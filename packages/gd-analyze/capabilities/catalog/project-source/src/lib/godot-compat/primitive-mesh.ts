/**
 * @godot-class PrimitiveMesh
 * @role PROTOCOL
 *
 * Godot 4.7's `PrimitiveMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mesh resource whose one surface its class builds
 * (`_create_mesh_array`) and the rendering server stores. The arrays a mesh reports, and the
 * vertex data Godot draws, are the stored ones: positions and UVs as 32-bit floats, normals and
 * tangents octahedron-encoded into two 16-bit unorms each
 * (`RenderingServer::_surface_set_data`, `servers/rendering/rendering_server.cpp:621`) and decoded
 * on read (`:1511`). Each primitive class module describes its resource with its builder; three
 * draws the stored arrays as a `BufferGeometry`.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import type { Vector2 } from './vector2';
import { construct as vector3, normalized, type Vector3 } from './vector3';

const f32 = Math.fround;

/** `_create_mesh_array`'s output: the arrays a primitive class builds, before storage. */
export interface PrimitiveMeshArrays {
  readonly vertices: readonly Vector3[];
  readonly normals: readonly Vector3[];
  /** Four floats per vertex: the tangent and its binormal sign. */
  readonly tangents: readonly number[];
  readonly uvs: readonly Vector2[];
  readonly indices: readonly number[];
}

/** The fields every primitive mesh carries (`scene/resources/3d/primitive_meshes.h:48`). */
export interface PrimitiveMesh {
  flip_faces: boolean;
}

/** Godot's `Mesh.ArrayType` layout of `surface_get_arrays`: ARRAY_MAX entries, absent ones null. */
export type MeshArrays = readonly [
  Vector3[],
  Vector3[],
  number[],
  null,
  Vector2[],
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  number[],
];

const BUILDERS = new WeakMap<object, (self: never) => PrimitiveMeshArrays>();

/**
 * Registers a primitive mesh resource with the builder its class transcribes.
 *
 * @godot PrimitiveMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:51
 */
export function godot_primitive_mesh_describe<Mesh extends PrimitiveMesh>(
  mesh: Mesh,
  build: (self: Mesh) => PrimitiveMeshArrays,
): Mesh {
  BUILDERS.set(mesh, build as (self: never) => PrimitiveMeshArrays);
  return mesh;
}

/** `Vector3::octahedron_encode` (`core/math/vector3.cpp:90`), in `real_t`. */
function octahedronEncode(value: Vector3): [number, number] {
  const sum = f32(f32(Math.abs(value.x) + Math.abs(value.y)) + Math.abs(value.z));
  const n = vector3(f32(value.x / sum), f32(value.y / sum), f32(value.z / sum));
  let x: number;
  let y: number;
  if (n.z >= 0) {
    x = n.x;
    y = n.y;
  } else {
    x = f32(f32(1 - Math.abs(n.y)) * (n.x >= 0 ? 1 : -1));
    y = f32(f32(1 - Math.abs(n.x)) * (n.y >= 0 ? 1 : -1));
  }
  return [f32(f32(x * 0.5) + 0.5), f32(f32(y * 0.5) + 0.5)];
}

/** `Vector3::octahedron_decode` (`core/math/vector3.cpp:106`), in `real_t`. */
function octahedronDecode(ox: number, oy: number): Vector3 {
  const fx = f32(f32(ox * 2) - 1);
  const fy = f32(f32(oy * 2) - 1);
  let x = fx;
  let y = fy;
  const z = f32(f32(1 - Math.abs(fx)) - Math.abs(fy));
  const t = Math.min(Math.max(-z, 0), 1);
  x = f32(x >= 0 ? x - t : x + t);
  y = f32(y >= 0 ? y - t : y + t);
  return normalized(vector3(x, y, z));
}

/** One stored 16-bit unorm pair: `(uint16_t)CLAMP(v * 65535, 0, 65535)`. */
function unorm16(value: number): number {
  return Math.trunc(Math.min(Math.max(f32(value * 65535), 0), 65535));
}

/** A stored unorm read back: `(v & 0xFFFF) / 65535.0` into `real_t`. */
function fromUnorm16(value: number): number {
  return f32(value / 65535);
}

/** A normal through storage (`rendering_server.cpp:621`, `:1511`). */
function storedNormal(normal: Vector3): Vector3 {
  const [x, y] = octahedronEncode(normal);
  return octahedronDecode(fromUnorm16(unorm16(x)), fromUnorm16(unorm16(y)));
}

/**
 * A tangent through storage: `octahedron_tangent_encode` folds the binormal sign into y
 * (`core/math/vector3.cpp:115`), a stored (0, 65535) becomes (65535, 65535)
 * (`rendering_server.cpp:652`), and `octahedron_tangent_decode` (`vector3.cpp:124`) reads it back.
 */
