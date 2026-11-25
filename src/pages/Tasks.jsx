import React, { useMemo, useState } from 'react';
import { MoreHorizontal, Search } from 'lucide-react';
import { Notice, Pill, NativeSelect } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { setTaskStatus, deleteTask } from '../lib/data.js';
import { shortDate, longDate, STATUS_LABEL } from '../lib/format.js';

const COLUMNS = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITY_TONE = { high: 'bad', medium: 'warn', low: 'mute' };
const LANE_DOT = { todo: 'bg-muted-foreground/50', in_progress: 'bg-foreground', blocked: 'bg-danger', done: 'bg-success' };

export default function Tasks({ d, tasks, owners, asOf, ask, refresh }) {
  const [filter, setFilter] = useState({ campaign: '', owner: '', q: '' });
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  const list = useMemo(() => tasks.filter((t) =>
    (!filter.campaign || t.campaign_id === filter.campaign) &&
    (!filter.owner || t.owner_id === filter.owner) &&
    (!filter.q || `${t.title} ${t.description || ''}`.toLowerCase().includes(filter.q.toLowerCase()))), [tasks, filter]);
  const overdue = tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < asOf).length;

  async function move(t, status) {
    setErr(null); setBusy(t.task_id);
    try { await setTaskStatus(t.task_id, status); refresh(); } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }
  async function remove(t) {
    if (!window.confirm(`Delete "${t.title}"? This cannot be undone.`)) return;
    setErr(null);
    try { await deleteTask(t.task_id); refresh(); } catch (e) { setErr(e.message); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 @2xl/main:w-auto">
          <div className="relative w-full @lg/main:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" placeholder="Search tasks" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search tasks" className="h-8 pl-8" />
          </div>
          <NativeSelect className="h-8 w-auto max-w-full min-w-0 flex-1 @lg/main:flex-none" value={filter.campaign} onChange={(e) => setFilter({ ...filter, campaign: e.target.value })} aria-label="Filter by campaign">
            <option value="">All campaigns</option>
            {d.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
          </NativeSelect>
          <NativeSelect className="h-8 w-auto max-w-full min-w-0 flex-1 @lg/main:flex-none" value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })} aria-label="Filter by owner">
            <option value="">All owners</option>
            {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
          </NativeSelect>
          {overdue > 0 && (
            <span className="inline-flex w-full items-center gap-1.5 px-1 text-xs font-medium text-danger @lg/main:w-auto">
              <Icon name="alert" size={14} />{overdue} overdue on {shortDate(asOf)}
            </span>
          )}
        </div>
        <div className="ml-auto flex w-full items-center justify-end gap-2 @lg/main:w-auto">
          <Button variant="outline" size="sm" className="flex-1 @lg/main:flex-none" onClick={() => ask('Review our open tasks against current performance. Which matter most, what is missing, and what is overdue?')}>
            <Icon name="chat" />Review with the analyst
          </Button>
          <Button size="sm" className="flex-1 @lg/main:flex-none" onClick={() => setEditing({})}><Icon name="plus" />New task</Button>
        </div>
      </div>
      <Notice>{err}</Notice>

      <div className="grid items-start gap-3 @2xl/main:grid-cols-2 @6xl/main:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = list.filter((t) => t.status === col);
          return (
            <section key={col} className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted/60 p-2 dark:bg-muted/40" aria-label={STATUS_LABEL[col]}>
              <header className="flex items-center gap-2 px-1.5 pt-1 pb-0.5">
                <span className={cn('size-2 rounded-full', LANE_DOT[col])} aria-hidden="true" />
                <h2 className="text-[13px] font-semibold">{STATUS_LABEL[col]}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {items.map((t) => {
                  const late = t.status !== 'done' && t.due_date && t.due_date < asOf;
                  return (
                    <article key={t.task_id} className={cn(
                      'flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-xs transition-opacity',
                      busy === t.task_id && 'opacity-55',
                      col === 'done' && 'text-muted-foreground',
                    )}>
                      <div className="flex items-center gap-2">
                        <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>
                        {t.source === 'ai' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground" title="Created from an AI proposal you confirmed">
                            <Icon name="chat" size={12} />AI
                          </span>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" className="-mr-1 ml-auto text-muted-foreground" aria-label={`Actions for ${t.title}`}><MoreHorizontal /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onSelect={() => setEditing(t)} aria-label={`Edit ${t.title}`}><Icon name="edit" />Edit</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => remove(t)} aria-label={`Delete ${t.title}`}><Icon name="trash" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <h3 className={cn('text-[13.5px] leading-snug font-medium text-pretty', col !== 'done' && 'text-foreground')}>{t.title}</h3>
                      {t.description && <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{t.description}</p>}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {t.campaign?.campaign_name && <span className="min-w-0 truncate">{t.campaign.campaign_name}</span>}
                        <span className="inline-flex items-center gap-1"><Icon name="user" size={12} />{t.owner?.owner_name || 'Unassigned'}</span>
                        {t.due_date && (
                          <span className={cn('inline-flex items-center gap-1 tabular-nums', late && 'font-medium text-danger')} title={late ? `Overdue as of ${longDate(asOf)}` : undefined}>
                            <Icon name="calendar" size={12} />{shortDate(t.due_date)}{late && ' overdue'}
                          </span>
                        )}
                      </div>
                      <div className="border-t pt-2">
                        <NativeSelect className="h-7 w-auto px-2 text-xs shadow-none" value={t.status} onChange={(e) => move(t, e.target.value)} aria-label={`Status of ${t.title}`} disabled={busy === t.task_id}>
                          {COLUMNS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </NativeSelect>
                      </div>
                    </article>
                  );
                })}
                {!items.length && <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">No tasks with this status</div>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Overdue is judged against the snapshot date, so the board can be replayed at any point in the campaign.</p>

      {editing && <TaskModal initial={editing} campaigns={d.campaigns} owners={owners} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}
