/**
 * The shader-lowering proof: sky shaders read by the pinned Godot's own shader frontend (the bound
 * exporter's `export_shader`: `ShaderPreprocessor`, then `ShaderLanguage::compile` over the sky
 * mode's `ShaderTypes`) — the platformer's panorama sky, and shaders that use the rest of what the
 * lowering carries (local variables and user functions, `if`/`else` and `return`, swizzle writes,
 * the common built-in functions, `SKY_COORDS`, `TIME`, `PI`, `ALPHA`) — each run at sample view
 * directions twice in binary32: by walking Godot's tree (the reference), and by running the GLSL
 * text the production lowering prints (`shader-glsl.ts`), the built-ins named as Godot's
 * Compatibility sky shader names them (`drivers/gles3/storage/material_storage.cpp:1522`). The
 * headless binary renders nothing, so the frontend's tree stands for Godot; the comparison is of
 * every output (`COLOR`, `ALPHA`) bit for bit. The engine sky materials' own shaders (the text
 * `sky_material.cpp` generates, captured by the exporter from the server) are run the same way, keyed
 * by their text's digest; one the lowering refuses is named in the detail and not compared.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { GodotBoundShader } from '../../godot-frontend/bound-shader';
import { monorepoImplementationDigest } from '../../godot-frontend/implementation-liveness';
import { captureGodotBoundProgram } from '../../godot-frontend/run-bound-program';
import { GODOT_SHADER_LOWERING_IMPLEMENTATION_FILES } from '../../translate/data/scene-node-authority-data';
import { GODOT_SKY_SHADER_BUILTINS } from '../../translate/emit/sky-shader';
import { lowerGodotShader } from '../../translate/emit/shader-glsl';
import { evaluateGlsl, evaluateGodotShaderTree, type ShaderSampler, type ShaderValue } from '../shader-evaluation';
import { canonical, type GodotProofMeasurement, type GodotProofTools, sha256 } from './proof';

const f32 = Math.fround;

const SHADERS: Readonly<Record<string, string>> = {
  // The platformer's stage sky (stage/skybox.gdshader), verbatim.
  'skybox.gdshader': `shader_type sky;

uniform samplerCube source_panorama : filter_linear, source_color, hint_default_black;
uniform float exposure : hint_range(0, 128) = 1.0;

void sky() {
    // If importing a cubemap from another engine, you may need to flip one of the \`EYEDIR\` components below
    // by replacing it with \`-EYEDIR\`.
    vec3 eyedir = vec3(EYEDIR.x, EYEDIR.y, EYEDIR.z);
    COLOR = texture(source_panorama, eyedir).rgb * exposure;
}
`,
  'gradient.gdshader': `shader_type sky;

uniform vec3 top_color : source_color = vec3(0.2, 0.4, 0.9);
uniform vec3 horizon_color = vec3(0.8, 0.85, 0.9);
uniform float curve = 0.35;

float band(float v, float k) {
\tif (v < 0.0) {
\t\treturn 0.0;
\t} else {
\t\treturn pow(clamp(v, 0.0, 1.0), k);
\t}
}

void sky() {
\tfloat t = band(EYEDIR.y, curve);
\tvec3 c = mix(horizon_color, top_color, t);
\tc.g += 0.25 * SKY_COORDS.x;
\tc.rb = c.br * vec2(0.5, 1.5) - vec2(SKY_COORDS.y * 0.1);
\tfloat s = dot(normalize(EYEDIR + vec3(0.0, 1.0, 0.0)), vec3(0.577, 0.577, 0.577));
\tCOLOR = c * max(s, 0.1) + vec3(sin(TIME * PI) * 0.05);
\tALPHA = 1.0 - step(0.9, abs(EYEDIR.x));
}
`,
};

/** The sample view directions: a spiral over the sphere, normalized in binary32. */
function directions(count: number): readonly (readonly number[])[] {
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const phi = i * 2.399963229728653;
    const v = [Math.cos(phi) * r, y, Math.sin(phi) * r].map(f32);
    const length = f32(Math.sqrt(f32(f32(f32((v[0] as number) * (v[0] as number)) + f32((v[1] as number) * (v[1] as number))) + f32((v[2] as number) * (v[2] as number)))));
    return v.map((c) => f32(c / length));
  });
}

/** A cubemap stand-in: a smooth colour of the direction. */
const cube: ShaderSampler = (d) => [f32(0.5 + 0.5 * (d[0] as number)), f32(0.5 + 0.25 * (d[1] as number)), f32(0.75 - 0.25 * (d[2] as number)), 1];

/**
 * The sky pass's directional lights at sample values (`_setup_sky` fills at most four): two the
 * sky sees, the rest disabled with zeroed data, as the renderer leaves them.
 */
const SKY_LIGHTS: readonly { readonly enabled: boolean; readonly direction: readonly number[]; readonly energy: number; readonly color: readonly number[]; readonly size: number }[] = [
  { enabled: true, direction: [f32(0.36), f32(0.48), f32(-0.8)], energy: f32(1.5), color: [f32(1), f32(0.9), f32(0.75)], size: f32(0.05) },
  { enabled: true, direction: [f32(-0.6), f32(0.8), f32(0)], energy: f32(0.7), color: [f32(0.5), f32(0.6), f32(1)], size: f32(0.2) },
  { enabled: false, direction: [0, 0, 0], energy: 0, color: [0, 0, 0], size: 0 },
  { enabled: false, direction: [0, 0, 0], energy: 0, color: [0, 0, 0], size: 0 },
];

/** A 2D panorama stand-in: a smooth colour of the coordinates. */
const flat: ShaderSampler = (uv) => [f32(0.25 + 0.5 * (uv[0] as number)), f32(0.75 - 0.5 * (uv[1] as number)), f32(0.5), 1];

