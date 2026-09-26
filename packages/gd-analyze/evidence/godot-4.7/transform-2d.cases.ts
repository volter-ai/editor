import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/transform-2d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Pair = readonly [number, number];

const gv = ([x, y]: Pair): string => `Vector2(${gd(x)}, ${gd(y)})`;
const tv = ([x, y]: Pair): V.Vector2 => V.construct(x, y);

const TRANSFORMS: readonly (readonly [string, Pair, Pair, Pair])[] = [
  ['identity', [1, 0], [0, 1], [0, 0]],
  ['scaled', [2, 0], [0, 3], [5, -6]],
  ['flipped', [2, 0], [0, -3], [0, 0]],
  ['rotated', [0.6, 0.8], [-0.8, 0.6], [1.5, 2.5]],
  ['skewed', [1.5, 0.25], [-0.75, 2.125], [0, 0]],
  ['decimals', [0.1, 0.2], [0.3, -0.4], [0.5, 0.6]],
  ['degenerate', [1, 2], [2, 4], [0, 0]],
  ['nan', [Number.NaN, 0], [0, 1], [0, 0]],
  ['large', [1e18, 0], [0, 1e-18], [0, 0]],
];
const gt = (x: Pair, y: Pair, o: Pair): string => `Transform2D(${gv(x)}, ${gv(y)}, ${gv(o)})`;
const tt = (x: Pair, y: Pair, o: Pair): T.Transform2D => T.construct(tv(x), tv(y), tv(o));

const c = caseCollector('Transform2D');
c.add('construct-empty', c.constructor, 'Transform2D()', () => T.construct());
for (const [name, x, y, o] of TRANSFORMS) {
  c.add(`construct-axes-${name}`, c.constructor, gt(x, y, o), () => tt(x, y, o));
  c.add(`construct-copy-${name}`, c.constructor, `Transform2D(${gt(x, y, o)})`, () => T.construct(tt(x, y, o)));
  c.add(`get_scale-${name}`, c.member('get_scale'), `${gt(x, y, o)}.get_scale()`, () => T.get_scale(tt(x, y, o)));
  for (const [axis, write] of [
    ['x', T.with_x],
    ['y', T.with_y],
    ['origin', T.with_origin],
  ] as const) {
    c.add(`with_${axis}-${name}`, c.memberSet(axis), `var t := ${gt(x, y, o)}\nt.${axis} = ${gv([0.1, -7])}\nreturn t`, () =>
      write(tt(x, y, o), tv([0.1, -7])),
    );
  }
}
for (const rotation of [0, 0.3, Math.PI / 2, Math.PI, -2, 100, 1e-8]) {
  c.add(`construct-rotation-${String(rotation)}`, c.constructor, `Transform2D(${gd(rotation)}, ${gv([3, -4])})`, () =>
    T.construct(rotation, tv([3, -4])),
  );
  for (const [scaleName, scale] of [
    ['one', [1, 1]],
    ['mixed', [2.5, -0.5]],
  ] as const) {
    for (const skew of [0, 0.2, -1]) {
      c.add(
        `construct-rotation-scale-skew-${String(rotation)}-${scaleName}-${String(skew)}`,
        c.constructor,
        `Transform2D(${gd(rotation)}, ${gv(scale)}, ${gd(skew)}, ${gv([1, 2])})`,
        () => T.construct(rotation, tv(scale), skew, tv([1, 2])),
      );
      c.add(
        `get_scale-rotation-scale-skew-${String(rotation)}-${scaleName}-${String(skew)}`,
        c.member('get_scale'),
        `Transform2D(${gd(rotation)}, ${gv(scale)}, ${gd(skew)}, ${gv([1, 2])}).get_scale()`,
        () => T.get_scale(T.construct(rotation, tv(scale), skew, tv([1, 2]))),
      );
    }
  }
}

const TRANSFORM2D_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Transform2D',
  compatModule: 'lib/godot-compat/transform-2d',
  typeExport: 'Transform2D',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::TRANSFORM2D', line: 112 },
  cases: c.cases,
};

export default TRANSFORM2D_EVIDENCE;
