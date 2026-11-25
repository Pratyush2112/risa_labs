import React, { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts';
import { Panel, Meter, Decision, Kind, Empty } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { getDaily } from '../lib/data.js';
import { inr, inrShort, num, pct, shortDate } from '../lib/format.js';

import { COLOR as C, reducedMotion } from '../lib/tokens.js';

const TONE_COLOR = { Scale: C.teal, Continue: C.continue, Change: C.amber, Stop: C.brick };
const SEVERITY_DOT = { high: 'bg-danger', medium: 'bg-warning', low: 'bg-muted-foreground/50' };
const SEVERITY_LABEL = { high: 'High severity', medium: 'Medium severity', low: 'Low severity' };

const CHART_CONFIG = {
  registrations: { label: 'New registrations', color: C.grey },
  cum: { label: 'Cumulative registrations', color: C.ink },
  visitors: { label: 'Cumulative visitors', color: C.gold },
};
const TICK = { fontSize: 11, fill: 'var(--muted-foreground)' };

// Divider rules for cells laid out in 1 column, then 2, then 4 (funnel) or 3 (readouts).
const CELL_DIVIDERS_4 = 'border-t first:border-t-0 @xl/main:[&:nth-child(2)]:border-t-0 @xl/main:even:border-l @4xl/main:border-t-0 @4xl/main:border-l @4xl/main:first:border-l-0';
// Readouts: 1 column; then spend + cost side by side with the status mix full width; then 3 across.
const READOUT_CELLS = [
  '',
  'border-t @xl/main:border-t-0 @xl/main:border-l',
  'border-t @xl/main:col-span-2 @4xl/main:col-span-1 @4xl/main:border-t-0 @4xl/main:border-l',
];

function Swatch({ color, className }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-[2px]', className)} style={{ background: color }} aria-hidden="true" />;
}

function FunnelRibbon({ d }) {
  const t = d.totals; const tg = d.targets; const frac = d.pace?.elapsed_fraction ?? 1;
  const stages = [
    { key: 'identified', label: 'Identified people', value: t.identified, goal: tg?.identified_goal, att: d.attainment?.identified },
    { key: 'registered', label: 'Registered', value: t.registered, goal: tg?.registration_goal, att: d.attainment?.registered, conv: d.funnel[1].rate, convLabel: 'of campaign-identified' },
    { key: 'confirmed', label: 'Confirmed', value: t.confirmed, conv: d.funnel[2].rate, convLabel: 'of registered' },
    d.preEvent
      ? { key: 'visitors', label: 'Projected visitors', value: d.projectedVisitors, goal: tg?.visitors_goal, att: d.attainment?.visitors, projected: true }
      : { key: 'visitors', label: 'Verified visitors', value: t.visitors, goal: tg?.visitors_goal, att: d.attainment?.visitors, conv: d.funnel[3].rate, convLabel: 'of confirmed attended' },
  ];
  return (
    <div className="grid overflow-hidden rounded-xl border bg-card text-card-foreground @xl/main:grid-cols-2 @4xl/main:grid-cols-4" role="list" aria-label="Attendance funnel">
      {stages.map((s, i) => {
        const isGoal = s.key === 'visitors';
        const showConv = i > 0 && s.conv != null;
        return (
          <div key={s.key} role="listitem"
            className={cn('relative flex min-w-0 flex-col gap-2 px-5 py-4', CELL_DIVIDERS_4, isGoal && 'bg-brand-soft')}>
            {showConv && (
              <div className="absolute top-3.5 left-0 z-10 hidden -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card py-0.5 pr-1 pl-2 text-[11px] font-medium text-foreground shadow-xs @4xl/main:flex"
                title={`${pct(s.conv)} ${s.convLabel}`}>
                <span>{pct(s.conv)}</span><span className="sr-only"> {s.convLabel}</span><Icon name="chevron" size={12} className="text-muted-foreground" />
              </div>
            )}
            <div className={cn('flex min-h-5 items-center justify-between gap-2', showConv && '@4xl/main:pl-6')}>
              <span className="flex min-w-0 items-center text-xs font-medium text-muted-foreground">
                <span className="truncate">{s.label}</span>{s.projected && <Kind kind="assumption" />}
              </span>
              {showConv && (
                <span className="shrink-0 text-[11px] text-muted-foreground @4xl/main:hidden" title={`${pct(s.conv)} ${s.convLabel}`}>
                  <span className="font-medium text-foreground">{pct(s.conv)}</span> {s.convLabel}
                </span>
              )}
            </div>
            <div className={cn('text-3xl leading-none font-semibold tracking-tight', s.projected && 'text-brand-foreground')}>{num(s.value)}</div>
            <div className="mt-auto flex flex-col gap-2 pt-1">
              {s.goal != null ? (
                <>
                  <Meter value={s.att} goal={d.preEvent && !isGoal ? frac : null} tone={isGoal ? 'gold' : 'ink'} label={`${s.label} versus goal`} className={isGoal ? 'bg-brand/20' : undefined} />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                    <span className="text-foreground">{pct(s.att, 0)} <span className="text-muted-foreground">of {num(s.goal)}</span></span>
                    {d.preEvent && !isGoal && <span className="text-muted-foreground">pace {num(s.key === 'identified' ? d.pace.identified_expected : d.pace.registered_expected)}</span>}
                  </div>
                </>
              ) : <div className="text-xs text-muted-foreground">No goal set for this stage</div>}
              {s.projected && <div className="text-xs text-muted-foreground">{num(t.confirmed)} confirmed × {pct(d.settings.confirmed_show_rate, 0)} + {d.settings.expected_walkins} walk-ins</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview({ d, tasks, owners, asOf, ask, refresh, goto, version }) {
  const [daily, setDaily] = useState([]);
  const [taskDraft, setTaskDraft] = useState(null);
  useEffect(() => { let a = true; getDaily(asOf).then((x) => a && setDaily(x)).catch(() => a && setDaily([])); return () => { a = false; }; }, [asOf, version]);

  const t = d.totals; const tg = d.targets;
  const series = useMemo(() => {
    let reg = 0; let vis = 0;
    return daily.map((x) => { reg += x.registrations; vis += x.visitors; return { date: shortDate(x.date), registrations: x.registrations, cum: reg, visitors: vis || null }; });
  }, [daily]);
  const efficiency = d.campaigns.filter((c) => c.outcome_cost != null).map((c) => ({ ...c, cost: Math.round(c.outcome_cost) })).sort((a, b) => a.cost - b.cost);
  const maxCost = Math.max(1, ...efficiency.map((e) => e.cost));
  const statusTotal = Math.max(1, t.interested + t.confirmed + t.cancelled + t.waitlisted);
  const statusParts = [
    ['confirmed', 'Confirmed', C.ink], ['interested', 'Interested', C.grey],
    ['cancelled', 'Cancelled', C.brick], ['waitlisted', 'Waitlisted', 'var(--chart-3)'],
  ];

  return (
    <div className="flex flex-col gap-4">
      <FunnelRibbon d={d} />

      <div className="grid overflow-hidden rounded-xl border bg-card text-card-foreground @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
        <div className={cn('flex min-w-0 flex-col gap-1.5 px-5 py-4', READOUT_CELLS[0])}>
          <div className="text-xs font-medium text-muted-foreground">Net spend</div>
          <div className="text-2xl font-semibold tracking-tight">{inr(t.spend)}</div>
          {tg && <div className="mt-auto flex flex-col gap-2 pt-1">
            <Meter value={d.attainment.budget_used} goal={d.preEvent ? d.pace.elapsed_fraction : null} label="Spend versus approved budget" />
            <div className="text-xs text-muted-foreground">{pct(d.attainment.budget_used, 0)} of {inr(tg.budget_inr)} approved{d.preEvent ? `, ${pct(d.pace.elapsed_fraction, 0)} of the window gone` : ''}</div>
          </div>}
        </div>
        <div className={cn('flex min-w-0 flex-col gap-1.5 px-5 py-4', READOUT_CELLS[1])}>
          <div className="text-xs font-medium text-muted-foreground">{d.preEvent ? 'Cost per confirmed registration' : 'Cost per verified visitor'}</div>
          <div className="text-2xl font-semibold tracking-tight">{inr(d.preEvent ? d.blendedOutcomeCost : d.blendedCostPerVisitor)}</div>
          <div className="mt-auto pt-1 text-xs text-muted-foreground">{d.preEvent ? 'Campaign spend ÷ campaign-attributed confirmations' : `All spend ÷ ${num(t.visitors)} visitors, including ${num(t.visitors_unattributed)} walk-ins`}</div>
        </div>
        <div className={cn('flex min-w-0 flex-col gap-1.5 px-5 py-4', READOUT_CELLS[2])}>
          <div className="text-xs font-medium text-muted-foreground">Registration status mix</div>
          <div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full bg-muted" role="img" aria-label={`Confirmed ${t.confirmed}, interested ${t.interested}, cancelled ${t.cancelled}, waitlisted ${t.waitlisted}`}>
            {statusParts.map(([k, , col]) => (
              <span key={k} className="h-full" style={{ width: `${(t[k] / statusTotal) * 100}%`, background: col }} />
            ))}
          </div>
          <div className="mt-auto flex flex-wrap gap-x-5 gap-y-1 pt-2 text-xs">
            {statusParts.map(([k, label, col]) => (
              <span key={k} className="flex items-center gap-1.5 text-muted-foreground">
                <Swatch color={col} />{label}<span className="font-medium text-foreground">{num(t[k])}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Registrations over time" className="min-w-0"
          aside={tg && <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-foreground/60" aria-hidden="true" />{num(tg.registration_goal)} goal ({tg.target_version})</span>}>
          {series.length === 0 ? <Empty>No activity yet.</Empty> : (
            <>
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[260px] w-full">
                <ComposedChart data={series} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={TICK} tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="l" tickFormatter={num} tick={TICK} tickLine={false} axisLine={false} width={36} />
                  <YAxis yAxisId="r" orientation="right" tickFormatter={num} tick={TICK} tickLine={false} axisLine={false} width={44} />
                  <ChartTooltip cursor={{ fill: 'var(--muted)' }} content={<ChartTooltipContent className="min-w-[12rem]" />} />
                  <Bar yAxisId="l" dataKey="registrations" name="registrations" fill="var(--color-registrations)" radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                  <Line yAxisId="r" dataKey="cum" name="cum" stroke="var(--color-cum)" dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
                  <Line yAxisId="r" dataKey="visitors" name="visitors" stroke="var(--color-visitors)" dot={false} strokeWidth={2} connectNulls isAnimationActive={!reducedMotion} />
                  {tg && <ReferenceLine yAxisId="r" y={tg.registration_goal} stroke="var(--foreground)" strokeDasharray="4 4" strokeOpacity={0.5} />}
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {Object.entries(CHART_CONFIG).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <Swatch color={v.color} className={k === 'registrations' ? '' : 'h-0.5 w-3 rounded-full'} />{v.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="Needs attention" className="min-w-0" aside={<span>{d.alerts.length} item{d.alerts.length === 1 ? '' : 's'}</span>} pad={false}>
          {d.alerts.length === 0 ? <div className="px-5 pb-5"><Empty>Nothing breaks a rule on this date.</Empty></div> : (
            <ul className="divide-y border-t">
              {d.alerts.slice(0, 6).map((a, i) => (
                <li key={i} className="flex gap-3 px-5 py-3">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', SEVERITY_DOT[a.severity] || SEVERITY_DOT.low)} role="img" aria-label={SEVERITY_LABEL[a.severity] || `${a.severity} severity`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{a.title}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.detail}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button variant="outline" size="xs" onClick={() => ask(`Diagnose this alert with the data and recommend what to do: "${a.title}". ${a.detail}`)}>
                        <Icon name="chat" size={12} />Ask the analyst
                      </Button>
                      <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setTaskDraft({
                        title: `${a.title.replace(/:.*$/, '')}: follow up`, description: a.detail, campaign_id: a.campaign_id || '',
                        owner_id: d.campaigns.find((c) => c.campaign_id === a.campaign_id)?.owner_id || '', priority: a.severity === 'high' ? 'high' : 'medium',
                      })}>
                        <Icon name="plus" size={12} />Create task
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={d.preEvent ? 'Cost per confirmed registration, by campaign' : 'Cost per verified attendee, by campaign'}
        aside={<Button variant="ghost" size="sm" className="-my-1 -mr-2 h-7 text-xs" onClick={() => goto('campaigns')}>Open campaigns <Icon name="arrowRight" size={14} /></Button>}>
        {efficiency.length === 0 ? <Empty>Not enough outcomes yet to compare campaigns.</Empty> : (
          <div className="flex flex-col gap-2.5">
            {efficiency.map((c) => (
              <div key={c.campaign_id} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm @xl/main:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_4rem_5.5rem]">
                <div className="truncate font-medium" title={c.campaign_name}>{c.campaign_name}</div>
                <div className="relative h-3 rounded-sm bg-muted">
                  <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(c.cost / maxCost) * 100}%`, background: TONE_COLOR[c.decision] || C.continue }} />
                  {d.blendedOutcomeCost != null && <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${(d.blendedOutcomeCost / maxCost) * 100}%` }} title={`Blended ${inr(d.blendedOutcomeCost)}`} />}
                </div>
                <div className="text-right font-medium">{inrShort(c.cost)}</div>
                <div className="hidden @xl/main:block"><Decision value={c.decision} title={c.reason} /></div>
              </div>
            ))}
            <p className="mt-2 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              Vertical rule: blended {inr(d.blendedOutcomeCost)}. Colour and label follow the decision rules (thresholds in Data Lab). {d.campaigns.length - efficiency.length > 0 && `${d.campaigns.length - efficiency.length} campaign(s) have no outcomes yet.`}
            </p>
          </div>
        )}
      </Panel>

      {taskDraft && <TaskModal initial={taskDraft} campaigns={d.campaigns} owners={owners} onClose={() => setTaskDraft(null)} onSaved={() => { setTaskDraft(null); refresh(); }} />}
    </div>
  );
}
