import type { MeshStandardMaterial } from 'three';
import * as B from '../../capabilities/catalog/project-source/src/lib/godot-compat/base-material-3d';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/standard-material-3d';
import type { GodotEvidenceCase, GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

/**
 * BaseMaterial3D on a StandardMaterial3D: each parameter set and read back in official Godot, and
 * (`render-mapping`) the three material the Compatibility scene shader's reading of it selects,
 * cited to the shader: unshaded draws as `MeshBasicMaterial`, albedo and energy-scaled emission
 * pass through the shader's sRGB polynomial (`drivers/gles3/shaders/tonemap_inc.glsl:22`).
 */

const c = resourceCases('BaseMaterial3D');
const gc = (r: number, g: number, b: number, a = 1): string => `Color(${gd(r)}, ${gd(g)}, ${gd(b)}, ${gd(a)})`;

for (const [name, [r, g, b, a]] of [
  ['default-ish', [1, 1, 1, 1]],
  ['gold', [1.5, 1.26, 0, 1]],
  ['translucent', [0.7, 0.7, 0.7, 0.25098]],
] as const) {
  c.add(`set_albedo-${name}`, 'set_albedo', ['var m := StandardMaterial3D.new()', `m.set_albedo(${gc(r, g, b, a)})`, 'return m.get_albedo()'], () => {
    const m = S.construct();
    B.set_albedo(m, C.construct(r, g, b, a));
    return B.get_albedo(m);
  });
}
c.add('get_albedo-default', 'get_albedo', ['return StandardMaterial3D.new().get_albedo()'], () => B.get_albedo(S.construct()));
for (const [member, getter, values] of [
  ['set_metallic', 'get_metallic', [0.1, 1]],
  ['set_roughness', 'get_roughness', [0, 0.2]],
  ['set_emission_energy_multiplier', 'get_emission_energy_multiplier', [3.71, 0.5]],
] as const) {
  for (const value of values) {
    c.add(`${member}-${gd(value)}`, member, ['var m := StandardMaterial3D.new()', `m.${member}(${gd(value)})`, `return m.${getter}()`], () => {
      const m = S.construct();
      B[member](m, value);
      return B[getter](m);
    });
  }
  c.add(`${getter}-default`, getter, [`return StandardMaterial3D.new().${getter}()`], () => B[getter](S.construct()));
}
c.add('set_emission', 'set_emission', ['var m := StandardMaterial3D.new()', `m.set_emission(${gc(1, 0.884824, 0.513098)})`, 'return m.get_emission()'], () => {
  const m = S.construct();
  B.set_emission(m, C.construct(1, 0.884824, 0.513098, 1));
  return B.get_emission(m);
});
c.add('get_emission-default', 'get_emission', ['return StandardMaterial3D.new().get_emission()'], () => B.get_emission(S.construct()));
for (const [feature, enabled] of [
  [0, true],
  [4, true],
  [99, true],
] as const) {
  c.add(`set_feature-${String(feature)}`, 'set_feature', ['var m := StandardMaterial3D.new()', `m.set_feature(${String(feature)}, ${String(enabled)})`, `return m.get_feature(${String(feature)})`], () => {
    const m = S.construct();
    B.set_feature(m, feature, enabled);
    return B.get_feature(m, feature);
  });
}
c.add('get_feature-default', 'get_feature', ['return StandardMaterial3D.new().get_feature(0)'], () => B.get_feature(S.construct(), 0));
for (const [member, getter, value] of [
  ['set_transparency', 'get_transparency', 1],
  ['set_blend_mode', 'get_blend_mode', 1],
  ['set_shading_mode', 'get_shading_mode', 0],
] as const) {
  c.add(member, member, ['var m := StandardMaterial3D.new()', `m.${member}(${String(value)})`, `return m.${getter}()`], () => {
    const m = S.construct();
    B[member](m, value);
    return B[getter](m);
  });
  c.add(`${getter}-default`, getter, [`return StandardMaterial3D.new().${getter}()`], () => B[getter](S.construct()));
}

// The three material each parameter draws as. The fact is the Compatibility shader's reading,
// computed here from the cited polynomial; the target reads the three material compat built.
const f32 = Math.fround;
const godotLinear = (v: number): number => f32(v * f32(f32(v * f32(f32(v * 0.305306011) + 0.682171111)) + 0.012522878));
const SHADER = { file: 'drivers/gles3/shaders/scene.glsl', symbol: 'albedo = srgb_to_linear(albedo); emission = srgb_to_linear(emission)', line: 2398 };
const mapping = (id: string, member: string, fact: unknown, target: () => unknown): GodotEvidenceCase => ({
  id: `three-${id}`,
  symbol: { kind: 'native-member', owner: 'BaseMaterial3D', member },
  gdscript: '',
  target,
  comparator: 'render-mapping',
  fact: { value: fact, source: SHADER },
});
const shaded = (m: B.BaseMaterial3D) => B.godot_base_material_3d_three(m) as MeshStandardMaterial;
c.cases.push(
  mapping('albedo-linear', 'set_albedo', [godotLinear(1.5), godotLinear(1.26), 0, 1, false].join(','), () => {
    const m = S.construct();
    B.set_albedo(m, C.construct(1.5, 1.26, 0, 1));
    const t = shaded(m);
    return [t.color.r, t.color.g, t.color.b, t.opacity, t.transparent].join(',');
  }),
  mapping('albedo-alpha-transparent', 'set_transparency', [f32(0.25098), true].join(','), () => {
    const m = S.construct();
    B.set_albedo(m, C.construct(1, 0.858824, 0.572549, 0.25098));
    B.set_transparency(m, 1);
    const t = shaded(m);
    return [t.opacity, t.transparent].join(',');
  }),
  mapping('emission-energy', 'set_emission_energy_multiplier', [godotLinear(f32(1 * f32(3.71))), godotLinear(f32(f32(0.884824) * f32(3.71))), godotLinear(f32(f32(0.513098) * f32(3.71))), 1].join(','), () => {
    const m = S.construct();
    B.set_feature(m, 0, true);
    B.set_emission(m, C.construct(1, 0.884824, 0.513098, 1));
    B.set_emission_energy_multiplier(m, 3.71);
    const t = shaded(m);
    return [t.emissive.r, t.emissive.g, t.emissive.b, t.emissiveIntensity].join(',');
  }),
  mapping('emission-disabled', 'set_feature', [0, 0, 0].join(','), () => {
    const m = S.construct();
    B.set_emission(m, C.construct(1, 1, 1, 1));
    const t = shaded(m);
    return [t.emissive.r, t.emissive.g, t.emissive.b].join(',');
  }),
  mapping('metallic-roughness', 'set_metallic', [f32(0.1), 0].join(','), () => {
    const m = S.construct();
    B.set_metallic(m, 0.1);
    B.set_roughness(m, 0);
    const t = shaded(m);
    return [t.metalness, t.roughness].join(',');
  }),
  mapping('unshaded-basic', 'set_shading_mode', 'MeshBasicMaterial', () => {
    const m = S.construct();
    B.set_shading_mode(m, 0);
    return B.godot_base_material_3d_three(m).type;
  }),
  // three's AdditiveBlending (2): Godot's BLEND_MODE_ADD, `blend_mode_add` in the scene shader.
  mapping('blend-add', 'set_blend_mode', 2, () => {
    const m = S.construct();
    B.set_blend_mode(m, 1);
    return B.godot_base_material_3d_three(m).blending;
  }),
);

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'BaseMaterial3D', compatModule: 'lib/godot-compat/base-material-3d', cases: c.cases };
export default EVIDENCE;
