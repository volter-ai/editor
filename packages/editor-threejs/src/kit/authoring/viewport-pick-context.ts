/**
 * Viewport pick context (B4, D12) — the camera/canvas seam that
 * `VgaiSceneAuthoringAdapter.pickable.pick` needs but cannot own itself: both
 * live on `EditorViewport`, not on the adapter (the adapter only ever held a
 * `store` — see its own doc comment). A tiny module-level slot, same shape as
 * `./active-systems.ts`: `EditorViewport`'s constructor sets it once its
 * camera/canvas exist; its `dispose()` clears it.
 *
 * Absent (module load, a headless unit test that builds the adapter with no
 * live viewport, or after `dispose()`) ⇒ `pick()` returns `null` — an honest
 * degrade, never a throw.
 */

import { setViewportEditorControls, type ViewportEditorControls } from '@volter/editor-sdk/kit/viewport-editor-controls';
import type * as THREE from 'three';

export interface ViewportPickContext {
  readonly camera: THREE.Camera;
  readonly canvas: HTMLCanvasElement;
  /** Editor-owned direct-manipulation projections (currently constraint
   * target/pole effectors). The full-cover selection overlay owns pointer
   * events in the project viewport, so it forwards them through this narrow
   * seam instead of duplicating Three raycasting or constraint semantics. */
  readonly editorControls?: ViewportEditorControls;

}

let _ctx: ViewportPickContext | null = null;

/** Install/clear the live viewport's pick context (`EditorViewport` ctor/dispose). */
export function setViewportPickContext(ctx: ViewportPickContext | null): void {
  _ctx = ctx;
  setViewportEditorControls(ctx?.editorControls ?? null);
}

/** The live viewport's camera/canvas, or `null` when none is mounted. */
export function getViewportPickContext(): ViewportPickContext | null {
  return _ctx;
}
