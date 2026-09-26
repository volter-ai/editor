/** Mesh collision-shape factories over the retained native Three BufferGeometry Resource. */

import { BufferGeometry, Vector3 as ThreeVector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  createGodotConcavePolygonShape3D,
  createGodotConvexPolygonShape3D,
  type GodotConcavePolygonShape3D,
  type GodotConvexPolygonShape3D,
} from './shape-3d';
import { vec3, type Vector3 } from './variant-3d';

function requireGeometry(value: unknown, member: string): BufferGeometry {
  if (!(value instanceof BufferGeometry)) {
    throw new TypeError(`${member} requires a retained native THREE.BufferGeometry Mesh resource.`);
  }
  return value;
}

function geometryVertices(geometry: BufferGeometry, member: string): Vector3[] {
  const position = geometry.getAttribute('position');
  if (position === undefined) return [];
  if (position.itemSize !== 3) {
    throw new TypeError(`${member} requires a three-component native position attribute.`);
  }
  return Array.from({ length: position.count }, (_, index) => {
    const point = vec3(position.getX(index), position.getY(index), position.getZ(index));
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new TypeError(`${member} position ${index} must be finite.`);
    }
    return point;
  });
}

/** Godot Mesh faces are the indexed triangle stream, not every allocated position slot. */
function geometryTriangleFaces(geometry: BufferGeometry, member: string): Vector3[] {
  const vertices = geometryVertices(geometry, member);
  const index = geometry.getIndex();
  const indices = index === null
    ? Array.from({ length: vertices.length }, (_, cursor) => cursor)
    : Array.from({ length: index.count }, (_, cursor) => index.getX(cursor));
  if (indices.length === 0) return [];
  if (indices.length % 3 !== 0) {
    throw new Error(`${member} requires triangle-list native geometry.`);
  }
  return indices.map((vertex, cursor) => {
    if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= vertices.length) {
      throw new RangeError(`${member} index ${cursor} is outside the native position attribute.`);
    }
    const point = vertices[vertex]!;
    return vec3(point.x, point.y, point.z);
  });
}

function boolArgument(value: unknown, fallback: boolean, member: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool arguments.`);
  return value;
}

/**
 * Godot's default `clean=true` retains only vertices on the convex hull. Three's ConvexGeometry
 * owns that same native QuickHull operation; its triangle output is reduced back to the unique
 * source vertices that Godot stores in ConvexPolygonShape points. A failed clean falls back to the
 * unclean vertex list, matching Godot's source path. `simplify=true` is deliberately loud because
 * it requires Godot's configured convex-decomposition backend rather than an ordinary hull.
 */
export function createGodotMeshConvexShape(
  value: unknown,
  major: 3 | 4,
  cleanValue?: unknown,
  simplifyValue?: unknown,
): GodotConvexPolygonShape3D {
  const member = 'Mesh.create_convex_shape';
  const geometry = requireGeometry(value, member);
  const clean = boolArgument(cleanValue, true, member);
  const simplify = boolArgument(simplifyValue, false, member);
  if (simplify) {
    throw new Error(
      `${member}(clean, true) requires Godot's convex-decomposition simplifier, which the native ` +
        'Three/Rapier runtime does not expose.',
    );
  }
  const vertices = geometryTriangleFaces(geometry, member);
  if (!clean || vertices.length < 4) return createGodotConvexPolygonShape3D(vertices, major);

  let hull: ConvexGeometry | undefined;
  try {
    hull = new ConvexGeometry(vertices.map((point) => new ThreeVector3(point.x, point.y, point.z)));
    const position = hull.getAttribute('position');
    const unique = new Map<string, Vector3>();
    for (let index = 0; index < position.count; index += 1) {
      const point = vec3(position.getX(index), position.getY(index), position.getZ(index));
      unique.set(`${point.x}\u0000${point.y}\u0000${point.z}`, point);
    }
    if (unique.size >= 4) return createGodotConvexPolygonShape3D(unique.values(), major);
  } catch {
    // Godot logs a cleaning failure and falls back to the original vertex list too.
  } finally {
    hull?.dispose();
  }
  return createGodotConvexPolygonShape3D(vertices, major);
}

/** `Mesh.create_trimesh_shape()` from the exact indexed native triangle stream. */
export function createGodotMeshTrimeshShape(
  value: unknown,
  major: 3 | 4,
): GodotConcavePolygonShape3D | null {
  const member = 'Mesh.create_trimesh_shape';
  const geometry = requireGeometry(value, member);
  const faces = geometryTriangleFaces(geometry, member);
  if (faces.length === 0) return null;
  return createGodotConcavePolygonShape3D(faces, major);
}
