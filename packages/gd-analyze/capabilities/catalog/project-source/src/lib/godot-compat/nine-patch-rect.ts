/**
 * @godot-class NinePatchRect
 * @role BINDING
 *
 * Godot 4.7's `NinePatchRect` (`scene/gui/nine_patch_rect.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control drawing its texture's region (the whole
 * texture when the region is empty, `get_rect_region`) as nine patches over its rect: the corners
 * as they are, the edges stretched or tiled along their axis, the centre too unless `draw_center`
 * is off (`canvas_item_add_nine_patch`, `renderer_canvas_cull.cpp:1708`). Its minimum size is its
 * margins. On the page it is the CSS border image of an element over its rect, which slices the same
 * nine patches; in a SubViewport it is painted (stretched patches).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { get_size, godot_control_mount, godot_control_props, update_minimum_size } from './control';
import { godot_node_entity } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import { get_height, get_width } from './texture-2d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector2, type Vector2 } from './vector2';

/** `NinePatchRect::AxisStretchMode` (`nine_patch_rect.h:40`) as CSS's border-image repeat. */
const AXIS_REPEAT = ['stretch', 'repeat', 'round'];

interface NinePatchState {
  texture: Texture | null;
  /** Left, top, right, bottom (`Side`). */
  margin: [number, number, number, number];
  region: Rect2;
  drawCenter: boolean;
  axisH: number;
  axisV: number;
}

const PATCHES = new WeakMap<object, NinePatchState>();
const CONTENTS = new WeakMap<Object3D, HTMLElement>();
const REGIONS = new WeakMap<object, { readonly key: string; readonly url: string }>();

function stateOf(self: object, member: string): NinePatchState {
  const state = PATCHES.get(godot_node_entity(self));
  if (state === undefined) throw new TypeError(`godot-compat: NinePatchRect.${member} requires a NinePatchRect.`);
  return state;
}

/** The region drawn: the texture's whole rect when the region is empty (`Texture2D::get_rect_region`). */
function regionOf(state: NinePatchState, texture: Texture): Rect2 {
  return state.region.size.x > 0 && state.region.size.y > 0 ? state.region : rect2(0, 0, get_width(texture), get_height(texture));
}

/** The region's image as a URL: the texture's own, or the region cut from it. */
function regionUrl(state: NinePatchState, texture: Texture): string {
  const image = texture.image as (CanvasImageSource & { readonly src?: string; readonly width: number; readonly height: number }) | null | undefined;
  if (image === null || image === undefined) return '';
  const region = regionOf(state, texture);
  const whole = region.position.x === 0 && region.position.y === 0 && region.size.x === get_width(texture) && region.size.y === get_height(texture);
  if (whole && typeof image.src === 'string') return image.src;
  const key = `${String(region.position.x)},${String(region.position.y)},${String(region.size.x)},${String(region.size.y)}`;
  const held = REGIONS.get(image);
  if (held?.key === key) return held.url;
  const canvas = document.createElement('canvas');
  canvas.width = region.size.x;
  canvas.height = region.size.y;
  canvas.getContext('2d')?.drawImage(image, region.position.x, region.position.y, region.size.x, region.size.y, 0, 0, region.size.x, region.size.y);
  const url = canvas.toDataURL();
  REGIONS.set(image, { key, url });
  return url;
}

/** `NOTIFICATION_DRAW` on the page: the region as a CSS border image over the rect, its patches the margins. */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = PATCHES.get(entity) as NinePatchState;
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    content.style.left = '0px';
    content.style.top = '0px';
    content.style.boxSizing = 'border-box';
    content.style.borderStyle = 'solid';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  const texture = state.texture;
  const url = texture === null ? '' : regionUrl(state, texture);
  if (url === '') {
    content.style.display = 'none';
    return;
  }
  const size = get_size(entity);
  const [left, top, right, bottom] = state.margin;
  content.style.display = '';
  content.style.width = `${String(size.x)}px`;
  content.style.height = `${String(size.y)}px`;
  content.style.borderWidth = `${String(top)}px ${String(right)}px ${String(bottom)}px ${String(left)}px`;
  content.style.borderImageSource = `url("${url}")`;
  content.style.borderImageSlice = `${String(top)} ${String(right)} ${String(bottom)} ${String(left)}${state.drawCenter ? ' fill' : ''}`;
  content.style.borderImageRepeat = `${AXIS_REPEAT[state.axisH] ?? 'stretch'} ${AXIS_REPEAT[state.axisV] ?? 'stretch'}`;
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}

