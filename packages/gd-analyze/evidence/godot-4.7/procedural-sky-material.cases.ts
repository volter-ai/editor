/**
 * ProceduralSkyMaterial: every property set and read back in official Godot (defaults included). The shader
 * parameters its setters derive (`sky_material.cpp`) are not observable here: the headless server
 * keeps no material parameters. What the sky draws from them is the scene-environment proof's.
 */
import type { Texture } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/procedural-sky-material';
import type { Shader } from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const shader = (): Shader => ({ lowered: { mode: 'sky', renderModes: [], uniforms: [], functions: '', entry: '' } });
const make = () => M.construct({ debanding0Cover0: shader(), debanding1Cover0: shader(), debanding0Cover1: shader(), debanding1Cover1: shader() });
const rgba = (c: C.Color) => [c.r, c.g, c.b, c.a];

const c = resourceCases('ProceduralSkyMaterial');
c.add('get_sky_curve-default', 'get_sky_curve', ['return ProceduralSkyMaterial.new().get_sky_curve()'], () => M.get_sky_curve(make()));
for (const value of [0.0175, 0.5, 1]) {
  c.add(`set_sky_curve-${String(value)}`, 'set_sky_curve', ['var m := ProceduralSkyMaterial.new()', `m.set_sky_curve(${String(value)})`, 'return m.get_sky_curve()'], () => {
    const m = make();
    M.set_sky_curve(m, value);
    return M.get_sky_curve(m);
  });
}
c.add('get_sky_energy_multiplier-default', 'get_sky_energy_multiplier', ['return ProceduralSkyMaterial.new().get_sky_energy_multiplier()'], () => M.get_sky_energy_multiplier(make()));
for (const value of [0.5, 2]) {
  c.add(`set_sky_energy_multiplier-${String(value)}`, 'set_sky_energy_multiplier', ['var m := ProceduralSkyMaterial.new()', `m.set_sky_energy_multiplier(${String(value)})`, 'return m.get_sky_energy_multiplier()'], () => {
    const m = make();
    M.set_sky_energy_multiplier(m, value);
    return M.get_sky_energy_multiplier(m);
  });
}
c.add('get_ground_curve-default', 'get_ground_curve', ['return ProceduralSkyMaterial.new().get_ground_curve()'], () => M.get_ground_curve(make()));
for (const value of [0.171484, 0.5]) {
  c.add(`set_ground_curve-${String(value)}`, 'set_ground_curve', ['var m := ProceduralSkyMaterial.new()', `m.set_ground_curve(${String(value)})`, 'return m.get_ground_curve()'], () => {
    const m = make();
    M.set_ground_curve(m, value);
    return M.get_ground_curve(m);
  });
}
c.add('get_ground_energy_multiplier-default', 'get_ground_energy_multiplier', ['return ProceduralSkyMaterial.new().get_ground_energy_multiplier()'], () => M.get_ground_energy_multiplier(make()));
for (const value of [0.3, 4]) {
  c.add(`set_ground_energy_multiplier-${String(value)}`, 'set_ground_energy_multiplier', ['var m := ProceduralSkyMaterial.new()', `m.set_ground_energy_multiplier(${String(value)})`, 'return m.get_ground_energy_multiplier()'], () => {
    const m = make();
    M.set_ground_energy_multiplier(m, value);
    return M.get_ground_energy_multiplier(m);
  });
}
c.add('get_sun_angle_max-default', 'get_sun_angle_max', ['return ProceduralSkyMaterial.new().get_sun_angle_max()'], () => M.get_sun_angle_max(make()));
for (const value of [10, 45.5]) {
  c.add(`set_sun_angle_max-${String(value)}`, 'set_sun_angle_max', ['var m := ProceduralSkyMaterial.new()', `m.set_sun_angle_max(${String(value)})`, 'return m.get_sun_angle_max()'], () => {
    const m = make();
    M.set_sun_angle_max(m, value);
    return M.get_sun_angle_max(m);
  });
}
c.add('get_sun_curve-default', 'get_sun_curve', ['return ProceduralSkyMaterial.new().get_sun_curve()'], () => M.get_sun_curve(make()));
for (const value of [0.05, 0.3]) {
  c.add(`set_sun_curve-${String(value)}`, 'set_sun_curve', ['var m := ProceduralSkyMaterial.new()', `m.set_sun_curve(${String(value)})`, 'return m.get_sun_curve()'], () => {
    const m = make();
    M.set_sun_curve(m, value);
    return M.get_sun_curve(m);
  });
}
c.add('get_energy_multiplier-default', 'get_energy_multiplier', ['return ProceduralSkyMaterial.new().get_energy_multiplier()'], () => M.get_energy_multiplier(make()));
for (const value of [0.5, 16]) {
  c.add(`set_energy_multiplier-${String(value)}`, 'set_energy_multiplier', ['var m := ProceduralSkyMaterial.new()', `m.set_energy_multiplier(${String(value)})`, 'return m.get_energy_multiplier()'], () => {
    const m = make();
    M.set_energy_multiplier(m, value);
    return M.get_energy_multiplier(m);
  });
}
c.add('get_sky_top_color-default', 'get_sky_top_color', ['var v := ProceduralSkyMaterial.new().get_sky_top_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_sky_top_color(make())));
c.add('set_sky_top_color', 'set_sky_top_color', ['var m := ProceduralSkyMaterial.new()', 'm.set_sky_top_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_sky_top_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_sky_top_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_sky_top_color(m));
});
c.add('get_sky_horizon_color-default', 'get_sky_horizon_color', ['var v := ProceduralSkyMaterial.new().get_sky_horizon_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_sky_horizon_color(make())));
c.add('set_sky_horizon_color', 'set_sky_horizon_color', ['var m := ProceduralSkyMaterial.new()', 'm.set_sky_horizon_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_sky_horizon_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_sky_horizon_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_sky_horizon_color(m));
});
c.add('get_sky_cover_modulate-default', 'get_sky_cover_modulate', ['var v := ProceduralSkyMaterial.new().get_sky_cover_modulate()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_sky_cover_modulate(make())));
c.add('set_sky_cover_modulate', 'set_sky_cover_modulate', ['var m := ProceduralSkyMaterial.new()', 'm.set_sky_cover_modulate(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_sky_cover_modulate()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_sky_cover_modulate(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_sky_cover_modulate(m));
});
c.add('get_ground_bottom_color-default', 'get_ground_bottom_color', ['var v := ProceduralSkyMaterial.new().get_ground_bottom_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_ground_bottom_color(make())));
c.add('set_ground_bottom_color', 'set_ground_bottom_color', ['var m := ProceduralSkyMaterial.new()', 'm.set_ground_bottom_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_ground_bottom_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_ground_bottom_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_ground_bottom_color(m));
});
c.add('get_ground_horizon_color-default', 'get_ground_horizon_color', ['var v := ProceduralSkyMaterial.new().get_ground_horizon_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_ground_horizon_color(make())));
c.add('set_ground_horizon_color', 'set_ground_horizon_color', ['var m := ProceduralSkyMaterial.new()', 'm.set_ground_horizon_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_ground_horizon_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_ground_horizon_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_ground_horizon_color(m));
});
c.add('get_use_debanding-default', 'get_use_debanding', ['return ProceduralSkyMaterial.new().get_use_debanding()'], () => M.get_use_debanding(make()));
c.add('set_use_debanding-false', 'set_use_debanding', ['var m := ProceduralSkyMaterial.new()', 'm.set_use_debanding(false)', 'return m.get_use_debanding()'], () => {
  const m = make();
  M.set_use_debanding(m, false);
  return M.get_use_debanding(m);
});
c.add('get_sky_cover-default', 'get_sky_cover', ['return ProceduralSkyMaterial.new().get_sky_cover() == null'], () => M.get_sky_cover(make()) === null);
c.add('set_sky_cover', 'set_sky_cover', ['var m := ProceduralSkyMaterial.new()', 'var t := PlaceholderTexture2D.new()', 'm.set_sky_cover(t)', 'return m.get_sky_cover() == t'], () => {
  const m = make();
  const t = {} as Texture;
  M.set_sky_cover(m, t);
  return M.get_sky_cover(m) === t;
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'ProceduralSkyMaterial', compatModule: 'lib/godot-compat/procedural-sky-material', cases: c.cases };
export default EVIDENCE;
