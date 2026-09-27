/**
 * The post-effects proof: the Compatibility renderer's post pass as `environment-post.ts`
 * transcribes it, evaluated in binary32 at sample texels against Godot's own shaders (the pinned
 * `drivers/gles3/shaders` files, vendored byte for byte in `vendor/gles3-shaders`, each checked
 * against its recorded digest), both run by the in-repo GLSL evaluator (`shader-evaluation.ts`):
 * - the buffer pass against `tonemap_inc.glsl`'s `linear_to_srgb` of the colour times the exposure,
 *   times the luminance multiplier (`scene.glsl:2794-2798`, `:3074`);
 * - each glow pass against `glow.glsl`'s fragment in that mode;
 * - the composite against `post.glsl`'s fragment for each combination of glow (with its luminance
 *   multiplier), the adjustments, and SSAO at each quality (`s4ao_micro_inc`, `s4ao_inc` low and
 *   medium, `s4ao_mega_inc` high and ultra), under the linear, Reinhard and filmic tone mappers.
 * Every buffer write is Godot's `GL_RGB10_A2` store, applied to the reference's output here and by
 * the transcription itself. The samplers are the same functions of the coordinate on both sides; the
 * depth samples are dyadic, so three's `1.0 - depth` (the `reverse-z-depth` deviation) is exact on
 * them and the comparison is of the arithmetic, bit for bit. The effect's final exact sRGB decode
 * (for the output encoding) is outside the comparison, identity on both.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as POST from '../../../capabilities/catalog/project-source/src/lib/godot-compat/environment-post';
import * as E from '../../../capabilities/catalog/project-source/src/lib/godot-compat/environment';
import { godot_environment_tonemapping_glsl } from '../../../capabilities/catalog/project-source/src/lib/godot-compat/world-environment';
import { monorepoImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { evaluateGlsl, type ShaderSampler, type ShaderValue } from '../shader-evaluation';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const VENDOR = path.join(PACKAGE_ROOT, 'vendor/gles3-shaders');
const f32 = Math.fround;

export const GODOT_POST_EFFECTS_IMPLEMENTATION_FILES = [
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/environment-post.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/world-environment.ts',
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat/environment.ts',
  'packages/gd-analyze/src/evidence/shader-evaluation.ts',
  'packages/gd-analyze/src/evidence/proofs/post-effects.ts',
] as const;

/** A vendored shader file, checked against the digest its lock records. */
function vendored(name: string): string {
  const lock = JSON.parse(readFileSync(path.join(VENDOR, 'UPSTREAM.lock.json'), 'utf8')) as { readonly files: Readonly<Record<string, { readonly sha256: string }>> };
  const bytes = readFileSync(path.join(VENDOR, name));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== lock.files[name]?.sha256) throw new Error(`vendor/gles3-shaders/${name} does not match its recorded digest`);
  return bytes.toString('utf8');
}

/** Godot's shader preprocessing, as far as these files use it: includes, object-like defines, conditionals. */
function preprocess(text: string, defines: ReadonlyMap<string, string>): string {
  const macros = new Map(defines);
  const out: string[] = [];
  const stack: { active: boolean; taken: boolean }[] = [];
  const active = () => stack.every((entry) => entry.active);
  const defined = (expression: string): boolean =>
    expression.split('||').some((part) => part.split('&&').every((term) => {
      const name = /defined\s*\(\s*(\w+)\s*\)/.exec(term)?.[1] ?? term.trim();
      return macros.has(name);
    }));
  for (const line of text.split('\n')) {
    const directive = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (line.startsWith('#[')) continue;
    if (directive === null) {
      if (active()) out.push([...macros].reduce((acc, [name, value]) => (value === '' ? acc : acc.replace(new RegExp(`\\b${name}\\b`, 'g'), value)), line));
      continue;
    }
    const [, word, rest] = directive as unknown as [string, string, string];
    if (word === 'ifdef' || word === 'ifndef') {
      const holds = macros.has(rest.trim()) === (word === 'ifdef');
      stack.push({ active: holds, taken: holds });
    } else if (word === 'if') {
      const holds = defined(rest);
      stack.push({ active: holds, taken: holds });
    } else if (word === 'elif') {
      const top = stack[stack.length - 1] as { active: boolean; taken: boolean };
      const holds = !top.taken && defined(rest);
      top.active = holds;
      top.taken ||= holds;
    } else if (word === 'else') {
      const top = stack[stack.length - 1] as { active: boolean; taken: boolean };
      top.active = !top.taken;
      top.taken = true;
    } else if (word === 'endif') {
      stack.pop();
    } else if (!active()) {
      continue;
    } else if (word === 'define') {
      const [name, ...value] = rest.trim().split(/\s+/);
      macros.set(name as string, value.join(' '));
    } else if (word === 'include') {
      const file = path.basename(/"(.*)"/.exec(rest)?.[1] ?? '');
      out.push(preprocess(vendored(file), macros));
    }
  }
  return out.join('\n');
}

