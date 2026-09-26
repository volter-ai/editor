import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Segment } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, member: string, segments: readonly Segment[], comparator: GodotEvidenceCase['comparator'] = 'exact'): void {
  const built = physicsCase(segments);
  cases.push({ id, symbol: { kind: 'native-member', owner: 'Area3D', member }, gdscript: built.gdscript, target: built.target, comparator });
}
const phys = (...ops: Op[]): Segment => ({ await: 'physics', ops });
const proc = (...ops: Op[]): Segment => ({ await: 'process', ops });
const mark = (label: string): Op => ({ mark: label });
const frames = (count: number, ...ops: Op[]): Segment[] => Array.from({ length: count }, (_, index) => phys(mark(`f${String(index)}`), ...(index === count - 1 ? ops : [])));

const COIN: Op = { body: 'coin', kind: 'area', shapes: [{ shape: { sphere: 0.5 } }], at: [0, 1, 0] };

// A static body moved into and out of a still area, across frames.
add('static-body-moved-through', 'get_overlapping_bodies', [
  { ops: [COIN, { body: 'box', kind: 'static', shapes: [{ shape: { box: [0.5, 0.5, 0.5] } }], at: [3, 1, 0] }, { watch: 'coin' }] },
  ...frames(2),
  phys({ move: 'box', at: [0.2, 1, 0] }, mark('moved-in')),
  ...frames(3, { read: ['overlapping', 'coin'] }),
  phys({ move: 'box', at: [3, 1, 0] }, mark('moved-out')),
  ...frames(3, { read: ['overlapping', 'coin'] }),
]);
// A body added inside the area, then removed from the tree while inside.
add('body-added-and-removed', 'overlaps_body', [
  { ops: [COIN, { body: 'box', kind: 'static', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 1.2, 0], detached: true }, { watch: 'coin' }] },
  ...frames(2),
  phys({ add: 'box' }, mark('added')),
  ...frames(3, { read: ['overlaps', 'coin', 'box'] }),
  phys({ remove: 'box' }, mark('removed'), { read: ['overlaps', 'coin', 'box'] }),
  ...frames(3, { read: ['overlapping', 'coin'] }),
]);
// The area moves onto a still body; its mask stops seeing the body's layer.
add('area-moved-and-masked', 'has_overlapping_bodies', [
  { ops: [{ body: 'coin', kind: 'area', shapes: [{ shape: { box: [1, 1, 1] } }], at: [5, 0, 0] }, { body: 'wall', kind: 'static', shapes: [{ shape: { box: [1, 4, 1] } }], at: [0, 0, 0] }, { watch: 'coin' }] },
  ...frames(2),
  phys({ move: 'coin', at: [0.5, 0, 0] }, mark('moved')),
  ...frames(3, { read: ['overlapping', 'coin'] }),
  phys({ mask: 'coin', value: 2 }, mark('masked')),
  ...frames(3, { read: ['overlapping', 'coin'] }),
]);
// A platformer pickup: a character walks through a coin (a moving kinematic body is active). The
// overlap sets and signals are exact; the character's positions follow Rapier's contacts.
add('character-walks-through', 'get_overlapping_bodies', [
  {
    ops: [
      { body: 'floor', kind: 'static', shapes: [{ shape: { box: [40, 1, 40] } }], at: [0, -0.5, 0] },
      { body: 'coin', kind: 'area', shapes: [{ shape: { sphere: 0.4 } }], at: [2, 1, 0] },
      { body: 'player', kind: 'character', shapes: [{ shape: { capsule: [0.4, 1.8] } }], at: [0, 0.9, 0] },
      { watch: 'coin' },
    ],
  },
  ...Array.from({ length: 40 }, (): Segment => ({ await: 'physics', ops: [{ slide: 'player', velocity: [6, -0.1, 0] }, { read: ['charPosition', 'player'] }, { read: ['overlapping', 'coin'] }] })),
], 'rapier-geometry');
add('set_monitoring', 'set_monitoring', [
  { ops: [COIN, { body: 'box', kind: 'static', shapes: [{ shape: { sphere: 0.3 } }], at: [0, 1, 0] }, { watch: 'coin' }] },
  ...frames(3, { read: ['overlapping', 'coin'] }),
  proc({ monitoring: 'coin', on: false }, mark('off'), { read: ['monitoring', 'coin'] }),
  ...frames(3),
  phys({ monitoring: 'coin', on: true }, mark('on'), { read: ['monitoring', 'coin'] }),
  ...frames(3, { read: ['overlapping', 'coin'] }),
]);
add('is_monitoring', 'is_monitoring', [{ ops: [COIN, { read: ['monitoring', 'coin'] }, { monitoring: 'coin', on: false }, { read: ['monitoring', 'coin'] }] }]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'Area3D',
  compatModule: 'lib/godot-compat/area-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};
export default EVIDENCE;
