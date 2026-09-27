import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/aabb';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Triple = readonly [number, number, number];
type Box = readonly [position: Triple, size: Triple];

const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
const tv = ([x, y, z]: Triple): V.Vector3 => V.construct(x, y, z);
const ga = ([position, size]: Box): string => `AABB(${gv(position)}, ${gv(size)})`;
const ta = ([position, size]: Box): A.AABB => A.construct(tv(position), tv(size));

const BOXES: readonly (readonly [string, Box])[] = [
  ['zero', [[0, 0, 0], [0, 0, 0]]],
  ['unit', [[0, 0, 0], [1, 1, 1]]],
  ['decimals', [[0.1, -0.2, 0.3], [1.1, 2.2, 3.3]]],
  // MATH_CHECKS prints "AABB size is negative" for these and computes on.
  ['negative-size', [[5, 5, 5], [-2, -3, 1]]],
  ['flat', [[1, 2, 3], [0, 4, 5]]],
  ['signed-zero', [[-0, 0, -0], [-0, 1, 0]]],
  ['touching', [[1, 0, 0], [1, 1, 1]]],
  ['inside', [[0.25, 0.25, 0.25], [0.5, 0.5, 0.5]]],
  ['huge', [[1e38, -1e30, 16777217], [3e38, 1e-40, 1]]],
  ['nan', [[Number.NaN, 0, 0], [1, 1, 1]]],
  ['nan-size', [[-0, -0, 1], [Number.NaN, -0, 0]]],
];
const POINTS: readonly (readonly [string, Triple])[] = [
  ['origin', [0, 0, 0]],
  ['center', [0.5, 0.5, 0.5]],
  ['end', [1, 1, 1]],
  ['past-end-ulp', [1.0000001, 1, 1]],
  ['below-ulp', [0, -1e-45, 0]],
  ['far', [-3, 7.5, 0.1]],
  ['decimal-end', [1.2, 2, 3.6]],
  ['nan', [0, Number.NaN, 0]],
];
const AMOUNTS: readonly (readonly [string, number])[] = [
  ['zero', 0],
  ['tenth', 0.1],
  ['shrink', -0.75],
  ['huge', 2e38],
];

const c = caseCollector('AABB');
c.add('construct-empty', c.constructor, 'AABB()', () => A.construct());
for (const [name, box] of BOXES) {
  const [position, size] = box;
  c.add(`construct-vectors-${name}`, c.constructor, ga(box), () => ta(box));
  c.add(`construct-copy-${name}`, c.constructor, `AABB(${ga(box)})`, () => A.construct(ta(box)));
  c.add(`with_position-${name}`, c.memberSet('position'), `var a := ${ga(box)}\na.position = Vector3(0.1, -7.0, 1e39)\nreturn a`, () =>
    A.with_position(ta(box), V.construct(0.1, -7, 1e39)),
  );
  c.add(`with_size-${name}`, c.memberSet('size'), `var a := ${ga(box)}\na.size = Vector3(0.1, -2.5, 1e-40)\nreturn a`, () =>
    A.with_size(ta(box), V.construct(0.1, -2.5, 1e-40)),
  );
  // The write and the `end` read after it (`get_end`, a getter on the record).
  c.add(`with_end-${name}`, c.memberSet('end'), `var a := ${ga(box)}\nvar before := a.end\na.end = Vector3(0.3, -1.0, 3e38)\nreturn [before, a, a.end]`, () => {
    const a = ta(box);
    const after = A.with_end(a, V.construct(0.3, -1, 3e38));
    return [a.end, after, after.end];
  });
  c.add(`get_longest_axis_size-${name}`, c.member('get_longest_axis_size'), `${ga(box)}.get_longest_axis_size()`, () =>
    A.get_longest_axis_size(ta(box)),
  );
  c.add(`get_center-${name}`, c.member('get_center'), `${ga(box)}.get_center()`, () => A.get_center(ta(box)));
  c.add(`get_volume-${name}`, c.member('get_volume'), `${ga(box)}.get_volume()`, () => A.get_volume(ta(box)));
  c.add(`abs-${name}`, c.member('abs'), `${ga(box)}.abs()`, () => A.abs(ta(box)));
  for (const [amountName, amount] of AMOUNTS) {
    c.add(`grow-${name}-${amountName}`, c.member('grow'), `${ga(box)}.grow(${gd(amount)})`, () => A.grow(ta(box), amount));
  }
  for (const [pointName, point] of POINTS) {
    c.add(`has_point-${name}-${pointName}`, c.member('has_point'), `${ga(box)}.has_point(${gv(point)})`, () =>
      A.has_point(ta(box), tv(point)),
    );
    c.add(`expand-${name}-${pointName}`, c.member('expand'), `${ga(box)}.expand(${gv(point)})`, () =>
      A.expand(ta(box), tv(point)),
    );
  }
  // Its own end, exactly on the boundary.
  c.add(`has_point-${name}-own-end`, c.member('has_point'), `var a := ${ga(box)}\nreturn a.has_point(a.end)`, () => {
    const a = ta(box);
    return A.has_point(a, a.end);
  });
  for (const [otherName, other] of BOXES) {
    const pair = `${name}-${otherName}`;
    c.add(`merge-${pair}`, c.member('merge'), `${ga(box)}.merge(${ga(other)})`, () => A.merge(ta(box), ta(other)));
    c.add(`intersects-${pair}`, c.member('intersects'), `${ga(box)}.intersects(${ga(other)})`, () =>
      A.intersects(ta(box), ta(other)),
    );
    c.add(`encloses-${pair}`, c.member('encloses'), `${ga(box)}.encloses(${ga(other)})`, () => A.encloses(ta(box), ta(other)));
    c.add(`is_equal_approx-${pair}`, c.member('is_equal_approx'), `${ga(box)}.is_equal_approx(${ga(other)})`, () =>
      A.is_equal_approx(ta(box), ta(other)),
    );
    c.add(`op_equal-${pair}`, c.operator('OP_EQUAL', 'AABB'), `${ga(box)} == ${ga(other)}`, () => A.op_equal(ta(box), ta(other)));
    c.add(`op_not_equal-${pair}`, c.operator('OP_NOT_EQUAL', 'AABB'), `${ga(box)} != ${ga(other)}`, () =>
      A.op_not_equal(ta(box), ta(other)),
    );
  }
  c.add(`merge-${name}-empty`, c.member('merge'), `${ga(box)}.merge(AABB())`, () => A.merge(ta(box), A.construct()));
  c.add(`merge-empty-${name}`, c.member('merge'), `AABB().merge(${ga(box)})`, () => A.merge(A.construct(), ta(box)));
  const [px, py, pz] = position;
  const [sx, sy, sz] = size;
  const nearly: Box = [[px + 1e-7, py, pz], [sx, sy, sz - 1e-7]];
  c.add(`is_equal_approx-${name}-nearly`, c.member('is_equal_approx'), `${ga(box)}.is_equal_approx(${ga(nearly)})`, () =>
    A.is_equal_approx(ta(box), ta(nearly)),
  );
}

const AABB_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'AABB',
  compatModule: 'lib/godot-compat/aabb',
  typeExport: 'AABB',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::AABB', line: 117 },
  cases: c.cases,
};

export default AABB_EVIDENCE;
