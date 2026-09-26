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

const QUATERNION_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Quaternion',
  compatModule: 'lib/godot-compat/quaternion',
  typeExport: 'Quaternion',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::QUATERNION', line: 116 },
  cases: c.cases,
};

export default QUATERNION_EVIDENCE;
