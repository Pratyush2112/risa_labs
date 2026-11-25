// Data access. Reads use PostgREST selects (with foreign-key embeds) and analytics RPCs.
// Every write goes through a validated SECURITY DEFINER function with typed parameters —
// the browser has no INSERT/UPDATE/DELETE rights on any table, and no query string is
// ever assembled from user input.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && anon);
export const supabase = configured ? createClient(url, anon, { auth: { persistSession: false } }) : null;

const FRIENDLY = [
  [/violates check constraint "tasks_title_check"/, 'Titles need 3–160 characters.'],
  [/violates check constraint "settings_check"|settings.*check/, 'That value is outside the allowed range for this setting.'],
  [/violates foreign key constraint/, 'That reference does not exist (check the campaign or owner).'],
  [/duplicate key value/, 'That ID already exists.'],
  [/violates check constraint/, 'One of the values is not allowed.'],
];
function check({ data, error }) {
  if (error) {
    const hit = FRIENDLY.find(([re]) => re.test(error.message));
    throw new Error(hit ? hit[1] : error.message);
  }
  return data;
}
const rpc = async (fn, args) => check(await supabase.rpc(fn, args));
const int = (v) => (v === '' || v == null ? null : Math.round(Number(v)));

// ---------- Reads ----------
export const getSnapshot = (asOf) => rpc('growth_snapshot', { p_as_of: asOf });
export const getDaily = (asOf, campaignId = null) => rpc('growth_daily', { p_as_of: asOf, p_campaign_id: campaignId });
export const getOwners = async () => check(await supabase.from('owners').select('owner_id,owner_name').order('owner_name'));
export const getTasks = async () => check(await supabase.from('tasks')
  .select('task_id,title,description,campaign_id,owner_id,due_date,priority,status,source,created_at,updated_at,campaign:campaigns(campaign_name),owner:owners(owner_name)')
  .order('due_date', { ascending: true, nullsFirst: false }));
export const getBets = async () => check(await supabase.from('bets').select('*, owner:owners(owner_name)').order('rank'));
export const getSettings = async () => check(await supabase.from('settings').select('*').order('kind').order('key'));
export const getTargets = async () => check(await supabase.from('targets').select('*').order('effective_at'));
export const getActivity = async (limit = 60) => check(await supabase.from('activity_log').select('*').order('at', { ascending: false }).limit(limit));
export const getIngestReport = async () => check(await supabase.from('ingest_runs').select('table_name,raw_rows,distinct_ids,loaded_rows,duplicates_removed,orphans_skipped,at').order('table_name'));
export const findDaily = async (campaignId, date) =>
  check(await supabase.from('daily_marketing').select('*').eq('campaign_id', campaignId).eq('activity_date', date).maybeSingle());
export const searchRegistrations = (term) => rpc('rpc_search_registrations', { p_term: term });
export const getHistory = (registrationId) => rpc('rpc_registration_history', { p_registration_id: registrationId });

// ---------- Writes (validated RPCs) ----------
export const createTask = (t, actor = 'user') => rpc('rpc_create_task', {
  p_title: t.title, p_description: t.description || null, p_campaign_id: t.campaign_id || null, p_owner_id: t.owner_id || null,
  p_due_date: t.due_date || null, p_priority: t.priority || 'medium', p_status: t.status || 'todo', p_actor: actor,
});
export const updateTask = (t) => rpc('rpc_update_task', {
  p_task_id: t.task_id, p_title: t.title, p_description: t.description || null, p_campaign_id: t.campaign_id || null,
  p_owner_id: t.owner_id || null, p_due_date: t.due_date || null, p_priority: t.priority, p_status: t.status,
});
export const setTaskStatus = (taskId, status) => rpc('rpc_set_task_status', { p_task_id: taskId, p_status: status });
export const deleteTask = (taskId) => rpc('rpc_delete_task', { p_task_id: taskId });

export const updateCampaign = (id, patch, actor = 'user') => rpc('rpc_update_campaign', {
  p_campaign_id: id, p_status: patch.status ?? null, p_allocated_budget_inr: patch.allocated_budget_inr == null ? null : int(patch.allocated_budget_inr),
  p_owner_id: patch.owner_id ?? null, p_decision_note: patch.decision_note ?? null, p_actor: actor,
});
export const shiftBudget = (from, to, amount, rationale = '', actor = 'user') =>
  rpc('rpc_shift_budget', { p_from: from, p_to: to, p_amount: int(amount), p_rationale: rationale, p_actor: actor });
export const createCampaign = (c) => rpc('rpc_create_campaign', {
  p_campaign_id: c.campaign_id, p_campaign_name: c.campaign_name, p_channel: c.channel || null, p_owner_id: c.owner_id || null,
  p_target_audience: c.target_audience || null, p_objective: c.objective || null, p_allocated_budget_inr: int(c.allocated_budget_inr) ?? 0,
});

export const saveDaily = (r) => rpc('rpc_save_daily', {
  p_campaign_id: r.campaign_id, p_activity_date: r.activity_date, p_impressions: int(r.impressions) ?? 0, p_clicks: int(r.clicks) ?? 0,
  p_reported_reach: int(r.reported_reach) ?? 0, p_landing_page_sessions: int(r.landing_page_sessions) ?? 0,
  p_registration_starts: int(r.registration_starts) ?? 0, p_marketing_spend_inr: int(r.marketing_spend_inr) ?? 0,
});
export const addStatusVersion = (registrationId, status, effectiveAtIso) =>
  rpc('rpc_add_status', { p_registration_id: registrationId, p_status: status, p_effective_at: effectiveAtIso });
export const addCheckin = ({ personId, walkInName, occurredAtIso, result, verification, source }) => rpc('rpc_add_checkin', {
  p_person_id: personId || null, p_walkin_name: walkInName || null, p_occurred_at: occurredAtIso,
  p_result: result, p_verification: verification, p_source: source,
});
export const updateTarget = (t) => rpc('rpc_update_target', {
  p_target_id: t.target_id, p_identified_goal: int(t.identified_goal), p_registration_goal: int(t.registration_goal),
  p_visitors_goal: int(t.visitors_goal), p_budget_inr: int(t.budget_inr),
});
export const updateSetting = (key, value) => rpc('rpc_update_setting', { p_key: key, p_value: Number(value) });
export const saveBetReading = (betId, reading, sample, date) => rpc('rpc_save_bet_reading', {
  p_bet_id: betId, p_reading: reading === '' || reading == null ? null : Number(reading),
  p_sample_size: int(sample), p_reading_date: date || null,
});
export const resetDemo = () => rpc('reset_demo', {});
