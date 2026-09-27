import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'World3D', member }, gdscript: built.gdscript, target: built.target, comparator: 'rapier-geometry' });
}
const SCENE: Segment = { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { sphere: 1 } }], at: [0.5, 0, 0] }] };
add('get_space', 'get_space', [SCENE, { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0]] }, { read: ['ray', [5, 10, 0], [5, -10, 0]] }] }]);
add('get_direct_space_state', 'get_direct_space_state', [
  SCENE,
  { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0], { via: 'world' }] }, { read: ['ray', [5, 10, 0], [5, -10, 0], { via: 'world' }] }] },
  { await: 'process', ops: [{ move: 'a', at: [5, 0, 0] }, { read: ['ray', [5, 10, 0], [5, -10, 0], { via: 'world' }] }] },
  { await: 'physics', ops: [{ read: ['ray', [5, 10, 0], [5, -10, 0], { via: 'world' }] }] },
]);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'World3D', compatModule: 'lib/godot-compat/world-3d', probeHelpers: PHYSICS_PROBE_HELPERS, cases };
export default EVIDENCE;
