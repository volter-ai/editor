/** Camera2D, parallax and CanvasModulate over the translated world's retained Pixi tree. */

import { ColorMatrixFilter, Container, Matrix, Point, RenderTexture, Texture, TilingSprite } from 'pixi.js';
import type { ColorValue, Transform2D } from './variant';
import { registerCanvasLightingLayer, releaseCanvasLightingLayer } from './canvas-light-2d';
import { bindGodotCanvasNode2DApi, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';

export interface CanvasPoint { x: number; y: number }

/** CanvasItem.get_viewport_transform over the native Pixi presentation-root matrix. */
export function getCanvasItemViewportTransform(node: Container, root: Container): Transform2D {
  if (node !== root && !root.children.includes(node) && node.parent === null) {
    throw new Error('CanvasItem.get_viewport_transform requires an item retained in its viewport tree.');
  }
  let matrix: Matrix | undefined;
  for (let current: Container | null = node; current !== null; current = current.parent) {
    const layer = CANVAS_LAYERS.get(current as GodotCanvasLayer);
    if (layer === undefined) continue;
    matrix = layer.screenTransform ?? root.getGlobalTransform(new Matrix()).invert()
      .append(current.getGlobalTransform(new Matrix()));
    break;
  }
  matrix ??= root.getGlobalTransform(new Matrix());
  return {
    x: { x: matrix.a, y: matrix.b },
    y: { x: matrix.c, y: matrix.d },
    origin: { x: matrix.tx, y: matrix.ty },
  };
}

/** CanvasItem.get_screen_transform over the retained Pixi presentation transform. */
export function getCanvasItemScreenTransform(node: Container, root: Container): Transform2D {
  let current: Container | null = node;
  while (current !== null && current !== root) current = current.parent;
  if (current !== root) {
    throw new Error('CanvasItem.get_screen_transform requires an item retained in its viewport tree.');
  }
  const matrix = node.getGlobalTransform(new Matrix());
  return {
    x: { x: matrix.a, y: matrix.b },
    y: { x: matrix.c, y: matrix.d },
    origin: { x: matrix.tx, y: matrix.ty },
  };
}

export interface Camera2DOptions {
  readonly viewportSize: CanvasPoint;
  readonly anchorMode?: number;
  readonly enabled?: boolean;
  readonly offset?: CanvasPoint;
  readonly zoom?: CanvasPoint;
  readonly ignoreRotation?: boolean;
  readonly positionSmoothingEnabled?: boolean;
  readonly positionSmoothingSpeed?: number;
  readonly dragHorizontalEnabled?: boolean;
  readonly dragVerticalEnabled?: boolean;
  readonly dragLeftMargin?: number;
  readonly dragTopMargin?: number;
  readonly dragRightMargin?: number;
  readonly dragBottomMargin?: number;
  readonly limitLeft?: number;
  readonly limitTop?: number;
  readonly limitRight?: number;
  readonly limitBottom?: number;
  readonly limitSmoothed?: boolean;
  readonly processCallback?: number;
}

export interface Camera2DApi {
  enabled: boolean;
  current: boolean;
  offset: CanvasPoint;
  zoom: CanvasPoint;
  anchor_mode: number;
  ignore_rotation: boolean;
  position_smoothing_enabled: boolean;
  position_smoothing_speed: number;
  drag_horizontal_enabled: boolean;
  drag_vertical_enabled: boolean;
  drag_left_margin: number;
  drag_top_margin: number;
  drag_right_margin: number;
  drag_bottom_margin: number;
  limit_left: number;
  limit_top: number;
  limit_right: number;
  limit_bottom: number;
  limit_smoothed: boolean;
  process_callback: number;
  make_current(): void;
  is_current(): boolean;
  clear_current(): void;
  set_limit_drawing_enabled(enabled: boolean): void;
  is_limit_drawing_enabled(): boolean;
  set_margin_drawing_enabled(enabled: boolean): void;
  is_margin_drawing_enabled(): boolean;
  set_screen_drawing_enabled(enabled: boolean): void;
  is_screen_drawing_enabled(): boolean;
  reset_smoothing(): void;
  align(): void;
  force_update_scroll(): void;
  get_screen_center_position(): CanvasPoint;
  get_target_position(): CanvasPoint;
  set_limit(margin: number, value: number): void;
  get_limit(margin: number): number;
  set_drag_margin(margin: number, value: number): void;
  get_drag_margin(margin: number): number;
  set_enabled(enabled: boolean): void;
  is_enabled(): boolean;
  set_offset(offset: CanvasPoint): void;
  get_offset(): CanvasPoint;
  set_zoom(zoom: CanvasPoint): void;
  get_zoom(): CanvasPoint;
  set_anchor_mode(mode: number): void;
  get_anchor_mode(): number;
  set_ignore_rotation(ignore: boolean): void;
  is_ignoring_rotation(): boolean;
  set_position_smoothing_enabled(enabled: boolean): void;
  is_position_smoothing_enabled(): boolean;
  set_position_smoothing_speed(speed: number): void;
  get_position_smoothing_speed(): number;
  set_drag_horizontal_enabled(enabled: boolean): void;
  is_drag_horizontal_enabled(): boolean;
  set_drag_vertical_enabled(enabled: boolean): void;
  is_drag_vertical_enabled(): boolean;
  set_limit_smoothing_enabled(enabled: boolean): void;
  is_limit_smoothing_enabled(): boolean;
  set_process_callback(mode: number): void;
  get_process_callback(): number;
}

export type GodotCamera2D = Container & Camera2DApi;

interface CameraBinding {
  readonly camera: GodotCamera2D;
  readonly root: Container;
  readonly viewport: CanvasPoint;
  center: CanvasPoint;
  target: CanvasPoint;
  force: boolean;
}

const CAMERA_BINDINGS = new WeakMap<GodotCamera2D, CameraBinding>();
const ACTIVE_CAMERAS = new WeakMap<Container, GodotCamera2D>();
const CAMERAS_BY_ROOT = new WeakMap<Container, Set<GodotCamera2D>>();

function resetCameraRoot(root: Container): void {
  root.position.set(0, 0);
  root.pivot.set(0, 0);
  root.scale.set(1, 1);
  root.rotation = 0;
}

/** The explicit active-camera listener position; null means viewport-center fallback. */
export function activeCamera2DCenter(root: Container): CanvasPoint | null {
  const camera = ACTIVE_CAMERAS.get(root);
  const binding = camera === undefined ? undefined : CAMERA_BINDINGS.get(camera);
  return binding === undefined ? null : valuePoint(binding.center);
}

/** Current retained Camera2D identity for Viewport.get_camera_2d(). */
export function activeCamera2D(root: Container): GodotCamera2D | null {
  const camera = ACTIVE_CAMERAS.get(root);
  return camera !== undefined && CAMERA_BINDINGS.has(camera) ? camera : null;
}

export interface CanvasLayerApi {
  layer: number;
  follow_viewport_enabled: boolean;
  follow_viewport_scale: number;
  visibility_layer: number;
  custom_viewport: unknown | null;
  offset: CanvasPoint;
  rotation_degrees: number;
  set_layer(value: number): void;
  get_layer(): number;
  set_offset(value: CanvasPoint): void;
  get_offset(): CanvasPoint;
  set_rotation(value: number): void;
  get_rotation(): number;
  set_scale(value: CanvasPoint): void;
  get_scale(): CanvasPoint;
  set_transform(value: Transform2D): void;
  get_transform(): Transform2D;
  get_final_transform(): Transform2D;
  set_follow_viewport(enabled: boolean): void;
  is_following_viewport(): boolean;
  set_follow_viewport_scale(value: number): void;
  get_follow_viewport_scale(): number;
  set_visibility_layer(value: number): void;
  get_visibility_layer(): number;
  set_visibility_layer_bit(layer: number, enabled: boolean): void;
  get_visibility_layer_bit(layer: number): boolean;
  set_custom_viewport(viewport: unknown | null): void;
  get_custom_viewport(): unknown | null;
  get_canvas(): Container;
  show(): void;
  hide(): void;
  is_visible(): boolean;
}
export type GodotCanvasLayer = Container & CanvasLayerApi;
interface CanvasLayerBinding {
  readonly root: Container;
  screenTransform: Matrix | null;
  followViewport: boolean;
  followViewportScale: number;
  visibilityLayer: number;
  customViewport: unknown | null;
}
const CANVAS_LAYERS = new WeakMap<GodotCanvasLayer, CanvasLayerBinding>();

/** Keep the retained CanvasLayer subtree in screen space while the native world root is camera-transformed. */
export function bindCanvasLayer(layer: Container, root: Container, options: { readonly layer?: number } = {}): GodotCanvasLayer {
  const native = layer as GodotCanvasLayer;
  let layerIndex = options.layer ?? 1;
  if (!Number.isSafeInteger(layerIndex)) throw new TypeError('CanvasLayer.layer requires int.');
  Object.defineProperty(native, 'layer', {
    configurable: true,
    enumerable: true,
    get: () => layerIndex,
    set: (value: number) => {
      if (!Number.isSafeInteger(value)) throw new TypeError('CanvasLayer.layer requires int.');
      layerIndex = value;
      registerCanvasLightingLayer(native, value);
    },
  });
  const binding: CanvasLayerBinding = {
    root,
    screenTransform: null,
    followViewport: false,
    followViewportScale: 1,
    visibilityLayer: 1,
    customViewport: null,
  };
  const matrixValue = (): Transform2D => ({
    x: { x: native.scale.x * Math.cos(native.rotation), y: native.scale.x * Math.sin(native.rotation) },
    y: { x: -native.scale.y * Math.sin(native.rotation), y: native.scale.y * Math.cos(native.rotation) },
    origin: { x: native.position.x, y: native.position.y },
  });
  const assignTransform = (value: Transform2D): void => {
    const entries = [value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y];
    if (!entries.every(Number.isFinite)) throw new TypeError('CanvasLayer.transform requires finite Transform2D components.');
    native.setFromMatrix(new Matrix(value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y));
    binding.screenTransform = null;
  };
  Object.defineProperties(native, {
    offset: {
      configurable: true, enumerable: true,
      get: () => native.get_offset(),
      set: (value: CanvasPoint) => native.set_offset(value),
    },
    rotation_degrees: {
      configurable: true, enumerable: true,
      get: () => native.rotation * 180 / Math.PI,
      set: (value: number) => native.set_rotation(value * Math.PI / 180),
    },
    follow_viewport_enabled: {
      configurable: true, enumerable: true,
      get: () => binding.followViewport,
      set: (value: boolean) => native.set_follow_viewport(value),
    },
    follow_viewport_scale: {
      configurable: true, enumerable: true,
      get: () => binding.followViewportScale,
      set: (value: number) => native.set_follow_viewport_scale(value),
    },
    visibility_layer: {
      configurable: true, enumerable: true,
      get: () => binding.visibilityLayer,
      set: (value: number) => native.set_visibility_layer(value),
    },
    custom_viewport: {
      configurable: true, enumerable: true,
      get: () => binding.customViewport,
      set: (value: unknown | null) => native.set_custom_viewport(value),
    },
  });
  Object.assign(native, {
    set_layer: (value: number) => { native.layer = value; },
    get_layer: () => native.layer,
    set_offset(value: CanvasPoint): void {
      if (![value?.x, value?.y].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        throw new TypeError('CanvasLayer.offset requires finite Vector2 components.');
      }
      native.position.set(value.x, value.y);
      binding.screenTransform = null;
    },
    get_offset: (): CanvasPoint => ({ x: native.position.x, y: native.position.y }),
    set_rotation(value: number): void {
      if (!Number.isFinite(value)) throw new TypeError('CanvasLayer.rotation requires finite float.');
      native.rotation = value;
      binding.screenTransform = null;
    },
    get_rotation: (): number => native.rotation,
    set_scale(value: CanvasPoint): void {
      if (![value?.x, value?.y].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        throw new TypeError('CanvasLayer.scale requires finite Vector2 components.');
      }
      native.scale.set(value.x, value.y);
      binding.screenTransform = null;
    },
    get_scale: (): CanvasPoint => ({ x: native.scale.x, y: native.scale.y }),
    set_transform: assignTransform,
    get_transform: matrixValue,
    get_final_transform: (): Transform2D => {
      const matrix = native.getGlobalTransform(new Matrix());
      return {
        x: { x: matrix.a, y: matrix.b }, y: { x: matrix.c, y: matrix.d },
        origin: { x: matrix.tx, y: matrix.ty },
      };
    },
    set_follow_viewport(value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('CanvasLayer.follow_viewport_enabled requires bool.');
      binding.followViewport = value;
    },
    is_following_viewport: (): boolean => binding.followViewport,
    set_follow_viewport_scale(value: number): void {
      if (!Number.isFinite(value) || value <= 0) throw new RangeError('CanvasLayer.follow_viewport_scale requires a positive finite number.');
      binding.followViewportScale = value;
    },
    get_follow_viewport_scale: (): number => binding.followViewportScale,
    set_visibility_layer(value: number): void {
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('CanvasLayer.visibility_layer requires uint32.');
      binding.visibilityLayer = value >>> 0;
    },
    get_visibility_layer: (): number => binding.visibilityLayer,
    set_visibility_layer_bit(layerValue: number, enabled: boolean): void {
      if (!Number.isSafeInteger(layerValue) || layerValue < 1 || layerValue > 20) throw new RangeError('CanvasLayer visibility layer bit requires 1..20.');
      if (typeof enabled !== 'boolean') throw new TypeError('CanvasLayer visibility layer bit requires bool.');
      const bit = 1 << (layerValue - 1);
      binding.visibilityLayer = enabled ? (binding.visibilityLayer | bit) : (binding.visibilityLayer & ~bit);
    },
    get_visibility_layer_bit(layerValue: number): boolean {
      if (!Number.isSafeInteger(layerValue) || layerValue < 1 || layerValue > 20) throw new RangeError('CanvasLayer visibility layer bit requires 1..20.');
      return (binding.visibilityLayer & (1 << (layerValue - 1))) !== 0;
    },
    set_custom_viewport: (viewport: unknown | null): void => { binding.customViewport = viewport; },
    get_custom_viewport: (): unknown | null => binding.customViewport,
    get_canvas: (): Container => native,
    show: (): void => { native.visible = true; },
    hide: (): void => { native.visible = false; },
    is_visible: (): boolean => native.visible,
  });
  registerCanvasLightingLayer(native, layerIndex);
  CANVAS_LAYERS.set(native, binding);
  return native;
}

/** Runtime CanvasLayer.new() over the same retained layer state used by authored scene nodes. */
export function createGodotCanvasLayer(root: Container): GodotCanvasLayer {
  const layer = bindCanvasLayer(new Container(), root);
  registerGodotObjectIdentity(layer, 'CanvasLayer');
  registerCanvasNodeRelease(layer, () => releaseCanvasLayer(layer));
  return layer;
}

export function releaseCanvasLayer(layer: GodotCanvasLayer): void {
  releaseCanvasLightingLayer(layer);
  CANVAS_LAYERS.delete(layer);
}

export function updateCanvasLayer(layer: GodotCanvasLayer): void {
  const binding = CANVAS_LAYERS.get(layer);
  if (binding === undefined) return;
  const rootGlobal = binding.root.getGlobalTransform(new Matrix());
  const outerGlobal = binding.root.parent?.getGlobalTransform(new Matrix()) ?? new Matrix();
  if (binding.screenTransform === null) {
    // Strip the current camera matrix from the already-mounted native layer exactly once. The
    // retained result includes every authored transform between the world root and CanvasLayer.
    binding.screenTransform = rootGlobal.clone().invert().append(layer.getGlobalTransform(new Matrix()));
  }
  const screenTransform = binding.screenTransform.clone();
  if (binding.followViewport) {
    screenTransform.tx *= binding.followViewportScale;
    screenTransform.ty *= binding.followViewportScale;
  }
  const desiredGlobal = outerGlobal.clone().append(screenTransform);
  const parentGlobal = layer.parent?.getGlobalTransform(new Matrix()) ?? new Matrix();
  layer.setFromMatrix(parentGlobal.clone().invert().append(desiredGlobal));
}

function valuePoint(value: CanvasPoint): CanvasPoint { return { x: value.x, y: value.y }; }
function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function cameraContentPosition(camera: Container, root: Container): CanvasPoint {
  const global = camera.getGlobalPosition(new Point());
  const local = root.toLocal(global, undefined, new Point());
  return { x: local.x, y: local.y };
}

function installPointProperty<T extends object>(
  target: T,
  name: string,
  initial: CanvasPoint,
  validate?: (value: CanvasPoint) => void,
): void {
  let held = valuePoint(initial);
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get: () => valuePoint(held),
    set: (value: CanvasPoint) => {
      validate?.(value);
      held = valuePoint(value);
    },
  });
}

