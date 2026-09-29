/**
 * @godot-class PanoramaSkyMaterial
 * @role BINDING
 *
 * Godot 4.7's `PanoramaSkyMaterial` (`scene/resources/3d/sky_material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a material whose shader the class generates itself,
 * one per `filter` value (`_update_shader`, `sky_material.cpp:490`). The import captures both
 * generated texts from the pinned Godot and lowers them through the same shader frontend as a
 * `.gdshader`; this binding holds the two lowered shaders and, like Godot, draws the one `filter`
 * selects. Its properties are the generated shader's parameters (`source_panorama`, `exposure`),
 * so the sky draws it as any sky `ShaderMaterial` (`world-environment.ts`).
 */

import type { Texture } from 'three';
import type { Shader } from './shader';
import { type ShaderMaterial, set_shader, set_shader_parameter } from './shader-material';

/** The generated shaders by the `filter` value that selects each (`sky_material.cpp:493`). */
export interface GodotPanoramaSkyShaders {
  readonly filterOff: Shader;
  readonly filterOn: Shader;
}

export interface PanoramaSkyMaterial extends ShaderMaterial {
  panorama: Texture | null;
  filter: boolean;
  energy_multiplier: number;
  readonly shaders: GodotPanoramaSkyShaders;
}

/**
 * A material at its initial values: filtering on (`sky_material.h:136`), energy 1
 * (`sky_material.cpp:515`).
 *
 * @godot PanoramaSkyMaterial (protocol)
 * @source scene/resources/3d/sky_material.cpp:513
 */
export function construct(shaders: GodotPanoramaSkyShaders): PanoramaSkyMaterial {
  const self: PanoramaSkyMaterial = {
    shader: shaders.filterOn,
    renderPriority: 0,
    parameters: new Map(),
    listeners: new Set(),
    panorama: null,
    filter: true,
    energy_multiplier: 1,
    shaders,
  };
  set_energy_multiplier(self, 1);
  return self;
}

/**
 * @godot PanoramaSkyMaterial.set_panorama
 * @source scene/resources/3d/sky_material.cpp:410
 */
export function set_panorama(self: PanoramaSkyMaterial, panorama: Texture | null): void {
  self.panorama = panorama;
  set_shader_parameter(self, 'source_panorama', panorama);
}

/**
 * @godot PanoramaSkyMaterial.get_panorama
 * @source scene/resources/3d/sky_material.cpp:419
 */
export function get_panorama(self: PanoramaSkyMaterial): Texture | null {
  return self.panorama;
}

/**
 * Selects the generated shader for the value.
 *
 * @godot PanoramaSkyMaterial.set_filtering_enabled
 * @source scene/resources/3d/sky_material.cpp:423
 */
export function set_filtering_enabled(self: PanoramaSkyMaterial, enabled: boolean): void {
  self.filter = enabled;
  set_shader(self, enabled ? self.shaders.filterOn : self.shaders.filterOff);
}

/**
 * @godot PanoramaSkyMaterial.is_filtering_enabled
 * @source scene/resources/3d/sky_material.cpp:433
 */
export function is_filtering_enabled(self: PanoramaSkyMaterial): boolean {
  return self.filter;
}

/**
 * Stored as a 32-bit float (`float p_multiplier`).
 *
 * @godot PanoramaSkyMaterial.set_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:437
 */
export function set_energy_multiplier(self: PanoramaSkyMaterial, multiplier: number): void {
  self.energy_multiplier = Math.fround(multiplier);
  set_shader_parameter(self, 'exposure', self.energy_multiplier);
}

/**
 * @godot PanoramaSkyMaterial.get_energy_multiplier
 * @source scene/resources/3d/sky_material.cpp:442
 */
export function get_energy_multiplier(self: PanoramaSkyMaterial): number {
  return self.energy_multiplier;
}

/**
 * A PanoramaSkyMaterial of its two generated shaders and the properties a scene states
 * (`panorama`, `filter`, `energyMultiplier`), set in the order given; an unknown one fails by name.
 *
 * @godot PanoramaSkyMaterial (protocol)
 * @source scene/resources/3d/sky_material.cpp:513
 */
export function godot_panorama_sky_material_new(
  shaders: GodotPanoramaSkyShaders,
  properties: Readonly<Record<string, unknown>> = {},
): PanoramaSkyMaterial {
  const self = construct(shaders);
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'panorama') set_panorama(self, value as Texture | null);
    else if (property === 'filter') set_filtering_enabled(self, value as boolean);
    else if (property === 'energyMultiplier') set_energy_multiplier(self, value as number);
    else throw new Error(`godot-compat: PanoramaSkyMaterial has no ${property} property.`);
  }
  return self;
}
