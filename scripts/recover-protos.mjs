#!/usr/bin/env node
// Rebuild .proto schemas from the compact protobuf descriptors bundled in a recovered app.
// Each generated message class carries `static $() { return ["Name|1 field 9?|2 other #0*", Ref0] }`
// and inherits its package from a base class `static $p() { return "aiserver.v1." }`.
// Usage: node scripts/recover-protos.mjs recovered/<version>   (writes recovered/<version>/protos/)
import fs from 'node:fs';
import path from 'node:path';

const ID = '[\\w$]+';
const STR = '"(?:[^"\\\\]|\\\\.)*"';

export const SCALARS = {
  1: 'double', 2: 'float', 3: 'int64', 4: 'uint64', 5: 'int32', 6: 'fixed64', 7: 'fixed32', 8: 'bool',
  9: 'string', 12: 'bytes', 13: 'uint32', 15: 'sfixed32', 16: 'sfixed64', 17: 'sint32', 18: 'sint64',
};

// Text from `open` (an opening bracket) through its matching close, skipping string literals.
function balanced(text, open) {
  const close = { '[': ']', '{': '}', '(': ')' }[text[open]];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
    } else if (ch === text[open]) depth++;
    else if (ch === close && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error(`unbalanced ${text[open]} at ${open}`);
}

const jsonish = (s) => JSON.parse(s.replace(/,(\s*[\]}])/g, '$1'));