function installBooleanProperty<T extends object>(target: T, name: string, initial: boolean): void {
  let held = initial;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get: () => held,
    set: (value: boolean) => {
      if (typeof value !== 'boolean') throw new TypeError(`Camera2D.${name} requires bool.`);
      held = value;
    },
  });
}

function installFiniteProperty<T extends object>(
  target: T,
  name: string,
  initial: number,
  minimum = -Infinity,
): void {
  let held = initial;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get: () => held,
    set: (value: number) => {
      if (!Number.isFinite(value) || value < minimum) {
        throw new RangeError(`Camera2D.${name} requires a finite value >= ${String(minimum)}.`);
      }
      held = value;
    },
  });
}

/** Add Camera2D semantics to the exact Pixi Container authored for the node. */
export function bindCamera2D(node: Container, root: Container, options: Camera2DOptions): GodotCamera2D {
  const camera = bindGodotCanvasNode2DApi(node) as unknown as GodotCamera2D;
  registerGodotObjectIdentity(camera, 'Camera2D');
  installPointProperty(camera, 'offset', options.offset ?? { x: 0, y: 0 }, (value) => {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
      throw new TypeError('Camera2D.offset requires a finite Vector2.');
    }
  });
  installPointProperty(camera, 'zoom', options.zoom ?? { x: 1, y: 1 }, (value) => {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x === 0 || value.y === 0) {
      throw new RangeError('Camera2D.zoom requires a finite Vector2 with non-zero components.');
    }
  });
  let anchorMode = options.anchorMode ?? 1;
  Object.defineProperty(camera, 'anchor_mode', {
    configurable: true,
    enumerable: true,
    get: () => anchorMode,
    set: (value: number) => {
      if (value !== 0 && value !== 1) throw new RangeError('Camera2D.anchor_mode must be FIXED_TOP_LEFT (0) or DRAG_CENTER (1).');
      anchorMode = value;
    },
  });
  installBooleanProperty(camera, 'ignore_rotation', options.ignoreRotation ?? true);
  installBooleanProperty(camera, 'position_smoothing_enabled', options.positionSmoothingEnabled ?? false);
  installFiniteProperty(camera, 'position_smoothing_speed', options.positionSmoothingSpeed ?? 5, 0);
  installBooleanProperty(camera, 'drag_horizontal_enabled', options.dragHorizontalEnabled ?? false);
  installBooleanProperty(camera, 'drag_vertical_enabled', options.dragVerticalEnabled ?? false);
  installFiniteProperty(camera, 'drag_left_margin', options.dragLeftMargin ?? 0.2, 0);
  installFiniteProperty(camera, 'drag_top_margin', options.dragTopMargin ?? 0.2, 0);
  installFiniteProperty(camera, 'drag_right_margin', options.dragRightMargin ?? 0.2, 0);
  installFiniteProperty(camera, 'drag_bottom_margin', options.dragBottomMargin ?? 0.2, 0);
  installFiniteProperty(camera, 'limit_left', options.limitLeft ?? -10_000_000);
  installFiniteProperty(camera, 'limit_top', options.limitTop ?? -10_000_000);
  installFiniteProperty(camera, 'limit_right', options.limitRight ?? 10_000_000);
  installFiniteProperty(camera, 'limit_bottom', options.limitBottom ?? 10_000_000);
  installBooleanProperty(camera, 'limit_smoothed', options.limitSmoothed ?? false);
  let processCallback = options.processCallback ?? 1;
  let limitDrawingEnabled = false;
  let marginDrawingEnabled = false;
  let screenDrawingEnabled = true;
  Object.defineProperty(camera, 'process_callback', {
    configurable: true,
    enumerable: true,
    get: () => processCallback,
    set: (value: number) => {
      if (value !== 0 && value !== 1) {
        throw new RangeError('Camera2D.process_callback must be CAMERA2D_PROCESS_PHYSICS (0) or CAMERA2D_PROCESS_IDLE (1).');
      }
      processCallback = value;
    },
  });
  Object.assign(camera, {
    enabled: options.enabled ?? true,
    current: options.enabled ?? true,
    make_current(): void {
      const prior = ACTIVE_CAMERAS.get(root);
      if (prior !== undefined) prior.current = false;
      camera.enabled = true;
      camera.current = true;
      ACTIVE_CAMERAS.set(root, camera);
      updateCamera2D(camera, 0);
    },
    is_current(): boolean {
      return camera.current;
    },
    set_limit_drawing_enabled(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new TypeError('Camera2D.set_limit_drawing_enabled requires bool.');
      // This flag controls Godot's editor-only limit guide. The exported player retains it but
      // intentionally has no guide to draw, matching the engine's non-editor runtime.
      limitDrawingEnabled = enabled;
    },
    is_limit_drawing_enabled: (): boolean => limitDrawingEnabled,
    set_margin_drawing_enabled(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new TypeError('Camera2D.set_margin_drawing_enabled requires bool.');
      marginDrawingEnabled = enabled;
    },
    is_margin_drawing_enabled: (): boolean => marginDrawingEnabled,
    set_screen_drawing_enabled(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new TypeError('Camera2D.set_screen_drawing_enabled requires bool.');
      screenDrawingEnabled = enabled;
    },
    is_screen_drawing_enabled: (): boolean => screenDrawingEnabled,
    clear_current(): void {
      camera.current = false;
      if (ACTIVE_CAMERAS.get(root) !== camera) return;
      ACTIVE_CAMERAS.delete(root);
      const replacement = [...(CAMERAS_BY_ROOT.get(root) ?? [])].reverse().find((candidate) =>
        candidate !== camera && candidate.enabled && candidate.parent !== null && CAMERA_BINDINGS.has(candidate));
      if (replacement === undefined) resetCameraRoot(root);
      else replacement.make_current();
    },
    reset_smoothing(): void {
      const binding = CAMERA_BINDINGS.get(camera);
      if (binding !== undefined) {
        binding.force = true;
        updateCamera2D(camera, 0);
      }
    },
    align(): void {
      const binding = CAMERA_BINDINGS.get(camera);
      if (binding === undefined) return;
      binding.force = true;
      updateCamera2D(camera, 0);
    },
    force_update_scroll(): void {
      const binding = CAMERA_BINDINGS.get(camera);
      if (binding !== undefined) binding.force = true;
      updateCamera2D(camera, 0);
    },
    get_screen_center_position(): CanvasPoint {
      return valuePoint(CAMERA_BINDINGS.get(camera)?.center ?? { x: 0, y: 0 });
    },
    get_target_position(): CanvasPoint {
      return valuePoint(CAMERA_BINDINGS.get(camera)?.target ?? { x: 0, y: 0 });
    },
    set_limit(margin: number, value: number): void {
      if (margin === 0) camera.limit_left = value;
      else if (margin === 1) camera.limit_top = value;
      else if (margin === 2) camera.limit_right = value;
      else if (margin === 3) camera.limit_bottom = value;
      else throw new RangeError(`Camera2D limit margin ${margin} is invalid.`);
    },
    get_limit(margin: number): number {
      if (margin === 0) return camera.limit_left;
      if (margin === 1) return camera.limit_top;
      if (margin === 2) return camera.limit_right;
      if (margin === 3) return camera.limit_bottom;
      throw new RangeError(`Camera2D limit margin ${margin} is invalid.`);
    },
    set_drag_margin(margin: number, value: number): void {
      if (margin === 0) camera.drag_left_margin = value;
      else if (margin === 1) camera.drag_top_margin = value;
      else if (margin === 2) camera.drag_right_margin = value;
      else if (margin === 3) camera.drag_bottom_margin = value;
      else throw new RangeError(`Camera2D drag margin ${margin} is invalid.`);
    },
    get_drag_margin(margin: number): number {
      if (margin === 0) return camera.drag_left_margin;
      if (margin === 1) return camera.drag_top_margin;
      if (margin === 2) return camera.drag_right_margin;
      if (margin === 3) return camera.drag_bottom_margin;
      throw new RangeError(`Camera2D drag margin ${margin} is invalid.`);
    },
    set_enabled(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new TypeError('Camera2D.enabled requires bool.');
      camera.enabled = enabled;
      if (enabled) camera.make_current();
      else if (ACTIVE_CAMERAS.get(root) === camera) camera.clear_current();
    },
    is_enabled(): boolean { return camera.enabled; },
    set_offset(value: CanvasPoint): void { camera.offset = value; },
    get_offset(): CanvasPoint { return valuePoint(camera.offset); },
    set_zoom(value: CanvasPoint): void { camera.zoom = value; },
    get_zoom(): CanvasPoint { return valuePoint(camera.zoom); },
    set_anchor_mode(value: number): void { camera.anchor_mode = value; },
    get_anchor_mode(): number { return camera.anchor_mode; },
    set_ignore_rotation(value: boolean): void { camera.ignore_rotation = value; },
    is_ignoring_rotation(): boolean { return camera.ignore_rotation; },
    set_position_smoothing_enabled(value: boolean): void { camera.position_smoothing_enabled = value; },
    is_position_smoothing_enabled(): boolean { return camera.position_smoothing_enabled; },
    set_position_smoothing_speed(value: number): void { camera.position_smoothing_speed = value; },
    get_position_smoothing_speed(): number { return camera.position_smoothing_speed; },
    set_drag_horizontal_enabled(value: boolean): void { camera.drag_horizontal_enabled = value; },
    is_drag_horizontal_enabled(): boolean { return camera.drag_horizontal_enabled; },
    set_drag_vertical_enabled(value: boolean): void { camera.drag_vertical_enabled = value; },
    is_drag_vertical_enabled(): boolean { return camera.drag_vertical_enabled; },
    set_limit_smoothing_enabled(value: boolean): void { camera.limit_smoothed = value; },
    is_limit_smoothing_enabled(): boolean { return camera.limit_smoothed; },
    set_process_callback(value: number): void { camera.process_callback = value; },
    get_process_callback(): number { return camera.process_callback; },
  });
  const initial = cameraContentPosition(camera, root);
  CAMERA_BINDINGS.set(camera, { camera, root, viewport: valuePoint(options.viewportSize), center: initial, target: initial, force: true });
  const cameras = CAMERAS_BY_ROOT.get(root) ?? new Set<GodotCamera2D>();
  cameras.add(camera);
  CAMERAS_BY_ROOT.set(root, cameras);
  if (camera.enabled) camera.make_current();
  return camera;
}

