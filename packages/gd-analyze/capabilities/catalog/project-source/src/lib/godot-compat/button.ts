/**
 * @godot-class Button
 * @role BINDING
 *
 * Godot 4.7's `Button` (`scene/gui/button.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a BaseButton drawing its text centred on the default theme's box (`default_theme.cpp:220`): a
 * dark rounded box, lighter hovered, darker pressed, its text in the theme's font colour. Its
 * minimum size is the text's plus the box's margins. Icons are not drawn.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_base_button_draw_state, godot_base_button_mount, godot_base_button_props } from './base-button';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_control_mount, godot_control_props, update_minimum_size } from './control';
import { get_height, godot_font_css, godot_font_default, godot_font_measure } from './font';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['Button', 'BaseButton', 'Control', 'CanvasItem', 'Node', 'Object'];
const FONT_SIZE = 16;
const MARGIN_X = 8;
const MARGIN_Y = 4;

interface ButtonState {
  text: string;
  flat: boolean;
  alignment: number;
  clipText: boolean;
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
  return vector2(godot_font_measure(font, state.text, FONT_SIZE) + MARGIN_X * 2, get_height(font, FONT_SIZE) + MARGIN_Y * 2);
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
  content.style.justifyContent = state.alignment === 0 ? 'flex-start' : state.alignment === 2 ? 'flex-end' : 'center';
  content.style.padding = `${String(MARGIN_Y)}px ${String(MARGIN_X)}px`;
  content.style.overflow = state.clipText ? 'hidden' : 'visible';
  content.style.backgroundColor = state.flat ? 'transparent' : look.disabled ? 'rgba(26, 26, 26, 0.3)' : look.down || look.pressed ? 'rgba(0, 0, 0, 0.6)' : look.hovered ? 'rgba(51, 51, 51, 0.6)' : 'rgba(26, 26, 26, 0.6)';
  content.style.color = look.disabled ? 'rgba(224, 224, 224, 0.5)' : look.hovered && !look.down ? 'rgb(245, 245, 245)' : 'rgb(224, 224, 224)';
  content.style.font = godot_font_css(godot_font_default(), FONT_SIZE);
  content.textContent = state.text;
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  const state = BUTTONS.get(entity) as ButtonState;
  return JSON.stringify([state, godot_base_button_draw_state(entity), godot_canvas_item_self_filter(entity, element)]);
}

/**
 * @godot Button (protocol)
 * @source scene/gui/button.cpp:780
 */
export function godot_button_mount(entity: Object3D): void {
  BUTTONS.set(entity, { text: '', flat: false, alignment: 1, clipText: false });
  godot_control_mount(entity, CLASSES, { minimumSize, draw, drawKey });
  godot_base_button_mount(entity, () => undefined);
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
    ['icon', () => undefined],
    ['expandIcon', () => undefined],
    ['iconAlignment', () => undefined],
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
