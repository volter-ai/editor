/**
 * The engine's runtime descriptor schemas.
 *
 * Each module is here because a real runtime READER consumes it — nothing in
 * this directory exists as documentation of a format:
 *
 * - `material.ts`   — the inline material descriptor `render/material-factory.ts` reads
 * - `mesh.ts`        — the geometry descriptor `render/material-factory.ts`'s `createGeometry` reads
 * - `light.ts` / `camera.ts` — the descriptors `render/light-camera-factory.ts` reads
 * - `collider.ts`    — the descriptor `physics/collider-dimensions.ts` and the editor's
 *                     collider gizmos read
 * - `particles.ts`   — the descriptor `render/particles-factory.ts` reads
 * - `render-settings.ts` — the tone-mapping / post-processing / render-feature scopes
 *                     `setup/setup-renderer.ts` reads
 * - `tuples.ts`      — the shared Vec3/Quat/Transform tuples the above build on
 *
 * These are DESCRIPTORS, not documents: each names a slice of authored data a
 * render/physics factory reads, and none of them is a scene — which is why
 * every one of them is named `*Descriptor`.
 */

export type { CameraDescriptor } from './camera';
export { CameraDescriptorSchema } from './camera';
export type { ColliderDescriptor } from './collider';
export { ColliderDescriptorSchema } from './collider';
export type { LightDescriptor } from './light';
export { LightDescriptorSchema } from './light';
export type { MaterialDescriptor } from './material';
export { MaterialDescriptorSchema } from './material';
export type { MeshDescriptor } from './mesh';
export { MeshDescriptorSchema } from './mesh';
export type { ParticlesDescriptor } from './particles';
export { ParticlesDescriptorSchema } from './particles';
export type {
  PostProcessingDescriptor,
  RenderEnvironment,
  ToneMappingDescriptor,
} from './render-env';
export {
  PostProcessingDescriptorSchema,
  RenderEnvironmentSchema,
  ToneMappingDescriptorSchema,
} from './render-env';
export type { Quat, Transform, Vec3 } from './tuples';
export { QuatSchema, TransformSchema, Vec3Schema } from './tuples';
