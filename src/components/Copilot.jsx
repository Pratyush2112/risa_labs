import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, CircleAlert, Loader2, RotateCcw, X } from 'lucide-react';
import { Markdown } from '../lib/markdown.jsx';
import { createTask, shiftBudget, updateCampaign } from '../lib/data.js';
import { inr, shortDate } from '../lib/format.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NativeSelect, Pill } from './ui.jsx';

const STORAGE = 'gc-analyst-v2';
const SUGGESTIONS = [
  'Compare cost per attendee and show rate for Paid Social and College Partnerships.',
  'Where is the biggest drop in the funnel, and which campaigns cause it?',
  'Did people who downloaded the brochure attend more often than those who did not?',
  'How did weekly registrations change after the targets were revised on 15 March?',
  'Move ₹20,000 from Paid Social to College Partnerships and create a task for the owner.',
  'What is our venue capacity, and will we exceed it?',
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
      hint: 'The /api/chat route is not being served. Run the app with `npm run dev` (which serves /api) or `npx vercel dev`, and on Vercel make sure the api/ folder is deployed.',
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

// Markdown answers, styled from the outside so markdown.jsx stays presentation-free.
const PROSE = cn(
  'text-sm leading-relaxed text-foreground',
  '[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_.md-h]:mt-3 [&_.md-h]:mb-1 [&_.md-h]:font-semibold [&_strong]:font-semibold',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px]',
  '[&_.md-table]:my-2 [&_.md-table]:overflow-x-auto [&_table]:w-full [&_table]:text-xs [&_th]:border-b [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:border-b [&_td]:px-2 [&_td]:py-1.5',
);

