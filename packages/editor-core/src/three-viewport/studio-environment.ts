/**
 * The LOOK LANES' neutral studio IBL — `scene.environment` for every surface
 * that photographs an asset instead of displaying it: the Asset Lab capture
 * path (`asset-preview.ts`: the model-file lane, `vgai screenshot <module>`
 * through `project.bake.preview`, labeled shot sets, source-review sheets,
 * splats) and the asset-browser thumbnails (`model-thumbnail.ts`).
 *
 * Why it exists: a `MeshStandardMaterial` with `metalness: 1` has NO diffuse
 * term — everything it shows is reflected environment. Lit by directional
 * lights alone it renders BLACK with a pinprick specular, so iron reads as
 * painted plastic, and the measured cost of that (cold barrel, 2026-08-29) is
 * that agents detune `metalness` to survive the screenshot — the look lane
 * silently teaching a wrong material value into shipped assets.
 *
 * The bake is three's own `RoomEnvironment` through `PMREMGenerator`, reused
 * verbatim from the document viewport's dressing
 * ({@link createStandardEnvironment}) so a capture and the open document light
 * the same subject the same way. Procedural: no HDRI binary, deterministic
 * frame to frame.
 *
 * Two rules this module exists to hold:
 *
 *  - **`environment` only, never `background`.** Each lane keeps its own
 *    backdrop (the Asset Lab's neutral clear colour, or transparent). An IBL
 *    that also painted the background would change every existing frame's
 *    composition, not just its materials.
 *  - **One bake per renderer.** A PMREM target is GL-context-bound, so it
 *    cannot be shared across renderers, and baking it per SCENE would pay for
 *    it once per shot in a 24-frame orbit. The cache is keyed by renderer and
 *    freed through {@link disposeStudioEnvironment}, which every caller that
 *    disposes its renderer must call — a PMREM render target leaks otherwise.
 */

import {
  createStandardEnvironment,
  type StandardEnvironment,
} from '@volter/editor-threejs/viewport/environment';
import type * as THREE from 'three';

/**
 * How hard the IBL pushes against the lane's existing key/fill rig.
 *
 * The key and fill are UNCHANGED — they still own the form, the direction of
 * the shading and the highlight. This is a reflection budget, not a second key.
 *
 * The blend was picked by reading before/after pairs of the barrel GLB and a
 * metalness sweep in the module lane, holding the wood constant and asking how
 * little environment buys back the metal:
 *  - 1.0 with the ambient untouched: the iron reads, the wood lifts and flattens
 *    — the shadow side of the staves fills in and the stave-to-stave tone
 *    variation collapses;
 *  - 0.55 with {@link STUDIO_AMBIENT_WITH_ENVIRONMENT} at 0.35: metal good,
 *    wood still visibly brighter and lower-contrast than the historical frame;
 *  - 0.45 with the ambient at 0.25 (shipped): the wood frame is indistinguishable
 *    from the historical one at full scale — same warmth, same grain, same
 *    terminator — while every hoop gains a gradient across the band and the
 *    bottom hoop stops reading as a shadow.
 */
export const STUDIO_ENVIRONMENT_INTENSITY = 0.45;

/**
 * The lanes' ambient fill is REDUCED when the IBL is present: a
 * hemisphere/ambient light is a crude stand-in for exactly what the environment
 * now does properly, and leaving both at full strength double-pays the ambient
 * term and washes the subject. Each lane multiplies its own historical ambient
 * intensity by this, so the total ambient energy lands near where it was and
 * only its DIRECTIONALITY improves.
 */
export const STUDIO_AMBIENT_WITH_ENVIRONMENT = 0.25;

const perRenderer = new WeakMap<THREE.WebGLRenderer, StandardEnvironment>();

/**
 * Light `scene` with the studio IBL baked for `renderer`, baking it on first
 * use for that renderer. `scene.background` is deliberately untouched.
 */
export function applyStudioEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  let environment = perRenderer.get(renderer);
  if (!environment) {
    environment = createStandardEnvironment(renderer);
    perRenderer.set(renderer, environment);
  }
  scene.environment = environment.texture;
  scene.environmentIntensity = STUDIO_ENVIRONMENT_INTENSITY;
}

/**
 * Free the bake this renderer owns. Idempotent, and safe for a renderer that
 * never had one — call it beside `renderer.dispose()`.
 */
export function disposeStudioEnvironment(renderer: THREE.WebGLRenderer): void {
  const environment = perRenderer.get(renderer);
  if (!environment) return;
  perRenderer.delete(renderer);
  environment.dispose();
}
