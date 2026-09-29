/**
 * @godot-class CameraAttributesPractical
 * @role BINDING
 *
 * Godot 4.7's `CameraAttributesPractical` (`scene/resources/camera_attributes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a camera's depth of field, drawn by the
 * WorldEnvironment's post pass (`world-environment.ts`) as `postprocessing`'s effect over the
 * scene's depth (`GodotDepthOfFieldEffect`). Its blur is Godot's (`bokeh_dof.glsl`): each pixel's
 * blur size from its distance, rising across the far transition from nothing to `dof_blur_amount`
 * × 64 pixels (and, before the near distance, across the near one), and the circular gather of
 * `MODE_BOKEH_CIRCULAR`, where Godot's default bokeh is its hexagon (two passes of the same size).
 * Exposure and auto exposure are not members here: a scene that states one is refused by name.
 */

import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

export interface CameraAttributesPractical {
  dof_blur_far_enabled: boolean;
  dof_blur_far_distance: number;
  dof_blur_far_transition: number;
  dof_blur_near_enabled: boolean;
  dof_blur_near_distance: number;
  dof_blur_near_transition: number;
  dof_blur_amount: number;
}

const f32 = Math.fround;

/**
 * No depth of field; far blur from 10 m over 5, near blur before 2 m over 1, amount 0.1
 * (`camera_attributes.h:82`).
 *
 * @godot CameraAttributesPractical.CameraAttributesPractical
 * @source scene/resources/camera_attributes.cpp:309
 */
