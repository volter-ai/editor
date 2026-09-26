import { registerGodotObjectIdentity } from './object';

export interface GodotRdTextureFormat {
  readonly __godotClass: 'RDTextureFormat';
  format: number;
  width: number;
  height: number;
  depth: number;
  array_layers: number;
  mipmaps: number;
  texture_type: number;
  samples: number;
  usage_bits: number;
  is_resolve_buffer: boolean;
  is_discardable: boolean;
}

export interface GodotRdTextureView {
  readonly __godotClass: 'RDTextureView';
  format_override: number;
  swizzle_r: number;
  swizzle_g: number;
  swizzle_b: number;
  swizzle_a: number;
}

export interface GodotRdSamplerState {
  readonly __godotClass: 'RDSamplerState';
  mag_filter: number;
  min_filter: number;
  mip_filter: number;
  repeat_u: number;
  repeat_v: number;
  repeat_w: number;
  lod_bias: number;
  use_anisotropy: boolean;
  anisotropy_max: number;
  enable_compare: boolean;
  compare_op: number;
  min_lod: number;
  max_lod: number;
  border_color: number;
  unnormalized_uvw: boolean;
}

export interface GodotRdShaderSource {
  readonly __godotClass: 'RDShaderSource';
  source_vertex: string;
  source_fragment: string;
  source_tesselation_control: string;
  source_tesselation_evaluation: string;
  source_compute: string;
  language: number;
}

export interface GodotRdShaderSpirv {
  readonly __godotClass: 'RDShaderSPIRV';
  bytecode_vertex: Uint8Array;
  bytecode_fragment: Uint8Array;
  bytecode_tesselation_control: Uint8Array;
  bytecode_tesselation_evaluation: Uint8Array;
  bytecode_compute: Uint8Array;
  compile_error_vertex: string;
  compile_error_fragment: string;
  compile_error_tesselation_control: string;
  compile_error_tesselation_evaluation: string;
  compile_error_compute: string;
}

export interface GodotRdVertexAttribute {
  readonly __godotClass: 'RDVertexAttribute';
  location: number;
  offset: number;
  format: number;
  stride: number;
  frequency: number;
}

export interface GodotRdPipelineRasterizationState {
  readonly __godotClass: 'RDPipelineRasterizationState';
  enable_depth_clamp: boolean;
  discard_primitives: boolean;
  wireframe: boolean;
  cull_mode: number;
  front_face: number;
  depth_bias_enabled: boolean;
  depth_bias_constant_factor: number;
  depth_bias_clamp: number;
  depth_bias_slope_factor: number;
  line_width: number;
  patch_control_points: number;
}

export interface GodotRdPipelineMultisampleState {
  readonly __godotClass: 'RDPipelineMultisampleState';
  sample_count: number;
  enable_sample_shading: boolean;
  min_sample_shading: number;
  sample_masks: number[];
  enable_alpha_to_coverage: boolean;
  enable_alpha_to_one: boolean;
}

export interface GodotRdPipelineDepthStencilState {
  readonly __godotClass: 'RDPipelineDepthStencilState';
  enable_depth_test: boolean;
  enable_depth_write: boolean;
  depth_compare_operator: number;
  enable_depth_range: boolean;
  depth_range_min: number;
  depth_range_max: number;
  enable_stencil: boolean;
  front_op_fail: number;
  front_op_pass: number;
  front_op_depth_fail: number;
  front_op_compare: number;
  front_op_compare_mask: number;
  front_op_write_mask: number;
  front_op_reference: number;
  back_op_fail: number;
  back_op_pass: number;
  back_op_depth_fail: number;
  back_op_compare: number;
  back_op_compare_mask: number;
  back_op_write_mask: number;
  back_op_reference: number;
}

export interface GodotRdPipelineColorBlendStateAttachment {
  readonly __godotClass: 'RDPipelineColorBlendStateAttachment';
  enable_blend: boolean;
  src_color_blend_factor: number;
  dst_color_blend_factor: number;
  color_blend_op: number;
  src_alpha_blend_factor: number;
  dst_alpha_blend_factor: number;
  alpha_blend_op: number;
  write_r: boolean;
  write_g: boolean;
  write_b: boolean;
  write_a: boolean;
}

