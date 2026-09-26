import * as Q from '../../capabilities/catalog/project-source/src/lib/godot-compat/quaternion';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Quad = readonly [number, number, number, number];
const QUATERNIONS: readonly (readonly [string, Quad])[] = [
  ['identity', [0, 0, 0, 1]],
  ['decimals', [0.1, -0.2, 0.3, 0.9273618]],
  ['bone', [-0.06803, 0.70383, 0.07057, 0.70378]],
  ['huge', [1e39, -1e39, 3.4e38, 1e-40]],
];
const gq = ([x, y, z, w]: Quad): string => `Quaternion(${gd(x)}, ${gd(y)}, ${gd(z)}, ${gd(w)})`;

const c = caseCollector('Quaternion');
c.add('construct-empty', c.constructor, 'Quaternion()', () => Q.construct());
for (const [name, value] of QUATERNIONS) {
  c.add(`construct-xyzw-${name}`, c.constructor, gq(value), () => Q.construct(...value));
  c.add(`construct-copy-${name}`, c.constructor, `Quaternion(${gq(value)})`, () => Q.construct(Q.construct(...value)));
}

const UNIT: readonly (readonly [string, Quad])[] = [
  ['identity', [0, 0, 0, 1]],
  ['bone', [-0.06803, 0.70383, 0.07057, 0.70378]],
  ['half', [0.5, 0.5, 0.5, 0.5]],
  ['flip', [1, -2.4919705e-38, 7.54979e-8, -1.05879e-22]],
  ['tilt', [0.0998334, 0, 0, 0.9950042]],
];
for (const [name, value] of [...UNIT, ['unnormal', [1, 2, 3, 4]] as const]) {
  const q = gq(value);
  c.add(`length-${name}`, c.member('length'), `${q}.length()`, () => Q.length(Q.construct(...value)));
  c.add(`length_squared-${name}`, c.member('length_squared'), `${q}.length_squared()`, () => Q.length_squared(Q.construct(...value)));
  c.add(`normalized-${name}`, c.member('normalized'), `${q}.normalized()`, () => Q.normalized(Q.construct(...value)));
  c.add(`is_normalized-${name}`, c.member('is_normalized'), `${q}.is_normalized()`, () => Q.is_normalized(Q.construct(...value)));
  c.add(`inverse-${name}`, c.member('inverse'), `${q}.inverse()`, () => Q.inverse(Q.construct(...value)));
}
for (const [a, av] of UNIT) {
  for (const [b, bv] of UNIT) {
    c.add(`dot-${a}-${b}`, c.member('dot'), `${gq(av)}.dot(${gq(bv)})`, () => Q.dot(Q.construct(...av), Q.construct(...bv)));
    c.add(`multiply-${a}-${b}`, c.operator('OP_MULTIPLY', 'Quaternion'), `${gq(av)} * ${gq(bv)}`, () => Q.op_multiply(Q.construct(...av), Q.construct(...bv)));
    for (const weight of [0, 0.25, 0.5, 0.9, 1]) {
      c.add(`slerp-${a}-${b}-${gd(weight)}`, c.member('slerp'), `${gq(av)}.normalized().slerp(${gq(bv)}.normalized(), ${gd(weight)})`, () =>
        Q.slerp(Q.normalized(Q.construct(...av)), Q.normalized(Q.construct(...bv)), weight),
      'float32-ulp');
    }
  }
}

const QUATERNION_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Quaternion',
  compatModule: 'lib/godot-compat/quaternion',
  typeExport: 'Quaternion',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::QUATERNION', line: 116 },
  cases: c.cases,
};

export default QUATERNION_EVIDENCE;
