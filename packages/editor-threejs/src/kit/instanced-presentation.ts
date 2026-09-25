/**
 * What an `InstancedMesh` IS to a reader looking at it — derived by measuring
 * the live object, never by guessing what the game meant.
 *
 * ## The two questions, and why the second one exists
 *
 * 1. **How many units does this row draw?** Every other count in the editor is
 *    keyed on OBJECTS, and an `InstancedMesh` is one object drawing N units, so
 *    a hierarchy row reports 1 where a reader sees 200 — both numbers correct,
 *    no error anywhere. `ThreeWalkStats.instances`
 *    (`projection/three.ts`) is the world-level half of the same
 *    shortfall; this is the per-node half.
 *
 * 2. **Is this a WORLD-ANCHORED instanced system?** The measured case
 *    (2026-08-16, the vendored racing-game): `Dust` and `Skid` write per-unit
 *    matrices in WORLD coordinates — `wheels[2].current.getWorldPosition(v)` →
 *    `setItemAt` — while the `instancedMesh` container sits at identity at the
 *    world origin, deliberately, because a skid mark must stay where it was laid
 *    (`vendor/games/racing-game/src/models/vehicle/Vehicle.tsx` renders both
 *    OUTSIDE `<Chassis>` for exactly that reason). Selecting one put the
 *    selection cage and the gizmo on (0,0,0) while every unit the reader can see
 *    is out at the car — measured live: focusing `Dust` flew the camera inside
 *    the canyon to two bracket marks at the origin, which reads as a broken
 *    editor rather than as a correctly-drawn trail system.
 *
 * The class is the native-engine vocabulary (Unity calls it simulation space).
 * We do not read the game's intent to find it: the SIGNATURE is measurable and
 * three.js forces it — to write world coordinates into instance matrices the
 * container's own world matrix MUST be identity, so "identity container, content
 * elsewhere" is the pattern's fingerprint and not an inference about it.
 *
 * ## What "elsewhere" is measured against, and why it is not a threshold
 *
 * The reference volume is the container's OWN drawn geometry, sitting at its own
 * origin. That is the only intrinsic scale an instanced draw has, and it makes
 * the test tuning-free: content whose centre still falls inside the shape the
 * container itself draws is content the pivot is already on top of, and nothing
 * about that reads as broken.
 *
 * It also makes the answer honest at REST, which matters more than it looks.
 * `new InstancedMesh(geometry, material, count)` seeds every unit to IDENTITY
 * (three r180 `InstancedMesh.js` — the constructor's `setMatrixAt(i, _identity)`
 * loop), so a system that has placed nothing yet genuinely draws `count` copies
 * stacked on the container's origin. There is no world-space anchoring to see
 * there, and the class correctly does not fire until the game has actually put
 * content somewhere else.
 */

import * as THREE from 'three';

/**
 * Element-wise slack against the identity matrix. Generous enough to survive
 * the float round-trip of a `Matrix4` composed from an untouched
 * position/quaternion/scale, tight enough that any authored placement — a
 * millimetre offset included — fails it.
 */
const IDENTITY_EPSILON = 1e-4;

/** The world-anchored class's ONE sentence, shown verbatim wherever it appears. */
export const WORLD_ANCHORED_INSTANCED_NOTE =
  'World-anchored — content is placed in world space by the game each frame; moving this container offsets future placements away from their source.';

/** Everything both surfaces need about one node's instancing, or `null` when the
 *  node is not an instanced draw at all. */
export interface InstancedPresentation {
  /** `InstancedMesh.count` — the units this one object draws. Always ≥ 1. */
  readonly units: number;
  /** The hierarchy row's dim detail: `200 instanced units`. */
  readonly detail: string;
  /** True for the class described in the module header. */
  readonly worldAnchored: boolean;
  /** {@link WORLD_ANCHORED_INSTANCED_NOTE} when {@link worldAnchored}, else `null`. */
  readonly note: string | null;
}

/**
 * `InstancedMesh.count`, or 0 for anything that is not one.
 *
 * `count` is the DRAWN range, not the allocated capacity, which is the number a
 * reader is looking at. A count of 0 is not an instanced draw for presentation
 * purposes — there is nothing to annotate — so it answers 0 like a plain mesh.
 */
export function instancedUnitCount(object: THREE.Object3D | null | undefined): number {
  if (!object) return 0;
  const instanced = object as THREE.Object3D & { isInstancedMesh?: boolean; count?: number };
  if (instanced.isInstancedMesh !== true) return 0;
  const count = instanced.count;
  return typeof count === 'number' && count > 0 ? count : 0;
}

/** Is `matrix` the identity matrix, within {@link IDENTITY_EPSILON}? */
export function isNearIdentityMatrix(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  for (let i = 0; i < 16; i++) {
    const expected = i % 5 === 0 ? 1 : 0;
    const value = e[i]!;
    if (!Number.isFinite(value) || Math.abs(value - expected) > IDENTITY_EPSILON) return false;
  }
  return true;
}

/** Scratch for the reference volume below — this module is synchronous and
 *  single-threaded, so one instance serves every call. */
const pivotVolume = new THREE.Box3();
const contentCentre = new THREE.Vector3();

/**
 * The whole presentation verdict for one live node.
 *
 * `contentBounds` is the node's measured world-space content (`content-bounds.ts`
 * — `contentWorldBounds`, which resolves instance matrices live rather than
 * through three's cached object box). It is passed IN rather than measured here
 * so this module stays a pure predicate: a caller that has the walk already does
 * not pay for a second one, and a test can state the geometry directly.
 */
export function describeInstancedPresentation(
  object: THREE.Object3D | null | undefined,
  contentBounds: THREE.Box3 | null | undefined,
): InstancedPresentation | null {
  const units = instancedUnitCount(object);
  if (units === 0) return null;
  const worldAnchored = isWorldAnchored(object as THREE.InstancedMesh, contentBounds);
  return {
    units,
    detail: unitsLabel(units),
    worldAnchored,
    note: worldAnchored ? WORLD_ANCHORED_INSTANCED_NOTE : null,
  };
}

function isWorldAnchored(
  mesh: THREE.InstancedMesh,
  contentBounds: THREE.Box3 | null | undefined,
): boolean {
  if (!contentBounds || contentBounds.isEmpty()) return false;
  if (!isNearIdentityMatrix(mesh.matrixWorld)) return false;
  const geometry = mesh.geometry;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return false;
  // The container's own drawn shape, at its own (identity) origin — see the
  // header. A degenerate box still works: a flat plane's centre test is the
  // in-plane one, which is the right question for a decal system.
  pivotVolume.copy(geometry.boundingBox);
  contentBounds.getCenter(contentCentre);
  return !pivotVolume.containsPoint(contentCentre);
}

/**
 * The hierarchy row's detail for `id`, or `null` — the whole of what a row needs.
 *
 * Rows are rendered for every visible node on every notify, so this is
 * deliberately the CHEAP half: a type check and a number read, with no bounds
 * walk. The world-anchored class costs a walk and is therefore an
 * inspector-only fact, on the one node the reader has actually selected.
 */
export function instancedRowDetail(object: THREE.Object3D | null | undefined): string | null {
  const units = instancedUnitCount(object);
  return units === 0 ? null : unitsLabel(units);
}

/** The ONE wording, so the row and the inspector cannot drift apart. */
function unitsLabel(units: number): string {
  return `${units} instanced unit${units === 1 ? '' : 's'}`;
}
