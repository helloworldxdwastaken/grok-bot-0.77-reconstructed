#!/usr/bin/env node
// Rebuild the internal rpc-edge IPC contracts as TypeScript from a recovered app.
// Electron main declares every edge as `Lo("gateway", { methods: { name: k().args({...}) | k().noArgs } })`
// with argument validators built from `(0, m.rpcString)()`, `(0, m.rpcObject)({...})`, ... combinators.
// Return types and event payloads are compile-time only, so they are not in the bundle.
// Usage: node scripts/recover-ipc.mjs recovered/<version>   (writes recovered/<version>/ipc/)
import fs from 'node:fs';
import path from 'node:path';

const ID = '[\\w$]+';
const esc = (s) => s.replace(/\$/g, '\\$');

// Index just past the bracket that matches text[open], skipping string literals.
function closeOf(text, open) {
  const pairs = { '[': ']', '{': '}', '(': ')' };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      if (!stack.length) return i + 1;
    } else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ']' || ch === '}' || ch === ')') {
      if (stack.pop() !== ch) throw new Error(`unbalanced ${ch} at ${i}`);
      if (!stack.length) return i + 1;
    }
  }
  throw new Error(`unbalanced ${text[open]} at ${open}`);
}

// Split on commas at bracket depth 0, stopping at an unmatched closer, ";" or end of text.
function splitTop(text, start = 0) {
  const parts = [];
  let from = start;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`' || ch === '(' || ch === '[' || ch === '{') { i = closeOf(text, i) - 1; continue; }
    if (ch === ',') { parts.push(text.slice(from, i)); from = i + 1; }
    if (ch === ')' || ch === ']' || ch === '}' || ch === ';') return { parts: [...parts, text.slice(from, i)], end: i };
  }
  return { parts: [...parts, text.slice(from)], end: text.length };
}
const items = (body) => splitTop(body).parts.map((s) => s.trim()).filter(Boolean);
const inner = (s) => s.slice(1, -1);

// Parse one validator expression into a small tree. Anything unrecognised becomes {kind: 'raw'}.
export function parseExpr(s) {
  // Prettier wraps long values as `(\n  expr,\n)`.
  s = s.trim().replace(/^\((.*)\)$/s, (m, x) => (closeOf(m, 0) === m.length ? x : m)).trim().replace(/,$/, '');
  let m;
  if (/^"(?:[^"\\]|\\.)*"$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)) return { kind: 'literal', value: JSON.parse(s) };
  if (/^`[^`]*`$/.test(s)) return { kind: 'literal', value: inner(s) };
  if (s === '!0' || s === '!1') return { kind: 'literal', value: s === '!0' };
  if (s === 'null' || s === 'void 0') return { kind: 'literal', value: null };
  if ((m = s.match(new RegExp(`^${ID}\\(\\)\\.noArgs$`)))) return { kind: 'noArgs' };
  if ((m = s.match(new RegExp(`^${ID}\\(\\)\\.args\\(`))) && closeOf(s, m[0].length - 1) === s.length)
    return { kind: 'args', schema: parseExpr(inner(s.slice(m[0].length - 1))) };
  if (s[0] === '{' && closeOf(s, 0) === s.length) {
    const fields = [];
    for (const it of items(inner(s))) {
      if (it.startsWith('...')) { fields.push({ spread: parseExpr(it.slice(3)) }); continue; }
      const c = it.match(/^("(?:[^"\\]|\\.)*"|[\w$]+)\s*:\s*/s);
      if (c) fields.push({ name: c[1][0] === '"' ? JSON.parse(c[1]) : c[1], value: parseExpr(it.slice(c[0].length)) });
      else fields.push({ name: it, value: parseExpr(it) }); // shorthand
    }
    return { kind: 'object', fields };
  }
  if (s[0] === '[' && closeOf(s, 0) === s.length) return { kind: 'array', items: items(inner(s)).map(parseExpr) };
  // `(0, m.rpcString)(...)` or `name(...)`
  if ((m = s.match(new RegExp(`^(?:\\(0, ${ID}\\.(${ID})\\)|(${ID}))\\(`))) && closeOf(s, m[0].length - 1) === s.length)
    return { kind: 'call', fn: m[1] ?? m[2], args: items(inner(s.slice(m[0].length - 1))).map(parseExpr) };
  if ((m = s.match(new RegExp(`^${ID}(\\.${ID})?$`)))) return { kind: 'ref', name: s };
  return { kind: 'raw', src: s };
}

