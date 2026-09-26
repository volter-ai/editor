import { allocateGodotRid, godotRidGetId, type GodotRid } from './gdscript-builtins';
import type {
  GodotRdPipelineColorBlendState,
  GodotRdPipelineDepthStencilState,
  GodotRdPipelineMultisampleState,
  GodotRdPipelineRasterizationState,
  GodotRdSamplerState,
  GodotRdShaderSpirv,
  GodotRdShaderSource,
  GodotRdTextureFormat,
  GodotRdTextureView,
  GodotRdVertexAttribute,
} from './rendering-device-resources';

export interface GodotRenderingDeviceInfo {
  readonly deviceName: string;
  readonly vendorName: string;
  readonly deviceType: number;
  readonly apiName: string;
  readonly apiVersion: string;
  readonly pipelineCacheUuid: string;
  readonly limits: ReadonlyMap<number, number>;
  readonly features: ReadonlyMap<number, boolean>;
  readonly screenWidth: number;
  readonly screenHeight: number;
}

export type GodotRenderingDeviceResourceKind =
  | 'texture'
  | 'sampler'
  | 'vertex_buffer'
  | 'index_buffer'
  | 'uniform_buffer'
  | 'storage_buffer'
  | 'texture_buffer'
  | 'shader'
  | 'uniform_set'
  | 'vertex_format'
  | 'vertex_array'
  | 'index_array'
  | 'framebuffer_format'
  | 'framebuffer'
  | 'render_pipeline'
  | 'compute_pipeline';

export interface GodotRdUniform {
  readonly __godotClass: 'RDUniform';
  uniform_type: number;
  binding: number;
  readonly ids: GodotRid[];
  add_id(rid: GodotRid): void;
  clear_ids(): void;
  get_ids(): GodotRid[];
}

export interface GodotRenderingDeviceResourceSnapshot {
  readonly rid: GodotRid;
  readonly kind: GodotRenderingDeviceResourceKind;
  readonly descriptor: unknown;
  readonly data: Uint8Array | null;
  readonly dependencies: readonly GodotRid[];
  readonly native: object | null;
  readonly label: string;
  readonly revision: number;
}

interface RetainedResource {
  rid: GodotRid;
  kind: GodotRenderingDeviceResourceKind;
  descriptor: unknown;
  data: Uint8Array | null;
  dependencies: GodotRid[];
  native: object | null;
  label: string;
  revision: number;
  freed: boolean;
}

export interface GodotRenderingDeviceDrawCommand {
  readonly operation: string;
  readonly arguments: readonly unknown[];
}

export interface GodotRenderingDeviceCommandListSnapshot {
  readonly id: number;
  readonly kind: 'draw' | 'compute';
  readonly framebuffer: GodotRid | null;
  readonly commands: readonly GodotRenderingDeviceDrawCommand[];
  readonly ended: boolean;
}

export interface GodotRenderingDeviceBinding {
  create(resource: GodotRenderingDeviceResourceSnapshot): object | null;
  update(resource: GodotRenderingDeviceResourceSnapshot, operation: string): void;
  free(resource: GodotRenderingDeviceResourceSnapshot): void;
  submit(lists: readonly GodotRenderingDeviceCommandListSnapshot[]): void;
  sync?(): void | Promise<void>;
}

interface CommandList {
  id: number;
  kind: 'draw' | 'compute';
  framebuffer: GodotRid | null;
  commands: GodotRenderingDeviceDrawCommand[];
  ended: boolean;
}

const RESOURCES = new Map<bigint, RetainedResource>();
const LISTS = new Map<number, CommandList>();
const PENDING_LISTS: CommandList[] = [];
const WATCHERS = new Set<(resource: GodotRenderingDeviceResourceSnapshot, operation: string) => void>();
let binding: GodotRenderingDeviceBinding | null = null;
let nextListId = 1;
let deviceInfo: GodotRenderingDeviceInfo = Object.freeze({
  deviceName: 'vgai rendering device', vendorName: 'vgai', deviceType: 4,
  apiName: 'WebGL/WebGPU', apiVersion: '', pipelineCacheUuid: '',
  limits: new Map(), features: new Map(), screenWidth: 0, screenHeight: 0,
});
const TIMESTAMPS: Array<{ name: string; cpuTime: number; gpuTime: number }> = [];

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`godot-compat: RenderingDevice.${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return value;
}

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: RenderingDevice.${member} requires an integer.`);
  return number;
}

function rid(value: unknown, member: string): GodotRid {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'bigint') {
    throw new TypeError(`godot-compat: RenderingDevice.${member} requires RID.`);
  }
  return value as GodotRid;
}

function bytes(value: unknown, member: string): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return Uint8Array.from(value.map((one) => integer(one, member, 0, 255)));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError(`godot-compat: RenderingDevice.${member} requires PackedByteArray.`);
}

function snapshot(resource: RetainedResource): GodotRenderingDeviceResourceSnapshot {
  return Object.freeze({
    rid: resource.rid,
    kind: resource.kind,
    descriptor: resource.descriptor,
    data: resource.data?.slice() ?? null,
    dependencies: Object.freeze([...resource.dependencies]),
    native: resource.native,
    label: resource.label,
    revision: resource.revision,
  });
}

function snapshotList(list: CommandList): GodotRenderingDeviceCommandListSnapshot {
  return Object.freeze({
    id: list.id,
    kind: list.kind,
    framebuffer: list.framebuffer,
    commands: Object.freeze(list.commands.map((command) => Object.freeze({ ...command }))),
    ended: list.ended,
  });
}

