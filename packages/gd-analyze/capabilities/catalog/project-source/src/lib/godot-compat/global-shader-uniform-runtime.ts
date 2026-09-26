import { registerGodotObjectIdentity } from './object';

export type GodotGlobalUniformType = 'float' | 'int' | 'uint' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'mat3' | 'mat4' | 'color';

export interface GodotGlobalUniformDescriptor {
  readonly name: string;
  readonly type: GodotGlobalUniformType;
  readonly defaultValue: unknown;
  readonly arraySize?: number;
  readonly group?: string;
}

export interface GodotGlobalUniformLayoutEntry {
  readonly name: string;
  readonly type: GodotGlobalUniformType;
  readonly offset: number;
  readonly size: number;
  readonly alignment: number;
  readonly arraySize: number;
  readonly arrayStride: number;
  readonly group: string;
}

export interface GodotGlobalUniformState extends GodotGlobalUniformLayoutEntry {
  readonly defaultValue: unknown;
  readonly value: unknown;
  readonly overrideValue: unknown;
  readonly effectiveValue: unknown;
  readonly revision: number;
  readonly dirty: boolean;
}

export interface GodotGlobalUniformUpload {
  readonly frame: number;
  readonly offset: number;
  readonly size: number;
  readonly data: Uint8Array;
  readonly parameters: readonly string[];
}

export interface GodotGlobalUniformBackend {
  resize?(size: number): void | Promise<void>;
  upload(upload: GodotGlobalUniformUpload): void | Promise<void>;
}

export interface GodotGlobalUniformFrameResult {
  readonly frame: number;
  readonly uploads: readonly GodotGlobalUniformUpload[];
  readonly uploadedParameters: number;
  readonly uploadedBytes: number;
  readonly remainingDirty: number;
}

export interface GodotGlobalUniformRuntimeSnapshot {
  readonly frame: number;
  readonly byteLength: number;
  readonly parameters: readonly GodotGlobalUniformState[];
  readonly dirtyParameters: number;
  readonly groups: readonly string[];
  readonly uploads: number;
  readonly uploadedBytes: number;
  readonly generation: number;
  readonly layoutRevision: number;
  readonly lastFrame: GodotGlobalUniformFrameResult | null;
}

interface UniformEntry {
  descriptor: { name: string; type: GodotGlobalUniformType; defaultValue: unknown; arraySize: number; group: string };
  layout: GodotGlobalUniformLayoutEntry;
  value: unknown;
  overrideValue: unknown;
  revision: number;
  dirty: boolean;
  order: number;
}

const TYPES = new Set<GodotGlobalUniformType>(['float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4', 'mat3', 'mat4', 'color']);
const TYPE_LAYOUT: Record<GodotGlobalUniformType, { size: number; alignment: number }> = {
  float: { size: 4, alignment: 4 }, int: { size: 4, alignment: 4 }, uint: { size: 4, alignment: 4 }, bool: { size: 4, alignment: 4 },
  vec2: { size: 8, alignment: 8 }, vec3: { size: 16, alignment: 16 }, vec4: { size: 16, alignment: 16 },
  mat3: { size: 48, alignment: 16 }, mat4: { size: 64, alignment: 16 }, color: { size: 16, alignment: 16 },
};

function integer(value: unknown, member: string, minimum = 0): number {
  const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum) throw new RangeError(`godot-compat: GlobalShaderUniformRuntime.${member} requires integer >= ${minimum}.`); return result;
}
function name(value: unknown, member: string, allowEmpty = false): string {
  const result = String(value); if (!allowEmpty && result.length === 0) throw new RangeError(`godot-compat: GlobalShaderUniformRuntime.${member} requires nonempty StringName.`); return result;
}
function type(value: unknown): GodotGlobalUniformType {
  if (!TYPES.has(value as GodotGlobalUniformType)) throw new TypeError(`godot-compat: unknown global uniform type ${String(value)}.`); return value as GodotGlobalUniformType;
}
function align(value: number, alignment: number): number { return Math.ceil(value / alignment) * alignment; }
function effective(entry: UniformEntry): unknown { return entry.overrideValue === undefined ? entry.value : entry.overrideValue; }

