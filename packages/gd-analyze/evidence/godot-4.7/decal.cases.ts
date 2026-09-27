/**
 * Decal: each parameter set and read back in official Godot (the player's blob shadow's values and
 * the clamps), and (`web-platform-fact`) what a decal draws in Godot's web export: nothing, its
 * Compatibility renderer's decal storage being empty.
 */
import { Group, Texture } from 'three';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as D from '../../capabilities/catalog/project-source/src/lib/godot-compat/decal';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('Decal');
type Fn = (self: object, value?: unknown) => unknown;
const call = (name: string): Fn => (D as unknown as Record<string, Fn>)[name] as Fn;
for (const [setter, getter, values, literal] of [
  ['set_emission_energy', 'get_emission_energy', [2.5], gd],
  ['set_albedo_mix', 'get_albedo_mix', [0.8], gd],
  ['set_upper_fade', 'get_upper_fade', [3.99999, -1], gd],
  ['set_lower_fade', 'get_lower_fade', [1, -0.5], gd],
  ['set_normal_fade', 'get_normal_fade', [0.5], gd],
  ['set_enable_distance_fade', 'is_distance_fade_enabled', [true], String],
  ['set_distance_fade_begin', 'get_distance_fade_begin', [12.5], gd],
  ['set_distance_fade_length', 'get_distance_fade_length', [3], gd],
  ['set_cull_mask', 'get_cull_mask', [1048573], String],
] as const) {
  for (const value of values) {
    c.add(`${setter}-${String(value)}`, setter, ['var d := Decal.new()', `d.${setter}(${(literal as (v: never) => string)(value as never)})`, `return d.${getter}()`], () => {
      const d = new Group();
      call(setter)(d, value);
      return call(getter)(d);
    });
  }
  c.add(`${getter}-default`, getter, [`return Decal.new().${getter}()`], () => call(getter)(new Group()));
}
for (const [name, [x, y, z]] of [
  ['blob', [1.6, 12, 1.6]],
  ['flat', [0, -3, 0.0001]],
] as const) {
  c.add(`set_size-${name}`, 'set_size', ['var d := Decal.new()', `d.set_size(Vector3(${gd(x)}, ${gd(y)}, ${gd(z)}))`, 'return d.get_size()'], () => {
    const d = new Group();
    D.set_size(d, V.construct(x, y, z));
    return D.get_size(d);
  });
}
c.add('get_size-default', 'get_size', ['return Decal.new().get_size()'], () => D.get_size(new Group()));
c.add('set_modulate', 'set_modulate', ['var d := Decal.new()', 'd.set_modulate(Color(0.2, 0.4, 0.6, 0.5))', 'return d.get_modulate()'], () => {
  const d = new Group();
  D.set_modulate(d, C.construct(0.2, 0.4, 0.6, 0.5));
  return D.get_modulate(d);
});
c.add('get_modulate-default', 'get_modulate', ['return Decal.new().get_modulate()'], () => D.get_modulate(new Group()));
c.add('set_texture', 'set_texture', ['var d := Decal.new()', 'var t := PlaceholderTexture2D.new()', 'd.set_texture(0, t)', 'd.set_texture(7, t)', 'return [d.get_texture(0) == t, d.get_texture(1) == null, d.get_texture(7) == null]'], () => {
  const d = new Group();
  const t = new Texture();
  D.set_texture(d, 0, t);
  D.set_texture(d, 7, t);
  return [D.get_texture(d, 0) === t, D.get_texture(d, 1) === null, D.get_texture(d, 7) === null];
});
c.add('get_texture-default', 'get_texture', ['return Decal.new().get_texture(0) == null'], () => D.get_texture(new Group(), 0) === null);
// What the web export draws for a decal: nothing, the group holding no drawable.
c.cases.push({
  id: 'web-draws-nothing',
  symbol: { kind: 'native-member', owner: 'Decal', member: 'set_size' },
  gdscript: '',
  target: () => {
    const d = new Group();
    D.set_size(d, V.construct(1.6, 12, 1.6));
    D.set_texture(d, 0, new Texture());
    return d.children.length;
  },
  comparator: 'web-platform-fact',
  fact: { value: 0, source: { file: 'drivers/gles3/storage/texture_storage.cpp', symbol: 'TextureStorage::decal_set_size (empty in the Compatibility renderer)', line: 2505 } },
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Decal', compatModule: 'lib/godot-compat/decal', cases: c.cases };
export default EVIDENCE;
