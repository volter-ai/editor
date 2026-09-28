/**
 * @godot-class Environment
 * @role PROTOCOL
 *
 * The Compatibility renderer's post pass (`drivers/gles3/effects/post_effects.cpp`,
 * `drivers/gles3/effects/glow.cpp`, `drivers/gles3/rasterizer_scene_gles3.cpp:2411-2420`,
 * `:2963-3043`) for an Environment that enables glow, SSAO or the adjustments, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`, as one `postprocessing` `Effect`:
 * - the scene draws untonemapped into an internal buffer: each fragment `linear_to_srgb(color *
 *   exposure) * luminance_multiplier` (`scene.glsl:2794-2798`, `:3074`), stored in the render
 *   target's `GL_RGB10_A2` (`texture_storage.cpp:2567`; the web's root viewport is neither HDR nor
 *   transparent), `luminance_multiplier` 0.25 when glow is on (`rasterizer_scene_gles3.cpp:2467`).
 *   Three draws the scene into `postprocessing`'s linear buffer; this effect's `update` makes
 *   Godot's buffer of it (the buffer pass);
 * - glow: the filter pass into level 0, three downsamples and three upsamples over four levels
 *   each half the size of the one before, at least 4 texels (`render_scene_buffers_gles3.cpp`
 *   `check_glow_buffers`), each stored in `GL_RGB10_A2` (`glow.glsl`);
 * - the composite, `post.glsl`'s fragment: glow blended (screen, in the buffer's sRGB encoding),
 *   `srgb_to_linear`, S4AO (the variant the project's `rendering/environment/ssao/quality` selects,
 *   `post_effects.cpp:post_copy`) on the depth buffer, the tone mapper, then brightness, contrast and
 *   saturation (`USE_BCS`), then `linear_to_srgb`.
 *
 * The GLSL is Godot's own (`drivers/gles3/shaders/effects/post.glsl`, `glow.glsl`,
 * `s4ao_inc.glsl`, `s4ao_micro_inc.glsl`, `s4ao_mega_inc.glsl`, `tonemap_inc.glsl`), with the
 * names this effect gives its textures: Copyright (c) 2014-present Godot Engine contributors (see
 * AUTHORS.md); Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur; MIT License. S4AO (Stupid
 * Simple Screen Space Ambient Occlusion) by Jonathan Dummer (O1S).
 *
 * Named deviations: `post-buffer-precision` (the internal and glow buffers are half-float targets
 * holding the 10-bit values Godot's `GL_RGB10_A2` stores, each quantized as Godot's store rounds
 * it, then held to half-float precision); `reverse-z-depth` (Godot's depth buffer is reverse-Z,
 * three's is not: S4AO reads `1.0 - depth` of three's 24-bit depth, which rounds differently from
 * the reverse-Z value Godot stores). The effect writes its colour linear, decoded exactly from the
 * sRGB Godot writes, for `postprocessing`'s output encoding to write it again (`srgb-output`).
 */

import { Effect, EffectAttribute } from 'postprocessing';
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RawShaderMaterial,
  Scene,
  Sphere,
  type Texture,
  Uniform,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { Environment } from './environment';
import { get_setting } from './project-settings';

const f32 = Math.fround;

/** `linear_to_srgb` and `srgb_to_linear` (`tonemap_inc.glsl:12-24`). */
export const GODOT_SRGB_GLSL = `vec3 linear_to_srgb(vec3 color) {
	return max(vec3(1.055) * pow(color, vec3(0.416666667)) - vec3(0.055), vec3(0.0));
}
vec3 srgb_to_linear(vec3 color) {
	return color * (color * (color * 0.305306011 + 0.682171111) + 0.012522878);
}
`;

/** A value as `GL_RGB10_A2` stores it: clamped to [0, 1], rounded to the nearest of 1023 steps. */
export const GODOT_RGB10_STORE_GLSL = `vec3 godot_store_rgb10(vec3 value) {
	return floor(clamp(value, 0.0, 1.0) * 1023.0 + 0.5) / 1023.0;
}
`;

/**
 * The buffer pass: the scene's untonemapped colour as Godot's scene shader writes its internal
 * buffer (`scene.glsl:2794-2798`: `color *= exposure; color = linear_to_srgb(color)`; `:3074`:
 * `* luminance_multiplier`), stored in `GL_RGB10_A2`. A lit fragment reached by a light that casts
 * shadows wrote the colour this encodes to its base pass plus that light's additive pass
 * (`scene.glsl:3072`, `godot_environment_light_passes_chunks` in `world-environment.ts`).
 */
