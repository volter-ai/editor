import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/concave-polygon-shape-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gva, resourceCases, type Triple } from './resource-cases';

const c = resourceCases('ConcavePolygonShape3D');
c.add('get_faces-default', 'get_faces', ['return ConcavePolygonShape3D.new().get_faces()'], () => S.get_faces(S.construct()));
c.add('is_backface_collision_enabled-default', 'is_backface_collision_enabled', ['return ConcavePolygonShape3D.new().is_backface_collision_enabled()'], () =>
  S.is_backface_collision_enabled(S.construct()),
);
for (const [name, faces] of [
  ['one', [[0, 0, 0], [1, 0, 0], [0, 0, 1]]],
  ['two', [[-1, 0, -1], [1, 0.5, -1], [1, 0, 1], [-1, 0, -1], [1, 0, 1], [-1, 0.25, 1.1]]],
  ['empty', []],
] as const satisfies readonly (readonly [string, readonly Triple[]])[]) {
  c.add(`set_faces-${name}`, 'set_faces', ['var s := ConcavePolygonShape3D.new()', `s.set_faces(${gva(faces)})`, 'return s.get_faces()'], () => {
    const s = S.construct();
    S.set_faces(s, faces.map((p) => V.construct(...p)));
    return S.get_faces(s);
  });
}
for (const on of [true, false]) {
  c.add(`set_backface_collision_enabled-${String(on)}`, 'set_backface_collision_enabled', ['var s := ConcavePolygonShape3D.new()', 's.set_backface_collision_enabled(true)', `s.set_backface_collision_enabled(${String(on)})`, 'return s.is_backface_collision_enabled()'], () => {
    const s = S.construct();
    S.set_backface_collision_enabled(s, true);
    S.set_backface_collision_enabled(s, on);
    return S.is_backface_collision_enabled(s);
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'ConcavePolygonShape3D', compatModule: 'lib/godot-compat/concave-polygon-shape-3d', cases: c.cases };
export default EVIDENCE;