/** Runtime Camera2D.new() over the mounted canvas root and its logical viewport dimensions. */
export function createGodotCamera2D(
  root: Container,
  viewportSize: CanvasPoint,
  options: Omit<Camera2DOptions, 'viewportSize'> = {},
): GodotCamera2D {
  const camera = bindCamera2D(new Container(), root, { ...options, viewportSize });
  registerCanvasNodeRelease(camera, () => releaseCamera2D(camera));
  return camera;
}

/** Remove every strong root-owned reference before a translated scene reload/unmount completes. */
export function releaseCamera2D(camera: GodotCamera2D): void {
  const binding = CAMERA_BINDINGS.get(camera);
  if (binding === undefined) return;
  const { root } = binding;
  const cameras = CAMERAS_BY_ROOT.get(root);
  cameras?.delete(camera);
  if (cameras?.size === 0) CAMERAS_BY_ROOT.delete(root);
  CAMERA_BINDINGS.delete(camera);
  camera.current = false;
  if (ACTIVE_CAMERAS.get(root) !== camera) return;
  ACTIVE_CAMERAS.delete(root);
  const replacement = [...(cameras ?? [])].reverse().find((candidate) =>
    candidate.enabled && candidate.parent !== null && CAMERA_BINDINGS.has(candidate));
  if (replacement === undefined) resetCameraRoot(root);
  else replacement.make_current();
}

