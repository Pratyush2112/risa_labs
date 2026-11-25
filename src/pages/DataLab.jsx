import React, { useEffect, useState } from 'react';
import { Panel, Field, Notice, Kind, Empty, Pill, NativeSelect } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import {
  findDaily, saveDaily, searchRegistrations, getHistory, addStatusVersion, addCheckin,
  getTargets, updateTarget, getSettings, updateSetting, getActivity, getIngestReport, resetDemo,
} from '../lib/data.js';
import { dateTime, istIso, inr, num } from '../lib/format.js';

const TABS = [
  ['quality', 'Data quality'], ['daily', 'Marketing activity'], ['status', 'Registration status'],
  ['checkin', 'Check-ins'], ['targets', 'Targets and thresholds'], ['log', 'Activity log'],
];

// Shared bits for this page only.
const Split = ({ children, className }) => <div className={cn('grid grid-cols-1 items-start gap-4 *:min-w-0 @4xl/main:grid-cols-2', className)}>{children}</div>;
const FootNote = ({ children, flush }) => (
  <p className={cn('text-xs leading-relaxed text-muted-foreground', flush ? 'border-t px-5 py-3' : 'mt-3')}>{children}</p>
);
const Actions = ({ children }) => <div className="flex justify-end gap-2">{children}</div>;
const Th = ({ className, ...p }) => <TableHead className={cn('h-9 text-xs font-medium text-muted-foreground first:pl-5 last:pr-5', className)} {...p} />;
const Td = ({ className, ...p }) => <TableCell className={cn('first:pl-5 last:pr-5', className)} {...p} />;

