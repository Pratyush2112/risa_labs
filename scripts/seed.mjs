// Loads the supplied dataset into raw_* staging tables (duplicates included), loads the simulated
// management seed, then runs ingest() to build the normalized, foreign-keyed core tables.
// Usage: npm run seed   (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env)
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
const pick = (rows, cols) => rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));

// ---------- Simulated management seed (labelled as simulated in the app) ----------
const ALLOCATIONS = [
  ['C01', 45000], ['C02', 100000], ['C03', 62000], ['C04', 33000], ['C05', 20000], ['C06', 16000], ['C07', 18000],
].map(([campaign_id, allocated_budget_inr]) => ({ campaign_id, allocated_budget_inr }));

const TASKS = [
  ['Weekly opt-out review for Paid Social', 'Check opt-outs per identified person; pause audiences above 5%.', 'C02', 'T04', '2025-03-07', 'high', 'done'],
  ['Move ₹10K from Paid Social to College Partnerships after the revised plan', 'Follows the 15 March target revision.', 'C04', 'T03', '2025-03-17', 'high', 'done'],
  ['Sign 10 more college clubs for group registrations', 'Group passes for 10+; club leaderboard.', 'C04', 'T03', '2025-03-25', 'high', 'in_progress'],
  ['Pause creator posts with no registrations in the last 7 days', 'Waiting for creator contract terms.', 'C03', 'T05', '2025-03-20', 'medium', 'blocked'],
  ['Send referral reminder to confirmed registrants', 'Two-sided reward given at check-in.', 'C05', 'T06', '2025-03-28', 'medium', 'todo'],
  ['Send D-3 "I\'m coming" reconfirmation to confirmed registrants', 'Feeds the final attendance forecast.', null, 'T05', '2025-04-09', 'high', 'todo'],
  ['Audit manual check-in process for duplicate entries', 'Manual records can overlap scanner records.', null, 'T03', '2025-04-11', 'medium', 'todo'],
  ['Post-event: compare show rate by campaign and share learnings', 'Use verified check-ins only.', null, 'T04', '2025-04-18', 'low', 'todo'],
].map(([title, description, campaign_id, owner_id, due_date, priority, status], i) => ({ seed_id: i + 1, title, description, campaign_id, owner_id, due_date, priority, status }));

const BETS = [
  { bet_id: 'b1', rank: 1, name: 'Club Squads', concept: 'College clubs bring groups of 10+ on a group pass; top clubs get a stage slot or stall.', owner_id: 'T03', kpi_name: 'Registrations per signed club', unit: 'number', plan_value: 20.3, scale_at: 22.3, continue_from: 18.2, stop_below: 12, min_sample: 10, read_by: 'W-9', stop_destination: 'Freeze new club signings; move unspent budget to Bring-a-Friend.', latest_reading: 23.5, sample_size: 12, reading_date: '2025-02-09' },
  { bet_id: 'b2', rank: 2, name: 'Bring-a-Friend', concept: 'Two-sided referral; fast-track entry and sponsor merch given only at check-in.', owner_id: 'T06', kpi_name: 'Referral registrations per 100 registrants', unit: 'number', plan_value: 18.2, scale_at: 20, continue_from: 16.4, stop_below: 12.5, min_sample: 500, read_by: 'W-7', stop_destination: 'Drop the reward, keep share links; move budget to Club Squads.', latest_reading: 14.1, sample_size: 620, reading_date: '2025-02-23' },
  { bet_id: 'b3', rank: 3, name: 'Ambassadors 2.0', concept: 'Stipend plus a fee per verified attendee instead of per sign-up.', owner_id: 'T03', kpi_name: 'Confirmed registrations per ambassador per week, new ÷ old pay', unit: 'ratio', plan_value: 1.0, scale_at: 1.2, continue_from: 0.9, stop_below: 0.7, min_sample: 20, read_by: 'W-9', stop_destination: 'Revert to the old pay model; release ₹21K to Bets 1–2.', latest_reading: null, sample_size: null, reading_date: null },
  { bet_id: 'b4', rank: 4, name: 'Show-Up Engine', concept: 'Reminders at D-7 and D-1, D-3 reconfirmation, wallet pass, plan-my-day schedule.', owner_id: 'T05', kpi_name: 'Intent-action gap vs 10% holdout (points), then D-3 reconfirmation gap', unit: 'points', plan_value: 5, scale_at: 5.5, continue_from: 4.5, stop_below: 1.5, min_sample: 200, read_by: 'W-3 / D-3', stop_destination: 'Stop paid messaging; move budget to Warm-Lead Retargeting.', latest_reading: null, sample_size: null, reading_date: null },
  { bet_id: 'b5', rank: 5, name: 'Warm-Lead Retargeting', concept: 'Re-engage people who showed interest but never registered.', owner_id: 'T04', kpi_name: 'Registration rate of the lead list (%)', unit: 'pct', plan_value: 25, scale_at: 27.5, continue_from: 22.5, stop_below: 12, min_sample: 300, read_by: 'W-4', stop_destination: 'Stop ads; move budget to the Show-Up Engine.', latest_reading: null, sample_size: null, reading_date: null },
];

