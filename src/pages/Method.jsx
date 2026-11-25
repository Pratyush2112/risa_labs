import React from 'react';
import { Panel } from '../components/ui.jsx';
import { pct } from '../lib/format.js';

export default function Method({ d }) {
  const s = d.settings;
  return (
    <div className="stack prose">
      <div className="split even">
        <Panel title="How every number is counted">
          <ul>
            <li><b>Snapshot date.</b> A date means the end of that day in IST. Records dated later are never used, so no outcome leaks into an earlier snapshot.</li>
            <li><b>Duplicates.</b> Import retries repeated some records with the same source ID. Ingest keeps one row per ID (see Data Lab, Data quality).</li>
            <li><b>Identified people.</b> Distinct external people first seen by the cut-off. Internal, staff and test identities never count.</li>
            <li><b>Registrations.</b> Distinct external people with a registration. The registration's campaign is the acquisition source.</li>
            <li><b>Status.</b> The latest status version of each registration at the cut-off.</li>
            <li><b>Verified visitors.</b> Distinct external people with an admitted and verified check-in, counted once across both days. Manual records count; denied, pending and unverified ones do not.</li>
            <li><b>Spend.</b> Net ledger amounts (credits negative) summed to the cut-off. Impressions, clicks, reach and sessions are events, not people; daily reach is never added up.</li>
            <li><b>Walk-ins.</b> Visitors without a registration are unattributed, which does not mean they cost nothing.</li>
          </ul>
        </Panel>
        <Panel title="Decision rules">
          <p>Before the event the outcome is a confirmed registration; from the event start it is a verified attendee. Each campaign's cost per outcome is compared with the blended cost of all campaigns.</p>
          <ul>
            <li><b>Scale:</b> cost at most {s.scale_ratio}× blended (and show rate at least {pct(s.scale_min_show_rate, 0)} after the event).</li>
            <li><b>Change:</b> cost at least {s.change_ratio}× blended, opt-outs at least {pct(s.optout_change, 0)} of identified people, or show rate below {pct(s.min_show_rate, 0)}.</li>
            <li><b>Stop:</b> cost at least {s.stop_ratio}× blended, or opt-outs at least {pct(s.optout_stop, 0)}.</li>
            <li><b>Insufficient data:</b> fewer than {s.min_outcomes} outcomes.</li>
          </ul>
          <p>Pre-event projection = confirmed × {pct(s.confirmed_show_rate, 0)} + {s.expected_walkins} walk-ins. Both inputs are assumptions from 2025 actuals, editable in the Data Lab. Pace compares actuals with a straight line from 15 January to the event start.</p>
        </Panel>
      </div>
      <div className="split even">
        <Panel title="Data model and security">
          <ul>
            <li>Raw files load into staging tables unchanged. An ingest function builds normalized tables with primary and foreign keys: owners → campaigns → people → registrations → status history, check-ins and interactions; daily marketing → campaigns; tasks → campaigns and owners.</li>
            <li>The browser can only read. Every change goes through a database function with typed parameters, validation and an activity-log entry. No query is assembled from user text.</li>
            <li>The AI service uses the same read-only access. It cannot write; it proposes, and you confirm.</li>
          </ul>
        </Panel>
        <Panel title="How the analyst works">
          <ul>
            <li>A LangGraph state machine: a router classifies the question and spots data the app does not have; a context step fetches the snapshot; the agent calls tools; a verifier checks that every figure in the draft appears in tool output and sends it back once if not.</li>
            <li>Tools: KPI snapshot, campaign comparison (with change between dates), time series, a whitelisted query language over record-level datasets, an exact calculator, tasks, bets, and three proposal tools.</li>
            <li>Every answer shows the tools it used and how many of its figures were traced to data.</li>
          </ul>
        </Panel>
      </div>
      <Panel title="Sourced, simulated and assumed">
        <ul>
          <li><b>Sourced:</b> people, interactions, registrations, status history, check-ins, daily marketing, campaigns and dated targets (CampusFest 2025, synthetic).</li>
          <li><b>Simulated in this tool:</b> the starting budget split, seed tasks, the five bets and two example bet readings.</li>
          <li><b>Assumptions:</b> projection show rate and walk-ins; decision thresholds.</li>
          <li><b>Not in the data:</b> venue capacity, ticket prices or revenue, demographics, college names, unique reach, sponsor data, and anything after 20 April 2025.</li>
        </ul>
      </Panel>
    </div>
  );
}
