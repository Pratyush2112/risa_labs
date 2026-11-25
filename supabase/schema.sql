-- =====================================================================
-- CampusFest Growth Center — database (Supabase / PostgreSQL 15+)
-- Run once in Supabase → SQL Editor. Safe to re-run (drops and recreates).
--
-- Layers
--   raw_*      exact copies of the supplied files (duplicates included); server-only
--   seed_*     simulated management seed (budget split, tasks, bets, settings); server-only
--   core       normalized tables with primary and foreign keys, built by ingest()
--   api        read: SELECT on core tables + analytics RPCs
--              write: SECURITY DEFINER RPCs with validated, typed parameters only
-- No function builds SQL from user text; every value is a bound parameter.
-- =====================================================================

create extension if not exists pgcrypto;

-- Clean re-run
drop function if exists ingest() cascade;
drop function if exists reset_demo() cascade;
drop table if exists activity_log, ingest_runs, tasks, bets, settings, daily_marketing, checkins, interactions,
  registration_status_history, registrations, people, targets, campaigns, owners, event cascade;
drop table if exists raw_event, raw_targets, raw_campaigns, raw_daily_marketing, raw_people, raw_interactions,
  raw_registrations, raw_registration_history, raw_checkins, seed_allocations, seed_tasks, seed_bets, seed_settings cascade;

-- ---------------------------------------------------------------------
-- 1. Raw staging (mirrors the source columns; no constraints on purpose)
-- ---------------------------------------------------------------------
create table raw_event (raw_row_id bigint generated always as identity primary key, event_name text, history_start date, history_end date, event_starts_at timestamptz, event_ends_at timestamptz, timezone text, currency text, fictional boolean);
create table raw_targets (raw_row_id bigint generated always as identity primary key, target_version text, effective_at timestamptz, identified_goal int, registration_goal int, visitors_goal int, budget_inr int);
create table raw_campaigns (raw_row_id bigint generated always as identity primary key, campaign_id text, campaign_name text, channel text, target_audience text, objective text, owner_name text, owner_id text, created_at timestamptz, planned_start_at timestamptz, planned_end_at timestamptz);
create table raw_daily_marketing (raw_row_id bigint generated always as identity primary key, activity_id text, campaign_id text, campaign_name text, owner_name text, owner_id text, activity_date date, impressions int, clicks int, reported_reach int, landing_page_sessions int, registration_starts int, marketing_spend_inr int, platform text);
create table raw_people (raw_row_id bigint generated always as identity primary key, person_id text, person_name text, person_type text, first_seen_at timestamptz, first_touch_source text, first_campaign_id text, first_campaign_name text, owner_name text, owner_id text);
create table raw_interactions (raw_row_id bigint generated always as identity primary key, interaction_id text, person_id text, person_name text, campaign_id text, campaign_name text, owner_name text, owner_id text, occurred_at timestamptz, event_type text, detail text);
create table raw_registrations (raw_row_id bigint generated always as identity primary key, registration_id text, person_id text, person_name text, campaign_id text, campaign_name text, owner_name text, owner_id text, registered_at timestamptz);
create table raw_registration_history (raw_row_id bigint generated always as identity primary key, history_id text, registration_id text, person_id text, person_name text, campaign_id text, campaign_name text, owner_name text, owner_id text, effective_at timestamptz, status text);
create table raw_checkins (raw_row_id bigint generated always as identity primary key, event_id text, person_id text, person_name text, registration_id text, campaign_id text, campaign_name text, owner_name text, owner_id text, occurred_at timestamptz, result text, verification text, source text);

-- Simulated management seed
create table seed_allocations (campaign_id text primary key, allocated_budget_inr int not null check (allocated_budget_inr >= 0));
create table seed_tasks (seed_id int primary key, title text not null, description text, campaign_id text, owner_id text, due_date date, priority text, status text);
create table seed_bets (bet_id text primary key, rank int, name text, concept text, owner_id text, kpi_name text, unit text, plan_value numeric, scale_at numeric, continue_from numeric, stop_below numeric, min_sample int, read_by text, stop_destination text, latest_reading numeric, sample_size int, reading_date date);
create table seed_settings (key text primary key, value numeric, label text, kind text, note text, min_value numeric, max_value numeric);

-- ---------------------------------------------------------------------
-- 2. Core normalized model
-- ---------------------------------------------------------------------
create table event (
  id smallint primary key default 1 check (id = 1),
  event_name text not null,
  history_start date not null,
  history_end date not null check (history_end >= history_start),
  event_starts_at timestamptz not null,
  event_ends_at timestamptz not null check (event_ends_at > event_starts_at),
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR'
);

create table owners (
  owner_id text primary key check (owner_id ~ '^[A-Z][0-9]{2,3}$'),
  owner_name text not null unique
);

create table campaigns (
  campaign_id text primary key check (campaign_id ~ '^C[0-9]{2,3}$'),
  campaign_name text not null unique check (length(campaign_name) between 2 and 80),
  channel text,
  target_audience text,
  objective text,
  owner_id text references owners(owner_id) on update cascade,
  created_at timestamptz not null default now(),
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  allocated_budget_inr int not null default 0 check (allocated_budget_inr >= 0),
  status text not null default 'active' check (status in ('active','scale','change','paused','stopped')),
  decision_note text check (length(decision_note) <= 500),
  updated_at timestamptz not null default now()
);

create table targets (
  target_id bigint generated always as identity primary key,
  target_version text not null unique,
  effective_at timestamptz not null unique,
  identified_goal int not null check (identified_goal >= 0),
  registration_goal int not null check (registration_goal >= 0),
  visitors_goal int not null check (visitors_goal >= 0),
  budget_inr int not null check (budget_inr >= 0)
);

