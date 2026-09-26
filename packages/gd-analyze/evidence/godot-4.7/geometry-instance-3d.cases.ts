import { Mesh } from 'three';
import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/geometry-instance-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
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
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'GeometryInstance3D', compatModule: 'lib/godot-compat/geometry-instance-3d', cases: c.cases };
export default EVIDENCE;
