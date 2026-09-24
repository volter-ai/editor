/**
 * Fit a directional light's orthographic shadow box to the camera, for one
 * frame — the geometry three does not supply.
 *
 * `DirectionalLightShadow` is an ordinary `OrthographicCamera` parented to the
 * light, and it sits wherever the light's authored transform puts it, forever.
 * That is fine for a scene the authored box contains and wrong for every game
 * whose camera travels: the moment the player walks past the box, the casters
 * out there stop having shadows, and no bias, map size or intensity fixes it
 * because the geometry is simply outside the frustum. Three's own addon CSM is
 * the multi-cascade answer to a different question and supplies neither of the
 * two pieces below.
 *
 * ## The box is the frustum slice's BOUNDING SPHERE
 *
 * The standard fit, and the reason it cannot be authored as a constant: take
 * the eight corners of the camera's frustum between its near plane and
 * `maxDistance`, put the box centre at their centroid, and size the box to the
 * largest distance from that centroid to a corner. That radius is decided by
 * the camera's FIELD OF VIEW and aspect as much as by `maxDistance` — at a
 * 70-degree vertical fov over 1024x600, a 40-unit slice has half-extents of
 * 47.8 x 28.0 at its far plane and the sphere around it has radius ~58.9,
 * nearly three times `maxDistance / 2`. A bounding SPHERE (rather than the
 * tight box) is what makes the radius independent of camera yaw, so turning in
 * place cannot resize the shadow.
 *
 * The corners are read through the camera's own `projectionMatrixInverse`, so
 * a perspective and an orthographic camera are exact with no branch on type —
 * and an asymmetric frustum (`setViewOffset`) is fitted over its real corners
 * rather than an assumed centre.
 *
 * ## Texel snapping is not a polish detail
 *
 * A shadow box that follows a camera continuously re-rasterizes the same
 * static geometry at sub-texel offsets, and the depth-test result flips along
 * every shadow edge from frame to frame — the edges CRAWL, which is far more
 * distracting than the missing shadows the fit is for. Quantizing the centre
 * to whole shadow texels, in the LIGHT's own basis (the shadow map's u/v axes
 * are the light's local x/y), makes the rasterized footprint of a static
 * caster identical between frames. Depth (local z) is deliberately NOT snapped:
 * it does not affect which texel a fragment lands in.
 *
 * ## What the caller keeps
 *
 * This is one pure function over three's own objects: it reads a camera and a
 * quaternion and returns three numbers-and-a-vector. It moves nothing, and in
 * particular it does not touch the light — how a fitted centre reaches the
 * shadow camera is the caller's, because three derives the shadow camera's
 * placement FROM the light every frame (`LightShadow.updateMatrices` copies the
 * light's world position and looks at `light.target`), so the thing that has to
 * move is the light NODE and only the caller knows how its light is parented,
 * aimed and torn down. The depth range (`shadow.camera.near`/`far`) is the
 * caller's for the same reason: it is what `shadow.bias` is normalized against.
 *
 * {@link DirectionalShadowFit.texelWorldSize} is published because everything
 * sized in texels moves with the box — a receiver-side `shadow.normalBias`
 * derived from a stale texel is wrong by exactly the factor the box grew, and
 * it surfaces as self-shadow acne on curved casters rather than as anything a
 * reviewer would call a shadow bug.
 *
 * Consumers today: `top-down-strategy`'s camera-fitted sun, and
 * `godot-compat`'s Godot 3 `SHADOW_ORTHOGONAL` fit.
 *
 * The Godot lane is ARCHIVED off main — `git fetch origin archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */
import { type Camera, Quaternion, Vector3 } from 'three';

/** The box a directional shadow is rendered through for one frame. */
export interface DirectionalShadowFit {
  /** WORLD-space centre of the box, quantized to whole shadow texels in the light's basis. */
  readonly center: Vector3;
  /** Half-extent on both lateral axes — the frustum slice's bounding-sphere radius. */
  readonly radius: number;
  /** One shadow texel in world units at this radius: `2 * radius / mapSize`. */
  readonly texelWorldSize: number;
}

