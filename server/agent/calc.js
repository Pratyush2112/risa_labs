// Safe arithmetic for the analyst: numbers, + - * / ^, parentheses and a few functions.
// Recursive-descent parser — never uses eval or Function.
const FUNCS = {
  round: (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; },
  abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max,
};

export function evaluate(input) {
  if (typeof input !== 'string' || input.length > 300) throw new Error('Expression must be a string under 300 characters');
  const src = input.replace(/(\d),(?=\d)/g, '$1').replace(/₹/g, '');
  const tokens = src.match(/\d+(?:\.\d+)?|[A-Za-z_]+|[()+\-*/^,%]|\S/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t) => { if (next() !== t) throw new Error(`Expected "${t}"`); };

  function primary() {
    const t = next();
    if (t === undefined) throw new Error('Unexpected end of expression');
    if (/^\d/.test(t)) {
      let v = Number(t);
      if (peek() === '%') { next(); v /= 100; }
      return v;
    }
    if (t === '(') { const v = expr(); expect(')'); return v; }
    if (/^[A-Za-z_]+$/.test(t)) {
      const f = FUNCS[t.toLowerCase()];
      if (!f) throw new Error(`Unknown function "${t}"`);
      expect('(');
      const args = [expr()];
      while (peek() === ',') { next(); args.push(expr()); }
      expect(')');
      return f(...args);
    }
    throw new Error(`Unexpected token "${t}"`);
  }
  function unary() {
    if (peek() === '-') { next(); return -unary(); }
    if (peek() === '+') { next(); return unary(); }
    return primary();
  }
  function power() {
    const b = unary();
    if (peek() === '^') { next(); return b ** power(); }
    return b;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = next(); const r = power();
      if (op === '/' && r === 0) throw new Error('Division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = next(); const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }

  const result = expr();
  if (i !== tokens.length) throw new Error(`Unexpected token "${tokens[i]}"`);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return Math.round(result * 1e6) / 1e6;
}
