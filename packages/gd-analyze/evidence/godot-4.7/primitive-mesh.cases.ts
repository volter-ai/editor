import * as Cy from '../../capabilities/catalog/project-source/src/lib/godot-compat/cylinder-mesh';
import * as Pl from '../../capabilities/catalog/project-source/src/lib/godot-compat/plane-mesh';
import * as M from '../../capabilities/catalog/project-source/src/lib/godot-compat/primitive-mesh';
import * as Q from '../../capabilities/catalog/project-source/src/lib/godot-compat/quad-mesh';
import * as Sp from '../../capabilities/catalog/project-source/src/lib/godot-compat/sphere-mesh';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { gd } from './literals';
import { resourceCases } from './resource-cases';

/**
 * `PrimitiveMesh.get_mesh_arrays()` (the stored surface, as `surface_get_arrays(0)` reports it) for
 * each primitive class and its parameters, with and without flipped faces.
 */

const c = resourceCases('PrimitiveMesh');

interface MeshCase {
  readonly id: string;
  /** GDScript lines that build `m`. */
  readonly gdscript: readonly string[];
  readonly target: () => M.PrimitiveMesh;
}

const MESHES: readonly MeshCase[] = [
  { id: 'plane-default', gdscript: ['var m := PlaneMesh.new()'], target: () => Pl.construct() },
  {
    id: 'plane-subdivided',
    gdscript: [
      'var m := PlaneMesh.new()',
      `m.size = Vector2(${gd(3)}, ${gd(1.5)})`,
      'm.subdivide_width = 2',
      'm.subdivide_depth = 3',
      `m.center_offset = Vector3(${gd(0.1)}, ${gd(0.2)}, ${gd(0.3)})`,
    ],
    target: () => {
      const m = Pl.construct();
      Pl.set_size(m, V2.construct(3, 1.5));
      Pl.set_subdivide_width(m, 2);
      Pl.set_subdivide_depth(m, 3);
      Pl.set_center_offset(m, V3.construct(0.1, 0.2, 0.3));
      return m;
    },
  },
  ...[0, 2].map((orientation) => ({
    id: `plane-orientation-${String(orientation)}`,
    gdscript: ['var m := PlaneMesh.new()', `m.orientation = ${String(orientation)}`, `m.size = Vector2(${gd(0.7)}, ${gd(2.2)})`],
    target: () => {
      const m = Pl.construct();
      Pl.set_orientation(m, orientation);
      Pl.set_size(m, V2.construct(0.7, 2.2));
      return m;
    },
  })),
  { id: 'quad-default', gdscript: ['var m := QuadMesh.new()'], target: () => Q.construct() },
  {
    id: 'quad-sized',
    gdscript: ['var m := QuadMesh.new()', `m.size = Vector2(${gd(0.35)}, ${gd(0.35)})`],
    target: () => {
      const m = Q.construct();
      Pl.set_size(m, V2.construct(0.35, 0.35));
      return m;
    },
  },
  { id: 'sphere-default', gdscript: ['var m := SphereMesh.new()'], target: () => Sp.construct() },
  {
    id: 'sphere-small',
    gdscript: [
      'var m := SphereMesh.new()',
      'm.radial_segments = 8',
      'm.rings = 4',
      `m.radius = ${gd(0.3)}`,
      `m.height = ${gd(1.2)}`,
    ],
    target: () => {
      const m = Sp.construct();
      Sp.set_radial_segments(m, 8);
      Sp.set_rings(m, 4);
      Sp.set_radius(m, 0.3);
      Sp.set_height(m, 1.2);
      return m;
    },
  },
  {
    id: 'sphere-hemisphere',
    gdscript: ['var m := SphereMesh.new()', 'm.radial_segments = 12', 'm.rings = 6', 'm.is_hemisphere = true'],
    target: () => {
      const m = Sp.construct();
      Sp.set_radial_segments(m, 12);
      Sp.set_rings(m, 6);
      Sp.set_is_hemisphere(m, true);
      return m;
    },
  },
  { id: 'cylinder-default', gdscript: ['var m := CylinderMesh.new()'], target: () => Cy.construct() },
  {
    id: 'cylinder-cone',
    gdscript: [
      'var m := CylinderMesh.new()',
      `m.top_radius = ${gd(0)}`,
      `m.bottom_radius = ${gd(1.25)}`,
      `m.height = ${gd(0.4)}`,
      'm.radial_segments = 12',
      'm.rings = 2',
    ],
    target: () => {
      const m = Cy.construct();
      Cy.set_top_radius(m, 0);
      Cy.set_bottom_radius(m, 1.25);
      Cy.set_height(m, 0.4);
      Cy.set_radial_segments(m, 12);
      Cy.set_rings(m, 2);
      return m;
    },
  },
  {
    id: 'cylinder-open',
    gdscript: ['var m := CylinderMesh.new()', 'm.cap_top = false', 'm.cap_bottom = false', 'm.radial_segments = 7', 'm.rings = 0'],
    target: () => {
      const m = Cy.construct();
      Cy.set_cap_top(m, false);
      Cy.set_cap_bottom(m, false);
      Cy.set_radial_segments(m, 7);
      Cy.set_rings(m, 0);
      return m;
    },
  },
];

for (const mesh of MESHES) {
  c.add(`get_mesh_arrays-${mesh.id}`, 'get_mesh_arrays', [...mesh.gdscript, 'return m.get_mesh_arrays()'], () =>
    M.get_mesh_arrays(mesh.target()),
  );
  c.add(
    `get_mesh_arrays-${mesh.id}-flipped`,
    'get_mesh_arrays',
    [...mesh.gdscript, 'm.flip_faces = true', 'return m.get_mesh_arrays()'],
    () => {
      const m = mesh.target();
      M.set_flip_faces(m, true);
      return M.get_mesh_arrays(m);
    },
  );
}
c.add('set_flip_faces', 'set_flip_faces', ['var m := PlaneMesh.new()', 'm.set_flip_faces(true)', 'return m.get_flip_faces()'], () => {
  const m = Pl.construct();
  M.set_flip_faces(m, true);
  return M.get_flip_faces(m);
});
c.add('get_flip_faces-default', 'get_flip_faces', ['return SphereMesh.new().get_flip_faces()'], () =>
  M.get_flip_faces(Sp.construct()),
);

const EVIDENCE: GodotEvidenceCaseFile = {
  godotClass: 'PrimitiveMesh',
  compatModule: 'lib/godot-compat/primitive-mesh',
  cases: c.cases,
};
export default EVIDENCE;
