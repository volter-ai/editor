import { Texture } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotMeshTextureSnapshot {
  readonly baseTexture: unknown | null;
  readonly imageSize: { readonly x: number; readonly y: number };
  readonly mesh: unknown | null;
  readonly revision: number;
}

export interface GodotMeshTextureBinding {
  update(snapshot: GodotMeshTextureSnapshot): void;
  dispose?(): void;
}

function integer(value: unknown, member: string, minimum = 0, maximum = 0x7fff_ffff): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new RangeError(`godot-compat: ${member} requires integer in [${minimum}, ${maximum}].`);
  return value as number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: ${member} requires finite value in [${minimum}, ${maximum}].`);
  return value;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`);
  return value;
}

function size2(value: unknown, member: string): { x: number; y: number } {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError(`godot-compat: ${member} requires Vector2.`);
  return Object.freeze({ x: finite(value.x, `${member}.x`, 0), y: finite(value.y, `${member}.y`, 0) });
}

export class GodotMeshTexture {
  public readonly __godotClass = 'MeshTexture';
  private baseTextureValue: unknown | null = null;
  private imageSizeValue: Readonly<{ x: number; y: number }> = Object.freeze({ x: 0, y: 0 });
  private meshValue: unknown | null = null;
  private revisionValue = 0;
  private bindingValue: GodotMeshTextureBinding | null = null;
  private readonly watchers = new Set<(snapshot: GodotMeshTextureSnapshot) => void>();

  public constructor() {
    registerGodotObjectIdentity(this, 'MeshTexture');
    bindGodotResourceProtocol<GodotMeshTexture>(this, {
      createDuplicate: (source) => {
        const duplicate = new GodotMeshTexture(); duplicate.base_texture = source.base_texture;
        duplicate.image_size = source.image_size; duplicate.mesh = source.mesh; return duplicate;
      },
    });
  }
  private publish(): void {
    this.revisionValue += 1; const snapshot = this.snapshot(); this.bindingValue?.update(snapshot);
    for (const watcher of this.watchers) watcher(snapshot); godotResourceEmitChanged(this);
  }
  public get base_texture(): unknown | null { return this.getBaseTexture(); }
  public set base_texture(value: unknown | null) { this.setBaseTexture(value); }
  public get image_size(): { x: number; y: number } { return this.getImageSize(); }
  public set image_size(value: unknown) { this.setImageSize(value); }
  public get mesh(): unknown | null { return this.getMesh(); }
  public set mesh(value: unknown | null) { this.setMesh(value); }
  public setBaseTexture(value: unknown | null): void { this.baseTextureValue = value; this.publish(); }
  public getBaseTexture(): unknown | null { return this.baseTextureValue; }
  public setImageSize(value: unknown): void { this.imageSizeValue = size2(value, 'MeshTexture.image_size'); this.publish(); }
  public getImageSize(): { x: number; y: number } { return { ...this.imageSizeValue }; }
  public setMesh(value: unknown | null): void { this.meshValue = value; this.publish(); }
  public getMesh(): unknown | null { return this.meshValue; }
  public getWidth(): number { return Math.trunc(this.imageSizeValue.x); }
  public getHeight(): number { return Math.trunc(this.imageSizeValue.y); }
  public hasAlpha(): boolean {
    const texture = this.baseTextureValue as { hasAlpha?: () => unknown; has_alpha?: () => unknown } | null;
    if (typeof texture?.hasAlpha === 'function') return Boolean(texture.hasAlpha());
    if (typeof texture?.has_alpha === 'function') return Boolean(texture.has_alpha());
    return true;
  }
  public snapshot(): GodotMeshTextureSnapshot { return Object.freeze({ baseTexture: this.baseTextureValue, imageSize: Object.freeze({ ...this.imageSizeValue }), mesh: this.meshValue, revision: this.revisionValue }); }
  public bind(binding: GodotMeshTextureBinding | null): () => void { this.bindingValue?.dispose?.(); this.bindingValue = binding; binding?.update(this.snapshot()); return () => { if (this.bindingValue === binding) { binding?.dispose?.(); this.bindingValue = null; } }; }
  public watch(watcher: (snapshot: GodotMeshTextureSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.snapshot()); return () => this.watchers.delete(watcher); }
}

export function createGodotMeshTexture(): GodotMeshTexture { return new GodotMeshTexture(); }
export function bindGodotMeshTexture(texture: GodotMeshTexture, binding: GodotMeshTextureBinding | null): () => void { return texture.bind(binding); }
export function watchGodotMeshTexture(texture: GodotMeshTexture, watcher: (snapshot: GodotMeshTextureSnapshot) => void): () => void { return texture.watch(watcher); }

export interface GodotPortableTexturePayload {
  readonly width: number;
  readonly height: number;
  readonly format: number;
  readonly compressionMode: number;
  readonly normalMap: boolean;
  readonly lossyQuality: number;
  readonly sizeLimit: number;
  readonly mipmaps: boolean;
  readonly data: Uint8Array;
}

export interface GodotPortableTextureCodec {
  encode(image: unknown, options: { compressionMode: number; normalMap: boolean; lossyQuality: number }): GodotPortableTexturePayload;
  decode(payload: GodotPortableTexturePayload): Texture;
}

let portableCodec: GodotPortableTextureCodec | null = null;

