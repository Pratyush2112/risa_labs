import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { createTask, shiftBudget, updateCampaign } from '../lib/data.js';
import { inr, shortDate } from '../lib/format.js';

const STORAGE = 'gc-analyst-v2';
const SUGGESTIONS = [
  ['Compare', 'Compare cost per attendee and show rate for Paid Social and College Partnerships.'],
  ['Diagnose', 'Where is the biggest drop in the funnel, and which campaigns cause it?'],
  ['Cohorts', 'Did people who downloaded the brochure attend more often than those who did not?'],
  ['Trend', 'How did weekly registrations change after the targets were revised on 15 March?'],
  ['Act', 'Move ₹20,000 from Paid Social to College Partnerships and create a task for the owner.'],
  ['Limits', 'What is our venue capacity, and will we exceed it?'],
];
const INTENT_LABEL = { compare: 'Comparison', diagnose: 'Diagnosis', trend: 'Trend', forecast: 'Forecast', action: 'Action', lookup: 'Lookup' };
const TOOL_LABEL = {
  get_kpi_snapshot: 'Snapshot', compare_kpis: 'Compare KPIs', get_timeseries: 'Time series', query_data: 'Query',
  calculate: 'Calculate', list_tasks: 'Tasks', list_bets: 'Bets', propose_task: 'Propose task',
  propose_budget_shift: 'Propose budget shift', propose_campaign_status: 'Propose status',
};
const uid = () => Math.random().toString(36).slice(2, 10);

// The response was not JSON: usually the route does not exist (404 from a static host) or the
// function crashed before it could answer.
function describeNonJson(res) {
  if (res.status === 404) {
    return {
      error: 'The analyst API was not found (404).', code: 'no_api',
      hint: 'The /api/chat route is not being served. Run the app with `npm run dev` (which now serves /api) or `npx vercel dev`, and on Vercel make sure the api/ folder is deployed.',
    };
  }
  return { error: `The server returned ${res.status} without a readable error.`, code: 'bad_response', hint: 'Check the server log (terminal or Vercel → Logs) for the stack trace.' };
}

function toApi(messages) {
  const out = [];
  for (const m of messages) {
    if (m.error || !m.text) continue;
    const role = m.role === 'model' ? 'model' : 'user';
    const text = m.role === 'note' ? `[System note] ${m.text}` : m.text;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.text += `\n\n${text}`;
    else out.push({ role, text });
  }
  return out.slice(-14);
}

