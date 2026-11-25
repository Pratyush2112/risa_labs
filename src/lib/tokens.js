// Colour tokens for places CSS variables cannot reach (Recharts SVG props, inline swatches).
// Keep in step with :root in styles.css.
export const COLOR = {
  ink: '#172033',
  muted: '#5B6578', // axis text: passes AA on white
  line: '#E3E6EB',
  grey: '#CDD2DA', // neutral bars and "interested"
  gold: '#E5A00D',
  teal: '#0E7466',
  amber: '#955800',
  brick: '#B3261E',
  continue: '#8F98A8', // a bar fill, not text
};

// Charts skip their draw-in animation when the person asked for reduced motion.
export const reducedMotion = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