/** Advance smoothing and write the real canvas root transform/listener pivot. */
export function updateCamera2D(camera: GodotCamera2D, delta: number, processCallback?: number): void {
  if (processCallback !== undefined && camera.process_callback !== processCallback) return;
  const binding = CAMERA_BINDINGS.get(camera);
  if (binding === undefined || !camera.enabled || !camera.current || ACTIVE_CAMERAS.get(binding.root) !== camera) return;
  const position = cameraContentPosition(camera, binding.root);
  let x = position.x + camera.offset.x;
  let y = position.y + camera.offset.y;
  const halfX = binding.viewport.x / (2 * Math.max(Math.abs(camera.zoom.x), Number.EPSILON));
  const halfY = binding.viewport.y / (2 * Math.max(Math.abs(camera.zoom.y), Number.EPSILON));
  if (camera.anchor_mode === 0) {
    x += halfX;
    y += halfY;
  }
  if (camera.anchor_mode === 1 && camera.drag_horizontal_enabled && !binding.force) {
    const left = binding.center.x - halfX * camera.drag_left_margin;
    const right = binding.center.x + halfX * camera.drag_right_margin;
    x = x < left ? x + halfX * camera.drag_left_margin : x > right ? x - halfX * camera.drag_right_margin : binding.center.x;
  }
  if (camera.anchor_mode === 1 && camera.drag_vertical_enabled && !binding.force) {
    const top = binding.center.y - halfY * camera.drag_top_margin;
    const bottom = binding.center.y + halfY * camera.drag_bottom_margin;
    y = y < top ? y + halfY * camera.drag_top_margin : y > bottom ? y - halfY * camera.drag_bottom_margin : binding.center.y;
  }
  const limitedTarget = {
    x: clamp(x, camera.limit_left + halfX, camera.limit_right - halfX),
    y: clamp(y, camera.limit_top + halfY, camera.limit_bottom - halfY),
  };
  binding.target = limitedTarget;
  const amount = binding.force || !camera.position_smoothing_enabled
    ? 1
    : 1 - Math.exp(-camera.position_smoothing_speed * Math.max(0, delta));
  const smoothingTarget = camera.limit_smoothed ? limitedTarget : { x, y };
  const smoothed = {
    x: binding.center.x + (smoothingTarget.x - binding.center.x) * amount,
    y: binding.center.y + (smoothingTarget.y - binding.center.y) * amount,
  };
  binding.center = camera.limit_smoothed
    ? smoothed
    : {
        x: clamp(smoothed.x, camera.limit_left + halfX, camera.limit_right - halfX),
        y: clamp(smoothed.y, camera.limit_top + halfY, camera.limit_bottom - halfY),
      };
  binding.force = false;
  binding.root.position.set(binding.viewport.x / 2, binding.viewport.y / 2);
  binding.root.pivot.set(binding.center.x, binding.center.y);
  binding.root.scale.set(camera.zoom.x, camera.zoom.y);
  let cameraRotation = 0;
  for (let current: Container | null = camera; current !== null && current !== binding.root; current = current.parent) {
    cameraRotation += current.rotation;
  }
  binding.root.rotation = camera.ignore_rotation ? 0 : -cameraRotation;
}

