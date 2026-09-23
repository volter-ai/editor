#!/usr/bin/env node
/**
 * BLENDER'S OWN NODE GLSL, copied into the presenter.
 *
 * WHEN IT RUNS: after the Blender fork's shader sources move (a new pin), or
 * when the presenter's graph compiler (`browser/three/blender-node-graph.ts`)
 * starts compiling a node type whose GLSL is not in the library yet — add the
 * node's file to ROOTS and re-run.
 *
 * WHAT IT READS: a Blender build tree's PROCESSED shaders (`*.glsl.tmp`,
 * written by Blender's own `glsl_preprocess` at build time: templates
 * expanded, struct methods renamed, references spelled `_ref(T, x)`), and the
 * matching SOURCE tree for each file's `#include` order. Nothing here converts
 * Blender's shader dialect; Blender already did, and `PRELUDE` is the subset of
 * Blender's `gpu_shader_compat_glsl.glsl` that maps the remaining type names
 * onto GLSL.
 *
 * WHAT IT WRITES: `browser/three/blender-node-glsl.generated.ts` — one entry
 * per file (its direct dependencies and its code), the prelude, and the
 * Blender commit the bytes came from. Checked in; the presenter never reads a
 * Blender tree at runtime.
 *
 *   node scripts/generate-node-glsl.mjs \
 *     --processed <build>/source/blender/gpu/shaders \
 *     --source <blender>/source/blender/gpu/shaders --commit <sha>
 */
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** The node files the graph compiler calls into. Their dependency closure is
 *  what ships. */
const ROOTS = [
  'gpu_shader_common_math.glsl',
  'gpu_shader_common_color_ramp.glsl',
  'gpu_shader_common_mix_rgb.glsl',
  'gpu_shader_material_bright_contrast.glsl',
  'gpu_shader_material_clamp.glsl',
  'gpu_shader_material_combine_color.glsl',
  'gpu_shader_material_combine_xyz.glsl',
  'gpu_shader_material_fresnel.glsl',
  'gpu_shader_material_gamma.glsl',
  'gpu_shader_material_hue_sat_val.glsl',
  'gpu_shader_material_invert.glsl',
  'gpu_shader_material_layer_weight.glsl',
  'gpu_shader_material_map_range.glsl',
  'gpu_shader_material_mapping.glsl',
  'gpu_shader_material_mix_color.glsl',
  'gpu_shader_material_rgb_to_bw.glsl',
  'gpu_shader_material_separate_color.glsl',
  'gpu_shader_material_separate_xyz.glsl',
  'gpu_shader_material_tex_brick.glsl',
  'gpu_shader_material_tex_checker.glsl',
  'gpu_shader_material_tex_gradient.glsl',
  'gpu_shader_material_tex_magic.glsl',
  'gpu_shader_material_tex_noise.glsl',
  'gpu_shader_material_tex_voronoi.glsl',
  'gpu_shader_material_tex_wave.glsl',
  'gpu_shader_material_tex_white_noise.glsl',
  'gpu_shader_material_vector_math.glsl',
  'gpu_shader_material_vector_rotate.glsl',
];

/**
 * WHERE BLENDER'S GLSL IS NOT GLSL ES 3.00. Blender compiles this library as
 * desktop GLSL, Vulkan GLSL or Metal, all of which convert int to float
 * implicitly and accept a non-constant `const` local; WebGL2 does neither.
 * Each patch is the smallest explicit spelling of what the desktop compiler
 * already did, named by file with the number of sites it must find -- a
 * Blender change that moves one is a loud failure here, never a silent skip.
 * The list is exactly what the browser's own compiler refused, per file
 * (measured in the editor page against every file in ROOTS' closure).
 */
