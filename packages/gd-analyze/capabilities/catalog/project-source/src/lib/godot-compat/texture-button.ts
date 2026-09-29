/**
 * @godot-class TextureButton
 * @role BINDING
 *
 * Godot 4.7's `TextureButton` (`scene/gui/texture_button.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a BaseButton drawing one of its textures by its draw
 * mode (normal; pressed, else hover, else normal; hover, else pressed when pressed, else normal;
 * disabled, else normal), the focused texture over it while focused, placed by its stretch mode, as
 * the texture's image in an element. Its minimum size is the first of its normal, pressed and hover
 * textures' sizes, none with `ignore_texture_size`. The click mask is not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { godot_base_button_draw_state, godot_base_button_mount, godot_base_button_props } from './base-button';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_control_mount, godot_control_props, has_focus, update_minimum_size } from './control';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { get_size as textureSize } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['TextureButton', 'BaseButton', 'Control', 'CanvasItem', 'Node', 'Object'];

/** `TextureButton::StretchMode` (`texture_button.h:39`). */
const STRETCH_SCALE = 0;
const STRETCH_TILE = 1;
const STRETCH_KEEP = 2;
const STRETCH_KEEP_CENTERED = 3;
const STRETCH_KEEP_ASPECT = 4;
const STRETCH_KEEP_ASPECT_CENTERED = 5;

interface TextureButtonState {
  normal: Texture | null;
  pressed: Texture | null;
  hover: Texture | null;
  disabled: Texture | null;
  focused: Texture | null;
  ignoreTextureSize: boolean;
  stretchMode: number;
  flipH: boolean;
  flipV: boolean;
}

const BUTTONS = new WeakMap<object, TextureButtonState>();

