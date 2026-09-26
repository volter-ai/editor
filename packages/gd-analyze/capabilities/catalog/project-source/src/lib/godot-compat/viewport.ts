import { Container, Matrix, RenderTexture, Sprite } from 'pixi.js';
import {
  type Camera,
  Color,
  DepthFormat,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { bindGodotCanvasContainerApi } from './canvas-container';
import { setCanvasItemTextureFilter } from './canvas-item-texture-filter';
import { type GodotControl, retainedGuiFocusOwner, retainedGuiHoveredOwner } from './control-state';
import { type GodotRid, godotRidOfCarrier } from './gdscript-builtins';
import {
  bindRuntimeCanvasControl,
  markInternalCanvasChild,
  registerCanvasNodeRelease,
} from './node';
import { registerGodotObjectIdentity } from './object';
import { type GodotRect2, rect2 } from './rect2';
import { initializeGodotTextureFlags } from './texture-2d';
import { type GodotTransform2D, godotTransform2DNew } from './transform-2d';

export const VIEWPORT_UPDATE_DISABLED = 0;
export const VIEWPORT_UPDATE_ONCE = 1;
export const VIEWPORT_UPDATE_WHEN_VISIBLE = 2;
export const VIEWPORT_UPDATE_WHEN_PARENT_VISIBLE = 3;
export const VIEWPORT_UPDATE_ALWAYS = 4;
export type GodotViewportUpdateMode = 0 | 1 | 2 | 3 | 4;

export const VIEWPORT_CLEAR_ALWAYS = 0;
export const VIEWPORT_CLEAR_NEVER = 1;
export const VIEWPORT_CLEAR_ONCE = 2;
export type GodotViewportClearMode = 0 | 1 | 2;

export const VIEWPORT_MSAA_DISABLED = 0;
export const VIEWPORT_MSAA_2X = 1;
export const VIEWPORT_MSAA_4X = 2;
export const VIEWPORT_MSAA_8X = 3;
export type GodotViewportMsaa = 0 | 1 | 2 | 3;

export const VIEWPORT_DEFAULT_TEXTURE_FILTER_NEAREST = 0;
export const VIEWPORT_DEFAULT_TEXTURE_FILTER_LINEAR = 1;
export const VIEWPORT_DEFAULT_TEXTURE_FILTER_LINEAR_WITH_MIPMAPS = 2;
export const VIEWPORT_DEFAULT_TEXTURE_FILTER_NEAREST_WITH_MIPMAPS = 3;
export const VIEWPORT_DEFAULT_TEXTURE_FILTER_PARENT_NODE = 4;
export type GodotViewportDefaultTextureFilter = 0 | 1 | 2 | 3 | 4;

export interface GodotViewportSize {
  readonly x: number;
  readonly y: number;
}

export interface GodotViewportOptions {
  readonly size?: GodotViewportSize;
  readonly size2dOverride?: GodotViewportSize;
  readonly size2dOverrideStretch?: boolean;
  readonly transparentBackground?: boolean;
  readonly useHdr2d?: boolean;
  readonly useOwnWorld3d?: boolean;
  readonly useOwnWorld2d?: boolean;
  readonly audioListener2d?: boolean;
  readonly renderTargetUpdateMode?: GodotViewportUpdateMode;
  readonly renderTargetClearMode?: GodotViewportClearMode;
  readonly msaa3d?: number;
  readonly disable3d?: boolean;
  readonly handleInputLocally?: boolean;
  readonly snap2dTransformsToPixel?: boolean;
  readonly snap2dVerticesToPixel?: boolean;
}

export interface GodotViewportTexture {
  readonly viewport: GodotViewport | null;
  readonly three?: Texture;
  readonly pixi?: RenderTexture;
  readonly canvas?: HTMLCanvasElement;
  readonly size: GodotViewportSize;
}

const viewportTextureCanvases = new WeakMap<GodotViewportTexture, Set<HTMLCanvasElement>>();

/** Bind one DOM TextureRect canvas to the retained ViewportTexture without fabricating a URL. */
export function bindGodotViewportTextureCanvas(
  texture: GodotViewportTexture,
  canvas: HTMLCanvasElement,
): () => void {
  if (typeof canvas.getContext !== 'function') {
    throw new TypeError('ViewportTexture TextureRect requires a real HTMLCanvasElement.');
  }
  let canvases = viewportTextureCanvases.get(texture);
  if (canvases === undefined) {
    canvases = new Set();
    viewportTextureCanvases.set(texture, canvases);
  }
  canvas.width = Math.max(1, Math.trunc(texture.size.x));
  canvas.height = Math.max(1, Math.trunc(texture.size.y));
  canvases.add(canvas);
  return () => {
    canvases!.delete(canvas);
    if (canvases!.size === 0) viewportTextureCanvases.delete(texture);
  };
}

function copyViewportCanvas(texture: GodotViewportTexture, source: CanvasImageSource): void {
  const canvases = viewportTextureCanvases.get(texture);
  if (canvases === undefined) return;
  for (const canvas of canvases) {
    const width = Math.max(1, Math.trunc(texture.size.x));
    const height = Math.max(1, Math.trunc(texture.size.y));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null)
      throw new Error('ViewportTexture TextureRect requires a 2D canvas context.');
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
  }
}

function copyThreeViewportPixels(viewport: GodotViewport, renderer: WebGLRenderer): void {
  const texture = viewport.getTexture();
  const canvases = viewportTextureCanvases.get(texture);
  if (canvases === undefined) return;
  const { x: width, y: height } = viewport.size;
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(viewport.getThreeRenderTarget(), 0, 0, width, height, pixels);
  for (const canvas of canvases) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null)
      throw new Error('ViewportTexture TextureRect requires a 2D canvas context.');
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      const sourceStart = (height - y - 1) * width * 4;
      image.data.set(pixels.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
    }
    context.putImageData(image, 0, 0);
  }
}

type ViewportTarget =
  | { readonly backend: 'three'; target: WebGLRenderTarget }
  | { readonly backend: 'pixi'; target: RenderTexture };

function normalizeSize(size: GodotViewportSize): GodotViewportSize {
  return { x: Math.max(1, Math.trunc(size.x)), y: Math.max(1, Math.trunc(size.y)) };
}

function normalizeMsaa(value: number): GodotViewportMsaa {
  if (!Number.isSafeInteger(value) || value < VIEWPORT_MSAA_DISABLED || value > VIEWPORT_MSAA_8X) {
    throw new RangeError('Viewport.msaa must be in [0, 3].');
  }
  return value as GodotViewportMsaa;
}

function normalizeDefaultTextureFilter(value: number): GodotViewportDefaultTextureFilter {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4) {
    throw new RangeError('Viewport.canvas_item_default_texture_filter must be in [0, 4].');
  }
  return value as GodotViewportDefaultTextureFilter;
}

function canvasItemFilterMode(value: GodotViewportDefaultTextureFilter): number {
  return value === VIEWPORT_DEFAULT_TEXTURE_FILTER_NEAREST
    ? 1
    : value === VIEWPORT_DEFAULT_TEXTURE_FILTER_LINEAR
      ? 2
      : value === VIEWPORT_DEFAULT_TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
        ? 4
        : value === VIEWPORT_DEFAULT_TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
          ? 3
          : 0;
}

function createThreeTarget(size: GodotViewportSize, hdr: boolean, msaa: number): WebGLRenderTarget {
  const samples = msaa <= 0 ? 0 : msaa === 1 ? 2 : msaa === 2 ? 4 : 8;
  const target = new WebGLRenderTarget(size.x, size.y, {
    format: RGBAFormat,
    type: hdr ? HalfFloatType : UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples,
  });
  target.depthTexture = new DepthTexture(size.x, size.y);
  target.depthTexture.format = DepthFormat;
  return target;
}

export class GodotViewport {
  private viewportSize: GodotViewportSize;
  private sizeOverride: GodotViewportSize;
  private overrideStretch: boolean;
  private transparent: boolean;
  private ownWorld3d: boolean;
  private ownWorld2d: boolean;
  private audioListener2d: boolean;
  private updateMode: GodotViewportUpdateMode;
  private clearMode: GodotViewportClearMode;
  private disabled3d: boolean;
  private localInput: boolean;
  private snapTransforms: boolean;
  private snapVertices: boolean;
  private canvasTransform: GodotTransform2D = godotTransform2DNew();
  private globalCanvasTransform: GodotTransform2D = godotTransform2DNew();
  private msaaMode: GodotViewportMsaa;
  private hdrEnabled: boolean;
  private keep3dLinear = false;
  private defaultTextureFilter: GodotViewportDefaultTextureFilter =
    VIEWPORT_DEFAULT_TEXTURE_FILTER_LINEAR;
  private visible = true;
  private parentVisible = true;
  private updateRequested = true;
  private disposed = false;
  private readonly textureResource: GodotViewportTexture;