function components(value: unknown, count: number, member: string): number[] {
  let result: unknown[];
  if (Array.isArray(value) || ArrayBuffer.isView(value)) result = Array.from(value as ArrayLike<unknown>);
  else if (typeof value === 'object' && value !== null) {
    const keys = count <= 4 ? ['x', 'y', 'z', 'w'].slice(0, count) : Array.from({ length: count }, (_, index) => String(index));
    if (count === 4 && 'r' in value && 'g' in value && 'b' in value) result = [value.r, value.g, value.b, 'a' in value ? value.a : 1];
    else result = keys.map((key) => Reflect.get(value, key));
  } else throw new TypeError(`godot-compat: global uniform ${member} requires ${count} numeric components.`);
  if (result.length < count) throw new RangeError(`godot-compat: global uniform ${member} requires ${count} components.`);
  return result.slice(0, count).map((one) => { const number = Number(one); if (!Number.isFinite(number)) throw new TypeError(`godot-compat: global uniform ${member} requires finite components.`); return number; });
}

function validateValue(value: unknown, uniformType: GodotGlobalUniformType, arraySize: number, member: string): unknown {
  if (arraySize > 1) {
    if (!Array.isArray(value) || value.length !== arraySize) throw new RangeError(`godot-compat: global uniform ${member} requires array of ${arraySize}.`);
    return Object.freeze(value.map((one, index) => validateValue(one, uniformType, 1, `${member}[${index}]`)));
  }
  if (uniformType === 'float') { const result = Number(value); if (!Number.isFinite(result)) throw new TypeError(`godot-compat: global uniform ${member} requires float.`); return result; }
  if (uniformType === 'int') { const result = Number(value); if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: global uniform ${member} requires int.`); return result; }
  if (uniformType === 'uint') return integer(value, member);
  if (uniformType === 'bool') { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: global uniform ${member} requires bool.`); return value; }
  const count = uniformType === 'vec2' ? 2 : uniformType === 'vec3' ? 3 : uniformType === 'mat3' ? 9 : uniformType === 'mat4' ? 16 : 4;
  return Object.freeze(components(value, count, member));
}

function state(entry: UniformEntry): GodotGlobalUniformState {
  return Object.freeze({
    ...entry.layout, defaultValue: entry.descriptor.defaultValue, value: entry.value,
    overrideValue: entry.overrideValue, effectiveValue: effective(entry), revision: entry.revision, dirty: entry.dirty,
  });
}

export class GodotGlobalShaderUniformRuntime {
  public readonly __godotClass = 'GlobalShaderUniformRuntime';
  private readonly backend: GodotGlobalUniformBackend;
  private readonly entries = new Map<string, UniformEntry>();
  private readonly buffer = new ArrayBuffer(0);
  private data = new Uint8Array(this.buffer);
  private frameValue = 0;
  private nextOrder = 0;
  private generationValue = 0;
  private layoutRevision = 0;
  private uploadLimitValue = 64;
  private uploads = 0;
  private uploadedBytes = 0;
  private uploading = false;
  private lastFrame: GodotGlobalUniformFrameResult | null = null;
  private readonly watchers = new Set<(snapshot: GodotGlobalUniformRuntimeSnapshot) => void>();

  public constructor(backend: GodotGlobalUniformBackend) {
    if (typeof backend?.upload !== 'function') throw new TypeError('godot-compat: GlobalShaderUniformRuntime requires upload backend.');
    this.backend = backend; registerGodotObjectIdentity(this, 'GlobalShaderUniformRuntime');
  }

  public add(value: GodotGlobalUniformDescriptor): void {
    const uniformName = name(value.name, 'name'); if (this.entries.has(uniformName)) throw new Error(`godot-compat: global uniform ${uniformName} already exists.`);
    const uniformType = type(value.type), arraySize = integer(value.arraySize ?? 1, 'array_size', 1);
    const defaultValue = validateValue(value.defaultValue, uniformType, arraySize, uniformName);
    this.entries.set(uniformName, {
      descriptor: { name: uniformName, type: uniformType, defaultValue, arraySize, group: name(value.group ?? '', 'group', true) },
      layout: { name: uniformName, type: uniformType, offset: 0, size: 0, alignment: 0, arraySize, arrayStride: 0, group: String(value.group ?? '') },
      value: defaultValue, overrideValue: undefined, revision: 1, dirty: true, order: this.nextOrder++,
    });
    this.rebuildLayout(); this.generationValue += 1; this.publish();
  }

