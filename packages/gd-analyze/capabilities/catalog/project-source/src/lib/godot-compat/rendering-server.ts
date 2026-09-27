/**
 * @godot-class RenderingServer
 * @role BINDING
 *
 * Godot 4.7's `RenderingServer` public members this lane uses, bound onto the web platform
 * (revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): Godot's web export renders with the
 * Compatibility renderer, and its rasterizer state lands on three's renderer settings, which
 * `viewport.ts` holds. A singleton: no receiver. It never reimplements the server.
 */

import { godot_viewport_directional_shadow_quality } from './viewport';

/**
 * The web platform's rendering method: `rendering/renderer/rendering_method.web` admits only
 * `gl_compatibility` (`main/main.cpp:2644`), the web display server's only driver is `opengl3`
 * (`platform/web/display_server_web.cpp:1007`), and the method the OS reports is the one it started
 * with (`servers/rendering/rendering_server.cpp:2090`).
 *
 * @godot RenderingServer.get_current_rendering_method
 * @source servers/rendering/rendering_server.cpp:2090
 */
export function get_current_rendering_method(): string {
  return 'gl_compatibility';
}

/**
 * The Compatibility rasterizer stores the quality its scene shader's directional shadow kernel is
 * selected by (`drivers/gles3/rasterizer_scene_gles3.cpp:1233`); on the web platform that is the
 * shadow-map type of the renderer `viewport.ts` holds.
 *
 * @godot RenderingServer.directional_soft_shadow_filter_set_quality
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1233
 */
export function directional_soft_shadow_filter_set_quality(quality: number): void {
  godot_viewport_directional_shadow_quality(quality);
}
