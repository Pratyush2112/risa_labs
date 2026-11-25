// POST /api/chat — runs the LangGraph analyst. The server uses the public anon key, so the AI
// can only read data and call the same read RPCs as the browser: it holds no write privileges.
// Writes happen in the browser after the user confirms a proposal.
//
// Logging: every request prints one line per stage, prefixed with "[analyst <id>]", to the server
// console (terminal for `npm run dev`, Vercel → Logs in production). Failures are classified into a
// short `code` plus a `hint` that tells you what to fix; the same id is returned to the browser.
import { createClient } from '@supabase/supabase-js';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { buildGraph } from '../server/agent/graph.js';
import { makeTools } from '../server/agent/tools.js';

const DATE_RE = /^2025-(0[1-4])-(0[1-9]|[12]\d|3[01])$/;

function parseBody(req) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const asOf = DATE_RE.test(body.asOf) && body.asOf >= '2025-01-15' && body.asOf <= '2025-04-20' ? body.asOf : '2025-04-20';
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
    .slice(-14)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
  while (messages.length && messages[0].role === 'model') messages.shift(); // Gemini needs a user turn first
  return { asOf, messages };
}

// Turn a provider error into something a person can act on. Order matters: the most specific first.
export function classifyModelError(raw, model) {
  const msg = String(raw || '');
  const rules = [
    [/API_KEY_INVALID|API key not valid|API key expired/i, 401, 'invalid_api_key',
      'Google rejected GEMINI_API_KEY. Create a key at https://aistudio.google.com/apikey (it starts with "AIza" and is 39 characters), put it in .env and in Vercel → Settings → Environment Variables, then restart the dev server or redeploy.'],
    [/PERMISSION_DENIED|\b403\b|has not been used in project|is disabled/i, 403, 'permission_denied',
      'The key is valid but cannot call the Gemini API. Enable "Generative Language API" for the key\'s Google Cloud project, or create the key from AI Studio.'],
    [/\b404\b|not found for API version|is not found|NOT_FOUND/i, 400, 'model_not_found',
      `The model "${model}" is not available to this key. Set GEMINI_MODEL to a model your key can use (for example gemini-2.5-flash).`],
    [/\b429\b|RESOURCE_EXHAUSTED|quota|rate limit|too many requests/i, 429, 'rate_limited',
      'The Gemini quota for this key is used up. Wait a minute (per-minute limit) or until tomorrow (daily limit), or use a key with billing enabled.'],
    [/SAFETY|blocked/i, 422, 'blocked',
      'Gemini blocked the response for safety reasons. Rephrase the question.'],
    [/\b(500|502|503|504)\b|UNAVAILABLE|overloaded|INTERNAL/i, 503, 'model_unavailable',
      'Gemini is temporarily unavailable. Try again in a minute.'],
    [/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i, 504, 'network',
      'The server could not reach Google. Check the internet connection or proxy of the machine running the API.'],
  ];
  for (const [re, status, code, hint] of rules) if (re.test(msg)) return { status, code, hint };
  return { status: 502, code: 'agent_error', hint: 'The analyst failed while answering. The detail below and the server log have the cause.' };
}

