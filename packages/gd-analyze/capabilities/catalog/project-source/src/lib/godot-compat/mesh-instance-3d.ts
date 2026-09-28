/**
 * @godot-class MeshInstance3D
 * @role BINDING
 *
 * Godot 4.7's `MeshInstance3D` (`scene/3d/mesh_instance_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh`: its geometry is the mesh
 * resource's stored surface (`primitive-mesh.ts`), or the surfaces a mesh class registers
 * (`mesh.ts`, an `ArrayMesh`'s), shared by every instance of that resource, drawn as one geometry
 * with a group per surface; each surface's material is its override, else the mesh's own, else the
 * Compatibility renderer's default material (`rasterizer_scene_gles3.cpp:4624`: albedo 0.6,
 * roughness 0.8, metallic 0.2).
 *
 * A scene's `<mesh>` reads its mesh resource back from its three primitive geometry the first time
 * it is asked for (`get_mesh`, `set_mesh`, the surface overrides), drawn with that geometry. The
 * material the scene draws it with stays its surface override, and the first node read back gives
 * the resource its own material (`PrimitiveMesh.material`). Until then, and for a mesh with no
 * primitive form, the scene's surface materials stand as its overrides.
 *
 * Known gaps, both in what the scene states rather than in this module:
 * - The scene's material for a surface is its override, else the mesh's own, collapsed into one
 *   three material. So an override slot Godot leaves empty reads back filled, and a mesh's own
 *   material is the first read-back node's, where nodes sharing the mesh drew different ones. A
 *   surface with neither reads back a default-grey StandardMaterial3D where Godot's is null; it
 *   draws the same. Telling them apart needs the plan to stamp which slot each surface's material
 *   came from.
 * - Nodes share a read-back resource only where they share a three geometry, and the scene
 *   declares one shared geometry only for a mesh several of its nodes draw; a mesh one node of a
 *   scene draws is that element's own geometry. So two instances of a scene (two `coin.tscn`s)
 *   read back two SphereMesh resources where Godot shares the scene's one sub-resource, and a
 *   setter on one changes only that instance.
 */

import { BufferAttribute, BufferGeometry, CylinderGeometry, type Material, type Mesh, PlaneGeometry, SphereGeometry } from 'three';
import { type BaseMaterial3D, godot_base_material_3d_initial, godot_base_material_3d_of, godot_base_material_3d_three } from './base-material-3d';
import { construct as color } from './color';
import type { ArrayMesh } from './array-mesh';
import { godot_cylinder_mesh_of } from './cylinder-mesh';
import { godot_mesh_surfaces, type GodotMeshSurface } from './mesh';
import { godot_plane_mesh_of } from './plane-mesh';
import { godot_primitive_mesh_geometry, type PrimitiveMesh } from './primitive-mesh';
import { godot_sphere_mesh_of } from './sphere-mesh';

/** A mesh resource a MeshInstance3D draws. */
type MeshResource = PrimitiveMesh | ArrayMesh;

interface MeshInstanceState {
  mesh: MeshResource | null;
  overrides: (BaseMaterial3D | null)[];
  /**
   * A scene's `<mesh>` whose mesh resource is not yet read back: its geometry is the scene's, its
   * surface materials the scene's materials.
   */
  unread?: BufferGeometry | undefined;
}

const STATE = new WeakMap<Mesh, MeshInstanceState>();
/** An ArrayMesh's surfaces joined into the one geometry its instances draw. */
const JOINED = new WeakMap<object, BufferGeometry>();

