import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { PHYSICS_PROBE_HELPERS, physicsCase } from './physics-timeline';

const built = physicsCase([
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [2, 1, 2] } }] }, { read: ['ray', [0, 10, 0], [0, -10, 0]] }] },
  { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0]] }, { read: ['ray', [3, 10, 0], [3, -10, 0]] }] },
]);
const cases: GodotEvidenceCase[] = [
  { id: 'space_get_direct_state', symbol: { kind: 'singleton-member', owner: 'PhysicsServer3D', member: 'space_get_direct_state' }, gdscript: built.gdscript, target: built.target, comparator: 'exact' },
];

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'PhysicsServer3D', compatModule: 'lib/godot-compat/physics-server-3d', probeHelpers: PHYSICS_PROBE_HELPERS, cases };
export default EVIDENCE;
