/**
 * @godot-class RenderingServer
 * @role BINDING
 *
 * Godot 4.7's `RenderingServer` public members this lane uses, bound onto the web platform
 * (revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the rasterizer state a game sets lands on
 * three's renderer settings, which `viewport.ts` holds. A singleton: no receiver. It never reimplements the server.
 */

import { godot_viewport_directional_shadow_quality } from './viewport';

/**
 * The rendering method whose drawing three's renderer matches: Forward+'s. Three lights a scene in
 * one pass, summing every light (shadowed or not) in linear space before the output encoding, as
 * Forward+ and Mobile do. The Compatibility renderer instead draws each shadowed light in its own
 * additive pass blended in sRGB space (`rasterizer_scene_gles3.cpp`, `USE_ADDITIVE_LIGHTING`),
 * which is what games branch on this answer to compensate for ("reduce the sun's energy to roughly
 * match the appearance of Forward+"): answering `gl_compatibility` would have three draw that
 * compensation without the blending it undoes, a scene's sun a quarter as bright as its author lit it.
 *
 * @godot RenderingServer.get_current_rendering_method
 * @source servers/rendering/rendering_server.cpp:2090
 */
export function get_current_rendering_method(): string {
  return 'forward_plus';
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
