/**
 * @godot-class MeshLibrary
 * @role BINDING
 *
 * Godot 4.7's `MeshLibrary` (`scene/resources/3d/mesh_library.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the palette a GridMap paints with, its items by id
 * in ascending order (an `RBMap`). An item's mesh is three's (the geometry and the surface
 * materials the scene declares for it); its shapes are Godot shape resources, each with its
 * placement in the item and the `@react-three/rapier` collider it is (the idiomatic scene's own
 * mapping of that shape). The editor's previews and the navigation meshes are not bound.
 */

import type { BufferGeometry, Material } from 'three';
import { construct as boxShape, set_size as setBoxSize } from './box-shape-3d';
import { construct as capsuleShape, set_height as setCapsuleHeight, set_radius as setCapsuleRadius } from './capsule-shape-3d';
import { construct as concaveShape, set_backface_collision_enabled, set_faces } from './concave-polygon-shape-3d';
import { construct as convexShape, set_points } from './convex-polygon-shape-3d';
import { construct as sphereShape, set_radius as setSphereRadius } from './sphere-shape-3d';
import { construct as basis } from './basis';
import { construct as transform3d, type Transform3D } from './transform-3d';
import { construct as vector3 } from './vector3';

const f32 = Math.fround;

/** An item's mesh as the scene declares it for three: its geometry and its surfaces' materials. */
export interface GodotMeshLibraryMesh {
  readonly geometry: BufferGeometry;
  readonly materials: readonly Material[];
}

/** A shape's collider, as `@react-three/rapier` states it: its component and arguments. */
export interface GodotMeshLibraryCollider {
  /** `cuboid`, `ball`, `capsule`, `convexHull` or `trimesh`: the `<…Collider>` component. */
  readonly component: 'cuboid' | 'ball' | 'capsule' | 'convexHull' | 'trimesh';
  readonly args: readonly unknown[];
}

interface Item {
  name: string;
  mesh: GodotMeshLibraryMesh | null;
  meshTransform: Transform3D;
  castShadow: number;
  shapes: { readonly shape: object; readonly transform: Transform3D; readonly collider: GodotMeshLibraryCollider }[];
}

export interface MeshLibrary {
  readonly items: Map<number, Item>;
  readonly listeners: Set<() => void>;
}

/**
 * A shape as the translation's data file writes it: its kind (`box`, `sphere`, `capsule`, `convex`,
 * `concave` for Box/Sphere/Capsule/ConvexPolygon/ConcavePolygonShape3D) and the properties it states.
 */
export interface GodotMeshLibraryShapeData {
  readonly kind: 'box' | 'sphere' | 'capsule' | 'convex' | 'concave';
  readonly size?: readonly [number, number, number];
  readonly radius?: number;
  readonly height?: number;
  /** Flat x, y, z per point (ConvexPolygon) or per face vertex (ConcavePolygon). */
  readonly points?: readonly number[];
  readonly faces?: readonly number[];
  readonly backfaceCollision?: boolean;
  /** The shape's placement in the item, Godot's `Transform3D(...)` arguments (rows, then origin). */
  readonly transform: readonly number[];
}

/** A MeshLibrary as the translation's data file writes it (`data/scene-families.ts`). */
export interface GodotMeshLibraryData {
  readonly items: readonly {
    readonly id: number;
    readonly name: string;
    readonly meshTransform: readonly number[];
    readonly castShadow: number;
    readonly shapes: readonly GodotMeshLibraryShapeData[];
  }[];
}

/** `Transform3D(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)`: its basis's rows, then the origin. */
function transformOf(values: readonly number[]): Transform3D {
  const v = values.map(f32);
  const at = (index: number) => v[index] as number;
  return transform3d(basis(vector3(at(0), at(3), at(6)), vector3(at(1), at(4), at(7)), vector3(at(2), at(5), at(8))), vector3(at(9), at(10), at(11)));
}

function vectors(flat: readonly number[]): ReturnType<typeof vector3>[] {
  return Array.from({ length: flat.length / 3 }, (_, index) => vector3(flat[index * 3] as number, flat[index * 3 + 1] as number, flat[index * 3 + 2] as number));
}

