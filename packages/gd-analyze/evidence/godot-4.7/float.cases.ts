import * as F from '../../capabilities/catalog/project-source/src/lib/godot-compat/float';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Triple = readonly [number, number, number];

const c = caseCollector('float');

const SCALARS: readonly number[] = [0.1, -3, 0, -0, 1e30, 1e39, 14, 9.8, 16777217.5, Infinity, Number.NaN];
const VECTORS: readonly (readonly [string, Triple])[] = [
  ['zero', [0, 0, 0]],
  ['down', [0, -1, 0]],
  ['decimals', [0.1, 0.2, 0.3]],
  ['negative', [-1.5, 2.25, -3.75]],
  ['subnormal', [1e-40, 0, -1e-40]],
  ['large', [1e18, -2e18, 3e18]],
  ['negative-zero', [-0, 0, -0]],
];

for (const scalar of SCALARS) {
  for (const [name, [x, y, z]] of VECTORS) {
    c.add(
      `op_multiply-vector3-${gd(scalar)}-${name}`,
      c.operator('OP_MULTIPLY', 'Vector3'),
      `var s: float = ${gd(scalar)}\nreturn s * Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`,
      () => F.op_multiply(scalar, V3.construct(x, y, z)),
    );
    c.add(
      `op_multiply-vector2-${gd(scalar)}-${name}`,
      c.operator('OP_MULTIPLY', 'Vector2'),
      `var s: float = ${gd(scalar)}\nreturn s * Vector2(${gd(x)}, ${gd(y)})`,
      () => F.op_multiply(scalar, V2.construct(x, y)),
    );
  }
}

c.add('construct-empty', c.constructor, 'float()', () => F.construct());
for (const value of [2.5, -0, 1e300, Number.NaN]) {
  c.add(`construct-float-${gd(value)}`, c.constructor, `float(${gd(value)})`, () => F.construct(value));
}
for (const value of [7, -3, 9007199254740993]) {
  c.add(`construct-int-${String(value)}`, c.constructor, `var i: int = ${String(value)}\nreturn float(i)`, () =>
    F.construct(Number(BigInt(value))),
  );
}
for (const value of [true, false]) {
  c.add(`construct-bool-${String(value)}`, c.constructor, `float(${String(value)})`, () => F.construct(value));
}

const FLOAT_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'float',
  compatModule: 'lib/godot-compat/float',
  cases: c.cases,
};

export default FLOAT_EVIDENCE;