export interface ParallaxBackgroundOptions {
  readonly scrollOffset?: CanvasPoint;
  readonly scrollBaseOffset?: CanvasPoint;
  readonly scrollBaseScale?: CanvasPoint;
  readonly scrollIgnoreCameraZoom?: boolean;
  readonly limitBegin?: CanvasPoint;
  readonly limitEnd?: CanvasPoint;
}
export interface ParallaxBackgroundApi {
  scroll_offset: CanvasPoint;
  scroll_base_offset: CanvasPoint;
  scroll_base_scale: CanvasPoint;
  scroll_ignore_camera_zoom: boolean;
  scroll_limit_begin: CanvasPoint;
  scroll_limit_end: CanvasPoint;
  set_scroll_offset(value: CanvasPoint): void;
  get_scroll_offset(): CanvasPoint;
  set_scroll_base_offset(value: CanvasPoint): void;
  get_scroll_base_offset(): CanvasPoint;
  set_scroll_base_scale(value: CanvasPoint): void;
  get_scroll_base_scale(): CanvasPoint;
  set_limit_begin(value: CanvasPoint): void;
  get_limit_begin(): CanvasPoint;
  set_limit_end(value: CanvasPoint): void;
  get_limit_end(): CanvasPoint;
  set_ignore_camera_zoom(value: boolean): void;
  is_ignore_camera_zoom(): boolean;
}
export type GodotParallaxBackground = Container & ParallaxBackgroundApi;
const PARALLAX_BACKGROUNDS = new WeakMap<GodotParallaxBackground, { root: Container }>();