function resourceOf(value: unknown, member: string, kind?: GodotRenderingDeviceResourceKind): RetainedResource {
  const resourceRid = rid(value, member);
  const resource = RESOURCES.get(godotRidGetId(resourceRid));
  if (resource === undefined || resource.freed) throw new Error(`godot-compat: RenderingDevice.${member} requires a live RID.`);
  if (kind !== undefined && resource.kind !== kind) {
    throw new TypeError(`godot-compat: RenderingDevice.${member} expected ${kind} RID, received ${resource.kind}.`);
  }
  return resource;
}

function create(
  kind: GodotRenderingDeviceResourceKind,
  descriptor: unknown,
  data: Uint8Array | null = null,
  dependencies: GodotRid[] = [],
): GodotRid {
  for (const dependency of dependencies) resourceOf(dependency, `${kind}_create`);
  const resourceRid = allocateGodotRid();
  const resource: RetainedResource = {
    rid: resourceRid,
    kind,
    descriptor,
    data,
    dependencies: [...dependencies],
    native: null,
    label: '',
    revision: 0,
    freed: false,
  };
  RESOURCES.set(godotRidGetId(resourceRid), resource);
  resource.native = binding?.create(snapshot(resource)) ?? null;
  publish(resource, 'create');
  return resourceRid;
}

function publish(resource: RetainedResource, operation: string): void {
  resource.revision += 1;
  const value = snapshot(resource);
  binding?.update(value, operation);
  for (const watcher of WATCHERS) watcher(value, operation);
}

function updateBytes(resource: RetainedResource, offset: number, replacement: Uint8Array, member: string): void {
  if (resource.data === null) throw new Error(`godot-compat: RenderingDevice.${member} cannot update a resource without byte storage.`);
  if (offset + replacement.byteLength > resource.data.byteLength) {
    throw new RangeError(`godot-compat: RenderingDevice.${member} update exceeds resource byte size.`);
  }
  resource.data.set(replacement, offset);
  publish(resource, member);
}

function listOf(idValue: unknown, member: string, kind?: 'draw' | 'compute'): CommandList {
  const id = integer(idValue, member, 1);
  const list = LISTS.get(id);
  if (list === undefined) throw new Error(`godot-compat: RenderingDevice.${member} requires an active command list.`);
  if (kind !== undefined && list.kind !== kind) throw new TypeError(`godot-compat: RenderingDevice.${member} requires a ${kind} list.`);
  if (list.ended) throw new Error(`godot-compat: RenderingDevice.${member} cannot record after list end.`);
  return list;
}

function command(list: CommandList, operation: string, ...arguments_: unknown[]): void {
  list.commands.push(Object.freeze({ operation, arguments: Object.freeze(arguments_) }));
}

function beginList(kind: 'draw' | 'compute', framebuffer: GodotRid | null): number {
  const list: CommandList = { id: nextListId++, kind, framebuffer, commands: [], ended: false };
  LISTS.set(list.id, list);
  return list.id;
}

function endList(list: CommandList): void {
  list.ended = true;
  LISTS.delete(list.id);
  PENDING_LISTS.push(list);
}

export function bindGodotRenderingDevice(next: GodotRenderingDeviceBinding | null): () => void {
  binding = next;
  if (next !== null) {
    for (const resource of RESOURCES.values()) {
      if (!resource.freed && resource.native === null) resource.native = next.create(snapshot(resource));
    }
  }
  return () => { if (binding === next) binding = null; };
}

export function watchGodotRenderingDevice(
  watcher: (resource: GodotRenderingDeviceResourceSnapshot, operation: string) => void,
): () => void {
  WATCHERS.add(watcher);
  return () => WATCHERS.delete(watcher);
}

export function configureGodotRenderingDeviceInfo(info: Partial<GodotRenderingDeviceInfo>): void {
  deviceInfo = Object.freeze({
    ...deviceInfo,
    ...info,
    limits: info.limits === undefined ? deviceInfo.limits : new Map(info.limits),
    features: info.features === undefined ? deviceInfo.features : new Map(info.features),
  });
}

export function createGodotRdUniform(): GodotRdUniform {
  let type = 0;
  let bindingIndex = 0;
  const ids: GodotRid[] = [];
  return {
    __godotClass: 'RDUniform',
    get uniform_type() { return type; },
    set uniform_type(value: number) { type = integer(value, 'RDUniform.uniform_type', 0, 15); },
    get binding() { return bindingIndex; },
    set binding(value: number) { bindingIndex = integer(value, 'RDUniform.binding'); },
    get ids() { return ids; },
    add_id(value: GodotRid) { ids.push(rid(value, 'RDUniform.add_id')); },
    clear_ids() { ids.length = 0; },
    get_ids() { return [...ids]; },
  };
}

export function godotRenderingDeviceGetResource(value: GodotRid): GodotRenderingDeviceResourceSnapshot {
  return snapshot(resourceOf(value, 'get_resource'));
}

export function godotRenderingDeviceTextureCreate(
  format: GodotRdTextureFormat,
  view: GodotRdTextureView,
  data: unknown[] = [],
): GodotRid {
  if (format?.__godotClass !== 'RDTextureFormat') throw new TypeError('godot-compat: RenderingDevice.texture_create requires RDTextureFormat.');
  if (view?.__godotClass !== 'RDTextureView') throw new TypeError('godot-compat: RenderingDevice.texture_create requires RDTextureView.');
  const layers = data.map((one) => bytes(one, 'texture_create'));
  const total = layers.reduce((sum, one) => sum + one.byteLength, 0);
  const packed = new Uint8Array(total);
  let cursor = 0;
  for (const layer of layers) { packed.set(layer, cursor); cursor += layer.byteLength; }
  return create('texture', { format, view, layerByteLengths: layers.map((one) => one.byteLength) }, packed);
}

