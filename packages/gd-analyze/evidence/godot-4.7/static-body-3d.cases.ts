import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceComparator } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[], comparator: GodotEvidenceComparator = 'exact'): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'StaticBody3D', member }, gdscript: built.gdscript, target: built.target, comparator });
}
const FLOOR: Op = { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] };
add('get_physics_material_override', 'get_physics_material_override', [
  { ops: [FLOOR, { read: ['material', 'floor'] }, { material: 'floor', friction: 0.2, bounce: 0 }, { read: ['material', 'floor'] }] },
]);
// A crate sliding on an icy floor: the smaller friction of the two applies.
add('set_physics_material_override', 'set_physics_material_override', [
  {
    ops: [
      FLOOR,
      { material: 'floor', friction: 0, bounce: 0 },
      { body: 'crate', kind: 'rigid', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0.52, 0] },
      { rigid: 'crate', set: 'lock_rotation', value: true },
      { rigid: 'crate', set: 'linear_velocity', value: [3, 0, 0] },
    ],
  },
  ...Array.from({ length: 60 }, (): Segment => ({ await: 'physics', ops: [{ read: ['rigidState', 'crate'] }] })),
], 'physics-trajectory');

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'StaticBody3D', compatModule: 'lib/godot-compat/static-body-3d', probeHelpers: PHYSICS_PROBE_HELPERS, cases };
export default EVIDENCE;
