/** PanoramaSkyMaterial: its panorama, filtering and energy set and read back in official Godot. */
import type { Texture } from 'three';
import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/panorama-sky-material';
import type { Shader } from '../../capabilities/catalog/project-source/src/lib/godot-compat/shader';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

/** The generated shaders' code is the import's (proof `scene-environment`); these read properties. */
const shader = (): Shader => ({ lowered: { mode: 'sky', renderModes: [], uniforms: [], functions: '', entry: '' } });
const make = () => P.construct({ filterOff: shader(), filterOn: shader() });

const c = resourceCases('PanoramaSkyMaterial');
c.add('get_energy_multiplier-default', 'get_energy_multiplier', ['return PanoramaSkyMaterial.new().get_energy_multiplier()'], () => P.get_energy_multiplier(make()));
for (const value of [0.5, 0.3, 2, 128]) {
  c.add(`set_energy_multiplier-${String(value)}`, 'set_energy_multiplier', ['var m := PanoramaSkyMaterial.new()', `m.set_energy_multiplier(${String(value)})`, 'return m.get_energy_multiplier()'], () => {
    const m = make();
    P.set_energy_multiplier(m, value);
    return P.get_energy_multiplier(m);
  });
}
c.add('is_filtering_enabled-default', 'is_filtering_enabled', ['return PanoramaSkyMaterial.new().is_filtering_enabled()'], () => P.is_filtering_enabled(make()));
for (const value of [false, true]) {
  c.add(`set_filtering_enabled-${String(value)}`, 'set_filtering_enabled', ['var m := PanoramaSkyMaterial.new()', `m.set_filtering_enabled(${String(value)})`, 'return m.is_filtering_enabled()'], () => {
    const m = make();
    P.set_filtering_enabled(m, value);
    return P.is_filtering_enabled(m);
  });
}
c.add('get_panorama-default', 'get_panorama', ['return PanoramaSkyMaterial.new().get_panorama() == null'], () => P.get_panorama(make()) === null);
c.add('set_panorama', 'set_panorama', ['var m := PanoramaSkyMaterial.new()', 'var t := PlaceholderTexture2D.new()', 'm.set_panorama(t)', 'return m.get_panorama() == t'], () => {
  const m = make();
  const t = {} as Texture;
  P.set_panorama(m, t);
  return P.get_panorama(m) === t;
});
c.add('set_panorama-null', 'set_panorama', ['var m := PanoramaSkyMaterial.new()', 'm.set_panorama(PlaceholderTexture2D.new())', 'm.set_panorama(null)', 'return m.get_panorama() == null'], () => {
  const m = make();
  P.set_panorama(m, {} as Texture);
  P.set_panorama(m, null);
  return P.get_panorama(m) === null;
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'PanoramaSkyMaterial', compatModule: 'lib/godot-compat/panorama-sky-material', cases: c.cases };
export default EVIDENCE;