// A cheap shape check so a pasted token of the wrong kind is caught before calling Google.
function keyProblem(key) {
  if (!key) return 'GEMINI_API_KEY is not set';
  if (/^["'\s]|["'\s]$/.test(key)) return 'GEMINI_API_KEY has quotes or spaces around it';
  if (!key.startsWith('AIza') || key.length !== 39) return `GEMINI_API_KEY does not look like an AI Studio key (length ${key.length}, expected 39 starting with "AIza")`;
  return null;
}

export default async function handler(req, res) {
  const id = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  const log = (...a) => console.log(`[analyst ${id}] +${Date.now() - t0}ms`, ...a);
  const fail = (status, code, error, extra = {}) => {
    console.error(`[analyst ${id}] FAILED ${status} ${code}: ${error}${extra.detail ? `\n  detail: ${extra.detail}` : ''}${extra.hint ? `\n  fix: ${extra.hint}` : ''}`);
    return res.status(status).json({ error, code, request_id: id, ...extra });
  };

  if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');

  const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const supaUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const missing = [!apiKey && 'GEMINI_API_KEY', !supaUrl && 'SUPABASE_URL', !supaKey && 'SUPABASE_ANON_KEY'].filter(Boolean);
  if (missing.length) {
    return fail(500, 'missing_env', `The server is missing ${missing.join(', ')}.`, {
      hint: 'Add them to .env for local runs and to Vercel → Settings → Environment Variables, then restart or redeploy.',
    });
  }
  const shape = keyProblem(process.env.GEMINI_API_KEY);
  if (shape) log(`WARNING ${shape}. Google will probably reject it.`);

  let input;
  try { input = parseBody(req); } catch { return fail(400, 'bad_json', 'Invalid JSON body.'); }
  if (!input.messages.length || input.messages.at(-1).role !== 'user') {
    return fail(400, 'bad_request', 'The last message must be from the user.');
  }
  log(`start model=${MODEL} asOf=${input.asOf} turns=${input.messages.length} q="${input.messages.at(-1).text.slice(0, 80)}"`);

  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  let owners; let campaigns;
  try {
    const [o, c] = await Promise.all([
      db.from('owners').select('owner_id,owner_name').order('owner_id'),
      db.from('campaigns').select('campaign_id,campaign_name,owner_id,status').order('campaign_id'),
    ]);
    if (o.error || c.error) throw new Error((o.error || c.error).message);
    owners = o.data; campaigns = c.data;
  } catch (e) {
    return fail(502, 'database', `Database error: ${e.message}`, {
      detail: String(e.message).slice(0, 300), hint: 'Check SUPABASE_URL and SUPABASE_ANON_KEY, and that the project is not paused.',
    });
  }
  log(`database ok owners=${owners.length} campaigns=${campaigns.length}`);

  const ctx = { db, asOf: input.asOf, owners, campaigns, trace: [], proposals: [], evidence: [], cache: new Map() };

  try {
    const tools = makeTools(ctx);
    const model = new ChatGoogleGenerativeAI({ model: MODEL, apiKey, maxRetries: 1 });
    const graph = buildGraph({ model, tools, ctx });
    const messages = input.messages.map((m) => (m.role === 'model' ? new AIMessage(m.text) : new HumanMessage(m.text)));

    const out = await graph.invoke({ messages, asOf: input.asOf }, { recursionLimit: 40 });
    log(`done route=${out.route?.intent} tools=${ctx.trace.length} stop=${out.stopReason} grounding=${out.grounding ? `${out.grounding.checked} checked/${out.grounding.unsupported.length} untraced` : 'n/a'}`);
    return res.status(200).json({
      reply: out.answer,
      proposals: ctx.proposals,
      trace: ctx.trace,
      route: out.route,
      grounding: out.grounding || null,
      context_as_of: out.context?.as_of,
      stop_reason: out.stopReason,
      model: MODEL,
      request_id: id,
    });
  } catch (e) {
    const detail = String(e?.message || e).replace(apiKey, '[key]');
    const { status, code, hint } = classifyModelError(detail, MODEL);
    if (code === 'agent_error' && e?.stack) console.error(e.stack);
    const headline = {
      invalid_api_key: 'The Gemini API key was rejected.',
      permission_denied: 'The Gemini API key is not allowed to call this API.',
      model_not_found: `The model "${MODEL}" was not found for this key.`,
      rate_limited: 'The Gemini usage limit was reached.',
      blocked: 'The answer was blocked by Gemini safety filters.',
      model_unavailable: 'Gemini is temporarily unavailable.',
      network: 'The server could not reach Gemini.',
      agent_error: 'The analyst failed while answering.',
    }[code];
    return fail(status, code, headline, { hint, detail: detail.slice(0, 600), model: MODEL, trace: ctx.trace });
  }
}
