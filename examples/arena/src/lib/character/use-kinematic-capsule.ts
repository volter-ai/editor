/**
 * The thin R3F wiring around `advanceCapsule`.
 *
 * It is a hook rather than a wrapper component because a character HAS
 * movement; it is not nested inside a controller component. Everything this
 * hook does is lifecycle — make the controller,
 * hand it back to Rapier on unmount, and read gravity from the physics world
 * so `<Physics gravity={…}>` actually reaches the character.
 *
 * The returned `advance(position, planarVelocity, verticalVelocity, dt)` is
 * called from the caller's OWN `useFrame`. Nothing here runs a loop, reads
 * input, or touches a camera.
 *
 * `null` means the body has not mounted yet.
 */

import { type RapierRigidBody, useRapier } from '@react-three/rapier';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import {
  type AdvanceCapsule,
  advanceCapsule,
  CAPSULE_TUNING,
  type CapsuleTuning,
  createCapsuleController,
} from './kinematic-capsule';

export function useKinematicCapsule(
  body: RefObject<RapierRigidBody | null>,
  tuning: Partial<CapsuleTuning> = {},
): AdvanceCapsule {
  const { world } = useRapier();
  const controller = useRef<ReturnType<typeof world.createCharacterController> | null>(null);
  const settings = { ...CAPSULE_TUNING, ...tuning };

  // Every setting is a separate dependency on purpose: a caller passing an
  // inline `{ autostepHeight: 0.8 }` literal hands us a new object every
  // render, so depending on `tuning` itself would rebuild the controller each
  // frame — while depending on nothing would make the inspector's edits dead.
  const {
    applyImpulsesToDynamicBodies,
    autostepDynamicBodies,
    autostepHeight,
    autostepMinWidth,
    maxSlopeClimbAngle,
    minSlopeSlideAngle,
    offset,
    snapToGround,
  } = settings;

  useEffect(() => {
    const made = createCapsuleController(world, {
      applyImpulsesToDynamicBodies,
      autostepDynamicBodies,
      autostepHeight,
      autostepMinWidth,
      maxSlopeClimbAngle,
      minSlopeSlideAngle,
      offset,
      snapToGround,
    });
    controller.current = made;
    // A character controller is a Rapier-side allocation, not a JS object: the
    // world holds it until it is handed back, so an editor remount that does
    // not return it leaks one per mount.
    return () => {
      controller.current = null;
      world.removeCharacterController(made);
    };
  }, [
    world,
    applyImpulsesToDynamicBodies,
    autostepDynamicBodies,
    autostepHeight,
    autostepMinWidth,
    maxSlopeClimbAngle,
    minSlopeSlideAngle,
    offset,
    snapToGround,
  ]);

  return useCallback(
    (position, planarVelocity, verticalVelocity, dt) => {
      const rigidBody = body.current;
      const character = controller.current;
      const collider = rigidBody?.collider(0);
      if (!rigidBody || !character || !collider) return null;
      return advanceCapsule({
        collider,
        controller: character,
        dt,
        gravity: world.gravity.y,
        planarVelocity,
        position,
        rigidBody,
        verticalVelocity,
        snapToGround,
      });
    },
    [body, world, snapToGround],
  );
}
