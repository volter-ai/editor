/**
 * @godot-class WorldEnvironment
 * @role BINDING
 *
 * Godot 4.7's `WorldEnvironment` (`scene/3d/world_environment.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) and the Compatibility renderer's drawing of its
 * `Environment` (`drivers/gles3/rasterizer_scene_gles3.cpp`), bound onto three:
 * - a sky background (`BG_SKY`) is a camera-centred box drawn first with a three `ShaderMaterial`
 *   whose fragment code is the renderer's sky pass (`drivers/gles3/shaders/sky.glsl:184`: the view
 *   direction `cube_normal`, the panorama coordinates by its own `atan2`/`acos` approximations,
 *   `color` and `alpha`, the shader's lowered `sky()` body, then `sky_energy_multiplier` and the
 *   conversion to linear by `srgb_to_linear`'s polynomial), its `LIGHTn_*` built-ins written in
 *   place each frame by the WorldEnvironment's own processing, as `_setup_sky` fills the sky's
 *   light buffer (`rasterizer_scene_gles3.cpp:741`): of the directional lights the plan hands the
 *   element as refs (`skyLights`, `scene-sky-lights.ts`), the visible ones the sky sees (sky mode
 *   not `LIGHT_ONLY`), each its direction `basis * (0, 0, 1)` normalized, its energy, its colour as
 *   authored and its size in radians, the rest disabled; the box's vertex code keeps only the
 *   view's rotation, so it draws around whichever camera renders with no transform of its own;
 *   a colour background is the scene's clear colour (`scene.background`), scaled by the energy
 *   multiplier;
 * - a constant-colour ambient (`AMBIENT_SOURCE_COLOR`, or the background's colour) is a three
 *   `AmbientLight`: the renderer adds `ambient_light_color_energy * albedo * (1 - metallic)`
 *   (`scene.glsl:2580`, `:2780`) from the colour converted by `Color::srgb_to_linear` and scaled by
 *   the energy (`rasterizer_scene_gles3.cpp:1618`); three adds its light times
 *   `BRDF_Lambert = albedo / PI`, so the light's intensity is `PI * energy`;
 * - the sky's radiance is three's `scene.environment`, the sky as drawn captured by three's
 *   `PMREMGenerator` at the sky's `radiance_size` (`doc/classes/Sky.xml:15`), which three's standard
 *   and physical materials reflect and are lit by: Godot reflects the sky where the reflected light
 *   source is the sky, or the background and the background is the sky
 *   (`reflected_light_source`, `doc/classes/Environment.xml:203`, `:419`), and takes the sky's share
 *   `ambient_light_sky_contribution` of its ambient from the sky where the ambient source is the
 *   sky, or the background and the background is the sky (`:60`, `:64`, `:407`); the capture is
 *   redone when the sky's parameters or its lights change, not as time passes nor as the camera
 *   moves;
 * - the tone mapper is three's own of the same name on the renderer (`toneMapping`, its exposure
 *   `toneMappingExposure`; `environment.h:66`: linear, Reinhard, filmic (three's Cineon, a
 *   filmic curve), ACES, and AgX as three's Neutral, `TONE_MAPPINGS`), where the post pass does
 *   not tone-map (`environment-post.ts`);
 * - fog is three's `FogExp2` of the fog colour (linear, times its energy) and density.
 *
 * Lighting and the output encoding are three's own: the scene is lit and encoded as three draws
 * any scene, and nothing here changes three's shader chunks.
 *
 * The environment drawn is resolved each frame by the WorldEnvironment's own component, from its
 * frame while the node is inside the tree (`useGodotDraw`); the
 * scene's first mounted one draws, for R3F's camera, as the renderer resolves it per camera
 * (`RendererSceneCull::_render_get_environment`, renderer_scene_cull.cpp:3722): the camera's own
 * (`Camera3D.environment`), else the world's. Nothing is done from the scene's render hooks or the
 * tree's notifications.
 *
 * Where three differs from Godot:
 * - Godot fogs by `1 - exp(-distance * density)` per vertex, three's `FogExp2` by
 *   `1 - exp(-(depth * density)^2)` per fragment; height fog and sun scatter are not drawn, nor fog
 *   on the sky;
 * - three lights reflection and diffuse ambient from one `scene.environmentIntensity`; where Godot
 *   sets them apart, three's ambient differs. A sky that is reflected also adds its irradiance to
 *   the diffuse ambient where Godot's ambient is a colour, is the sky at a share under 1, or is
 *   off (`ambient_light_source` disabled, where Godot adds no ambient at all). A sky that lights
 *   the ambient but is not reflected is reflected at the ambient's share;
 * - the sky's lights are the ones the plan names: the directional lights of the WorldEnvironment's
 *   own scene, in scene order, authored with a sky mode other than `LIGHT_ONLY`, at most four
 *   (`scene-sky-lights.ts`). Godot's sky pass takes every directional light of the world whose sky
 *   mode is not `LIGHT_ONLY`, up to four (`rasterizer_scene_gles3.cpp:728-771`, `max_directional_lights`
 *   `:4591`), in the order they entered it. So a light in another instanced scene does not feed the
 *   sky, nor one an imported model carries, nor one a script adds at runtime, nor one authored
 *   `LIGHT_ONLY` that a script later lets the sky see;
 * - a camera's own environment is drawn only in a scene that holds a WorldEnvironment, whose
 *   component draws it, and only for R3F's camera: a game that sets `Camera3D.environment` with no
 *   WorldEnvironment draws with three's defaults. Knowingly deferred: drawing it needs the camera's
 *   own component to draw it, which Camera3D's binding does not yet do;
 * - the environment is drawn each frame the node is inside the tree, whatever its process mode, as
 *   Godot's renderer draws it (`useGodotDraw`); its sky lights are read in that frame's order among
 *   the scripts' hooks, so a light a script turns later in the same frame shows in the next;
 * - a WorldEnvironment taken out of the tree while its component stays mounted stops drawing but
 *   stays registered, so the environment it drew stays on screen and another WorldEnvironment in
 *   the tree does not take over; Godot unregisters it on leaving the tree (`world_environment.cpp`,
 *   `NOTIFICATION_EXIT_TREE`);
 * - a sky light's energy is the light's `light_energy` alone: Godot negates it for a negative light,
 *   multiplies it by `light_intensity_lumens` with physical light units on, and by the camera
 *   attributes' exposure normalization (`rasterizer_scene_gles3.cpp:750-758`); none of these is
 *   bound here (`light-3d.ts`);
 * - the radiance is captured once from the world origin and again only when the sky's parameters
 *   or lights change. Godot recaptures a sky whose shader reads `TIME` or `POSITION` in real time,
 *   and one that reads `POSITION` whenever the camera moves (`rasterizer_scene_gles3.cpp:720-723`,
 *   `doc/classes/Sky.xml:49`); the background itself is drawn each frame from the camera;
 * - three writes sRGB with the exact transfer function where Godot uses `linear_to_srgb`'s
 *   approximation (`tonemap_inc.glsl:14`).
 */

