import { registerGodotObjectIdentity } from './object';

export class GodotRDAttachmentFormat {
  private format = 0; private samples = 0; private usageFlags = 0;
  set_format(value: number): void { this.format = value; } get_format(): number { return this.format; }
  set_samples(value: number): void { this.samples = value; } get_samples(): number { return this.samples; }
  set_usage_flags(value: number): void { this.usageFlags = value >>> 0; } get_usage_flags(): number { return this.usageFlags; }
}

export class GodotRDSamplerState {
  private magFilter = 1; private minFilter = 1; private mipFilter = 1;
  private repeatU = 2; private repeatV = 2; private repeatW = 2;
  private lodBias = 0; private useAnisotropy = false; private anisotropyMax = 1;
  private enableCompare = false; private compareOp = 7; private minLod = -1000; private maxLod = 1000;
  private borderColor = 0; private unnormalizedUVW = false;
  set_mag_filter(v: number): void { this.magFilter = v; } get_mag_filter(): number { return this.magFilter; }
  set_min_filter(v: number): void { this.minFilter = v; } get_min_filter(): number { return this.minFilter; }
  set_mip_filter(v: number): void { this.mipFilter = v; } get_mip_filter(): number { return this.mipFilter; }
  set_repeat_u(v: number): void { this.repeatU = v; } get_repeat_u(): number { return this.repeatU; }
  set_repeat_v(v: number): void { this.repeatV = v; } get_repeat_v(): number { return this.repeatV; }
  set_repeat_w(v: number): void { this.repeatW = v; } get_repeat_w(): number { return this.repeatW; }
  set_lod_bias(v: number): void { this.lodBias = v; } get_lod_bias(): number { return this.lodBias; }
  set_use_anisotropy(v: boolean): void { this.useAnisotropy = v; } get_use_anisotropy(): boolean { return this.useAnisotropy; }
  set_anisotropy_max(v: number): void { this.anisotropyMax = v; } get_anisotropy_max(): number { return this.anisotropyMax; }
  set_enable_compare(v: boolean): void { this.enableCompare = v; } get_enable_compare(): boolean { return this.enableCompare; }
  set_compare_op(v: number): void { this.compareOp = v; } get_compare_op(): number { return this.compareOp; }
  set_min_lod(v: number): void { this.minLod = v; } get_min_lod(): number { return this.minLod; }
  set_max_lod(v: number): void { this.maxLod = v; } get_max_lod(): number { return this.maxLod; }
  set_border_color(v: number): void { this.borderColor = v; } get_border_color(): number { return this.borderColor; }
  set_unnormalized_uvw(v: boolean): void { this.unnormalizedUVW = v; } get_unnormalized_uvw(): boolean { return this.unnormalizedUVW; }
}

export class GodotRDTextureFormat {
  private format = 0; private width = 1; private height = 1; private depth = 1; private arrayLayers = 1; private mipmaps = 1;
  private textureType = 1; private samples = 0; private usageBits = 0; private readonly shareableFormats = new Set<number>();
  set_format(v: number): void { this.format = v; } get_format(): number { return this.format; }
  set_width(v: number): void { this.width = Math.max(1, Math.trunc(v)); } get_width(): number { return this.width; }
  set_height(v: number): void { this.height = Math.max(1, Math.trunc(v)); } get_height(): number { return this.height; }
  set_depth(v: number): void { this.depth = Math.max(1, Math.trunc(v)); } get_depth(): number { return this.depth; }
  set_array_layers(v: number): void { this.arrayLayers = Math.max(1, Math.trunc(v)); } get_array_layers(): number { return this.arrayLayers; }
  set_mipmaps(v: number): void { this.mipmaps = Math.max(1, Math.trunc(v)); } get_mipmaps(): number { return this.mipmaps; }
  set_texture_type(v: number): void { this.textureType = v; } get_texture_type(): number { return this.textureType; }
  set_samples(v: number): void { this.samples = v; } get_samples(): number { return this.samples; }
  set_usage_bits(v: number): void { this.usageBits = v >>> 0; } get_usage_bits(): number { return this.usageBits; }
  add_shareable_format(v: number): void { this.shareableFormats.add(v); }
  remove_shareable_format(v: number): void { this.shareableFormats.delete(v); }
  get_shareable_formats(): number[] { return [...this.shareableFormats]; }
}