export function godotRenderingDeviceTextureCreateShared(view: GodotRdTextureView, withTexture: GodotRid): GodotRid {
  const source = resourceOf(withTexture, 'texture_create_shared', 'texture');
  return create('texture', { ...(source.descriptor as object), view, shared: true }, source.data?.slice() ?? null, [source.rid]);
}

export function godotRenderingDeviceTextureCreateSharedFromSlice(
  view: GodotRdTextureView,
  withTexture: GodotRid,
  layer: unknown,
  mipmap: unknown,
  mipmaps = 1,
  sliceType = 0,
): GodotRid {
  const source = resourceOf(withTexture, 'texture_create_shared_from_slice', 'texture');
  return create('texture', {
    ...(source.descriptor as object), view, shared: true,
    layer: integer(layer, 'texture_create_shared_from_slice.layer'),
    mipmap: integer(mipmap, 'texture_create_shared_from_slice.mipmap'),
    mipmaps: integer(mipmaps, 'texture_create_shared_from_slice.mipmaps', 1),
    sliceType: integer(sliceType, 'texture_create_shared_from_slice.slice_type', 0, 7),
  }, source.data?.slice() ?? null, [source.rid]);
}

export function godotRenderingDeviceTextureUpdate(texture: GodotRid, layer: unknown, data: unknown): void {
  const resource = resourceOf(texture, 'texture_update', 'texture');
  const layerIndex = integer(layer, 'texture_update.layer');
  const descriptor = resource.descriptor as { layerByteLengths?: number[] };
  const lengths = descriptor.layerByteLengths ?? [resource.data?.byteLength ?? 0];
  const layerLength = lengths[layerIndex];
  if (layerLength === undefined) throw new RangeError('godot-compat: RenderingDevice.texture_update layer is out of bounds.');
  const replacement = bytes(data, 'texture_update.data');
  if (replacement.byteLength !== layerLength) throw new RangeError('godot-compat: RenderingDevice.texture_update must preserve layer byte length.');
  const offset = lengths.slice(0, layerIndex).reduce((sum, one) => sum + one, 0);
  updateBytes(resource, offset, replacement, 'texture_update');
}

export function godotRenderingDeviceTextureGetData(texture: GodotRid, layer = 0): Uint8Array {
  const resource = resourceOf(texture, 'texture_get_data', 'texture');
  const layerIndex = integer(layer, 'texture_get_data.layer');
  const lengths = (resource.descriptor as { layerByteLengths?: number[] }).layerByteLengths ?? [resource.data?.byteLength ?? 0];
  const layerLength = lengths[layerIndex];
  if (layerLength === undefined) throw new RangeError('godot-compat: RenderingDevice.texture_get_data layer is out of bounds.');
  const offset = lengths.slice(0, layerIndex).reduce((sum, one) => sum + one, 0);
  return resource.data?.slice(offset, offset + layerLength) ?? new Uint8Array();
}

export function godotRenderingDeviceTextureGetFormat(texture: GodotRid): GodotRdTextureFormat {
  const resource = resourceOf(texture, 'texture_get_format', 'texture');
  return (resource.descriptor as { format: GodotRdTextureFormat }).format;
}

export function godotRenderingDeviceTextureIsShared(texture: GodotRid): boolean {
  return Boolean((resourceOf(texture, 'texture_is_shared', 'texture').descriptor as { shared?: boolean }).shared);
}

export function godotRenderingDeviceTextureIsValid(texture: GodotRid): boolean {
  try { resourceOf(texture, 'texture_is_valid', 'texture'); return true; } catch { return false; }
}

export function godotRenderingDeviceTextureClear(texture: GodotRid, color: unknown, baseMipmap: unknown, mipmapCount: unknown, baseLayer: unknown, layerCount: unknown): void {
  const resource = resourceOf(texture, 'texture_clear', 'texture');
  resource.data?.fill(0);
  resource.descriptor = { ...(resource.descriptor as object), clear: { color, baseMipmap: integer(baseMipmap, 'texture_clear.base_mipmap'), mipmapCount: integer(mipmapCount, 'texture_clear.mipmap_count', 1), baseLayer: integer(baseLayer, 'texture_clear.base_layer'), layerCount: integer(layerCount, 'texture_clear.layer_count', 1) } };
  publish(resource, 'texture_clear');
}

export function godotRenderingDeviceTextureCopy(from: GodotRid, to: GodotRid, fromPosition: unknown, toPosition: unknown, size: unknown, srcMipmap: unknown, dstMipmap: unknown, srcLayer: unknown, dstLayer: unknown): void {
  const source = resourceOf(from, 'texture_copy', 'texture');
  const destination = resourceOf(to, 'texture_copy', 'texture');
  destination.data = source.data?.slice() ?? null;
  destination.descriptor = { ...(destination.descriptor as object), lastCopy: { from: source.rid, fromPosition, toPosition, size, srcMipmap: integer(srcMipmap, 'texture_copy.src_mipmap'), dstMipmap: integer(dstMipmap, 'texture_copy.dst_mipmap'), srcLayer: integer(srcLayer, 'texture_copy.src_layer'), dstLayer: integer(dstLayer, 'texture_copy.dst_layer') } };
  publish(destination, 'texture_copy');
}

export function godotRenderingDeviceTextureResolveMultisample(from: GodotRid, to: GodotRid): void {
  const source = resourceOf(from, 'texture_resolve_multisample', 'texture');
  const destination = resourceOf(to, 'texture_resolve_multisample', 'texture');
  destination.data = source.data?.slice() ?? null;
  destination.descriptor = { ...(destination.descriptor as object), resolvedFrom: source.rid };
  publish(destination, 'texture_resolve_multisample');
}

