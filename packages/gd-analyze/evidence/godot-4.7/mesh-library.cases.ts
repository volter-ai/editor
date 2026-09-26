import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/mesh-library';
import { construct as basis } from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import { construct as transform3d } from '../../capabilities/catalog/project-source/src/lib/godot-compat/transform-3d';
import { construct as vector3 } from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('MeshLibrary');
/** Items 7, 2 and 40, named out of order, as a library `ml`. */
const SETUP = ['var ml := MeshLibrary.new()', 'ml.create_item(7)', 'ml.create_item(2)', 'ml.create_item(40)', 'ml.set_item_name(7, "Wall")', 'ml.set_item_name(2, "Floor")', 'ml.set_item_name(40, "Wall")'];
const library = () => {
  const ml = M.godot_mesh_library_new();
  M.create_item(ml, 7);
  M.create_item(ml, 2);
  M.create_item(ml, 40);
  M.set_item_name(ml, 7, 'Wall');
  M.set_item_name(ml, 2, 'Floor');
  M.set_item_name(ml, 40, 'Wall');
  return ml;
};
c.add('get_item_list-sorted', 'get_item_list', [...SETUP, 'return ml.get_item_list()'], () => M.get_item_list(library()));
c.add('create_item-taken-negative', 'create_item', [...SETUP, 'ml.create_item(2)', 'ml.create_item(-1)', 'return [ml.get_item_list(), ml.get_item_name(2)]'], () => {
  const ml = library();
  M.create_item(ml, 2);
  M.create_item(ml, -1);
  return [M.get_item_list(ml), M.get_item_name(ml, 2)];
});
c.add('get_item_name', 'get_item_name', [...SETUP, 'return [ml.get_item_name(7), ml.get_item_name(40), ml.get_item_name(3)]'], () => {
  const ml = library();
  return [M.get_item_name(ml, 7), M.get_item_name(ml, 40), M.get_item_name(ml, 3)];
});
c.add('set_item_name-missing', 'set_item_name', [...SETUP, 'ml.set_item_name(99, "X")', 'ml.set_item_name(2, "Ramp")', 'return [ml.get_item_list(), ml.get_item_name(2)]'], () => {
  const ml = library();
  M.set_item_name(ml, 99, 'X');
  M.set_item_name(ml, 2, 'Ramp');
  return [M.get_item_list(ml), M.get_item_name(ml, 2)];
});
c.add('find_item_by_name', 'find_item_by_name', [...SETUP, 'return [ml.find_item_by_name("Wall"), ml.find_item_by_name("Floor"), ml.find_item_by_name("None")]'], () => {
  const ml = library();
  return [M.find_item_by_name(ml, 'Wall'), M.find_item_by_name(ml, 'Floor'), M.find_item_by_name(ml, 'None')];
});
c.add('get_last_unused_item_id', 'get_last_unused_item_id', ['var ml := MeshLibrary.new()', 'var r = [ml.get_last_unused_item_id()]', 'ml.create_item(40)', 'ml.create_item(3)', 'r.append(ml.get_last_unused_item_id())', 'return r'], () => {
  const ml = M.godot_mesh_library_new();
  const r = [M.get_last_unused_item_id(ml)];
  M.create_item(ml, 40);
  M.create_item(ml, 3);
  r.push(M.get_last_unused_item_id(ml));
  return r;
});
c.add('mesh_transform', 'set_item_mesh_transform', [...SETUP, 'ml.set_item_mesh_transform(7, Transform3D(Basis(Vector3(0, 0, -1), Vector3(0, 1, 0), Vector3(1, 0, 0)), Vector3(1, 2, 3)))', 'return [ml.get_item_mesh_transform(7), ml.get_item_mesh_transform(2), ml.get_item_mesh_transform(5)]'], () => {
  const ml = library();
  M.set_item_mesh_transform(ml, 7, transform3d(basis(vector3(0, 0, -1), vector3(0, 1, 0), vector3(1, 0, 0)), vector3(1, 2, 3)));
  return [M.get_item_mesh_transform(ml, 7), M.get_item_mesh_transform(ml, 2), M.get_item_mesh_transform(ml, 5)];
});
c.add('get_item_mesh_transform', 'get_item_mesh_transform', [...SETUP, 'return ml.get_item_mesh_transform(2)'], () => M.get_item_mesh_transform(library(), 2));
c.add('mesh_cast_shadow', 'set_item_mesh_cast_shadow', [...SETUP, 'ml.set_item_mesh_cast_shadow(7, 0)', 'return [ml.get_item_mesh_cast_shadow(7), ml.get_item_mesh_cast_shadow(2), ml.get_item_mesh_cast_shadow(5)]'], () => {
  const ml = library();
  M.set_item_mesh_cast_shadow(ml, 7, 0);
  return [M.get_item_mesh_cast_shadow(ml, 7), M.get_item_mesh_cast_shadow(ml, 2), M.get_item_mesh_cast_shadow(ml, 5)];
});
c.add('get_item_mesh_cast_shadow', 'get_item_mesh_cast_shadow', [...SETUP, 'return ml.get_item_mesh_cast_shadow(40)'], () => M.get_item_mesh_cast_shadow(library(), 40));
c.add('remove_item', 'remove_item', [...SETUP, 'ml.remove_item(7)', 'ml.remove_item(8)', 'return [ml.get_item_list(), ml.get_last_unused_item_id()]'], () => {
  const ml = library();
  M.remove_item(ml, 7);
  M.remove_item(ml, 8);
  return [M.get_item_list(ml), M.get_last_unused_item_id(ml)];
});
c.add('clear', 'clear', [...SETUP, 'ml.clear()', 'return [ml.get_item_list(), ml.get_last_unused_item_id()]'], () => {
  const ml = library();
  M.clear(ml);
  return [M.get_item_list(ml), M.get_last_unused_item_id(ml)];
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'MeshLibrary', compatModule: 'lib/godot-compat/mesh-library', cases: c.cases };
export default EVIDENCE;