/** `NOTIFICATION_DRAW` onto a canvas (a SubViewport's, or a mask): the nine patches, stretched. */
function paint(entity: Object3D, context: CanvasRenderingContext2D): boolean {
  const state = PATCHES.get(entity) as NinePatchState;
  const texture = state.texture;
  const image = texture?.image as CanvasImageSource | null | undefined;
  if (texture === null || image === null || image === undefined) return true;
  // An image still loading draws nothing yet.
  if ((image as { readonly complete?: boolean }).complete === false) return false;
  const region = regionOf(state, texture);
  const size = get_size(entity);
  const [left, top, right, bottom] = state.margin;
  const sx = [region.position.x, region.position.x + left, region.position.x + region.size.x - right, region.position.x + region.size.x];
  const sy = [region.position.y, region.position.y + top, region.position.y + region.size.y - bottom, region.position.y + region.size.y];
  const dx = [0, left, size.x - right, size.x];
  const dy = [0, top, size.y - bottom, size.y];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      if (row === 1 && column === 1 && !state.drawCenter) continue;
      const w = (sx[column + 1] as number) - (sx[column] as number);
      const h = (sy[row + 1] as number) - (sy[row] as number);
      const dw = (dx[column + 1] as number) - (dx[column] as number);
      const dh = (dy[row + 1] as number) - (dy[row] as number);
      if (w <= 0 || h <= 0 || dw <= 0 || dh <= 0) continue;
      context.drawImage(image, sx[column] as number, sy[row] as number, w, h, dx[column] as number, dy[row] as number, dw, dh);
    }
  }
  return true;
}

/**
 * Makes `entity` a NinePatchRect: no texture, no margins, the centre drawn, both axes stretched
 * (`nine_patch_rect.h:45`).
 *
 * @godot NinePatchRect (protocol)
 * @source scene/gui/nine_patch_rect.cpp:37
 */
export function godot_nine_patch_rect_mount(entity: Object3D): void {
  PATCHES.set(entity, { texture: null, margin: [0, 0, 0, 0], region: rect2(0, 0, 0, 0), drawCenter: true, axisH: 0, axisV: 0 });
  godot_control_mount(entity, ['NinePatchRect', 'Control', 'CanvasItem', 'Node'], {
    // `get_minimum_size` (`nine_patch_rect.cpp:55`): the margins.
    minimumSize: (node): Vector2 => {
      const [left, top, right, bottom] = (PATCHES.get(node) as NinePatchState).margin;
      return vector2(left + right, top + bottom);
    },
    draw,
    drawKey: (node, element) => {
      const state = PATCHES.get(node) as NinePatchState;
      const size = get_size(node);
      const image = state.texture?.image as { readonly src?: unknown } | null | undefined;
      return JSON.stringify([typeof image?.src === 'string' ? image.src : state.texture === null ? 0 : 1, state.margin, state.region, state.drawCenter, state.axisH, state.axisV, size.x, size.y, godot_canvas_item_self_filter(node, element)]);
    },
    paint,
  });
}

/**
 * @godot NinePatchRect.set_texture
 * @source scene/gui/nine_patch_rect.cpp:98
 */
export function set_texture(self: object, texture: Texture | null): void {
  stateOf(self, 'set_texture').texture = texture;
  update_minimum_size(self);
}

/**
 * @godot NinePatchRect.get_texture
 * @source scene/gui/nine_patch_rect.cpp:118
 */
export function get_texture(self: object): Texture | null {
  return stateOf(self, 'get_texture').texture;
}

/**
 * A patch margin by `Side` (left 0, top 1, right 2, bottom 3); another side fails and leaves them.
 *
 * @godot NinePatchRect.set_patch_margin
 * @source scene/gui/nine_patch_rect.cpp:122
 */
