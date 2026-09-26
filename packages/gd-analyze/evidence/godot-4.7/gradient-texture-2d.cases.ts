import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient';
import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient-texture-2d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('GradientTexture2D');
const f32 = Math.fround;
// Pixels read back as `Image.get_pixel` reads an RGBA8 image: each byte over 255 in float.
const PIXELS: readonly (readonly [number, number])[] = [[0, 0], [5, 3], [8, 8], [12, 4], [15, 15], [3, 12], [7, 0], [0, 9]];
const readGd = `var im := t.get_image()\nreturn [${PIXELS.map(([x, y]) => `im.get_pixel(${String(x)}, ${String(y)})`).join(', ')}]`;
const readTs = (t: T.GradientTexture2D) => {
  const data = T.godot_gradient_texture_2d_pixels(t);
  return PIXELS.map(([x, y]) => {
    const i = (x + y * t.width) * 4;
    return C.construct(...([0, 1, 2, 3].map((k) => f32((data[i + k] as number) / f32(255))) as [number, number, number, number]));
  });
};
// The platformer's coin glow: a cubic gradient filled radially from the centre.
const GRADIENT = [
  'var g := Gradient.new()',
  'g.interpolation_mode = 2',
  'g.offsets = PackedFloat32Array([0.0, 0.642276, 1.0])',
  'g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.180392), Color(1, 1, 1, 0)])',
];
const gradient = () => {
  const g = G.construct();
  G.set_interpolation_mode(g, 2);
  G.set_offsets(g, [0, 0.642276, 1]);
  G.set_colors(g, [C.construct(1, 1, 1, 1), C.construct(1, 1, 1, 0.180392), C.construct(1, 1, 1, 0)]);
  return g;
};
type Setup = readonly [string, readonly string[], (t: T.GradientTexture2D) => void];
const SETUPS: readonly Setup[] = [
  ['radial-coin', ['t.fill = 1', 't.fill_from = Vector2(0.5, 0.5)', 't.fill_to = Vector2(0.5, 0.01)'], (t) => {
    T.set_fill(t, 1);
    T.set_fill_from(t, V.construct(0.5, 0.5));
    T.set_fill_to(t, V.construct(0.5, 0.01));
  }],
  ['linear', ['t.fill_from = Vector2(0.1, 0.2)', 't.fill_to = Vector2(0.9, 0.7)'], (t) => {
    T.set_fill_from(t, V.construct(0.1, 0.2));
    T.set_fill_to(t, V.construct(0.9, 0.7));
  }],
  ['square-repeat', ['t.fill = 2', 't.repeat = 1', 't.fill_from = Vector2(0.5, 0.5)', 't.fill_to = Vector2(0.8, 0.6)'], (t) => {
    T.set_fill(t, 2);
    T.set_repeat(t, 1);
    T.set_fill_from(t, V.construct(0.5, 0.5));
    T.set_fill_to(t, V.construct(0.8, 0.6));
  }],
  ['conic-mirror', ['t.fill = 3', 't.repeat = 2', 't.fill_from = Vector2(0.4, 0.5)', 't.fill_to = Vector2(0.9, 0.2)'], (t) => {
    T.set_fill(t, 3);
    T.set_repeat(t, 2);
    T.set_fill_from(t, V.construct(0.4, 0.5));
    T.set_fill_to(t, V.construct(0.9, 0.2));
  }],
];
for (const [name, gdSetup, setup] of SETUPS) {
  c.add(`pixels-${name}`, name === 'radial-coin' ? 'set_fill' : name === 'linear' ? 'set_fill_from' : name === 'square-repeat' ? 'set_repeat' : 'set_fill_to', [
    ...GRADIENT,
    'var t := GradientTexture2D.new()',
    't.gradient = g',
    't.width = 16',
    't.height = 16',
    ...gdSetup,
    readGd,
  ], () => {
    const t = T.construct();
    T.set_gradient(t, gradient());
    T.set_width(t, 16);
    T.set_height(t, 16);
    setup(t);
    return readTs(t);
  });
}
// A gradient of one point fills the image with its colour.
c.add('pixels-one-point', 'set_gradient', ['var g := Gradient.new()', 'g.offsets = PackedFloat32Array([0.3])', 'g.colors = PackedColorArray([Color(0.2, 0.4, 0.6, 0.8)])', 'var t := GradientTexture2D.new()', 't.gradient = g', 't.width = 16', 't.height = 16', readGd], () => {
  const g = G.construct();
  G.set_offsets(g, [0.3]);
  G.set_colors(g, [C.construct(0.2, 0.4, 0.6, 0.8)]);
  const t = T.construct();
  T.set_gradient(t, g);
  T.set_width(t, 16);
  T.set_height(t, 16);
  return readTs(t);
});
for (const [member, read] of [
  ['get_fill', (t: T.GradientTexture2D) => T.get_fill(t)],
  ['get_repeat', (t: T.GradientTexture2D) => T.get_repeat(t)],
  ['get_fill_from', (t: T.GradientTexture2D) => T.get_fill_from(t)],
  ['get_fill_to', (t: T.GradientTexture2D) => T.get_fill_to(t)],
] as const) {
  c.add(`${member}-default`, member, ['var t := GradientTexture2D.new()', `return t.${member}()`], () => read(T.construct()));
}
c.add('set-width-height', 'set_width', ['var t := GradientTexture2D.new()', 't.width = 0', 't.height = 20000', 't.width = 33', 'return [t.width, t.height]'], () => {
  const t = T.construct();
  T.set_width(t, 0);
  T.set_height(t, 20000);
  T.set_width(t, 33);
  return [t.width, t.height];
});
c.add('set_height', 'set_height', ['var t := GradientTexture2D.new()', 't.height = 7', 'return t.height'], () => {
  const t = T.construct();
  T.set_height(t, 7);
  return t.height;
});
c.add('get_gradient', 'get_gradient', ['var t := GradientTexture2D.new()', 'return t.get_gradient() == null'], () => T.get_gradient(T.construct()) === null);

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'GradientTexture2D', compatModule: 'lib/godot-compat/gradient-texture-2d', cases: c.cases };
export default EVIDENCE;
