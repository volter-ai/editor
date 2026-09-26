/** Godot CanvasItem immediate drawing on the retained native Pixi Graphics entity. */

import { Container, Graphics, Matrix, Mesh, MeshGeometry, Rectangle, Text, Texture } from 'pixi.js';
import type { GodotRid } from './gdscript-builtins';
import { godotFontCanvasPresentation } from './font';
import { markInternalCanvasChild } from './node';
import {
  installCanvasItemModulate,
  setCanvasYSortEnabled,
  setModulate,
  setNode2DTransform,
  setVisible,
  setZAsRelative,
  setZIndex,
} from './node';
import { godotResourceGetRid, godotResourceOfRid } from './resource-io';
import type { GodotTransform2D } from './transform-2d';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';

export type GodotCanvasDrawMajor = 3 | 4;

interface CanvasDrawState {
  readonly draw: () => void;
  readonly textures: Texture[];
  readonly displayObjects: Container[];
  transform: Matrix;
  dirty: boolean;
  drawing: boolean;
  released: boolean;
  animationSlice: {
    readonly animationLength: number;
    readonly sliceBegin: number;
    readonly sliceEnd: number;
    readonly offset: number;
  } | null;
}

const DRAW_STATE = new WeakMap<Graphics, CanvasDrawState>();
const SERVER_DRAW_TARGETS = new WeakMap<Container, Graphics>();

function serverCanvasItem(rid: GodotRid, member: string): Container {
  const owner = godotResourceOfRid(rid);
  if (!(owner instanceof Container)) {
    throw new TypeError(
      `RenderingServer.${member} RID must identify a retained native Pixi CanvasItem.`,
    );
  }
  return owner;
}

function serverDrawTarget(rid: GodotRid, member: string): Graphics {
  const owner = serverCanvasItem(rid, member);
  if (owner instanceof Graphics) return owner;
  const retained = SERVER_DRAW_TARGETS.get(owner);
  if (retained !== undefined) return retained;
  const created = markInternalCanvasChild(new Graphics());
  owner.addChild(created);
  SERVER_DRAW_TARGETS.set(owner, created);
  return created;
}

/**
 * RenderingServer/VisualServer direct CanvasItem state.
 *
 * These calls deliberately resolve the RID back to the same Pixi entity returned by
 * `CanvasItem.get_canvas_item()`. They do not mirror state in a server wrapper: visibility,
 * transforms, modulation, Z sorting, Y sorting, and light masks are all written into the native
 * object already consumed by Pixi's renderer. An RID that belongs to another Resource family is
 * rejected before any mutation.
 */
export function godotRenderingServerCanvasItemSetVisible(
  rid: GodotRid,
  visible: unknown,
): void {
  if (typeof visible !== 'boolean') {
    throw new TypeError('RenderingServer.canvas_item_set_visible requires bool.');
  }
  setVisible(serverCanvasItem(rid, 'canvas_item_set_visible'), visible);
}

export function godotRenderingServerCanvasItemSetTransform(
  rid: GodotRid,
  transform: unknown,
): void {
  if (
    typeof transform !== 'object' ||
    transform === null ||
    typeof Reflect.get(transform, 'x') !== 'object' ||
    typeof Reflect.get(transform, 'y') !== 'object' ||
    typeof Reflect.get(transform, 'origin') !== 'object'
  ) {
    throw new TypeError('RenderingServer.canvas_item_set_transform requires Transform2D.');
  }
  setNode2DTransform(
    serverCanvasItem(rid, 'canvas_item_set_transform'),
    transform as GodotTransform2D,
  );
}

export function godotRenderingServerCanvasItemSetModulate(
  rid: GodotRid,
  value: unknown,
): void {
  const owner = serverCanvasItem(rid, 'canvas_item_set_modulate');
  installCanvasItemModulate(owner);
  setModulate(
    owner,
    color(value, 'canvas_item_set_modulate'),
  );
}

export function godotRenderingServerCanvasItemSetZIndex(
  rid: GodotRid,
  value: unknown,
): void {
  if (typeof value !== 'number') {
    throw new TypeError('RenderingServer.canvas_item_set_z_index requires int.');
  }
  setZIndex(serverCanvasItem(rid, 'canvas_item_set_z_index'), value);
}

export function godotRenderingServerCanvasItemSetZAsRelativeToParent(
  rid: GodotRid,
  enabled: unknown,
): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('RenderingServer.canvas_item_set_z_as_relative_to_parent requires bool.');
  }
  setZAsRelative(serverCanvasItem(rid, 'canvas_item_set_z_as_relative_to_parent'), enabled);
}

export function godotRenderingServerCanvasItemSetSortChildrenByY(
  rid: GodotRid,
  enabled: unknown,
): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('RenderingServer.canvas_item_set_sort_children_by_y requires bool.');
  }
  setCanvasYSortEnabled(
    serverCanvasItem(rid, 'canvas_item_set_sort_children_by_y'),
    enabled,
  );
}

export function godotRenderingServerCanvasItemSetLightMask(
  rid: GodotRid,
  value: unknown,
): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(
      'RenderingServer.canvas_item_set_light_mask requires an unsigned 32-bit layer mask.',
    );
  }
  const owner = serverCanvasItem(rid, 'canvas_item_set_light_mask') as Container & {
    light_mask?: number;
  };
  if (!('light_mask' in owner)) {
    throw new Error(
      'RenderingServer.canvas_item_set_light_mask requires the retained native CanvasItem lighting owner.',
    );
  }
  owner.light_mask = value;
}

/** Clear the retained immediate command list without changing the CanvasItem's node children. */
export function godotRenderingServerCanvasItemClear(rid: GodotRid): void {
  const owner = serverCanvasItem(rid, 'canvas_item_clear');
  const target = owner instanceof Graphics ? owner : SERVER_DRAW_TARGETS.get(owner);
  if (target === undefined) return;
  target.clear();
}

export function godotRenderingServerCanvasItemAddLine(
  rid: GodotRid,
  fromValue: unknown,
  toValue: unknown,
  colorValue: unknown,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  const from = point(fromValue, 'canvas_item_add_line', 'from');
  const to = point(toValue, 'canvas_item_add_line', 'to');
  const tint = pixiColor(color(colorValue, 'canvas_item_add_line'));
  const width = finite(widthValue, 'canvas_item_add_line', 'width');
  const antialiased = boolean(antialiasedValue, 'canvas_item_add_line', 'antialiased');
  if (width < 0 || antialiased) {
    throw new Error(
      'RenderingServer.canvas_item_add_line requires a non-negative width and antialiased=false on the native Pixi Graphics path.',
    );
  }
  serverDrawTarget(rid, 'canvas_item_add_line')
    .moveTo(from.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ ...tint, width, cap: 'butt' });
}

export function godotRenderingServerCanvasItemAddCircle(
  rid: GodotRid,
  positionValue: unknown,
  radiusValue: unknown,
  colorValue: unknown,
): void {
  const position = point(positionValue, 'canvas_item_add_circle', 'position');
  const radius = finite(radiusValue, 'canvas_item_add_circle', 'radius');
  if (radius < 0) {
    throw new RangeError('RenderingServer.canvas_item_add_circle radius must be non-negative.');
  }
  serverDrawTarget(rid, 'canvas_item_add_circle')
    .circle(position.x, position.y, radius)
    .fill(pixiColor(color(colorValue, 'canvas_item_add_circle')));
}

function finite(value: unknown, member: string, argument: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`CanvasItem.${member} ${argument} must be a finite number.`);
  }
  return value;
}

function boolean(value: unknown, member: string, argument: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`CanvasItem.${member} ${argument} must be a bool.`);
  }
  return value;
}

function point(value: unknown, member: string, argument: string): Vector2 {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof Reflect.get(value, 'x') !== 'number' ||
    typeof Reflect.get(value, 'y') !== 'number'
  ) {
    throw new TypeError(`CanvasItem.${member} ${argument} must be a Vector2.`);
  }
  return {
    x: finite(Reflect.get(value, 'x'), member, `${argument}.x`),
    y: finite(Reflect.get(value, 'y'), member, `${argument}.y`),
  };
}

