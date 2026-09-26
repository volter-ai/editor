import { BufferGeometry, Texture, Vector2, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export interface GodotTextureResourceLike {
  readonly native?: Texture;
  get_native_texture?(): Texture | null;
  get_width?(): number;
  get_height?(): number;
  has_alpha?(): boolean;
}

function nativeTexture(value: GodotTextureResourceLike | Texture | null): Texture | null {
  if (value === null) return null;
  if (value instanceof Texture) return value;
  return value.get_native_texture?.() ?? value.native ?? null;
}

function dimension(value: GodotTextureResourceLike | Texture | null, axis: 'width' | 'height'): number {
  if (value === null) return 0;
  if (!(value instanceof Texture)) {
    const getter = axis === 'width' ? value.get_width : value.get_height;
    if (typeof getter === 'function') return Number(getter.call(value));
  }
  const texture = nativeTexture(value);
  const image = texture?.image as { width?: unknown; height?: unknown } | undefined;
  const result = Number(image?.[axis] ?? 0);
  return Number.isFinite(result) ? result : 0;
}

export class GodotProxyTexture {
  private baseValue: GodotTextureResourceLike | Texture | null = null;

  constructor(base: GodotTextureResourceLike | Texture | null = null) {
    registerGodotObjectIdentity(this, 'ProxyTexture');
    this.baseValue = base;
  }

  set_base(value: GodotTextureResourceLike | Texture | null): void {
    if (value === this.baseValue) return;
    this.baseValue = value;
    godotResourceEmitChanged(this);
  }
  get_base(): GodotTextureResourceLike | Texture | null { return this.baseValue; }
  get_native_texture(): Texture | null { return nativeTexture(this.baseValue); }
  get_width(): number { return dimension(this.baseValue, 'width'); }
  get_height(): number { return dimension(this.baseValue, 'height'); }
  has_alpha(): boolean {
    if (this.baseValue === null || this.baseValue instanceof Texture) return true;
    return this.baseValue.has_alpha?.() ?? true;
  }
}

export interface GodotExternalTextureResolver {
  resolveExternalTexture(bufferId: number, size: Vector2): Texture | null;
}

export class GodotExternalTexture {
  private readonly sizeValue = new Vector2(256, 256);
  private externalBufferIdValue = 0;

  constructor(private readonly resolver: GodotExternalTextureResolver) {
    registerGodotObjectIdentity(this, 'ExternalTexture');
  }

  set_size(value: Vector2): void {
    if (!Number.isInteger(value.x) || !Number.isInteger(value.y) || value.x <= 0 || value.y <= 0) {
      throw new RangeError('ExternalTexture.size requires positive integer components.');
    }
    this.sizeValue.copy(value);
    godotResourceEmitChanged(this);
  }
  get_size(): Vector2 { return this.sizeValue.clone(); }
  get_width(): number { return this.sizeValue.x; }
  get_height(): number { return this.sizeValue.y; }
  set_external_buffer_id(value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('ExternalTexture external buffer id requires a nonnegative integer.');
    this.externalBufferIdValue = value;
    godotResourceEmitChanged(this);
  }
  get_external_buffer_id(): number { return this.externalBufferIdValue; }
  update_external_texture(bufferId: number): void { this.set_external_buffer_id(bufferId); }
  get_native_texture(): Texture | null {
    return this.resolver.resolveExternalTexture(this.externalBufferIdValue, this.sizeValue.clone());
  }
  has_alpha(): boolean { return true; }
}

export class GodotMeshTexture {
  private baseTextureValue: GodotTextureResourceLike | Texture | null = null;
  private imageSizeValue = new Vector2();
  private meshValue: BufferGeometry | null = null;

  constructor() {
    registerGodotObjectIdentity(this, 'MeshTexture');
  }

  set_base_texture(value: GodotTextureResourceLike | Texture | null): void {
    this.baseTextureValue = value;
    godotResourceEmitChanged(this);
  }
  get_base_texture(): GodotTextureResourceLike | Texture | null { return this.baseTextureValue; }
  set_image_size(value: Vector2): void {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.y < 0) {
      throw new RangeError('MeshTexture.image_size requires finite nonnegative components.');
    }
    this.imageSizeValue.copy(value);
    godotResourceEmitChanged(this);
  }
  get_image_size(): Vector2 { return this.imageSizeValue.clone(); }
  set_mesh(value: BufferGeometry | null): void {
    if (value !== null && !(value instanceof BufferGeometry)) throw new TypeError('MeshTexture.mesh requires a native BufferGeometry or null.');
    this.meshValue = value;
    godotResourceEmitChanged(this);
  }
  get_mesh(): BufferGeometry | null { return this.meshValue; }
  get_width(): number { return Math.trunc(this.imageSizeValue.x || dimension(this.baseTextureValue, 'width')); }
  get_height(): number { return Math.trunc(this.imageSizeValue.y || dimension(this.baseTextureValue, 'height')); }
  has_alpha(): boolean {
    if (this.baseTextureValue === null || this.baseTextureValue instanceof Texture) return true;
    return this.baseTextureValue.has_alpha?.() ?? true;
  }
  get_native_texture(): Texture | null { return nativeTexture(this.baseTextureValue); }
}