import { useThree } from '@react-three/fiber';
import { EffectComposer } from '@react-three/postprocessing';
import { createElement, Fragment, type ReactElement, type RefObject, useLayoutEffect, useMemo, useRef } from 'react';
import { GodotPostEffect, godot_environment_post_enabled } from './environment-post';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  BoxGeometry,
  type Camera,
  CineonToneMapping,
  Color as ThreeColor,
  type CubeTexture,
  type DirectionalLight,
  FogExp2,
  Group,
  LinearToneMapping,
  type Material,
  Mesh,
  NeutralToneMapping,
  NoToneMapping,
  type Object3D,
  type PerspectiveCamera,
  PMREMGenerator,
  ReinhardToneMapping,
  Scene,
  ShaderMaterial as ThreeShaderMaterial,
  type Texture,
  type ToneMapping,
  type WebGLRenderer,
  type WebGLRenderTarget,
  Vector3,
} from 'three';
import type { Color } from './color';
import { type Environment, godot_environment_tonemap_parameters } from './environment';
import { get_environment as get_camera_environment } from './camera-3d';
import { type GodotSkyLight, godot_light_3d_sky_light } from './light-3d';
import { useGodotDraw } from './advance';
import { godot_node_foreign } from './node';
import { get_global_basis } from './node-3d';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import type { Shader } from './shader';
import type { ShaderMaterial } from './shader-material';

const f32 = Math.fround;

/** `Color::srgb_to_linear` (`core/math/color.h:192`), in binary32. */
function srgbToLinear(value: number): number {
  return value < 0.04045 ? f32(value * f32(1 / 12.92)) : f32(Math.pow(f32((value + 0.055) * (1.0 / (1.0 + 0.055))), 2.4));
}

/**
 * The constant ambient light a scene's environment draws with: its linear colour and three
 * intensity, or null when the environment adds none (`rasterizer_scene_gles3.cpp:1603`). Where the
 * ambient comes from the sky, this is the colour's share, `1 - ambient_light_sky_contribution`
 * (`doc/classes/Environment.xml:60`); the sky's share is its radiance (`godot_world_environment_sky_lighting`).
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1603
 */
export function godot_world_environment_ambient(env: Environment): { readonly color: readonly [number, number, number]; readonly intensity: number } | null {
  const bg = env.bg_mode;
  const source = env.ambient_source;
  if (source === 0 && (bg === 0 || bg === 1)) {
    if (bg === 0) throw new Error('godot-compat: an ambient from the project clear colour is not bound.');
    const c = env.bg_color;
    return { color: [f32(srgbToLinear(c.r) * env.bg_energy_multiplier), f32(srgbToLinear(c.g) * env.bg_energy_multiplier), f32(srgbToLinear(c.b) * env.bg_energy_multiplier)], intensity: Math.PI };
  }
  const fromSky = source === 3 || (source === 0 && bg === 2);
  if (!fromSky && source !== 2) return null;
  const share = fromSky ? 1 - (godot_world_environment_sky_lighting(env)?.ambient ?? 0) : 1;
  if (share === 0) return null;
  const c = env.ambient_color;
  const e = env.ambient_energy * share;
  return { color: [f32(srgbToLinear(c.r) * e), f32(srgbToLinear(c.g) * e), f32(srgbToLinear(c.b) * e)], intensity: Math.PI };
}

/**
 * The fog a scene's environment draws with: its linear colour times energy and its density, or
 * null when fog is off (`rasterizer_scene_gles3.cpp:1646`).
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1646
 */
