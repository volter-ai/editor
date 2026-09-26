import type { GodotGLTFState } from './gltf-state';

export class GodotGLTFAccessor {
  private bufferView = -1;
  private byteOffset = 0;
  private componentType = 0;
  private normalized = false;
  private count = 0;
  private accessorType = 0;
  private type = '';
  private minimum: number[] = [];
  private maximum: number[] = [];
  private sparseCount = 0;
  private sparseIndicesBufferView = 0;
  private sparseIndicesByteOffset = 0;
  private sparseIndicesComponentType = 0;
  private sparseValuesBufferView = 0;
  private sparseValuesByteOffset = 0;

  static from_dictionary(dictionary: Readonly<Record<string, unknown>>): GodotGLTFAccessor {
    const result = new GodotGLTFAccessor();
    for (const [key, value] of Object.entries(dictionary)) {
      const setter = Reflect.get(result, `set_${key}`);
      if (typeof setter === 'function') Reflect.apply(setter, result, [value]);
    }
    return result;
  }
  to_dictionary(): Readonly<Record<string, unknown>> {
    return { buffer_view: this.bufferView, byte_offset: this.byteOffset, component_type: this.componentType, normalized: this.normalized, count: this.count, accessor_type: this.accessorType, type: this.type, min: this.minimum, max: this.maximum, sparse_count: this.sparseCount, sparse_indices_buffer_view: this.sparseIndicesBufferView, sparse_indices_byte_offset: this.sparseIndicesByteOffset, sparse_indices_component_type: this.sparseIndicesComponentType, sparse_values_buffer_view: this.sparseValuesBufferView, sparse_values_byte_offset: this.sparseValuesByteOffset };
  }
  get_buffer_view(): number { return this.bufferView; } set_buffer_view(v: number): void { this.bufferView = v; }
  get_byte_offset(): number { return this.byteOffset; } set_byte_offset(v: number): void { this.byteOffset = v; }
  get_component_type(): number { return this.componentType; } set_component_type(v: number): void { this.componentType = v; }
  get_normalized(): boolean { return this.normalized; } set_normalized(v: boolean): void { this.normalized = v; }
  get_count(): number { return this.count; } set_count(v: number): void { this.count = v; }
  get_accessor_type(): number { return this.accessorType; } set_accessor_type(v: number): void { this.accessorType = v; }
  get_type(): string { return this.type; } set_type(v: string): void { this.type = v; }
  get_min(): number[] { return this.minimum; } set_min(v: number[]): void { this.minimum = v; }
  get_max(): number[] { return this.maximum; } set_max(v: number[]): void { this.maximum = v; }
  get_sparse_count(): number { return this.sparseCount; } set_sparse_count(v: number): void { this.sparseCount = v; }
  get_sparse_indices_buffer_view(): number { return this.sparseIndicesBufferView; } set_sparse_indices_buffer_view(v: number): void { this.sparseIndicesBufferView = v; }
  get_sparse_indices_byte_offset(): number { return this.sparseIndicesByteOffset; } set_sparse_indices_byte_offset(v: number): void { this.sparseIndicesByteOffset = v; }
  get_sparse_indices_component_type(): number { return this.sparseIndicesComponentType; } set_sparse_indices_component_type(v: number): void { this.sparseIndicesComponentType = v; }
  get_sparse_values_buffer_view(): number { return this.sparseValuesBufferView; } set_sparse_values_buffer_view(v: number): void { this.sparseValuesBufferView = v; }
  get_sparse_values_byte_offset(): number { return this.sparseValuesByteOffset; } set_sparse_values_byte_offset(v: number): void { this.sparseValuesByteOffset = v; }
}

export class GodotGLTFAnimation {
  private originalName = '';
  private loop = false;
  private readonly additionalData = new Map<string, unknown>();
  get_original_name(): string { return this.originalName; }
  set_original_name(v: string): void { this.originalName = v; }
  get_loop(): boolean { return this.loop; }
  set_loop(v: boolean): void { this.loop = v; }
  get_additional_data(name: string): unknown { return this.additionalData.get(name) ?? null; }
  set_additional_data(name: string, data: unknown): void { this.additionalData.set(name, data); }
}

