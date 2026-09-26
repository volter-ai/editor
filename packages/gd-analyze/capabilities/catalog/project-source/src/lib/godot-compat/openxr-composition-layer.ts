/** Godot OpenXR composition layer nodes and swapchain sampling state. */

import { Object3D, Vector3 } from 'three';
import { godotColor } from './color';
import { registerGodotObjectIdentity } from './object';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';

export interface GodotOpenXRCompositionVector2i { readonly x: number; readonly y: number }
export interface GodotOpenXRCompositionLayerCarrier {
  getAndroidSurface(): unknown;
  isNativelySupported(layer: GodotOpenXRCompositionLayer): boolean;
  intersectsRay(layer: GodotOpenXRCompositionLayer, origin: Vector3, direction: Vector3): Vector2 | null;
  propertyChanged?(layer: GodotOpenXRCompositionLayer, property: string, value: unknown): void;
}

function enumValue(value: number, maximum: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`OpenXR composition ${member} is invalid.`);
  return value;
}
function positive(value: number, member: string, allowZero = false): number {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : Number.EPSILON)) throw new RangeError(`OpenXR composition ${member} must be positive.`);
  return value;
}

export class GodotOpenXRCompositionLayer extends Object3D {
  private viewport: object | null = null;
  private androidSurface = false;
  private protectedContent = false;
  private androidSurfaceSize: GodotOpenXRCompositionVector2i = { x: 0, y: 0 };
  private sortOrder = 1;
  private alphaBlend = false;
  private holePunch = false;
  private eyeVisibility = 0;
  private minFilter = 1;
  private magFilter = 1;
  private mipmapMode = 0;
  private horizontalWrap = 1;
  private verticalWrap = 1;
  private redSwizzle = 0;
  private greenSwizzle = 1;
  private blueSwizzle = 2;
  private alphaSwizzle = 3;
  private maxAnisotropy = 1;
  private borderColor: ColorValue = godotColor(0, 0, 0, 0);