// Resolves minified names against the bundle(s): `X = expr`, `function X() { ... }`, `get NAME() { return X; }`.
export function resolver(texts) {
  const cache = new Map();
  const find = (re) => {
    for (const text of texts) {
      const m = text.match(re);
      if (m) return { text, m };
    }
  };
  // Minified names are reused across scopes, so take the definition nearest to the use (`pos` in texts[0]).
  const valueOf = (name, pos = 0) => {
    const dot = name.indexOf('.');
    if (dot !== -1) {
      let obj = valueOf(name.slice(0, dot), pos);
      for (let i = 0; obj?.kind === 'ref' && i < 10; i++) obj = valueOf(obj.name, obj.pos ?? pos);
      // `edge.methods` reads the declaration object passed to the edge factory.
      if (obj?.kind === 'call' && obj.args.at(-1)?.kind === 'object') obj = Object.assign(obj.args.at(-1), { pos: obj.pos });
      const field = obj?.kind === 'object' && obj.fields.find((f) => f.name === name.slice(dot + 1));
      if (field) return Object.assign(field.value, { pos: field.value.pos ?? obj.pos });
      const g = find(new RegExp(`get ${esc(name.slice(dot + 1))}\\(\\) \\{\\s*return (${ID});`));
      return g && valueIn(g.m[1], g.text, g.text === texts[0] ? g.m.index : 0);
    }
    return valueIn(name, texts[0], pos) ?? texts.slice(1).map((t) => valueIn(name, t, 0)).find(Boolean);
  };
  const valueIn = (name, text, pos) => {
    const key = `${texts.indexOf(text)}:${name}`;
    const defs = cache.get(key) ?? cache.set(key, [...text.matchAll(new RegExp(`(?:^|[\\s,(;])${esc(name)} = (?!=)`, 'gm'))]
      .map((m) => m.index + m[0].length)).get(key);
    if (!defs.length) return undefined;
    const start = defs.reduce((a, b) => (Math.abs(b - pos) < Math.abs(a - pos) ? b : a));
    return Object.assign(parseExpr(splitTop(text, start).parts[0]), { pos: start });
  };
  // A helper whose body is a single `return expr;`, e.g. `function re() { return Cr("agent id", ...) }`.
  const fnBody = (name) => {
    const f = find(new RegExp(`function ${esc(name)}\\(([^)]*)\\) \\{\\s*return `));
    if (!f) return undefined;
    const start = f.m.index + f.m[0].length;
    const { parts, end } = splitTop(f.text, start);
    if (parts.length !== 1 || f.text[end] !== ';') return undefined;
    return { params: f.m[1].split(',').map((p) => p.trim()).filter(Boolean), expr: parseExpr(parts[0]), src: parts[0] };
  };
  return { valueOf, fnBody };
}

const SIMPLE = { rpcString: 'string', rpcNumber: 'number', rpcBoolean: 'boolean', rpcUnknown: 'unknown', rpcUint8Array: 'Uint8Array' };
const prop = (n) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));

// Custom validators carry only a human label and a predicate; infer the obvious primitive from either.
function labelled(label, check = '') {
  let base = 'unknown';
  if (/typeof \w+ == "string"/.test(check) || /\b(string|text|id|path|url|uri|name|code)\b/i.test(label)) base = 'string';
  else if (/typeof \w+ == "number"/.test(check) || /\b(integer|number|epoch ms)\b/i.test(label)) base = 'number';
  return `${base}${/^null or /.test(label) ? ' | null' : ''} /* ${label.replace(/\*\//g, '* /')} */`;
}

// Follow refs to their definition; the returned resolver looks names up near that definition.
function deref(node, r) {
  const seen = new Set();
  while (node?.kind === 'ref' && !seen.has(node.name)) {
    seen.add(node.name);
    const v = r.valueOf(node.name, r.pos);
    if (!v) return { node: undefined, r };
    if (v.pos !== undefined) r = { ...r, pos: v.pos };
    node = v;
  }
  return { node, r };
}