/** Godot's sky pass's panorama coordinates for a direction, as its uniform inputs (`sky.glsl:205`). */
function panorama(d: readonly number[]): readonly number[] {
  return [f32(((Math.atan2(d[0] as number, -(d[2] as number)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)), f32(Math.acos(d[1] as number) / Math.PI)];
}

function inputDigest(): string {
  return sha256(
    Object.entries(SHADERS)
      .map(([name, source]) => `${name}\0${sha256(source)}`)
      .join('\n'),
  );
}

export function measureShaderLoweringProof(tools: GodotProofTools): readonly GodotProofMeasurement[] {
  const temp = mkdtempSync(path.join(tmpdir(), 'vgai-godot-shader-lowering-'));
  try {
    const project = path.join(temp, 'project');
    mkdirSync(project);
    writeFileSync(path.join(project, 'project.godot'), 'config_version=5\n\n[application]\nconfig/features=PackedStringArray("4.7")\n');
    for (const [name, source] of Object.entries(SHADERS)) writeFileSync(path.join(project, name), source);
    const program = captureGodotBoundProgram({ godotBinary: tools.exporterBinary, projectDir: project });
    const samples = directions(24);
    const reference: Record<string, unknown> = {};
    const lowered: Record<string, unknown> = {};
    const refused: string[] = [];
    const engine = program.engineShaders.map((shader) => ({ shader, key: `${shader.path}@${shader.sourceSha256}` }));
    for (const { shader, key } of [...program.shaders.map((shader: GodotBoundShader) => ({ shader, key: shader.path })), ...engine]) {
      if (!shader.ok) throw new Error(`${shader.path}: the shader frontend refused it: ${shader.message}`);
      const lowering = lowerGodotShader(shader, GODOT_SKY_SHADER_BUILTINS, 'sky');
      if (typeof lowering === 'string') {
        if (key === shader.path) throw new Error(lowering);
        refused.push(`${key}: ${lowering}`);
        continue;
      }
      const defaults = new Map<string, ShaderValue | ShaderSampler>();
      for (const uniform of shader.tree.uniforms) {
        if (uniform.type.name === 'samplerCube') defaults.set(uniform.name, cube);
        else if (uniform.type.name === 'sampler2D') defaults.set(uniform.name, flat);
        else if (uniform.default.length > 0) {
          const values = uniform.default.map((value) => ('float' in value ? value.float : 'int' in value ? value.int : 'uint' in value ? value.uint : value.bool ? 1 : 0));
          defaults.set(uniform.name, values.length === 1 ? (values[0] as number) : values);
        } else defaults.set(uniform.name, uniform.type.name === 'float' ? 0 : Array.from({ length: Number(uniform.type.name.slice(-1)) || 1 }, () => 0));
      }
      const rows: unknown[] = [];
      const rowsLowered: unknown[] = [];
      for (const d of samples) {
        const builtins = new Map<string, ShaderValue>([
          ['EYEDIR', d],
          ['SKY_COORDS', panorama(d)],
          ['TIME', f32(1.25)],
          ['PI', f32(Number(GODOT_SKY_SHADER_BUILTINS['PI']))],
          ['COLOR', [0, 0, 0]],
          ['ALPHA', 1],
          ...SKY_LIGHTS.flatMap((light, n): [string, ShaderValue][] => [
            [`LIGHT${String(n)}_ENABLED`, light.enabled],
            [`LIGHT${String(n)}_DIRECTION`, light.direction],
            [`LIGHT${String(n)}_ENERGY`, light.energy],
            [`LIGHT${String(n)}_COLOR`, light.color],
            [`LIGHT${String(n)}_SIZE`, light.size],
          ]),
        ]);
        evaluateGodotShaderTree(shader.tree, 'sky', builtins, defaults as ReadonlyMap<string, ShaderValue | ShaderSampler>);
        rows.push([builtins.get('COLOR'), builtins.get('ALPHA')]);
        const variables = new Map<string, ShaderValue | ShaderSampler>([
          ['cube_normal', d],
          ['panorama_coords', panorama(d)],
          ['time', f32(1.25)],
          ['color', [0, 0, 0]],
          ['alpha', 1],
          ...SKY_LIGHTS.flatMap((light, n): [string, ShaderValue][] => [
            [`godot_sky_light${String(n)}_enabled`, light.enabled],
            [`godot_sky_light${String(n)}_direction`, light.direction],
            [`godot_sky_light${String(n)}_energy`, light.energy],
            [`godot_sky_light${String(n)}_color`, light.color],
            [`godot_sky_light${String(n)}_size`, light.size],
          ]),
        ]);
        for (const uniform of lowering.uniforms) variables.set(uniform.glsl, defaults.get(uniform.name) as ShaderValue | ShaderSampler);
        // The printed helper functions, then the entry body.
        evaluateGlsl(`${lowering.functions}\n${lowering.entry}`, variables);
        rowsLowered.push([variables.get('color'), variables.get('alpha')]);
      }
      reference[key] = rows;
      lowered[key] = rowsLowered;
    }
    const nativeJson = JSON.stringify(canonical(reference));
    const targetJson = JSON.stringify(canonical(lowered));
    const comparison = JSON.stringify({ native: nativeJson, target: targetJson, equal: nativeJson === targetJson });
    return [
      {
        name: 'shader-lowering',
        identities: {
          input: inputDigest(),
          implementation: monorepoImplementationDigest(GODOT_SHADER_LOWERING_IMPLEMENTATION_FILES),
          observed: sha256(nativeJson),
          comparison: sha256(comparison),
        },
        agree: nativeJson === targetJson,
        detail: `native ${nativeJson}\ntarget ${targetJson}\nnot lowered ${JSON.stringify(refused)}`,
      },
    ];
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