export function bindParallaxBackground(node: Container, root: Container, options: ParallaxBackgroundOptions = {}): GodotParallaxBackground {
  const background = node as GodotParallaxBackground;
  installPointProperty(background, 'scroll_offset', options.scrollOffset ?? { x: 0, y: 0 });
  installPointProperty(background, 'scroll_base_offset', options.scrollBaseOffset ?? { x: 0, y: 0 });
  installPointProperty(background, 'scroll_base_scale', options.scrollBaseScale ?? { x: 1, y: 1 });
  installPointProperty(background, 'scroll_limit_begin', options.limitBegin ?? { x: -10_000_000, y: -10_000_000 });
  installPointProperty(background, 'scroll_limit_end', options.limitEnd ?? { x: 10_000_000, y: 10_000_000 });
  let ignoreCameraZoom = options.scrollIgnoreCameraZoom ?? false;
  Object.defineProperty(background, 'scroll_ignore_camera_zoom', {
    configurable: true,
    enumerable: true,
    get: () => ignoreCameraZoom,
    set: (value: boolean) => {
      if (typeof value !== 'boolean') throw new TypeError('ParallaxBackground.scroll_ignore_camera_zoom requires bool.');
      ignoreCameraZoom = value;
    },
  });
  Object.assign(background, {
    set_scroll_offset: (value: CanvasPoint) => { background.scroll_offset = value; }, get_scroll_offset: () => background.scroll_offset,
    set_scroll_base_offset: (value: CanvasPoint) => { background.scroll_base_offset = value; }, get_scroll_base_offset: () => background.scroll_base_offset,
    set_scroll_base_scale: (value: CanvasPoint) => { background.scroll_base_scale = value; }, get_scroll_base_scale: () => background.scroll_base_scale,
    set_limit_begin: (value: CanvasPoint) => { background.scroll_limit_begin = value; }, get_limit_begin: () => background.scroll_limit_begin,
    set_limit_end: (value: CanvasPoint) => { background.scroll_limit_end = value; }, get_limit_end: () => background.scroll_limit_end,
    set_ignore_camera_zoom: (value: boolean) => { background.scroll_ignore_camera_zoom = value; }, is_ignore_camera_zoom: () => background.scroll_ignore_camera_zoom,
  });
  PARALLAX_BACKGROUNDS.set(background, { root });
  return background;
}

export function updateParallaxBackground(background: GodotParallaxBackground): void {
  const binding = PARALLAX_BACKGROUNDS.get(background);
  if (binding === undefined) return;
  background.position.set(
    clamp(background.scroll_base_offset.x + background.scroll_offset.x, background.scroll_limit_begin.x, background.scroll_limit_end.x),
    clamp(background.scroll_base_offset.y + background.scroll_offset.y, background.scroll_limit_begin.y, background.scroll_limit_end.y),
  );
  background.scale.set(background.scroll_ignore_camera_zoom ? 1 / binding.root.scale.x : background.scroll_base_scale.x, background.scroll_ignore_camera_zoom ? 1 / binding.root.scale.y : background.scroll_base_scale.y);
}

export function releaseParallaxBackground(background: GodotParallaxBackground): void {
  PARALLAX_BACKGROUNDS.delete(background);
}

/** Runtime Godot 3 `ParallaxBackground.new()` over the retained camera-relative root. */
export function createGodotCanvasParallaxBackground(root: Container): GodotParallaxBackground {
  const background = bindParallaxBackground(new Container(), root);
  registerGodotObjectIdentity(background, 'ParallaxBackground');
  registerCanvasNodeRelease(background, () => releaseParallaxBackground(background));
  return background;
}

export interface ParallaxLayerOptions { readonly motionScale?: CanvasPoint; readonly motionOffset?: CanvasPoint; readonly mirroring?: CanvasPoint }
export interface ParallaxLayerApi {
  motion_scale: CanvasPoint;
  motion_offset: CanvasPoint;
  motion_mirroring: CanvasPoint;
  set_motion_scale(value: CanvasPoint): void;
  get_motion_scale(): CanvasPoint;
  set_motion_offset(value: CanvasPoint): void;
  get_motion_offset(): CanvasPoint;
  set_mirroring(value: CanvasPoint): void;
  get_mirroring(): CanvasPoint;
}
export type GodotParallaxLayer = Container & ParallaxLayerApi;
interface NativeParallaxRepeat {
  readonly root: Container;
  readonly tile: TilingSprite;
  readonly sourceRenderable: WeakMap<Container, boolean>;
  texture: RenderTexture | null;
}
const PARALLAX_LAYERS = new WeakMap<GodotParallaxLayer, NativeParallaxRepeat>();
const PARALLAX_LAYERS_BY_ROOT = new WeakMap<Container, Set<GodotParallaxLayer>>();

function parallaxLayers(root: Container): Set<GodotParallaxLayer> {
  let layers = PARALLAX_LAYERS_BY_ROOT.get(root);
  if (layers === undefined) { layers = new Set(); PARALLAX_LAYERS_BY_ROOT.set(root, layers); }
  return layers;
}

export function bindParallaxLayer(node: Container, root: Container, options: ParallaxLayerOptions = {}): GodotParallaxLayer {
  releaseParallaxLayer(node as GodotParallaxLayer);
  const layer = node as GodotParallaxLayer;
  installPointProperty(layer, 'motion_scale', options.motionScale ?? { x: 1, y: 1 });
  installPointProperty(layer, 'motion_offset', options.motionOffset ?? { x: 0, y: 0 });
  installPointProperty(layer, 'motion_mirroring', options.mirroring ?? { x: 0, y: 0 });
  const tile = markInternalCanvasChild(new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 }));
  tile.renderable = false;
  layer.addChild(tile);
  Object.assign(layer, {
    set_motion_scale: (value: CanvasPoint) => { layer.motion_scale = value; }, get_motion_scale: () => layer.motion_scale,
    set_motion_offset: (value: CanvasPoint) => { layer.motion_offset = value; }, get_motion_offset: () => layer.motion_offset,
    set_mirroring: (value: CanvasPoint) => { layer.motion_mirroring = value; }, get_mirroring: () => layer.motion_mirroring,
  });
  PARALLAX_LAYERS.set(layer, { root, tile, sourceRenderable: new WeakMap(), texture: null });
  parallaxLayers(root).add(layer);
  return layer;
}

export function updateParallaxLayer(layer: GodotParallaxLayer): void {
  const binding = PARALLAX_LAYERS.get(layer);
  if (binding === undefined) return;
  layer.position.set(binding.root.pivot.x * (1 - layer.motion_scale.x) + layer.motion_offset.x, binding.root.pivot.y * (1 - layer.motion_scale.y) + layer.motion_offset.y);
}

export function releaseParallaxLayer(layer: GodotParallaxLayer): void {
  const state = PARALLAX_LAYERS.get(layer);
  if (state === undefined) return;
  parallaxLayers(state.root).delete(layer);
  for (const child of layer.children) {
    if (child !== state.tile) child.renderable = state.sourceRenderable.get(child) ?? child.renderable;
  }
  state.tile.removeFromParent();
  state.tile.destroy({ children: true });
  state.texture?.destroy(true);
  PARALLAX_LAYERS.delete(layer);
}

