import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/convex-polygon-shape-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gva, resourceCases, type Triple } from './resource-cases';

const c = resourceCases('ConvexPolygonShape3D');
c.add('get_points-default', 'get_points', ['return ConvexPolygonShape3D.new().get_points()'], () => S.get_points(S.construct()));
for (const [name, points] of [
  ['tetra', [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]],
  ['decimals', [[0.1, -0.2, 0.3], [1.7, 0.2, -0.9], [0.4, 2.2, 0.1], [-0.3, 0.5, 1.9], [0.2, 0.3, 0.1]]],
  ['empty', []],
] as const satisfies readonly (readonly [string, readonly Triple[]])[]) {
  c.add(`set_points-${name}`, 'set_points', ['var s := ConvexPolygonShape3D.new()', `s.set_points(${gva(points)})`, 'return s.get_points()'], () => {
    const s = S.construct();
    S.set_points(s, points.map((p) => V.construct(...p)));
    return S.get_points(s);
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'ConvexPolygonShape3D', compatModule: 'lib/godot-compat/convex-polygon-shape-3d', cases: c.cases };
export default EVIDENCE;
