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
  'ShaderNodeTexVoronoi', 'ShaderNodeTexChecker',
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
vec3 blender_reflection() {
  // coordinate_reflect: -reflect(world incident, N), incident toward the eye.
  vec3 incident = isOrthographic
    ? normalize(vec3(inverse(viewMatrix)[2]))
    : normalize(cameraPosition - vBlenderWorldPosition);
  return -reflect(incident, normalize(vBlenderWorldNormal));
}
`;

class Compiler {
  private readonly files = new Set<string>();
  private readonly lines: string[] = [];
  private readonly emitted = new Map<string, {name: string; type: GpuType}[]>();
  readonly uniforms = new Map<string, number | readonly number[]>();
  private readonly uniformTypes = new Map<string, GpuType>();
  readonly images: GraphImage[] = [];
  readonly ramps: GraphRamp[] = [];
  readonly uvs = new Set<string>();
  private readonly structure: unknown[] = [];

  constructor(private readonly graph: MaterialGraph) {}

  private uniform(type: GpuType, v: number | readonly number[]): string {
    const name = `bgU${this.uniforms.size}`;
    const values = literal(type, v);
    this.uniforms.set(name, type === 'float' ? values[0]! : values);
    this.uniformTypes.set(name, type);
    return name;
  }

  private use(fn: string): string {
    const file = DEFINED_IN.get(fn);
    if (!file) throw new Error(`Blender's node library has no ${fn}`);
    this.files.add(file);
    return fn;
  }

  /** An input as a GLSL expression of `to`. */
  source(source: Source, to: GpuType): string {
    if ('value' in source) {
      this.structure.push('v');
      return this.uniform(to, source.value);
    }
    const [key, index] = source.link;
    const node = this.graph.nodes[key];
    if (!node) throw new Error(`The graph links to ${key}, which it does not carry`);
    const outputs = this.node(key, node);
    const output = outputs[index];
    if (!output) throw new Error(`${key} has no output ${index}`);
    this.structure.push(['l', key, index]);
    return convert(output.name, output.type, to);
  }

  private input(node: GraphNode, id: string, to?: GpuType): string {
    const input = node.inputs.find(i => i.id === id);
    if (!input) throw new Error(`${node.type} arrived without its '${id}' input`);
    return this.source(input, to ?? input.gpu);
  }

  /** A texture node's Vector: its link, or the coordinate Blender defaults to
   *  (`node_shader_gpu_default_tex_coord`: Generated; UV for an image). */
  private coordinate(node: GraphNode, fallback: 'orco' | 'uv'): string {
    const input = node.inputs[0]!;
    if ('link' in input) return this.source(input, 'vec3');
    this.structure.push(['default', fallback]);
    if (fallback === 'orco') return 'blender_orco()';
    this.uvs.add('');
    return `vec3(${uvVarying('')}, 0.0)`;
  }

  /** Each node's outputs, declared once, as `{name, type}` by socket index. */
  private node(key: string, node: GraphNode): {name: string; type: GpuType}[] {
    const held = this.emitted.get(key);
    if (held) return held;
    const id = `bgN${this.emitted.size}`;
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
    this.structure.push(['n', node.type, node.props['operation'], node.props['blend_type'], node.props['data_type'],
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
        this.uvs.add('');
        const values = ['blender_orco()', 'blender_object_normal()', `vec3(${uvVarying('')}, 0.0)`,
          'vBlenderObjectPosition', 'blender_camera()', 'blender_window()', 'blender_reflection()'];
        values.forEach((v, i) => { if (outputs[i]) body.push(`${outputs[i]!.name} = ${v};`); });
        break;
      }
      case 'ShaderNodeUVMap': {
        const name = prop<string>(node, 'uv_map');
        this.uvs.add(name);
        body.push(`${outputs[0]!.name} = vec3(${uvVarying(name)}, 0.0);`);
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
          const uniform = `bgRamp${this.ramps.length}`;
          this.ramps.push({uniform, table: ramp.table});
          this.structure.push(['ramp', ramp.interpolation === 'CONSTANT']);
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
      case 'ShaderNodeTexImage': {
        const image = prop<{name: string; revision: number} | null>(node, 'image');
        if (image === null) {
          // node_tex_image_empty.
          body.push(`${outs([0])} = vec4(0.0); ${outs([1])} = 0.0;`);
          break;
        }
        const uniform = `bgImage${this.images.length}`;
        this.images.push({
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
         'Emission Color': 'vec4', 'Emission Strength': 'float'} as const;
    const outputs: Record<string, {global: string; type: GpuType}> = {};
    const assignments: string[] = [];
    let index = 0;
    for (const [name, type] of Object.entries(surfaceInputs)) {
      const source = this.graph.inputs[name];
      if (!source) continue;
      const global = `bgOut${index++}`;
      outputs[name] = {global, type};
      this.structure.push(['out', name]);
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
    for (const file of this.files) visit(file);
    const declarations = [
      BLENDER_NODE_GLSL_PRELUDE,
      ...ordered.map(f => BLENDER_NODE_GLSL[f]!.code),
      COORDINATES,
      ...[...this.uniformTypes].map(([n, t]) => `uniform ${t} ${n};`),
      ...this.images.map(i => `uniform sampler2D ${i.uniform};`),
      ...this.ramps.map(r => `uniform sampler2D ${r.uniform};`),
      ...Object.values(outputs).map(o => `${o.type} ${o.global};`),
      `void blenderGraph() {\n  ${[...this.lines, ...assignments].join('\n  ')}\n}`,
    ].join('\n');
    return {
      key: JSON.stringify([this.graph.surface, this.structure, [...this.uvs].sort()]),
      declarations,
      uniforms: this.uniforms,
      images: this.images,
      ramps: this.ramps,
      uvs: [...this.uvs],
      outputs,
      surface: this.graph.surface,
    };
  }
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
