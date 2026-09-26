/**
 * What the arena is, in numbers — the parts of it that are NOT collision.
 *
 * Collision used to live here too: a height table and a list of blocker boxes,
 * a second description of a level whose first description is the geometry in
 * `scenes/ArenaScene.tsx`. The two drifted (the centre bridge had to be special-cased out
 * of the height table by hand). Rapier's colliders are generated from that
 * geometry now, so the level is described once and this file keeps only the
 * input maths. Jump-pad placement is read from the placed prefab nodes.
 */

export interface PlanarPoint {
  x: number;
  z: number;
}

export function computeArenaMove(
  digital: { forward: boolean; backward: boolean; left: boolean; right: boolean },
  stick: { x: number; y: number },
  yaw: number,
): PlanarPoint {
  let x = Number(digital.right) - Number(digital.left) + stick.x;
  let z = Number(digital.backward) - Number(digital.forward) + stick.y;
  const magnitude = Math.hypot(x, z);
  if (magnitude > 1) {
    x /= magnitude;
    z /= magnitude;
  }
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}
