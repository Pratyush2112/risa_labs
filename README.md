# CampusFest Growth Center

**RISA Labs · Growth APM assignment · Challenge A (Attendee Growth)** — Pratyush Singh, IIT Kharagpur

A working command centre for growing *verified festival attendance*: funnel analytics you can replay day by day, campaign and task management, a data editor with a data-quality report, and a LangGraph AI analyst that answers from the live database, checks its own figures, and turns insights into tasks only after you confirm.

- **Live app:** `https://<your-vercel-url>` (add after deploying)
- **Strategy deck:** `Pratyush_Singh_RISA_Growth_APM_Slides.pdf`
- **Model:** Google Sheet "RISA Slide 1 – Attendee Funnel Model"

---

## 1. Brief → product

| Brief | Where |
|---|---|
| Measure: funnel, campaign KPIs, targets vs actuals, conversion, budgets, projection | **Overview**: funnel ribbon (each stage vs goal, with a pace marker before the event), spend vs budget, cost per outcome, status mix, registrations over time vs goal. **Campaigns**: 13-column table |
| Diagnose: winners, laggards, bottlenecks, drivers | Rule decision per campaign with its reason; *Needs attention* list; cost-per-outcome bars against the blended line; campaign inspector with daily spend vs registrations |
| Support decisions: prioritise, allocate, scale / change / stop | Budget allocation view and transfers; status and decision notes; **Bets** page with thresholds and minimum samples |
| Manage execution: tasks, owners, deadlines; changes update analytics | **Tasks** kanban (overdue judged against the selected date); **Data Lab** edits; activity log; restore original data |
| AI analyst and copilot | Right-hand panel on every page (section 5) |
| Snapshot integrity | The **timeline scrubber** replays any day from 15 Jan to 20 Apr 2025; nothing dated later leaks into a snapshot |

## 2. Data model (Supabase / PostgreSQL)

```
raw_* (exact files, duplicates kept)  ──ingest()──►  core tables with PKs and FKs
                                                     owners ◄── campaigns ◄── daily_marketing
                                                       ▲           ▲  ▲
                                                       │           │  └── interactions ──► people
                                                     people ◄── registrations ◄── registration_status_history
                                                       ▲           ▲
                                                       └─ checkins ┘
                                                     tasks ──► campaigns, owners      bets ──► owners
                                                     settings, targets, activity_log, ingest_runs
```

- `ingest()` keeps one row per source ID, skips orphans (none in the supplied data), and writes a **data-quality report** (`ingest_runs`) shown in Data Lab: duplicates removed are 2 daily rows, 4 status versions and 20 check-ins.
- Check constraints enforce every enumerated value (person types, statuses, results, priorities); settings carry min/max ranges.
- `growth_snapshot(date)`, `growth_daily(date, campaign)` and `dataset_rows(dataset, date)` are the single source of truth for the dashboard **and** the AI.

### Verification checklist (computed independently from the Excel)

| As of | Identified | Registered | Confirmed | Visitors | Spend |
|---|---|---|---|---|---|
| 15 Feb 2025 | 1,055 | 587 | 426 | 0 | ₹73,475 |
| 14 Mar 2025 | 2,329 | 1,506 | 1,255 | 0 | ₹1,89,575 |
| 11 Apr 2025 | 3,500 | 2,800 | 2,500 | 0 | ₹2,76,500 |
| 20 Apr 2025 | 3,625 | 2,800 | 2,500 | **2,050** | **₹2,74,000** |

## 3. Security model

| Layer | Rule |
|---|---|
| Browser | `SELECT` only on core tables (RLS read policies). **No INSERT / UPDATE / DELETE grants on any table.** |
| Writes | 16 `SECURITY DEFINER` functions (`rpc_create_task`, `rpc_shift_budget`, `rpc_add_checkin`, …) with typed parameters, validation, row locks where money moves, and an activity-log entry each |
| Injection | No SQL is built from user or model text anywhere. Search escapes `LIKE` wildcards and binds the term as a parameter. `dataset_rows` picks one of six static queries by name. The old free-form SQL tool is gone |
| AI service | Uses the **anon** key: it can read and call read RPCs, nothing else. It proposes; the browser writes after you confirm |
| Raw and seed tables | RLS on, no policies: only the service role (used by the local seed script) can touch them |
| Service role key | Used only by `npm run seed` on your machine. Never deployed |
| Inputs | Dates clamped to the data window; IDs validated by pattern; model tool arguments validated against whitelists; request bodies trimmed and length-capped |
| Headers | `nosniff`, `DENY` framing, strict referrer policy (`vercel.json`) |

Known trade-off: this is a public demo without login, so anyone with the link can call the write functions (validated and logged). Use **Restore original data** after testing. Production would add Supabase Auth and role checks inside each function.

## 4. Assumptions and simulated data

| Item | Value | Type |
|---|---|---|
| Starting budget split | Ambassadors ₹45K, Paid Social ₹100K, Creators ₹62K, College ₹33K, Referrals ₹20K, Organic ₹16K, Community ₹18K | Simulated |
| Pre-event projection | confirmed × 77% + 125 walk-ins | Assumption (2025 actuals), editable |
| Decision thresholds | Scale ≤ 0.8× blended cost per outcome (and show rate ≥ 75% after the event); Change ≥ 1.2×, opt-outs ≥ 5% or show rate < 65%; Stop ≥ 1.8× or opt-outs ≥ 8%; < 30 outcomes is insufficient | Threshold, editable with bounds |
| Seed tasks, five bets, two example readings | — | Simulated |

