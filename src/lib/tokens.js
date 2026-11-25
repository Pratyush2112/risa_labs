// Theme colours for Recharts props. They are CSS variables, so charts follow light/dark mode.
export const COLOR = {
  ink: 'var(--chart-1)',
  gold: 'var(--chart-2)',
  teal: 'var(--success)',
  amber: 'var(--warning)',
  brick: 'var(--danger)',
  grey: 'var(--chart-5)',
  continue: 'var(--muted-foreground)',
  muted: 'var(--muted-foreground)',
  line: 'var(--border)',
};

// Charts skip their draw-in animation when the person asked for reduced motion.
export const reducedMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
