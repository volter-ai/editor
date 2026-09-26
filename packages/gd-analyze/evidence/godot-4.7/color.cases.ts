import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { caseCollector, gd } from './literals';

type Quad = readonly [number, number, number, number];
const COLORS: readonly (readonly [string, Quad])[] = [
  ['black', [0, 0, 0, 1]],
  ['decimals', [0.1, 0.2, 0.3, 0.4]],
  ['over-range', [1.5, -0.25, 255, 2]],
  ['tiny', [1e-40, 1e-10, 0.3333333333333333, 0.6666666666666666]],
  ['huge', [1e39, -1e39, 3.4e38, 1e30]],
  ['nan', [Number.NaN, 0, 1, 1]],
];
const gc = ([r, g, b, a]: Quad): string => `Color(${gd(r)}, ${gd(g)}, ${gd(b)}, ${gd(a)})`;
const tc = ([r, g, b, a]: Quad): C.Color => C.construct(r, g, b, a);

const c = caseCollector('Color');
c.add('construct-empty', c.constructor, 'Color()', () => C.construct());
c.add('constant-gray', c.constant('GRAY'), 'Color.GRAY', () => C.GRAY);
for (const [name, value] of COLORS) {
  c.add(`construct-rgba-${name}`, c.constructor, gc(value), () => tc(value));
  c.add(`construct-rgb-${name}`, c.constructor, `Color(${gd(value[0])}, ${gd(value[1])}, ${gd(value[2])})`, () =>
    C.construct(value[0], value[1], value[2]),
  );
  c.add(`construct-copy-${name}`, c.constructor, `Color(${gc(value)})`, () => C.construct(tc(value)));
  c.add(`construct-alpha-${name}`, c.constructor, `Color(${gc(value)}, 0.1)`, () => C.construct(tc(value), 0.1));
  for (const [channel, write] of [
    ['r', C.with_r],
    ['g', C.with_g],
    ['b', C.with_b],
    ['a', C.with_a],
  ] as const) {
    for (const assigned of [0.1, -2.5, 1e39]) {
      c.add(`with_${channel}-${name}-${String(assigned)}`, c.memberSet(channel), `var c := ${gc(value)}\nc.${channel} = ${gd(assigned)}\nreturn c`, () =>
        write(tc(value), assigned),
      );
    }
  }
}

const COLOR_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Color',
  compatModule: 'lib/godot-compat/color',
  typeExport: 'Color',
  typeSource: { file: 'core/variant/variant.h', symbol: 'Variant::COLOR', line: 123 },
  cases: c.cases,
};

export default COLOR_EVIDENCE;
