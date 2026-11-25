import React, { useState } from 'react';
import { Modal, Field, Notice, NativeSelect } from './ui.jsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
      <form className="flex flex-col gap-4" onSubmit={save}>
        <Field label="Title"><Input value={t.title} onChange={set('title')} maxLength={160} required /></Field>
        <Field label="What to do, and the evidence behind it">
          <Textarea rows={3} className="min-h-20" value={t.description || ''} onChange={set('description')} maxLength={2000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaign">
            <NativeSelect value={t.campaign_id || ''} onChange={pickCampaign}>
              <option value="">No campaign</option>
              {campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Owner">
            <NativeSelect value={t.owner_id || ''} onChange={set('owner_id')}>
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Due date"><Input type="date" value={t.due_date || ''} onChange={set('due_date')} /></Field>
          <Field label="Priority">
            <NativeSelect value={t.priority} onChange={set('priority')}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect value={t.status} onChange={set('status')}>
              <option value="todo">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option>
            </NativeSelect>
          </Field>
        </div>
        <Notice>{err}</Notice>
        <div className="-mx-6 -mb-6 mt-1 flex flex-col-reverse gap-2 border-t bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : t.task_id ? 'Save changes' : 'Create task'}</Button>
        </div>
      </form>
    </Modal>
  );
}