export class GodotRDTextureView {
  private formatOverride = 0; private swizzleR = 0; private swizzleG = 1; private swizzleB = 2; private swizzleA = 3;
  set_format_override(v: number): void { this.formatOverride = v; } get_format_override(): number { return this.formatOverride; }
  set_swizzle_r(v: number): void { this.swizzleR = v; } get_swizzle_r(): number { return this.swizzleR; }
  set_swizzle_g(v: number): void { this.swizzleG = v; } get_swizzle_g(): number { return this.swizzleG; }
  set_swizzle_b(v: number): void { this.swizzleB = v; } get_swizzle_b(): number { return this.swizzleB; }
  set_swizzle_a(v: number): void { this.swizzleA = v; } get_swizzle_a(): number { return this.swizzleA; }
}

export class GodotRDUniform {
  private uniformType = 0; private binding = 0; private readonly ids: unknown[] = [];
  set_uniform_type(v: number): void { this.uniformType = v; } get_uniform_type(): number { return this.uniformType; }
  set_binding(v: number): void { this.binding = Math.max(0, Math.trunc(v)); } get_binding(): number { return this.binding; }
  add_id(v: unknown): void { this.ids.push(v); }
  clear_ids(): void { this.ids.length = 0; }
  get_ids(): unknown[] { return [...this.ids]; }
}

export class GodotRDVertexAttribute {
  private location = 0; private offset = 0; private format = 0; private stride = 0; private frequency = 0;
  set_location(v: number): void { this.location = Math.max(0, Math.trunc(v)); } get_location(): number { return this.location; }
  set_offset(v: number): void { this.offset = Math.max(0, Math.trunc(v)); } get_offset(): number { return this.offset; }
  set_format(v: number): void { this.format = v; } get_format(): number { return this.format; }
  set_stride(v: number): void { this.stride = Math.max(0, Math.trunc(v)); } get_stride(): number { return this.stride; }
  set_frequency(v: number): void { this.frequency = v; } get_frequency(): number { return this.frequency; }
}

export class GodotRDPipelineColorBlendStateAttachment {
  private enableBlend = false; private srcColorBlendFactor = 1; private dstColorBlendFactor = 0; private colorBlendOp = 0;
  private srcAlphaBlendFactor = 1; private dstAlphaBlendFactor = 0; private alphaBlendOp = 0;
  private writeR = true; private writeG = true; private writeB = true; private writeA = true;
  set_enable_blend(v: boolean): void { this.enableBlend = v; } get_enable_blend(): boolean { return this.enableBlend; }
  set_src_color_blend_factor(v: number): void { this.srcColorBlendFactor = v; } get_src_color_blend_factor(): number { return this.srcColorBlendFactor; }
  set_dst_color_blend_factor(v: number): void { this.dstColorBlendFactor = v; } get_dst_color_blend_factor(): number { return this.dstColorBlendFactor; }
  set_color_blend_op(v: number): void { this.colorBlendOp = v; } get_color_blend_op(): number { return this.colorBlendOp; }
  set_src_alpha_blend_factor(v: number): void { this.srcAlphaBlendFactor = v; } get_src_alpha_blend_factor(): number { return this.srcAlphaBlendFactor; }
  set_dst_alpha_blend_factor(v: number): void { this.dstAlphaBlendFactor = v; } get_dst_alpha_blend_factor(): number { return this.dstAlphaBlendFactor; }
  set_alpha_blend_op(v: number): void { this.alphaBlendOp = v; } get_alpha_blend_op(): number { return this.alphaBlendOp; }
  set_write_r(v: boolean): void { this.writeR = v; } get_write_r(): boolean { return this.writeR; }
  set_write_g(v: boolean): void { this.writeG = v; } get_write_g(): boolean { return this.writeG; }
  set_write_b(v: boolean): void { this.writeB = v; } get_write_b(): boolean { return this.writeB; }
  set_write_a(v: boolean): void { this.writeA = v; } get_write_a(): boolean { return this.writeA; }
}

export class GodotRDPipelineColorBlendState {
  private enableLogicOp = false; private logicOp = 0; private attachments: GodotRDPipelineColorBlendStateAttachment[] = [];
  set_enable_logic_op(v: boolean): void { this.enableLogicOp = v; } get_enable_logic_op(): boolean { return this.enableLogicOp; }
  set_logic_op(v: number): void { this.logicOp = v; } get_logic_op(): number { return this.logicOp; }
  set_attachments(v: readonly GodotRDPipelineColorBlendStateAttachment[]): void { this.attachments = [...v]; }
  get_attachments(): GodotRDPipelineColorBlendStateAttachment[] { return [...this.attachments]; }
}