  public constructor(
    private target: ViewportTarget,
    options: GodotViewportOptions = {},
  ) {
    this.viewportSize = normalizeSize(options.size ?? { x: 512, y: 512 });
    this.sizeOverride = options.size2dOverride ?? { x: 0, y: 0 };
    this.overrideStretch = options.size2dOverrideStretch ?? false;
    this.transparent = options.transparentBackground ?? false;
    this.ownWorld3d = options.useOwnWorld3d === true;
    this.ownWorld2d = options.useOwnWorld2d === true;
    this.audioListener2d = options.audioListener2d === true;
    this.updateMode = options.renderTargetUpdateMode ?? VIEWPORT_UPDATE_WHEN_VISIBLE;
    this.clearMode = options.renderTargetClearMode ?? VIEWPORT_CLEAR_ALWAYS;
    this.disabled3d = options.disable3d ?? false;
    this.localInput = options.handleInputLocally ?? true;
    this.snapTransforms = options.snap2dTransformsToPixel ?? false;
    this.snapVertices = options.snap2dVerticesToPixel ?? false;
    this.msaaMode = normalizeMsaa(options.msaa3d ?? VIEWPORT_MSAA_DISABLED);
    this.hdrEnabled = options.useHdr2d ?? false;
    const viewport = this;
    this.textureResource =
      target.backend === 'three'
        ? {
            viewport,
            three: target.target.texture,
            get size() {
              return viewport.size;
            },
          }
        : {
            viewport,
            pixi: target.target,
            get size() {
              return viewport.size;
            },
          };
    registerGodotObjectIdentity(this.textureResource, 'ViewportTexture');
    initializeGodotTextureFlags(this.textureResource);
  }

  public get backend(): 'three' | 'pixi' {
    return this.target.backend;
  }

  public get size(): GodotViewportSize {
    return { x: this.viewportSize.x, y: this.viewportSize.y };
  }

  public set size(value: GodotViewportSize) {
    this.setSize(value);
  }

  public setSize(value: GodotViewportSize): void {
    this.assertLive();
    const size = normalizeSize(value);
    if (size.x === this.viewportSize.x && size.y === this.viewportSize.y) return;
    this.viewportSize = size;
    if (this.target.backend === 'three') this.target.target.setSize(size.x, size.y);
    else this.target.target.resize(size.x, size.y);
    this.updateRequested = true;
  }

  public getTexture(): GodotViewportTexture {
    this.assertLive();
    return this.textureResource;
  }

  public get transparent_bg(): boolean {
    return this.hasTransparentBackground();
  }
  public set transparent_bg(value: boolean) {
    this.setTransparentBackground(value);
  }
  public get render_target_update_mode(): GodotViewportUpdateMode {
    return this.getRenderTargetUpdateMode();
  }
  public set render_target_update_mode(value: GodotViewportUpdateMode) {
    this.setRenderTargetUpdateMode(value);
  }
  public get render_target_clear_mode(): GodotViewportClearMode {
    return this.getRenderTargetClearMode();
  }
  public set render_target_clear_mode(value: GodotViewportClearMode) {
    this.setRenderTargetClearMode(value);
  }
  public get disable_3d(): boolean {
    return this.is3dDisabled();
  }
  public set disable_3d(value: boolean) {
    this.setDisable3d(value);
  }
  public get handle_input_locally(): boolean {
    return this.isHandlingInputLocally();
  }
  public set handle_input_locally(value: boolean) {
    this.setHandleInputLocally(value);
  }
  public get size_2d_override(): GodotViewportSize {
    return this.getSize2dOverride();
  }
  public set size_2d_override(value: GodotViewportSize) {
    this.setSize2dOverride(value);
  }
  public get size_2d_override_stretch(): boolean {
    return this.isSize2dOverrideStretchEnabled();
  }
  public set size_2d_override_stretch(value: boolean) {
    this.setSize2dOverrideStretch(value);
  }
  public get snap_2d_transforms_to_pixel(): boolean {
    return this.isSnap2dTransformsToPixelEnabled();
  }
  public set snap_2d_transforms_to_pixel(value: boolean) {
    this.setSnap2dTransformsToPixel(value);
  }
  public get snap_2d_vertices_to_pixel(): boolean {
    return this.isSnap2dVerticesToPixelEnabled();
  }
  public set snap_2d_vertices_to_pixel(value: boolean) {
    this.setSnap2dVerticesToPixel(value);
  }
  public get use_own_world_3d(): boolean {
    return this.isUsingOwnWorld3d();
  }
  public set use_own_world_3d(value: boolean) {
    this.setUseOwnWorld3d(value);
  }
  public get audio_listener_enable_2d(): boolean {
    return this.isAudioListener2d();
  }
  public set audio_listener_enable_2d(value: boolean) {
    this.setAudioListener2d(value);
  }
  public get canvas_transform(): GodotTransform2D {
    return this.getCanvasTransform();
  }
  public set canvas_transform(value: GodotTransform2D) {
    this.setCanvasTransform(value);
  }
  public get global_canvas_transform(): GodotTransform2D {
    return this.getGlobalCanvasTransform();
  }
  public set global_canvas_transform(value: GodotTransform2D) {
    this.setGlobalCanvasTransform(value);
  }
  public get msaa(): GodotViewportMsaa {
    return this.getMsaa();
  }
  public set msaa(value: GodotViewportMsaa) {
    this.setMsaa(value);
  }
  public get hdr(): boolean {
    return this.isHdrEnabled();
  }
  public set hdr(value: boolean) {
    this.setHdr(value);
  }
  public get keep_3d_linear(): boolean {
    return this.isKeeping3dLinear();
  }
  public set keep_3d_linear(value: boolean) {
    this.setKeep3dLinear(value);
  }
  public get canvas_item_default_texture_filter(): GodotViewportDefaultTextureFilter {
    return this.getDefaultCanvasItemTextureFilter();
  }
  public set canvas_item_default_texture_filter(value: GodotViewportDefaultTextureFilter) {
    this.setDefaultCanvasItemTextureFilter(value);
  }

  public getThreeRenderTarget(): WebGLRenderTarget {
    this.assertLive();
    if (this.target.backend !== 'three') throw new Error('Canvas SubViewport has no Three target.');
    return this.target.target;
  }

  public getPixiRenderTexture(): RenderTexture {
    this.assertLive();
    if (this.target.backend !== 'pixi') throw new Error('Three SubViewport has no Pixi target.');
    return this.target.target;
  }

  public setRenderTargetUpdateMode(mode: GodotViewportUpdateMode): void {
    if (
      !Number.isSafeInteger(mode) ||
      mode < VIEWPORT_UPDATE_DISABLED ||
      mode > VIEWPORT_UPDATE_ALWAYS
    ) {
      throw new RangeError('SubViewport.render_target_update_mode must be in [0, 4].');
    }
    this.updateMode = mode;
    if (mode !== VIEWPORT_UPDATE_DISABLED) this.updateRequested = true;
  }

  public getRenderTargetUpdateMode(): GodotViewportUpdateMode {
    return this.updateMode;
  }

  public setRenderTargetClearMode(mode: GodotViewportClearMode): void {
    if (!Number.isSafeInteger(mode) || mode < VIEWPORT_CLEAR_ALWAYS || mode > VIEWPORT_CLEAR_ONCE) {
      throw new RangeError('SubViewport.render_target_clear_mode must be in [0, 2].');
    }
    this.clearMode = mode;
    if (mode !== VIEWPORT_CLEAR_NEVER) this.updateRequested = true;
  }

  public getRenderTargetClearMode(): GodotViewportClearMode {
    return this.clearMode;
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
  }

  public setParentVisible(visible: boolean): void {
    this.parentVisible = visible;
  }

  public requestUpdate(): void {
    this.updateRequested = true;
  }

  public shouldRender(): boolean {
    if (this.disposed || this.updateMode === VIEWPORT_UPDATE_DISABLED) return false;
    if (this.updateMode === VIEWPORT_UPDATE_ALWAYS) return true;
    if (this.updateMode === VIEWPORT_UPDATE_ONCE) return this.updateRequested;
    return this.updateMode === VIEWPORT_UPDATE_WHEN_VISIBLE ? this.visible : this.parentVisible;
  }