export function set_patch_margin(self: object, margin: number, value: number): void {
  const state = stateOf(self, 'set_patch_margin');
  if (margin < 0 || margin > 3) return;
  state.margin[margin] = Math.trunc(value);
  update_minimum_size(self);
}

/**
 * @godot NinePatchRect.get_patch_margin
 * @source scene/gui/nine_patch_rect.cpp:134
 */
export function get_patch_margin(self: object, margin: number): number {
  return margin < 0 || margin > 3 ? 0 : (stateOf(self, 'get_patch_margin').margin[margin] as number);
}

/**
 * @godot NinePatchRect.set_region_rect
 * @source scene/gui/nine_patch_rect.cpp:139
 */
export function set_region_rect(self: object, region: Rect2): void {
  stateOf(self, 'set_region_rect').region = region;
}

/**
 * @godot NinePatchRect.get_region_rect
 * @source scene/gui/nine_patch_rect.cpp:149
 */
export function get_region_rect(self: object): Rect2 {
  return stateOf(self, 'get_region_rect').region;
}

/**
 * @godot NinePatchRect.set_draw_center
 * @source scene/gui/nine_patch_rect.cpp:153
 */
export function set_draw_center(self: object, enabled: boolean): void {
  stateOf(self, 'set_draw_center').drawCenter = enabled;
}

/**
 * @godot NinePatchRect.is_draw_center_enabled
 * @source scene/gui/nine_patch_rect.cpp:162
 */
export function is_draw_center_enabled(self: object): boolean {
  return stateOf(self, 'is_draw_center_enabled').drawCenter;
}

/**
 * @godot NinePatchRect.set_h_axis_stretch_mode
 * @source scene/gui/nine_patch_rect.cpp:166
 */
export function set_h_axis_stretch_mode(self: object, mode: number): void {
  stateOf(self, 'set_h_axis_stretch_mode').axisH = mode;
}

/**
 * @godot NinePatchRect.get_h_axis_stretch_mode
 * @source scene/gui/nine_patch_rect.cpp:175
 */
export function get_h_axis_stretch_mode(self: object): number {
  return stateOf(self, 'get_h_axis_stretch_mode').axisH;
}

/**
 * @godot NinePatchRect.set_v_axis_stretch_mode
 * @source scene/gui/nine_patch_rect.cpp:179
 */
export function set_v_axis_stretch_mode(self: object, mode: number): void {
  stateOf(self, 'set_v_axis_stretch_mode').axisV = mode;
}

/**
 * @godot NinePatchRect.get_v_axis_stretch_mode
 * @source scene/gui/nine_patch_rect.cpp:188
 */
export function get_v_axis_stretch_mode(self: object): number {
  return stateOf(self, 'get_v_axis_stretch_mode').axisV;
}

const NINE_PATCH_RECT = {
  create: () => new Group(),
  classes: ['NinePatchRect', 'Control', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_nine_patch_rect_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['texture', (entity, value: Texture | null) => set_texture(entity, value)],
    ['regionRect', (entity, value: readonly [number, number, number, number]) => set_region_rect(entity, rect2(...value))],
    ['patchMarginLeft', (entity, value: number) => set_patch_margin(entity, 0, value)],
    ['patchMarginTop', (entity, value: number) => set_patch_margin(entity, 1, value)],
    ['patchMarginRight', (entity, value: number) => set_patch_margin(entity, 2, value)],
    ['patchMarginBottom', (entity, value: number) => set_patch_margin(entity, 3, value)],
    ['drawCenter', (entity, value: boolean) => set_draw_center(entity, value)],
    ['axisStretchHorizontal', (entity, value: number) => set_h_axis_stretch_mode(entity, value)],
    ['axisStretchVertical', (entity, value: number) => set_v_axis_stretch_mode(entity, value)],
  ]),
};

/**
 * A NinePatchRect as a scene writes it: `<GodotNinePatchRect texture={frame} patchMarginLeft={8} />`.
 *
 * @godot NinePatchRect (protocol)
 * @source scene/gui/nine_patch_rect.cpp:59
 */
export function GodotNinePatchRect(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(NINE_PATCH_RECT, props);
}