export function godot_world_environment_fog(env: Environment): { readonly color: readonly [number, number, number]; readonly density: number } | null {
  if (!env.fog_enabled) return null;
  if (env.fog_mode !== 0) throw new Error('godot-compat: depth fog is not bound.');
  const c: Color = env.fog_light_color;
  const e = env.fog_light_energy;
  return { color: [f32(srgbToLinear(c.r) * e), f32(srgbToLinear(c.g) * e), f32(srgbToLinear(c.b) * e)], density: env.fog_density };
}

/** A GLSL float literal of a binary32 value. */
function glsl(value: number): string {
  const text = Number(f32(value).toPrecision(9)).toString();
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/**
 * The post pass's tone mapping (`tonemap_inc.glsl`: `apply_tonemapping`, after `color *=
 * exposure`, `scene.glsl:2794`), the mapper and its parameters fixed into the code.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/shaders/tonemap_inc.glsl:176
 */
export function godot_environment_tonemapping_glsl(env: Environment): string {
  const { params } = godot_environment_tonemap_parameters(env);
  const p = `vec4(${params.map(glsl).join(', ')})`;
  const mapper = env.tone_mapper;
  const body: Readonly<Record<number, string>> = {
    0: 'return color;',
    1: `float white_squared = ${glsl(params[0])};
	vec3 white_squared_color = white_squared * color;
	return (white_squared_color + color * color) / (white_squared_color + white_squared);`,
    2: `const float exposure_bias = 2.0f;
	const float A = 0.22f * exposure_bias * exposure_bias;
	const float B = 0.30f * exposure_bias;
	const float C = 0.10f;
	const float D = 0.20f;
	const float E = 0.01f;
	const float F = 0.30f;
	vec3 color_tonemapped = ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
	return color_tonemapped / ${glsl(params[0])};`,
    3: `const float exposure_bias = 1.8f;
	const float A = 0.0245786f;
	const float B = 0.000090537f;
	const float C = 0.983729f;
	const float D = 0.432951f;
	const float E = 0.238081f;
	const mat3 rgb_to_rrt = mat3(
			vec3(0.59719f * exposure_bias, 0.35458f * exposure_bias, 0.04823f * exposure_bias),
			vec3(0.07600f * exposure_bias, 0.90834f * exposure_bias, 0.01566f * exposure_bias),
			vec3(0.02840f * exposure_bias, 0.13383f * exposure_bias, 0.83777f * exposure_bias));
	const mat3 odt_to_rgb = mat3(
			vec3(1.60475f, -0.53108f, -0.07367f),
			vec3(-0.10208f, 1.10813f, -0.00605f),
			vec3(-0.00327f, -0.07276f, 1.07602f));
	color *= rgb_to_rrt;
	vec3 color_tonemapped = (color * (color + A) - B) / (color * (C * color + D) + E);
	color_tonemapped *= odt_to_rgb;
	return color_tonemapped / ${glsl(params[0])};`,
    4: `vec4 tonemapper_params = ${p};
	const mat3 rec709_to_rec2020_agx_inset_matrix = mat3(
			0.544814746488245, 0.140416948464053, 0.0888104196149096,
			0.373787398372697, 0.754137554567394, 0.178871756420858,
			0.0813978551390581, 0.105445496968552, 0.732317823964232);
	const mat3 agx_outset_rec2020_to_rec709_matrix = mat3(
			1.96488741169489, -0.299313364904742, -0.164352742528393,
			-0.855988495690215, 1.32639796461980, -0.238183969428088,
			-0.108898916004672, -0.0270845997150571, 1.40253671195648);
	const float output_max_value = 1.0;
	color = rec709_to_rec2020_agx_inset_matrix * color;
	const float awp_crossover_point = 0.18;
	const float awp_shoulder_max = output_max_value - awp_crossover_point;
	float awp_contrast = tonemapper_params.x;
	float awp_toe_a = tonemapper_params.y;
	float awp_slope = tonemapper_params.z;
	float awp_w = tonemapper_params.w;
	vec3 s = color - awp_crossover_point;
	vec3 slope_s = awp_slope * s;
	s = slope_s * (1.0 + s / awp_w) / (1.0 + (slope_s / awp_shoulder_max));
	s += awp_crossover_point;
	vec3 t = pow(color, vec3(awp_contrast));
	t = t / (t + awp_toe_a);
	color = mix(s, t, lessThan(color, vec3(awp_crossover_point)));
	color = min(vec3(output_max_value), color);
	color = agx_outset_rec2020_to_rec709_matrix * color;
	return color;`,
  };
  const mapped = body[mapper];
  if (mapped === undefined) throw new Error(`godot-compat: tone mapper ${String(mapper)} is not bound.`);
  // The post pass's (`post.glsl`): the scene shader already scaled by the exposure.
  return `vec3 apply_tonemapping( vec3 color ) {
	${mapper === 0 ? '' : 'color = max(vec3(0.0), color);'}
	${mapped}
}`;
}

/**
 * `Environment::ToneMapper` (`environment.h:66`) as three's tone mapping that draws it: linear,
 * Reinhard, filmic (three's Cineon, a filmic curve), ACES, and for AgX three's Neutral. Godot's
 * AgX (`tonemap_inc.glsl`, 4.5 on) is a curve of its own, linear through the mid-tones with a toe
 * and a shoulder, that keeps a colour's saturation; three's AgX is Blender's, which encodes in log
 * space and greys lit colours out. Three's Neutral (Khronos PBR Neutral) is the curve of its own
 * that draws Godot's AgX: linear through the mid-tones, compressing only the highlights.
 */
const TONE_MAPPINGS: readonly ToneMapping[] = [LinearToneMapping, ReinhardToneMapping, CineonToneMapping, ACESFilmicToneMapping, NeutralToneMapping];

/** The sky pass's code around the shader's `sky()` body (`sky.glsl:159`), `COLOR` in sRGB terms. */
function skyFragment(shader: Shader): string {
  const lowered = shader.lowered;
  return `#define M_PI 3.14159265359
uniform float sky_energy_multiplier;
uniform float time;
${SKY_LIGHT_UNIFORMS}
varying vec3 vGodotSkyDirection;
${lowered.uniforms.map((uniform) => `uniform ${uniform.type} ${uniform.glsl};`).join('\n')}

float acos_approx(float p_x) {
	float x = abs(p_x);
	float res = -0.156583f * x + (M_PI / 2.0);
	res *= sqrt(1.0f - x);
	return (p_x >= 0.0) ? res : M_PI - res;
}

float atan2_approx(float y, float x) {
	float a = min(abs(x), abs(y)) / max(abs(x), abs(y));
	float s = a * a;
	float poly = 0.0872929f;
	poly = -0.301895f + poly * s;
	poly = 1.0f + poly * s;
	poly = poly * a;
	float r = abs(y) > abs(x) ? (M_PI / 2.0) - poly : poly;
	r = x < 0.0 ? M_PI - r : r;
	r = y < 0.0 ? -r : r;
	return r;
}

${lowered.functions}

void main() {
	vec3 cube_normal = normalize(vGodotSkyDirection);
	vec2 uv = gl_FragCoord.xy;
	vec3 position = cameraPosition;
	vec2 panorama_coords = vec2(atan2_approx(cube_normal.x, -cube_normal.z), acos_approx(cube_normal.y));
	if (panorama_coords.x < 0.0) {
		panorama_coords.x += M_PI * 2.0;
	}
	panorama_coords /= vec2(M_PI * 2.0, M_PI);
	vec3 color = vec3(0.0, 0.0, 0.0);
	float alpha = 1.0;
	{
${lowered.entry}
	}
	color *= sky_energy_multiplier;
	color = color * (color * (color * 0.305306011 + 0.682171111) + 0.012522878);
	gl_FragColor = vec4(color, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
${lowered.renderModes.includes('use_debanding') ? SKY_DEBANDING : ''}}
`;
}

/**
 * `render_mode use_debanding`: the sky pass's noise, one 8-bit step, added to the sky's output
 * (`sky.glsl:134`, `:276`). Where the post pass is off, the sky draws straight to three's sRGB
 * output and the noise lands on sRGB values, as Godot's does with `luminance_multiplier` 1. Where
 * the post pass draws (`godot_environment_post_enabled`), the composer's render pass draws the sky
 * into its linear input buffer, so the noise lands on linear values before the post pass encodes
 * them (`environment-post.ts`), and is larger near black than Godot's. Godot adds it to the sRGB
 * values in its own buffer, both scaled by `luminance_multiplier`, 0.25 with glow on a 10-bit target
 * (`rasterizer_scene_gles3.cpp:2465-2469`).
 */
const SKY_DEBANDING = `	{
		const vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
		float res = fract(magic.z * fract(dot(gl_FragCoord.xy, magic.xy))) * 2.0 - 1.0;
		gl_FragColor.rgb += vec3(res, -res, res) / 255.0 * sky_energy_multiplier;
	}
`;

/** The sky pass's four directional lights, one set of uniforms per `LIGHTn` (`sky-shader.ts`). */
const SKY_LIGHTS = 4;
const SKY_LIGHT_UNIFORMS = Array.from({ length: SKY_LIGHTS }, (_, n) =>
  [`uniform bool godot_sky_light${String(n)}_enabled;`, `uniform vec3 godot_sky_light${String(n)}_direction;`, `uniform float godot_sky_light${String(n)}_energy;`, `uniform vec3 godot_sky_light${String(n)}_color;`, `uniform float godot_sky_light${String(n)}_size;`].join('\n'),
).join('\n');

/** One `LIGHTn` of a sky's three material: its uniforms, written in place each render. */
interface SkyLightSlot {
  readonly enabled: { value: boolean };
  /** `basis.xform(Vector3(0, 0, 1)).normalized()`, in float. */
  readonly direction: { readonly value: Vector3 };
  readonly energy: { value: number };
  readonly color: { readonly value: Vector3 };
  readonly size: { value: number };
}

/** The four `LIGHTn` slots of a sky's three material (`godot_sky_material_three`). */
function skyLightSlots(three: ThreeShaderMaterial): readonly SkyLightSlot[] {
  return Array.from({ length: SKY_LIGHTS }, (_, n) => {
    const uniform = (name: string) => three.uniforms[`godot_sky_light${String(n)}_${name}`];
    return { enabled: uniform('enabled'), direction: uniform('direction'), energy: uniform('energy'), color: uniform('color'), size: uniform('size') } as SkyLightSlot;
  });
}

/** A directional light the plan hands the sky, as the ref on its element. */
export type GodotSkyLightRef = RefObject<DirectionalLight | null>;

/** Writes one slot from a light, returning whether any of its values changed. */
function writeSlot(slot: SkyLightSlot, light: GodotSkyLight, x: number, y: number, z: number): boolean {
  const [r, g, b] = light.color;
  const same =
    slot.enabled.value &&
    slot.energy.value === light.energy &&
    slot.size.value === light.size &&
    slot.direction.value.x === x &&
    slot.direction.value.y === y &&
    slot.direction.value.z === z &&
    slot.color.value.x === r &&
    slot.color.value.y === g &&
    slot.color.value.z === b;
  if (same) return false;
  slot.enabled.value = true;
  slot.energy.value = light.energy;
  slot.size.value = light.size;
  slot.direction.value.set(x, y, z);
  slot.color.value.set(r, g, b);
  return true;
}

/** Whether `object` draws in `scene`: it and every node above it up to the scene are visible. */
function shownIn(object: Object3D, scene: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false;
    if (node === scene) return true;
  }
  return false;
}

