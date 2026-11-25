import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Menu, Moon, Sun } from 'lucide-react';
import { configured, getSnapshot, getTasks, getOwners } from './lib/data.js';
import { deriveSnapshot } from '../shared/metrics.js';
import { cn } from '@/lib/utils';
import Icon from './components/Icon.jsx';
import Timeline from './components/Timeline.jsx';
import Copilot from './components/Copilot.jsx';
import { Notice, Skeleton } from './components/ui.jsx';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';

// Pages load on demand, so the charting library is only fetched by the pages that draw charts.
const Overview = lazy(() => import('./pages/Overview.jsx'));
const Campaigns = lazy(() => import('./pages/Campaigns.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const Bets = lazy(() => import('./pages/Bets.jsx'));
const DataLab = lazy(() => import('./pages/DataLab.jsx'));
const Method = lazy(() => import('./pages/Method.jsx'));
const PageLoading = () => <div className="flex flex-col gap-4" aria-busy="true"><Skeleton h={140} /><Skeleton h={320} /></div>;

const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'overview', blurb: 'Where attendance stands against target, and what needs attention.' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaigns', blurb: 'Channel performance, rule decisions and budget allocation.' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', blurb: 'Owners, deadlines and status for every action item.' },
  { id: 'bets', label: 'Bets', icon: 'bets', blurb: 'The five ranked growth bets and their test readings.' },
  { id: 'data', label: 'Data Lab', icon: 'data', blurb: 'Edit source records, targets and thresholds; review data quality.' },
  { id: 'method', label: 'Method', icon: 'method', blurb: 'How every number is counted and what is assumed.' },
];

// The analyst docks beside the page only when the page keeps ~1000px; below that it slides over.
const WIDE = '(min-width: 1536px)';
const useMedia = (q) => {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const mq = window.matchMedia(q); const on = () => setM(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }, [q]);
  return m;
};

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('gc-theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
  }, [dark]);
  return [dark, setDark];
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0"><rect width="32" height="32" rx="8" className="fill-brand" /><path d="M8 10h16l-5.5 6.5v5.5l-5 2v-7.5z" className="fill-zinc-900" /></svg>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-foreground">CampusFest</div>
        <div className="text-xs text-muted-foreground">Growth Center</div>
      </div>
    </div>
  );
}