export default function Copilot({ asOf, d, owners, onClose, onDataChanged, pendingPrompt, clearPending }) {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE)) || []; } catch { return []; } });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(messages.slice(-50))); } catch { /* storage full */ } }, [messages]);
  // Scroll the panel body only (not the page), and only once there is a conversation to follow.
  useEffect(() => {
    const body = endRef.current?.parentElement;
    if (body && (messages.length || busy)) body.scrollTop = body.scrollHeight;
  }, [messages, busy]);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

  async function send(text) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages, { id: uid(), role: 'user', text: q, asOf }];
    setMessages(next); setInput(''); setBusy(true);
    const started = performance.now();
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asOf, messages: toApi(next) }) });
      const json = await res.json().catch(() => describeNonJson(res));
      const ms = Math.round(performance.now() - started);
      if (!res.ok || json.error) {
        console.groupCollapsed(`%c[analyst] ${res.status} ${json.code || 'error'}: ${json.error}`, 'color:#B3261E');
        console.log({ status: res.status, ms, request_id: json.request_id, model: json.model, hint: json.hint, detail: json.detail, trace: json.trace });
        console.groupEnd();
        setMessages((m) => [...m, {
          id: uid(), role: 'model', error: true, text: json.error || `Request failed (${res.status}).`,
          hint: json.hint, detail: json.detail, code: json.code, status: res.status, requestId: json.request_id, trace: json.trace,
        }]);
      } else {
        console.info(`[analyst] ok in ${ms} ms · ${json.model} · ${json.trace?.length || 0} tool calls · request ${json.request_id}`);
        setMessages((m) => [...m, {
          id: uid(), role: 'model', text: json.reply, trace: json.trace, route: json.route, grounding: json.grounding, asOf: json.context_as_of || asOf,
          proposals: (json.proposals || []).map((p) => ({ ...p, pid: uid(), state: 'pending' })),
        }]);
      }
    } catch (e) {
      console.error('[analyst] request failed before a response arrived', e);
      setMessages((m) => [...m, {
        id: uid(), role: 'model', error: true, code: 'offline', text: 'Could not reach the server.',
        hint: 'Check that the dev server is still running and that you are online.', detail: e.message,
      }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (pendingPrompt?.text) { send(pendingPrompt.text); clearPending(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt?.id]);

  const patchProposal = (mid, pid, patch) => setMessages((ms) => ms.map((m) => (m.id !== mid ? m : { ...m, proposals: m.proposals.map((p) => (p.pid === pid ? { ...p, ...patch } : p)) })));
  const note = (text) => setMessages((ms) => [...ms, { id: uid(), role: 'note', text }]);

  async function confirm(m, p) {
    patchProposal(m.id, p.pid, { state: 'saving', err: null });
    try {
      if (p.type === 'task') {
        await createTask({ title: p.title, description: p.description, campaign_id: p.campaign_id, owner_id: p.owner_id, due_date: p.due_date, priority: p.priority }, 'ai_confirmed');
        const owner = owners.find((o) => o.owner_id === p.owner_id)?.owner_name || 'unassigned';
        note(`The user confirmed and created the task "${p.title}" (owner ${owner}, due ${p.due_date || 'no date'}, priority ${p.priority}).`);
      } else if (p.type === 'budget_shift') {
        await shiftBudget(p.from_campaign_id, p.to_campaign_id, p.amount_inr, p.rationale, 'ai_confirmed');
        note(`The user confirmed moving ${inr(Number(p.amount_inr))} of allocated budget from ${p.from_name} to ${p.to_name}.`);
      } else if (p.type === 'campaign_status') {
        await updateCampaign(p.campaign_id, { status: p.status, decision_note: p.note }, 'ai_confirmed');
        note(`The user confirmed setting ${p.campaign_name} to "${p.status}".`);
      }
      patchProposal(m.id, p.pid, { state: 'confirmed' });
      onDataChanged();
    } catch (e) {
      patchProposal(m.id, p.pid, { state: 'pending', err: e.message });
    }
  }
  function dismiss(m, p) {
    patchProposal(m.id, p.pid, { state: 'dismissed' });
    note(`The user dismissed the proposed ${p.type === 'task' ? `task "${p.title}"` : p.type.replace('_', ' ')}.`);
  }

  return (
    <aside className="analyst" id="analyst" aria-label="Growth analyst">
      <header className="an-h">
        <div className="an-title"><div><strong>Growth analyst</strong><span>Reads live data as of {shortDate(asOf)} 2025</span></div></div>
        <div className="an-tools">
          {messages.length > 0 && <button className="link" onClick={() => setMessages([])}>Clear</button>}
          <button className="icon-btn" onClick={onClose} aria-label="Close the analyst"><Icon name="close" /></button>
        </div>
      </header>

      <div className="an-body" aria-live="polite">
        {messages.length === 0 && (
          <div className="an-empty">
            <p>Answers come from the same database as the dashboard. Every figure is checked against the data, and nothing is changed until you confirm.</p>
            <p className="an-empty-h">Try asking</p>
            <ul className="prompts">
              {SUGGESTIONS.map(([, s]) => <li key={s}><button onClick={() => send(s)}>{s}</button></li>)}
            </ul>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === 'note') return <div key={m.id} className="an-note"><Icon name="check" size={14} />{m.text}</div>;
          if (m.role === 'user') return <div key={m.id} className="an-q">{m.text}</div>;
          return (
            <div key={m.id} className={`an-a ${m.error ? 'is-error' : ''}`}>
              {m.error ? <ErrorBody m={m} /> : <Markdown text={m.text} />}
              {!m.error && (
                <div className="an-meta">
                  {m.route && <span className="tag">{INTENT_LABEL[m.route.intent] || 'Answer'}</span>}
                  {m.grounding && m.grounding.checked > 0 && (
                    m.grounding.unsupported.length
                      ? <span className="tag warn" title={`Not traced: ${m.grounding.unsupported.join(', ')}`}><Icon name="alert" size={13} />{m.grounding.unsupported.length} figure{m.grounding.unsupported.length > 1 ? 's' : ''} not traced</span>
                      : <span className="tag good"><Icon name="check" size={13} />{m.grounding.checked} figure{m.grounding.checked > 1 ? 's' : ''} traced to data</span>
                  )}
                  {m.asOf && <span className="tag">As of {shortDate(m.asOf)}</span>}
                </div>
              )}
              {m.trace?.length > 0 && (
                <details className="an-trace">
                  <summary>Data checked ({m.trace.length})</summary>
                  <ol>{m.trace.map((t, i) => (
                    <li key={i}><span className="tr-n">{TOOL_LABEL[t.name] || t.name}</span><span className="tr-d">{t.detail}</span>{t.error && <span className="tr-e">{t.error}</span>}</li>
                  ))}</ol>
                </details>
              )}
              {m.proposals?.map((p) => (
                <Proposal key={p.pid} p={p} d={d} owners={owners}
                  onChange={(patch) => patchProposal(m.id, p.pid, patch)} onConfirm={() => confirm(m, p)} onDismiss={() => dismiss(m, p)} />
              ))}
            </div>
          );
        })}
        {busy && <div className="an-a thinking"><span className="dots" aria-hidden="true"><i /><i /><i /></span>Routing, querying and checking figures</div>}
        <div ref={endRef} />
      </div>

      <form className="an-in" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea ref={inputRef} value={input} rows={2} maxLength={2000} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question or request an action"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} aria-label="Message the analyst" />
        <button className="btn primary icon-only" disabled={busy || !input.trim()} aria-label="Send"><Icon name="send" /></button>
      </form>
    </aside>
  );
}