  public shouldClear(): boolean {
    return this.clearMode === VIEWPORT_CLEAR_ALWAYS || this.clearMode === VIEWPORT_CLEAR_ONCE;
  }

  public didRender(): void {
    this.updateRequested = false;
    if (this.updateMode === VIEWPORT_UPDATE_ONCE) this.updateMode = VIEWPORT_UPDATE_DISABLED;
    if (this.clearMode === VIEWPORT_CLEAR_ONCE) this.clearMode = VIEWPORT_CLEAR_NEVER;
  }

  public setTransparentBackground(transparent: boolean): void {
    if (typeof transparent !== 'boolean')
      throw new TypeError('Viewport.transparent_bg requires bool.');
    this.transparent = transparent;
    this.updateRequested = true;
  }

  public hasTransparentBackground(): boolean {
    return this.transparent;
  }

  public setUseOwnWorld3d(own: boolean): void {
    if (typeof own !== 'boolean')
      throw new TypeError('SubViewport.use_own_world_3d requires bool.');
    this.ownWorld3d = own;
  }

  public isUsingOwnWorld3d(): boolean {
    return this.ownWorld3d;
  }

  public isUsingOwnWorld2d(): boolean {
    return this.ownWorld2d;
  }
  public isAudioListener2d(): boolean {
    return this.audioListener2d;
  }
  public setAudioListener2d(enabled: boolean): void {
    if (typeof enabled !== 'boolean')
      throw new TypeError('SubViewport.audio_listener_enable_2d requires bool.');
    this.audioListener2d = enabled;
  }

  public setDisable3d(disabled: boolean): void {
    if (typeof disabled !== 'boolean') throw new TypeError('Viewport.disable_3d requires bool.');
    this.disabled3d = disabled;
  }

  public is3dDisabled(): boolean {
    return this.disabled3d;
  }

  public setHandleInputLocally(local: boolean): void {
    if (typeof local !== 'boolean')
      throw new TypeError('Viewport.handle_input_locally requires bool.');
    this.localInput = local;
  }

  public isHandlingInputLocally(): boolean {
    return this.localInput;
  }

  public setSize2dOverride(size: GodotViewportSize): void {
    if (![size.x, size.y].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new RangeError('SubViewport.size_2d_override requires a non-negative Vector2i.');
    }
    this.sizeOverride = { x: Math.trunc(size.x), y: Math.trunc(size.y) };
  }

  public getSize2dOverride(): GodotViewportSize {
    return this.sizeOverride;
  }

  public setSize2dOverrideStretch(enabled: boolean): void {
    if (typeof enabled !== 'boolean')
      throw new TypeError('SubViewport.size_2d_override_stretch requires bool.');
    this.overrideStretch = enabled;
  }

  public isSize2dOverrideStretchEnabled(): boolean {
    return this.overrideStretch;
  }

  public getCanvasTransformSize(): GodotViewportSize {
    return this.sizeOverride.x > 0 && this.sizeOverride.y > 0
      ? this.sizeOverride
      : this.viewportSize;
  }

  public setSnap2dTransformsToPixel(enabled: boolean): void {
    if (typeof enabled !== 'boolean')
      throw new TypeError('Viewport.snap_2d_transforms_to_pixel requires bool.');
    this.snapTransforms = enabled;
  }

  public isSnap2dTransformsToPixelEnabled(): boolean {
    return this.snapTransforms;
  }

  public setSnap2dVerticesToPixel(enabled: boolean): void {
    if (typeof enabled !== 'boolean')
      throw new TypeError('Viewport.snap_2d_vertices_to_pixel requires bool.');
    this.snapVertices = enabled;
  }

  public isSnap2dVerticesToPixelEnabled(): boolean {
    return this.snapVertices;
  }

  public setCanvasTransform(value: GodotTransform2D): void {
    this.canvasTransform = copyViewportTransform(value);
    this.updateRequested = true;
  }

  public getCanvasTransform(): GodotTransform2D {
    return copyViewportTransform(this.canvasTransform);
  }

  public setGlobalCanvasTransform(value: GodotTransform2D): void {
    this.globalCanvasTransform = copyViewportTransform(value);
    this.updateRequested = true;
  }

  public getGlobalCanvasTransform(): GodotTransform2D {
    return copyViewportTransform(this.globalCanvasTransform);
  }

  public getFinalTransform(): GodotTransform2D {
    // The browser host has no independent stretch transform in the game's logical-pixel space,
    // so Godot's Viewport final transform is exactly the retained global canvas transform.
    return this.getGlobalCanvasTransform();
  }

  public setMsaa(value: number): void {
    const msaa = normalizeMsaa(value);
    if (this.target.backend === 'three') {
      this.target.target.samples = msaa === VIEWPORT_MSAA_DISABLED ? 0 : 2 ** msaa;
    } else if (msaa !== VIEWPORT_MSAA_DISABLED) {
      throw new Error('godot-compat: a Canvas Viewport has no 3D multisample target.');
    }
    this.msaaMode = msaa;
    this.updateRequested = true;
  }

  public getMsaa(): GodotViewportMsaa {
    return this.msaaMode;
  }

  public setHdr(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('Viewport.hdr requires bool.');
    if (this.target.backend === 'three') {
      this.target.target.texture.type = enabled ? HalfFloatType : UnsignedByteType;
      this.target.target.dispose();
    } else if (enabled) {
      throw new Error('godot-compat: a Pixi canvas target cannot provide an HDR 3D framebuffer.');
    }
    this.hdrEnabled = enabled;
    this.updateRequested = true;
  }

  public isHdrEnabled(): boolean {
    return this.hdrEnabled;
  }

  public setKeep3dLinear(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('Viewport.keep_3d_linear requires bool.');
    if (this.target.backend !== 'three') {
      if (enabled) throw new Error('godot-compat: a Pixi canvas target has no 3D color buffer.');
    } else {
      this.target.target.texture.colorSpace = enabled ? NoColorSpace : SRGBColorSpace;
    }
    this.keep3dLinear = enabled;
    this.updateRequested = true;
  }

  public isKeeping3dLinear(): boolean {
    return this.keep3dLinear;
  }

  public setDefaultCanvasItemTextureFilter(value: number): void {
    const filter = normalizeDefaultTextureFilter(value);
    const nativeRoot = pixiNodeByViewport.get(this);
    if (nativeRoot === undefined && this.target.backend !== 'pixi') {
      throw new Error(
        'godot-compat: a Three-only Viewport has no CanvasItem texture sampler owner.',
      );
    }
    if (nativeRoot !== undefined)
      setCanvasItemTextureFilter(nativeRoot, canvasItemFilterMode(filter));
    this.defaultTextureFilter = filter;
    this.updateRequested = true;
  }

  public getDefaultCanvasItemTextureFilter(): GodotViewportDefaultTextureFilter {
    return this.defaultTextureFilter;
  }

  public dispose(): void {
    if (this.disposed) return;
    if (this.target.backend === 'three') {
      this.target.target.depthTexture?.dispose();
      this.target.target.dispose();
    } else this.target.target.destroy(true);
    this.disposed = true;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('SubViewport has been disposed.');
  }
}

export function createThreeSubViewport(options: GodotViewportOptions = {}): GodotViewport {
  const size = normalizeSize(options.size ?? { x: 512, y: 512 });
  return new GodotViewport(
    {
      backend: 'three',
      target: createThreeTarget(size, options.useHdr2d ?? false, options.msaa3d ?? 0),
    },
    { ...options, size },
  );
}

export function createPixiSubViewport(options: GodotViewportOptions = {}): GodotViewport {
  const size = normalizeSize(options.size ?? { x: 512, y: 512 });
  return new GodotViewport(
    {
      backend: 'pixi',
      target: RenderTexture.create({ width: size.x, height: size.y, resolution: 1 }),
    },
    { ...options, size },
  );
}

const subViewportNodes = new WeakMap<object, GodotViewport>();
const pixiNodeByViewport = new WeakMap<GodotViewport, Container>();

interface RetainedMainViewportState {
  canvasTransform: GodotTransform2D;
  globalCanvasTransform: GodotTransform2D;
  defaultTextureFilter: GodotViewportDefaultTextureFilter;
}

const mainViewportState = new WeakMap<object, RetainedMainViewportState>();

function copyViewportTransform(value: GodotTransform2D): GodotTransform2D {
  const numbers = [
    value?.x?.x,
    value?.x?.y,
    value?.y?.x,
    value?.y?.y,
    value?.origin?.x,
    value?.origin?.y,
  ];
  if (numbers.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new TypeError('Viewport.canvas_transform requires a finite Transform2D value.');
  }
  return godotTransform2DNew(value);
}

