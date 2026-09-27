import * as P from '../../capabilities/catalog/project-source/src/lib/godot-compat/plane-mesh';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { gv, resourceCases } from './resource-cases';

const c = resourceCases('PlaneMesh');
c.add('get_size-default', 'get_size', ['return PlaneMesh.new().get_size()'], () => P.get_size(P.construct()));
c.add('set_size', 'set_size', ['var m := PlaneMesh.new()', `m.set_size(Vector2(${gd(0.1)}, ${gd(-3)}))`, 'return m.get_size()'], () => {
  const m = P.construct();
  P.set_size(m, V2.construct(0.1, -3));
  return P.get_size(m);
});
for (const [member, getter] of [
  ['set_subdivide_width', 'get_subdivide_width'],
  ['set_subdivide_depth', 'get_subdivide_depth'],
] as const) {
  for (const value of [3, 0, -2]) {
    c.add(`${member}-${String(value)}`, member, ['var m := PlaneMesh.new()', `m.${member}(${String(value)})`, `return m.${getter}()`], () => {
      const m = P.construct();
      P[member](m, value);
      return P[getter](m);
    });
  }
  c.add(`${getter}-default`, getter, [`return PlaneMesh.new().${getter}()`], () => P[getter](P.construct()));
}
for (const [name, offset] of [
  ['set', [0.5, -1, 2]],
  ['approx', [0.000001, 0, 0]],
] as const) {
  c.add(`set_center_offset-${name}`, 'set_center_offset', ['var m := PlaneMesh.new()', `m.set_center_offset(${gv(offset)})`, 'return m.get_center_offset()'], () => {
    const m = P.construct();
    P.set_center_offset(m, V3.construct(...offset));
    return P.get_center_offset(m);
  });
}
c.add('get_center_offset-default', 'get_center_offset', ['return PlaneMesh.new().get_center_offset()'], () => P.get_center_offset(P.construct()));
c.add('set_orientation', 'set_orientation', ['var m := PlaneMesh.new()', 'm.set_orientation(PlaneMesh.FACE_Z)', 'return m.get_orientation()'], () => {
  const m = P.construct();
  P.set_orientation(m, 2);
  return P.get_orientation(m);
});
c.add('get_orientation-default', 'get_orientation', ['return PlaneMesh.new().get_orientation()'], () => P.get_orientation(P.construct()));

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'PlaneMesh', compatModule: 'lib/godot-compat/plane-mesh', cases: c.cases };
export default EVIDENCE;