export function godotRenderingDeviceTextureIsFormatSupportedForUsage(format: unknown, usageBits: unknown): boolean {
  integer(format, 'texture_is_format_supported_for_usage.format');
  integer(usageBits, 'texture_is_format_supported_for_usage.usage_bits', 0, 0xffff_ffff);
  return true;
}

export function godotRenderingDeviceSamplerCreate(state: GodotRdSamplerState): GodotRid {
  if (state?.__godotClass !== 'RDSamplerState') throw new TypeError('godot-compat: RenderingDevice.sampler_create requires RDSamplerState.');
  return create('sampler', { state });
}

function bufferCreate(kind: GodotRenderingDeviceResourceKind, size: unknown, data: unknown, member: string): GodotRid {
  const length = integer(size, `${member}.size`, 1);
  const initial = data === undefined || data === null ? new Uint8Array(length) : bytes(data, `${member}.data`);
  if (initial.byteLength > length) throw new RangeError(`godot-compat: RenderingDevice.${member} initial data exceeds buffer size.`);
  const retained = new Uint8Array(length);
  retained.set(initial);
  return create(kind, { size: length }, retained);
}

export function godotRenderingDeviceVertexBufferCreate(size: unknown, data?: unknown, useAsStorage = false): GodotRid {
  return bufferCreate('vertex_buffer', size, data, 'vertex_buffer_create');
}
export function godotRenderingDeviceIndexBufferCreate(size: unknown, data?: unknown, useRestartIndices = false): GodotRid {
  const result = bufferCreate('index_buffer', size, data, 'index_buffer_create');
  resourceOf(result, 'index_buffer_create').descriptor = { size: integer(size, 'index_buffer_create.size', 1), useRestartIndices: Boolean(useRestartIndices) };
  return result;
}
export function godotRenderingDeviceUniformBufferCreate(size: unknown, data?: unknown): GodotRid { return bufferCreate('uniform_buffer', size, data, 'uniform_buffer_create'); }
export function godotRenderingDeviceStorageBufferCreate(size: unknown, data?: unknown, usage = 0): GodotRid {
  const result = bufferCreate('storage_buffer', size, data, 'storage_buffer_create');
  resourceOf(result, 'storage_buffer_create').descriptor = { size: integer(size, 'storage_buffer_create.size', 1), usage: integer(usage, 'storage_buffer_create.usage') };
  return result;
}
export function godotRenderingDeviceTextureBufferCreate(size: unknown, format: unknown, data?: unknown): GodotRid {
  const result = bufferCreate('texture_buffer', size, data, 'texture_buffer_create');
  resourceOf(result, 'texture_buffer_create').descriptor = { size: integer(size, 'texture_buffer_create.size', 1), format: integer(format, 'texture_buffer_create.format') };
  return result;
}

export function godotRenderingDeviceBufferUpdate(buffer: GodotRid, offset: unknown, size: unknown, data: unknown): void {
  const resource = resourceOf(buffer, 'buffer_update');
  if (!resource.kind.endsWith('_buffer')) throw new TypeError('godot-compat: RenderingDevice.buffer_update requires a buffer RID.');
  const replacement = bytes(data, 'buffer_update.data');
  const length = integer(size, 'buffer_update.size');
  if (replacement.byteLength < length) throw new RangeError('godot-compat: RenderingDevice.buffer_update data is shorter than size.');
  updateBytes(resource, integer(offset, 'buffer_update.offset'), replacement.subarray(0, length), 'buffer_update');
}

export function godotRenderingDeviceBufferGetData(buffer: GodotRid, offset = 0, size = 0): Uint8Array {
  const resource = resourceOf(buffer, 'buffer_get_data');
  if (!resource.kind.endsWith('_buffer') || resource.data === null) throw new TypeError('godot-compat: RenderingDevice.buffer_get_data requires a buffer RID.');
  const start = integer(offset, 'buffer_get_data.offset');
  const length = size === 0 ? resource.data.byteLength - start : integer(size, 'buffer_get_data.size');
  if (start + length > resource.data.byteLength) throw new RangeError('godot-compat: RenderingDevice.buffer_get_data range exceeds buffer size.');
  return resource.data.slice(start, start + length);
}

export function godotRenderingDeviceBufferClear(buffer: GodotRid, offset: unknown, size: unknown): void {
  const resource = resourceOf(buffer, 'buffer_clear');
  if (!resource.kind.endsWith('_buffer') || resource.data === null) throw new TypeError('godot-compat: RenderingDevice.buffer_clear requires a buffer RID.');
  const start = integer(offset, 'buffer_clear.offset');
  const length = integer(size, 'buffer_clear.size');
  if (start + length > resource.data.byteLength) throw new RangeError('godot-compat: RenderingDevice.buffer_clear range exceeds buffer size.');
  resource.data.fill(0, start, start + length);
  publish(resource, 'buffer_clear');
}

