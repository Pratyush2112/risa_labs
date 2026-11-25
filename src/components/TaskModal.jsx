import React, { useState } from 'react';
import { Modal, Field, Notice } from './ui.jsx';
import { createTask, updateTask } from '../lib/data.js';

const BLANK = { title: '', description: '', campaign_id: '', owner_id: '', due_date: '', priority: 'medium', status: 'todo' };

export default function TaskModal({ initial, campaigns, owners, onClose, onSaved }) {
  const [t, setT] = useState({ ...BLANK, ...initial });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setT((x) => ({ ...x, [k]: e.target.value }));

  const pickCampaign = (e) => {
    const id = e.target.value;
    const c = campaigns.find((x) => x.campaign_id === id);
    setT((x) => ({ ...x, campaign_id: id, owner_id: x.owner_id || c?.owner_id || '' }));
  };

  async function save(e) {
    e.preventDefault();
    if (t.title.trim().length < 3) return setErr('Give the task a title of at least 3 characters.');
    setSaving(true); setErr(null);
    try {
      if (t.task_id) await updateTask(t);
      else await createTask(t);
      onSaved();
    } catch (x) { setErr(x.message); setSaving(false); }
  }

  return (
    <Modal title={t.task_id ? 'Edit task' : 'New task'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="Title"><input value={t.title} onChange={set('title')} maxLength={160} required /></Field>
        <Field label="What to do, and the evidence behind it"><textarea rows={3} value={t.description || ''} onChange={set('description')} maxLength={2000} /></Field>
        <div className="row">
          <Field label="Campaign">
            <select value={t.campaign_id || ''} onChange={pickCampaign}>
              <option value="">No campaign</option>
              {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
            </select>
          </Field>
          <Field label="Owner">
            <select value={t.owner_id || ''} onChange={set('owner_id')}>
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Due date"><input type="date" value={t.due_date || ''} onChange={set('due_date')} /></Field>
          <Field label="Priority">
            <select value={t.priority} onChange={set('priority')}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          </Field>
          <Field label="Status">
            <select value={t.status} onChange={set('status')}>
              <option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </select>
          </Field>
        </div>
        <Notice>{err}</Notice>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : t.task_id ? 'Save changes' : 'Create task'}</button>
        </div>
      </form>
    </Modal>
  );
}