export class GodotRDPipelineDepthStencilState {
  private enableDepthTest = false; private enableDepthWrite = false; private depthCompareOperator = 7;
  private enableDepthRange = false; private depthRangeMin = 0; private depthRangeMax = 1; private enableStencil = false;
  private frontOp = { fail: 0, pass: 0, depthFail: 0, compare: 7, compareMask: 0xff, writeMask: 0xff, reference: 0 };
  private backOp = { fail: 0, pass: 0, depthFail: 0, compare: 7, compareMask: 0xff, writeMask: 0xff, reference: 0 };
  set_enable_depth_test(v: boolean): void { this.enableDepthTest = v; } get_enable_depth_test(): boolean { return this.enableDepthTest; }
  set_enable_depth_write(v: boolean): void { this.enableDepthWrite = v; } get_enable_depth_write(): boolean { return this.enableDepthWrite; }
  set_depth_compare_operator(v: number): void { this.depthCompareOperator = v; } get_depth_compare_operator(): number { return this.depthCompareOperator; }
  set_enable_depth_range(v: boolean): void { this.enableDepthRange = v; } get_enable_depth_range(): boolean { return this.enableDepthRange; }
  set_depth_range_min(v: number): void { this.depthRangeMin = v; } get_depth_range_min(): number { return this.depthRangeMin; }
  set_depth_range_max(v: number): void { this.depthRangeMax = v; } get_depth_range_max(): number { return this.depthRangeMax; }
  set_enable_stencil(v: boolean): void { this.enableStencil = v; } get_enable_stencil(): boolean { return this.enableStencil; }
  set_front_op_fail(v: number): void { this.frontOp.fail = v; } get_front_op_fail(): number { return this.frontOp.fail; }
  set_front_op_pass(v: number): void { this.frontOp.pass = v; } get_front_op_pass(): number { return this.frontOp.pass; }
  set_front_op_depth_fail(v: number): void { this.frontOp.depthFail = v; } get_front_op_depth_fail(): number { return this.frontOp.depthFail; }
  set_front_op_compare(v: number): void { this.frontOp.compare = v; } get_front_op_compare(): number { return this.frontOp.compare; }
  set_front_op_compare_mask(v: number): void { this.frontOp.compareMask = v >>> 0; } get_front_op_compare_mask(): number { return this.frontOp.compareMask; }
  set_front_op_write_mask(v: number): void { this.frontOp.writeMask = v >>> 0; } get_front_op_write_mask(): number { return this.frontOp.writeMask; }
  set_front_op_reference(v: number): void { this.frontOp.reference = v >>> 0; } get_front_op_reference(): number { return this.frontOp.reference; }
  set_back_op_fail(v: number): void { this.backOp.fail = v; } get_back_op_fail(): number { return this.backOp.fail; }
  set_back_op_pass(v: number): void { this.backOp.pass = v; } get_back_op_pass(): number { return this.backOp.pass; }
  set_back_op_depth_fail(v: number): void { this.backOp.depthFail = v; } get_back_op_depth_fail(): number { return this.backOp.depthFail; }
  set_back_op_compare(v: number): void { this.backOp.compare = v; } get_back_op_compare(): number { return this.backOp.compare; }
  set_back_op_compare_mask(v: number): void { this.backOp.compareMask = v >>> 0; } get_back_op_compare_mask(): number { return this.backOp.compareMask; }
  set_back_op_write_mask(v: number): void { this.backOp.writeMask = v >>> 0; } get_back_op_write_mask(): number { return this.backOp.writeMask; }
  set_back_op_reference(v: number): void { this.backOp.reference = v >>> 0; } get_back_op_reference(): number { return this.backOp.reference; }
}

