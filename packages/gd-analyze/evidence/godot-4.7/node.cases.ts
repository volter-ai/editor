import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, type Segment, TREE_PROBE_HELPERS, treeCase } from './tree-timeline';
import { inputCase, type Op as InputOp } from './input-tree';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[], owner = 'Node'): void {
  const built = treeCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner, member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const now = (...ops: Op[]): Segment => ({ ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });

/** a(b(d, e), c), all scripted, built before entering the tree. */
const TREE: Op[] = [
  { new: 'a' }, { new: 'b', kind: 'node' }, { new: 'c' }, { new: 'd' }, { new: 'e', kind: 'node' },
  { add: 'b', to: 'a' }, { add: 'c', to: 'a' }, { add: 'd', to: 'b' }, { add: 'e', to: 'b' },
];

add('add_child-subtree-enter-ready-order', 'add_child', [now(...TREE, { log: 'attach' }, { add: 'a' }, { log: 'attached' })]);
add('add_child-into-tree-one-by-one', 'add_child', [now({ new: 'a' }, { add: 'a' }, { new: 'b' }, { add: 'b', to: 'a' }, { new: 'c', kind: 'node' }, { add: 'c', to: 'b' })]);
add('process-order-over-frames', 'set_process', [now(...TREE, { add: 'a' }), phys({ log: 'physics-segment' }), proc({ log: 'process-segment' }), phys(), proc()]);
add('process-toggle', 'set_process', [now(...TREE, { add: 'a' }, { process: 'b', on: false }, { process: 'd', on: false, physics: true }), proc({ read: ['processing', 'b'] }, { read: ['physics_processing', 'd'] }, { process: 'b', on: true })]);
add('is_processing-read', 'is_processing', [now({ new: 'a' }, { read: ['processing', 'a'] }, { add: 'a' }, { read: ['processing', 'a'] }, { new: 'q', script: 'quiet' }, { add: 'q' }, { read: ['processing', 'q'] })]);
add('set_physics_process', 'set_physics_process', [now({ new: 'a' }, { add: 'a' }, { process: 'a', on: false, physics: true }), phys({ read: ['physics_processing', 'a'] }), proc()]);
add('is_physics_processing', 'is_physics_processing', [now({ new: 'a' }, { read: ['physics_processing', 'a'] }, { add: 'a' }, { read: ['physics_processing', 'a'] })]);
add('process-priority', 'set_process_priority', [now(...TREE, { priority: 'c', value: -5 }, { priority: 'a', value: 3 }, { add: 'a' }, { read: ['process_priority', 'c'] }), phys(), proc()]);
add('get_process_priority', 'get_process_priority', [now({ new: 'a' }, { read: ['process_priority', 'a'] }, { priority: 'a', value: 7 }, { read: ['process_priority', 'a'] })]);
add('process-mode-disabled', 'set_process_mode', [now(...TREE, { mode: 'b', value: 4 }, { add: 'a' }, { read: ['can_process', 'd'] }, { read: ['can_process', 'a'] }), proc(), phys()]);
add('get_process_mode', 'get_process_mode', [now({ new: 'a' }, { read: ['process_mode', 'a'] }, { mode: 'a', value: 3 }, { read: ['process_mode', 'a'] }, { mode: 'a', value: 9 }, { read: ['process_mode', 'a'] }, { mode: 'a', value: -1 }, { read: ['process_mode', 'a'] }, { add: 'a' }, { read: ['can_process', 'a'] })]);
add('can_process', 'can_process', [now({ new: 'a' }, { read: ['can_process', 'a'] }, { add: 'a' }, { read: ['can_process', 'a'] }, { mode: 'a', value: 4 }, { read: ['can_process', 'a'] })]);
add('remove_child-exit-order', 'remove_child', [now(...TREE, { add: 'a' }), proc({ remove: 'b', from: 'a' }, { read: ['inside', 'd'] }, { read: ['children', 'a'] }), proc({ add: 'b', to: 'c' }, { read: ['node_ready', 'b'] })]);
add('queue_free-timing', 'queue_free', [now(...TREE, { add: 'a' }), proc({ free: 'b' }, { read: ['queued', 'b'] }, { read: ['inside', 'b'] }, { log: 'queued' }), phys({ log: 'physics-after-free' }), proc()]);
add('queue_free-in-physics', 'queue_free', [now(...TREE, { add: 'a' }), phys({ free: 'c' }, { read: ['inside', 'c'] }), proc({ read: ['children', 'a'] })]);
add('queue_free-flag', 'queue_free', [now({ new: 'a' }, { add: 'a' }, { read: ['queued', 'a'] }, { free: 'a' }, { read: ['queued', 'a'] })]);
add('get_children', 'get_children', [now(...TREE, { add: 'a' }, { read: ['children', 'a'] }, { read: ['children', 'b'] }, { read: ['children', 'e'] }, { new: 'u', script: 'none' }, { add: 'u', to: 'a' }, { read: ['children', 'a'] })]);
add('get_parent', 'get_parent', [now(...TREE, { read: ['parent', 'd'] }, { read: ['parent', 'a'] }, { add: 'a' }, { read: ['parent', 'c'] })]);
add('get_node_or_null-paths', 'get_node_or_null', [now(...TREE, { add: 'a' },
  { read: ['get_node_or_null', 'a', 'b'] }, { read: ['get_node_or_null', 'a', 'b/d'] }, { read: ['get_node_or_null', 'd', '..'] },
  { read: ['get_node_or_null', 'd', '../e'] }, { read: ['get_node_or_null', 'd', '../../c'] }, { read: ['get_node_or_null', 'a', 'x'] },
  { read: ['get_node_or_null', 'a', '.'] }, { read: ['get_node_or_null', 'a', 'b/./e'] }, { read: ['get_node_or_null', 'a', ''] },
  { read: ['get_node_or_null', 'a', 'b//d'] }, { read: ['get_node_or_null', 'a', 'c:position'] })]);
add('get_node-paths', 'get_node', [now(...TREE, { add: 'a' }, { read: ['get_node', 'b', 'e'] }, { read: ['get_node', 'e', '../d'] }, { read: ['get_node', 'a', 'missing'] })]);
add('get_name', 'get_name', [now({ new: 'a' }, { read: ['name', 'a'] }, { add: 'a' }, { read: ['name', 'a'] })]);
add('set_name-collision', 'set_name', [now({ new: 'a' }, { add: 'a' }, { new: 'b' }, { add: 'b', to: 'a' }, { new: 'c' }, { add: 'c', to: 'a' }, { rename: 'c', to: 'x' }, { read: ['name', 'c'] }, { rename: 'c', to: '' }, { read: ['name', 'c'] }, { read: ['get_node_or_null', 'a', 'x'] })]);
add('groups', 'add_to_group', [now({ new: 'a' }, { group: 'a', name: 'enemies' }, { read: ['in_group', 'a', 'enemies'] }, { add: 'a' }, { group: 'a', name: 'enemies' }, { read: ['in_group', 'a', 'enemies'] })]);
add('is_in_group', 'is_in_group', [now({ new: 'a' }, { read: ['in_group', 'a', 'x'] }, { add: 'a' }, { group: 'a', name: 'x' }, { read: ['in_group', 'a', 'x'] }, { read: ['in_group', 'a', 'y'] })]);
add('remove_from_group', 'remove_from_group', [now({ new: 'a' }, { add: 'a' }, { group: 'a', name: 'x' }, { ungroup: 'a', name: 'x' }, { read: ['in_group', 'a', 'x'] }, { ungroup: 'a', name: 'never' })]);
add('is_inside_tree', 'is_inside_tree', [now({ new: 'a' }, { read: ['inside', 'a'] }, { add: 'a' }, { read: ['inside', 'a'] })]);
add('get_tree', 'get_tree', [now({ new: 'a' }, { add: 'a' }, { read: ['tree_is_same', 'a'] })]);
add('get_viewport', 'get_viewport', [now({ new: 'a' }, { add: 'a' }, { read: ['viewport_is_root', 'a'] })]);
add('get_physics_process_delta_time', 'get_physics_process_delta_time', [now({ new: 'a' }, { read: ['physics_delta', 'a'] }, { add: 'a' }), phys({ read: ['physics_delta', 'a'] })]);
add('get_process_delta_time', 'get_process_delta_time', [now({ new: 'a' }, { read: ['process_delta', 'a'] }, { add: 'a' }, { read: ['process_delta', 'a'] })]);
add('reset_physics_interpolation', 'reset_physics_interpolation', [now({ new: 'a' }, { add: 'a' }, { resetInterpolation: 'a' }, { log: 'reset' }), phys()]);
add('is_node_ready', 'is_node_ready', [now({ new: 'a' }, { read: ['node_ready', 'a'] }, { add: 'a' }, { read: ['node_ready', 'a'] })]);
add('request_ready', 'request_ready', [now({ new: 'a' }, { new: 'p', kind: 'node' }, { add: 'p' }, { add: 'a', to: 'p' }, { remove: 'a', from: 'p' }, { requestReady: 'a' }, { add: 'a', to: 'p' }, { remove: 'a', from: 'p' }, { add: 'a', to: 'p' })]);
add('deferred-order', 'add_child', [now(...TREE, { deferred: 'b', what: 'one' }, { add: 'a' }, { deferred: 'a', what: 'two' }, { log: 'end-of-body' }), proc({ free: 'c' }, { deferred: 'c', what: 'after-free' })]);

// Input processing: a script's input callbacks turn their processing on at ready; the flags gate
// which nodes each stage of push_input calls.
for (const [setter, getter, callback] of [
  ['set_process_input', 'is_processing_input', 'input'],
  ['set_process_shortcut_input', 'is_processing_shortcut_input', 'shortcut_input'],
  ['set_process_unhandled_input', 'is_processing_unhandled_input', 'unhandled_input'],
  ['set_process_unhandled_key_input', 'is_processing_unhandled_key_input', 'unhandled_key_input'],
] as const) {
  const ops: InputOp[] = [
    { node: 'plain', kind: 'Node' },
    { read: getter, on: 'plain' },
    { node: 'scripted', kind: 'Node', script: { [callback]: false } },
    { read: getter, on: 'scripted' },
    { event: { key: 70, pressed: true } },
    { call: setter, on: 'scripted', args: [false] },
    { read: getter, on: 'scripted' },
    { event: { key: 70, pressed: false } },
    { call: setter, on: 'plain', args: [true] },
    { read: getter, on: 'plain' },
    { call: setter, on: 'scripted', args: [true] },
    { event: { key: 71, pressed: true } },
    { event: { key: 71, pressed: false } },
  ];
  for (const member of [setter, getter]) {
    const built = inputCase(ops);
    cases.push({ id: `${member}-input`, symbol: { kind: 'native-member', owner: 'Node', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
  }
}

const NODE_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Node',
  compatModule: 'lib/godot-compat/node',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default NODE_EVIDENCE;
