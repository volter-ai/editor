import { registerGodotObjectIdentity } from './object';

export const GODOT_VISUAL_SHADER_TYPE = {
  VERTEX: 0, FRAGMENT: 1, LIGHT: 2, START: 3, PROCESS: 4, COLLIDE: 5, MAX: 6,
  TYPE_VERTEX: 0, TYPE_FRAGMENT: 1, TYPE_LIGHT: 2, TYPE_START: 3, TYPE_PROCESS: 4, TYPE_COLLIDE: 5, TYPE_MAX: 6,
} as const;

export const GODOT_VISUAL_SHADER_MODE = {
  SPATIAL: 0, CANVAS_ITEM: 1, PARTICLES: 2, SKY: 3, FOG: 4, MAX: 5,
  MODE_SPATIAL: 0, MODE_CANVAS_ITEM: 1, MODE_PARTICLES: 2, MODE_SKY: 3, MODE_FOG: 4, MODE_MAX: 5,
} as const;

export interface GodotVisualShaderPosition { readonly x: number; readonly y: number }

export interface GodotVisualShaderNode {
  readonly __godotClass: string;
  output_port_for_preview: number;
  expanded: boolean;
  simple_declaration: boolean;
  readonly defaults: Map<number, unknown>;
}

export interface GodotVisualShaderNodeInput extends GodotVisualShaderNode { input_name: string }
export interface GodotVisualShaderNodeFloatConstant extends GodotVisualShaderNode { constant: number }
export interface GodotVisualShaderNodeIntConstant extends GodotVisualShaderNode { constant: number }
export interface GodotVisualShaderNodeBooleanConstant extends GodotVisualShaderNode { constant: boolean }
export interface GodotVisualShaderNodeColorConstant extends GodotVisualShaderNode { constant: unknown }
export interface GodotVisualShaderNodeVec3Constant extends GodotVisualShaderNode { constant: unknown }
export interface GodotVisualShaderNodeTexture extends GodotVisualShaderNode { texture: unknown | null; texture_type: number; source: number }
export interface GodotVisualShaderNodeFloatOp extends GodotVisualShaderNode { operator: number }
export interface GodotVisualShaderNodeIntOp extends GodotVisualShaderNode { operator: number }
export interface GodotVisualShaderNodeVectorOp extends GodotVisualShaderNode { operator: number }
export interface GodotVisualShaderNodeColorOp extends GodotVisualShaderNode { operator: number }
export interface GodotVisualShaderNodeTransformOp extends GodotVisualShaderNode { operator: number }
export interface GodotVisualShaderNodeCompare extends GodotVisualShaderNode { comparison_type: number; function: number; condition: number }
export interface GodotVisualShaderNodeFloatFunc extends GodotVisualShaderNode { function: number }
export interface GodotVisualShaderNodeIntFunc extends GodotVisualShaderNode { function: number }
export interface GodotVisualShaderNodeVectorFunc extends GodotVisualShaderNode { function: number; op_type: number }
export interface GodotVisualShaderNodeColorFunc extends GodotVisualShaderNode { function: number }
export interface GodotVisualShaderNodeTransformFunc extends GodotVisualShaderNode { function: number }
export interface GodotVisualShaderNodeClamp extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeSmoothStep extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeStep extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeVectorCompose extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeVectorDecompose extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeVectorDistance extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeVectorLen extends GodotVisualShaderNode { op_type: number }
export interface GodotVisualShaderNodeDerivativeFunc extends GodotVisualShaderNode { function: number; op_type: number; precision: number }
export interface GodotVisualShaderNodeParameter extends GodotVisualShaderNode { parameter_name: string; qualifier: number }
export interface GodotVisualShaderNodeTextureParameter extends GodotVisualShaderNodeParameter { texture_type: number; color_default: number; texture_filter: number; texture_repeat: number; texture_source: number }
export interface GodotVisualShaderNodeFloatParameter extends GodotVisualShaderNodeParameter { hint: number; min: number; max: number; step: number; default_value_enabled: boolean; default_value: number }
export interface GodotVisualShaderNodeIntParameter extends GodotVisualShaderNodeParameter { hint: number; min: number; max: number; step: number; default_value_enabled: boolean; default_value: number }
export interface GodotVisualShaderNodeBooleanParameter extends GodotVisualShaderNodeParameter { default_value_enabled: boolean; default_value: boolean }
export interface GodotVisualShaderNodeColorParameter extends GodotVisualShaderNodeParameter { default_value_enabled: boolean; default_value: unknown }
export interface GodotVisualShaderNodeVec3Parameter extends GodotVisualShaderNodeParameter { default_value_enabled: boolean; default_value: unknown }
export interface GodotVisualShaderNodeTransformParameter extends GodotVisualShaderNodeParameter { default_value_enabled: boolean; default_value: unknown }
export interface GodotVisualShaderNodeExpression extends GodotVisualShaderNode { expression: string; input_ports: Array<{ id: number; type: number; name: string }>; output_ports: Array<{ id: number; type: number; name: string }> }
export interface GodotVisualShaderNodeParticleEmitter extends GodotVisualShaderNode { mode_2d: boolean }
export interface GodotVisualShaderNodeParticleMultiplyByAxisAngle extends GodotVisualShaderNode { degrees_mode: boolean }
export interface GodotVisualShaderNodeCubemap extends GodotVisualShaderNode { cube_map: unknown | null; texture_type: number; source: number }