export interface GodotRdPipelineColorBlendState {
  readonly __godotClass: 'RDPipelineColorBlendState';
  enable_logic_op: boolean;
  logic_op: number;
  attachments: GodotRdPipelineColorBlendStateAttachment[];
  blend_constant: unknown;
}

export interface GodotRdAttachmentFormat {
  readonly __godotClass: 'RDAttachmentFormat';
  format: number;
  samples: number;
  usage_flags: number;
}

export interface GodotRdFramebufferPass {
  readonly __godotClass: 'RDFramebufferPass';
  color_attachments: number[];
  input_attachments: number[];
  resolve_attachments: number[];
  preserve_attachments: number[];
  depth_attachment: number;
}

export interface GodotRdPipelineSpecializationConstant {
  readonly __godotClass: 'RDPipelineSpecializationConstant';
  constant_id: number;
  value: boolean | number;
}

interface RenderingDeviceResourceByClass {
  readonly RDTextureFormat: GodotRdTextureFormat;
  readonly RDTextureView: GodotRdTextureView;
  readonly RDSamplerState: GodotRdSamplerState;
  readonly RDShaderSource: GodotRdShaderSource;
  readonly RDShaderSPIRV: GodotRdShaderSpirv;
  readonly RDVertexAttribute: GodotRdVertexAttribute;
  readonly RDPipelineRasterizationState: GodotRdPipelineRasterizationState;
  readonly RDPipelineMultisampleState: GodotRdPipelineMultisampleState;
  readonly RDPipelineDepthStencilState: GodotRdPipelineDepthStencilState;
  readonly RDPipelineColorBlendStateAttachment: GodotRdPipelineColorBlendStateAttachment;
  readonly RDPipelineColorBlendState: GodotRdPipelineColorBlendState;
  readonly RDAttachmentFormat: GodotRdAttachmentFormat;
  readonly RDFramebufferPass: GodotRdFramebufferPass;
  readonly RDPipelineSpecializationConstant: GodotRdPipelineSpecializationConstant;
}