/** A shape resource of its data, and the collider the idiomatic scene writes for it. */
function shapeOf(data: GodotMeshLibraryShapeData): { readonly shape: object; readonly collider: GodotMeshLibraryCollider } {
  switch (data.kind) {
    case 'box': {
      const shape = boxShape();
      const size = data.size ?? [1, 1, 1];
      setBoxSize(shape, vector3(...size));
      return { shape, collider: { component: 'cuboid', args: size.map((value) => f32(value) / 2) } };
    }
    case 'sphere': {
      const shape = sphereShape();
      const radius = data.radius ?? 0.5;
      setSphereRadius(shape, radius);
      return { shape, collider: { component: 'ball', args: [radius] } };
    }
    case 'capsule': {
      const shape = capsuleShape();
      const radius = data.radius ?? 0.5;
      const height = data.height ?? 2;
      setCapsuleRadius(shape, radius);
      setCapsuleHeight(shape, height);
      // Godot's height spans the caps (`capsule_shape_3d.cpp:100`); Rapier's half height does not.
      return { shape, collider: { component: 'capsule', args: [height / 2 - radius, radius] } };
    }
    case 'convex': {
      const shape = convexShape();
      set_points(shape, vectors(data.points ?? []));
      return { shape, collider: { component: 'convexHull', args: [Float32Array.from(data.points ?? [])] } };
    }
    case 'concave': {
      const shape = concaveShape();
      const faces = data.faces ?? [];
      set_faces(shape, vectors(faces));
      if (data.backfaceCollision !== undefined) set_backface_collision_enabled(shape, data.backfaceCollision);
      return {
        shape,
        collider: { component: 'trimesh', args: [Float32Array.from(faces), Uint32Array.from({ length: faces.length / 3 }, (_, index) => index)] },
      };
    }
  }
}

function emitChanged(self: MeshLibrary): void {
  for (const listener of [...self.listeners]) listener();
}

function newItem(): Item {
  return { name: '', mesh: null, meshTransform: transform3d(), castShadow: 1, shapes: [] };
}

/**
 * A MeshLibrary: empty (`MeshLibrary.new()`), or the one a scene loads, from the translation's
 * data file (its items' names, mesh placements, shadow settings and shapes) and the meshes the
 * scene declares for its items, by id.
 *
 * @godot MeshLibrary (protocol)
 * @source scene/resources/3d/mesh_library.cpp:41
 */
export function godot_mesh_library_new(data?: GodotMeshLibraryData, meshes: Readonly<Record<number, GodotMeshLibraryMesh>> = {}): MeshLibrary {
  const self: MeshLibrary = { items: new Map(), listeners: new Set() };
  for (const entry of [...(data?.items ?? [])].sort((left, right) => left.id - right.id)) {
    self.items.set(entry.id, {
      name: entry.name,
      mesh: meshes[entry.id] ?? null,
      meshTransform: transformOf(entry.meshTransform),
      castShadow: entry.castShadow,
      shapes: entry.shapes.map((shape) => ({ ...shapeOf(shape), transform: transformOf(shape.transform) })),
    });
  }
  return self;
}

/**
 * Listens for the library's `changed` signal (its GridMaps redraw).
 *
 * @godot MeshLibrary (protocol)
 * @source scene/resources/3d/mesh_library.cpp:162
 */
export function godot_mesh_library_connect_changed(self: MeshLibrary, listener: () => void): () => void {
  self.listeners.add(listener);
  return () => self.listeners.delete(listener);
}

/**
 * An item's three mesh, placement, shadow setting and shapes, for its GridMaps; undefined when the
 * library has no such item.
 *
 * @godot MeshLibrary (protocol)
 * @source scene/resources/3d/mesh_library.cpp:232
 */
export function godot_mesh_library_item(self: MeshLibrary, id: number): Readonly<Item> | undefined {
  return self.items.get(id);
}