/** The fragment stage of a `#[vertex]`/`#[fragment]` shader file. */
function fragmentOf(text: string): string {
  const at = text.indexOf('#[fragment]');
  return at < 0 ? text : text.slice(at + '#[fragment]'.length);
}

/** `GL_RGB10_A2`'s store in binary32, as the transcription's `godot_store_rgb10` computes it. */
function store(value: readonly number[]): number[] {
  return value.slice(0, 3).map((x) => f32(f32(Math.floor(f32(f32(Math.min(Math.max(x, 0), 1)) * 1023) + 0.5)) / 1023));
}

/** A deterministic texture: a smooth, varied value of the coordinate, scaled. */
function sampler(seed: number, scale: number): ShaderSampler {
  return ([u = 0, v = 0]) => [0, 1, 2, 3].map((c) => f32(scale * (0.5 + 0.5 * Math.sin(u * (12.9898 + seed + c) + v * (78.233 - seed * c)))));
}

/** A reverse-Z depth texture of dyadic values, so three's `1.0 - (1.0 - d)` is `d` exactly. */
function depth(seed: number): ShaderSampler {
  return ([u = 0, v = 0]) => {
    // A gently curved surface (the occlusion stays inside (0, 1)), in 1024 steps.
    const d = (Math.floor((0.6 + 0.1 * u - 0.05 * v + 0.04 * Math.sin(u * (6.1 + seed) + v * 4.3)) * 1024) + 1) / 1024;
    return [d, d, d, d];
  };
}

const UVS: readonly (readonly [number, number])[] = [
  [0.5, 0.5],
  [0.1, 0.9],
  [0.73, 0.21],
  [0.33, 0.66],
  [0.02, 0.98],
  [0.91, 0.47],
].map(([u, v]) => [f32(u as number), f32(v as number)] as const);

function run(text: string, variables: Map<string, ShaderValue | ShaderSampler>, read: string): ShaderValue {
  evaluateGlsl(`${text}\nmain();`, variables);
  return variables.get(read) as ShaderValue;
}

function bufferRows(): { readonly reference: unknown[]; readonly target: unknown[] } {
  const reference: unknown[] = [];
  const target: unknown[] = [];
  const tonemap = preprocess(vendored('tonemap_inc.glsl'), new Map());
  for (const [exposure, luminance] of [[1, 1], [f32(0.8), 0.25], [f32(1.7), 0.25]] as const) {
    for (const uv of UVS) {
      const color = sampler(3, 4);
      const base = (): Map<string, ShaderValue | ShaderSampler> =>
        new Map<string, ShaderValue | ShaderSampler>([['scene_color', color], ['exposure', exposure], ['luminance_multiplier', luminance], ['uv_interp', [...uv]], ['frag_color', [0, 0, 0, 0]]]);
      const ref = run(`${tonemap}\nvoid main() { vec3 color = texture(scene_color, uv_interp).rgb * exposure; frag_color = vec4(linear_to_srgb(color) * luminance_multiplier, 1.0); }`, base(), 'frag_color');
      reference.push(store(ref as number[]));
      target.push((run(POST.GODOT_BUFFER_FRAGMENT, base(), 'frag_color') as number[]).slice(0, 3));
    }
  }
  return { reference, target };
}

