import * as Q from '../../capabilities/catalog/project-source/src/lib/godot-compat/physics-ray-query-parameters-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';
import { gv, type Triple } from './resource-cases';

const cases: GodotEvidenceCase[] = [];
const member = (name: string): GodotEvidenceSymbol => ({ kind: 'native-member', owner: 'PhysicsRayQueryParameters3D', member: name });
const READS = ['get_from', 'get_to', 'get_collision_mask', 'is_collide_with_bodies_enabled', 'is_collide_with_areas_enabled', 'is_hit_from_inside_enabled', 'is_hit_back_faces_enabled'] as const;
const readAll = (q: Q.PhysicsRayQueryParameters3D): unknown[] => READS.map((name) => Q[name](q));
const gdReadAll = 'return [q.get_from(), q.get_to(), q.get_collision_mask(), q.is_collide_with_bodies_enabled(), q.is_collide_with_areas_enabled(), q.is_hit_from_inside_enabled(), q.is_hit_back_faces_enabled()]';

const FROM: Triple = [0.1, 2.5, -3];
const TO: Triple = [4, -1e3, 0.7];
for (const [name, mask] of [
  ['default', undefined],
  ['mask-6', 6],
  ['mask-max', 4294967295],
  ['mask-0', 0],
] as const) {
  cases.push({
    id: `create-${name}`,
    symbol: { kind: 'native-static', owner: 'PhysicsRayQueryParameters3D', member: 'create' },
    gdscript: `var q := PhysicsRayQueryParameters3D.create(${gv(FROM)}, ${gv(TO)}${mask === undefined ? '' : `, ${String(mask)}`})\n${gdReadAll}`,
    target: () => readAll(mask === undefined ? Q.create(V.construct(...FROM), V.construct(...TO)) : Q.create(V.construct(...FROM), V.construct(...TO), mask)),
    comparator: 'exact',
  });
}
for (const reader of READS) {
  cases.push({ id: `${reader}-default`, symbol: member(reader), gdscript: `PhysicsRayQueryParameters3D.new().${reader}()`, target: () => Q[reader](Q.godot_ray_query_new()), comparator: 'exact' });
}
const SETTERS: readonly (readonly [string, string, (q: Q.PhysicsRayQueryParameters3D) => void])[] = [
  ['set_from', `q.set_from(${gv([1.5, -2, 3.25])})`, (q) => Q.set_from(q, V.construct(1.5, -2, 3.25))],
  ['set_to', `q.set_to(${gv([-7, 0.001, 9])})`, (q) => Q.set_to(q, V.construct(-7, 0.001, 9))],
  ['set_collision_mask', 'q.set_collision_mask(1 << 5)', (q) => Q.set_collision_mask(q, 1 << 5)],
  ['set_collide_with_bodies', 'q.set_collide_with_bodies(false)', (q) => Q.set_collide_with_bodies(q, false)],
  ['set_collide_with_areas', 'q.set_collide_with_areas(true)', (q) => Q.set_collide_with_areas(q, true)],
  ['set_hit_from_inside', 'q.set_hit_from_inside(true)', (q) => Q.set_hit_from_inside(q, true)],
  ['set_hit_back_faces', 'q.set_hit_back_faces(false)', (q) => Q.set_hit_back_faces(q, false)],
  ['set_exclude', 'q.set_exclude([])', (q) => Q.set_exclude(q, [])],
];
for (const [name, gdscript, write] of SETTERS) {
  cases.push({
    id: name,
    symbol: member(name),
    gdscript: `var q := PhysicsRayQueryParameters3D.new()\n${gdscript}\n${gdReadAll}`,
    target: () => {
      const q = Q.godot_ray_query_new();
      write(q);
      return readAll(q);
    },
    comparator: 'exact',
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'PhysicsRayQueryParameters3D', compatModule: 'lib/godot-compat/physics-ray-query-parameters-3d', cases };
export default EVIDENCE;
