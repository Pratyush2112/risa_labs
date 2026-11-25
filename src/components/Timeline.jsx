import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, daysBetween, longDate } from '../lib/format.js';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Pill } from './ui.jsx';

const START = '2025-01-15';
const END = '2025-04-20';
const REVISION = '2025-03-15';
const EVENT_A = '2025-04-12';
const EVENT_B = '2025-04-13';
const SPAN = daysBetween(START, END);
const at = (iso) => `${(daysBetween(START, iso) / SPAN) * 100}%`;
const PRESETS = [['2025-02-15', 'Mid-Feb'], [REVISION, 'Revision'], ['2025-04-11', 'Event eve'], [END, 'Final']];

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
  const months = useMemo(() => [['2025-02-01', 'Feb'], ['2025-03-01', 'Mar'], ['2025-04-01', 'Apr']], []);
  const step = (n) => setDraft((d) => { const x = addDays(d, n); return x < START ? START : x > END ? END : x; });
  const preset = PRESETS.find(([d]) => d === draft)?.[0] ?? '';

  return (
    <div className="flex flex-col gap-2 px-4 pb-3 md:px-6" role="group" aria-label="Snapshot date">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-xs text-muted-foreground">As of</span>
          <span className="text-sm font-semibold tracking-tight whitespace-nowrap">{longDate(draft)}</span>
          <Pill tone={tone} dot>{label}</Pill>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={preset} onValueChange={(v) => v && setDraft(v)} aria-label="Jump to a key date">
            {PRESETS.map(([d, l]) => <ToggleGroupItem key={d} value={d} className="px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">{l}</ToggleGroupItem>)}
          </ToggleGroup>
          <input type="date" min={START} max={END} value={draft} onChange={(e) => e.target.value && setDraft(e.target.value)} aria-label="Pick a date"
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={() => step(-7)} aria-label="Back one week"><ChevronLeft /></Button>
        <div className="relative h-10 flex-1">
          {/* flags above the track */}
          <span className="absolute top-0 -translate-x-1/2 text-[10.5px] font-medium whitespace-nowrap text-brand-foreground" style={{ left: at(REVISION) }}>Targets revised</span>
          <span className="absolute top-0 -translate-x-1/2 text-[10.5px] font-medium whitespace-nowrap text-success" style={{ left: at(EVENT_A) }}>Event</span>
          {/* track */}
          <div className="absolute inset-x-0 top-[19px] h-1 rounded-full bg-muted" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: at(draft) }} />
            <span className="absolute -top-1 h-3 w-0.5 rounded-full bg-brand" style={{ left: at(REVISION) }} />
            <span className="absolute -top-1 h-3 rounded-sm bg-success" style={{ left: at(EVENT_A), width: `calc(${at(EVENT_B)} - ${at(EVENT_A)} + 3px)` }} />
          </div>
          <input type="range" min={0} max={SPAN} step={1} value={idx} className="scrubber absolute inset-x-0 top-[11px] m-0 h-5 w-full"
            onChange={(e) => setDraft(addDays(START, Number(e.target.value)))} aria-label="Snapshot date" aria-valuetext={longDate(draft)} />
          {/* month labels below */}
          <div className="pointer-events-none absolute inset-x-0 top-[28px] text-[10.5px] text-muted-foreground" aria-hidden="true">
            <span className="absolute left-0">15 Jan</span>
            {months.map(([m, l]) => <span key={m} className={cn('absolute hidden -translate-x-1/2 sm:inline')} style={{ left: at(m) }}>{l}</span>)}
            <span className="absolute right-0">20 Apr</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={() => step(7)} aria-label="Forward one week"><ChevronRight /></Button>
      </div>
    </div>
  );
}