function retainedMainViewportState(viewportLike: unknown): RetainedMainViewportState {
  if (
    (typeof viewportLike !== 'object' || viewportLike === null) &&
    typeof viewportLike !== 'function'
  ) {
    throw new Error('godot-compat: Viewport transform requires a mounted viewport handle.');
  }
  const owner = viewportLike as object;
  let state = mainViewportState.get(owner);
  if (state === undefined) {
    state = {
      canvasTransform: godotTransform2DNew(),
      globalCanvasTransform: godotTransform2DNew(),
      defaultTextureFilter: VIEWPORT_DEFAULT_TEXTURE_FILTER_LINEAR,
    };
    mainViewportState.set(owner, state);
  }
  return state;
}

function multiplyViewportTransforms(
  left: GodotTransform2D,
  right: GodotTransform2D,
): GodotTransform2D {
  const x = {
    x: left.x.x * right.x.x + left.y.x * right.x.y,
    y: left.x.y * right.x.x + left.y.y * right.x.y,
  };
  const y = {
    x: left.x.x * right.y.x + left.y.x * right.y.y,
    y: left.x.y * right.y.x + left.y.y * right.y.y,
  };
  const origin = {
    x: left.x.x * right.origin.x + left.y.x * right.origin.y + left.origin.x,
    y: left.x.y * right.origin.x + left.y.y * right.origin.y + left.origin.y,
  };
  return godotTransform2DNew(x, y, origin);
}

function applyViewportCanvasTransforms(
  viewportLike: unknown,
  canvasRoot: Container | undefined,
): void {
  const viewport = retainedViewport(viewportLike);
  const canvas =
    viewport?.getCanvasTransform() ?? retainedMainViewportState(viewportLike).canvasTransform;
  const global =
    viewport?.getGlobalCanvasTransform() ??
    retainedMainViewportState(viewportLike).globalCanvasTransform;
  const transform = multiplyViewportTransforms(global, canvas);
  const nativeCanvasRoot = viewport === undefined ? canvasRoot : pixiNodeByViewport.get(viewport);
  if (!(nativeCanvasRoot instanceof Container)) return;
  nativeCanvasRoot.setFromMatrix(
    new Matrix(
      transform.x.x,
      transform.x.y,
      transform.y.x,
      transform.y.y,
      transform.origin.x,
      transform.origin.y,
    ),
  );
}

function retainedViewport(viewportLike: unknown): GodotViewport | undefined {
  if (viewportLike instanceof GodotViewport) return viewportLike;
  if (
    (typeof viewportLike === 'object' && viewportLike !== null) ||
    typeof viewportLike === 'function'
  ) {
    return subViewportNodes.get(viewportLike as object);
  }
  return undefined;
}

/** Retained `Viewport.canvas_transform`; Canvas applies it directly to the native Pixi world root. */
export function setGodotViewportCanvasTransform(
  viewportLike: unknown,
  value: GodotTransform2D,
  canvasRoot?: Container,
): void {
  const transform = copyViewportTransform(value);
  const viewport = retainedViewport(viewportLike);
  if (viewport !== undefined) viewport.setCanvasTransform(transform);
  else retainedMainViewportState(viewportLike).canvasTransform = transform;
  applyViewportCanvasTransforms(viewportLike, canvasRoot);
}

/** Godot Transform2D is a value type, so every viewport transform read returns a fresh copy. */
export function getGodotViewportCanvasTransform(viewportLike: unknown): GodotTransform2D {
  const viewport = retainedViewport(viewportLike);
  return (
    viewport?.getCanvasTransform() ??
    copyViewportTransform(retainedMainViewportState(viewportLike).canvasTransform)
  );
}

/** With the host's logical-pixel viewport mapped 1:1, the final transform is the retained global
 * canvas transform; per-Canvas transforms are intentionally outside this Viewport result. */
export function getGodotViewportFinalTransform(viewportLike: unknown): GodotTransform2D {
  const viewport = retainedViewport(viewportLike);
  return (
    viewport?.getFinalTransform() ??
    copyViewportTransform(retainedMainViewportState(viewportLike).globalCanvasTransform)
  );
}

/** Retained `Viewport.global_canvas_transform`, multiplied ahead of the world's canvas transform. */
export function setGodotViewportGlobalCanvasTransform(
  viewportLike: unknown,
  value: GodotTransform2D,
  canvasRoot?: Container,
): void {
  const transform = copyViewportTransform(value);
  const viewport = retainedViewport(viewportLike);
  if (viewport !== undefined) viewport.setGlobalCanvasTransform(transform);
  else retainedMainViewportState(viewportLike).globalCanvasTransform = transform;
  applyViewportCanvasTransforms(viewportLike, canvasRoot);
}

export function getGodotViewportGlobalCanvasTransform(viewportLike: unknown): GodotTransform2D {
  const viewport = retainedViewport(viewportLike);
  return (
    viewport?.getGlobalCanvasTransform() ??
    copyViewportTransform(retainedMainViewportState(viewportLike).globalCanvasTransform)
  );
}

function requireRetainedViewport(viewportLike: unknown, member: string): GodotViewport {
  const viewport = retainedViewport(viewportLike);
  if (viewport === undefined) {
    throw new Error(`godot-compat: ${member} requires a retained native offscreen Viewport.`);
  }
  return viewport;
}

export function getGodotViewportDisable3d(viewportLike: unknown): boolean {
  return requireRetainedViewport(viewportLike, 'Viewport.disable_3d').is3dDisabled();
}

export function setGodotViewportDisable3d(viewportLike: unknown, disabled: boolean): void {
  requireRetainedViewport(viewportLike, 'Viewport.disable_3d').setDisable3d(disabled);
}

export function getGodotViewportMsaa(viewportLike: unknown): GodotViewportMsaa {
  return requireRetainedViewport(viewportLike, 'Viewport.msaa').getMsaa();
}

export function setGodotViewportMsaa(viewportLike: unknown, msaa: number): void {
  requireRetainedViewport(viewportLike, 'Viewport.msaa').setMsaa(msaa);
}

export function getGodotViewportHdr(viewportLike: unknown): boolean {
  return requireRetainedViewport(viewportLike, 'Viewport.hdr').isHdrEnabled();
}

export function setGodotViewportHdr(viewportLike: unknown, enabled: boolean): void {
  requireRetainedViewport(viewportLike, 'Viewport.hdr').setHdr(enabled);
}

export function getGodotViewportKeep3dLinear(viewportLike: unknown): boolean {
  return requireRetainedViewport(viewportLike, 'Viewport.keep_3d_linear').isKeeping3dLinear();
}

export function setGodotViewportKeep3dLinear(viewportLike: unknown, enabled: boolean): void {
  requireRetainedViewport(viewportLike, 'Viewport.keep_3d_linear').setKeep3dLinear(enabled);
}

/** Godot 3 Viewport.UpdateMode has UPDATE_ALWAYS=3; compat's shared G4-native enum uses 4. */
export function getGodot3ViewportUpdateMode(viewportLike: unknown): number {
  const mode = requireRetainedViewport(
    viewportLike,
    'Viewport.render_target_update_mode',
  ).getRenderTargetUpdateMode();
  return mode === VIEWPORT_UPDATE_ALWAYS ? 3 : mode;
}

export function setGodot3ViewportUpdateMode(viewportLike: unknown, mode: number): void {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 3) {
    throw new RangeError('Viewport.render_target_update_mode must be in [0, 3].');
  }
  requireRetainedViewport(
    viewportLike,
    'Viewport.render_target_update_mode',
  ).setRenderTargetUpdateMode(
    mode === 3 ? VIEWPORT_UPDATE_ALWAYS : (mode as GodotViewportUpdateMode),
  );
}

export function getGodotViewportClearMode(viewportLike: unknown): GodotViewportClearMode {
  return requireRetainedViewport(viewportLike, 'Viewport.clear_mode').getRenderTargetClearMode();
}

export function setGodotViewportClearMode(viewportLike: unknown, mode: number): void {
  requireRetainedViewport(viewportLike, 'Viewport.clear_mode').setRenderTargetClearMode(
    mode as GodotViewportClearMode,
  );
}