export interface GodotVisualShaderConnection {
  readonly fromNode: number;
  readonly fromPort: number;
  readonly toNode: number;
  readonly toPort: number;
}

export interface GodotVisualShaderGraphSnapshot {
  readonly mode: number;
  readonly flags: ReadonlyMap<string, boolean>;
  readonly graphs: ReadonlyMap<number, {
    readonly nodes: ReadonlyMap<number, GodotVisualShaderNode>;
    readonly positions: ReadonlyMap<number, GodotVisualShaderPosition>;
    readonly connections: readonly GodotVisualShaderConnection[];
  }>;
}

export interface GodotVisualShaderBinding { compile(snapshot: GodotVisualShaderGraphSnapshot): void }

interface Graph {
  nodes: Map<number, GodotVisualShaderNode>;
  positions: Map<number, GodotVisualShaderPosition>;
  connections: GodotVisualShaderConnection[];
}

export interface GodotVisualShader {
  readonly __godotClass: 'VisualShader';
  mode: number;
}

interface ShaderState {
  mode: number;
  flags: Map<string, boolean>;
  graphs: Map<number, Graph>;
  binding: GodotVisualShaderBinding | null;
  listeners: Set<(snapshot: GodotVisualShaderGraphSnapshot) => void>;
}

const SHADERS = new WeakMap<GodotVisualShader, ShaderState>();

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new RangeError(`godot-compat: VisualShader.${member} requires an integer in [${minimum}, ${maximum}].`);
  return value as number;
}
function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`godot-compat: ${member} requires a finite number.`); return value;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`); return value;
}
function position(value: unknown): GodotVisualShaderPosition {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError('godot-compat: VisualShader node position requires Vector2.');
  return Object.freeze({ x: finite(value.x, 'VisualShader.position.x'), y: finite(value.y, 'VisualShader.position.y') });
}
function shaderState(shader: GodotVisualShader): ShaderState {
  const state = SHADERS.get(shader); if (state === undefined) throw new TypeError('godot-compat: VisualShader member requires VisualShader Resource.'); return state;
}
function graphOf(shader: GodotVisualShader, type: unknown): Graph {
  const index = integer(type, 'type', 0, 5); const state = shaderState(shader);
  let graph = state.graphs.get(index); if (graph === undefined) { graph = { nodes: new Map(), positions: new Map(), connections: [] }; state.graphs.set(index, graph); }
  return graph;
}
function nodeOf(shader: GodotVisualShader, type: unknown, id: unknown): GodotVisualShaderNode {
  const node = graphOf(shader, type).nodes.get(integer(id, 'node_id', 0, 0x7fff_ffff));
  if (node === undefined) throw new RangeError(`godot-compat: VisualShader node ${String(id)} does not exist.`); return node;
}

function snapshot(state: ShaderState): GodotVisualShaderGraphSnapshot {
  return Object.freeze({ mode: state.mode, flags: new Map(state.flags), graphs: new Map([...state.graphs].map(([type, graph]) => [type, Object.freeze({ nodes: new Map(graph.nodes), positions: new Map(graph.positions), connections: Object.freeze(graph.connections.map((connection) => Object.freeze({ ...connection }))) })])) });
}
function publish(shader: GodotVisualShader): void {
  const state = shaderState(shader), value = snapshot(state); state.binding?.compile(value); for (const listener of state.listeners) listener(value);
}

function node(className: string): GodotVisualShaderNode {
  const value: GodotVisualShaderNode = { __godotClass: className, output_port_for_preview: -1, expanded: false, simple_declaration: false, defaults: new Map() };
  registerGodotObjectIdentity(value, className); return value;
}

export function createGodotVisualShader(): GodotVisualShader {
  const shader = { __godotClass: 'VisualShader' as const, get mode() { return shaderState(shader).mode; }, set mode(value: number) { shaderState(shader).mode = integer(value, 'mode', 0, 4); publish(shader); } };
  SHADERS.set(shader, { mode: 0, flags: new Map(), graphs: new Map(), binding: null, listeners: new Set() });
  registerGodotObjectIdentity(shader, 'VisualShader'); return shader;
}
export function createGodotVisualShaderNodeInput(): GodotVisualShaderNodeInput { return Object.assign(node('VisualShaderNodeInput'), { input_name: '[None]' }); }
export function createGodotVisualShaderNodeOutput(): GodotVisualShaderNode { return node('VisualShaderNodeOutput'); }
export function createGodotVisualShaderNodeFloatConstant(): GodotVisualShaderNodeFloatConstant { return Object.assign(node('VisualShaderNodeFloatConstant'), { constant: 0 }); }
export function createGodotVisualShaderNodeIntConstant(): GodotVisualShaderNodeIntConstant { return Object.assign(node('VisualShaderNodeIntConstant'), { constant: 0 }); }
export function createGodotVisualShaderNodeBooleanConstant(): GodotVisualShaderNodeBooleanConstant { return Object.assign(node('VisualShaderNodeBooleanConstant'), { constant: false }); }
export function createGodotVisualShaderNodeColorConstant(): GodotVisualShaderNodeColorConstant { return Object.assign(node('VisualShaderNodeColorConstant'), { constant: { r: 1, g: 1, b: 1, a: 1 } }); }
export function createGodotVisualShaderNodeVec3Constant(): GodotVisualShaderNodeVec3Constant { return Object.assign(node('VisualShaderNodeVec3Constant'), { constant: { x: 0, y: 0, z: 0 } }); }
export function createGodotVisualShaderNodeTexture(): GodotVisualShaderNodeTexture { return Object.assign(node('VisualShaderNodeTexture'), { texture: null, texture_type: 0, source: 0 }); }

function enumNode<T extends GodotVisualShaderNode>(className: string, fields: Record<string, unknown>): T {
  return Object.assign(node(className), fields) as T;
}

function parameterNode<T extends GodotVisualShaderNodeParameter>(className: string, fields: Record<string, unknown>): T {
  return enumNode<T>(className, { parameter_name: '', qualifier: 0, ...fields });
}

export function createGodotVisualShaderNodeFloatOp(): GodotVisualShaderNodeFloatOp { return enumNode('VisualShaderNodeFloatOp', { operator: 0 }); }
export function createGodotVisualShaderNodeIntOp(): GodotVisualShaderNodeIntOp { return enumNode('VisualShaderNodeIntOp', { operator: 0 }); }
export function createGodotVisualShaderNodeVectorOp(): GodotVisualShaderNodeVectorOp { return enumNode('VisualShaderNodeVectorOp', { operator: 0 }); }
export function createGodotVisualShaderNodeColorOp(): GodotVisualShaderNodeColorOp { return enumNode('VisualShaderNodeColorOp', { operator: 0 }); }
export function createGodotVisualShaderNodeTransformOp(): GodotVisualShaderNodeTransformOp { return enumNode('VisualShaderNodeTransformOp', { operator: 0 }); }
export function createGodotVisualShaderNodeCompare(): GodotVisualShaderNodeCompare { return enumNode('VisualShaderNodeCompare', { comparison_type: 0, function: 0, condition: 0 }); }
export function createGodotVisualShaderNodeFloatFunc(): GodotVisualShaderNodeFloatFunc { return enumNode('VisualShaderNodeFloatFunc', { function: 0 }); }
export function createGodotVisualShaderNodeIntFunc(): GodotVisualShaderNodeIntFunc { return enumNode('VisualShaderNodeIntFunc', { function: 0 }); }
export function createGodotVisualShaderNodeVectorFunc(): GodotVisualShaderNodeVectorFunc { return enumNode('VisualShaderNodeVectorFunc', { function: 0, op_type: 0 }); }
export function createGodotVisualShaderNodeColorFunc(): GodotVisualShaderNodeColorFunc { return enumNode('VisualShaderNodeColorFunc', { function: 0 }); }
export function createGodotVisualShaderNodeTransformFunc(): GodotVisualShaderNodeTransformFunc { return enumNode('VisualShaderNodeTransformFunc', { function: 0 }); }
export function createGodotVisualShaderNodeClamp(): GodotVisualShaderNodeClamp { return enumNode('VisualShaderNodeClamp', { op_type: 0 }); }
export function createGodotVisualShaderNodeSmoothStep(): GodotVisualShaderNodeSmoothStep { return enumNode('VisualShaderNodeSmoothStep', { op_type: 0 }); }
export function createGodotVisualShaderNodeStep(): GodotVisualShaderNodeStep { return enumNode('VisualShaderNodeStep', { op_type: 0 }); }
export function createGodotVisualShaderNodeVectorCompose(): GodotVisualShaderNodeVectorCompose { return enumNode('VisualShaderNodeVectorCompose', { op_type: 0 }); }
export function createGodotVisualShaderNodeVectorDecompose(): GodotVisualShaderNodeVectorDecompose { return enumNode('VisualShaderNodeVectorDecompose', { op_type: 0 }); }
export function createGodotVisualShaderNodeVectorDistance(): GodotVisualShaderNodeVectorDistance { return enumNode('VisualShaderNodeVectorDistance', { op_type: 0 }); }
export function createGodotVisualShaderNodeVectorLen(): GodotVisualShaderNodeVectorLen { return enumNode('VisualShaderNodeVectorLen', { op_type: 0 }); }
export function createGodotVisualShaderNodeDotProduct(): GodotVisualShaderNode { return node('VisualShaderNodeDotProduct'); }
export function createGodotVisualShaderNodeVectorRefract(): GodotVisualShaderNode { return node('VisualShaderNodeVectorRefract'); }
export function createGodotVisualShaderNodeFresnel(): GodotVisualShaderNode { return node('VisualShaderNodeFresnel'); }
export function createGodotVisualShaderNodeDerivativeFunc(): GodotVisualShaderNodeDerivativeFunc { return enumNode('VisualShaderNodeDerivativeFunc', { function: 0, op_type: 0, precision: 0 }); }
export function createGodotVisualShaderNodeTextureParameter(): GodotVisualShaderNodeTextureParameter { return parameterNode<GodotVisualShaderNodeTextureParameter>('VisualShaderNodeTextureParameter', { texture_type: 0, color_default: 0, texture_filter: 0, texture_repeat: 0, texture_source: 0 }); }
export function createGodotVisualShaderNodeFloatParameter(): GodotVisualShaderNodeFloatParameter { return parameterNode('VisualShaderNodeFloatParameter', { hint: 0, min: 0, max: 1, step: 0.1, default_value_enabled: false, default_value: 0 }); }
export function createGodotVisualShaderNodeIntParameter(): GodotVisualShaderNodeIntParameter { return parameterNode('VisualShaderNodeIntParameter', { hint: 0, min: 0, max: 100, step: 1, default_value_enabled: false, default_value: 0 }); }
export function createGodotVisualShaderNodeBooleanParameter(): GodotVisualShaderNodeBooleanParameter { return parameterNode('VisualShaderNodeBooleanParameter', { default_value_enabled: false, default_value: false }); }
export function createGodotVisualShaderNodeColorParameter(): GodotVisualShaderNodeColorParameter { return parameterNode('VisualShaderNodeColorParameter', { default_value_enabled: false, default_value: { r: 1, g: 1, b: 1, a: 1 } }); }
export function createGodotVisualShaderNodeVec3Parameter(): GodotVisualShaderNodeVec3Parameter { return parameterNode('VisualShaderNodeVec3Parameter', { default_value_enabled: false, default_value: { x: 0, y: 0, z: 0 } }); }
export function createGodotVisualShaderNodeTransformParameter(): GodotVisualShaderNodeTransformParameter { return parameterNode('VisualShaderNodeTransformParameter', { default_value_enabled: false, default_value: null }); }
export function createGodotVisualShaderNodeExpression(): GodotVisualShaderNodeExpression { return enumNode('VisualShaderNodeExpression', { expression: '', input_ports: [], output_ports: [] }); }
export function createGodotVisualShaderNodeGlobalExpression(): GodotVisualShaderNodeExpression { return enumNode('VisualShaderNodeGlobalExpression', { expression: '', input_ports: [], output_ports: [] }); }
export function createGodotVisualShaderNodeParticleEmitter(): GodotVisualShaderNodeParticleEmitter { return enumNode('VisualShaderNodeParticleEmitter', { mode_2d: false }); }
export function createGodotVisualShaderNodeParticleMultiplyByAxisAngle(): GodotVisualShaderNodeParticleMultiplyByAxisAngle { return enumNode('VisualShaderNodeParticleMultiplyByAxisAngle', { degrees_mode: false }); }
export function createGodotVisualShaderNodeCubemap(): GodotVisualShaderNodeCubemap { return enumNode('VisualShaderNodeCubemap', { cube_map: null, texture_type: 0, source: 0 }); }
export function createGodotVisualShaderNodeBillboard(): GodotVisualShaderNode { return enumNode('VisualShaderNodeBillboard', { billboard_type: 0, keep_scale_enabled: false }); }
export function createGodotVisualShaderNodeComment(): GodotVisualShaderNode { return enumNode('VisualShaderNodeComment', { title: '', description: '' }); }
export function createGodotVisualShaderNodeDeterminant(): GodotVisualShaderNode { return node('VisualShaderNodeDeterminant'); }
export function createGodotVisualShaderNodeDistanceFade(): GodotVisualShaderNode { return node('VisualShaderNodeDistanceFade'); }
export function createGodotVisualShaderNodeFaceForward(): GodotVisualShaderNode { return node('VisualShaderNodeFaceForward'); }
export function createGodotVisualShaderNodeFrame(): GodotVisualShaderNode { return enumNode('VisualShaderNodeFrame', { title: '', tint_color_enabled: false, tint_color: { r: 0.3, g: 0.3, b: 0.3, a: 0.2 } }); }
export function createGodotVisualShaderNodeIf(): GodotVisualShaderNode { return enumNode('VisualShaderNodeIf', { op_type: 0 }); }
export function createGodotVisualShaderNodeIs(): GodotVisualShaderNode { return enumNode('VisualShaderNodeIs', { function: 0 }); }
export function createGodotVisualShaderNodeLinearSceneDepth(): GodotVisualShaderNode { return node('VisualShaderNodeLinearSceneDepth'); }
export function createGodotVisualShaderNodeMix(): GodotVisualShaderNode { return enumNode('VisualShaderNodeMix', { op_type: 0 }); }
export function createGodotVisualShaderNodeMultiplyAdd(): GodotVisualShaderNode { return enumNode('VisualShaderNodeMultiplyAdd', { op_type: 0 }); }
export function createGodotVisualShaderNodeOuterProduct(): GodotVisualShaderNode { return node('VisualShaderNodeOuterProduct'); }
export function createGodotVisualShaderNodeParameterRef(): GodotVisualShaderNode { return enumNode('VisualShaderNodeParameterRef', { parameter_name: '' }); }
export function createGodotVisualShaderNodeProximityFade(): GodotVisualShaderNode { return node('VisualShaderNodeProximityFade'); }
export function createGodotVisualShaderNodeRandomRange(): GodotVisualShaderNode { return enumNode('VisualShaderNodeRandomRange', { op_type: 0 }); }
export function createGodotVisualShaderNodeRemap(): GodotVisualShaderNode { return enumNode('VisualShaderNodeRemap', { op_type: 0 }); }
export function createGodotVisualShaderNodeReroute(): GodotVisualShaderNode { return enumNode('VisualShaderNodeReroute', { port_type: 0 }); }
export function createGodotVisualShaderNodeRotationByAxis(): GodotVisualShaderNode { return enumNode('VisualShaderNodeRotationByAxis', { op_type: 0 }); }
export function createGodotVisualShaderNodeSdfRaymarch(): GodotVisualShaderNode { return node('VisualShaderNodeSDFRaymarch'); }
export function createGodotVisualShaderNodeSdfToScreenUv(): GodotVisualShaderNode { return node('VisualShaderNodeSDFToScreenUV'); }
export function createGodotVisualShaderNodeScreenNormalWorldSpace(): GodotVisualShaderNode { return node('VisualShaderNodeScreenNormalWorldSpace'); }
export function createGodotVisualShaderNodeScreenUvToSdf(): GodotVisualShaderNode { return node('VisualShaderNodeScreenUVToSDF'); }
export function createGodotVisualShaderNodeSwitch(): GodotVisualShaderNode { return enumNode('VisualShaderNodeSwitch', { op_type: 0 }); }
export function createGodotVisualShaderNodeTextureSdf(): GodotVisualShaderNode { return node('VisualShaderNodeTextureSDF'); }
export function createGodotVisualShaderNodeTextureSdfNormal(): GodotVisualShaderNode { return node('VisualShaderNodeTextureSDFNormal'); }
export function createGodotVisualShaderNodeTransformCompose(): GodotVisualShaderNode { return node('VisualShaderNodeTransformCompose'); }
export function createGodotVisualShaderNodeTransformConstant(): GodotVisualShaderNode { return enumNode('VisualShaderNodeTransformConstant', { constant: null }); }
export function createGodotVisualShaderNodeTransformDecompose(): GodotVisualShaderNode { return node('VisualShaderNodeTransformDecompose'); }
export function createGodotVisualShaderNodeTransformVecMult(): GodotVisualShaderNode { return enumNode('VisualShaderNodeTransformVecMult', { operator: 0 }); }
export function createGodotVisualShaderNodeUIntConstant(): GodotVisualShaderNode { return enumNode('VisualShaderNodeUIntConstant', { constant: 0 }); }
export function createGodotVisualShaderNodeUIntFunc(): GodotVisualShaderNode { return enumNode('VisualShaderNodeUIntFunc', { function: 0 }); }
export function createGodotVisualShaderNodeUIntOp(): GodotVisualShaderNode { return enumNode('VisualShaderNodeUIntOp', { operator: 0 }); }
export function createGodotVisualShaderNodeUIntParameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeUIntParameter', { default_value_enabled: false, default_value: 0 }); }
export function createGodotVisualShaderNodeUvFunc(): GodotVisualShaderNode { return enumNode('VisualShaderNodeUVFunc', { function: 0 }); }
export function createGodotVisualShaderNodeUvPolarCoord(): GodotVisualShaderNode { return node('VisualShaderNodeUVPolarCoord'); }
export function createGodotVisualShaderNodeVarying(): GodotVisualShaderNode { return enumNode('VisualShaderNodeVarying', { varying_name: '', varying_type: 0, varying_mode: 0 }); }
export function createGodotVisualShaderNodeVaryingGetter(): GodotVisualShaderNode { return enumNode('VisualShaderNodeVaryingGetter', { varying_name: '' }); }
export function createGodotVisualShaderNodeVaryingSetter(): GodotVisualShaderNode { return enumNode('VisualShaderNodeVaryingSetter', { varying_name: '' }); }
export function createGodotVisualShaderNodeVec2Constant(): GodotVisualShaderNode { return enumNode('VisualShaderNodeVec2Constant', { constant: { x: 0, y: 0 } }); }
export function createGodotVisualShaderNodeVec4Constant(): GodotVisualShaderNode { return enumNode('VisualShaderNodeVec4Constant', { constant: { x: 0, y: 0, z: 0, w: 0 } }); }
export function createGodotVisualShaderNodeVec2Parameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeVec2Parameter', { default_value_enabled: false, default_value: { x: 0, y: 0 } }); }
export function createGodotVisualShaderNodeVec4Parameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeVec4Parameter', { default_value_enabled: false, default_value: { x: 0, y: 0, z: 0, w: 0 } }); }
export function createGodotVisualShaderNodeWorldPositionFromDepth(): GodotVisualShaderNode { return node('VisualShaderNodeWorldPositionFromDepth'); }
export function createGodotVisualShaderNodeTexture2DArray(): GodotVisualShaderNode { return enumNode('VisualShaderNodeTexture2DArray', { texture: null, texture_type: 0, source: 0 }); }
export function createGodotVisualShaderNodeTexture3D(): GodotVisualShaderNode { return enumNode('VisualShaderNodeTexture3D', { texture: null, texture_type: 0, source: 0 }); }
export function createGodotVisualShaderNodeTexture2DParameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeTexture2DParameter', { texture_type: 0, color_default: 0, texture_filter: 0, texture_repeat: 0, texture_source: 0 }); }
export function createGodotVisualShaderNodeTexture2DArrayParameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeTexture2DArrayParameter', { texture_type: 0, color_default: 0, texture_filter: 0, texture_repeat: 0, texture_source: 0 }); }
export function createGodotVisualShaderNodeTexture3DParameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeTexture3DParameter', { texture_type: 0, color_default: 0, texture_filter: 0, texture_repeat: 0, texture_source: 0 }); }
export function createGodotVisualShaderNodeCubemapParameter(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeCubemapParameter', { texture_type: 0, color_default: 0, texture_filter: 0, texture_repeat: 0, texture_source: 0 }); }
export function createGodotVisualShaderNodeTextureParameterTriplanar(): GodotVisualShaderNode { return parameterNode('VisualShaderNodeTextureParameterTriplanar', { texture_type: 0, color_default: 0, texture_filter: 0, texture_repeat: 0, texture_source: 0 }); }
export function createGodotVisualShaderNodeParticleAccelerator(): GodotVisualShaderNode { return enumNode('VisualShaderNodeParticleAccelerator', { mode: 0 }); }
export function createGodotVisualShaderNodeParticleBoxEmitter(): GodotVisualShaderNode { return node('VisualShaderNodeParticleBoxEmitter'); }
export function createGodotVisualShaderNodeParticleConeVelocity(): GodotVisualShaderNode { return node('VisualShaderNodeParticleConeVelocity'); }
export function createGodotVisualShaderNodeParticleEmit(): GodotVisualShaderNode { return enumNode('VisualShaderNodeParticleEmit', { flags: 0 }); }
export function createGodotVisualShaderNodeParticleMeshEmitter(): GodotVisualShaderNode { return node('VisualShaderNodeParticleMeshEmitter'); }
export function createGodotVisualShaderNodeParticleOutput(): GodotVisualShaderNode { return enumNode('VisualShaderNodeParticleOutput', { output_type: 0 }); }
export function createGodotVisualShaderNodeParticleRandomness(): GodotVisualShaderNode { return enumNode('VisualShaderNodeParticleRandomness', { op_type: 0 }); }
export function createGodotVisualShaderNodeParticleRingEmitter(): GodotVisualShaderNode { return node('VisualShaderNodeParticleRingEmitter'); }
export function createGodotVisualShaderNodeParticleSphereEmitter(): GodotVisualShaderNode { return node('VisualShaderNodeParticleSphereEmitter'); }
export interface GodotVisualShaderGroupPort { id: number; type: number; name: string }
export interface GodotVisualShaderNodeGroupBase extends GodotVisualShaderNode {
  inputs: GodotVisualShaderGroupPort[];
  outputs: GodotVisualShaderGroupPort[];
  size: { x: number; y: number };
}
export function createGodotVisualShaderNodeGroupBase(): GodotVisualShaderNodeGroupBase { return enumNode('VisualShaderNodeGroupBase', { inputs: [], outputs: [], size: { x: 0, y: 0 } }); }
export function createGodotVisualShaderNodeCustom(): GodotVisualShaderNodeGroupBase { return enumNode('VisualShaderNodeCustom', { inputs: [], outputs: [], size: { x: 0, y: 0 } }); }
export function createGodotVisualShaderNodeResizableBase(): GodotVisualShaderNode { return enumNode('VisualShaderNodeResizableBase', { size: { x: 0, y: 0 } }); }
export function createGodotVisualShaderNodeCurveTexture(): GodotVisualShaderNode { return enumNode('VisualShaderNodeCurveTexture', { texture: null }); }
export function createGodotVisualShaderNodeCurveXyzTexture(): GodotVisualShaderNode { return enumNode('VisualShaderNodeCurveXYZTexture', { texture: null }); }
export function createGodotVisualShaderNodeSample3D(): GodotVisualShaderNode { return enumNode('VisualShaderNodeSample3D', { source: 0 }); }

function groupNode(value: GodotVisualShaderNode): GodotVisualShaderNodeGroupBase {
  if (value?.__godotClass !== 'VisualShaderNodeGroupBase' && value?.__godotClass !== 'VisualShaderNodeCustom') throw new TypeError('godot-compat: VisualShaderNodeGroupBase member requires group node.');
  return value as GodotVisualShaderNodeGroupBase;
}
function groupPort(id: unknown, type: unknown, name: unknown, member: string): GodotVisualShaderGroupPort {
  const portName = String(name);
  if (!isGodotVisualShaderGroupPortNameValid(portName)) throw new RangeError(`godot-compat: ${member} invalid port name ${portName}.`);
  return { id: integer(id, `${member}.id`, 0, 1024), type: integer(type, `${member}.type`, 0, 16), name: portName };
}
function ports(nodeValue: GodotVisualShaderNodeGroupBase, output: boolean): GodotVisualShaderGroupPort[] { return output ? nodeValue.outputs : nodeValue.inputs; }
function portOf(nodeValue: GodotVisualShaderNodeGroupBase, output: boolean, id: unknown, member: string): GodotVisualShaderGroupPort {
  const port = ports(nodeValue, output).find((one) => one.id === integer(id, `${member}.id`, 0, 1024));
  if (port === undefined) throw new RangeError(`godot-compat: ${member} port does not exist.`);
  return port;
}
export function isGodotVisualShaderGroupPortNameValid(name: unknown): boolean { return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name); }
export function addGodotVisualShaderGroupPort(value: GodotVisualShaderNode, output: boolean, id: unknown, type: unknown, name: unknown): void {
  const group = groupNode(value), list = ports(group, output), port = groupPort(id, type, name, `VisualShaderNodeGroupBase.add_${output ? 'output' : 'input'}_port`);
  if (list.some((one) => one.id === port.id || one.name === port.name)) throw new Error('godot-compat: VisualShaderNodeGroupBase port id and name must be unique.');
  list.push(port); list.sort((a, b) => a.id - b.id);
}
export function removeGodotVisualShaderGroupPort(value: GodotVisualShaderNode, output: boolean, id: unknown): void {
  const group = groupNode(value), list = ports(group, output), portId = integer(id, 'VisualShaderNodeGroupBase.remove_port.id', 0, 1024), index = list.findIndex((one) => one.id === portId);
  if (index < 0) throw new RangeError('godot-compat: VisualShaderNodeGroupBase port does not exist.'); list.splice(index, 1);
}
export function clearGodotVisualShaderGroupPorts(value: GodotVisualShaderNode, output: boolean): void { ports(groupNode(value), output).length = 0; }
export function getGodotVisualShaderGroupPortCount(value: GodotVisualShaderNode, output: boolean): number { return ports(groupNode(value), output).length; }
export function hasGodotVisualShaderGroupPort(value: GodotVisualShaderNode, output: boolean, id: unknown): boolean { const portId = integer(id, 'VisualShaderNodeGroupBase.has_port.id', 0, 1024); return ports(groupNode(value), output).some((one) => one.id === portId); }
export function setGodotVisualShaderGroupPortName(value: GodotVisualShaderNode, output: boolean, id: unknown, name: unknown): void {
  const group = groupNode(value), port = portOf(group, output, id, 'VisualShaderNodeGroupBase.set_port_name'), portName = String(name);
  if (!isGodotVisualShaderGroupPortNameValid(portName) || ports(group, output).some((one) => one !== port && one.name === portName)) throw new RangeError('godot-compat: VisualShaderNodeGroupBase port name must be valid and unique.'); port.name = portName;
}
export function setGodotVisualShaderGroupPortType(value: GodotVisualShaderNode, output: boolean, id: unknown, type: unknown): void { portOf(groupNode(value), output, id, 'VisualShaderNodeGroupBase.set_port_type').type = integer(type, 'VisualShaderNodeGroupBase.port_type', 0, 16); }
export function getGodotVisualShaderGroupFreePortId(value: GodotVisualShaderNode, output: boolean): number { const used = new Set(ports(groupNode(value), output).map((one) => one.id)); let id = 0; while (used.has(id)) id += 1; return id; }
export function serializeGodotVisualShaderGroupPorts(value: GodotVisualShaderNode, output: boolean): string { return ports(groupNode(value), output).map((port) => `${port.id},${port.type},${port.name};`).join(''); }
export function parseGodotVisualShaderGroupPorts(value: GodotVisualShaderNode, output: boolean, serialized: unknown): void {
  if (typeof serialized !== 'string') throw new TypeError('godot-compat: VisualShaderNodeGroupBase ports require String.');
  const parsed = serialized.split(';').filter(Boolean).map((record) => { const [id, type, ...name] = record.split(','); return groupPort(Number(id), Number(type), name.join(','), 'VisualShaderNodeGroupBase.ports'); });
  const list = ports(groupNode(value), output); list.length = 0; for (const port of parsed) { if (list.some((one) => one.id === port.id || one.name === port.name)) throw new Error('godot-compat: VisualShaderNodeGroupBase parsed ports must be unique.'); list.push(port); }
}

function expressionNode(value: GodotVisualShaderNodeExpression): GodotVisualShaderNodeExpression {
  if (value?.__godotClass !== 'VisualShaderNodeExpression' && value?.__godotClass !== 'VisualShaderNodeGlobalExpression') throw new TypeError('godot-compat: expression port operation requires VisualShaderNodeExpression.');
  return value;
}
function expressionPort(value: unknown, member: string): { id: number; type: number; name: string } {
  if (typeof value !== 'object' || value === null) throw new TypeError(`godot-compat: ${member} requires a port descriptor.`);
  const candidate = value as { id?: unknown; type?: unknown; name?: unknown };
  return { id: integer(candidate.id, `${member}.id`, 0, 1024), type: integer(candidate.type, `${member}.type`, 0, 16), name: String(candidate.name ?? '') };
}
export function addGodotVisualShaderExpressionInputPort(value: GodotVisualShaderNodeExpression, id: unknown, type: unknown, name: unknown): void { expressionNode(value).input_ports.push(expressionPort({ id, type, name }, 'VisualShaderNodeExpression.add_input_port')); }
export function addGodotVisualShaderExpressionOutputPort(value: GodotVisualShaderNodeExpression, id: unknown, type: unknown, name: unknown): void { expressionNode(value).output_ports.push(expressionPort({ id, type, name }, 'VisualShaderNodeExpression.add_output_port')); }
export function removeGodotVisualShaderExpressionInputPort(value: GodotVisualShaderNodeExpression, id: unknown): void { const nodeValue = expressionNode(value), portId = integer(id, 'VisualShaderNodeExpression.remove_input_port', 0, 1024); nodeValue.input_ports = nodeValue.input_ports.filter((port) => port.id !== portId); }
export function removeGodotVisualShaderExpressionOutputPort(value: GodotVisualShaderNodeExpression, id: unknown): void { const nodeValue = expressionNode(value), portId = integer(id, 'VisualShaderNodeExpression.remove_output_port', 0, 1024); nodeValue.output_ports = nodeValue.output_ports.filter((port) => port.id !== portId); }
export function getGodotVisualShaderExpressionInputPortCount(value: GodotVisualShaderNodeExpression): number { return expressionNode(value).input_ports.length; }
export function getGodotVisualShaderExpressionOutputPortCount(value: GodotVisualShaderNodeExpression): number { return expressionNode(value).output_ports.length; }

export function addGodotVisualShaderNode(shader: GodotVisualShader, type: unknown, value: GodotVisualShaderNode, positionValue: unknown, id: unknown): void {
  if (typeof value !== 'object' || value === null || !('__godotClass' in value)) throw new TypeError('godot-compat: VisualShader.add_node requires VisualShaderNode.');
  const graph = graphOf(shader, type), nodeId = integer(id, 'node_id', 0, 0x7fff_ffff);
  if (graph.nodes.has(nodeId)) throw new Error(`godot-compat: VisualShader node ${nodeId} already exists.`);
  graph.nodes.set(nodeId, value); graph.positions.set(nodeId, position(positionValue)); publish(shader);
}
export function removeGodotVisualShaderNode(shader: GodotVisualShader, type: unknown, id: unknown): void {
  const graph = graphOf(shader, type), nodeId = integer(id, 'node_id', 0, 0x7fff_ffff);
  if (!graph.nodes.delete(nodeId)) throw new RangeError(`godot-compat: VisualShader node ${nodeId} does not exist.`);
  graph.positions.delete(nodeId); graph.connections = graph.connections.filter((connection) => connection.fromNode !== nodeId && connection.toNode !== nodeId); publish(shader);
}
export function getGodotVisualShaderNode(shader: GodotVisualShader, type: unknown, id: unknown): GodotVisualShaderNode { return nodeOf(shader, type, id); }
export function getGodotVisualShaderNodeList(shader: GodotVisualShader, type: unknown): number[] { return [...graphOf(shader, type).nodes.keys()]; }
export function setGodotVisualShaderNodePosition(shader: GodotVisualShader, type: unknown, id: unknown, value: unknown): void { nodeOf(shader, type, id); graphOf(shader, type).positions.set(id as number, position(value)); publish(shader); }
export function getGodotVisualShaderNodePosition(shader: GodotVisualShader, type: unknown, id: unknown): GodotVisualShaderPosition { nodeOf(shader, type, id); return { ...graphOf(shader, type).positions.get(id as number)! }; }

function connection(fromNode: unknown, fromPort: unknown, toNode: unknown, toPort: unknown): GodotVisualShaderConnection {
  return Object.freeze({ fromNode: integer(fromNode, 'from_node', 0, 0x7fff_ffff), fromPort: integer(fromPort, 'from_port', 0, 1024), toNode: integer(toNode, 'to_node', 0, 0x7fff_ffff), toPort: integer(toPort, 'to_port', 0, 1024) });
}
export function connectGodotVisualShaderNodes(shader: GodotVisualShader, type: unknown, fromNode: unknown, fromPort: unknown, toNode: unknown, toPort: unknown): void {
  const graph = graphOf(shader, type), next = connection(fromNode, fromPort, toNode, toPort); nodeOf(shader, type, next.fromNode); nodeOf(shader, type, next.toNode);
  if (graph.connections.some((one) => one.toNode === next.toNode && one.toPort === next.toPort)) throw new Error('godot-compat: VisualShader input port already has a connection.');
  graph.connections.push(next); publish(shader);
}
export function disconnectGodotVisualShaderNodes(shader: GodotVisualShader, type: unknown, fromNode: unknown, fromPort: unknown, toNode: unknown, toPort: unknown): void {
  const graph = graphOf(shader, type), target = connection(fromNode, fromPort, toNode, toPort), before = graph.connections.length;
  graph.connections = graph.connections.filter((one) => one.fromNode !== target.fromNode || one.fromPort !== target.fromPort || one.toNode !== target.toNode || one.toPort !== target.toPort);
  if (before === graph.connections.length) throw new RangeError('godot-compat: VisualShader connection does not exist.'); publish(shader);
}
export function isGodotVisualShaderNodeConnection(shader: GodotVisualShader, type: unknown, fromNode: unknown, fromPort: unknown, toNode: unknown, toPort: unknown): boolean {
  const target = connection(fromNode, fromPort, toNode, toPort); return graphOf(shader, type).connections.some((one) => one.fromNode === target.fromNode && one.fromPort === target.fromPort && one.toNode === target.toNode && one.toPort === target.toPort);
}
export function getGodotVisualShaderNodeConnections(shader: GodotVisualShader, type: unknown): GodotVisualShaderConnection[] { return graphOf(shader, type).connections.map((one) => ({ ...one })); }
export function setGodotVisualShaderMode(shader: GodotVisualShader, value: unknown): void { shader.mode = integer(value, 'mode', 0, 4); }
export function getGodotVisualShaderMode(shader: GodotVisualShader): number { return shader.mode; }
export function setGodotVisualShaderFlag(shader: GodotVisualShader, name: unknown, enabled: unknown): void { if (typeof name !== 'string') throw new TypeError('VisualShader flag requires String.'); shaderState(shader).flags.set(name, bool(enabled, 'VisualShader.flag')); publish(shader); }
export function getGodotVisualShaderFlag(shader: GodotVisualShader, name: unknown): boolean { if (typeof name !== 'string') throw new TypeError('VisualShader flag requires String.'); return shaderState(shader).flags.get(name) ?? false; }
export function bindGodotVisualShader(shader: GodotVisualShader, binding: GodotVisualShaderBinding | null): () => void { const state = shaderState(shader); state.binding = binding; if (binding !== null) binding.compile(snapshot(state)); return () => { if (state.binding === binding) state.binding = null; }; }
export function watchGodotVisualShader(shader: GodotVisualShader, listener: (snapshot: GodotVisualShaderGraphSnapshot) => void): () => void { const state = shaderState(shader); state.listeners.add(listener); listener(snapshot(state)); return () => state.listeners.delete(listener); }
export function setGodotVisualShaderNodeDefaultInput(nodeValue: GodotVisualShaderNode, port: unknown, value: unknown): void { nodeValue.defaults.set(integer(port, 'VisualShaderNode.input_port', 0, 1024), value); }
export function getGodotVisualShaderNodeDefaultInput(nodeValue: GodotVisualShaderNode, port: unknown): unknown { return nodeValue.defaults.get(integer(port, 'VisualShaderNode.input_port', 0, 1024)) ?? null; }