create table people (
  person_id text primary key,
  person_name text not null,
  person_type text not null check (person_type in ('external','internal','staff','test')),
  first_seen_at timestamptz not null,
  first_touch_source text not null check (first_touch_source in ('campaign','walk_in','internal_registration','event_access')),
  first_campaign_id text references campaigns(campaign_id) on update cascade,
  owner_id text references owners(owner_id) on update cascade
);

create table registrations (
  registration_id text primary key,
  person_id text not null references people(person_id) on update cascade on delete cascade,
  campaign_id text references campaigns(campaign_id) on update cascade,
  registered_at timestamptz not null
);

create table registration_status_history (
  history_id text primary key,
  registration_id text not null references registrations(registration_id) on update cascade on delete cascade,
  status text not null check (status in ('interested','confirmed','cancelled','waitlisted')),
  effective_at timestamptz not null
);

create table interactions (
  interaction_id text primary key,
  person_id text not null references people(person_id) on update cascade on delete cascade,
  campaign_id text references campaigns(campaign_id) on update cascade,
  occurred_at timestamptz not null,
  event_type text not null check (event_type in ('page_visit','brochure_download','registration_start','event_question_submitted','nurture_email_sent','nurture_email_opened','nurture_email_clicked','opted_out')),
  detail text
);

create table checkins (
  event_id text primary key,
  person_id text not null references people(person_id) on update cascade on delete cascade,
  registration_id text references registrations(registration_id) on update cascade on delete set null,
  occurred_at timestamptz not null,
  result text not null check (result in ('admitted','denied','pending')),
  verification text not null check (verification in ('verified','unverified')),
  source text not null check (source in ('scanner','manual'))
);

create table daily_marketing (
  activity_id text primary key,
  campaign_id text not null references campaigns(campaign_id) on update cascade on delete cascade,
  activity_date date not null,
  impressions int not null default 0 check (impressions >= 0),
  clicks int not null default 0 check (clicks >= 0),
  reported_reach int not null default 0 check (reported_reach >= 0),
  landing_page_sessions int not null default 0 check (landing_page_sessions >= 0),
  registration_starts int not null default 0 check (registration_starts >= 0),
  marketing_spend_inr int not null default 0,
  platform text,
  unique (campaign_id, activity_date)
);

