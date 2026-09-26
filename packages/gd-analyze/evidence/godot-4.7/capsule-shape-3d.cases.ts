import * as S from '../../capabilities/catalog/project-source/src/lib/godot-compat/capsule-shape-3d';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

const c = resourceCases('CapsuleShape3D');
c.add('get_radius-default', 'get_radius', ['return CapsuleShape3D.new().get_radius()'], () => S.get_radius(S.construct()));
c.add('get_height-default', 'get_height', ['return CapsuleShape3D.new().get_height()'], () => S.get_height(S.construct()));
for (const [radius, height] of [
  [0.25, 3],
  [2, 1],
  [0.3, 0.1],
  [-1, 2],
  [0.5, -3],
  [0.1, 0.7],
] as const) {
  for (const [order, member] of [
    ['radius-first', 'set_radius'],
    ['height-first', 'set_height'],
  ] as const) {
    const lines =
      order === 'radius-first'
        ? [`s.set_radius(${gd(radius)})`, `r.append([s.get_radius(), s.get_height()])`, `s.set_height(${gd(height)})`]
        : [`s.set_height(${gd(height)})`, `r.append([s.get_radius(), s.get_height()])`, `s.set_radius(${gd(radius)})`];
    c.add(`${member}-${String(radius)}-${String(height)}`, member, ['var s := CapsuleShape3D.new()', 'var r := []', ...lines, 'r.append([s.get_radius(), s.get_height()])', 'return r'], () => {
      const s = S.construct();
      const r: unknown[] = [];
      if (order === 'radius-first') {
        S.set_radius(s, radius);
        r.push([S.get_radius(s), S.get_height(s)]);
        S.set_height(s, height);
      } else {
        S.set_height(s, height);
        r.push([S.get_radius(s), S.get_height(s)]);
        S.set_radius(s, radius);
      }
      r.push([S.get_radius(s), S.get_height(s)]);
      return r;
    });
  }
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'CapsuleShape3D', compatModule: 'lib/godot-compat/capsule-shape-3d', cases: c.cases };
export default EVIDENCE;
