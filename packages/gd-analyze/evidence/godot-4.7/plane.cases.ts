import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/plane';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Triple = readonly [number, number, number];
const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
const tv = ([x, y, z]: Triple): V.Vector3 => V.construct(x, y, z);

const PLANES: readonly (readonly [string, Triple, number])[] = [
  ['ground', [0, 1, 0], 0],
  ['raised', [0, 1, 0], 2.5],
  ['tilted', [0.6, 0.8, 0], -1.25],
  ['decimals', [0.1, 0.2, 0.3], 0.4],
  ['zero', [0, 0, 0], 0],
];
const gp = (n: Triple, d: number): string => `Plane(${gv(n)}, ${gd(d)})`;
const tp = (n: Triple, d: number): P.Plane => P.construct(tv(n), d);

const RAYS: readonly (readonly [string, Triple, Triple])[] = [
  ['down', [1, 10, 2], [0, -1, 0]],
  ['up-from-below', [1, -10, 2], [0, 1, 0]],
  ['away', [1, 10, 2], [0, 1, 0]],
  ['parallel', [1, 10, 2], [1, 0, 0]],
  ['nearly-parallel', [1, 10, 2], [1, -1e-6, 0]],
  ['slanted', [0.3, 5.5, -2], [0.2, -0.9, 0.1]],
  ['on-plane', [3, 0, 3], [0, -1, 0]],
  ['just-behind', [3, 1e-6, 3], [0, 1, 0]],
  ['long', [1e6, 1e6, -1e6], [-0.5, -0.5, 0.5]],
];

const c = caseCollector('Plane');
c.add('construct-empty', c.constructor, 'Plane()', () => P.construct());
for (const [name, n, d] of PLANES) {
  c.add(`construct-normal-d-${name}`, c.constructor, gp(n, d), () => tp(n, d));
  c.add(`construct-normal-${name}`, c.constructor, `Plane(${gv(n)})`, () => P.construct(tv(n)));
  c.add(`construct-copy-${name}`, c.constructor, `Plane(${gp(n, d)})`, () => P.construct(tp(n, d)));
  c.add(`construct-normal-point-${name}`, c.constructor, `Plane(${gv(n)}, ${gv([1.5, -2, 0.25])})`, () =>
    P.construct(tv(n), tv([1.5, -2, 0.25])),
  );
  c.add(`construct-abcd-${name}`, c.constructor, `Plane(${gd(n[0])}, ${gd(n[1])}, ${gd(n[2])}, ${gd(d)})`, () =>
    P.construct(n[0], n[1], n[2], d),
  );
  for (const [rayName, from, dir] of RAYS) {
    c.add(`intersects_ray-${name}-${rayName}`, c.member('intersects_ray'), `${gp(n, d)}.intersects_ray(${gv(from)}, ${gv(dir)})`, () =>
      P.intersects_ray(tp(n, d), tv(from), tv(dir)),
    );
  }
  c.add(`with_normal-${name}`, c.memberSet('normal'), `var p := ${gp(n, d)}\np.normal = ${gv([0, 0, 1])}\nreturn p`, () =>
    P.with_normal(tp(n, d), tv([0, 0, 1])),
  );
  c.add(`with_d-${name}`, c.memberSet('d'), `var p := ${gp(n, d)}\np.d = 0.1\nreturn p`, () => P.with_d(tp(n, d), 0.1));
}
for (const [name, points] of [
  ['triangle', [[0, 0, 0], [1, 0, 0], [0, 0, 1]]],
  ['decimals', [[0.1, 0.2, 0.3], [1.5, -0.5, 2], [-1, 3, 0.25]]],
  ['colinear', [[0, 0, 0], [1, 1, 1], [2, 2, 2]]],
] as const) {
  c.add(`construct-points-${name}`, c.constructor, `Plane(${points.map(gv).join(', ')})`, () =>
    P.construct(tv(points[0]), tv(points[1]), tv(points[2])),
  );
}

const PLANE_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Plane',
  compatModule: 'lib/godot-compat/plane',
  typeExport: 'Plane',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::PLANE', line: 115 },
  cases: c.cases,
};

export default PLANE_EVIDENCE;
