import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { configured, getSnapshot, getTasks, getOwners } from './lib/data.js';
import { deriveSnapshot } from '../shared/metrics.js';
import Icon from './components/Icon.jsx';
import Timeline from './components/Timeline.jsx';
import Copilot from './components/Copilot.jsx';
import { Notice, Skeleton } from './components/ui.jsx';
import Overview from './pages/Overview.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Tasks from './pages/Tasks.jsx';
import Bets from './pages/Bets.jsx';
import DataLab from './pages/DataLab.jsx';
import Method from './pages/Method.jsx';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'overview', blurb: 'Where attendance stands against target, and what needs attention.' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', blurb: 'Channel performance, rule decisions and budget allocation.' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', blurb: 'Owners, deadlines and status for every action item.' },
  { id: 'bets', label: 'Bets', icon: 'bets', blurb: 'The five ranked growth bets and their test readings.' },
  { id: 'data', label: 'Data Lab', icon: 'data', blurb: 'Edit source records, targets and thresholds; review data quality.' },
  { id: 'method', label: 'Method', icon: 'method', blurb: 'How every number is counted and what is assumed.' },
];

export default function App() {
  const [page, setPage] = useState(() => (PAGES.some((p) => `#${p.id}` === window.location.hash) ? window.location.hash.slice(1) : 'overview'));
  const [asOf, setAsOf] = useState('2025-04-20');
  const [snap, setSnap] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [owners, setOwners] = useState([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copilotOpen, setCopilotOpen] = useState(() => window.innerWidth > 1180);
  const [pendingPrompt, setPendingPrompt] = useState(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const ask = useCallback((text) => { setCopilotOpen(true); setPendingPrompt({ text, id: Date.now() }); }, []);
  const goto = useCallback((id) => { setPage(id); window.history.replaceState(null, '', `#${id}`); window.scrollTo(0, 0); }, []);

  useEffect(() => {
    if (!configured) return undefined;
    let alive = true;
    setLoading(true);
    Promise.all([getSnapshot(asOf), getTasks(), getOwners()])
      .then(([s, t, o]) => { if (alive) { setSnap(s); setTasks(t); setOwners(o); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [asOf, version]);

  useEffect(() => {
    if (!copilotOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.scrim')) setCopilotOpen(false); }; // a modal handles its own Esc
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copilotOpen]);

  const d = useMemo(() => (snap ? deriveSnapshot(snap, { tasks }) : null), [snap, tasks]);
  const current = PAGES.find((p) => p.id === page);

  if (!configured) {
    return (
      <div className="setup">
        <h1>CampusFest Growth Center</h1>
        <p>Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see the README), then rebuild.</p>
      </div>
    );
  }

  const props = { d, tasks, owners, asOf, ask, refresh, goto, version };

  return (
    <div className={`shell ${copilotOpen ? 'has-copilot' : ''}`}>
      <a className="skip" href="#main">Skip to content</a>
      <aside className="rail" aria-label="Primary">
        <div className="mark">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#E39B0B" /><path d="M7 10h18l-6 7v6l-6 2v-8z" fill="#13203B" /></svg>
          <div><div className="mark-t">CampusFest</div><div className="mark-s">Growth Center</div></div>
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={`rail-i ${page === p.id ? 'on' : ''}`} onClick={() => goto(p.id)} aria-current={page === p.id ? 'page' : undefined}>
              <Icon name={p.icon} /><span>{p.label}</span>
              {p.id === 'tasks' && tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < asOf).length > 0 && (
                <span className="rail-badge" title="Overdue tasks">{tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < asOf).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <div className="rail-event">CampusFest 2025<br /><span>Bengaluru, 12–13 April</span></div>
          <div className="rail-by">Challenge A: Attendee growth<br />Pratyush Singh</div>
        </div>
      </aside>

      <div className="workspace">
        <header className="pagehead">
          <div>
            <h1>{current.label}</h1>
            <p>{current.blurb}</p>
          </div>
          <div className="pagehead-r">
            {loading && <span className="sync" role="status">Updating</span>}
            {!copilotOpen && (
              <button className="btn accent" onClick={() => setCopilotOpen(true)} aria-expanded={false} aria-controls="analyst">
                <Icon name="chat" />Ask the analyst
              </button>
            )}
          </div>
        </header>
        <Timeline asOf={asOf} onChange={setAsOf} />

        <main id="main" className="content" tabIndex={-1}>
          {error && <Notice>Could not load data: {error}</Notice>}
          {!d && !error && <div className="stack"><Skeleton h={150} /><Skeleton h={300} /></div>}
          {d && (
            <>
              {page === 'overview' && <Overview {...props} />}
              {page === 'campaigns' && <Campaigns {...props} />}
              {page === 'tasks' && <Tasks {...props} />}
              {page === 'bets' && <Bets {...props} />}
              {page === 'data' && <DataLab {...props} />}
              {page === 'method' && <Method {...props} />}
            </>
          )}
        </main>
      </div>

      {copilotOpen && (
        // Only visible when the analyst floats over the page (narrow screens); clicking it closes the panel.
        <div className="analyst-scrim" onClick={() => setCopilotOpen(false)} aria-hidden="true" />
      )}
      {copilotOpen && (
        <Copilot asOf={asOf} d={d} owners={owners} onClose={() => setCopilotOpen(false)} onDataChanged={refresh}
          pendingPrompt={pendingPrompt} clearPending={() => setPendingPrompt(null)} />
      )}
    </div>
  );
}
