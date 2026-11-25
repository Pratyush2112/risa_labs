import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Panel, Decision, Field, Notice, Modal, Pill } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { getDaily, updateCampaign, shiftBudget, createCampaign } from '../lib/data.js';
import { inr, inrShort, num, pct, shortDate, STATUS_LABEL } from '../lib/format.js';

const COLS = [
  ['campaign_name', 'Campaign', 'text'], ['decision', 'Rule', 'decision'], ['spend', 'Spend', 'inr'],
  ['identified', 'Identified', 'num'], ['registered', 'Registered', 'num'], ['confirmed', 'Confirmed', 'num'], ['attended', 'Attended', 'num'],
  ['ident_to_reg', 'Ident → Reg', 'pct'], ['show_rate', 'Show rate', 'pct'], ['cost_per_registration', '₹ / reg', 'inr'],
  ['outcome_cost', '₹ / outcome', 'inr'], ['brochure_rate', 'Brochure', 'pct'], ['optout_rate', 'Opt-out', 'pct'],
];
const fmt = (type, v) => (type === 'inr' ? inr(v) : type === 'pct' ? pct(v) : type === 'num' ? num(v) : v);
const STATUS_TONE = { active: 'mute', scale: 'good', change: 'warn', paused: 'bad', stopped: 'bad' };

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
    <div className="stack">
      <Panel pad={false} title={`Performance (outcome = ${d.preEvent ? 'confirmed registration' : 'verified attendee'})`}
        aside={<>
          <button className="btn ghost sm" onClick={() => ask('Rank our campaigns and tell me which to scale, change or stop, with the numbers behind each call.')}><Icon name="chat" size={16} />Rank with the analyst</button>
          <button className="btn ghost sm" onClick={() => setShowNew(true)}><Icon name="plus" size={16} />Add campaign</button>
        </>}>
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>{COLS.map(([k, l, type]) => (
                <th key={k} className={type === 'text' || type === 'decision' ? '' : 'num'} aria-sort={sort[0] === k ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}>
                  <button className="sort" onClick={() => setSort(([sk, sd]) => [k, sk === k ? -sd : 1])}>{l}{sort[0] === k && <span aria-hidden="true">{sort[1] === 1 ? ' ↑' : ' ↓'}</span>}</button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.campaign_id} className={c.campaign_id === selected ? 'is-selected' : ''}>
                  <td className="sticky">
                    <button className="rowlink" onClick={() => setSelected(c.campaign_id === selected ? null : c.campaign_id)} aria-expanded={c.campaign_id === selected}>
                      <span className="rowlink-t">{c.campaign_name}</span>
                      <span className="rowlink-s">{c.owner_name || 'No owner'} <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill></span>
                    </button>
                  </td>
                  <td><Decision value={c.decision} title={c.reason} /></td>
                  {COLS.slice(2).map(([k, , type]) => <td key={k} className="num">{fmt(type, c[k])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="foot-note">
          Blended cost per outcome {inr(d.blendedOutcomeCost)}. Scale at ≤ {d.settings.scale_ratio}× blended; change at ≥ {d.settings.change_ratio}× or opt-outs ≥ {pct(d.settings.optout_change, 0)};
          stop at ≥ {d.settings.stop_ratio}× or opt-outs ≥ {pct(d.settings.optout_stop, 0)}; fewer than {d.settings.min_outcomes} outcomes is insufficient. Rates per identified person. Select a campaign for detail.
        </p>
      </Panel>

      {sel && <Inspector key={sel.campaign_id} c={sel} d={d} tasks={tasks} owners={owners} asOf={asOf} ask={ask} refresh={refresh} version={version} onClose={() => setSelected(null)} />}

      <Allocation d={d} refresh={refresh} />

      {showNew && <NewCampaign owners={owners} existing={d.campaigns} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); refresh(); }} />}
    </div>
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
    <Panel title={c.campaign_name} className="inspector"
      aside={<>
        <button className="btn ghost sm" onClick={() => ask(`Analyse ${c.campaign_name} (${c.campaign_id}): what is working, what is not, and what should we do next?`)}><Icon name="chat" size={16} />Analyse</button>
        <button className="icon-btn" onClick={onClose} aria-label="Close detail"><Icon name="close" /></button>
      </>}>
      <div className="inspector-grid">
        <div>
          <p className="muted small">{c.target_audience}</p>
          <dl className="facts">
            <dt>Rule</dt><dd><Decision value={c.decision} /> <span className="small">{c.reason}</span></dd>
            <dt>Budget</dt><dd>{inr(c.spend)} of {inr(c.allocated_budget_inr)} ({pct(c.budget_used, 0)})</dd>
            <dt>Funnel</dt><dd>{num(c.identified)} identified → {num(c.registered)} registered → {num(c.confirmed)} confirmed{!d.preEvent && <> → {num(c.attended)} attended</>}</dd>
            <dt>Statuses</dt><dd className="small">{num(c.interested)} interested, {num(c.cancelled)} cancelled, {num(c.waitlisted)} waitlisted</dd>
            <dt>Traffic</dt><dd className="small">{num(c.impressions)} impressions, {num(c.clicks)} clicks ({pct(c.ctr, 2)}), {num(c.sessions)} sessions — events, not people</dd>
          </dl>
          {series.length > 0 && (
            <ResponsiveContainer width="100%" height={170}>
              <ComposedChart data={series} margin={{ top: 6, right: 0, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#E1E5EC" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8A94A6' }} tickLine={false} interval={Math.max(0, Math.floor(series.length / 5))} />
                <YAxis yAxisId="l" tick={{ fontSize: 10, fill: '#8A94A6' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#8A94A6' }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v, n) => (n === 'Spend' ? inr(v) : num(v))} />
                <Bar yAxisId="l" dataKey="spend" name="Spend" fill="#CDD3DD" radius={[2, 2, 0, 0]} />
                <Line yAxisId="r" dataKey="registrations" name="Registrations" stroke="#13203B" dot={false} strokeWidth={1.75} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <div>
          <form className="form" onSubmit={save}>
            <div className="row">
              <Field label="Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {['active', 'scale', 'change', 'paused', 'stopped'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Allocated (₹)"><input type="number" min="0" step="1000" value={form.allocated_budget_inr} onChange={(e) => setForm({ ...form, allocated_budget_inr: e.target.value })} /></Field>
            </div>
            <Field label="Owner">
              <select value={form.owner_id} onChange={(e) => setForm({ ...form, owner_id: e.target.value })}>
                {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
              </select>
            </Field>
            <Field label="Decision note"><input value={form.decision_note} maxLength={500} onChange={(e) => setForm({ ...form, decision_note: e.target.value })} placeholder="Why this status?" /></Field>
            <Notice>{err}</Notice>
            <div className="actions">
              {saved && !dirty && <span className="ok"><Icon name="check" size={16} />Saved</span>}
              <button className="btn primary sm" disabled={!dirty}>Save changes</button>
            </div>
          </form>
          <div className="subhead">
            <h3>Linked tasks</h3>
            <button className="link" onClick={() => setTaskDraft({ campaign_id: c.campaign_id, owner_id: c.owner_id, priority: 'medium' })}><Icon name="plus" size={14} />Add</button>
          </div>
          <ul className="minilist">
            {linked.map((k) => (
              <li key={k.task_id}><Pill tone={k.status === 'done' ? 'good' : k.status === 'blocked' ? 'bad' : 'mute'}>{STATUS_LABEL[k.status]}</Pill>
                <span>{k.title}</span><span className="muted small">{k.owner?.owner_name || 'Unassigned'}{k.due_date ? `, ${shortDate(k.due_date)}` : ''}</span></li>
            ))}
            {!linked.length && <li className="muted small">No tasks for this campaign.</li>}
          </ul>
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
    <Panel title="Budget allocation" aside={<span className="muted small">{inr(total)} allocated{approved ? ` of ${inr(approved)} approved, ${inr(approved - total)} unallocated` : ''}</span>}>
      <div className="split even">
        <div className="alloc">
          {d.campaigns.map((c) => (
            <div key={c.campaign_id} className="alloc-row">
              <div className="alloc-name">{c.campaign_name}</div>
              <div className="alloc-track" title={`${inr(c.spend)} spent of ${inr(c.allocated_budget_inr)}`}>
                <span className="alloc-cap" style={{ width: `${(c.allocated_budget_inr / max) * 100}%` }} />
                <span className={`alloc-spend ${c.spend > c.allocated_budget_inr ? 'over' : ''}`} style={{ width: `${(Math.max(0, c.spend) / max) * 100}%` }} />
              </div>
              <div className="alloc-val">{inrShort(c.spend)} <span className="muted">/ {inrShort(c.allocated_budget_inr)}</span></div>
            </div>
          ))}
          <div className="legend"><span><i className="sw-cap" />Allocated</span><span><i className="sw-spend" />Spent to date</span><span><i className="sw-over" />Over allocation</span></div>
          <p className="muted small">Starting allocations are simulated (the dataset records spend, not allocations).</p>
        </div>
        <form className="form" onSubmit={go}>
          <h3>Move budget</h3>
          <div className="row">
            <Field label="From">
              <select value={from} onChange={(e) => setFrom(e.target.value)} required>
                <option value="">Choose…</option>
                {d.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name} ({inrShort(c.allocated_budget_inr)})</option>)}
              </select>
            </Field>
            <Field label="To">
              <select value={to} onChange={(e) => setTo(e.target.value)} required>
                <option value="">Choose…</option>
                {d.campaigns.filter((c) => c.campaign_id !== from).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Amount (₹)"><input type="number" min="1" step="500" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          <Field label="Reason"><input value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} placeholder="For example: Paid Social meets the stop rule" /></Field>
          <Notice>{err}</Notice>
          <Notice tone="good">{msg}</Notice>
          <div className="actions"><button className="btn primary sm">Move budget</button></div>
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
      <form className="form" onSubmit={save}>
        <div className="row">
          <Field label="Campaign ID"><input value={c.campaign_id} onChange={set('campaign_id')} required /></Field>
          <Field label="Name" className="grow"><input value={c.campaign_name} onChange={set('campaign_name')} required maxLength={80} /></Field>
        </div>
        <div className="row">
          <Field label="Channel"><input value={c.channel} onChange={set('channel')} placeholder="club_squads" /></Field>
          <Field label="Owner"><select value={c.owner_id} onChange={set('owner_id')}>{owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}</select></Field>
          <Field label="Allocated (₹)"><input type="number" min="0" value={c.allocated_budget_inr} onChange={set('allocated_budget_inr')} /></Field>
        </div>
        <Field label="Target audience"><input value={c.target_audience} onChange={set('target_audience')} /></Field>
        <Field label="Objective"><input value={c.objective} onChange={set('objective')} /></Field>
        <p className="muted small">Add the campaign's daily activity in the Data Lab; its funnel fills in as people are attributed to it.</p>
        <Notice>{err}</Notice>
        <div className="actions"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Create campaign</button></div>
      </form>
    </Modal>
  );
}