export function godotRenderingDeviceBufferCopy(from: GodotRid, to: GodotRid, sourceOffset: unknown, destinationOffset: unknown, size: unknown): void {
  const source = resourceOf(from, 'buffer_copy');
  const destination = resourceOf(to, 'buffer_copy');
  if (!source.kind.endsWith('_buffer') || source.data === null || !destination.kind.endsWith('_buffer') || destination.data === null) throw new TypeError('godot-compat: RenderingDevice.buffer_copy requires buffer RIDs.');
  const fromOffset = integer(sourceOffset, 'buffer_copy.source_offset');
  const toOffset = integer(destinationOffset, 'buffer_copy.destination_offset');
  const length = integer(size, 'buffer_copy.size');
  if (fromOffset + length > source.data.byteLength || toOffset + length > destination.data.byteLength) throw new RangeError('godot-compat: RenderingDevice.buffer_copy range exceeds buffer size.');
  destination.data.set(source.data.slice(fromOffset, fromOffset + length), toOffset);
  publish(destination, 'buffer_copy');
}

export function godotRenderingDeviceShaderCreateFromSpirv(spirv: GodotRdShaderSpirv, name = ''): GodotRid {
  if (spirv?.__godotClass !== 'RDShaderSPIRV') throw new TypeError('godot-compat: RenderingDevice.shader_create_from_spirv requires RDShaderSPIRV.');
  return create('shader', { spirv, name: String(name) });
}

export function godotRenderingDeviceShaderCompileSpirvFromSource(source: GodotRdShaderSource, allowCache = true): GodotRdShaderSpirv {
  if (source?.__godotClass !== 'RDShaderSource') throw new TypeError('godot-compat: RenderingDevice.shader_compile_spirv_from_source requires RDShaderSource.');
  const encoder = new TextEncoder();
  return {
    __godotClass: 'RDShaderSPIRV',
    bytecode_vertex: encoder.encode(source.source_vertex),
    bytecode_fragment: encoder.encode(source.source_fragment),
    bytecode_tesselation_control: encoder.encode(source.source_tesselation_control),
    bytecode_tesselation_evaluation: encoder.encode(source.source_tesselation_evaluation),
    bytecode_compute: encoder.encode(source.source_compute),
    compile_error_vertex: '', compile_error_fragment: '', compile_error_tesselation_control: '',
    compile_error_tesselation_evaluation: '', compile_error_compute: '',
  };
}

export function godotRenderingDeviceShaderGetSpirv(shader: GodotRid): GodotRdShaderSpirv {
  return (resourceOf(shader, 'shader_get_spirv', 'shader').descriptor as { spirv: GodotRdShaderSpirv }).spirv;
}

export function godotRenderingDeviceShaderGetUniformList(shader: GodotRid, setIndex = 0): unknown[] {
  const descriptor = resourceOf(shader, 'shader_get_uniform_list', 'shader').descriptor as { uniformLists?: unknown[][] };
  return [...(descriptor.uniformLists?.[integer(setIndex, 'shader_get_uniform_list.set_index')] ?? [])];
}

export function godotRenderingDeviceShaderGetVertexInputAttributeMask(shader: GodotRid): number {
  const resource = resourceOf(shader, 'shader_get_vertex_input_attribute_mask', 'shader');
  return integer((resource.descriptor as { vertexInputAttributeMask?: number }).vertexInputAttributeMask ?? 0xffff_ffff, 'shader_get_vertex_input_attribute_mask', 0, 0xffff_ffff);
}

export function godotRenderingDeviceUniformSetCreate(uniforms: GodotRdUniform[], shader: GodotRid, shaderSet: unknown): GodotRid {
  resourceOf(shader, 'uniform_set_create', 'shader');
  if (!Array.isArray(uniforms) || uniforms.some((one) => one?.__godotClass !== 'RDUniform')) throw new TypeError('godot-compat: RenderingDevice.uniform_set_create requires RDUniform array.');
  const dependencies = [shader, ...uniforms.flatMap((uniform) => uniform.get_ids())];
  return create('uniform_set', { uniforms: uniforms.map((uniform) => ({ uniform_type: uniform.uniform_type, binding: uniform.binding, ids: uniform.get_ids() })), shaderSet: integer(shaderSet, 'uniform_set_create.shader_set') }, null, dependencies);
}

export function godotRenderingDeviceUniformSetIsValid(uniformSet: GodotRid): boolean {
  try { resourceOf(uniformSet, 'uniform_set_is_valid', 'uniform_set'); return true; } catch { return false; }
}

export function godotRenderingDeviceVertexFormatCreate(attributes: GodotRdVertexAttribute[]): GodotRid {
  if (!Array.isArray(attributes) || attributes.some((one) => one?.__godotClass !== 'RDVertexAttribute')) throw new TypeError('godot-compat: RenderingDevice.vertex_format_create requires RDVertexAttribute array.');
  return create('vertex_format', { attributes: [...attributes] });
}

export function godotRenderingDeviceVertexArrayCreate(vertexCount: unknown, vertexFormat: GodotRid, sourceBuffers: GodotRid[], offsets: unknown[] = []): GodotRid {
  resourceOf(vertexFormat, 'vertex_array_create', 'vertex_format');
  for (const source of sourceBuffers) resourceOf(source, 'vertex_array_create', 'vertex_buffer');
  return create('vertex_array', { vertexCount: integer(vertexCount, 'vertex_array_create.vertex_count'), offsets: offsets.map((one) => integer(one, 'vertex_array_create.offset')) }, null, [vertexFormat, ...sourceBuffers]);
}

export function godotRenderingDeviceIndexArrayCreate(indexBuffer: GodotRid, indexOffset: unknown, indexCount: unknown, indexFormat = 0): GodotRid {
  resourceOf(indexBuffer, 'index_array_create', 'index_buffer');
  return create('index_array', { indexOffset: integer(indexOffset, 'index_array_create.index_offset'), indexCount: integer(indexCount, 'index_array_create.index_count'), indexFormat: integer(indexFormat, 'index_array_create.index_format', 0, 1) }, null, [indexBuffer]);
}