export function setGodotViewportSnap2dTransformsToPixel(
  viewportLike: unknown,
  enabled: boolean,
): void {
  const viewport = requireRetainedViewport(viewportLike, 'Viewport.snap_2d_transforms_to_pixel');
  viewport.setSnap2dTransformsToPixel(enabled);
  const nativeRoot = pixiNodeByViewport.get(viewport);
  if (nativeRoot !== undefined) {
    (nativeRoot as Container & { roundPixels: boolean }).roundPixels = enabled;
  }
}

export function getGodotViewportDefaultCanvasItemTextureFilter(
  viewportLike: unknown,
): GodotViewportDefaultTextureFilter {
  const viewport = retainedViewport(viewportLike);
  return (
    viewport?.getDefaultCanvasItemTextureFilter() ??
    retainedMainViewportState(viewportLike).defaultTextureFilter
  );
}

export function setGodotViewportDefaultCanvasItemTextureFilter(
  viewportLike: unknown,
  value: number,
  canvasRoot?: Container,
): void {
  const filter = normalizeDefaultTextureFilter(value);
  const viewport = retainedViewport(viewportLike);
  if (viewport !== undefined) {
    viewport.setDefaultCanvasItemTextureFilter(filter);
    return;
  }
  if (canvasRoot === undefined) {
    throw new Error(
      'godot-compat: Viewport.canvas_item_default_texture_filter requires a mounted Pixi canvas owner.',
    );
  }
  setCanvasItemTextureFilter(canvasRoot, canvasItemFilterMode(filter));
  retainedMainViewportState(viewportLike).defaultTextureFilter = filter;
}

export function bindThreeSubViewportNode<TNode extends object>(
  node: TNode,
  options: GodotViewportOptions = {},
): GodotViewport {
  const existing = subViewportNodes.get(node);
  if (existing !== undefined) return existing;
  const viewport = createThreeSubViewport(options);
  subViewportNodes.set(node, viewport);
  return viewport;
}

/**
 * Bind the native SubViewport while React commits its retained Object3D ref. Child scene layout
 * effects run before their parent's layout effect, so waiting for the parent's attach phase would
 * make a child Camera3D's `_ready` temporarily inherit the main viewport instead.
 */
export function bindThreeSubViewportRef<TNode extends object>(
  setRef: (node: TNode | null) => void,
  options: GodotViewportOptions = {},
): (node: TNode | null) => void {
  return (node) => {
    setRef(node);
    if (node !== null) bindThreeSubViewportNode(node, options);
  };
}

export function bindPixiSubViewportNode<TNode extends Container>(
  node: TNode,
  options: GodotViewportOptions = {},
): GodotViewport {
  const existing = subViewportNodes.get(node);
  if (existing !== undefined) return existing;
  const viewport = createPixiSubViewport(options);
  subViewportNodes.set(node, viewport);
  pixiNodeByViewport.set(viewport, node);
  // A Viewport is a render root, never a visible child of its owning world. Its container is made
  // renderable only while the native renderer targets the Viewport's RenderTexture.
  node.renderable = false;
  registerGodotObjectIdentity(node, 'Viewport');
  return viewport;
}

export type GodotCanvasSubViewport = Container & {
  size: GodotViewportSize;
  transparent_bg: boolean;
  render_target_update_mode: GodotViewportUpdateMode;
  render_target_clear_mode: GodotViewportClearMode;
  disable_3d: boolean;
  handle_input_locally: boolean;
  size_2d_override: GodotViewportSize;
  size_2d_override_stretch: boolean;
  snap_2d_transforms_to_pixel: boolean;
  snap_2d_vertices_to_pixel: boolean;
  use_own_world_3d: boolean;
  audio_listener_enable_2d: boolean;
  set_size(value: GodotViewportSize): void;
  get_size(): GodotViewportSize;
  get_texture(): GodotViewportTexture;
  set_transparent_background(enabled: boolean): void;
  has_transparent_background(): boolean;
  set_update_mode(mode: number): void;
  get_update_mode(): number;
  set_clear_mode(mode: number): void;
  get_clear_mode(): number;
  set_disable_3d(disabled: boolean): void;
  is_3d_disabled(): boolean;
  set_handle_input_locally(enabled: boolean): void;
  is_handling_input_locally(): boolean;
  set_size_2d_override(value: GodotViewportSize): void;
  get_size_2d_override(): GodotViewportSize;
  set_size_2d_override_stretch(enabled: boolean): void;
  is_size_2d_override_stretch_enabled(): boolean;
  set_snap_2d_transforms_to_pixel(enabled: boolean): void;
  is_snap_2d_transforms_to_pixel_enabled(): boolean;
  set_snap_2d_vertices_to_pixel(enabled: boolean): void;
  is_snap_2d_vertices_to_pixel_enabled(): boolean;
  set_use_own_world_3d(enabled: boolean): void;
  is_using_own_world_3d(): boolean;
  set_as_audio_listener_2d(enabled: boolean): void;
  is_audio_listener_2d(): boolean;
};

export function bindGodotCanvasSubViewportApi<T extends Container>(
  source: T,
): T & GodotCanvasSubViewport {
  const node = source as T & GodotCanvasSubViewport;
  const viewport = subViewportOf(node);
  Object.defineProperties(node, {
    size: {
      configurable: true,
      enumerable: true,
      get: () => viewport.size,
      set: (value: GodotViewportSize) => viewport.setSize(value),
    },
    transparent_bg: {
      configurable: true,
      enumerable: true,
      get: () => viewport.hasTransparentBackground(),
      set: (value: boolean) => viewport.setTransparentBackground(value),
    },
    render_target_update_mode: {
      configurable: true,
      enumerable: true,
      get: () => viewport.getRenderTargetUpdateMode(),
      set: (value: GodotViewportUpdateMode) => viewport.setRenderTargetUpdateMode(value),
    },
    render_target_clear_mode: {
      configurable: true,
      enumerable: true,
      get: () => viewport.getRenderTargetClearMode(),
      set: (value: GodotViewportClearMode) => viewport.setRenderTargetClearMode(value),
    },
    disable_3d: {
      configurable: true,
      enumerable: true,
      get: () => viewport.is3dDisabled(),
      set: (value: boolean) => viewport.setDisable3d(value),
    },
    handle_input_locally: {
      configurable: true,
      enumerable: true,
      get: () => viewport.isHandlingInputLocally(),
      set: (value: boolean) => viewport.setHandleInputLocally(value),
    },
    size_2d_override: {
      configurable: true,
      enumerable: true,
      get: () => viewport.getSize2dOverride(),
      set: (value: GodotViewportSize) => viewport.setSize2dOverride(value),
    },
    size_2d_override_stretch: {
      configurable: true,
      enumerable: true,
      get: () => viewport.isSize2dOverrideStretchEnabled(),
      set: (value: boolean) => viewport.setSize2dOverrideStretch(value),
    },
    snap_2d_transforms_to_pixel: {
      configurable: true,
      enumerable: true,
      get: () => viewport.isSnap2dTransformsToPixelEnabled(),
      set: (value: boolean) => viewport.setSnap2dTransformsToPixel(value),
    },
    snap_2d_vertices_to_pixel: {
      configurable: true,
      enumerable: true,
      get: () => viewport.isSnap2dVerticesToPixelEnabled(),
      set: (value: boolean) => viewport.setSnap2dVerticesToPixel(value),
    },
    use_own_world_3d: {
      configurable: true,
      enumerable: true,
      get: () => viewport.isUsingOwnWorld3d(),
      set: (value: boolean) => viewport.setUseOwnWorld3d(value),
    },
    audio_listener_enable_2d: {
      configurable: true,
      enumerable: true,
      get: () => viewport.isAudioListener2d(),
      set: (value: boolean) => viewport.setAudioListener2d(value),
    },
  });
  Object.assign(node, {
    set_size: (value: GodotViewportSize): void => viewport.setSize(value),
    get_size: (): GodotViewportSize => viewport.size,
    get_texture: (): GodotViewportTexture => viewport.getTexture(),
    set_transparent_background: (value: boolean): void => viewport.setTransparentBackground(value),
    has_transparent_background: (): boolean => viewport.hasTransparentBackground(),
    set_update_mode: (value: number): void =>
      viewport.setRenderTargetUpdateMode(value as GodotViewportUpdateMode),
    get_update_mode: (): number => viewport.getRenderTargetUpdateMode(),
    set_clear_mode: (value: number): void =>
      viewport.setRenderTargetClearMode(value as GodotViewportClearMode),
    get_clear_mode: (): number => viewport.getRenderTargetClearMode(),
    set_disable_3d: (value: boolean): void => viewport.setDisable3d(value),
    is_3d_disabled: (): boolean => viewport.is3dDisabled(),
    set_handle_input_locally: (value: boolean): void => viewport.setHandleInputLocally(value),
    is_handling_input_locally: (): boolean => viewport.isHandlingInputLocally(),
    set_size_2d_override: (value: GodotViewportSize): void => viewport.setSize2dOverride(value),
    get_size_2d_override: (): GodotViewportSize => viewport.getSize2dOverride(),
    set_size_2d_override_stretch: (value: boolean): void =>
      viewport.setSize2dOverrideStretch(value),
    is_size_2d_override_stretch_enabled: (): boolean => viewport.isSize2dOverrideStretchEnabled(),
    set_snap_2d_transforms_to_pixel: (value: boolean): void =>
      viewport.setSnap2dTransformsToPixel(value),
    is_snap_2d_transforms_to_pixel_enabled: (): boolean =>
      viewport.isSnap2dTransformsToPixelEnabled(),
    set_snap_2d_vertices_to_pixel: (value: boolean): void =>
      viewport.setSnap2dVerticesToPixel(value),
    is_snap_2d_vertices_to_pixel_enabled: (): boolean => viewport.isSnap2dVerticesToPixelEnabled(),
    set_use_own_world_3d: (value: boolean): void => viewport.setUseOwnWorld3d(value),
    is_using_own_world_3d: (): boolean => viewport.isUsingOwnWorld3d(),
    set_as_audio_listener_2d: (value: boolean): void => viewport.setAudioListener2d(value),
    is_audio_listener_2d: (): boolean => viewport.isAudioListener2d(),
  });
  return node;
}