function ErrorBody({ m }) {
  return (
    <div className="an-err" role="alert">
      <p className="an-err-t"><Icon name="alert" size={15} />{m.text}</p>
      {m.hint && <p className="an-err-h">{m.hint}</p>}
      {(m.detail || m.requestId || m.code) && (
        <details className="an-err-d">
          <summary>Technical details</summary>
          <dl>
            {m.code && <><dt>Code</dt><dd>{m.code}{m.status ? ` (HTTP ${m.status})` : ''}</dd></>}
            {m.requestId && <><dt>Request</dt><dd>{m.requestId} <span className="muted">(search the server log for this id)</span></dd></>}
          </dl>
          {m.detail && <pre>{m.detail}</pre>}
        </details>
      )}
    </div>
  );
}

function Proposal({ p, d, owners, onChange, onConfirm, onDismiss }) {
  const locked = p.state === 'confirmed' || p.state === 'dismissed' || p.state === 'saving';
  const title = { task: 'Proposed task', budget_shift: 'Proposed budget move', campaign_status: 'Proposed status change' }[p.type];
  return (
    <div className={`proposal is-${p.state}`}>
      <div className="prop-h"><strong>{title}</strong><span>{p.state === 'pending' ? 'Review, edit and confirm' : p.state === 'saving' ? 'Saving' : p.state === 'confirmed' ? 'Saved' : 'Dismissed'}</span></div>
      {p.type === 'task' && (
        <div className="prop-form">
          <input value={p.title} disabled={locked} onChange={(e) => onChange({ title: e.target.value })} aria-label="Task title" maxLength={160} />
          <textarea rows={3} value={p.description || ''} disabled={locked} onChange={(e) => onChange({ description: e.target.value })} aria-label="Task description" />
          <div className="row">
            <select value={p.campaign_id || ''} disabled={locked} onChange={(e) => onChange({ campaign_id: e.target.value || null })} aria-label="Campaign">
              <option value="">No campaign</option>
              {(d?.campaigns || []).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
            </select>
            <select value={p.owner_id || ''} disabled={locked} onChange={(e) => onChange({ owner_id: e.target.value || null })} aria-label="Owner">
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
            </select>
          </div>
          <div className="row">
            <input type="date" value={p.due_date || ''} disabled={locked} onChange={(e) => onChange({ due_date: e.target.value })} aria-label="Due date" />
            <select value={p.priority} disabled={locked} onChange={(e) => onChange({ priority: e.target.value })} aria-label="Priority">
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </div>
        </div>
      )}
      {p.type === 'budget_shift' && (
        <div className="prop-text">
          <p>Move <input type="number" min="1" className="inline-num" value={p.amount_inr} disabled={locked} onChange={(e) => onChange({ amount_inr: e.target.value })} aria-label="Amount in rupees" /> from <strong>{p.from_name}</strong> to <strong>{p.to_name}</strong>.</p>
          {p.rationale && <p className="muted">{p.rationale}</p>}
        </div>
      )}
      {p.type === 'campaign_status' && (
        <div className="prop-text"><p>Set <strong>{p.campaign_name}</strong> from {p.from_status} to <strong>{p.status}</strong>.</p>{p.note && <p className="muted">{p.note}</p>}</div>
      )}
      {p.err && <p className="prop-err" role="alert">{p.err}</p>}
      {p.state === 'pending' && (
        <div className="actions">
          <button className="btn ghost sm" onClick={onDismiss}>Dismiss</button>
          <button className="btn primary sm" onClick={onConfirm}><Icon name="check" size={16} />Confirm and save</button>
        </div>
      )}
    </div>
  );
}
