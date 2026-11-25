// A small, strictly validated query language that runs over record-level datasets fetched with
// parameterized RPCs. The model chooses a dataset, filters, groupings and aggregates from fixed
// whitelists. Nothing it writes is ever interpolated into SQL.

export const DATASETS = {
  registrations: {
    description: 'One row per registration at the as-of date, with latest status, attendance and engagement flags.',
    fields: {
      registration_id: 'string', person_id: 'string', person_type: 'string', campaign_id: 'string', campaign_name: 'string',
      registered_date: 'date', registered_week: 'date', days_before_event: 'number', latest_status: 'string',
      attended: 'boolean', downloaded_brochure: 'boolean', asked_question: 'boolean', clicked_email: 'boolean', opted_out: 'boolean',
    },
  },
  people: {
    description: 'One row per identified person first seen by the as-of date.',
    fields: {
      person_id: 'string', person_type: 'string', first_touch_source: 'string', first_campaign_id: 'string', campaign_name: 'string',
      first_seen_date: 'date', first_seen_week: 'date', registered: 'boolean', attended: 'boolean', downloaded_brochure: 'boolean', opted_out: 'boolean',
    },
  },
  checkins: {
    description: 'One row per admission record (several can belong to one person). Verified visit = is_verified_admission.',
    fields: {
      event_id: 'string', person_id: 'string', person_type: 'string', registration_id: 'string', campaign_id: 'string', campaign_name: 'string',
      checkin_date: 'date', checkin_hour: 'number', event_day: 'number', result: 'string', verification: 'string', source: 'string',
      is_verified_admission: 'boolean',
    },
  },
  interactions: {
    description: 'One row per identified engagement action.',
    fields: {
      interaction_id: 'string', person_id: 'string', person_type: 'string', campaign_id: 'string', campaign_name: 'string',
      event_type: 'string', occurred_date: 'date', occurred_week: 'date',
    },
  },
  daily_marketing: {
    description: 'One row per campaign per day of anonymous activity and net spend (not unique people).',
    fields: {
      activity_id: 'string', campaign_id: 'string', campaign_name: 'string', activity_date: 'date', activity_week: 'date',
      impressions: 'number', clicks: 'number', reported_reach: 'number', landing_page_sessions: 'number',
      registration_starts: 'number', marketing_spend_inr: 'number',
    },
  },
  status_history: {
    description: 'One row per registration status version effective by the as-of date.',
    fields: { history_id: 'string', registration_id: 'string', campaign_id: 'string', campaign_name: 'string', status: 'string', effective_date: 'date' },
  },
  tasks: {
    description: 'Tasks in the management tool; overdue is judged against the as-of date.',
    fields: {
      task_id: 'string', title: 'string', campaign_id: 'string', campaign_name: 'string', owner_name: 'string', due_date: 'date',
      priority: 'string', status: 'string', source: 'string', overdue: 'boolean',
    },
  },
};

export const FILTER_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'is_null', 'not_null'];
export const AGG_FNS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'];
const MAX_LIMIT = 50;

class QueryError extends Error {}