export function godotRenderingDeviceFramebufferFormatCreate(attachments: unknown[], viewCount = 1): GodotRid {
  if (!Array.isArray(attachments)) throw new TypeError('godot-compat: RenderingDevice.framebuffer_format_create requires attachment array.');
  return create('framebuffer_format', { attachments: [...attachments], viewCount: integer(viewCount, 'framebuffer_format_create.view_count', 1) });
}

export function godotRenderingDeviceFramebufferFormatCreateMultipass(attachments: unknown[], passes: unknown[], viewCount = 1): GodotRid {
  if (!Array.isArray(attachments) || !Array.isArray(passes)) throw new TypeError('godot-compat: RenderingDevice.framebuffer_format_create_multipass requires attachment and pass arrays.');
  return create('framebuffer_format', { attachments: [...attachments], passes: [...passes], viewCount: integer(viewCount, 'framebuffer_format_create_multipass.view_count', 1) });
}

export function godotRenderingDeviceFramebufferCreate(textures: GodotRid[], validateWithFormat: GodotRid | null = null, viewCount = 1): GodotRid {
  for (const texture of textures) resourceOf(texture, 'framebuffer_create', 'texture');
  if (validateWithFormat !== null) resourceOf(validateWithFormat, 'framebuffer_create', 'framebuffer_format');
  return create('framebuffer', { viewCount: integer(viewCount, 'framebuffer_create.view_count', 1) }, null, [...textures, ...(validateWithFormat === null ? [] : [validateWithFormat])]);
}

export function godotRenderingDeviceFramebufferCreateMultipass(textures: GodotRid[], passes: unknown[], validateWithFormat: GodotRid | null = null, viewCount = 1): GodotRid {
  for (const texture of textures) resourceOf(texture, 'framebuffer_create_multipass', 'texture');
  if (validateWithFormat !== null) resourceOf(validateWithFormat, 'framebuffer_create_multipass', 'framebuffer_format');
  return create('framebuffer', { passes: [...passes], viewCount: integer(viewCount, 'framebuffer_create_multipass.view_count', 1) }, null, [...textures, ...(validateWithFormat === null ? [] : [validateWithFormat])]);
}

export function godotRenderingDeviceFramebufferGetFormat(framebuffer: GodotRid): GodotRid | null {
  const resource = resourceOf(framebuffer, 'framebuffer_get_format', 'framebuffer');
  return resource.dependencies.find((dependency) => RESOURCES.get(godotRidGetId(dependency))?.kind === 'framebuffer_format') ?? null;
}

export function godotRenderingDeviceFramebufferIsValid(framebuffer: GodotRid): boolean {
  try { resourceOf(framebuffer, 'framebuffer_is_valid', 'framebuffer'); return true; } catch { return false; }
}

export function godotRenderingDeviceRenderPipelineCreate(
  shader: GodotRid,
  framebufferFormat: GodotRid,
  vertexFormat: GodotRid,
  primitive: unknown,
  rasterization: GodotRdPipelineRasterizationState,
  multisample: GodotRdPipelineMultisampleState,
  depthStencil: GodotRdPipelineDepthStencilState,
  colorBlend: GodotRdPipelineColorBlendState,
  dynamicStateFlags = 0,
  forRenderPass = 0,
  specializationConstants: unknown[] = [],
): GodotRid {
  resourceOf(shader, 'render_pipeline_create', 'shader');
  resourceOf(framebufferFormat, 'render_pipeline_create', 'framebuffer_format');
  resourceOf(vertexFormat, 'render_pipeline_create', 'vertex_format');
  return create('render_pipeline', { primitive: integer(primitive, 'render_pipeline_create.primitive'), rasterization, multisample, depthStencil, colorBlend, dynamicStateFlags: integer(dynamicStateFlags, 'render_pipeline_create.dynamic_state_flags'), forRenderPass: integer(forRenderPass, 'render_pipeline_create.for_render_pass'), specializationConstants: [...specializationConstants] }, null, [shader, framebufferFormat, vertexFormat]);
}

export function godotRenderingDeviceComputePipelineCreate(shader: GodotRid, specializationConstants: unknown[] = []): GodotRid {
  resourceOf(shader, 'compute_pipeline_create', 'shader');
  return create('compute_pipeline', { specializationConstants: [...specializationConstants] }, null, [shader]);
}

export function godotRenderingDeviceRenderPipelineIsValid(pipeline: GodotRid): boolean { try { resourceOf(pipeline, 'render_pipeline_is_valid', 'render_pipeline'); return true; } catch { return false; } }
export function godotRenderingDeviceComputePipelineIsValid(pipeline: GodotRid): boolean { try { resourceOf(pipeline, 'compute_pipeline_is_valid', 'compute_pipeline'); return true; } catch { return false; } }

export function godotRenderingDeviceDrawListBegin(framebuffer: GodotRid, initialColorAction = 0, finalColorAction = 0, initialDepthAction = 0, finalDepthAction = 0, clearColorValues: unknown[] = [], clearDepth = 1, clearStencil = 0, region: unknown = null, breadcrumb = 0): number {
  resourceOf(framebuffer, 'draw_list_begin', 'framebuffer');
  const id = beginList('draw', framebuffer);
  command(listOf(id, 'draw_list_begin', 'draw'), 'begin', initialColorAction, finalColorAction, initialDepthAction, finalDepthAction, [...clearColorValues], finite(clearDepth, 'draw_list_begin.clear_depth', 0, 1), integer(clearStencil, 'draw_list_begin.clear_stencil'), region, integer(breadcrumb, 'draw_list_begin.breadcrumb'));
  return id;
}

