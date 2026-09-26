/** Shared native BufferGeometry expansion for Godot CSG primitive brush faces. */
import { BufferGeometry, Float32BufferAttribute } from 'three';

export type GodotCsgVec2 = readonly [number, number];
export type GodotCsgVec3 = readonly [number, number, number];

export interface GodotCsgBrushFace {
  readonly vertices: readonly [GodotCsgVec3, GodotCsgVec3, GodotCsgVec3];
  readonly uvs: readonly [GodotCsgVec2, GodotCsgVec2, GodotCsgVec2];
  readonly smooth: boolean;
}

const add = (a: GodotCsgVec3, b: GodotCsgVec3): GodotCsgVec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
const subtract = (a: GodotCsgVec3, b: GodotCsgVec3): GodotCsgVec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const cross = (a: GodotCsgVec3, b: GodotCsgVec3): GodotCsgVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalized = (value: GodotCsgVec3): GodotCsgVec3 => {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length === 0 ? [0, 0, 0] : [value[0] / length, value[1] / length, value[2] / length];
};
const faceNormal = (face: GodotCsgBrushFace): GodotCsgVec3 =>
  normalized(
    cross(
      subtract(face.vertices[2], face.vertices[0]),
      subtract(face.vertices[1], face.vertices[0]),
    ),
  );
const vertexKey = (value: GodotCsgVec3): string => `${value[0]},${value[1]},${value[2]}`;

/** Expand Godot's clockwise, unindexed CSG brush faces into a native Three BufferGeometry. */
export function buildGodotCsgBrushGeometry(
  faces: readonly GodotCsgBrushFace[],
): BufferGeometry {
  // `CSGShape::update_shape` accumulates plane normals for every smooth face at each exact point.
  const smoothNormalSums = new Map<string, GodotCsgVec3>();
  for (const face of faces) {
    if (!face.smooth) continue;
    const normal = faceNormal(face);
    for (const vertex of face.vertices) {
      const key = vertexKey(vertex);
      smoothNormalSums.set(key, add(smoothNormalSums.get(key) ?? [0, 0, 0], normal));
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  // Godot's brush faces are clockwise; Three's front-face convention is counter-clockwise.
  const threeOrder = [0, 2, 1] as const;
  for (const face of faces) {
    const flatNormal = faceNormal(face);
    for (const index of threeOrder) {
      const vertex = face.vertices[index];
      const uv = face.uvs[index];
      const normal = face.smooth
        ? normalized(smoothNormalSums.get(vertexKey(vertex)) ?? flatNormal)
        : flatNormal;
      positions.push(vertex[0], vertex[1], vertex[2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(uv[0], uv[1]);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