-- Management
create table tasks (
  task_id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 160),
  description text check (length(description) <= 2000),
  campaign_id text references campaigns(campaign_id) on update cascade on delete set null,
  owner_id text references owners(owner_id) on update cascade on delete set null,
  due_date date,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  source text not null default 'manual' check (source in ('manual','ai','seed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bets (
  bet_id text primary key check (bet_id ~ '^b[0-9]{1,2}$'),
  rank int not null unique,
  name text not null,
  concept text,
  owner_id text references owners(owner_id) on update cascade on delete set null,
  kpi_name text not null,
  unit text not null check (unit in ('number','ratio','pct','points')),
  plan_value numeric,
  scale_at numeric not null,
  continue_from numeric not null,
  stop_below numeric not null,
  min_sample int not null default 0 check (min_sample >= 0),
  read_by text,
  stop_destination text,
  latest_reading numeric,
  sample_size int check (sample_size >= 0),
  reading_date date,
  updated_at timestamptz not null default now(),
  check (stop_below <= continue_from and continue_from <= scale_at)
);

create table settings (
  key text primary key check (key ~ '^[a-z_]{3,40}$'),
  value numeric not null,
  label text not null,
  kind text not null check (kind in ('assumption','threshold')),
  note text,
  min_value numeric not null,
  max_value numeric not null,
  check (value between min_value and max_value)
);

create table activity_log (
  log_id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null check (actor in ('user','ai_confirmed','system')),
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);

create table ingest_runs (
  run_id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  raw_rows int not null,
  distinct_ids int not null,
  loaded_rows int not null,
  duplicates_removed int not null,
  orphans_skipped int not null
);

-- Indexes for the joins and as-of filters
create index on campaigns(owner_id);
create index on people(first_campaign_id);
create index on people(person_type, first_seen_at);
create index on registrations(person_id);
create index on registrations(campaign_id, registered_at);
create index on registration_status_history(registration_id, effective_at desc);
create index on interactions(person_id, event_type);
create index on interactions(campaign_id, occurred_at);
create index on checkins(person_id, occurred_at);
create index on checkins(registration_id);
create index on daily_marketing(activity_date);
create index on tasks(campaign_id);
create index on tasks(owner_id);
create index on activity_log(at desc);

-- ---------------------------------------------------------------------
-- 3. Ingest: raw → core (de-duplicate by source ID, skip orphans, report)
-- ---------------------------------------------------------------------
create or replace function ingest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare report jsonb;
begin
    truncate table tasks, bets, settings, daily_marketing, checkins, interactions, registration_status_history,
                 registrations, people, targets, campaigns, owners, event, ingest_runs restart identity cascade;

  insert into event (event_name, history_start, history_end, event_starts_at, event_ends_at, timezone, currency)
  select event_name, history_start, history_end, event_starts_at, event_ends_at, coalesce(timezone, 'Asia/Kolkata'), coalesce(currency, 'INR')
  from raw_event order by raw_row_id limit 1;

  insert into owners (owner_id, owner_name)
  select distinct on (owner_id) owner_id, owner_name
  from (
    select owner_id, owner_name from raw_campaigns union all
    select owner_id, owner_name from raw_people union all
    select owner_id, owner_name from raw_daily_marketing
  ) s
  where owner_id is not null and owner_name is not null
  order by owner_id, owner_name;

  insert into campaigns (campaign_id, campaign_name, channel, target_audience, objective, owner_id, created_at, planned_start_at, planned_end_at, allocated_budget_inr)
  select distinct on (c.campaign_id) c.campaign_id, c.campaign_name, c.channel, c.target_audience, c.objective, c.owner_id,
         coalesce(c.created_at, now()), c.planned_start_at, c.planned_end_at, coalesce(a.allocated_budget_inr, 0)
  from raw_campaigns c left join seed_allocations a on a.campaign_id = c.campaign_id
  order by c.campaign_id, c.raw_row_id;

  insert into targets (target_version, effective_at, identified_goal, registration_goal, visitors_goal, budget_inr)
  select distinct on (effective_at) target_version, effective_at, identified_goal, registration_goal, visitors_goal, budget_inr
  from raw_targets order by effective_at, raw_row_id;

  insert into people (person_id, person_name, person_type, first_seen_at, first_touch_source, first_campaign_id, owner_id)
  select distinct on (r.person_id) r.person_id, r.person_name, r.person_type, r.first_seen_at, r.first_touch_source,
         r.first_campaign_id, r.owner_id
  from raw_people r
  where (r.first_campaign_id is null or exists (select 1 from campaigns c where c.campaign_id = r.first_campaign_id))
  order by r.person_id, r.raw_row_id;

  insert into registrations (registration_id, person_id, campaign_id, registered_at)
  select distinct on (r.registration_id) r.registration_id, r.person_id, r.campaign_id, r.registered_at
  from raw_registrations r
  where exists (select 1 from people p where p.person_id = r.person_id)
    and (r.campaign_id is null or exists (select 1 from campaigns c where c.campaign_id = r.campaign_id))
  order by r.registration_id, r.raw_row_id;

  insert into registration_status_history (history_id, registration_id, status, effective_at)
  select distinct on (h.history_id) h.history_id, h.registration_id, h.status, h.effective_at
  from raw_registration_history h
  where exists (select 1 from registrations r where r.registration_id = h.registration_id)
  order by h.history_id, h.raw_row_id;

  insert into interactions (interaction_id, person_id, campaign_id, occurred_at, event_type, detail)
  select distinct on (i.interaction_id) i.interaction_id, i.person_id, i.campaign_id, i.occurred_at, i.event_type, i.detail
  from raw_interactions i
  where exists (select 1 from people p where p.person_id = i.person_id)
    and (i.campaign_id is null or exists (select 1 from campaigns c where c.campaign_id = i.campaign_id))
  order by i.interaction_id, i.raw_row_id;

  insert into checkins (event_id, person_id, registration_id, occurred_at, result, verification, source)
  select distinct on (k.event_id) k.event_id, k.person_id, k.registration_id, k.occurred_at, k.result, k.verification, k.source
  from raw_checkins k
  where exists (select 1 from people p where p.person_id = k.person_id)
    and (k.registration_id is null or exists (select 1 from registrations r where r.registration_id = k.registration_id))
  order by k.event_id, k.raw_row_id;

  insert into daily_marketing (activity_id, campaign_id, activity_date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr, platform)
  select distinct on (d.activity_id) d.activity_id, d.campaign_id, d.activity_date, d.impressions, d.clicks, d.reported_reach,
         d.landing_page_sessions, d.registration_starts, d.marketing_spend_inr, d.platform
  from raw_daily_marketing d
  where exists (select 1 from campaigns c where c.campaign_id = d.campaign_id)
  order by d.activity_id, d.raw_row_id;

  -- Management seed (simulated)
  insert into settings (key, value, label, kind, note, min_value, max_value)
  select key, value, label, kind, note, min_value, max_value from seed_settings;
  insert into bets (bet_id, rank, name, concept, owner_id, kpi_name, unit, plan_value, scale_at, continue_from, stop_below, min_sample, read_by, stop_destination, latest_reading, sample_size, reading_date)
  select bet_id, rank, name, concept, owner_id, kpi_name, unit, plan_value, scale_at, continue_from, stop_below, min_sample, read_by, stop_destination, latest_reading, sample_size, reading_date from seed_bets;
  insert into tasks (title, description, campaign_id, owner_id, due_date, priority, status, source)
  select title, description, campaign_id, owner_id, due_date, priority, status, 'seed' from seed_tasks order by seed_id;

  -- Data-quality report
  insert into ingest_runs (table_name, raw_rows, distinct_ids, loaded_rows, duplicates_removed, orphans_skipped)
  select t, raw_n, ids_n, loaded_n, raw_n - ids_n, ids_n - loaded_n from (
    select 'campaigns' t, (select count(*) from raw_campaigns)::int raw_n, (select count(distinct campaign_id) from raw_campaigns)::int ids_n, (select count(*) from campaigns)::int loaded_n
    union all select 'people', (select count(*) from raw_people), (select count(distinct person_id) from raw_people), (select count(*) from people)
    union all select 'registrations', (select count(*) from raw_registrations), (select count(distinct registration_id) from raw_registrations), (select count(*) from registrations)
    union all select 'registration_status_history', (select count(*) from raw_registration_history), (select count(distinct history_id) from raw_registration_history), (select count(*) from registration_status_history)
    union all select 'interactions', (select count(*) from raw_interactions), (select count(distinct interaction_id) from raw_interactions), (select count(*) from interactions)
    union all select 'checkins', (select count(*) from raw_checkins), (select count(distinct event_id) from raw_checkins), (select count(*) from checkins)
    union all select 'daily_marketing', (select count(*) from raw_daily_marketing), (select count(distinct activity_id) from raw_daily_marketing), (select count(*) from daily_marketing)
  ) q;

  select coalesce(jsonb_agg(to_jsonb(r) - 'run_id' - 'at' order by r.table_name), '[]'::jsonb) into report from ingest_runs r;
  return report;
end $$;

create or replace function reset_demo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare report jsonb;
begin
  report := ingest();
  insert into activity_log (actor, action, entity_type, details) values ('system', 'reset_to_original_data', 'dataset', jsonb_build_object('ingest', report));
  return report;
end $$;

-- ---------------------------------------------------------------------
-- 4. Analytics (read-only, parameterized)
--    A selected date means the end of that day in Asia/Kolkata.
-- ---------------------------------------------------------------------
create or replace function as_of_cutoff(p_as_of date)
returns timestamptz language sql immutable as $$
  select ((p_as_of + 1)::timestamp at time zone 'Asia/Kolkata')
$$;

create or replace function growth_snapshot(p_as_of date default null)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare v_as_of date; v_cut timestamptz; e event%rowtype; out jsonb;
begin
  select * into e from event where id = 1;
  v_as_of := least(greatest(coalesce(p_as_of, e.history_end), e.history_start), e.history_end);
  v_cut := as_of_cutoff(v_as_of);

  with ext as (
    select person_id, first_campaign_id, first_touch_source from people
    where person_type = 'external' and first_seen_at < v_cut
  ),
  regp as (
    select distinct on (r.person_id) r.person_id, r.registration_id, r.campaign_id
    from registrations r join people p on p.person_id = r.person_id and p.person_type = 'external'
    where r.registered_at < v_cut
    order by r.person_id, r.registered_at, r.registration_id
  ),
  st as (
    select distinct on (h.registration_id) h.registration_id, h.status
    from registration_status_history h where h.effective_at < v_cut
    order by h.registration_id, h.effective_at desc, h.history_id desc
  ),
  regs as (select regp.*, coalesce(st.status, 'interested') as status from regp left join st using (registration_id)),
  vis as (
    select distinct k.person_id from checkins k join people p on p.person_id = k.person_id and p.person_type = 'external'
    where k.result = 'admitted' and k.verification = 'verified' and k.occurred_at < v_cut
  ),
  visc as (select vis.person_id, regp.campaign_id from vis left join regp using (person_id)),
  sp as (
    select campaign_id, sum(marketing_spend_inr) spend, sum(impressions) impressions, sum(clicks) clicks,
           sum(landing_page_sessions) sessions, sum(registration_starts) reg_starts
    from daily_marketing where activity_date <= v_as_of group by campaign_id
  ),
  ia as (
    select i.campaign_id,
      count(distinct i.person_id) filter (where i.event_type = 'brochure_download') brochure_people,
      count(distinct i.person_id) filter (where i.event_type = 'event_question_submitted') question_people,
      count(distinct i.person_id) filter (where i.event_type = 'nurture_email_clicked') email_click_people,
      count(distinct i.person_id) filter (where i.event_type = 'opted_out') optout_people
    from interactions i join people p on p.person_id = i.person_id and p.person_type = 'external'
    where i.occurred_at < v_cut group by i.campaign_id
  ),
  camp as (
    select c.campaign_id, c.campaign_name, c.channel, c.owner_id, o.owner_name, c.status, c.allocated_budget_inr,
           c.decision_note, c.target_audience,
           coalesce(sp.spend, 0) spend, coalesce(sp.impressions, 0) impressions, coalesce(sp.clicks, 0) clicks,
           coalesce(sp.sessions, 0) sessions, coalesce(sp.reg_starts, 0) reg_starts,
           (select count(*) from ext where ext.first_campaign_id = c.campaign_id) identified,
           (select count(*) from regs where regs.campaign_id = c.campaign_id) registered,
           (select count(*) from regs where regs.campaign_id = c.campaign_id and regs.status = 'confirmed') confirmed,
           (select count(*) from regs where regs.campaign_id = c.campaign_id and regs.status = 'interested') interested,
           (select count(*) from regs where regs.campaign_id = c.campaign_id and regs.status = 'cancelled') cancelled,
           (select count(*) from regs where regs.campaign_id = c.campaign_id and regs.status = 'waitlisted') waitlisted,
           (select count(*) from visc where visc.campaign_id = c.campaign_id) attended,
           coalesce(ia.brochure_people, 0) brochure_people, coalesce(ia.question_people, 0) question_people,
           coalesce(ia.email_click_people, 0) email_click_people, coalesce(ia.optout_people, 0) optout_people
    from campaigns c
    left join owners o on o.owner_id = c.owner_id
    left join sp on sp.campaign_id = c.campaign_id
    left join ia on ia.campaign_id = c.campaign_id
  ),
  tg as (
    select target_version, effective_at, identified_goal, registration_goal, visitors_goal, budget_inr
    from targets where effective_at < v_cut order by effective_at desc limit 1
  )
  select jsonb_build_object(
    'as_of', v_as_of, 'history_start', e.history_start, 'history_end', e.history_end,
    'event_starts_at', e.event_starts_at, 'event_ends_at', e.event_ends_at, 'event_started', e.event_starts_at < v_cut,
    'targets', (select to_jsonb(tg) from tg),
    'totals', jsonb_build_object(
      'identified', (select count(*) from ext),
      'identified_walk_in', (select count(*) from ext where first_touch_source = 'walk_in'),
      'registered', (select count(*) from regs),
      'confirmed', (select count(*) from regs where status = 'confirmed'),
      'interested', (select count(*) from regs where status = 'interested'),
      'cancelled', (select count(*) from regs where status = 'cancelled'),
      'waitlisted', (select count(*) from regs where status = 'waitlisted'),
      'visitors', (select count(*) from vis),
      'visitors_registered', (select count(*) from visc where campaign_id is not null),
      'visitors_unattributed', (select count(*) from visc where campaign_id is null),
      'spend', (select coalesce(sum(marketing_spend_inr), 0) from daily_marketing where activity_date <= v_as_of),
      'allocated_budget', (select coalesce(sum(allocated_budget_inr), 0) from campaigns)
    ),
    'campaigns', (select coalesce(jsonb_agg(to_jsonb(camp) order by camp.campaign_id), '[]'::jsonb) from camp),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from settings)
  ) into out;
  return out;
