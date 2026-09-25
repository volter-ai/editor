/**
 * The asset-preview capture engine's FRAMING MATH, extracted from
 * `asset-preview.ts` so it can be exercised without a WebGL context.
 *
 * Everything here is pure: it takes points, a camera basis and an output
 * aspect, and returns frustum half-extents or a configured
 * `THREE.OrthographicCamera`. Nothing in this module traverses a scene,
 * renders, or allocates GPU resources — the traversal that FEEDS it
 * (`forEachRenderableVertex`) stays in `asset-preview.ts`, because that is
 * scene-graph knowledge rather than geometry.
 *
 * Two facts drove the extraction:
 *
 * 1. A turntable shot must be framed from the subject's ACTUAL projected
 *    extent along that shot's own camera axes. The engine used to derive
 *    every yaw's frame from ONE world-axis-aligned bounding box, which is a
 *    proxy: it is conservative for a compact subject and wasteful for a
 *    long one held in a bent pose, and it centres every yaw on the AABB's
 *    centre rather than on what that yaw actually sees.
 * 2. A `bone-zoom` crop needs the same freedom of angle the turntable has.
 *    Its basis used to be hardcoded to +Z, so a crop anchored on the tail of
 *    an 8 m quadruped photographed the hind legs standing in front of it.
 *
 * @see {@link turntableViewBasis} for the yaw convention both shot kinds share.
 */
import * as THREE from 'three';

/** Frame margin: the fitted half-extents are scaled by this, so a subject
 *  never touches the frame edge. Shared by every orthographic preview
 *  camera — the value is the engine's one framing constant. */
export const ASSET_PREVIEW_PADDING = 1.2;

/** The smallest half-extent a fitted frame may have, so a degenerate
 *  (single-point) subject still produces a valid frustum. */
const MIN_HALF_EXTENT = 0.001;

/** An orthonormal camera basis. `direction` points from the subject TOWARD
 *  the camera (the convention every preview camera in this engine uses:
 *  `position = target + direction * distance`). */