/** Runtime Godot 3 `ParallaxLayer.new()` with retained repeat-texture composition. */
export function createGodotCanvasParallaxLayer(root: Container): GodotParallaxLayer {
  const layer = bindParallaxLayer(bindGodotCanvasNode2DApi(new Container()), root);
  registerGodotObjectIdentity(layer, 'ParallaxLayer');
  registerCanvasNodeRelease(layer, () => releaseParallaxLayer(layer));
  return layer;
}

export interface Parallax2DOptions {
  readonly scrollScale?: CanvasPoint;
  readonly scrollOffset?: CanvasPoint;
  readonly repeatSize?: CanvasPoint;
  readonly repeatTimes?: number;
  readonly autoscroll?: CanvasPoint;
  readonly limitBegin?: CanvasPoint;
  readonly limitEnd?: CanvasPoint;
  readonly followViewport?: boolean;
  readonly ignoreCameraScroll?: boolean;
}
export interface Parallax2DApi {
  scroll_scale: CanvasPoint;
  scroll_offset: CanvasPoint;
  repeat_size: CanvasPoint;
  repeat_times: number;
  autoscroll: CanvasPoint;
  limit_begin: CanvasPoint;
  limit_end: CanvasPoint;
  follow_viewport: boolean;
  ignore_camera_scroll: boolean;
  set_scroll_scale(value: CanvasPoint): void;
  get_scroll_scale(): CanvasPoint;
  set_scroll_offset(value: CanvasPoint): void;
  get_scroll_offset(): CanvasPoint;
  set_repeat_size(value: CanvasPoint): void;
  get_repeat_size(): CanvasPoint;
  set_repeat_times(value: number): void;
  get_repeat_times(): number;
  set_autoscroll(value: CanvasPoint): void;
  get_autoscroll(): CanvasPoint;
  set_limit_begin(value: CanvasPoint): void;
  get_limit_begin(): CanvasPoint;
  set_limit_end(value: CanvasPoint): void;
  get_limit_end(): CanvasPoint;
  set_follow_viewport(enabled: boolean): void;
  is_following_viewport(): boolean;
  set_ignore_camera_scroll(enabled: boolean): void;
  is_ignoring_camera_scroll(): boolean;
}
export type GodotParallax2D = Container & Parallax2DApi;
const PARALLAX_2D = new WeakMap<GodotParallax2D, NativeParallaxRepeat>();
const PARALLAX_2D_BY_ROOT = new WeakMap<Container, Set<GodotParallax2D>>();
function parallax2DNodes(root: Container): Set<GodotParallax2D> {
  let nodes = PARALLAX_2D_BY_ROOT.get(root);
  if (nodes === undefined) { nodes = new Set(); PARALLAX_2D_BY_ROOT.set(root, nodes); }
  return nodes;
}

export function bindParallax2D(node: Container, root: Container, options: Parallax2DOptions = {}): GodotParallax2D {
  releaseParallax2D(node as GodotParallax2D);
  const parallax = node as GodotParallax2D;
  installPointProperty(parallax, 'scroll_scale', options.scrollScale ?? { x: 1, y: 1 });
  installPointProperty(parallax, 'scroll_offset', options.scrollOffset ?? { x: 0, y: 0 });
  installPointProperty(parallax, 'repeat_size', options.repeatSize ?? { x: 0, y: 0 });
  installPointProperty(parallax, 'autoscroll', options.autoscroll ?? { x: 0, y: 0 });
  installPointProperty(parallax, 'limit_begin', options.limitBegin ?? { x: -10_000_000, y: -10_000_000 });
  installPointProperty(parallax, 'limit_end', options.limitEnd ?? { x: 10_000_000, y: 10_000_000 });
  installBooleanProperty(parallax, 'follow_viewport', options.followViewport ?? true);
  installBooleanProperty(parallax, 'ignore_camera_scroll', options.ignoreCameraScroll ?? false);
  const repeatTimes = options.repeatTimes ?? 1;
  if (!Number.isSafeInteger(repeatTimes) || repeatTimes < 1) throw new RangeError('Parallax2D.repeat_times requires a positive integer.');
  let repeatTimesValue = repeatTimes;
  Object.defineProperty(parallax, 'repeat_times', {
    configurable: true,
    enumerable: true,
    get: () => repeatTimesValue,
    set: (value: number) => {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Parallax2D.repeat_times requires a positive integer.');
      repeatTimesValue = value;
    },
  });
  const tile = markInternalCanvasChild(new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 }));
  tile.renderable = false;
  parallax.addChild(tile);
  Object.assign(parallax, {
    set_scroll_scale: (value: CanvasPoint) => { parallax.scroll_scale = value; }, get_scroll_scale: () => parallax.scroll_scale,
    set_scroll_offset: (value: CanvasPoint) => { parallax.scroll_offset = value; }, get_scroll_offset: () => parallax.scroll_offset,
    set_repeat_size: (value: CanvasPoint) => { parallax.repeat_size = value; }, get_repeat_size: () => parallax.repeat_size,
    set_repeat_times: (value: number) => { parallax.repeat_times = value; }, get_repeat_times: () => parallax.repeat_times,
    set_autoscroll: (value: CanvasPoint) => { parallax.autoscroll = value; }, get_autoscroll: () => parallax.autoscroll,
    set_limit_begin: (value: CanvasPoint) => { parallax.limit_begin = value; }, get_limit_begin: () => parallax.limit_begin,
    set_limit_end: (value: CanvasPoint) => { parallax.limit_end = value; }, get_limit_end: () => parallax.limit_end,
    set_follow_viewport: (value: boolean) => { parallax.follow_viewport = value; }, is_following_viewport: () => parallax.follow_viewport,
    set_ignore_camera_scroll: (value: boolean) => { parallax.ignore_camera_scroll = value; }, is_ignoring_camera_scroll: () => parallax.ignore_camera_scroll,
  });
  PARALLAX_2D.set(parallax, { root, tile, sourceRenderable: new WeakMap(), texture: null });
  parallax2DNodes(root).add(parallax);
  return parallax;
}

export function updateParallax2D(parallax: GodotParallax2D, delta: number): void {
  const binding = PARALLAX_2D.get(parallax);
  if (binding === undefined) return;
  parallax.scroll_offset = { x: parallax.scroll_offset.x + parallax.autoscroll.x * delta, y: parallax.scroll_offset.y + parallax.autoscroll.y * delta };
  const viewport = parallax.follow_viewport && !parallax.ignore_camera_scroll
    ? binding.root.pivot
    : { x: 0, y: 0 };
  parallax.position.set(
    clamp(viewport.x * (1 - parallax.scroll_scale.x) + parallax.scroll_offset.x, parallax.limit_begin.x, parallax.limit_end.x),
    clamp(viewport.y * (1 - parallax.scroll_scale.y) + parallax.scroll_offset.y, parallax.limit_begin.y, parallax.limit_end.y),
  );
}

