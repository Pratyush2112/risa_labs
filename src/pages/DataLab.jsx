import React, { useEffect, useState } from 'react';
import { Panel, Field, Notice, Kind, Empty, Pill } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import {
  findDaily, saveDaily, searchRegistrations, getHistory, addStatusVersion, addCheckin,
  getTargets, updateTarget, getSettings, updateSetting, getActivity, getIngestReport, resetDemo,
} from '../lib/data.js';
import { dateTime, istIso, inr, num } from '../lib/format.js';

const TABS = [
  ['quality', 'Data quality'], ['daily', 'Marketing activity'], ['status', 'Registration status'],
  ['checkin', 'Check-ins'], ['targets', 'Targets and thresholds'], ['log', 'Activity log'],
];

export default function DataLab(props) {
  const [tab, setTab] = useState('quality');
  return (
    <div className="stack">
      <p className="lede">Change the records behind the dashboard. Every change goes through a validated database function, is logged, and reaches the dashboard and the analyst immediately. The original files are kept untouched and can be restored.</p>
      <div className="tabs" role="tablist" aria-label="Data Lab sections">
        {TABS.map(([id, l]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'quality' && <Quality {...props} />}
        {tab === 'daily' && <DailyEditor {...props} />}
        {tab === 'status' && <StatusEditor {...props} />}
        {tab === 'checkin' && <CheckinEditor {...props} />}
        {tab === 'targets' && <TargetsEditor {...props} />}
        {tab === 'log' && <Log {...props} />}
      </div>
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
    <div className="split even">
      <Panel title="Ingest report" aside={rows[0] && <span className="muted small">Last run {dateTime(rows[0].at)}</span>} pad={false}>
        <table className="grid-table">
          <thead><tr><th>Table</th><th className="num">Raw rows</th><th className="num">Distinct IDs</th><th className="num">Loaded</th><th className="num">Duplicates removed</th><th className="num">Orphans skipped</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.table_name}>
                <td>{r.table_name.replaceAll('_', ' ')}</td><td className="num">{num(r.raw_rows)}</td><td className="num">{num(r.distinct_ids)}</td>
                <td className="num">{num(r.loaded_rows)}</td>
                <td className="num">{r.duplicates_removed ? <Pill tone="warn">{r.duplicates_removed}</Pill> : 0}</td>
                <td className="num">{r.orphans_skipped ? <Pill tone="bad">{r.orphans_skipped}</Pill> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="foot-note">Import retries repeated some records with the same source ID; each ID counts once. Orphans are rows whose person, registration or campaign does not exist; foreign keys keep them out.</p>
      </Panel>
      <Panel title="Restore original data">
        <p className="small">Rebuilds every core table from the untouched raw files and restores the simulated starting budget split, seed tasks, bets and thresholds. The activity log is kept.</p>
        <Notice>{err}</Notice>
        <button className="btn danger" onClick={reset} disabled={busy}><Icon name="reset" size={16} />{busy ? 'Restoring…' : 'Restore original data'}</button>
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
  const f = (k, label, hint) => <Field label={label} hint={hint}><input type="number" step="1" value={rec?.[k] ?? 0} onChange={(e) => setRec({ ...rec, [k]: e.target.value })} /></Field>;

  return (
    <Panel title="Daily marketing record">
      <form className="form" onSubmit={save}>
        <div className="row">
          <Field label="Campaign">
            <select value={cid} onChange={(e) => setCid(e.target.value)}>{d.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}</select>
          </Field>
          <Field label="Date (IST)"><input type="date" min="2025-01-15" max="2025-04-20" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <p className="muted small">{existing ? `Editing ${existing.activity_id}; current net spend ${inr(existing.marketing_spend_inr)}.` : 'No record for this campaign and date. Saving creates one.'}</p>
        {rec && (
          <div className="fieldgrid">
            {f('marketing_spend_inr', 'Net spend (₹)', 'Negative = vendor credit')}
            {f('impressions', 'Impressions')}{f('clicks', 'Clicks')}{f('reported_reach', 'Reported reach')}
            {f('landing_page_sessions', 'Landing sessions')}{f('registration_starts', 'Registration starts')}
          </div>
        )}
        <Notice>{err}</Notice>
        <Notice tone="good">{msg}</Notice>
        <div className="actions"><button className="btn primary">Save record</button></div>
      </form>
    </Panel>
  );
}

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
    <div className="split even">
      <Panel title="Find a registration">
        <form className="row" onSubmit={search}>
          <Field label="Name or ID" className="grow"><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Leena, R0001 or E0001" /></Field>
          <button className="btn primary sm">Search</button>
        </form>
        <Notice>{err}</Notice>
        {results && (results.length === 0 ? <Empty>No matches.</Empty> : (
          <ul className="picklist">
            {results.map((r) => (
              <li key={r.registration_id}>
                <button className={reg?.registration_id === r.registration_id ? 'on' : ''} onClick={() => pick(r)}>
                  <strong>{r.person_name}</strong><span>{r.registration_id}, {r.person_id}, {r.campaign_name}{r.person_type !== 'external' ? `, ${r.person_type}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      </Panel>
      <Panel title={reg ? `${reg.person_name}, ${reg.registration_id}` : 'Status history'}>
        {!reg ? <Empty>Select a registration to see and extend its history.</Empty> : (
          <>
            <ol className="history">
              {hist.map((h) => <li key={h.history_id}><span className="h-date">{dateTime(h.effective_at)}</span><Pill tone={h.status === 'confirmed' ? 'good' : h.status === 'cancelled' ? 'bad' : h.status === 'waitlisted' ? 'gold' : 'mute'}>{h.status}</Pill></li>)}
            </ol>
            <form className="form" onSubmit={add}>
              <div className="row">
                <Field label="New status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{['interested', 'confirmed', 'cancelled', 'waitlisted'].map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Effective date"><input type="date" min="2025-01-15" max="2025-04-20" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Time (IST)"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              </div>
              <Notice tone="good">{msg}</Notice>
              <div className="actions"><button className="btn primary sm">Add status version</button></div>
            </form>
          </>
        )}
      </Panel>
    </div>
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
    <Panel title="Add an admission record">
      <form className="form" onSubmit={save}>
        <div className="seg" role="radiogroup" aria-label="Who">
          <button type="button" role="radio" aria-checked={mode === 'existing'} className={mode === 'existing' ? 'on' : ''} onClick={() => setMode('existing')}>Existing person</button>
          <button type="button" role="radio" aria-checked={mode === 'walkin'} className={mode === 'walkin' ? 'on' : ''} onClick={() => setMode('walkin')}>New walk-in</button>
        </div>
        {mode === 'existing'
          ? <Field label="Person ID" hint="For example E0002. Find IDs under Registration status."><input value={personId} onChange={(e) => setPersonId(e.target.value)} pattern="[A-Za-z][A-Za-z0-9-]{1,20}" required /></Field>
          : <Field label="Walk-in name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>}
        <div className="fieldgrid">
          <Field label="Date"><input type="date" min="2025-01-15" max="2025-04-20" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Time (IST)"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Result"><select value={result} onChange={(e) => setResult(e.target.value)}><option>admitted</option><option>denied</option><option>pending</option></select></Field>
          <Field label="Verification"><select value={verification} onChange={(e) => setVerification(e.target.value)}><option>verified</option><option>unverified</option></select></Field>
          <Field label="Source"><select value={source} onChange={(e) => setSource(e.target.value)}><option>scanner</option><option>manual</option></select></Field>
        </div>
        <Notice>{err}</Notice>
        <Notice tone="good">{msg}</Notice>
        <div className="actions"><button className="btn primary">Save admission</button></div>
      </form>
    </Panel>
  );
}

function TargetsEditor({ refresh, version }) {
  const [targets, setTargets] = useState([]);
  const [settings, setSettings] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { Promise.all([getTargets(), getSettings()]).then(([t, s]) => { setTargets(t); setSettings(s); }).catch((e) => setErr(e.message)); }, [version]);

  const run = async (fn, ok) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); refresh(); } catch (e) { setErr(e.message); } };

  return (
    <div className="stack">
      <Notice>{err}</Notice>
      <Notice tone="good">{msg}</Notice>
      <div className="split even">
        <Panel title="Targets" aside={<Kind kind="source" />} pad={false}>
          <table className="grid-table">
            <thead><tr><th>Version</th><th className="num">Identified</th><th className="num">Registrations</th><th className="num">Visitors</th><th className="num">Budget ₹</th></tr></thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.target_id}>
                  <td>{t.target_version}<div className="muted small">from {dateTime(t.effective_at)}</div></td>
                  {['identified_goal', 'registration_goal', 'visitors_goal', 'budget_inr'].map((k) => (
                    <td key={k} className="num"><input className="cell" type="number" min="0" defaultValue={t[k]} aria-label={`${t.target_version} ${k}`}
                      onBlur={(e) => Number(e.target.value) !== t[k] && run(() => updateTarget({ ...t, [k]: e.target.value }), 'Target saved.')} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="foot-note">Each version applies from its effective time. Edit a value and leave the field to save.</p>
        </Panel>
        <Panel title="Assumptions and decision thresholds" pad={false}>
          <table className="grid-table">
            <tbody>
              {settings.map((s) => (
                <tr key={s.key}>
                  <td><div>{s.label} <Kind kind={s.kind} /></div>{s.note && <div className="muted small">{s.note}</div>}<div className="muted small">Allowed {s.min_value} to {s.max_value}</div></td>
                  <td className="num"><input className="cell" type="number" step="any" min={s.min_value} max={s.max_value} defaultValue={s.value} aria-label={s.label}
                    onBlur={(e) => Number(e.target.value) !== Number(s.value) && run(() => updateSetting(s.key, e.target.value), 'Setting saved.')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

function Log({ version }) {
  const [log, setLog] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getActivity(80).then(setLog).catch((e) => setErr(e.message)); }, [version]);
  if (err) return <Notice>{err}</Notice>;
  if (!log) return null;
  return (
    <Panel title="Activity log" aside={<span className="muted small">Latest 80 changes</span>} pad={false}>
      {log.length === 0 ? <div className="pad"><Empty>No changes yet.</Empty></div> : (
        <ol className="timelog">
          {log.map((l) => (
            <li key={l.log_id}>
              <span className="tlog-when">{dateTime(l.at)}</span>
              <span className="tlog-what">
                <strong>{l.action.replaceAll('_', ' ')}</strong>
                {l.entity_id && <span className="muted"> {l.entity_type} {l.entity_id}</span>}
                <Pill tone={l.actor === 'ai_confirmed' ? 'gold' : l.actor === 'system' ? 'ink' : 'mute'}>{l.actor === 'ai_confirmed' ? 'AI, confirmed' : l.actor}</Pill>
              </span>
              <code className="tlog-detail">{JSON.stringify(l.details)}</code>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