  public remove(nameValue: unknown): boolean {
    const uniformName = name(nameValue, 'name'); if (!this.entries.delete(uniformName)) return false;
    this.rebuildLayout(); this.generationValue += 1; this.publish(); return true;
  }

  private requireEntry(value: unknown): UniformEntry {
    const uniformName = name(value, 'name'), entry = this.entries.get(uniformName);
    if (entry === undefined) throw new Error(`godot-compat: global uniform ${uniformName} does not exist.`); return entry;
  }

  private rebuildLayout(): void {
    let offset = 0;
    for (const entry of [...this.entries.values()].sort((left, right) => left.order - right.order)) {
      const base = TYPE_LAYOUT[entry.descriptor.type], arrayStride = entry.descriptor.arraySize > 1 ? align(base.size, 16) : base.size;
      const alignment = entry.descriptor.arraySize > 1 ? Math.max(16, base.alignment) : base.alignment;
      offset = align(offset, alignment);
      entry.layout = Object.freeze({
        name: entry.descriptor.name, type: entry.descriptor.type, offset,
        size: arrayStride * entry.descriptor.arraySize, alignment, arraySize: entry.descriptor.arraySize,
        arrayStride, group: entry.descriptor.group,
      });
      offset += entry.layout.size; entry.dirty = true;
    }
    const next = new Uint8Array(align(offset, 16)); this.data = next; this.layoutRevision += 1;
    for (const entry of this.entries.values()) this.writeEntry(entry);
    void this.backend.resize?.(this.data.byteLength);
  }

  public set(nameValue: unknown, value: unknown): void {
    const entry = this.requireEntry(nameValue); entry.value = validateValue(value, entry.descriptor.type, entry.descriptor.arraySize, entry.descriptor.name);
    entry.revision += 1; entry.dirty = true; this.writeEntry(entry); this.publish();
  }

  public setOverride(nameValue: unknown, value: unknown): void {
    const entry = this.requireEntry(nameValue);
    entry.overrideValue = value === null || value === undefined ? undefined : validateValue(value, entry.descriptor.type, entry.descriptor.arraySize, entry.descriptor.name);
    entry.revision += 1; entry.dirty = true; this.writeEntry(entry); this.publish();
  }

  public get(nameValue: unknown): unknown { return effective(this.requireEntry(nameValue)); }

  private writeEntry(entry: UniformEntry): void {
    const view = new DataView(this.data.buffer), values = entry.descriptor.arraySize > 1 ? effective(entry) as readonly unknown[] : [effective(entry)];
    for (let arrayIndex = 0; arrayIndex < values.length; arrayIndex += 1) {
      const offset = entry.layout.offset + arrayIndex * entry.layout.arrayStride, value = values[arrayIndex];
      if (entry.descriptor.type === 'float') view.setFloat32(offset, Number(value), true);
      else if (entry.descriptor.type === 'int') view.setInt32(offset, Number(value), true);
      else if (entry.descriptor.type === 'uint') view.setUint32(offset, Number(value), true);
      else if (entry.descriptor.type === 'bool') view.setUint32(offset, value ? 1 : 0, true);
      else {
        const count = entry.descriptor.type === 'vec2' ? 2 : entry.descriptor.type === 'vec3' ? 3 : entry.descriptor.type === 'mat3' ? 9 : entry.descriptor.type === 'mat4' ? 16 : 4;
        const packed = value as readonly number[];
        if (entry.descriptor.type === 'mat3') {
          for (let column = 0; column < 3; column += 1) for (let row = 0; row < 3; row += 1) view.setFloat32(offset + column * 16 + row * 4, packed[column * 3 + row]!, true);
        } else for (let index = 0; index < count; index += 1) view.setFloat32(offset + index * 4, packed[index]!, true);
      }
    }
  }

