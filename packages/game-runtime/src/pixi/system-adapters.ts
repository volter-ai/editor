import type { PhysicsAdapter2D } from '@volter/editor-project/adapter/physics-adapter-2d';
import type { Container } from 'pixi.js';
import type { Physics2DRegistry } from './physics-registry';

export type { PhysicsAdapter2D } from '@volter/editor-project/adapter/physics-adapter-2d';

export function createPhysicsAdapter2D(physics: Physics2DRegistry): PhysicsAdapter2D {
  // Remember each frozen body's prior type so unfreeze restores it.
  const frozen = new WeakMap<Container, number>();
  return {
    keyedBy: 'display',
    ownerOf(display) {
      const refs = physics.get(display);
      if (!refs) return 'none';
      return refs.body.isDynamic() || refs.body.isKinematic() ? 'physics' : 'none';
    },
    freeze(display) {
      const refs = physics.get(display);
      if (!refs) return;
      frozen.set(display, refs.body.bodyType());
      // Kinematic-position bodies hold a pose without being driven by forces.
      refs.body.setBodyType(2 /* KinematicPositionBased */, true);
    },
    commit(display, position, rotation) {
      const refs = physics.get(display);
      if (!refs) return;
      refs.body.setTranslation({ x: position[0], y: position[1] }, true);
      refs.body.setRotation(rotation, true);
    },
    unfreeze(display) {
      const refs = physics.get(display);
      if (!refs) return;
      const prior = frozen.get(display);
      if (prior !== undefined) {
        refs.body.setBodyType(prior, true);
        frozen.delete(display);
      }
    },
  };
}

/**
 * ONE carrier over several, each owning a DIFFERENT set of display objects.
 *
 * The canvas ingest mount is the case: the host always builds a registry-backed
 * carrier for objects the editor itself created, and an ingested game may ALSO
 * declare one over its own simulation's objects. Neither is a superset of the
 * other and neither can answer for the other's objects, so the composition is
 * ownership-routed rather than layered — `ownerOf` asks each in order and the
 * FIRST to claim the object handles every other call for it. A display object
 * nobody claims answers `'none'` and the freeze/commit/unfreeze trio no-ops,
 * which is exactly what a single unclaiming carrier already does.
 *
 * Order is precedence: earlier carriers win a (never-expected) double claim,
 * so the caller states its own preference instead of this function inventing
 * one.
 */
export function composePhysicsAdapters2D(carriers: readonly PhysicsAdapter2D[]): PhysicsAdapter2D {
  const ownerFor = (display: Container): PhysicsAdapter2D | null =>
    carriers.find((carrier) => carrier.ownerOf(display) === 'physics') ?? null;
  return {
    keyedBy: 'display',
    ownerOf: (display) => (ownerFor(display) ? 'physics' : 'none'),
    freeze: (display) => ownerFor(display)?.freeze(display),
    commit: (display, position, rotation) => ownerFor(display)?.commit(display, position, rotation),
    unfreeze: (display) => ownerFor(display)?.unfreeze(display),
  };
}