function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`CanvasItem.${member} color must be a Color.`);
  }
  return {
    r: finite(Reflect.get(value, 'r'), member, 'color.r'),
    g: finite(Reflect.get(value, 'g'), member, 'color.g'),
    b: finite(Reflect.get(value, 'b'), member, 'color.b'),
    a: finite(Reflect.get(value, 'a'), member, 'color.a'),
  };
}

function pixiColor(value: ColorValue): { color: number; alpha: number } {
  const byte = (component: number): number =>
    Math.max(0, Math.min(255, Math.round(component * 255)));
  return {
    color: (byte(value.r) << 16) | (byte(value.g) << 8) | byte(value.b),
    alpha: Math.max(0, Math.min(1, value.a)),
  };
}

function stateOf(node: Graphics, member: string): CanvasDrawState {
  const state = DRAW_STATE.get(node);
  if (state === undefined || state.released) {
    throw new Error(`godot-compat: CanvasItem.${member} reached an unbound or released Graphics.`);
  }
  return state;
}

function drawing(node: Graphics, member: string): CanvasDrawState {
  const state = stateOf(node, member);
  if (!state.drawing) {
    throw new Error(
      `godot-compat: CanvasItem.${member} may only be called from the CanvasItem's _draw callback.`,
    );
  }
  return state;
}

/** CanvasItem.get_canvas_item(): the retained Pixi entity's stable rendering RID. */
export function godotCanvasItemRid(node: Container): GodotRid {
  if (!(node instanceof Container)) {
    throw new TypeError('godot-compat: CanvasItem.get_canvas_item requires a native Pixi Container.');
  }
  return godotResourceGetRid(node);
}

/** Resolve a canvas RID only while its immediate command list is being recorded. */
export function godotCanvasDrawingTarget(rid: GodotRid): Graphics {
  const node = godotResourceOfRid(rid);
  if (!(node instanceof Graphics)) {
    throw new TypeError(
      'godot-compat: StyleBox.draw canvas_item RID does not identify a native Pixi Graphics.',
    );
  }
  drawing(node, 'draw_style_box');
  return node;
}

/** RenderingServer command-list insertion on the retained Pixi Graphics identified by its RID. */
export function godotRenderingServerCanvasItemAddPolygon(
  rid: GodotRid,
  pointsValue: readonly unknown[],
  colorsValue: readonly unknown[],
  uvs: readonly unknown[] = [],
  texture: GodotRid = { id: 0n },
): void {
  const owner = godotResourceOfRid(rid);
  if (!(owner instanceof Container)) {
    throw new TypeError('RenderingServer.canvas_item_add_polygon RID must identify a retained Pixi CanvasItem.');
  }
  const node = owner instanceof Graphics ? owner : (() => {
    const retained = SERVER_DRAW_TARGETS.get(owner);
    if (retained !== undefined) return retained;
    const created = markInternalCanvasChild(new Graphics());
    owner.addChild(created);
    SERVER_DRAW_TARGETS.set(owner, created);
    return created;
  })();
  if (uvs.length !== 0 || texture.id !== 0n) {
    throw new Error('RenderingServer.canvas_item_add_polygon textured/UV polygons are unavailable on the native Pixi Graphics path.');
  }
  const points = pointsValue.map((value, index) => point(value, 'canvas_item_add_polygon', `points[${index}]`));
  if (points.length < 3) throw new RangeError('RenderingServer.canvas_item_add_polygon requires at least three points.');
  if (colorsValue.length !== 1 && colorsValue.length !== points.length) {
    throw new RangeError('RenderingServer.canvas_item_add_polygon colors must contain one color or one per point.');
  }
  const colors = colorsValue.map((value) => color(value, 'canvas_item_add_polygon'));
  const first = colors[0] ?? { r: 1, g: 1, b: 1, a: 1 };
  if (colors.some((entry) => entry.r !== first.r || entry.g !== first.g || entry.b !== first.b || entry.a !== first.a)) {
    throw new Error('RenderingServer.canvas_item_add_polygon per-vertex color interpolation is unavailable on Pixi Graphics.');
  }
  node.poly(points.flatMap((entry) => [entry.x, entry.y]), true).fill(pixiColor(first));
}

export type GodotCanvasDrawable = Graphics & {
  queue_redraw(): void;
  update(): void;
  get_canvas_item(): GodotRid;
  draw_set_transform(position: unknown, rotation?: unknown, scale?: unknown): void;
  draw_set_transform_matrix(transform: unknown): void;
  draw_animation_slice(animationLength: number, sliceBegin: number, sliceEnd: number, offset?: number): void;
  draw_end_animation(): void;
  draw_line(...args: unknown[]): void;
  draw_circle(...args: unknown[]): void;
  draw_ellipse(...args: unknown[]): void;
  draw_arc(...args: unknown[]): void;
  draw_ellipse_arc(...args: unknown[]): void;
  draw_rect(...args: unknown[]): void;
  draw_string(...args: unknown[]): void;
  draw_string_outline(...args: unknown[]): void;
  draw_multiline_string(...args: unknown[]): void;
  draw_multiline_string_outline(...args: unknown[]): void;
  draw_char(...args: unknown[]): number;
  draw_char_outline(...args: unknown[]): number;
  draw_polyline(...args: unknown[]): void;
  draw_polyline_colors(...args: unknown[]): void;
  draw_multiline(...args: unknown[]): void;
  draw_multiline_colors(...args: unknown[]): void;
  draw_polygon(...args: unknown[]): void;
  draw_colored_polygon(...args: unknown[]): void;
  draw_primitive(...args: unknown[]): void;
  draw_mesh(...args: unknown[]): void;
  draw_multimesh(...args: unknown[]): void;
  draw_style_box(...args: unknown[]): void;
  draw_dashed_line(...args: unknown[]): void;
  draw_texture(...args: unknown[]): void;
  draw_texture_rect(...args: unknown[]): void;
  draw_texture_rect_region(...args: unknown[]): void;
  draw_lcd_texture_rect_region(...args: unknown[]): void;
  draw_msdf_texture_rect_region(...args: unknown[]): void;
};

