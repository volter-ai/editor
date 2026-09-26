/** Godot AStar3D (Godot 4) / AStar (Godot 3) protocol over Vector3 values. */

import { createGodotAStarGraph, type GodotAStarGraph } from './astar-common';
import { type Vector3, vec3 } from './variant-3d';
import { registerGodotObjectIdentity } from './object';

const copy = (value: Readonly<Vector3>): Vector3 => vec3(value.x, value.y, value.z);
const distance = (a: Readonly<Vector3>, b: Readonly<Vector3>): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const closestOnSegment = (
  point: Readonly<Vector3>,
  from: Readonly<Vector3>,
  to: Readonly<Vector3>,
): Vector3 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared === 0) return copy(from);
  const weight = Math.max(
    0,
    Math.min(
      1,
      ((point.x - from.x) * dx + (point.y - from.y) * dy + (point.z - from.z) * dz) /
        lengthSquared,
    ),
  );
  return vec3(from.x + dx * weight, from.y + dy * weight, from.z + dz * weight);
};

export type GodotAStar3D = GodotAStarGraph<Vector3>;

const zero = (): Vector3 => vec3(0, 0, 0);

export function createGodotAStar3D(): GodotAStar3D {
  const graph = createGodotAStarGraph({ zero, copy, distance, closestOnSegment });
  registerGodotObjectIdentity(graph, 'AStar3D');
  return graph;
}

/** Godot 3 exposes the same 3D implementation as `AStar`. */
export function createGodotAStar(): GodotAStar3D {
  const graph = createGodotAStarGraph({ zero, copy, distance, closestOnSegment });
  registerGodotObjectIdentity(graph, 'AStar');
  return graph;
}
