import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'PhysicsBody3D', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
// A floating character pushed into a crate, touching nothing else (with a floor as well, the
// contacts' order is GodotPhysics3D's BVH history, see character-body-3d.cases.ts).
const WORLD: Op[] = [
  { body: 'crate', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [1.5, 0.9, 0] },
  { body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0, 0.9, 0] },
  { character: 'player', set: 'motion_mode', value: 1 },
];
const walk = (count: number): Segment[] =>
  Array.from({ length: count }, () => ({ await: 'physics', ops: [{ slide: 'player', velocity: [3, 0, 0.5] }, { read: ['char', 'player'] }] }));

// Moving into a crate: through it while it is an exception, blocked once it is not.
add('add_collision_exception_with', 'add_collision_exception_with', [{ ops: [...WORLD, { except: 'player', with: 'crate' }] }, ...walk(30)]);
add('remove_collision_exception_with', 'remove_collision_exception_with', [
  { ops: [...WORLD, { except: 'player', with: 'crate' }] },
  ...walk(3),
  { ops: [{ unexcept: 'player', with: 'crate' }] },
  ...walk(25),
]);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'PhysicsBody3D', compatModule: 'lib/godot-compat/physics-body-3d', probeHelpers: PHYSICS_PROBE_HELPERS, cases };
export default EVIDENCE;
