import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { deriveSnapshot, snapshotForAI, betBand, safeDiv } from '../../shared/metrics.js';
import { DATASETS, FILTER_OPS, AGG_FNS, runQuery } from './query-engine.js';
import { evaluate } from './calc.js';

export const METRICS = [
  'spend', 'allocated_budget_inr', 'budget_used', 'impressions', 'clicks', 'ctr', 'sessions',
  'identified', 'registered', 'confirmed', 'attended', 'ident_to_reg', 'confirm_rate', 'show_rate',
  'cost_per_identified', 'cost_per_registration', 'cost_per_confirmed', 'cost_per_attendee',
  'brochure_people', 'brochure_rate', 'question_people', 'optout_people', 'optout_rate',
];
const SUMMABLE = new Set(['spend', 'allocated_budget_inr', 'impressions', 'clicks', 'sessions', 'identified', 'registered', 'confirmed', 'attended', 'brochure_people', 'question_people', 'optout_people']);
const LOWER_IS_BETTER = new Set(['cost_per_identified', 'cost_per_registration', 'cost_per_confirmed', 'cost_per_attendee', 'optout_rate', 'optout_people', 'budget_used']);
const SERIES = ['spend', 'sessions', 'identified', 'registrations', 'visitors'];

// A factory, not a shared constant: reusing one zod object makes the JSON schema emit $ref, which Gemini rejects.
const DATE = () => z.string().describe('YYYY-MM-DD between 2025-01-15 and 2025-04-20');
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
const clampDate = (d, fallback) => (d && /^2025-\d{2}-\d{2}$/.test(d) && d >= '2025-01-15' && d <= '2025-04-20' ? d : fallback);

function totalsRow(rows, preEvent) {
  const t = {};
  SUMMABLE.forEach((k) => { t[k] = rows.reduce((a, c) => a + (c[k] || 0), 0); });
  return {
    ...t,
    budget_used: safeDiv(t.spend, t.allocated_budget_inr), ctr: safeDiv(t.clicks, t.impressions),
    ident_to_reg: safeDiv(t.registered, t.identified), confirm_rate: safeDiv(t.confirmed, t.registered),
    show_rate: preEvent ? null : safeDiv(t.attended, t.registered),
    cost_per_identified: safeDiv(t.spend, t.identified), cost_per_registration: safeDiv(t.spend, t.registered),
    cost_per_confirmed: safeDiv(t.spend, t.confirmed), cost_per_attendee: preEvent ? null : safeDiv(t.spend, t.attended),
    brochure_rate: safeDiv(t.brochure_people, t.identified), optout_rate: safeDiv(t.optout_people, t.identified),
  };
}

