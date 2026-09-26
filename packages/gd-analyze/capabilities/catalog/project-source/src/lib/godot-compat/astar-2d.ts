/** Godot AStar2D protocol over source-owned Vector2 values. */

import { createGodotAStarGraph, type GodotAStarGraph } from './astar-common';
import { copyVector2, type Vector2, vec2 } from './vector2';
import { registerGodotObjectIdentity } from './object';

const distance = (a: Readonly<Vector2>, b: Readonly<Vector2>): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

const closestOnSegment = (
  point: Readonly<Vector2>,
  from: Readonly<Vector2>,
  to: Readonly<Vector2>,
): Vector2 => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return copyVector2(from);
  const weight = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return vec2(from.x + dx * weight, from.y + dy * weight);
};

export type GodotAStar2D = GodotAStarGraph<Vector2>;

export function createGodotAStar2D(): GodotAStar2D {
  const graph = createGodotAStarGraph({ zero: vec2, copy: copyVector2, distance, closestOnSegment });
  registerGodotObjectIdentity(graph, 'AStar2D');
  return graph;
}
