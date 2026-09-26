import * as R from '../../capabilities/catalog/project-source/src/lib/godot-compat/rect2';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Quad = readonly [number, number, number, number];
const RECTS: readonly (readonly [string, Quad])[] = [
  ['unit', [0, 0, 1, 1]],
  ['decimals', [0.1, -0.2, 3.3, 4.4]],
  ['negative-size', [5, 5, -2, -3]],
  ['huge', [1e39, -1e30, 1e-40, 16777217]],
  ['nan', [Number.NaN, 0, 1, 1]],
];
const gr = ([x, y, w, h]: Quad): string => `Rect2(${gd(x)}, ${gd(y)}, ${gd(w)}, ${gd(h)})`;
const tr = ([x, y, w, h]: Quad): R.Rect2 => R.construct(x, y, w, h);

const c = caseCollector('Rect2');
c.add('construct-empty', c.constructor, 'Rect2()', () => R.construct());
for (const [name, value] of RECTS) {
  c.add(`construct-floats-${name}`, c.constructor, gr(value), () => tr(value));
  c.add(`construct-copy-${name}`, c.constructor, `Rect2(${gr(value)})`, () => R.construct(tr(value)));
  c.add(
    `construct-vectors-${name}`,
    c.constructor,
    `Rect2(Vector2(${gd(value[0])}, ${gd(value[1])}), Vector2(${gd(value[2])}, ${gd(value[3])}))`,
    () => R.construct(V.construct(value[0], value[1]), V.construct(value[2], value[3])),
  );
  c.add(`with_position-${name}`, c.memberSet('position'), `var r := ${gr(value)}\nr.position = Vector2(0.1, -7.0)\nreturn r`, () =>
    R.with_position(tr(value), V.construct(0.1, -7)),
  );
  c.add(`with_size-${name}`, c.memberSet('size'), `var r := ${gr(value)}\nr.size = Vector2(0.1, 1e39)\nreturn r`, () =>
    R.with_size(tr(value), V.construct(0.1, 1e39)),
  );
}

const RECT2_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Rect2',
  compatModule: 'lib/godot-compat/rect2',
  typeExport: 'Rect2',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::RECT2', line: 108 },
  cases: c.cases,
};

export default RECT2_EVIDENCE;
