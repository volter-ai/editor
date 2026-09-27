/**
 * @godot-class Mesh
 * @role PROTOCOL
 *
 * Godot 4.7's `Mesh` (`scene/resources/mesh.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the surfaces a mesh resource draws: each mesh
 * class registers, for its resources, the three geometry and the material of each surface, which a
 * `MeshInstance3D` draws (a primitive mesh's one surface is `primitive-mesh.ts`'s own).
 */

import type { BufferGeometry } from 'three';
import type { BaseMaterial3D } from './base-material-3d';

export interface GodotMeshSurface {
  readonly geometry: BufferGeometry;
  readonly material: BaseMaterial3D | null;
  /** The surface's arrays as `surface_get_arrays` returns them. */
  readonly arrays: () => readonly unknown[];
}

const SURFACES = new WeakMap<object, () => readonly GodotMeshSurface[]>();

/**
 * Registers a mesh resource's surfaces.
 *
 * @godot Mesh (protocol)
 * @source scene/resources/mesh.cpp:1857
 */
export function godot_mesh_register(mesh: object, surfaces: () => readonly GodotMeshSurface[]): void {
  SURFACES.set(mesh, surfaces);
}

/**
 * The surfaces a registered mesh resource draws, or undefined for one that registered none.
 *
 * @godot Mesh (protocol)
 * @source scene/resources/mesh.cpp:1857
 */
export function godot_mesh_surfaces(mesh: object): readonly GodotMeshSurface[] | undefined {
  return SURFACES.get(mesh)?.();
}

function surfacesOf(self: object, member: string): readonly GodotMeshSurface[] {
  const surfaces = godot_mesh_surfaces(self);
  if (surfaces === undefined) throw new Error(`godot-compat: Mesh.${member} on a mesh whose class registers no surfaces`);
  return surfaces;
}

/**
 * @godot Mesh.get_surface_count
 * @source scene/resources/mesh.cpp:1857
 */
export function get_surface_count(self: object): number {
  return surfacesOf(self, 'get_surface_count').length;
}

/**
 * The surface's arrays; an index outside the surfaces gives an empty array.
 *
 * @godot Mesh.surface_get_arrays
 * @source scene/resources/mesh.cpp:1842
 */
export function surface_get_arrays(self: object, surface: number): readonly unknown[] {
  return surfacesOf(self, 'surface_get_arrays')[surface]?.arrays() ?? [];
}

/**
 * @godot Mesh.surface_get_material
 * @source scene/resources/mesh.cpp:2004
 */
export function surface_get_material(self: object, surface: number): BaseMaterial3D | null {
  return surfacesOf(self, 'surface_get_material')[surface]?.material ?? null;
}
