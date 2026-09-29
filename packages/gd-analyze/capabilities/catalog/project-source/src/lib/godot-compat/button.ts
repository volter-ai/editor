/**
 * @godot-class Button
 * @role BINDING
 *
 * Godot 4.7's `Button` (`scene/gui/button.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a BaseButton drawing its text centred on the default theme's box (`default_theme.cpp:220`): a
 * dark rounded box, lighter hovered, darker pressed, its text in the theme's font colour. Its
 * minimum size is the text's plus the box's margins, and its icon's beside it: the icon is drawn
 * before (or after) the text at its size, or fit to the button's height when expanded.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, type Texture } from 'three';
import { godot_base_button_draw_state, godot_base_button_mount, godot_base_button_props, set_toggle_mode } from './base-button';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_control_mount, godot_control_props, update_minimum_size } from './control';
import { get_height, godot_font_css, godot_font_default, godot_font_measure } from './font';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { get_size as textureSize } from './texture-2d';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['Button', 'BaseButton', 'Control', 'CanvasItem', 'Node', 'Object'];
const FONT_SIZE = 16;
const MARGIN_X = 8;
const MARGIN_Y = 4;
/** A CheckBox's box and the space after it (the default theme's `checked` icon, `h_separation`). */
const CHECK = 16;
const SEPARATION = 4;

interface ButtonState {
  /** A CheckBox's look: a check box before its text, flat (`check-box.ts`). */
  readonly check: boolean;
  text: string;
  flat: boolean;
  alignment: number;
  clipText: boolean;
  /** Its icon, drawn before the text at its size, or fit to the button's height when expanded. */
  icon: Texture | null;
  expandIcon: boolean;
  iconAlignment: number;
}

const BUTTONS = new WeakMap<object, ButtonState>();