export interface GodotCompressedTextureLoadResult {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
  readonly layers?: number;
  readonly format?: number;
  readonly hasAlpha?: boolean;
  readonly mipmaps?: boolean;
}

export interface GodotCompressedTextureResolver {
  loadCompressedTexture(path: string): GodotCompressedTextureLoadResult;
}

abstract class GodotCompressedTextureBase {
  protected loadPathValue = '';
  protected result: GodotCompressedTextureLoadResult | null = null;

  protected constructor(
    godotClass: string,
    protected readonly resolver: GodotCompressedTextureResolver,
  ) {
    registerGodotObjectIdentity(this, godotClass);
  }

  load(path: string): number {
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('CompressedTexture.load requires a nonempty resource path.');
    this.result = this.resolver.loadCompressedTexture(path);
    this.loadPathValue = path;
    godotResourceEmitChanged(this);
    return 0;
  }
  get_load_path(): string { return this.loadPathValue; }
  get_native_texture(): Texture | null { return this.result?.texture ?? null; }
  get_width(): number { return this.result?.width ?? 0; }
  get_height(): number { return this.result?.height ?? 0; }
  get_format(): number { return this.result?.format ?? 0; }
  has_alpha(): boolean { return this.result?.hasAlpha ?? true; }
  has_mipmaps(): boolean { return this.result?.mipmaps ?? false; }
}

export class GodotCompressedTexture2D extends GodotCompressedTextureBase {
  constructor(resolver: GodotCompressedTextureResolver) { super('CompressedTexture2D', resolver); }
}

export class GodotCompressedTexture3D extends GodotCompressedTextureBase {
  constructor(resolver: GodotCompressedTextureResolver) { super('CompressedTexture3D', resolver); }
  get_depth(): number { return this.result?.depth ?? 0; }
  get_size(): Vector3 { return new Vector3(this.get_width(), this.get_height(), this.get_depth()); }
}

export const GodotCompressedTextureLayeredType = {
  LAYERED_2D_ARRAY: 0,
  LAYERED_CUBEMAP: 1,
  LAYERED_CUBEMAP_ARRAY: 2,
} as const;

export class GodotCompressedTextureLayered extends GodotCompressedTextureBase {
  constructor(
    resolver: GodotCompressedTextureResolver,
    private readonly layeredTypeValue: number = GodotCompressedTextureLayeredType.LAYERED_2D_ARRAY,
  ) {
    super('CompressedTextureLayered', resolver);
    if (layeredTypeValue !== 0 && layeredTypeValue !== 1 && layeredTypeValue !== 2) {
      throw new RangeError('CompressedTextureLayered layered type requires 2D array, cubemap, or cubemap array.');
    }
  }
  get_layers(): number { return this.result?.layers ?? 0; }
  get_layered_type(): number { return this.layeredTypeValue; }
}

export const createGodotProxyTexture = (base: GodotTextureResourceLike | Texture | null = null): GodotProxyTexture => new GodotProxyTexture(base);
export const createGodotExternalTexture = (resolver: GodotExternalTextureResolver): GodotExternalTexture => new GodotExternalTexture(resolver);
export const createGodotMeshTexture = (): GodotMeshTexture => new GodotMeshTexture();
export const createGodotCompressedTexture2D = (resolver: GodotCompressedTextureResolver): GodotCompressedTexture2D => new GodotCompressedTexture2D(resolver);
export const createGodotCompressedTexture3D = (resolver: GodotCompressedTextureResolver): GodotCompressedTexture3D => new GodotCompressedTexture3D(resolver);
export const createGodotCompressedTextureLayered = (
  resolver: GodotCompressedTextureResolver,
  type: number = 0,
): GodotCompressedTextureLayered => new GodotCompressedTextureLayered(resolver, type);
