/**
 * A MATERIAL'S NODE GRAPH, COMPILED THE WAY EEVEE COMPILES IT.
 *
 * The session ships the graph that drives a Principled BSDF's or an Emission's
 * linked inputs (`session.py`'s `material_graph`): Blender's own nodes, every
 * input socket in declaration order with its GPU type, every output's GPU
 * type, the node's RNA properties. This file turns that into GLSL the way
 * Blender's GPU codegen does (`gpu_codegen.cc`, each node's
 * `node_shader_gpu_*`): one call per node into Blender's own node library
 * (`blender-node-glsl.generated.ts`), arguments in stack order -- the inputs,
 * the node's extra constants, the outputs -- with Blender's implicit socket
 * conversions (`<to>_from_<from>`) between them.
 *
 * What differs from EEVEE is only what EEVEE reads from its own engine: the
 * texture coordinates (`COORDINATES` below, transcribed from EEVEE's
 * `coordinate_*` and `attr_load_orco`), image sampling through three's
 * textures, and the colour ramp's 257-texel band, which WebGL2 holds as a 2D
 * texture instead of a `sampler1DArray`.
 *
 * Unlinked input values are UNIFORMS, never literals, so an edited constant
 * updates the program instead of compiling a new one: `key` names the
 * program's structure, `uniforms` its values.
 */
import * as THREE from 'three';
import {z} from 'zod';
import {BLENDER_NODE_GLSL, BLENDER_NODE_GLSL_PRELUDE} from './blender-node-glsl.generated';

const scalar = z.number().finite();
const gpuType = z.enum(['float', 'vec2', 'vec3', 'vec4']);
type GpuType = z.infer<typeof gpuType>;
const value = z.union([scalar, z.array(scalar)]);
const link = z.tuple([z.string(), z.number().int().nonnegative()]);
const sourceSchema = z.union([
  z.object({value}).strict(),
  z.object({link}).strict(),
]);

/** The node types `session.py`'s `_GRAPH_NODES` ships. A type the session
 *  ships and this file does not name is a schema rejection, never a guess. */
export const GRAPH_NODE_TYPES = [
  'ShaderNodeTexCoord', 'ShaderNodeUVMap', 'ShaderNodeValue', 'ShaderNodeRGB',
  'ShaderNodeTexImage', 'ShaderNodeMapping', 'ShaderNodeMath', 'ShaderNodeVectorMath',
  'ShaderNodeMix', 'ShaderNodeMixRGB', 'ShaderNodeValToRGB', 'ShaderNodeInvert',
  'ShaderNodeSeparateXYZ', 'ShaderNodeCombineXYZ', 'ShaderNodeTexNoise',
  'ShaderNodeTexVoronoi', 'ShaderNodeTexChecker', 'ShaderNodeTexWhiteNoise',
  'ShaderNodeTexWave', 'ShaderNodeTexGradient', 'ShaderNodeTexMagic', 'ShaderNodeTexBrick',
  'ShaderNodeMapRange', 'ShaderNodeClamp', 'ShaderNodeHueSaturation', 'ShaderNodeBrightContrast',
  'ShaderNodeGamma', 'ShaderNodeRGBToBW', 'ShaderNodeSeparateColor', 'ShaderNodeCombineColor',
  'ShaderNodeVectorRotate', 'ShaderNodeFresnel', 'ShaderNodeLayerWeight', 'ShaderNodeBump',
  'ShaderNodeNormalMap', 'ShaderNodeNewGeometry',
] as const;

const nodeSchema = z.object({
  type: z.enum(GRAPH_NODE_TYPES),
  props: z.record(z.string(), z.unknown()),
  inputs: z.array(z.union([
    z.object({value, id: z.string(), gpu: gpuType, enabled: z.boolean()}).strict(),
    z.object({link, id: z.string(), gpu: gpuType, enabled: z.boolean()}).strict(),
  ])),
  outputs: z.array(z.object({id: z.string(), gpu: gpuType.or(z.literal('closure')).nullable()}).strict()),
}).strict();

export const materialGraphSchema = z.object({
  surface: z.enum(['ShaderNodeBsdfPrincipled', 'ShaderNodeEmission']),
  inputs: z.record(z.string(), sourceSchema),
  nodes: z.record(z.string(), nodeSchema),
}).strict();
export type MaterialGraph = z.infer<typeof materialGraphSchema>;
type GraphNode = z.infer<typeof nodeSchema>;
type Source = z.infer<typeof sourceSchema>;

/** Scene-linear Rec.709's luminance, which Blender's default configuration
 *  answers to `IMB_colormanagement_get_luminance_coefficients` (the Y row of
 *  its scene-linear to XYZ matrix). Codegen passes it to `float_from_float4`. */
const LUMINANCE = 'vec3(0.2126729, 0.7151522, 0.0721750)';

export interface GraphImage {
  readonly uniform: string;
  readonly node: string;
  readonly name: string;
  readonly revision: number;
  readonly extension: 'REPEAT' | 'EXTEND' | 'MIRROR' | 'CLIP';
  readonly closest: boolean;
}
export interface GraphRamp {
  readonly uniform: string;
  readonly table: readonly (readonly number[])[];
}
export interface CompiledGraph {
  /** The program's structure: equal keys share one program. */
  readonly key: string;
  /** Declarations: the prelude, the library files in dependency order, the
   *  uniforms, the graph function. Goes before `main`. */
  readonly declarations: string;
  /** Uniform name to value; refreshed on every frame without recompiling. */
  readonly uniforms: ReadonlyMap<string, number | readonly number[]>;
  readonly images: readonly GraphImage[];
  readonly ramps: readonly GraphRamp[];
  /** UV layer names the graph reads ('' is the render UV). */
  readonly uvs: readonly string[];
  /** Which surface inputs the graph drives, each a GLSL global of `type`. */
  readonly outputs: Readonly<Record<string, {readonly global: string; readonly type: GpuType}>>;
  readonly surface: MaterialGraph['surface'];
}

