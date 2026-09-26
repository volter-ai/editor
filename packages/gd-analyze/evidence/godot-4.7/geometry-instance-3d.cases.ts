import { Mesh, MeshStandardMaterial } from 'three';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/geometry-instance-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const mounted = (): Mesh => {
  const n = new Mesh();
  G.godot_geometry_instance_3d_mount(n);
  return n;
};
const c = resourceCases('GeometryInstance3D');
c.add('get_cast_shadows_setting-default', 'get_cast_shadows_setting', ['return MeshInstance3D.new().get_cast_shadows_setting()'], () => G.get_cast_shadows_setting(mounted()));
for (const setting of [0, 2, 3]) {
  c.add(`set_cast_shadows_setting-${String(setting)}`, 'set_cast_shadows_setting', ['var n := MeshInstance3D.new()', `n.set_cast_shadows_setting(${String(setting)})`, 'return n.get_cast_shadows_setting()'], () => {
    const n = mounted();
    G.set_cast_shadows_setting(n, setting);
    return G.get_cast_shadows_setting(n);
  });
}
// The visibility range setters, read back through Godot's getters.
for (const [setter, getter, value] of [
  ['set_visibility_range_begin', 'get_visibility_range_begin', 3.3],
  ['set_visibility_range_end', 'get_visibility_range_end', 8.5],
  ['set_visibility_range_begin_margin', 'get_visibility_range_begin_margin', 0.1],
  ['set_visibility_range_end_margin', 'get_visibility_range_end_margin', 2.7],
  ['set_visibility_range_fade_mode', 'get_visibility_range_fade_mode', 1],
] as const) {
  const literal = setter === 'set_visibility_range_fade_mode' ? String(value) : gd(value);
  c.add(setter, setter, ['var n := MeshInstance3D.new()', `n.${setter}(${literal})`, `return n.${getter}()`], () => {
    const n = mounted();
    (G[setter] as (self: object, value: number) => void)(n, value);
    return (G[getter] as (self: object) => number)(n);
  });
  c.add(`${getter}-default`, getter, [`return MeshInstance3D.new().${getter}()`], () => (G[getter] as (self: object) => number)(mounted()));
}
// Transparency, clamped, and (`render-mapping`) the three material it leaves as it is: the
// Compatibility renderer, the web's, never reads the instance's `force_alpha`.
for (const value of [0.25, 1.5, -0.5, 1]) {
  c.add(`set_transparency-${String(value)}`, 'set_transparency', ['var n := MeshInstance3D.new()', `n.set_transparency(${gd(value)})`, 'return n.get_transparency()'], () => {
    const n = mounted();
    G.set_transparency(n, value);
    return G.get_transparency(n);
  });
}
// A scene's instance: its transparency and casting setting in `userData` (casting also as three's
// `castShadow`), as the idiomatic scene states them.
for (const value of [0.3, 1.5]) {
  c.add(`scene-transparency-${String(value)}`, 'get_transparency', ['var n := MeshInstance3D.new()', `n.transparency = ${gd(value)}`, 'return n.get_transparency()'], () => {
    const n = mounted();
    n.userData = { transparency: value };
    return G.get_transparency(n);
  });
}
for (const setting of [0, 2, 3]) {
  c.add(`scene-cast_shadow-${String(setting)}`, 'get_cast_shadows_setting', ['var n := MeshInstance3D.new()', `n.cast_shadow = ${String(setting)}`, 'return n.get_cast_shadows_setting()'], () => {
    const n = mounted();
    n.castShadow = setting !== 0;
    n.userData = { cast_shadow: setting };
    return G.get_cast_shadows_setting(n);
  });
}
c.add('get_transparency-default', 'get_transparency', ['return MeshInstance3D.new().get_transparency()'], () => G.get_transparency(mounted()));
c.cases.push({
  id: 'three-set_transparency-material',
  symbol: { kind: 'native-member', owner: 'GeometryInstance3D', member: 'set_transparency' },
  gdscript: '',
  target: () => {
    const material = new MeshStandardMaterial();
    const n = new Mesh(undefined, material);
    G.godot_geometry_instance_3d_mount(n);
    G.set_transparency(n, 0.6);
    return [material.opacity, material.transparent, n.visible].join(',');
  },
  comparator: 'render-mapping',
  fact: { value: '1,false,true', source: { file: 'drivers/gles3/rasterizer_scene_gles3.cpp', symbol: 'RasterizerSceneGLES3::_fill_render_list (force_alpha is never the instance transparency)', line: 1479 } },
});
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'GeometryInstance3D', compatModule: 'lib/godot-compat/geometry-instance-3d', cases: c.cases };
export default EVIDENCE;
