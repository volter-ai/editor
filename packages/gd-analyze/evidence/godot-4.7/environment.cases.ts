/**
 * Environment: each parameter set and read back in official Godot (the platformer's stage values,
 * the clamps and the fog mode's density reset), with Godot's defaults; and (`render-mapping`) the
 * tone mapper's parameters the Compatibility renderer computes for each mapper, cited to
 * `environment_storage.cpp:276` and recomputed here from the cited formula in double as the C++
 * promotes it.
 */
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as E from '../../capabilities/catalog/project-source/src/lib/godot-compat/environment';
import * as SKY from '../../capabilities/catalog/project-source/src/lib/godot-compat/sky';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('Environment');
type Fn = (self: E.Environment, value?: unknown) => unknown;
const call = (name: string): Fn => (E as unknown as Record<string, Fn>)[name] as Fn;
const FLOATS: readonly (readonly [string, string, readonly number[]])[] = [
  ['set_bg_energy_multiplier', 'get_bg_energy_multiplier', [2.5]],
  ['set_ambient_light_sky_contribution', 'get_ambient_light_sky_contribution', [0, 0.35, 1.5, -2]],
  ['set_ambient_light_energy', 'get_ambient_light_energy', [1.25]],
  ['set_tonemap_exposure', 'get_tonemap_exposure', [0.8]],
  ['set_tonemap_white', 'get_tonemap_white', [6]],
  ['set_tonemap_agx_white', 'get_tonemap_agx_white', [4]],
  ['set_tonemap_agx_contrast', 'get_tonemap_agx_contrast', [1.5]],
  ['set_fog_light_energy', 'get_fog_light_energy', [0.5]],
  ['set_fog_sun_scatter', 'get_fog_sun_scatter', [0.25]],
  ['set_fog_density', 'get_fog_density', [0.0015]],
  ['set_fog_sky_affect', 'get_fog_sky_affect', [0]],
  ['set_fog_height', 'get_fog_height', [-2.5]],
  ['set_fog_height_density', 'get_fog_height_density', [0.3]],
  ['set_ssao_power', 'get_ssao_power', [2.25]],
  ['set_ssao_horizon', 'get_ssao_horizon', [0.12]],
  ['set_sdfgi_energy', 'get_sdfgi_energy', [0.7]],
  ['set_glow_intensity', 'get_glow_intensity', [0.8]],
  ['set_glow_bloom', 'get_glow_bloom', [0.15]],
  ['set_glow_hdr_bleed_threshold', 'get_glow_hdr_bleed_threshold', [0.9]],
  ['set_glow_hdr_bleed_scale', 'get_glow_hdr_bleed_scale', [1.5]],
  ['set_glow_hdr_luminance_cap', 'get_glow_hdr_luminance_cap', [6]],
  ['set_ssao_radius', 'get_ssao_radius', [0.3]],
  ['set_ssao_intensity', 'get_ssao_intensity', [1.2]],
  ['set_adjustment_brightness', 'get_adjustment_brightness', [1.1]],
  ['set_adjustment_contrast', 'get_adjustment_contrast', [1.3]],
  ['set_adjustment_saturation', 'get_adjustment_saturation', [0.6]],
];
const BOOLS: readonly (readonly [string, string])[] = [
  ['set_glow_enabled', 'is_glow_enabled'],
  ['set_ssao_enabled', 'is_ssao_enabled'],
  ['set_adjustment_enabled', 'is_adjustment_enabled'],
];
for (const [setter, getter] of BOOLS) {
  c.add(setter, setter, ['var e := Environment.new()', `e.${setter}(true)`, `return e.${getter}()`], () => {
    const e = E.construct();
    call(setter)(e, true);
    return call(getter)(e);
  });
  c.add(`${getter}-default`, getter, [`return Environment.new().${getter}()`], () => call(getter)(E.construct()));
}
const INTS: readonly (readonly [string, string, readonly number[]])[] = [
  ['set_background', 'get_background', [2, 1]],
  ['set_ambient_source', 'get_ambient_source', [2]],
  ['set_reflection_source', 'get_reflection_source', [1]],
  ['set_tonemapper', 'get_tonemapper', [4, 1]],
  ['set_sdfgi_cascades', 'get_sdfgi_cascades', [6, 0, 9]],
];
for (const [setter, getter, values] of [...FLOATS, ...INTS]) {
  const integer = INTS.some((entry) => entry[0] === setter);
  for (const value of values) {
    c.add(`${setter}-${String(value)}`, setter, ['var e := Environment.new()', `e.${setter}(${integer ? String(value) : gd(value)})`, `return e.${getter}()`], () => {
      const e = E.construct();
      call(setter)(e, value);
      return call(getter)(e);
    });
  }
  c.add(`${getter}-default`, getter, [`return Environment.new().${getter}()`], () => call(getter)(E.construct()));
}
// The glow levels by index, with the defaults and an index outside the seven.
for (const level of [0, 1, 2, 3, 6, 7, -1]) {
  c.add(`get_glow_level-default-${String(level)}`, 'get_glow_level', [`return Environment.new().get_glow_level(${String(level)})`], () => E.get_glow_level(E.construct(), level));
  c.add(`set_glow_level-${String(level)}`, 'set_glow_level', ['var e := Environment.new()', `e.set_glow_level(${String(level)}, 0.35)`, 'return [e.get_glow_level(0), e.get_glow_level(1), e.get_glow_level(6)]'], () => {
    const e = E.construct();
    E.set_glow_level(e, level, 0.35);
    return [E.get_glow_level(e, 0), E.get_glow_level(e, 1), E.get_glow_level(e, 6)];
  });
}
for (const [setter, getter] of [
  ['set_bg_color', 'get_bg_color'],
  ['set_ambient_light_color', 'get_ambient_light_color'],
  ['set_fog_light_color', 'get_fog_light_color'],
] as const) {
  c.add(setter, setter, ['var e := Environment.new()', `e.${setter}(Color(0.6, 0.6, 0.6, 1))`, `return e.${getter}()`], () => {
    const e = E.construct();
    call(setter)(e, C.construct(0.6, 0.6, 0.6, 1));
    return call(getter)(e);
  });
  c.add(`${getter}-default`, getter, [`return Environment.new().${getter}()`], () => call(getter)(E.construct()));
}
c.add('set_fog_enabled', 'set_fog_enabled', ['var e := Environment.new()', 'e.set_fog_enabled(true)', 'return e.is_fog_enabled()'], () => {
  const e = E.construct();
  E.set_fog_enabled(e, true);
  return E.is_fog_enabled(e);
});
c.add('is_fog_enabled-default', 'is_fog_enabled', ['return Environment.new().is_fog_enabled()'], () => E.is_fog_enabled(E.construct()));
// The fog mode resets the density: 1.0 for depth, 0.01 back to exponential, 1.0 exponential again.
c.add('set_fog_mode', 'set_fog_mode', ['var e := Environment.new()', 'var out := []', 'e.set_fog_mode(1)', 'out.append(e.get_fog_density())', 'e.set_fog_mode(0)', 'out.append(e.get_fog_density())', 'e.set_fog_mode(0)', 'out.append(e.get_fog_density())', 'out.append(e.get_fog_mode())', 'return out'], () => {
  const e = E.construct();
  const out: unknown[] = [];
  E.set_fog_mode(e, 1);
  out.push(E.get_fog_density(e));
  E.set_fog_mode(e, 0);
  out.push(E.get_fog_density(e));
  E.set_fog_mode(e, 0);
  out.push(E.get_fog_density(e), E.get_fog_mode(e));
  return out;
});
c.add('get_fog_mode-default', 'get_fog_mode', ['return Environment.new().get_fog_mode()'], () => E.get_fog_mode(E.construct()));
c.add('set_sky', 'set_sky', ['var e := Environment.new()', 'var s := Sky.new()', 'e.set_sky(s)', 'return e.get_sky() == s'], () => {
  const e = E.construct();
  const s = SKY.construct();
  E.set_sky(e, s);
  return E.get_sky(e) === s;
});
c.add('get_sky-default', 'get_sky', ['return Environment.new().get_sky() == null'], () => E.get_sky(E.construct()) === null);

