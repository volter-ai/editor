import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment, type Triple } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[]): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'singleton-member', owner: 'PhysicsServer3D', member }, gdscript: built.gdscript, target: built.target, comparator: 'rapier-geometry' });
}
add('space_get_direct_state', 'space_get_direct_state', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [2, 1, 2] } }] }, { read: ['ray', [0, 10, 0], [0, -10, 0]] }] },
  { await: 'physics', ops: [{ read: ['ray', [0, 10, 0], [0, -10, 0]] }, { read: ['ray', [3, 10, 0], [3, -10, 0]] }] },
]);

const WORLD: Op[] = [
  { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] },
  { body: 'wall', kind: 'static', shapes: [{ shape: { box: [1, 4, 20] } }], at: [3, 2, 0] },
  { body: 'ramp', kind: 'static', shapes: [{ shape: { box: [4, 1, 4] } }], at: [-4, 0, 0], rotation: [0, 0, 0.35] },
  { body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0, 5, 0] },
  { body: 'ball', kind: 'character', shapes: [{ shape: { sphere: 0.5 } }], at: [0, 8, 5] },
];
const tests: readonly (readonly [string, string, Triple, Triple, Partial<{ margin: number; max: number; recovery: boolean }>])[] = [
  ['free-fall', 'player', [0, 3, 0], [0, -0.1, 0], {}],
  ['land', 'player', [0, 0.95, 0], [0, -0.1, 0], {}],
  ['touching-walk', 'player', [0, 0.9, 0], [0.0667, -0.00272, 0.025], { max: 6, recovery: true }],
  ['recovered-walk', 'player', [0, 0.9008268117904663, 0], [0.06666667014360428, -0.0027222223579883575, 0.02500000223517418], { max: 6, recovery: true }],
  ['sunk', 'player', [0.3, 0.897, 0.1], [0.05, 0, 0], { max: 6, recovery: true }],
  ['into-wall', 'player', [2, 0.901, 0], [0.3, -0.002, 0.1], { max: 6, recovery: true }],
  ['wall-touching', 'player', [2.1, 0.9005, 0], [0.083, -0.0027, 0.05], { max: 6, recovery: true }],
  ['onto-ramp', 'player', [-2.5, 2, 0], [-0.5, -1, 0], { max: 4 }],
  ['sphere-drop', 'ball', [0, 0.52, 5], [0.1, -0.2, 0], { max: 4, recovery: true }],
  ['snap', 'player', [0, 0.95, 0], [0, -0.1, 0], { max: 4, recovery: true }],
  ['big-margin', 'player', [0, 0.92, 0], [0.2, 0, 0], { margin: 0.05, max: 6, recovery: true }],
];
add('body_test_motion', 'body_test_motion', [
  { ops: WORLD },
  { await: 'physics', ops: tests.map(([, body, from, motion, options]): Op => ({ testMotion: body, from, motion, ...options })) },
]);

// A character sliding along a wall on a floor: the two calls move_and_slide makes each frame.
const SLIDE_WORLD: Op[] = [
  { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] },
  { body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0, 5, 0] },
  { body: 'wall', kind: 'static', shapes: [{ shape: { box: [1, 4, 20] } }], at: [2, 2, 0] },
];
add('body_test_motion-along-wall', 'body_test_motion', [
  { ops: SLIDE_WORLD },
  {
    await: 'physics',
    ops: [1.4999996423721313, 1.5499995946884155, 1.5999995470046997, 1.6499994993209839].flatMap((z): Op[] => [
      { testMotion: 'player', from: [1.0833332538604736, 0.9008677005767822, z], motion: [0.0833333358168602, -0.0027222223579883575, 0.05000000447034836], max: 6, recovery: true },
      { testMotion: 'player', from: [1.0833332538604736, 0.9003148078918457, z], motion: [0, 0, 0.05000000447034836], max: 6, recovery: true },
    ]),
  },
]);

// A character walking into a crate beside it on the floor: the calls of two frames.
add('body_test_motion-into-crate', 'body_test_motion', [
  {
    ops: [
      { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] },
      { body: 'crate', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [1.5, 0.5, 0] },
      { body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0, 5, 0] },
    ],
  },
  {
    await: 'physics',
    ops: (
      [
        [[0.5000000596046448, 0.8982036113739014, 0], [0.05000000447034836, -0.0027222223579883575, 0]],
        [[0.5377930402755737, 0.8985364437103271, 0], [0.01220703125, -0.0006646050605922937, 0]],
        [[0.5500000715255737, 0.8999726176261902, 0], [0.05000000447034836, -0.0027222223579883575, 0]],
        [[0.5687038898468018, 0.8989542722702026, 0], [0.03129618614912033, -0.0017039033118635416, 0]],
        [[0.5858190059661865, 0.8997595310211182, 0], [0.014181084930896759, 0, 0]],
        [[0.5858190059661865, 0.9007956981658936, 0], [0.05000000447034836, -0.0027222223579883575, 0]],
      ] as const
    ).map(([from, motion]): Op => ({ testMotion: 'player', from, motion, max: 6, recovery: true })),
  },
]);

const EVIDENCE: GodotEvidenceCaseFile = { kind: 'node', godotClass: 'PhysicsServer3D', compatModule: 'lib/godot-compat/physics-server-3d', probeHelpers: PHYSICS_PROBE_HELPERS, cases };
export default EVIDENCE;
