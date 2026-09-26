import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3i';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

const c = caseCollector('Vector3i');
const INTS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, -2, 3],
  [2147483647, -2147483648, 0],
  [2147483648, -2147483649, 4294967297],
  [9007199254740991, -9007199254740991, 12],
];
const REALS: readonly (readonly [number, number, number])[] = [
  [0, -0, 0.5],
  [1.9, -1.9, -0.5],
  [16777217, -3.75, 1e-40],
  [2147483520, -2147483648, 3e9],
  [1e30, -1e30, Infinity],
  [-Infinity, Number.NaN, 7],
];

c.add('construct-empty', c.constructor, 'Vector3i()', () => V.construct());
c.add('construct-copy', c.constructor, 'Vector3i(Vector3i(5, -6, 7))', () => V.construct(V.construct(5, -6, 7)));
for (const [x, y, z] of INTS) {
  c.add(`construct-ints-${String(x)}-${String(z)}`, c.constructor, `Vector3i(${String(x)}, ${String(y)}, ${String(z)})`, () =>
    V.construct(x, y, z),
  );
}
for (const [x, y, z] of REALS) {
  c.add(
    `construct-vector3-${String(x)}-${String(y)}-${String(z)}`,
    c.constructor,
    `Vector3i(Vector3(${gd(x)}, ${gd(y)}, ${gd(z)}))`,
    () => V.construct({ x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) }),
  );
}
for (const [axis, write] of [
  ['x', V.with_x],
  ['y', V.with_y],
  ['z', V.with_z],
] as const) {
  for (const value of [0, -7, 2147483648, -4294967296, 9007199254740991]) {
    c.add(`with_${axis}-${String(value)}`, c.memberSet(axis), `var v := Vector3i(3, 4, 5)\nv.${axis} = ${String(value)}\nreturn v`, () =>
      write(V.construct(3, 4, 5), value),
    );
  }
}

const VECTOR3I_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Vector3i',
  compatModule: 'lib/godot-compat/vector3i',
  typeExport: 'Vector3i',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::VECTOR3I', line: 111 },
  cases: c.cases,
};

export default VECTOR3I_EVIDENCE;