// The tone mapper's parameters, recomputed from `environment_get_tonemap_parameters`.
const f32 = Math.fround;
const TONEMAP = { file: 'servers/rendering/storage/environment_storage.cpp', symbol: 'RendererEnvironmentStorage::environment_get_tonemap_parameters', line: 276 };
function expected(mapper: number, white: number, agxWhite: number, contrast: number): number[] {
  const w = mapper === 0 ? 1 : mapper === 2 || mapper === 3 ? Math.max(1, white) : mapper === 4 ? f32(Math.max(2, agxWhite)) : Math.max(1, white);
  if (mapper === 1) return [f32(w * w), 0, 0, 0];
  if (mapper === 2) {
    const A = f32(f32(0.22) * 2 * 2);
    const B = f32(f32(0.3) * 2);
    const Cc = f32(0.1);
    const D = f32(0.2);
    const Ee = f32(0.01);
    const F = f32(0.3);
    return [f32(f32(f32(f32(w * f32(f32(A * w) + f32(Cc * B))) + f32(D * Ee)) / f32(f32(w * f32(f32(A * w) + B)) + f32(D * F))) - f32(Ee / F)), 0, 0, 0];
  }
  if (mapper === 3) {
    const ww = f32(w * f32(1.8));
    return [f32(f32(f32(ww * f32(ww + f32(0.0245786))) - f32(0.000090537)) / f32(f32(ww * f32(f32(f32(0.983729) * ww) + f32(0.432951))) + f32(0.238081))), 0, 0, 0];
  }
  if (mapper === 4) {
    const x = f32(0.18);
    const toe = f32((1.0 / x - 1.0) * f32(Math.pow(x, contrast)));
    const denom = f32(f32(Math.pow(x, contrast)) + toe);
    const slope = f32(f32(f32(contrast * f32(Math.pow(x, contrast - 1.0))) * toe) / f32(denom * denom));
    const aw = f32(f32(f32(f32(w - x) * f32(w - x)) / f32(1 - x)) * slope);
    return [contrast, toe, slope, aw];
  }
  return [0, 0, 0, 0];
}
for (const [id, mapper, white] of [
  ['linear', 0, 1],
  ['reinhard', 1, 6],
  ['filmic', 2, 4],
  ['aces', 3, 1],
  ['agx-stage', 4, 1],
] as const) {
  c.cases.push({
    id: `tonemap-parameters-${id}`,
    symbol: { kind: 'native-member', owner: 'Environment', member: 'set_tonemapper' },
    gdscript: '',
    target: () => {
      const e = E.construct();
      E.set_tonemapper(e, mapper);
      E.set_tonemap_white(e, white);
      return E.godot_environment_tonemap_parameters(e).params.join(',');
    },
    comparator: 'render-mapping',
    fact: { value: expected(mapper, white, f32(16.29), 1.25).join(','), source: TONEMAP },
  });
}

// What the Compatibility renderer draws does not change with the parameters it never reads: its
// SSAO pass takes the intensity and radius alone, its glow its own levels, its SDFGI nothing.
c.cases.push({
  id: 'unread-parameters-draw-nothing',
  symbol: { kind: 'native-member', owner: 'Environment', member: 'set_ssao_power' },
  gdscript: '',
  target: () => {
    const e = E.construct();
    const before = JSON.stringify(E.godot_environment_tonemap_parameters(e));
    E.set_ssao_power(e, 3);
    E.set_ssao_horizon(e, 0.5);
    E.set_glow_level(e, 2, 1);
    E.set_sdfgi_cascades(e, 2);
    E.set_sdfgi_energy(e, 4);
    return JSON.stringify(E.godot_environment_tonemap_parameters(e)) === before;
  },
  comparator: 'render-mapping',
  fact: { value: true, source: { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'ssao_strength / ssao_radius: the only SSAO parameters read', line: 2996 } },
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Environment', compatModule: 'lib/godot-compat/environment', cases: c.cases };
export default EVIDENCE;
