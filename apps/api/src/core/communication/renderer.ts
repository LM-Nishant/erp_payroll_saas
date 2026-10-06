/*
 * Minimal, safe handlebars-style renderer for message templates.
 *
 *   {{ name }}            escaped value (HTML-escaped when rendering HTML)
 *   {{{ html }}}          raw value (HTML only; never use for user-supplied values)
 *   {{#if flag}}…{{else}}…{{/if}}   truthy section (nestable)
 *   {{ user.name }}       dotted paths
 *
 * No helpers, partials, prototype access or code execution. Missing variables render empty.
 */

type Vars = Record<string, unknown>;

const TOKEN =
  /\{\{\{\s*([A-Za-z_][\w.]*)\s*\}\}\}|\{\{\s*(#if|\/if|else)?\s*([A-Za-z_][\w.]*)?\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function lookup(vars: Vars, path: string): unknown {
  let cur: unknown = vars;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return '';
  return String(value);
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return !!value;
}

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; raw: boolean }
  | { t: 'if'; path: string; then: Node[]; else: Node[] };

export class TemplateSyntaxError extends Error {}

function parse(source: string): Node[] {
  const root: Node[] = [];
  const stack: Array<{ node: Extract<Node, { t: 'if' }>; inElse: boolean }> = [];
  const out = () => {
    const top = stack[stack.length - 1];
    if (!top) return root;
    return top.inElse ? top.node.else : top.node.then;
  };
  let last = 0;
  for (const m of source.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out().push({ t: 'text', v: source.slice(last, index) });
    last = index + m[0].length;
    const [, rawPath, keyword, path] = m;
    if (rawPath) {
      out().push({ t: 'var', path: rawPath, raw: true });
    } else if (keyword === '#if') {
      if (!path) throw new TemplateSyntaxError('{{#if}} needs a variable');
      const node: Extract<Node, { t: 'if' }> = { t: 'if', path, then: [], else: [] };
      out().push(node);
      stack.push({ node, inElse: false });
    } else if (keyword === 'else' && !path) {
      const top = stack[stack.length - 1];
      if (!top || top.inElse) throw new TemplateSyntaxError('Unexpected {{else}}');
      top.inElse = true;
    } else if (keyword === '/if' && !path) {
      if (!stack.pop()) throw new TemplateSyntaxError('Unexpected {{/if}}');
    } else if (!keyword && path) {
      out().push({ t: 'var', path, raw: false });
    } else {
      throw new TemplateSyntaxError(`Invalid tag ${m[0]}`);
    }
  }
  if (stack.length > 0) throw new TemplateSyntaxError('Unclosed {{#if}}');
  if (last < source.length) out().push({ t: 'text', v: source.slice(last) });
  return root;
}

function renderNodes(nodes: Node[], vars: Vars, html: boolean): string {
  let s = '';
  for (const node of nodes) {
    if (node.t === 'text') s += node.v;
    else if (node.t === 'var') {
      const v = stringify(lookup(vars, node.path));
      s += html && !node.raw ? escapeHtml(v) : v;
    } else {
      s += renderNodes(truthy(lookup(vars, node.path)) ? node.then : node.else, vars, html);
    }
  }
  return s;
}

/** Render `source` with `vars`. `html: true` escapes `{{x}}` output for HTML. */
export function renderTemplate(source: string, vars: Vars, options: { html?: boolean } = {}) {
  return renderNodes(parse(source), vars, options.html ?? false);
}

/** Throws TemplateSyntaxError for malformed templates. */
export function validateTemplate(source: string): void {
  parse(source);
}

/** Distinct variable paths referenced by a template (for the editor / documentation). */
export function extractVariables(...sources: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.t === 'var') found.add(n.path);
      else if (n.t === 'if') {
        found.add(n.path);
        walk(n.then);
        walk(n.else);
      }
    }
  };
  for (const src of sources) if (src) walk(parse(src));
  return [...found].sort();
}