/** Runtime `SubViewport.new()` retaining an offscreen Pixi RenderTexture root. */
export function createGodotCanvasSubViewport(
  options: GodotViewportOptions = {},
): GodotCanvasSubViewport {
  const node = new Container();
  bindPixiSubViewportNode(node, options);
  registerGodotObjectIdentity(node, 'SubViewport');
  bindGodotCanvasSubViewportApi(node);
  registerCanvasNodeRelease(node, () => releaseSubViewportNode(node));
  return node as unknown as GodotCanvasSubViewport;
}

export function subViewportOf(node: object): GodotViewport {
  const viewport = subViewportNodes.get(node);
  if (viewport === undefined) throw new Error('Node is not bound as a SubViewport.');
  return viewport;
}

/** Script-visible `Viewport.size`, accepting either a retained viewport node/resource or the
 * input-owned main viewport handle. Every read is a Vector2 value copy. */
export function getGodotViewportSize(viewportLike: unknown): GodotViewportSize {
  if (viewportLike instanceof GodotViewport) return viewportLike.size;
  if (
    (typeof viewportLike === 'object' && viewportLike !== null) ||
    typeof viewportLike === 'function'
  ) {
    const retained = subViewportNodes.get(viewportLike as object);
    if (retained !== undefined) return retained.size;
    const getSize = (viewportLike as { readonly getSize?: unknown }).getSize;
    if (typeof getSize === 'function') {
      const value = getSize.call(viewportLike) as GodotViewportSize;
      if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return { x: value.x, y: value.y };
    }
  }
  throw new Error(
    'godot-compat: Viewport.size requires a retained SubViewport or mounted main viewport handle.',
  );
}

/** `Viewport.get_visible_rect()` in the same logical pixel space as `Viewport.size`.
 * A SubViewport and the mounted main viewport both have their origin at (0, 0); host CSS
 * placement is deliberately outside the game viewport coordinate system. */
export function getGodotViewportVisibleRect(viewportLike: unknown): GodotRect2 {
  const size = getGodotViewportSize(viewportLike);
  return rect2(0, 0, size.x, size.y);
}

/** `Viewport.size = value` resizes the owned offscreen target immediately. The browser/main
 * viewport belongs to the host layout and therefore cannot be resized through a scene property. */
export function setGodotViewportSize(viewportLike: unknown, value: GodotViewportSize): void {
  if (viewportLike instanceof GodotViewport) {
    viewportLike.setSize(value);
    return;
  }
  if (
    (typeof viewportLike === 'object' && viewportLike !== null) ||
    typeof viewportLike === 'function'
  ) {
    const retained = subViewportNodes.get(viewportLike as object);
    if (retained !== undefined) {
      retained.setSize(value);
      return;
    }
  }
  throw new Error(
    'godot-compat: Viewport.size writes require an authored retained SubViewport; the main viewport size is host-owned.',
  );
}

export function getGodotViewportRid(viewportLike: unknown): GodotRid {
  if (
    (typeof viewportLike !== 'object' || viewportLike === null) &&
    typeof viewportLike !== 'function'
  ) {
    throw new TypeError('godot-compat: Viewport.get_viewport_rid requires a retained Viewport.');
  }
  return godotRidOfCarrier(viewportLike as object);
}

export function setGodotViewportDisableInput(viewportLike: unknown, disabled: boolean): void {
  const setter = (viewportLike as { readonly setDisableInput?: unknown } | null)?.setDisableInput;
  if (typeof setter !== 'function') {
    throw new Error(
      'godot-compat: Viewport.set_disable_input requires the mounted main input Viewport.',
    );
  }
  setter.call(viewportLike, disabled);
}

type TransparentViewportHandle = {
  readonly hasTransparentBackground?: unknown;
  readonly setTransparentBackground?: unknown;
};

function retainedTransparentViewport(
  viewportLike: unknown,
): GodotViewport | TransparentViewportHandle {
  if (viewportLike instanceof GodotViewport) return viewportLike;
  if (
    (typeof viewportLike === 'object' && viewportLike !== null) ||
    typeof viewportLike === 'function'
  ) {
    const retained = subViewportNodes.get(viewportLike as object);
    if (retained !== undefined) return retained;
    const handle = viewportLike as TransparentViewportHandle;
    if (
      typeof handle.hasTransparentBackground === 'function' &&
      typeof handle.setTransparentBackground === 'function'
    ) {
      return handle;
    }
  }
  throw new Error(
    'godot-compat: Viewport.transparent_bg requires a retained SubViewport or mounted main viewport handle.',
  );
}

/** Value read over the retained offscreen viewport or the mounted renderer's real clear-alpha owner. */
export function getGodotViewportTransparentBackground(viewportLike: unknown): boolean {
  const viewport = retainedTransparentViewport(viewportLike);
  return (viewport.hasTransparentBackground as () => boolean).call(viewport);
}

/** Apply `transparent_bg` to the same retained backend that renders this Viewport. */
export function setGodotViewportTransparentBackground(
  viewportLike: unknown,
  transparent: boolean,
): void {
  const viewport = retainedTransparentViewport(viewportLike);
  (viewport.setTransparentBackground as (value: boolean) => void).call(viewport, transparent);
}

/** `Viewport.get_texture()` returns the one retained ViewportTexture Resource backed directly by
 * the native Three/Pixi render target. The main window is deliberately refused: unlike a
 * SubViewport it has no persistent sampleable render target owned by this compat layer. */
export function getGodotViewportTexture(viewportLike: unknown): GodotViewportTexture {
  if (viewportLike instanceof GodotViewport) return viewportLike.getTexture();
  if (
    (typeof viewportLike === 'object' && viewportLike !== null) ||
    typeof viewportLike === 'function'
  ) {
    const retained = subViewportNodes.get(viewportLike as object);
    if (retained !== undefined) return retained.getTexture();
    const getTexture = (viewportLike as { readonly getTexture?: unknown }).getTexture;
    if (typeof getTexture === 'function') {
      const texture = getTexture.call(viewportLike) as GodotViewportTexture;
      if (typeof texture === 'object' && texture !== null) return texture;
    }
  }
  throw new Error(
    'godot-compat: Viewport.get_texture requires a retained SubViewport or mounted main viewport texture.',
  );
}

/** Current native browser focus owner for the main GUI viewport; offscreen viewports stay loud. */
export function getGodotViewportGuiFocusOwner(viewportLike: unknown): GodotControl | null {
  if (
    viewportLike instanceof GodotViewport ||
    (typeof viewportLike === 'object' &&
      viewportLike !== null &&
      subViewportNodes.has(viewportLike))
  ) {
    throw new Error(
      'godot-compat: Viewport.gui_get_focus_owner is unavailable for an offscreen SubViewport without a native DOM focus tree.',
    );
  }
  return retainedGuiFocusOwner();
}

