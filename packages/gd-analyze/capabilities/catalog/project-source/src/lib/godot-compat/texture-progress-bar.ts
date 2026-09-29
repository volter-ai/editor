/**
 * @godot-class TextureProgressBar
 * @role BINDING
 *
 * Godot 4.7's `TextureProgressBar` (`scene/gui/texture_progress_bar.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Range drawn as its under texture, the part of its
 * progress texture its value fills (from the left, the right, the top or the bottom, at the
 * progress offset), then its over texture, each at its own size and tinted
 * (`NOTIFICATION_DRAW`, `texture_progress_bar.cpp:439`); its minimum size the largest texture's.
 * The radial, clockwise and bilinear fills and nine-patch stretching draw the whole progress
 * texture: they are not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { type Color, construct as color } from './color';
import { godot_control_mount, godot_control_props, update_minimum_size } from './control';
import { godot_node_adopt, godot_node_entity } from './node';
import { get_as_ratio, godot_range_mount, godot_range_props } from './range';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { get_size as textureSize } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['TextureProgressBar', 'Range', 'Control', 'CanvasItem', 'Node', 'Object'];

/** `FillMode` (`texture_progress_bar.h:48`), the linear ones. */
const FILL_RIGHT_TO_LEFT = 1;
const FILL_TOP_TO_BOTTOM = 2;
const FILL_BOTTOM_TO_TOP = 3;

interface BarState {
  under: Texture | null;
  progress: Texture | null;
  over: Texture | null;
  offset: Vector2;
  fillMode: number;
  tintUnder: Color;
  tintProgress: Color;
  tintOver: Color;
}

const BARS = new WeakMap<object, BarState>();