/**
 * Writes the sky's lights into `slots` in place, as `_setup_sky` fills the light buffer: of
 * `lights`, the directional lights the plan named for the sky, the mounted and visible ones the sky
 * sees (sky mode not `LIGHT_ONLY`), at most four, the rest disabled. Returns whether any slot
 * changed.
 *
 * @godot WorldEnvironment (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:741
 */
function writeSkyLights(scene: Object3D, lights: readonly GodotSkyLightRef[], slots: readonly SkyLightSlot[]): boolean {
  let changed = false;
  let n = 0;
  for (const ref of lights) {
    if (n >= SKY_LIGHTS) break;
    const light = ref.current;
    if (light === null || !shownIn(light, scene)) continue;
    const seen = godot_light_3d_sky_light(light);
    if (seen === null) continue;
    // `basis.xform(Vector3(0, 0, 1))` is the global basis's z column; `Vector3::normalize`
    // (`vector3.h:548`) in float.
    const column = get_global_basis(light).z;
    const x = f32(column.x);
    const y = f32(column.y);
    const z = f32(column.z);
    const length = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))));
    const slot = slots[n] as SkyLightSlot;
    n += 1;
    if (length === 0) changed = writeSlot(slot, seen, 0, 0, 0) || changed;
    else changed = writeSlot(slot, seen, f32(x / length), f32(y / length), f32(z / length)) || changed;
  }
  for (; n < SKY_LIGHTS; n += 1) {
    const slot = slots[n] as SkyLightSlot;
    if (!slot.enabled.value) continue;
    slot.enabled.value = false;
    changed = true;
  }
  return changed;
}