function stateOf(self: object, member: string): ButtonState {
  const state = BUTTONS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Button`);
  return state;
}

function minimumSize(entity: Object3D): Vector2 {
  const state = BUTTONS.get(entity) as ButtonState;
  const font = godot_font_default();
  // An icon's own size beside the text, unless it is expanded to the button (`Button::get_minimum_size_for_text_and_icon`, `button.cpp:481`).
  const icon = state.icon === null || state.expandIcon ? vector2(0, 0) : textureSize(state.icon);
  const gap = state.icon !== null && state.text !== '' ? SEPARATION : 0;
  return vector2(
    godot_font_measure(font, state.text, FONT_SIZE) + MARGIN_X * 2 + (state.check ? CHECK + SEPARATION : 0) + icon.x + gap,
    Math.max(get_height(font, FONT_SIZE), icon.y) + MARGIN_Y * 2,
  );
}

const CONTENTS = new WeakMap<Object3D, HTMLElement>();

function draw(entity: Object3D, element: HTMLElement): void {
  const state = BUTTONS.get(entity) as ButtonState;
  const look = godot_base_button_draw_state(entity);
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    content.style.inset = '0px';
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.boxSizing = 'border-box';
    content.style.borderRadius = '3px';
    content.style.whiteSpace = 'pre';
    content.style.pointerEvents = 'none';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  content.style.justifyContent = state.check || state.alignment === 0 ? 'flex-start' : state.alignment === 2 ? 'flex-end' : 'center';
  content.style.padding = `${String(MARGIN_Y)}px ${String(MARGIN_X)}px`;
  content.style.overflow = state.clipText ? 'hidden' : 'visible';
  content.style.backgroundColor = state.flat || state.check ? 'transparent' : look.disabled ? 'rgba(26, 26, 26, 0.3)' : look.down || look.pressed ? 'rgba(0, 0, 0, 0.6)' : look.hovered ? 'rgba(51, 51, 51, 0.6)' : 'rgba(26, 26, 26, 0.6)';
  content.style.color = look.disabled ? 'rgba(224, 224, 224, 0.5)' : look.hovered && !look.down ? 'rgb(245, 245, 245)' : 'rgb(224, 224, 224)';
  content.style.font = godot_font_css(godot_font_default(), FONT_SIZE);
  // A CheckBox's box, ticked while pressed, before its text.
  content.textContent = state.check ? `${look.pressed ? '\u2611' : '\u2610'}\u2002${state.text}` : state.text;
  // The icon before or after the text (`icon_alignment`), at its size or fit to the height.
  const source = iconSource(state.icon);
  if (source !== '') {
    const image = element.ownerDocument.createElement('img');
    image.src = source;
    image.style.pointerEvents = 'none';
    image.style.flex = 'none';
    if (state.expandIcon) {
      image.style.height = '100%';
      image.style.objectFit = 'contain';
    }
    if (state.text !== '') image.style[state.iconAlignment === 2 ? 'marginLeft' : 'marginRight'] = `${String(SEPARATION)}px`;
    if (state.iconAlignment === 2) content.append(image);
    else content.prepend(image);
  }
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  const state = BUTTONS.get(entity) as ButtonState;
  return JSON.stringify([{ ...state, icon: iconSource(state.icon) }, godot_base_button_draw_state(entity), godot_canvas_item_self_filter(entity, element)]);
}

/**
 * @godot Button (protocol)
 * @source scene/gui/button.cpp:780
 */
export function godot_button_mount(entity: Object3D, classes: readonly string[] = CLASSES, check = false): void {
  BUTTONS.set(entity, { check, text: '', flat: false, alignment: 1, clipText: false, icon: null, expandIcon: false, iconAlignment: 0 });
  godot_control_mount(entity, classes, { minimumSize, draw, drawKey });
  godot_base_button_mount(entity, () => undefined);
  // A CheckBox toggles (`CheckBox::CheckBox`, `check_box.cpp`: `set_toggle_mode(true)`).
  if (check) set_toggle_mode(entity, true);
}

/**
 * Button's element props, which a CheckBox shares.
 *
 * @godot Button (protocol)
 * @source scene/gui/button.cpp:780
 */
export function godot_button_props(): (readonly [string, GodotElementProp<Object3D>])[] {
  return [...BUTTON.props];
}

/**
 * @godot Button.set_text
 * @source scene/gui/button.cpp:560
 */
export function set_text(self: object, text: string): void {
  stateOf(self, 'set_text').text = text;
  update_minimum_size(self);
}

/**
 * @godot Button.get_text
 * @source scene/gui/button.cpp:575
 */
export function get_text(self: object): string {
  return stateOf(self, 'get_text').text;
}

/**
 * @godot Button.set_flat
 * @source scene/gui/button.cpp:640
 */
export function set_flat(self: object, enabled: boolean): void {
  stateOf(self, 'set_flat').flat = enabled;
}

/**
 * @godot Button.set_text_alignment
 * @source scene/gui/button.cpp:670
 */
export function set_text_alignment(self: object, alignment: number): void {
  stateOf(self, 'set_text_alignment').alignment = alignment;
}

/** The icon's image as the page shows it (an imported texture's source). */
function iconSource(texture: Texture | null): string {
  const image = texture?.image as { readonly src?: string; readonly toDataURL?: () => string } | null | undefined;
  if (image === null || image === undefined) return '';
  if (typeof image.src === 'string') return image.src;
  return typeof image.toDataURL === 'function' ? image.toDataURL() : '';
}

/**
 * @godot Button.set_button_icon
 * @source scene/gui/button.cpp:663
 */
export function set_button_icon(self: object, icon: Texture | null): void {
  stateOf(self, 'set_button_icon').icon = icon;
  update_minimum_size(self);
}

/**
 * @godot Button.get_button_icon
 * @source scene/gui/button.cpp:695
 */
export function get_button_icon(self: object): Texture | null {
  return stateOf(self, 'get_button_icon').icon;
}

/**
 * @godot Button.set_expand_icon
 * @source scene/gui/button.cpp:699
 */
export function set_expand_icon(self: object, enabled: boolean): void {
  stateOf(self, 'set_expand_icon').expandIcon = enabled;
  update_minimum_size(self);
}

/**
 * @godot Button.is_expand_icon
 * @source scene/gui/button.cpp:708
 */
export function is_expand_icon(self: object): boolean {
  return stateOf(self, 'is_expand_icon').expandIcon;
}

/**
 * @godot Button.set_icon_alignment
 * @source scene/gui/button.cpp:749
 */
export function set_icon_alignment(self: object, alignment: number): void {
  stateOf(self, 'set_icon_alignment').iconAlignment = alignment;
}

/**
 * @godot Button.get_icon_alignment
 * @source scene/gui/button.cpp:773
 */
export function get_icon_alignment(self: object): number {
  return stateOf(self, 'get_icon_alignment').iconAlignment;
}

/**
 * @godot Button.set_clip_text
 * @source scene/gui/button.cpp:655
 */
export function set_clip_text(self: object, enabled: boolean): void {
  stateOf(self, 'set_clip_text').clipText = enabled;
}

const BUTTON = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_button_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ...godot_base_button_props(),
    ['text', (entity, value: string) => set_text(entity, value)],
    ['flat', (entity, value: boolean) => set_flat(entity, value)],
    ['alignment', (entity, value: number) => set_text_alignment(entity, value)],
    ['clipText', (entity, value: boolean) => set_clip_text(entity, value)],
    ['icon', (entity, value: Texture | null) => set_button_icon(entity, value)],
    ['expandIcon', (entity, value: boolean) => set_expand_icon(entity, value)],
    ['iconAlignment', (entity, value: number) => set_icon_alignment(entity, value)],
  ]),
};

/**
 * A Button as a scene writes it: `<GodotButton text="Start" />`.
 *
 * @godot Button (protocol)
 * @source scene/gui/button.cpp:780
 */
export function GodotButton(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(BUTTON, props);
}
