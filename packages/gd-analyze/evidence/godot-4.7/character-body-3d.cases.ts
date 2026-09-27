import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceComparator, GodotEvidenceGeometryFact } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment, type Triple } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(
  id: string,
  member: string,
  segments: readonly Segment[],
  comparator: GodotEvidenceComparator = 'rapier-geometry',
  geometryFacts?: readonly GodotEvidenceGeometryFact[],
): void {
  const built = physicsCase(segments);
  cases.push({
    id,
    symbol: { kind: 'native-member', owner: 'CharacterBody3D', member },
    gdscript: built.gdscript,
    target: built.target,
    comparator,
    ...(geometryFacts === undefined ? {} : { geometryFacts }),
    ...(comparator === 'rapier-geometry' ? { derivation: DERIVATION } : {}),
  });
}
const DERIVATION =
  'get_real_velocity is compared as get_real_velocity() / 60, the frame\'s displacement, and get_last_motion as the displacement it is, under the position bound';
/**
 * Walking on a floor under gravity, each frame's slides graze the floor: on some frames Godot's GJK
 * sweep misses a graze Rapier's query meets, so Godot's slide collision count (the frame record's
 * eighth value) is one or two lower and the character sinks up to 0.0027 into the floor. The frame records
 * carry `get_real_velocity() / 60`, the frame's displacement, compared as positions.
 */
const WALK_FACTS: readonly GodotEvidenceGeometryFact[] = [
  { at: ['*', 7], within: 2, fact: 'slide collisions per frame: Godot 1 or 2 / Rapier 3 where Godot\'s sweep misses a floor graze (it sinks up to 0.0027)' },
];
const GRAVITY: Triple = [0, -9.8 / 60, 0];
const FLOOR: Op = { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] };
const player = (at: Triple): Op => ({ body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at });
/** Frames of a platformer's `_physics_process`: gravity, then move_and_slide, then the state. */
const frames = (count: number, velocity?: (frame: number) => Triple | undefined, read: 'char' | 'charState' = 'char'): Segment[] =>
  Array.from({ length: count }, (_, frame) => {
    const set = velocity?.(frame);
    return { await: 'physics', ops: [{ slide: 'player', plus: GRAVITY, ...(set === undefined ? {} : { velocity: set }) }, { read: [read, 'player'] }] };
  });

add('move_and_slide-fall-and-land', 'move_and_slide', [{ ops: [FLOOR, player([0, 2, 0])] }, ...frames(45)]);
add('move_and_slide-walk', 'move_and_slide', [{ ops: [FLOOR, player([0, 0.9, 0])] }, ...frames(30, () => [4, 0, 1.5])], 'rapier-geometry', WALK_FACTS);
add('move_and_slide-jump', 'move_and_slide', [
  { ops: [FLOOR, player([0, 0.9, 0])] },
  ...frames(3),
  ...frames(1, () => [2, 4.5, 0]),
  ...frames(60),
]);
// Against a wall and the floor at once, the recovery sums the contacts of both in the order
// GodotPhysics3D's BVH returns them, which depends on the broad phase's history (the same frames
// run after other cases resolve a frame differently natively).
add(
  'move_and_slide-wall-slide',
  'move_and_slide',
  [{ ops: [FLOOR, player([0, 0.9, 0]), { body: 'wall', kind: 'static', shapes: [{ shape: { box: [1, 4, 20] } }], at: [2, 2, 0] }] }, ...frames(40, () => [5, 0, 3], 'charState')],
  'rapier-geometry',
  WALK_FACTS,
);
add('move_and_slide-ceiling', 'move_and_slide', [
  { ops: [FLOOR, player([0, 0.9, 0]), { body: 'roof', kind: 'static', shapes: [{ shape: { box: [10, 1, 10] } }], at: [0, 3, 0] }] },
  ...frames(2),
  ...frames(1, () => [0, 8, 0]),
  ...frames(40),
]);