/** Seat source-visible CanvasItem draw members directly on the retained native Graphics. */
export function bindGodotCanvasDrawApi(
  source: Graphics,
  major: GodotCanvasDrawMajor,
): GodotCanvasDrawable {
  const node = source as GodotCanvasDrawable;
  const invoke = (callable: (...values: never[]) => unknown, prefix: unknown[], args: unknown[]): unknown =>
    Reflect.apply(callable, undefined, [...prefix, ...args]);
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    queue_redraw: () => queueCanvasRedraw(node),
    update: () => queueCanvasRedraw(node),
    get_canvas_item: () => godotCanvasItemRid(node),
    draw_set_transform: (position, rotation = 0, scale = { x: 1, y: 1 }) =>
      godotCanvasDrawSetTransform(node, position, rotation, scale),
    draw_set_transform_matrix: (transform) => godotCanvasDrawSetTransformMatrix(node, transform),
    draw_animation_slice: (animationLength, sliceBegin, sliceEnd, offset = 0) =>
      godotCanvasDrawAnimationSlice(node, animationLength, sliceBegin, sliceEnd, offset),
    draw_end_animation: () => godotCanvasDrawEndAnimation(node),
    draw_line: (...args) => invoke(godotCanvasDrawLine as never, [node, major], args),
    draw_circle: (...args) => invoke(godotCanvasDrawCircle as never, [node, major], args),
    draw_ellipse: (...args) => invoke(godotCanvasDrawEllipse as never, [node], args),
    draw_arc: (...args) => invoke(godotCanvasDrawArc as never, [node], args),
    draw_ellipse_arc: (...args) => invoke(godotCanvasDrawEllipseArc as never, [node], args),
    draw_rect: (...args) => invoke(godotCanvasDrawRect as never, [node], args),
    draw_string: (...args) => invoke(godotCanvasDrawString as never, [node, major], args),
    draw_string_outline: (...args) => invoke(godotCanvasDrawStringOutline as never, [node], args),
    draw_multiline_string: (...args) => invoke(godotCanvasDrawMultilineString as never, [node], args),
    draw_multiline_string_outline: (...args) => invoke(godotCanvasDrawMultilineStringOutline as never, [node], args),
    draw_char: (...args) => invoke(godotCanvasDrawChar as never, [node, major], args),
    draw_char_outline: (...args) => invoke(godotCanvasDrawCharOutline as never, [node], args),
    draw_polyline: (...args) => invoke(godotCanvasDrawPolyline as never, [node, major], args),
    draw_polyline_colors: (...args) => invoke(godotCanvasDrawPolylineColors as never, [node, major], args),
    draw_multiline: (...args) => invoke(godotCanvasDrawMultiline as never, [node, major], args),
    draw_multiline_colors: (...args) => invoke(godotCanvasDrawMultilineColors as never, [node, major], args),
    draw_polygon: (...args) => invoke(godotCanvasDrawPolygon as never, [node, major], args),
    draw_colored_polygon: (...args) => invoke(godotCanvasDrawColoredPolygon as never, [node, major], args),
    draw_primitive: (...args) => invoke(godotCanvasDrawPrimitive as never, [node, major], args),
    draw_mesh: (...args) => invoke(godotCanvasDrawMesh as never, [node, major], args),
    draw_multimesh: (...args) => invoke(godotCanvasDrawMultiMesh as never, [node], args),
    draw_style_box: (...args) => invoke(godotCanvasDrawStyleBox as never, [node], args),
    draw_dashed_line: (...args) => invoke(godotCanvasDrawDashedLine as never, [node], args),
    draw_texture: (...args) => invoke(godotCanvasDrawTexture as never, [node, major], args),
    draw_texture_rect: (...args) => invoke(godotCanvasDrawTextureRect as never, [node, major], args),
    draw_texture_rect_region: (...args) => invoke(godotCanvasDrawTextureRectRegion as never, [node, major], args),
    draw_lcd_texture_rect_region: (...args) => invoke(godotCanvasDrawLcdTextureRectRegion as never, [node], args),
    draw_msdf_texture_rect_region: (...args) => invoke(godotCanvasDrawMsdfTextureRectRegion as never, [node], args),
  };
  Object.defineProperties(node, Object.fromEntries(
    Object.entries(methods).map(([name, value]) => [name, {
      configurable: true,
      enumerable: false,
      writable: true,
      value,
    }]),
  ));
  return node;
}

/**
 * Bind one translated `_draw` callback to its retained Pixi Graphics identity.
 *
 * Godot records draw commands during NOTIFICATION_DRAW, retains them between frames, clears the
 * old command list immediately before a requested redraw, and invokes `_draw` once. The dirty bit
 * below is that command-list lifecycle; it never replays commands every render frame.
 */
export function bindCanvasDraw(
  node: Graphics,
  draw: () => void,
  major: GodotCanvasDrawMajor = 4,
): () => void {
  if (!(node instanceof Graphics)) {
    throw new TypeError('godot-compat: a CanvasItem with _draw must retain a Pixi Graphics entity.');
  }
  if (DRAW_STATE.has(node)) {
    throw new Error('godot-compat: CanvasItem drawing is already bound to this Graphics.');
  }
  if (typeof draw !== 'function') {
    throw new TypeError('godot-compat: CanvasItem draw binding requires a _draw callback.');
  }
  bindGodotCanvasDrawApi(node, major);
  const state: CanvasDrawState = {
    draw,
    textures: [],
    displayObjects: [],
    transform: new Matrix(),
    dirty: true,
    drawing: false,
    released: false,
    animationSlice: null,
  };
  DRAW_STATE.set(node, state);
  return () => {
    if (state.released) return;
    state.released = true;
    state.dirty = false;
    state.drawing = false;
    for (const texture of state.textures.splice(0)) texture.destroy(false);
    for (const child of state.displayObjects.splice(0)) child.destroy({ children: true });
    DRAW_STATE.delete(node);
  };
}

/** Godot 3 `update()` / Godot 4 `queue_redraw()` coalesce until the next draw phase. */
export function queueCanvasRedraw(node: Graphics): void {
  const state = stateOf(node, 'queue_redraw');
  state.dirty = true;
}

/** Run from the emitted canvas draw phase after idle processing and before render. */
export function flushCanvasRedraw(node: Graphics): void {
  const state = stateOf(node, '_draw');
  if (!state.dirty) return;
  state.dirty = false;
  for (const texture of state.textures.splice(0)) texture.destroy(false);
  for (const child of state.displayObjects.splice(0)) child.destroy({ children: true });
  node.clear();
  node.resetTransform();
  state.transform.identity();
  state.drawing = true;
  try {
    state.draw();
  } finally {
    state.drawing = false;
  }
}

/**
 * Godot 3 `CanvasItem.draw_set_transform(position, rotation, scale)` replaces the transform used
 * by every following command in the current `_draw` command list. Pixi Graphics retains the same
 * per-command context matrix, so no display-object or authored Node2D transform is mutated.
 */
export function godotCanvasDrawSetTransform(
  node: Graphics,
  positionValue: unknown,
  rotationValue: unknown = 0,
  scaleValue: unknown = { x: 1, y: 1 },
): void {
  const state = drawing(node, 'draw_set_transform');
  const position = point(positionValue, 'draw_set_transform', 'position');
  const rotation = finite(rotationValue, 'draw_set_transform', 'rotation');
  const scale = point(scaleValue, 'draw_set_transform', 'scale');
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const transform = new Matrix(
    cosine * scale.x,
    sine * scale.x,
    -sine * scale.y,
    cosine * scale.y,
    position.x,
    position.y,
  );
  state.transform = transform.clone();
  node.setFromMatrix(transform);
}

/** Godot 4 `draw_set_transform_matrix()` replaces the following command transform verbatim. */
export function godotCanvasDrawSetTransformMatrix(
  node: Graphics,
  transformValue: unknown,
): void {
  const state = drawing(node, 'draw_set_transform_matrix');
  if (typeof transformValue !== 'object' || transformValue === null) {
    throw new TypeError('CanvasItem.draw_set_transform_matrix transform must be a Transform2D.');
  }
  const x = point(Reflect.get(transformValue, 'x'), 'draw_set_transform_matrix', 'transform.x');
  const y = point(Reflect.get(transformValue, 'y'), 'draw_set_transform_matrix', 'transform.y');
  const origin = point(
    Reflect.get(transformValue, 'origin'),
    'draw_set_transform_matrix',
    'transform.origin',
  );
  const transform = new Matrix(x.x, x.y, y.x, y.y, origin.x, origin.y);
  state.transform = transform.clone();
  node.setFromMatrix(transform);
}

/** Begin a timed command slice for subsequent CanvasItem draw commands. */
export function godotCanvasDrawAnimationSlice(
  node: Graphics,
  animationLengthValue: unknown,
  sliceBeginValue: unknown,
  sliceEndValue: unknown,
  offsetValue: unknown = 0,
): void {
  const state = drawing(node, 'draw_animation_slice');
  const animationLength = finite(animationLengthValue, 'draw_animation_slice', 'animation_length');
  const sliceBegin = finite(sliceBeginValue, 'draw_animation_slice', 'slice_begin');
  const sliceEnd = finite(sliceEndValue, 'draw_animation_slice', 'slice_end');
  const offset = finite(offsetValue, 'draw_animation_slice', 'offset');
  if (animationLength < 0 || sliceBegin < 0 || sliceBegin > sliceEnd || sliceEnd > animationLength) {
    throw new RangeError(
      'CanvasItem.draw_animation_slice requires 0 <= slice_begin <= slice_end <= animation_length.',
    );
  }
  state.animationSlice = { animationLength, sliceBegin, sliceEnd, offset };
}

