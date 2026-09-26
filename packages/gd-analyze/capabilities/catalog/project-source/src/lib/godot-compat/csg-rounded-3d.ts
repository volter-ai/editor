/** Godot CSGSphere/CSGTorus `_build_brush` ports over the shared native brush expander. */
import type { BufferGeometry } from 'three';
import {
  buildGodotCsgBrushGeometry,
  type GodotCsgBrushFace,
  type GodotCsgVec2,
  type GodotCsgVec3,
} from './csg-primitive-3d';

export interface GodotCsgSphereGeometryOptions {
  readonly major: 3 | 4;
  readonly radius: number;
  readonly radialSegments: number;
  readonly rings: number;
  readonly smoothFaces: boolean;
}

export interface GodotCsgTorusGeometryOptions {
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly sides: number;
  readonly ringSides: number;
  readonly smoothFaces: boolean;
}

export function createGodotCsgSphereGeometry(
  options: GodotCsgSphereGeometryOptions,
): BufferGeometry {
  const faces: GodotCsgBrushFace[] = [];
  const latitudeStep = -Math.PI / options.rings;
  const longitudeStep = (Math.PI * 2) / options.radialSegments;

  for (let i = 0; i < options.rings; i += 1) {
    // Godot 4 pins the two poles to exact zero/one vectors. Godot 3 evaluates both through trig;
    // retaining that distinction preserves the pinned source's actual brush positions.
    const latitude0 = latitudeStep * i + Math.PI / 2;
    const latitude1 = latitudeStep * (i + 1) + Math.PI / 2;
    const cos0 = options.major === 4 && i === 0 ? 0 : Math.cos(latitude0);
    const sin0 = options.major === 4 && i === 0 ? 1 : Math.sin(latitude0);
    const cos1 = options.major === 4 && i === options.rings - 1 ? 0 : Math.cos(latitude1);
    const sin1 = options.major === 4 && i === options.rings - 1 ? -1 : Math.sin(latitude1);
    const v0 = i / options.rings;
    const v1 = (i + 1) / options.rings;

    for (let j = 0; j < options.radialSegments; j += 1) {
      const longitude0 = longitudeStep * j;
      const longitude1 = j === options.radialSegments - 1 ? 0 : longitudeStep * (j + 1);
      // Source intentionally maps sin to X and cos to Z for CCW UVs on +X.
      const x0 = Math.sin(longitude0);
      const z0 = Math.cos(longitude0);
      const x1 = Math.sin(longitude1);
      const z1 = Math.cos(longitude1);
      const u0 = j / options.radialSegments;
      const u1 = (j + 1) / options.radialSegments;
      const vertices: readonly [GodotCsgVec3, GodotCsgVec3, GodotCsgVec3, GodotCsgVec3] = [
        [x0 * cos0 * options.radius, sin0 * options.radius, z0 * cos0 * options.radius],
        [x1 * cos0 * options.radius, sin0 * options.radius, z1 * cos0 * options.radius],
        [x1 * cos1 * options.radius, sin1 * options.radius, z1 * cos1 * options.radius],
        [x0 * cos1 * options.radius, sin1 * options.radius, z0 * cos1 * options.radius],
      ];
      const uvs: readonly [GodotCsgVec2, GodotCsgVec2, GodotCsgVec2, GodotCsgVec2] = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];

      if (i > 0) {
        faces.push({
          vertices: [vertices[0], vertices[1], vertices[2]],
          uvs: [uvs[0], uvs[1], uvs[2]],
          smooth: options.smoothFaces,
        });
      }
      if (i < options.rings - 1) {
        faces.push({
          vertices: [vertices[2], vertices[3], vertices[0]],
          uvs: [uvs[2], uvs[3], uvs[0]],
          smooth: options.smoothFaces,
        });
      }
    }
  }
  return buildGodotCsgBrushGeometry(faces);
}

export function createGodotCsgTorusGeometry(
  options: GodotCsgTorusGeometryOptions,
): BufferGeometry {
  let minRadius = options.innerRadius;
  let maxRadius = options.outerRadius;
  if (minRadius === maxRadius) return buildGodotCsgBrushGeometry([]);
  if (minRadius > maxRadius) [minRadius, maxRadius] = [maxRadius, minRadius];
  const tubeRadius = (maxRadius - minRadius) * 0.5;
  const centerRadius = minRadius + tubeRadius;
  const faces: GodotCsgBrushFace[] = [];

  for (let i = 0; i < options.sides; i += 1) {
    const around = i / options.sides;
    const nextAround = i === options.sides - 1 ? 0 : (i + 1) / options.sides;
    const angle = around * Math.PI * 2;
    const nextAngle = nextAround * Math.PI * 2;
    const normal: GodotCsgVec3 = [Math.cos(angle), 0, Math.sin(angle)];
    const nextNormal: GodotCsgVec3 = [Math.cos(nextAngle), 0, Math.sin(nextAngle)];

    for (let j = 0; j < options.ringSides; j += 1) {
      const ring = j / options.ringSides;
      const nextRing = j === options.ringSides - 1 ? 0 : (j + 1) / options.ringSides;
      const ringAngle = ring * Math.PI * 2;
      const nextRingAngle = nextRing * Math.PI * 2;
      const ringPoint: GodotCsgVec2 = [
        Math.cos(ringAngle) * tubeRadius + centerRadius,
        Math.sin(ringAngle) * tubeRadius,
      ];
      const nextRingPoint: GodotCsgVec2 = [
        Math.cos(nextRingAngle) * tubeRadius + centerRadius,
        Math.sin(nextRingAngle) * tubeRadius,
      ];
      const points: readonly [GodotCsgVec3, GodotCsgVec3, GodotCsgVec3, GodotCsgVec3] = [
        [normal[0] * ringPoint[0], ringPoint[1], normal[2] * ringPoint[0]],
        [normal[0] * nextRingPoint[0], nextRingPoint[1], normal[2] * nextRingPoint[0]],
        [nextNormal[0] * nextRingPoint[0], nextRingPoint[1], nextNormal[2] * nextRingPoint[0]],
        [nextNormal[0] * ringPoint[0], ringPoint[1], nextNormal[2] * ringPoint[0]],
      ];
      const uvs: readonly [GodotCsgVec2, GodotCsgVec2, GodotCsgVec2, GodotCsgVec2] = [
        [around, ring],
        [around, nextRing],
        [nextAround, nextRing],
        [nextAround, ring],
      ];
      faces.push({
        vertices: [points[0], points[2], points[1]],
        uvs: [uvs[0], uvs[2], uvs[1]],
        smooth: options.smoothFaces,
      });
      faces.push({
        vertices: [points[3], points[2], points[0]],
        uvs: [uvs[3], uvs[2], uvs[0]],
        smooth: options.smoothFaces,
      });
    }
  }
  return buildGodotCsgBrushGeometry(faces);
}