export const GODOT_BUFFER_FRAGMENT = `precision highp float;
uniform sampler2D scene_color;
uniform float exposure;
uniform float luminance_multiplier;
in vec2 uv_interp;
layout(location = 0) out vec4 frag_color;
${GODOT_SRGB_GLSL}${GODOT_RGB10_STORE_GLSL}
void main() {
	vec3 color = texture(scene_color, uv_interp).rgb * exposure;
	color = linear_to_srgb(color);
	color *= luminance_multiplier;
	frag_color = vec4(godot_store_rgb10(color), 1.0);
}
`;

/**
 * `glow.glsl`'s fragment for one mode, its output stored in `GL_RGB10_A2`.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/shaders/effects/glow.glsl:59
 */
export function godot_glow_fragment(mode: 'filter' | 'downsample' | 'upsample'): string {
  const filter = `	vec2 half_pixel = pixel_size * 0.5;
	vec2 uv = uv_interp;
	vec3 color = textureLod(source_color, uv, 0.0).rgb * 4.0;
	color += textureLod(source_color, uv - half_pixel, 0.0).rgb;
	color += textureLod(source_color, uv + half_pixel, 0.0).rgb;
	color += textureLod(source_color, uv - vec2(half_pixel.x, -half_pixel.y), 0.0).rgb;
	color += textureLod(source_color, uv + vec2(half_pixel.x, -half_pixel.y), 0.0).rgb;
	color /= luminance_multiplier * 8.0;

	float feedback_factor = max(color.r, max(color.g, color.b));
	float feedback = max(smoothstep(glow_hdr_threshold, glow_hdr_threshold + glow_hdr_scale, feedback_factor), glow_bloom);

	color = min(color * feedback, vec3(glow_luminance_cap));

	frag_color = vec4(luminance_multiplier * color, 1.0);`;
  const downsample = `	vec2 half_pixel = pixel_size * 0.5;
	vec4 color = textureLod(source_color, uv_interp, 0.0) * 4.0;
	color += textureLod(source_color, uv_interp - half_pixel, 0.0);
	color += textureLod(source_color, uv_interp + half_pixel, 0.0);
	color += textureLod(source_color, uv_interp - vec2(half_pixel.x, -half_pixel.y), 0.0);
	color += textureLod(source_color, uv_interp + vec2(half_pixel.x, -half_pixel.y), 0.0);
	frag_color = color / 8.0;`;
  const upsample = `	vec2 half_pixel = pixel_size * 0.5;

	vec4 color = textureLod(source_color, uv_interp + vec2(-half_pixel.x * 2.0, 0.0), 0.0);
	color += textureLod(source_color, uv_interp + vec2(-half_pixel.x, half_pixel.y), 0.0) * 2.0;
	color += textureLod(source_color, uv_interp + vec2(0.0, half_pixel.y * 2.0), 0.0);
	color += textureLod(source_color, uv_interp + vec2(half_pixel.x, half_pixel.y), 0.0) * 2.0;
	color += textureLod(source_color, uv_interp + vec2(half_pixel.x * 2.0, 0.0), 0.0);
	color += textureLod(source_color, uv_interp + vec2(half_pixel.x, -half_pixel.y), 0.0) * 2.0;
	color += textureLod(source_color, uv_interp + vec2(0.0, -half_pixel.y * 2.0), 0.0);
	color += textureLod(source_color, uv_interp + vec2(-half_pixel.x, -half_pixel.y), 0.0) * 2.0;

	frag_color = color / 12.0;`;
  const body = mode === 'filter' ? filter : mode === 'downsample' ? downsample : upsample;
  return `precision highp float;
uniform sampler2D source_color;
uniform vec2 pixel_size;
uniform float luminance_multiplier;
uniform float glow_bloom;
uniform float glow_hdr_threshold;
uniform float glow_hdr_scale;
uniform float glow_luminance_cap;
in vec2 uv_interp;
layout(location = 0) out vec4 frag_color;
${GODOT_RGB10_STORE_GLSL}
void main() {
${body}
	frag_color = vec4(godot_store_rgb10(frag_color.rgb), 1.0);
}
`;
}

/** The screen triangle every pass draws (`glow.cpp`: `-1,-1`, `3,-1`, `-1,3`), its `uv_interp`. */
const PASS_VERTEX = `precision highp float;
in vec2 position;
out vec2 uv_interp;
void main() {
	uv_interp = position * 0.5 + 0.5;
	gl_Position = vec4(position, 1.0, 1.0);
}
`;