export class GodotRDPipelineMultisampleState {
  private sampleCount = 0; private enableSampleShading = false; private minSampleShading = 0;
  private sampleMasks: number[] = []; private enableAlphaToCoverage = false; private enableAlphaToOne = false;
  set_sample_count(v: number): void { this.sampleCount = v; } get_sample_count(): number { return this.sampleCount; }
  set_enable_sample_shading(v: boolean): void { this.enableSampleShading = v; } get_enable_sample_shading(): boolean { return this.enableSampleShading; }
  set_min_sample_shading(v: number): void { this.minSampleShading = v; } get_min_sample_shading(): number { return this.minSampleShading; }
  set_sample_masks(v: readonly number[]): void { this.sampleMasks = v.map((value) => value >>> 0); } get_sample_masks(): number[] { return [...this.sampleMasks]; }
  set_enable_alpha_to_coverage(v: boolean): void { this.enableAlphaToCoverage = v; } get_enable_alpha_to_coverage(): boolean { return this.enableAlphaToCoverage; }
  set_enable_alpha_to_one(v: boolean): void { this.enableAlphaToOne = v; } get_enable_alpha_to_one(): boolean { return this.enableAlphaToOne; }
}

export class GodotRDPipelineRasterizationState {
  private enableDepthClamp = false; private discardPrimitives = false; private wireframe = false; private cullMode = 0; private frontFace = 0;
  private depthBiasEnabled = false; private depthBiasConstantFactor = 0; private depthBiasClamp = 0; private depthBiasSlopeFactor = 0;
  private lineWidth = 1; private patchControlPoints = 1;
  set_enable_depth_clamp(v: boolean): void { this.enableDepthClamp = v; } get_enable_depth_clamp(): boolean { return this.enableDepthClamp; }
  set_discard_primitives(v: boolean): void { this.discardPrimitives = v; } get_discard_primitives(): boolean { return this.discardPrimitives; }
  set_wireframe(v: boolean): void { this.wireframe = v; } get_wireframe(): boolean { return this.wireframe; }
  set_cull_mode(v: number): void { this.cullMode = v; } get_cull_mode(): number { return this.cullMode; }
  set_front_face(v: number): void { this.frontFace = v; } get_front_face(): number { return this.frontFace; }
  set_depth_bias_enabled(v: boolean): void { this.depthBiasEnabled = v; } get_depth_bias_enabled(): boolean { return this.depthBiasEnabled; }
  set_depth_bias_constant_factor(v: number): void { this.depthBiasConstantFactor = v; } get_depth_bias_constant_factor(): number { return this.depthBiasConstantFactor; }
  set_depth_bias_clamp(v: number): void { this.depthBiasClamp = v; } get_depth_bias_clamp(): number { return this.depthBiasClamp; }
  set_depth_bias_slope_factor(v: number): void { this.depthBiasSlopeFactor = v; } get_depth_bias_slope_factor(): number { return this.depthBiasSlopeFactor; }
  set_line_width(v: number): void { this.lineWidth = v; } get_line_width(): number { return this.lineWidth; }
  set_patch_control_points(v: number): void { this.patchControlPoints = Math.max(1, Math.trunc(v)); } get_patch_control_points(): number { return this.patchControlPoints; }
}

export class GodotRDFramebufferPass {
  private colorAttachments: number[] = [];
  private inputAttachments: number[] = [];
  private resolveAttachments: number[] = [];
  private preserveAttachments: number[] = [];
  private depthAttachment = -1;
  private vrsAttachment = -1;
  set_color_attachments(v: readonly number[]): void { this.colorAttachments = v.map(Math.trunc); }
  get_color_attachments(): number[] { return [...this.colorAttachments]; }
  set_input_attachments(v: readonly number[]): void { this.inputAttachments = v.map(Math.trunc); }
  get_input_attachments(): number[] { return [...this.inputAttachments]; }
  set_resolve_attachments(v: readonly number[]): void { this.resolveAttachments = v.map(Math.trunc); }
  get_resolve_attachments(): number[] { return [...this.resolveAttachments]; }
  set_preserve_attachments(v: readonly number[]): void { this.preserveAttachments = v.map(Math.trunc); }
  get_preserve_attachments(): number[] { return [...this.preserveAttachments]; }
  set_depth_attachment(v: number): void { this.depthAttachment = Math.trunc(v); }
  get_depth_attachment(): number { return this.depthAttachment; }
  set_vrs_attachment(v: number): void { this.vrsAttachment = Math.trunc(v); }
  get_vrs_attachment(): number { return this.vrsAttachment; }
}

export class GodotRDPipelineSpecializationConstant {
  private constantId = 0;
  private value: unknown = false;
  set_constant_id(v: number): void { this.constantId = Math.max(0, Math.trunc(v)); }
  get_constant_id(): number { return this.constantId; }
  set_value(v: unknown): void {
    if (typeof v !== 'boolean' && typeof v !== 'number') throw new TypeError('RDPipelineSpecializationConstant.value requires bool, int, or float.');
    this.value = v;
  }
  get_value(): unknown { return this.value; }
}

