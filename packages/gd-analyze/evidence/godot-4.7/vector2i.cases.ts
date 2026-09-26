import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2i';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

const c = caseCollector('Vector2i');
const INTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, -2],
  [2147483647, -2147483648],
  [2147483648, -2147483649],
  [4294967297, -4294967298],
  [9007199254740991, -9007199254740991],
];
const REALS: readonly (readonly [number, number])[] = [
  [0, -0],
  [1.9, -1.9],
  [0.5, -0.5],
  [16777217, -3.75],
  [2147483520, -2147483648],
  [3e9, -3e9],
  [1e30, -1e30],
  [Infinity, -Infinity],
  [Number.NaN, 7],
];

c.add('construct-empty', c.constructor, 'Vector2i()', () => V.construct());
c.add('construct-copy', c.constructor, 'Vector2i(Vector2i(5, -6))', () => V.construct(V.construct(5, -6)));
for (const [x, y] of INTS) {
  c.add(`construct-ints-${String(x)}`, c.constructor, `Vector2i(${String(x)}, ${String(y)})`, () => V.construct(x, y));
}
for (const [x, y] of REALS) {
  c.add(`construct-vector2-${String(x)}-${String(y)}`, c.constructor, `Vector2i(Vector2(${gd(x)}, ${gd(y)}))`, () =>
    V.construct({ x: Math.fround(x), y: Math.fround(y) }),
  );
}
for (const [a, b] of [
  [[1, 2], [1, 2]],
  [[1, 2], [2, 1]],
  [[0, 0], [0, 1]],
  [[-5, 7], [-5, 7]],
  [[2147483647, 0], [-2147483648, 0]],
] as const) {
  c.add(
    `op_not_equal-${a.join('_')}-${b.join('_')}`,
    c.operator('OP_NOT_EQUAL', 'Vector2i'),
    `Vector2i(${a.join(', ')}) != Vector2i(${b.join(', ')})`,
    () => V.op_not_equal(V.construct(a[0], a[1]), V.construct(b[0], b[1])),
  );
}
for (const [axis, write] of [
  ['x', V.with_x],
  ['y', V.with_y],
] as const) {
  for (const value of [0, -7, 2147483648, -4294967296, 9007199254740991]) {
    c.add(`with_${axis}-${String(value)}`, c.memberSet(axis), `var v := Vector2i(3, 4)\nv.${axis} = ${String(value)}\nreturn v`, () =>
      write(V.construct(3, 4), value),
    );
  }
}

const VECTOR2I_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Vector2i',
  compatModule: 'lib/godot-compat/vector2i',
  typeExport: 'Vector2i',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::VECTOR2I', line: 107 },
  cases: c.cases,
};

export default VECTOR2I_EVIDENCE;