function glowRows(): { readonly reference: unknown[]; readonly target: unknown[] } {
  const reference: unknown[] = [];
  const target: unknown[] = [];
  const glow = fragmentOf(vendored('glow.glsl'));
  for (const mode of ['filter', 'downsample', 'upsample'] as const) {
    const godot = preprocess(glow, new Map([[`MODE_${mode.toUpperCase()}`, '']]));
    for (const [bloom, threshold, scale, cap, luminance] of [[0, 1, 2, 12, 0.25], [f32(0.3), f32(0.8), f32(1.5), 6, 0.25], [0, 1, 2, 12, 1]] as const) {
      for (const uv of UVS) {
        const base = (): Map<string, ShaderValue | ShaderSampler> =>
          new Map<string, ShaderValue | ShaderSampler>([
            ['source_color', sampler(7, 0.9)],
            ['pixel_size', [f32(1 / 480), f32(1 / 270)]],
            ['luminance_multiplier', luminance],
            ['glow_bloom', bloom],
            ['glow_hdr_threshold', threshold],
            ['glow_hdr_scale', scale],
            ['glow_luminance_cap', cap],
            ['view', 0],
            ['uv_interp', [...uv]],
            ['frag_color', [0, 0, 0, 0]],
          ]);
        reference.push(store(run(godot, base(), 'frag_color') as number[]));
        target.push((run(POST.godot_glow_fragment(mode), base(), 'frag_color') as number[]).slice(0, 3));
      }
    }
  }
  return { reference, target };
}

/** The composite's combinations: glow, adjustments and the SSAO quality (or none). */
const COMPOSITES: readonly { readonly glow: boolean; readonly bcs: boolean; readonly ssao: number | null }[] = [
  { glow: false, bcs: true, ssao: null },
  { glow: true, bcs: false, ssao: null },
  { glow: false, bcs: false, ssao: 0 },
  { glow: false, bcs: false, ssao: 1 },
  { glow: false, bcs: false, ssao: 2 },
  { glow: false, bcs: false, ssao: 3 },
  { glow: false, bcs: false, ssao: 4 },
  { glow: true, bcs: true, ssao: 2 },
];