export function releaseParallax2D(parallax: GodotParallax2D): void {
  const state = PARALLAX_2D.get(parallax);
  if (state === undefined) return;
  parallax2DNodes(state.root).delete(parallax);
  for (const child of parallax.children) {
    if (child !== state.tile) child.renderable = state.sourceRenderable.get(child) ?? child.renderable;
  }
  state.tile.removeFromParent();
  state.tile.destroy({ children: true });
  state.texture?.destroy(true);
  PARALLAX_2D.delete(parallax);
}

/** Runtime Godot 4 `Parallax2D.new()` with retained autoscroll and repeat composition. */
export function createGodotCanvasParallax2D(root: Container): GodotParallax2D {
  const parallax = bindParallax2D(bindGodotCanvasNode2DApi(new Container()), root);
  registerGodotObjectIdentity(parallax, 'Parallax2D');
  registerCanvasNodeRelease(parallax, () => releaseParallax2D(parallax));
  return parallax;
}

export interface CanvasParallaxRenderer {
  render(options: { readonly container: Container; readonly target: RenderTexture; readonly clear: boolean; readonly transform?: Matrix }): void;
}

function updateNativeRepeat(
  node: Container,
  state: NativeParallaxRepeat,
  size: CanvasPoint,
  times: number,
  renderer: CanvasParallaxRenderer,
  viewport: CanvasPoint,
): void {
  const repeats = size.x !== 0 || size.y !== 0;
  const authored = node.children.filter((child) => child !== state.tile);
  for (const child of authored) {
    if (!state.sourceRenderable.has(child)) state.sourceRenderable.set(child, child.renderable);
  }
  if (!repeats || authored.length === 0) {
    state.tile.renderable = false;
    for (const child of authored) child.renderable = state.sourceRenderable.get(child) ?? true;
    return;
  }
  state.tile.renderable = false;
  for (const child of authored) child.renderable = state.sourceRenderable.get(child) ?? true;
  const bounds = node.getLocalBounds();
  const cellWidth = Math.max(1, Math.ceil(Math.abs(size.x || bounds.width || viewport.x)));
  const cellHeight = Math.max(1, Math.ceil(Math.abs(size.y || bounds.height || viewport.y)));
  if (state.texture === null || state.texture.width !== cellWidth || state.texture.height !== cellHeight) {
    state.texture?.destroy(true);
    state.texture = RenderTexture.create({ width: cellWidth, height: cellHeight, resolution: 1 });
    state.tile.texture = state.texture;
  }
  try {
    renderer.render({ container: node, target: state.texture, clear: true, transform: node.worldTransform.clone().invert() });
  } finally {
    for (const child of authored) child.renderable = false;
  }
  state.tile.renderable = true;
  state.tile.position.set(size.x === 0 ? bounds.x : -cellWidth * Math.floor(times / 2), size.y === 0 ? bounds.y : -cellHeight * Math.floor(times / 2));
  state.tile.width = size.x === 0 ? Math.max(1, bounds.width) : cellWidth * times;
  state.tile.height = size.y === 0 ? Math.max(1, bounds.height) : cellHeight * times;
  state.tile.tilePosition.set(node.position.x % cellWidth, node.position.y % cellHeight);
}

/** Host-owned pre-render update for native RenderTexture/TilingSprite parallax repetition. */
export function updateCanvasParallaxRepeats(root: Container, renderer: CanvasParallaxRenderer, viewport: CanvasPoint): void {
  for (const layer of PARALLAX_LAYERS_BY_ROOT.get(root) ?? []) {
    const state = PARALLAX_LAYERS.get(layer);
    if (state !== undefined) updateNativeRepeat(layer, state, layer.motion_mirroring, 3, renderer, viewport);
  }
  for (const parallax of PARALLAX_2D_BY_ROOT.get(root) ?? []) {
    const state = PARALLAX_2D.get(parallax);
    if (state !== undefined) updateNativeRepeat(parallax, state, parallax.repeat_size, parallax.repeat_times, renderer, viewport);
  }
}

export interface CanvasModulateApi {
  color: ColorValue;
  set_color(value: ColorValue): void;
  get_color(): ColorValue;
}
export type GodotCanvasModulate = Container & CanvasModulateApi;
const CANVAS_MODULATES = new WeakMap<GodotCanvasModulate, { root: Container; filter: ColorMatrixFilter }>();

export function bindCanvasModulate(node: Container, root: Container, initial: ColorValue): GodotCanvasModulate {
  const modulate = node as GodotCanvasModulate;
  disposeCanvasModulate(modulate);
  const filter = new ColorMatrixFilter();
  root.filters = [...(root.filters ?? []), filter];
  CANVAS_MODULATES.set(modulate, { root, filter });
  let color = initial;
  Object.defineProperty(modulate, 'color', {
    configurable: true,
    enumerable: true,
    get: () => color,
    set: (value: ColorValue) => {
      if (
        typeof value !== 'object' || value === null ||
        ![value.r, value.g, value.b, value.a].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
      ) throw new TypeError('CanvasModulate.color requires finite Color components.');
      color = { r: value.r, g: value.g, b: value.b, a: value.a };
      filter.matrix = [value.r, 0, 0, 0, 0, 0, value.g, 0, 0, 0, 0, 0, value.b, 0, 0, 0, 0, value.a, 0, 0];
    },
  });
  Object.assign(modulate, {
    set_color(value: ColorValue): void { modulate.color = value; },
    get_color(): ColorValue { return { ...modulate.color }; },
  });
  modulate.color = initial;
  return modulate;
}

/** Runtime CanvasModulate.new() sharing the authored root-filter implementation. */
export function createGodotCanvasModulate(root: Container): GodotCanvasModulate {
  const modulate = bindCanvasModulate(bindGodotCanvasNode2DApi(new Container()), root, { r: 1, g: 1, b: 1, a: 1 });
  registerGodotObjectIdentity(modulate, 'CanvasModulate');
  registerCanvasNodeRelease(modulate, () => disposeCanvasModulate(modulate));
  return modulate;
}

/** Remove only this node's filter; other CanvasModulates and unrelated Pixi filters remain. */
export function disposeCanvasModulate(modulate: GodotCanvasModulate): void {
  const binding = CANVAS_MODULATES.get(modulate);
  if (binding === undefined) return;
  binding.root.filters = (binding.root.filters ?? []).filter((filter) => filter !== binding.filter);
  CANVAS_MODULATES.delete(modulate);
}
