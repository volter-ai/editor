/**
 * B8.4 — pure horizontal-slice measurement math for
 * `project.humanoid.slice-measure`: cut a world-space triangle soup at a
 * height, fit an axis-aligned ellipse to the cross-section, and sample the
 * outline radially so the residual shape (relative to that ellipse) can be
 * pasted into a body spec as a profile suggestion.
 *
 * Deliberately three.js-free (plain numbers in flat arrays) so every formula
 * here is unit-testable against exact synthetic outlines — see
 * `packages/editor/test/humanoid-slice-measure.test.ts`.
 *
 * Conventions (matching the humanoid body engine's ring vocabulary):
 * - `hx`/`hz` are half-extents along +X / +Z; `ox`/`oz` the slice center.
 * - Radial angle θ starts at +Z (the character's FRONT once the model is
 *   yaw-normalized to face +Z) and turns toward +X: direction
 *   `(x, z) = (sin θ, cos θ)`.
 */

export interface SliceEllipse {
  /** Half-extent along X (metres, world space). */
  hx: number;
  /** Half-extent along Z. */
  hz: number;
  /** Slice-center offset along X. */
  ox: number;
  /** Slice-center offset along Z. */
  oz: number;
}

/**
 * Intersect a triangle soup with the horizontal plane `y`, returning flat
 * cross-section segments `[x1, z1, x2, z2, ...]`.
 *
 * `triangles` is a flat xyz soup: 9 numbers per triangle. An edge crosses the
 * plane when its endpoints land on opposite sides of the half-open split
 * `y_vertex <= y` — a deterministic convention that also resolves vertices
 * lying exactly on the plane without epsilon tuning.
 */
export function sliceTriangleSegments(triangles: ArrayLike<number>, y: number): number[] {
  if (triangles.length % 9 !== 0) {
    throw new Error(`Triangle soup length must be a multiple of 9, got ${triangles.length}.`);
  }
  const segments: number[] = [];
  const crossX: number[] = [0, 0];
  const crossZ: number[] = [0, 0];
  for (let base = 0; base < triangles.length; base += 9) {
    let crossings = 0;
    for (let edge = 0; edge < 3 && crossings < 2; edge++) {
      const a = base + edge * 3;
      const b = base + ((edge + 1) % 3) * 3;
      const ya = triangles[a + 1]!;
      const yb = triangles[b + 1]!;
      if (ya <= y === yb <= y) continue;
      const t = (y - ya) / (yb - ya);
      crossX[crossings] = triangles[a]! + (triangles[b]! - triangles[a]!) * t;
      crossZ[crossings] = triangles[a + 2]! + (triangles[b + 2]! - triangles[a + 2]!) * t;
      crossings++;
    }
    if (crossings === 2) {
      segments.push(crossX[0]!, crossZ[0]!, crossX[1]!, crossZ[1]!);
    }
  }
  return segments;
}

/**
 * Axis-aligned ellipse fit from the cross-section's extents: center at the
 * middle of the X/Z bounds, half-extents to those bounds — the same shape a
 * body-spec ring row (`hx`, `hz`, center offset) describes.
 */
export function fitSliceEllipse(segments: ArrayLike<number>): SliceEllipse {
  if (segments.length === 0 || segments.length % 4 !== 0) {
    throw new Error(`Slice segments must be non-empty groups of 4, got ${segments.length}.`);
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < segments.length; index += 2) {
    const x = segments[index]!;
    const z = segments[index + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    hx: (maxX - minX) / 2,
    hz: (maxZ - minZ) / 2,
    ox: (minX + maxX) / 2,
    oz: (minZ + maxZ) / 2,
  };
}

/** Polar radius of the axis-aligned ellipse at angle θ (θ=0 → +Z, toward
 *  +X): the r solving `(r sinθ / hx)² + (r cosθ / hz)² = 1`. */
export function ellipseRadiusAt(hx: number, hz: number, theta: number): number {
  if (hx <= 0 || hz <= 0) {
    throw new Error(`Ellipse radii must be positive (hx=${hx}, hz=${hz}).`);
  }
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  return 1 / Math.sqrt((sin * sin) / (hx * hx) + (cos * cos) / (hz * hz));
}

/** Farthest intersection distance of the ray from `(ox, oz)` in direction
 *  `(sin θ, cos θ)` against the slice segments; 0 when nothing is hit. */
export function radialDistance(
  segments: ArrayLike<number>,
  ox: number,
  oz: number,
  theta: number,
): number {
  const dirX = Math.sin(theta);
  const dirZ = Math.cos(theta);
  let farthest = 0;
  for (let index = 0; index < segments.length; index += 4) {
    const ax = segments[index]! - ox;
    const az = segments[index + 1]! - oz;
    const bx = segments[index + 2]! - ox;
    const bz = segments[index + 3]! - oz;
    const ex = bx - ax;
    const ez = bz - az;
    // Solve a + s·e = t·dir for s ∈ [0,1], t ≥ 0 via 2D cross products.
    const denominator = dirX * ez - dirZ * ex;
    if (Math.abs(denominator) < 1e-12) continue; // parallel (or degenerate) segment
    const s = (dirZ * ax - dirX * az) / denominator;
    if (s < 0 || s > 1) continue;
    const t = Math.abs(dirX) >= Math.abs(dirZ) ? (ax + s * ex) / dirX : (az + s * ez) / dirZ;
    if (t > farthest) farthest = t;
  }
  return farthest;
}

/**
 * The residual outline: the slice's radial distance from the fitted-ellipse
 * center at `count` uniform angles, each normalized by the ellipse's own
 * radius at that angle. 1 everywhere ⇒ the slice IS the ellipse; >1 bulges
 * past it (a square slice reads √2 at its corners); 0 ⇒ no outline hit on
 * that ray (e.g. a hollow/degenerate direction).
 */
export function radialResiduals(
  segments: ArrayLike<number>,
  ellipse: SliceEllipse,
  count = 16,
): number[] {
  if (!Number.isInteger(count) || count < 4) {
    throw new Error(`Radial sample count must be an integer >= 4, got ${count}.`);
  }
  const residuals: number[] = [];
  for (let index = 0; index < count; index++) {
    const theta = (index * 2 * Math.PI) / count;
    const radius = radialDistance(segments, ellipse.ox, ellipse.oz, theta);
    residuals.push(radius / ellipseRadiusAt(ellipse.hx, ellipse.hz, theta));
  }
  return residuals;
}
