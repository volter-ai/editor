import { GodotGLTFDocumentExtension } from './gltf-document-extension';
import { GodotGLTFNode, GodotGLTFState } from './gltf-state';

export const GODOT_GLTF_DOCUMENT_OK = 0;
export const GODOT_GLTF_DOCUMENT_ERR_CANT_OPEN = 19;
export const GODOT_GLTF_DOCUMENT_ERR_PARSE_ERROR = 43;
export const GODOT_GLTF_DOCUMENT_ERR_INVALID_DATA = 30;

export const GODOT_GLTF_ROOT_NODE_MODE_SINGLE_ROOT = 0;
export const GODOT_GLTF_ROOT_NODE_MODE_KEEP_ROOT = 1;
export const GODOT_GLTF_ROOT_NODE_MODE_MULTI_ROOT = 2;

export const GODOT_GLTF_FLAG_NONE = 0;
export const GODOT_GLTF_FLAG_USE_NAMED_SKIN_BINDS = 1;
export const GODOT_GLTF_FLAG_DISCARD_MESHES_AND_MATERIALS = 2;
export const GODOT_GLTF_FLAG_FORCE_DISABLE_MESH_COMPRESSION = 4;

export interface GodotGLTFDocumentBackend {
  readFile?(path: string): Uint8Array | string | null;
  writeFile?(path: string, data: Uint8Array): boolean | void;
  parseScene?(scene: unknown, state: GodotGLTFState, flags: number): number | void;
  generateScene?(state: GodotGLTFState, bakeFPS: number, trimming: boolean, removeImmutableTracks: boolean): unknown;
  serializeState?(state: GodotGLTFState): Uint8Array | null;
}

export interface GodotGLTFGeneratedNode {
  name: string;
  transform: unknown;
  visible: boolean;
  mesh: number;
  camera: number;
  light: number;
  skin: number;
  skeleton: number;
  children: GodotGLTFGeneratedNode[];
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function pad4(length: number): number {
  return (length + 3) & ~3;
}

function readU32(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16) | ((data[offset + 3] ?? 0) << 24)) >>> 0;
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

function parseGLB(data: Uint8Array): { json: Readonly<Record<string, unknown>>; binary: Uint8Array } | null {
  if (data.length < 20 || readU32(data, 0) !== 0x46546c67 || readU32(data, 4) !== 2) return null;
  const declaredLength = readU32(data, 8);
  if (declaredLength > data.length) return null;
  let cursor = 12;
  let json: Readonly<Record<string, unknown>> | null = null;
  let binary = new Uint8Array();
  while (cursor + 8 <= declaredLength) {
    const chunkLength = readU32(data, cursor);
    const chunkType = readU32(data, cursor + 4);
    cursor += 8;
    if (cursor + chunkLength > declaredLength) return null;
    const chunk = Uint8Array.from(data.subarray(cursor, cursor + chunkLength));
    if (chunkType === 0x4e4f534a) {
      const text = utf8Decode(chunk).replace(/[\u0000\u0020]+$/g, '');
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      json = parsed as Readonly<Record<string, unknown>>;
    } else if (chunkType === 0x004e4942) binary = Uint8Array.from(chunk);
    cursor += chunkLength;
  }
  return json ? { json, binary } : null;
}

function serializeGLB(json: Readonly<Record<string, unknown>>, binary: Uint8Array): Uint8Array {
  const rawJson = utf8Encode(JSON.stringify(json));
  const jsonLength = pad4(rawJson.length);
  const binaryLength = binary.length ? pad4(binary.length) : 0;
  const output = new Uint8Array(12 + 8 + jsonLength + (binaryLength ? 8 + binaryLength : 0));
  writeU32(output, 0, 0x46546c67);
  writeU32(output, 4, 2);
  writeU32(output, 8, output.length);
  writeU32(output, 12, jsonLength);
  writeU32(output, 16, 0x4e4f534a);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(rawJson, 20);
  if (binaryLength) {
    const offset = 20 + jsonLength;
    writeU32(output, offset, binaryLength);
    writeU32(output, offset + 4, 0x004e4942);
    output.set(binary, offset + 8);
  }
  return output;
}

function pathDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

function pathFilename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function nodeFromState(state: GodotGLTFState, index: number, visited: Set<number>): GodotGLTFGeneratedNode | null {
  if (visited.has(index)) return null;
  const source = state.get_nodes()[index];
  if (!(source instanceof GodotGLTFNode)) return null;
  visited.add(index);
  const children: GodotGLTFGeneratedNode[] = [];
  for (const childIndex of source.get_children()) {
    const child = nodeFromState(state, childIndex, visited);
    if (child) children.push(child);
  }
  visited.delete(index);
  return {
    name: source.get_original_name() || `Node${index}`,
    transform: source.get_xform(),
    visible: source.get_visible(),
    mesh: source.get_mesh(),
    camera: source.get_camera(),
    light: source.get_light(),
    skin: source.get_skin(),
    skeleton: source.get_skeleton(),
    children,
  };
}

export class GodotGLTFDocument {
  private static readonly extensions: GodotGLTFDocumentExtension[] = [];
  private imageFormat = 'PNG';
  private lossyQuality = 0.75;
  private rootNodeMode = GODOT_GLTF_ROOT_NODE_MODE_SINGLE_ROOT;

  constructor(private readonly backend: GodotGLTFDocumentBackend = {}) {}

  static register_gltf_document_extension(extension: GodotGLTFDocumentExtension, firstPriority = false): void {
    const index = this.extensions.indexOf(extension);
    if (index >= 0) this.extensions.splice(index, 1);
    if (firstPriority) this.extensions.unshift(extension);
    else this.extensions.push(extension);
  }