end $$;

create or replace function growth_daily(p_as_of date default null, p_campaign_id text default null)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare v_as_of date; e event%rowtype; res jsonb;
begin
  select * into e from event where id = 1;
  v_as_of := least(greatest(coalesce(p_as_of, e.history_end), e.history_start), e.history_end);

  with d as (select generate_series(e.history_start, v_as_of, interval '1 day')::date dt),
  sp as (
    select activity_date dt, sum(marketing_spend_inr) spend, sum(landing_page_sessions) sessions
    from daily_marketing where p_campaign_id is null or campaign_id = p_campaign_id group by 1
  ),
  idn as (
    select (first_seen_at at time zone 'Asia/Kolkata')::date dt, count(*) n from people
    where person_type = 'external' and (p_campaign_id is null or first_campaign_id = p_campaign_id) group by 1
  ),
  rg as (
    select (r.registered_at at time zone 'Asia/Kolkata')::date dt, count(distinct r.person_id) n
    from registrations r join people p on p.person_id = r.person_id and p.person_type = 'external'
    where p_campaign_id is null or r.campaign_id = p_campaign_id group by 1
  ),
  vz as (
    select dt, count(*) n from (
      select k.person_id, min((k.occurred_at at time zone 'Asia/Kolkata')::date) dt
      from checkins k
      join people p on p.person_id = k.person_id and p.person_type = 'external'
      left join registrations r on r.registration_id = k.registration_id
      where k.result = 'admitted' and k.verification = 'verified' and (p_campaign_id is null or r.campaign_id = p_campaign_id)
      group by k.person_id
    ) x group by dt
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', d.dt, 'spend', coalesce(sp.spend, 0), 'sessions', coalesce(sp.sessions, 0),
           'identified', coalesce(idn.n, 0), 'registrations', coalesce(rg.n, 0), 'visitors', coalesce(vz.n, 0)) order by d.dt), '[]'::jsonb)
  into res
  from d left join sp using (dt) left join idn using (dt) left join rg using (dt) left join vz using (dt);
  return res;
