/**
 * The sky shader mode's built-ins as Godot's Compatibility renderer names them in its sky pass
 * (`drivers/gles3/storage/material_storage.cpp:1522`, `drivers/gles3/shaders/sky.glsl`), which the
 * compat sky material declares by the same names (`sky-material.ts`). `PI`, `TAU` and `E` are the
 * renderer's literal text (`String::num`, 14 decimals). The four directional lights
 * (`LIGHTn_ENABLED`/`_DIRECTION`/`_ENERGY`/`_COLOR`/`_SIZE`, `material_storage.cpp:1538`) are the
 * compat sky's per-light uniforms (`world-environment.ts`, filled as `_setup_sky` fills Godot's
 * light buffer). `RADIANCE`, `FOG`, the half- and quarter-resolution passes and the per-pass flags
 * are not carried: a sky shader that reads one refuses by name.
 */
import type { GodotShaderBuiltins } from './shader-glsl';

export const GODOT_SKY_SHADER_BUILTINS: GodotShaderBuiltins = {
  COLOR: 'color',
  ALPHA: 'alpha',
  EYEDIR: 'cube_normal',
  POSITION: 'position',
  SKY_COORDS: 'panorama_coords',
  SCREEN_UV: 'uv',
  TIME: 'time',
  FRAGCOORD: 'gl_FragCoord',
  PI: '3.14159265358979',
  TAU: '6.28318530717959',
  E: '2.71828182845905',
  ...Object.fromEntries(
    [0, 1, 2, 3].flatMap((n) => [
      [`LIGHT${String(n)}_ENABLED`, `godot_sky_light${String(n)}_enabled`],
      [`LIGHT${String(n)}_DIRECTION`, `godot_sky_light${String(n)}_direction`],
      [`LIGHT${String(n)}_ENERGY`, `godot_sky_light${String(n)}_energy`],
      [`LIGHT${String(n)}_COLOR`, `godot_sky_light${String(n)}_color`],
      [`LIGHT${String(n)}_SIZE`, `godot_sky_light${String(n)}_size`],
    ]),
  ),
};