  constructor(private readonly carrier: GodotOpenXRCompositionLayerCarrier, className = 'OpenXRCompositionLayer') {
    super();
    registerGodotObjectIdentity(this, className);
  }
  set_layer_viewport(viewport: object | null): void { this.viewport = viewport; this.changed('layer_viewport', viewport); }
  get_layer_viewport(): object | null { return this.viewport; }
  set_use_android_surface(enable: boolean): void { this.androidSurface = Boolean(enable); this.changed('use_android_surface', this.androidSurface); }
  get_use_android_surface(): boolean { return this.androidSurface; }
  set_android_surface_size(size: GodotOpenXRCompositionVector2i): void {
    if (!Number.isSafeInteger(size.x) || !Number.isSafeInteger(size.y) || size.x < 0 || size.y < 0) throw new RangeError('OpenXR Android surface size requires non-negative Vector2i.');
    this.androidSurfaceSize = { x: size.x, y: size.y };
    this.changed('android_surface_size', this.androidSurfaceSize);
  }
  get_android_surface_size(): GodotOpenXRCompositionVector2i { return { ...this.androidSurfaceSize }; }
  set_enable_hole_punch(enable: boolean): void { this.holePunch = Boolean(enable); this.changed('enable_hole_punch', this.holePunch); }
  get_enable_hole_punch(): boolean { return this.holePunch; }
  set_sort_order(order: number): void {
    if (!Number.isSafeInteger(order)) throw new TypeError('OpenXR composition sort_order requires int.');
    this.sortOrder = order; this.changed('sort_order', order);
  }
  get_sort_order(): number { return this.sortOrder; }
  set_alpha_blend(enabled: boolean): void { this.alphaBlend = Boolean(enabled); this.changed('alpha_blend', this.alphaBlend); }
  get_alpha_blend(): boolean { return this.alphaBlend; }
  get_android_surface(): unknown { return this.androidSurface ? this.carrier.getAndroidSurface() : null; }
  is_natively_supported(): boolean { return Boolean(this.carrier.isNativelySupported(this)); }
  is_protected_content(): boolean { return this.protectedContent; }
  set_protected_content(value: boolean): void { this.protectedContent = Boolean(value); this.changed('protected_content', this.protectedContent); }
  set_min_filter(mode: number): void { this.minFilter = enumValue(mode, 2, 'min_filter'); this.changed('min_filter', mode); }
  get_min_filter(): number { return this.minFilter; }
  set_mag_filter(mode: number): void { this.magFilter = enumValue(mode, 2, 'mag_filter'); this.changed('mag_filter', mode); }
  get_mag_filter(): number { return this.magFilter; }
  set_mipmap_mode(mode: number): void { this.mipmapMode = enumValue(mode, 2, 'mipmap_mode'); this.changed('mipmap_mode', mode); }
  get_mipmap_mode(): number { return this.mipmapMode; }
  set_horizontal_wrap(mode: number): void { this.horizontalWrap = enumValue(mode, 4, 'horizontal_wrap'); this.changed('horizontal_wrap', mode); }
  get_horizontal_wrap(): number { return this.horizontalWrap; }
  set_vertical_wrap(mode: number): void { this.verticalWrap = enumValue(mode, 4, 'vertical_wrap'); this.changed('vertical_wrap', mode); }
  get_vertical_wrap(): number { return this.verticalWrap; }
  set_red_swizzle(mode: number): void { this.redSwizzle = enumValue(mode, 5, 'red_swizzle'); this.changed('red_swizzle', mode); }
  get_red_swizzle(): number { return this.redSwizzle; }
  set_green_swizzle(mode: number): void { this.greenSwizzle = enumValue(mode, 5, 'green_swizzle'); this.changed('green_swizzle', mode); }
  get_green_swizzle(): number { return this.greenSwizzle; }
  set_blue_swizzle(mode: number): void { this.blueSwizzle = enumValue(mode, 5, 'blue_swizzle'); this.changed('blue_swizzle', mode); }
  get_blue_swizzle(): number { return this.blueSwizzle; }
  set_alpha_swizzle(mode: number): void { this.alphaSwizzle = enumValue(mode, 5, 'alpha_swizzle'); this.changed('alpha_swizzle', mode); }
  get_alpha_swizzle(): number { return this.alphaSwizzle; }
  set_max_anisotropy(value: number): void { this.maxAnisotropy = positive(value, 'max_anisotropy'); this.changed('max_anisotropy', value); }
  get_max_anisotropy(): number { return this.maxAnisotropy; }
  set_border_color(color: ColorValue): void { this.borderColor = godotColor(color.r, color.g, color.b, color.a); this.changed('border_color', this.borderColor); }
  get_border_color(): ColorValue { return godotColor(this.borderColor.r, this.borderColor.g, this.borderColor.b, this.borderColor.a); }
  set_eye_visibility(value: number): void { this.eyeVisibility = enumValue(value, 2, 'eye_visibility'); this.changed('eye_visibility', value); }
  get_eye_visibility(): number { return this.eyeVisibility; }
  intersects_ray(origin: Vector3, direction: Vector3): Vector2 {
    if (!(origin instanceof Vector3) || !(direction instanceof Vector3)) throw new TypeError('OpenXR composition ray requires Vector3 origin and direction.');
    const result = this.carrier.intersectsRay(this, origin.clone(), direction.clone());
    return result === null ? { x: -1, y: -1 } : { x: result.x, y: result.y };
  }
  protected changed(property: string, value: unknown): void { this.carrier.propertyChanged?.(this, property, value); }
}

export class GodotOpenXRCompositionLayerQuad extends GodotOpenXRCompositionLayer {
  private quadSize: Vector2 = { x: 1, y: 1 };
  constructor(carrier: GodotOpenXRCompositionLayerCarrier) { super(carrier, 'OpenXRCompositionLayerQuad'); }
  set_quad_size(size: Vector2): void { this.quadSize = { x: positive(size.x, 'quad_size.x'), y: positive(size.y, 'quad_size.y') }; this.changed('quad_size', this.quadSize); }
  get_quad_size(): Vector2 { return { ...this.quadSize }; }
}

