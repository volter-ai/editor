import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type {
  GodotEvidenceCase,
  GodotEvidenceCaseFile,
  GodotEvidenceComparator,
  GodotEvidenceSymbol,
} from '../../src/evidence/case';

interface Triple {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const t = (x: number, y: number, z: number): Triple => ({ x, y, z });

/** A GDScript float literal with exactly this double's value. */
function gd(value: number): string {
  if (Number.isNaN(value)) return 'NAN';
  if (value === Infinity) return 'INF';
  if (value === -Infinity) return '-INF';
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

const gv = (v: Triple): string => `Vector3(${gd(v.x)}, ${gd(v.y)}, ${gd(v.z)})`;
const tv = (v: Triple): V.Vector3 => V.construct(v.x, v.y, v.z);

const ZERO = t(0, 0, 0);
const X = t(1, 0, 0);
const Y = t(0, 1, 0);
const Z = t(0, 0, 1);
const A = t(1, 2, 3);
const B = t(4, -5, 6);
const DECIMALS = t(0.1, 0.2, 0.3);
const NEGATIVE = t(-1.5, 2.25, -3.75);
const NEAR_ZERO = t(1e-6, -1e-6, 9.99e-6);
const EPSILON_EDGE = t(1e-5, 0, 0);
const SUBNORMAL = t(1e-40, 0, 0);
const LARGE = t(1e18, -2e18, 3e18);
const OVERFLOW = t(1e30, -2e30, 3e30);
const MIXED = t(123.456, -0.001, 7890.5);
const INFINITE = t(Infinity, 0, 1);
const NOT_A_NUMBER = t(Number.NaN, 1, 2);
const DIAGONAL = t(0.5773502691896258, 0.5773502691896258, 0.5773502691896258);
const VECTORS: readonly (readonly [string, Triple])[] = [
  ['zero', ZERO],
  ['x', X],
  ['a', A],
  ['decimals', DECIMALS],
  ['negative', NEGATIVE],
  ['near-zero', NEAR_ZERO],
  ['epsilon-edge', EPSILON_EDGE],
  ['subnormal', SUBNORMAL],
  ['large', LARGE],
  ['overflow', OVERFLOW],
  ['mixed', MIXED],
];

const cases: GodotEvidenceCase[] = [];

function add(
  id: string,
  symbol: GodotEvidenceSymbol,
  gdscript: string,
  target: () => unknown,
  comparator: GodotEvidenceComparator = 'exact',
): void {
  cases.push({ id, symbol, gdscript, target, comparator });
}

const member = (name: string): GodotEvidenceSymbol => ({
  kind: 'builtin-member',
  owner: 'Vector3',
  member: name,
});
const operator = (name: string, right?: string): GodotEvidenceSymbol => ({
  kind: 'builtin-operator',
  owner: 'Vector3',
  member: name,
  ...(right === undefined ? {} : { right }),
});
const memberSet = (name: string): GodotEvidenceSymbol => ({
  kind: 'builtin-member-set',
  owner: 'Vector3',
  member: name,
});
const CONSTRUCTOR: GodotEvidenceSymbol = {
  kind: 'builtin-constructor',
  owner: 'Vector3',
  member: 'Vector3',
};

// Constructors: no arguments, from Vector3, from Vector3i, from three floats.
add('construct-empty', CONSTRUCTOR, 'Vector3()', () => V.construct());
add('construct-copy', CONSTRUCTOR, `Vector3(${gv(DECIMALS)})`, () => V.construct(tv(DECIMALS)));
add('construct-vector3i', CONSTRUCTOR, 'Vector3(Vector3i(1, -2, 3))', () =>
  V.construct({ x: 1, y: -2, z: 3 }),
);
add('construct-vector3i-rounds', CONSTRUCTOR, 'Vector3(Vector3i(16777217, -16777219, 0))', () =>
  V.construct({ x: 16777217, y: -16777219, z: 0 }),
);
for (const [name, value] of VECTORS) {
  add(`construct-floats-${name}`, CONSTRUCTOR, gv(value), () => tv(value));
}
add('construct-floats-negative-zero', CONSTRUCTOR, gv(t(-0, 0, -0)), () => tv(t(-0, 0, -0)));
add('construct-floats-infinite', CONSTRUCTOR, gv(INFINITE), () => tv(INFINITE));
add('construct-floats-double-overflow', CONSTRUCTOR, gv(t(1e39, -1e39, 3.4e38)), () =>
  tv(t(1e39, -1e39, 3.4e38)),
);

// Constants.
add('constant-zero', { kind: 'builtin-constant', owner: 'Vector3', member: 'ZERO' }, 'Vector3.ZERO', () => V.ZERO);
add('constant-up', { kind: 'builtin-constant', owner: 'Vector3', member: 'UP' }, 'Vector3.UP', () => V.UP);

// Unary members over every vector.
for (const [name, value] of VECTORS) {
  for (const unary of ['is_zero_approx', 'length', 'length_squared', 'normalized'] as const) {
    add(`${unary}-${name}`, member(unary), `${gv(value)}.${unary}()`, () => V[unary](tv(value)));
  }
  add(`limit_length-default-${name}`, member('limit_length'), `${gv(value)}.limit_length()`, () =>
    V.limit_length(tv(value)),
  );
}
for (const [name, value] of [
  ['infinite', INFINITE],
  ['nan', NOT_A_NUMBER],
] as const) {
  add(`normalized-${name}`, member('normalized'), `${gv(value)}.normalized()`, () =>
    V.normalized(tv(value)),
  );
  add(`is_zero_approx-${name}`, member('is_zero_approx'), `${gv(value)}.is_zero_approx()`, () =>
    V.is_zero_approx(tv(value)),
  );
}
add('is_zero_approx-negative-zero', member('is_zero_approx'), `${gv(t(-0, -0, -0))}.is_zero_approx()`, () =>
  V.is_zero_approx(tv(t(-0, -0, -0))),
);
add('is_zero_approx-just-under', member('is_zero_approx'), `${gv(t(9.9e-6, -9.9e-6, 0))}.is_zero_approx()`, () =>
  V.is_zero_approx(tv(t(9.9e-6, -9.9e-6, 0))),
);

for (const [name, length] of [
  ['half', 0.5],
  ['ten', 10],
  ['zero', 0],
  ['negative', -1],
  ['decimal', 0.1],
] as const) {
  for (const [vectorName, value] of [
    ['a', A],
    ['negative', NEGATIVE],
    ['zero', ZERO],
    ['large', LARGE],
  ] as const) {
    add(
      `limit_length-${name}-${vectorName}`,
      member('limit_length'),
      `${gv(value)}.limit_length(${gd(length)})`,
      () => V.limit_length(tv(value), length),
    );
  }
}

// Binary members.
const PAIRS: readonly (readonly [string, Triple, Triple])[] = [
  ['a-b', A, B],
  ['x-y', X, Y],
  ['y-x', Y, X],
  ['zero-a', ZERO, A],
  ['decimals-negative', DECIMALS, NEGATIVE],
  ['near-zero-mixed', NEAR_ZERO, MIXED],
  ['large-a', LARGE, A],
  ['overflow-large', OVERFLOW, LARGE],
  ['mixed-mixed', MIXED, MIXED],
];
for (const [name, left, right] of PAIRS) {
  for (const binary of ['cross', 'dot', 'distance_to'] as const) {
    add(`${binary}-${name}`, member(binary), `${gv(left)}.${binary}(${gv(right)})`, () =>
      V[binary](tv(left), tv(right)),
    );
  }
  for (const weight of [0, 1, 0.5, 0.1, -0.5, 1.5]) {
    add(
      `lerp-${name}-${String(weight)}`,
      member('lerp'),
      `${gv(left)}.lerp(${gv(right)}, ${gd(weight)})`,
      () => V.lerp(tv(left), tv(right), weight),
    );
  }
}

// rotated: normalized axes, a nearly normalized axis, and axes MATH_CHECKS rejects.
const AXES: readonly (readonly [string, Triple])[] = [
  ['x', X],
  ['y', Y],
  ['z', Z],
  ['diagonal', DIAGONAL],
  ['not-normalized', t(2, 0, 0)],
  ['zero', ZERO],
  ['nearly-normalized', t(0, 1.0004, 0)],
];
const ANGLES: readonly (readonly [string, number])[] = [
  ['zero', 0],
  ['half-pi', Math.PI / 2],
  ['pi', Math.PI],
  ['small', 0.3],
  ['negative', -2],
  ['large', 100],
];
for (const [axisName, axis] of AXES) {
  for (const [angleName, angle] of ANGLES) {
    for (const [vectorName, value] of [
      ['a', A],
      ['mixed', MIXED],
    ] as const) {
      add(
        `rotated-${vectorName}-${axisName}-${angleName}`,
        member('rotated'),
        `${gv(value)}.rotated(${gv(axis)}, ${gd(angle)})`,
        () => V.rotated(tv(value), tv(axis), angle),
      );
    }
  }
}

// Operators.
for (const [name, left, right] of PAIRS) {
  add(`op_add-${name}`, operator('OP_ADD', 'Vector3'), `${gv(left)} + ${gv(right)}`, () =>
    V.op_add(tv(left), tv(right)),
  );
  add(`op_subtract-${name}`, operator('OP_SUBTRACT', 'Vector3'), `${gv(left)} - ${gv(right)}`, () =>
    V.op_subtract(tv(left), tv(right)),
  );
  add(`op_multiply-vector-${name}`, operator('OP_MULTIPLY', 'Vector3'), `${gv(left)} * ${gv(right)}`, () =>
    V.op_multiply(tv(left), tv(right)),
  );
  add(`op_divide-vector-${name}`, operator('OP_DIVIDE', 'Vector3'), `${gv(left)} / ${gv(right)}`, () =>
    V.op_divide(tv(left), tv(right)),
  );
  add(`op_equal-${name}`, operator('OP_EQUAL', 'Vector3'), `${gv(left)} == ${gv(right)}`, () =>
    V.op_equal(tv(left), tv(right)),
  );
}
for (const [name, value] of VECTORS) {
  add(`op_negate-${name}`, operator('OP_NEGATE'), `-${gv(value)}`, () => V.op_negate(tv(value)));
  for (const scalar of [0.1, -3, 0, 1e30]) {
    add(
      `op_multiply-float-${name}-${String(scalar)}`,
      operator('OP_MULTIPLY', 'float'),
      `${gv(value)} * ${gd(scalar)}`,
      () => V.op_multiply(tv(value), scalar),
    );
    add(
      `op_divide-float-${name}-${String(scalar)}`,
      operator('OP_DIVIDE', 'float'),
      `${gv(value)} / ${gd(scalar)}`,
      () => V.op_divide(tv(value), scalar),
    );
  }
}
for (const [name, value] of VECTORS) {
  for (const scalar of [2, -3, 0, 16777217]) {
    add(
      `op_multiply-int-${name}-${String(scalar)}`,
      operator('OP_MULTIPLY', 'int'),
      `${gv(value)} * ${String(scalar)}`,
      () => V.op_multiply(tv(value), scalar),
    );
    add(
      `op_divide-int-${name}-${String(scalar)}`,
      operator('OP_DIVIDE', 'int'),
      `${gv(value)} / ${String(scalar)}`,
      () => V.op_divide(tv(value), scalar),
    );
  }
}

// Member writes: Godot copies the value, writes the member, and the variable holds the copy.
for (const [name, value] of VECTORS) {
  for (const [axis, write] of [
    ['x', V.with_x],
    ['y', V.with_y],
    ['z', V.with_z],
  ] as const) {
    for (const assigned of [0.1, -2.5, 1e30, 1e39]) {
      add(
        `with_${axis}-${name}-${String(assigned)}`,
        memberSet(axis),
        `var v := ${gv(value)}\nv.${axis} = ${gd(assigned)}\nreturn v`,
        () => write(tv(value), assigned),
      );
    }
  }
}

add('op_equal-signed-zero', operator('OP_EQUAL', 'Vector3'), `${gv(t(0, -0, 0))} == ${gv(ZERO)}`, () =>
  V.op_equal(tv(t(0, -0, 0)), tv(ZERO)),
);
add('op_equal-nan', operator('OP_EQUAL', 'Vector3'), `${gv(NOT_A_NUMBER)} == ${gv(NOT_A_NUMBER)}`, () =>
  V.op_equal(tv(NOT_A_NUMBER), tv(NOT_A_NUMBER)),
);
add('op_equal-rounded', operator('OP_EQUAL', 'Vector3'), `${gv(t(0.1, 0, 0))} == ${gv(t(0.10000000000000002, 0, 0))}`, () =>
  V.op_equal(tv(t(0.1, 0, 0)), tv(t(0.10000000000000002, 0, 0))),
);

const VECTOR3_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Vector3',
  compatModule: 'lib/godot-compat/vector3',
  typeExport: 'Vector3',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::VECTOR3', line: 110 },
  cases,
};

export default VECTOR3_EVIDENCE;