/** Current retained native pointer target for the main GUI viewport. */
export function getGodotViewportGuiHoveredControl(viewportLike: unknown): GodotControl | null {
  if (
    viewportLike instanceof GodotViewport ||
    (typeof viewportLike === 'object' &&
      viewportLike !== null &&
      subViewportNodes.has(viewportLike))
  ) {
    throw new Error(
      'godot-compat: Viewport.gui_get_hovered_control requires the mounted main GUI viewport.',
    );
  }
  return retainedGuiHoveredOwner();
}

/** The nearest retained SubViewport that owns this Object3D, across PackedScene boundaries. */
export function inheritedSubViewportOf(node: Object3D): GodotViewport | undefined {
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    const viewport = subViewportNodes.get(parent);
    if (viewport !== undefined) return viewport;
  }
  return undefined;
}

export function releaseSubViewportNode(node: object): void {
  const viewport = subViewportNodes.get(node);
  if (viewport === undefined) return;
  const containerNode = containersByViewportNode.get(node);
  if (containerNode !== undefined) {
    releasePixiSubViewportLink(containerNode);
    const container = viewportContainers.get(containerNode);
    if (container !== undefined) {
      container.viewport = null;
      container.viewportNode = null;
    }
    containersByViewportNode.delete(node);
  }
  viewport.dispose();
  subViewportNodes.delete(node);
  const composite = composites.get(node);
  if (composite !== undefined) {
    composite.quad.geometry.dispose();
    composite.quad.material.dispose();
    composites.delete(node);
  }
}

export function renderThreeSubViewport(
  viewport: GodotViewport,
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  viewportRoot?: Object3D,
  clearColor: Color | number | string = 0x000000,
): boolean {
  if (!viewport.shouldRender() || viewport.is3dDisabled()) return false;
  const oldTarget = renderer.getRenderTarget();
  const oldAutoClear = renderer.autoClear;
  const oldColor = renderer.getClearColor(new Color());
  const oldAlpha = renderer.getClearAlpha();
  try {
    renderer.setRenderTarget(viewport.getThreeRenderTarget());
    renderer.autoClear = false;
    if (viewport.shouldClear()) {
      renderer.setClearColor(clearColor, viewport.hasTransparentBackground() ? 0 : 1);
      renderer.clear(true, true, true);
    }
    renderer.render(
      viewport.isUsingOwnWorld3d() && viewportRoot !== undefined
        ? (viewportRoot as unknown as Scene)
        : scene,
      camera,
    );
    copyThreeViewportPixels(viewport, renderer);
    viewport.didRender();
    return true;
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.autoClear = oldAutoClear;
    renderer.setClearColor(oldColor, oldAlpha);
  }
}

export interface PixiViewportRenderer {
  render(options: {
    readonly container: Container;
    readonly target: RenderTexture;
    readonly clear: boolean;
  }): void;
  readonly extract?: { canvas(texture: RenderTexture): CanvasImageSource };
}

export function renderPixiSubViewport(
  viewport: GodotViewport,
  renderer: PixiViewportRenderer,
  root: Container,
): boolean {
  if (!viewport.shouldRender()) return false;
  renderer.render({
    container: root,
    target: viewport.getPixiRenderTexture(),
    clear: viewport.shouldClear(),
  });
  if (viewportTextureCanvases.has(viewport.getTexture())) {
    if (renderer.extract === undefined) {
      throw new Error('ViewportTexture TextureRect requires Pixi renderer.extract.canvas.');
    }
    copyViewportCanvas(
      viewport.getTexture(),
      renderer.extract.canvas(viewport.getPixiRenderTexture()),
    );
  }
  viewport.didRender();
  return true;
}

export interface GodotSubViewportContainerOptions {
  readonly stretch?: boolean;
  readonly stretchShrink?: number;
  readonly mouseTarget?: boolean;
  readonly godotClass?: 'ViewportContainer' | 'SubViewportContainer';
}

export interface GodotSubViewportCanvasState {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly pointerEvents: 'auto' | 'none';
}

export interface GodotSubViewportContainerBinding<TNode extends object> {
  readonly node: TNode;
  viewport: GodotViewport | null;
  viewportNode: object | null;
  stretch: boolean;
  stretchShrink: number;
  mouseTarget: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
}

const viewportContainers = new WeakMap<object, GodotSubViewportContainerBinding<object>>();
const containersByViewportNode = new WeakMap<object, object>();

interface PixiSubViewportLink {
  readonly containerNode: Container;
  readonly viewportNode: Container;
  readonly sprite: Sprite;
}

const PIXI_SUB_VIEWPORT_LINKS = new Set<PixiSubViewportLink>();
const pixiLinkByContainer = new WeakMap<object, PixiSubViewportLink>();

export function bindPixiSubViewportContainer(
  containerNode: Container,
  viewportNode: Container,
): void {
  releasePixiSubViewportLink(containerNode);
  const viewport = subViewportOf(viewportNode);
  if (viewport.backend !== 'pixi')
    throw new Error('ViewportContainer requires a native Pixi Viewport.');
  const sprite = markInternalCanvasChild(new Sprite(viewport.getPixiRenderTexture()));
  containerNode.addChild(sprite);
  viewportNode.renderable = false;
  const link = { containerNode, viewportNode, sprite };
  PIXI_SUB_VIEWPORT_LINKS.add(link);
  pixiLinkByContainer.set(containerNode, link);
  setSubViewportContainerViewport(containerNode, viewport, viewportNode);
}

function releasePixiSubViewportLink(containerNode: object): void {
  const link = pixiLinkByContainer.get(containerNode);
  if (link !== undefined) {
    PIXI_SUB_VIEWPORT_LINKS.delete(link);
    pixiLinkByContainer.delete(containerNode);
    link.viewportNode.renderable = true;
    link.sprite.removeFromParent();
    link.sprite.destroy({ texture: false });
  }
}

export function releaseSubViewportContainerNode(containerNode: object): void {
  releasePixiSubViewportLink(containerNode);
  const binding = viewportContainers.get(containerNode);
  if (binding?.viewportNode !== null && binding?.viewportNode !== undefined) {
    containersByViewportNode.delete(binding.viewportNode);
  }
  viewportContainers.delete(containerNode);
}

