import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { Group } from 'three';
import * as O from '../../capabilities/catalog/project-source/src/lib/godot-compat/object';
import { construct as vector3 } from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import { resourceCases } from './resource-cases';
import { type Op, type Segment, TREE_PROBE_HELPERS, treeCase } from './tree-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = treeCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Object', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const now = (...ops: Op[]): Segment => ({ ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });

add('call_deferred-in-process-frame', 'call_deferred', [now({ new: 'a' }, { add: 'a' }, { deferred: 'a', what: '1' }, { deferred: 'a', what: '2' }, { log: 'body' })]);
add('call_deferred-in-physics', 'call_deferred', [now({ new: 'a' }, { add: 'a' }), phys({ deferred: 'a', what: 'p' }, { log: 'physics-body' }), proc({ deferred: 'a', what: 'q' })]);
add('call_deferred-freed-target', 'call_deferred', [now({ new: 'a' }, { add: 'a' }), proc({ deferred: 'a', what: 'x' }, { free: 'a' }), proc()]);
add('call_deferred-before-tree', 'call_deferred', [now({ new: 'a', script: 'quiet' }, { deferred: 'a', what: 'early' }, { add: 'a' })]);
add('set_deferred', 'set_deferred', [now({ new: 'a', script: 'quiet' }, { add: 'a' }, { setDeferred: 'a', value: 'v1' }, { readMark: 'a' }), phys({ readMark: 'a' }, { setDeferred: 'a', value: 'v2' }, { readMark: 'a' }), proc({ readMark: 'a' })]);
add('is_queued_for_deletion', 'is_queued_for_deletion', [now({ new: 'a' }, { add: 'a' }, { read: ['queued', 'a'] }, { free: 'a' }, { read: ['queued', 'a'] })]);

// Metadata: a node's entries in insertion order, erased by a null value.
const meta = resourceCases('Object');
const node = () => new Group();
meta.add('set_meta-get', 'set_meta', ['var n := Node3D.new()', 'n.set_meta("a", 1)', 'n.set_meta("_editor_floor_", Vector3(0, 7, 0))', 'var r = [n.get_meta("a"), n.get_meta("_editor_floor_")]', 'n.free()', 'return r'], () => {
  const n = node();
  O.set_meta(n, 'a', 1);
  O.set_meta(n, '_editor_floor_', vector3(0, 7, 0));
  return [O.get_meta(n, 'a'), O.get_meta(n, '_editor_floor_')];
});
meta.add('set_meta-null-erases', 'set_meta', ['var n := Node3D.new()', 'n.set_meta("a", 1)', 'n.set_meta("a", null)', 'var r = n.has_meta("a")', 'n.free()', 'return r'], () => {
  const n = node();
  O.set_meta(n, 'a', 1);
  O.set_meta(n, 'a', null);
  return O.has_meta(n, 'a');
});
meta.add('get_meta-default', 'get_meta', ['var n := Node3D.new()', 'var r = n.get_meta("missing", 5)', 'n.free()', 'return r'], () => O.get_meta(node(), 'missing', 5));
meta.add('has_meta', 'has_meta', ['var n := Node3D.new()', 'n.set_meta("b", "x")', 'var r = [n.has_meta("b"), n.has_meta("c")]', 'n.free()', 'return r'], () => {
  const n = node();
  O.set_meta(n, 'b', 'x');
  return [O.has_meta(n, 'b'), O.has_meta(n, 'c')];
});
meta.add('remove_meta', 'remove_meta', ['var n := Node3D.new()', 'n.set_meta("b", 2)', 'n.remove_meta("b")', 'var r = n.has_meta("b")', 'n.free()', 'return r'], () => {
  const n = node();
  O.set_meta(n, 'b', 2);
  O.remove_meta(n, 'b');
  return O.has_meta(n, 'b');
});
meta.add('get_meta_list-order', 'get_meta_list', ['var n := Node3D.new()', 'n.set_meta("z", 1)', 'n.set_meta("a", 2)', 'n.set_meta("m", 3)', 'n.remove_meta("a")', 'n.set_meta("a", 4)', 'var r = n.get_meta_list()', 'n.free()', 'return r'], () => {
  const n = node();
  O.set_meta(n, 'z', 1);
  O.set_meta(n, 'a', 2);
  O.set_meta(n, 'm', 3);
  O.remove_meta(n, 'a');
  O.set_meta(n, 'a', 4);
  return O.get_meta_list(n);
});
cases.push(...meta.cases);

const OBJECT_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Object',
  compatModule: 'lib/godot-compat/object',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default OBJECT_EVIDENCE;
