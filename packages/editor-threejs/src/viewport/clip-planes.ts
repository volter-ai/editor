/**
 * How far a Three authoring view's perspective camera can see.
 *
 * ## The measured defect this exists for
 *
 * The editor camera was constructed once, with `far = 1000`, and never
 * adjusted. That is fine for the starter template (a cube on a 50-unit grid)
 * and wrong for anything world-sized: framing a world several hundred units
 * across puts the camera past the far plane, so every triangle is clipped and
 * the Scene viewport is a flat, empty field. The failure is graded, which is
 * what made it confusing — at a 454-unit framing the world draws; at 1099 only
 * the fragments within 1000 survive; at 1276 nothing does. A game whose own
 * camera declares `far = 10000` is stating the honest scale of its world, and
 * the editor camera has to reach it.
 *
 * Nothing about that is ingest-specific — a first-party world larger than
 * ~1000 units disappears the same way — so the fix is a property of the editor
 * camera, not of the ingest route.
 *
 * ## Why grow `far` instead of just setting it large
 *
 * The depth buffer's precision is governed by `far / near`, not by `far`. A
 * blanket `far = 100000` would give every small scene a 10^6 ratio and visible
 * z-fighting. So `far` tracks the content the camera actually has to reach,
 * and `near` is pushed out only as much as is needed to keep the ratio bounded
 * — which, for anything at the template's scale, is not at all: the planes come
 * back exactly `0.1 / 1000`, the values the camera has always had.
 */

/** The camera's minimum near plane — also the exact value for any small scene. */
export const EDITOR_CAMERA_NEAR = 0.1;

/** The camera's minimum far plane — also the exact value for any small scene. */
export const EDITOR_CAMERA_FAR = 1000;

/**
 * Ceiling on `far / near`. 0.1/1000 is 10^4, so this leaves two doublings of
 * headroom before `near` starts moving at all, and caps the depth-precision
 * loss a very large world can inflict.
 */
export const EDITOR_CAMERA_MAX_DEPTH_RATIO = 20_000;

/** Slack past the farthest content, so the far plane never grazes it. */
const REACH_MARGIN = 1.25;

/**
 * Clip planes that reach `contentRadius` around a center `distanceToCenter`
 * away, never tighter than the base planes.
 *
 * Pure and total: a non-finite or negative input yields the base planes rather
 * than an `Infinity`/`NaN` projection matrix, because a camera whose bounds
 * could not be measured must still draw.
 */
export function fitClipPlanes(
  distanceToCenter: number,
  contentRadius: number,
): { near: number; far: number } {
  const d = Number.isFinite(distanceToCenter) ? Math.max(0, distanceToCenter) : 0;
  const r = Number.isFinite(contentRadius) ? Math.max(0, contentRadius) : 0;
  const far = Math.max(EDITOR_CAMERA_FAR, (d + r) * REACH_MARGIN);
  const near = Math.max(EDITOR_CAMERA_NEAR, far / EDITOR_CAMERA_MAX_DEPTH_RATIO);
  return { near, far };
}