export default function DataLab(props) {
  const [tab, setTab] = useState('quality');
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[78ch] text-sm text-muted-foreground">Change the records behind the dashboard. Every change goes through a validated database function, is logged, and reaches the dashboard and the analyst immediately. The original files are kept untouched and can be restored.</p>
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <TabsList aria-label="Data Lab sections">
            {TABS.map(([id, l]) => <TabsTrigger key={id} value={id} className="px-2.5 text-[13px]">{l}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="quality"><Quality {...props} /></TabsContent>
        <TabsContent value="daily"><DailyEditor {...props} /></TabsContent>
        <TabsContent value="status"><StatusEditor {...props} /></TabsContent>
        <TabsContent value="checkin"><CheckinEditor {...props} /></TabsContent>
        <TabsContent value="targets"><TargetsEditor {...props} /></TabsContent>
        <TabsContent value="log"><Log {...props} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Quality({ refresh, version }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getIngestReport().then(setRows).catch((e) => setErr(e.message)); }, [version]);

  async function reset() {
    if (!window.confirm('Restore the original dataset and seed records? Every edit, task and budget change made in the app will be replaced. This cannot be undone.')) return;
    setBusy(true); setErr(null);
    try { await resetDemo(); refresh(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Ingest report" aside={rows[0] && <span>Last run {dateTime(rows[0].at)}</span>} pad={false}>
        <Table className="tabular-nums">
          <TableHeader><TableRow className="hover:bg-transparent">
            <Th>Table</Th><Th className="text-right">Raw rows</Th><Th className="text-right">Distinct IDs</Th><Th className="text-right">Loaded</Th><Th className="text-right">Duplicates removed</Th><Th className="text-right">Orphans skipped</Th>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.table_name}>
                <Td className="font-medium capitalize">{r.table_name.replaceAll('_', ' ')}</Td>
                <Td className="text-right">{num(r.raw_rows)}</Td><Td className="text-right">{num(r.distinct_ids)}</Td>
                <Td className="text-right">{num(r.loaded_rows)}</Td>
                <Td className="text-right">{r.duplicates_removed ? <Pill tone="warn">{r.duplicates_removed}</Pill> : <span className="text-muted-foreground">0</span>}</Td>
                <Td className="text-right">{r.orphans_skipped ? <Pill tone="bad">{r.orphans_skipped}</Pill> : <span className="text-muted-foreground">0</span>}</Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <FootNote flush>Import retries repeated some records with the same source ID; each ID counts once. Orphans are rows whose person, registration or campaign does not exist; foreign keys keep them out.</FootNote>
      </Panel>
      <Panel title="Restore original data" className="border-danger/30">
        <div className="flex flex-col gap-4 @2xl/main:flex-row @2xl/main:items-center @2xl/main:justify-between">
          <p className="max-w-[70ch] text-sm text-muted-foreground">Rebuilds every core table from the untouched raw files and restores the simulated starting budget split, seed tasks, bets and thresholds. The activity log is kept.</p>
          <Button variant="destructive" size="sm" className="self-start @2xl/main:self-center" onClick={reset} disabled={busy}><Icon name="reset" />{busy ? 'Restoring…' : 'Restore original data'}</Button>
        </div>
        {err && <div className="mt-4"><Notice>{err}</Notice></div>}
      </Panel>
    </div>
  );
}

function DailyEditor({ d, asOf, refresh }) {
  const [cid, setCid] = useState(d.campaigns[0]?.campaign_id || '');
  const [date, setDate] = useState(asOf);
  const [rec, setRec] = useState(null);
  const [existing, setExisting] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!cid || !date) return;
    setMsg(null); setErr(null);
    findDaily(cid, date).then((r) => {
      setExisting(r);
      setRec(r ? { ...r } : { impressions: 0, clicks: 0, reported_reach: 0, landing_page_sessions: 0, registration_starts: 0, marketing_spend_inr: 0 });
    }).catch((e) => setErr(e.message));
  }, [cid, date]);

  async function save(e) {
    e.preventDefault(); setErr(null);
    try {
      const mode = await saveDaily({ ...rec, campaign_id: cid, activity_date: date });
      setMsg(mode === 'updated' ? 'Record updated. Spend and cost metrics now reflect it.' : 'Record added. Spend and cost metrics now reflect it.');
      setExisting(await findDaily(cid, date));
      refresh();
    } catch (x) { setErr(x.message); }
  }
  const f = (k, label, hint) => <Field label={label} hint={hint}><Input type="number" step="1" className="tabular-nums" value={rec?.[k] ?? 0} onChange={(e) => setRec({ ...rec, [k]: e.target.value })} /></Field>;

  return (
    <Panel title="Daily marketing record" description={existing ? `Editing ${existing.activity_id}; current net spend ${inr(existing.marketing_spend_inr)}.` : 'No record for this campaign and date. Saving creates one.'} className="max-w-4xl">
      <form className="flex flex-col gap-5" onSubmit={save}>
        <div className="grid gap-4 @lg/main:grid-cols-2">
          <Field label="Campaign">
            <NativeSelect value={cid} onChange={(e) => setCid(e.target.value)}>{d.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}</NativeSelect>
          </Field>
          <Field label="Date (IST)"><Input type="date" min="2025-01-15" max="2025-04-20" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {rec && (
          <div className="grid gap-4 border-t pt-5 @lg/main:grid-cols-2 @3xl/main:grid-cols-3">
            {f('marketing_spend_inr', 'Net spend (₹)', 'Negative = vendor credit')}
            {f('impressions', 'Impressions')}{f('clicks', 'Clicks')}{f('reported_reach', 'Reported reach')}
            {f('landing_page_sessions', 'Landing sessions')}{f('registration_starts', 'Registration starts')}
          </div>
        )}
        <Notice>{err}</Notice>
        <Notice tone="good">{msg}</Notice>
        <Actions><Button type="submit">Save record</Button></Actions>
      </form>
    </Panel>
  );
}

const STATUS_TONE = (s) => (s === 'confirmed' ? 'good' : s === 'cancelled' ? 'bad' : s === 'waitlisted' ? 'gold' : 'mute');

