/**
 * pixi — the PixiJS surface substrate.
 *
 * PixiJS is opt-in: the engine core never imports it, so a three-only bundle
 * never pays for it. What lives here is what the host needs to mount and
 * inspect a PixiJS game it did not write — the render-call capture trap, the
 * in-realm mount, the live display-tree authoring adapter, and the
 * Rapier-2D handle registry the editor's transform coordination reads.
 */

export {
  AuthoringAdapter2D,
  type CanvasIdentity,
  type EditorNode2D,
  type Overlay2D,
  type Override2D,
  type Property2D,
  STRUCTURAL_CANVAS_IDENTITY,
  type Transform2DValue,
} from './authoring';
export { type IngestGame2D, type IngestMount2D, mountIngestGame2D } from './ingest';
export {
  createPhysics2DRegistry,
  type Physics2DRefs,
  type Physics2DRegistry,
} from './physics-registry';
export {
  type CapturedRuntime2D,
  installSceneCapture2D,
  type SceneCapture2DHandle,
} from './scene-capture';
export { createPhysicsAdapter2D, type PhysicsAdapter2D } from './system-adapters';
