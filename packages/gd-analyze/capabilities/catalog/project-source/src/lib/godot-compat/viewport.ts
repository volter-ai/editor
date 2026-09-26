/**
 * @godot-class Viewport
 * @role BINDING
 *
 * Godot 4.7's root `Viewport` (`scene/main/viewport.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the three `WebGLRenderer` the composition
 * site renders with, which it hands over as it hands over the Rapier world (`world-3d.ts`). The
 * renderer's settings are where the web platform's Compatibility rasterizer state lands: the
 * directional shadow filter the rendering server selects is the renderer's shadow-map type.
 */

import { BasicShadowMap, PCFShadowMap, PCFSoftShadowMap, type ShadowMapType, type WebGLRenderer } from 'three';

const renderers = new Set<WebGLRenderer>();

/**
 * `rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality`'s registered
 * default, `SHADOW_QUALITY_SOFT_LOW` (`servers/rendering/rendering_server.cpp:3675`), which the
 * Compatibility rasterizer applies at initialization (`drivers/gles3/rasterizer_scene_gles3.cpp:4541`).
 */
let directionalShadowQuality = 2;

/**
 * The three shadow-map type for a `RenderingServer.ShadowQuality`, from the kernel the
 * Compatibility scene shader selects (`drivers/gles3/rasterizer_scene_gles3.cpp:3674`): below
 * `SOFT_LOW`, one hardware compare tap (`drivers/gles3/shaders/scene.glsl:1392`), three's
 * `BasicShadowMap`; `SOFT_LOW` to `SOFT_MEDIUM`, `SHADOW_MODE_PCF_5` (taps one texel apart,
 * `scene.glsl:1420`), three's `PCFShadowMap` (taps within one texel at the default radius);
 * `SOFT_HIGH` and above, `SHADOW_MODE_PCF_13` (taps two texels apart, `scene.glsl:1393`), three's
 * `PCFSoftShadowMap` (a filtered kernel two texels wide). Godot filters only directional shadows
 * this way; three's type is the renderer's, so it applies to every shadow the renderer draws.
 */
function shadowMapType(quality: number): ShadowMapType {
  if (quality >= 4) return PCFSoftShadowMap;
  if (quality >= 2) return PCFShadowMap;
  return BasicShadowMap;
}

function apply(renderer: WebGLRenderer): void {
  renderer.shadowMap.type = shadowMapType(directionalShadowQuality);
  renderer.shadowMap.needsUpdate = true;
}

/**
 * Attaches the renderer the composition site draws the root viewport with; releasing detaches it.
 *
 * @godot Viewport (protocol)
 * @source scene/main/viewport.cpp:5542
 */
export function godot_viewport_attach_renderer(renderer: WebGLRenderer): () => void {
  renderers.add(renderer);
  apply(renderer);
  return () => {
    renderers.delete(renderer);
  };
}

/**
 * The rendering server's directional soft-shadow quality, applied to every attached renderer.
 *
 * @godot Viewport (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1233
 */
export function godot_viewport_directional_shadow_quality(quality: number): void {
  directionalShadowQuality = quality;
  for (const renderer of renderers) apply(renderer);
}
