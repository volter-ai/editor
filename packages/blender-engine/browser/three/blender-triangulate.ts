/**
 * `triangulate` — how a BMesh FACE becomes triangles, and the one place that
 * decision is made.
 *
 * A `BMesh` face is an n-gon; a `BufferGeometry` is triangles. The conversion
 * used to be a naive fan (`0,1,2`, `0,2,3`, `0,3,4`, …), which is correct for
 * a CONVEX polygon and silently wrong for a concave one: the fan's later
 * triangles fold back over the polygon's own reflex corner, so they overlap
 * each other and face BACKWARDS. That renders as a hole. It shipped as one —
 * the treasure chest's crescent lid end-cap (docs/BLENDER-PARITY.md §Driver
 * ladder, "Chest-measured gaps") — and, worse, `validate()` had nothing to say
 * about it, because every count and every winding on the BMesh side was
 * perfectly sound. The defect only existed in the export.
 *
 * So the export's triangulation is now a real one, and it is the SAME
 * function `validate` checks, which is what closes the gap: there is no way
 * for the exporter to fan something the validator did not look at.
 *
 * THE RUNG. Ear clipping is not hand-rolled here: `THREE.ShapeUtils
 * .triangulateShape` is three's own Earcut and ships in the dependency the
 * kit already has. This module supplies only the two things Earcut cannot do
 * for a 3D face — pick the plane to flatten onto, and decide whether the
 * result is trustworthy.
 *
 * THE FAN IS STILL THE FAST PATH, and deliberately so. Every face is fanned
 * FIRST and the fan is kept whenever it is sound, so every convex face — which
 * is nearly all of them, quads included — exports with byte-identical indices
 * to before this module existed. Earcut runs only where the fan actually
 * fails. That is not an optimization: it is what lets an existing model be
 * rebuilt through the fixed kit and change ONLY where it was broken.
 */

import * as THREE from 'three';

/** One triangle, as indices into the polygon's own corner order. */
export type TriangleIndices = readonly [number, number, number];

/** What `triangulatePolygon` decided, and whether to trust it. */
export interface PolygonTriangulation {
  /** The triangles, in the polygon's own corner-index space and its own
   *  winding. Always `n − 2` of them when `sound`; possibly fewer, or
   *  overlapping, when not. */
  readonly triangles: readonly TriangleIndices[];
  /** Whether this is a genuine PARTITION of the polygon: `n − 2` triangles,
   *  every one wound with the polygon, and their absolute areas summing to
   *  the polygon's own. Overlap or a fold-back makes the sum exceed the
   *  polygon area, so the two conditions together are exactly the property
   *  that fails when a triangulation renders as a hole.
   *
   *  FALSE is a real defect and stays visible rather than being smoothed
   *  over: it means the polygon is self-intersecting or so badly warped that
   *  no flattening of it is simple, and neither the fan nor Earcut can fix
   *  that. `validate` reports it as `overlappingTriangulation`. */
  readonly sound: boolean;
  /** Which path produced `triangles` — `'fan'` is the untouched legacy
   *  layout, `'earcut'` is `THREE.ShapeUtils.triangulateShape`. */
  readonly method: 'fan' | 'earcut';
}

/** Relative slack on the area-sum test, in units of the polygon's own area.
 *  Generous enough that float noise on a big polygon never fires it, tight
 *  enough that a single folded-back ear (which doubles some sub-area) always
 *  does. */
const AREA_TOLERANCE = 1e-6;

/** The polygon's Newell area-weighted normal — the standard best-fit plane
 *  for a possibly non-planar face, and the one whose length is twice the
 *  projected area. */
function newellNormal(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as THREE.Vector3;
    const b = points[(i + 1) % points.length] as THREE.Vector3;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.multiplyScalar(0.5);
}

/** Twice the signed area of a 2D triangle (positive = counter-clockwise). */
const cross2 = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** The consecutive fan from corner 0 — the layout every export used before
 *  this module, reproduced exactly so a sound fan stays byte-identical. */
