/**
 * @godot-class NavigationMesh
 * @role BINDING
 *
 * Godot 4.7's `NavigationMesh` (`scene/resources/navigation_mesh.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a baked mesh of convex polygons over its vertices,
 * drawn for three-pathfinding (`navigation-region-3d.ts`) as a three geometry of its polygons
 * fanned into triangles. Its bake settings only matter to baking, which the game does not do.
 */

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { construct as vector3, type Vector3 } from './vector3';

export interface NavigationMesh {
  /** The vertices' coordinates, three per vertex. */
  vertices: number[];
  polygons: number[][];
  /** The geometry of the current polygons, made once each time they change. */
  geometry: BufferGeometry | undefined;
}

/** The mesh as its data file states it (`scene-families.ts`, `godotNavigationMeshDataPath`). */
export interface GodotNavigationMeshData {
  readonly vertices: readonly number[];
  readonly polygons: readonly (readonly number[])[];
}

/**
 * An empty mesh.
 *
 * @godot NavigationMesh.NavigationMesh
 * @source scene/resources/navigation_mesh.cpp:306
 */
export function construct(): NavigationMesh {
  return { vertices: [], polygons: [], geometry: undefined };
}

/**
 * The mesh of a scene's baked data.
 *
 * @godot NavigationMesh (protocol)
 * @source scene/resources/navigation_mesh.cpp:317
 */
export function godot_navigation_mesh_new(data: GodotNavigationMeshData): NavigationMesh {
  return { vertices: [...data.vertices], polygons: data.polygons.map((polygon) => [...polygon]), geometry: undefined };
}

/**
 * The polygons as one three geometry, each fanned into triangles from its first vertex.
 *
 * @godot NavigationMesh (protocol)
 * @source scene/resources/navigation_mesh.cpp:348
 */
export function godot_navigation_mesh_geometry(self: NavigationMesh): BufferGeometry {
  if (self.geometry !== undefined) return self.geometry;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(self.vertices, 3));
  const index: number[] = [];
  for (const polygon of self.polygons) {
    for (let at = 1; at + 1 < polygon.length; at += 1) index.push(polygon[0] as number, polygon[at] as number, polygon[at + 1] as number);
  }
  geometry.setIndex(index);
  self.geometry = geometry;
  return geometry;
}

function changed(self: NavigationMesh): void {
  self.geometry?.dispose();
  self.geometry = undefined;
}

/**
 * @godot NavigationMesh.set_vertices
 * @source scene/resources/navigation_mesh.cpp:306
 */
export function set_vertices(self: NavigationMesh, vertices: Vector3[]): void {
  self.vertices = vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]);
  changed(self);
}

/**
 * @godot NavigationMesh.get_vertices
 * @source scene/resources/navigation_mesh.cpp:312
 */
export function get_vertices(self: NavigationMesh): Vector3[] {
  const out: Vector3[] = [];
  for (let at = 0; at + 2 < self.vertices.length; at += 3) out.push(vector3(self.vertices[at] as number, self.vertices[at + 1] as number, self.vertices[at + 2] as number));
  return out;
}

/**
 * @godot NavigationMesh.add_polygon
 * @source scene/resources/navigation_mesh.cpp:348
 */
export function add_polygon(self: NavigationMesh, polygon: number[]): void {
  self.polygons.push([...polygon]);
  changed(self);
}

/**
 * @godot NavigationMesh.get_polygon_count
 * @source scene/resources/navigation_mesh.cpp:354
 */
export function get_polygon_count(self: NavigationMesh): number {
  return self.polygons.length;
}

/**
 * @godot NavigationMesh.get_polygon
 * @source scene/resources/navigation_mesh.cpp:359
 */
export function get_polygon(self: NavigationMesh, idx: number): number[] {
  return [...(self.polygons[idx] ?? [])];
}

/**
 * @godot NavigationMesh.clear_polygons
 * @source scene/resources/navigation_mesh.cpp:365
 */
export function clear_polygons(self: NavigationMesh): void {
  self.polygons = [];
  changed(self);
}