const width = (type: GpuType): number => (type === 'float' ? 1 : Number(type[3]));

function literal(type: GpuType, v: number | readonly number[]): readonly number[] {
  const values = typeof v === 'number' ? [v] : v;
  const n = width(type);
  return Array.from({length: n}, (_, i) => values[i] ?? (i === 3 ? 1 : 0));
}

/** Blender's `<to>_from_<from>` socket conversion, as the codegen library
 *  spells it; `float_from_float4` takes the luminance coefficients. */
function convert(expression: string, from: GpuType, to: GpuType): string {
  if (from === to) return expression;
  const name = (t: GpuType) => (t === 'float' ? 'float' : `float${t[3]}`);
  const extra = from === 'vec4' && to === 'float' ? `, ${LUMINANCE}` : '';
  return `${name(to)}_from_${name(from)}(${expression}${extra})`;
}

/** Math and Vector Math: the operation's GLSL name (`FloatMathOperationInfo`
 *  and `gpu_shader_get_name` in node_shader_vector_math.cc). */
const MATH_NAMES: Record<string, string> = {
  INVERSE_SQRT: 'math_inversesqrt', FRACT: 'math_fraction',
  SMOOTH_MIN: 'math_smoothmin', SMOOTH_MAX: 'math_smoothmax',
};
const VECTOR_MATH_NAMES: Record<string, string> = {
  CROSS_PRODUCT: 'vector_math_cross', DOT_PRODUCT: 'vector_math_dot',
};
/** `MA_RAMP_*` by RNA identifier to the mix function's suffix. */
const BLEND_NAMES: Record<string, string> = {
  MIX: 'blend', ADD: 'add', MULTIPLY: 'mult', SUBTRACT: 'sub', SCREEN: 'screen',
  DIVIDE: 'div_fallback', DIFFERENCE: 'diff', EXCLUSION: 'exclusion', DARKEN: 'dark',
  LIGHTEN: 'light', OVERLAY: 'overlay', DODGE: 'dodge', BURN: 'burn', HUE: 'hue',
  SATURATION: 'sat', VALUE: 'val', COLOR: 'color', SOFT_LIGHT: 'soft', LINEAR_LIGHT: 'linear',
};
const NOISE_NAMES: Record<string, string> = {
  MULTIFRACTAL: 'multi_fractal', FBM: 'fbm', HYBRID_MULTIFRACTAL: 'hybrid_multi_fractal',
  RIDGED_MULTIFRACTAL: 'ridged_multi_fractal', HETERO_TERRAIN: 'hetero_terrain',
};
const VORONOI_NAMES: Record<string, string> = {
  F1: 'f1', F2: 'f2', SMOOTH_F1: 'smooth_f1', DISTANCE_TO_EDGE: 'distance_to_edge',
  N_SPHERE_RADIUS: 'n_sphere_radius',
};
/** `SHD_VORONOI_*` distance metrics, passed as a float constant. */
const VORONOI_METRICS: Record<string, number> = {EUCLIDEAN: 0, MANHATTAN: 1, CHEBYCHEV: 2, MINKOWSKI: 3};

