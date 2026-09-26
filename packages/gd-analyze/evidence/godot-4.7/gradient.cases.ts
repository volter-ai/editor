import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/gradient';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

type Quad = readonly [number, number, number, number];
const gc = ([r, g, b, a]: Quad): string => `Color(${gd(r)}, ${gd(g)}, ${gd(b)}, ${gd(a)})`;
const c = resourceCases('Gradient');

// The platformer's coin glow: three points, cubic.
const OFFSETS = [0, 0.642276, 1];
const COLORS: readonly Quad[] = [
  [1, 1, 1, 1],
  [1, 1, 1, 0.180392],
  [1, 1, 1, 0],
];
const SAMPLES = [-0.5, 0, 0.1, 0.25, 0.5, 0.642276, 0.7, 0.9, 1, 1.5];
const build = (mode: number, space: number) => [
  'var g := Gradient.new()',
  `g.offsets = PackedFloat32Array([${OFFSETS.map(gd).join(', ')}])`,
  `g.colors = PackedColorArray([${COLORS.map(gc).join(', ')}])`,
  `g.interpolation_mode = ${String(mode)}`,
  `g.interpolation_color_space = ${String(space)}`,
];
const made = (mode: number, space: number): G.Gradient => {
  const g = G.construct();
  G.set_offsets(g, OFFSETS);
  G.set_colors(g, COLORS.map((q) => C.construct(...q)));
  G.set_interpolation_mode(g, mode);
  G.set_interpolation_color_space(g, space);
  return g;
};
for (const [mode, space, name] of [
  [0, 0, 'linear'],
  [1, 0, 'constant'],
  [2, 0, 'cubic'],
  [0, 1, 'linear-linear-srgb'],
  [2, 1, 'cubic-linear-srgb'],
] as const) {
  c.add(`sample-${name}`, 'sample', [...build(mode, space), `return [${SAMPLES.map((s) => `g.sample(${gd(s)})`).join(', ')}]`], () => {
    const g = made(mode, space);
    return SAMPLES.map((s) => G.sample(g, s));
  });
}
c.add('sample-default', 'sample', ['var g := Gradient.new()', 'return [g.sample(0.0), g.sample(0.3), g.sample(1.0)]'], () => {
  const g = G.construct();
  return [0, 0.3, 1].map((s) => G.sample(g, s));
});
// Offsets set out of order are sorted before the gradient is read; `get_offsets` reads the order as set.
c.add('unsorted-offsets', 'set_offsets', [
  'var g := Gradient.new()',
  'g.offsets = PackedFloat32Array([1.0, 0.0, 0.5])',
  `g.colors = PackedColorArray([${[[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]].map((q) => gc(q as unknown as Quad)).join(', ')}])`,
  'var before := g.get_offsets()',
  'var cs := g.get_colors()',
  'return [before, g.sample(0.25), g.sample(0.75), g.get_offsets(), [cs[0], cs[1], cs[2]], g.get_point_count()]',
], () => {
  const g = G.construct();
  G.set_offsets(g, [1, 0, 0.5]);
  G.set_colors(g, [C.construct(1, 0, 0, 1), C.construct(0, 1, 0, 1), C.construct(0, 0, 1, 1)]);
  const before = G.get_offsets(g);
  const colors = G.get_colors(g);
  return [before, G.sample(g, 0.25), G.sample(g, 0.75), G.get_offsets(g), colors, G.get_point_count(g)];
});
c.add('add-point', 'add_point', ['var g := Gradient.new()', 'g.add_point(0.5, Color(1, 0, 0, 1))', 'return [g.sample(0.25), g.sample(0.5), g.get_point_count(), g.get_offsets()]'], () => {
  const g = G.construct();
  G.add_point(g, 0.5, C.construct(1, 0, 0, 1));
  return [G.sample(g, 0.25), G.sample(g, 0.5), G.get_point_count(g), G.get_offsets(g)];
});
// Each accessor, read back after the coin's gradient is built.
for (const [member, gdRead, read] of [
  ['get_offsets', 'g.get_offsets()', (g: G.Gradient) => G.get_offsets(g)],
  ['set_colors', '[g.get_colors()[0], g.get_colors()[1], g.get_colors()[2]]', (g: G.Gradient) => G.get_colors(g)],
  ['get_colors', '[g.get_colors()[0], g.get_colors()[1], g.get_colors()[2]]', (g: G.Gradient) => G.get_colors(g)],
  ['set_interpolation_mode', 'g.get_interpolation_mode()', (g: G.Gradient) => G.get_interpolation_mode(g)],
  ['set_interpolation_color_space', 'g.get_interpolation_color_space()', (g: G.Gradient) => G.get_interpolation_color_space(g)],
  ['get_point_count', 'g.get_point_count()', (g: G.Gradient) => G.get_point_count(g)],
] as const) {
  c.add(`${member}-coin`, member, [...build(2, 1), `return ${gdRead}`], () => read(made(2, 1)));
}
for (const reader of ['get_interpolation_mode', 'get_interpolation_color_space'] as const) {
  c.add(`${reader}-default`, reader, ['var g := Gradient.new()', `return g.${reader}()`], () => G[reader](G.construct()));
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Gradient', compatModule: 'lib/godot-compat/gradient', cases: c.cases };
export default EVIDENCE;
