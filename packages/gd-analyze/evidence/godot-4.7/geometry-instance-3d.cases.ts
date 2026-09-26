import { Mesh } from 'three';
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
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'GeometryInstance3D', compatModule: 'lib/godot-compat/geometry-instance-3d', cases: c.cases };
export default EVIDENCE;