function compositeRows(): { readonly reference: unknown[]; readonly target: unknown[] } {
  const reference: unknown[] = [];
  const target: unknown[] = [];
  const post = fragmentOf(vendored('post.glsl'));
  const qualities = ['USE_SSAO_ABYSS', 'USE_SSAO_LOW', 'USE_SSAO_MED', 'USE_SSAO_HIGH', 'USE_SSAO_MEGA'];
  for (const mapper of [0, 1, 2]) {
    for (const combination of COMPOSITES) {
      const env = E.construct();
      E.set_tonemapper(env, mapper);
      E.set_tonemap_white(env, 6);
      E.set_glow_enabled(env, combination.glow);
      E.set_glow_intensity(env, 0.8);
      E.set_adjustment_enabled(env, combination.bcs);
      E.set_adjustment_brightness(env, 1.2);
      E.set_adjustment_contrast(env, 1.3);
      E.set_adjustment_saturation(env, 0.7);
      E.set_ssao_enabled(env, combination.ssao !== null);
      E.set_ssao_intensity(env, 1.5);
      E.set_ssao_radius(env, 0.6);
      const params = E.godot_environment_tonemap_parameters(env);
      const defines = new Map<string, string>([['APPLY_TONEMAPPING', '']]);
      if (combination.glow) {
        defines.set('USE_GLOW', '');
        defines.set('USE_LUMINANCE_MULTIPLIER', '');
      }
      if (combination.bcs) defines.set('USE_BCS', '');
      if (combination.ssao !== null) defines.set(qualities[combination.ssao] as string, '');
      const godot = preprocess(post, defines);
      const ours = preprocess(
        POST.godot_post_fragment(godot_environment_tonemapping_glsl(env, true), combination.ssao === null ? '' : POST.godot_s4ao_glsl(combination.ssao))
          // The exact decode for the output encoding is outside the comparison: identity here.
          .replace(/vec3 godot_srgb_decode\(vec3 color\) \{[\s\S]*?\n\}\n/, '')
          .replace('void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {', 'void main() {'),
        new Map([...defines].filter(([name]) => name !== 'APPLY_TONEMAPPING').concat(combination.ssao === null ? [] : [['USE_SOME_SSAO', '']])),
      );
      const luminance = combination.glow ? 0.25 : 1;
      const width = 480;
      const height = 270;
      for (const uv of UVS) {
        const d = depth(combination.ssao ?? 0);
        const shared = (): Map<string, ShaderValue | ShaderSampler> =>
          new Map<string, ShaderValue | ShaderSampler>([
            ['source_color', sampler(11, 1)],
            ['glow_color', sampler(13, 0.25)],
            ['pixel_size', [f32(1 / width), f32(1 / height)]],
            ['glow_intensity', f32(0.8)],
            ['srgb_white', POST.godot_environment_srgb_white(params.white)],
            ['luminance_multiplier', luminance],
            ['brightness', f32(1.2)],
            ['contrast', f32(1.3)],
            ['saturation', f32(0.7)],
            ['ssao_intensity', f32(f32(1.5) * 2)],
            ['ssao_radius_frac', f32(f32(0.6) * 0.5)],
            ['ssao_prn_UV', [f32(f32(width * f32(1.087)) * f32(f32(1 + f32(Math.sqrt(5))) / 2)), f32(f32(height * f32(1.087)) * f32(f32(9 + f32(Math.sqrt(221))) / 10))]],
            ['view', 0],
          ]);
        const godotVars = shared();
        godotVars.set('depth_buffer', d);
        godotVars.set('uv_interp', [...uv]);
        godotVars.set('frag_color', [0, 0, 0, 0]);
        godotVars.set('tonemapper', mapper);
        godotVars.set('tonemapper_params', [...params.params]);
        godotVars.set('exposure', 1);
        reference.push((run(godot, godotVars, 'frag_color') as number[]).slice(0, 3));
        const ourVars = shared();
        ourVars.set('uv', [...uv]);
        ourVars.set('outputColor', [0, 0, 0, 0]);
        ourVars.set('godot_srgb_decode', ((value: ShaderValue) => value) as unknown as ShaderValue);
        ourVars.set('readDepth', ((coordinate: ShaderValue) => f32(1 - ((d(coordinate as number[]) as number[])[0] as number))) as unknown as ShaderValue);
        target.push((run(ours, ourVars, 'outputColor') as number[]).slice(0, 3));
      }
    }
  }
  return { reference, target };
}

function inputDigest(): string {
  return sha256(
    ['post.glsl', 'glow.glsl', 's4ao_inc.glsl', 's4ao_micro_inc.glsl', 's4ao_mega_inc.glsl', 'tonemap_inc.glsl'].map((name) => `${name}\0${sha256(vendored(name))}`).join('\n'),
  );
}

export function measurePostEffectsProof(_tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const buffer = bufferRows();
  const glow = glowRows();
  const composite = compositeRows();
  const nativeJson = JSON.stringify(canonical({ buffer: buffer.reference, glow: glow.reference, composite: composite.reference }));
  const targetJson = JSON.stringify(canonical({ buffer: buffer.target, glow: glow.target, composite: composite.target }));
  const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
  return [
    {
      name: 'post-effects',
      identities: {
        input: inputDigest(),
        implementation: monorepoImplementationDigest(GODOT_POST_EFFECTS_IMPLEMENTATION_FILES),
        observed: sha256(nativeJson),
        comparison: sha256(comparison),
      },
      agree: nativeJson === targetJson,
      detail: `native ${nativeJson}\ntarget ${targetJson}`,
    },
  ];
}