/** End the current timed command slice; following draw commands are unconditional. */
export function godotCanvasDrawEndAnimation(node: Graphics): void {
  drawing(node, 'draw_end_animation').animationSlice = null;
}

export function godotCanvasDrawString(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  fontValue: unknown,
  positionValue: unknown,
  textValue: unknown,
  fourthValue: unknown = major === 3 ? { r: 1, g: 1, b: 1, a: 1 } : 0,
  fifthValue: unknown = -1,
  sixthValue: unknown = 16,
  seventhValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  eighthValue: unknown = 3,
  ninthValue: unknown = 0,
  tenthValue: unknown = 0,
  eleventhValue: unknown = 0,
  outlineSizeValue: unknown = 0,
): void {
  const state = drawing(node, 'draw_string');
  const position = point(positionValue, 'draw_string', major === 3 ? 'position' : 'pos');
  if (typeof textValue !== 'string') {
    throw new TypeError('CanvasItem.draw_string text must be a String.');
  }

  let requestedSize: number | undefined;
  let modulateValue: unknown;
  let clipWidth = -1;
  if (major === 3) {
    modulateValue = fourthValue;
    clipWidth = finite(fifthValue, 'draw_string', 'clip_w');
    if (!Number.isSafeInteger(clipWidth) || clipWidth < -1) {
      throw new RangeError('CanvasItem.draw_string clip_w must be -1 or a non-negative integer.');
    }
  } else {
    const alignment = finite(fourthValue, 'draw_string', 'alignment');
    const width = finite(fifthValue, 'draw_string', 'width');
    const fontSize = finite(sixthValue, 'draw_string', 'font_size');
    const justification = finite(eighthValue, 'draw_string', 'justification_flags');
    const direction = finite(ninthValue, 'draw_string', 'direction');
    const orientation = finite(tenthValue, 'draw_string', 'orientation');
    const oversampling = finite(eleventhValue, 'draw_string', 'oversampling');
    if (alignment !== 0 || width !== -1 || justification !== 3 || direction !== 0 || orientation !== 0 || oversampling !== 0) {
      throw new Error(
        'godot-compat: CanvasItem.draw_string supports Godot 4 default left/unbounded/auto-horizontal layout; advanced shaping arguments are unsupported.',
      );
    }
    if (!Number.isSafeInteger(fontSize) || fontSize <= 0) {
      throw new RangeError('CanvasItem.draw_string font_size must be a positive integer.');
    }
    requestedSize = fontSize;
    modulateValue = seventhValue;
  }

  const font = godotFontCanvasPresentation(fontValue, requestedSize);
  const tint = pixiColor(color(modulateValue, 'draw_string'));
  const outlineSize = finite(outlineSizeValue, 'draw_string', 'outline_size');
  if (!Number.isSafeInteger(outlineSize) || outlineSize < 0) {
    throw new RangeError('CanvasItem.draw_string outline_size must be a non-negative integer.');
  }
  const holder = markInternalCanvasChild(new Container());
  const text = markInternalCanvasChild(new Text({
    text: textValue,
    style: {
      fill: tint.color,
      fontFamily: [...font.fontFamily],
      fontSize: font.fontSize,
      fontStyle: font.fontStyle,
      fontWeight: font.fontWeight,
      letterSpacing: font.letterSpacing,
      ...(outlineSize <= 0 && font.outline === null ? {} : {
        stroke: outlineSize > 0
          ? { color: tint.color, width: outlineSize * 2 }
          : { color: font.outline!.color, width: font.outline!.size * 2 },
      }),
    },
  }));
  text.alpha = tint.alpha;
  text.position.set(position.x, position.y - font.ascent);
  holder.addChild(text);
  if (clipWidth >= 0) {
    const mask = markInternalCanvasChild(new Graphics())
      .rect(position.x, position.y - font.ascent, clipWidth, font.height)
      .fill(0xffffff);
    holder.addChild(mask);
    text.mask = mask;
  }
  node.addChild(holder);
  state.displayObjects.push(holder);
}

export function godotCanvasDrawStringOutline(
  node: Graphics,
  fontValue: unknown,
  positionValue: unknown,
  textValue: unknown,
  outlineSizeValue: unknown = 1,
  alignmentValue: unknown = 0,
  widthValue: unknown = -1,
  fontSizeValue: unknown = 16,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  justificationValue: unknown = 3,
  directionValue: unknown = 0,
  orientationValue: unknown = 0,
  oversamplingValue: unknown = 0,
): void {
  godotCanvasDrawString(node, 4, fontValue, positionValue, textValue, alignmentValue, widthValue, fontSizeValue, modulateValue, justificationValue, directionValue, orientationValue, oversamplingValue, outlineSizeValue);
}

function multilineText(
  textValue: unknown,
  maxLinesValue: unknown,
  member: string,
): string {
  if (typeof textValue !== 'string') {
    throw new TypeError(`CanvasItem.${member} text must be a String.`);
  }
  const maxLines = finite(maxLinesValue, member, 'max_lines');
  if (!Number.isSafeInteger(maxLines) || maxLines < -1) {
    throw new RangeError(`CanvasItem.${member} max_lines must be -1 or a non-negative integer.`);
  }
  if (maxLines < 0) return textValue;
  return textValue.split('\n').slice(0, maxLines).join('\n');
}

export function godotCanvasDrawMultilineString(
  node: Graphics,
  fontValue: unknown,
  positionValue: unknown,
  textValue: unknown,
  alignmentValue: unknown = 0,
  widthValue: unknown = -1,
  fontSizeValue: unknown = 16,
  maxLinesValue: unknown = -1,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  breakFlagsValue: unknown = 3,
  justificationValue: unknown = 3,
  directionValue: unknown = 0,
  orientationValue: unknown = 0,
  oversamplingValue: unknown = 0,
): void {
  const breakFlags = finite(breakFlagsValue, 'draw_multiline_string', 'brk_flags');
  if (!Number.isSafeInteger(breakFlags) || breakFlags < 0) {
    throw new RangeError('CanvasItem.draw_multiline_string brk_flags must be a non-negative bitfield.');
  }
  godotCanvasDrawString(
    node,
    4,
    fontValue,
    positionValue,
    multilineText(textValue, maxLinesValue, 'draw_multiline_string'),
    alignmentValue,
    widthValue,
    fontSizeValue,
    modulateValue,
    justificationValue,
    directionValue,
    orientationValue,
    oversamplingValue,
  );
}

export function godotCanvasDrawMultilineStringOutline(
  node: Graphics,
  fontValue: unknown,
  positionValue: unknown,
  textValue: unknown,
  outlineSizeValue: unknown = 1,
  alignmentValue: unknown = 0,
  widthValue: unknown = -1,
  fontSizeValue: unknown = 16,
  maxLinesValue: unknown = -1,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  breakFlagsValue: unknown = 3,
  justificationValue: unknown = 3,
  directionValue: unknown = 0,
  orientationValue: unknown = 0,
  oversamplingValue: unknown = 0,
): void {
  const breakFlags = finite(breakFlagsValue, 'draw_multiline_string_outline', 'brk_flags');
  if (!Number.isSafeInteger(breakFlags) || breakFlags < 0) {
    throw new RangeError('CanvasItem.draw_multiline_string_outline brk_flags must be a non-negative bitfield.');
  }
  godotCanvasDrawString(
    node,
    4,
    fontValue,
    positionValue,
    multilineText(textValue, maxLinesValue, 'draw_multiline_string_outline'),
    alignmentValue,
    widthValue,
    fontSizeValue,
    modulateValue,
    justificationValue,
    directionValue,
    orientationValue,
    oversamplingValue,
    outlineSizeValue,
  );
}