// Parse one bundle. Returns definitions keyed by the bundle's minified variable names.
export function parseBundle(text) {
  const defs = new Map(); // var -> [{pos, def}]
  const add = (v, pos, def) => (defs.get(v) ?? defs.set(v, []).get(v)).push({ pos, def });
  const strVars = new Map();
  for (const m of text.matchAll(new RegExp(`(${ID}) = "([\\w.]+\\.)"`, 'g'))) strVars.set(m[1], m[2]);
  const pkgOf = (tok) => (tok.startsWith('"') ? JSON.parse(tok) : strVars.get(tok));

  const bases = new Map();
  for (const m of text.matchAll(new RegExp(
    `(${ID}) = class extends ${ID} \\{\\s*static get runtime\\(\\) \\{[^}]*\\}\\s*static \\$p\\(\\) \\{\\s*return (${ID}|${STR});`, 'g')))
    bases.set(m[1], pkgOf(m[2]));

  const headers = [...text.matchAll(new RegExp(`(${ID}) = class (?:(${ID}) )?extends (${ID}) \\{`, 'g'))];
  let h = 0;
  const unresolved = [];
  for (const m of text.matchAll(new RegExp(`static \\$\\(\\) \\{\\s*return \\[\\s*(${STR})((?:\\s*,\\s*${ID})*)\\s*,?\\s*\\];`, 'g'))) {
    while (h + 1 < headers.length && headers[h + 1].index < m.index) h++;
    const [, v, inner, base] = headers[h];
    const desc = JSON.parse(m[1]);
    const pkg = bases.get(base);
    if (pkg === undefined) { unresolved.push(desc.split('|')[0]); continue; }
    // A recursive message refers to itself by the class expression's inner name.
    const refs = m[2].split(',').map((s) => s.trim()).filter(Boolean).map((r) => (r === inner ? v : r));
    add(v, m.index, { kind: 'message', pkg, desc, refs });
  }

  const fn = text.match(new RegExp(
    `function (${ID})\\(${ID}, ${ID}, ${ID}, ${ID}, ${ID}\\) \\{\\s*let ${ID} = ${ID}\\.slice\\(${ID}\\.lastIndexOf\\("\\."\\) \\+ 1\\)`))?.[1];
  if (fn) {
    for (const m of text.matchAll(new RegExp(`(${ID}) = ${fn.replace(/\$/g, '\\$')}\\(\\s*${ID},\\s*(${ID}|${STR}),\\s*(${STR}),\\s*\\[`, 'g'))) {
      const arr = balanced(text, m.index + m[0].length - 1);
      const after = text.slice(m.index + m[0].length - 1 + arr.length).match(/^\s*,\s*1\b/);
      const rel = JSON.parse(m[3]);
      const short = rel.slice(rel.lastIndexOf('.') + 1);
      const prefix = after ? (short[0] + short.slice(1).replace(/[A-Z]/g, (c) => '_' + c)).toUpperCase() + '_' : '';
      const values = jsonish(arr).map(([no, name]) => [no, prefix + name]);
      add(m[1], m.index, { kind: 'enum', pkg: pkgOf(m[2]), rel, values });
    }
  }

  // Hand-written well-known / third-party types are referenced by name only.
  for (const m of text.matchAll(new RegExp(`(${ID})\\.typeName = "([\\w.]+)"`, 'g'))) add(m[1], m.index, { kind: 'external', name: m[2] });
  for (const m of text.matchAll(new RegExp(`setEnumType\\(\\s*(${ID}),\\s*"([\\w.]+)"`, 'g'))) add(m[1], m.index, { kind: 'external', name: m[2] });

  const services = [];
  const methodsOf = (obj, seen = new Set()) => {
    const out = [...obj.matchAll(new RegExp(`name: "(\\w+)",\\s*I: (${ID}),\\s*O: (${ID}),\\s*kind: ${ID}\\.(\\w+)`, 'g'))]
      .map((x) => ({ name: x[1], I: x[2], O: x[3], kind: x[4] }));
    for (const s of obj.matchAll(new RegExp(`\\.\\.\\.(${ID})`, 'g'))) {
      if (seen.has(s[1])) continue;
      seen.add(s[1]);
      const d = text.match(new RegExp(`(?:^|[\\s,;])${s[1].replace(/\$/g, '\\$')} = \\{`, 'm'));
      if (d) out.push(...methodsOf(balanced(text, d.index + d[0].length - 1), seen));
    }
    return out;
  };
  for (const m of text.matchAll(/typeName: "([\w.]+)",\s*methods: \{/g))
    services.push({ name: m[1], pos: m.index, methods: methodsOf(balanced(text, m.index + m[0].length - 1)) });

  return { defs, services, unresolved };
}

// Nearest definition of a minified variable (names can be reused in nested scopes).
function lookup(defs, v, pos) {
  const c = defs.get(v);
  if (!c) return undefined;
  return c.reduce((a, b) => (Math.abs(b.pos - pos) < Math.abs(a.pos - pos) ? b : a)).def;
}
const fullName = (d) => (d.kind === 'external' ? d.name : d.pkg + (d.kind === 'enum' ? d.rel : d.desc.split('|')[0]));

// Merge bundles into one schema: Map<fullName, type>, plus services.
export function buildSchema(bundles) {
  const types = new Map();
  const services = new Map();
  const problems = [];
  for (const { file, text } of bundles) {
    const { defs, services: svcs, unresolved } = parseBundle(text);
    for (const u of unresolved) problems.push(`${file}: no package for ${u}`);
    const ref = (v, pos) => {
      const d = lookup(defs, v, pos);
      if (!d) problems.push(`${file}: unresolved ref ${v}`);
      return d ? fullName(d) : `UNRESOLVED_${v}`;
    };
    for (const [, list] of defs) for (const { pos, def } of list) {
      if (def.kind === 'external') continue;
      const name = fullName(def);
      let t;
      if (def.kind === 'enum') t = { kind: 'enum', pkg: def.pkg, name, values: def.values };
      else {
        const [head, ...specs] = def.desc.split('|');
        const resolve = (tok) => (tok[0] === '#' ? ref(def.refs[+tok.slice(1)], pos) : +tok);
        const fields = specs.map((spec) => {
          let [no, fname, type, oneof] = spec.split(' ');
          let label;
          if (type.endsWith('?') || type.endsWith('*')) { label = type.endsWith('?') ? 'optional' : 'repeated'; type = type.slice(0, -1); }
          const comma = type.indexOf(',');
          const f = { no: +no, name: fname, label, oneof };
          if (comma !== -1) Object.assign(f, { key: +type.slice(0, comma), type: resolve(type.slice(comma + 1)) });
          else f.type = resolve(type);
          return f;
        });
        t = { kind: 'message', pkg: def.pkg, name: def.pkg + head, fields, desc: def.desc };
      }
      const prev = types.get(name);
      if (prev && prev.kind === 'message' && prev.desc !== t.desc) {
        problems.push(`${file}: ${name} differs from an earlier bundle; kept the one with more fields`);
        if (t.fields.length <= prev.fields.length) continue;
      }
      if (!prev || prev.kind === 'message') types.set(name, t);
    }
    for (const s of svcs) {
      const methods = s.methods.map((m) => ({ ...m, I: ref(m.I, s.pos), O: ref(m.O, s.pos) }));
      const prev = services.get(s.name);
      if (!prev || methods.length > prev.methods.length) services.set(s.name, { name: s.name, methods });
    }
  }
  return { types, services, problems };
}

const WKT = {
  Timestamp: 'timestamp', Duration: 'duration', Empty: 'empty', Any: 'any', FieldMask: 'field_mask',
  Struct: 'struct', Value: 'struct', ListValue: 'struct', NullValue: 'struct',
};
function importFor(name, pkg) {
  if (name.startsWith('google.protobuf.')) {
    const short = name.split('.')[2];
    return `google/protobuf/${WKT[short] ?? (short.endsWith('Value') ? 'wrappers' : 'descriptor')}.proto`;
  }
  if (name.startsWith('opentelemetry.proto.')) {
    const p = name.split('.');
    return `opentelemetry/proto/${p[2]}/${p[3]}/${p[2]}.proto`;
  }
  return pkg + 'proto';
}

const pkgOfName = (types, name) => types.get(name)?.pkg ?? name.slice(0, name.lastIndexOf('.') + 1);

// Render one .proto file per package.
export function renderProtos({ types, services }) {
  const byPkg = new Map();
  const bucket = (pkg) => byPkg.get(pkg) ?? byPkg.set(pkg, { types: [], services: [] }).get(pkg);
  for (const t of types.values()) bucket(t.pkg).types.push(t);
  for (const s of services.values()) bucket(pkgOfName(types, s.name)).services.push(s);

  const out = new Map();
  for (const [pkg, { types: list, services: svcs }] of [...byPkg].sort()) {
    const imports = new Set();
    const typeRef = (name) => {
      if (!types.has(name) || types.get(name).pkg !== pkg) imports.add(importFor(name, pkgOfName(types, name)));
      return '.' + name;
    };
    const fieldType = (f) => {
      const v = typeof f.type === 'number' ? SCALARS[f.type] ?? `UNKNOWN_SCALAR_${f.type}` : typeRef(f.type);
      return f.key !== undefined ? `map<${SCALARS[f.key]}, ${v}>` : v;
    };

    // Nest "Outer.Inner" under Outer; synthesize missing parents.
    const root = { children: new Map() };
    for (const t of list.sort((a, b) => a.name.localeCompare(b.name))) {
      let node = root;
      for (const part of t.name.slice(pkg.length).split('.')) {
        node = node.children.get(part) ?? node.children.set(part, { children: new Map() }).get(part);
      }
      node.type = t;
    }
    const lines = [];
    const emit = (name, node, ind) => {
      const t = node.type;
      if (t?.kind === 'enum') {
        lines.push(`${ind}enum ${name} {`);
        for (const [no, v] of t.values) lines.push(`${ind}  ${v} = ${no};`);
        lines.push(`${ind}}`);
        return;
      }
      lines.push(`${ind}message ${name} {${t ? '' : ' // container only; not present in the bundle'}`);
      const doneOneofs = new Set();
      for (const f of t?.fields ?? []) {
        if (f.oneof) {
          if (doneOneofs.has(f.oneof)) continue;
          doneOneofs.add(f.oneof);
          lines.push(`${ind}  oneof ${f.oneof} {`);
          for (const g of t.fields.filter((x) => x.oneof === f.oneof)) lines.push(`${ind}    ${fieldType(g)} ${g.name} = ${g.no};`);
          lines.push(`${ind}  }`);
        } else lines.push(`${ind}  ${f.label ? f.label + ' ' : ''}${fieldType(f)} ${f.name} = ${f.no};`);
      }
      for (const [n, child] of node.children) emit(n, child, ind + '  ');
      lines.push(`${ind}}`);
    };
    for (const [n, node] of root.children) { emit(n, node, ''); lines.push(''); }
    for (const s of svcs.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`service ${s.name.slice(s.name.lastIndexOf('.') + 1)} {`);
      for (const m of s.methods) {
        const cs = m.kind === 'ClientStreaming' || m.kind === 'BiDiStreaming' ? 'stream ' : '';
        const ss = m.kind === 'ServerStreaming' || m.kind === 'BiDiStreaming' ? 'stream ' : '';
        lines.push(`  rpc ${m.name}(${cs}${typeRef(m.I)}) returns (${ss}${typeRef(m.O)});`);
      }
      lines.push('}', '');
    }
    imports.delete(pkg + 'proto');
    const head = ['// Recovered from compact protobuf descriptors in the shipped bundles; field order and', '// file split are the bundle\'s, not the original sources\'.', 'syntax = "proto3";', '', `package ${pkg.slice(0, -1)};`, ''];
    if (imports.size) head.push(...[...imports].sort().map((i) => `import "${i}";`), '');
    out.set(pkg + 'proto', head.concat(lines).join('\n').trimEnd() + '\n');
  }
  return out;
}

function main(dir) {
  const dist = path.join(dir, 'pretty/dist');
  const bundles = fs.readdirSync(dist, { recursive: true })
    .filter((f) => /\.c?js$/.test(f) && !f.startsWith('renderer'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(dist, f), 'utf8') }))
    .filter((b) => b.text.includes('static $() {') || b.text.includes('methods: {'));
  const schema = buildSchema(bundles);
  const files = renderProtos(schema);
  const outDir = path.join(dir, 'protos');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, body] of files) fs.writeFileSync(path.join(outDir, name), body);
  fs.writeFileSync(path.join(outDir, 'PROBLEMS.txt'), [...new Set(schema.problems)].join('\n') + '\n');
  const n = (k) => [...schema.types.values()].filter((t) => t.kind === k).length;
  console.log(`${files.size} files, ${n('message')} messages, ${n('enum')} enums, ${schema.services.size} services, ` +
    `${[...schema.services.values()].reduce((a, s) => a + s.methods.length, 0)} rpcs, ${new Set(schema.problems).size} problems -> ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv[2] ?? 'recovered/0.77.0');
