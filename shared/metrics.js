// Shared by the browser app and the AI server, so the dashboard and the
// AI analyst always compute identical numbers from the same snapshot.

export const DEFAULT_SETTINGS = {
  confirmed_show_rate: 0.77,
  expected_walkins: 125,
  scale_ratio: 0.8,
  change_ratio: 1.2,
  stop_ratio: 1.8,
  min_show_rate: 0.65,
  scale_min_show_rate: 0.75,
  optout_change: 0.05,
  optout_stop: 0.08,
  min_outcomes: 30,
  pace_alert: 0.9,
};

export const safeDiv = (a, b) => (b && Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

/** Fraction of the acquisition window that has passed at the end of the as-of day (0..1). */
export function elapsedFraction(snap) {
  const start = new Date(snap.history_start + 'T00:00:00+05:30').getTime();
  const end = new Date(snap.event_starts_at).getTime();
  const cut = new Date(snap.as_of + 'T23:59:59+05:30').getTime();
  if (!(end > start)) return 1;
  return Math.max(0, Math.min(1, (cut - start) / (end - start)));
}

/** Decision for one campaign. Pre-event the outcome is a confirmed registration; after the event it is a verified attendee. */
export function decisionFor(c, ctx) {
  const s = ctx.settings;
  const outcomes = ctx.preEvent ? c.confirmed : c.attended;
  const outcomeLabel = ctx.preEvent ? 'confirmed registration' : 'verified attendee';
  if (c.spend <= 0 && outcomes === 0) return { decision: 'No data', reason: 'No spend or outcomes yet.' };
  if (outcomes < s.min_outcomes) {
    return { decision: 'Insufficient data', reason: `Only ${outcomes} ${outcomeLabel}s (minimum ${s.min_outcomes}) — too early to judge.` };
  }
  const ratio = safeDiv(c.outcome_cost, ctx.blendedOutcomeCost);
  const parts = [];
  if (ratio != null) parts.push(`cost per ${outcomeLabel} ₹${Math.round(c.outcome_cost)} is ${ratio.toFixed(2)}× the blended ₹${Math.round(ctx.blendedOutcomeCost)}`);
  if (c.optout_rate != null) parts.push(`opt-out rate ${(c.optout_rate * 100).toFixed(1)}%`);
  if (!ctx.preEvent && c.show_rate != null) parts.push(`show rate ${(c.show_rate * 100).toFixed(1)}%`);
  const why = parts.join('; ');

  if ((ratio != null && ratio >= s.stop_ratio) || (c.optout_rate != null && c.optout_rate >= s.optout_stop)) {
    return { decision: 'Stop', reason: `Stop rule: ${why}.` };
  }
  if ((ratio != null && ratio >= s.change_ratio) ||
      (c.optout_rate != null && c.optout_rate >= s.optout_change) ||
      (!ctx.preEvent && c.show_rate != null && c.show_rate < s.min_show_rate)) {
    return { decision: 'Change', reason: `Change rule: ${why}.` };
  }
  if (ratio != null && ratio <= s.scale_ratio && (ctx.preEvent || (c.show_rate ?? 0) >= s.scale_min_show_rate)) {
    return { decision: 'Scale', reason: `Scale rule: ${why}.` };
  }
  return { decision: 'Continue', reason: `Within normal range: ${why}.` };
}

/** Adds rates, costs, decisions, projections, pace and alerts to a raw growth_snapshot result. */
export function deriveSnapshot(snap, { tasks = [] } = {}) {
  if (!snap) return null;
  const settings = { ...DEFAULT_SETTINGS, ...(snap.settings || {}) };
  const preEvent = !snap.event_started;
  const t = snap.totals;
  const targets = snap.targets || null;

  const campaigns = (snap.campaigns || []).map((c) => {
    const d = { ...c };
    d.ident_to_reg = safeDiv(c.registered, c.identified);
    d.confirm_rate = safeDiv(c.confirmed, c.registered);
    d.show_rate = preEvent ? null : safeDiv(c.attended, c.registered);
    d.cost_per_identified = safeDiv(c.spend, c.identified);
    d.cost_per_registration = safeDiv(c.spend, c.registered);
    d.cost_per_confirmed = safeDiv(c.spend, c.confirmed);
    d.cost_per_attendee = preEvent ? null : safeDiv(c.spend, c.attended);
    d.outcome_cost = preEvent ? d.cost_per_confirmed : d.cost_per_attendee;
    d.brochure_rate = safeDiv(c.brochure_people, c.identified);
    d.optout_rate = safeDiv(c.optout_people, c.identified);
    d.budget_used = safeDiv(c.spend, c.allocated_budget_inr);
    d.ctr = safeDiv(c.clicks, c.impressions);
    return d;
  });

  const campSpend = campaigns.reduce((a, c) => a + c.spend, 0);
  const campOutcomes = campaigns.reduce((a, c) => a + (preEvent ? c.confirmed : c.attended), 0);
  const blendedOutcomeCost = safeDiv(campSpend, campOutcomes);
  const ctx = { settings, preEvent, blendedOutcomeCost };
  campaigns.forEach((c) => Object.assign(c, decisionFor(c, ctx)));

  const projectedVisitors = preEvent
    ? Math.round(t.confirmed * settings.confirmed_show_rate + settings.expected_walkins)
    : t.visitors;

  const frac = elapsedFraction(snap);
  const attainment = targets ? {
    identified: safeDiv(t.identified, targets.identified_goal),
    registered: safeDiv(t.registered, targets.registration_goal),
    visitors: safeDiv(preEvent ? projectedVisitors : t.visitors, targets.visitors_goal),
    budget_used: safeDiv(t.spend, targets.budget_inr),
  } : null;
  const pace = targets ? {
    elapsed_fraction: r3(frac),
    identified_expected: Math.round(targets.identified_goal * frac),
    registered_expected: Math.round(targets.registration_goal * frac),
    spend_expected: Math.round(targets.budget_inr * frac),
  } : null;

  // ---- Alerts (what needs attention today) ----
  const alerts = [];
  campaigns.forEach((c) => {
    if (c.decision === 'Stop') alerts.push({ severity: 'high', campaign_id: c.campaign_id, title: `${c.campaign_name}: meets the stop rule`, detail: c.reason });
    else if (c.decision === 'Change') alerts.push({ severity: 'medium', campaign_id: c.campaign_id, title: `${c.campaign_name}: needs a change`, detail: c.reason });
    if (c.allocated_budget_inr > 0 && c.spend > c.allocated_budget_inr) {
      alerts.push({ severity: 'high', campaign_id: c.campaign_id, title: `${c.campaign_name}: over its allocation`, detail: `Spent ₹${c.spend.toLocaleString('en-IN')} against ₹${c.allocated_budget_inr.toLocaleString('en-IN')} allocated.` });
    }
  });
  if (targets && preEvent) {
    if (t.registered < pace.registered_expected * settings.pace_alert) {
      alerts.push({ severity: 'high', title: 'Registrations behind target pace', detail: `${t.registered} registered vs ~${pace.registered_expected} expected by now on a straight-line path to ${targets.registration_goal} (alert below ${Math.round(settings.pace_alert * 100)}% of pace).` });
    }
    if (t.identified < pace.identified_expected * settings.pace_alert) {
      alerts.push({ severity: 'medium', title: 'Identified people behind target pace', detail: `${t.identified} identified vs ~${pace.identified_expected} expected by now (goal ${targets.identified_goal}).` });
    }
    if (projectedVisitors < targets.visitors_goal) {
      alerts.push({ severity: 'medium', title: 'Projected visitors below goal', detail: `Projection ${projectedVisitors} = ${t.confirmed} confirmed × ${Math.round(settings.confirmed_show_rate * 100)}% assumed show rate + ${settings.expected_walkins} assumed walk-ins, vs goal ${targets.visitors_goal}.` });
    }
  }
  if (targets && !preEvent && t.visitors < targets.visitors_goal) {
    alerts.push({ severity: 'medium', title: 'Visitor goal missed', detail: `${t.visitors} verified external visitors vs goal ${targets.visitors_goal} (${Math.round(attainment.visitors * 100)}%).` });
  }
  if (targets && t.spend > targets.budget_inr) {
    alerts.push({ severity: 'high', title: 'Spend above approved budget', detail: `₹${t.spend.toLocaleString('en-IN')} spent vs ₹${targets.budget_inr.toLocaleString('en-IN')} approved.` });
  }
  const overdue = tasks.filter((k) => k.status !== 'done' && k.due_date && k.due_date < snap.as_of);
  if (overdue.length) alerts.push({ severity: 'low', title: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`, detail: overdue.slice(0, 3).map((k) => k.title).join('; ') });
  const sevOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  // Funnel stage conversion (totals). Registered → attended only after the event.
  const funnel = [
    { stage: 'Identified people', value: t.identified },
    { stage: 'Registered', value: t.registered, rate: safeDiv(t.registered, t.identified - (t.identified_walk_in || 0)) },
    { stage: 'Confirmed (latest status)', value: t.confirmed, rate: safeDiv(t.confirmed, t.registered) },
    { stage: 'Verified visitors', value: t.visitors, rate: preEvent ? null : safeDiv(t.visitors_registered, t.confirmed), note: t.visitors_unattributed ? `incl. ${t.visitors_unattributed} without a registration (walk-ins)` : '' },
  ];

  return {
    ...snap,
    settings,
    preEvent,
    campaigns,
    blendedOutcomeCost,
    blendedCostPerVisitor: preEvent ? null : safeDiv(t.spend, t.visitors),
    projectedVisitors,
    attainment,
    pace,
    alerts,
    funnel,
  };
}

/** Band for a bet's latest KPI reading. */
export function betBand(b) {
  if (b.latest_reading == null || b.latest_reading === '') return { band: 'No reading', reason: 'Enter the latest reading to get a decision.' };
  const v = Number(b.latest_reading);
  if (b.min_sample && (b.sample_size == null || b.sample_size < b.min_sample)) {
    return { band: 'Insufficient sample', reason: `Sample ${b.sample_size ?? 0} is below the minimum ${b.min_sample}. Keep collecting before deciding.` };
  }
  if (v >= b.scale_at) return { band: 'Scale', reason: `${v} ≥ scale line ${b.scale_at}.` };
  if (v >= b.continue_from) return { band: 'Continue', reason: `${v} is within 90–110% of plan (${b.continue_from}–${b.scale_at}).` };
  if (v >= b.stop_below) return { band: 'Change', reason: `${v} is between the stop line ${b.stop_below} and ${b.continue_from}.` };
  return { band: 'Stop', reason: `${v} is below the stop line ${b.stop_below}. ${b.stop_destination || ''}`.trim() };
}

/** Compact, rounded version of the derived snapshot for the AI (keeps tokens low). */
export function snapshotForAI(d) {
  const pick = (c) => ({
    campaign_id: c.campaign_id, campaign: c.campaign_name, owner_id: c.owner_id, owner: c.owner_name, status: c.status,
    allocated_budget_inr: c.allocated_budget_inr, spend_inr: c.spend, budget_used: r3(c.budget_used),
    impressions: c.impressions, clicks: c.clicks, landing_sessions: c.sessions, registration_starts_anonymous: c.reg_starts,
    identified: c.identified, registered: c.registered, confirmed: c.confirmed, interested: c.interested,
    cancelled: c.cancelled, waitlisted: c.waitlisted, attended: c.attended,
    ident_to_reg: r3(c.ident_to_reg), confirm_rate: r3(c.confirm_rate), show_rate: r3(c.show_rate),
    cost_per_registration: r1(c.cost_per_registration), cost_per_confirmed: r1(c.cost_per_confirmed),
    cost_per_attendee: r1(c.cost_per_attendee), brochure_people: c.brochure_people, question_people: c.question_people,
    optout_people: c.optout_people, optout_rate: r3(c.optout_rate),
    rule_decision: c.decision, rule_reason: c.reason, manager_note: c.decision_note,
  });
  return {
    as_of: d.as_of, event_started: d.event_started, event_starts_at: d.event_starts_at,
    targets_in_effect: d.targets, totals: d.totals,
    projected_visitors: d.projectedVisitors,
    projection_method: d.preEvent
      ? `confirmed × ${d.settings.confirmed_show_rate} (assumed show rate) + ${d.settings.expected_walkins} (assumed walk-ins)`
      : 'actual verified visitors (event has happened)',
    target_attainment: d.attainment, straight_line_pace: d.pace,
    blended_outcome_cost: r1(d.blendedOutcomeCost),
    blended_outcome: d.preEvent ? 'spend per confirmed registration (campaign-attributed)' : 'spend per verified attendee (campaign-attributed)',
    campaigns: d.campaigns.map(pick),
    alerts: d.alerts,
    settings_assumptions_and_thresholds: d.settings,
  };
}