// Render a validator tree as a TypeScript type.
export function toType(node, r, ind = '', seen = new Set()) {
  const t = (n) => toType(n, r, ind, seen);
  switch (node.kind) {
    case 'literal': return JSON.stringify(node.value);
    case 'object': return objectType(node, r, ind, seen);
    case 'ref': {
      if (seen.has(node.name)) return `unknown /* recursive ${node.name} */`;
      const d = deref(node, r);
      if (!d.node) return `unknown /* unresolved ${node.name} */`;
      return toType(d.node, d.r, ind, new Set(seen).add(node.name));
    }
    case 'array': return node.items.map(t).join(' | ') || 'never';
    case 'call': {
      const [a, b] = node.args;
      if (SIMPLE[node.fn]) return SIMPLE[node.fn];
      switch (node.fn) {
        case 'rpcLiteral': return t(a);
        case 'rpcOptional': return `${t(a)} | undefined`;
        case 'rpcNullable': return `${t(a)} | null`;
        case 'rpcArray': return `Array<${t(a)}>`;
        case 'rpcRecord': return `Record<string, ${t(a)}>`;
        case 'rpcUnion': return node.args.map(t).join(' | ');
        case 'rpcObject': return a ? objectType(a, r, ind, seen) : '{}';
      }
      // Custom validators are `helper("label", check)`; `Ot("label", values)` is a literal union.
      if (a?.kind === 'literal' && typeof a.value === 'string') {
        if (b) {
          const d = deref(b, r);
          const vals = d.node?.kind === 'array' && d.node.items.map((x) => deref(x, d.r).node);
          if (vals?.length && vals.every((x) => x?.kind === 'literal')) return vals.map((x) => JSON.stringify(x.value)).join(' | ');
        }
        return labelled(a.value, b?.src);
      }
      // Inline a single-return helper, binding its parameters to the call's arguments.
      const f = r.fnBody(node.fn);
      if (f && !seen.has(node.fn + '()')) {
        // `wrap(schema, transform)` helpers read `e.expects`/`e.check`: the wire type is the schema's.
        if (f.params[0] && f.src.includes(`${f.params[0]}.expects`)) return t(a);
        const env = new Map(f.params.map((p, i) => [p, node.args[i]]));
        const rr = { ...r, valueOf: (n, p) => (env.has(n) ? env.get(n) : r.valueOf(n, p)) };
        if (f.expr.kind !== 'raw') return toType(f.expr, rr, ind, new Set(seen).add(node.fn + '()'));
      }
      return `unknown /* ${node.fn}(...) */`;
    }
    default: return `unknown /* ${(node.src ?? node.kind).replace(/\s+/g, ' ').slice(0, 60)} */`;
  }
}

function objectType(node, r, ind, seen) {
  if (node.kind !== 'object') return toType(node, r, ind, seen);
  const lines = [...objectEntries(node, r, ind, seen).values()];
  return lines.length ? `{\n${lines.join('\n')}\n${ind}}` : '{}';
}

// Property lines keyed by name; later keys win, as in a JS object literal with spreads.
function objectEntries(node, r, ind, seen) {
  const out = new Map();
  const add = (k, l) => { out.delete(k); out.set(k, l); };
  const into = ind + '  ';
  for (const f of node.fields) {
    if (f.spread) {
      const { node: v, r: vr } = deref(f.spread, r);
      const body = v?.kind === 'call' && v.fn === 'rpcObject' ? deref(v.args[0], vr) : { node: v, r: vr };
      if (body.node?.kind === 'object') for (const [k, l] of objectEntries(body.node, body.r, ind, seen)) add(k, l);
      else add(Symbol(), `${into}// ...${toType(f.spread, r, into, seen)}`);
      continue;
    }
    const opt = f.value.kind === 'call' && f.value.fn === 'rpcOptional';
    add(f.name, `${into}${prop(f.name)}${opt ? '?' : ''}: ${toType(opt ? f.value.args[0] : f.value, r, into, seen)};`);
  }
  return out;
}