export default function Copilot({ asOf, d, owners, onClose, onDataChanged, pendingPrompt, clearPending }) {
  const [messages, setMessages] = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE)) || []; } catch { return []; } });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(messages.slice(-50))); } catch { /* storage full */ } }, [messages]);
  // Scroll the panel body only (not the page), and only once there is a conversation to follow.
  useEffect(() => {
    const body = bodyRef.current;
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
        console.groupCollapsed(`%c[analyst] ${res.status} ${json.code || 'error'}: ${json.error}`, 'color:#dc2626');
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Growth analyst</h2>
          <p className="text-xs text-muted-foreground">Live data as of {shortDate(asOf)} 2025</p>
        </div>
        {messages.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setMessages([])} aria-label="Clear the conversation"><RotateCcw className="size-4" /></Button>
            </TooltipTrigger>
            <TooltipContent>Clear conversation</TooltipContent>
          </Tooltip>
        )}
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={onClose} aria-label="Close the analyst"><X className="size-4" /></Button>
      </header>

      <div ref={bodyRef} className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-muted-foreground">Answers come from the same database as the dashboard. Every figure is checked against the data, and nothing changes until you confirm.</p>
            <p className="mt-5 mb-1 text-xs font-medium text-muted-foreground">Try asking</p>
            <ul className="divide-y rounded-lg border">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button onClick={() => send(s)} className="group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-foreground/80 transition-colors outline-none first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted">
                    <span className="flex-1">{s}</span>
                    <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === 'note') {
            return <div key={m.id} className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-xs text-success"><Check className="mt-0.5 size-3.5 shrink-0" />{m.text}</div>;
          }
          if (m.role === 'user') {
            return <div key={m.id} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{m.text}</div>;
          }
          return (
            <div key={m.id} className="flex flex-col gap-2">
              {m.error ? <ErrorBody m={m} /> : <div className={PROSE}><Markdown text={m.text} /></div>}
              {!m.error && (
                <div className="flex flex-wrap gap-1.5">
                  {m.route && <Pill>{INTENT_LABEL[m.route.intent] || 'Answer'}</Pill>}
                  {m.grounding && m.grounding.checked > 0 && (
                    m.grounding.unsupported.length
                      ? <Pill tone="warn" title={`Not traced: ${m.grounding.unsupported.join(', ')}`} dot>{m.grounding.unsupported.length} figure{m.grounding.unsupported.length > 1 ? 's' : ''} not traced</Pill>
                      : <Pill tone="good" dot>{m.grounding.checked} figure{m.grounding.checked > 1 ? 's' : ''} traced to data</Pill>
                  )}
                  {m.asOf && <Pill>As of {shortDate(m.asOf)}</Pill>}
                </div>
              )}
              {m.trace?.length > 0 && (
                <details className="group rounded-md border text-xs">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
                    <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />Data checked ({m.trace.length})
                  </summary>
                  <ol className="flex flex-col gap-1.5 border-t px-2.5 py-2">
                    {m.trace.map((t, i) => (
                      <li key={i} className="flex flex-col">
                        <span className="font-medium">{TOOL_LABEL[t.name] || t.name}</span>
                        <span className="font-mono text-[11px] break-words text-muted-foreground">{t.detail}</span>
                        {t.error && <span className="text-danger">{t.error}</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {m.proposals?.map((p) => (
                <Proposal key={p.pid} p={p} d={d} owners={owners}
                  onChange={(patch) => patchProposal(m.id, p.pid, patch)} onConfirm={() => confirm(m, p)} onDismiss={() => dismiss(m, p)} />
              ))}
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />Querying the data and checking figures
          </div>
        )}
      </div>

      <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex flex-col rounded-xl border bg-card shadow-xs transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <textarea ref={inputRef} value={input} rows={2} maxLength={2000} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question or request an action"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }} aria-label="Message the analyst"
            className="min-h-[52px] w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground" />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="pl-1 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</span>
            <Button type="submit" size="icon" className="size-7 rounded-full" disabled={busy || !input.trim()} aria-label="Send"><ArrowUp className="size-4" /></Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ErrorBody({ m }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5" role="alert">
      <p className="flex items-start gap-2 text-sm font-medium text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{m.text}</p>
      {m.hint && <p className="text-sm text-foreground/80">{m.hint}</p>}
      {(m.detail || m.requestId || m.code) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Technical details</summary>
          <dl className="mt-1.5 grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5">
            {m.code && <><dt className="text-muted-foreground">Code</dt><dd className="font-mono">{m.code}{m.status ? ` (HTTP ${m.status})` : ''}</dd></>}
            {m.requestId && <><dt className="text-muted-foreground">Request</dt><dd className="font-mono">{m.requestId} <span className="font-sans text-muted-foreground">(search the server log for this id)</span></dd></>}
          </dl>
          {m.detail && <pre className="mt-1.5 max-h-44 overflow-auto rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">{m.detail}</pre>}
        </details>
      )}
    </div>
  );
}

function Proposal({ p, d, owners, onChange, onConfirm, onDismiss }) {
  const locked = p.state === 'confirmed' || p.state === 'dismissed' || p.state === 'saving';
  const title = { task: 'Proposed task', budget_shift: 'Proposed budget move', campaign_status: 'Proposed status change' }[p.type];
  const status = { pending: 'Review, edit and confirm', saving: 'Saving', confirmed: 'Saved', dismissed: 'Dismissed' }[p.state];
  return (
    <div className={cn('flex flex-col gap-2.5 rounded-lg border p-3',
      p.state === 'confirmed' ? 'border-success/30 bg-success-soft' : p.state === 'dismissed' ? 'opacity-60' : 'border-brand/50 bg-card')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
      {p.type === 'task' && (
        <div className="flex flex-col gap-2">
          <Input className="h-8 text-sm" value={p.title} disabled={locked} onChange={(e) => onChange({ title: e.target.value })} aria-label="Task title" maxLength={160} />
          <Textarea className="min-h-16 text-sm" rows={3} value={p.description || ''} disabled={locked} onChange={(e) => onChange({ description: e.target.value })} aria-label="Task description" />
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect className="h-8 text-xs" value={p.campaign_id || ''} disabled={locked} onChange={(e) => onChange({ campaign_id: e.target.value || null })} aria-label="Campaign">
              <option value="">No campaign</option>
              {(d?.campaigns || []).map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
            </NativeSelect>
            <NativeSelect className="h-8 text-xs" value={p.owner_id || ''} disabled={locked} onChange={(e) => onChange({ owner_id: e.target.value || null })} aria-label="Owner">
              <option value="">Unassigned</option>
              {owners.map((o) => <option key={o.owner_id} value={o.owner_id}>{o.owner_name}</option>)}
            </NativeSelect>
            <Input type="date" className="h-8 text-xs" value={p.due_date || ''} disabled={locked} onChange={(e) => onChange({ due_date: e.target.value })} aria-label="Due date" />
            <NativeSelect className="h-8 text-xs" value={p.priority} disabled={locked} onChange={(e) => onChange({ priority: e.target.value })} aria-label="Priority">
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </NativeSelect>
          </div>
        </div>
      )}
      {p.type === 'budget_shift' && (
        <div className="flex flex-col gap-1.5 text-sm">
          <p className="flex flex-wrap items-center gap-1.5">Move
            <Input type="number" min="1" className="h-7 w-28 text-sm" value={p.amount_inr} disabled={locked} onChange={(e) => onChange({ amount_inr: e.target.value })} aria-label="Amount in rupees" />
            from <strong className="font-medium">{p.from_name}</strong> to <strong className="font-medium">{p.to_name}</strong>.</p>
          {p.rationale && <p className="text-muted-foreground">{p.rationale}</p>}
        </div>
      )}
      {p.type === 'campaign_status' && (
        <div className="flex flex-col gap-1.5 text-sm">
          <p>Set <strong className="font-medium">{p.campaign_name}</strong> from {p.from_status} to <strong className="font-medium">{p.status}</strong>.</p>
          {p.note && <p className="text-muted-foreground">{p.note}</p>}
        </div>
      )}
      {p.err && <p className="text-xs text-danger" role="alert">{p.err}</p>}
      {p.state === 'pending' && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
          <Button size="sm" onClick={onConfirm}><Check />Confirm and save</Button>
        </div>
      )}
    </div>
  );
}