function Nav({ page, goto, overdue, onNavigate }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {PAGES.map((p) => {
        const on = page === p.id;
        return (
          <button key={p.id} onClick={() => { goto(p.id); onNavigate?.(); }} aria-current={on ? 'page' : undefined}
            className={cn('group flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-xs ring-1 ring-sidebar-border' : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground')}>
            <Icon name={p.icon} className={on ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'} />
            <span>{p.label}</span>
            {p.id === 'tasks' && overdue > 0 && (
              <span className="ml-auto rounded-full bg-danger-soft px-1.5 text-[11px] font-medium leading-5 text-danger" title="Overdue tasks">{overdue}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ dark, setDark }) {
  return (
    <div className="mt-auto flex items-end justify-between gap-2 border-t border-sidebar-border px-2 pt-3">
      <div className="text-xs leading-relaxed">
        <div className="font-medium text-foreground">CampusFest 2025</div>
        <div className="text-muted-foreground">Bengaluru, 12–13 April</div>
      </div>
      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setDark((d) => !d)} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState(() => (PAGES.some((p) => `#${p.id}` === window.location.hash) ? window.location.hash.slice(1) : 'overview'));
  const [asOf, setAsOf] = useState('2025-04-20');
  const [snap, setSnap] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [owners, setOwners] = useState([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const wide = useMedia(WIDE);
  const [copilotOpen, setCopilotOpen] = useState(() => window.matchMedia(WIDE).matches);
  const [navOpen, setNavOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [dark, setDark] = useTheme();

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

  const d = useMemo(() => (snap ? deriveSnapshot(snap, { tasks }) : null), [snap, tasks]);
  const current = PAGES.find((p) => p.id === page);
  const overdue = tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < asOf).length;

  if (!configured) {
    return (
      <div className="mx-auto mt-[12vh] max-w-lg rounded-xl border bg-card p-7">
        <h1 className="text-lg font-semibold">CampusFest Growth Center</h1>
        <p className="mt-2 text-sm text-muted-foreground">Supabase is not configured. Add <code className="font-mono text-xs">VITE_SUPABASE_URL</code> and <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> (see the README), then rebuild.</p>
      </div>
    );
  }

  const props = { d, tasks, owners, asOf, ask, refresh, goto, version };
  const copilot = (
    <Copilot asOf={asOf} d={d} owners={owners} onClose={() => setCopilotOpen(false)} onDataChanged={refresh}
      pendingPrompt={pendingPrompt} clearPending={() => setPendingPrompt(null)} />
  );

  return (
    <TooltipProvider delayDuration={300}>
      <a href="#main" className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <div className="flex min-h-svh bg-sidebar">
        {/* Sidebar (md and up) */}
        <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 px-3 py-4 md:flex" aria-label="Sidebar">
          <Brand />
          <Nav page={page} goto={goto} overdue={overdue} />
          <SidebarFooter dark={dark} setDark={setDark} />
        </aside>

        {/* Mobile navigation */}
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="w-72 gap-6 bg-sidebar p-4">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">Go to a page</SheetDescription>
            <Brand />
            <Nav page={page} goto={goto} overdue={overdue} onNavigate={() => setNavOpen(false)} />
            <SidebarFooter dark={dark} setDark={setDark} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 md:py-2 md:pr-2">
          <div className="flex min-w-0 flex-1 flex-col bg-background md:rounded-xl md:border md:shadow-xs">
            <header className="sticky top-0 z-20 rounded-t-xl border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
              <div className="flex items-center gap-3 px-4 pt-4 pb-3 md:px-6">
                <Button variant="ghost" size="icon" className="-ml-2 md:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu /></Button>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-lg font-semibold tracking-tight">{current.label}</h1>
                  <p className="hidden truncate text-sm text-muted-foreground sm:block">{current.blurb}</p>
                </div>
                {loading && <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex" role="status"><span className="size-1.5 animate-pulse rounded-full bg-brand" />Updating</span>}
                {!(copilotOpen && wide) && (
                  <Button size="sm" onClick={() => setCopilotOpen(true)} aria-expanded={copilotOpen} aria-controls="analyst">
                    <Icon name="chat" />Ask the analyst
                  </Button>
                )}
              </div>
              <Timeline asOf={asOf} onChange={setAsOf} />
            </header>

            <main id="main" tabIndex={-1} className="@container/main flex-1 px-4 py-5 outline-none md:px-6 md:py-6">
              {error && <div className="mb-4"><Notice>Could not load data: {error}</Notice></div>}
              {!d && !error && <PageLoading />}
              {d && (
                <Suspense fallback={<PageLoading />}>
                  {page === 'overview' && <Overview {...props} />}
                  {page === 'campaigns' && <Campaigns {...props} />}
                  {page === 'tasks' && <Tasks {...props} />}
                  {page === 'bets' && <Bets {...props} />}
                  {page === 'data' && <DataLab {...props} />}
                  {page === 'method' && <Method {...props} />}
                </Suspense>
              )}
            </main>
          </div>

          {/* Analyst: docked beside the page on wide screens */}
          {wide && copilotOpen && (
            <aside id="analyst" className="sticky top-2 ml-2 flex h-[calc(100svh-1rem)] w-[380px] shrink-0 flex-col overflow-hidden rounded-xl border bg-background shadow-xs" aria-label="Growth analyst">
              {copilot}
            </aside>
          )}
        </div>

        {/* Analyst: slide-over sheet on smaller screens */}
        {!wide && (
          <Sheet open={copilotOpen} onOpenChange={setCopilotOpen}>
            <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-[420px]" id="analyst">
              <SheetTitle className="sr-only">Growth analyst</SheetTitle>
              <SheetDescription className="sr-only">Ask questions about the live data</SheetDescription>
              {copilot}
            </SheetContent>
          </Sheet>
        )}
      </div>
    </TooltipProvider>
  );
}