  private dirtyUploads(frame: number): GodotGlobalUniformUpload[] {
    const dirty = [...this.entries.values()].filter((entry) => entry.dirty).sort((left, right) => left.layout.offset - right.layout.offset).slice(0, this.uploadLimitValue);
    const uploads: GodotGlobalUniformUpload[] = []; let group: UniformEntry[] = [];
    const flush = () => {
      if (group.length === 0) return; const start = group[0]!.layout.offset, last = group[group.length - 1]!, end = last.layout.offset + last.layout.size;
      uploads.push(Object.freeze({ frame, offset: start, size: end - start, data: this.data.slice(start, end), parameters: Object.freeze(group.map((entry) => entry.descriptor.name)) })); group = [];
    };
    for (const entry of dirty) {
      const previous = group[group.length - 1]; if (previous !== undefined && entry.layout.offset > previous.layout.offset + previous.layout.size) flush(); group.push(entry);
    }
    flush(); return uploads;
  }

  public async uploadFrame(frameValue: unknown): Promise<GodotGlobalUniformFrameResult> {
    const frame = integer(frameValue, 'frame'); if (frame < this.frameValue) throw new RangeError('godot-compat: global uniform frame cannot move backwards.');
    if (this.uploading) throw new Error('godot-compat: global uniform upload already in progress.'); this.frameValue = frame; this.uploading = true;
    try {
      const uploads = this.dirtyUploads(frame); let uploadedParameters = 0, bytes = 0;
      for (const upload of uploads) {
        await this.backend.upload(upload); bytes += upload.size; uploadedParameters += upload.parameters.length;
        for (const parameter of upload.parameters) this.entries.get(parameter)!.dirty = false;
      }
      this.uploads += uploads.length; this.uploadedBytes += bytes;
      this.lastFrame = Object.freeze({ frame, uploads: Object.freeze(uploads), uploadedParameters, uploadedBytes: bytes, remainingDirty: [...this.entries.values()].filter((entry) => entry.dirty).length });
      this.publish(); return this.lastFrame;
    } finally { this.uploading = false; }
  }

  public markGroupDirty(groupValue: unknown): number {
    const group = name(groupValue, 'group', true); let count = 0;
    for (const entry of this.entries.values()) if (entry.descriptor.group === group) { entry.dirty = true; count += 1; }
    this.publish(); return count;
  }
  public setUploadLimit(value: unknown): void { this.uploadLimitValue = integer(value, 'upload_limit', 1); }
  public getLayout(): readonly GodotGlobalUniformLayoutEntry[] { return Object.freeze([...this.entries.values()].sort((left, right) => left.layout.offset - right.layout.offset).map((entry) => entry.layout)); }
  public getBufferData(): Uint8Array { return this.data.slice(); }
  public getSnapshot(): GodotGlobalUniformRuntimeSnapshot {
    const parameters = [...this.entries.values()].sort((left, right) => left.order - right.order).map(state);
    return Object.freeze({
      frame: this.frameValue, byteLength: this.data.byteLength, parameters: Object.freeze(parameters),
      dirtyParameters: parameters.filter((entry) => entry.dirty).length, groups: Object.freeze([...new Set(parameters.map((entry) => entry.group))]),
      uploads: this.uploads, uploadedBytes: this.uploadedBytes, generation: this.generationValue,
      layoutRevision: this.layoutRevision, lastFrame: this.lastFrame,
    });
  }
  public watch(watcher: (snapshot: GodotGlobalUniformRuntimeSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.getSnapshot()); return () => this.watchers.delete(watcher); }
  private publish(): void { const value = this.getSnapshot(); for (const watcher of this.watchers) watcher(value); }
  public clear(): void {
    if (this.uploading) throw new Error('godot-compat: cannot clear global uniforms during upload.');
    this.entries.clear(); this.rebuildLayout(); this.generationValue += 1; this.lastFrame = null; this.publish();
  }
  public dispose(): void { this.clear(); this.watchers.clear(); }
}

export function createGodotGlobalShaderUniformRuntime(backend: GodotGlobalUniformBackend): GodotGlobalShaderUniformRuntime {
  return new GodotGlobalShaderUniformRuntime(backend);
}