export function godotCanvasDrawChar(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  fontValue: unknown,
  positionValue: unknown,
  characterValue: unknown,
  fontSizeValue: unknown = 16,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
): number {
  const character = typeof characterValue === 'number'
    ? String.fromCodePoint(characterValue)
    : String(characterValue);
  if ([...character].length !== 1) throw new RangeError('CanvasItem.draw_char requires exactly one Unicode character.');
  godotCanvasDrawString(node, major, fontValue, positionValue, character, major === 3 ? modulateValue : 0, major === 3 ? -1 : -1, fontSizeValue, modulateValue);
  const font = godotFontCanvasPresentation(fontValue, Number(fontSizeValue));
  return font.fontSize * (character.codePointAt(0)! > 0xff ? 1 : 0.6);
}

export function godotCanvasDrawCharOutline(
  node: Graphics,
  fontValue: unknown,
  positionValue: unknown,
  characterValue: unknown,
  fontSizeValue: unknown = 16,
  outlineSizeValue: unknown = 1,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
): number {
  const character = typeof characterValue === 'number' ? String.fromCodePoint(characterValue) : String(characterValue);
  if ([...character].length !== 1) throw new RangeError('CanvasItem.draw_char_outline requires exactly one Unicode character.');
  godotCanvasDrawStringOutline(node, fontValue, positionValue, character, outlineSizeValue, 0, -1, fontSizeValue, modulateValue);
  const font = godotFontCanvasPresentation(fontValue, Number(fontSizeValue));
  return font.fontSize * (character.codePointAt(0)! > 0xff ? 1 : 0.6);
}

export function godotCanvasDrawLine(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  fromValue: unknown,
  toValue: unknown,
  colorValue: unknown,
  widthValue: unknown = major === 3 ? 1 : -1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_line');
  const from = point(fromValue, 'draw_line', 'from');
  const to = point(toValue, 'draw_line', 'to');
  const width = finite(widthValue, 'draw_line', 'width');
  const antialiased = boolean(antialiasedValue, 'draw_line', 'antialiased');
  if (antialiased) {
    throw new Error(
      'godot-compat: CanvasItem.draw_line antialiased=true is unsupported because Pixi exposes antialiasing at renderer scope, not per command.',
    );
  }
  if (width <= 0) {
    throw new Error(
      `godot-compat: CanvasItem.draw_line width=${String(width)} requests Godot's negative-width primitive line; Pixi has no transform-invariant primitive-width stroke.`,
    );
  }
  node
    .moveTo(from.x, from.y)
    .lineTo(to.x, to.y)
    .stroke({ ...pixiColor(color(colorValue, 'draw_line')), width, cap: 'butt', join: 'miter' });
}

export function godotCanvasDrawCircle(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  positionValue: unknown,
  radiusValue: unknown,
  colorValue: unknown,
  filledValue: unknown = true,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_circle');
  const position = point(positionValue, 'draw_circle', 'position');
  const radius = finite(radiusValue, 'draw_circle', 'radius');
  if (radius < 0) throw new RangeError('CanvasItem.draw_circle radius must be non-negative.');
  const tint = pixiColor(color(colorValue, 'draw_circle'));
  if (major === 3) {
    node.circle(position.x, position.y, radius).fill(tint);
    return;
  }
  const filled = boolean(filledValue, 'draw_circle', 'filled');
  const width = finite(widthValue, 'draw_circle', 'width');
  const antialiased = boolean(antialiasedValue, 'draw_circle', 'antialiased');
  if (antialiased) {
    throw new Error(
      'godot-compat: CanvasItem.draw_circle antialiased=true is unsupported because Pixi exposes antialiasing at renderer scope, not per command.',
    );
  }
  if (filled) {
    if (width !== -1 && typeof console !== 'undefined') {
      console.warn(
        'godot-compat: CanvasItem.draw_circle filled=true ignores width, matching Godot 4.7 draw_ellipse.',
      );
    }
    node.circle(position.x, position.y, radius).fill(tint);
    return;
  }
  if (width <= 0) {
    throw new Error(
      'godot-compat: CanvasItem.draw_circle filled=false requires a positive width; Pixi has no transform-invariant negative-width primitive stroke.',
    );
  }
  node.circle(position.x, position.y, radius).stroke({ ...tint, width });
}

export function godotCanvasDrawEllipse(
  node: Graphics,
  positionValue: unknown,
  radiusValue: unknown,
  colorValue: unknown,
  filledValue: unknown = true,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_ellipse');
  const position = point(positionValue, 'draw_ellipse', 'position');
  const radius = point(radiusValue, 'draw_ellipse', 'radius');
  if (radius.x < 0 || radius.y < 0) {
    throw new RangeError('CanvasItem.draw_ellipse radius components must be non-negative.');
  }
  const filled = boolean(filledValue, 'draw_ellipse', 'filled');
  const width = finite(widthValue, 'draw_ellipse', 'width');
  boolean(antialiasedValue, 'draw_ellipse', 'antialiased');
  const command = node.ellipse(position.x, position.y, radius.x, radius.y);
  const tint = pixiColor(color(colorValue, 'draw_ellipse'));
  if (filled) command.fill(tint);
  else command.stroke({ ...tint, width: width <= 0 ? 1 : width });
}

export function godotCanvasDrawEllipseArc(
  node: Graphics,
  centerValue: unknown,
  radiusValue: unknown,
  startAngleValue: unknown,
  endAngleValue: unknown,
  pointCountValue: unknown,
  colorValue: unknown,
  widthValue: unknown = 1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_ellipse_arc');
  const center = point(centerValue, 'draw_ellipse_arc', 'center');
  const radius = point(radiusValue, 'draw_ellipse_arc', 'radius');
  const startAngle = finite(startAngleValue, 'draw_ellipse_arc', 'start_angle');
  const endAngle = finite(endAngleValue, 'draw_ellipse_arc', 'end_angle');
  const pointCount = finite(pointCountValue, 'draw_ellipse_arc', 'point_count');
  const width = finite(widthValue, 'draw_ellipse_arc', 'width');
  if (radius.x < 0 || radius.y < 0) {
    throw new RangeError('CanvasItem.draw_ellipse_arc radius components must be non-negative.');
  }
  if (!Number.isSafeInteger(pointCount) || pointCount < 2) {
    throw new RangeError('CanvasItem.draw_ellipse_arc point_count must be an integer of at least 2.');
  }
  if (width <= 0) throw new RangeError('CanvasItem.draw_ellipse_arc width must be positive.');
  boolean(antialiasedValue, 'draw_ellipse_arc', 'antialiased');
  const span = endAngle - startAngle;
  node.moveTo(
    center.x + Math.cos(startAngle) * radius.x,
    center.y + Math.sin(startAngle) * radius.y,
  );
  for (let index = 1; index < pointCount; index += 1) {
    const angle = startAngle + span * index / (pointCount - 1);
    node.lineTo(
      center.x + Math.cos(angle) * radius.x,
      center.y + Math.sin(angle) * radius.y,
    );
  }
  node.stroke({ ...pixiColor(color(colorValue, 'draw_ellipse_arc')), width });
}