Outcome = confirmed registration before the event, verified attendee after. Not in the data: venue capacity, ticket prices or revenue, demographics, college names, unique reach, sponsor data, anything after 20 Apr 2025, causal lift.

## 5. The AI analyst: a LangGraph state machine

```
START → router → context → agent ─┬─ tool calls ──→ tools ─→ agent
                                  ├─ draft answer → verify ─┬─ untraced figures (first time) → agent
                                  │                         └─ all traced / already revised → finalize → END
                                  └─ step budget used ─────→ finalize → END
```

| Node | What it does |
|---|---|
| **router** | Deterministic (no model call): intent (compare, diagnose, trend, forecast, action, lookup), campaigns and dates named in the question, and topics the data cannot answer (capacity, revenue, demographics, unique reach, sponsors, causal lift…) |
| **context** | Fetches the snapshot for the requested date and puts it in the system prompt, so top-line answers need no extra calls |
| **agent** | Gemini with tools bound; the system prompt carries definitions, tool policy, answer format, honesty rules and the routing notes |
| **tools** | `get_kpi_snapshot`, `compare_kpis` (side-by-side with totals, best/worst and change between dates), `get_timeseries` (daily/weekly), `query_data` (whitelisted query language over six record-level datasets plus tasks: filters, group-by, count / count_distinct / sum / avg / min / max), `calculate` (exact arithmetic, no `eval`), `list_tasks`, `list_bets`, `propose_task`, `propose_budget_shift`, `propose_campaign_status` |
| **verify** | Extracts every figure from the draft (₹, %, ×, K/L/Cr) and checks it against the numbers in the snapshot and tool results, allowing display rounding. Untraced figures send the draft back once with instructions to recompute or remove them |
| **finalize** | Returns the answer, proposals, the tool trace and the grounding report; the UI shows "n figures traced to data" or a warning |

Why a deterministic router: it is free, instant, testable and cannot hallucinate; the model's budget goes to analysis.

## 6. Setup (about 30–45 minutes)

1. **Database.** Supabase → New project → SQL Editor → paste and run `supabase/schema.sql`.
2. **Keys.** Supabase → Project Settings → API (URL, `anon`, `service_role`); Google AI Studio → API key.
3. **Configure.** Copy `.env.example` to `.env` and fill it in.
4. **Install and seed.**
   ```bash
   npm install
   npm run seed
   ```
   The script prints the ingest report and `Check: 3625 / 2800 / 2050 / 274000 → PASS`.
5. **Local run (optional).** `npx vercel dev` serves the app and `/api/chat` together.
6. **Deploy.** Push to GitHub → Vercel → Import (framework Vite). Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY` (optional `GEMINI_MODEL`). **Do not add the service role key to Vercel.**
7. **Smoke test.** Overview at *Final*: 3,625 / 2,800 / 2,050 / ₹2,74,000. Ask the analyst "How many verified visitors came on both days?"

If the model rejects tool calls, set `GEMINI_MODEL` to another current Flash model listed in AI Studio.

## 7. Demo: one insight-to-action workflow

1. Drag the timeline to **15 Mar (Revision)**. The ribbon shows registrations against goal with the pace marker; *Needs attention* lists rule breaches.
2. Ask: *"Which campaigns should we scale, change or stop, and why?"* → `compare_kpis`; answer cites cost per confirmed registration vs blended and opt-out rates; "7 figures traced to data".
3. Follow-up: *"Did people who downloaded the brochure attend more often?"* → `query_data` on registrations grouped by `downloaded_brochure` with `avg(attended)`; the answer calls it an association, not proof.
4. *"Move ₹20,000 from Paid Social to College Partnerships and create a task for Meera to sign 10 more clubs by 25 March."* → two proposal cards; edit, then **Confirm and save**.
5. Tasks shows the new card (marked AI), Campaigns shows the new allocation, Data Lab → Activity log shows both as "AI, confirmed".
6. Limits: *"What is our venue capacity?"* → the router flags it; the analyst says the data lacks it, gives the Day 1 / Day 2 visitor counts it can compute, and says what input is needed.
7. Changed data: Data Lab → change a day's Paid Social spend, or add a verified walk-in on 12 Apr; ask again and the numbers move. **Restore original data** resets everything.

More test questions: weekly registrations for Student Referrals in March; show rate for people who registered 30–60 days before the event; how many people were waitlisted on 11 April and whether any attended; overdue tasks on 20 March; ticket revenue (should say it is not in the data).

## 8. Known limitations

- Open demo access (see section 3). Seed allocations, tasks, bets and two bet readings are simulated and labelled.
- The projection uses a flat show-rate assumption; pace alerts use a straight line (the 2025 weekly curve is in the Sheet's PlanCurve tab).
- Gemini free-tier rate limits can return "try again in a minute"; wording varies between runs, numbers come from tools.
- The grounding check matches figures, not meaning: it catches invented numbers, not a correct number used in the wrong sentence.
- One attribution model (registration's campaign); first-touch or multi-touch are not implemented.

## 9. Tools used

| Tool | Use |
|---|---|
| React 18, Vite 5, Recharts 2 | Front end and charts |
| Supabase (free) | Postgres, RLS, SQL functions, persistence |
| Vercel (free) | Hosting and the `/api/chat` function |
| LangGraph JS, LangChain core, `@langchain/google-genai`, Zod | Analyst state machine, tool schemas |
| Google Gemini API (AI Studio key; `gemini-flash-latest` by default) | Reasoning and tool calling |
| Python + pandas | Converting the Excel to seed JSON; independent verification of the checklist |
| Claude (Anthropic) | Pair-building: analysis, model, slides and code drafts; numbers cross-checked against the raw dataset |

All code was written for this assignment; no templates were reused.
