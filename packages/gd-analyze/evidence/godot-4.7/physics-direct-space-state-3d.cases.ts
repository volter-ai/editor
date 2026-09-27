import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { type Op, PHYSICS_PROBE_HELPERS, physicsCase, type Read, type Segment, type Shape, type Triple } from './physics-timeline';

const cases: GodotEvidenceCase[] = [];
function add(id: string, segments: readonly Segment[]): void {
  const built = physicsCase(segments);
  // The hit point and normal are Rapier's ray cast (the bounded deviation in the compat module).
  const comparator = 'rapier-geometry';
  cases.push({ id, symbol: { kind: 'native-member', owner: 'PhysicsDirectSpaceState3D', member: 'intersect_ray' }, gdscript: built.gdscript, target: built.target, comparator });
}
const ray = (from: Triple, to: Triple, options?: NonNullable<Extract<Read, readonly ['ray', ...unknown[]]>[3]>): Op => ({ read: options === undefined ? ['ray', from, to] : ['ray', from, to, options] });
const SHAPES: readonly (readonly [string, Shape])[] = [
  ['box', { box: [2, 1, 3] }],
  ['sphere', { sphere: 0.75 }],
  ['capsule', { capsule: [0.5, 2] }],
  ['convex', { convex: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.5, 0]] }],
  ['concave', { concave: [[-5, 0, -5], [5, 0, -5], [5, 0, 5], [-5, 0, -5], [5, 0, 5], [-5, 0, 5]] }],
];
const RAYS: readonly (readonly [string, Triple, Triple])[] = [
  ['down', [0.3, 5, 0.2], [0.3, -5, 0.2]],
  ['up', [0.1, -5, -0.4], [0.1, 5, -0.4]],
  ['side', [-6, 0.25, 0.1], [6, 0.25, 0.1]],
  // Off the box's edge: at an edge Godot reports the entered face's normal, Rapier the edge's.
  ['diagonal', [3.1, 4, 2], [-1, -2, -0.5]],
  ['miss', [10, 10, 10], [10, -10, 10]],
  ['short', [0.3, 5, 0.2], [0.3, 3, 0.2]],
];
for (const [shapeName, shape] of SHAPES) {
  for (const [rayName, from, to] of RAYS) {
    add(`${shapeName}-${rayName}`, [{ ops: [{ body: 'b', kind: 'static', shapes: [{ shape }], at: [0, 0.5, 0] }] }, { await: 'physics', ops: [ray(from, to)] }]);
  }
}
add('rotated-box', [{ ops: [{ body: 'b', kind: 'static', shapes: [{ shape: { box: [2, 1, 3] }, rotation: [0.3, 0.7, 0] }], at: [0, 0, 0], rotation: [0, 0.4, 0.2] }] }, { await: 'physics', ops: [ray([0.2, 5, 0.1], [0.2, -5, 0.1]), ray([-5, 0.1, 0], [5, 0.1, 0])] }]);
add('offset-shape', [{ ops: [{ body: 'b', kind: 'static', shapes: [{ shape: { sphere: 0.5 }, at: [2, 0, 0] }, { shape: { box: [1, 1, 1] }, at: [-2, 0, 0] }] }] }, { await: 'physics', ops: [ray([2, 5, 0], [2, -5, 0]), ray([-2, 5, 0], [-2, -5, 0]), ray([-6, 0, 0], [6, 0, 0])] }]);
add('nearest-of-two', [{ ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }, { body: 'b', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 3, 0] }] }, { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0]), ray([0, -10, 0], [0, 10, 0])] }]);
add('masks-and-layers', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0], layer: 2 }, { body: 'b', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 3, 0], layer: 4 }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0], { mask: 2 }), ray([0, 10, 0], [0, -10, 0], { mask: 4 }), ray([0, 10, 0], [0, -10, 0], { mask: 1 }), ray([0, 10, 0], [0, -10, 0], { mask: 6 })] },
]);
add('exclude', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }, { body: 'b', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 3, 0] }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0], { exclude: ['b'] }), ray([0, 10, 0], [0, -10, 0], { exclude: ['a', 'b'] })] },
]);
add('areas', [
  { ops: [{ body: 'a', kind: 'area', shapes: [{ shape: { box: [2, 2, 2] } }], at: [0, 3, 0] }, { body: 'b', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0]), ray([0, 10, 0], [0, -10, 0], { areas: true }), ray([0, 10, 0], [0, -10, 0], { areas: true, bodies: false })] },
]);
add('from-inside', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [2, 2, 2] } }], at: [0, 0, 0] }, { body: 'b', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, -5, 0] }] },
  { await: 'physics', ops: [ray([0, 0.2, 0], [0, -10, 0]), ray([0, 0.2, 0], [0, -10, 0], { inside: true })] },
]);
add('moved-body', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0]), { move: 'a', at: [0, 2, 0] }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0])] },
]);
add('disabled-shape', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] }, disabled: true }], at: [0, 0, 0] }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0]), { disable: 'a', index: 0, on: false }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0])] },
]);
add('removed-body', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0]), { remove: 'a' }] },
  { await: 'physics', ops: [ray([0, 10, 0], [0, -10, 0])] },
]);

