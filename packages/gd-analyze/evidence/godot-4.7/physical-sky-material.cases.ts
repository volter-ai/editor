/**
 * PhysicalSkyMaterial: every property set and read back in official Godot (defaults included). The shader
 * parameters its setters derive (`sky_material.cpp`) are not observable here: the headless server
 * keeps no material parameters. What the sky draws from them is the scene-environment proof's.
 */
import type { Texture } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/physical-sky-material';
import type { Shader } from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const shader = (): Shader => ({ lowered: { mode: 'sky', renderModes: [], uniforms: [], functions: '', entry: '' } });
const make = () => M.construct({ debanding0Night0: shader(), debanding1Night0: shader(), debanding0Night1: shader(), debanding1Night1: shader() });
const rgba = (c: C.Color) => [c.r, c.g, c.b, c.a];

const c = resourceCases('PhysicalSkyMaterial');
c.add('get_rayleigh_coefficient-default', 'get_rayleigh_coefficient', ['return PhysicalSkyMaterial.new().get_rayleigh_coefficient()'], () => M.get_rayleigh_coefficient(make()));
for (const value of [0.5, 7.25]) {
  c.add(`set_rayleigh_coefficient-${String(value)}`, 'set_rayleigh_coefficient', ['var m := PhysicalSkyMaterial.new()', `m.set_rayleigh_coefficient(${String(value)})`, 'return m.get_rayleigh_coefficient()'], () => {
    const m = make();
    M.set_rayleigh_coefficient(m, value);
    return M.get_rayleigh_coefficient(m);
  });
}
c.add('get_mie_coefficient-default', 'get_mie_coefficient', ['return PhysicalSkyMaterial.new().get_mie_coefficient()'], () => M.get_mie_coefficient(make()));
for (const value of [0.001, 0.3]) {
  c.add(`set_mie_coefficient-${String(value)}`, 'set_mie_coefficient', ['var m := PhysicalSkyMaterial.new()', `m.set_mie_coefficient(${String(value)})`, 'return m.get_mie_coefficient()'], () => {
    const m = make();
    M.set_mie_coefficient(m, value);
    return M.get_mie_coefficient(m);
  });
}
c.add('get_mie_eccentricity-default', 'get_mie_eccentricity', ['return PhysicalSkyMaterial.new().get_mie_eccentricity()'], () => M.get_mie_eccentricity(make()));
for (const value of [-0.5, 0.95]) {
  c.add(`set_mie_eccentricity-${String(value)}`, 'set_mie_eccentricity', ['var m := PhysicalSkyMaterial.new()', `m.set_mie_eccentricity(${String(value)})`, 'return m.get_mie_eccentricity()'], () => {
    const m = make();
    M.set_mie_eccentricity(m, value);
    return M.get_mie_eccentricity(m);
  });
}
c.add('get_turbidity-default', 'get_turbidity', ['return PhysicalSkyMaterial.new().get_turbidity()'], () => M.get_turbidity(make()));
for (const value of [3.5, 100]) {
  c.add(`set_turbidity-${String(value)}`, 'set_turbidity', ['var m := PhysicalSkyMaterial.new()', `m.set_turbidity(${String(value)})`, 'return m.get_turbidity()'], () => {
    const m = make();
    M.set_turbidity(m, value);
    return M.get_turbidity(m);
  });
}
c.add('get_sun_disk_scale-default', 'get_sun_disk_scale', ['return PhysicalSkyMaterial.new().get_sun_disk_scale()'], () => M.get_sun_disk_scale(make()));
for (const value of [0.5, 12]) {
  c.add(`set_sun_disk_scale-${String(value)}`, 'set_sun_disk_scale', ['var m := PhysicalSkyMaterial.new()', `m.set_sun_disk_scale(${String(value)})`, 'return m.get_sun_disk_scale()'], () => {
    const m = make();
    M.set_sun_disk_scale(m, value);
    return M.get_sun_disk_scale(m);
  });
}
c.add('get_energy_multiplier-default', 'get_energy_multiplier', ['return PhysicalSkyMaterial.new().get_energy_multiplier()'], () => M.get_energy_multiplier(make()));
for (const value of [0.5, 16]) {
  c.add(`set_energy_multiplier-${String(value)}`, 'set_energy_multiplier', ['var m := PhysicalSkyMaterial.new()', `m.set_energy_multiplier(${String(value)})`, 'return m.get_energy_multiplier()'], () => {
    const m = make();
    M.set_energy_multiplier(m, value);
    return M.get_energy_multiplier(m);
  });
}
c.add('get_rayleigh_color-default', 'get_rayleigh_color', ['var v := PhysicalSkyMaterial.new().get_rayleigh_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_rayleigh_color(make())));
c.add('set_rayleigh_color', 'set_rayleigh_color', ['var m := PhysicalSkyMaterial.new()', 'm.set_rayleigh_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_rayleigh_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_rayleigh_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_rayleigh_color(m));
});
c.add('get_mie_color-default', 'get_mie_color', ['var v := PhysicalSkyMaterial.new().get_mie_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_mie_color(make())));
c.add('set_mie_color', 'set_mie_color', ['var m := PhysicalSkyMaterial.new()', 'm.set_mie_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_mie_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_mie_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_mie_color(m));
});
c.add('get_ground_color-default', 'get_ground_color', ['var v := PhysicalSkyMaterial.new().get_ground_color()', 'return [v.r, v.g, v.b, v.a]'], () => rgba(M.get_ground_color(make())));
c.add('set_ground_color', 'set_ground_color', ['var m := PhysicalSkyMaterial.new()', 'm.set_ground_color(Color(0.25, 0.5, 0.75, 0.9))', 'var v := m.get_ground_color()', 'return [v.r, v.g, v.b, v.a]'], () => {
  const m = make();
  M.set_ground_color(m, C.construct(0.25, 0.5, 0.75, 0.9));
  return rgba(M.get_ground_color(m));
});
c.add('get_use_debanding-default', 'get_use_debanding', ['return PhysicalSkyMaterial.new().get_use_debanding()'], () => M.get_use_debanding(make()));
c.add('set_use_debanding-false', 'set_use_debanding', ['var m := PhysicalSkyMaterial.new()', 'm.set_use_debanding(false)', 'return m.get_use_debanding()'], () => {
  const m = make();
  M.set_use_debanding(m, false);
  return M.get_use_debanding(m);
});
c.add('get_night_sky-default', 'get_night_sky', ['return PhysicalSkyMaterial.new().get_night_sky() == null'], () => M.get_night_sky(make()) === null);
c.add('set_night_sky', 'set_night_sky', ['var m := PhysicalSkyMaterial.new()', 'var t := PlaceholderTexture2D.new()', 'm.set_night_sky(t)', 'return m.get_night_sky() == t'], () => {
  const m = make();
  const t = {} as Texture;
  M.set_night_sky(m, t);
  return M.get_night_sky(m) === t;
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'PhysicalSkyMaterial', compatModule: 'lib/godot-compat/physical-sky-material', cases: c.cases };
export default EVIDENCE;