function stateOf(self: object, member: string): TextureButtonState {
  const state = BUTTONS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a TextureButton`);
  return state;
}

/** `TextureButton::get_minimum_size` (`texture_button.cpp:35`). */
function minimumSize(entity: Object3D): Vector2 {
  const state = BUTTONS.get(entity) as TextureButtonState;
  if (state.ignoreTextureSize) return vector2(0, 0);
  const first = state.normal ?? state.pressed ?? state.hover;
  if (first === null) return vector2(0, 0);
  const size = textureSize(first);
  return vector2(Math.abs(size.x), Math.abs(size.y));
}

/** The texture the draw mode draws (`NOTIFICATION_DRAW`, `texture_button.cpp:121`). */
function drawn(entity: Object3D): Texture | null {
  const state = BUTTONS.get(entity) as TextureButtonState;
  const look = godot_base_button_draw_state(entity);
  if (look.disabled) return state.disabled ?? state.normal;
  if (look.down) return state.pressed ?? state.hover ?? state.normal;
  if (look.hovered) return state.hover ?? (look.pressed ? state.pressed : null) ?? state.normal;
  if (look.pressed) return state.pressed ?? state.hover ?? state.normal;
  return state.normal;
}

function imageSource(texture: Texture | null): string {
  const image = texture?.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

/** A layer showing `texture` in the node's box, placed as the stretch mode places it. */
function paint(layer: HTMLElement, texture: Texture | null, state: TextureButtonState): void {
  const source = imageSource(texture);
  layer.style.display = source === '' ? 'none' : '';
  if (source === '' || texture === null) return;
  const size = textureSize(texture);
  layer.style.backgroundImage = `url("${source}")`;
  layer.style.backgroundRepeat = state.stretchMode === STRETCH_TILE ? 'repeat' : 'no-repeat';
  layer.style.backgroundSize =
    state.stretchMode === STRETCH_SCALE
      ? '100% 100%'
      : state.stretchMode === STRETCH_KEEP_ASPECT || state.stretchMode === STRETCH_KEEP_ASPECT_CENTERED
        ? 'contain'
        : state.stretchMode === STRETCH_TILE || state.stretchMode === STRETCH_KEEP || state.stretchMode === STRETCH_KEEP_CENTERED
          ? `${String(size.x)}px ${String(size.y)}px`
          : 'cover';
  layer.style.backgroundPosition = state.stretchMode === STRETCH_KEEP_CENTERED || state.stretchMode === STRETCH_KEEP_ASPECT_CENTERED || state.stretchMode > STRETCH_KEEP_ASPECT_CENTERED ? 'center' : '0px 0px';
  layer.style.transform = state.flipH || state.flipV ? `scale(${state.flipH ? '-1' : '1'}, ${state.flipV ? '-1' : '1'})` : '';
}

const LAYERS = new WeakMap<Object3D, readonly [HTMLElement, HTMLElement]>();

function draw(entity: Object3D, element: HTMLElement): void {
  const state = BUTTONS.get(entity) as TextureButtonState;
  let layers = LAYERS.get(entity);
  if (layers === undefined) {
    const make = () => {
      const layer = element.ownerDocument.createElement('div');
      layer.setAttribute('data-godot-content', '');
      layer.style.position = 'absolute';
      layer.style.inset = '0px';
      layer.style.pointerEvents = 'none';
      return layer;
    };
    layers = [make(), make()];
    LAYERS.set(entity, layers);
  }
  const [base, focus] = layers;
  if (base.parentElement !== element) element.insertBefore(base, element.firstChild);
  if (focus.parentElement !== element) base.after(focus);
  const texture = drawn(entity);
  const focused = has_focus(entity, true) && state.focused !== null;
  // With no other texture, the focused one alone (`draw_focus_only`, `texture_button.cpp:174`).
  paint(base, texture ?? (focused ? state.focused : null), state);
  paint(focus, focused && texture !== null ? state.focused : null, state);
  const filter = godot_canvas_item_self_filter(entity, element);
  base.style.filter = filter;
  focus.style.filter = filter;
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  const state = BUTTONS.get(entity) as TextureButtonState;
  const texture = drawn(entity);
  return JSON.stringify([imageSource(texture), has_focus(entity, true), state.stretchMode, state.flipH, state.flipV, godot_canvas_item_self_filter(entity, element)]);
}

/**
 * @godot TextureButton (protocol)
 * @source scene/gui/texture_button.cpp:121
 */
export function godot_texture_button_mount(entity: Object3D): void {
  BUTTONS.set(entity, { normal: null, pressed: null, hover: null, disabled: null, focused: null, ignoreTextureSize: false, stretchMode: STRETCH_KEEP, flipH: false, flipV: false });
  godot_control_mount(entity, CLASSES.slice(0, -1), { minimumSize, draw, drawKey });
  godot_base_button_mount(entity, () => undefined);
}

/**
 * @godot TextureButton.TextureButton
 * @source scene/gui/texture_button.h:
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_texture_button_mount(entity);
  return entity;
}

const texture = (field: 'normal' | 'pressed' | 'hover' | 'disabled' | 'focused', sized: boolean) => (self: object, value: Texture | null) => {
  stateOf(self, `set_texture_${field}`)[field] = value;
  if (sized) update_minimum_size(self);
};

/**
 * @godot TextureButton.set_texture_normal
 * @source scene/gui/texture_button.cpp:295
 */
export function set_texture_normal(self: object, normal: Texture | null): void {
  texture('normal', true)(self, normal);
}

/**
 * @godot TextureButton.set_texture_pressed
 * @source scene/gui/texture_button.cpp:299
 */
export function set_texture_pressed(self: object, pressed: Texture | null): void {
  texture('pressed', true)(self, pressed);
}

/**
 * @godot TextureButton.set_texture_hover
 * @source scene/gui/texture_button.cpp:303
 */
export function set_texture_hover(self: object, hover: Texture | null): void {
  texture('hover', true)(self, hover);
}

/**
 * @godot TextureButton.set_texture_disabled
 * @source scene/gui/texture_button.cpp:307
 */
export function set_texture_disabled(self: object, disabled: Texture | null): void {
  texture('disabled', false)(self, disabled);
}

/**
 * @godot TextureButton.set_texture_focused
 * @source scene/gui/texture_button.cpp:343
 */
export function set_texture_focused(self: object, focused: Texture | null): void {
  texture('focused', false)(self, focused);
}

/**
 * @godot TextureButton.set_ignore_texture_size
 * @source scene/gui/texture_button.cpp:373
 */
export function set_ignore_texture_size(self: object, ignore: boolean): void {
  stateOf(self, 'set_ignore_texture_size').ignoreTextureSize = ignore;
  update_minimum_size(self);
}

/**
 * @godot TextureButton.set_stretch_mode
 * @source scene/gui/texture_button.cpp:383
 */
export function set_stretch_mode(self: object, mode: number): void {
  stateOf(self, 'set_stretch_mode').stretchMode = mode;
}

/**
 * @godot TextureButton.set_flip_h
 * @source scene/gui/texture_button.cpp:396
 */
export function set_flip_h(self: object, enable: boolean): void {
  stateOf(self, 'set_flip_h').flipH = enable;
}

/**
 * @godot TextureButton.set_flip_v
 * @source scene/gui/texture_button.cpp:409
 */
export function set_flip_v(self: object, enable: boolean): void {
  stateOf(self, 'set_flip_v').flipV = enable;
}

const TEXTURE_BUTTON = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_texture_button_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ...godot_base_button_props(),
    ['textureNormal', (entity, value: Texture | null) => set_texture_normal(entity, value)],
    ['texturePressed', (entity, value: Texture | null) => set_texture_pressed(entity, value)],
    ['textureHover', (entity, value: Texture | null) => set_texture_hover(entity, value)],
    ['textureDisabled', (entity, value: Texture | null) => set_texture_disabled(entity, value)],
    ['textureFocused', (entity, value: Texture | null) => set_texture_focused(entity, value)],
    ['ignoreTextureSize', (entity, value: boolean) => set_ignore_texture_size(entity, value)],
    ['stretchMode', (entity, value: number) => set_stretch_mode(entity, value)],
    ['flipH', (entity, value: boolean) => set_flip_h(entity, value)],
    ['flipV', (entity, value: boolean) => set_flip_v(entity, value)],
  ]),
};

/**
 * A TextureButton as a scene writes it: `<GodotTextureButton textureNormal={image} />`.
 *
 * @godot TextureButton (protocol)
 * @source scene/gui/texture_button.h:
 */
export function GodotTextureButton(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(TEXTURE_BUTTON, props);
}
