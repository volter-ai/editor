import { DirectionalLight, Group } from 'three';
import * as B3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as DL from '../../capabilities/catalog/project-source/src/lib/godot-compat/directional-light-3d';
import * as L from '../../capabilities/catalog/project-source/src/lib/godot-compat/light-3d';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as N3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as T3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/transform-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import * as VI from '../../capabilities/catalog/project-source/src/lib/godot-compat/visual-instance-3d';
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

// duplicate(): a configured directional light with a child (the corpus duplicates its sun to
// add a second light). The copy keeps the name, transform, light and layer state, groups and the
// child; changing the copy leaves the original alone.
const LIGHT_CLASSES = ['DirectionalLight3D', 'Light3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'];
cases.push({
  id: 'duplicate-directional-light',
  symbol: { kind: 'native-member', owner: 'Node', member: 'duplicate' },
  comparator: 'exact',
  gdscript: [
    'var l := DirectionalLight3D.new()',
    'l.name = "Sun"',
    'l.transform = Transform3D(Basis(Vector3(0, 1, 0), 0.5), Vector3(1, 2, 3))',
    'l.light_energy = 0.7',
    'l.light_color = Color(1, 0.5, 0.25)',
    'l.shadow_enabled = true',
    'l.shadow_bias = 0.02',
    'l.directional_shadow_mode = 0',
    'l.sky_mode = 1',
    'l.layers = 5',
    'l.add_to_group("lights")',
    'var c := Node3D.new()',
    'c.name = "Child"',
    'c.position = Vector3(1, 2, 3)',
    'l.add_child(c)',
    'var d: DirectionalLight3D = l.duplicate()',
    'var out := [String(d.name), d.transform, d.light_energy, d.light_color, d.shadow_enabled, d.shadow_bias, d.directional_shadow_mode, d.sky_mode, d.layers, d.is_in_group("lights"), d.get_child_count(), String(d.get_child(0).name), d.get_child(0).position, d.get_child(0) == c]',
    'd.light_energy = 0.25',
    'd.sky_mode = 2',
    'out.append_array([l.light_energy, l.sky_mode, d.light_energy, d.sky_mode])',
    'd.free()',
    'l.free()',
    'return out',
  ].join('\n'),
  target: () => {
    const l = new DirectionalLight();
    N.godot_node_adopt(l, { classes: LIGHT_CLASSES });
    DL.godot_directional_light_3d_mount(l);
    N.set_name(l, 'Sun');
    N3.set_transform(l, T3.construct(B3.construct(V.construct(0, 1, 0), 0.5), V.construct(1, 2, 3)));
    L.set_param(l, 0, 0.7);
    L.set_color(l, C.construct(1, 0.5, 0.25));
    L.set_shadow(l, true);
    L.set_param(l, 15, 0.02);
    DL.set_shadow_mode(l, 0);
    DL.set_sky_mode(l, 1);
    VI.set_layer_mask(l, 5);
    N.add_to_group(l, 'lights');
    const c = new Group();
    N.godot_node_adopt(c, { classes: ['Node3D', 'Node', 'Object'] });
    N.set_name(c, 'Child');
    N3.set_position(c, V.construct(1, 2, 3));
    N.add_child(l, c);
    const d = N.duplicate(l) as DirectionalLight;
    const child = N.get_children(d)[0] as Group;
    const out: unknown[] = [
      N.get_name(d), N3.get_transform(d), L.get_param(d, 0), L.get_color(d), L.has_shadow(d), L.get_param(d, 15),
      DL.get_shadow_mode(d), DL.get_sky_mode(d), VI.get_layer_mask(d), N.is_in_group(d, 'lights'), N.get_children(d).length,
      N.get_name(child), N3.get_position(child), child === c,
    ];
    L.set_param(d, 0, 0.25);
    DL.set_sky_mode(d, 2);
    out.push(L.get_param(l, 0), DL.get_sky_mode(l), L.get_param(d, 0), DL.get_sky_mode(d));
    return out;
  },
});

const NODE_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Node',
  compatModule: 'lib/godot-compat/node',
  probeHelpers: TREE_PROBE_HELPERS,
  cases,
};

export default NODE_EVIDENCE;
