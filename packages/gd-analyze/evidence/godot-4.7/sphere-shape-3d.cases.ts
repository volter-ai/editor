import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-shape-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('SphereShape3D');
c.add('get_radius-default', 'get_radius', ['return SphereShape3D.new().get_radius()'], () => S.get_radius(S.construct()));
for (const radius of [1, 0.1, 0, -0.5, 1e-7, 123.456]) {
  c.add(`set_radius-${String(radius)}`, 'set_radius', ['var s := SphereShape3D.new()', `s.set_radius(${gd(radius)})`, 'return s.get_radius()'], () => {
    const s = S.construct();
    S.set_radius(s, radius);
    return S.get_radius(s);
  });
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'SphereShape3D', compatModule: 'lib/godot-compat/sphere-shape-3d', cases: c.cases };
export default EVIDENCE;