function weekStart(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** ctx: { db, asOf, owners, campaigns, trace, proposals, evidence, cache } */
export function makeTools(ctx) {
  const cached = async (key, fn) => {
    if (!ctx.cache.has(key)) ctx.cache.set(key, fn());
    return ctx.cache.get(key);
  };

  ctx.getDerived = (date) => cached(`snap:${date}`, async () => {
    const [{ data, error }, { data: tasks }] = await Promise.all([
      ctx.db.rpc('growth_snapshot', { p_as_of: date }),
      ctx.db.from('tasks').select('title,status,due_date'),
    ]);
    if (error) throw new Error(error.message);
    return deriveSnapshot(data, { tasks: tasks || [] });
  });

  ctx.getDataset = (name, date) => cached(`ds:${name}:${date}`, async () => {
    if (name === 'tasks') {
      const { data, error } = await ctx.db.from('tasks')
        .select('task_id,title,campaign_id,due_date,priority,status,source,campaign:campaigns(campaign_name),owner:owners(owner_name)');
      if (error) throw new Error(error.message);
      return data.map((t) => ({
        task_id: t.task_id, title: t.title, campaign_id: t.campaign_id, campaign_name: t.campaign?.campaign_name ?? null,
        owner_name: t.owner?.owner_name ?? null, due_date: t.due_date, priority: t.priority, status: t.status, source: t.source,
        overdue: t.status !== 'done' && Boolean(t.due_date) && t.due_date < date,
      }));
    }
    const { data, error } = await ctx.db.rpc('dataset_rows', { p_dataset: name, p_as_of: date });
    if (error) throw new Error(error.message);
    return data;
  });

  // Wrap every tool: timing, trace, evidence capture and uniform error handling.
  const wrap = (name, fn, summarize) => async (args) => {
    const t0 = Date.now();
    try {
      const result = await fn(args);
      ctx.evidence.push(result);
      ctx.trace.push({ name, detail: summarize ? summarize(args, result) : JSON.stringify(args).slice(0, 240), ms: Date.now() - t0 });
      return JSON.stringify(result);
    } catch (e) {
      ctx.trace.push({ name, detail: JSON.stringify(args).slice(0, 240), error: e.message, ms: Date.now() - t0 });
      return JSON.stringify({ error: e.message, hint: 'Check the arguments against the tool description and retry once.' });
    }
  };

  const getKpiSnapshot = tool(
    wrap('get_kpi_snapshot', async ({ as_of }) => snapshotForAI(await ctx.getDerived(clampDate(as_of, ctx.asOf))),
      (a) => `as of ${a.as_of || ctx.asOf}`),
    {
      name: 'get_kpi_snapshot',
      description: 'Totals, targets in effect, attainment, pace, projection, per-campaign funnel/costs/rule decisions and alerts at the end of a given date. Use for dates other than the context snapshot.',
      schema: z.object({ as_of: DATE().optional() }),
    },
  );

  const compareKpis = tool(
    wrap('compare_kpis', async ({ metrics: requested, campaign_ids, as_of, baseline_as_of }) => {
      const metrics = [...new Set((requested || []).filter((m) => METRICS.includes(m)))].slice(0, 8);
      if (!metrics.length) throw new Error(`Choose 1–8 metrics from: ${METRICS.join(', ')}`);
      const date = clampDate(as_of, ctx.asOf);
      const d = await ctx.getDerived(date);
      const ids = campaign_ids?.length ? new Set(campaign_ids.map((s) => s.toUpperCase())) : null;
      const rows = d.campaigns.filter((c) => !ids || ids.has(c.campaign_id));
      if (!rows.length) throw new Error('No matching campaigns. Use ids like C01–C07.');
      const total = totalsRow(d.campaigns, d.preEvent);
      const base = baseline_as_of ? await ctx.getDerived(clampDate(baseline_as_of, date)) : null;
      const table = rows.map((c) => {
        const out = { campaign_id: c.campaign_id, campaign: c.campaign_name, rule_decision: c.decision };
        metrics.forEach((m) => {
          out[m] = r4(c[m]);
          if (base) {
            const b = base.campaigns.find((x) => x.campaign_id === c.campaign_id)?.[m];
            out[`${m}_at_baseline`] = r4(b);
            out[`${m}_change`] = b == null || c[m] == null ? null : r4(c[m] - b);
          }
        });
        return out;
      });
      const ranks = {};
      metrics.forEach((m) => {
        const sorted = table.filter((r) => r[m] != null).sort((a, b) => (LOWER_IS_BETTER.has(m) ? a[m] - b[m] : b[m] - a[m]));
        ranks[m] = { best: sorted[0]?.campaign ?? null, worst: sorted.at(-1)?.campaign ?? null, better_is: LOWER_IS_BETTER.has(m) ? 'lower' : 'higher' };
      });
      return {
        as_of: date, baseline_as_of: base ? base.as_of : null, event_started: d.event_started,
        outcome_definition: d.preEvent ? 'confirmed registration (pre-event)' : 'verified attendee',
        rows: table,
        all_campaigns_total: Object.fromEntries(metrics.map((m) => [m, r4(total[m])])),
        ranks,
      };
    }, (a, r) => `${(a.metrics || []).join(', ')} · ${r.rows.length} campaigns · as of ${r.as_of}${r.baseline_as_of ? ` vs ${r.baseline_as_of}` : ''}`),
    {
      name: 'compare_kpis',
      description: 'Compare campaigns side by side on chosen metrics, with all-campaign totals, best/worst per metric, and optional change versus a baseline date.',
      schema: z.object({
        metrics: z.array(z.enum(METRICS)).describe('1 to 8 metrics to compare'),
        campaign_ids: z.array(z.string()).optional().describe('e.g. ["C02","C04"]; omit for all campaigns'),
        as_of: DATE().optional(),
        baseline_as_of: DATE().optional().describe('Earlier date to compute change against'),
      }),
    },
  );

  const getTimeseries = tool(
    wrap('get_timeseries', async ({ metric, grain = 'week', campaign_id, from, as_of }) => {
      const date = clampDate(as_of, ctx.asOf);
      const cid = campaign_id ? campaign_id.toUpperCase() : null;
      const { data, error } = await ctx.db.rpc('growth_daily', { p_as_of: date, p_campaign_id: cid });
      if (error) throw new Error(error.message);
      const days = data.filter((x) => !from || x.date >= from);
      const buckets = new Map();
      days.forEach((x) => {
        const k = grain === 'day' ? x.date : weekStart(x.date);
        buckets.set(k, (buckets.get(k) || 0) + (x[metric] || 0));
      });
      let cum = 0;
      const points = [...buckets.entries()].map(([period, value]) => { cum += value; return { period, value, cumulative: cum }; });
      const peak = points.reduce((a, p) => (!a || p.value > a.value ? p : a), null);
      return {
        metric, grain, campaign_id: cid || 'all', as_of: date,
        points: grain === 'day' ? points.slice(-60) : points,
        total: cum, average_per_period: points.length ? r4(cum / points.length) : null, peak,
        note: grain === 'week' ? 'Weeks start on Monday; the first and last weeks can be partial.' : undefined,
      };
    }, (a, r) => `${a.metric} by ${r.grain}${a.campaign_id ? ` · ${a.campaign_id}` : ''} · total ${r.total}`),
    {
      name: 'get_timeseries',
      description: 'Daily or weekly series up to the as-of date for spend, sessions, newly identified people, new registrations or new verified visitors; optionally one campaign.',
      schema: z.object({
        metric: z.enum(SERIES),
        grain: z.enum(['day', 'week']).optional(),
        campaign_id: z.string().optional(),
        from: DATE().optional(),
        as_of: DATE().optional(),
      }),
    },
  );

  const queryData = tool(
    wrap('query_data', async ({ dataset, filters, group_by, aggregates, select, order_by, limit, as_of }) => {
      const date = clampDate(as_of, ctx.asOf);
      const rows = await ctx.getDataset(dataset, date);
      const res = runQuery(dataset, rows, { filters, group_by, aggregates, select, order_by, limit });
      return { dataset, as_of: date, ...res };
    }, (a, r) => `${a.dataset}${a.filters?.length ? ` where ${a.filters.map((f) => `${f.field} ${f.op} ${f.value ?? ''}`.trim()).join(' and ')}` : ''}${a.group_by?.length ? ` by ${a.group_by.join(', ')}` : ''} → ${r.result_rows} rows of ${r.scanned_rows}`),
    {
      name: 'query_data',
      description: 'Filter, group and aggregate record-level data (registrations, people, checkins, interactions, daily_marketing, status_history, tasks) at the as-of date. Use for cohorts, custom breakdowns and questions the snapshot cannot answer.',
      schema: z.object({
        dataset: z.enum(Object.keys(DATASETS)),
        filters: z.array(z.object({
          field: z.string(),
          op: z.enum(FILTER_OPS),
          value: z.string().optional().describe('String form: "true", "120", "2025-03-15", or "C02,C03" for in/not_in'),
        })).optional().describe('Up to 10 filters, combined with AND'),
        group_by: z.array(z.string()).optional().describe('Up to 3 fields'),
        aggregates: z.array(z.object({
          fn: z.enum(AGG_FNS),
          field: z.string().optional(),
          as: z.string().optional(),
        })).optional().describe('Up to 8 aggregates'),
        select: z.array(z.string()).optional().describe('Up to 12 fields to return when not aggregating'),
        order_by: z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
        limit: z.number().int().optional().describe('1 to 50, default 25'),
        as_of: DATE().optional(),
      }),
    },
  );

  const calculate = tool(
    wrap('calculate', async ({ expression, label }) => ({ label: label || null, expression, result: evaluate(expression) }),
      (a, r) => `${a.label ? `${a.label}: ` : ''}${a.expression} = ${r.result}`),
    {
      name: 'calculate',
      description: 'Evaluate arithmetic exactly: + - * / ^ ( ), percentages like 5%, and round(x,d), abs, min, max, sqrt. Use for every derived number you state.',
      schema: z.object({ expression: z.string().describe('Arithmetic only, under 300 characters'), label: z.string().optional() }),
    },
  );

  const listTasks = tool(
    wrap('list_tasks', async ({ status, campaign_id, overdue_only }) => {
      let rows = await ctx.getDataset('tasks', ctx.asOf);
      if (status) rows = rows.filter((t) => t.status === status);
      if (campaign_id) rows = rows.filter((t) => t.campaign_id === campaign_id.toUpperCase());
      if (overdue_only) rows = rows.filter((t) => t.overdue);
      return { as_of: ctx.asOf, count: rows.length, tasks: rows.slice(0, 40) };
    }, (a, r) => `${r.count} tasks${a.status ? ` · ${a.status}` : ''}${a.overdue_only ? ' · overdue' : ''}`),
    {
      name: 'list_tasks',
      description: 'Tasks with campaign, owner, due date, priority, status, source and overdue flag (relative to the as-of date).',
      schema: z.object({
        status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
        campaign_id: z.string().optional(),
        overdue_only: z.boolean().optional(),
      }),
    },
  );

  const listBets = tool(
    wrap('list_bets', async () => {
      const { data, error } = await ctx.db.from('bets').select('*, owner:owners(owner_name)').order('rank');
      if (error) throw new Error(error.message);
      return { note: 'Readings are entered by the team; seeded readings are simulated.', bets: data.map((b) => ({ ...b, owner_name: b.owner?.owner_name, owner: undefined, ...betBand(b) })) };
    }, (a, r) => `${r.bets.length} bets`),
    {
      name: 'list_bets',
      description: 'The five ranked growth bets with KPI, plan value, scale/continue/stop lines, minimum sample, latest reading and resulting band.',
      schema: z.object({ include_concepts: z.boolean().optional() }),
    },
  );

  const resolveOwner = (v) => {
    if (!v) return null;
    const s = String(v).trim().toLowerCase();
    return ctx.owners.find((o) => o.owner_id.toLowerCase() === s || o.owner_name.toLowerCase() === s)
      || ctx.owners.find((o) => o.owner_name.toLowerCase().includes(s)) || null;
  };
  const findCampaign = (id) => ctx.campaigns.find((c) => c.campaign_id === String(id || '').toUpperCase()) || null;

  const proposeTask = tool(
    wrap('propose_task', async ({ title, description, campaign_id, owner, due_date, priority }) => {
      if (!title || title.trim().length < 3) throw new Error('Title needs at least 3 characters');
      const camp = campaign_id ? findCampaign(campaign_id) : null;
      if (campaign_id && !camp) throw new Error(`Unknown campaign ${campaign_id}`);
      const own = resolveOwner(owner) || (camp ? ctx.owners.find((o) => o.owner_id === camp.owner_id) : null);
      const p = {
        type: 'task', title: title.trim().slice(0, 160), description: (description || '').slice(0, 1500),
        campaign_id: camp?.campaign_id || null, campaign_name: camp?.campaign_name || null,
        owner_id: own?.owner_id || null, owner_name: own?.owner_name || null,
        due_date: clampDate(due_date, null), priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      };
      ctx.proposals.push(p);
      return { status: 'proposed_awaiting_user_confirmation', proposal: p };
    }, (a) => a.title),
    {
      name: 'propose_task',
      description: 'Propose a task. It appears as an editable card; nothing is saved until the user confirms.',
      schema: z.object({
        title: z.string().describe('3 to 160 characters'),
        description: z.string().describe('What to do and the evidence (numbers) behind it'),
        campaign_id: z.string().optional(),
        owner: z.string().optional().describe('Owner name or id; defaults to the campaign owner'),
        due_date: DATE().optional(),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    },
  );

  const proposeBudgetShift = tool(
    wrap('propose_budget_shift', async ({ from_campaign_id, to_campaign_id, amount_inr, rationale }) => {
      const d = await ctx.getDerived(ctx.asOf);
      const from = d.campaigns.find((c) => c.campaign_id === from_campaign_id.toUpperCase());
      const to = d.campaigns.find((c) => c.campaign_id === to_campaign_id.toUpperCase());
      if (!from || !to) throw new Error('Unknown campaign id');
      if (!Number.isInteger(amount_inr) || amount_inr <= 0) throw new Error('Amount must be a positive whole number of rupees');
      if (from.campaign_id === to.campaign_id) throw new Error('Choose two different campaigns');
      if (amount_inr > from.allocated_budget_inr) throw new Error(`Amount exceeds ${from.campaign_name}'s allocation of ₹${from.allocated_budget_inr}`);
      const p = { type: 'budget_shift', from_campaign_id: from.campaign_id, from_name: from.campaign_name, to_campaign_id: to.campaign_id, to_name: to.campaign_name, amount_inr, rationale: String(rationale || '').slice(0, 500) };
      ctx.proposals.push(p);
      return { status: 'proposed_awaiting_user_confirmation', proposal: p, from_allocation_now: from.allocated_budget_inr, to_allocation_now: to.allocated_budget_inr };
    }, (a) => `${a.from_campaign_id} → ${a.to_campaign_id} ₹${a.amount_inr}`),
    {
      name: 'propose_budget_shift',
      description: 'Propose moving allocated budget between campaigns. Applied only after the user confirms.',
      schema: z.object({
        from_campaign_id: z.string(), to_campaign_id: z.string(),
        amount_inr: z.number().int().describe('Positive whole rupees'),
        rationale: z.string(),
      }),
    },
  );

  const proposeStatus = tool(
    wrap('propose_campaign_status', async ({ campaign_id, status, note }) => {
      const camp = findCampaign(campaign_id);
      if (!camp) throw new Error(`Unknown campaign ${campaign_id}`);
      const p = { type: 'campaign_status', campaign_id: camp.campaign_id, campaign_name: camp.campaign_name, from_status: camp.status, status, note: String(note || '').slice(0, 500) };
      ctx.proposals.push(p);
      return { status: 'proposed_awaiting_user_confirmation', proposal: p };
    }, (a) => `${a.campaign_id} → ${a.status}`),
    {
      name: 'propose_campaign_status',
      description: 'Propose a campaign status change with a decision note. Applied only after the user confirms.',
      schema: z.object({
        campaign_id: z.string(),
        status: z.enum(['active', 'scale', 'change', 'paused', 'stopped']),
        note: z.string(),
      }),
    },
  );

  return [getKpiSnapshot, compareKpis, getTimeseries, queryData, calculate, listTasks, listBets, proposeTask, proposeBudgetShift, proposeStatus];
}