const _inverseLight = new Quaternion();
const _corner = new Vector3();
const _centroid = new Vector3();
const _ndc = new Vector3();
/** The four lateral NDC corners; the slice's eight are these at two depths. */
const NDC_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** View-space depth `-z` as this camera's NDC z, through the camera's OWN projection — so the
 *  slice is exact for a perspective and an orthographic camera alike, with no branch on type. */
function ndcDepthOf(camera: Camera, viewDepth: number): number {
  return _ndc.set(0, 0, -viewDepth).applyMatrix4(camera.projectionMatrix).z;
}

/**
 * The bounding sphere of `camera`'s frustum between its near plane and
 * `maxDistance`, with the centre quantized to whole shadow texels in the
 * LIGHT's basis.
 *
 * `camera` is read through its own `projectionMatrix`/`projectionMatrixInverse`/`matrixWorld`, so a
 * caller must have brought those up to date (three does this for every rendered camera).
 * `maxDistance` is the view depth the shadow covers, measured from the camera and clamped to its
 * far plane — there is nothing to shadow past the geometry the camera draws.
 * `lightOrientation` is the light's WORLD quaternion, whose local x/y are the shadow map's own axes
 * and therefore the axes the snap quantizes along. A `mapSize` of zero or less disables snapping
 * rather than dividing by it.
 */
export function fitDirectionalShadowToCamera(
  camera: Camera,
  lightOrientation: Quaternion,
  maxDistance: number,
  mapSize: number,
): DirectionalShadowFit {
  const frustum = camera as Camera & { near?: number; far?: number };
  const camNear = typeof frustum.near === 'number' ? frustum.near : 0;
  const camFar = typeof frustum.far === 'number' ? frustum.far : maxDistance;
  // The two clamps are degenerate-input guards: far at least a hair past near, near never past far.
  let far = Math.min(maxDistance, camFar);
  far = Math.max(far, camNear + 0.001);
  const near = Math.min(camNear, far);
  const nearNdc = ndcDepthOf(camera, near);
  const farNdc = ndcDepthOf(camera, far);

  // The centroid of the eight corners. Both planes contribute four symmetric corners, so for an
  // ordinary camera this is `(near + far) / 2` down -Z — but it is computed rather than assumed,
  // because `setViewOffset` makes a frustum asymmetric and the fit is over the real corners.
  _centroid.set(0, 0, 0);
  for (const ndcZ of [nearNdc, farNdc]) {
    for (const [x, y] of NDC_CORNERS) {
      _centroid.add(_corner.set(x, y, ndcZ).applyMatrix4(camera.projectionMatrixInverse));
    }
  }
  _centroid.multiplyScalar(1 / 8);

  let radius = 0;
  for (const ndcZ of [nearNdc, farNdc]) {
    for (const [x, y] of NDC_CORNERS) {
      radius = Math.max(
        radius,
        _corner.set(x, y, ndcZ).applyMatrix4(camera.projectionMatrixInverse).distanceTo(_centroid),
      );
    }
  }
  // One texel of margin, so the snapped box never clips its own outermost texel: the snap below
  // moves the centre by up to half a texel on each lateral axis.
  if (mapSize > 2) radius *= mapSize / (mapSize - 2);

  const center = _centroid.clone().applyMatrix4(camera.matrixWorld);
  const texelWorldSize = mapSize > 0 ? (2 * radius) / mapSize : 0;
  if (texelWorldSize > 0) {
    center.applyQuaternion(_inverseLight.copy(lightOrientation).invert());
    center.x = Math.round(center.x / texelWorldSize) * texelWorldSize;
    center.y = Math.round(center.y / texelWorldSize) * texelWorldSize;
    center.applyQuaternion(lightOrientation);
  }
  return { center, radius, texelWorldSize };
}