/** The surfaces' geometries as one, a group per surface in order (each surface's own attributes). */
function joined(surfaces: readonly GodotMeshSurface[]): BufferGeometry {
  if (surfaces.length === 1) return (surfaces[0] as GodotMeshSurface).geometry;
  const names = Object.keys((surfaces[0] as GodotMeshSurface).geometry.attributes);
  const geometry = new BufferGeometry();
  for (const name of names) {
    const parts = surfaces.map((surface) => surface.geometry.getAttribute(name));
    if (parts.some((part) => part === undefined)) throw new Error(`godot-compat: mesh surfaces differ in their ${name} array`);
    const size = (parts[0] as BufferAttribute).itemSize;
    geometry.setAttribute(name, new BufferAttribute(Float32Array.from(parts.flatMap((part) => [...(part as BufferAttribute).array])), size));
  }
  const index: number[] = [];
  let base = 0;
  surfaces.forEach((surface, group) => {
    const start = index.length;
    for (const value of surface.geometry.getIndex()?.array ?? []) index.push(value + base);
    geometry.addGroup(start, index.length - start, group);
    base += surface.geometry.getAttribute('position').count;
  });
  geometry.setIndex(index);
  return geometry;
}
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
    // A mesh the scene's JSX states reads its surface materials back as the node's overrides: one
    // Godot material per three material, so nodes sharing one share it.
    const materials = self.material === undefined ? [] : Array.isArray(self.material) ? self.material : [self.material];
    const scene = self.geometry !== undefined && Object.keys(self.geometry.attributes).length > 0;
    state = scene
      ? { mesh: null, overrides: materials.map((material) => godot_base_material_3d_of(material)), unread: self.geometry }
      : { mesh: null, overrides: [] };
    STATE.set(self, state);
  }
  return state;
}

/** The resource each scene geometry was read back as: nodes sharing a geometry share the resource, as nodes sharing a three material share its Godot material (`godot_base_material_3d_of`). */
const READ = new WeakMap<BufferGeometry, PrimitiveMesh>();

/**
 * The mesh resource a scene's three primitive geometry draws, read back from it (as a collision
 * shape reads its shape from its collider), or undefined for a geometry with no primitive form (an
 * ArrayMesh's `bufferGeometry`), whose resource is not read back. A resource read back for the
 * first time takes `material`, the Godot material of the first node's scene material, as its own.
 */
function sceneMesh(geometry: BufferGeometry, material: BaseMaterial3D | null): PrimitiveMesh | undefined {
  let mesh = READ.get(geometry);
  if (mesh !== undefined) return mesh;
  if (geometry instanceof PlaneGeometry) mesh = godot_plane_mesh_of(geometry);
  else if (geometry instanceof SphereGeometry) mesh = godot_sphere_mesh_of(geometry);
  else if (geometry instanceof CylinderGeometry) mesh = godot_cylinder_mesh_of(geometry);
  if (mesh === undefined) return undefined;
  mesh.material = material;
  READ.set(geometry, mesh);
  return mesh;
}

/**
 * A scene's `<mesh>` takes the resource its geometry draws, where one can be read back. The scene
 * drew one material per surface without saying whether it was the mesh's own or the node's
 * override, so the read-back never loses it: the node keeps it as its override, and the resource
 * takes the first reading node's material as its own. A script then reads the drawn material
 * through either accessor, and clearing the override draws the mesh's material, not the default.
 * Where Godot's override slot was empty, it reads back filled; that is closed when the plan
 * states which slot the material came from.
 */
function readBack(state: MeshInstanceState): void {
  if (state.unread === undefined) return;
  const drawn = state.overrides[0] ?? null;
  const mesh = sceneMesh(state.unread, drawn);
  if (mesh === undefined) return;
  state.mesh = mesh;
  state.unread = undefined;
  state.overrides = [drawn];
}

/** The geometry a mesh instance without a mesh draws: nothing, with its node and children left as they are. */
const NOTHING = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(0), 3));

