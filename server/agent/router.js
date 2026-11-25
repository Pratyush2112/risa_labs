// Deterministic router (no model call): classifies the request, extracts campaigns and dates,
// and flags topics the dataset cannot answer. Its output steers the agent's instructions.

const INTENTS = [
  ['action', /\b(create|add|assign|schedule|make|open|log)\b.*\b(task|todo|action item|reminder)\b|\b(move|shift|reallocate|transfer)\b.*\b(budget|₹|rs|inr|money)\b|\b(pause|stop|scale|change)\b\s+(the\s+)?(campaign|paid|creator|ambassador|referral|college|organic|community)|\bset\b.*\bstatus\b/i],
  ['compare', /\b(compare|comparison|vs\.?|versus|against|rank|ranking|best|worst|top|bottom|outperform|better|worse|which campaign)\b/i],
  ['forecast', /\b(forecast|project(ed|ion)?|on track|will we|expect|predict|pace|hit the (goal|target)|reach the (goal|target))\b/i],
  ['trend', /\b(trend|over time|weekly|daily|by week|by day|per week|per day|trajectory|growth rate|week[- ]on[- ]week|timeline)\b/i],
  ['diagnose', /\b(why|drop|bottleneck|underperform|problem|issue|wrong|cause|leak|fix|improve|worst stage)\b/i],
];

const GAPS = [
  [/\b(capacity|venue size|how many (people )?can (the )?venue|fire limit|occupancy)\b/i, 'venue capacity'],
  [/\b(revenue|ticket price|ticket sales|profit|income|sold tickets)\b/i, 'ticket prices and revenue'],
  [/\b(demograph|gender|age group|which colleges?|college names?|universit(y|ies) name)/i, 'demographics and college names'],
  [/\bunique reach\b|\bhow many (unique )?people (did we|we) reach/i, 'unique reach (daily reach cannot be summed)'],
  [/\bsponsor/i, 'sponsor data (not loaded in this app)'],
  [/\bcompetitor/i, 'competitor data'],
  [/\b(2026|next year)\b.*\b(actual|result|attendance)\b|\bafter (20|21|22|30) apr/i, 'results after 20 April 2025'],
  [/\b(causal|caused|incremental lift|uplift)\b/i, 'causal proof of incremental attendance'],
];

const ALIASES = [
  ['C01', /\bambassador/i], ['C02', /\bpaid( social)?\b|\bmeta ads?\b|\binstagram ads?\b/i], ['C03', /\bcreator/i],
  ['C04', /\bcollege|\bclubs?\b/i], ['C05', /\breferral|\bfriends?\b/i], ['C06', /\borganic|\bsearch\b|\bseo\b/i], ['C07', /\bcommunity|\bcommunities/i],
];

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, january: 1, february: 2, march: 3, april: 4 };
const pad = (n) => String(n).padStart(2, '0');

function extractDates(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b(2025)-(0[1-4])-(\d{2})\b/g)) found.add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|january|february|march|april)\b/gi)) {
    found.add(`2025-${pad(MONTH[m[2].toLowerCase()])}-${pad(Number(m[1]))}`);
  }
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|january|february|march|april)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi)) {
    found.add(`2025-${pad(MONTH[m[1].toLowerCase()])}-${pad(Number(m[2]))}`);
  }
  return [...found].filter((d) => d >= '2025-01-15' && d <= '2025-04-20').sort();
}

export function route(text, campaigns = []) {
  const t = String(text || '');
  const intents = INTENTS.filter(([, re]) => re.test(t)).map(([k]) => k);
  const campaignIds = new Set();
  for (const m of t.matchAll(/\bC0?(\d{1,2})\b/g)) campaignIds.add(`C${pad(Number(m[1]))}`);
  ALIASES.forEach(([id, re]) => { if (re.test(t)) campaignIds.add(id); });
  campaigns.forEach((c) => { if (c.campaign_name && t.toLowerCase().includes(c.campaign_name.toLowerCase())) campaignIds.add(c.campaign_id); });
  const known = new Set(campaigns.map((c) => c.campaign_id));
  return {
    intent: intents[0] || 'lookup',
    secondary_intents: intents.slice(1),
    campaign_ids: [...campaignIds].filter((id) => !known.size || known.has(id)),
    dates: extractDates(t),
    data_gaps: GAPS.filter(([re]) => re.test(t)).map(([, label]) => label),
  };
}
