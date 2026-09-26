import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
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

const OBJECT_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Object',
  compatModule: 'lib/godot-compat/object',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default OBJECT_EVIDENCE;