end $$;

-- Record-level datasets for the AI query engine. The dataset name selects one of a
-- fixed set of static queries (no dynamic SQL); the date is a bound parameter.
create or replace function dataset_rows(p_dataset text, p_as_of date default null)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare v_as_of date; v_cut timestamptz; e event%rowtype; v_event_date date; res jsonb;
begin
  select * into e from event where id = 1;
  v_as_of := least(greatest(coalesce(p_as_of, e.history_end), e.history_start), e.history_end);
  v_cut := as_of_cutoff(v_as_of);
  v_event_date := (e.event_starts_at at time zone 'Asia/Kolkata')::date;

  if p_dataset = 'registrations' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select r.registration_id, r.person_id, p.person_type, r.campaign_id, c.campaign_name,
             (r.registered_at at time zone 'Asia/Kolkata')::date as registered_date,
             date_trunc('week', (r.registered_at at time zone 'Asia/Kolkata'))::date as registered_week,
             v_event_date - (r.registered_at at time zone 'Asia/Kolkata')::date as days_before_event,
             coalesce((select h.status from registration_status_history h where h.registration_id = r.registration_id and h.effective_at < v_cut
                       order by h.effective_at desc, h.history_id desc limit 1), 'interested') as latest_status,
             exists (select 1 from checkins k where k.person_id = r.person_id and k.result = 'admitted' and k.verification = 'verified' and k.occurred_at < v_cut) as attended,
             exists (select 1 from interactions i where i.person_id = r.person_id and i.event_type = 'brochure_download' and i.occurred_at < v_cut) as downloaded_brochure,
             exists (select 1 from interactions i where i.person_id = r.person_id and i.event_type = 'event_question_submitted' and i.occurred_at < v_cut) as asked_question,
             exists (select 1 from interactions i where i.person_id = r.person_id and i.event_type = 'nurture_email_clicked' and i.occurred_at < v_cut) as clicked_email,
             exists (select 1 from interactions i where i.person_id = r.person_id and i.event_type = 'opted_out' and i.occurred_at < v_cut) as opted_out
      from registrations r join people p on p.person_id = r.person_id left join campaigns c on c.campaign_id = r.campaign_id
      where r.registered_at < v_cut
    ) x;
  elsif p_dataset = 'people' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select p.person_id, p.person_type, p.first_touch_source, p.first_campaign_id, c.campaign_name,
             (p.first_seen_at at time zone 'Asia/Kolkata')::date as first_seen_date,
             date_trunc('week', (p.first_seen_at at time zone 'Asia/Kolkata'))::date as first_seen_week,
             exists (select 1 from registrations r where r.person_id = p.person_id and r.registered_at < v_cut) as registered,
             exists (select 1 from checkins k where k.person_id = p.person_id and k.result = 'admitted' and k.verification = 'verified' and k.occurred_at < v_cut) as attended,
             exists (select 1 from interactions i where i.person_id = p.person_id and i.event_type = 'brochure_download' and i.occurred_at < v_cut) as downloaded_brochure,
             exists (select 1 from interactions i where i.person_id = p.person_id and i.event_type = 'opted_out' and i.occurred_at < v_cut) as opted_out
      from people p left join campaigns c on c.campaign_id = p.first_campaign_id
      where p.first_seen_at < v_cut
    ) x;
  elsif p_dataset = 'checkins' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select k.event_id, k.person_id, p.person_type, k.registration_id, r.campaign_id, c.campaign_name,
             (k.occurred_at at time zone 'Asia/Kolkata')::date as checkin_date,
             extract(hour from (k.occurred_at at time zone 'Asia/Kolkata'))::int as checkin_hour,
             ((k.occurred_at at time zone 'Asia/Kolkata')::date - v_event_date + 1) as event_day,
             k.result, k.verification, k.source,
             (k.result = 'admitted' and k.verification = 'verified') as is_verified_admission
      from checkins k join people p on p.person_id = k.person_id
      left join registrations r on r.registration_id = k.registration_id
      left join campaigns c on c.campaign_id = r.campaign_id
      where k.occurred_at < v_cut
    ) x;
  elsif p_dataset = 'interactions' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select i.interaction_id, i.person_id, p.person_type, i.campaign_id, c.campaign_name, i.event_type,
             (i.occurred_at at time zone 'Asia/Kolkata')::date as occurred_date,
             date_trunc('week', (i.occurred_at at time zone 'Asia/Kolkata'))::date as occurred_week
      from interactions i join people p on p.person_id = i.person_id left join campaigns c on c.campaign_id = i.campaign_id
      where i.occurred_at < v_cut
    ) x;
  elsif p_dataset = 'daily_marketing' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select d.activity_id, d.campaign_id, c.campaign_name, d.activity_date,
             date_trunc('week', d.activity_date)::date as activity_week,
             d.impressions, d.clicks, d.reported_reach, d.landing_page_sessions, d.registration_starts, d.marketing_spend_inr
      from daily_marketing d join campaigns c on c.campaign_id = d.campaign_id
      where d.activity_date <= v_as_of
    ) x;
  elsif p_dataset = 'status_history' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select h.history_id, h.registration_id, r.campaign_id, c.campaign_name, h.status,
             (h.effective_at at time zone 'Asia/Kolkata')::date as effective_date
      from registration_status_history h join registrations r on r.registration_id = h.registration_id
      left join campaigns c on c.campaign_id = r.campaign_id
      where h.effective_at < v_cut
    ) x;
  else
    raise exception 'Unknown dataset' using errcode = '22023';
  end if;
  return res;
