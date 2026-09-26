import {
  Data3DTexture,
  DataArrayTexture,
  DataTexture,
  NearestFilter,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from 'three';
import { godotRidGetId, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import {
  godotRenderingDeviceGetResource,
  watchGodotRenderingDevice,
  type GodotRenderingDeviceResourceSnapshot,
} from './rendering-device';
import type { GodotRdTextureFormat } from './rendering-device-resources';

const INVALID_RID: GodotRid = Object.freeze({ id: 0n });

function dimension(value: unknown, member: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 0x7fff_ffff) throw new RangeError(`godot-compat: ${member} requires positive integer.`);
  return value as number;
}

function rid(value: unknown, member: string): GodotRid {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'bigint') throw new TypeError(`godot-compat: ${member} requires RID.`);
  return value as GodotRid;
}

function textureSnapshot(value: GodotRid, member: string): GodotRenderingDeviceResourceSnapshot | null {
  if (godotRidGetId(value) === 0n) return null;
  const snapshot = godotRenderingDeviceGetResource(value);
  if (snapshot.kind !== 'texture') throw new TypeError(`godot-compat: ${member} requires RenderingDevice texture RID.`);
  return snapshot;
}

function textureFormat(snapshot: GodotRenderingDeviceResourceSnapshot | null): GodotRdTextureFormat | null {
  return snapshot === null ? null : (snapshot.descriptor as { format?: GodotRdTextureFormat }).format ?? null;
}

function rgbaBytes(snapshot: GodotRenderingDeviceResourceSnapshot | null, width: number, height: number, depth = 1): Uint8Array {
  const required = width * height * depth * 4;
  if (snapshot?.data !== null && snapshot?.data !== undefined && snapshot.data.byteLength >= required) return snapshot.data.slice(0, required);
  return new Uint8Array(required);
}

interface TextureRidState {
  rid: GodotRid;
  native: Texture | null;
  unwatch: (() => void) | null;
}

function bindRidUpdates(state: TextureRidState, rebuild: () => void): void {
  state.unwatch?.();
  const resourceId = godotRidGetId(state.rid);
  if (resourceId === 0n) { state.unwatch = null; return; }
  state.unwatch = watchGodotRenderingDevice((snapshot) => {
    if (godotRidGetId(snapshot.rid) === resourceId && snapshot.kind === 'texture') rebuild();
  });
}

export class GodotTexture2DRd {
  public readonly __godotClass = 'Texture2DRD';
  private readonly state: TextureRidState = { rid: INVALID_RID, native: null, unwatch: null };

  public constructor() {
    registerGodotObjectIdentity(this, 'Texture2DRD');
    bindGodotResourceProtocol<GodotTexture2DRd>(this, { createDuplicate: (source) => { const copy = new GodotTexture2DRd(); copy.setTextureRdRid(source.state.rid); return copy; } });
  }
  public get texture_rd_rid(): GodotRid { return this.getTextureRdRid(); }
  public set texture_rd_rid(value: GodotRid) { this.setTextureRdRid(value); }
  public setTextureRdRid(value: unknown): void { this.state.rid = rid(value, 'Texture2DRD.texture_rd_rid'); textureSnapshot(this.state.rid, 'Texture2DRD.texture_rd_rid'); bindRidUpdates(this.state, () => this.rebuild()); this.rebuild(); }
  public getTextureRdRid(): GodotRid { return this.state.rid; }
  public getWidth(): number { return textureFormat(textureSnapshot(this.state.rid, 'Texture2DRD.get_width'))?.width ?? 0; }
  public getHeight(): number { return textureFormat(textureSnapshot(this.state.rid, 'Texture2DRD.get_height'))?.height ?? 0; }
  public hasAlpha(): boolean { return true; }
  public getNativeTexture(): Texture | null { return this.state.native; }
  public dispose(): void { this.state.unwatch?.(); this.state.unwatch = null; this.state.native?.dispose(); this.state.native = null; }
  private rebuild(): void {
    const snapshot = textureSnapshot(this.state.rid, 'Texture2DRD.texture_rd_rid');
    const format = textureFormat(snapshot);
    this.state.native?.dispose(); this.state.native = null;
    if (format !== null) {
      const native = new DataTexture(rgbaBytes(snapshot, format.width, format.height), format.width, format.height, RGBAFormat, UnsignedByteType);
      native.needsUpdate = true; native.name = 'Texture2DRD'; this.state.native = native;
    }
    godotResourceEmitChanged(this);
  }
}