export class GodotOpenXRCompositionLayerCylinder extends GodotOpenXRCompositionLayer {
  private radius = 1;
  private aspectRatio = 1;
  private centralAngle = Math.PI / 2;
  private fallbackSegments = 32;
  constructor(carrier: GodotOpenXRCompositionLayerCarrier) { super(carrier, 'OpenXRCompositionLayerCylinder'); }
  set_radius(value: number): void { this.radius = positive(value, 'radius'); this.changed('radius', value); }
  get_radius(): number { return this.radius; }
  set_aspect_ratio(value: number): void { this.aspectRatio = positive(value, 'aspect_ratio'); this.changed('aspect_ratio', value); }
  get_aspect_ratio(): number { return this.aspectRatio; }
  set_central_angle(value: number): void { this.centralAngle = positive(value, 'central_angle'); this.changed('central_angle', value); }
  get_central_angle(): number { return this.centralAngle; }
  set_fallback_segments(value: number): void { if (!Number.isSafeInteger(value) || value < 3) throw new RangeError('OpenXR cylinder segments require >= 3.'); this.fallbackSegments = value; this.changed('fallback_segments', value); }
  get_fallback_segments(): number { return this.fallbackSegments; }
}

export class GodotOpenXRCompositionLayerEquirect extends GodotOpenXRCompositionLayer {
  private radius = 1;
  private centralHorizontalAngle = Math.PI * 2;
  private upperVerticalAngle = Math.PI / 2;
  private lowerVerticalAngle = -Math.PI / 2;
  private fallbackSegments = 32;
  constructor(carrier: GodotOpenXRCompositionLayerCarrier) { super(carrier, 'OpenXRCompositionLayerEquirect'); }
  set_radius(value: number): void { this.radius = positive(value, 'radius'); this.changed('radius', value); }
  get_radius(): number { return this.radius; }
  set_central_horizontal_angle(value: number): void { this.centralHorizontalAngle = positive(value, 'central_horizontal_angle'); this.changed('central_horizontal_angle', value); }
  get_central_horizontal_angle(): number { return this.centralHorizontalAngle; }
  set_upper_vertical_angle(value: number): void { if (!Number.isFinite(value)) throw new TypeError('OpenXR upper vertical angle requires float.'); this.upperVerticalAngle = value; this.changed('upper_vertical_angle', value); }
  get_upper_vertical_angle(): number { return this.upperVerticalAngle; }
  set_lower_vertical_angle(value: number): void { if (!Number.isFinite(value)) throw new TypeError('OpenXR lower vertical angle requires float.'); this.lowerVerticalAngle = value; this.changed('lower_vertical_angle', value); }
  get_lower_vertical_angle(): number { return this.lowerVerticalAngle; }
  set_fallback_segments(value: number): void { if (!Number.isSafeInteger(value) || value < 3) throw new RangeError('OpenXR equirect segments require >= 3.'); this.fallbackSegments = value; this.changed('fallback_segments', value); }
  get_fallback_segments(): number { return this.fallbackSegments; }
}

export function createGodotOpenXRCompositionLayerQuad(carrier: GodotOpenXRCompositionLayerCarrier): GodotOpenXRCompositionLayerQuad { return new GodotOpenXRCompositionLayerQuad(carrier); }
export function createGodotOpenXRCompositionLayerCylinder(carrier: GodotOpenXRCompositionLayerCarrier): GodotOpenXRCompositionLayerCylinder { return new GodotOpenXRCompositionLayerCylinder(carrier); }
export function createGodotOpenXRCompositionLayerEquirect(carrier: GodotOpenXRCompositionLayerCarrier): GodotOpenXRCompositionLayerEquirect { return new GodotOpenXRCompositionLayerEquirect(carrier); }
