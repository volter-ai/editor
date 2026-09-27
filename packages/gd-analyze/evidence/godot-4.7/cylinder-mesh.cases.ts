import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/cylinder-mesh';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('CylinderMesh');
for (const [member, getter, values] of [
  ['set_top_radius', 'get_top_radius', [0, 0.5000001, 1.25]],
  ['set_bottom_radius', 'get_bottom_radius', [0.3, 0.1]],
  ['set_height', 'get_height', [0.4, 2.0000001, 7.5]],
] as const) {
  for (const value of values) {
    c.add(`${member}-${gd(value)}`, member, ['var m := CylinderMesh.new()', `m.${member}(${gd(value)})`, `return m.${getter}()`], () => {
      const m = C.construct();
      C[member](m, value);
      return C[getter](m);
    });
  }
  c.add(`${getter}-default`, getter, [`return CylinderMesh.new().${getter}()`], () => C[getter](C.construct()));
}
for (const value of [12, 3]) {
  c.add(`set_radial_segments-${String(value)}`, 'set_radial_segments', ['var m := CylinderMesh.new()', `m.set_radial_segments(${String(value)})`, 'return m.get_radial_segments()'], () => {
    const m = C.construct();
    C.set_radial_segments(m, value);
    return C.get_radial_segments(m);
  });
}
c.add('get_radial_segments-default', 'get_radial_segments', ['return CylinderMesh.new().get_radial_segments()'], () => C.get_radial_segments(C.construct()));
for (const value of [0, 2]) {
  c.add(`set_rings-${String(value)}`, 'set_rings', ['var m := CylinderMesh.new()', `m.set_rings(${String(value)})`, 'return m.get_rings()'], () => {
    const m = C.construct();
    C.set_rings(m, value);
    return C.get_rings(m);
  });
}
c.add('get_rings-default', 'get_rings', ['return CylinderMesh.new().get_rings()'], () => C.get_rings(C.construct()));
for (const [member, getter] of [
  ['set_cap_top', 'is_cap_top'],
  ['set_cap_bottom', 'is_cap_bottom'],
] as const) {
  c.add(member, member, ['var m := CylinderMesh.new()', `m.${member}(false)`, `return m.${getter}()`], () => {
    const m = C.construct();
    C[member](m, false);
    return C[getter](m);
  });
  c.add(`${getter}-default`, getter, [`return CylinderMesh.new().${getter}()`], () => C[getter](C.construct()));
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'CylinderMesh', compatModule: 'lib/godot-compat/cylinder-mesh', cases: c.cases };
export default EVIDENCE;
