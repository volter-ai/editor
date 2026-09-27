/**
 * @godot-class ArrayMesh
 * @role BINDING
 *
 * Godot 4.7's `ArrayMesh` (`scene/resources/mesh.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto three `BufferGeometry`: each surface's
 * arrays are the ones `RenderingServer::_get_array_from_surface` decodes from the resource's
 * `_surfaces` (the translation decodes them with the reader's transcription,
 * `read/godot4-surfaces.ts`, and hands them over as data), its geometry those arrays drawn with
 * each triangle's last two indices exchanged (Godot's front faces wind clockwise,
 * `glFrontFace(GL_CW)`), and its material the surface's. Triangle surfaces only; blend shapes are
 * not bound.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import type { BaseMaterial3D } from './base-material-3d';
import { construct as color } from './color';
import { godot_mesh_register } from './mesh';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

/** One surface as the translation hands it over: Godot's arrays, flat, and its material. */
export interface GodotArrayMeshSurface {
  readonly primitive: number;
  readonly vertex: readonly number[];
  readonly normal?: readonly number[];
  readonly tangent?: readonly number[];
  readonly color?: readonly number[];
  readonly tex_uv?: readonly number[];
  readonly tex_uv2?: readonly number[];
  readonly index?: readonly number[];
  readonly material?: BaseMaterial3D | null;
}

export interface ArrayMesh {
  readonly resource_name: string;
  readonly surfaces: readonly GodotArrayMeshSurface[];
}

const GEOMETRY = new WeakMap<GodotArrayMeshSurface, BufferGeometry>();

/** `PrimitiveType::PRIMITIVE_TRIANGLES` (`rendering_server_enums.h:208`). */
const PRIMITIVE_TRIANGLES = 3;

function geometryOf(surface: GodotArrayMeshSurface): BufferGeometry {
  let geometry = GEOMETRY.get(surface);
  if (geometry !== undefined) return geometry;
  geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(surface.vertex), 3));
  if (surface.normal !== undefined) geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(surface.normal), 3));
  if (surface.tangent !== undefined) geometry.setAttribute('tangent', new BufferAttribute(Float32Array.from(surface.tangent), 4));
  if (surface.color !== undefined) geometry.setAttribute('color', new BufferAttribute(Float32Array.from(surface.color), 4));
  if (surface.tex_uv !== undefined) geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(surface.tex_uv), 2));
  if (surface.tex_uv2 !== undefined) geometry.setAttribute('uv1', new BufferAttribute(Float32Array.from(surface.tex_uv2), 2));
  const indices = surface.index ?? Array.from({ length: surface.vertex.length / 3 }, (_, i) => i);
  const wound: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) wound.push(indices[i] as number, indices[i + 2] as number, indices[i + 1] as number);
  geometry.setIndex(wound);
  GEOMETRY.set(surface, geometry);
  return geometry;
}

/**
 * The surface's arrays in `Mesh::ArrayType` order (`ARRAY_MAX` 13), as `surface_get_arrays`
 * returns them (`mesh.cpp:1842`): vertices, normals, tangents, colours, UVs, UV2s, four custom
 * channels, bones, weights, indices; an absent array is null.
 */
function arraysOf(found: GodotArrayMeshSurface): readonly unknown[] {
  const v3 = (flat: readonly number[] | undefined): Vector3[] | null =>
    flat === undefined ? null : Array.from({ length: flat.length / 3 }, (_, i) => vector3(flat[i * 3] as number, flat[i * 3 + 1] as number, flat[i * 3 + 2] as number));
  const v2 = (flat: readonly number[] | undefined): Vector2[] | null =>
    flat === undefined ? null : Array.from({ length: flat.length / 2 }, (_, i) => vector2(flat[i * 2] as number, flat[i * 2 + 1] as number));
  return [
    v3(found.vertex),
    v3(found.normal),
    found.tangent === undefined ? null : [...found.tangent],
    found.color === undefined ? null : Array.from({ length: found.color.length / 4 }, (_, i) => color(...(found.color as readonly number[]).slice(i * 4, i * 4 + 4) as [number, number, number, number])),
    v2(found.tex_uv),
    v2(found.tex_uv2),
    null,
    null,
    null,
    null,
    null,
    null,
    found.index === undefined ? null : [...found.index],
  ];
}

/**
 * The resource the translation made from a `.res`/`.tres` `ArrayMesh`: its surfaces set as
 * `ArrayMesh::_set_surfaces` sets them (`mesh.cpp:1587`), its `resource_name` kept.
 *
 * @godot ArrayMesh (protocol)
 * @source scene/resources/mesh.cpp:1587
 */
export function godot_array_mesh_new(data: { readonly resource_name?: string; readonly surfaces: readonly GodotArrayMeshSurface[] }): ArrayMesh {
  for (const surface of data.surfaces) {
    if (surface.primitive !== PRIMITIVE_TRIANGLES) throw new Error(`godot-compat: an ArrayMesh surface of primitive ${String(surface.primitive)} is not bound`);
  }
  const mesh: ArrayMesh = { resource_name: data.resource_name ?? '', surfaces: data.surfaces };
  godot_mesh_register(mesh, () => mesh.surfaces.map((surface) => ({ geometry: geometryOf(surface), material: surface.material ?? null, arrays: () => arraysOf(surface) })));
  return mesh;
}

/** An ArrayMesh's data file as the translation writes it (three's conventions, `scene-families.ts`). */
export interface GodotArrayMeshData {
  readonly position: readonly number[];
  readonly normal?: readonly number[];
  readonly tangent?: readonly number[];
  readonly color?: readonly number[];
  readonly uv?: readonly number[];
  readonly uv1?: readonly number[];
  readonly index: readonly number[];
  readonly groups: readonly { readonly start: number; readonly count: number; readonly materialIndex: number }[];
}

/**
 * The geometry a scene shares between the nodes that draw one ArrayMesh: three's geometry of its
 * data file, a group per surface.
 *
 * @godot ArrayMesh (protocol)
 * @source scene/resources/mesh.cpp:1842
 */
export function godot_array_mesh_geometry(data: GodotArrayMeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  const sizes = [['position', 3], ['normal', 3], ['tangent', 4], ['color', 4], ['uv', 2], ['uv1', 2]] as const;
  for (const [name, size] of sizes) {
    const values = data[name];
    if (values !== undefined) geometry.setAttribute(name, new BufferAttribute(Float32Array.from(values), size));
  }
  geometry.setIndex(new BufferAttribute(Uint32Array.from(data.index), 1));
  for (const group of data.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  return geometry;
}