export function godotCanvasDrawArc(
  node: Graphics,
  centerValue: unknown,
  radiusValue: unknown,
  startAngleValue: unknown,
  endAngleValue: unknown,
  pointCountValue: unknown,
  colorValue: unknown,
  widthValue: unknown = 1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_arc');
  const center = point(centerValue, 'draw_arc', 'center');
  const radius = finite(radiusValue, 'draw_arc', 'radius');
  const startAngle = finite(startAngleValue, 'draw_arc', 'start_angle');
  const endAngle = finite(endAngleValue, 'draw_arc', 'end_angle');
  const pointCount = finite(pointCountValue, 'draw_arc', 'point_count');
  const width = finite(widthValue, 'draw_arc', 'width');
  if (radius < 0) throw new RangeError('CanvasItem.draw_arc radius must be non-negative.');
  if (!Number.isSafeInteger(pointCount) || pointCount < 2) {
    throw new RangeError('CanvasItem.draw_arc point_count must be an integer of at least 2.');
  }
  if (width <= 0) throw new RangeError('CanvasItem.draw_arc width must be positive.');
  if (boolean(antialiasedValue, 'draw_arc', 'antialiased')) {
    throw new Error('CanvasItem.draw_arc antialiased=true requires renderer-wide Pixi antialiasing.');
  }
  const span = endAngle - startAngle;
  node.moveTo(center.x + Math.cos(startAngle) * radius, center.y + Math.sin(startAngle) * radius);
  for (let index = 1; index < pointCount; index += 1) {
    const angle = startAngle + span * index / (pointCount - 1);
    node.lineTo(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
  }
  node.stroke({ ...pixiColor(color(colorValue, 'draw_arc')), width });
}

export function godotCanvasDrawRect(
  node: Graphics,
  rectValue: unknown,
  colorValue: unknown,
  filledValue: unknown = true,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_rect');
  if (typeof rectValue !== 'object' || rectValue === null) {
    throw new TypeError('CanvasItem.draw_rect rect must be a Rect2.');
  }
  const position = point(Reflect.get(rectValue, 'position'), 'draw_rect', 'rect.position');
  const size = point(Reflect.get(rectValue, 'size'), 'draw_rect', 'rect.size');
  if (size.x < 0 || size.y < 0) throw new RangeError('CanvasItem.draw_rect size must be non-negative.');
  const filled = boolean(filledValue, 'draw_rect', 'filled');
  const width = finite(widthValue, 'draw_rect', 'width');
  if (boolean(antialiasedValue, 'draw_rect', 'antialiased')) {
    throw new Error('CanvasItem.draw_rect antialiased=true requires renderer-wide Pixi antialiasing.');
  }
  const command = node.rect(position.x, position.y, size.x, size.y);
  const tint = pixiColor(color(colorValue, 'draw_rect'));
  if (filled) command.fill(tint);
  else {
    if (width <= 0) throw new RangeError('CanvasItem.draw_rect unfilled width must be positive.');
    command.stroke({ ...tint, width });
  }
}

function points(value: unknown, member: string): Vector2[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`CanvasItem.${member} points must be a PackedVector2Array/Array.`);
  }
  return value.map((entry, index) => point(entry, member, `points[${index}]`));
}

function nativeTexture(value: unknown, member: string): Texture {
  if (!(value instanceof Texture)) {
    throw new TypeError(`CanvasItem.${member} texture must be a native Pixi Texture2D.`);
  }
  return value;
}

function rect(value: unknown, member: string, argument = 'rect'): { position: Vector2; size: Vector2 } {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`CanvasItem.${member} ${argument} must be a Rect2.`);
  }
  const position = point(Reflect.get(value, 'position'), member, `${argument}.position`);
  const size = point(Reflect.get(value, 'size'), member, `${argument}.size`);
  if (size.x < 0 || size.y < 0) {
    throw new RangeError(`CanvasItem.${member} ${argument}.size must be non-negative.`);
  }
  return { position, size };
}

function positiveStrokeWidth(value: unknown, member: string): number {
  const width = finite(value, member, 'width');
  if (width <= 0) {
    throw new RangeError(
      `CanvasItem.${member} requires positive width; Pixi cannot retain Godot's transform-invariant negative-width primitive stroke.`,
    );
  }
  return width;
}

function rendererAntialias(value: unknown, member: string): void {
  if (boolean(value, member, 'antialiased')) {
    throw new Error(`CanvasItem.${member} antialiased=true requires renderer-wide Pixi antialiasing.`);
  }
}

function colors(value: unknown, member: string): ColorValue[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`CanvasItem.${member} colors must be a PackedColorArray/Array.`);
  }
  return value.map((entry, index) => color(entry, `${member} colors[${String(index)}]`));
}

function uniformVertexColor(values: readonly ColorValue[], member: string): ColorValue {
  const first = values[0];
  if (first === undefined) throw new RangeError(`CanvasItem.${member} colors must not be empty.`);
  if (values.some((entry) => entry.r !== first.r || entry.g !== first.g || entry.b !== first.b || entry.a !== first.a)) {
    throw new Error(
      `godot-compat: CanvasItem.${member} per-vertex color interpolation has no exact native Pixi Graphics carrier.`,
    );
  }
  return first;
}

export function godotCanvasDrawPolyline(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorValue: unknown,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_polyline');
  const line = points(pointsValue, 'draw_polyline');
  if (line.length < 2) return;
  rendererAntialias(antialiasedValue, 'draw_polyline');
  node.poly(line.flatMap((entry) => [entry.x, entry.y]), false).stroke({
    ...pixiColor(color(colorValue, 'draw_polyline')),
    width: positiveStrokeWidth(widthValue, 'draw_polyline'),
    cap: 'butt',
    join: 'miter',
  });
}

export function godotCanvasDrawMultiline(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorValue: unknown,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_multiline');
  const lines = points(pointsValue, 'draw_multiline');
  if (lines.length % 2 !== 0) {
    throw new RangeError('CanvasItem.draw_multiline points must contain complete point pairs.');
  }
  rendererAntialias(antialiasedValue, 'draw_multiline');
  const stroke = {
    ...pixiColor(color(colorValue, 'draw_multiline')),
    width: positiveStrokeWidth(widthValue, 'draw_multiline'),
    cap: 'butt' as const,
  };
  for (let index = 0; index < lines.length; index += 2) {
    node.moveTo(lines[index]!.x, lines[index]!.y).lineTo(lines[index + 1]!.x, lines[index + 1]!.y).stroke(stroke);
  }
}

export function godotCanvasDrawMultilineColors(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorsValue: unknown,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  const vertices = points(pointsValue, 'draw_multiline_colors');
  const vertexColors = colors(colorsValue, 'draw_multiline_colors');
  if (vertices.length % 2 !== 0) throw new RangeError('CanvasItem.draw_multiline_colors requires point pairs.');
  const segmentCount = vertices.length / 2;
  if (vertexColors.length !== 1 && vertexColors.length !== segmentCount && vertexColors.length !== vertices.length) {
    throw new RangeError('CanvasItem.draw_multiline_colors colors must contain one color, one per segment, or one per endpoint.');
  }
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const tint = vertexColors.length === 1
      ? vertexColors[0]!
      : vertexColors.length === segmentCount
        ? vertexColors[segment]!
        : vertexColors[segment * 2]!;
    godotCanvasDrawLine(node, major, vertices[segment * 2]!, vertices[segment * 2 + 1]!, tint, widthValue, antialiasedValue);
  }
}

export function godotCanvasDrawPolylineColors(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorsValue: unknown,
  widthValue: unknown = -1,
  antialiasedValue: unknown = false,
): void {
  const lineColors = colors(colorsValue, 'draw_polyline_colors');
  godotCanvasDrawPolyline(
    node,
    _major,
    pointsValue,
    uniformVertexColor(lineColors, 'draw_polyline_colors'),
    widthValue,
    antialiasedValue,
  );
}

export function godotCanvasDrawPolygon(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorsValue: unknown,
  uvsValue: unknown = [],
  textureValue: unknown = null,
  normalMapValue: unknown = null,
  antialiasedValue: unknown = false,
): void {
  const polygon = points(pointsValue, 'draw_polygon');
  const vertexColors = colors(colorsValue, 'draw_polygon');
  if (vertexColors.length !== 1 && vertexColors.length !== polygon.length) {
    throw new RangeError('CanvasItem.draw_polygon colors must contain one color or one color per point.');
  }
  godotCanvasDrawColoredPolygon(
    node,
    major,
    polygon,
    uniformVertexColor(vertexColors, 'draw_polygon'),
    uvsValue,
    textureValue,
    normalMapValue,
    antialiasedValue,
  );
}

