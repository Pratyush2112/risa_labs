// Deterministic grounding check: every figure in the draft answer must match a number that
// appeared in the context snapshot, a tool result, or the user's own messages (allowing for
// display rounding, percent conversion and K/L/Cr abbreviations).

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
const STRIP = [
  /\b\d{4}-\d{2}-\d{2}\b/g,                                       // ISO dates
  new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS})\\b\\.?(\\s+\\d{4})?`, 'gi'), // 15 March 2025
  new RegExp(`\\b(${MONTHS})\\.?\\s+\\d{1,2}(st|nd|rd|th)?(,?\\s+\\d{4})?`, 'gi'),   // March 15, 2025
  /\b[WD]-\d+\b/g,                                                 // W-9, D-3
  /\b[A-Z]{1,3}-?U?[0-9A-Z]{2,}\b/g,                               // IDs: C01, R0001, CHK-U..., RH000001
  /\bb\d\b/g,                                                      // bet ids
  /\b(19|20)\d{2}\b/g,                                             // bare years
  /\b\d{1,2}:\d{2}\b/g,                                            // times
];

const FIG = /(₹\s?)?(-?\d[\d,]*(?:\.\d+)?)\s?(%|×|x\b|k\b|K\b|L\b|lakh\b|lakhs\b|Cr\b|crore\b)?/g;

export function extractFigures(text) {
  let t = String(text || '');
  for (const re of STRIP) t = t.replace(re, ' ');
  const out = [];
  let m;
  while ((m = FIG.exec(t))) {
    const rupee = Boolean(m[1]);
    const rawNum = m[2];
    const suffix = (m[3] || '').toLowerCase();
    let value = Number(rawNum.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const decimals = (rawNum.split('.')[1] || '').length;
    let scale = 1;
    if (suffix === 'k') scale = 1e3;
    if (suffix === 'l' || suffix.startsWith('lakh')) scale = 1e5;
    if (suffix === 'cr' || suffix === 'crore') scale = 1e7;
    const isPct = suffix === '%';
    // Ignore small bare integers (ranks, counts of items, "3 bets") unless they are money or percentages.
    if (!rupee && !isPct && scale === 1 && Number.isInteger(value) && Math.abs(value) <= 12) continue;
    out.push({ raw: m[0].trim(), value: value * scale, decimals, isPct, abbreviated: scale !== 1 });
  }
  return out;
}

export function collectNumbers(input, acc = new Set()) {
  if (input == null) return acc;
  if (typeof input === 'number') { if (Number.isFinite(input)) acc.add(input); return acc; }
  if (typeof input === 'string') {
    const s = input.trim();
    if ((s.startsWith('{') || s.startsWith('[')) && s.length < 2_000_000) {
      try { return collectNumbers(JSON.parse(s), acc); } catch { /* fall through to text scan */ }
    }
    for (const f of extractFigures(s)) acc.add(f.value);
    const plain = s.match(/-?\d+(?:\.\d+)?/g) || [];
    plain.forEach((p) => acc.add(Number(p)));
    return acc;
  }
  if (Array.isArray(input)) { input.forEach((v) => collectNumbers(v, acc)); return acc; }
  if (typeof input === 'object') { Object.values(input).forEach((v) => collectNumbers(v, acc)); return acc; }
  return acc;
}

const roundTo = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

function supported(fig, evidence) {
  for (const e of evidence) {
    const candidates = [e];
    if (Math.abs(e) <= 10) candidates.push(e * 100);       // ratios shown as percentages
    if (fig.isPct && Math.abs(e) > 1) candidates.push(e);  // already-percent values
    for (const c of candidates) {
      if (fig.abbreviated) {
        if (Math.abs(c - fig.value) <= Math.max(0.006 * Math.abs(c), 1)) return true;
      } else if (roundTo(c, fig.decimals) === fig.value || Math.abs(c - fig.value) < 1e-9) {
        return true;
      } else if (fig.decimals === 0 && Math.abs(c - fig.value) <= 0.5) {
        return true;
      }
    }
  }
  return false;
}

export function checkGrounding(answer, evidenceSources) {
  const evidence = new Set();
  evidenceSources.forEach((s) => collectNumbers(s, evidence));
  const figures = extractFigures(answer);
  const unsupported = figures.filter((f) => !supported(f, evidence));
  return {
    checked: figures.length,
    supported: figures.length - unsupported.length,
    unsupported: [...new Set(unsupported.map((f) => f.raw))].slice(0, 12),
  };
}
