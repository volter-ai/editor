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
 *   conversion to linear by `srgb_to_linear`'s polynomial), its `LIGHTn_*` built-ins filled each
 *   frame as `_setup_sky` fills the sky's light buffer (`rasterizer_scene_gles3.cpp:741`): up to
 *   four directional lights the sky sees (sky mode not `LIGHT_ONLY`), each its direction
 *   `basis * (0, 0, 1)` normalized, its energy, its colour as authored and its size in radians,
 *   the rest disabled; a colour background is the scene's
 *   clear colour (`scene.background`), scaled by the energy multiplier;
 * - a constant-colour ambient (`AMBIENT_SOURCE_COLOR`, or the background's colour) is a three
 *   `AmbientLight`: the renderer adds `ambient_light_color_energy * albedo * (1 - metallic)`
 *   (`scene.glsl:2580`, `:2780`) from the colour converted by `Color::srgb_to_linear` and scaled by
 *   the energy (`rasterizer_scene_gles3.cpp:1618`); three adds its light times
 *   `BRDF_Lambert = albedo / PI`, so the light's intensity is `PI * energy`;
 * - tone mapping is the renderer's (`tonemap_inc.glsl`: `color *= exposure`, then the tone mapper
 *   with the parameters `godot_environment_tonemap_parameters` computes) as three's
 *   `CustomToneMapping`, which every tone-mapped three material runs before its output conversion;
 * - fog is three's `FogExp2` of the fog colour (linear, times its energy) and density.
 *
 * The environment drawn is resolved each time a viewport's scene renders, as the renderer resolves
 * it per camera (`RendererSceneCull::_render_get_environment`, renderer_scene_cull.cpp:3722): the
 * drawing camera's own (`Camera3D.environment`), else the world's.
 *
 * Named deviations: `fog-model` (Godot fogs by `1 - exp(-distance * density)` per vertex, three's
 * `FogExp2` by `1 - exp(-(depth * density)^2)` per fragment; height fog and sun scatter are not
 * drawn, nor fog on the sky); `sky-radiance` (the sky's radiance, which Godot's materials reflect and
 * an ambient source of `SKY` lights with, is not captured: a scene whose ambient comes from the sky
 * refuses, and reflections of it are not drawn); `sky-light-order` (the sky's lights are the
 * visible directional lights in scene-tree order, where Godot takes them in the order they entered
 * the world: the same for authored scenes, possibly different for lights a script adds or moves);
 * `srgb-output` (three writes sRGB with the exact
 * transfer function where Godot uses `linear_to_srgb`'s approximation, `tonemap_inc.glsl:14`).
 */

import { useThree } from '@react-three/fiber';
import { EffectComposer } from '@react-three/postprocessing';
import { createElement, Fragment, type ReactElement, useLayoutEffect, useMemo } from 'react';
import { GodotPostEffect, godot_environment_post_enabled } from './environment-post';
import {
  AmbientLight,
  BoxGeometry,
  type Camera,
  BackSide,
  Color as ThreeColor,
  type DirectionalLight,
  type CubeTexture,
  CustomToneMapping,
  FogExp2,
  Group,
  type Material,
  Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  ShaderChunk,
  ShaderMaterial as ThreeShaderMaterial,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { Color } from './color';
import { type Environment, godot_environment_tonemap_parameters } from './environment';
import { get_environment as get_camera_environment, godot_camera_3d_world_listener } from './camera-3d';
import { type GodotSkyLight, godot_light_3d_sky_light } from './light-3d';
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
 * The ambient light a scene's environment draws with: its linear colour and three intensity, or
 * null when the environment adds none (`rasterizer_scene_gles3.cpp:1603`); an ambient from the sky
 * throws by name (`sky-radiance`).
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
  if ((source === 0 && bg === 2) || source === 3) throw new Error('godot-compat: an ambient from the sky is not drawn (sky-radiance).');
  if (source !== 2) return null;
  const c = env.ambient_color;
  const e = env.ambient_energy;
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
 * The renderer's tone mapping (`tonemap_inc.glsl`: `apply_tonemapping`, after `color *=
 * exposure`, `scene.glsl:2794`) as three's `CustomToneMapping` function, the mapper and its
 * parameters fixed into the code.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/shaders/tonemap_inc.glsl:176
 */
export function godot_environment_tonemapping_glsl(env: Environment, post = false): string {
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
  return `vec3 ${post ? 'apply_tonemapping' : 'CustomToneMapping'}( vec3 color ) {
	${post ? '' : 'color *= toneMappingExposure;'}
	${mapper === 0 ? '' : 'color = max(vec3(0.0), color);'}
	${mapped}
}`;
}

/** three's own tone mapping chunk, before any environment rewrote its custom function. */
const TONEMAPPING_CHUNK = ShaderChunk.tonemapping_pars_fragment;
const CUSTOM_STUB = /vec3 CustomToneMapping\( vec3 color \) \{ return color; \}/;

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
 * `render_mode use_debanding`: the sky pass's noise added to its sRGB output (`sky.glsl:134`,
 * `:276`), `luminance_multiplier` 1 (named `post-buffer-precision` where the post pass draws).
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

/** One directional light as the sky pass receives it. */
export interface GodotWorldSkyLight extends GodotSkyLight {
  /** `basis.xform(Vector3(0, 0, 1)).normalized()`, in float. */
  readonly direction: readonly [number, number, number];
}

/**
 * The directional lights `scene` hands its sky pass, as `_setup_sky` fills the light buffer: the
 * visible ones the sky sees (sky mode not `LIGHT_ONLY`), in scene order, at most four.
 *
 * @godot WorldEnvironment (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:741
 */
export function godot_world_environment_sky_lights(scene: Object3D): GodotWorldSkyLight[] {
  const f32 = Math.fround;
  const lights: GodotWorldSkyLight[] = [];
  const visit = (object: Object3D): void => {
    if (!object.visible || lights.length >= SKY_LIGHTS) return;
    if ((object as { readonly isDirectionalLight?: boolean }).isDirectionalLight === true) {
      const sky = godot_light_3d_sky_light(object as DirectionalLight);
      if (sky !== null) {
        // `basis.xform(Vector3(0, 0, 1))` is the global basis's z column; `Vector3::normalize`
        // (`vector3.h:548`) in float.
        const column = get_global_basis(object).z;
        const [x, y, z] = [f32(column.x), f32(column.y), f32(column.z)];
        const length = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))));
        const direction: [number, number, number] = length === 0 ? [0, 0, 0] : [f32(x / length), f32(y / length), f32(z / length)];
        lights.push({ ...sky, direction });
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(scene);
  return lights;
}

/** Fills a sky material's light uniforms from `scene`'s sky lights, the rest disabled. */
function updateSkyLights(three: ThreeShaderMaterial, scene: Object3D): void {
  const lights = godot_world_environment_sky_lights(scene);
  for (let n = 0; n < SKY_LIGHTS; n += 1) {
    const entry = lights[n];
    const set = (name: string, value: unknown) => {
      (three.uniforms[`godot_sky_light${String(n)}_${name}`] as { value: unknown }).value = value;
    };
    set('enabled', entry !== undefined);
    if (entry === undefined) continue;
    set('direction', [...entry.direction]);
    set('energy', entry.energy);
    set('color', [...entry.color]);
    set('size', entry.size);
  }
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
 * lowered `sky()` body, the material's parameters (else the shader's defaults) as uniforms.
 *
 * @godot WorldEnvironment (protocol)
 * @source drivers/gles3/shaders/sky.glsl:184
 */
export function godot_sky_material_three(material: ShaderMaterial, energy: number): ThreeShaderMaterial {
  const shader = material.shader;
  if (shader === null) throw new Error('godot-compat: a sky material without a shader draws nothing.');
  if (shader.lowered.mode !== 'sky') throw new Error(`godot-compat: a ${shader.lowered.mode} shader cannot draw a sky.`);
  const uniforms: Record<string, { value: unknown }> = { sky_energy_multiplier: { value: energy }, time: { value: 0 } };
  for (let n = 0; n < SKY_LIGHTS; n += 1) {
    Object.assign(uniforms, {
      [`godot_sky_light${String(n)}_enabled`]: { value: false },
      [`godot_sky_light${String(n)}_direction`]: { value: [0, 0, 1] },
      [`godot_sky_light${String(n)}_energy`]: { value: 0 },
      [`godot_sky_light${String(n)}_color`]: { value: [0, 0, 0] },
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
  material.changed = (name, value) => {
    const uniform = shader.lowered.uniforms.find((entry) => entry.name === name);
    if (uniform !== undefined) (three.uniforms[uniform.glsl] as { value: unknown }).value = value ?? uniformValue(material, uniform);
  };
  return three;
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

/**
 * A WorldEnvironment as a scene writes it (`world_environment.cpp:134`: `environment`): the node,
 * and its environment drawn on the scene R3F renders while it is mounted.
 *
 * @godot WorldEnvironment (protocol)
 * @source scene/3d/world_environment.cpp:134
 */
export function GodotWorldEnvironment(props: GodotElementProps<Group>): ReactElement {
  const element = useGodotElement(WORLD_ENVIRONMENT, props);
  const scene = useThree((state) => state.scene);
  // The node is made once (`useGodotElement`): a render of the scene registers nothing again.
  const node = (element.props as { object?: Group }).object;
  useLayoutEffect(() => {
    if (node === undefined) return undefined;
    return godot_world_environment_register(scene, node);
  }, [node, scene]);
  // Glow, SSAO or the adjustments: the renderer's post pass (`environment-post.ts`), which
  // `postprocessing`'s composer renders in place of R3F's own frame, without MSAA as Godot's 3D
  // (`rendering/anti_aliasing/quality/msaa_3d`, 0).
  const env = (props['environment'] ?? null) as Environment | null;
  const post = useMemo(
    () => (env !== null && godot_environment_post_enabled(env) ? new GodotPostEffect(env, godot_environment_tonemapping_glsl(env, true), godot_environment_tonemap_parameters(env).white) : null),
    [env],
  );
  if (post === null) return element;
  return createElement(Fragment, null, element, createElement(EffectComposer, { multisampling: 0, depthBuffer: true, children: createElement('primitive', { object: post }) }));
}

/** What a viewport's scene draws its environment from, and the environment it drew last. */
interface Drawn {
  /** The WorldEnvironments drawing on this scene, in mount order: the first one's is the world's. */
  readonly worlds: Group[];
  environment: Environment | null;
  undo: () => void;
  compiled: boolean;
}

const DRAWN = new WeakMap<Scene, Drawn>();

/**
 * The environment a viewport draws with a camera (`RendererSceneCull::_render_get_environment`,
 * renderer_scene_cull.cpp:3722): the camera's own, else the world's (its first WorldEnvironment's).
 * Resolved each time the scene renders, as the renderer resolves it per camera; a change redraws
 * it, and recompiles the scene's materials for the tone mapping they run.
 */
function drawnOf(scene: Scene): Drawn {
  let drawn = DRAWN.get(scene);
  if (drawn === undefined) {
    const state: Drawn = { worlds: [], environment: null, undo: () => undefined, compiled: false };
    drawn = state;
    DRAWN.set(scene, state);
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = (renderer, drawnScene, camera, target, material, group) => {
      previous.call(scene, renderer, drawnScene, camera, target, material, group);
      const env = godot_world_environment_resolve(scene, camera);
      if (env === state.environment && state.compiled) return;
      state.undo();
      state.undo = env === null ? () => undefined : drawEnvironment(scene, renderer, env);
      if (state.compiled) {
        scene.traverse((object) => {
          const materials = (object as { material?: Material | Material[] }).material;
          for (const entry of Array.isArray(materials) ? materials : materials === undefined ? [] : [materials]) entry.needsUpdate = true;
        });
      }
      state.environment = env;
      state.compiled = true;
    };
  }
  return drawn;
}

/**
 * A WorldEnvironment drawing on `scene`, in mount order; the returned function withdraws it.
 *
 * @godot WorldEnvironment (protocol)
 * @source scene/3d/world_environment.cpp:78
 */
export function godot_world_environment_register(scene: Scene, node: Group): () => void {
  const drawn = drawnOf(scene);
  drawn.worlds.push(node);
  return () => {
    drawn.worlds.splice(drawn.worlds.indexOf(node), 1);
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
  return own ?? drawnOf(scene).worlds.map((node) => get_environment(node)).find((env) => env !== null) ?? null;
}

// A camera with its own environment draws on its viewport's scene.
godot_camera_3d_world_listener((camera, viewport) => {
  if (get_camera_environment(camera) !== null && (viewport as { readonly isScene?: boolean }).isScene === true) drawnOf(viewport as Scene);
});

/** Draws `env` on `scene` with `gl`; the returned function undoes it. */
function drawEnvironment(scene: Scene, gl: WebGLRenderer, env: Environment): () => void {
  const undo: (() => void)[] = [];
  // The background.
  if (env.bg_mode === 2) {
    const sky = env.sky?.sky_material ?? null;
    if (sky !== null) {
      const box = new Mesh(new BoxGeometry(1, 1, 1), godot_sky_material_three(sky, env.bg_energy_multiplier));
      box.frustumCulled = false;
      box.renderOrder = -Number.MAX_SAFE_INTEGER;
      box.onBeforeRender = (_renderer, drawnScene, camera) => {
        box.position.setFromMatrixPosition(camera.matrixWorld);
        box.updateMatrixWorld();
        updateSkyLights(box.material as ThreeShaderMaterial, drawnScene);
      };
      godot_node_foreign(box);
      scene.add(box);
      undo.push(() => {
        scene.remove(box);
        box.geometry.dispose();
        (box.material as ThreeShaderMaterial).dispose();
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
  // The tone mapping, before the materials that run it compile.
  ShaderChunk.tonemapping_pars_fragment = TONEMAPPING_CHUNK.replace(CUSTOM_STUB, godot_environment_tonemapping_glsl(env));
  const previousMapping = gl.toneMapping;
  const previousExposure = gl.toneMappingExposure;
  gl.toneMapping = CustomToneMapping;
  gl.toneMappingExposure = env.tonemap_exposure;
  undo.push(() => {
    ShaderChunk.tonemapping_pars_fragment = TONEMAPPING_CHUNK;
    gl.toneMapping = previousMapping;
    gl.toneMappingExposure = previousExposure;
  });
  return () => {
    for (const step of undo.reverse()) step();
  };
}
