import * as THREE from 'three';

/**
 * Accept a Three.js Scene across package/bundle boundaries.
 *
 * A registry-installed project owns its own `three` module while the packaged
 * editor already has Three bundled. Those constructors are intentionally not
 * referentially identical, so `instanceof THREE.Scene` alone rejects the
 * project's valid scene. `isScene` is Three's public structural brand for
 * exactly this kind of boundary.
 */
export function isThreeScene(value: unknown): value is THREE.Scene {
  return (
    value instanceof THREE.Scene ||
    (value !== null &&
      typeof value === 'object' &&
      (value as { isScene?: unknown }).isScene === true)
  );
}