function StatusEditor({ asOf, refresh }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [reg, setReg] = useState(null);
  const [hist, setHist] = useState([]);
  const [status, setStatus] = useState('confirmed');
  const [date, setDate] = useState(asOf);
  const [time, setTime] = useState('12:00');
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  async function search(e) {
    e.preventDefault(); setErr(null);
    if (term.trim().length < 2) return setErr('Type at least 2 characters.');
    try { setResults(await searchRegistrations(term)); } catch (x) { setErr(x.message); }
  }
  async function pick(r) { setReg(r); setMsg(null); setHist(await getHistory(r.registration_id)); }
  async function add(e) {
    e.preventDefault(); setErr(null);
    try {
      await addStatusVersion(reg.registration_id, status, istIso(date, time));
      setHist(await getHistory(reg.registration_id));
      setMsg(`Added "${status}" from ${date} ${time} IST. Snapshots from that moment use it; earlier ones do not.`);
      refresh();
    } catch (x) { setErr(x.message); }
  }

  return (
    <Split>
      <Panel title="Find a registration">
        <form className="flex items-end gap-2" onSubmit={search}>
          <Field label="Name or ID" className="min-w-0 flex-1"><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Leena, R0001 or E0001" /></Field>
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {err && <div className="mt-3"><Notice>{err}</Notice></div>}
        {results && (results.length === 0 ? <Empty className="mt-4">No matches.</Empty> : (
          <ul className="mt-4 flex max-h-[380px] flex-col gap-1.5 overflow-auto">
            {results.map((r) => {
              const on = reg?.registration_id === r.registration_id;
              return (
                <li key={r.registration_id}>
                  <button type="button" aria-pressed={on} onClick={() => pick(r)} className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    on && 'border-foreground/60 bg-accent',
                  )}>
                    <span className="text-sm font-medium">{r.person_name}</span>
                    <span className="text-xs text-muted-foreground">{r.registration_id}, {r.person_id}, {r.campaign_name}{r.person_type !== 'external' ? `, ${r.person_type}` : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </Panel>
      <Panel title={reg ? `${reg.person_name}, ${reg.registration_id}` : 'Status history'}>
        {!reg ? <Empty>Select a registration to see and extend its history.</Empty> : (
          <div className="flex flex-col gap-5">
            <ol className="flex flex-col">
              {hist.map((h, i) => (
                <li key={h.history_id} className="relative flex items-center gap-3 py-1.5 pl-5">
                  <span className="absolute top-1/2 left-[3px] size-2 -translate-y-1/2 rounded-full border-2 border-background bg-muted-foreground/60 ring-1 ring-border" aria-hidden="true" />
                  {i < hist.length - 1 && <span className="absolute top-1/2 left-[6.5px] h-full w-px bg-border" aria-hidden="true" />}
                  <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">{dateTime(h.effective_at)}</span>
                  <Pill tone={STATUS_TONE(h.status)}>{h.status}</Pill>
                </li>
              ))}
            </ol>
            <form className="flex flex-col gap-4 border-t pt-5" onSubmit={add}>
              <div className="grid gap-4 @lg/main:grid-cols-3 @4xl/main:grid-cols-1 @6xl/main:grid-cols-3">
                <Field label="New status"><NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>{['interested', 'confirmed', 'cancelled', 'waitlisted'].map((s) => <option key={s}>{s}</option>)}</NativeSelect></Field>
                <Field label="Effective date"><Input type="date" min="2025-01-15" max="2025-04-20" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Time (IST)"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              </div>
              <Notice tone="good">{msg}</Notice>
              <Actions><Button type="submit" size="sm">Add status version</Button></Actions>
            </form>
          </div>
        )}
      </Panel>
    </Split>
  );
}

function CheckinEditor({ refresh }) {
  const [mode, setMode] = useState('existing');
  const [personId, setPersonId] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState('2025-04-12');
  const [time, setTime] = useState('11:00');
  const [result, setResult] = useState('admitted');
  const [verification, setVerification] = useState('verified');
  const [source, setSource] = useState('scanner');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function save(e) {
    e.preventDefault(); setErr(null); setMsg(null);
    try {
      const p = await addCheckin({ personId: mode === 'existing' ? personId : null, walkInName: mode === 'walkin' ? name : null, occurredAtIso: istIso(date, time), result, verification, source });
      const counts = p.person_type === 'external' && result === 'admitted' && verification === 'verified';
      setMsg(`Saved ${p.event_id} for ${p.person_name} (${p.person_id}). ${counts ? 'This is a verified admission; the person counts once as a visitor.' : 'This does not count as a verified external visit.'}`);
      refresh();
    } catch (x) { setErr(x.message); }
  }

  return (
    <Panel title="Add an admission record" className="max-w-4xl">
      <form className="flex flex-col gap-5" onSubmit={save}>
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v)} aria-label="Who">
          <ToggleGroupItem value="existing" className="px-3">Existing person</ToggleGroupItem>
          <ToggleGroupItem value="walkin" className="px-3">New walk-in</ToggleGroupItem>
        </ToggleGroup>
        <div className="max-w-md">
          {mode === 'existing'
            ? <Field label="Person ID" hint="For example E0002. Find IDs under Registration status."><Input value={personId} onChange={(e) => setPersonId(e.target.value)} pattern="[A-Za-z][A-Za-z0-9-]{1,20}" required /></Field>
            : <Field label="Walk-in name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>}
        </div>
        <div className="grid gap-4 border-t pt-5 @lg/main:grid-cols-2 @3xl/main:grid-cols-3">
          <Field label="Date"><Input type="date" min="2025-01-15" max="2025-04-20" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Time (IST)"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Result"><NativeSelect value={result} onChange={(e) => setResult(e.target.value)}><option>admitted</option><option>denied</option><option>pending</option></NativeSelect></Field>
          <Field label="Verification"><NativeSelect value={verification} onChange={(e) => setVerification(e.target.value)}><option>verified</option><option>unverified</option></NativeSelect></Field>
          <Field label="Source"><NativeSelect value={source} onChange={(e) => setSource(e.target.value)}><option>scanner</option><option>manual</option></NativeSelect></Field>
        </div>
        <Notice>{err}</Notice>
        <Notice tone="good">{msg}</Notice>
        <Actions><Button type="submit">Save admission</Button></Actions>
      </form>
    </Panel>
  );
}

const cellInput = 'ml-auto h-8 w-28 text-right tabular-nums';

function TargetsEditor({ refresh, version }) {
  const [targets, setTargets] = useState([]);
  const [settings, setSettings] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { Promise.all([getTargets(), getSettings()]).then(([t, s]) => { setTargets(t); setSettings(s); }).catch((e) => setErr(e.message)); }, [version]);

  const run = async (fn, ok) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); refresh(); } catch (e) { setErr(e.message); } };

  return (
    <div className="flex flex-col gap-4">
      <Notice>{err}</Notice>
      <Notice tone="good">{msg}</Notice>
      <Panel title="Targets" aside={<Kind kind="source" />} pad={false}>
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <Th>Version</Th><Th className="text-right">Identified</Th><Th className="text-right">Registrations</Th><Th className="text-right">Visitors</Th><Th className="text-right">Budget ₹</Th>
            </TableRow></TableHeader>
            <TableBody>
              {targets.map((t) => (
                <TableRow key={t.target_id} className="hover:bg-transparent">
                  <Td><div className="font-medium">{t.target_version}</div><div className="text-xs text-muted-foreground">from {dateTime(t.effective_at)}</div></Td>
                  {['identified_goal', 'registration_goal', 'visitors_goal', 'budget_inr'].map((k) => (
                    <Td key={k} className="text-right">
                      <Input className={cellInput} type="number" min="0" defaultValue={t[k]} aria-label={`${t.target_version} ${k}`}
                        onBlur={(e) => Number(e.target.value) !== t[k] && run(() => updateTarget({ ...t, [k]: e.target.value }), 'Target saved.')} />
                    </Td>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <FootNote flush>Each version applies from its effective time. Edit a value and leave the field to save.</FootNote>
        </Panel>
        <Panel title="Assumptions and decision thresholds" pad={false}>
          <Table>
            <TableBody>
              {settings.map((s) => (
                <TableRow key={s.key} className="hover:bg-transparent">
                  <Td className="py-3 whitespace-normal">
                    <div className="text-sm font-medium">{s.label} <Kind kind={s.kind} /></div>
                    {s.note && <div className="mt-0.5 text-xs text-muted-foreground">{s.note}</div>}
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">Allowed {s.min_value} to {s.max_value}</div>
                  </Td>
                  <Td className="py-3 text-right align-top">
                    <Input className={cellInput} type="number" step="any" min={s.min_value} max={s.max_value} defaultValue={s.value} aria-label={s.label}
                      onBlur={(e) => Number(e.target.value) !== Number(s.value) && run(() => updateSetting(s.key, e.target.value), 'Setting saved.')} />
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </Panel>
    </div>
  );
}

const ACTOR_TONE = (a) => (a === 'ai_confirmed' ? 'gold' : a === 'system' ? 'ink' : 'mute');

function Log({ version }) {
  const [log, setLog] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getActivity(80).then(setLog).catch((e) => setErr(e.message)); }, [version]);
  if (err) return <Notice>{err}</Notice>;
  if (!log) return null;
  return (
    <Panel title="Activity log" aside={<span>Latest 80 changes</span>} pad={false}>
      {log.length === 0 ? <div className="px-5 pb-5"><Empty>No changes yet.</Empty></div> : (
        <ol className="divide-y border-t">
          {log.map((l) => (
            <li key={l.log_id} className="grid gap-x-4 gap-y-1 px-5 py-3 @2xl/main:grid-cols-[8.5rem_minmax(0,1fr)]">
              <span className="pt-px text-xs text-muted-foreground tabular-nums">{dateTime(l.at)}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium first-letter:uppercase">{l.action.replaceAll('_', ' ')}</span>
                  {l.entity_id && <span className="text-muted-foreground">{l.entity_type} {l.entity_id}</span>}
                  <Pill tone={ACTOR_TONE(l.actor)}>{l.actor === 'ai_confirmed' ? 'AI, confirmed' : l.actor}</Pill>
                </div>
                <code className="line-clamp-2 font-mono text-[11px] leading-relaxed break-all text-muted-foreground">{JSON.stringify(l.details)}</code>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
