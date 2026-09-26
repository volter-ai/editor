import * as B from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Triple = readonly [number, number, number];

const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
const tv = ([x, y, z]: Triple): V.Vector3 => V.construct(x, y, z);
const gb = (x: Triple, y: Triple, z: Triple): string => `Basis(${gv(x)}, ${gv(y)}, ${gv(z)})`;
const tb = (x: Triple, y: Triple, z: Triple): B.Basis => B.construct(tv(x), tv(y), tv(z));

const BASES: readonly (readonly [string, Triple, Triple, Triple])[] = [
  ['identity', [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  ['general', [1, 2, 3], [4, -5, 6], [-7, 8, 9]],
  ['decimals', [0.1, 0.2, 0.3], [-0.4, 0.5, 0.6], [0.7, -0.8, 0.9]],
  ['rotation', [0.36, 0.48, -0.8], [-0.8, 0.6, 0], [0.48, 0.64, 0.6]],
  ['large', [1e18, 0, 2], [3, 1e-6, 0], [0, 4, -1e30]],
];
const VECTORS: readonly (readonly [string, Triple])[] = [
  ['zero', [0, 0, 0]],
  ['a', [1, 2, 3]],
  ['decimals', [0.1, -0.2, 0.3]],
  ['mixed', [123.456, -0.001, 7890.5]],
  ['large', [1e18, -2e18, 3e18]],
  ['nan', [Number.NaN, 1, 2]],
];

const c = caseCollector('Basis');
c.add('construct-empty', c.constructor, 'Basis()', () => B.construct());
for (const [name, x, y, z] of BASES) {
  c.add(`construct-columns-${name}`, c.constructor, gb(x, y, z), () => tb(x, y, z));
  c.add(`construct-copy-${name}`, c.constructor, `Basis(${gb(x, y, z)})`, () => B.construct(tb(x, y, z)));
}
for (const [axisName, axis] of [
  ['x', [1, 0, 0]],
  ['diagonal', [0.5773502691896258, 0.5773502691896258, 0.5773502691896258]],
  ['nearly-normalized', [0, 1.0004, 0]],
  ['not-normalized', [2, 0, 0]],
] as const) {
  for (const angle of [0, Math.PI / 2, 0.3, -2, 100]) {
    c.add(`construct-axis-angle-${axisName}-${String(angle)}`, c.constructor, `Basis(${gv(axis)}, ${gd(angle)})`, () =>
      B.construct(tv(axis), angle),
    );
  }
}
for (const [name, x, y, z] of BASES) {
  for (const [vectorName, value] of VECTORS) {
    c.add(`scaled-${name}-${vectorName}`, c.member('scaled'), `${gb(x, y, z)}.scaled(${gv(value)})`, () =>
      B.scaled(tb(x, y, z), tv(value)),
    );
    c.add(`op_multiply-${name}-${vectorName}`, c.operator('OP_MULTIPLY', 'Vector3'), `${gb(x, y, z)} * ${gv(value)}`, () =>
      B.op_multiply(tb(x, y, z), tv(value)),
    );
  }
  for (const [axis, write] of [
    ['x', B.with_x],
    ['y', B.with_y],
    ['z', B.with_z],
  ] as const) {
    for (const [vectorName, value] of VECTORS.slice(0, 4)) {
      c.add(`with_${axis}-${name}-${vectorName}`, c.memberSet(axis), `var b := ${gb(x, y, z)}\nb.${axis} = ${gv(value)}\nreturn b`, () =>
        write(tb(x, y, z), tv(value)),
      );
    }
  }
}

const BASIS_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Basis',
  compatModule: 'lib/godot-compat/basis',
  typeExport: 'Basis',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::BASIS', line: 118 },
  cases: c.cases,
};

export default BASIS_EVIDENCE;
