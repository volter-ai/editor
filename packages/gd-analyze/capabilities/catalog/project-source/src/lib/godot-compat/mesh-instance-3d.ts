/**
 * @godot-class MeshInstance3D
 * @role BINDING
 *
 * Godot 4.7's `MeshInstance3D` (`scene/3d/mesh_instance_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh`: its geometry is the mesh
 * resource's stored surface (`primitive-mesh.ts`), shared by every instance of that resource, and
 * its material the surface's override, else the mesh's own, else the Compatibility renderer's
 * default material (`rasterizer_scene_gles3.cpp:4624`: albedo 0.6, roughness 0.8, metallic 0.2).
 */

import type { BufferGeometry, Material, Mesh } from 'three';
import { type BaseMaterial3D, godot_base_material_3d_initial, godot_base_material_3d_three } from './base-material-3d';
import { construct as color } from './color';
import { godot_primitive_mesh_geometry, type PrimitiveMesh } from './primitive-mesh';

interface MeshInstanceState {
  mesh: PrimitiveMesh | null;
  overrides: (BaseMaterial3D | null)[];
}

const STATE = new WeakMap<Mesh, MeshInstanceState>();
const GEOMETRY = new WeakMap<PrimitiveMesh, BufferGeometry>();
let fallback: Material | undefined;

/** The Compatibility renderer's default material (`rasterizer_scene_gles3.cpp:4624`). */
function defaultMaterial(): Material {
  if (fallback === undefined) {
    const godot = godot_base_material_3d_initial();
    godot.albedo = color(0.6, 0.6, 0.6, 1);
    godot.roughness = Math.fround(0.8);
    godot.metallic = Math.fround(0.2);
    fallback = godot_base_material_3d_three(godot);
  }
  return fallback;
}

function stateOf(self: Mesh): MeshInstanceState {
  let state = STATE.get(self);
  if (state === undefined) {
    state = { mesh: null, overrides: [] };
    STATE.set(self, state);
  }
  return state;
}

function draw(self: Mesh, state: MeshInstanceState): void {
  if (state.mesh === null) {
    self.visible = false;
    return;
  }
  let geometry = GEOMETRY.get(state.mesh);
  if (geometry === undefined) {
    geometry = godot_primitive_mesh_geometry(state.mesh);
    GEOMETRY.set(state.mesh, geometry);
  }
  self.geometry = geometry;
  const own = (state.mesh as PrimitiveMesh & { material?: BaseMaterial3D | null }).material ?? null;
  const material = state.overrides[0] ?? own;
  self.material = material === null ? defaultMaterial() : godot_base_material_3d_three(material);
  self.visible = true;
}

/**
 * A mesh instance with no mesh draws nothing (`set_base(RID())`); its surface overrides resize to
 * the mesh's surfaces (`_mesh_changed`), one for a primitive mesh.
 *
 * @godot MeshInstance3D.set_mesh
 * @source scene/3d/mesh_instance_3d.cpp:120
 */
export function set_mesh(self: Mesh, mesh: PrimitiveMesh | null): void {
  const state = stateOf(self);
  if (state.mesh === mesh) return;
  state.mesh = mesh;
  state.overrides = mesh === null ? [] : [state.overrides[0] ?? null];
  draw(self, state);
}

/**
 * @godot MeshInstance3D.get_mesh
 * @source scene/3d/mesh_instance_3d.cpp:148
 */
export function get_mesh(self: Mesh): PrimitiveMesh | null {
  return stateOf(self).mesh;
}

/**
 * A surface index outside the mesh's surfaces fails and leaves the overrides.
 *
 * @godot MeshInstance3D.set_surface_override_material
 * @source scene/3d/mesh_instance_3d.cpp:375
 */
export function set_surface_override_material(self: Mesh, surface: number, material: BaseMaterial3D | null): void {
  const state = stateOf(self);
  if (surface < 0 || surface >= state.overrides.length) return;
  state.overrides[surface] = material;
  draw(self, state);
}

/**
 * @godot MeshInstance3D.get_surface_override_material
 * @source scene/3d/mesh_instance_3d.cpp:387
 */
export function get_surface_override_material(self: Mesh, surface: number): BaseMaterial3D | null {
  const state = stateOf(self);
  if (surface < 0 || surface >= state.overrides.length) return null;
  return state.overrides[surface] ?? null;
}