abstract class GodotTextureLayeredRd {
  public readonly __godotClass: string;
  protected readonly state: TextureRidState = { rid: INVALID_RID, native: null, unwatch: null };
  protected constructor(className: string) { this.__godotClass = className; registerGodotObjectIdentity(this, className); }
  public get texture_rd_rid(): GodotRid { return this.getTextureRdRid(); }
  public set texture_rd_rid(value: GodotRid) { this.setTextureRdRid(value); }
  public setTextureRdRid(value: unknown): void { this.state.rid = rid(value, `${this.__godotClass}.texture_rd_rid`); textureSnapshot(this.state.rid, `${this.__godotClass}.texture_rd_rid`); bindRidUpdates(this.state, () => this.rebuild()); this.rebuild(); }
  public getTextureRdRid(): GodotRid { return this.state.rid; }
  public getWidth(): number { return textureFormat(textureSnapshot(this.state.rid, `${this.__godotClass}.get_width`))?.width ?? 0; }
  public getHeight(): number { return textureFormat(textureSnapshot(this.state.rid, `${this.__godotClass}.get_height`))?.height ?? 0; }
  public getLayers(): number { return textureFormat(textureSnapshot(this.state.rid, `${this.__godotClass}.get_layers`))?.array_layers ?? 0; }
  public hasAlpha(): boolean { return true; }
  public getNativeTexture(): Texture | null { return this.state.native; }
  public dispose(): void { this.state.unwatch?.(); this.state.unwatch = null; this.state.native?.dispose(); this.state.native = null; }
  protected rebuild(): void {
    const snapshot = textureSnapshot(this.state.rid, `${this.__godotClass}.texture_rd_rid`), format = textureFormat(snapshot);
    this.state.native?.dispose(); this.state.native = null;
    if (format !== null) {
      const layers = Math.max(format.array_layers, 1);
      const native = new DataArrayTexture(Uint8Array.from(rgbaBytes(snapshot, format.width, format.height, layers)), format.width, format.height, layers);
      native.format = RGBAFormat; native.type = UnsignedByteType; native.needsUpdate = true; native.name = this.__godotClass; this.state.native = native;
    }
    godotResourceEmitChanged(this);
  }
}

export class GodotTexture2DArrayRd extends GodotTextureLayeredRd {
  public constructor() { super('Texture2DArrayRD'); bindGodotResourceProtocol<GodotTexture2DArrayRd>(this, { createDuplicate: (source) => { const copy = new GodotTexture2DArrayRd(); copy.setTextureRdRid(source.state.rid); return copy; } }); }
}
export class GodotCubemapRd extends GodotTextureLayeredRd {
  public constructor() { super('CubemapRD'); bindGodotResourceProtocol<GodotCubemapRd>(this, { createDuplicate: (source) => { const copy = new GodotCubemapRd(); copy.setTextureRdRid(source.state.rid); return copy; } }); }
}
export class GodotCubemapArrayRd extends GodotTextureLayeredRd {
  public constructor() { super('CubemapArrayRD'); bindGodotResourceProtocol<GodotCubemapArrayRd>(this, { createDuplicate: (source) => { const copy = new GodotCubemapArrayRd(); copy.setTextureRdRid(source.state.rid); return copy; } }); }
}

export class GodotTexture3DRd {
  public readonly __godotClass = 'Texture3DRD';
  private readonly state: TextureRidState = { rid: INVALID_RID, native: null, unwatch: null };
  public constructor() { registerGodotObjectIdentity(this, 'Texture3DRD'); bindGodotResourceProtocol<GodotTexture3DRd>(this, { createDuplicate: (source) => { const copy = new GodotTexture3DRd(); copy.setTextureRdRid(source.state.rid); return copy; } }); }
  public get texture_rd_rid(): GodotRid { return this.getTextureRdRid(); }
  public set texture_rd_rid(value: GodotRid) { this.setTextureRdRid(value); }
  public setTextureRdRid(value: unknown): void { this.state.rid = rid(value, 'Texture3DRD.texture_rd_rid'); textureSnapshot(this.state.rid, 'Texture3DRD.texture_rd_rid'); bindRidUpdates(this.state, () => this.rebuild()); this.rebuild(); }
  public getTextureRdRid(): GodotRid { return this.state.rid; }
  public getWidth(): number { return textureFormat(textureSnapshot(this.state.rid, 'Texture3DRD.get_width'))?.width ?? 0; }
  public getHeight(): number { return textureFormat(textureSnapshot(this.state.rid, 'Texture3DRD.get_height'))?.height ?? 0; }
  public getDepth(): number { return textureFormat(textureSnapshot(this.state.rid, 'Texture3DRD.get_depth'))?.depth ?? 0; }
  public hasAlpha(): boolean { return true; }
  public getNativeTexture(): Texture | null { return this.state.native; }
  public dispose(): void { this.state.unwatch?.(); this.state.unwatch = null; this.state.native?.dispose(); this.state.native = null; }
  private rebuild(): void {
    const snapshot = textureSnapshot(this.state.rid, 'Texture3DRD.texture_rd_rid'), format = textureFormat(snapshot);
    this.state.native?.dispose(); this.state.native = null;
    if (format !== null) {
      const native = new Data3DTexture(rgbaBytes(snapshot, format.width, format.height, format.depth), format.width, format.height, format.depth);
      native.format = RGBAFormat; native.type = UnsignedByteType; native.needsUpdate = true; native.name = 'Texture3DRD'; this.state.native = native;
    }
    godotResourceEmitChanged(this);
  }
}

