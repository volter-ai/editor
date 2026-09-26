/**
 * The trap this file exists for: a foothold THINNER than the controller's reach
 * tunnels, and nothing says so.
 *
 * Measured, in a real build: a 0.28 m-thick `CuboidCollider` under a capsule
 * whose controller reaches `offset + snapToGround` = 0.47 m below its feet. The
 * solver's ground probe reaches straight through the slab and out the far side,
 * so `computedGrounded()` flip-flops frame to frame, the character's y
 * oscillates, and eventually it falls clean through and keeps going. Every
 * symptom points at gravity, at the jump code, at the animation — the collider
 * that actually caused it looks fine in the editor, because the VISUAL is the
 * authored size and only the collider is thin. That hunt cost ~8 minutes and
 * three wrong diagnoses; the collider was never suspected, because nothing
 * anywhere connected the two numbers.
 *
 * So the step primitive connects them: on the first frame the capsule stands on
 * a collider too thin for its own reach, it says so, by name, with both numbers
 * and the fix.
 *
 * Only FOOTHOLDS are checked — contacts whose normal is a surface this
 * controller could stand on. A thin WALL is not this defect: the only reach a
 * wall contact sees is the skin `offset` (0.02 m by default), never
 * `snapToGround`, which is a downward probe. Warning about thin walls would be
 * pure noise, and noise is how a real warning gets ignored.
 *
 * Cost: `numComputedCollisions()` plus one `computedCollision(i, out)` per
 * contact, per frame — the same wasm calls a game that reads its own contacts
 * makes, into a REUSED out object, so nothing is allocated after the first
 * frame. Everything past that is gated on a `WeakSet` hit: a collider is
 * measured ONCE, the first time it is stood on, and never again for the life of
 * the page. So the steady-state cost of walking around a level is one integer
 * read, one normal comparison and one set lookup per contact.
 */

import type { CapsuleController, RapierCollider } from './rapier';

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * `ShapeType` values, spelled rather than imported — the same call this
 * capability's `EXCLUDE_SENSORS` makes, for the same reason: a VALUE import of
 * `@dimforge/rapier3d-compat` drags a second wasm-carrying Rapier copy into the
 * bundle for a handful of integers (see `rapier.ts`). Identical in every Rapier
 * this repo installs, and the capability's test pins them against the real enum
 * so they cannot silently drift.
 */
export const MEASURED_SHAPE_TYPES = {
  Ball: 0,
  Capsule: 2,
  Cone: 11,
  Cuboid: 1,
  Cylinder: 10,
  RoundCuboid: 12,
  RoundCylinder: 14,
} as const;

/** Rapier's concrete shapes, structurally — see `rapier.ts` on not importing them. */
interface ShapeLike {
  readonly borderRadius?: number;
  readonly halfExtents?: Vec3;
  readonly halfHeight?: number;
  readonly radius?: number;
  readonly type: number;
}

