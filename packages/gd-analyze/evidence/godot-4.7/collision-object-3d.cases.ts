import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceComparator } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[], comparator: GodotEvidenceComparator = 'exact'): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'CollisionObject3D', member }, gdscript: built.gdscript, target: built.target, comparator });
}
const BOX: Op = { body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }] };
const reads = (): Op[] => [
  { read: ['layer', 'a'] },
  { read: ['mask', 'a'] },
  ...[1, 2, 3, 32, 0, 33].flatMap((bit): Op[] => [{ read: ['layerBit', 'a', bit] }, { read: ['maskBit', 'a', bit] }]),
];
add('get_collision_layer-default', 'get_collision_layer', [{ ops: [BOX, { read: ['layer', 'a'] }] }]);
add('get_collision_mask-default', 'get_collision_mask', [{ ops: [BOX, { read: ['mask', 'a'] }] }]);
for (const value of [0, 5, 0x80000000, 0xffffffff, 2 ** 32 + 3, -1]) {
  add(`set_collision_layer-${String(value)}`, 'set_collision_layer', [{ ops: [BOX, { layer: 'a', value }, ...reads()] }]);
  add(`set_collision_mask-${String(value)}`, 'set_collision_mask', [{ ops: [BOX, { mask: 'a', value }, ...reads()] }]);
}
add('get_collision_layer_value', 'get_collision_layer_value', [{ ops: [BOX, { layer: 'a', value: 0x80000005 }, ...reads()] }]);
add('get_collision_mask_value', 'get_collision_mask_value', [{ ops: [BOX, { mask: 'a', value: 0x80000006 }, ...reads()] }]);
add('set_collision_layer_value', 'set_collision_layer_value', [
  { ops: [BOX, { layerBit: 'a', bit: 3, on: true }, { layerBit: 'a', bit: 1, on: false }, { layerBit: 'a', bit: 32, on: true }, { layerBit: 'a', bit: 0, on: true }, { layerBit: 'a', bit: 33, on: true }, ...reads()] },
]);
add('set_collision_mask_value', 'set_collision_mask_value', [
  { ops: [BOX, { maskBit: 'a', bit: 2, on: true }, { maskBit: 'a', bit: 1, on: false }, { maskBit: 'a', bit: 32, on: true }, { maskBit: 'a', bit: 0, on: true }, ...reads()] },
]);
// The RID a query excludes by.
add('get_rid', 'get_rid', [
  { ops: [BOX, { body: 'b', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 3, 0] }] },
  { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0], { exclude: ['b'] }] }, { read: ['ray', [0, 10, 0], [0, -10, 0], { exclude: ['a'] }] }] },
]);
// Layer and mask decide which bodies a query sees, as they change between frames.
add('set_collision_layer-queried', 'set_collision_layer', [
  { ops: [BOX] },
  { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0], { mask: 2 }] }, { layer: 'a', value: 2 }, { read: ['ray', [0, 10, 0], [0, -10, 0], { mask: 2 }] }] },
  { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0], { mask: 2 }] }, { layerBit: 'a', bit: 2, on: false }, { read: ['ray', [0, 10, 0], [0, -10, 0], { mask: 2 }] }] },
]);

// A crate whose mask misses the floor's layer falls through it onto the ground.
add('set_collision_mask-rigid', 'set_collision_mask', [
  {
    ops: [
      { body: 'floor', kind: 'static', shapes: [{ shape: { box: [10, 0.2, 10] } }], at: [0, 0, 0], layer: 2 },
      { body: 'ground', kind: 'static', shapes: [{ shape: { box: [10, 0.2, 10] } }], at: [0, -2, 0] },
      { body: 'crate', kind: 'rigid', shapes: [{ shape: { box: [0.5, 0.5, 0.5] } }], at: [0, 1, 0], layer: 4, mask: 1 },
      { rigid: 'crate', set: 'lock_rotation', value: true },
    ],
  },
  ...Array.from({ length: 60 }, (): Segment => ({ await: 'physics', ops: [{ read: ['rigidState', 'crate'] }] })),
], 'physics-trajectory');

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'CollisionObject3D',
  compatModule: 'lib/godot-compat/collision-object-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
