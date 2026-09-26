import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/physics-test-motion-parameters-3d';
import * as B from '../../capabilities/catalog/project-source/src/lib/godot-compat/basis';
import * as T from '../../capabilities/catalog/project-source/src/lib/godot-compat/transform-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';

const c = resourceCases('PhysicsTestMotionParameters3D');
const READS = ['get_from', 'get_motion', 'get_margin', 'get_max_collisions', 'is_collide_separation_ray_enabled', 'is_recovery_as_collision_enabled'] as const;
const gdReads = `return [${READS.map((r) => `p.${r}()`).join(', ')}]`;
const reads = (p: P.PhysicsTestMotionParameters3D): unknown[] => READS.map((r) => P[r](p));
for (const reader of READS) {
  c.add(`${reader}-default`, reader, ['var p := PhysicsTestMotionParameters3D.new()', `return p.${reader}()`], () => P[reader](P.godot_test_motion_parameters()));
}
const SETTERS: readonly (readonly [string, string, (p: P.PhysicsTestMotionParameters3D) => void])[] = [
  ['set_from', 'p.set_from(Transform3D(Basis(Vector3(0, 1, 0), 0.5), Vector3(1.5, -2, 3)))', (p) => P.set_from(p, T.construct(B.construct(V.construct(0, 1, 0), 0.5), V.construct(1.5, -2, 3)))],
  ['set_motion', 'p.set_motion(Vector3(0.1, -0.2, 0.3))', (p) => P.set_motion(p, V.construct(0.1, -0.2, 0.3))],
  ['set_margin', 'p.set_margin(0.04)', (p) => P.set_margin(p, 0.04)],
  ['set_max_collisions', 'p.set_max_collisions(6)', (p) => P.set_max_collisions(p, 6)],
  ['set_collide_separation_ray_enabled', 'p.set_collide_separation_ray_enabled(true)', (p) => P.set_collide_separation_ray_enabled(p, true)],
  ['set_recovery_as_collision_enabled', 'p.set_recovery_as_collision_enabled(true)', (p) => P.set_recovery_as_collision_enabled(p, true)],
  ['set_exclude_bodies', 'p.set_exclude_bodies([])', (p) => P.set_exclude_bodies(p, [])],
];
for (const [name, gd, write] of SETTERS) {
  c.add(name, name, ['var p := PhysicsTestMotionParameters3D.new()', gd, gdReads], () => {
    const p = P.godot_test_motion_parameters();
    write(p);
    return reads(p);
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'PhysicsTestMotionParameters3D', compatModule: 'lib/godot-compat/physics-test-motion-parameters-3d', cases: c.cases };
export default EVIDENCE;
