import assert from 'node:assert/strict';
import test from 'node:test';
import { findEdges, renderEdge, resolver } from '../scripts/recover-ipc.mjs';

// Shaped like the Prettier output of dist/electron-main/main-app.cjs.
const bundle = `
function Lo(e, t) {
  return Object.freeze({
    kind: "rpc-edge",
    edge: e,
    methods: t.methods,
    hasEvents: t.events != null,
  });
}
function re() {
  return Cr("agent id", (e) => e);
}
function Ot(e, t) {
  return We(e, (n) => t.some((r) => r === n));
}
var cz = ["approved", "denied"],
  base = (0, m.rpcObject)({ id: re(), note: (0, m.rpcOptional)((0, m.rpcString)()) }),
  shared = { ping: k().noArgs },
  edge = Lo("demo-edge", {
    methods: {
      ...shared,
      resolve: k().args({
        ...base,
        resolution: Ot("resolution", cz),
        tags: (0, m.rpcArray)((0, m.rpcNullable)((0, m.rpcNumber)())),
        note: (0, m.rpcString)(),
      }),
    },
    events: ro(),
  });
`;

test('rpc-edge declarations become a TypeScript contract', () => {
  const [e] = findEdges(bundle);
  assert.equal(e.edge, 'demo-edge');
  const ts = renderEdge(e, resolver([bundle]), 'demo.cjs:1');
  for (const line of [
    'export const demoEdgeHasEvents = true;',
    '  ping: { args: "none" },',
    '  resolve: { args: "object" },',
    '  ping(): Promise<unknown>;',
    '    id: string /* agent id */;',
    '    resolution: "approved" | "denied";',
    '    tags: Array<number | null>;',
    '    note: string;', // the later key overrides the spread's optional one
  ]) assert.ok(ts.includes(line + '\n'), `missing: ${line}\n${ts}`);
  assert.ok(!ts.includes('note?:'), ts);
});
