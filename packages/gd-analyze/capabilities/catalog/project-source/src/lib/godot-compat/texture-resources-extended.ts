import { Data3DTexture, DataArrayTexture, DataTexture, RGBAFormat, Texture, UnsignedByteType } from 'three';
import { type GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export const GODOT_PORTABLE_COMPRESSED_MODE_LOSSLESS = 0;
export const GODOT_PORTABLE_COMPRESSED_MODE_LOSSY = 1;
export const GODOT_PORTABLE_COMPRESSED_MODE_BASIS_UNIVERSAL = 2;
export const GODOT_PORTABLE_COMPRESSED_MODE_S3TC = 3;
export const GODOT_PORTABLE_COMPRESSED_MODE_ETC2 = 4;
export const GODOT_PORTABLE_COMPRESSED_MODE_BPTC = 5;

function positiveInteger(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${member} requires a positive integer.`);
  return value;
}

function textureBytes(image: GodotImage): Uint8Array {
  const pixels = image.get_width() * image.get_height(); const source = image.get_data();
  if (source.length === pixels * 4) return Uint8Array.from(source);
  const output = new Uint8Array(pixels * 4); const components = Math.max(1, Math.floor(source.length / pixels));
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const sourceOffset = pixel * components; const target = pixel * 4;
    output[target] = source[sourceOffset] ?? 0;
    output[target + 1] = source[sourceOffset + Math.min(1, components - 1)] ?? output[target]!;
    output[target + 2] = source[sourceOffset + Math.min(2, components - 1)] ?? output[target]!;
    output[target + 3] = components >= 4 ? source[sourceOffset + 3] ?? 255 : 255;
  }
  return output;
}

export class GodotPlaceholderTexture2D {
  private size = { x: 1, y: 1 };
  readonly native = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  constructor() { registerGodotObjectIdentity(this, 'PlaceholderTexture2D'); this.native.needsUpdate = true; }
  set_size(size: Readonly<{ x: number; y: number }>): void {
    this.size = { x: positiveInteger(size.x, 'PlaceholderTexture2D.size.x'), y: positiveInteger(size.y, 'PlaceholderTexture2D.size.y') };
    this.native.image = { data: new Uint8Array(this.size.x * this.size.y * 4).fill(255), width: this.size.x, height: this.size.y };
    this.native.needsUpdate = true; godotResourceEmitChanged(this);
  }
  get_size(): Readonly<{ x: number; y: number }> { return { ...this.size }; }
  get_width(): number { return this.size.x; }
  get_height(): number { return this.size.y; }
  has_alpha(): boolean { return true; }
}

export class GodotPlaceholderTexture3D {
  private size = { x: 1, y: 1, z: 1 };
  readonly native = new Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  constructor() { registerGodotObjectIdentity(this, 'PlaceholderTexture3D'); this.native.format = RGBAFormat; this.native.type = UnsignedByteType; this.native.needsUpdate = true; }
  set_size(size: Readonly<{ x: number; y: number; z: number }>): void {
    this.size = { x: positiveInteger(size.x, 'PlaceholderTexture3D.size.x'), y: positiveInteger(size.y, 'PlaceholderTexture3D.size.y'), z: positiveInteger(size.z, 'PlaceholderTexture3D.size.z') };
    this.native.image = { data: new Uint8Array(this.size.x * this.size.y * this.size.z * 4).fill(255), width: this.size.x, height: this.size.y, depth: this.size.z };
    this.native.needsUpdate = true; godotResourceEmitChanged(this);
  }
  get_size(): Readonly<{ x: number; y: number; z: number }> { return { ...this.size }; }
  get_width(): number { return this.size.x; }
  get_height(): number { return this.size.y; }
  get_depth(): number { return this.size.z; }
}

export class GodotPlaceholderTextureLayered {
  private size = { x: 1, y: 1 };
  private layers = 1;
  readonly native = new DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  constructor(readonly layeredType = 0, className = 'PlaceholderTextureLayered') { registerGodotObjectIdentity(this, className); this.native.format = RGBAFormat; this.native.type = UnsignedByteType; this.native.needsUpdate = true; }
  set_size(size: Readonly<{ x: number; y: number }>): void { this.resize(size.x, size.y, this.layers); }
  set_layers(layers: number): void { this.resize(this.size.x, this.size.y, layers); }
  private resize(width: number, height: number, layers: number): void {
    this.size = { x: positiveInteger(width, 'PlaceholderTextureLayered.width'), y: positiveInteger(height, 'PlaceholderTextureLayered.height') };
    this.layers = positiveInteger(layers, 'PlaceholderTextureLayered.layers');
    this.native.image = { data: new Uint8Array(this.size.x * this.size.y * this.layers * 4).fill(255), width: this.size.x, height: this.size.y, depth: this.layers };
    this.native.needsUpdate = true; godotResourceEmitChanged(this);
  }
  get_size(): Readonly<{ x: number; y: number }> { return { ...this.size }; }
  get_width(): number { return this.size.x; }
  get_height(): number { return this.size.y; }
  get_layers(): number { return this.layers; }
}

export class GodotCanvasTextureResource {
  private diffuseTexture: Texture | null = null;
  private normalTexture: Texture | null = null;
  private specularTexture: Texture | null = null;
  private specularColor: unknown = { r: 1, g: 1, b: 1, a: 1 };
  private specularShininess = 1;
  private textureFilter = 0;
  private textureRepeat = 0;
  constructor() { registerGodotObjectIdentity(this, 'CanvasTexture'); }
  set_diffuse_texture(value: Texture | null): void { this.diffuseTexture = value; godotResourceEmitChanged(this); }
  get_diffuse_texture(): Texture | null { return this.diffuseTexture; }
  set_normal_texture(value: Texture | null): void { this.normalTexture = value; godotResourceEmitChanged(this); }
  get_normal_texture(): Texture | null { return this.normalTexture; }
  set_specular_texture(value: Texture | null): void { this.specularTexture = value; godotResourceEmitChanged(this); }
  get_specular_texture(): Texture | null { return this.specularTexture; }
  set_specular_color(value: unknown): void { this.specularColor = value; godotResourceEmitChanged(this); }
  get_specular_color(): unknown { return this.specularColor; }
  set_specular_shininess(value: number): void { this.specularShininess = Math.max(0, Math.min(1, value)); godotResourceEmitChanged(this); }
  get_specular_shininess(): number { return this.specularShininess; }
  set_texture_filter(value: number): void { this.textureFilter = value; godotResourceEmitChanged(this); }
  get_texture_filter(): number { return this.textureFilter; }
  set_texture_repeat(value: number): void { this.textureRepeat = value; godotResourceEmitChanged(this); }
  get_texture_repeat(): number { return this.textureRepeat; }
  get_width(): number { return Number(this.diffuseTexture?.image?.width ?? 0); }
  get_height(): number { return Number(this.diffuseTexture?.image?.height ?? 0); }
}

export interface GodotCameraTextureResolver { resolve(feedId: number, whichFeed: number): Texture | null; }

export class GodotCameraTextureResource {
  private feedId = 0;
  private whichFeed = 0;
  private cameraActive = false;
  constructor(private readonly resolver: GodotCameraTextureResolver) { registerGodotObjectIdentity(this, 'CameraTexture'); }
  set_camera_feed_id(value: number): void { this.feedId = Math.trunc(value); godotResourceEmitChanged(this); }
  get_camera_feed_id(): number { return this.feedId; }
  set_which_feed(value: number): void { this.whichFeed = Math.trunc(value); godotResourceEmitChanged(this); }
  get_which_feed(): number { return this.whichFeed; }
  set_camera_active(value: boolean): void { this.cameraActive = value; godotResourceEmitChanged(this); }
  get_camera_active(): boolean { return this.cameraActive; }
  get_native_texture(): Texture | null { return this.cameraActive ? this.resolver.resolve(this.feedId, this.whichFeed) : null; }
  get_width(): number { return Number(this.get_native_texture()?.image?.width ?? 0); }
  get_height(): number { return Number(this.get_native_texture()?.image?.height ?? 0); }
}

export class GodotPortableCompressedTexture2D {
  private compressionMode = GODOT_PORTABLE_COMPRESSED_MODE_LOSSLESS;
  private sizeOverride = { x: 0, y: 0 };
  private image: GodotImage | null = null;
  private compressedBuffer = new Uint8Array();
  readonly native = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat, UnsignedByteType);
  constructor() { registerGodotObjectIdentity(this, 'PortableCompressedTexture2D'); this.native.flipY = false; }

  create_from_image(image: GodotImage, compressionMode = GODOT_PORTABLE_COMPRESSED_MODE_LOSSLESS, normalMap = false, lossyQuality = 0.8): void {
    void normalMap; void lossyQuality;
    this.compressionMode = compressionMode; this.image = image; this.compressedBuffer = Uint8Array.from(image.get_data());
    this.native.image = { data: textureBytes(image), width: image.get_width(), height: image.get_height() }; this.native.generateMipmaps = image.has_mipmaps(); this.native.needsUpdate = true; godotResourceEmitChanged(this);
  }
  set_size_override(size: Readonly<{ x: number; y: number }>): void { this.sizeOverride = { x: Math.max(0, Math.trunc(size.x)), y: Math.max(0, Math.trunc(size.y)) }; godotResourceEmitChanged(this); }
  get_size_override(): Readonly<{ x: number; y: number }> { return { ...this.sizeOverride }; }
  get_width(): number { return this.sizeOverride.x || this.image?.get_width() || 0; }
  get_height(): number { return this.sizeOverride.y || this.image?.get_height() || 0; }
  get_format(): number { return this.image?.get_format() ?? 0; }
  has_alpha(): boolean { return true; }
  get_image(): GodotImage | null { return this.image; }
  get_compression_mode(): number { return this.compressionMode; }
  get_compressed_buffer(): Uint8Array { return this.compressedBuffer.slice(); }
}

export const createGodotPlaceholderTexture2D = (): GodotPlaceholderTexture2D => new GodotPlaceholderTexture2D();
export const createGodotPlaceholderTexture3D = (): GodotPlaceholderTexture3D => new GodotPlaceholderTexture3D();
export const createGodotPlaceholderTextureLayered = (): GodotPlaceholderTextureLayered => new GodotPlaceholderTextureLayered();
export const createGodotCanvasTextureResource = (): GodotCanvasTextureResource => new GodotCanvasTextureResource();
export const createGodotCameraTextureResource = (resolver: GodotCameraTextureResolver): GodotCameraTextureResource => new GodotCameraTextureResource(resolver);
export const createGodotPortableCompressedTexture2D = (): GodotPortableCompressedTexture2D => new GodotPortableCompressedTexture2D();
