import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Pair = readonly [number, number];

const gv = ([x, y]: Pair): string => `Vector2(${gd(x)}, ${gd(y)})`;
const tv = ([x, y]: Pair): V.Vector2 => V.construct(x, y);

const VECTORS: readonly (readonly [string, Pair])[] = [
  ['zero', [0, 0]],
  ['x', [1, 0]],
  ['a', [3, -4]],
  ['decimals', [0.1, 0.2]],
  ['negative', [-1.5, -2.25]],
  ['near-zero', [1e-6, -1e-6]],
  ['subnormal', [1e-40, 0]],
  ['large', [1e18, -2e18]],
  ['overflow', [1e30, -2e30]],
  ['mixed', [123.456, -0.001]],
  ['negative-zero', [-0, -0]],
  ['minus-x', [-1, 0]],
  ['minus-x-negative-zero-y', [-1, -0]],
];
const INFINITE: Pair = [Infinity, 1];
const NOT_A_NUMBER: Pair = [Number.NaN, 1];

const c = caseCollector('Vector2');

c.add('construct-empty', c.constructor, 'Vector2()', () => V.construct());
c.add('construct-copy', c.constructor, `Vector2(${gv([0.1, 0.2])})`, () => V.construct(tv([0.1, 0.2])));
c.add('construct-vector2i', c.constructor, 'Vector2(Vector2i(16777217, -3))', () =>
  V.construct({ x: 16777217, y: -3 }),
);
for (const [name, value] of VECTORS) c.add(`construct-floats-${name}`, c.constructor, gv(value), () => tv(value));
c.add('construct-floats-double-overflow', c.constructor, gv([1e39, -1e39]), () => tv([1e39, -1e39]));
c.add('constant-zero', c.constant('ZERO'), 'Vector2.ZERO', () => V.ZERO);

for (const [name, value] of [...VECTORS, ['infinite', INFINITE] as const, ['nan', NOT_A_NUMBER] as const]) {
  for (const unary of ['angle', 'length', 'length_squared', 'normalized'] as const) {
    c.add(`${unary}-${name}`, c.member(unary), `${gv(value)}.${unary}()`, () => V[unary](tv(value)));
  }
  c.add(`limit_length-default-${name}`, c.member('limit_length'), `${gv(value)}.limit_length()`, () =>
    V.limit_length(tv(value)),
  );
}
for (const length of [0.5, 10, 0, -1, 0.1]) {
  for (const [name, value] of VECTORS.slice(0, 10)) {
    c.add(`limit_length-${String(length)}-${name}`, c.member('limit_length'), `${gv(value)}.limit_length(${gd(length)})`, () =>
      V.limit_length(tv(value), length),
    );
  }
}
// angle near +-pi, where atan2f's [-pi, pi] range decides the rounding, and over every octant.
for (const y of [1e-40, 1e-30, 1e-8, 1e-7, 3e-7, 1e-6, -1e-7, -1e-8]) {
  c.add(`angle-near-pi-${String(y)}`, c.member('angle'), `${gv([-1, y])}.angle()`, () => V.angle(tv([-1, y])));
}
for (const [name, value] of [
  ['minus-infinity', [-Infinity, 1]],
  ['minus-infinity-infinity', [-Infinity, Infinity]],
  ['infinity-infinity', [Infinity, Infinity]],
  ['up', [0, 1]],
  ['down', [0, -1]],
] as const) {
  c.add(`angle-${name}`, c.member('angle'), `${gv(value)}.angle()`, () => V.angle(tv(value)));
}
for (let step = 0; step < 16; step += 1) {
  const a = (step * Math.PI) / 8 + 0.1;
  const value: Pair = [Math.cos(a) * 3.5, Math.sin(a) * 3.5];
  c.add(`angle-octant-${String(step)}`, c.member('angle'), `${gv(value)}.angle()`, () => V.angle(tv(value)));
}

const PAIRS: readonly (readonly [string, Pair, Pair])[] = [
  ['a-b', [3, -4], [4, -5]],
  ['zero-a', [0, 0], [3, -4]],
  ['decimals-negative', [0.1, 0.2], [-1.5, 2.25]],
  ['near-zero-mixed', [1e-6, -1e-6], [123.456, -0.001]],
  ['large-a', [1e18, -2e18], [3, 4]],
  ['overflow-large', [1e30, -2e30], [1e18, 2e18]],
  ['same', [7.25, -0.5], [7.25, -0.5]],
];
for (const [name, left, right] of PAIRS) {
  c.add(`distance_to-${name}`, c.member('distance_to'), `${gv(left)}.distance_to(${gv(right)})`, () =>
    V.distance_to(tv(left), tv(right)),
  );
  c.add(`op_add-${name}`, c.operator('OP_ADD', 'Vector2'), `${gv(left)} + ${gv(right)}`, () => V.op_add(tv(left), tv(right)));
  c.add(`op_subtract-${name}`, c.operator('OP_SUBTRACT', 'Vector2'), `${gv(left)} - ${gv(right)}`, () =>
    V.op_subtract(tv(left), tv(right)),
  );
  c.add(`op_multiply-vector-${name}`, c.operator('OP_MULTIPLY', 'Vector2'), `${gv(left)} * ${gv(right)}`, () =>
    V.op_multiply(tv(left), tv(right)),
  );
  c.add(`op_divide-vector-${name}`, c.operator('OP_DIVIDE', 'Vector2'), `${gv(left)} / ${gv(right)}`, () =>
    V.op_divide(tv(left), tv(right)),
  );
}
for (const [name, value] of VECTORS) {
  for (const scalar of [0.1, -3, 0, 1e30]) {
    c.add(`op_multiply-float-${name}-${String(scalar)}`, c.operator('OP_MULTIPLY', 'float'), `${gv(value)} * ${gd(scalar)}`, () =>
      V.op_multiply(tv(value), scalar),
    );
    c.add(`op_divide-float-${name}-${String(scalar)}`, c.operator('OP_DIVIDE', 'float'), `${gv(value)} / ${gd(scalar)}`, () =>
      V.op_divide(tv(value), scalar),
    );
  }
  for (const scalar of [2, -3, 0, 16777217]) {
    c.add(`op_multiply-int-${name}-${String(scalar)}`, c.operator('OP_MULTIPLY', 'int'), `${gv(value)} * ${String(scalar)}`, () =>
      V.op_multiply(tv(value), scalar),
    );
    c.add(`op_divide-int-${name}-${String(scalar)}`, c.operator('OP_DIVIDE', 'int'), `${gv(value)} / ${String(scalar)}`, () =>
      V.op_divide(tv(value), scalar),
    );
  }
  for (const [axis, write] of [
    ['x', V.with_x],
    ['y', V.with_y],
  ] as const) {
    for (const assigned of [0.1, -2.5, 1e30, 1e39]) {
      c.add(`with_${axis}-${name}-${String(assigned)}`, c.memberSet(axis), `var v := ${gv(value)}\nv.${axis} = ${gd(assigned)}\nreturn v`, () =>
        write(tv(value), assigned),
      );
    }
  }
}

const VECTOR2_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Vector2',
  compatModule: 'lib/godot-compat/vector2',
  typeExport: 'Vector2',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::VECTOR2', line: 106 },
  cases: c.cases,
};

export default VECTOR2_EVIDENCE;
