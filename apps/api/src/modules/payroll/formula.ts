/*
 * Safe payroll formula language (Layer 8). A hand-written tokenizer + recursive-descent parser —
 * NEVER `eval` / `Function`. Supported:
 *   numbers, "strings" / 'strings', true / false, identifiers (variables / component codes),
 *   + - * / %, unary - + !, comparisons < <= > >= == !=, && ||, ternary c ? a : b,
 *   functions min(a, b, …), max(a, b, …), round(x[, digits]), floor(x), ceil(x), abs(x),
 *   if(condition, then, else).
 * Identifiers resolve only against the supplied variable map (own properties); there is no
 * member access, no assignment, no calls other than the whitelisted functions, and parse depth /
 * length are bounded.
 */

export type FormulaValue = number | string | boolean;

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(position === undefined ? message : `${message} (at ${position})`);
    this.name = 'FormulaError';
  }
}

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'unary'; op: string; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'ternary'; test: Node; then: Node; otherwise: Node }
  | { kind: 'call'; fn: string; args: Node[]; pos: number };

export type FormulaAst = Node;

interface Token {
  type: 'num' | 'str' | 'id' | 'op' | 'eof';
  value: string;
  pos: number;
}

const MAX_LENGTH = 2000;
const MAX_TOKENS = 1000;
const MAX_DEPTH = 64;
const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '!'];
const PUNCT = new Set(['(', ')', ',', '?', ':']);
export const FORMULA_FUNCTIONS = ['min', 'max', 'round', 'floor', 'ceil', 'abs', 'if'] as const;
const FUNCTIONS = new Set<string>(FORMULA_FUNCTIONS);

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new FormulaError(`Formula longer than ${MAX_LENGTH} chars`);
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError('Invalid number', i);
      tokens.push({ type: 'num', value: m[0], pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ type: 'id', value: m[0], pos: i });
      i += m[0].length;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError('Unterminated string', i);
      const value = src.slice(i + 1, end);
      if (value.length > 100) throw new FormulaError('String literal too long', i);
      tokens.push({ type: 'str', value, pos: i });
      i = end + 1;
    } else if (PUNCT.has(c)) {
      tokens.push({ type: 'op', value: c, pos: i });
      i += 1;
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (!op) throw new FormulaError(`Unexpected character "${c}"`, i);
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
    }
    if (tokens.length > MAX_TOKENS) throw new FormulaError('Formula too complex');
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

const LEVELS: string[][] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i]!;
  }
  private next(): Token {
    return this.tokens[this.i++]!;
  }
  private isOp(...values: string[]): boolean {
    const t = this.peek();
    return t.type === 'op' && values.includes(t.value);
  }
  private expect(value: string): void {
    const t = this.next();
    if (t.type !== 'op' || t.value !== value) {
      throw new FormulaError(`Expected "${value}"`, t.pos);
    }
  }
  private enter() {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new FormulaError('Formula nested too deeply');
  }

  parse(): Node {
    const node = this.expression();
    const t = this.peek();
    if (t.type !== 'eof') throw new FormulaError(`Unexpected "${t.value}"`, t.pos);
    return node;
  }

  private expression(): Node {
    this.enter();
    try {
      const test = this.binary(0);
      if (this.isOp('?')) {
        this.next();
        const then = this.expression();
        this.expect(':');
        const otherwise = this.expression();
        return { kind: 'ternary', test, then, otherwise };
      }
      return test;
    } finally {
      this.depth -= 1;
    }
  }

  private binary(level: number): Node {
    if (level >= LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (this.isOp(...LEVELS[level]!)) {
      const op = this.next().value;
      const right = this.binary(level + 1);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp('-', '+', '!')) {
      const op = this.next().value;
      this.enter();
      try {
        return { kind: 'unary', op, arg: this.unary() };
      } finally {
        this.depth -= 1;
      }
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.next();
    if (t.type === 'num') {
      const value = Number(t.value);
      if (!Number.isFinite(value)) throw new FormulaError('Invalid number', t.pos);
      return { kind: 'num', value };
    }
    if (t.type === 'str') return { kind: 'str', value: t.value };
    if (t.type === 'id') {
      const lower = t.value.toLowerCase();
      if (this.isOp('(')) {
        if (!FUNCTIONS.has(lower)) throw new FormulaError(`Unknown function "${t.value}"`, t.pos);
        this.next();
        const args: Node[] = [];
        if (!this.isOp(')')) {
          args.push(this.expression());
          while (this.isOp(',')) {
            this.next();
            args.push(this.expression());
          }
        }
        this.expect(')');
        checkArity(lower, args.length, t.pos);
        return { kind: 'call', fn: lower, args, pos: t.pos };
      }
      if (lower === 'true' || lower === 'false') return { kind: 'bool', value: lower === 'true' };
      return { kind: 'var', name: t.value, pos: t.pos };
    }
    if (t.type === 'op' && t.value === '(') {
      const inner = this.expression();
      this.expect(')');
      return inner;
    }
    throw new FormulaError(
      t.type === 'eof' ? 'Unexpected end of formula' : `Unexpected "${t.value}"`,
      t.pos,
    );
  }
}

function checkArity(fn: string, n: number, pos: number) {
  let ok: boolean;
  if (fn === 'min' || fn === 'max') ok = n >= 1;
  else if (fn === 'round') ok = n === 1 || n === 2;
  else if (fn === 'if') ok = n === 3;
  else ok = n === 1;
  if (!ok) throw new FormulaError(`Wrong number of arguments for ${fn}()`, pos);
}

const CACHE = new Map<string, Node>();

/** Parse (and cache) a formula. Throws `FormulaError` on syntax errors. */
export function parseFormula(src: string): FormulaAst {
  const cached = CACHE.get(src);
  if (cached) return cached;
  const ast = new Parser(tokenize(src)).parse();
  if (CACHE.size > 2000) CACHE.clear();
  CACHE.set(src, ast);
  return ast;
}

/** Identifiers referenced by a formula (its dependencies). */
export function formulaVariables(src: string | FormulaAst): Set<string> {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.kind) {
      case 'var':
        out.add(n.name);
        break;
      case 'unary':
        walk(n.arg);
        break;
      case 'binary':
        walk(n.left);
        walk(n.right);
        break;
      case 'ternary':
        walk(n.test);
        walk(n.then);
        walk(n.otherwise);
        break;
      case 'call':
        n.args.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(typeof src === 'string' ? parseFormula(src) : src);
  return out;
}

const toNumber = (v: FormulaValue, what: string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new FormulaError(`${what} expects a number, got "${v}"`);
};
const truthy = (v: FormulaValue) => (typeof v === 'string' ? v.length > 0 : Boolean(v));

const roundTo = (x: number, digits: number) => {
  const f = 10 ** Math.max(0, Math.min(6, Math.trunc(digits)));
  return Math.round((x + Number.EPSILON) * f) / f;
};

function arithmetic(op: string, a: number, b: number): FormulaValue {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) throw new FormulaError('Division by zero');
      return a / b;
    case '%':
      if (b === 0) throw new FormulaError('Division by zero');
      return a % b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    default:
      throw new FormulaError(`Unknown operator ${op}`);
  }
}