function beneath(node: Container, root: Container): boolean {
  for (let current: Container | null = node; current !== null; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

/** Draw every live Godot 3 Viewport to its RenderTexture before Pixi draws the owning world. */
export function renderPixiSubViewports(root: Container, renderer: PixiViewportRenderer): void {
  for (const link of PIXI_SUB_VIEWPORT_LINKS) {
    if (!beneath(link.containerNode, root)) continue;
    const viewport = subViewportOf(link.viewportNode);
    link.viewportNode.renderable = true;
    try {
      renderPixiSubViewport(viewport, renderer, link.viewportNode);
    } finally {
      link.viewportNode.renderable = false;
    }
    const state = subViewportContainerCanvasState(link.containerNode);
    if (state === null) continue;
    link.sprite.position.set(0, 0);
    link.sprite.width = state.width;
    link.sprite.height = state.height;
    link.sprite.eventMode = state.pointerEvents === 'auto' ? 'static' : 'none';
  }
}

export function bindSubViewportContainer<TNode extends object>(
  node: TNode,
  options: GodotSubViewportContainerOptions = {},
): GodotSubViewportContainerBinding<TNode> {
  const binding: GodotSubViewportContainerBinding<TNode> = {
    node,
    viewport: null,
    viewportNode: null,
    stretch: options.stretch ?? false,
    stretchShrink: Math.max(1, Math.trunc(options.stretchShrink ?? 1)),
    mouseTarget: options.mouseTarget ?? true,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  };
  syncSubViewportControlRect(binding as GodotSubViewportContainerBinding<object>);
  viewportContainers.set(node, binding as GodotSubViewportContainerBinding<object>);
  registerGodotObjectIdentity(node, options.godotClass ?? 'SubViewportContainer');
  return binding;
}

export type GodotCanvasSubViewportContainer = Container & {
  stretch: boolean;
  stretch_shrink: number;
  mouse_target: boolean;
  set_stretch(enabled: boolean): void;
  is_stretch_enabled(): boolean;
  set_stretch_shrink(shrink: number): void;
  get_stretch_shrink(): number;
  set_mouse_target(enabled: boolean): void;
  is_mouse_target_enabled(): boolean;
};

export function bindGodotCanvasSubViewportContainerApi<T extends Container>(
  source: T,
): T & GodotCanvasSubViewportContainer {
  const container = source as T & GodotCanvasSubViewportContainer;
  Object.defineProperties(container, {
    stretch: {
      configurable: true,
      enumerable: true,
      get: (): boolean => subViewportContainerBinding(container).stretch,
      set: (value: boolean): void => setSubViewportContainerStretch(container, value),
    },
    stretch_shrink: {
      configurable: true,
      enumerable: true,
      get: (): number => getSubViewportContainerStretchShrink(container),
      set: (value: number): void => setSubViewportContainerStretchShrink(container, value),
    },
    mouse_target: {
      configurable: true,
      enumerable: true,
      get: (): boolean => subViewportContainerBinding(container).mouseTarget,
      set: (value: boolean): void => setSubViewportContainerMouseTarget(container, value),
    },
  });
  Object.assign(container, {
    set_stretch: (value: boolean): void => setSubViewportContainerStretch(container, value),
    is_stretch_enabled: (): boolean => subViewportContainerBinding(container).stretch,
    set_stretch_shrink: (value: number): void =>
      setSubViewportContainerStretchShrink(container, value),
    get_stretch_shrink: (): number => getSubViewportContainerStretchShrink(container),
    set_mouse_target: (value: boolean): void =>
      setSubViewportContainerMouseTarget(container, value),
    is_mouse_target_enabled: (): boolean => subViewportContainerBinding(container).mouseTarget,
  });
  return container;
}

/** Runtime Godot 3 ViewportContainer / Godot 4 SubViewportContainer retained canvas identity. */
export function createGodotCanvasSubViewportContainer(
  major: 3 | 4 = 4,
): GodotCanvasSubViewportContainer {
  const node = bindRuntimeCanvasControl(new Container(), { containerLayout: 'fill' });
  bindSubViewportContainer(node, {
    godotClass: major === 3 ? 'ViewportContainer' : 'SubViewportContainer',
  });
  bindGodotCanvasContainerApi(node);
  bindGodotCanvasSubViewportContainerApi(node);
  registerCanvasNodeRelease(node, () => releaseSubViewportContainerNode(node));
  return node as unknown as GodotCanvasSubViewportContainer;
}

export function subViewportContainerBinding<TNode extends object>(
  node: TNode,
): GodotSubViewportContainerBinding<TNode> {
  const binding = viewportContainers.get(node) as
    | GodotSubViewportContainerBinding<TNode>
    | undefined;
  if (binding === undefined)
    throw new Error('Control node is not bound as a SubViewportContainer.');
  syncSubViewportControlRect(binding as GodotSubViewportContainerBinding<object>);
  return binding;
}

function syncSubViewportControlRect(binding: GodotSubViewportContainerBinding<object>): void {
  const control = binding.node as {
    readonly global_position?: { readonly x?: unknown; readonly y?: unknown };
    readonly size?: { readonly x?: unknown; readonly y?: unknown };
  };
  const position = control.global_position;
  const size = control.size;
  if (
    typeof position?.x !== 'number' ||
    typeof position.y !== 'number' ||
    typeof size?.x !== 'number' ||
    typeof size.y !== 'number'
  ) {
    return;
  }
  binding.x = position.x;
  binding.y = position.y;
  binding.width = Math.max(0, size.x);
  binding.height = Math.max(0, size.y);
}

function fitSubViewportContainer(binding: GodotSubViewportContainerBinding<object>): void {
  if (!binding.stretch || binding.viewport === null || binding.width <= 0 || binding.height <= 0)
    return;
  binding.viewport.setSize({
    x: Math.max(1, Math.trunc(binding.width / binding.stretchShrink)),
    y: Math.max(1, Math.trunc(binding.height / binding.stretchShrink)),
  });
}

export function setSubViewportContainerViewport(
  node: object,
  viewport: GodotViewport | null,
  viewportNode?: object,
): void {
  const binding = subViewportContainerBinding(node);
  if (binding.viewportNode !== null) containersByViewportNode.delete(binding.viewportNode);
  binding.viewport = viewport;
  binding.viewportNode = viewportNode ?? null;
  if (viewportNode !== undefined) containersByViewportNode.set(viewportNode, node);
  fitSubViewportContainer(binding);
}

export function subViewportContainerOf(viewportNode: object): object {
  const container = containersByViewportNode.get(viewportNode);
  if (container === undefined)
    throw new Error('SubViewport is not linked to a SubViewportContainer.');
  return container;
}

export function setSubViewportContainerRect(
  node: object,
  width: number,
  height: number,
  x = 0,
  y = 0,
): void {
  const binding = subViewportContainerBinding(node);
  binding.width = Math.max(0, width);
  binding.height = Math.max(0, height);
  binding.x = x;
  binding.y = y;
  fitSubViewportContainer(binding);
}

interface SubViewportComposite {
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly quad: Mesh<PlaneGeometry, MeshBasicMaterial>;
}

const composites = new WeakMap<object, SubViewportComposite>();

function subViewportComposite(viewportNode: object): SubViewportComposite {
  const existing = composites.get(viewportNode);
  if (existing !== undefined) return existing;
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(
    new PlaneGeometry(2, 2),
    new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false }),
  );
  scene.add(quad);
  const composite = { scene, camera, quad };
  composites.set(viewportNode, composite);
  return composite;
}

export function renderThreeSubViewportContainer(
  viewportNode: object,
  containerNode: object,
  renderer: WebGLRenderer,
  sharedScene: Scene,
  camera: Camera,
  surface: { readonly width: number; readonly height: number },
): boolean {
  const viewport = subViewportOf(viewportNode);
  const container = subViewportContainerBinding(containerNode);
  if (container.width <= 0 || container.height <= 0) return false;
  if (container.stretch) {
    viewport.setSize({
      x: Math.max(1, Math.trunc(container.width / container.stretchShrink)),
      y: Math.max(1, Math.trunc(container.height / container.stretchShrink)),
    });
  }
  const viewportRoot = viewportNode as Object3D;
  if (!renderThreeSubViewport(viewport, renderer, sharedScene, camera, viewportRoot)) return false;
  const oldTarget = renderer.getRenderTarget();
  const oldAutoClear = renderer.autoClear;
  const oldScissorTest = renderer.getScissorTest();
  const oldViewport = renderer.getViewport(new Vector4());
  const oldScissor = renderer.getScissor(new Vector4());
  const composite = subViewportComposite(viewportNode);
  const canvas = subViewportContainerCanvasState(containerNode);
  if (canvas === null || canvas.width <= 0 || canvas.height <= 0) return false;
  composite.quad.material.map = viewport.getThreeRenderTarget().texture;
  composite.quad.material.needsUpdate = true;
  try {
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setViewport(
      canvas.x,
      surface.height - canvas.y - canvas.height,
      canvas.width,
      canvas.height,
    );
    renderer.setScissor(
      canvas.x,
      surface.height - canvas.y - canvas.height,
      canvas.width,
      canvas.height,
    );
    renderer.render(composite.scene, composite.camera);
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setViewport(oldViewport);
    renderer.setScissor(oldScissor);
    renderer.setScissorTest(oldScissorTest);
    renderer.autoClear = oldAutoClear;
  }
  return true;
}

export function setSubViewportContainerStretch(node: object, stretch: boolean): void {
  const binding = subViewportContainerBinding(node);
  binding.stretch = stretch;
  fitSubViewportContainer(binding);
}

export function setSubViewportContainerStretchShrink(node: object, shrink: number): void {
  const binding = subViewportContainerBinding(node);
  binding.stretchShrink = Math.max(1, Math.trunc(shrink));
  fitSubViewportContainer(binding);
}

export function getSubViewportContainerStretchShrink(node: object): number {
  return subViewportContainerBinding(node).stretchShrink;
}

export function setSubViewportContainerMouseTarget(node: object, enabled: boolean): void {
  subViewportContainerBinding(node).mouseTarget = enabled;
}

export function subViewportContainerCanvasState(node: object): GodotSubViewportCanvasState | null {
  const binding = subViewportContainerBinding(node);
  if (binding.viewport === null) return null;
  const source = binding.viewport.size;
  const width = binding.stretch ? binding.width : source.x;
  const height = binding.stretch ? binding.height : source.y;
  return {
    x: binding.x,
    y: binding.y,
    width,
    height,
    sourceWidth: source.x,
    sourceHeight: source.y,
    scaleX: width / source.x,
    scaleY: height / source.y,
    pointerEvents: binding.mouseTarget ? 'auto' : 'none',
  };
}

export function subViewportContainerCanvasPoint(
  node: object,
  x: number,
  y: number,
): GodotViewportSize {
  const state = subViewportContainerCanvasState(node);
  return state === null
    ? { x, y }
    : { x: (x - state.x) / state.scaleX, y: (y - state.y) / state.scaleY };
}
