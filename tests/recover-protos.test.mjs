import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSchema, renderProtos } from '../scripts/recover-protos.mjs';

// Shaped like the Prettier output of a shipped bundle.
const bundle = `
var ot = "demo.v1.",
  x = class extends f {
    static get runtime() {
      return m(this, "runtime", s);
    }
    static $p() {
      return ot;
    }
  };
function a(e, t, r, l, u) {
  let d = r.slice(r.lastIndexOf(".") + 1),
    h;
}
var Node = class e extends x {
    static $() {
      return ["Node|1 name 9|2 children #0*|3 kind #1?|4 tags 9,9|5 text 9 body|6 blob 12 body", e, Kind];
    }
  },
  Kind = a(s, ot, "Node.Kind", [
    [0, "UNSPECIFIED"],
    [1, "LEAF"],
  ], 1);
var Svc = {
  typeName: "demo.v1.TreeService",
  methods: {
    walk: {
      name: "Walk",
      I: Node,
      O: Node,
      kind: g.ServerStreaming,
    },
  },
};
`;

test('compact descriptors become a valid proto3 file', () => {
  const schema = buildSchema([{ file: 'demo.cjs', text: bundle }]);
  assert.deepEqual(schema.problems, []);
  const proto = renderProtos(schema).get('demo.v1.proto');
  for (const line of [
    'package demo.v1;',
    'message Node {',
    '  string name = 1;',
    '  repeated .demo.v1.Node children = 2;',
    '  optional .demo.v1.Node.Kind kind = 3;',
    '  map<string, string> tags = 4;',
    '  oneof body {',
    '    bytes blob = 6;',
    '  enum Kind {',
    '    KIND_UNSPECIFIED = 0;',
    '  rpc Walk(.demo.v1.Node) returns (stream .demo.v1.Node);',
  ]) assert.ok(proto.includes(line + '\n'), `missing: ${line}\n${proto}`);
});
