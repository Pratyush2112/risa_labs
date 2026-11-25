import React, { useEffect, useMemo, useState } from 'react';
import { addDays, daysBetween, longDate } from '../lib/format.js';

const START = '2025-01-15';
const END = '2025-04-20';
const REVISION = '2025-03-15';
const EVENT_A = '2025-04-12';
const EVENT_B = '2025-04-13';
const SPAN = daysBetween(START, END);
const at = (iso) => `${(daysBetween(START, iso) / SPAN) * 100}%`;

function phase(d) {
  if (d < REVISION) return ['Launch plan', 'mute'];
  if (d < EVENT_A) return ['Revised plan', 'gold'];
  if (d <= EVENT_B) return ['Event days', 'good'];
  return ['After the event', 'ink'];
}

export default function Timeline({ asOf, onChange }) {
  const [draft, setDraft] = useState(asOf);
  useEffect(() => setDraft(asOf), [asOf]);
  useEffect(() => {
    if (draft === asOf) return undefined;
    const t = setTimeout(() => onChange(draft), 220);
    return () => clearTimeout(t);
  }, [draft, asOf, onChange]);

  const idx = daysBetween(START, draft);
  const [label, tone] = phase(draft);
  const months = useMemo(() => ['2025-02-01', '2025-03-01', '2025-04-01'], []);
  const jump = (iso) => setDraft(iso);
  const step = (n) => setDraft((d) => {
    const next = addDays(d, n);
    return next < START ? START : next > END ? END : next;
  });

  return (
    <div className="timeline" role="group" aria-label="Snapshot date">
      <div className="tl-top">
        <div className="tl-read">
          <div className="tl-date">
            <span className="tl-k">Viewing the end of</span>
            <strong>{longDate(draft)}</strong>
          </div>
          <span className={`pill tone-${tone}`}>{label}</span>
        </div>

        <div className="tl-jumps" role="group" aria-label="Jump to a key date">
          {[['2025-02-15', 'Mid-Feb'], [REVISION, 'Revision'], ['2025-04-11', 'Event eve'], [END, 'Final']].map(([d, l]) => (
            <button key={d} className={`chip ${draft === d ? 'on' : ''}`} onClick={() => jump(d)} aria-pressed={draft === d}>{l}</button>
          ))}
          <input className="tl-input" type="date" min={START} max={END} value={draft}
            onChange={(e) => e.target.value && setDraft(e.target.value)} aria-label="Pick a date" />
        </div>
      </div>

      <div className="tl-scrub">
        <button className="icon-btn sm" onClick={() => step(-7)} aria-label="Back one week">−7</button>
        <div className="tl-track-wrap">
          <div className="tl-track" aria-hidden="true">
            <span className="tl-fill" style={{ width: at(draft) }} />
            <span className="tl-band" style={{ left: at(EVENT_A), width: `calc(${at(EVENT_B)} - ${at(EVENT_A)} + 4px)` }} />
            <span className="tl-mark gold" style={{ left: at(REVISION) }} />
          </div>
          <input type="range" min={0} max={SPAN} step={1} value={idx}
            onChange={(e) => setDraft(addDays(START, Number(e.target.value)))}
            aria-label="Snapshot date" aria-valuetext={longDate(draft)} />
          <div className="tl-labels" aria-hidden="true">
            <span style={{ left: 0 }}>15 Jan</span>
            {months.map((m) => <span key={m} className="tl-month" style={{ left: at(m) }}>{m === '2025-02-01' ? 'Feb' : m === '2025-03-01' ? 'Mar' : 'Apr'}</span>)}
            <span className="tl-flag gold" style={{ left: at(REVISION) }}>Targets revised</span>
            <span className="tl-flag good" style={{ left: at(EVENT_A) }}>Event</span>
            <span className="tl-end" style={{ right: 0 }}>20 Apr</span>
          </div>
        </div>
        <button className="icon-btn sm" onClick={() => step(7)} aria-label="Forward one week">+7</button>
      </div>
    </div>
  );
}
