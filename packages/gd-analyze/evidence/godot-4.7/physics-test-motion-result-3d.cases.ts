import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { CONTACT_POINTS, MOTION_DERIVATION } from './physics-server-3d.cases';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase } from './physics-timeline';

const WORLD: Op[] = [
  { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] },
  { body: 'wall', kind: 'static', shapes: [{ shape: { box: [1, 4, 20] } }], at: [3, 2, 0] },
  { body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0, 5, 0] },
];
const built = physicsCase([
  { ops: WORLD },
  {
    await: 'physics',
    ops: [
      { testMotion: 'player', from: [0, 3, 0], motion: [0, -0.1, 0] },
      { testMotion: 'player', from: [0, 0.95, 0], motion: [0, -0.1, 0] },
      { testMotion: 'player', from: [2, 0.901, 0], motion: [0.3, -0.002, 0.1], max: 6, recovery: true },
    ],
  },
]);
const cases: GodotEvidenceCase[] = [
  'get_travel',
  'get_remainder',
  'get_collision_safe_fraction',
  'get_collision_unsafe_fraction',
  'get_collision_count',
  'get_collision_point',
  'get_collision_normal',
  'get_collider_velocity',
  'get_collider',
  'get_collider_shape',
  'get_collision_local_shape',
  'get_collision_depth',
].map((member) => ({
  id: member,
  symbol: { kind: 'native-member', owner: 'PhysicsTestMotionResult3D', member },
  gdscript: built.gdscript,
  target: built.target,
  comparator: 'rapier-geometry',
  geometryFacts: CONTACT_POINTS,
  derivation: MOTION_DERIVATION,
}));

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'PhysicsTestMotionResult3D',
  compatModule: 'lib/godot-compat/physics-test-motion-result-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