function draw(self: Mesh, state: MeshInstanceState): void {
  if (state.unread !== undefined) {
    const current = Array.isArray(self.material) ? self.material : [self.material];
    const materials = state.overrides.map((material, surface) => (material === null ? (current[surface] as Material) : godot_base_material_3d_three(material)));
    self.material = materials.length === 1 ? (materials[0] as Material) : materials;
    return;
  }
  if (state.mesh === null) {
    // Godot's `set_base(RID())` stops only this instance's drawing: its visibility, and its
    // children's drawing, are untouched, so the node draws an empty geometry rather than hiding.
    self.geometry = NOTHING;
    return;
  }
  const surfaces = godot_mesh_surfaces(state.mesh);
  let geometry = surfaces === undefined ? godot_primitive_mesh_geometry(state.mesh as PrimitiveMesh) : JOINED.get(state.mesh);
  if (geometry === undefined) {
    geometry = joined(surfaces as readonly GodotMeshSurface[]);
    JOINED.set(state.mesh, geometry);
  }
  self.geometry = geometry;
  const own = surfaces === undefined ? [(state.mesh as PrimitiveMesh & { material?: BaseMaterial3D | null }).material ?? null] : surfaces.map((surface) => surface.material);
  const materials = own.map((material, surface) => {
    const chosen = state.overrides[surface] ?? material;
    return chosen === null ? defaultMaterial() : godot_base_material_3d_three(chosen);
  });
  self.material = materials.length === 1 ? (materials[0] as Material) : materials;
}

/**
 * A mesh instance with no mesh draws nothing (`set_base(RID())`); its surface overrides resize to
 * the mesh's surfaces (`_mesh_changed`), one for a primitive mesh.
 *
 * @godot MeshInstance3D.set_mesh
 * @source scene/3d/mesh_instance_3d.cpp:120
 */
export function set_mesh(self: Mesh, mesh: MeshResource | null): void {
  const state = stateOf(self);
  readBack(state);
  if (state.mesh === mesh && state.unread === undefined) return;
  state.mesh = mesh;
  state.unread = undefined;
  // `_mesh_changed` (`mesh_instance_3d.cpp:412`): one override per surface of the new mesh.
  const count = mesh === null ? 0 : (godot_mesh_surfaces(mesh)?.length ?? 1);
  state.overrides = Array.from({ length: count }, (_, surface) => state.overrides[surface] ?? null);
  draw(self, state);
}

/**
 * @godot MeshInstance3D.get_mesh
 * @source scene/3d/mesh_instance_3d.cpp:148
 */
export function get_mesh(self: Mesh): MeshResource | null {
  const state = stateOf(self);
  readBack(state);
  return state.mesh;
}

/**
 * A surface index outside the mesh's surfaces fails and leaves the overrides.
 *
 * @godot MeshInstance3D.set_surface_override_material
 * @source scene/3d/mesh_instance_3d.cpp:375
 */
export function set_surface_override_material(self: Mesh, surface: number, material: BaseMaterial3D | null): void {
  const state = stateOf(self);
  readBack(state);
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
  readBack(state);
  if (surface < 0 || surface >= state.overrides.length) return null;
  return state.overrides[surface] ?? null;
}

const SKELETON = new WeakMap<Mesh, string>();

/**
 * The skeleton path, which skins the mesh only when it names a Skeleton3D and the mesh's surfaces
 * carry bones (`_resolve_skeleton_path`, `mesh_instance_3d.cpp:184`); a scene's meshes are
 * unskinned, so it draws nothing. A scene states it in the mesh's `userData.skeleton_path`.
 *
 * @godot MeshInstance3D.set_skeleton_path
 * @source scene/3d/mesh_instance_3d.cpp:227
 */
export function set_skeleton_path(self: Mesh, path: string): void {
  SKELETON.set(self, String(path));
}

/**
 * @godot MeshInstance3D.get_skeleton_path
 * @source scene/3d/mesh_instance_3d.cpp:235
 */
export function get_skeleton_path(self: Mesh): string {
  const stated = (self.userData as Readonly<Record<string, unknown>>)['skeleton_path'];
  return SKELETON.get(self) ?? (typeof stated === 'string' ? stated : '');
}
