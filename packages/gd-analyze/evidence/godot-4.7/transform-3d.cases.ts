import * as B from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/transform-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Triple = readonly [number, number, number];

const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
const tv = ([x, y, z]: Triple): V.Vector3 => V.construct(x, y, z);
const gb = (x: Triple, y: Triple, z: Triple): string => `Basis(${gv(x)}, ${gv(y)}, ${gv(z)})`;
const tb = (x: Triple, y: Triple, z: Triple): B.Basis => B.construct(tv(x), tv(y), tv(z));

const GENERAL: readonly [Triple, Triple, Triple] = [[1, 2, 3], [4, -5, 6], [-7, 8, 9]];
const ORIGINS: readonly (readonly [string, Triple])[] = [
  ['zero', [0, 0, 0]],
  ['a', [1, 2, 3]],
  ['decimals', [0.1, -0.2, 0.3]],
  ['far', [1000.5, -2000.25, 3e6]],
];
const TARGETS: readonly (readonly [string, Triple])[] = [
  ['forward', [0, 0, -5]],
  ['diagonal', [3, 4, 5]],
  ['up', [0, 10, 0]],
  ['down', [0, -3, 0]],
  ['near', [1.000001, 2, 3]],
  ['same-as-a', [1, 2, 3]],
  ['decimals', [0.7, -0.3, 0.9]],
  ['far', [-5000, 12.5, 1e5]],
];
const UPS: readonly (readonly [string, Triple])[] = [
  ['up', [0, 1, 0]],
  ['x', [1, 0, 0]],
  ['tilted', [0.1, 1, 0.2]],
  ['zero', [0, 0, 0]],
];

const c = caseCollector('Transform3D');
c.add('construct-empty', c.constructor, 'Transform3D()', () => T.construct());
for (const [name, origin] of ORIGINS) {
  c.add(`construct-basis-origin-${name}`, c.constructor, `Transform3D(${gb(...GENERAL)}, ${gv(origin)})`, () =>
    T.construct(tb(...GENERAL), tv(origin)),
  );
  c.add(`construct-axes-${name}`, c.constructor, `Transform3D(${gv(GENERAL[0])}, ${gv(GENERAL[1])}, ${gv(GENERAL[2])}, ${gv(origin)})`, () =>
    T.construct(tv(GENERAL[0]), tv(GENERAL[1]), tv(GENERAL[2]), tv(origin)),
  );
  c.add(`construct-copy-${name}`, c.constructor, `Transform3D(Transform3D(${gb(...GENERAL)}, ${gv(origin)}))`, () =>
    T.construct(T.construct(tb(...GENERAL), tv(origin))),
  );
}
for (const [originName, origin] of ORIGINS) {
  const gt = `Transform3D(${gb(...GENERAL)}, ${gv(origin)})`;
  const tt = () => T.construct(tb(...GENERAL), tv(origin));
  for (const [targetName, target] of TARGETS) {
    c.add(`looking_at-default-${originName}-${targetName}`, c.member('looking_at'), `${gt}.looking_at(${gv(target)})`, () =>
      T.looking_at(tt(), tv(target)),
    );
    for (const [upName, up] of UPS) {
      for (const front of [false, true]) {
        c.add(
          `looking_at-${originName}-${targetName}-${upName}-${String(front)}`,
          c.member('looking_at'),
          `${gt}.looking_at(${gv(target)}, ${gv(up)}, ${String(front)})`,
          () => T.looking_at(tt(), tv(target), tv(up), front),
        );
      }
    }
  }
  c.add(`with_basis-${originName}`, c.memberSet('basis'), `var t := ${gt}\nt.basis = ${gb([0.5, 0, 0], [0, 2, 0], [0, 0.25, 1])}\nreturn t`, () =>
    T.with_basis(tt(), tb([0.5, 0, 0], [0, 2, 0], [0, 0.25, 1])),
  );
  c.add(`with_origin-${originName}`, c.memberSet('origin'), `var t := ${gt}\nt.origin = ${gv([7.5, -0.1, 1e30])}\nreturn t`, () =>
    T.with_origin(tt(), tv([7.5, -0.1, 1e30])),
  );
}

const ROTATED: readonly [Triple, Triple, Triple] = [[0.36, 0.48, -0.8], [-0.8, 0.6, 0], [0.48, 0.64, 0.6]];
const SINGULAR: readonly [Triple, Triple, Triple] = [[1, 2, 3], [2, 4, 6], [0, 1, 0]];
for (const [basisName, axes] of [
  ['general', GENERAL],
  ['rotated', ROTATED],
  ['singular', SINGULAR],
] as const) {
  for (const [originName, origin] of ORIGINS) {
    const gt = `Transform3D(${gb(...axes)}, ${gv(origin)})`;
    const tt = () => T.construct(tb(...axes), tv(origin));
    c.add(`affine_inverse-${basisName}-${originName}`, c.member('affine_inverse'), `${gt}.affine_inverse()`, () => T.affine_inverse(tt()));
    for (const [pointName, point] of ORIGINS) {
      c.add(`op_multiply-${basisName}-${originName}-vector-${pointName}`, c.operator('OP_MULTIPLY', 'Vector3'), `${gt} * ${gv(point)}`, () =>
        T.op_multiply(tt(), tv(point)),
      );
    }
    c.add(
      `op_multiply-${basisName}-${originName}-transform`,
      c.operator('OP_MULTIPLY', 'Transform3D'),
      `${gt} * Transform3D(${gb(...ROTATED)}, ${gv([0.5, -1.5, 2.25])})`,
      () => T.op_multiply(tt(), T.construct(tb(...ROTATED), tv([0.5, -1.5, 2.25]))),
    );
  }
}

const TRANSFORM3D_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Transform3D',
  compatModule: 'lib/godot-compat/transform-3d',
  typeExport: 'Transform3D',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::TRANSFORM3D', line: 119 },
  cases: c.cases,
};

export default TRANSFORM3D_EVIDENCE;
