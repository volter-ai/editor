import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceComparator } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[], comparator: GodotEvidenceComparator = 'exact'): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'RigidBody3D', member }, gdscript: built.gdscript, target: built.target, comparator });
}
const FLOOR: Op = { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] };
const frames = (count: number, tag = 'crate'): Segment[] => Array.from({ length: count }, (): Segment => ({ await: 'physics', ops: [{ read: ['rigidState', tag] }] }));

// Free flight: Godot's integration, transcribed.
add('free-fall', 'set_linear_velocity', [
  { ops: [{ body: 'crate', kind: 'rigid', shapes: [{ shape: { box: [0.5, 0.5, 0.5] } }], at: [0, 20, 0] }, { rigid: 'crate', set: 'linear_velocity', value: [2, 5, -1] }] },
  ...frames(90),
]);
add('gravity-scale-and-mass', 'set_gravity_scale', [
  {
    ops: [
      { body: 'crate', kind: 'rigid', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 20, 0] },
      { rigid: 'crate', set: 'gravity_scale', value: 0.25 },
      { rigid: 'crate', set: 'mass', value: 3 },
      { rigid: 'crate', set: 'linear_damp', value: 0.5 },
    ],
  },
  ...frames(60),
]);
add('impulse', 'apply_central_impulse', [
  { ops: [{ body: 'crate', kind: 'rigid', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 20, 0] }, { rigid: 'crate', set: 'mass', value: 2 }] },
  { await: 'physics', ops: [{ impulse: 'crate', value: [4, 6, 0] }, { read: ['rigidState', 'crate'] }] },
  ...frames(40),
]);
// Contact with the floor: Rapier's solver.
add('land-on-floor', 'set_mass', [
  { ops: [FLOOR, { body: 'crate', kind: 'rigid', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 2, 0] }, { rigid: 'crate', set: 'lock_rotation', value: true }] },
  ...frames(100),
], 'physics-trajectory');
// A rigid enemy walking along the floor from its `_integrate_forces`.
// With friction (the default 1), GodotPhysics3D's contact holds the pushed body still where
// Rapier's lets it slide: a body driven along a floor is only compared frictionless.
add('integrate-forces-patrol', 'set_max_contacts_reported', [
  {
    ops: [
      FLOOR,
      { body: 'enemy', kind: 'rigid', shapes: [{ shape: { box: [0.8, 0.8, 0.8] } }], at: [0, 0.8, 0] },
      { patrol: 'enemy', speed: 2 },
      { material: 'enemy', friction: 0, bounce: 0 },
      { rigid: 'enemy', set: 'max_contacts_reported', value: 4 },
      { rigid: 'enemy', set: 'lock_rotation', value: true },
    ],
  },
  ...frames(90, 'enemy'),
], 'physics-trajectory');

// Each property read back after it is set, before and after a step.
const BALL: Op = { body: 'crate', kind: 'rigid', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 20, 0] };
for (const [getter, set, value] of [
  ['get_mass', 'mass', 2.5],
  ['get_gravity_scale', 'gravity_scale', -0.5],
  ['get_linear_damp', 'linear_damp', 0.75],
  ['get_linear_velocity', 'linear_velocity', [1, 2, 3]],
  ['get_angular_velocity', 'angular_velocity', [0, 3, 0]],
  ['is_using_custom_integrator', 'custom_integrator', true],
  ['get_max_contacts_reported', 'max_contacts_reported', 3],
  ['is_contact_monitor_enabled', 'contact_monitor', true],
  ['is_lock_rotation_enabled', 'lock_rotation', true],
] as const) {
  add(`${getter}`, getter, [
    { ops: [BALL, { read: ['rigidGet', 'crate', getter] }, { rigid: 'crate', set, value }, { read: ['rigidGet', 'crate', getter] }] },
    { await: 'physics', ops: [{ read: ['rigidGet', 'crate', getter] }] },
    { await: 'physics', ops: [{ read: ['rigidGet', 'crate', getter] }] },
  ]);
}
for (const [setter, set, value] of [
  ['set_linear_damp', 'linear_damp', 2],
  ['set_angular_velocity', 'angular_velocity', [0, 4, 0]],
  ['set_use_custom_integrator', 'custom_integrator', true],
  ['set_contact_monitor', 'contact_monitor', true],
  ['set_lock_rotation_enabled', 'lock_rotation', true],
] as const) {
  add(`${setter}-flight`, setter, [
    { ops: [BALL, { rigid: 'crate', set, value }, { rigid: 'crate', set: 'linear_velocity', value: [1, 0, 0] }] },
    ...Array.from({ length: 30 }, (): Segment => ({ await: 'physics', ops: [{ read: ['rigidState', 'crate'] }, { read: ['rigidGet', 'crate', 'get_angular_velocity'] }] })),
  ]);
}
add('get_contact_count', 'get_contact_count', [
  {
    ops: [
      FLOOR,
      { body: 'crate', kind: 'rigid', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0.6, 0] },
      { rigid: 'crate', set: 'max_contacts_reported', value: 4 },
      { rigid: 'crate', set: 'lock_rotation', value: true },
    ],
  },
  ...Array.from({ length: 20 }, (): Segment => ({ await: 'physics', ops: [{ read: ['rigidGet', 'crate', 'get_contact_count'] }] })),
]);

add('get_physics_material_override', 'get_physics_material_override', [
  { ops: [BALL, { read: ['material', 'crate'] }, { material: 'crate', friction: 0.25, bounce: 0.5 }, { read: ['material', 'crate'] }] },
]);
// A ball dropped on a floor bounces by the larger bounce (the floor has none): the first bounce;
// restitution is Rapier's, and later bounces drift apart beyond the trajectory bound.
add('set_physics_material_override', 'set_physics_material_override', [
  {
    ops: [
      FLOOR,
      { body: 'crate', kind: 'rigid', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 1.5, 0] },
      { material: 'crate', friction: 0.5, bounce: 0.6 },
      { rigid: 'crate', set: 'lock_rotation', value: true },
    ],
  },
  ...frames(45),
], 'physics-trajectory');

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'RigidBody3D',
  compatModule: 'lib/godot-compat/rigid-body-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