function coerce(type, raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (type === 'number') {
    const n = Number(s.replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new QueryError(`"${s}" is not a number`);
    return n;
  }
  if (type === 'boolean') {
    if (/^(true|yes|1)$/i.test(s)) return true;
    if (/^(false|no|0)$/i.test(s)) return false;
    throw new QueryError(`"${s}" is not true/false`);
  }
  if (type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new QueryError(`"${s}" is not a YYYY-MM-DD date`);
    return s;
  }
  return s;
}

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function makePredicate(f, fields) {
  const type = fields[f.field];
  if (!type) throw new QueryError(`Unknown field "${f.field}". Allowed: ${Object.keys(fields).join(', ')}`);
  if (!FILTER_OPS.includes(f.op)) throw new QueryError(`Unknown operator "${f.op}"`);
  const k = f.field;
  switch (f.op) {
    case 'is_null': return (r) => r[k] == null;
    case 'not_null': return (r) => r[k] != null;
    case 'in':
    case 'not_in': {
      const set = new Set(String(f.value ?? '').split(',').map((v) => coerce(type, v)));
      return f.op === 'in' ? (r) => set.has(r[k]) : (r) => !set.has(r[k]);
    }
    case 'contains': {
      const needle = String(f.value ?? '').toLowerCase();
      return (r) => r[k] != null && String(r[k]).toLowerCase().includes(needle);
    }
    default: {
      const v = coerce(type, f.value);
      const cmp = { eq: (c) => c === 0, neq: (c) => c !== 0, gt: (c) => c > 0, gte: (c) => c >= 0, lt: (c) => c < 0, lte: (c) => c <= 0 }[f.op];
      return (r) => r[k] != null && cmp(compare(r[k], v));
    }
  }
}

function aggregate(rows, agg, fields) {
  const { fn, field } = agg;
  if (fn === 'count') return rows.length;
  if (!field || !fields[field]) throw new QueryError(`Aggregate ${fn} needs a valid field`);
  const vals = rows.map((r) => r[field]).filter((v) => v != null);
  if (fn === 'count_distinct') return new Set(vals).size;
  const nums = vals.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : Number(v))).filter(Number.isFinite);
  if (!nums.length) return null;
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (fn === 'min') return Math.min(...nums);
  if (fn === 'max') return Math.max(...nums);
  throw new QueryError(`Unknown aggregate "${fn}"`);
}

const round = (v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10000) / 10000 : v);

/**
 * spec = { filters?, group_by?, aggregates?, select?, order_by?, limit? }
 * Returns { rows, matched_rows, scanned_rows, notes }
 */
export function runQuery(dataset, allRows, spec = {}) {
  const def = DATASETS[dataset];
  if (!def) throw new QueryError(`Unknown dataset "${dataset}"`);
  const { fields } = def;
  const filters = (spec.filters || []).slice(0, 10).map((f) => makePredicate(f, fields));
  const matched = allRows.filter((r) => filters.every((p) => p(r)));

  const groupBy = (spec.group_by || []).slice(0, 3);
  groupBy.forEach((g) => { if (!fields[g]) throw new QueryError(`Unknown group_by field "${g}"`); });
  const aggs = (spec.aggregates || []).slice(0, 8).map((a) => {
    if (!AGG_FNS.includes(a.fn)) throw new QueryError(`Unknown aggregate "${a.fn}"`);
    const alias = (a.as && /^[a-z][a-z0-9_]{0,40}$/i.test(a.as)) ? a.as : (a.fn === 'count' ? 'count' : `${a.fn}_${a.field}`);
    return { ...a, alias };
  });

  let out;
  const notes = [];
  if (groupBy.length || aggs.length) {
    const useAggs = aggs.length ? aggs : [{ fn: 'count', alias: 'count' }];
    const groups = new Map();
    for (const r of matched) {
      const key = JSON.stringify(groupBy.map((g) => r[g] ?? null));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    if (!groupBy.length && !groups.size) groups.set('[]', []);
    out = [...groups.entries()].map(([key, rs]) => {
      const keyVals = JSON.parse(key);
      const row = Object.fromEntries(groupBy.map((g, i) => [g, keyVals[i]]));
      useAggs.forEach((a) => { row[a.alias] = round(aggregate(rs, a, fields)); });
      row.rows_in_group = rs.length;
      return row;
    });
    if (useAggs.some((a) => a.fn === 'avg' && fields[a.field] === 'boolean')) notes.push('avg of a true/false field is the share of rows where it is true (0–1).');
  } else {
    const select = (spec.select || Object.keys(fields)).filter((f) => fields[f]).slice(0, 12);
    out = matched.map((r) => Object.fromEntries(select.map((f) => [f, r[f]])));
  }

  if (spec.order_by?.field) {
    const k = spec.order_by.field;
    const dir = spec.order_by.direction === 'asc' ? 1 : -1;
    if (out.length && !(k in out[0])) throw new QueryError(`order_by field "${k}" is not in the result`);
    out.sort((a, b) => compare(a[k], b[k]) * dir);
  }
  const limit = Math.min(Math.max(Number(spec.limit) || 25, 1), MAX_LIMIT);
  const total = out.length;
  if (total > limit) notes.push(`Showing ${limit} of ${total} result rows.`);
  return { rows: out.slice(0, limit), result_rows: total, matched_rows: matched.length, scanned_rows: allRows.length, notes };
}

export { QueryError };
