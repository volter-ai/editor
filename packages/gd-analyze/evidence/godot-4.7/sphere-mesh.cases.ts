import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-mesh';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('SphereMesh');
for (const [member, getter, values] of [
  ['set_radius', 'get_radius', [0.3, 0.5000001, 1e-3, 0.1]],
  ['set_height', 'get_height', [2.5, 1.0000001, 0.1]],
] as const) {
  for (const value of values) {
    c.add(`${member}-${gd(value)}`, member, ['var m := SphereMesh.new()', `m.${member}(${gd(value)})`, `return m.${getter}()`], () => {
      const m = S.construct();
      S[member](m, value);
      return S[getter](m);
    });
  }
  c.add(`${getter}-default`, getter, [`return SphereMesh.new().${getter}()`], () => S[getter](S.construct()));
}
for (const value of [8, 3, 4]) {
  c.add(`set_radial_segments-${String(value)}`, 'set_radial_segments', ['var m := SphereMesh.new()', `m.set_radial_segments(${String(value)})`, 'return m.get_radial_segments()'], () => {
    const m = S.construct();
    S.set_radial_segments(m, value);
    return S.get_radial_segments(m);
  });
}
c.add('set_radial_segments-below-4-at-4', 'set_radial_segments', ['var m := SphereMesh.new()', 'm.set_radial_segments(4)', 'm.set_radial_segments(2)', 'return m.get_radial_segments()'], () => {
  const m = S.construct();
  S.set_radial_segments(m, 4);
  S.set_radial_segments(m, 2);
  return S.get_radial_segments(m);
});
c.add('get_radial_segments-default', 'get_radial_segments', ['return SphereMesh.new().get_radial_segments()'], () => S.get_radial_segments(S.construct()));
for (const value of [5, 1]) {
  c.add(`set_rings-${String(value)}`, 'set_rings', ['var m := SphereMesh.new()', `m.set_rings(${String(value)})`, 'return m.get_rings()'], () => {
    const m = S.construct();
    S.set_rings(m, value);
    return S.get_rings(m);
  });
}
c.add('get_rings-default', 'get_rings', ['return SphereMesh.new().get_rings()'], () => S.get_rings(S.construct()));
c.add('set_is_hemisphere', 'set_is_hemisphere', ['var m := SphereMesh.new()', 'm.set_is_hemisphere(true)', 'return m.get_is_hemisphere()'], () => {
  const m = S.construct();
  S.set_is_hemisphere(m, true);
  return S.get_is_hemisphere(m);
});
c.add('get_is_hemisphere-default', 'get_is_hemisphere', ['return SphereMesh.new().get_is_hemisphere()'], () => S.get_is_hemisphere(S.construct()));

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'SphereMesh', compatModule: 'lib/godot-compat/sphere-mesh', cases: c.cases };
export default EVIDENCE;
