import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm leading-relaxed text-pretty text-muted-foreground">
        The five bets from the growth plan, ranked by risk-adjusted visitors. Each has one leading KPI with scale, continue and stop lines and a minimum sample.
        Enter a test reading to get a decision; below the minimum sample the app will not call it. <Kind kind="simulated" /> Readings for Club Squads and Bring-a-Friend are examples.
      </p>
      <div className="grid gap-4 @2xl/main:grid-cols-2">
        {bets.map((b) => <BetCard key={b.bet_id} b={b} asOf={asOf} ask={ask} onSaved={refresh} />)}
      </div>
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <>
      <dt className="pt-px text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
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
    <Panel className="@container/bet h-full"
      contentClassName="flex flex-1 flex-col gap-4"
      title={<span className="flex items-center gap-2"><span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-medium text-muted-foreground tabular-nums">{b.rank}</span>{b.name}</span>}
      aside={<Decision value={preview.band} />}>
      <p className="text-sm leading-relaxed text-muted-foreground">{b.concept}</p>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <Fact label="Lead KPI">{b.kpi_name}</Fact>
        <Fact label="Plan">{unit(b, b.plan_value)}, read by {b.read_by}, owner {b.owner?.owner_name || '—'}</Fact>
        <Fact label="Min. sample"><span className="tabular-nums">{b.min_sample}</span></Fact>
      </dl>

      <div className="flex flex-col gap-2">
        <div className="relative py-1" aria-hidden="true">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
            <span className="absolute inset-y-0 bg-danger-soft [:root:not(.dark)_&]:bg-danger/15" style={{ left: 0, width: `${pos(b.stop_below)}%` }} />
            <span className="absolute inset-y-0 border-l-2 border-card bg-warning-soft [:root:not(.dark)_&]:bg-warning/20" style={{ left: `${pos(b.stop_below)}%`, width: `${pos(b.continue_from) - pos(b.stop_below)}%` }} />
            <span className="absolute inset-y-0 border-l-2 border-card bg-muted-foreground/15" style={{ left: `${pos(b.continue_from)}%`, width: `${pos(b.scale_at) - pos(b.continue_from)}%` }} />
            <span className="absolute inset-y-0 border-l-2 border-card bg-success-soft [:root:not(.dark)_&]:bg-success/15" style={{ left: `${pos(b.scale_at)}%`, right: 0 }} />
            {b.plan_value != null && <span className="absolute inset-y-0 -ml-px w-0.5 bg-brand" style={{ left: `${pos(Number(b.plan_value))}%` }} />}
          </div>
          {reading !== '' && <span className="absolute inset-y-0 -ml-[3px] w-1.5 rounded-full bg-foreground ring-2 ring-card" style={{ left: `${pos(Number(reading))}%` }} />}
        </div>
        <div className="grid grid-cols-3 gap-2 text-[11px] leading-tight text-muted-foreground">
          <span>Stop below {unit(b, b.stop_below)}</span>
          <span className="text-center">Continue from {unit(b, b.continue_from)}</span>
          <span className="text-right">Scale at {unit(b, b.scale_at)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 @sm/bet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <Field label="Reading"><Input type="number" step="any" value={reading} onChange={(e) => setReading(e.target.value)} /></Field>
        <Field label="Sample"><Input type="number" min="0" value={sample} onChange={(e) => setSample(e.target.value)} /></Field>
        <Field label="Date" className="col-span-2 @sm/bet:col-span-1"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 px-3 py-2.5">
        <p className="text-sm"><strong className="font-semibold">{preview.band}.</strong> <span className="text-muted-foreground">{preview.reason}</span></p>
        {b.reading_date && <p className="text-xs text-muted-foreground">Saved reading: {unit(b, b.latest_reading)} on {shortDate(b.reading_date)} (sample {b.sample_size ?? '—'})</p>}
      </div>
      <Notice>{err}</Notice>
      <div className="mt-auto flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => ask(`Look at bet "${b.name}" (${b.bet_id}). Given its latest reading and the campaign data, should we scale, continue, change or stop it? If a change is needed, propose a task.`)}><Icon name="chat" />Ask</Button>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save reading'}</Button>
      </div>
    </Panel>
  );
}
