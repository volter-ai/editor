import { Mesh } from 'three';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-mesh';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/mesh-instance-3d';
import * as SM from '../../capabilities/catalog/project-source/src/lib/godot-compat/standard-material-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('MeshInstance3D');
c.add('get_mesh-default', 'get_mesh', ['return MeshInstance3D.new().get_mesh() == null'], () => M.get_mesh(new Mesh()) === null);
c.add('set_mesh', 'set_mesh', ['var n := MeshInstance3D.new()', 'var m := SphereMesh.new()', 'n.set_mesh(m)', 'return n.get_mesh() == m'], () => {
  const n = new Mesh();
  const m = S.construct();
  M.set_mesh(n, m);
  return M.get_mesh(n) === m;
});
c.add('set_mesh-null', 'set_mesh', ['var n := MeshInstance3D.new()', 'n.set_mesh(SphereMesh.new())', 'n.set_mesh(null)', 'return n.get_mesh() == null'], () => {
  const n = new Mesh();
  M.set_mesh(n, S.construct());
  M.set_mesh(n, null);
  return M.get_mesh(n) === null;
});
c.add('set_surface_override_material', 'set_surface_override_material', ['var n := MeshInstance3D.new()', 'n.set_mesh(SphereMesh.new())', 'var mat := StandardMaterial3D.new()', 'n.set_surface_override_material(0, mat)', 'return n.get_surface_override_material(0) == mat'], () => {
  const n = new Mesh();
  M.set_mesh(n, S.construct());
  const mat = SM.construct();
  M.set_surface_override_material(n, 0, mat);
  return M.get_surface_override_material(n, 0) === mat;
});
c.add('set_surface_override_material-before-mesh', 'set_surface_override_material', ['var n := MeshInstance3D.new()', 'n.set_surface_override_material(0, StandardMaterial3D.new())', 'n.set_mesh(SphereMesh.new())', 'return n.get_surface_override_material(0) == null'], () => {
  const n = new Mesh();
  M.set_surface_override_material(n, 0, SM.construct());
  M.set_mesh(n, S.construct());
  return M.get_surface_override_material(n, 0) === null;
});
c.add('get_surface_override_material-out-of-range', 'get_surface_override_material', ['var n := MeshInstance3D.new()', 'n.set_mesh(SphereMesh.new())', 'return n.get_surface_override_material(3) == null'], () => {
  const n = new Mesh();
  M.set_mesh(n, S.construct());
  return M.get_surface_override_material(n, 3) === null;
});
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'MeshInstance3D', compatModule: 'lib/godot-compat/mesh-instance-3d', cases: c.cases };
export default EVIDENCE;