export class GodotRDShaderSource {
  private language = 0;
  private sourceVertex = '';
  private sourceFragment = '';
  private sourceTesselationControl = '';
  private sourceTesselationEvaluation = '';
  private sourceCompute = '';
  set_language(v: number): void { this.language = v; }
  get_language(): number { return this.language; }
  set_stage_source(stage: number, source: string): void {
    if (stage === 0) this.sourceVertex = source;
    else if (stage === 1) this.sourceFragment = source;
    else if (stage === 2) this.sourceTesselationControl = source;
    else if (stage === 3) this.sourceTesselationEvaluation = source;
    else if (stage === 4) this.sourceCompute = source;
    else throw new RangeError('RDShaderSource stage is invalid.');
  }
  get_stage_source(stage: number): string {
    if (stage === 0) return this.sourceVertex;
    if (stage === 1) return this.sourceFragment;
    if (stage === 2) return this.sourceTesselationControl;
    if (stage === 3) return this.sourceTesselationEvaluation;
    if (stage === 4) return this.sourceCompute;
    return '';
  }
  set_source_vertex(v: string): void { this.sourceVertex = v; } get_source_vertex(): string { return this.sourceVertex; }
  set_source_fragment(v: string): void { this.sourceFragment = v; } get_source_fragment(): string { return this.sourceFragment; }
  set_source_tesselation_control(v: string): void { this.sourceTesselationControl = v; } get_source_tesselation_control(): string { return this.sourceTesselationControl; }
  set_source_tesselation_evaluation(v: string): void { this.sourceTesselationEvaluation = v; } get_source_tesselation_evaluation(): string { return this.sourceTesselationEvaluation; }
  set_source_compute(v: string): void { this.sourceCompute = v; } get_source_compute(): string { return this.sourceCompute; }
}

function resource<T extends object>(value: T, className: string): T { registerGodotObjectIdentity(value, className); return value; }
export const createGodotRDAttachmentFormat = (): GodotRDAttachmentFormat => resource(new GodotRDAttachmentFormat(), 'RDAttachmentFormat');
export const createGodotRDSamplerState = (): GodotRDSamplerState => resource(new GodotRDSamplerState(), 'RDSamplerState');
export const createGodotRDTextureFormat = (): GodotRDTextureFormat => resource(new GodotRDTextureFormat(), 'RDTextureFormat');
export const createGodotRDTextureView = (): GodotRDTextureView => resource(new GodotRDTextureView(), 'RDTextureView');
export const createGodotRDUniform = (): GodotRDUniform => resource(new GodotRDUniform(), 'RDUniform');
export const createGodotRDVertexAttribute = (): GodotRDVertexAttribute => resource(new GodotRDVertexAttribute(), 'RDVertexAttribute');
export const createGodotRDPipelineColorBlendStateAttachment = (): GodotRDPipelineColorBlendStateAttachment => resource(new GodotRDPipelineColorBlendStateAttachment(), 'RDPipelineColorBlendStateAttachment');
export const createGodotRDPipelineColorBlendState = (): GodotRDPipelineColorBlendState => resource(new GodotRDPipelineColorBlendState(), 'RDPipelineColorBlendState');
export const createGodotRDPipelineDepthStencilState = (): GodotRDPipelineDepthStencilState => resource(new GodotRDPipelineDepthStencilState(), 'RDPipelineDepthStencilState');
export const createGodotRDPipelineMultisampleState = (): GodotRDPipelineMultisampleState => resource(new GodotRDPipelineMultisampleState(), 'RDPipelineMultisampleState');
export const createGodotRDPipelineRasterizationState = (): GodotRDPipelineRasterizationState => resource(new GodotRDPipelineRasterizationState(), 'RDPipelineRasterizationState');
export const createGodotRDFramebufferPass = (): GodotRDFramebufferPass => resource(new GodotRDFramebufferPass(), 'RDFramebufferPass');
export const createGodotRDPipelineSpecializationConstant = (): GodotRDPipelineSpecializationConstant => resource(new GodotRDPipelineSpecializationConstant(), 'RDPipelineSpecializationConstant');
export const createGodotRDShaderSource = (): GodotRDShaderSource => resource(new GodotRDShaderSource(), 'RDShaderSource');
