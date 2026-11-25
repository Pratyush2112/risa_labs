import React, { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Panel, Decision, Field, Notice, Modal, Pill, NativeSelect } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { getDaily, updateCampaign, shiftBudget, createCampaign } from '../lib/data.js';
import { COLOR as C, reducedMotion } from '../lib/tokens.js';
import { inr, inrShort, num, pct, shortDate, STATUS_LABEL } from '../lib/format.js';

const COLS = [
  ['campaign_name', 'Campaign', 'text'], ['decision', 'Rule', 'decision'], ['spend', 'Spend', 'inr'],
  ['identified', 'Identified', 'num'], ['registered', 'Registered', 'num'], ['confirmed', 'Confirmed', 'num'], ['attended', 'Attended', 'num'],
  ['ident_to_reg', 'Ident → Reg', 'pct'], ['show_rate', 'Show rate', 'pct'], ['cost_per_registration', '₹ / reg', 'inr'],
  ['outcome_cost', '₹ / outcome', 'inr'], ['brochure_rate', 'Brochure', 'pct'], ['optout_rate', 'Opt-out', 'pct'],
];
const fmt = (type, v) => (type === 'inr' ? inr(v) : type === 'pct' ? pct(v) : type === 'num' ? num(v) : v);
const STATUS_TONE = { active: 'mute', scale: 'good', change: 'warn', paused: 'bad', stopped: 'bad' };

// The sticky first column needs an opaque background that still follows row hover / selection.
const STICKY_CELL = 'sticky left-0 z-10 bg-card shadow-[inset_-1px_0_0_var(--border)]';
const STICKY_HOVER = 'group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]';

const H3 = 'text-sm font-semibold tracking-tight';