/** Rotate a world-space direction into the collider's own frame. */
function intoLocal(v: Vec3, q: { w: number; x: number; y: number; z: number }): Vec3 {
  // The conjugate rotates world → local for a unit quaternion.
  const x = -q.x;
  const y = -q.y;
  const z = -q.z;
  const w = q.w;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/**
 * How much solid material lies along `worldNormal`, in metres — the shape's own
 * width in that direction, which for a floor slab is exactly its thickness.
 *
 * `null` for shapes with no solid thickness to measure: a trimesh, heightfield,
 * polyline or half-space is a SURFACE, not a slab, so the far side the solver
 * would reach through does not exist and this defect cannot occur. Convex hulls
 * are skipped too — their width needs a support-point search, which is not a
 * cost this is worth paying on a contact.
 *
 * Every branch is an UPPER bound (a box's projected width when the normal is
 * off-axis; a cone measured as its widest cylinder), so this errs toward
 * silence. A warning that fires is always a real one.
 */
function widthAlongNormal(collider: RapierCollider, worldNormal: Vec3): number | null {
  const shape = collider.shape as unknown as ShapeLike;
  const n = intoLocal(worldNormal, collider.rotation());
  const border = shape.borderRadius ?? 0;
  switch (shape.type) {
    case MEASURED_SHAPE_TYPES.Ball:
      return 2 * (shape.radius ?? 0);
    case MEASURED_SHAPE_TYPES.Cuboid:
    case MEASURED_SHAPE_TYPES.RoundCuboid: {
      const h = shape.halfExtents;
      if (!h) return null;
      return 2 * (Math.abs(n.x) * h.x + Math.abs(n.y) * h.y + Math.abs(n.z) * h.z + border);
    }
    case MEASURED_SHAPE_TYPES.Capsule: {
      // Axis is y: the caps are spheres, so the radius is there whatever the angle.
      return 2 * ((shape.radius ?? 0) + (shape.halfHeight ?? 0) * Math.abs(n.y));
    }
    case MEASURED_SHAPE_TYPES.Cone:
    case MEASURED_SHAPE_TYPES.Cylinder:
    case MEASURED_SHAPE_TYPES.RoundCylinder: {
      const lateral = Math.sqrt(Math.max(0, 1 - n.y * n.y));
      return 2 * ((shape.halfHeight ?? 0) * Math.abs(n.y) + (shape.radius ?? 0) * lateral + border);
    }
    default:
      return null;
  }
}

/**
 * Every collider already measured, so the warning fires ONCE per collider per
 * session however many frames the character spends standing on it.
 *
 * Ownership: module state, keyed on Rapier's own `Collider` object rather than
 * its handle — handles are recycled across worlds, object identity is not, and
 * a `WeakSet` lets a removed collider be collected with nothing to clear. There
 * is deliberately no reset: "once per session" IS the contract, and a per-frame
 * warning that can flood a console is what the dedup exists to prevent.
 */
const measured = new WeakSet<object>();

/** Rapier's collision record, reused across frames rather than reallocated. */
type Collision = NonNullable<ReturnType<CapsuleController['computedCollision']>>;
let scratch: Collision | undefined;

function metres(value: number): string {
  return value.toFixed(2);
}

/**
 * Inspect the contacts the last `computeColliderMovement` produced and warn
 * about any foothold thinner than the controller can reach.
 *
 * Called by `advanceCapsule`; there is nothing for a game to wire up.
 */
export function warnOnThinFootholds(controller: CapsuleController, snapToGround: number): void {
  const count = controller.numComputedCollisions();
  if (count === 0) return;

  const offset = controller.offset();
  const reach = offset + snapToGround;
  // A surface this controller could stand on — the same limit the solve used.
  const standable = Math.cos(controller.maxSlopeClimbAngle());

  for (let i = 0; i < count; i += 1) {
    const hit = controller.computedCollision(i, scratch);
    if (!hit) continue;
    scratch = hit;
    const collider = hit.collider;
    // A ceiling or a wall is not a foothold: `snapToGround` only probes down.
    if (!collider || hit.normal1.y <= standable) continue;
    if (measured.has(collider)) continue;
    measured.add(collider);

    const thickness = widthAlongNormal(collider, hit.normal1);
    if (thickness === null || thickness >= reach) continue;

    const at = collider.translation();
    console.warn(
      `[character] thin foothold: collider #${collider.handle} at ` +
        `(${metres(at.x)}, ${metres(at.y)}, ${metres(at.z)}) is ${metres(thickness)} m thick, ` +
        `thinner than this capsule controller's ${metres(reach)} m reach ` +
        `(offset ${metres(offset)} + snapToGround ${metres(snapToGround)}). ` +
        'The solver probes straight through it, so ground contact flickers frame to frame ' +
        'and the capsule can fall clean through. ' +
        `Fix: give every foothold a solid collider at least ${metres(reach)} m thick; ` +
        'keep the visual its authored size.',
    );
  }
}
