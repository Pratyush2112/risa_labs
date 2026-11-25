import React, { useMemo, useState } from 'react';
import { Notice, Pill } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { setTaskStatus, deleteTask } from '../lib/data.js';
import { shortDate, longDate, STATUS_LABEL } from '../lib/format.js';

const COLUMNS = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITY_TONE = { high: 'bad', medium: 'warn', low: 'mute' };

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
    <div className="stack">
      <div className="toolbar">
        <div className="toolbar-l">
          <input className="search" type="search" placeholder="Search tasks" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search tasks" />
          <select value={filter.campaign} onChange={(e) => setFilter({ ...filter, campaign: e.target.value })} aria-label="Filter by campaign">
            <option value="">All campaigns</option>
            {d.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
          </select>
          <select value={filter.owner} onChange={(e) => setFilter({ ...filter, owner: e.target.value })} aria-label="Filter by owner">
            <option value="">All owners</option>
            {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
          </select>
          {overdue > 0 && <span className="overdue-note"><Icon name="alert" size={16} />{overdue} overdue on {shortDate(asOf)}</span>}
        </div>
        <div className="toolbar-r">
          <button className="btn ghost sm" onClick={() => ask('Review our open tasks against current performance. Which matter most, what is missing, and what is overdue?')}><Icon name="chat" size={16} />Review with the analyst</button>
          <button className="btn primary sm" onClick={() => setEditing({})}><Icon name="plus" size={16} />New task</button>
        </div>
      </div>
      <Notice>{err}</Notice>

      <div className="board">
        {COLUMNS.map((col) => {
          const items = list.filter((t) => t.status === col);
          return (
            <section key={col} className={`lane lane-${col}`} aria-label={STATUS_LABEL[col]}>
              <header className="lane-h"><h2>{STATUS_LABEL[col]}</h2><span className="count">{items.length}</span></header>
              <div className="lane-body">
                {items.map((t) => {
                  const late = t.status !== 'done' && t.due_date && t.due_date < asOf;
                  return (
                    <article key={t.task_id} className={`card ${late ? 'is-late' : ''} ${busy === t.task_id ? 'is-busy' : ''}`}>
                      <div className="card-top">
                        <Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill>
                        {t.source === 'ai' && <span className="ai-mark" title="Created from an AI proposal you confirmed"><Icon name="chat" size={13} />AI</span>}
                      </div>
                      <h3 className="card-t">{t.title}</h3>
                      {t.description && <p className="card-d">{t.description}</p>}
                      <div className="card-meta">
                        {t.campaign?.campaign_name && <span>{t.campaign.campaign_name}</span>}
                        <span><Icon name="user" size={13} />{t.owner?.owner_name || 'Unassigned'}</span>
                        {t.due_date && <span className={late ? 'late' : ''} title={late ? `Overdue as of ${longDate(asOf)}` : undefined}><Icon name="calendar" size={13} />{shortDate(t.due_date)}{late && ' overdue'}</span>}
                      </div>
                      <div className="card-actions">
                        <select value={t.status} onChange={(e) => move(t, e.target.value)} aria-label={`Status of ${t.title}`}>
                          {COLUMNS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                        <span className="spacer" />
                        <button className="icon-btn sm" onClick={() => setEditing(t)} aria-label={`Edit ${t.title}`}><Icon name="edit" size={15} /></button>
                        <button className="icon-btn sm" onClick={() => remove(t)} aria-label={`Delete ${t.title}`}><Icon name="trash" size={15} /></button>
                      </div>
                    </article>
                  );
                })}
                {!items.length && <div className="lane-empty">No tasks with this status</div>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="foot-note">Overdue is judged against the snapshot date, so the board can be replayed at any point in the campaign.</p>

      {editing && <TaskModal initial={editing} campaigns={d.campaigns} owners={owners} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}