/** Keeps the map sorted by id, as Godot's `RBMap` is. */
function sortItems(self: MeshLibrary): void {
  const sorted = [...self.items].sort(([left], [right]) => left - right);
  self.items.clear();
  for (const [id, item] of sorted) self.items.set(id, item);
}

/**
 * A negative or taken id fails.
 *
 * @godot MeshLibrary.create_item
 * @source scene/resources/3d/mesh_library.cpp:162
 */
export function create_item(self: MeshLibrary, id: number): void {
  if (id < 0 || self.items.has(id)) return;
  self.items.set(id, newItem());
  sortItems(self);
  emitChanged(self);
}

/**
 * @godot MeshLibrary.set_item_name
 * @source scene/resources/3d/mesh_library.cpp:170
 */
export function set_item_name(self: MeshLibrary, id: number, name: string): void {
  const item = self.items.get(id);
  if (item === undefined) return;
  item.name = name;
  emitChanged(self);
}

/**
 * A missing item's is "".
 *
 * @godot MeshLibrary.get_item_name
 * @source scene/resources/3d/mesh_library.cpp:227
 */
export function get_item_name(self: MeshLibrary, id: number): string {
  return self.items.get(id)?.name ?? '';
}

/**
 * @godot MeshLibrary.set_item_mesh_transform
 * @source scene/resources/3d/mesh_library.cpp:182
 */
export function set_item_mesh_transform(self: MeshLibrary, id: number, transform: Transform3D): void {
  const item = self.items.get(id);
  if (item === undefined) return;
  item.meshTransform = transform;
  emitChanged(self);
}

/**
 * A missing item's is the identity.
 *
 * @godot MeshLibrary.get_item_mesh_transform
 * @source scene/resources/3d/mesh_library.cpp:237
 */
export function get_item_mesh_transform(self: MeshLibrary, id: number): Transform3D {
  return self.items.get(id)?.meshTransform ?? transform3d();
}

/**
 * @godot MeshLibrary.set_item_mesh_cast_shadow
 * @source scene/resources/3d/mesh_library.cpp:188
 */
export function set_item_mesh_cast_shadow(self: MeshLibrary, id: number, setting: number): void {
  const item = self.items.get(id);
  if (item === undefined) return;
  item.castShadow = setting;
  emitChanged(self);
}

/**
 * A missing item's is `SHADOW_CASTING_SETTING_ON`.
 *
 * @godot MeshLibrary.get_item_mesh_cast_shadow
 * @source scene/resources/3d/mesh_library.cpp:242
 */
export function get_item_mesh_cast_shadow(self: MeshLibrary, id: number): number {
  return self.items.get(id)?.castShadow ?? 1;
}

/**
 * @godot MeshLibrary.remove_item
 * @source scene/resources/3d/mesh_library.cpp:278
 */
export function remove_item(self: MeshLibrary, id: number): void {
  if (!self.items.delete(id)) return;
  emitChanged(self);
}

/**
 * @godot MeshLibrary.clear
 * @source scene/resources/3d/mesh_library.cpp:285
 */
export function clear(self: MeshLibrary): void {
  self.items.clear();
  emitChanged(self);
}

/**
 * The ids in ascending order.
 *
 * @godot MeshLibrary.get_item_list
 * @source scene/resources/3d/mesh_library.cpp:291
 */
export function get_item_list(self: MeshLibrary): number[] {
  return [...self.items.keys()];
}

/**
 * The first id (ascending) whose name is `name`, or -1.
 *
 * @godot MeshLibrary.find_item_by_name
 * @source scene/resources/3d/mesh_library.cpp:302
 */
export function find_item_by_name(self: MeshLibrary, name: string): number {
  for (const [id, item] of self.items) if (item.name === name) return id;
  return -1;
}

/**
 * The largest id plus one, or 0 for an empty library.
 *
 * @godot MeshLibrary.get_last_unused_item_id
 * @source scene/resources/3d/mesh_library.cpp:311
 */
export function get_last_unused_item_id(self: MeshLibrary): number {
  const ids = [...self.items.keys()];
  return ids.length === 0 ? 0 : (ids[ids.length - 1] as number) + 1;
}
