/**
 * Rest-relative clip authoring + the clip self-checks
 * (`createRestRelativeQuaternionTrack`, `assertClipRestBoundaries`,
 * `assertClipLoops`, `sampleAnimatedDeformedBounds`).
 *
 * The implementation MOVED to `../bake/rest-relative-animation`: it is
 * skeleton-agnostic — it speaks `THREE.Bone`/`THREE.Object3D`/
 * `THREE.AnimationClip` and nothing humanoid — and a walking castle wants it
 * as much as a character does, so it belongs at family level beside
 * `../bake/clip-layering`. This file stays as a verbatim re-export so every
 * import path that ever worked still does; there is no deprecation and
 * nothing to migrate.
 */

export * from '../bake/rest-relative-animation';