export function godotRenderingDeviceDrawListBindRenderPipeline(list: unknown, pipeline: GodotRid): void { resourceOf(pipeline, 'draw_list_bind_render_pipeline', 'render_pipeline'); command(listOf(list, 'draw_list_bind_render_pipeline', 'draw'), 'bind_render_pipeline', pipeline); }
export function godotRenderingDeviceDrawListBindUniformSet(list: unknown, uniformSet: GodotRid, setIndex: unknown): void { resourceOf(uniformSet, 'draw_list_bind_uniform_set', 'uniform_set'); command(listOf(list, 'draw_list_bind_uniform_set', 'draw'), 'bind_uniform_set', uniformSet, integer(setIndex, 'draw_list_bind_uniform_set.set_index')); }
export function godotRenderingDeviceDrawListBindVertexArray(list: unknown, vertexArray: GodotRid): void { resourceOf(vertexArray, 'draw_list_bind_vertex_array', 'vertex_array'); command(listOf(list, 'draw_list_bind_vertex_array', 'draw'), 'bind_vertex_array', vertexArray); }
export function godotRenderingDeviceDrawListBindIndexArray(list: unknown, indexArray: GodotRid): void { resourceOf(indexArray, 'draw_list_bind_index_array', 'index_array'); command(listOf(list, 'draw_list_bind_index_array', 'draw'), 'bind_index_array', indexArray); }
export function godotRenderingDeviceDrawListSetPushConstant(list: unknown, buffer: unknown, size: unknown): void { const data = bytes(buffer, 'draw_list_set_push_constant.buffer'); command(listOf(list, 'draw_list_set_push_constant', 'draw'), 'set_push_constant', data.subarray(0, integer(size, 'draw_list_set_push_constant.size'))); }
export function godotRenderingDeviceDrawListSetBlendConstants(list: unknown, color: unknown): void { command(listOf(list, 'draw_list_set_blend_constants', 'draw'), 'set_blend_constants', color); }
export function godotRenderingDeviceDrawListSetLineWidth(list: unknown, width: unknown): void { command(listOf(list, 'draw_list_set_line_width', 'draw'), 'set_line_width', finite(width, 'draw_list_set_line_width.width', Number.MIN_VALUE)); }
export function godotRenderingDeviceDrawListSetScissor(list: unknown, rect: unknown): void { command(listOf(list, 'draw_list_set_scissor', 'draw'), 'set_scissor', rect); }
export function godotRenderingDeviceDrawListSetViewport(list: unknown, rect: unknown): void { command(listOf(list, 'draw_list_set_viewport', 'draw'), 'set_viewport', rect); }
export function godotRenderingDeviceDrawListDraw(list: unknown, useIndices: unknown, instances: unknown = 1, proceduralVertexCount = 0): void { command(listOf(list, 'draw_list_draw', 'draw'), 'draw', Boolean(useIndices), integer(instances, 'draw_list_draw.instances', 1), integer(proceduralVertexCount, 'draw_list_draw.procedural_vertex_count')); }
export function godotRenderingDeviceDrawListDrawIndirect(list: unknown, useIndices: unknown, buffer: GodotRid, offset: unknown, drawCount = 1, stride = 0): void { const indirect = resourceOf(buffer, 'draw_list_draw_indirect'); if (!indirect.kind.endsWith('_buffer')) throw new TypeError('godot-compat: RenderingDevice.draw_list_draw_indirect requires a buffer RID.'); command(listOf(list, 'draw_list_draw_indirect', 'draw'), 'draw_indirect', Boolean(useIndices), buffer, integer(offset, 'draw_list_draw_indirect.offset'), integer(drawCount, 'draw_list_draw_indirect.draw_count', 1), integer(stride, 'draw_list_draw_indirect.stride')); }
export function godotRenderingDeviceDrawListSwitchToNextPass(list: unknown): void { command(listOf(list, 'draw_list_switch_to_next_pass', 'draw'), 'next_pass'); }
export function godotRenderingDeviceDrawListEnd(list: unknown): void { endList(listOf(list, 'draw_list_end', 'draw')); }

export function godotRenderingDeviceComputeListBegin(allowDrawOverlap = false): number { const id = beginList('compute', null); command(listOf(id, 'compute_list_begin', 'compute'), 'begin', Boolean(allowDrawOverlap)); return id; }
export function godotRenderingDeviceComputeListBindComputePipeline(list: unknown, pipeline: GodotRid): void { resourceOf(pipeline, 'compute_list_bind_compute_pipeline', 'compute_pipeline'); command(listOf(list, 'compute_list_bind_compute_pipeline', 'compute'), 'bind_compute_pipeline', pipeline); }
export function godotRenderingDeviceComputeListBindUniformSet(list: unknown, uniformSet: GodotRid, setIndex: unknown): void { resourceOf(uniformSet, 'compute_list_bind_uniform_set', 'uniform_set'); command(listOf(list, 'compute_list_bind_uniform_set', 'compute'), 'bind_uniform_set', uniformSet, integer(setIndex, 'compute_list_bind_uniform_set.set_index')); }
export function godotRenderingDeviceComputeListSetPushConstant(list: unknown, buffer: unknown, size: unknown): void { const data = bytes(buffer, 'compute_list_set_push_constant.buffer'); command(listOf(list, 'compute_list_set_push_constant', 'compute'), 'set_push_constant', data.subarray(0, integer(size, 'compute_list_set_push_constant.size'))); }
export function godotRenderingDeviceComputeListDispatch(list: unknown, xGroups: unknown, yGroups: unknown, zGroups: unknown): void { command(listOf(list, 'compute_list_dispatch', 'compute'), 'dispatch', integer(xGroups, 'compute_list_dispatch.x_groups', 1), integer(yGroups, 'compute_list_dispatch.y_groups', 1), integer(zGroups, 'compute_list_dispatch.z_groups', 1)); }
export function godotRenderingDeviceComputeListDispatchIndirect(list: unknown, buffer: GodotRid, offset: unknown): void { const indirect = resourceOf(buffer, 'compute_list_dispatch_indirect'); if (!indirect.kind.endsWith('_buffer')) throw new TypeError('godot-compat: RenderingDevice.compute_list_dispatch_indirect requires a buffer RID.'); command(listOf(list, 'compute_list_dispatch_indirect', 'compute'), 'dispatch_indirect', buffer, integer(offset, 'compute_list_dispatch_indirect.offset')); }
export function godotRenderingDeviceComputeListAddBarrier(list: unknown): void { command(listOf(list, 'compute_list_add_barrier', 'compute'), 'barrier'); }
export function godotRenderingDeviceComputeListEnd(list: unknown): void { endList(listOf(list, 'compute_list_end', 'compute')); }