function storedTangent(tangent: Vector3, sign: number): [number, number, number, number] {
  const bias = f32(1 / 32767);
  const encoded = octahedronEncode(tangent);
  let y = Math.max(encoded[1], bias);
  y = f32(f32(y * 0.5) + 0.5);
  y = sign >= 0 ? y : f32(1 - y);
  let ux = unorm16(encoded[0]);
  const uy = unorm16(y);
  if (ux === 0 && uy === 65535) ux = 65535;
  const cx = fromUnorm16(ux);
  let cy = f32(f32(fromUnorm16(uy) * 2) - 1);
  const decodedSign = cy >= 0 ? 1 : -1;
  cy = Math.abs(cy);
  const decoded = octahedronDecode(cx, cy);
  return [decoded.x, decoded.y, decoded.z, decodedSign];
}

/**
 * The stored surface: `_update` (`primitive_meshes.cpp:51`) flips faces when asked (normals
 * negated, each triangle's first two indices swapped) and hands the arrays to the rendering
 * server, which stores normals and tangents octahedron-encoded.
 */
function storedSurface(mesh: PrimitiveMesh): PrimitiveMeshArrays {
  const build = BUILDERS.get(mesh);
  if (build === undefined) throw new Error('godot-compat: PrimitiveMesh has no described builder.');
  const built = build(mesh as never);
  let normals = built.normals;
  let indices = built.indices;
  if (mesh.flip_faces && normals.length > 0 && indices.length > 0) {
    normals = normals.map((normal) => vector3(-normal.x, -normal.y, -normal.z));
    const swapped = [...indices];
    for (let i = 0; i + 2 < swapped.length; i += 3) {
      const first = swapped[i] as number;
      swapped[i] = swapped[i + 1] as number;
      swapped[i + 1] = first;
    }
    indices = swapped;
  }
  const tangents: number[] = [];
  for (let i = 0; i < built.vertices.length; i += 1) {
    const t = vector3(
      built.tangents[i * 4] as number,
      built.tangents[i * 4 + 1] as number,
      built.tangents[i * 4 + 2] as number,
    );
    tangents.push(...storedTangent(t, built.tangents[i * 4 + 3] as number));
  }
  return {
    vertices: built.vertices,
    normals: normals.map(storedNormal),
    tangents,
    uvs: built.uvs,
    indices,
  };
}

/**
 * The stored surface as `Mesh.surface_get_arrays(0)` reports it.
 *
 * @godot PrimitiveMesh.get_mesh_arrays
 * @source scene/resources/3d/primitive_meshes.cpp:287
 */
export function get_mesh_arrays(self: PrimitiveMesh): MeshArrays {
  const stored = storedSurface(self);
  return [
    [...stored.vertices],
    [...stored.normals],
    [...stored.tangents],
    null,
    [...stored.uvs],
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    [...stored.indices],
  ];
}

/**
 * @godot PrimitiveMesh.set_flip_faces
 * @source scene/resources/3d/primitive_meshes.cpp:304
 */
export function set_flip_faces(self: PrimitiveMesh, flip: boolean): void {
  self.flip_faces = flip;
}

/**
 * @godot PrimitiveMesh.get_flip_faces
 * @source scene/resources/3d/primitive_meshes.cpp:312
 */
export function get_flip_faces(self: PrimitiveMesh): boolean {
  return self.flip_faces;
}

/**
 * The stored surface as a three `BufferGeometry`. Godot's front faces wind clockwise on screen:
 * the Compatibility renderer draws right-side up with `glFrontFace(GL_CW)`
 * (`drivers/gles3/rasterizer_scene_gles3.cpp:2557`), and three's front faces wind
 * counter-clockwise, so each triangle is drawn with its last two indices exchanged; the vertex data
 * is Godot's stored data unchanged.
 *
 * @godot PrimitiveMesh (protocol)
 * @source servers/rendering/rendering_server.cpp:1511
 */
export function godot_primitive_mesh_geometry(self: PrimitiveMesh): BufferGeometry {
  const stored = storedSurface(self);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(stored.vertices.flatMap((v) => [v.x, v.y, v.z])), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array(stored.normals.flatMap((v) => [v.x, v.y, v.z])), 3),
  );
  geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(stored.tangents), 4));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(stored.uvs.flatMap((v) => [v.x, v.y])), 2));
  const index: number[] = [];
  for (let i = 0; i + 2 < stored.indices.length; i += 3) {
    index.push(stored.indices[i] as number, stored.indices[i + 2] as number, stored.indices[i + 1] as number);
  }
  geometry.setIndex(index);
  return geometry;
}
