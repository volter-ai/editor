/**
 * @godot-class Sky
 * @role BINDING
 *
 * Godot 4.7's `Sky` (`scene/resources/sky.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * the material an environment's sky background draws with, its radiance size and process mode,
 * stored and read back. The sky is drawn by `world-environment.ts`.
 */

import type { ShaderMaterial } from './shader-material';

/** `RadianceSize` (`sky.h:40`): 32 to 2048, `RADIANCE_SIZE_256` by default. */
const RADIANCE_SIZE_MAX = 7;

export interface Sky {
  sky_material: ShaderMaterial | null;
  radiance_size: number;
  process_mode: number;
}

/**
 * A sky at its initial values (`sky.h:60`).
 *
 * @godot Sky (protocol)
 * @source scene/resources/sky.cpp:105
 */
export function construct(): Sky {
  return { sky_material: null, radiance_size: 3, process_mode: 0 };
}

/**
 * A size outside the enum fails and is ignored.
 *
 * @godot Sky.set_radiance_size
 * @source scene/resources/sky.cpp:36
 */
export function set_radiance_size(self: Sky, size: number): void {
  if (size < 0 || size >= RADIANCE_SIZE_MAX) return;
  self.radiance_size = size;
}

/**
 * @godot Sky.get_radiance_size
 * @source scene/resources/sky.cpp:46
 */
export function get_radiance_size(self: Sky): number {
  return self.radiance_size;
}

/**
 * @godot Sky.set_process_mode
 * @source scene/resources/sky.cpp:50
 */
export function set_process_mode(self: Sky, mode: number): void {
  self.process_mode = mode;
}

/**
 * @godot Sky.get_process_mode
 * @source scene/resources/sky.cpp:55
 */
export function get_process_mode(self: Sky): number {
  return self.process_mode;
}

/**
 * @godot Sky.set_material
 * @source scene/resources/sky.cpp:59
 */
export function set_material(self: Sky, material: ShaderMaterial | null): void {
  self.sky_material = material;
}

/**
 * @godot Sky.get_material
 * @source scene/resources/sky.cpp:68
 */
export function get_material(self: Sky): ShaderMaterial | null {
  return self.sky_material;
}

/**
 * A Sky of the properties a scene states (`skyMaterial`, `radianceSize`, `processMode`), set in
 * the order given; an unknown one fails by name.
 *
 * @godot Sky (protocol)
 * @source scene/resources/sky.cpp:105
 */
export function godot_sky_new(properties: Readonly<Record<string, unknown>> = {}): Sky {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'skyMaterial') set_material(self, value as ShaderMaterial | null);
    else if (property === 'radianceSize') set_radiance_size(self, value as number);
    else if (property === 'processMode') set_process_mode(self, value as number);
    else throw new Error(`godot-compat: Sky has no ${property} property.`);
  }
  return self;
}