export function godotRenderingDeviceBarrier(from: unknown, to: unknown): void {
  const list = beginList('compute', null);
  command(listOf(list, 'barrier', 'compute'), 'barrier', integer(from, 'barrier.from'), integer(to, 'barrier.to'));
  endList(listOf(list, 'barrier', 'compute'));
}

export function godotRenderingDeviceFullBarrier(): void { godotRenderingDeviceBarrier(0x7fff_ffff, 0x7fff_ffff); }

export function godotRenderingDeviceCaptureTimestamp(name: unknown): void {
  const time = typeof performance === 'undefined' ? Date.now() : performance.now();
  TIMESTAMPS.push({ name: String(name), cpuTime: time, gpuTime: time });
}

export function godotRenderingDeviceGetCapturedTimestampsCount(): number { return TIMESTAMPS.length; }
export function godotRenderingDeviceGetCapturedTimestampName(index: unknown): string { return TIMESTAMPS[integer(index, 'get_captured_timestamp_name.index', 0, TIMESTAMPS.length - 1)]?.name ?? ''; }
export function godotRenderingDeviceGetCapturedTimestampCpuTime(index: unknown): number { return TIMESTAMPS[integer(index, 'get_captured_timestamp_cpu_time.index', 0, TIMESTAMPS.length - 1)]?.cpuTime ?? 0; }
export function godotRenderingDeviceGetCapturedTimestampGpuTime(index: unknown): number { return TIMESTAMPS[integer(index, 'get_captured_timestamp_gpu_time.index', 0, TIMESTAMPS.length - 1)]?.gpuTime ?? 0; }

export function godotRenderingDeviceGetDeviceName(): string { return deviceInfo.deviceName; }
export function godotRenderingDeviceGetDeviceVendorName(): string { return deviceInfo.vendorName; }
export function godotRenderingDeviceGetDeviceType(): number { return deviceInfo.deviceType; }
export function godotRenderingDeviceGetDeviceApiName(): string { return deviceInfo.apiName; }
export function godotRenderingDeviceGetDeviceApiVersion(): string { return deviceInfo.apiVersion; }
export function godotRenderingDeviceGetDevicePipelineCacheUuid(): string { return deviceInfo.pipelineCacheUuid; }
export function godotRenderingDeviceLimitGet(limit: unknown): number { return deviceInfo.limits.get(integer(limit, 'limit_get.limit')) ?? 0; }
export function godotRenderingDeviceHasFeature(feature: unknown): boolean { return deviceInfo.features.get(integer(feature, 'has_feature.feature')) ?? false; }
export function godotRenderingDeviceScreenGetWidth(screen = 0): number { integer(screen, 'screen_get_width.screen'); return deviceInfo.screenWidth; }
export function godotRenderingDeviceScreenGetHeight(screen = 0): number { integer(screen, 'screen_get_height.screen'); return deviceInfo.screenHeight; }

export function godotRenderingDeviceSubmit(): void {
  if (LISTS.size !== 0) throw new Error('godot-compat: RenderingDevice.submit requires every command list to be ended.');
  const submitted = PENDING_LISTS.splice(0).map(snapshotList);
  binding?.submit(submitted);
}

export function godotRenderingDeviceSync(): void | Promise<void> { return binding?.sync?.(); }

export function godotRenderingDeviceSetResourceName(value: GodotRid, name: unknown): void {
  const resource = resourceOf(value, 'set_resource_name');
  resource.label = String(name);
  publish(resource, 'set_resource_name');
}

export function godotRenderingDeviceGetMemoryUsage(type = 0): number {
  integer(type, 'get_memory_usage.type', 0, 2);
  let total = 0;
  for (const resource of RESOURCES.values()) if (!resource.freed) total += resource.data?.byteLength ?? 0;
  return total;
}

export function godotRenderingDeviceFreeRid(value: GodotRid): void {
  const resource = resourceOf(value, 'free_rid');
  for (const candidate of RESOURCES.values()) {
    if (!candidate.freed && candidate.dependencies.some((dependency) => godotRidGetId(dependency) === godotRidGetId(resource.rid))) {
      throw new Error(`godot-compat: RenderingDevice.free_rid cannot free ${resource.kind} while ${candidate.kind} depends on it.`);
    }
  }
  const finalSnapshot = snapshot(resource);
  binding?.free(finalSnapshot);
  resource.freed = true;
  resource.native = null;
  resource.data = null;
  resource.dependencies = [];
  for (const watcher of WATCHERS) watcher(finalSnapshot, 'free');
}
