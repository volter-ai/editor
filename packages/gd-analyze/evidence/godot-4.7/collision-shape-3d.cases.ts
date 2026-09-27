import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment, type Triple } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'CollisionShape3D', member }, gdscript: built.gdscript, target: built.target, comparator: 'rapier-geometry' });
}
const ray = (x: number): Op => ({ read: ['ray', [x, 10, 0.1] as Triple, [x, -10, 0.1] as Triple] });
const BODY: Op = { body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }, { shape: { sphere: 0.5 }, at: [3, 0, 0] }] };

add('set_shape', 'set_shape', [
  { ops: [BODY] },
  { await: 'physics', ops: [ray(0), ray(3), { reshape: 'a', index: 0, shape: { capsule: [0.3, 3] } }, ray(0)] },
  { await: 'physics', ops: [ray(0), { reshape: 'a', index: 1, shape: null }, ray(3)] },
  { await: 'physics', ops: [ray(3), { reshape: 'a', index: 1, shape: { box: [2, 2, 2] } }] },
  { await: 'physics', ops: [ray(3)] },
]);
// A shape child moved straight through three between frames (a JSX prop re-render, an editor
// drag), as Godot sees its CollisionShape3D moved: from the next physics frame a query finds it at
// its new place and not at its old one. (A move Godot sees applies to a query in the same frame; a
// move made in three is known only at the next step.)
add('moved-through-three', 'set_shape', [
  { ops: [BODY] },
  { await: 'physics', ops: [ray(3), ray(5), { shift: 'a', index: 1, at: [5, 0, 0] }] },
  { await: 'physics', ops: [ray(5), ray(3)] },
  { await: 'physics', ops: [ray(5)] },
]);
add('get_shape', 'get_shape', [{ ops: [BODY, { read: ['shapeNull', 'a', 0] }, { reshape: 'a', index: 0, shape: null }, { read: ['shapeNull', 'a', 0] }] }]);
add('set_disabled', 'set_disabled', [
  { ops: [BODY, { disable: 'a', index: 1, on: true }] },
  { await: 'physics', ops: [ray(0), ray(3), { disable: 'a', index: 0, on: true }, { disable: 'a', index: 1, on: false }, ray(0), ray(3)] },
  { await: 'physics', ops: [ray(0), ray(3)] },
]);
add('is_disabled', 'is_disabled', [{ ops: [BODY, { read: ['shapeDisabled', 'a', 0] }, { disable: 'a', index: 0, on: true }, { read: ['shapeDisabled', 'a', 0] }] }]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'CollisionShape3D',
  compatModule: 'lib/godot-compat/collision-shape-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
