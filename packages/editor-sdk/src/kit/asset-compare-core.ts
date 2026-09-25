/**
 * B8.4 — pure math for the Asset Lab compare mode (`vgai screenshot
 * <model.glb> --compare <ref.glb>`): silhouette masks, IoU, the overlay pixel recipe,
 * forward-facing normalization, and the equal-height placement that lets a
 * procedural humanoid be scored numerically against a reference GLB.
 *
 * Deliberately DOM/WebGL-free so the whole scoring contract is unit-testable
 * in node (`packages/editor/test/asset-compare-core.test.ts`); the browser
 * rendering half lives in `asset-compare.ts`.
 */

export const ASSET_COMPARE_VIEWS = ['front', 'side'] as const;
export type AssetCompareView = (typeof ASSET_COMPARE_VIEWS)[number];

/** Both models are scaled to this height, feet at y=0, centered on x=z=0. */
export const COMPARE_TARGET_HEIGHT = 1;
/** Fixed orthographic frame: half-height around the model's mid-height. The
 *  10% margin keeps equal-height silhouettes fully in frame while wasting
 *  little resolution — and, being CONSTANT, makes captures deterministic
 *  across runs (a stated gate) and comparable across assets. */
export const COMPARE_FRAME_HALF_HEIGHT = 0.55;
export const COMPARE_FRAME_CENTER_Y = COMPARE_TARGET_HEIGHT / 2;

/** Silhouettes render as a flat unlit white override on solid black, so the
 *  mask threshold sits mid-range — antialiased edge pixels land on the side
 *  of the ramp they dominate. */
export const SILHOUETTE_LUMA_THRESHOLD = 128;

/** Overlay legend (RGB). The overlay is machine-generated review evidence:
 *  every pixel is exactly one of these four colors. */
export const OVERLAY_BACKGROUND_RGB = [24, 26, 31] as const;
export const OVERLAY_ASSET_ONLY_RGB = [235, 137, 52] as const; // orange — the asset under test
export const OVERLAY_REF_ONLY_RGB = [56, 189, 248] as const; // cyan — the reference
export const OVERLAY_OVERLAP_RGB = [236, 240, 238] as const; // near-white — agreement

/**
 * Binary silhouette mask from RGBA pixels of a white-on-black render: a
 * pixel belongs to the silhouette when any color channel crosses the
 * threshold. Returns one byte (0|1) per pixel.
 */
export function silhouetteMaskFromRgba(rgba: ArrayLike<number>, pixelCount: number): Uint8Array {
  if (rgba.length < pixelCount * 4) {
    throw new Error(
      `Silhouette mask expected ${pixelCount * 4} RGBA bytes but received ${rgba.length}.`,
    );
  }
  const mask = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const offset = pixel * 4;
    const value =
      rgba[offset]! >= SILHOUETTE_LUMA_THRESHOLD ||
      rgba[offset + 1]! >= SILHOUETTE_LUMA_THRESHOLD ||
      rgba[offset + 2]! >= SILHOUETTE_LUMA_THRESHOLD;
    mask[pixel] = value ? 1 : 0;
  }
  return mask;
}

export interface MaskOverlapStats {
  intersection: number;
  union: number;
  aCount: number;
  bCount: number;
  /** intersection / union; 0 when the union is empty (guard emptiness upstream). */
  iou: number;
}

/** Silhouette intersection-over-union between two same-length binary masks. */
export function maskIoU(a: Uint8Array, b: Uint8Array): MaskOverlapStats {
  if (a.length !== b.length) {
    throw new Error(`Mask IoU requires equal-size masks (${a.length} vs ${b.length}).`);
  }
  let intersection = 0;
  let aCount = 0;
  let bCount = 0;
  for (let index = 0; index < a.length; index++) {
    const inA = a[index] !== 0;
    const inB = b[index] !== 0;
    if (inA) aCount++;
    if (inB) bCount++;
    if (inA && inB) intersection++;
  }
  const union = aCount + bCount - intersection;
  return { intersection, union, aCount, bCount, iou: union === 0 ? 0 : intersection / union };
}

/**
 * The compare overlay: both silhouettes on one image in visibly distinct
 * colors — asset-only orange, reference-only cyan, agreement near-white on a
 * dark background. Returns opaque RGBA bytes ready for an ImageData.
 */
export function overlayRgba(
  assetMask: Uint8Array,
  refMask: Uint8Array,
): Uint8ClampedArray<ArrayBuffer> {
  if (assetMask.length !== refMask.length) {
    throw new Error(
      `Overlay requires equal-size masks (${assetMask.length} vs ${refMask.length}).`,
    );
  }
  const out = new Uint8ClampedArray(assetMask.length * 4);
  for (let pixel = 0; pixel < assetMask.length; pixel++) {
    const inAsset = assetMask[pixel] !== 0;
    const inRef = refMask[pixel] !== 0;
    const color =
      inAsset && inRef
        ? OVERLAY_OVERLAP_RGB
        : inAsset
          ? OVERLAY_ASSET_ONLY_RGB
          : inRef
            ? OVERLAY_REF_ONLY_RGB
            : OVERLAY_BACKGROUND_RGB;
    const offset = pixel * 4;
    out[offset] = color[0];
    out[offset + 1] = color[1];
    out[offset + 2] = color[2];
    out[offset + 3] = 255;
  }
  return out;
}

/** A structurally valid forward vector ([x,y,z], finite, non-degenerate in
 *  the ground plane) or null — used to read GLB `extras`/`userData.forward`
 *  without trusting arbitrary content. */
export function parseForwardVector(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (Math.hypot(x, z) < 1e-6) return null; // vertical/zero forward cannot define a facing
  return [x, y, z];
}

/**
 * The Y rotation (radians) that turns a model whose forward is `forward`
 * to face +Z — the direction the fixed front camera looks from. Facing is a
 * ground-plane property; the vector's y component is ignored.
 */
export function forwardYawRadians(forward: readonly [number, number, number]): number {
  const [x, , z] = forward;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 1e-6) {
    throw new Error(`Cannot derive a facing from forward vector [${forward.join(', ')}].`);
  }
  return Math.atan2(x, z);
}

export interface NormalizedPlacement {
  scale: number;
  /** Applied AFTER the scale: ground at y=0, footprint centered at x=z=0. */
  position: [number, number, number];
}

/**
 * Bounding-box height normalization (the decided compare framing): scale the
 * model so its bounds stand `targetHeight` tall, then place it with its
 * ground plane at y=0 and its bounds center on the x=0/z=0 axis.
 */
export function normalizedPlacement(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  targetHeight: number = COMPARE_TARGET_HEIGHT,
): NormalizedPlacement {
  const height = max[1] - min[1];
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error(`Compare normalization needs positive model height, got ${height}.`);
  }
  const scale = targetHeight / height;
  const centerX = (min[0] + max[0]) / 2;
  const centerZ = (min[2] + max[2]) / 2;
  return { scale, position: [-centerX * scale, -min[1] * scale, -centerZ * scale] };
}
