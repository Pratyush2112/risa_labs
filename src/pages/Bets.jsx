import React, { useEffect, useState } from 'react';
import { Panel, Decision, Field, Notice, Kind, Skeleton } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { getBets, saveBetReading } from '../lib/data.js';
import { betBand } from '../../shared/metrics.js';
import { shortDate } from '../lib/format.js';

const unit = (b, v) => (v == null || v === '' ? '—' : b.unit === 'pct' ? `${v}%` : b.unit === 'ratio' ? `${v}×` : b.unit === 'points' ? `${v} pts` : `${v}`);

export default function Bets({ asOf, ask, version, refresh }) {
  const [bets, setBets] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getBets().then(setBets).catch((e) => setErr(e.message)); }, [version]);
  if (err) return <Notice>{err}</Notice>;
  if (!bets) return <Skeleton h={320} />;

  return (
    <div className="stack">
      <p className="lede">
        The five bets from the growth plan, ranked by risk-adjusted visitors. Each has one leading KPI with scale, continue and stop lines and a minimum sample.
        Enter a test reading to get a decision; below the minimum sample the app will not call it. <Kind kind="simulated" /> Readings for Club Squads and Bring-a-Friend are examples.
      </p>
      <div className="bets">
        {bets.map((b) => <BetCard key={b.bet_id} b={b} asOf={asOf} ask={ask} onSaved={refresh} />)}
      </div>
    </div>
  );
}

function BetCard({ b, asOf, ask, onSaved }) {
  const [reading, setReading] = useState(b.latest_reading ?? '');
  const [sample, setSample] = useState(b.sample_size ?? '');
  const [date, setDate] = useState(b.reading_date || asOf);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const preview = betBand({ ...b, latest_reading: reading === '' ? null : Number(reading), sample_size: sample === '' ? null : Number(sample) });
  const dirty = String(reading) !== String(b.latest_reading ?? '') || String(sample) !== String(b.sample_size ?? '') || date !== (b.reading_date || asOf);

  const lo = b.stop_below - (b.scale_at - b.stop_below) * 0.45;
  const hi = b.scale_at + (b.scale_at - b.stop_below) * 0.45;
  const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

  async function save() {
    setErr(null); setSaving(true);
    try { await saveBetReading(b.bet_id, reading, sample, date); onSaved(); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <Panel className="bet" title={<span className="bet-title"><span className="rank">{b.rank}</span>{b.name}</span>} aside={<Decision value={preview.band} />}>
      <p className="small">{b.concept}</p>
      <dl className="facts compact">
        <dt>Lead KPI</dt><dd>{b.kpi_name}</dd>
        <dt>Plan</dt><dd>{unit(b, b.plan_value)}, read by {b.read_by}, owner {b.owner?.owner_name || '—'}</dd>
        <dt>Min. sample</dt><dd>{b.min_sample}</dd>
      </dl>
      <div className="band" aria-hidden="true">
        <span className="z z-stop" style={{ left: 0, width: `${pos(b.stop_below)}%` }} />
        <span className="z z-change" style={{ left: `${pos(b.stop_below)}%`, width: `${pos(b.continue_from) - pos(b.stop_below)}%` }} />
        <span className="z z-cont" style={{ left: `${pos(b.continue_from)}%`, width: `${pos(b.scale_at) - pos(b.continue_from)}%` }} />
        <span className="z z-scale" style={{ left: `${pos(b.scale_at)}%`, right: 0 }} />
        {b.plan_value != null && <span className="plan-tick" style={{ left: `${pos(Number(b.plan_value))}%` }} />}
        {reading !== '' && <span className="marker" style={{ left: `${pos(Number(reading))}%` }} />}
      </div>
      <div className="band-l"><span>Stop below {unit(b, b.stop_below)}</span><span>Continue from {unit(b, b.continue_from)}</span><span>Scale at {unit(b, b.scale_at)}</span></div>
      <div className="row">
        <Field label="Reading"><input type="number" step="any" value={reading} onChange={(e) => setReading(e.target.value)} /></Field>
        <Field label="Sample"><input type="number" min="0" value={sample} onChange={(e) => setSample(e.target.value)} /></Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <p className="verdict"><strong>{preview.band}.</strong> {preview.reason}</p>
      {b.reading_date && <p className="muted small">Saved reading: {unit(b, b.latest_reading)} on {shortDate(b.reading_date)} (sample {b.sample_size ?? '—'})</p>}
      <Notice>{err}</Notice>
      <div className="actions">
        <button className="btn ghost sm" onClick={() => ask(`Look at bet "${b.name}" (${b.bet_id}). Given its latest reading and the campaign data, should we scale, continue, change or stop it? If a change is needed, propose a task.`)}><Icon name="chat" size={16} />Ask</button>
        <button className="btn primary sm" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save reading'}</button>
      </div>
    </Panel>
  );
}