const fanOf = (n: number): TriangleIndices[] =>
  Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2] as const);

/** Twice the signed area of the projected polygon (shoelace). */
function polygonArea2(flat: readonly THREE.Vector2[]): number {
  let sum = 0;
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i] as THREE.Vector2;
    const b = flat[(i + 1) % flat.length] as THREE.Vector2;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Is `triangles` a partition of the projected polygon — right count, all
 *  wound with it, and no area double-covered? See `PolygonTriangulation
 *  .sound`. */
function isSound(
  triangles: readonly TriangleIndices[],
  flat: readonly THREE.Vector2[],
  area2: number,
): boolean {
  if (triangles.length !== flat.length - 2) return false;
  if (!(Math.abs(area2) > 0)) return false;
  const sign = Math.sign(area2);
  let covered = 0;
  for (const [i, j, k] of triangles) {
    const t = cross2(flat[i] as THREE.Vector2, flat[j] as THREE.Vector2, flat[k] as THREE.Vector2);
    // A sliver of exactly zero area is harmless (it covers nothing and hides
    // nothing); a triangle wound AGAINST the polygon is the fold-back.
    if (t * sign < 0) return false;
    covered += Math.abs(t);
  }
  return Math.abs(covered - Math.abs(area2)) <= AREA_TOLERANCE * Math.abs(area2);
}

/**
 * Triangulate one polygon given its corner positions in order.
 *
 * The polygon is flattened onto its own Newell plane with a right-handed
 * basis, so the projection keeps the polygon's winding and the resulting
 * triangles come back in the corner-index space the caller passed in. Under 3
 * corners there is nothing to do; at exactly 3 the single triangle IS the
 * polygon.
 *
 * A degenerate face — zero Newell normal, i.e. no plane to flatten onto — is
 * reported as an unsound fan rather than throwing: `validate` already has
 * `degenerateFace` for that condition and says it better, and an exporter
 * that threw here would refuse a mesh it could still write.
 */
export function triangulatePolygon(points: readonly THREE.Vector3[]): PolygonTriangulation {
  const n = points.length;
  if (n < 3) return { triangles: [], sound: false, method: 'fan' };
  if (n === 3) return { triangles: [[0, 1, 2]], sound: true, method: 'fan' };

  const normal = newellNormal(points);
  const length = normal.length();
  if (!(length > 0) || !Number.isFinite(length)) {
    return { triangles: fanOf(n), sound: false, method: 'fan' };
  }
  const w = normal.clone().divideScalar(length);
  // Any vector not parallel to w gives a usable in-plane axis.
  const seed = Math.abs(w.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(seed, w).normalize();
  const v = new THREE.Vector3().crossVectors(w, u);
  const origin = points[0] as THREE.Vector3;
  const flat = points.map((p) => {
    const d = p.clone().sub(origin);
    return new THREE.Vector2(d.dot(u), d.dot(v));
  });
  const area2 = polygonArea2(flat);

  const fan = fanOf(n);
  if (isSound(fan, flat, area2)) return { triangles: fan, sound: true, method: 'fan' };

  // The fan folded back. Hand the flattened contour to three's own Earcut.
  let earcut: TriangleIndices[] = [];
  try {
    earcut = THREE.ShapeUtils.triangulateShape(flat as THREE.Vector2[], []).map(
      (t) => [t[0] as number, t[1] as number, t[2] as number] as const,
    );
  } catch {
    // Earcut refuses a contour it cannot read at all; the fan is still the
    // honest thing to hand back, flagged unsound.
    return { triangles: fan, sound: false, method: 'fan' };
  }
  if (isSound(earcut, flat, area2)) return { triangles: earcut, sound: true, method: 'earcut' };
  // Earcut produced something, but not a partition: keep it (it is still
  // closer than the fan) and let `validate` name the face.
  return {
    triangles: earcut.length > 0 ? earcut : fan,
    sound: false,
    method: earcut.length > 0 ? 'earcut' : 'fan',
  };
}
