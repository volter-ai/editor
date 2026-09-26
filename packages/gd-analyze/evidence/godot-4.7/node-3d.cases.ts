import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as SV from '../../capabilities/catalog/project-source/src/lib/godot-compat/sub-viewport';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';
import { basis, int, scene, type Step, transform, v3, type Value } from './scene-tree';

const cases: GodotEvidenceCase[] = [];
const member = (name: string): GodotEvidenceSymbol => ({ kind: 'native-member', owner: 'Node3D', member: name });

function add(id: string, symbol: string, steps: readonly Step[], call: string, on = 'a', args: readonly Value[] = []): void {
  const built = scene(steps, { call, on, args }, [N], (viewport, size) => SV.set_size(viewport, size as never));
  cases.push({ id, symbol: member(symbol), gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}

const A: Step = { node: 'a' };
const GETTERS = [
  'get_position',
  'get_rotation',
  'get_scale',
  'get_basis',
  'get_transform',
  'get_global_transform',
  'get_global_position',
  'get_global_basis',
  'get_rotation_order',
  'is_set_as_top_level',
] as const;

// A fresh Node3D.
for (const getter of GETTERS) add(`fresh-${getter}`, getter, [A], getter);

const EULERS: readonly (readonly [string, Value])[] = [
  ['zero', v3(0, 0, 0)],
  ['small', v3(0.1, 0.2, 0.3)],
  ['mixed', v3(-1.2, 2.5, 0.75)],
  ['gimbal-x', v3(Math.PI / 2, 0.3, 0.2)],
  ['gimbal-y', v3(0.3, Math.PI / 2, 0.2)],
  ['gimbal-neg', v3(-Math.PI / 2, -Math.PI / 2, 0.4)],
  ['large', v3(7, -9, 13)],
  ['pure-y', v3(0, 1.1, 0)],
  ['pure-x', v3(0.9, 0, 0)],
];
const SCALES: readonly (readonly [string, Value])[] = [
  ['uniform', v3(2, 2, 2)],
  ['non-uniform', v3(1, 3, 0.5)],
  ['negative', v3(-1, 2, 3)],
  ['all-negative', v3(-2, -0.5, -1)],
  ['tiny', v3(1e-6, 1, 1)],
];
const ORDERS = [0, 1, 2, 3, 4, 5];

for (const order of ORDERS) {
  for (const [name, euler] of EULERS) {
    const steps: Step[] = [A, { call: 'set_rotation_order', on: 'a', args: [int(order)] }, { call: 'set_rotation', on: 'a', args: [euler] }];
    add(`set_rotation-${String(order)}-${name}-basis`, 'set_rotation', steps, 'get_basis');
    add(`set_rotation-${String(order)}-${name}-rotation`, 'get_rotation', steps, 'get_rotation');
    add(`set_rotation-${String(order)}-${name}-scale`, 'get_scale', steps, 'get_scale');
    // Round trip through a set transform: the Euler angles come back out of the basis.
    const viaTransform: Step[] = [
      ...steps,
      { call: 'set_scale', on: 'a', args: [v3(1, 3, 0.5)] },
      { call: 'set_transform', on: 'a', args: [transform([1, 0.5, 0], [0.2, 2, -0.3], [0.1, 0, 0.7], [1, 2, 3])] },
    ];
    add(`set_transform-${String(order)}-${name}-rotation`, 'set_transform', viaTransform, 'get_rotation');
  }
  // Changing the order in each dirty state.
  for (const [state, pre] of [
    ['fresh', []],
    ['after-rotation', [{ call: 'set_rotation', on: 'a', args: [v3(0.4, -0.7, 1.3)] }]],
    ['after-transform', [{ call: 'set_transform', on: 'a', args: [transform([0.6, 0.8, 0], [-0.8, 0.6, 0], [0, 0, 2], [0, 0, 0])] }]],
    ['after-read', [{ call: 'set_rotation', on: 'a', args: [v3(0.4, -0.7, 1.3)] }, { call: 'get_transform', on: 'a' }]],
  ] as const) {
    const steps: Step[] = [A, ...pre, { call: 'set_rotation_order', on: 'a', args: [int(order)] }];
    add(`set_rotation_order-${state}-${String(order)}-rotation`, 'set_rotation_order', steps, 'get_rotation');
    add(`set_rotation_order-${state}-${String(order)}-basis`, 'get_rotation_order', steps, 'get_basis');
  }
}
add('set_rotation_order-invalid', 'set_rotation_order', [A, { call: 'set_rotation_order', on: 'a', args: [int(9)] }], 'get_rotation_order');

for (const [name, scale] of SCALES) {
  for (const [eulerName, euler] of EULERS.slice(0, 4)) {
    const steps: Step[] = [A, { call: 'set_rotation', on: 'a', args: [euler] }, { call: 'set_scale', on: 'a', args: [scale] }];
    add(`set_scale-${name}-${eulerName}-basis`, 'set_scale', steps, 'get_basis');
    add(`set_scale-${name}-${eulerName}-rotation`, 'get_rotation', steps, 'get_rotation');
    add(`set_scale-${name}-${eulerName}-scale`, 'get_scale', steps, 'get_scale');
  }
}

const BASES: readonly (readonly [string, Value])[] = [
  ['rotation', basis([0.36, 0.48, -0.8], [-0.8, 0.6, 0], [0.48, 0.64, 0.6])],
  ['sheared', basis([1, 0.5, 0], [0.2, 2, -0.3], [0.1, 0, 0.7])],
  ['mirrored', basis([-1, 0, 0], [0, 1, 0], [0, 0, 1])],
  ['singular', basis([1, 2, 3], [2, 4, 6], [0, 0, 1])],
];
for (const [name, value] of BASES) {
  const steps: Step[] = [A, { call: 'set_position', on: 'a', args: [v3(4, 5, 6)] }, { call: 'set_basis', on: 'a', args: [value] }];
  add(`set_basis-${name}-transform`, 'set_basis', steps, 'get_transform');
  add(`set_basis-${name}-rotation`, 'get_rotation', steps, 'get_rotation');
  add(`set_basis-${name}-scale`, 'get_scale', steps, 'get_scale');
}

for (const [name, value] of [
  ['plain', v3(1, 2, 3)],
  ['decimals', v3(0.1, -0.2, 0.3)],
  ['huge', v3(1e39, -1e-40, 16777217)],
] as const) {
  add(`set_position-${name}`, 'set_position', [A, { call: 'set_position', on: 'a', args: [value] }], 'get_position');
  add(`set_position-after-rotation-${name}`, 'get_transform', [
    A,
    { call: 'set_rotation', on: 'a', args: [v3(0.3, 0.2, 0.1)] },
    { call: 'set_position', on: 'a', args: [value] },
  ], 'get_transform');
}

// Parented transforms.
const PARENT: Step[] = [
  { node: 'p' },
  { call: 'set_rotation', on: 'p', args: [v3(0.3, -1.1, 0.25)] },
  { call: 'set_scale', on: 'p', args: [v3(2, 0.5, 1.5)] },
  { call: 'set_position', on: 'p', args: [v3(10, -3, 2.5)] },
  { node: 'a', parent: 'p' },
  { call: 'set_position', on: 'a', args: [v3(1, 2, 3)] },
  { call: 'set_rotation', on: 'a', args: [v3(0.5, 0.1, -0.2)] },
];
const GRAND: Step[] = [...PARENT, { node: 'g', parent: 'a' }, { call: 'set_position', on: 'g', args: [v3(-1, 0.5, 4)] }];
for (const getter of ['get_global_transform', 'get_global_position', 'get_global_basis'] as const) {
  add(`parented-${getter}`, getter, PARENT, getter);
  add(`grandchild-${getter}`, getter, GRAND, getter, 'g');
}
add('parented-after-parent-moves', 'get_global_transform', [...PARENT, { call: 'rotate_y', on: 'p', args: [0.7] }], 'get_global_transform');
for (const [name, value] of [
  ['identity', transform([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0])],
  ['general', transform([0.6, 0.8, 0], [-0.8, 0.6, 0], [0, 0, 2], [5, 6, 7])],
] as const) {
  add(`set_global_transform-${name}-local`, 'set_global_transform', [...PARENT, { call: 'set_global_transform', on: 'a', args: [value] }], 'get_transform');
  add(`set_global_transform-${name}-global`, 'get_global_transform', [...PARENT, { call: 'set_global_transform', on: 'a', args: [value] }], 'get_global_transform');
  add(`set_global_transform-root-${name}`, 'set_global_transform', [A, { call: 'set_global_transform', on: 'a', args: [value] }], 'get_transform');
}
add('set_global_position-local', 'set_global_position', [...PARENT, { call: 'set_global_position', on: 'a', args: [v3(0, 1, 0)] }], 'get_transform');
add('set_global_position-grand', 'set_global_position', [...GRAND, { call: 'set_global_position', on: 'g', args: [v3(-4, 2, 9)] }], 'get_global_transform', 'g');
add('set_global_basis-local', 'set_global_basis', [...PARENT, { call: 'set_global_basis', on: 'a', args: [basis([0, 0, 1], [0, 1, 0], [-1, 0, 0])] }], 'get_transform');

// A plain Node between two Node3Ds: the lower one has no parent Node3D, so global = local.
const PLAIN: Step[] = [...PARENT.slice(0, 4), { node: 'm', parent: 'p', plain: true }, { node: 'a', parent: 'm' }, { call: 'set_position', on: 'a', args: [v3(1, 2, 3)] }];
for (const getter of ['get_global_transform', 'get_global_position'] as const) add(`plain-node-parent-${getter}`, getter, PLAIN, getter);
add('plain-node-parent-set_global_position', 'set_global_position', [...PLAIN, { call: 'set_global_position', on: 'a', args: [v3(5, 5, 5)] }], 'get_transform');

// top_level.
for (const enabled of [true, false]) {
  const toggled: Step[] = [...GRAND, { call: 'set_as_top_level', on: 'a', args: [true] }, ...(enabled ? [] : [{ call: 'set_as_top_level', on: 'a', args: [false] } as Step])];
  add(`set_as_top_level-${String(enabled)}-local`, 'set_as_top_level', toggled, 'get_transform');
  add(`set_as_top_level-${String(enabled)}-global`, 'get_global_transform', toggled, 'get_global_transform');
  add(`set_as_top_level-${String(enabled)}-grand`, 'get_global_transform', toggled, 'get_global_transform', 'g');
  add(`set_as_top_level-${String(enabled)}-flag`, 'is_set_as_top_level', toggled, 'is_set_as_top_level');
  add(`set_as_top_level-${String(enabled)}-parent-moves`, 'set_as_top_level', [...toggled, { call: 'set_position', on: 'p', args: [v3(-50, 0, 0)] }], 'get_global_transform');
}
add('set_as_top_level-root', 'set_as_top_level', [A, { call: 'set_position', on: 'a', args: [v3(1, 1, 1)] }, { call: 'set_as_top_level', on: 'a', args: [true] }], 'get_transform');

// rotate_y.
for (const angle of [0, 0.5, -2, Math.PI, 100]) {
  add(`rotate_y-${String(angle)}`, 'rotate_y', [A, { call: 'rotate_y', on: 'a', args: [angle] }], 'get_transform');
  add(`rotate_y-scaled-${String(angle)}`, 'rotate_y', [
    A,
    { call: 'set_rotation', on: 'a', args: [v3(0.2, 0.3, 0.4)] },
    { call: 'set_scale', on: 'a', args: [v3(1, 2, 3)] },
    { call: 'rotate_y', on: 'a', args: [angle] },
  ], 'get_transform');
  add(`rotate_y-rotation-${String(angle)}`, 'get_rotation', [A, { call: 'rotate_y', on: 'a', args: [angle] }, { call: 'rotate_y', on: 'a', args: [angle] }], 'get_rotation');
}

// look_at_from_position.
for (const [name, args] of [
  ['forward', [v3(0, 0, 0), v3(0, 0, -5)]],
  ['diagonal', [v3(1, 2, 3), v3(4, -2, 8)]],
  ['up-colinear', [v3(0, 0, 0), v3(0, 10, 0)]],
  ['same', [v3(1, 1, 1), v3(1, 1, 1.000001)]],
  ['custom-up', [v3(0, 0, 0), v3(3, 1, -2), v3(1, 0, 0)]],
  ['zero-up', [v3(0, 0, 0), v3(3, 1, -2), v3(0, 0, 0)]],
  ['model-front', [v3(2, 0, 0), v3(3, 1, -2), v3(0, 1, 0), true]],
] as const) {
  add(`look_at_from_position-${name}`, 'look_at_from_position', [
    A,
    { call: 'set_scale', on: 'a', args: [v3(1, 2, 0.5)] },
    { call: 'look_at_from_position', on: 'a', args: args as readonly Value[] },
  ], 'get_transform');
  add(`look_at_from_position-parented-${name}`, 'look_at_from_position', [
    ...PARENT,
    { call: 'look_at_from_position', on: 'a', args: args as readonly Value[] },
  ], 'get_global_transform');
}

const NODE3D_EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Node3D',
  compatModule: 'lib/godot-compat/node-3d',
  cases,
};

export default NODE3D_EVIDENCE;