export function construct(): CameraAttributesPractical {
  return {
    dof_blur_far_enabled: false,
    dof_blur_far_distance: 10,
    dof_blur_far_transition: 5,
    dof_blur_near_enabled: false,
    dof_blur_near_distance: 2,
    dof_blur_near_transition: 1,
    dof_blur_amount: f32(0.1),
  };
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_far_enabled
 * @source scene/resources/camera_attributes.cpp:151
 */
export function set_dof_blur_far_enabled(self: CameraAttributesPractical, enabled: boolean): void {
  self.dof_blur_far_enabled = enabled;
}

/**
 * @godot CameraAttributesPractical.is_dof_blur_far_enabled
 * @source scene/resources/camera_attributes.cpp:157
 */
export function is_dof_blur_far_enabled(self: CameraAttributesPractical): boolean {
  return self.dof_blur_far_enabled;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_far_distance
 * @source scene/resources/camera_attributes.cpp:161
 */
export function set_dof_blur_far_distance(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_far_distance = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_far_distance
 * @source scene/resources/camera_attributes.cpp:166
 */
export function get_dof_blur_far_distance(self: CameraAttributesPractical): number {
  return self.dof_blur_far_distance;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_far_transition
 * @source scene/resources/camera_attributes.cpp:170
 */
export function set_dof_blur_far_transition(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_far_transition = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_far_transition
 * @source scene/resources/camera_attributes.cpp:175
 */
export function get_dof_blur_far_transition(self: CameraAttributesPractical): number {
  return self.dof_blur_far_transition;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_near_enabled
 * @source scene/resources/camera_attributes.cpp:179
 */
export function set_dof_blur_near_enabled(self: CameraAttributesPractical, enabled: boolean): void {
  self.dof_blur_near_enabled = enabled;
}

/**
 * @godot CameraAttributesPractical.is_dof_blur_near_enabled
 * @source scene/resources/camera_attributes.cpp:185
 */
export function is_dof_blur_near_enabled(self: CameraAttributesPractical): boolean {
  return self.dof_blur_near_enabled;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_near_distance
 * @source scene/resources/camera_attributes.cpp:189
 */
export function set_dof_blur_near_distance(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_near_distance = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_near_distance
 * @source scene/resources/camera_attributes.cpp:194
 */
export function get_dof_blur_near_distance(self: CameraAttributesPractical): number {
  return self.dof_blur_near_distance;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_near_transition
 * @source scene/resources/camera_attributes.cpp:198
 */
export function set_dof_blur_near_transition(self: CameraAttributesPractical, distance: number): void {
  self.dof_blur_near_transition = f32(distance);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_near_transition
 * @source scene/resources/camera_attributes.cpp:203
 */
export function get_dof_blur_near_transition(self: CameraAttributesPractical): number {
  return self.dof_blur_near_transition;
}

/**
 * @godot CameraAttributesPractical.set_dof_blur_amount
 * @source scene/resources/camera_attributes.cpp:207
 */
export function set_dof_blur_amount(self: CameraAttributesPractical, amount: number): void {
  self.dof_blur_amount = f32(amount);
}

/**
 * @godot CameraAttributesPractical.get_dof_blur_amount
 * @source scene/resources/camera_attributes.cpp:212
 */
export function get_dof_blur_amount(self: CameraAttributesPractical): number {
  return self.dof_blur_amount;
}

/**
 * Whether the attributes blur anything (`BokehDOF::bokeh_dof_compute` runs only then).
 *
 * @godot CameraAttributesPractical (protocol)
 * @source servers/rendering/renderer_rd/effects/bokeh_dof.cpp:102
 */
export function godot_camera_attributes_dof_enabled(self: unknown): self is CameraAttributesPractical {
  if (typeof self !== 'object' || self === null || !('dof_blur_far_enabled' in self)) return false;
  const attributes = self as CameraAttributesPractical;
  return (attributes.dof_blur_far_enabled || attributes.dof_blur_near_enabled) && attributes.dof_blur_amount > 0;
}

/**
 * `bokeh_dof.glsl`'s blur size (`get_blur_size`, the non-physical transitions; near blur negative)
 * and its circular gather (`MODE_BOKEH_CIRCULAR`, full size, `blur_scale` 0.5), over the scene's
 * depth as `postprocessing` reads it (`readDepth`, `getViewZ`).
 */
const DEPTH_OF_FIELD = /* glsl */ `
uniform bool blurFarActive;
uniform float blurFarBegin;
uniform float blurFarEnd;
uniform bool blurNearActive;
uniform float blurNearBegin;
uniform float blurNearEnd;
uniform float blurSize;

const float GOLDEN_ANGLE = 2.39996323;
const float BLUR_SCALE = 0.5;

float godotBlurSize(const in float depth) {
  float z = -getViewZ(depth);
  if (blurNearActive && z < blurNearBegin) return -(1.0 - smoothstep(blurNearEnd, blurNearBegin, z)) * blurSize;
  if (blurFarActive && z > blurFarBegin) return smoothstep(blurFarBegin, blurFarEnd, z) * blurSize;
  return 0.0;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 color = inputColor;
  float initialBlur = godotBlurSize(depth);
  float accum = 1.0;
  float radius = BLUR_SCALE;
  for (int i = 0; i < 4096; i++) {
    if (radius >= blurSize) break;
    float angle = float(i) * GOLDEN_ANGLE;
    vec2 suv = uv + vec2(cos(angle), sin(angle)) * texelSize * radius;
    vec4 sampleColor = texture2D(inputBuffer, suv);
    float sampleBlur = godotBlurSize(readDepth(suv));
    float sampleSize = abs(sampleBlur);
    if (sampleBlur > initialBlur) sampleSize = clamp(sampleSize, 0.0, abs(initialBlur) * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
    color += mix(color / accum, sampleColor, m);
    accum += 1.0;
    radius += BLUR_SCALE / radius;
  }
  outputColor = color / accum;
}
`;

/**
 * A camera's depth of field as a `postprocessing` effect, its uniforms read from the attributes
 * each frame (`update`), so a change to them draws at once.
 *
 * @godot CameraAttributesPractical (protocol)
 * @source servers/rendering/renderer_rd/effects/bokeh_dof.cpp:102
 */
export class GodotDepthOfFieldEffect extends Effect {
  readonly attributes: CameraAttributesPractical;

  constructor(attributes: CameraAttributesPractical) {
    super('GodotDepthOfFieldEffect', DEPTH_OF_FIELD, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['blurFarActive', new Uniform(false)],
        ['blurFarBegin', new Uniform(0)],
        ['blurFarEnd', new Uniform(0)],
        ['blurNearActive', new Uniform(false)],
        ['blurNearBegin', new Uniform(0)],
        ['blurNearEnd', new Uniform(0)],
        ['blurSize', new Uniform(0)],
      ]),
    });
    this.attributes = attributes;
  }

  override update(): void {
    const a = this.attributes;
    const set = (name: string, value: unknown) => {
      (this.uniforms.get(name) as Uniform).value = value;
    };
    // `BokehDOF::bokeh_dof_compute` (`bokeh_dof.cpp:102`): the far blur ends a transition beyond its
    // distance, the near one a transition before it; the size is the amount of a 64 pixel radius.
    set('blurFarActive', a.dof_blur_far_enabled);
    set('blurFarBegin', a.dof_blur_far_distance);
    set('blurFarEnd', a.dof_blur_far_distance + a.dof_blur_far_transition);
    set('blurNearActive', a.dof_blur_near_enabled);
    set('blurNearBegin', a.dof_blur_near_distance);
    set('blurNearEnd', a.dof_blur_near_distance - a.dof_blur_near_transition);
    set('blurSize', a.dof_blur_amount * 64);
  }
}
