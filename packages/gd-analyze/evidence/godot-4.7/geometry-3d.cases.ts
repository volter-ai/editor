import * as G from '../../capabilities/catalog/project-source/src/lib/godot-compat/geometry-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceCaseFile, GodotEvidenceSymbol } from '../../src/evidence/case';
import { gd } from './literals';

type Triple = readonly [number, number, number];

const gv = ([x, y, z]: Triple): string => `Vector3(${gd(x)}, ${gd(y)}, ${gd(z)})`;
const tv = ([x, y, z]: Triple): V.Vector3 => V.construct(x, y, z);
const member = (name: string): GodotEvidenceSymbol => ({ kind: 'singleton-member', owner: 'Geometry3D', member: name });

const SEGMENTS: readonly (readonly [string, Triple, Triple])[] = [
  ['down', [0, 5, 0], [0, -5, 0]],
  ['across-x', [-5, 0.25, 0.1], [5, 0.25, 0.1]],
  ['across-z', [0.3, -0.2, -5], [0.3, -0.2, 5]],
  ['diagonal', [-3, 4, -2], [2, -3, 1.5]],
  ['grazing', [-5, 0.49999, 0], [5, 0.49999, 0]],
  ['short', [0, 5, 0], [0, 4, 0]],
  ['inside', [0.1, 0.1, 0.1], [0.2, 3, 0.1]],
  ['degenerate', [1, 1, 1], [1, 1, 1]],
  ['decimals', [0.7, 3.3, -0.9], [-0.1, -2.9, 0.35]],
  ['off-axis', [2.5, 7, 1.2], [-1.9, -6, -0.4]],
];

const cases: GodotEvidenceCase[] = [];
for (const [name, from, to] of SEGMENTS) {
  for (const [centreName, centre, radius] of [
    ['origin', [0, 0, 0], 0.5],
    ['offset', [0.2, 0.5, -0.1], 1.25],
  ] as const) {
    cases.push({
      id: `segment_intersects_sphere-${name}-${centreName}`,
      symbol: member('segment_intersects_sphere'),
      gdscript: `Geometry3D.segment_intersects_sphere(${gv(from)}, ${gv(to)}, ${gv(centre)}, ${gd(radius)})`,
      target: () => G.segment_intersects_sphere(tv(from), tv(to), tv(centre), radius),
      comparator: 'exact',
    });
  }
  for (const [height, radius] of [
    [2, 0.5],
    [1, 1.5],
    [0.3, 0.7],
  ] as const) {
    cases.push({
      id: `segment_intersects_cylinder-${name}-${String(height)}-${String(radius)}`,
      symbol: member('segment_intersects_cylinder'),
      gdscript: `Geometry3D.segment_intersects_cylinder(${gv(from)}, ${gv(to)}, ${gd(height)}, ${gd(radius)})`,
      target: () => G.segment_intersects_cylinder(tv(from), tv(to), height, radius),
      comparator: 'exact',
    });
  }
  for (const [triName, a, b, c] of [
    ['floor', [-2, 0, -2], [2, 0, -2], [0, 0, 2]],
    ['tilted', [-1, -0.5, 0.3], [1.5, 0.4, -0.2], [0.1, 0.8, 1.7]],
    ['wall', [0.2, -3, -3], [0.2, 3, -3], [0.2, 0, 3]],
  ] as const) {
    cases.push({
      id: `segment_intersects_triangle-${name}-${triName}`,
      symbol: member('segment_intersects_triangle'),
      gdscript: `Geometry3D.segment_intersects_triangle(${gv(from)}, ${gv(to)}, ${gv(a)}, ${gv(b)}, ${gv(c)})`,
      target: () => G.segment_intersects_triangle(tv(from), tv(to), tv(a), tv(b), tv(c)),
      comparator: 'exact',
    });
  }
}

const GEOMETRY3D_EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'Geometry3D',
  compatModule: 'lib/godot-compat/geometry-3d',
  cases,
};

export default GEOMETRY3D_EVIDENCE;