export function godotCanvasDrawPrimitive(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorsValue: unknown,
  uvsValue: unknown = [],
  textureValue: unknown = null,
): void {
  const vertices = points(pointsValue, 'draw_primitive');
  const vertexColors = colors(colorsValue, 'draw_primitive');
  if (vertices.length < 1 || vertices.length > 4) {
    throw new RangeError('CanvasItem.draw_primitive requires one through four vertices.');
  }
  if (vertexColors.length !== 1 && vertexColors.length !== vertices.length) {
    throw new RangeError('CanvasItem.draw_primitive colors must contain one color or one per vertex.');
  }
  const tint = uniformVertexColor(vertexColors, 'draw_primitive');
  if (vertices.length === 1) {
    drawing(node, 'draw_primitive');
    node.circle(vertices[0]!.x, vertices[0]!.y, 0.5).fill(pixiColor(tint));
  } else if (vertices.length === 2) {
    godotCanvasDrawLine(node, major, vertices[0], vertices[1], tint, 1, false);
  } else {
    godotCanvasDrawColoredPolygon(node, major, vertices, tint, uvsValue, textureValue, null, false);
  }
}

interface RetainedCanvasMesh {
  readonly geometry: MeshGeometry;
  readonly texture: Texture;
}

function retainedCanvasMesh(value: unknown, member: string): RetainedCanvasMesh {
  if (value instanceof Mesh) return { geometry: value.geometry, texture: value.texture };
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`CanvasItem.${member} requires a retained 2D Mesh Resource.`);
  }
  const geometry = Reflect.get(value, 'geometry');
  const texture = Reflect.get(value, 'texture');
  if (!(geometry instanceof MeshGeometry)) {
    throw new TypeError(`CanvasItem.${member} Mesh requires native Pixi MeshGeometry.`);
  }
  if (!(texture instanceof Texture)) {
    throw new TypeError(`CanvasItem.${member} Mesh requires a native Pixi Texture.`);
  }
  return { geometry, texture };
}

function drawTransform(value: unknown, member: string): Matrix {
  if (value === null || value === undefined) return new Matrix();
  if (typeof value !== 'object') throw new TypeError(`CanvasItem.${member} transform requires Transform2D.`);
  const x = point(Reflect.get(value, 'x'), member, 'transform.x');
  const y = point(Reflect.get(value, 'y'), member, 'transform.y');
  const origin = point(Reflect.get(value, 'origin'), member, 'transform.origin');
  return new Matrix(x.x, x.y, y.x, y.y, origin.x, origin.y);
}

function addRetainedMesh(
  node: Graphics,
  state: CanvasDrawState,
  resource: RetainedCanvasMesh,
  texture: Texture,
  transform: Matrix,
  modulate: ColorValue,
): void {
  const child = markInternalCanvasChild(new Mesh({ geometry: resource.geometry, texture }));
  const tint = pixiColor(modulate);
  child.tint = tint.color;
  child.alpha = tint.alpha;
  child.setFromMatrix(state.transform.clone().append(transform));
  node.addChild(child);
  state.displayObjects.push(child);
}

/** Draw one retained ArrayMesh/QuadMesh-compatible Pixi geometry. */
export function godotCanvasDrawMesh(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  meshValue: unknown,
  textureValue: unknown = null,
  thirdValue: unknown = null,
  fourthValue: unknown = major === 3 ? null : { r: 1, g: 1, b: 1, a: 1 },
  fifthValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
): void {
  const state = drawing(node, 'draw_mesh');
  const resource = retainedCanvasMesh(meshValue, 'draw_mesh');
  const texture = textureValue === null ? resource.texture : nativeTexture(textureValue, 'draw_mesh');
  if (major === 3 && thirdValue !== null) {
    throw new Error('CanvasItem.draw_mesh normal_map requires an authored Pixi shader backend.');
  }
  const transformValue = major === 3 ? fourthValue : thirdValue;
  const modulateValue = major === 3 ? fifthValue : fourthValue;
  addRetainedMesh(
    node,
    state,
    resource,
    texture,
    drawTransform(transformValue, 'draw_mesh'),
    color(modulateValue, 'draw_mesh'),
  );
}

interface RetainedCanvasMultiMesh {
  readonly mesh: unknown;
  readonly instance_count: number;
  readonly visible_instance_count: number;
  readonly transform_format: number;
  readonly use_colors?: boolean;
  get_instance_transform_2d(index: number): unknown;
  get_instance_color(index: number): ColorValue;
}

function retainedCanvasMultiMesh(value: unknown): RetainedCanvasMultiMesh {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('CanvasItem.draw_multimesh requires a retained MultiMesh Resource.');
  }
  const candidate = value as Partial<RetainedCanvasMultiMesh>;
  if (
    !Number.isSafeInteger(candidate.instance_count) || (candidate.instance_count ?? -1) < 0 ||
    typeof candidate.get_instance_transform_2d !== 'function' ||
    typeof candidate.get_instance_color !== 'function'
  ) {
    throw new TypeError('CanvasItem.draw_multimesh requires allocated MultiMesh instance data.');
  }
  if (candidate.transform_format !== 0) {
    throw new Error('CanvasItem.draw_multimesh requires MultiMesh.TRANSFORM_2D.');
  }
  return candidate as RetainedCanvasMultiMesh;
}

/** Draw every currently visible retained MultiMesh 2D instance as a native Pixi mesh child. */
export function godotCanvasDrawMultiMesh(
  node: Graphics,
  multimeshValue: unknown,
  textureValue: unknown = null,
): void {
  const state = drawing(node, 'draw_multimesh');
  const multimesh = retainedCanvasMultiMesh(multimeshValue);
  const resource = retainedCanvasMesh(multimesh.mesh, 'draw_multimesh');
  const texture = textureValue === null ? resource.texture : nativeTexture(textureValue, 'draw_multimesh');
  const count = multimesh.visible_instance_count < 0
    ? multimesh.instance_count
    : Math.min(multimesh.instance_count, multimesh.visible_instance_count);
  for (let index = 0; index < count; index += 1) {
    const tint = multimesh.use_colors === false
      ? { r: 1, g: 1, b: 1, a: 1 }
      : color(multimesh.get_instance_color(index), 'draw_multimesh');
    addRetainedMesh(
      node,
      state,
      resource,
      texture,
      drawTransform(multimesh.get_instance_transform_2d(index), 'draw_multimesh'),
      tint,
    );
  }
}

/** Invoke a retained StyleBox Resource's own RID-based draw implementation. */
export function godotCanvasDrawStyleBox(
  node: Graphics,
  styleBoxValue: unknown,
  rectValue: unknown,
): void {
  drawing(node, 'draw_style_box');
  if (typeof styleBoxValue !== 'object' || styleBoxValue === null) {
    throw new TypeError('CanvasItem.draw_style_box requires a retained StyleBox Resource.');
  }
  const draw = Reflect.get(styleBoxValue, 'draw');
  if (typeof draw !== 'function') {
    throw new TypeError('CanvasItem.draw_style_box Resource must implement draw(canvas_item, rect).');
  }
  draw.call(styleBoxValue, godotCanvasItemRid(node), rectValue);
}

export function godotCanvasDrawDashedLine(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  fromValue: unknown,
  toValue: unknown,
  colorValue: unknown,
  widthValue: unknown = -1,
  dashValue: unknown = 2,
  alignedValue: unknown = true,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_dashed_line');
  const from = point(fromValue, 'draw_dashed_line', 'from');
  const to = point(toValue, 'draw_dashed_line', 'to');
  const width = positiveStrokeWidth(widthValue, 'draw_dashed_line');
  const dash = finite(dashValue, 'draw_dashed_line', 'dash');
  if (dash <= 0) throw new RangeError('CanvasItem.draw_dashed_line dash must be positive.');
  const aligned = boolean(alignedValue, 'draw_dashed_line', 'aligned');
  rendererAntialias(antialiasedValue, 'draw_dashed_line');
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const ux = dx / length;
  const uy = dy / length;
  const segmentCount = aligned ? Math.max(1, Math.round(length / dash)) : Math.max(1, Math.floor(length / dash));
  const segmentLength = aligned ? length / segmentCount : dash;
  const tint = pixiColor(color(colorValue, 'draw_dashed_line'));
  for (let index = 0; index < segmentCount; index += 2) {
    const start = index * segmentLength;
    const end = Math.min(length, start + segmentLength);
    node.moveTo(from.x + ux * start, from.y + uy * start)
      .lineTo(from.x + ux * end, from.y + uy * end)
      .stroke({ ...tint, width, cap: 'butt' });
  }
}

