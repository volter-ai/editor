import { Group } from 'three';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/marker-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('Marker3D');
c.add('get_gizmo_extents-default', 'get_gizmo_extents', ['var m := Marker3D.new()', 'var e := m.get_gizmo_extents()', 'm.free()', 'return e'], () => M.get_gizmo_extents(new Group()));
for (const value of [0, 0.1, 1.5, 12.25]) {
  c.add(`set_gizmo_extents-${gd(value)}`, 'set_gizmo_extents', ['var m := Marker3D.new()', `m.set_gizmo_extents(${gd(value)})`, 'var e := m.get_gizmo_extents()', 'm.free()', 'return e'], () => {
    const m = new Group();
    M.set_gizmo_extents(m, value);
    return M.get_gizmo_extents(m);
  });
}
const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'Marker3D', compatModule: 'lib/godot-compat/marker-3d', cases: c.cases };
export default EVIDENCE;
