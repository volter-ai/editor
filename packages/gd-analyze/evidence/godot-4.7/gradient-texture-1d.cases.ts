import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient';
import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient-texture-1d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('GradientTexture1D');
const f32 = Math.fround;
const PIXELS = [0, 3, 7, 12, 19];
const build = [
  'var g := Gradient.new()',
  'g.offsets = PackedFloat32Array([0.0, 0.3, 1.0])',
  'g.colors = PackedColorArray([Color(1, 0, 0, 1), Color(0.2, 0.9, 0.1, 0.5), Color(0, 0, 1, 0)])',
  'var t := GradientTexture1D.new()',
  't.gradient = g',
  't.width = 20',
  `var im := t.get_image()`,
  `return [${PIXELS.map((x) => `im.get_pixel(${String(x)}, 0)`).join(', ')}]`,
];
const made = () => {
  const g = G.construct();
  G.set_offsets(g, [0, 0.3, 1]);
  G.set_colors(g, [C.construct(1, 0, 0, 1), C.construct(0.2, 0.9, 0.1, 0.5), C.construct(0, 0, 1, 0)]);
  const t = T.construct();
  T.set_gradient(t, g);
  T.set_width(t, 20);
  const data = T.godot_gradient_texture_1d_pixels(t);
  return PIXELS.map((x) => C.construct(...([0, 1, 2, 3].map((k) => f32((data[x * 4 + k] as number) / f32(255))) as [number, number, number, number])));
};
for (const member of ['set_gradient', 'set_width'] as const) c.add(`pixels-${member}`, member, build, made);
c.add('get_gradient', 'get_gradient', ['var t := GradientTexture1D.new()', 'return t.get_gradient() == null'], () => T.get_gradient(T.construct()) === null);

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'GradientTexture1D', compatModule: 'lib/godot-compat/gradient-texture-1d', cases: c.cases };
export default EVIDENCE;
