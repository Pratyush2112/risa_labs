import React, { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import { DECISION_TONE } from '../lib/format.js';

export const Panel = ({ title, aside, children, className = '', pad = true }) => (
  <section className={`panel ${pad ? '' : 'flush'} ${className}`}>
    {(title || aside) && (
      <header className="panel-h">
        {title && <h2>{title}</h2>}
        {aside && <div className="panel-aside">{aside}</div>}
      </header>
    )}
    {children}
  </section>
);

export const Decision = ({ value, title }) => (
  <span className={`pill tone-${DECISION_TONE[value] || 'mute'}`} title={title}>{value}</span>
);

export const Pill = ({ tone = 'mute', children, title }) => <span className={`pill tone-${tone}`} title={title}>{children}</span>;

export const Kind = ({ kind }) => {
  const map = { assumption: ['tone-gold', 'Assumption'], threshold: ['tone-mute', 'Threshold'], source: ['tone-good', 'Source data'], simulated: ['tone-gold', 'Simulated'] };
  const [cls, label] = map[kind] || map.source;
  return <span className={`kind ${cls}`}>{label}</span>;
};

export const Meter = ({ value, goal, tone = 'ink', label }) => {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <div className={`meter m-${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <span className="meter-fill" style={{ width: `${v * 100}%` }} />
      {goal != null && <span className="meter-goal" style={{ left: `${Math.min(1, goal) * 100}%` }} />}
    </div>
  );
};

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="panel-h">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint, className = '' }) => (
  <label className={`field ${className}`}>
    <span className="field-l">{label}</span>
    {children}
    {hint && <span className="field-h">{hint}</span>}
  </label>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Notice = ({ tone = 'bad', children }) => (children ? <div className={`notice n-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div> : null);
export const Skeleton = ({ h = 120 }) => <div className="skeleton" style={{ height: h }} aria-hidden="true" />;
