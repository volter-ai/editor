/**
 * Build a `THREE.BufferGeometry` from a baked Godot `ArrayMesh` spec.
 *
 * The port used to stamp `new BufferGeometry()` / `setAttribute` / `setIndex` / `addGroup` as a
 * per-module IIFE. Those are the same statements for every mesh; this is the one factory they
 * collapse into. The typed arrays arrive already concatenated (a multi-surface mesh is one
 * indexed geometry) and already winding-reversed for three (Godot 3 draws `GL_CW`; three keeps
 * OpenGL's counter-clockwise default).
 *
 * **Owns:** nothing with a lifetime. **Shares:** nothing. **Teardown:** the scene's own
 * `BufferGeometry` is collected with the module; this file holds nothing.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import { aabb, type GodotAabb } from './aabb';

/** One draw group on a multi-surface geometry — three's `addGroup` arguments. */
export interface ArrayMeshGeometryGroup {
  readonly start: number;
  readonly count: number;
  readonly material: number;
}

/**
 * A baked `ArrayMesh` as typed arrays. Numbers are Godot's own, already remapped for three:
 * indices winding-reversed, multi-surface attributes concatenated, `skinIndex` addressing the
 * parent `Skeleton`'s `bones/N` list directly.
 */
export interface ArrayMeshGeometrySpec {
  readonly positions: Float32Array;
  readonly normals?: Float32Array;
  readonly uvs?: Float32Array;
  /** Godot's UV2 channel. Three r180 names its second texture-coordinate attribute `uv1`. */
  readonly uv2s?: Float32Array;
  readonly tangents?: Float32Array;
  /** Four bone indices per vertex — three's `skinIndex`. */
  readonly bones?: Uint16Array;
  /** Four weights per vertex — three's `skinWeight`. */
  readonly weights?: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly groups?: readonly ArrayMeshGeometryGroup[];
}

/** Assemble one `BufferGeometry` from a baked spec. */
export function buildArrayMeshGeometry(spec: ArrayMeshGeometrySpec): BufferGeometry {
  const shape = new BufferGeometry();
  shape.setAttribute('position', new BufferAttribute(spec.positions, 3));
  if (spec.normals !== undefined) {
    shape.setAttribute('normal', new BufferAttribute(spec.normals, 3));
  }
  if (spec.uvs !== undefined) {
    shape.setAttribute('uv', new BufferAttribute(spec.uvs, 2));
  }
  if (spec.uv2s !== undefined) {
    shape.setAttribute('uv1', new BufferAttribute(spec.uv2s, 2));
  }
  if (spec.tangents !== undefined) {
    shape.setAttribute('tangent', new BufferAttribute(spec.tangents, 4));
  }
  if (spec.bones !== undefined) {
    shape.setAttribute('skinIndex', new BufferAttribute(spec.bones, 4));
  }
  if (spec.weights !== undefined) {
    shape.setAttribute('skinWeight', new BufferAttribute(spec.weights, 4));
  }
  shape.setIndex(new BufferAttribute(spec.indices, 1));
  if (spec.groups !== undefined) {
    for (const group of spec.groups) {
      shape.addGroup(group.start, group.count, group.material);
    }
  }
  return shape;
}

/** `Mesh.get_aabb()` — the mesh-local bounds of the retained native Three geometry. */
export function getGodotMeshAabb(mesh: BufferGeometry): GodotAabb {
  const positions = mesh.getAttribute('position');
  if (positions === undefined || positions.count === 0) return aabb();
  mesh.computeBoundingBox();
  const bounds = mesh.boundingBox;
  if (bounds === null || bounds.isEmpty()) return aabb();
  return aabb(bounds.min, {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  });
}