/** Every library file that defines `fn`, so a call pulls in its file. */
const DEFINED_IN = (() => {
  const map = new Map<string, string>();
  for (const [file, entry] of Object.entries(BLENDER_NODE_GLSL))
    for (const m of entry.code.matchAll(/^(?:void|float\d?)\s+([A-Za-z_]\w*)\s*\(/gm))
      if (!map.has(m[1]!)) map.set(m[1]!, file);
  return map;
})();

function prop<T>(node: GraphNode, name: string): T {
  if (!(name in node.props)) throw new Error(`${node.type} arrived without its '${name}' property`);
  return node.props[name] as T;
}

/** What EEVEE's node library reads from EEVEE itself, transcribed: the
 *  shading globals `g_data` (`init_globals`: N faces the viewer, Ng the true
 *  normal), the object/view matrix accessors `transform_utils` calls, the
 *  object's negative-scale flag, `coordinate_incoming` (toward the eye; the
 *  view axis in orthographic), `derivative_scale_get` (1 at full resolution)
 *  and codegen's precise `dF_impl`, which the bump sub-function evaluates
 *  with its derivative flag set (`gpu_shader_codegen_lib.glsl`).
 *  BLENDER'S WORLD IS Z-UP: the presenter's model root maps it into three's
 *  Y-up world by the exact permutation (x, y, z) -> (x, z, -y)
 *  (`blender-runtime-view.ts`), so every world-space quantity handed to the
 *  library goes back through `blender_from_three`, and a normal the graph
 *  returns comes out through its transpose. */
const EEVEE_GLOBALS = `
#define GPU_FRAGMENT_SHADER
#define FrontFacing gl_FrontFacing
uniform mat4 modelMatrix;
const mat3 blender_from_three = mat3(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0);
const mat4 blender_from_three4 = mat4(blender_from_three);
struct BlenderGlobalData { vec3 P; vec3 N; vec3 Ng; vec3 Ni; bool is_strand; vec3 curve_T; vec2 barycentric_coords; };
BlenderGlobalData g_data;
struct ObjectMatrices { mat4 model; mat4 model_inverse; };
ObjectMatrices object_matrices_get() {
  mat4 model = blender_from_three4 * modelMatrix;
  return ObjectMatrices(model, inverse(model));
}
struct ViewMatrices { mat4 viewmat; mat4 viewinv; };
ViewMatrices view_matrices_get() {
  mat4 viewinv = blender_from_three4 * inverse(viewMatrix);
  return ViewMatrices(inverse(viewinv), viewinv);
}
#define OBJECT_NEGATIVE_SCALE 1u
struct ObjectInfos { uint flag; };
ObjectInfos object_infos_get() { return ObjectInfos(determinant(mat3(modelMatrix)) < 0.0 ? 1u : 0u); }
vec3 coordinate_incoming(vec3 P) {
  return isOrthographic ? normalize(blender_from_three * vec3(inverse(viewMatrix)[2]))
    : normalize(blender_from_three * cameraPosition - P);
}
float derivative_scale_get() { return 1.0; }
float g_derivative_filter_width = 0.0;
int g_derivative_flag = 0;
vec3 dF_impl(vec3 v) {
  if (g_derivative_flag > 0) return dFdx(v) * g_derivative_filter_width;
  else if (g_derivative_flag < 0) return dFdy(v) * g_derivative_filter_width;
  return vec3(0.0);
}
void blender_init_globals() {
  // EEVEE's init_globals: the shading normal faces the viewer.
  vec3 N = blender_from_three * normalize(vBlenderWorldNormal);
  g_data.P = blender_from_three * vBlenderWorldPosition;
  g_data.N = gl_FrontFacing ? N : -N;
  g_data.Ni = g_data.N;
  vec3 Ng = normalize(cross(dFdx(g_data.P), dFdy(g_data.P)));
  g_data.Ng = gl_FrontFacing ? Ng : -Ng;
  g_data.is_strand = false;
  g_data.curve_T = vec3(0.0);
  g_data.barycentric_coords = vec2(0.0);
}
`;

/** The GLSL the graph's coordinate nodes read, from three's own varyings and
 *  EEVEE's definitions of each Texture Coordinate output. */
const COORDINATES = `
uniform vec2 blenderViewport;
vec3 blender_orco() {
  // attr_load_orco: the orco attribute (\`orcoAttribute\`), interpolated.
  return vBlenderOrco;
}
vec3 blender_object_normal() {
  // normal_transform_world_to_object, of the interpolated normal.
  return normalize(vBlenderObjectNormal);
}
vec3 blender_camera() {
  // coordinate_camera: view-space position with z pointing away.
  vec3 v = (viewMatrix * vec4(vBlenderWorldPosition, 1.0)).xyz;
  return vec3(v.xy, -v.z);
}
vec3 blender_window() {
  // coordinate_screen, without a camera border.
  return vec3(gl_FragCoord.xy / blenderViewport, 0.0);
}
vec4 blender_uv_tangent(vec2 uv) {
  // A tangent from the UV layer's screen derivatives (three's
  // perturbNormal2Arb), where EEVEE reads the mesh's MikkTSpace tangent.
  vec3 N = g_data.N;
  vec3 dp1 = dFdx(g_data.P), dp2 = dFdy(g_data.P);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float m = max(dot(T, T), dot(B, B));
  if (m == 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  T *= inversesqrt(m); B *= inversesqrt(m);
  return vec4(normalize(T), dot(cross(N, T), B) < 0.0 ? -1.0 : 1.0);
}
vec3 blender_reflection() {
  // coordinate_reflect: -reflect(world incident, N), incident toward the eye.
  vec3 incident = isOrthographic
    ? normalize(vec3(inverse(viewMatrix)[2]))
    : normalize(cameraPosition - vBlenderWorldPosition);
  return blender_from_three * -reflect(incident, normalize(vBlenderWorldNormal));
}
`;

/** What every compiler of one material shares: its program's library files,
 *  uniforms, textures, UV layers, structure key and sub-functions. */
interface Shared {
  readonly files: Set<string>;
  readonly uniforms: Map<string, number | readonly number[]>;
  readonly uniformTypes: Map<string, GpuType>;
  readonly images: GraphImage[];
  readonly ramps: GraphRamp[];
  readonly uvs: Set<string>;
  readonly structure: unknown[];
  /** Sub-functions (a Bump's height), defined before `blenderGraph`. */
  readonly functions: string[];
}

class Compiler {
  readonly lines: string[] = [];
  private readonly emitted = new Map<string, {name: string; type: GpuType}[]>();
  private readonly s: Shared;

  /** `derivative` is Blender's `node_shader_gpu_bump_tex_coord`: in a bump's
   *  height sub-function every coordinate read carries `dF_impl`, so the
   *  sub-function evaluated with the derivative flag set samples the offset
   *  position. */
  constructor(private readonly graph: MaterialGraph, shared?: Shared,
    private readonly derivative = false, private readonly prefix = 'bgN') {
    this.s = shared ?? {files: new Set(), uniforms: new Map(), uniformTypes: new Map(), images: [], ramps: [],
      uvs: new Set(), structure: [], functions: []};
  }

  get uniforms() { return this.s.uniforms; }
  get images() { return this.s.images; }
  get ramps() { return this.s.ramps; }

  /** A coordinate as the height sub-function reads it (see `derivative`). */
  private d(expr: string): string {
    return this.derivative ? `(${expr} + dF_impl(${expr}))` : expr;
  }

  private uniform(type: GpuType, v: number | readonly number[]): string {
    const name = `bgU${this.s.uniforms.size}`;
    const values = literal(type, v);
    this.s.uniforms.set(name, type === 'float' ? values[0]! : values);
    this.s.uniformTypes.set(name, type);
    return name;
  }

  private use(fn: string): string {
    const file = DEFINED_IN.get(fn);
    if (!file) throw new Error(`Blender's node library has no ${fn}`);
    this.s.files.add(file);
    return fn;
  }

  /** An input as a GLSL expression of `to`. */
  source(source: Source, to: GpuType): string {
    if ('value' in source) {
      this.s.structure.push('v');
      return this.uniform(to, source.value);
    }
    const [key, index] = source.link;
    const node = this.graph.nodes[key];
    if (!node) throw new Error(`The graph links to ${key}, which it does not carry`);
    const outputs = this.node(key, node);
    const output = outputs[index];
    if (!output) throw new Error(`${key} has no output ${index}`);
    this.s.structure.push(['l', key, index]);
    return convert(output.name, output.type, to);
  }

  private input(node: GraphNode, id: string, to?: GpuType): string {
    const input = node.inputs.find(i => i.id === id) ?? node.inputs.find(i => i.id.replace(/_/g, ' ') === id);
    if (!input) throw new Error(`${node.type} arrived without its '${id}' input`);
    return this.source(input, to ?? input.gpu);
  }

  /** A texture node's Vector: its link, or the coordinate Blender defaults to
   *  (`node_shader_gpu_default_tex_coord`: Generated; UV for an image). */
  private coordinate(node: GraphNode, fallback: 'orco' | 'uv'): string {
    const input = node.inputs[0]!;
    if ('link' in input) return this.source(input, 'vec3');
    this.s.structure.push(['default', fallback]);
    if (fallback === 'orco') return this.d('blender_orco()');
    this.s.uvs.add('');
    return this.d(`vec3(${uvVarying('')}, 0.0)`);
  }

  /** Each node's outputs, declared once, as `{name, type}` by socket index. */
  private node(key: string, node: GraphNode): {name: string; type: GpuType}[] {
    const held = this.emitted.get(key);
    if (held) return held;
    const id = `${this.prefix}${this.emitted.size}`;
    // A closure output is not a value any graph input reads; it is declared as
    // a float so socket indices stay Blender's.
    const outputs = node.outputs.map((o, i) => ({name: `${id}_${i}`, type: (o.gpu === 'closure' || o.gpu === null ? 'float' : o.gpu) as GpuType}));
    this.emitted.set(key, outputs);
    const declare = (i: number) => `${outputs[i]!.type} ${outputs[i]!.name} = ${outputs[i]!.type}(0.0);`;
    const all = outputs.map((_, i) => declare(i)).join(' ');
    const outs = (indices: number[]) => indices.map(i => outputs[i]!.name).join(', ');
    const stack = (extras: string[] = []) => {
      // GPU_stack_link: every input with a GPU type, the extras, every output.
      const args = node.inputs.map(i => this.source(i, i.gpu));
      return [...args, ...extras, ...outputs.map(o => o.name)].join(', ');
    };
    this.s.structure.push(['n', node.type, node.props['operation'], node.props['blend_type'], node.props['data_type'],
      node.props['factor_mode'], node.props['clamp_factor'], node.props['clamp_result'], node.props['use_clamp'],
      node.props['noise_dimensions'], node.props['noise_type'], node.props['voronoi_dimensions'], node.props['feature'],
      node.props['distance'], node.props['vector_type'], node.props['uv_map'], node.props['extension'],
      node.props['interpolation'], node.props['image_alpha_mode'], node.props['image_is_data'],
      (node.props['color_ramp'] as {elements?: unknown[]; interpolation?: string; color_mode?: string} | undefined)?.elements?.length,
      (node.props['color_ramp'] as {interpolation?: string} | undefined)?.interpolation]);
    const body: string[] = [all];
    switch (node.type) {
      case 'ShaderNodeValue':
      case 'ShaderNodeRGB': {
        const type = outputs[0]!.type;
        body.push(`${outputs[0]!.name} = ${this.uniform(type, prop<number | number[]>(node, 'value'))};`);
        break;
      }
      case 'ShaderNodeTexCoord': {
        // node_tex_coord's outputs, in socket order.
        this.s.uvs.add('');
        const values = ['blender_orco()', 'blender_object_normal()', `vec3(${uvVarying('')}, 0.0)`,
          'vBlenderObjectPosition', 'blender_camera()', 'blender_window()', 'blender_reflection()'];
        values.forEach((v, i) => { if (outputs[i]) body.push(`${outputs[i]!.name} = ${this.d(v)};`); });
        break;
      }
      case 'ShaderNodeUVMap': {
        const name = prop<string>(node, 'uv_map');
        this.s.uvs.add(name);
        body.push(`${outputs[0]!.name} = ${this.d(`vec3(${uvVarying(name)}, 0.0)`)};`);
        break;
      }
      case 'ShaderNodeMath': {
        const op = prop<string>(node, 'operation');
        const fn = this.use(MATH_NAMES[op] ?? `math_${op.toLowerCase()}`);
        body.push(`${fn}(${stack()});`);
        if (prop<boolean>(node, 'use_clamp'))
          body.push(`${this.use('clamp_value')}(${outs([0])}, 0.0, 1.0, ${outs([0])});`);
        break;
      }
      case 'ShaderNodeVectorMath': {
        const op = prop<string>(node, 'operation');
        body.push(`${this.use(VECTOR_MATH_NAMES[op] ?? `vector_math_${op.toLowerCase()}`)}(${stack()});`);
        break;
      }
      case 'ShaderNodeMapping':
        body.push(`${this.use(`mapping_${prop<string>(node, 'vector_type').toLowerCase()}`)}(${stack()});`);
        break;
      case 'ShaderNodeInvert':
        body.push(`${this.use('invert')}(${stack()});`);
        break;
      case 'ShaderNodeSeparateXYZ':
        body.push(`${this.use('separate_xyz')}(${stack()});`);
        break;
      case 'ShaderNodeCombineXYZ':
        body.push(`${this.use('combine_xyz')}(${stack()});`);
        break;
      case 'ShaderNodeMix': {
        // gpu_shader_mix: named sockets only, factor clamp before, colour clamp after.
        const dataType = prop<string>(node, 'data_type');
        const nonUniform = prop<string>(node, 'factor_mode') === 'NON_UNIFORM';
        const suffix = {FLOAT: 'Float', VECTOR: 'Vector', RGBA: 'Color', ROTATION: 'Rotation'}[dataType];
        if (!suffix) throw new Error(`Mix has data type ${dataType}`);
        const vectorFactor = dataType === 'VECTOR' && nonUniform;
        let factor = this.input(node, vectorFactor ? 'Factor_Vector' : 'Factor_Float');
        if (prop<boolean>(node, 'clamp_factor')) {
          const clamped = `${id}_fac`;
          body.push(vectorFactor
            ? `vec3 ${clamped}; ${this.use('node_mix_clamp_vector')}(${factor}, vec3(0.0), vec3(1.0), ${clamped});`
            : `float ${clamped}; ${this.use('node_mix_clamp_value')}(${factor}, 0.0, 1.0, ${clamped});`);
          factor = clamped;
        }
        const name = dataType === 'FLOAT' ? 'node_mix_float'
          : dataType === 'VECTOR' ? (nonUniform ? 'node_mix_vector_non_uniform' : 'node_mix_vector')
          : dataType === 'RGBA' ? `node_mix_${BLEND_NAMES[prop<string>(node, 'blend_type')]}`
          : 'node_mix_rotation';
        const result = node.outputs.findIndex(o => o.id === `Result_${suffix}`);
        body.push(`${this.use(name)}(${factor}, ${this.input(node, `A_${suffix}`)}, ${this.input(node, `B_${suffix}`)}, ${outs([result])});`);
        if (dataType === 'RGBA' && prop<boolean>(node, 'clamp_result'))
          body.push(`${this.use('node_mix_clamp_color')}(${outs([result])}, vec4(0.0), vec4(1.0), ${outs([result])});`);
        break;
      }
      case 'ShaderNodeMixRGB': {
        // gpu_shader_mix_rgb: the factor is always clamped; the result when asked.
        const factor = `${id}_fac`;
        body.push(`float ${factor}; ${this.use('clamp_value')}(${this.input(node, 'Fac')}, 0.0, 1.0, ${factor});`);
        const rest = node.inputs.slice(1).map(i => this.source(i, i.gpu));
        body.push(`${this.use(`mix_${BLEND_NAMES[prop<string>(node, 'blend_type')]}`)}(${[factor, ...rest, outs([0])].join(', ')});`);
        if (prop<boolean>(node, 'use_clamp'))
          body.push(`${this.use('clamp_color')}(${outs([0])}, vec4(0.0), vec4(1.0), ${outs([0])});`);
        break;
      }
      case 'ShaderNodeValToRGB': {
        // gpu_shader_valtorgb: one stop is a constant, two RGB stops the
        // "opti" forms, anything else the 257-texel band.
        const ramp = prop<{interpolation: string; color_mode: string; elements: number[][]; table: number[][]}>(node, 'color_ramp');
        const fac = this.input(node, 'Fac');
        const [e0, e1] = ramp.elements as [number[], number[] | undefined];
        const color = (e: number[]) => this.uniform('vec4', e.slice(1, 5));
        if (ramp.elements.length === 1) {
          body.push(`${outs([0])} = ${color(e0)}; ${outs([1])} = ${outs([0])}.a;`);
        } else if (ramp.elements.length === 2 && ramp.color_mode === 'RGB' && e1 && ramp.interpolation !== 'B_SPLINE' && ramp.interpolation !== 'CARDINAL') {
          if (ramp.interpolation === 'CONSTANT') {
            body.push(`${this.use('valtorgb_opti_constant')}(${fac}, ${this.uniform('float', Math.max(e0[0]!, e1[0]!))}, ${color(e0)}, ${color(e1)}, ${outs([0, 1])});`);
          } else {
            const mul = 1 / (e1[0]! - e0[0]!);
            const fn = ramp.interpolation === 'EASE' ? 'valtorgb_opti_ease' : 'valtorgb_opti_linear';
            body.push(`${this.use(fn)}(${fac}, ${this.uniform('vec2', [mul, -mul * e0[0]!])}, ${color(e0)}, ${color(e1)}, ${outs([0, 1])});`);
          }
        } else {
          const uniform = `bgRamp${this.s.ramps.length}`;
          this.s.ramps.push({uniform, table: ramp.table});
          this.s.structure.push(['ramp', ramp.interpolation === 'CONSTANT']);
          // valtorgb / valtorgb_nearest over a 257x1 texture.
          body.push(ramp.interpolation === 'CONSTANT'
            ? `${outs([0])} = texelFetch(${uniform}, ivec2(int(clamp(${fac}, 0.0, 1.0) * 256.0), 0), 0);`
            : `${outs([0])} = texture(${uniform}, vec2(clamp(${fac}, 0.0, 1.0) * (256.0 / 257.0) + 0.5 / 257.0, 0.5));`);
          body.push(`${outs([1])} = ${outs([0])}.a;`);
        }
        break;
      }
      case 'ShaderNodeTexNoise': {
        const dims = Number(prop<string>(node, 'noise_dimensions')[0]);
        const fn = this.use(`node_noise_tex_${NOISE_NAMES[prop<string>(node, 'noise_type')]}_${dims}d`);
        const co = this.coordinate(node, 'orco');
        const rest = node.inputs.slice(1).map(i => this.source(i, i.gpu));
        const normalize = prop<boolean>(node, 'normalize') ? '1.0' : '0.0';
        body.push(`${fn}(${[co, ...rest, normalize, '1.0', outs(outputs.map((_, i) => i))].join(', ')});`);
        break;
      }
      case 'ShaderNodeTexVoronoi': {
        const dims = Number(prop<string>(node, 'voronoi_dimensions')[0]);
        const fn = this.use(`node_tex_voronoi_${VORONOI_NAMES[prop<string>(node, 'feature')]}_${dims}d`);
        const co = this.coordinate(node, 'orco');
        const rest = node.inputs.slice(1).map(i => this.source(i, i.gpu));
        const metric = `${VORONOI_METRICS[prop<string>(node, 'distance')]!.toFixed(1)}`;
        const normalize = prop<boolean>(node, 'normalize') ? '1.0' : '0.0';
        body.push(`${fn}(${[co, ...rest, metric, normalize, outs(outputs.map((_, i) => i))].join(', ')});`);
        break;
      }
      case 'ShaderNodeTexChecker': {
        const co = this.coordinate(node, 'orco');
        const rest = node.inputs.slice(1).map(i => this.source(i, i.gpu));
        body.push(`${this.use('node_tex_checker')}(${[co, ...rest, outs(outputs.map((_, i) => i))].join(', ')});`);
        break;
      }
      case 'ShaderNodeTexWhiteNoise': {
        const dims = Number(prop<string>(node, 'noise_dimensions')[0]);
        body.push(`${this.use(`node_white_noise_${dims}d`)}(${stack()});`);
        break;
      }
      case 'ShaderNodeTexWave':
      case 'ShaderNodeTexGradient':
      case 'ShaderNodeTexMagic':
      case 'ShaderNodeTexBrick': {
        // Procedural textures with node constants (`GPU_constant`/`GPU_uniform`
        // after the inputs), their Vector defaulting to Generated.
        const co = this.coordinate(node, 'orco');
        const rest = node.inputs.slice(1).map(i => this.source(i, i.gpu));
        const e = (name: string) => prop<number>(node, `${name}#value`).toFixed(1);
        const extras = node.type === 'ShaderNodeTexWave'
          ? [e('wave_type'), e('bands_direction'), e('rings_direction'), e('wave_profile')]
          : node.type === 'ShaderNodeTexGradient' ? [e('gradient_type')]
          : node.type === 'ShaderNodeTexMagic' ? [prop<number>(node, 'turbulence_depth').toFixed(1)]
          : [this.uniform('float', prop<number>(node, 'offset')), prop<number>(node, 'offset_frequency').toFixed(1),
             this.uniform('float', prop<number>(node, 'squash')), prop<number>(node, 'squash_frequency').toFixed(1)];
        const fn = {ShaderNodeTexWave: 'node_tex_wave', ShaderNodeTexGradient: 'node_tex_gradient',
          ShaderNodeTexMagic: 'node_tex_magic', ShaderNodeTexBrick: 'node_tex_brick'}[node.type];
        body.push(`${this.use(fn)}(${[co, ...rest, ...extras, outs(outputs.map((_, i) => i))].join(', ')});`);
        break;
      }
      case 'ShaderNodeMapRange': {
        // gpu_shader_map_range: every socket, the clamp flag; a clamped
        // linear/stepped float result then goes through clamp_range(To Min, To Max).
        const vector = prop<string>(node, 'data_type') === 'FLOAT_VECTOR';
        const mode = prop<string>(node, 'interpolation_type').toLowerCase();
        const clamp = prop<boolean>(node, 'clamp');
        body.push(`${this.use(`${vector ? 'vector_' : ''}map_range_${mode}`)}(${stack([clamp ? '1.0' : '0.0'])});`);
        if (clamp && !vector && (mode === 'linear' || mode === 'stepped'))
          body.push(`${this.use('clamp_range')}(${outs([0])}, ${this.input(node, 'To Min', 'float')}, ${this.input(node, 'To Max', 'float')}, ${outs([0])});`);
        break;
      }
      case 'ShaderNodeClamp':
        body.push(`${this.use(prop<string>(node, 'clamp_type') === 'MINMAX' ? 'clamp_minmax' : 'clamp_range')}(${stack()});`);
        break;
      case 'ShaderNodeHueSaturation':
        body.push(`${this.use('hue_sat')}(${stack()});`);
        break;
      case 'ShaderNodeBrightContrast':
        body.push(`${this.use('brightness_contrast')}(${stack()});`);
        break;
      case 'ShaderNodeGamma':
        body.push(`${this.use('node_gamma')}(${stack()});`);
        break;
      case 'ShaderNodeRGBToBW':
        body.push(`${this.use('rgbtobw')}(${stack([LUMINANCE])});`);
        break;
      case 'ShaderNodeSeparateColor':
        body.push(`${this.use(`separate_color_${prop<string>(node, 'mode').toLowerCase()}`)}(${stack()});`);
        break;
      case 'ShaderNodeCombineColor':
        body.push(`${this.use(`combine_color_${prop<string>(node, 'mode').toLowerCase()}`)}(${stack()});`);
        break;
      case 'ShaderNodeVectorRotate': {
        const name = {AXIS_ANGLE: 'axis_angle', X_AXIS: 'axis_x', Y_AXIS: 'axis_y', Z_AXIS: 'axis_z',
          EULER_XYZ: 'euler_xyz'}[prop<string>(node, 'rotation_type')];
        body.push(`${this.use(`node_vector_rotate_${name}`)}(${stack([prop<boolean>(node, 'invert') ? '-1.0' : '1.0'])});`);
        break;
      }
      case 'ShaderNodeFresnel':
      case 'ShaderNodeLayerWeight': {
        // An unlinked Normal is the shading normal (`world_normals_get`).
        const n = node.inputs[1]!;
        const normal = 'link' in n ? this.source(n, 'vec3') : 'g_data.N';
        if (!('link' in n)) this.s.structure.push('world-normal');
        const first = this.source(node.inputs[0]!, 'float');
        const fn = node.type === 'ShaderNodeFresnel' ? 'node_fresnel' : 'node_layer_weight';
        body.push(`${this.use(fn)}(${[first, normal, outs(outputs.map((_, i) => i))].join(', ')});`);
        break;
      }
      case 'ShaderNodeBump': {
        // gpu_shader_bump: no Height is a no-op (the Normal, or the shading
        // normal); otherwise the height sub-function evaluated at the shading
        // point and at the dF offsets, into node_bump.
        const height = node.inputs.find(i => i.id === 'Height');
        const normalIn = node.inputs.find(i => i.id === 'Normal');
        const normal = normalIn && 'link' in normalIn ? this.source(normalIn, 'vec3') : 'g_data.N';
        if (!height || !('link' in height)) {
          body.push(`${outs([0])} = ${normal};`);
          break;
        }
        const fn = `bgHeight${this.s.functions.length}`;
        this.s.functions.push('');
        const child = new Compiler(this.graph, this.s, true, `${fn}_`);
        const expr = child.source(height, 'float');
        this.s.functions[Number(fn.slice('bgHeight'.length))] =
          `float ${fn}() {\n  ${child.lines.join('\n  ')}\n  return ${expr};\n}`;
        const width = this.input(node, 'Filter Width', 'float');
        body.push(`float ${id}_h = ${fn}();`,
          `g_derivative_filter_width = ${width} * derivative_scale_get();`,
          `g_derivative_flag = 1; float ${id}_hx = ${fn}();`,
          `g_derivative_flag = -1; float ${id}_hy = ${fn}();`,
          `g_derivative_flag = 0;`);
        const invert = prop<boolean>(node, 'invert') ? '-1.0' : '1.0';
        body.push(`${this.use('node_bump')}(${this.input(node, 'Strength', 'float')}, ${this.input(node, 'Distance', 'float')}, ` +
          `${width}, ${id}_h, ${normal}, vec2(${id}_hx, ${id}_hy), ${invert}, ${outs([0])});`);
        break;
      }
      case 'ShaderNodeNormalMap': {
        // gpu_shader_normal_map.
        const space = prop<string>(node, 'space');
        const strength = this.input(node, 'Strength', 'float');
        const color = this.input(node, 'Color', 'vec3');
        const n = `${id}_n`;
        body.push(`vec3 ${n}; ${this.use(space.startsWith('BLENDER_') ? 'color_to_blender_normal_new_shading' : 'color_to_normal_new_shading')}(${color}, ${n});`);
        if (node.props['convention'] === 'DIRECTX') body.push(`${this.use('color_invert_green_channel')}(${n}, ${n});`);
        if (space === 'TANGENT') {
          const uv = prop<string>(node, 'uv_map');
          this.s.uvs.add(uv);
          body.push(`${this.use('node_normal_map')}(blender_uv_tangent(${uvVarying(uv)}), ${strength}, ${n}, g_data.Ni, ${outs([0])});`);
        } else {
          if (space === 'OBJECT' || space === 'BLENDER_OBJECT')
            body.push(`${this.use('normal_transform_object_to_world')}(${n}, ${n});`);
          body.push(`${this.use('node_normal_map_mix')}(${strength}, ${n}, ${outs([0])});`);
        }
        break;
      }
      case 'ShaderNodeNewGeometry': {
        // node_shader_gpu_geometry: every output a coordinate, 1/2/4 normalized.
        body.push(`${this.use('node_geometry')}(${['blender_orco()', outs(outputs.map((_, i) => i))].join(', ')});`);
        // Only Position is a bump coordinate (node_shader_gpu_geometry).
        if (outputs[0]) body.push(`${outputs[0].name} = ${this.d(outputs[0].name)};`);
        for (const i of [1, 2, 4]) if (outputs[i]) body.push(`${outputs[i]!.name} = normalize(${outputs[i]!.name});`);
        break;
      }
      case 'ShaderNodeTexImage': {
        const image = prop<{name: string; revision: number} | null>(node, 'image');
        if (image === null) {
          // node_tex_image_empty.
          body.push(`${outs([0])} = vec4(0.0); ${outs([1])} = 0.0;`);
          break;
        }
        const uniform = `bgImage${this.s.images.length}`;
        this.s.images.push({
          uniform, node: key, name: image.name, revision: image.revision,
          extension: prop<GraphImage['extension']>(node, 'extension'),
          closest: prop<string>(node, 'interpolation') === 'Closest',
        });
        const co = this.coordinate(node, 'uv');
        const clip = prop<string>(node, 'extension') === 'CLIP';
        body.push(`${outs([0])} = texture(${uniform}, ${co}.xy);`);
        if (clip) body.push(`if (any(lessThan(${co}.xy, vec2(0.0))) || any(greaterThan(${co}.xy, vec2(1.0)))) ${outs([0])} = vec4(0.0);`);
        body.push(`${outs([1])} = ${outs([0])}.a;`);
        // node_shader_gpu_tex_image's Color output, for three's straight-alpha
        // upload: cleared for ignored/packed/data alpha; premultiplied (and
        // cleared) when Alpha is used; straight otherwise.
        const mode = prop<string>(node, 'image_alpha_mode');
        const alphaUsed = this.uses(key, 1);
        if (mode === 'NONE' || mode === 'CHANNEL_PACKED' || prop<boolean>(node, 'image_is_data') || !alphaUsed)
          body.push(`${outs([0])}.a = 1.0;`);
        else
          body.push(`${outs([0])} = vec4(${outs([0])}.rgb * ${outs([0])}.a, 1.0);`);
        break;
      }
    }
    this.lines.push(...body);
    return outputs;
  }

  /** Whether anything in the graph reads `key`'s output `index` (Blender's
   *  `hasoutput`). */
  private uses(key: string, index: number): boolean {
    const reads = (s: Source) => 'link' in s && s.link[0] === key && s.link[1] === index;
    return Object.values(this.graph.inputs).some(reads)
      || Object.values(this.graph.nodes).some(n => n.inputs.some(reads));
  }

  compile(): CompiledGraph {
    const surfaceInputs = this.graph.surface === 'ShaderNodeEmission'
      ? {Color: 'vec4', Strength: 'float'} as const
      : {'Base Color': 'vec4', Metallic: 'float', Roughness: 'float', Alpha: 'float',
         'Emission Color': 'vec4', 'Emission Strength': 'float', Normal: 'vec3'} as const;
    const outputs: Record<string, {global: string; type: GpuType}> = {};
    const assignments: string[] = [];
    let index = 0;
    for (const [name, type] of Object.entries(surfaceInputs)) {
      const source = this.graph.inputs[name];
      if (!source) continue;
      // An unlinked Normal is the geometry's own, which three already shades.
      if (name === 'Normal' && !('link' in source)) continue;
      const global = `bgOut${index++}`;
      outputs[name] = {global, type};
      this.s.structure.push(['out', name]);
      assignments.push(`${global} = ${this.source(source, type)};`);
    }
    const ordered: string[] = [];
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const dep of BLENDER_NODE_GLSL[file]!.deps) visit(dep);
      ordered.push(file);
    };
    for (const file of this.s.files) visit(file);
    const graphBody = `void blenderGraph() {\n  blender_init_globals();\n  ${[...this.lines, ...assignments].join('\n  ')}\n}`;
    const declarations = [
      BLENDER_NODE_GLSL_PRELUDE,
      shakeLibrary(EEVEE_GLOBALS + ordered.map(f => BLENDER_NODE_GLSL[f]!.code).join('\n') + '\n' + COORDINATES,
        [...this.s.functions, graphBody].join('\n')),
      ...[...this.s.uniformTypes].map(([n, t]) => `uniform ${t} ${n};`),
      ...this.images.map(i => `uniform sampler2D ${i.uniform};`),
      ...this.ramps.map(r => `uniform sampler2D ${r.uniform};`),
      ...Object.values(outputs).map(o => `${o.type} ${o.global};`),
      ...this.s.functions,
      graphBody,
    ].join('\n');
    return {
      key: JSON.stringify([this.graph.surface, this.s.structure, [...this.s.uvs].sort()]),
      declarations,
      uniforms: this.uniforms,
      images: this.images,
      ramps: this.ramps,
      uvs: [...this.s.uvs],
      outputs,
      surface: this.graph.surface,
    };
  }
}