// Each state reader over the landing, and each setting over a walk that exercises it.
const LANDING: Segment[] = [{ ops: [FLOOR, player([0, 1.2, 0.3])] }, ...frames(20)];
for (const member of [
  'is_on_floor',
  'is_on_floor_only',
  'is_on_wall',
  'is_on_wall_only',
  'is_on_ceiling',
  'is_on_ceiling_only',
  'get_floor_normal',
  'get_wall_normal',
  'get_last_motion',
  'get_position_delta',
  'get_real_velocity',
  'get_slide_collision_count',
  'get_velocity',
  'set_velocity',
]) {
  add(`${member}-landing`, member, LANDING);
}
const MAX_SLIDES_FRAMES = 13;
const setting = (member: string, set: Extract<Op, { character: string }>['set'], value: number | boolean | Triple, walk: Triple, count = 30): void => {
  add(
    `${member}-walk`,
    member,
    [
      { ops: [FLOOR, player([0, 0.9, 0]), { body: 'ramp', kind: 'static', shapes: [{ shape: { box: [4, 1, 4] } }], at: [3, 0, 0], rotation: [0, 0, 0.35] }, { character: 'player', set, value }] },
      ...frames(count, () => walk),
    ],
    'rapier-geometry',
    WALK_FACTS,
  );
};
setting('set_up_direction', 'up_direction', [0, 2, 0], [3, 0, 0]);
setting('set_floor_max_angle', 'floor_max_angle', 0.2, [3, 0, 0]);
setting('set_floor_snap_length', 'floor_snap_length', 0.5, [3, 0, 0]);
// One slide a frame: each frame's travel is the grazing cast's safe fraction, so the positions drift
// apart frame by frame (measured: within 0.03 through frame 13, then 0.04 further in one frame); the
// case keeps the frames the position bound holds for.
setting('set_max_slides', 'max_slides', 1, [3, 0, 0], MAX_SLIDES_FRAMES);
setting('set_safe_margin', 'safe_margin', 0.01, [3, 0, 0]);
setting('set_floor_stop_on_slope_enabled', 'floor_stop_on_slope', false, [3, 0, 0]);
setting('set_floor_constant_speed_enabled', 'floor_constant_speed', true, [3, 0, 0]);
setting('set_floor_block_on_wall_enabled', 'floor_block_on_wall', false, [3, 0, 0]);
setting('set_slide_on_ceiling_enabled', 'slide_on_ceiling', false, [3, 0, 0]);
setting('set_motion_mode', 'motion_mode', 1, [3, 0, 0]);
setting('set_wall_min_slide_angle', 'wall_min_slide_angle', 0.5, [3, 0, 0]);
add('apply_floor_snap', 'apply_floor_snap', [
  { ops: [FLOOR, player([0, 0.95, 0])] },
  { await: 'physics', ops: [{ read: ['char', 'player'] }, { snap: 'player' }, { read: ['char', 'player'] }] },
]);

for (const member of [
  'get_safe_margin',
  'get_floor_angle',
  'get_platform_velocity',
  'is_floor_stop_on_slope_enabled',
  'is_floor_constant_speed_enabled',
  'is_floor_block_on_wall_enabled',
  'is_slide_on_ceiling_enabled',
  'get_motion_mode',
  'get_max_slides',
  'get_floor_max_angle',
  'get_floor_snap_length',
  'get_wall_min_slide_angle',
  'get_up_direction',
]) {
  add(`${member}-defaults-and-landing`, member, [
    { ops: [FLOOR, { body: 'ramp', kind: 'static', shapes: [{ shape: { box: [4, 1, 4] } }], at: [0, 0, 0], rotation: [0, 0, 0.3] }, player([0.3, 1.8, 0]), { read: ['charGet', 'player', member] }] },
    ...frames(20),
    { await: 'physics', ops: [{ read: ['charGet', 'player', member] }] },
  ]);
}

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'CharacterBody3D',
  compatModule: 'lib/godot-compat/character-body-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