abstract class GodotPlaceholderTexture {
  public readonly __godotClass: string;
  protected widthValue: number;
  protected heightValue: number;
  protected nativeValue: Texture;
  protected constructor(className: string, width = 1, height = 1) {
    this.__godotClass = className; this.widthValue = dimension(width, `${className}.size`); this.heightValue = dimension(height, `${className}.size`);
    this.nativeValue = placeholder2D(className); registerGodotObjectIdentity(this, className);
  }
  public get size(): { x: number; y: number } { return this.getSize(); }
  public set size(value: unknown) { this.setSize(value); }
  public setSize(value: unknown): void {
    if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError(`godot-compat: ${this.__godotClass}.size requires Vector2i.`);
    this.widthValue = dimension(value.x, `${this.__godotClass}.size.x`); this.heightValue = dimension(value.y, `${this.__godotClass}.size.y`); godotResourceEmitChanged(this);
  }
  public getSize(): { x: number; y: number } { return { x: this.widthValue, y: this.heightValue }; }
  public getWidth(): number { return this.widthValue; }
  public getHeight(): number { return this.heightValue; }
  public hasAlpha(): boolean { return true; }
  public getNativeTexture(): Texture { return this.nativeValue; }
  public dispose(): void { this.nativeValue.dispose(); }
}

function placeholder2D(name: string): DataTexture {
  const native = new DataTexture(new Uint8Array([255, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 255, 255]), 2, 2, RGBAFormat, UnsignedByteType);
  native.magFilter = NearestFilter; native.minFilter = NearestFilter; native.needsUpdate = true; native.name = name; return native;
}

export class GodotPlaceholderTexture2D extends GodotPlaceholderTexture {
  public constructor() { super('PlaceholderTexture2D'); bindGodotResourceProtocol<GodotPlaceholderTexture2D>(this, { createDuplicate: (source) => { const copy = new GodotPlaceholderTexture2D(); copy.setSize(source.getSize()); return copy; } }); }
}

export class GodotPlaceholderTexture2DArray extends GodotPlaceholderTexture {
  private layersValue = 1;
  public constructor() { super('PlaceholderTexture2DArray'); bindGodotResourceProtocol<GodotPlaceholderTexture2DArray>(this, { createDuplicate: (source) => { const copy = new GodotPlaceholderTexture2DArray(); copy.setSize(source.getSize()); copy.layers = source.layers; return copy; } }); }
  public get layers(): number { return this.layersValue; }
  public set layers(value: number) { this.layersValue = dimension(value, 'PlaceholderTexture2DArray.layers'); godotResourceEmitChanged(this); }
  public getLayers(): number { return this.layersValue; }
}

export class GodotPlaceholderCubemap extends GodotPlaceholderTexture {
  public constructor() { super('PlaceholderCubemap'); bindGodotResourceProtocol<GodotPlaceholderCubemap>(this, { createDuplicate: (source) => { const copy = new GodotPlaceholderCubemap(); copy.setSize(source.getSize()); return copy; } }); }
  public getLayers(): number { return 6; }
}

export class GodotPlaceholderTexture3D extends GodotPlaceholderTexture {
  private depthValue = 1;
  public constructor() { super('PlaceholderTexture3D'); bindGodotResourceProtocol<GodotPlaceholderTexture3D>(this, { createDuplicate: (source) => { const copy = new GodotPlaceholderTexture3D(); copy.setSize(source.getSize()); copy.depth = source.depth; return copy; } }); }
  public get depth(): number { return this.depthValue; }
  public set depth(value: number) { this.depthValue = dimension(value, 'PlaceholderTexture3D.depth'); godotResourceEmitChanged(this); }
  public getDepth(): number { return this.depthValue; }
}

export function createGodotTexture2DRd(): GodotTexture2DRd { return new GodotTexture2DRd(); }
export function createGodotTexture2DArrayRd(): GodotTexture2DArrayRd { return new GodotTexture2DArrayRd(); }
export function createGodotTexture3DRd(): GodotTexture3DRd { return new GodotTexture3DRd(); }
export function createGodotCubemapRd(): GodotCubemapRd { return new GodotCubemapRd(); }
export function createGodotCubemapArrayRd(): GodotCubemapArrayRd { return new GodotCubemapArrayRd(); }
export function createGodotPlaceholderTexture2D(): GodotPlaceholderTexture2D { return new GodotPlaceholderTexture2D(); }
export function createGodotPlaceholderTexture2DArray(): GodotPlaceholderTexture2DArray { return new GodotPlaceholderTexture2DArray(); }
export function createGodotPlaceholderCubemap(): GodotPlaceholderCubemap { return new GodotPlaceholderCubemap(); }
export function createGodotPlaceholderTexture3D(): GodotPlaceholderTexture3D { return new GodotPlaceholderTexture3D(); }