function stateOf(self: object, member: string): BarState {
  const state = BARS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a TextureProgressBar`);
  return state;
}

function imageSource(texture: Texture | null): string {
  const image = texture?.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

/** `TextureProgressBar::get_minimum_size` (`texture_progress_bar.cpp:81`). */
function minimumSize(entity: Object3D): Vector2 {
  const state = BARS.get(entity) as BarState;
  let width = 1;
  let height = 1;
  for (const texture of [state.under, state.progress, state.over]) {
    if (texture === null) continue;
    const size = textureSize(texture);
    width = Math.max(width, size.x);
    height = Math.max(height, size.y);
  }
  return vector2(width, height);
}

/** A tint as a CSS filter's opacity and brightness (its alpha, and white's colour at most). */
function tinted(layer: HTMLElement, tint: Color): void {
  layer.style.opacity = String(tint.a);
  layer.style.filter = tint.r === 1 && tint.g === 1 && tint.b === 1 ? '' : `brightness(${String((tint.r + tint.g + tint.b) / 3)})`;
}

const LAYERS = new WeakMap<Object3D, readonly [HTMLElement, HTMLElement, HTMLElement]>();

function draw(entity: Object3D, element: HTMLElement): void {
  const state = BARS.get(entity) as BarState;
  let layers = LAYERS.get(entity);
  if (layers === undefined) {
    const make = () => {
      const layer = element.ownerDocument.createElement('div');
      layer.setAttribute('data-godot-content', '');
      Object.assign(layer.style, { position: 'absolute', left: '0px', top: '0px', pointerEvents: 'none', backgroundRepeat: 'no-repeat' });
      return layer;
    };
    layers = [make(), make(), make()];
    LAYERS.set(entity, layers);
  }
  const [under, progress, over] = layers;
  let previous: HTMLElement | null = null;
  for (const layer of layers) {
    if (layer.parentElement !== element || layer.previousElementSibling !== previous) {
      if (previous === null) element.insertBefore(layer, element.firstChild);
      else previous.after(layer);
    }
    previous = layer;
  }
  const place = (layer: HTMLElement, texture: Texture | null, at: Vector2) => {
    const source = imageSource(texture);
    layer.style.display = source === '' ? 'none' : '';
    if (source === '' || texture === null) return;
    const size = textureSize(texture);
    Object.assign(layer.style, { backgroundImage: `url("${source}")`, left: `${String(at.x)}px`, top: `${String(at.y)}px`, width: `${String(size.x)}px`, height: `${String(size.y)}px` });
  };
  place(under, state.under, vector2(0, 0));
  place(progress, state.progress, state.offset);
  place(over, state.over, vector2(0, 0));
  // The filled part of the progress texture (`texture_progress_bar.cpp:456`).
  const empty = `${String((1 - get_as_ratio(entity)) * 100)}%`;
  progress.style.clipPath =
    state.fillMode === FILL_RIGHT_TO_LEFT
      ? `inset(0 0 0 ${empty})`
      : state.fillMode === FILL_TOP_TO_BOTTOM
        ? `inset(0 0 ${empty} 0)`
        : state.fillMode === FILL_BOTTOM_TO_TOP
          ? `inset(${empty} 0 0 0)`
          : state.fillMode === 0
            ? `inset(0 ${empty} 0 0)`
            : 'none';
  tinted(under, state.tintUnder);
  tinted(progress, state.tintProgress);
  tinted(over, state.tintOver);
  element.style.filter = godot_canvas_item_self_filter(entity, element);
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  const state = BARS.get(entity) as BarState;
  return JSON.stringify([imageSource(state.under), imageSource(state.progress), imageSource(state.over), state.offset, state.fillMode, state.tintUnder, state.tintProgress, state.tintOver, get_as_ratio(entity), godot_canvas_item_self_filter(entity, element)]);
}

/**
 * @godot TextureProgressBar (protocol)
 * @source scene/gui/texture_progress_bar.cpp:439
 */
export function godot_texture_progress_bar_mount(entity: Object3D): void {
  const white = color(1, 1, 1, 1);
  BARS.set(entity, { under: null, progress: null, over: null, offset: vector2(0, 0), fillMode: 0, tintUnder: white, tintProgress: white, tintOver: white });
  godot_control_mount(entity, CLASSES.slice(0, -1), { minimumSize, draw, drawKey });
  godot_range_mount(entity);
}

/**
 * @godot TextureProgressBar.TextureProgressBar
 * @source scene/gui/texture_progress_bar.cpp:727
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_texture_progress_bar_mount(entity);
  return entity;
}

/**
 * @godot TextureProgressBar.set_under_texture
 * @source scene/gui/texture_progress_bar.cpp:33
 */
export function set_under_texture(self: object, texture: Texture | null): void {
  stateOf(self, 'set_under_texture').under = texture;
  update_minimum_size(self);
}

/**
 * @godot TextureProgressBar.get_under_texture
 * @source scene/gui/texture_progress_bar.cpp:37
 */
export function get_under_texture(self: object): Texture | null {
  return stateOf(self, 'get_under_texture').under;
}

/**
 * @godot TextureProgressBar.set_over_texture
 * @source scene/gui/texture_progress_bar.cpp:41
 */
export function set_over_texture(self: object, texture: Texture | null): void {
  stateOf(self, 'set_over_texture').over = texture;
  update_minimum_size(self);
}

/**
 * @godot TextureProgressBar.set_progress_texture
 * @source scene/gui/texture_progress_bar.cpp:99
 */
export function set_progress_texture(self: object, texture: Texture | null): void {
  stateOf(self, 'set_progress_texture').progress = texture;
  update_minimum_size(self);
}

/**
 * @godot TextureProgressBar.get_progress_texture
 * @source scene/gui/texture_progress_bar.cpp:103
 */
export function get_progress_texture(self: object): Texture | null {
  return stateOf(self, 'get_progress_texture').progress;
}

/**
 * @godot TextureProgressBar.set_texture_progress_offset
 * @source scene/gui/texture_progress_bar.cpp:107
 */
export function set_texture_progress_offset(self: object, offset: Vector2): void {
  stateOf(self, 'set_texture_progress_offset').offset = offset;
}

/**
 * @godot TextureProgressBar.set_fill_mode
 * @source scene/gui/texture_progress_bar.cpp:575
 */
export function set_fill_mode(self: object, mode: number): void {
  stateOf(self, 'set_fill_mode').fillMode = mode;
}

/**
 * @godot TextureProgressBar.get_fill_mode
 * @source scene/gui/texture_progress_bar.cpp:587
 */
export function get_fill_mode(self: object): number {
  return stateOf(self, 'get_fill_mode').fillMode;
}

/**
 * @godot TextureProgressBar.set_tint_under
 * @source scene/gui/texture_progress_bar.cpp:120
 */
export function set_tint_under(self: object, tint: Color): void {
  stateOf(self, 'set_tint_under').tintUnder = tint;
}

/**
 * @godot TextureProgressBar.set_tint_progress
 * @source scene/gui/texture_progress_bar.cpp:133
 */
export function set_tint_progress(self: object, tint: Color): void {
  stateOf(self, 'set_tint_progress').tintProgress = tint;
}

/**
 * @godot TextureProgressBar.set_tint_over
 * @source scene/gui/texture_progress_bar.cpp:146
 */
export function set_tint_over(self: object, tint: Color): void {
  stateOf(self, 'set_tint_over').tintOver = tint;
}

const TEXTURE_PROGRESS_BAR = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_texture_progress_bar_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ...godot_range_props(),
    ['textureUnder', (entity, value: Texture | null) => set_under_texture(entity, value)],
    ['textureOver', (entity, value: Texture | null) => set_over_texture(entity, value)],
    ['textureProgress', (entity, value: Texture | null) => set_progress_texture(entity, value)],
    ['textureProgressOffset', (entity, value: readonly [number, number]) => set_texture_progress_offset(entity, vector2(value[0], value[1]))],
    ['fillMode', (entity, value: number) => set_fill_mode(entity, value)],
    ['tintUnder', (entity, value: readonly number[]) => set_tint_under(entity, color(value[0] ?? 1, value[1] ?? 1, value[2] ?? 1, value[3] ?? 1))],
    ['tintProgress', (entity, value: readonly number[]) => set_tint_progress(entity, color(value[0] ?? 1, value[1] ?? 1, value[2] ?? 1, value[3] ?? 1))],
    ['tintOver', (entity, value: readonly number[]) => set_tint_over(entity, color(value[0] ?? 1, value[1] ?? 1, value[2] ?? 1, value[3] ?? 1))],
  ]),
};

/**
 * A TextureProgressBar as a scene writes it: `<GodotTextureProgressBar textureUnder={under} value={10} />`.
 *
 * @godot TextureProgressBar (protocol)
 * @source scene/gui/texture_progress_bar.cpp:439
 */
export function GodotTextureProgressBar(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(TEXTURE_PROGRESS_BAR, props);
}