const PATCHES = [
  ['gpu_shader_math_safe_lib.glsl', 'return a - N * b;', 'return a - float(N) * b;', 1],
  ['gpu_shader_material_tex_brick.glsl', 'brick_width * bricknum', 'brick_width * float(bricknum)', 1],
  ['gpu_shader_material_tex_brick.glsl', 'row_height * rownum', 'row_height * float(rownum)', 1],
  ['gpu_shader_material_tex_magic.glsl', /depth > (\d+)\)/g, 'depth > $1.0f)', 10],
  ['gpu_shader_material_tex_gradient.glsl', '(M_PI * 2)', '(M_PI * 2.0f)', 1],
  ['gpu_shader_material_tex_checker.glsl', '((mod(xi, 2) == mod(yi, 2)) == bool(mod(zi, 2)))',
    '(((xi % 2) == (yi % 2)) == bool(zi % 2))', 1],
  ['gpu_shader_material_noise.glsl', 'float g = 1u + (h & 7u);', 'float g = float(1u + (h & 7u));', 1],
  ['gpu_shader_material_noise.glsl', /\b(f[xyzw]) - 1\b(?!\.)/g, '$1 - 1.0f', 12],
  ['gpu_shader_material_voronoi.glsl', 'float cellOffset = i;', 'float cellOffset = float(i);', 4],
  ['gpu_shader_material_voronoi.glsl', 'float cellOffset = i + closestPointOffset;',
    'float cellOffset = float(i) + closestPointOffset;', 1],
  ['gpu_shader_material_fractal_voronoi.glsl', 'i <= ceil(params.detail)', 'float(i) <= ceil(params.detail)', 5],
  ['gpu_shader_material_fractal_voronoi.glsl', 'i <= params.detail)', 'float(i) <= params.detail)', 5],
  ['gpu_shader_math_euler_lib.glsl', '_ctor(EulerXYZ) 0, 0, 0 _rotc()', '_ctor(EulerXYZ) 0.0f, 0.0f, 0.0f _rotc()', 1],
  ['gpu_shader_math_angle_lib.glsl', '_ctor(AngleRadian) 0 _rotc()', '_ctor(AngleRadian) 0.0f _rotc()', 1],
  ['gpu_shader_math_axis_angle_lib.glsl', '_ctor(AxisAngle) float3(0, 1, 0), 0 _rotc()',
    '_ctor(AxisAngle) float3(0, 1, 0), 0.0f _rotc()', 1],
  ['gpu_shader_math_quaternion_lib.glsl', '_ctor(Quaternion) 1, 0, 0, 0 _rotc()',
    '_ctor(Quaternion) 1.0f, 0.0f, 0.0f, 0.0f _rotc()', 1],
  ['gpu_shader_math_quaternion_lib.glsl', /^(\s+)const (Quaternion \w+ =)/gm, '$1$2', 2],
];

/** Blender's codegen puts its constants library in every material shader;
 *  a node file may use `M_PI` without including it. */
const IMPLICIT = 'gpu_shader_math_constants_lib.glsl';

/** Blender's compat header and the backend extension header are the prelude's
 *  job; the codegen library contributes only its type-conversion macros. */
const PROVIDED = new Set(['gpu_shader_compat.hh', 'gpu_shader_glsl_extension.glsl']);

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  for (const key of ['processed', 'source', 'commit'])
    if (!out[key]) throw new Error(`generate-node-glsl: --${key} is required`);
  return out;
}

/** Every file under `root` ending in `suffix`, keyed by its name with `strip`
 *  removed (so `x.glsl.tmp` and `x.glsl` share the key `x.glsl`). */
function index(root, suffix, strip = '') {
  const found = new Map();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(suffix)) found.set(strip ? name.slice(0, -strip.length) : name, path);
    }
  };
  walk(root);
  return found;
}

const {processed, source, commit} = args();
const sources = index(source, '.glsl');
const tmps = index(processed, '.glsl.tmp', '.tmp');