/**
 * ONLY THE FUNCTIONS THE GRAPH REACHES, as Blender's codegen links only the
 * functions a material calls. A node's file holds every variant of it (each
 * Noise type and dimension, each Voronoi feature), and a program carrying all
 * of them measured ~155 KB of GLSL for a 30-line graph -- compile time the
 * viewport spent blocked. Everything that is not a plain function definition
 * (macros, which may generate or call functions; structs; constants) is kept,
 * and a function is kept when its name appears in kept text, to a fixpoint.
 * Overloads of a kept name are all kept.
 */
function shakeLibrary(library: string, root: string): string {
  type Chunk = {text: string; name: string | null};
  const chunks: Chunk[] = [];
  const header = /^[A-Za-z_][\w ]*?\b([A-Za-z_]\w*)\s*\(/gm;
  let from = 0;
  for (let m; (m = header.exec(library)); ) {
    if (m.index < from) continue;
    let i = m.index + m[0].length;
    for (let depth = 1; i < library.length && depth > 0; i++) depth += library[i] === '(' ? 1 : library[i] === ')' ? -1 : 0;
    const after = library.slice(i).match(/^\s*(\{|;)/);
    // Only a definition or prototype at top level is a function chunk; a
    // macro invocation line (`NOISE_FBM(float)`) is kept as other text.
    if (!after || /^\s*#/.test(library.slice(library.lastIndexOf('\n', m.index) + 1, m.index + 1))) continue;
    const prev = library.slice(Math.max(0, m.index - 2), m.index);
    if (prev.endsWith('\\\n')) continue;
    let end = i + after[0].length;
    if (after[1] === '{') {
      for (let depth = 1; end < library.length && depth > 0; end++)
        depth += library[end] === '{' ? 1 : library[end] === '}' ? -1 : 0;
    }
    chunks.push({text: library.slice(from, m.index), name: null});
    chunks.push({text: library.slice(m.index, end), name: m[1]!});
    from = end;
    header.lastIndex = end;
  }
  chunks.push({text: library.slice(from), name: null});
  const keep = new Set<Chunk>(chunks.filter(c => c.name === null));
  const referenced = new Set<string>();
  const scan = (text: string) => { for (const w of text.matchAll(/[A-Za-z_]\w*/g)) referenced.add(w[0]); };
  scan(root);
  for (const c of keep) scan(c.text);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of chunks) {
      if (keep.has(c) || c.name === null || !referenced.has(c.name)) continue;
      keep.add(c);
      scan(c.text);
      grew = true;
    }
  }
  return chunks.filter(c => keep.has(c)).map(c => c.text).join('');
}

/** The varying a UV layer arrives in; `''` is the render UV. */
export function uvVarying(name: string): string {
  return name === '' ? 'vBlenderUvRender' : `vBlenderUv_${[...name].map(c => c.charCodeAt(0).toString(16)).join('')}`;
}

export function compileMaterialGraph(graph: MaterialGraph): CompiledGraph {
  return new Compiler(graph).compile();
}

/** A ramp's 257 samples as the texture its uniform reads. */
export function rampTexture(table: readonly (readonly number[])[]): THREE.DataTexture {
  // Half floats: linearly filterable on every WebGL2 device, which 32-bit
  // floats are not (OES_texture_float_linear).
  const data = new Uint16Array(table.length * 4);
  table.forEach((c, i) => data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1].map(v => THREE.DataUtils.toHalfFloat(v)), i * 4));
  const texture = new THREE.DataTexture(data, table.length, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
