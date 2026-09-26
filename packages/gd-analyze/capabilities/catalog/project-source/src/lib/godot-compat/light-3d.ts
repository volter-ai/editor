/**
 * @godot-class Light3D
 * @role BINDING
 *
 * Godot 4.7's `Light3D` (`scene/3d/light_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three light. Its parameters are Godot's;
 * what the Compatibility renderer hands its shader from them (`rasterizer_scene_gles3.cpp:1751`,
 * `:1970`, physical light units off) is three's: the color converted to linear
 * (`Color::srgb_to_linear`), the energy times pi (Godot's shader divides the Lambert term by pi,
 * `scene.glsl:411`, as three's does), an omni light's range the distance its attenuation reaches
 * zero at and its attenuation the decay exponent (`get_omni_spot_attenuation`, `scene.glsl:429`,
 * three's `getDistanceAttenuation`; three floors `d^decay` at 0.01 where Godot floors `d` at
 * 0.0001). A directional light in `SKY_MODE_SKY_ONLY` lights nothing in the scene
 * (`rasterizer_scene_gles3.cpp:1724`).
 */

import { LinearSRGBColorSpace, type Light, PointLight } from 'three';
import { construct as color, type Color } from './color';

const f32 = Math.fround;

/** `Light3D::Param` (`light_3d.h:44`). */
const PARAM_ENERGY = 0;
const PARAM_RANGE = 4;
const PARAM_ATTENUATION = 6;
const PARAM_MAX = 21;

interface LightState {
  color: Color;
  params: number[];
  shadow: boolean;
  /** A directional light's `SkyMode`; 0 for other lights. */
  skyMode: number;
}

const STATE = new WeakMap<Light, LightState>();

/** `Light3D::Light3D` (`light_3d.cpp:463`): the parameters every light starts with. */
function initialParams(): number[] {
  const params = new Array<number>(PARAM_MAX).fill(0);
  const set = (index: number, value: number) => {
    params[index] = f32(value);
  };
  set(0, 1); // ENERGY
  set(1, 1); // INDIRECT_ENERGY
  set(2, 1); // VOLUMETRIC_FOG_ENERGY
  set(3, 0.5); // SPECULAR
  set(4, 5); // RANGE
  set(5, 0); // SIZE
  set(6, 1); // ATTENUATION
  set(7, 45); // SPOT_ANGLE
  set(8, 1); // SPOT_ATTENUATION
  set(9, 0); // SHADOW_MAX_DISTANCE
  set(10, 0.1); // SHADOW_SPLIT_1_OFFSET
  set(11, 0.2); // SHADOW_SPLIT_2_OFFSET
  set(12, 0.5); // SHADOW_SPLIT_3_OFFSET
  set(13, 1); // SHADOW_FADE_START (0.8, then 1, light_3d.cpp:509)
  set(14, 1); // SHADOW_NORMAL_BIAS
  set(15, 0.1); // SHADOW_BIAS
  set(16, 20); // SHADOW_PANCAKE_SIZE
  set(17, 1); // SHADOW_OPACITY
  set(18, 1); // SHADOW_BLUR
  set(19, 0.05); // TRANSMITTANCE_BIAS
  set(20, 1000); // INTENSITY
  return params;
}

/** `Color::srgb_to_linear` (`core/math/color.h:192`), in float. */
function srgbToLinear(value: number): number {
  return value < f32(0.04045) ? f32(value * f32(1 / 12.92)) : f32(Math.pow(f32((value + 0.055) * (1 / 1.055)), f32(2.4)));
}

function stateOf(self: Light): LightState {
  let state = STATE.get(self);
  if (state === undefined) {
    state = { color: color(1, 1, 1, 1), params: initialParams(), shadow: false, skyMode: 0 };
    STATE.set(self, state);
  }
  return state;
}

function apply(self: Light, state: LightState): void {
  self.color.setRGB(
    srgbToLinear(state.color.r),
    srgbToLinear(state.color.g),
    srgbToLinear(state.color.b),
    LinearSRGBColorSpace,
  );
  self.intensity = state.skyMode === 2 ? 0 : f32((state.params[PARAM_ENERGY] as number) * Math.PI);
  self.castShadow = state.shadow;
  if (self instanceof PointLight) {
    self.distance = Math.max(0.001, state.params[PARAM_RANGE] as number);
    self.decay = state.params[PARAM_ATTENUATION] as number;
  }
}

/**
 * A light as its class creates it, with the parameters its constructor sets over Light3D's.
 *
 * @godot Light3D (protocol)
 * @source scene/3d/light_3d.cpp:463
 */
export function godot_light_3d_mount(self: Light, overrides: Readonly<Record<number, number>> = {}): void {
  const state = stateOf(self);
  for (const [param, value] of Object.entries(overrides)) state.params[Number(param)] = f32(value);
  apply(self, state);
}

/**
 * A directional light's sky mode (`DirectionalLight3D::set_sky_mode`, `light_3d.cpp:550`).
 *
 * @godot Light3D (protocol)
 * @source scene/3d/light_3d.cpp:550
 */
export function godot_light_3d_sky_mode(self: Light, mode?: number): number {
  const state = stateOf(self);
  if (mode !== undefined) {
    state.skyMode = mode;
    apply(self, state);
  }
  return state.skyMode;
}

/**
 * An index outside `Param` fails and leaves the parameters.
 *
 * @godot Light3D.set_param
 * @source scene/3d/light_3d.cpp:40
 */
export function set_param(self: Light, param: number, value: number): void {
  if (param < 0 || param >= PARAM_MAX) return;
  const state = stateOf(self);
  state.params[param] = f32(value);
  apply(self, state);
}

/**
 * @godot Light3D.get_param
 * @source scene/3d/light_3d.cpp:55
 */
export function get_param(self: Light, param: number): number {
  if (param < 0 || param >= PARAM_MAX) return 0;
  return stateOf(self).params[param] as number;
}

/**
 * @godot Light3D.set_color
 * @source scene/3d/light_3d.cpp:126
 */
export function set_color(self: Light, value: Color): void {
  const state = stateOf(self);
  state.color = value;
  apply(self, state);
}

/**
 * @godot Light3D.get_color
 * @source scene/3d/light_3d.cpp:140
 */
export function get_color(self: Light): Color {
  return stateOf(self).color;
}

/**
 * @godot Light3D.set_shadow
 * @source scene/3d/light_3d.cpp:60
 */
export function set_shadow(self: Light, enabled: boolean): void {
  const state = stateOf(self);
  state.shadow = enabled;
  apply(self, state);
}

/**
 * @godot Light3D.has_shadow
 * @source scene/3d/light_3d.cpp:67
 */
export function has_shadow(self: Light): boolean {
  return stateOf(self).shadow;
}
