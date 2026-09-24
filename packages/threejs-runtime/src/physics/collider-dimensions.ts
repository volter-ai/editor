/**
 * Shared world-scale collider dimension math (T1.2).
 *
 * Rapier colliders have no notion of a parent Object3D's `scale` — a body's
 * shape is defined in absolute world units at creation time. Three.js meshes,
 * by contrast, scale visually for free via the normal Object3D hierarchy. To
 * keep the physical collider matching what's on screen, the LOADER must bake
 * the entity's composed WORLD scale (self × every transformed ancestor) into
 * the collider's dimensions at creation time.
 *
 * This is the ONE place that does that math, so every caller — the physics
 * body creation path and the editor's collider gizmo alike — agrees on
 * exactly the same numbers. Two copies silently agree by coincidence for
 * uniform scale and disagree for everything else.
 *
 * Round colliders (ball/capsule) can only represent a uniform radius — Rapier
 * has no ellipsoid/elliptical-capsule shape. A non-uniform world scale on a
 * round collider's round axes throws a loud error naming the entity, rather
 * than silently simulating (or rendering) the wrong shape.
 */

import type { ColliderDescriptor } from '../asset-formats/collider';
import { DEFAULTS } from '../defaults';

/** Axes are considered "uniform enough" within this tolerance (float error only). */
const UNIFORM_SCALE_EPSILON = 1e-4;

export interface ColliderWorldDimensions {
  /** cuboid only: per-axis half-extents, world scale applied. */
  halfExtents?: [number, number, number];
  /** ball/capsule only: radius, world scale applied (uniform axes required). */
  radius?: number;
  /** capsule only: half-height along the capsule's axis, world scale applied. */
  halfHeight?: number;
}

/**
 * Compute a collider's WORLD-space dimensions given the entity's composed
 * world scale (self × ancestors, per-axis, in the entity's own local frame,
 * in X/Y/Z order).
 *
 * @param collider - the entity's authored (unscaled) collider definition.
 * @param worldScale - composed world scale `[x, y, z]`.
 * @param entityLabel - human-readable entity identifier, used only in thrown
 *   error messages (loud-failure naming, never silently wrong).
 * @throws if a ball/capsule collider's round cross-section axes have a
 *   non-uniform world scale (beyond {@link UNIFORM_SCALE_EPSILON}).
 */
export function computeColliderWorldDimensions(
  collider: ColliderDescriptor,
  worldScale: readonly [number, number, number],
  entityLabel: string,
): ColliderWorldDimensions {
  const [sx, sy, sz] = worldScale;

  switch (collider.type) {
    case 'cuboid': {
      const he = collider.halfExtents ?? DEFAULTS.collider.cuboid.halfExtents;
      return { halfExtents: [he[0]! * sx, he[1]! * sy, he[2]! * sz] };
    }
    case 'ball': {
      if (
        Math.abs(sx - sy) > UNIFORM_SCALE_EPSILON ||
        Math.abs(sy - sz) > UNIFORM_SCALE_EPSILON ||
        Math.abs(sx - sz) > UNIFORM_SCALE_EPSILON
      ) {
        throw new Error(
          `Entity "${entityLabel}" has a "ball" collider under a non-uniform world scale ` +
            `[${sx}, ${sy}, ${sz}]. Rapier ball colliders are always perfect spheres — a ` +
            `non-uniform scale cannot be represented and would silently simulate the wrong ` +
            `shape. Use a uniform scale on this entity (and every transformed ancestor), or ` +
            `switch to a "cuboid" collider.`,
        );
      }
      const radius = collider.radius ?? DEFAULTS.collider.ball.radius;
      return { radius: radius * sx };
    }
    case 'capsule': {
      // Rapier capsules run their half-height along the local Y axis, with a
      // circular cross-section in the XZ plane — so only X/Z need to match.
      if (Math.abs(sx - sz) > UNIFORM_SCALE_EPSILON) {
        throw new Error(
          `Entity "${entityLabel}" has a "capsule" collider whose X/Z world scale differs ` +
            `(x=${sx}, z=${sz}). Rapier capsule colliders have a circular cross-section — a ` +
            `non-uniform X/Z scale cannot be represented and would silently simulate the ` +
            `wrong shape. Use a uniform X/Z scale on this entity (and every transformed ` +
            `ancestor), or switch to a "cuboid" collider.`,
        );
      }
      const radius = collider.radius ?? DEFAULTS.collider.capsule.radius;
      const halfHeight = collider.halfHeight ?? DEFAULTS.collider.capsule.halfHeight;
      return { radius: radius * sx, halfHeight: halfHeight * sy };
    }
    default:
      return {};
  }
}

/**
 * Compute a collider's WORLD-scaled translation offset (sibling to
 * {@link computeColliderWorldDimensions}, same input contract).
 *
 * Rapier's `ColliderDesc.setTranslation` is a raw physics-engine offset with no
 * notion of a parent Object3D's scale — like dimensions, an authored `offset`
 * (in the entity's own local units) must be scaled per-axis by the entity's
 * composed world scale before being handed to Rapier, or the collider's center
 * silently drifts away from its visual anchor point under any non-1 scale.
 * Applies to every collider type (including trimesh, which is otherwise not
 * handled by {@link computeColliderWorldDimensions}).
 *
 * Returns `undefined` when no offset is authored, mirroring the `if (col.offset)`
 * guard call sites already use.
 */
export function computeColliderWorldOffset(
  offset: readonly [number, number, number] | undefined,
  worldScale: readonly [number, number, number],
): [number, number, number] | undefined {
  if (!offset) return undefined;
  const [sx, sy, sz] = worldScale;
  return [offset[0] * sx, offset[1] * sy, offset[2] * sz];
}