const SKY_VERTEX = `varying vec3 vGodotSkyDirection;
void main() {
	vGodotSkyDirection = position;
	vec4 projected = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
	gl_Position = projected.xyww;
}
`;

/** A lowered uniform's value for three: the material's parameter, else the shader's default. */
function uniformValue(material: ShaderMaterial, uniform: Shader['lowered']['uniforms'][number]): unknown {
  const set = material.parameters.get(uniform.name);
  if (set !== undefined && set !== null) {
    const value = set as { readonly r?: number; readonly x?: number } | number | Texture | CubeTexture;
    if (typeof value === 'object' && value !== null && 'r' in value && !('isTexture' in value)) {
      const c = value as Color;
      return uniform.type === 'vec4' ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b];
    }
    return value;
  }
  const initial = uniform.default;
  if (initial === null || initial.length === 0) return uniform.type.startsWith('sampler') ? null : uniform.type === 'float' || uniform.type === 'int' ? 0 : [0, 0, 0, 0].slice(0, Number(uniform.type.slice(-1)));
  return initial.length === 1 ? initial[0] : [...initial];
}

/**
 * The three material a sky's `ShaderMaterial` draws with: the sky pass's fragment code around the
 * lowered `sky()` body, the material's parameters (else the shader's defaults) as uniforms, kept
 * current by a listener on the material while it draws. `dispose` removes the listener and
 * disposes the three material; another drawing of the same material keeps its own.
 *
 * @godot WorldEnvironment (protocol)
 * @source drivers/gles3/shaders/sky.glsl:184
 */