export default function Campaigns({ d, tasks, owners, asOf, ask, refresh, version }) {
  const [sort, setSort] = useState(['outcome_cost', 1]);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const rows = useMemo(() => {
    const [k, dir] = sort;
    return [...d.campaigns].sort((a, b) => {
      const x = a[k]; const y = b[k];
      if (x == null) return 1; if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * dir;
    });
  }, [d.campaigns, sort]);
  const sel = d.campaigns.find((c) => c.campaign_id === selected);

  return (
    <div className="flex flex-col gap-4">
      <Panel pad={false} title={`Performance (outcome = ${d.preEvent ? 'confirmed registration' : 'verified attendee'})`}
        aside={<>
          <Button variant="outline" size="sm" onClick={() => ask('Rank our campaigns and tell me which to scale, change or stop, with the numbers behind each call.')}><Icon name="chat" />Rank with the analyst</Button>
          <Button variant="outline" size="sm" onClick={() => setShowNew(true)}><Icon name="plus" />Add campaign</Button>
        </>}>
        <Table className="border-t text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLS.map(([k, l, type], i) => {
                const active = sort[0] === k;
                const right = type !== 'text' && type !== 'decision';
                const SortIcon = active ? (sort[1] === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <TableHead key={k} aria-sort={active ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}
                    className={cn('h-9 px-3 text-xs font-medium text-muted-foreground', right && 'text-right', i === 0 && cn(STICKY_CELL, 'z-20 min-w-52 pl-5'), i === COLS.length - 1 && 'pr-5')}>
                    <button type="button" onClick={() => setSort(([sk, sd]) => [k, sk === k ? -sd : 1])}
                      className={cn('group/sort -mx-1 inline-flex h-7 items-center gap-1 rounded px-1 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        right && 'flex-row-reverse', active && 'text-foreground')}>
                      {l}
                      <SortIcon aria-hidden="true" className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60')} />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const on = c.campaign_id === selected;
              return (
                <TableRow key={c.campaign_id} data-state={on ? 'selected' : undefined} className="group has-aria-expanded:bg-muted">
                  <TableCell className={cn(STICKY_CELL, 'p-0', on ? 'bg-muted' : STICKY_HOVER)}>
                    <button type="button" onClick={() => setSelected(on ? null : c.campaign_id)} aria-expanded={on}
                      className="flex w-full min-w-52 flex-col items-start gap-1 py-2.5 pr-3 pl-5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
                      <span className="max-w-64 truncate font-medium text-foreground">{c.campaign_name}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{c.owner_name || 'No owner'} <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill></span>
                    </button>
                  </TableCell>
                  <TableCell className="px-3"><Decision value={c.decision} title={c.reason} /></TableCell>
                  {COLS.slice(2).map(([k, , type], i) => (
                    <TableCell key={k} className={cn('px-3 text-right tabular-nums', c[k] == null && 'text-muted-foreground', i === COLS.length - 3 && 'pr-5')}>{fmt(type, c[k])}</TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="border-t px-5 py-3 text-xs leading-relaxed text-pretty text-muted-foreground">
          Blended cost per outcome <span className="font-medium text-foreground">{inr(d.blendedOutcomeCost)}</span>. Scale at ≤ {d.settings.scale_ratio}× blended; change at ≥ {d.settings.change_ratio}× or opt-outs ≥ {pct(d.settings.optout_change, 0)};
          stop at ≥ {d.settings.stop_ratio}× or opt-outs ≥ {pct(d.settings.optout_stop, 0)}; fewer than {d.settings.min_outcomes} outcomes is insufficient. Rates per identified person. Select a campaign for detail.
        </p>
      </Panel>

      {sel && <Inspector key={sel.campaign_id} c={sel} d={d} tasks={tasks} owners={owners} asOf={asOf} ask={ask} refresh={refresh} version={version} onClose={() => setSelected(null)} />}

      <Allocation d={d} refresh={refresh} />

      {showNew && <NewCampaign owners={owners} existing={d.campaigns} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); refresh(); }} />}
    </div>
  );
}

const chartConfig = {
  spend: { label: 'Spend', color: C.grey },
  registrations: { label: 'Registrations', color: C.ink },
};

function Fact({ label, children }) {
  return (
    <>
      <dt className="pt-px text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </>
  );
}

function Inspector({ c, d, tasks, owners, asOf, ask, refresh, version, onClose }) {
  const [daily, setDaily] = useState([]);
  const [form, setForm] = useState({ status: c.status, allocated_budget_inr: c.allocated_budget_inr, owner_id: c.owner_id || '', decision_note: c.decision_note || '' });
  const [err, setErr] = useState(null);
  const [saved, setSaved] = useState(false);
  const [taskDraft, setTaskDraft] = useState(null);
  useEffect(() => { let a = true; getDaily(asOf, c.campaign_id).then((x) => a && setDaily(x)).catch(() => a && setDaily([])); return () => { a = false; }; }, [asOf, c.campaign_id, version]);

  const series = daily.map((x) => ({ date: shortDate(x.date), spend: x.spend, registrations: x.registrations }));
  const linked = tasks.filter((k) => k.campaign_id === c.campaign_id);
  const dirty = form.status !== c.status || Number(form.allocated_budget_inr) !== c.allocated_budget_inr || form.owner_id !== (c.owner_id || '') || form.decision_note !== (c.decision_note || '');

  async function save(e) {
    e.preventDefault(); setErr(null); setSaved(false);
    try { await updateCampaign(c.campaign_id, form); setSaved(true); refresh(); } catch (x) { setErr(x.message); }
  }

  return (
    <Panel title={c.campaign_name} description={c.target_audience}
      aside={<>
        <Button variant="outline" size="sm" onClick={() => ask(`Analyse ${c.campaign_name} (${c.campaign_id}): what is working, what is not, and what should we do next?`)}><Icon name="chat" />Analyse</Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onClose} aria-label="Close detail"><Icon name="close" /></Button>
      </>}>
      <div className="grid gap-6 border-t pt-4 @4xl/main:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] @4xl/main:gap-8">
        <div className="flex min-w-0 flex-col gap-5">
          <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2.5">
            <Fact label="Rule"><span className="flex flex-wrap items-center gap-x-2 gap-y-1"><Decision value={c.decision} /> <span className="text-xs text-muted-foreground">{c.reason}</span></span></Fact>
            <Fact label="Budget">{inr(c.spend)} of {inr(c.allocated_budget_inr)} <span className="text-muted-foreground">({pct(c.budget_used, 0)})</span></Fact>
            <Fact label="Funnel">{num(c.identified)} identified → {num(c.registered)} registered → {num(c.confirmed)} confirmed{!d.preEvent && <> → {num(c.attended)} attended</>}</Fact>
            <Fact label="Statuses"><span className="text-muted-foreground">{num(c.interested)} interested, {num(c.cancelled)} cancelled, {num(c.waitlisted)} waitlisted</span></Fact>
            <Fact label="Traffic"><span className="text-muted-foreground">{num(c.impressions)} impressions, {num(c.clicks)} clicks ({pct(c.ctr, 2)}), {num(c.sessions)} sessions — events, not people</span></Fact>
          </dl>
          {series.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-chart-5" aria-hidden="true" />Spend (left)</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-chart-1" aria-hidden="true" />Registrations (right)</span>
              </div>
              <ChartContainer config={chartConfig} className="aspect-auto h-[170px] w-full">
                <ComposedChart data={series} margin={{ top: 6, right: 0, left: -18, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickMargin={6} interval={Math.max(0, Math.floor(series.length / 5))} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => inrShort(v)} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent formatter={(v, n, item) => (
                    <div className="flex w-full items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                      <span className="text-muted-foreground">{chartConfig[n]?.label ?? n}</span>
                      <span className="ml-auto font-medium text-foreground tabular-nums">{n === 'spend' ? inr(v) : num(v)}</span>
                    </div>
                  )} />} />
                  <Bar yAxisId="l" dataKey="spend" name="spend" fill="var(--color-spend)" radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                  <Line yAxisId="r" dataKey="registrations" name="registrations" stroke="var(--color-registrations)" dot={false} strokeWidth={1.75} isAnimationActive={!reducedMotion} />
                </ComposedChart>
              </ChartContainer>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <form className="flex flex-col gap-3" onSubmit={save}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <NativeSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {['active', 'scale', 'change', 'paused', 'stopped'].map((s) => <option key={s} value={s}>{s}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Allocated (₹)"><Input type="number" min="0" step="1000" value={form.allocated_budget_inr} onChange={(e) => setForm({ ...form, allocated_budget_inr: e.target.value })} /></Field>
            </div>
            <Field label="Owner">
              <NativeSelect value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
                {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Decision note"><Input value={form.decision_note} maxLength={500} onChange={(e) => setForm({ ...form, decision_note: e.target.value })} placeholder="Why this status?" /></Field>
            <Notice>{err}</Notice>
            <div className="flex items-center justify-end gap-3">
              {saved && !dirty && <span className="inline-flex items-center gap-1 text-xs font-medium text-success" role="status"><Icon name="check" size={14} />Saved</span>}
              <Button size="sm" disabled={!dirty}>Save changes</Button>
            </div>
          </form>
          <Separator />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className={H3}>Linked tasks</h3>
              <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setTaskDraft({ campaign_id: c.campaign_id, owner_id: c.owner_id, priority: 'medium' })}><Icon name="plus" size={14} />Add</Button>
            </div>
            <ul className="flex flex-col divide-y">
              {linked.map((k) => (
                <li key={k.task_id} className="flex flex-col gap-1 py-2 first:pt-0">
                  <span className="flex items-start gap-2 text-sm">
                    <Pill tone={k.status === 'done' ? 'good' : k.status === 'blocked' ? 'bad' : 'mute'} className="mt-px">{STATUS_LABEL[k.status]}</Pill>
                    <span className="min-w-0">{k.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{k.owner?.owner_name || 'Unassigned'}{k.due_date ? `, ${shortDate(k.due_date)}` : ''}</span>
                </li>
              ))}
              {!linked.length && <li className="text-xs text-muted-foreground">No tasks for this campaign.</li>}
            </ul>
          </div>
        </div>
      </div>
      {taskDraft && <TaskModal initial={taskDraft} campaigns={d.campaigns} owners={owners} onClose={() => setTaskDraft(null)} onSaved={() => { setTaskDraft(null); refresh(); }} />}
    </Panel>
  );
}

function Allocation({ d, refresh }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [why, setWhy] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const total = d.campaigns.reduce((a, c) => a + c.allocated_budget_inr, 0);
  const approved = d.targets?.budget_inr;
  const max = Math.max(1, ...d.campaigns.map((c) => Math.max(c.allocated_budget_inr, c.spend)));

  async function go(e) {
    e.preventDefault(); setErr(null); setMsg(null);
    try {
      await shiftBudget(from, to, amount, why);
      setMsg(`Moved ${inr(Number(amount))}. Allocations and analytics are updated.`);
      setAmount(''); setWhy(''); refresh();
    } catch (x) { setErr(x.message); }
  }

  return (
    <Panel title="Budget allocation" aside={<span>{inr(total)} allocated{approved ? ` of ${inr(approved)} approved, ${inr(approved - total)} unallocated` : ''}</span>}>
      <div className="grid gap-6 border-t pt-4 @4xl/main:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] @4xl/main:gap-8">
        <div className="@container/alloc flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 @md/alloc:gap-2.5">
            {d.campaigns.map((c) => {
              const over = c.spend > c.allocated_budget_inr;
              return (
                <div key={c.campaign_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 @md/alloc:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_7.5rem]">
                  <div className="truncate text-sm font-medium">{c.campaign_name}</div>
                  <div className="relative order-last col-span-2 h-3 @md/alloc:order-none @md/alloc:col-span-1" title={`${inr(c.spend)} spent of ${inr(c.allocated_budget_inr)}`}>
                    <span className="absolute inset-y-0 left-0 rounded-[3px] bg-muted ring-1 ring-border ring-inset" style={{ width: `${(c.allocated_budget_inr / max) * 100}%` }} />
                    <span className={cn('absolute inset-y-[3px] left-0 rounded-[2px]', over ? 'bg-danger' : 'bg-foreground')} style={{ width: `${(Math.max(0, c.spend) / max) * 100}%` }} />
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <span className={cn(over && 'text-danger')}>{inrShort(c.spend)}</span> <span className="text-muted-foreground">/ {inrShort(c.allocated_budget_inr)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[2px] bg-muted ring-1 ring-border ring-inset" />Allocated</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[2px] bg-foreground" />Spent to date</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-[2px] bg-danger" />Over allocation</span>
          </div>
          <p className="text-xs text-muted-foreground">Starting allocations are simulated (the dataset records spend, not allocations).</p>
        </div>
        <form className="flex min-w-0 flex-col gap-3 border-t pt-5 @4xl/main:border-t-0 @4xl/main:border-l @4xl/main:pt-0 @4xl/main:pl-8" onSubmit={go}>
          <h3 className={H3}>Move budget</h3>
          <div className="grid grid-cols-1 gap-3 @lg/main:grid-cols-2 @4xl/main:grid-cols-1">
            <Field label="From">
              <NativeSelect value={from} onChange={(e) => setFrom(e.target.value)} required>
                <option value="">Choose…</option>
                {d.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name} ({inrShort(c.allocated_budget_inr)})</option>)}
              </NativeSelect>
            </Field>
            <Field label="To">
              <NativeSelect value={to} onChange={(e) => setTo(e.target.value)} required>
                <option value="">Choose…</option>
                {d.campaigns.filter((c) => c.campaign_id !== from).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Amount (₹)"><Input type="number" min="1" step="500" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          <Field label="Reason"><Input value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} placeholder="For example: Paid Social meets the stop rule" /></Field>
          <Notice>{err}</Notice>
          <Notice tone="good">{msg}</Notice>
          <div className="flex justify-end"><Button size="sm">Move budget</Button></div>
        </form>
      </div>
    </Panel>
  );
}

function NewCampaign({ owners, existing, onClose, onSaved }) {
  const next = `C${String(existing.length + 1).padStart(2, '0')}`;
  const [c, setC] = useState({ campaign_id: next, campaign_name: '', channel: '', owner_id: owners[0]?.owner_id || '', target_audience: '', objective: '', allocated_budget_inr: 0 });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    if (!/^C\d{2,3}$/.test(c.campaign_id.trim().toUpperCase())) return setErr('Campaign IDs look like C08.');
    try { await createCampaign(c); onSaved(); } catch (x) { setErr(x.message); }
  }
  return (
    <Modal title="Add campaign" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <Field label="Campaign ID"><Input value={c.campaign_id} onChange={set('campaign_id')} required /></Field>
          <Field label="Name"><Input value={c.campaign_name} onChange={set('campaign_name')} required maxLength={80} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Channel"><Input value={c.channel} onChange={set('channel')} placeholder="club_squads" /></Field>
          <Field label="Owner"><NativeSelect value={c.owner_id} onChange={set('owner_id')}>{owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}</NativeSelect></Field>
          <Field label="Allocated (₹)"><Input type="number" min="0" value={c.allocated_budget_inr} onChange={set('allocated_budget_inr')} /></Field>
        </div>
        <Field label="Target audience"><Input value={c.target_audience} onChange={set('target_audience')} /></Field>
        <Field label="Objective"><Input value={c.objective} onChange={set('objective')} /></Field>
        <p className="text-xs text-muted-foreground">Add the campaign's daily activity in the Data Lab; its funnel fills in as people are attributed to it.</p>
        <Notice>{err}</Notice>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button>Create campaign</Button>
        </div>
      </form>
    </Modal>
  );
}
