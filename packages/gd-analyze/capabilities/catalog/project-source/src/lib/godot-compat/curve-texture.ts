/**
 * @godot-class CurveTexture
 * @role BINDING
 *
 * Godot 4.7's `CurveTexture` (`scene/resources/curve_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a curve held as a texture a particle process
 * material samples. Its one reader here is a GPUParticles3D converted to CPU particles
 * (`gpu-particles-3d.ts`), which takes the curve itself (`ctex->get_curve()`,
 * `cpu_particles_3d.cpp:1528`), so no image is baked.
 */

import type { Curve } from './curve';

/** `CurveTexture::TextureMode` (`curve_texture.h:40`). */
const TEXTURE_MODE_RED = 1;

export interface CurveTexture {
  curve: Curve | null;
  width: number;
  texture_mode: number;
}

/**
 * 256 wide, RGB, no curve (`curve_texture.h:48`).
 *
 * @godot CurveTexture (protocol)
 * @source scene/resources/curve_texture.h:48
 */
export function construct(): CurveTexture {
  return { curve: null, width: 256, texture_mode: 0 };
}

/**
 * @godot CurveTexture.set_curve
 * @source scene/resources/curve_texture.cpp:81
 */
export function set_curve(self: CurveTexture, curve: Curve | null): void {
  self.curve = curve;
}

/**
 * @godot CurveTexture.get_curve
 * @source scene/resources/curve_texture.cpp:147
 */
export function get_curve(self: CurveTexture): Curve | null {
  return self.curve;
}

/**
 * A width outside 32 to 4096 fails and leaves it.
 *
 * @godot CurveTexture.set_width
 * @source scene/resources/curve_texture.cpp:54
 */
export function set_width(self: CurveTexture, width: number): void {
  if (width < 32 || width > 4096) return;
  self.width = width;
}

/**
 * @godot CurveTexture.get_width
 * @source scene/resources/curve_texture.cpp:64
 */
export function get_width(self: CurveTexture): number {
  return self.width;
}

/**
 * A mode other than RGB or red fails and leaves it.
 *
 * @godot CurveTexture.set_texture_mode
 * @source scene/resources/curve_texture.cpp:151
 */
export function set_texture_mode(self: CurveTexture, mode: number): void {
  if (mode < 0 || mode > TEXTURE_MODE_RED) return;
  self.texture_mode = mode;
}

/**
 * @godot CurveTexture.get_texture_mode
 * @source scene/resources/curve_texture.cpp:159
 */
export function get_texture_mode(self: CurveTexture): number {
  return self.texture_mode;
}

/**
 * A CurveTexture of the properties a scene states; an unknown one fails by name.
 *
 * @godot CurveTexture (protocol)
 * @source scene/resources/curve_texture.cpp:36
 */
export function godot_curve_texture_new(properties: Readonly<Record<string, unknown>> = {}): CurveTexture {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'curve') set_curve(self, value as Curve | null);
    else if (property === 'width') set_width(self, value as number);
    else if (property === 'textureMode') set_texture_mode(self, value as number);
    else throw new Error(`godot-compat: CurveTexture has no ${property} property.`);
  }
  return self;
}