function evalNode(n: Node, vars: Readonly<Record<string, FormulaValue>>): FormulaValue {
  switch (n.kind) {
    case 'num':
    case 'str':
    case 'bool':
      return n.value;
    case 'var': {
      if (!Object.prototype.hasOwnProperty.call(vars, n.name)) {
        throw new FormulaError(`Unknown variable "${n.name}"`, n.pos);
      }
      return vars[n.name]!;
    }
    case 'unary': {
      const v = evalNode(n.arg, vars);
      if (n.op === '!') return !truthy(v);
      const x = toNumber(v, `unary ${n.op}`);
      return n.op === '-' ? -x : x;
    }
    case 'ternary':
      return truthy(evalNode(n.test, vars)) ? evalNode(n.then, vars) : evalNode(n.otherwise, vars);
    case 'binary': {
      if (n.op === '&&') return truthy(evalNode(n.left, vars)) && truthy(evalNode(n.right, vars));
      if (n.op === '||') return truthy(evalNode(n.left, vars)) || truthy(evalNode(n.right, vars));
      const l = evalNode(n.left, vars);
      const r = evalNode(n.right, vars);
      if (n.op === '==' || n.op === '!=') {
        const eq =
          typeof l === 'string' || typeof r === 'string'
            ? String(l) === String(r)
            : toNumber(l, n.op) === toNumber(r, n.op);
        return n.op === '==' ? eq : !eq;
      }
      return arithmetic(n.op, toNumber(l, n.op), toNumber(r, n.op));
    }
    case 'call': {
      if (n.fn === 'if') {
        return truthy(evalNode(n.args[0]!, vars))
          ? evalNode(n.args[1]!, vars)
          : evalNode(n.args[2]!, vars);
      }
      const args = n.args.map((a) => toNumber(evalNode(a, vars), `${n.fn}()`));
      switch (n.fn) {
        case 'min':
          return Math.min(...args);
        case 'max':
          return Math.max(...args);
        case 'round':
          return roundTo(args[0]!, args[1] ?? 0);
        case 'floor':
          return Math.floor(args[0]!);
        case 'ceil':
          return Math.ceil(args[0]!);
        case 'abs':
          return Math.abs(args[0]!);
        default:
          throw new FormulaError(`Unknown function ${n.fn}`, n.pos);
      }
    }
    default:
      throw new FormulaError('Invalid expression');
  }
}

/** Evaluate a formula against a variable map. */
export function evaluateFormula(
  src: string | FormulaAst,
  vars: Readonly<Record<string, FormulaValue>>,
): FormulaValue {
  return evalNode(typeof src === 'string' ? parseFormula(src) : src, vars);
}

/** Evaluate to a finite number (booleans → 1 / 0). */
export function evaluateNumber(
  src: string | FormulaAst,
  vars: Readonly<Record<string, FormulaValue>>,
): number {
  const v = toNumber(evaluateFormula(src, vars), 'Formula');
  if (!Number.isFinite(v)) throw new FormulaError('Formula result is not a finite number');
  return v;
}

/** Syntax check; returns an error message or null. */
export function formulaError(src: string): string | null {
  try {
    parseFormula(src);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : String(e);
  }
}