export function godotCanvasDrawTexture(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  textureValue: unknown,
  positionValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
): void {
  drawing(node, 'draw_texture');
  const texture = nativeTexture(textureValue, 'draw_texture');
  const position = point(positionValue, 'draw_texture', 'position');
  const tint = pixiColor(color(modulateValue, 'draw_texture'));
  const width = texture.orig.width;
  const height = texture.orig.height;
  node.rect(position.x, position.y, width, height).fill({
    ...tint,
    texture,
    matrix: new Matrix().translate(position.x, position.y),
  });
}

export function godotCanvasDrawTextureRect(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  textureValue: unknown,
  rectValue: unknown,
  tileValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  transposeValue: unknown = false,
): void {
  drawing(node, 'draw_texture_rect');
  const texture = nativeTexture(textureValue, 'draw_texture_rect');
  const target = rect(rectValue, 'draw_texture_rect');
  const tile = boolean(tileValue, 'draw_texture_rect', 'tile');
  const transpose = boolean(transposeValue, 'draw_texture_rect', 'transpose');
  const sourceWidth = Math.max(1, texture.orig.width);
  const sourceHeight = Math.max(1, texture.orig.height);
  const matrix = new Matrix();
  if (transpose) matrix.rotate(Math.PI / 2).translate(sourceHeight, 0);
  if (!tile) matrix.scale(target.size.x / sourceWidth, target.size.y / sourceHeight);
  matrix.translate(target.position.x, target.position.y);
  node.rect(target.position.x, target.position.y, target.size.x, target.size.y).fill({
    ...pixiColor(color(modulateValue, 'draw_texture_rect')),
    texture,
    matrix,
  });
}

export function godotCanvasDrawTextureRectRegion(
  node: Graphics,
  _major: GodotCanvasDrawMajor,
  textureValue: unknown,
  rectValue: unknown,
  sourceRectValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  transposeValue: unknown = false,
  clipUvValue: unknown = true,
): void {
  const state = drawing(node, 'draw_texture_rect_region');
  const texture = nativeTexture(textureValue, 'draw_texture_rect_region');
  const target = rect(rectValue, 'draw_texture_rect_region');
  const source = rect(sourceRectValue, 'draw_texture_rect_region', 'src_rect');
  const transpose = boolean(transposeValue, 'draw_texture_rect_region', 'transpose');
  const clipUv = boolean(clipUvValue, 'draw_texture_rect_region', 'clip_uv');
  const available = texture.frame;
  let sourceX = source.position.x;
  let sourceY = source.position.y;
  let sourceWidth = source.size.x;
  let sourceHeight = source.size.y;
  if (clipUv) {
    const right = Math.min(available.width, sourceX + sourceWidth);
    const bottom = Math.min(available.height, sourceY + sourceHeight);
    sourceX = Math.max(0, sourceX);
    sourceY = Math.max(0, sourceY);
    sourceWidth = Math.max(0, right - sourceX);
    sourceHeight = Math.max(0, bottom - sourceY);
  }
  if (sourceWidth === 0 || sourceHeight === 0 || target.size.x === 0 || target.size.y === 0) return;
  const region = new Texture({
    source: texture.source,
    frame: new Rectangle(
      available.x + sourceX,
      available.y + sourceY,
      sourceWidth,
      sourceHeight,
    ),
  });
  state.textures.push(region);
  const matrix = new Matrix();
  if (transpose) matrix.rotate(Math.PI / 2).translate(sourceHeight, 0);
  matrix.scale(target.size.x / sourceWidth, target.size.y / sourceHeight)
    .translate(target.position.x, target.position.y);
  node.rect(target.position.x, target.position.y, target.size.x, target.size.y).fill({
    ...pixiColor(color(modulateValue, 'draw_texture_rect_region')),
    texture: region,
    matrix,
  });
}

/** Retains Godot's LCD glyph mask command through the same native textured quad carrier. */
export function godotCanvasDrawLcdTextureRectRegion(
  node: Graphics,
  textureValue: unknown,
  rectValue: unknown,
  sourceRectValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
): void {
  godotCanvasDrawTextureRectRegion(
    node,
    4,
    textureValue,
    rectValue,
    sourceRectValue,
    modulateValue,
    false,
    true,
  );
}

/**
 * MSDF textures are already decoded by Pixi's texture source. The retained quad therefore shares
 * the region implementation while preserving Godot's range/scale argument validation.
 */
export function godotCanvasDrawMsdfTextureRectRegion(
  node: Graphics,
  textureValue: unknown,
  rectValue: unknown,
  sourceRectValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  outlineValue: unknown = 0,
  pixelRangeValue: unknown = 4,
  scaleValue: unknown = 1,
): void {
  const outline = finite(outlineValue, 'draw_msdf_texture_rect_region', 'outline');
  const pixelRange = finite(pixelRangeValue, 'draw_msdf_texture_rect_region', 'pixel_range');
  const scale = finite(scaleValue, 'draw_msdf_texture_rect_region', 'scale');
  if (outline < 0) {
    throw new RangeError('CanvasItem.draw_msdf_texture_rect_region outline must be non-negative.');
  }
  if (pixelRange <= 0) {
    throw new RangeError('CanvasItem.draw_msdf_texture_rect_region pixel_range must be positive.');
  }
  if (scale <= 0) {
    throw new RangeError('CanvasItem.draw_msdf_texture_rect_region scale must be positive.');
  }
  godotCanvasDrawTextureRectRegion(
    node,
    4,
    textureValue,
    rectValue,
    sourceRectValue,
    modulateValue,
    false,
    true,
  );
}

export function godotCanvasDrawColoredPolygon(
  node: Graphics,
  major: GodotCanvasDrawMajor,
  pointsValue: unknown,
  colorValue: unknown,
  uvsValue: unknown = [],
  textureValue: unknown = null,
  normalMapValue: unknown = null,
  antialiasedValue: unknown = false,
): void {
  drawing(node, 'draw_colored_polygon');
  const polygon = points(pointsValue, 'draw_colored_polygon');
  if (polygon.length < 3) {
    throw new RangeError(
      `CanvasItem.draw_colored_polygon requires at least three points; received ${String(polygon.length)}.`,
    );
  }
  if (!Array.isArray(uvsValue) || uvsValue.length !== 0) {
    throw new Error('godot-compat: CanvasItem.draw_colored_polygon textured UVs are unsupported by retained Pixi Graphics.');
  }
  if (textureValue !== null) {
    throw new Error('godot-compat: CanvasItem.draw_colored_polygon texture is unsupported by retained Pixi Graphics.');
  }
  if (major === 3 && normalMapValue !== null) {
    throw new Error('godot-compat: CanvasItem.draw_colored_polygon normal_map is unsupported by retained Pixi Graphics.');
  }
  if (major === 3 && boolean(antialiasedValue, 'draw_colored_polygon', 'antialiased')) {
    throw new Error(
      'godot-compat: CanvasItem.draw_colored_polygon antialiased=true is unsupported because Pixi exposes antialiasing at renderer scope.',
    );
  }
  node
    .poly(polygon.flatMap((entry) => [entry.x, entry.y]), true)
    .fill(pixiColor(color(colorValue, 'draw_colored_polygon')));
}
