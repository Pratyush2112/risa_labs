import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { Panel, Meter, Decision, Kind, Empty } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import TaskModal from '../components/TaskModal.jsx';
import { getDaily } from '../lib/data.js';
import { inr, inrShort, num, pct, shortDate } from '../lib/format.js';

import { COLOR as C, reducedMotion } from '../lib/tokens.js';

const TONE_COLOR = { Scale: C.teal, Continue: C.continue, Change: C.amber, Stop: C.brick };

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-h">{label}</div>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey}><i style={{ background: p.color }} />{p.name}<b>{num(p.value)}</b></div>
      ))}
    </div>
  );
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
    <div className="ribbon" role="list" aria-label="Attendance funnel">
      {stages.map((s, i) => (
        <div key={s.key} className={`ribbon-cell ${s.key === 'visitors' ? 'is-goal' : ''} ${s.projected ? 'is-projected' : ''}`} role="listitem">
          {i > 0 && s.conv != null && (
            <div className="ribbon-conv" title={`${pct(s.conv)} ${s.convLabel}`}>
              <span>{pct(s.conv)}</span><Icon name="chevron" size={14} />
            </div>
          )}
          <div className="ribbon-label">{s.label}{s.projected && <Kind kind="assumption" />}</div>
          <div className="ribbon-value">{num(s.value)}</div>
          {s.goal != null ? (
            <>
              <Meter value={s.att} goal={d.preEvent && s.key !== 'visitors' ? frac : null} tone={s.key === 'visitors' ? 'gold' : 'ink'} label={`${s.label} versus goal`} />
              <div className="ribbon-goal">
                <span>{pct(s.att, 0)} of {num(s.goal)}</span>
                {d.preEvent && s.key !== 'visitors' && <span className="muted">pace {num(s.key === 'identified' ? d.pace.identified_expected : d.pace.registered_expected)}</span>}
              </div>
            </>
          ) : <div className="ribbon-goal muted">No goal set for this stage</div>}
          {s.projected && <div className="ribbon-note">{num(t.confirmed)} confirmed × {pct(d.settings.confirmed_show_rate, 0)} + {d.settings.expected_walkins} walk-ins</div>}
        </div>
      ))}
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

  return (
    <div className="stack">
      <FunnelRibbon d={d} />

      <div className="readouts">
        <div className="readout">
          <div className="readout-l">Net spend</div>
          <div className="readout-v">{inr(t.spend)}</div>
          {tg && <><Meter value={d.attainment.budget_used} goal={d.preEvent ? d.pace.elapsed_fraction : null} label="Spend versus approved budget" />
            <div className="readout-s">{pct(d.attainment.budget_used, 0)} of {inr(tg.budget_inr)} approved{d.preEvent ? `, ${pct(d.pace.elapsed_fraction, 0)} of the window gone` : ''}</div></>}
        </div>
        <div className="readout">
          <div className="readout-l">{d.preEvent ? 'Cost per confirmed registration' : 'Cost per verified visitor'}</div>
          <div className="readout-v">{inr(d.preEvent ? d.blendedOutcomeCost : d.blendedCostPerVisitor)}</div>
          <div className="readout-s">{d.preEvent ? 'Campaign spend ÷ campaign-attributed confirmations' : `All spend ÷ ${num(t.visitors)} visitors, including ${num(t.visitors_unattributed)} walk-ins`}</div>
        </div>
        <div className="readout">
          <div className="readout-l">Registration status mix</div>
          <div className="stackbar" role="img" aria-label={`Confirmed ${t.confirmed}, interested ${t.interested}, cancelled ${t.cancelled}, waitlisted ${t.waitlisted}`}>
            {[['confirmed', C.ink], ['interested', C.grey], ['cancelled', C.brick], ['waitlisted', C.gold]].map(([k, col]) => (
              <span key={k} style={{ width: `${(t[k] / statusTotal) * 100}%`, background: col }} />
            ))}
          </div>
          <div className="legend">
            <span><i style={{ background: C.ink }} />Confirmed {num(t.confirmed)}</span><span><i style={{ background: C.grey }} />Interested {num(t.interested)}</span>
            <span><i style={{ background: C.brick }} />Cancelled {num(t.cancelled)}</span><span><i style={{ background: C.gold }} />Waitlisted {num(t.waitlisted)}</span>
          </div>
        </div>
      </div>

      <div className="split">
        <Panel title="Registrations over time" aside={tg && <span className="muted small">Dashed line: {num(tg.registration_goal)} goal ({tg.target_version})</span>}>
          {series.length === 0 ? <Empty>No activity yet.</Empty> : (
            <ResponsiveContainer width="100%" height={268}>
              <ComposedChart data={series} margin={{ top: 10, right: 6, left: -14, bottom: 0 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.line }} interval={Math.max(0, Math.floor(series.length / 7))} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: C.muted }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(23,32,51,0.04)' }} />
                <Bar yAxisId="l" dataKey="registrations" name="New registrations" fill={C.grey} radius={[2, 2, 0, 0]} isAnimationActive={!reducedMotion} />
                <Line yAxisId="r" dataKey="cum" name="Cumulative registrations" stroke={C.ink} dot={false} strokeWidth={2} isAnimationActive={!reducedMotion} />
                <Line yAxisId="r" dataKey="visitors" name="Cumulative visitors" stroke={C.gold} dot={false} strokeWidth={2} connectNulls isAnimationActive={!reducedMotion} />
                {tg && <ReferenceLine yAxisId="r" y={tg.registration_goal} stroke={C.ink} strokeDasharray="4 4" strokeOpacity={0.5} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Needs attention" aside={<span className="muted small">{d.alerts.length} item{d.alerts.length === 1 ? '' : 's'}</span>} pad={false}>
          {d.alerts.length === 0 ? <div className="pad"><Empty>Nothing breaks a rule on this date.</Empty></div> : (
            <ul className="attention">
              {d.alerts.slice(0, 6).map((a, i) => (
                <li key={i} className={`att sev-${a.severity}`}>
                  <div className="att-t">{a.title}</div>
                  <div className="att-d">{a.detail}</div>
                  <div className="att-a">
                    <button className="link" onClick={() => ask(`Diagnose this alert with the data and recommend what to do: "${a.title}". ${a.detail}`)}>Ask the analyst</button>
                    <button className="link" onClick={() => setTaskDraft({
                      title: `${a.title.replace(/:.*$/, '')}: follow up`, description: a.detail, campaign_id: a.campaign_id || '',
                      owner_id: d.campaigns.find((c) => c.campaign_id === a.campaign_id)?.owner_id || '', priority: a.severity === 'high' ? 'high' : 'medium',
                    })}>Create task</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={d.preEvent ? 'Cost per confirmed registration, by campaign' : 'Cost per verified attendee, by campaign'}
        aside={<button className="link" onClick={() => goto('campaigns')}>Open campaigns <Icon name="arrowRight" size={14} /></button>}>
        {efficiency.length === 0 ? <Empty>Not enough outcomes yet to compare campaigns.</Empty> : (
          <div className="effbars">
            {efficiency.map((c) => (
              <div key={c.campaign_id} className="effrow">
                <div className="eff-name">{c.campaign_name}</div>
                <div className="eff-track">
                  <span className="eff-bar" style={{ width: `${(c.cost / maxCost) * 100}%`, background: TONE_COLOR[c.decision] || C.continue }} />
                  {d.blendedOutcomeCost != null && <span className="eff-blend" style={{ left: `${(d.blendedOutcomeCost / maxCost) * 100}%` }} title={`Blended ${inr(d.blendedOutcomeCost)}`} />}
                </div>
                <div className="eff-val">{inrShort(c.cost)}</div>
                <Decision value={c.decision} title={c.reason} />
              </div>
            ))}
            <div className="eff-foot muted small">
              Vertical rule: blended {inr(d.blendedOutcomeCost)}. Colour and label follow the decision rules (thresholds in Data Lab). {d.campaigns.length - efficiency.length > 0 && `${d.campaigns.length - efficiency.length} campaign(s) have no outcomes yet.`}
            </div>
          </div>
        )}
      </Panel>

      {taskDraft && <TaskModal initial={taskDraft} campaigns={d.campaigns} owners={owners} onClose={() => setTaskDraft(null)} onSaved={() => { setTaskDraft(null); refresh(); }} />}
    </div>
  );
}