const TERRAIN: readonly Triple[] = [
  [-4, 0, -4], [0, 0.5, -4], [0, 1, 0],
  [-4, 0, -4], [0, 1, 0], [-4, -0.25, 0],
  [0, 0.5, -4], [4, 0.2, -4], [4, -0.5, 0],
  [0, 0.5, -4], [4, -0.5, 0], [0, 1, 0],
  [-4, -0.25, 0], [0, 1, 0], [0, 0.3, 4],
  [-4, -0.25, 0], [0, 0.3, 4], [-4, 0.1, 4],
  [0, 1, 0], [4, -0.5, 0], [4, 0, 4],
  [0, 1, 0], [4, 0, 4], [0, 0.3, 4],
];
const TERRAIN_RAYS = (): Op[] => [
  ray([-2.1, 5, -1.7], [-2.1, -5, -1.7]),
  ray([1.3, 5, -2.2], [1.3, -5, -2.2]),
  ray([2.6, 5, 1.9], [2.6, -5, 1.9]),
  ray([-1.4, 5, 2.8], [-1.4, -5, 2.8]),
  ray([-6, 2, 0.7], [6, -1, 0.3]),
  ray([1.1, -5, 0.9], [1.1, 5, 0.9]),
];
add('concave-terrain', [{ ops: [{ body: 't', kind: 'static', shapes: [{ shape: { concave: TERRAIN } }], at: [0.5, -0.2, 0.25], rotation: [0, 0.3, 0] }] }, { await: 'physics', ops: TERRAIN_RAYS() }]);
add('concave-backface', [
  { ops: [{ body: 't', kind: 'static', shapes: [{ shape: { concave: TERRAIN, backface: true } }] }] },
  { await: 'physics', ops: [...TERRAIN_RAYS(), ray([1.1, -5, 0.9], [1.1, 5, 0.9], { backFaces: false }), ray([-2.1, 5, -1.7], [-2.1, -5, -1.7], { backFaces: false })] },
]);
const OCTAHEDRON: readonly Triple[] = [[1.2, 0, 0], [-0.8, 0, 0], [0, 1.5, 0], [0, -0.7, 0], [0, 0, 1.1], [0, 0, -0.9], [0.2, 0.3, 0.1]];
const PRISM: readonly Triple[] = [[-1, -0.5, -0.7], [1.3, -0.5, -0.4], [0.2, -0.5, 1.2], [-0.9, 0.8, -0.6], [1.1, 0.6, -0.3], [0.3, 0.9, 1.0]];
for (const [name, points] of [
  ['octahedron', OCTAHEDRON],
  ['prism', PRISM],
] as const) {
  add(`convex-${name}`, [
    { ops: [{ body: 'c', kind: 'static', shapes: [{ shape: { convex: points } }], at: [0.3, 0.1, -0.2], rotation: [0.2, -0.5, 0.1] }] },
    {
      await: 'physics',
      ops: [
        ray([0.4, 5, -0.1], [0.4, -5, -0.1]),
        ray([0.1, -5, 0.2], [0.1, 5, 0.2]),
        ray([-5, 0.3, -0.3], [5, 0.3, -0.3]),
        ray([4, 3, 2], [-3, -2, -1.5]),
        ray([0.3, 0.2, -0.2], [0.3, -5, -0.2]),
        ray([0.3, 0.2, -0.2], [0.3, -5, -0.2], { inside: true }),
      ],
    },
  ]);
}
add('rotated-capsule-and-sphere', [
  {
    ops: [
      { body: 'c', kind: 'static', shapes: [{ shape: { capsule: [0.4, 1.8] }, rotation: [0, 0, 1.2] }], at: [0, 0.3, 0], rotation: [0.4, 0, 0] },
      { body: 's', kind: 'static', shapes: [{ shape: { sphere: 0.6 }, at: [0.2, 0, 0.1] }], at: [3, 0.2, -1], rotation: [0.3, 0.9, -0.2] },
    ],
  },
  {
    await: 'physics',
    ops: [
      ray([0.5, 5, 0.1], [0.5, -5, 0.1]),
      ray([-5, 0.4, 0.05], [5, 0.4, 0.05]),
      ray([3.1, 5, -0.9], [3.1, -5, -0.9]),
      ray([0, 0.3, 0], [0, -5, 0]),
      ray([0, 0.3, 0], [0, -5, 0], { inside: true }),
      ray([3.2, 0.2, -0.9], [3.2, 5, -0.9], { inside: true }),
    ],
  },
]);
add('moved-same-frame', [
  { ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }] },
  { await: 'physics', ops: [{ move: 'a', at: [0, 2, 0] }, ray([0, 10, 0], [0, -10, 0])] },
  { await: 'process', ops: [ray([0, 10, 0], [0, -10, 0])] },
]);
add('added-same-frame', [
  { ops: [] },
  { await: 'physics', ops: [{ body: 'a', kind: 'static', shapes: [{ shape: { box: [1, 1, 1] } }], at: [0, 0, 0] }, ray([0, 10, 0], [0, -10, 0])] },
  { await: 'process', ops: [ray([0, 10, 0], [0, -10, 0])] },
]);

const EVIDENCE: GodotEvidenceCaseFile = {
  kind: 'node',
  godotClass: 'PhysicsDirectSpaceState3D',
  compatModule: 'lib/godot-compat/physics-direct-space-state-3d',
  probeHelpers: PHYSICS_PROBE_HELPERS,
  cases,
};

export default EVIDENCE;