type ResourceClass = keyof RenderingDeviceResourceByClass;
type ResourceFields = Readonly<Record<string, readonly [unknown, (value: unknown) => unknown]>>;
const LISTENERS = new WeakMap<object, Set<(member: string) => void>>();

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: ${member} requires a finite value in [${minimum}, ${maximum}].`); return value;
}
function integer(value: unknown, member: string, minimum = 0, maximum = 0x7fff_ffff): number {
  const number = finite(value, member, minimum, maximum); if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: ${member} requires an integer.`); return number;
}
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`); return value; }
function string(value: unknown, member: string): string { if (typeof value !== 'string') throw new TypeError(`godot-compat: ${member} requires String.`); return value; }
function bytes(value: unknown, member: string): Uint8Array { if (value instanceof Uint8Array) return value.slice(); if (Array.isArray(value)) return Uint8Array.from(value.map((one) => integer(one, member, 0, 255))); throw new TypeError(`godot-compat: ${member} requires PackedByteArray.`); }
function numbers(value: unknown, member: string): number[] { if (!Array.isArray(value)) throw new TypeError(`godot-compat: ${member} requires Array.`); return value.map((one) => integer(one, member, 0, 0xffff_ffff)); }

function resource<Class extends ResourceClass>(
  className: Class,
  fields: ResourceFields,
): RenderingDeviceResourceByClass[Class] {
  const value = { __godotClass: className } as RenderingDeviceResourceByClass[Class];
  LISTENERS.set(value, new Set());
  for (const [member, [initial, normalize]] of Object.entries(fields)) {
    let retained = normalize(initial);
    Object.defineProperty(value, member, { enumerable: true, configurable: true, get: () => retained, set: (next: unknown) => { retained = normalize(next); for (const listener of LISTENERS.get(value) ?? []) listener(member); } });
  }
  registerGodotObjectIdentity(value, className);
  return value;
}

const i = (member: string, min = 0, max = 0x7fff_ffff) => (value: unknown) => integer(value, member, min, max);
const f = (member: string, min = -Infinity, max = Infinity) => (value: unknown) => finite(value, member, min, max);
const b = (member: string) => (value: unknown) => bool(value, member);
const s = (member: string) => (value: unknown) => string(value, member);
const ba = (member: string) => (value: unknown) => bytes(value, member);

export function createGodotRdTextureFormat(): GodotRdTextureFormat {
  return resource('RDTextureFormat', {
    format: [0, i('RDTextureFormat.format')], width: [1, i('RDTextureFormat.width', 1)], height: [1, i('RDTextureFormat.height', 1)],
    depth: [1, i('RDTextureFormat.depth', 1)], array_layers: [1, i('RDTextureFormat.array_layers', 1)], mipmaps: [1, i('RDTextureFormat.mipmaps', 1)],
    texture_type: [1, i('RDTextureFormat.texture_type', 0, 7)], samples: [0, i('RDTextureFormat.samples', 0, 6)], usage_bits: [0, i('RDTextureFormat.usage_bits', 0, 0xffff_ffff)],
    is_resolve_buffer: [false, b('RDTextureFormat.is_resolve_buffer')], is_discardable: [false, b('RDTextureFormat.is_discardable')],
  });
}
export function createGodotRdTextureView(): GodotRdTextureView {
  return resource('RDTextureView', { format_override: [0, i('RDTextureView.format_override')], swizzle_r: [0, i('RDTextureView.swizzle_r', 0, 5)], swizzle_g: [1, i('RDTextureView.swizzle_g', 0, 5)], swizzle_b: [2, i('RDTextureView.swizzle_b', 0, 5)], swizzle_a: [3, i('RDTextureView.swizzle_a', 0, 5)] });
}
export function createGodotRdSamplerState(): GodotRdSamplerState {
  return resource('RDSamplerState', {
    mag_filter: [0, i('RDSamplerState.mag_filter', 0, 1)], min_filter: [0, i('RDSamplerState.min_filter', 0, 1)], mip_filter: [0, i('RDSamplerState.mip_filter', 0, 2)],
    repeat_u: [2, i('RDSamplerState.repeat_u', 0, 4)], repeat_v: [2, i('RDSamplerState.repeat_v', 0, 4)], repeat_w: [2, i('RDSamplerState.repeat_w', 0, 4)], lod_bias: [0, f('RDSamplerState.lod_bias')],
    use_anisotropy: [false, b('RDSamplerState.use_anisotropy')], anisotropy_max: [1, f('RDSamplerState.anisotropy_max', 1)], enable_compare: [false, b('RDSamplerState.enable_compare')], compare_op: [7, i('RDSamplerState.compare_op', 0, 7)],
    min_lod: [0, f('RDSamplerState.min_lod')], max_lod: [1e20, f('RDSamplerState.max_lod')], border_color: [0, i('RDSamplerState.border_color', 0, 5)], unnormalized_uvw: [false, b('RDSamplerState.unnormalized_uvw')],
  });
}
export function createGodotRdShaderSource(): GodotRdShaderSource {
  return resource('RDShaderSource', { source_vertex: ['', s('RDShaderSource.source_vertex')], source_fragment: ['', s('RDShaderSource.source_fragment')], source_tesselation_control: ['', s('RDShaderSource.source_tesselation_control')], source_tesselation_evaluation: ['', s('RDShaderSource.source_tesselation_evaluation')], source_compute: ['', s('RDShaderSource.source_compute')], language: [0, i('RDShaderSource.language', 0, 1)] });
}
export function createGodotRdShaderSpirv(): GodotRdShaderSpirv {
  return resource('RDShaderSPIRV', { bytecode_vertex: [new Uint8Array(), ba('RDShaderSPIRV.bytecode_vertex')], bytecode_fragment: [new Uint8Array(), ba('RDShaderSPIRV.bytecode_fragment')], bytecode_tesselation_control: [new Uint8Array(), ba('RDShaderSPIRV.bytecode_tesselation_control')], bytecode_tesselation_evaluation: [new Uint8Array(), ba('RDShaderSPIRV.bytecode_tesselation_evaluation')], bytecode_compute: [new Uint8Array(), ba('RDShaderSPIRV.bytecode_compute')], compile_error_vertex: ['', s('RDShaderSPIRV.compile_error_vertex')], compile_error_fragment: ['', s('RDShaderSPIRV.compile_error_fragment')], compile_error_tesselation_control: ['', s('RDShaderSPIRV.compile_error_tesselation_control')], compile_error_tesselation_evaluation: ['', s('RDShaderSPIRV.compile_error_tesselation_evaluation')], compile_error_compute: ['', s('RDShaderSPIRV.compile_error_compute')] });
}
export function createGodotRdVertexAttribute(): GodotRdVertexAttribute {
  return resource('RDVertexAttribute', { location: [0, i('RDVertexAttribute.location')], offset: [0, i('RDVertexAttribute.offset')], format: [0, i('RDVertexAttribute.format')], stride: [0, i('RDVertexAttribute.stride')], frequency: [0, i('RDVertexAttribute.frequency', 0, 1)] });
}
export function createGodotRdPipelineRasterizationState(): GodotRdPipelineRasterizationState {
  return resource('RDPipelineRasterizationState', { enable_depth_clamp: [false, b('RDPipelineRasterizationState.enable_depth_clamp')], discard_primitives: [false, b('RDPipelineRasterizationState.discard_primitives')], wireframe: [false, b('RDPipelineRasterizationState.wireframe')], cull_mode: [0, i('RDPipelineRasterizationState.cull_mode', 0, 2)], front_face: [0, i('RDPipelineRasterizationState.front_face', 0, 1)], depth_bias_enabled: [false, b('RDPipelineRasterizationState.depth_bias_enabled')], depth_bias_constant_factor: [0, f('RDPipelineRasterizationState.depth_bias_constant_factor')], depth_bias_clamp: [0, f('RDPipelineRasterizationState.depth_bias_clamp')], depth_bias_slope_factor: [0, f('RDPipelineRasterizationState.depth_bias_slope_factor')], line_width: [1, f('RDPipelineRasterizationState.line_width', Number.MIN_VALUE)], patch_control_points: [1, i('RDPipelineRasterizationState.patch_control_points', 1, 32)] });
}
export function createGodotRdPipelineMultisampleState(): GodotRdPipelineMultisampleState {
  return resource('RDPipelineMultisampleState', { sample_count: [0, i('RDPipelineMultisampleState.sample_count', 0, 6)], enable_sample_shading: [false, b('RDPipelineMultisampleState.enable_sample_shading')], min_sample_shading: [0, f('RDPipelineMultisampleState.min_sample_shading', 0, 1)], sample_masks: [[], (value) => numbers(value, 'RDPipelineMultisampleState.sample_masks')], enable_alpha_to_coverage: [false, b('RDPipelineMultisampleState.enable_alpha_to_coverage')], enable_alpha_to_one: [false, b('RDPipelineMultisampleState.enable_alpha_to_one')] });
}
export function createGodotRdPipelineDepthStencilState(): GodotRdPipelineDepthStencilState {
  const fields: Record<string, readonly [unknown, (value: unknown) => unknown]> = { enable_depth_test: [false, b('RDPipelineDepthStencilState.enable_depth_test')], enable_depth_write: [false, b('RDPipelineDepthStencilState.enable_depth_write')], depth_compare_operator: [7, i('RDPipelineDepthStencilState.depth_compare_operator', 0, 7)], enable_depth_range: [false, b('RDPipelineDepthStencilState.enable_depth_range')], depth_range_min: [0, f('RDPipelineDepthStencilState.depth_range_min', 0, 1)], depth_range_max: [1, f('RDPipelineDepthStencilState.depth_range_max', 0, 1)], enable_stencil: [false, b('RDPipelineDepthStencilState.enable_stencil')] };
  for (const face of ['front', 'back']) { fields[`${face}_op_fail`] = [0, i(`${face}_op_fail`, 0, 7)]; fields[`${face}_op_pass`] = [0, i(`${face}_op_pass`, 0, 7)]; fields[`${face}_op_depth_fail`] = [0, i(`${face}_op_depth_fail`, 0, 7)]; fields[`${face}_op_compare`] = [7, i(`${face}_op_compare`, 0, 7)]; fields[`${face}_op_compare_mask`] = [0, i(`${face}_op_compare_mask`, 0, 0xffff_ffff)]; fields[`${face}_op_write_mask`] = [0, i(`${face}_op_write_mask`, 0, 0xffff_ffff)]; fields[`${face}_op_reference`] = [0, i(`${face}_op_reference`, 0, 0xffff_ffff)]; }
  return resource('RDPipelineDepthStencilState', fields);
}
export function createGodotRdPipelineColorBlendStateAttachment(): GodotRdPipelineColorBlendStateAttachment {
  return resource('RDPipelineColorBlendStateAttachment', { enable_blend: [false, b('ColorBlendAttachment.enable_blend')], src_color_blend_factor: [1, i('src_color_blend_factor', 0, 18)], dst_color_blend_factor: [0, i('dst_color_blend_factor', 0, 18)], color_blend_op: [0, i('color_blend_op', 0, 4)], src_alpha_blend_factor: [1, i('src_alpha_blend_factor', 0, 18)], dst_alpha_blend_factor: [0, i('dst_alpha_blend_factor', 0, 18)], alpha_blend_op: [0, i('alpha_blend_op', 0, 4)], write_r: [true, b('write_r')], write_g: [true, b('write_g')], write_b: [true, b('write_b')], write_a: [true, b('write_a')] });
}
export function createGodotRdPipelineColorBlendState(): GodotRdPipelineColorBlendState {
  return resource('RDPipelineColorBlendState', { enable_logic_op: [false, b('ColorBlendState.enable_logic_op')], logic_op: [0, i('ColorBlendState.logic_op', 0, 15)], attachments: [[], (value) => { if (!Array.isArray(value) || value.some((one) => typeof one !== 'object' || one === null || (one as { __godotClass?: unknown }).__godotClass !== 'RDPipelineColorBlendStateAttachment')) throw new TypeError('ColorBlendState.attachments requires attachment resources.'); return [...value]; }], blend_constant: [{ r: 0, g: 0, b: 0, a: 0 }, (value) => value] });
}
export function createGodotRdAttachmentFormat(): GodotRdAttachmentFormat {
  return resource('RDAttachmentFormat', {
    format: [0, i('RDAttachmentFormat.format')],
    samples: [0, i('RDAttachmentFormat.samples', 0, 6)],
    usage_flags: [0, i('RDAttachmentFormat.usage_flags', 0, 0xffff_ffff)],
  });
}
export function createGodotRdFramebufferPass(): GodotRdFramebufferPass {
  const attachmentList = (member: string) => (value: unknown): number[] => {
    if (!Array.isArray(value)) throw new TypeError(`godot-compat: RDFramebufferPass.${member} requires PackedInt32Array.`);
    return value.map((one) => integer(one, `RDFramebufferPass.${member}`, -1, 0x7fff_ffff));
  };
  return resource('RDFramebufferPass', {
    color_attachments: [[], attachmentList('color_attachments')],
    input_attachments: [[], attachmentList('input_attachments')],
    resolve_attachments: [[], attachmentList('resolve_attachments')],
    preserve_attachments: [[], attachmentList('preserve_attachments')],
    depth_attachment: [-1, i('RDFramebufferPass.depth_attachment', -1)],
  });
}
export function createGodotRdPipelineSpecializationConstant(): GodotRdPipelineSpecializationConstant {
  return resource('RDPipelineSpecializationConstant', {
    constant_id: [0, i('RDPipelineSpecializationConstant.constant_id')],
    value: [false, (value: unknown) => {
      if (typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError('godot-compat: RDPipelineSpecializationConstant.value requires bool, int, or float.');
      return value;
    }],
  });
}
export function watchGodotRenderingDeviceResource(resourceValue: object, listener: (member: string) => void): () => void { const listeners = LISTENERS.get(resourceValue); if (listeners === undefined) throw new TypeError('rendering device resource expected.'); listeners.add(listener); return () => listeners.delete(listener); }
