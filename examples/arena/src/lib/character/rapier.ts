/**
 * Rapier's own types, taken from the provider that hands them to you.
 *
 * These are aliases, not shapes: every one is derived from
 * `@react-three/rapier`'s `RapierContext` — the object `useRapier()` returns —
 * so the capability's parameter types are, by construction, exactly what the
 * running `<Physics>` provider produces.
 *
 * Do NOT swap these for a direct `@dimforge/rapier3d-compat` import. That
 * package can legitimately be installed more than once through different
 * dependency paths. Rapier's classes carry private fields, so two copies' types are
 * mutually unassignable, and typing against the wrong one produces a
 * capability that cannot be called with the world the game actually has —
 * `Type 'World' is missing the following properties from type 'World'`. Both
 * shipped examples avoid this the same way: they import from
 * `@react-three/rapier` and never from `@dimforge` at all.
 */

import type { RapierContext } from '@react-three/rapier';

export type { RapierCollider, RapierRigidBody } from '@react-three/rapier';

/** The live physics world — `const { world } = useRapier()`. */
export type RapierWorld = RapierContext['world'];

/** Rapier's kinematic character controller, as this world creates it. */
export type CapsuleController = ReturnType<RapierWorld['createCharacterController']>;

/** Just enough of the Rapier module to build a ray — `const { rapier } = useRapier()`. */
export type RayFactory = Pick<RapierContext['rapier'], 'Ray'>;

/**
 * `QueryFilterFlags`, as the world this game actually has declares them —
 * derived from the controller's own signature so it is the right copy by
 * construction, exactly like every other type in this file.
 */
export type QueryFilterFlags = NonNullable<
  Parameters<CapsuleController['computeColliderMovement']>[2]
>;

/**
 * `QueryFilterFlags.EXCLUDE_SENSORS`, spelled as its value rather than
 * imported.
 *
 * Every scene query in this capability passes it, because a SENSOR is a
 * trigger volume — a checkpoint, a kill zone, a pickup — and Rapier's scene
 * queries do NOT skip one unless told to. A character controller that solves
 * against sensors stops dead at the edge of every trigger in the level and the
 * intersection is never reported; a camera boom that ray-casts against them
 * pulls in on thin air.
 *
 * Excluding them costs nothing that a trigger needs: intersections are
 * computed by the PHYSICS STEP, not by these queries, so `onIntersectionEnter`
 * (and Rapier's own `intersectionPair`) still fire for a capsule that walked
 * through. That split is the whole sensor contract.
 *
 * There is a SECOND half to that contract, and it is not this capability's to
 * set: Rapier's default `ActiveCollisionTypes` report DYNAMIC pairs only, so a
 * KINEMATIC character never fires a FIXED trigger's `onIntersectionEnter` no
 * matter what these queries do. The character's own collider is the one place
 * to widen it — `<CapsuleCollider activeCollisionTypes={ActiveCollisionTypes
 * .ALL}>`, or one `collider.setActiveCollisionTypes(…)` where you already hold
 * the collider — rather than every trigger volume the game ever authors. The
 * capability cannot choose that policy because it owns no collider; a game
 * relying on fixed sensors sets it on its character prefab's collider.
 *
 * The value, not the import, because `QueryFilterFlags` is a runtime enum: an
 * `import { QueryFilterFlags } from '@dimforge/rapier3d-compat'` is a VALUE
 * import of a package this capability deliberately does not depend on (see the
 * header) and drags a second wasm-carrying Rapier copy into the bundle for one
 * bit. `8` is that bit, identical in every Rapier this repo installs; the
 * capability's test pins it against the real enum so it cannot silently drift.
 */
export const EXCLUDE_SENSORS = 8 as QueryFilterFlags;