  static unregister_gltf_document_extension(extension: GodotGLTFDocumentExtension): void {
    const index = this.extensions.indexOf(extension);
    if (index >= 0) this.extensions.splice(index, 1);
  }

  static get_registered_extensions(): readonly GodotGLTFDocumentExtension[] {
    return [...this.extensions];
  }

  set_image_format(imageFormat: string): void { this.imageFormat = imageFormat; }
  get_image_format(): string { return this.imageFormat; }
  set_lossy_quality(lossyQuality: number): void { this.lossyQuality = Math.max(0, Math.min(1, lossyQuality)); }
  get_lossy_quality(): number { return this.lossyQuality; }
  set_root_node_mode(rootNodeMode: number): void { this.rootNodeMode = rootNodeMode; }
  get_root_node_mode(): number { return this.rootNodeMode; }

  append_from_file(path: string, state: GodotGLTFState, flags = GODOT_GLTF_FLAG_NONE, basePath = ''): number {
    const data = this.backend.readFile?.(path);
    if (data === null || data === undefined) return GODOT_GLTF_DOCUMENT_ERR_CANT_OPEN;
    state.set_filename(pathFilename(path));
    return this.append_from_buffer(typeof data === 'string' ? utf8Encode(data) : data, basePath || pathDirectory(path), state, flags);
  }

  append_from_buffer(bytes: Uint8Array | readonly number[], basePath: string, state: GodotGLTFState, flags = GODOT_GLTF_FLAG_NONE): number {
    const data = Uint8Array.from(bytes);
    let json: Readonly<Record<string, unknown>> = {};
    let binary: Uint8Array<ArrayBufferLike> = new Uint8Array();
    try {
      const glb = parseGLB(data);
      if (glb) ({ json, binary } = glb);
      else {
        const parsed = JSON.parse(utf8Decode(data)) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return GODOT_GLTF_DOCUMENT_ERR_INVALID_DATA;
        json = parsed as Readonly<Record<string, unknown>>;
      }
    } catch {
      return GODOT_GLTF_DOCUMENT_ERR_PARSE_ERROR;
    }

    state.set_json(json);
    state.set_base_path(basePath);
    state.set_glb_data(binary);
    state.set_use_named_skin_binds((flags & GODOT_GLTF_FLAG_USE_NAMED_SKIN_BINDS) !== 0);
    const asset = json['asset'];
    if (asset && typeof asset === 'object') {
      const version = String((asset as Record<string, unknown>)['version'] ?? '2.0').split('.');
      state.set_major_version(Number(version[0] ?? '2') || 2);
      state.set_minor_version(Number(version[1] ?? '0') || 0);
      state.set_copyright(String((asset as Record<string, unknown>)['copyright'] ?? ''));
    }
    const used = Array.isArray(json['extensionsUsed']) ? json['extensionsUsed'] : [];
    const required = new Set(Array.isArray(json['extensionsRequired']) ? json['extensionsRequired'].map(String) : []);
    for (const extension of used) state.add_used_extension(String(extension), required.has(String(extension)));
    for (const extension of GodotGLTFDocument.extensions) {
      extension._import_preflight(state, used.map(String));
      extension._import_post_parse(state);
      extension._import_pre_generate(state);
    }
    return GODOT_GLTF_DOCUMENT_OK;
  }

  append_from_scene(node: unknown, state: GodotGLTFState, flags = GODOT_GLTF_FLAG_NONE): number {
    state.set_use_named_skin_binds((flags & GODOT_GLTF_FLAG_USE_NAMED_SKIN_BINDS) !== 0);
    for (const extension of GodotGLTFDocument.extensions) extension._export_preflight(state, node);
    const result = this.backend.parseScene?.(node, state, flags);
    if (typeof result === 'number' && result !== GODOT_GLTF_DOCUMENT_OK) return result;
    for (const extension of GodotGLTFDocument.extensions) {
      extension._export_post_convert(state, node);
      extension._export_preserialize(state);
    }
    return GODOT_GLTF_DOCUMENT_OK;
  }

  generate_scene(state: GodotGLTFState, bakeFPS = 30, trimming = false, removeImmutableTracks = true): unknown {
    state.set_bake_fps(bakeFPS);
    const generated = this.backend.generateScene?.(state, bakeFPS, trimming, removeImmutableTracks);
    if (generated !== undefined) {
      for (const extension of GodotGLTFDocument.extensions) extension._import_post(state, generated);
      return generated;
    }
    const roots = state.get_root_nodes().map((index) => nodeFromState(state, index, new Set())).filter((node): node is GodotGLTFGeneratedNode => node !== null);
    const scene = this.rootNodeMode === GODOT_GLTF_ROOT_NODE_MODE_SINGLE_ROOT && roots.length === 1
      ? roots[0]!
      : { name: state.get_scene_name() || 'Scene', children: roots };
    for (const extension of GodotGLTFDocument.extensions) extension._import_post(state, scene);
    return scene;
  }

  generate_buffer(state: GodotGLTFState): Uint8Array {
    const generated = this.backend.serializeState?.(state);
    if (generated) return generated;
    for (const extension of GodotGLTFDocument.extensions) extension._export_post(state);
    return serializeGLB(state.get_json(), state.get_glb_data());
  }

  write_to_filesystem(state: GodotGLTFState, path: string): number {
    if (!this.backend.writeFile) return GODOT_GLTF_DOCUMENT_ERR_CANT_OPEN;
    const result = this.backend.writeFile(path, this.generate_buffer(state));
    return result === false ? GODOT_GLTF_DOCUMENT_ERR_CANT_OPEN : GODOT_GLTF_DOCUMENT_OK;
  }
}

export function createGodotGLTFDocument(backend: GodotGLTFDocumentBackend = {}): GodotGLTFDocument {
  return new GodotGLTFDocument(backend);
}
