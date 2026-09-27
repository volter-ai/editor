/**
 * CurveTexture: its width (32 to 4096, else left), its texture mode (RGB or Red, else left) and its
 * curve, read back as the setters leave them. The image Godot makes of the curve is not readable
 * headless (the dummy texture storage keeps none); its texels are `Curve.sample_baked`'s, which
 * `curve.cases.ts` measures.
 */
import * as K from '../../capabilities/catalog/project-source/src/lib/godot-compat/curve';
import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/curve-texture';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('CurveTexture');
const POINTS: readonly (readonly [number, number])[] = [
  [0, 0.25],
  [0.3, 1],
  [1, 0.1],
];
const gdCurve = ['var k := Curve.new()', ...POINTS.map(([x, y]) => `k.add_point(Vector2(${gd(x)}, ${gd(y)}))`)];
const tsCurve = () => {
  const k = K.construct();
  for (const [x, y] of POINTS) K.add_point(k, V.construct(x, y));
  return k;
};
// Widths at and past the bounds: 32 and 4096 are taken, 31, 4097, 0 and -5 leave the width.
const WIDTHS = [64, 31, 32, 4097, 4096, 0, -5, 100];
c.add(
  'width-bounds',
  'set_width',
  ['var t := CurveTexture.new()', 'var out := [t.width]', ...WIDTHS.flatMap((w) => [`t.set_width(${String(w)})`, 'out.append(t.width)']), 'return out'],
  () => {
    const t = T.construct();
    const out = [T.get_width(t)];
    for (const w of WIDTHS) {
      T.set_width(t, w);
      out.push(T.get_width(t));
    }
    return out;
  },
);
// The state a scene leaves, in any order (headless Godot keeps no image to read back: its dummy
// texture storage returns none for `get_image`).
c.add('state-curve-first', 'set_width', [...gdCurve, 'var t := CurveTexture.new()', 't.curve = k', 't.width = 50', 't.texture_mode = 1', 'return [t.get_width(), t.get_texture_mode(), t.get_curve() == k]'], () => {
  const t = T.construct();
  const k = tsCurve();
  T.set_curve(t, k);
  T.set_width(t, 50);
  T.set_texture_mode(t, 1);
  return [T.get_width(t), T.get_texture_mode(t), T.get_curve(t) === k];
});
// Modes at and past the bounds: 0 and 1 are taken, 2 and -1 leave the mode.
const MODES = [1, 2, 0, -1, 1];
c.add(
  'mode-bounds',
  'set_texture_mode',
  ['var t := CurveTexture.new()', 'var out := [t.get_texture_mode()]', ...MODES.flatMap((m) => [`t.set_texture_mode(${String(m)})`, 'out.append(t.get_texture_mode())']), 'return out'],
  () => {
    const t = T.construct();
    const out = [T.get_texture_mode(t)];
    for (const m of MODES) {
      T.set_texture_mode(t, m);
      out.push(T.get_texture_mode(t));
    }
    return out;
  },
);
c.cases.push({
  id: 'new',
  symbol: { kind: 'native-constructor', owner: 'CurveTexture', member: 'CurveTexture' },
  gdscript: ['var t := CurveTexture.new()', 'return [t.get_width(), t.get_texture_mode(), t.get_curve() == null]'].join('\n'),
  target: () => {
    const t = T.construct();
    return [T.get_width(t), T.get_texture_mode(t), T.get_curve(t) === null];
  },
  comparator: 'exact',
});
c.add('get_texture_mode', 'get_texture_mode', ['var t := CurveTexture.new()', 'return t.get_texture_mode()'], () => T.get_texture_mode(T.construct()));
c.add('curve-identity', 'set_curve', [...gdCurve, 'var t := CurveTexture.new()', 'var before := t.get_curve() == null', 't.set_curve(k)', 'var same := t.get_curve() == k', 't.set_curve(null)', 'return [before, same, t.get_curve() == null]'], () => {
  const t = T.construct();
  const k = tsCurve();
  const before = T.get_curve(t) === null;
  T.set_curve(t, k);
  const same = T.get_curve(t) === k;
  T.set_curve(t, null);
  return [before, same, T.get_curve(t) === null];
});
c.add('get_curve', 'get_curve', [...gdCurve, 'var t := CurveTexture.new()', 't.curve = k', 'return t.get_curve().get_point_position(1)'], () => {
  const t = T.construct();
  T.set_curve(t, tsCurve());
  return K.get_point_position(T.get_curve(t) as K.Curve, 1);
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'CurveTexture', compatModule: 'lib/godot-compat/curve-texture', cases: c.cases };
export default EVIDENCE;
