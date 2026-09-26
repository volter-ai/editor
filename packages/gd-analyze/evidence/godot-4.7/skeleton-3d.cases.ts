import { Group } from 'three';
import * as Q from '../../capabilities/catalog/project-source/src/lib/godot-compat/quaternion';
import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/skeleton-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

/** A skeleton with bones `hip`, `spine` and `head`. */
const skeleton = (): Group => {
  const s = new Group();
  for (const name of ['hip', 'spine', 'head']) S.add_bone(s, name);
  return s;
};
const G_SKELETON = ['var s := Skeleton3D.new()', 's.add_bone("hip")', 's.add_bone("spine")', 's.add_bone("head")'];
const done = (value: string): string[] => [`var out = ${value}`, 's.free()', 'return out'];

const c = resourceCases('Skeleton3D');
c.add('add_bone', 'add_bone', ['var s := Skeleton3D.new()', 'var out := [s.add_bone("hip"), s.add_bone("spine"), s.add_bone("hip"), s.add_bone(""), s.add_bone("a:b"), s.add_bone("a/b"), s.get_bone_count()]', 's.free()', 'return out'], () => {
  const s = new Group();
  return [S.add_bone(s, 'hip'), S.add_bone(s, 'spine'), S.add_bone(s, 'hip'), S.add_bone(s, ''), S.add_bone(s, 'a:b'), S.add_bone(s, 'a/b'), S.get_bone_count(s)];
});
c.add('get_bone_count', 'get_bone_count', [...G_SKELETON, ...done('s.get_bone_count()')], () => S.get_bone_count(skeleton()));
c.add('find_bone', 'find_bone', [...G_SKELETON, ...done('[s.find_bone("hip"), s.find_bone("head"), s.find_bone("tail")]')], () => {
  const s = skeleton();
  return [S.find_bone(s, 'hip'), S.find_bone(s, 'head'), S.find_bone(s, 'tail')];
});
c.add('get_bone_name', 'get_bone_name', [...G_SKELETON, ...done('[s.get_bone_name(0), s.get_bone_name(2), s.get_bone_name(3)]')], () => {
  const s = skeleton();
  return [S.get_bone_name(s, 0), S.get_bone_name(s, 2), S.get_bone_name(s, 3)];
});
c.add('get_bone_pose-default', 'get_bone_pose_position', [...G_SKELETON, ...done('[s.get_bone_pose_position(1), s.get_bone_pose_rotation(1), s.get_bone_pose_scale(1), s.get_bone_pose_position(7), s.get_bone_pose_rotation(-1), s.get_bone_pose_scale(9)]')], () => {
  const s = skeleton();
  return [S.get_bone_pose_position(s, 1), S.get_bone_pose_rotation(s, 1), S.get_bone_pose_scale(s, 1), S.get_bone_pose_position(s, 7), S.get_bone_pose_rotation(s, -1), S.get_bone_pose_scale(s, 9)];
});
for (const [x, y, z] of [[0.1, 0.643772, -0.2], [1e39, -2.5, 3]] as const) {
  c.add(`set_bone_pose_position-${gd(x)}`, 'set_bone_pose_position', [...G_SKELETON, `s.set_bone_pose_position(1, Vector3(${gd(x)}, ${gd(y)}, ${gd(z)}))`, `s.set_bone_pose_position(5, Vector3(1, 1, 1))`, ...done('[s.get_bone_pose_position(0), s.get_bone_pose_position(1)]')], () => {
    const s = skeleton();
    S.set_bone_pose_position(s, 1, V.construct(x, y, z));
    S.set_bone_pose_position(s, 5, V.construct(1, 1, 1));
    return [S.get_bone_pose_position(s, 0), S.get_bone_pose_position(s, 1)];
  });
  c.add(`set_bone_pose_scale-${gd(x)}`, 'set_bone_pose_scale', [...G_SKELETON, `s.set_bone_pose_scale(2, Vector3(${gd(x)}, ${gd(y)}, ${gd(z)}))`, ...done('[s.get_bone_pose_scale(1), s.get_bone_pose_scale(2)]')], () => {
    const s = skeleton();
    S.set_bone_pose_scale(s, 2, V.construct(x, y, z));
    return [S.get_bone_pose_scale(s, 1), S.get_bone_pose_scale(s, 2)];
  });
}
for (const [x, y, z, w] of [[-0.06803, 0.70383, 0.07057, 0.70378], [0.5, 0.5, 0.5, 0.5]] as const) {
  c.add(`set_bone_pose_rotation-${gd(x)}`, 'set_bone_pose_rotation', [...G_SKELETON, `s.set_bone_pose_rotation(0, Quaternion(${gd(x)}, ${gd(y)}, ${gd(z)}, ${gd(w)}))`, ...done('[s.get_bone_pose_rotation(0), s.get_bone_pose_rotation(2)]')], () => {
    const s = skeleton();
    S.set_bone_pose_rotation(s, 0, Q.construct(x, y, z, w));
    return [S.get_bone_pose_rotation(s, 0), S.get_bone_pose_rotation(s, 2)];
  });
}
c.add('get_bone_pose_rotation', 'get_bone_pose_rotation', [...G_SKELETON, 's.set_bone_pose_rotation(1, Quaternion(0, 0.6, 0, 0.8))', ...done('s.get_bone_pose_rotation(1)')], () => {
  const s = skeleton();
  S.set_bone_pose_rotation(s, 1, Q.construct(0, 0.6, 0, 0.8));
  return S.get_bone_pose_rotation(s, 1);
});
c.add('get_bone_pose_scale', 'get_bone_pose_scale', [...G_SKELETON, 's.set_bone_pose_scale(0, Vector3(2, 2, 2))', ...done('s.get_bone_pose_scale(0)')], () => {
  const s = skeleton();
  S.set_bone_pose_scale(s, 0, V.construct(2, 2, 2));
  return S.get_bone_pose_scale(s, 0);
});

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Skeleton3D', compatModule: 'lib/godot-compat/skeleton-3d', cases: c.cases };
export default EVIDENCE;