export class GodotGLTFBufferView {
  private buffer = -1;
  private byteOffset = 0;
  private byteLength = 0;
  private byteStride = -1;
  private indices = false;
  private vertexAttributes = false;
  load_buffer_view_data(state: GodotGLTFState): Uint8Array {
    const source = state.get_buffers()[this.buffer];
    return source?.slice(this.byteOffset, this.byteOffset + this.byteLength) ?? new Uint8Array();
  }
  static from_dictionary(dictionary: Readonly<Record<string, unknown>>): GodotGLTFBufferView {
    const result = new GodotGLTFBufferView();
    const buffer = dictionary['buffer'];
    const byteOffset = dictionary['byte_offset'];
    const byteLength = dictionary['byte_length'];
    const byteStride = dictionary['byte_stride'];
    const indices = dictionary['indices'];
    const vertexAttributes = dictionary['vertex_attributes'];
    if (typeof buffer === 'number') result.set_buffer(buffer);
    if (typeof byteOffset === 'number') result.set_byte_offset(byteOffset);
    if (typeof byteLength === 'number') result.set_byte_length(byteLength);
    if (typeof byteStride === 'number') result.set_byte_stride(byteStride);
    if (typeof indices === 'boolean') result.set_indices(indices);
    if (typeof vertexAttributes === 'boolean') result.set_vertex_attributes(vertexAttributes);
    return result;
  }
  to_dictionary(): Readonly<Record<string, unknown>> { return { buffer: this.buffer, byte_offset: this.byteOffset, byte_length: this.byteLength, byte_stride: this.byteStride, indices: this.indices, vertex_attributes: this.vertexAttributes }; }
  get_buffer(): number { return this.buffer; } set_buffer(v: number): void { this.buffer = v; }
  get_byte_offset(): number { return this.byteOffset; } set_byte_offset(v: number): void { this.byteOffset = v; }
  get_byte_length(): number { return this.byteLength; } set_byte_length(v: number): void { this.byteLength = v; }
  get_byte_stride(): number { return this.byteStride; } set_byte_stride(v: number): void { this.byteStride = v; }
  get_indices(): boolean { return this.indices; } set_indices(v: boolean): void { this.indices = v; }
  get_vertex_attributes(): boolean { return this.vertexAttributes; } set_vertex_attributes(v: boolean): void { this.vertexAttributes = v; }
}

export class GodotGLTFCamera {
  private perspective = true;
  private fov = 75;
  private sizeMag = 0.5;
  private depthFar = 4000;
  private depthNear = 0.05;
  static from_node(node: Readonly<Record<string, unknown>>): GodotGLTFCamera { return GodotGLTFCamera.from_dictionary(node); }
  to_node(): Readonly<Record<string, unknown>> { return this.to_dictionary(); }
  static from_dictionary(dictionary: Readonly<Record<string, unknown>>): GodotGLTFCamera {
    const camera = new GodotGLTFCamera();
    const perspective = dictionary['perspective'];
    const fov = dictionary['fov'];
    const sizeMag = dictionary['size_mag'];
    const depthFar = dictionary['depth_far'];
    const depthNear = dictionary['depth_near'];
    if (typeof perspective === 'boolean') camera.set_perspective(perspective);
    if (typeof fov === 'number') camera.set_fov(fov);
    if (typeof sizeMag === 'number') camera.set_size_mag(sizeMag);
    if (typeof depthFar === 'number') camera.set_depth_far(depthFar);
    if (typeof depthNear === 'number') camera.set_depth_near(depthNear);
    return camera;
  }
  to_dictionary(): Readonly<Record<string, unknown>> { return { perspective: this.perspective, fov: this.fov, size_mag: this.sizeMag, depth_far: this.depthFar, depth_near: this.depthNear }; }
  get_perspective(): boolean { return this.perspective; } set_perspective(v: boolean): void { this.perspective = v; }
  get_fov(): number { return this.fov; } set_fov(v: number): void { this.fov = v; }
  get_size_mag(): number { return this.sizeMag; } set_size_mag(v: number): void { this.sizeMag = v; }
  get_depth_far(): number { return this.depthFar; } set_depth_far(v: number): void { this.depthFar = v; }
  get_depth_near(): number { return this.depthNear; } set_depth_near(v: number): void { this.depthNear = v; }
}