export function godot_sky_material_three(material: ShaderMaterial, energy: number): { readonly three: ThreeShaderMaterial; readonly dispose: () => void } {
  const shader = material.shader;
  if (shader === null) throw new Error('godot-compat: a sky material without a shader draws nothing.');
  if (shader.lowered.mode !== 'sky') throw new Error(`godot-compat: a ${shader.lowered.mode} shader cannot draw a sky.`);
  const uniforms: Record<string, { value: unknown }> = { sky_energy_multiplier: { value: energy }, time: { value: 0 } };
  for (let n = 0; n < SKY_LIGHTS; n += 1) {
    Object.assign(uniforms, {
      [`godot_sky_light${String(n)}_enabled`]: { value: false },
      [`godot_sky_light${String(n)}_direction`]: { value: new Vector3(0, 0, 1) },
      [`godot_sky_light${String(n)}_energy`]: { value: 0 },
      [`godot_sky_light${String(n)}_color`]: { value: new Vector3() },
      [`godot_sky_light${String(n)}_size`]: { value: 0 },
    });
  }
  for (const uniform of shader.lowered.uniforms) uniforms[uniform.glsl] = { value: uniformValue(material, uniform) };
  const three = new ThreeShaderMaterial({
    uniforms,
    vertexShader: SKY_VERTEX,
    fragmentShader: skyFragment(shader),
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  three.toneMapped = true;
  const listener = (name: string, value: unknown): void => {
    const uniform = shader.lowered.uniforms.find((entry) => entry.name === name);
    if (uniform !== undefined) (three.uniforms[uniform.glsl] as { value: unknown }).value = value ?? uniformValue(material, uniform);
  };
  material.listeners.add(listener);
  return {
    three,
    dispose: () => {
      material.listeners.delete(listener);
      three.dispose();
    },
  };
}

/**
 * How the sky lights a scene's materials: whether they reflect it, and its share of the diffuse
 * ambient; null when it lights nothing or the environment has no sky material.
 * - `reflected_light_source` (`doc/classes/Environment.xml:203`): the background (`:419`) reflects
 *   the sky when the background is the sky, the sky (`:425`) always, disabled (`:422`) never;
 * - `ambient_light_source` (`:64`): the background (`:407`) takes the ambient from the sky when the
 *   background is the sky, the sky (`:416`) always, at the share `ambient_light_sky_contribution`
 *   (`:60`), the rest from the ambient colour.
 *
 * @godot Environment (protocol)
 * @source doc/classes/Environment.xml:203
 */
export function godot_world_environment_sky_lighting(env: Environment): { readonly reflection: boolean; readonly ambient: number } | null {
  if ((env.sky?.sky_material ?? null) === null) return null;
  const skyBackground = env.bg_mode === 2;
  const reflection = env.reflection_source === 2 || (env.reflection_source === 0 && skyBackground);
  const ambient = env.ambient_source === 3 || (env.ambient_source === 0 && skyBackground) ? env.ambient_sky_contribution : 0;
  return reflection || ambient > 0 ? { reflection, ambient } : null;
}

/**
 * The sky's radiance on `scene`: the sky's three material captured into a prefiltered environment
 * by three's `PMREMGenerator` (one per drawing, as three's examples make it) and set as
 * `scene.environment`, which three's standard and physical materials reflect and take their diffuse
 * ambient from. Its intensity is 1 where the sky is reflected, else the sky's ambient share. The
 * capture is redone in a frame only after the sky's parameters or its lights change: a sky whose
 * shader reads `TIME` is not recaptured as time passes, where a `Sky`'s automatic process mode
 * updates such a sky's radiance in real time (`doc/classes/Sky.xml`). Returns what the
 * environment's frame hook calls, told whether the sky's lights changed, and the undo.
 */
function drawSkyRadiance(
  scene: Scene,
  gl: WebGLRenderer,
  env: Environment,
  material: ShaderMaterial,
  sky: ThreeShaderMaterial,
  lighting: { readonly reflection: boolean; readonly ambient: number },
): { readonly frame: (lightsChanged: boolean) => void; readonly undo: () => void } {
  const capture = new Scene();
  const box = new Mesh(new BoxGeometry(1, 1, 1), sky);
  box.frustumCulled = false;
  capture.add(box);
  // `Sky.radiance_size` (`doc/classes/Sky.xml:15`): 32 pixels, doubled per step.
  const size = 32 * 2 ** Math.min(Math.max(env.sky?.radiance_size ?? 3, 0), 6);
  const previous = { environment: scene.environment, intensity: scene.environmentIntensity };
  // Made at the first capture (its constructor compiles its blur shader).
  let pmrem: PMREMGenerator | null = null;
  let target: WebGLRenderTarget | null = null;
  let stale = true;
  // A parameter change marks the capture stale; the sky's three material updates its own uniforms.
  const listener = (): void => {
    stale = true;
  };
  material.listeners.add(listener);
  // A capture the renderer cannot make is reported once; the scene then draws
  // without the sky's radiance rather than failing every frame.
  let failed = false;
  const frame = (lightsChanged: boolean): void => {
    if (failed || (!stale && !lightsChanged)) return;
    stale = false;
    let next: WebGLRenderTarget;
    try {
      pmrem ??= new PMREMGenerator(gl);
      next = pmrem.fromScene(capture, 0, 0.1, 100, { size });
    } catch (error) {
      failed = true;
      console.error("godot-compat: the sky's radiance could not be captured; the scene draws without it.", error);
      return;
    }
    target?.dispose();
    target = next;
    scene.environment = next.texture;
    scene.environmentIntensity = lighting.reflection ? 1 : lighting.ambient;
  };
  const undo = (): void => {
    material.listeners.delete(listener);
    scene.environment = previous.environment;
    scene.environmentIntensity = previous.intensity;
    target?.dispose();
    pmrem?.dispose();
    box.geometry.dispose();
  };
  return { frame, undo };
}

const ENVIRONMENT = new WeakMap<object, Environment | null>();

/**
 * @godot WorldEnvironment.set_environment
 * @source scene/3d/world_environment.cpp:111
 */
export function set_environment(self: object, environment: Environment | null): void {
  ENVIRONMENT.set(self, environment);
}

/**
 * @godot WorldEnvironment.get_environment
 * @source scene/3d/world_environment.cpp:132
 */
export function get_environment(self: object): Environment | null {
  return ENVIRONMENT.get(self) ?? null;
}

const WORLD_ENVIRONMENT: GodotElementClass<Group> = {
  create: () => new Group(),
  classes: ['WorldEnvironment', 'Node', 'Object'],
  spatial: false,
  mount: (entity) => set_environment(entity, null),
  props: new Map<string, GodotElementProp<Group>>([['environment', (self, value: Environment | null) => set_environment(self, value)]]),
};

/** A WorldEnvironment's props: the node's, and the refs of the directional lights its sky reads. */
export type GodotWorldEnvironmentProps = GodotElementProps<Group> & {
  /** The directional lights the plan names for the sky, in scene order (`scene-sky-lights.ts`). */
  readonly skyLights?: readonly GodotSkyLightRef[];
};

const NO_SKY_LIGHTS: readonly GodotSkyLightRef[] = [];

/**
 * A WorldEnvironment as a scene writes it (`world_environment.cpp:134`: `environment`): the node,
 * and its environment drawn on the scene R3F renders while it is mounted, by its own processing
 * each frame: the environment resolved for R3F's camera, the sky's lights (`skyLights`) written
 * into the sky's uniforms, and the radiance captured again when they or the sky's parameters
 * changed.
 *
 * @godot WorldEnvironment (protocol)
 * @source scene/3d/world_environment.cpp:134
 */
export function GodotWorldEnvironment({ skyLights = NO_SKY_LIGHTS, ...props }: GodotWorldEnvironmentProps): ReactElement {
  const element = useGodotElement(WORLD_ENVIRONMENT, props);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const get = useThree((state) => state.get);
  const lights = useRef(skyLights);
  lights.current = skyLights;
  // The node is made once (`useGodotElement`): a render of the scene registers nothing again.
  const node = (element.props as { object?: Group }).object;
  useLayoutEffect(() => {
    if (node === undefined) return undefined;
    return godot_world_environment_register(scene, node);
  }, [node, scene]);
  // Its drawing, from its own component's frame while it is inside the tree (`useGodotDraw`).
  useGodotDraw(node, () => {
    if (node === undefined) return;
    const state = get();
    drawFrame(scene, node, state.gl, state.camera, lights.current);
  });
  // Glow, SSAO or the adjustments: the renderer's post pass (`environment-post.ts`), which
  // `postprocessing`'s composer renders in place of R3F's own frame, without MSAA as Godot's 3D
  // (`rendering/anti_aliasing/quality/msaa_3d`, 0).
  const env = (props['environment'] ?? null) as Environment | null;
  const post = useMemo(
    () => (env !== null && godot_environment_post_enabled(env) ? new GodotPostEffect(env, godot_environment_tonemapping_glsl(env), godot_environment_tonemap_parameters(env).white) : null),
    [env],
  );
  if (post === null) return element;
  // The composer draws the scene through the camera the viewport draws with now (its own default is
  // R3F's camera when it mounts, before the scene's current camera is chosen).
  return createElement(Fragment, null, element, createElement(EffectComposer, { multisampling: 0, depthBuffer: true, scene, camera, children: createElement('primitive', { object: post }) }));
}

/** What a scene draws its environment from, and the environment it drew last. */
interface Drawn {
  /** The WorldEnvironments drawing on this scene, in mount order: the first one's is the world's. */
  readonly worlds: Group[];
  environment: Environment | null;
  undo: () => void;
  /** What the drawn environment does in a frame, given the sky's lights. */
  frame: (lights: readonly GodotSkyLightRef[]) => void;
  compiled: boolean;
}

const DRAWN = new WeakMap<Scene, Drawn>();

const NOTHING_DRAWN = { undo: () => undefined, frame: () => undefined };

/**
 * A WorldEnvironment drawing on `scene`, in mount order; the returned function withdraws it, and
 * undoes the drawing when it was the one drawing.
 *
 * @godot WorldEnvironment (protocol)
 * @source scene/3d/world_environment.cpp:78
 */
export function godot_world_environment_register(scene: Scene, node: Group): () => void {
  let drawn = DRAWN.get(scene);
  if (drawn === undefined) {
    drawn = { worlds: [], environment: null, undo: NOTHING_DRAWN.undo, frame: NOTHING_DRAWN.frame, compiled: false };
    DRAWN.set(scene, drawn);
  }
  const state = drawn;
  state.worlds.push(node);
  return () => {
    const drawing = state.worlds[0] === node;
    state.worlds.splice(state.worlds.indexOf(node), 1);
    if (!drawing) return;
    // The next WorldEnvironment, if any, draws its own in its next frame.
    state.undo();
    state.undo = NOTHING_DRAWN.undo;
    state.frame = NOTHING_DRAWN.frame;
    state.environment = null;
  };
}

/**
 * The environment `scene` draws with `camera`: the camera's own, else the world's, the first
 * WorldEnvironment's (`RendererSceneCull::_render_get_environment`, renderer_scene_cull.cpp:3722).
 *
 * @godot WorldEnvironment (protocol)
 * @source servers/rendering/renderer_scene_cull.cpp:3722
 */
export function godot_world_environment_resolve(scene: Scene, camera: Camera): Environment | null {
  const own = (camera as { readonly isPerspectiveCamera?: boolean }).isPerspectiveCamera === true ? get_camera_environment(camera as PerspectiveCamera) : null;
  return own ?? (DRAWN.get(scene)?.worlds ?? []).map((node) => get_environment(node)).find((env) => env !== null) ?? null;
}

/**
 * One frame of `node`'s environment on `scene`, its own processing: the scene's first
 * WorldEnvironment draws, the others wait. A changed environment is drawn again and the scene's
 * materials recompiled for the tone mapping they run; then the drawing's frame writes the sky's
 * lights and recaptures the radiance if they or the sky changed.
 */
function drawFrame(scene: Scene, node: Group, gl: WebGLRenderer, camera: Camera, lights: readonly GodotSkyLightRef[]): void {
  const state = DRAWN.get(scene);
  if (state === undefined || state.worlds[0] !== node) return;
  const env = godot_world_environment_resolve(scene, camera);
  if (env !== state.environment || !state.compiled) {
    state.undo();
    const drawing = env === null ? NOTHING_DRAWN : drawEnvironment(scene, gl, env);
    state.undo = drawing.undo;
    state.frame = drawing.frame;
    if (state.compiled) {
      scene.traverse((object) => {
        const materials = (object as { material?: Material | Material[] }).material;
        for (const entry of Array.isArray(materials) ? materials : materials === undefined ? [] : [materials]) entry.needsUpdate = true;
      });
    }
    state.environment = env;
    state.compiled = true;
  }
  state.frame(lights);
}

/** Draws `env` on `scene` with `gl`: what its frame hook does each frame, and the undo. */
function drawEnvironment(scene: Scene, gl: WebGLRenderer, env: Environment): { readonly frame: (lights: readonly GodotSkyLightRef[]) => void; readonly undo: () => void } {
  const undo: (() => void)[] = [];
  let frame = (_lights: readonly GodotSkyLightRef[]): void => undefined;
  const skyMaterial = env.sky?.sky_material ?? null;
  const lighting = godot_world_environment_sky_lighting(env);
  // The sky's three material, drawn as the background, captured as the radiance, or both. Each
  // drawing listens to the sky material's parameters while it draws and stops when it is undone,
  // so drawings sharing one sky leave each other's listeners.
  const drawsSky = skyMaterial !== null && (env.bg_mode === 2 || lighting !== null);
  const skyDrawing = drawsSky ? godot_sky_material_three(skyMaterial, env.bg_energy_multiplier) : null;
  if (skyDrawing !== null) undo.push(skyDrawing.dispose);
  const sky = skyDrawing?.three ?? null;
  // The background: a box whose vertex code keeps only the view's rotation (`SKY_VERTEX`), so it
  // surrounds whichever camera draws it without following it.
  if (env.bg_mode === 2) {
    if (sky !== null) {
      const box = new Mesh(new BoxGeometry(1, 1, 1), sky);
      box.frustumCulled = false;
      box.renderOrder = -Number.MAX_SAFE_INTEGER;
      godot_node_foreign(box);
      scene.add(box);
      undo.push(() => {
        scene.remove(box);
        box.geometry.dispose();
      });
    }
  } else if (env.bg_mode === 1) {
    const c = env.bg_color;
    const previous = scene.background;
    scene.background = new ThreeColor(srgbToLinear(c.r) * env.bg_energy_multiplier, srgbToLinear(c.g) * env.bg_energy_multiplier, srgbToLinear(c.b) * env.bg_energy_multiplier);
    undo.push(() => {
      scene.background = previous;
    });
  }
  // The sky's lights, written in place each frame: the background and the radiance draw with the
  // one material, and the radiance is captured again only when they change.
  if (sky !== null && skyMaterial !== null) {
    const slots = skyLightSlots(sky);
    const radiance = lighting === null ? null : drawSkyRadiance(scene, gl, env, skyMaterial, sky, lighting);
    if (radiance !== null) undo.push(radiance.undo);
    frame = (lights) => {
      const lightsChanged = writeSkyLights(scene, lights, slots);
      radiance?.frame(lightsChanged);
    };
  }
  // The ambient light.
  const ambient = godot_world_environment_ambient(env);
  if (ambient !== null) {
    const light = new AmbientLight(new ThreeColor(...ambient.color), ambient.intensity);
    godot_node_foreign(light);
    scene.add(light);
    undo.push(() => scene.remove(light));
  }
  // The fog.
  const fog = godot_world_environment_fog(env);
  if (fog !== null) {
    const previous = scene.fog;
    scene.fog = new FogExp2(new ThreeColor(...fog.color).getHex(), fog.density);
    undo.push(() => {
      scene.fog = previous;
    });
  }
  // The tone mapping: three's own of the same name, with the exposure; the post pass tone-maps
  // itself where it draws.
  const previousMapping = gl.toneMapping;
  const previousExposure = gl.toneMappingExposure;
  gl.toneMapping = godot_environment_post_enabled(env) ? NoToneMapping : (TONE_MAPPINGS[env.tone_mapper] ?? LinearToneMapping);
  gl.toneMappingExposure = env.tonemap_exposure;
  undo.push(() => {
    gl.toneMapping = previousMapping;
    gl.toneMappingExposure = previousExposure;
  });
  return {
    frame,
    undo: () => {
      for (const step of undo.reverse()) step();
    },
  };
}