end $$;

-- ---------------------------------------------------------------------
-- 5. Write API: validated SECURITY DEFINER functions (typed parameters only)
-- ---------------------------------------------------------------------
create or replace function _actor(p text) returns text language sql immutable as $$
  select case when p = 'ai_confirmed' then 'ai_confirmed' else 'user' end
$$;

create or replace function rpc_create_task(p_title text, p_description text, p_campaign_id text, p_owner_id text,
  p_due_date date, p_priority text, p_status text default 'todo', p_actor text default 'user')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into tasks (title, description, campaign_id, owner_id, due_date, priority, status, source)
  values (btrim(p_title), nullif(btrim(p_description), ''), nullif(p_campaign_id, ''), nullif(p_owner_id, ''), p_due_date,
          coalesce(p_priority, 'medium'), coalesce(p_status, 'todo'), case when _actor(p_actor) = 'ai_confirmed' then 'ai' else 'manual' end)
  returning task_id into v_id;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values (_actor(p_actor), 'task_created', 'task', v_id::text, jsonb_build_object('title', btrim(p_title), 'campaign_id', p_campaign_id, 'owner_id', p_owner_id, 'due_date', p_due_date));
  return v_id;
end $$;

create or replace function rpc_update_task(p_task_id uuid, p_title text, p_description text, p_campaign_id text, p_owner_id text,
  p_due_date date, p_priority text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update tasks set title = btrim(p_title), description = nullif(btrim(p_description), ''), campaign_id = nullif(p_campaign_id, ''),
    owner_id = nullif(p_owner_id, ''), due_date = p_due_date, priority = p_priority, status = p_status, updated_at = now()
  where task_id = p_task_id;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'task_updated', 'task', p_task_id::text, jsonb_build_object('title', p_title, 'status', p_status, 'priority', p_priority, 'due_date', p_due_date));
end $$;

create or replace function rpc_set_task_status(p_task_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  select status into v_old from tasks where task_id = p_task_id for update;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  update tasks set status = p_status, updated_at = now() where task_id = p_task_id;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'task_status_changed', 'task', p_task_id::text, jsonb_build_object('from', v_old, 'to', p_status));
end $$;

create or replace function rpc_delete_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_title text;
begin
  delete from tasks where task_id = p_task_id returning title into v_title;
  if not found then raise exception 'Task not found' using errcode = 'P0002'; end if;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'task_deleted', 'task', p_task_id::text, jsonb_build_object('title', v_title));
end $$;

create or replace function rpc_update_campaign(p_campaign_id text, p_status text, p_allocated_budget_inr int,
  p_owner_id text, p_decision_note text, p_actor text default 'user')