export class GodotGLTFLight {
  private color: unknown = { r: 1, g: 1, b: 1, a: 1 };
  private intensity = 1;
  private lightType = 'point';
  private range = Number.POSITIVE_INFINITY;
  private innerConeAngle = 0;
  private outerConeAngle = Math.PI / 4;
  private readonly additionalData = new Map<string, unknown>();
  static from_node(node: Readonly<Record<string, unknown>>): GodotGLTFLight { return GodotGLTFLight.from_dictionary(node); }
  to_node(): Readonly<Record<string, unknown>> { return this.to_dictionary(); }
  static from_dictionary(d: Readonly<Record<string, unknown>>): GodotGLTFLight {
    const v = new GodotGLTFLight();
    const color = d['color'];
    const intensity = d['intensity'];
    const lightType = d['light_type'];
    const range = d['range'];
    const innerConeAngle = d['inner_cone_angle'];
    const outerConeAngle = d['outer_cone_angle'];
    if (color !== undefined) v.set_color(color);
    if (typeof intensity === 'number') v.set_intensity(intensity);
    if (typeof lightType === 'string') v.set_light_type(lightType);
    if (typeof range === 'number') v.set_range(range);
    if (typeof innerConeAngle === 'number') v.set_inner_cone_angle(innerConeAngle);
    if (typeof outerConeAngle === 'number') v.set_outer_cone_angle(outerConeAngle);
    return v;
  }
  to_dictionary(): Readonly<Record<string, unknown>> { return { color: this.color, intensity: this.intensity, light_type: this.lightType, range: this.range, inner_cone_angle: this.innerConeAngle, outer_cone_angle: this.outerConeAngle }; }
  get_color(): unknown { return this.color; } set_color(v: unknown): void { this.color = v; }
  get_intensity(): number { return this.intensity; } set_intensity(v: number): void { this.intensity = v; }
  get_light_type(): string { return this.lightType; } set_light_type(v: string): void { this.lightType = v; }
  get_range(): number { return this.range; } set_range(v: number): void { this.range = v; }
  get_inner_cone_angle(): number { return this.innerConeAngle; } set_inner_cone_angle(v: number): void { this.innerConeAngle = v; }
  get_outer_cone_angle(): number { return this.outerConeAngle; } set_outer_cone_angle(v: number): void { this.outerConeAngle = v; }
  get_additional_data(name: string): unknown { return this.additionalData.get(name) ?? null; }
  set_additional_data(name: string, data: unknown): void { this.additionalData.set(name, data); }
}

export class GodotGLTFMesh {
  private originalName = '';
  private mesh: unknown = null;
  private blendWeights: number[] = [];
  private instanceMaterials: unknown[] = [];
  private readonly additionalData = new Map<string, unknown>();
  get_original_name(): string { return this.originalName; } set_original_name(v: string): void { this.originalName = v; }
  get_mesh(): unknown { return this.mesh; } set_mesh(v: unknown): void { this.mesh = v; }
  get_blend_weights(): number[] { return this.blendWeights; } set_blend_weights(v: number[]): void { this.blendWeights = v; }
  get_instance_materials(): unknown[] { return this.instanceMaterials; } set_instance_materials(v: unknown[]): void { this.instanceMaterials = v; }
  get_additional_data(name: string): unknown { return this.additionalData.get(name) ?? null; }
  set_additional_data(name: string, data: unknown): void { this.additionalData.set(name, data); }
}

export class GodotGLTFSpecGloss {
  private diffuseImage: unknown = null; private diffuseFactor: unknown = null; private glossFactor = 1; private specularFactor: unknown = null; private specGlossImage: unknown = null;
  get_diffuse_img(): unknown { return this.diffuseImage; } set_diffuse_img(v: unknown): void { this.diffuseImage = v; }
  get_diffuse_factor(): unknown { return this.diffuseFactor; } set_diffuse_factor(v: unknown): void { this.diffuseFactor = v; }
  get_gloss_factor(): number { return this.glossFactor; } set_gloss_factor(v: number): void { this.glossFactor = v; }
  get_specular_factor(): unknown { return this.specularFactor; } set_specular_factor(v: unknown): void { this.specularFactor = v; }
  get_spec_gloss_img(): unknown { return this.specGlossImage; } set_spec_gloss_img(v: unknown): void { this.specGlossImage = v; }
}

export class GodotGLTFTextureSampler {
  private magFilter = 9729; private minFilter = 9987; private wrapS = 10497; private wrapT = 10497;
  get_mag_filter(): number { return this.magFilter; } set_mag_filter(v: number): void { this.magFilter = v; }
  get_min_filter(): number { return this.minFilter; } set_min_filter(v: number): void { this.minFilter = v; }
  get_wrap_s(): number { return this.wrapS; } set_wrap_s(v: number): void { this.wrapS = v; }
  get_wrap_t(): number { return this.wrapT; } set_wrap_t(v: number): void { this.wrapT = v; }
}

export const createGodotGLTFAccessor = (): GodotGLTFAccessor => new GodotGLTFAccessor();
export const createGodotGLTFAnimation = (): GodotGLTFAnimation => new GodotGLTFAnimation();
export const createGodotGLTFBufferView = (): GodotGLTFBufferView => new GodotGLTFBufferView();
export const createGodotGLTFCamera = (): GodotGLTFCamera => new GodotGLTFCamera();
export const createGodotGLTFLight = (): GodotGLTFLight => new GodotGLTFLight();
export const createGodotGLTFMesh = (): GodotGLTFMesh => new GodotGLTFMesh();
export const createGodotGLTFSpecGloss = (): GodotGLTFSpecGloss => new GodotGLTFSpecGloss();
export const createGodotGLTFTextureSampler = (): GodotGLTFTextureSampler => new GodotGLTFTextureSampler();
