/** A lone Godot CSGCylinder evaluated from Godot's own `_build_brush` topology. */
import type { BufferGeometry } from 'three';
import {
  buildGodotCsgBrushGeometry,
  type GodotCsgBrushFace,
  type GodotCsgVec2,
  type GodotCsgVec3,
} from './csg-primitive-3d';

export interface GodotCsgCylinderGeometryOptions {
  readonly radius: number;
  readonly height: number;
  readonly sides: number;
  readonly cone: boolean;
  readonly smoothFaces: boolean;
}

/**
 * Construct the exact unindexed triangle soup authored by Godot 3/4 CSGCylinder `_build_brush`.
 * In particular, the cap UVs intentionally use the source's `(face_point.x, face_point.y)` map;
 * replacing this with Three's radial X/Z cap map changes existing CSG textures.
 */
export function createGodotCsgCylinderGeometry(
  options: GodotCsgCylinderGeometryOptions,
): BufferGeometry {
  const faces: GodotCsgBrushFace[] = [];
  const halfHeight = options.height * 0.5;
  const scaled = (point: GodotCsgVec3): GodotCsgVec3 => [
    point[0] * options.radius,
    point[1] * halfHeight,
    point[2] * options.radius,
  ];
  const capUv = (point: GodotCsgVec3): GodotCsgVec2 => [
    point[0] * 0.5 + 0.5,
    point[1] * 0.5 + 0.5,
  ];

  for (let i = 0; i < options.sides; i += 1) {
    const increment = i / options.sides;
    const nextIncrement = i === options.sides - 1 ? 0 : (i + 1) / options.sides;
    const angle = increment * Math.PI * 2;
    const nextAngle = nextIncrement * Math.PI * 2;
    const base: GodotCsgVec3 = [Math.cos(angle), 0, Math.sin(angle)];
    const nextBase: GodotCsgVec3 = [Math.cos(nextAngle), 0, Math.sin(nextAngle)];
    const points: readonly [GodotCsgVec3, GodotCsgVec3, GodotCsgVec3, GodotCsgVec3] = [
      [base[0], -1, base[2]],
      [nextBase[0], -1, nextBase[2]],
      [nextBase[0] * (options.cone ? 0 : 1), 1, nextBase[2] * (options.cone ? 0 : 1)],
      [base[0] * (options.cone ? 0 : 1), 1, base[2] * (options.cone ? 0 : 1)],
    ];
    const sideUvs: readonly [GodotCsgVec2, GodotCsgVec2, GodotCsgVec2, GodotCsgVec2] = [
      [increment, 0],
      [nextIncrement, 0],
      [nextIncrement, 1],
      [increment, 1],
    ];

    faces.push({
      vertices: [scaled(points[0]), scaled(points[1]), scaled(points[2])],
      uvs: [sideUvs[0], sideUvs[1], sideUvs[2]],
      smooth: options.smoothFaces,
    });
    if (!options.cone) {
      faces.push({
        vertices: [scaled(points[2]), scaled(points[3]), scaled(points[0])],
        uvs: [sideUvs[2], sideUvs[3], sideUvs[0]],
        smooth: options.smoothFaces,
      });
    }

    faces.push({
      vertices: [scaled(points[1]), scaled(points[0]), [0, -halfHeight, 0]],
      uvs: [capUv(points[1]), capUv(points[0]), [0.5, 0.5]],
      smooth: false,
    });
    if (!options.cone) {
      // This deliberately mirrors Godot's source: the top vertices use the bottom face points for
      // UVs as well, including their Y coordinate, rather than the top vertices' X/Z coordinates.
      faces.push({
        vertices: [scaled(points[3]), scaled(points[2]), [0, halfHeight, 0]],
        uvs: [capUv(points[1]), capUv(points[0]), [0.5, 0.5]],
        smooth: false,
      });
    }
  }

  return buildGodotCsgBrushGeometry(faces);
}
