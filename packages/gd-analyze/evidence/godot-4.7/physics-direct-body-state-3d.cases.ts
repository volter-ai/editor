import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

// A ball spinning about y drops onto a floor: its direct state each step, one contact once landed.
const built = physicsCase([
  {
    ops: [
      { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] },
      { body: 'ball', kind: 'rigid', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 0.8, 0] },
      { probeState: 'ball' },
      { rigid: 'ball', set: 'max_contacts_reported', value: 2 },
    ],
  },
  ...Array.from({ length: 40 }, (): Segment => ({ await: 'physics', ops: [] })),
]);
const cases: GodotEvidenceCase[] = [
  'get_step',
  'get_total_gravity',
  'get_linear_velocity',
  'set_linear_velocity',
  'get_angular_velocity',
  'set_angular_velocity',
  'get_transform',
  'get_contact_count',
  'get_contact_local_position',
  'get_contact_local_normal',
  'get_contact_collider_object',
].map((member) => ({
  id: member,
  symbol: { kind: 'native-member', owner: 'PhysicsDirectBodyState3D', member },
  gdscript: built.gdscript,
  target: built.target,
  comparator: 'physics-trajectory',
}));

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'PhysicsDirectBodyState3D',
  compatModule: 'lib/godot-compat/physics-direct-body-state-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
