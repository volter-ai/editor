import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'RayCast3D', member }, gdscript: built.gdscript, target: built.target, comparator: 'exact' });
}
const read = (tag: string): Op => ({ read: ['raycast', tag] });
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });

const GROUND: Op = { body: 'ground', kind: 'static', shapes: [{ shape: { box: [20, 1, 20] } }], at: [0, -0.5, 0] };
const LEDGE: Op = { body: 'ledge', kind: 'static', shapes: [{ shape: { box: [2, 0.5, 2] } }], at: [3, 1.25, 0], layer: 2 };
const PLAYER: Op = { body: 'player', kind: 'static', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0.2, 1.5, 0.1] };

// A ray cast before and after its first physics frame, down onto the ground from inside a body it
// excludes (its parent), then with the parent no longer excluded.
const timeline = (member: string): void => {
  add(`${member}-under-parent`, member, [
    { ops: [GROUND, PLAYER, { raycast: 'feet', parent: 'player', at: [0, -0.8, 0], target: [0, -1.5, 0] }, read('feet')] },
    phys(read('feet')),
    proc(read('feet')),
    phys(read('feet')),
  ]);
};
for (const member of ['is_colliding', 'get_collision_point', 'get_collision_normal', 'get_collider', 'get_collider_shape']) timeline(member);

add('set_target_position-across-frames', 'set_target_position', [
  { ops: [GROUND, LEDGE, { raycast: 'ray', at: [3, 4, 0.3], target: [0, -1, 0] }] },
  phys(read('ray')),
  phys({ rayTarget: 'ray', target: [0, -10, 0] }, read('ray')),
  phys(read('ray')),
  phys({ rayTarget: 'ray', target: [-6, -10, 0] }),
  phys(read('ray')),
  phys({ rayTarget: 'ray', target: [0, 0, 0] }),
  phys(read('ray')),
]);
add('get_target_position', 'get_target_position', [
  { ops: [{ raycast: 'a' }, { raycast: 'b', target: [1.1, 2, -3.3] }, { read: ['rayTarget', 'a'] }, { read: ['rayTarget', 'b'] }] },
  phys({ rayTarget: 'a', target: [0.1, 0.2, 0.3] }, { read: ['rayTarget', 'a'] }),
]);
add('set_collision_mask', 'set_collision_mask', [
  { ops: [GROUND, LEDGE, { raycast: 'ray', at: [3, 4, 0], target: [0, -10, 0], mask: 2 }] },
  phys(),
  phys(read('ray')),
  { ops: [{ raycast: 'ray1', at: [3, 4, 0], target: [0, -10, 0], mask: 1 }] },
  phys(),
  phys(read('ray1')),
]);
add('get_collision_mask', 'get_collision_mask', [{ ops: [{ raycast: 'a' }, { raycast: 'b', mask: 0xffffffff }, { raycast: 'c', mask: 6 }, { read: ['rayMask', 'a'] }, { read: ['rayMask', 'b'] }, { read: ['rayMask', 'c'] }] }]);
add('add_exception', 'add_exception', [
  { ops: [GROUND, LEDGE, { raycast: 'ray', at: [3, 4, 0], target: [0, -10, 0], mask: 3 }] },
  phys(),
  phys(read('ray'), { rayException: 'ray', except: 'ledge' }),
  phys(read('ray'), { rayException: 'ray', except: 'ground' }),
  phys(read('ray')),
]);
add('set_enabled', 'set_enabled', [
  { ops: [GROUND, { raycast: 'ray', at: [0, 2, 0], target: [0, -5, 0] }] },
  phys(read('ray'), { rayEnabled: 'ray', on: false }, read('ray')),
  phys(read('ray'), { rayEnabled: 'ray', on: true }),
  phys(read('ray')),
]);
add('set_collide_with_areas', 'set_collide_with_areas', [
  {
    ops: [
      GROUND,
      { body: 'zone', kind: 'area', shapes: [{ shape: { sphere: 1 } }], at: [0, 2, 0] },
      { raycast: 'bodies', at: [0.1, 5, 0], target: [0, -10, 0] },
      { raycast: 'areas', at: [0.1, 5, 0], target: [0, -10, 0], areas: true },
    ],
  },
  phys(),
  phys(read('bodies'), read('areas')),
]);
add('set_exclude_parent_body', 'set_exclude_parent_body', [
  {
    ops: [
      GROUND,
      PLAYER,
      { raycast: 'excluding', parent: 'player', at: [0, 1.5, 0], target: [0, -5, 0] },
      { raycast: 'including', parent: 'player', at: [0, 1.5, 0], target: [0, -5, 0], excludeParent: false },
    ],
  },
  phys(),
  phys(read('excluding'), read('including')),
]);
add('force_raycast_update', 'force_raycast_update', [
  { ops: [GROUND, { raycast: 'ray', at: [0, 5, 0], target: [0, -10, 0] }] },
  phys(read('ray')),
  proc({ body: 'box', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 2, 0] }, read('ray'), { forceRay: 'ray' }, read('ray')),
  phys(read('ray')),
]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'RayCast3D',
  compatModule: 'lib/godot-compat/ray-cast-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};

export default EVIDENCE;