export interface OrthographicViewBasis {
  direction: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

/**
 * The turntable yaw convention, shared by `turntable` shots and — since the
 * `bone-zoom` yaw was added — by bone-anchored crops too, so a definition
 * reads one angle convention rather than two.
 *
 * `yaw = 0` puts the camera on +Z looking at the subject's front (the
 * direction `faceFrontSubject` normalises the model's own forward to face),
 * and yaw increases toward +X: `PI` is the back, `-PI/2` and `+PI/2` the two
 * sides — the angles shot sets already label 'left' and 'right'.
 */
export function turntableViewBasis(yaw: number): OrthographicViewBasis {
  const direction = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = worldUp.clone().cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  return { direction, right, up };
}

/**
 * The subject's extent along one camera basis, accumulated point by point.
 * This is an oriented (not axis-aligned) measurement: `right`/`up` are the
 * screen axes of the shot being framed, so the span is exactly what that
 * shot's frustum has to contain.
 */
export interface ProjectedSpan {
  minRight: number;
  maxRight: number;
  minUp: number;
  maxUp: number;
  minDepth: number;
  maxDepth: number;
}

export function createProjectedSpan(): ProjectedSpan {
  return {
    minRight: Number.POSITIVE_INFINITY,
    maxRight: Number.NEGATIVE_INFINITY,
    minUp: Number.POSITIVE_INFINITY,
    maxUp: Number.NEGATIVE_INFINITY,
    minDepth: Number.POSITIVE_INFINITY,
    maxDepth: Number.NEGATIVE_INFINITY,
  };
}

export function isProjectedSpanEmpty(span: ProjectedSpan): boolean {
  return span.maxRight < span.minRight;
}

/** Return a span to its empty state, so one allocation can measure a long
 *  series of small subjects (the per-primitive coverage walk measures one
 *  span per rendered triangle and would otherwise allocate per triangle). */
export function resetProjectedSpan(span: ProjectedSpan): void {
  span.minRight = Number.POSITIVE_INFINITY;
  span.maxRight = Number.NEGATIVE_INFINITY;
  span.minUp = Number.POSITIVE_INFINITY;
  span.maxUp = Number.NEGATIVE_INFINITY;
  span.minDepth = Number.POSITIVE_INFINITY;
  span.maxDepth = Number.NEGATIVE_INFINITY;
}

/** Fold one world-space point into a span. Mutates `span` — a capture walks
 *  every rendered vertex once and folds it into every basis it needs. */
export function expandProjectedSpan(
  span: ProjectedSpan,
  point: THREE.Vector3,
  basis: OrthographicViewBasis,
): void {
  const right = point.dot(basis.right);
  const up = point.dot(basis.up);
  const depth = point.dot(basis.direction);
  if (right < span.minRight) span.minRight = right;
  if (right > span.maxRight) span.maxRight = right;
  if (up < span.minUp) span.minUp = up;
  if (up > span.maxUp) span.maxUp = up;
  if (depth < span.minDepth) span.minDepth = depth;
  if (depth > span.maxDepth) span.maxDepth = depth;
}

/** The world-space point at the centre of a span — where the shot's camera
 *  looks. Reconstructed from the basis, so it is the centre of the ORIENTED
 *  box the shot sees, not of a world-axis-aligned proxy. */
export function projectedSpanCenter(
  span: ProjectedSpan,
  basis: OrthographicViewBasis,
): THREE.Vector3 {
  if (isProjectedSpanEmpty(span)) {
    throw new Error('Asset preview cannot frame an empty projected span.');
  }
  return new THREE.Vector3()
    .addScaledVector(basis.right, (span.minRight + span.maxRight) / 2)
    .addScaledVector(basis.up, (span.minUp + span.maxUp) / 2)
    .addScaledVector(basis.direction, (span.minDepth + span.maxDepth) / 2);
}

/** An orthographic frustum's half-extents, already padded and aspect-fitted. */
export interface OrthographicFrame {
  halfWidth: number;
  halfHeight: number;
}

/**
 * Fit half-extents that contain `halfRight` x `halfUp` at the output aspect,
 * with the engine's standard padding. Height leads and width follows, so the
 * rendered pixels are never anisotropic relative to the subject.
 */
export function fitOrthographicFrame(
  halfRight: number,
  halfUp: number,
  aspect: number,
  padding: number = ASSET_PREVIEW_PADDING,
): OrthographicFrame {
  const halfHeight = Math.max(halfUp, halfRight / aspect, MIN_HALF_EXTENT) * padding;
  return { halfHeight, halfWidth: halfHeight * aspect };
}

/** Fit the frame a single projected span needs. */
export function fitProjectedSpanFrame(
  span: ProjectedSpan,
  aspect: number,
  padding: number = ASSET_PREVIEW_PADDING,
): OrthographicFrame {
  if (isProjectedSpanEmpty(span)) {
    throw new Error('Asset preview cannot frame an empty projected span.');
  }
  return fitOrthographicFrame(
    (span.maxRight - span.minRight) / 2,
    (span.maxUp - span.minUp) / 2,
    aspect,
    padding,
  );
}

/**
 * The frame every turntable shot of one staged subject shares: the UNION of
 * what each yaw needs.
 *
 * Why the union rather than a per-shot exact fit. A verify shot set is read
 * as a SET — the reviewer compares the same junction across yaws (and, on a
 * contact sheet, side by side). A per-shot fit silently rescales the subject
 * between frames, so a wing that looks thicker at yaw 0 than at yaw PI/2
 * would be a framing artefact rather than geometry, which is exactly the
 * kind of false signal a verify render exists to eliminate. The union keeps
 * ONE scale for every turntable shot of a staged subject while each shot is
 * still CENTRED on its own projected span — so nothing clips and nothing
 * rescales.
 *
 * The union is per staged subject (the rest scene, and each named pose's
 * disposable snapshot) rather than across poses: poses are separately
 * staged already, and a single extreme pose must not shrink every other
 * frame in the set.
 */
export function unionOrthographicFrames(frames: readonly OrthographicFrame[]): OrthographicFrame {
  if (frames.length === 0) {
    throw new Error('Asset preview cannot union an empty set of frames.');
  }
  let halfWidth = 0;
  let halfHeight = 0;
  for (const frame of frames) {
    halfWidth = Math.max(halfWidth, frame.halfWidth);
    halfHeight = Math.max(halfHeight, frame.halfHeight);
  }
  return { halfWidth, halfHeight };
}

/**
 * The frame a bone-anchored crop needs: a margin proportional to the WHOLE
 * model's own bounding radius (never a fixed reference-human height, so a
 * goblin's crop stays goblin-scaled), widened until it actually contains
 * every anchor.
 *
 * Offsets are measured along the SHOT's basis, so a crop taken from the side
 * frames the anchors it names from the side. At the default yaw the basis is
 * (+X, +Y, +Z) and this reduces exactly to the world-axis arithmetic it
 * replaced.
 */
export function fitBoneZoomFrame(
  anchors: readonly THREE.Vector3[],
  center: THREE.Vector3,
  basis: OrthographicViewBasis,
  overallRadius: number,
  spanFraction: number,
  aspect: number,
): OrthographicFrame {
  const margin = Math.max(overallRadius * spanFraction, MIN_HALF_EXTENT);
  let halfWidth = margin;
  let halfHeight = margin;
  const offset = new THREE.Vector3();
  for (const point of anchors) {
    offset.copy(point).sub(center);
    halfWidth = Math.max(halfWidth, Math.abs(offset.dot(basis.right)) + margin);
    halfHeight = Math.max(halfHeight, Math.abs(offset.dot(basis.up)) + margin);
  }
  // Keep the crop's aspect consistent with the output image so neither axis
  // is silently clipped relative to what actually got rendered.
  halfWidth = Math.max(halfWidth, halfHeight * aspect);
  halfHeight = Math.max(halfHeight, halfWidth / aspect);
  return { halfWidth, halfHeight };
}

/** The mean of the anchor points a bone-zoom crop is built around. */
export function boneZoomCenter(anchors: readonly THREE.Vector3[]): THREE.Vector3 {
  if (anchors.length === 0) {
    throw new Error('Asset preview cannot centre a bone-zoom crop on zero anchors.');
  }
  const center = new THREE.Vector3();
  for (const point of anchors) center.add(point);
  return center.multiplyScalar(1 / anchors.length);
}

/**
 * What one orthographic shot actually renders, in the SAME scalar
 * coordinates a {@link ProjectedSpan} is measured in (`point.dot(right)`,
 * `point.dot(up)`, `point.dot(direction)`) — so a shot's frame and the
 * subject's measured extent are directly comparable without a second
 * projection convention.
 *
 * This exists for the empty-frame guard: a verify shot that frames NO
 * geometry renders pure background, lands on a contact sheet looking like
 * coverage, and proves nothing. Detecting that is a containment question
 * about the vertices the capture already walks, not a question about pixels.
 */
export interface ShotFrameWindow {
  minRight: number;
  maxRight: number;
  minUp: number;
  maxUp: number;
  /** Depth here is `point.dot(direction)`, which INCREASES toward the camera
   *  (`direction` points from subject to camera), so the near plane is the
   *  MAXIMUM depth and the far plane the minimum. */
  minDepth: number;
  maxDepth: number;
}

/**
 * The window a configured orthographic shot camera renders, read back off the
 * camera itself rather than recomputed from the inputs that built it — so the
 * guard tests what will be drawn, including the padding and aspect fitting
 * {@link fitOrthographicFrame} applied.
 */
export function orthographicShotFrameWindow(
  camera: THREE.OrthographicCamera,
  basis: OrthographicViewBasis,
): ShotFrameWindow {
  const right = camera.position.dot(basis.right);
  const up = camera.position.dot(basis.up);
  const depth = camera.position.dot(basis.direction);
  const zoom = camera.zoom || 1;
  return {
    minRight: right + camera.left / zoom,
    maxRight: right + camera.right / zoom,
    minUp: up + camera.bottom / zoom,
    maxUp: up + camera.top / zoom,
    minDepth: depth - camera.far,
    maxDepth: depth - camera.near,
  };
}

/**
 * Could anything measured into `span` appear in this shot?
 *
 * `span` is expected to be ONE rendered primitive (a triangle, a line
 * segment, a sprite quad), measured in the shot's own basis — so this is an
 * overlap test between the primitive's projected bounding box and the frame.
 *
 * The asymmetry is deliberate and is what makes the empty-frame warning
 * trustworthy: a primitive whose box overlaps the frame may still miss it
 * (a thin diagonal triangle), so "overlaps" does not prove the shot shows
 * something — but NO primitive overlapping does prove it shows nothing. The
 * guard only ever claims the second. Testing individual VERTICES instead
 * would invert that: a crop sitting inside one large flat face contains no
 * vertex while rendering solid geometry, and would be reported as empty.
 */
export function spanOverlapsShotFrame(span: ProjectedSpan, window: ShotFrameWindow): boolean {
  if (isProjectedSpanEmpty(span)) return false;
  return (
    span.maxRight >= window.minRight &&
    span.minRight <= window.maxRight &&
    span.maxUp >= window.minUp &&
    span.minUp <= window.maxUp &&
    span.maxDepth >= window.minDepth &&
    span.minDepth <= window.maxDepth
  );
}

/**
 * Build the configured orthographic camera for one shot. `distance` and
 * `far` are the depth budget the caller derives from the subject's own
 * bounding radius; the frame and target come from the projected measurements
 * above.
 */
export function createOrthographicShotCamera(
  target: THREE.Vector3,
  basis: OrthographicViewBasis,
  frame: OrthographicFrame,
  distance: number,
  far: number,
): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(
    -frame.halfWidth,
    frame.halfWidth,
    frame.halfHeight,
    -frame.halfHeight,
    0.01,
    far,
  );
  camera.position.copy(target).addScaledVector(basis.direction, distance);
  camera.up.copy(basis.up);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}