/** `ENV_SSAO_QUALITY_*` (`rendering_server_enums.h`) as the post shader's S4AO define. */
const SSAO_DEFINES = ['USE_SSAO_ABYSS', 'USE_SSAO_LOW', 'USE_SSAO_MED', 'USE_SSAO_HIGH', 'USE_SSAO_MEGA'] as const;

/**
 * `s4ao_inc.glsl` / `s4ao_micro_inc.glsl` / `s4ao_mega_inc.glsl`, depth read by `godot_depth`.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/shaders/s4ao_inc.glsl:22
 */
export function godot_s4ao_glsl(quality: number): string {
  if (quality === 0) {
    return `const mediump float ssao_falloff_frac = 0.25;
float s4ao(vec2 UV) {
	mediump float depth = godot_depth(UV);
	mediump float inv_falloff = 1.0f / max(1e-4f, depth * ssao_falloff_frac);
	mediump float r01 = fract(dot(UV, ssao_prn_UV));
	mediump vec2 duv = vec2(r01 - 0.5f, 2.0f * (r01 - r01 * r01)) * (2.0f * depth * ssao_radius_frac);
	mediump float occlusion = 0.0f;
	for (int s = 0; s < 2; ++s) {
		mediump float dz = godot_depth(UV + duv) - depth;
		occlusion += normalize(vec3(duv, dz)).z * mix(1.0f, 0.0f, dz * inv_falloff);
		duv = -duv;
	}
	occlusion = 1.0f - clamp(occlusion * 0.5f * ssao_intensity, 0.0f, 1.0f);
	return occlusion * occlusion;
}
`;
  }
  if (quality >= 3) {
    const mega = quality === 4;
    return `const int rings = ${mega ? 4 : 3};
const int samps[] = int[](${mega ? '24, 18, 12, 6' : '15, 10, 5, 1'});
const float average_samples = 1.0 / float(samps[0] + samps[1] * int(rings > 1) + samps[2] * int(rings > 2) + samps[3] * int(rings > 3));
const float ssao_falloff_frac = 0.25;
float s4ao(vec2 UV) {
	float depth = godot_depth(UV);
	float inv_falloff = 1.0f / max(1e-4f, depth * ssao_falloff_frac);
	float r01 = fract(dot(UV, ssao_prn_UV));
	vec2 rcos = vec2(r01 - 0.5f, 2.0f * (r01 - r01 * r01)) * (2.0f * depth * ssao_radius_frac);
	vec2 rsin = rcos.yx * vec2(-1, 1);
	float occlusion = 0.0f;
	float ring_shrink = 0.75f;
	for (int r = 0; r < rings; ++r) {
		float dt = (6.283185307f) / float(samps[r]);
		float t = float(r & 1) * 0.5f * dt;
		for (int s = 0; s < samps[r]; ++s) {
			vec2 duv = cos(t) * rcos + sin(t) * rsin;
			float dz = godot_depth(UV + duv) - depth;
			occlusion += normalize(vec3(duv, dz)).z * smoothstep(1.0f, 0.0f, dz * inv_falloff);
			t += dt;
		}
		rcos *= ring_shrink;
		rsin *= ring_shrink;
	}
	occlusion *= ssao_intensity * average_samples;
	occlusion = 1.0f - clamp(occlusion, 0.0f, 1.0f);
	return occlusion * occlusion;
}
`;
  }
  const width = quality === 1 ? 2 : 4;
  return `const int sample_width = ${width};
const int notch_01 = int(sample_width > 3);
const float sample_mid = (float(sample_width) - 1.0) * 0.50001;
const float inv_half_width = ${quality === 1 ? '1.0' : '1.7'} / sample_mid;
const float average_samples = 1.0 / float(sample_width * sample_width - 4 * notch_01);
const float ssao_falloff_frac = 0.25;
float s4ao(vec2 UV) {
	float depth = godot_depth(UV);
	float radius = max(1e-4f, depth * ssao_radius_frac);
	float inv_falloff = 1.0f / max(1e-4f, depth * ssao_falloff_frac);
	vec2 rcos = (inv_half_width * radius) * vec2(0.5f, fract(dot(UV, ssao_prn_UV)) - 0.5f);
	vec2 rsin = rcos.yx * vec2(-1, 1);
	float occlusion = 0.0f;
	vec2 base_duv = -sample_mid * rsin;
	for (int j = sample_width; --j >= 0;) {
${
  quality === 1
    ? `		vec2 duv = -sample_mid * rcos + base_duv;
		for (int i = sample_width; --i >= 0;) {`
    : `		int o = int((j <= 0) || (j >= (sample_width - 1)));
		vec2 duv = (float(o) - sample_mid) * rcos + base_duv;
		for (int i = sample_width - o - o; --i >= 0;) {`
}
			float dz = godot_depth(UV + duv) - depth;
			float validity = smoothstep(1.0f, 0.0f, dz * inv_falloff);
			occlusion += normalize(vec3(duv, dz)).z * validity;
			duv += rcos;
		}
		base_duv += rsin;
	}
	occlusion *= ssao_intensity * average_samples;
	occlusion = clamp(1.0f - occlusion, 0.0f, 1.0f);
	return occlusion * occlusion;
}
`;
}

/**
 * `post.glsl`'s fragment as the effect's `mainImage`: the colour Godot's post pass writes (sRGB,
 * `linear_to_srgb`), decoded exactly to linear for the output encoding that follows.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/shaders/effects/post.glsl:121
 */
export function godot_post_fragment(tonemapping: string, ssao: string): string {
  return `uniform sampler2D source_color;
uniform float luminance_multiplier;
#ifdef USE_GLOW
uniform sampler2D glow_color;
uniform vec2 pixel_size;
uniform float glow_intensity;
uniform float srgb_white;

vec4 get_glow_color(vec2 uv) {
	vec2 half_pixel = pixel_size * 0.5;

	vec4 color = textureLod(glow_color, uv + vec2(-half_pixel.x * 2.0, 0.0), 0.0);
	color += textureLod(glow_color, uv + vec2(-half_pixel.x, half_pixel.y), 0.0) * 2.0;
	color += textureLod(glow_color, uv + vec2(0.0, half_pixel.y * 2.0), 0.0);
	color += textureLod(glow_color, uv + vec2(half_pixel.x, half_pixel.y), 0.0) * 2.0;
	color += textureLod(glow_color, uv + vec2(half_pixel.x * 2.0, 0.0), 0.0);
	color += textureLod(glow_color, uv + vec2(half_pixel.x, -half_pixel.y), 0.0) * 2.0;
	color += textureLod(glow_color, uv + vec2(0.0, -half_pixel.y * 2.0), 0.0);
	color += textureLod(glow_color, uv + vec2(-half_pixel.x, -half_pixel.y), 0.0) * 2.0;

#ifdef USE_LUMINANCE_MULTIPLIER
	color = color / luminance_multiplier;
#endif

	return color / 12.0;
}
#endif
#ifdef USE_BCS
uniform float brightness;
uniform float contrast;
uniform float saturation;
#endif
#ifdef USE_SOME_SSAO
uniform float ssao_intensity;
uniform float ssao_radius_frac;
uniform vec2 ssao_prn_UV;
float godot_depth(vec2 uv) {
	return 1.0 - readDepth(uv);
}
${ssao}
#endif
${GODOT_SRGB_GLSL}
${tonemapping}
vec3 godot_srgb_decode(vec3 color) {
	return mix(pow(color * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), color * 0.0773993808, vec3(lessThanEqual(color, vec3(0.04045))));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
	vec2 uv_interp = uv;
	vec4 color = texture(source_color, uv_interp);

#ifdef USE_LUMINANCE_MULTIPLIER
	color = color / luminance_multiplier;
#endif

#ifdef USE_GLOW
	vec4 glow = get_glow_color(uv_interp) * glow_intensity;
	glow.rgb = clamp(glow.rgb, 0.0, srgb_white);
	color.rgb = color.rgb + glow.rgb - (color.rgb * glow.rgb / srgb_white);
#endif

	color.rgb = srgb_to_linear(color.rgb);

#ifdef USE_SOME_SSAO
	color.rgb *= s4ao(uv_interp);
#endif

	color.rgb = apply_tonemapping(color.rgb);

#ifdef USE_BCS
	color.rgb = color.rgb * brightness;
	color.rgb = linear_to_srgb(color.rgb);
	color.rgb = mix(vec3(0.5), color.rgb, contrast);
	color.rgb = mix(vec3(dot(vec3(1.0), color.rgb) * (1.0 / 3.0)), color.rgb, saturation);
#else
	color.rgb = linear_to_srgb(color.rgb);
#endif

	outputColor = vec4(godot_srgb_decode(color.rgb), 1.0);
}
`;
}

/**
 * Whether an environment has the renderer draw its post pass for glow, SSAO or the adjustments.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:2420
 */
export function godot_environment_post_enabled(env: Environment): boolean {
  return env.glow_enabled || env.ssao_enabled || env.adjustment_enabled;
}

/**
 * The tone mapper's white as the post pass's `srgb_white`.
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:2983
 */
export function godot_environment_srgb_white(white: number): number {
  return f32(1.055 * f32(Math.pow(white, f32(1 / 2.4))) - 0.055);
}

function passMaterial(fragment: string, uniforms: Record<string, Uniform>): RawShaderMaterial {
  return new RawShaderMaterial({ glslVersion: GLSL3, vertexShader: PASS_VERTEX, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false });
}

function target(width: number, height: number): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
}

/**
 * The post pass of one environment, as a `postprocessing` effect (`<EffectComposer>` renders it,
 * `world-environment.ts`).
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/effects/post_effects.cpp:92
 */
export class GodotPostEffect extends Effect {
  readonly #env: Environment;
  readonly #glow: boolean;
  readonly #scene = new Scene();
  readonly #camera = new Camera();
  readonly #quad: Mesh;
  readonly #buffer = target(1, 1);
  readonly #levels = [target(1, 1), target(1, 1), target(1, 1), target(1, 1)];
  readonly #bufferPass: RawShaderMaterial;
  readonly #filter: RawShaderMaterial;
  readonly #downsample: RawShaderMaterial;
  readonly #upsample: RawShaderMaterial;
  #size = new Vector2(1, 1);

  constructor(env: Environment, tonemapping: string, whiteForGlow: number) {
    const quality = Math.trunc(Number(get_setting('rendering/environment/ssao/quality', 2)));
    const defines = new Map<string, string>();
    if (env.glow_enabled) {
      defines.set('USE_GLOW', '1');
      defines.set('USE_LUMINANCE_MULTIPLIER', '1');
    }
    if (env.adjustment_enabled) defines.set('USE_BCS', '1');
    if (env.ssao_enabled) {
      defines.set('USE_SOME_SSAO', '1');
      defines.set(SSAO_DEFINES[Math.min(Math.max(quality, 0), 4)] as string, '1');
    }
    const luminance = env.glow_enabled ? 0.25 : 1;
    super('GodotPostEffect', godot_post_fragment(tonemapping, env.ssao_enabled ? godot_s4ao_glsl(quality) : ''), {
      attributes: env.ssao_enabled ? EffectAttribute.DEPTH : EffectAttribute.NONE,
      defines,
      uniforms: new Map<string, Uniform>([
        ['source_color', new Uniform(null)],
        ['luminance_multiplier', new Uniform(luminance)],
        ['glow_color', new Uniform(null)],
        ['pixel_size', new Uniform(new Vector2())],
        ['glow_intensity', new Uniform(env.glow_intensity)],
        ['srgb_white', new Uniform(godot_environment_srgb_white(whiteForGlow))],
        ['brightness', new Uniform(env.adjustment_brightness)],
        ['contrast', new Uniform(env.adjustment_contrast)],
        ['saturation', new Uniform(env.adjustment_saturation)],
        // `post_copy`'s SSAO uniforms (`post_effects.cpp:136-141`), from the environment
        // (`rasterizer_scene_gles3.cpp:2996`: intensity * 2, radius * 0.5).
        ['ssao_intensity', new Uniform(f32(env.ssao_intensity * 2))],
        ['ssao_radius_frac', new Uniform(f32(env.ssao_radius * 0.5))],
        ['ssao_prn_UV', new Uniform(new Vector2())],
      ]),
    });
    this.#env = env;
    this.#glow = env.glow_enabled;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
    // A full-screen triangle in clip space, never culled: its 2D positions bound no sphere, so it
    // states an unbounded one.
    geometry.boundingSphere = new Sphere(new Vector3(), Infinity);
    this.#bufferPass = passMaterial(GODOT_BUFFER_FRAGMENT, {
      scene_color: new Uniform(null),
      exposure: new Uniform(env.tonemap_exposure),
      luminance_multiplier: new Uniform(luminance),
    });
    const glowUniforms = () => ({
      source_color: new Uniform(null),
      pixel_size: new Uniform(new Vector2()),
      luminance_multiplier: new Uniform(luminance),
      glow_bloom: new Uniform(env.glow_bloom),
      glow_hdr_threshold: new Uniform(env.glow_hdr_bleed_threshold),
      glow_hdr_scale: new Uniform(env.glow_hdr_bleed_scale),
      glow_luminance_cap: new Uniform(env.glow_hdr_luminance_cap),
    });
    this.#filter = passMaterial(godot_glow_fragment('filter'), glowUniforms());
    this.#downsample = passMaterial(godot_glow_fragment('downsample'), glowUniforms());
    this.#upsample = passMaterial(godot_glow_fragment('upsample'), glowUniforms());
    this.#quad = new Mesh(geometry, this.#bufferPass);
    this.#quad.frustumCulled = false;
    this.#quad.frustumCulled = false;
    this.#scene.add(this.#quad);
    (this.uniforms.get('source_color') as Uniform).value = this.#buffer.texture;
    (this.uniforms.get('glow_color') as Uniform).value = (this.#levels[0] as WebGLRenderTarget).texture;
  }

  #draw(renderer: WebGLRenderer, material: RawShaderMaterial, source: Texture, into: WebGLRenderTarget): void {
    this.#quad.material = material;
    const uniforms = material.uniforms as Record<string, Uniform>;
    if (uniforms['scene_color'] !== undefined) (uniforms['scene_color'] as Uniform).value = source;
    if (uniforms['source_color'] !== undefined) (uniforms['source_color'] as Uniform).value = source;
    if (uniforms['pixel_size'] !== undefined) (uniforms['pixel_size'] as Uniform<Vector2>).value.set(1 / into.width, 1 / into.height);
    renderer.setRenderTarget(into);
    renderer.render(this.#scene, this.#camera);
  }

  /** The buffer pass, then the glow passes (`Glow::process_glow`, glow.cpp:96), each frame. */
  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    const previous = renderer.getRenderTarget();
    this.#draw(renderer, this.#bufferPass, inputBuffer.texture, this.#buffer);
    if (this.#glow) {
      const levels = this.#levels as [WebGLRenderTarget, WebGLRenderTarget, WebGLRenderTarget, WebGLRenderTarget];
      this.#draw(renderer, this.#filter, this.#buffer.texture, levels[0]);
      for (let i = 1; i < 4; i += 1) this.#draw(renderer, this.#downsample, (levels[i - 1] as WebGLRenderTarget).texture, levels[i] as WebGLRenderTarget);
      for (let i = 2; i >= 0; i -= 1) this.#draw(renderer, this.#upsample, (levels[i + 1] as WebGLRenderTarget).texture, levels[i] as WebGLRenderTarget);
    }
    renderer.setRenderTarget(previous);
  }

  /** The internal buffer at the drawing size, the glow levels each half the one before, at least 4. */
  override setSize(width: number, height: number): void {
    this.#size.set(width, height);
    this.#buffer.setSize(width, height);
    let level: readonly [number, number] = [width, height];
    for (const glow of this.#levels) {
      level = godot_glow_level_size(level);
      glow.setSize(level[0], level[1]);
    }
    (this.uniforms.get('pixel_size') as Uniform<Vector2>).value.set(1 / width, 1 / height);
    // `post_copy`'s pseudo-random UV scale (`post_effects.cpp:138`), in binary32.
    (this.uniforms.get('ssao_prn_UV') as Uniform<Vector2>).value.set(
      f32(f32(width * f32(1.087)) * f32(f32(1 + f32(Math.sqrt(5))) / 2)),
      f32(f32(height * f32(1.087)) * f32(f32(9 + f32(Math.sqrt(221))) / 10)),
    );
  }

  /** The environment this effect draws. */
  get environment(): Environment {
    return this.#env;
  }

  override dispose(): void {
    super.dispose();
    this.#buffer.dispose();
    for (const glow of this.#levels) glow.dispose();
    for (const material of [this.#bufferPass, this.#filter, this.#downsample, this.#upsample]) material.dispose();
    this.#quad.geometry.dispose();
  }
}

/**
 * A glow level's size from the one before (`check_glow_buffers`: `>> 1`, at least 4).
 *
 * @godot Environment (protocol)
 * @source drivers/gles3/storage/render_scene_buffers_gles3.cpp:579
 */
export function godot_glow_level_size(previous: readonly [number, number]): readonly [number, number] {
  return [Math.max(previous[0] >> 1, 4), Math.max(previous[1] >> 1, 4)];
}