returns void language plpgsql security definer set search_path = public as $$
declare v_old campaigns%rowtype;
begin
  select * into v_old from campaigns where campaign_id = p_campaign_id for update;
  if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
  update campaigns set
    status = coalesce(p_status, status),
    allocated_budget_inr = coalesce(p_allocated_budget_inr, allocated_budget_inr),
    owner_id = coalesce(nullif(p_owner_id, ''), owner_id),
    decision_note = coalesce(p_decision_note, decision_note),
    updated_at = now()
  where campaign_id = p_campaign_id;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values (_actor(p_actor), 'campaign_updated', 'campaign', p_campaign_id, jsonb_build_object(
    'status', jsonb_build_array(v_old.status, coalesce(p_status, v_old.status)),
    'allocated_budget_inr', jsonb_build_array(v_old.allocated_budget_inr, coalesce(p_allocated_budget_inr, v_old.allocated_budget_inr)),
    'owner_id', jsonb_build_array(v_old.owner_id, coalesce(nullif(p_owner_id, ''), v_old.owner_id)),
    'decision_note', p_decision_note));
end $$;

create or replace function rpc_shift_budget(p_from text, p_to text, p_amount int, p_rationale text, p_actor text default 'user')
returns void language plpgsql security definer set search_path = public as $$
declare v_from int; v_to int;
begin
  if p_from = p_to then raise exception 'Choose two different campaigns' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive' using errcode = '22023'; end if;
  -- lock both rows in a stable order to avoid deadlocks
  perform 1 from campaigns where campaign_id in (p_from, p_to) order by campaign_id for update;
  select allocated_budget_inr into v_from from campaigns where campaign_id = p_from;
  select allocated_budget_inr into v_to from campaigns where campaign_id = p_to;
  if v_from is null or v_to is null then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
  if p_amount > v_from then raise exception 'Amount exceeds the source allocation of %', v_from using errcode = '22023'; end if;
  update campaigns set allocated_budget_inr = allocated_budget_inr - p_amount, updated_at = now() where campaign_id = p_from;
  update campaigns set allocated_budget_inr = allocated_budget_inr + p_amount, updated_at = now() where campaign_id = p_to;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values (_actor(p_actor), 'budget_shifted', 'campaign', p_from, jsonb_build_object('from', p_from, 'to', p_to, 'amount_inr', p_amount, 'rationale', left(p_rationale, 500)));
end $$;

create or replace function rpc_create_campaign(p_campaign_id text, p_campaign_name text, p_channel text, p_owner_id text,
  p_target_audience text, p_objective text, p_allocated_budget_inr int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into campaigns (campaign_id, campaign_name, channel, owner_id, target_audience, objective, allocated_budget_inr)
  values (upper(btrim(p_campaign_id)), btrim(p_campaign_name), nullif(btrim(p_channel), ''), nullif(p_owner_id, ''),
          nullif(btrim(p_target_audience), ''), nullif(btrim(p_objective), ''), coalesce(p_allocated_budget_inr, 0));
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'campaign_created', 'campaign', upper(btrim(p_campaign_id)), jsonb_build_object('name', p_campaign_name, 'allocated_budget_inr', p_allocated_budget_inr));
end $$;

create or replace function rpc_save_daily(p_campaign_id text, p_activity_date date, p_impressions int, p_clicks int, p_reported_reach int,
  p_landing_page_sessions int, p_registration_starts int, p_marketing_spend_inr int)
returns text language plpgsql security definer set search_path = public as $$
declare e event%rowtype; v_old int; v_id text; v_mode text;
begin
  select * into e from event where id = 1;
  if p_activity_date < e.history_start or p_activity_date > e.history_end then
    raise exception 'Date must be between % and %', e.history_start, e.history_end using errcode = '22023';
  end if;
  select activity_id, marketing_spend_inr into v_id, v_old from daily_marketing where campaign_id = p_campaign_id and activity_date = p_activity_date for update;
  if found then
    update daily_marketing set impressions = p_impressions, clicks = p_clicks, reported_reach = p_reported_reach,
      landing_page_sessions = p_landing_page_sessions, registration_starts = p_registration_starts, marketing_spend_inr = p_marketing_spend_inr
    where activity_id = v_id;
    v_mode := 'updated';
  else
    v_id := 'AD-' || p_campaign_id || '-' || to_char(p_activity_date, 'MMDD') || '-U' || substr(md5(gen_random_uuid()::text), 1, 6);
    insert into daily_marketing (activity_id, campaign_id, activity_date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr, platform)
    values (v_id, p_campaign_id, p_activity_date, p_impressions, p_clicks, p_reported_reach, p_landing_page_sessions, p_registration_starts, p_marketing_spend_inr, 'manual entry (Growth Center)');
    v_mode := 'added';
  end if;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'daily_marketing_' || v_mode, 'daily_marketing', v_id, jsonb_build_object('campaign_id', p_campaign_id, 'date', p_activity_date, 'spend_before', v_old, 'spend_after', p_marketing_spend_inr));
  return v_mode;
end $$;

create or replace function rpc_add_status(p_registration_id text, p_status text, p_effective_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not exists (select 1 from registrations where registration_id = p_registration_id) then
    raise exception 'Registration not found' using errcode = 'P0002';
  end if;
  v_id := 'RH-U' || substr(md5(gen_random_uuid()::text), 1, 10);
  insert into registration_status_history (history_id, registration_id, status, effective_at) values (v_id, p_registration_id, p_status, p_effective_at);
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'registration_status_added', 'registration', p_registration_id, jsonb_build_object('status', p_status, 'effective_at', p_effective_at));
  return v_id;
end $$;