export function bindGodotPortableTextureCodec(codec: GodotPortableTextureCodec | null): () => void {
  portableCodec = codec;
  return () => { if (portableCodec === codec) portableCodec = null; };
}

function bytes(value: unknown, member: string): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return Uint8Array.from(value.map((one) => integer(one, member, 0, 255)));
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  throw new TypeError(`godot-compat: ${member} requires PackedByteArray.`);
}

function payload(value: GodotPortableTexturePayload): GodotPortableTexturePayload {
  return Object.freeze({
    width: integer(value.width, 'PortableCompressedTexture2D.width', 1),
    height: integer(value.height, 'PortableCompressedTexture2D.height', 1),
    format: integer(value.format, 'PortableCompressedTexture2D.format'),
    compressionMode: integer(value.compressionMode, 'PortableCompressedTexture2D.compression_mode', 0, 4),
    normalMap: bool(value.normalMap, 'PortableCompressedTexture2D.normal_map'),
    lossyQuality: finite(value.lossyQuality, 'PortableCompressedTexture2D.lossy_quality', 0, 1),
    sizeLimit: integer(value.sizeLimit, 'PortableCompressedTexture2D.size_limit'),
    mipmaps: bool(value.mipmaps, 'PortableCompressedTexture2D.mipmaps'),
    data: bytes(value.data, 'PortableCompressedTexture2D.data'),
  });
}

export class GodotPortableCompressedTexture2D {
  public readonly __godotClass = 'PortableCompressedTexture2D';
  private payloadValue: GodotPortableTexturePayload | null = null;
  private nativeValue: Texture | null = null;
  private sizeOverrideValue: Readonly<{ x: number; y: number }> = Object.freeze({ x: 0, y: 0 });
  private keepCompressedBufferValue = false;
  private revisionValue = 0;
  private readonly watchers = new Set<(payload: GodotPortableTexturePayload | null) => void>();

  public constructor() {
    registerGodotObjectIdentity(this, 'PortableCompressedTexture2D');
    bindGodotResourceProtocol<GodotPortableCompressedTexture2D>(this, {
      createDuplicate: (source) => {
        const duplicate = new GodotPortableCompressedTexture2D();
        if (source.payloadValue !== null) duplicate.setPayload(source.payloadValue);
        duplicate.size_override = source.size_override; duplicate.keep_compressed_buffer = source.keep_compressed_buffer; return duplicate;
      },
    });
  }
  private publish(): void { this.revisionValue += 1; for (const watcher of this.watchers) watcher(this.getPayload()); godotResourceEmitChanged(this); }
  public get size_override(): { x: number; y: number } { return this.getSizeOverride(); }
  public set size_override(value: unknown) { this.setSizeOverride(value); }
  public get keep_compressed_buffer(): boolean { return this.keepCompressedBufferValue; }
  public set keep_compressed_buffer(value: boolean) { this.keepCompressedBufferValue = bool(value, 'PortableCompressedTexture2D.keep_compressed_buffer'); this.publish(); }
  public createFromImage(image: unknown, compressionMode = 0, normalMap = false, lossyQuality = 0.8): void {
    if (portableCodec === null) throw new Error('godot-compat: PortableCompressedTexture2D.create_from_image requires bindGodotPortableTextureCodec().');
    this.setPayload(portableCodec.encode(image, { compressionMode: integer(compressionMode, 'PortableCompressedTexture2D.compression_mode', 0, 4), normalMap: bool(normalMap, 'PortableCompressedTexture2D.normal_map'), lossyQuality: finite(lossyQuality, 'PortableCompressedTexture2D.lossy_quality', 0, 1) }));
  }
  public setPayload(value: GodotPortableTexturePayload): void {
    const retained = payload(value); const native = portableCodec?.decode(retained) ?? null;
    this.nativeValue?.dispose(); this.payloadValue = retained; this.nativeValue = native; this.publish();
  }
  public getPayload(): GodotPortableTexturePayload | null { return this.payloadValue === null ? null : payload(this.payloadValue); }
  public getWidth(): number { return this.sizeOverrideValue.x > 0 ? Math.trunc(this.sizeOverrideValue.x) : this.payloadValue?.width ?? 0; }
  public getHeight(): number { return this.sizeOverrideValue.y > 0 ? Math.trunc(this.sizeOverrideValue.y) : this.payloadValue?.height ?? 0; }
  public hasAlpha(): boolean { return true; }
  public getFormat(): number { return this.payloadValue?.format ?? 0; }
  public setSizeOverride(value: unknown): void { this.sizeOverrideValue = size2(value, 'PortableCompressedTexture2D.size_override'); this.publish(); }
  public getSizeOverride(): { x: number; y: number } { return { ...this.sizeOverrideValue }; }
  public getNativeTexture(): Texture | null { return this.nativeValue; }
  public watch(watcher: (payload: GodotPortableTexturePayload | null) => void): () => void { this.watchers.add(watcher); watcher(this.getPayload()); return () => this.watchers.delete(watcher); }
  public dispose(): void { this.nativeValue?.dispose(); this.nativeValue = null; this.payloadValue = null; this.publish(); }
}

export function createGodotPortableCompressedTexture2D(): GodotPortableCompressedTexture2D { return new GodotPortableCompressedTexture2D(); }
export function watchGodotPortableCompressedTexture2D(texture: GodotPortableCompressedTexture2D, watcher: (payload: GodotPortableTexturePayload | null) => void): () => void { return texture.watch(watcher); }