// Every `<factory>("edge", { methods: {...} })`, where the factory returns `{ kind: "rpc-edge", edge, ... }`.
export function findEdges(text) {
  const factories = [...text.matchAll(new RegExp(`function (${ID})\\(${ID}, ${ID}\\) \\{\\s*return Object\\.freeze\\(\\{\\s*kind: "rpc-edge"`, 'g'))].map((m) => m[1]);
  const edges = [];
  for (const f of factories) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w$.])${esc(f)}\\("([\\w-]+)", \\{`, 'g'))) {
      const open = m.index + m[0].length - 1;
      const decl = parseExpr(text.slice(open, closeOf(text, open)));
      const field = (n) => decl.fields.find((x) => x.name === n)?.value;
      edges.push({ edge: m[1], pos: m.index, methods: field('methods'), hasEvents: field('events') !== undefined });
    }
  }
  return edges;
}
// Method entries of a `methods` object, following `...spread` of shared method groups.
function methodNames(methods, r) {
  const d = deref(methods, r);
  return (d.node?.fields ?? []).flatMap((f) => (f.spread ? methodNames(f.spread, d.r) : [{ ...f, r: d.r }]));
}

const pascal = (s) => s.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

export function renderEdge(e, r0, where) {
  const name = pascal(e.edge);
  const r = { ...r0, pos: e.pos };
  const methods = methodNames(e.methods, r).filter((f) => !f.spread);
  const sig = [];
  const table = [];
  for (const { name: m, value, r: mr } of methods) {
    const { node, r: vr } = deref(value, mr);
    const v = node ?? value;
    if (v.kind === 'noArgs') {
      sig.push(`  ${m}(): Promise<unknown>;`);
      table.push(`  ${m}: { args: "none" },`);
    } else {
      const ty = v.kind === 'args' ? objectType(deref(v.schema, vr).node ?? v.schema, deref(v.schema, vr).r, '  ', new Set()) : `unknown /* ${v.kind} */`;
      sig.push(`  ${m}(args: ${ty}): Promise<unknown>;`);
      table.push(`  ${m}: { args: "object" },`);
    }
  }
  return [
    `// Recovered from the "${e.edge}" rpc-edge declaration at ${where}.`,
    '// Argument types come from the runtime validators; return types and event payloads are',
    '// compile-time only and not present in the bundle.',
    `// Channels: dune-rpc:${e.edge}:m:<method>, dune-rpc:${e.edge}:e:<event>, dune-rpc:${e.edge}:probe.`,
    '',
    `export const ${name.replace(/^./, (c) => c.toLowerCase())}Edge = "${e.edge}";`,
    `export const ${name.replace(/^./, (c) => c.toLowerCase())}HasEvents = ${e.hasEvents};`,
    '',
    `/** Same shape as RpcMethodTable in source/electron-preload/rpc-edge-runtime.ts. */`,
    `export const ${name.replace(/^./, (c) => c.toLowerCase())}Methods = {`,
    ...table,
    '} as const;',
    '',
    `export interface ${name}Edge {`,
    ...sig,
    '}',
    '',
  ].join('\n');
}

function main(dir) {
  const dist = path.join(dir, 'pretty/dist');
  const read = (f) => fs.readFileSync(path.join(dist, f), 'utf8');
  const mainApp = read('electron-main/main-app.cjs');
  const r = resolver([mainApp, read('electron-main/main-core.cjs')]);
  const outDir = path.join(dir, 'ipc');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const edges = findEdges(mainApp);
  const ours = new Map(edges.map((e) => [e.edge, new Set(methodNames(e.methods, { ...r, pos: e.pos }).map((f) => f.name))]));
  const report = [];
  for (const e of edges) {
    const where = `dist/electron-main/main-app.cjs:${lineOf(mainApp, e.pos)}`;
    fs.writeFileSync(path.join(outDir, `${e.edge}.ts`), renderEdge(e, r, where));
    const body = fs.readFileSync(path.join(outDir, `${e.edge}.ts`), 'utf8');
    report.push(`${e.edge}: ${ours.get(e.edge).size} methods, events=${e.hasEvents}, ${(body.match(/unknown \/\*/g) ?? []).length} opaque types`);
  }

  // The other processes carry their own copies of the declarations; compare method names.
  for (const f of fs.readdirSync(dist, { recursive: true }).filter((f) => /\.cjs$/.test(f) && f !== 'electron-main/main-app.cjs')) {
    const text = read(f);
    if (!text.includes('"rpc-edge"')) continue;
    const rr = resolver([text]);
    for (const e of findEdges(text)) {
      const theirs = new Set(methodNames(e.methods, { ...rr, pos: e.pos }).map((x) => x.name));
      const mine = ours.get(e.edge) ?? new Set();
      const missing = [...theirs].filter((x) => !mine.has(x));
      const extra = [...mine].filter((x) => !theirs.has(x));
      report.push(`  ${f}:${lineOf(text, e.pos)} ${e.edge}: ${theirs.size} methods` +
        (missing.length ? `, only here: ${missing.join(' ')}` : '') + (extra.length ? `, not here: ${extra.join(' ')}` : ''));
    }
  }
  fs.writeFileSync(path.join(outDir, 'REPORT.txt'), report.join('\n') + '\n');
  console.log(report.join('\n'));
  console.log(`${edges.length} edges -> ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2] ?? 'recovered/0.77.0');