const includes = name => {
  const path = sources.get(name);
  if (!path) throw new Error(`generate-node-glsl: no source for ${name}`);
  return [...readFileSync(path, 'utf8').matchAll(/^#include "([^"]+)"/gm)]
    .map(m => m[1])
    .filter(dep => !PROVIDED.has(dep));
};

/** Parameter types WebGL2's GLSL ES 3.00 does not have. A function taking one
 *  is dropped whole (GLSL compiles every function it is given, used or not);
 *  the presenter's compiler supplies the WebGL form of any it calls. */
const UNAVAILABLE = /\b(sampler1D\w*|samplerCubeArray\w*|image\w+)\b/;

/** Top-level function definitions whose parameters name an unavailable type,
 *  removed by paren and brace matching (a processed parameter list holds
 *  `_ref(T, x)`, so it is not one balanced-free span). */
function dropUnavailable(text) {
  const header = /^[A-Za-z_][\w ]*\b[A-Za-z_]\w*\s*\(/gm;
  let out = '';
  let from = 0;
  for (let m; (m = header.exec(text)); ) {
    let i = m.index + m[0].length;
    for (let depth = 1; i < text.length && depth > 0; i++) depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
    const params = text.slice(m.index + m[0].length, i - 1);
    const rest = text.slice(i).match(/^\s*\{/);
    if (!rest || !UNAVAILABLE.test(params)) continue;
    let end = i + rest[0].length - 1;
    for (let depth = 0; end < text.length; end++) {
      if (text[end] === '{') depth++;
      else if (text[end] === '}' && --depth === 0) break;
    }
    out += text.slice(from, m.index);
    from = end + 1;
    header.lastIndex = from;
  }
  return out + text.slice(from);
}

const code = name => {
  const path = tmps.get(name);
  if (!path) throw new Error(`generate-node-glsl: no processed ${name}.tmp — build Blender first`);
  const text = readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => !/^#line\b/.test(line) && !/^#pragma\b/.test(line))
    // A macro line that is only its continuation is empty in the macro;
    // ANGLE's preprocessor reads one as a directive that runs to end of file.
    .filter(line => !/^\s*\\$/.test(line))
    .join('\n');
  return dropUnavailable(text).replace(/\n{3,}/g, '\n\n').trim();
};

const files = {};
const visit = name => {
  if (files[name]) return;
  files[name] = {deps: [], code: ''};
  const deps = includes(name);
  if (name !== IMPLICIT && !deps.includes(IMPLICIT)) deps.unshift(IMPLICIT);
  for (const dep of deps) visit(dep);
  files[name] = {deps, code: code(name)};
};
for (const root of ROOTS) visit(root);

for (const [file, find, replace, count] of PATCHES) {
  const entry = files[file];
  if (!entry) throw new Error(`generate-node-glsl: patch names ${file}, which the closure does not hold`);
  const found = typeof find === 'string' ? entry.code.split(find).length - 1 : (entry.code.match(find) ?? []).length;
  if (found !== count)
    throw new Error(`generate-node-glsl: ${file}: expected ${count} of ${find}, found ${found} -- Blender's source moved`);
  entry.code = typeof find === 'string' ? entry.code.replaceAll(find, replace) : entry.code.replace(find, replace);
}

// THE PRELUDE: Blender's own compat spellings, single-line and unconditional,
// plus the codegen library's implicit socket conversions.
const compat = readFileSync(sources.get('gpu_shader_compat_glsl.glsl'), 'utf8');
const prelude = [];
let depth = 0;
for (const line of compat.split('\n')) {
  if (/^#\s*if/.test(line)) depth++;
  else if (/^#\s*endif/.test(line)) depth--;
  else if (depth === 0 && /^#define \w+(\([^)]*\))?( |$)/.test(line) && !line.endsWith('\\')) prelude.push(line);
}
// The compat header's RESHAPE macro, expanded: `to_float4x4(mat3)` and kin.
for (const m of compat.matchAll(/^RESHAPE\((\w+), (\w+), (\w+)\)$/gm))
  prelude.push(`${m[2]} to_${m[1]}(${m[3]} m) { return ${m[2]}(m); }`);
const codegen = readFileSync(sources.get('gpu_shader_codegen_lib.glsl'), 'utf8');
for (const line of codegen.split('\n')) if (/^#define float\d?_from_float\d?\(/.test(line)) prelude.push(line);
prelude.push('#define gpu_dfdx(x) dFdx(x)', '#define gpu_dfdy(x) dFdy(x)', '#define gpu_fwidth(x) fwidth(x)');

const out = join(dirname(fileURLToPath(import.meta.url)), '../browser/three/blender-node-glsl.generated.ts');
writeFileSync(
  out,
  `/* GENERATED by scripts/generate-node-glsl.mjs from Blender ${commit} — do not edit.
 * SPDX-FileCopyrightText: Blender Authors
 * SPDX-License-Identifier: GPL-2.0-or-later */
export const BLENDER_NODE_GLSL_COMMIT = ${JSON.stringify(commit)};
export const BLENDER_NODE_GLSL_PRELUDE = ${JSON.stringify(prelude.join('\n'))};
export const BLENDER_NODE_GLSL: Readonly<Record<string, {readonly deps: readonly string[]; readonly code: string}>> = ${JSON.stringify(files, null, 1)};
`,
);
console.log(`${basename(out)}: ${Object.keys(files).length} files, ${prelude.length} prelude lines`);
