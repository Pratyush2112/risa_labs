export const inr = (v) => (v == null || Number.isNaN(v) ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
export const inrShort = (v) => {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(a >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')}L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `₹${Math.round(v)}`;
};
export const num = (v) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN'));
export const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const toDate = (iso) => new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
export const shortDate = (iso) => (iso ? toDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—');
export const longDate = (iso) => (iso ? toDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');
export const dateTime = (iso) => (iso ? toDate(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');
export const istIso = (date, time = '12:00') => `${date}T${time}:00+05:30`;
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
export const DECISION_TONE = { Scale: 'good', Continue: 'neutral', Change: 'warn', Stop: 'bad' };
export const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