const SETTINGS = [
  ['confirmed_show_rate', 0.77, 'Expected show rate of confirmed registrants', 'assumption', '2025 actual: 1,925 of 2,500 (77%). Used only for the pre-event projection.', 0.3, 1],
  ['expected_walkins', 125, 'Expected walk-ins without a registration', 'assumption', '2025 actual: 125.', 0, 2000],
  ['scale_ratio', 0.8, 'Scale if cost per outcome ≤ this × blended', 'threshold', 'Outcome = confirmed registration before the event, verified attendee after.', 0.1, 1],
  ['change_ratio', 1.2, 'Change if cost per outcome ≥ this × blended', 'threshold', null, 1, 3],
  ['stop_ratio', 1.8, 'Stop if cost per outcome ≥ this × blended', 'threshold', null, 1.2, 5],
  ['scale_min_show_rate', 0.75, 'Minimum show rate to scale (after the event)', 'threshold', null, 0.3, 1],
  ['min_show_rate', 0.65, 'Change if show rate is below', 'threshold', null, 0.2, 1],
  ['optout_change', 0.05, 'Change if opt-outs per identified person ≥', 'threshold', null, 0.005, 0.5],
  ['optout_stop', 0.08, 'Stop if opt-outs per identified person ≥', 'threshold', null, 0.01, 0.5],
  ['min_outcomes', 30, 'Minimum outcomes before judging a campaign', 'threshold', 'Below this the app says "Insufficient data".', 1, 1000],
  ['pace_alert', 0.9, 'Alert if actual is below this share of straight-line target pace', 'threshold', null, 0.5, 1],
].map(([key, value, label, kind, note, min_value, max_value]) => ({ key, value, label, kind, note, min_value, max_value }));

// ---------- helpers ----------
async function clear(table, col) {
  const { error } = await db.from(table).delete().not(col, 'is', null);
  if (error) throw new Error(`${table} clear: ${error.message}`);
}
async function insert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
  console.log(`  ${table.padEnd(26)} ${rows.length}`);
}

const RAW = [
  ['raw_event', 'event', ['event_name', 'history_start', 'history_end', 'event_starts_at', 'event_ends_at', 'timezone', 'currency', 'fictional']],
  ['raw_targets', 'targets', ['target_version', 'effective_at', 'identified_goal', 'registration_goal', 'visitors_goal', 'budget_inr']],
  ['raw_campaigns', 'campaigns', ['campaign_id', 'campaign_name', 'channel', 'target_audience', 'objective', 'owner_name', 'owner_id', 'created_at', 'planned_start_at', 'planned_end_at']],
  ['raw_daily_marketing', 'daily_marketing', ['activity_id', 'campaign_id', 'campaign_name', 'owner_name', 'owner_id', 'activity_date', 'impressions', 'clicks', 'reported_reach', 'landing_page_sessions', 'registration_starts', 'marketing_spend_inr', 'platform']],
  ['raw_people', 'people', ['person_id', 'person_name', 'person_type', 'first_seen_at', 'first_touch_source', 'first_campaign_id', 'first_campaign_name', 'owner_name', 'owner_id']],
  ['raw_interactions', 'interactions', ['interaction_id', 'person_id', 'person_name', 'campaign_id', 'campaign_name', 'owner_name', 'owner_id', 'occurred_at', 'event_type', 'detail']],
  ['raw_registrations', 'registrations', ['registration_id', 'person_id', 'person_name', 'campaign_id', 'campaign_name', 'owner_name', 'owner_id', 'registered_at']],
  ['raw_registration_history', 'registration_history', ['history_id', 'registration_id', 'person_id', 'person_name', 'campaign_id', 'campaign_name', 'owner_name', 'owner_id', 'effective_at', 'status']],
  ['raw_checkins', 'checkins', ['event_id', 'person_id', 'person_name', 'registration_id', 'campaign_id', 'campaign_name', 'owner_name', 'owner_id', 'occurred_at', 'result', 'verification', 'source']],
];

async function main() {
  console.log('Loading raw files (duplicates kept)…');
  for (const [table, file, cols] of RAW) {
    await clear(table, 'raw_row_id');
    await insert(table, pick(load(file), cols));
  }
  console.log('Loading simulated management seed…');
  for (const [t, c] of [['seed_allocations', 'campaign_id'], ['seed_tasks', 'seed_id'], ['seed_bets', 'bet_id'], ['seed_settings', 'key']]) await clear(t, c);
  await insert('seed_allocations', ALLOCATIONS);
  await insert('seed_tasks', TASKS);
  await insert('seed_bets', BETS);
  await insert('seed_settings', SETTINGS);

  console.log('Building core tables (ingest)…');
  const { data: report, error } = await db.rpc('ingest');
  if (error) throw new Error(`ingest: ${error.message}`);
  console.table(report);

  const { data: snap, error: e2 } = await db.rpc('growth_snapshot', { p_as_of: null });
  if (e2) throw new Error(`growth_snapshot: ${e2.message}`);
  const t = snap.totals;
  const ok = t.identified === 3625 && t.registered === 2800 && t.visitors === 2050 && t.spend === 274000;
  console.log(`Check: ${t.identified} / ${t.registered} / ${t.visitors} / ${t.spend}  (expected 3625 / 2800 / 2050 / 274000) → ${ok ? 'PASS' : 'MISMATCH'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