create or replace function rpc_add_checkin(p_person_id text, p_walkin_name text, p_occurred_at timestamptz,
  p_result text, p_verification text, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_person people%rowtype; v_reg text; v_event text;
begin
  if nullif(btrim(p_walkin_name), '') is not null then
    if length(btrim(p_walkin_name)) > 80 then raise exception 'Name is too long' using errcode = '22023'; end if;
    insert into people (person_id, person_name, person_type, first_seen_at, first_touch_source)
    values ('W' || upper(substr(md5(gen_random_uuid()::text), 1, 7)), btrim(p_walkin_name), 'external', p_occurred_at, 'walk_in')
    returning * into v_person;
  else
    select * into v_person from people where person_id = upper(btrim(p_person_id));
    if not found then raise exception 'No person with that ID' using errcode = 'P0002'; end if;
  end if;
  select registration_id into v_reg from registrations where person_id = v_person.person_id order by registered_at limit 1;
  v_event := 'CHK-U' || upper(substr(md5(gen_random_uuid()::text), 1, 8));
  insert into checkins (event_id, person_id, registration_id, occurred_at, result, verification, source)
  values (v_event, v_person.person_id, v_reg, p_occurred_at, p_result, p_verification, p_source);
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'checkin_added', 'checkin', v_event, jsonb_build_object('person_id', v_person.person_id, 'person_type', v_person.person_type, 'result', p_result, 'verification', p_verification, 'source', p_source));
  return jsonb_build_object('person_id', v_person.person_id, 'person_name', v_person.person_name, 'person_type', v_person.person_type, 'event_id', v_event);
end $$;

create or replace function rpc_update_target(p_target_id bigint, p_identified_goal int, p_registration_goal int, p_visitors_goal int, p_budget_inr int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update targets set identified_goal = p_identified_goal, registration_goal = p_registration_goal,
    visitors_goal = p_visitors_goal, budget_inr = p_budget_inr where target_id = p_target_id;
  if not found then raise exception 'Target version not found' using errcode = 'P0002'; end if;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'target_updated', 'target', p_target_id::text, jsonb_build_object('identified_goal', p_identified_goal, 'registration_goal', p_registration_goal, 'visitors_goal', p_visitors_goal, 'budget_inr', p_budget_inr));
end $$;

create or replace function rpc_update_setting(p_key text, p_value numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_old numeric;
begin
  select value into v_old from settings where key = p_key for update;
  if not found then raise exception 'Unknown setting' using errcode = 'P0002'; end if;
  update settings set value = p_value where key = p_key;  -- range enforced by the table CHECK
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'setting_updated', 'setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

create or replace function rpc_save_bet_reading(p_bet_id text, p_reading numeric, p_sample_size int, p_reading_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  update bets set latest_reading = p_reading, sample_size = p_sample_size, reading_date = p_reading_date, updated_at = now() where bet_id = p_bet_id;
  if not found then raise exception 'Bet not found' using errcode = 'P0002'; end if;
  insert into activity_log (actor, action, entity_type, entity_id, details)
  values ('user', 'bet_reading_saved', 'bet', p_bet_id, jsonb_build_object('reading', p_reading, 'sample_size', p_sample_size, 'date', p_reading_date));
end $$;

-- Search: exact ID match or name substring. LIKE wildcards in the input are escaped.
create or replace function rpc_search_registrations(p_term text)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (select btrim(coalesce(p_term, '')) as q)
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select r.registration_id, r.person_id, p.person_name, p.person_type, r.campaign_id, c.campaign_name, r.registered_at
    from registrations r join people p on p.person_id = r.person_id left join campaigns c on c.campaign_id = r.campaign_id, t
    where length(t.q) >= 2 and (
      r.registration_id = upper(t.q) or r.person_id = upper(t.q)
      or p.person_name ilike '%' || replace(replace(replace(t.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    order by p.person_name, r.registration_id
    limit 25
  ) x
$$;

create or replace function rpc_registration_history(p_registration_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('history_id', history_id, 'status', status, 'effective_at', effective_at) order by effective_at, history_id), '[]'::jsonb)
  from registration_status_history where registration_id = p_registration_id
$$;

-- ---------------------------------------------------------------------
-- 6. Privileges: browser = read core + call RPCs. No direct writes, no raw/seed access.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['event','owners','campaigns','targets','people','registrations','registration_status_history',
                           'interactions','checkins','daily_marketing','tasks','bets','settings','activity_log','ingest_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy read_all on %I for select to anon, authenticated using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
  foreach t in array array['raw_event','raw_targets','raw_campaigns','raw_daily_marketing','raw_people','raw_interactions',
                           'raw_registrations','raw_registration_history','raw_checkins','seed_allocations','seed_tasks','seed_bets','seed_settings']
  loop
    execute format('alter table %I enable row level security', t);   -- no policies: only service_role can touch them
  end loop;
end $$;

grant execute on function growth_snapshot(date), growth_daily(date, text), dataset_rows(text, date),
  rpc_create_task(text, text, text, text, date, text, text, text), rpc_update_task(uuid, text, text, text, text, date, text, text),
  rpc_set_task_status(uuid, text), rpc_delete_task(uuid), rpc_update_campaign(text, text, int, text, text, text),
  rpc_shift_budget(text, text, int, text, text), rpc_create_campaign(text, text, text, text, text, text, int),
  rpc_save_daily(text, date, int, int, int, int, int, int), rpc_add_status(text, text, timestamptz),
  rpc_add_checkin(text, text, timestamptz, text, text, text), rpc_update_target(bigint, int, int, int, int),
  rpc_update_setting(text, numeric), rpc_save_bet_reading(text, numeric, int, date),
  rpc_search_registrations(text), rpc_registration_history(text), reset_demo()
to anon, authenticated;

grant execute on function ingest() to service_role;
grant execute on function as_of_cutoff(date), _actor(text) to anon, authenticated;
