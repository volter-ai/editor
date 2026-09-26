/**
 * @godot-class TouchScreenButton
 * @role BINDING
 *
 * Godot 4.7's `TouchScreenButton` (`scene/2d/physics/touch_screen_button.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D pressed by a screen touch inside its normal
 * texture's rectangle (its own `input()`, the touch in its canvas space), pressing and releasing its
 * action through `Input` and pushing the `InputEventAction` into the viewport, emitting `pressed`
 * and `released`. Hidden, or `VISIBILITY_TOUCHSCREEN_ONLY` on a page without touch, it takes no
 * input. It is bound onto the page as its normal (or, while pressed, pressed) texture's image. The
 * collision `shape` and the `bitmask` are not bound (a button without them tests its texture's
 * rectangle).
 */

import type { Object3D, Texture } from 'three';
import { godot_canvas_item_self_filter, get_global_transform_with_canvas, is_visible_in_tree } from './canvas-item';
import { is_touchscreen_available } from './display-server';
import { action_press, action_release } from './input';
import type { InputEventRecord } from './input-event';
import { godot_node_2d_mount } from './node-2d';
import { godot_node_entity, godot_node_set_internal_input, godot_node_tree_signal, get_viewport, set_process_input } from './node';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { get_height, get_width } from './texture-2d';
import { affine_inverse, op_multiply as xform } from './transform-2d';
import type { Vector2 } from './vector2';
import { push_input } from './viewport';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { godot_node_2d_props } from './node-2d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

/** `TouchScreenButton::VisibilityMode` (`touch_screen_button.h:42`). */
const VISIBILITY_TOUCHSCREEN_ONLY = 1;

interface ButtonState {
  textureNormal: Texture | null;
  texturePressed: Texture | null;
  action: string;
  visibility: number;
  passby: boolean;
  finger: number;
  readonly pressed: SignalHandle<[]>;
  readonly released: SignalHandle<[]>;
}

const BUTTONS = new WeakMap<Object3D, ButtonState>();

function stateOf(self: object, member: string): ButtonState {
  const state = BUTTONS.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a TouchScreenButton`);
  return state;
}

/** Whether the button ignores input: `VISIBILITY_TOUCHSCREEN_ONLY` on a page without touch. */
function touchHidden(state: ButtonState): boolean {
  return !is_touchscreen_available() && state.visibility === VISIBILITY_TOUCHSCREEN_ONLY;
}

/**
 * `_is_point_inside` (`touch_screen_button.cpp:288`): the point in the button's canvas space inside
 * the normal texture's rectangle.
 */
function inside(entity: Object3D, state: ButtonState, point: Vector2): boolean {
  if (state.textureNormal === null) return false;
  const coord = xform(affine_inverse(get_global_transform_with_canvas(entity)), point);
  return coord.x >= 0 && coord.y >= 0 && coord.x < get_width(state.textureNormal) && coord.y < get_height(state.textureNormal);
}

/** `_press` (`touch_screen_button.cpp:323`). */
function press(entity: Object3D, state: ButtonState, finger: number): void {
  state.finger = finger;
  if (state.action !== '') {
    action_press(state.action);
    const viewport = get_viewport(entity);
    if (viewport !== null) push_input(viewport, { type: 'action', action: state.action, pressed: true }, true);
  }
  state.pressed.emit();
}

/** `_release` (`touch_screen_button.cpp:339`). */
function release(entity: Object3D, state: ButtonState, exitingTree = false): void {
  state.finger = -1;
  if (state.action !== '') {
    action_release(state.action);
    const viewport = get_viewport(entity);
    if (!exitingTree && viewport !== null) push_input(viewport, { type: 'action', action: state.action, pressed: false }, true);
  }
  if (!exitingTree) state.released.emit();
}

/** `input` (`touch_screen_button.cpp:235`). */
function input(entity: Object3D, state: ButtonState, event: InputEventRecord): void {
  if (!is_visible_in_tree(entity)) return;
  const touch = event.type === 'screen_touch' ? event : null;
  if (state.passby) {
    const drag = event.type === 'screen_drag' ? event : null;
    if (touch !== null && !touch.pressed && state.finger === touch.index) release(entity, state);
    if ((touch !== null && touch.pressed) || drag !== null) {
      const index = touch !== null ? touch.index : (drag as { readonly index: number }).index;
      const coord = touch !== null ? touch.position : (drag as { readonly position: Vector2 }).position;
      if (state.finger === -1 || index === state.finger) {
        if (inside(entity, state, coord)) {
          if (state.finger === -1) press(entity, state, index);
        } else if (state.finger !== -1) {
          release(entity, state);
        }
      }
    }
  } else if (touch !== null) {
    if (touch.pressed) {
      if (state.finger !== -1) return;
      if (inside(entity, state, touch.position)) press(entity, state, touch.index);
    } else if (touch.index === state.finger) {
      release(entity, state);
    }
  }
}

const CONTENTS = new WeakMap<Object3D, HTMLElement>();

/** `NOTIFICATION_DRAW` (`touch_screen_button.cpp:141`): the pressed or normal texture at the origin. */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = BUTTONS.get(entity) as ButtonState;
  let content = CONTENTS.get(entity);
  if (content === undefined) {
    content = element.ownerDocument.createElement('div');
    content.setAttribute('data-godot-content', '');
    content.style.position = 'absolute';
    content.style.left = '0px';
    content.style.top = '0px';
    CONTENTS.set(entity, content);
  }
  if (content.parentElement !== element) element.insertBefore(content, element.firstChild);
  const texture = state.finger !== -1 && state.texturePressed !== null ? state.texturePressed : state.textureNormal;
  const image = texture?.image as { readonly src?: string } | null | undefined;
  if (texture === null || touchHidden(state)) {
    content.style.display = 'none';
    return;
  }
  content.style.display = '';
  content.style.width = `${String(get_width(texture))}px`;
  content.style.height = `${String(get_height(texture))}px`;
  content.style.backgroundImage = typeof image?.src === 'string' ? `url("${image.src}")` : '';
  content.style.backgroundColor = typeof image?.src === 'string' ? '' : 'white';
  content.style.backgroundSize = '100% 100%';
  content.style.filter = godot_canvas_item_self_filter(entity, element);
}

/**
 * Makes `entity` a TouchScreenButton, a node of that class, with its defaults
 * (`touch_screen_button.h:58-61`): entering the tree turns its input on while visible in the tree
 * (and off when not, unless touch-only on a page without touch); a visibility change turns it on or off, releasing a
 * pressed button; leaving the tree releases it without the event (`touch_screen_button.cpp:127`).
 *
 * @godot TouchScreenButton (protocol)
 * @source scene/2d/physics/touch_screen_button.cpp:127
 */
export function godot_touch_screen_button_mount(entity: Object3D): void {
  const state: ButtonState = {
    textureNormal: null,
    texturePressed: null,
    action: '',
    visibility: 0,
    passby: false,
    finger: -1,
    pressed: createSignal<[]>(),
    released: createSignal<[]>(),
  };
  BUTTONS.set(entity, state);
  godot_node_2d_mount(entity, ['TouchScreenButton', 'Node2D', 'CanvasItem', 'Node'], {
    draw,
    visibilityChanged: (node) => {
      if (is_visible_in_tree(node)) set_process_input(node, true);
      else {
        set_process_input(node, false);
        if (state.finger !== -1) release(node, state);
      }
    },
  });
  godot_node_set_internal_input(entity, 'input', (event) => input(entity, state, event as InputEventRecord));
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    // CanvasItem's `NOTIFICATION_ENTER_TREE` sends `NOTIFICATION_VISIBILITY_CHANGED` to an item
    // visible in the tree first (`canvas_item.cpp:433`), which turns input on; the button's own
    // enter-tree then returns early when touch-only on a page without touch.
    if (is_visible_in_tree(entity)) set_process_input(entity, true);
    if (touchHidden(state)) return;
    set_process_input(entity, is_visible_in_tree(entity));
  });
  godot_node_tree_signal(entity, 'tree_exiting').connect(() => {
    if (state.finger !== -1) release(entity, state, true);
  });
}

/**
 * The button's `pressed` or `released` signal.
 *
 * @godot TouchScreenButton (protocol)
 * @source scene/2d/physics/touch_screen_button.cpp:451
 */
export function godot_touch_screen_button_signal(self: object, name: 'pressed' | 'released'): GodotSignal<[]> {
  const state = stateOf(self, name);
  return (name === 'pressed' ? state.pressed : state.released).signal;
}

/**
 * @godot TouchScreenButton.set_texture_normal
 * @source scene/2d/physics/touch_screen_button.cpp:42
 */
export function set_texture_normal(self: object, p_texture: Texture | null): void {
  stateOf(self, 'set_texture_normal').textureNormal = p_texture;
}

/**
 * @godot TouchScreenButton.get_texture_normal
 * @source scene/2d/physics/touch_screen_button.cpp:56
 */
export function get_texture_normal(self: object): Texture | null {
  return stateOf(self, 'get_texture_normal').textureNormal;
}

/**
 * @godot TouchScreenButton.set_texture_pressed
 * @source scene/2d/physics/touch_screen_button.cpp:60
 */
export function set_texture_pressed(self: object, p_texture: Texture | null): void {
  stateOf(self, 'set_texture_pressed').texturePressed = p_texture;
}

/**
 * @godot TouchScreenButton.get_texture_pressed
 * @source scene/2d/physics/touch_screen_button.cpp:74
 */
export function get_texture_pressed(self: object): Texture | null {
  return stateOf(self, 'get_texture_pressed').texturePressed;
}

/**
 * @godot TouchScreenButton.is_pressed
 * @source scene/2d/physics/touch_screen_button.cpp:223
 */
export function is_pressed(self: object): boolean {
  return stateOf(self, 'is_pressed').finger !== -1;
}

/**
 * @godot TouchScreenButton.set_action
 * @source scene/2d/physics/touch_screen_button.cpp:227
 */
export function set_action(self: object, p_action: string): void {
  stateOf(self, 'set_action').action = p_action;
}

/**
 * @godot TouchScreenButton.get_action
 * @source scene/2d/physics/touch_screen_button.cpp:231
 */
export function get_action(self: object): string {
  return stateOf(self, 'get_action').action;
}

/**
 * @godot TouchScreenButton.set_visibility_mode
 * @source scene/2d/physics/touch_screen_button.cpp:381
 */
export function set_visibility_mode(self: object, p_mode: number): void {
  stateOf(self, 'set_visibility_mode').visibility = p_mode;
}

/**
 * @godot TouchScreenButton.get_visibility_mode
 * @source scene/2d/physics/touch_screen_button.cpp:386
 */
export function get_visibility_mode(self: object): number {
  return stateOf(self, 'get_visibility_mode').visibility;
}

/**
 * @godot TouchScreenButton.set_passby_press
 * @source scene/2d/physics/touch_screen_button.cpp:390
 */
export function set_passby_press(self: object, p_enable: boolean): void {
  stateOf(self, 'set_passby_press').passby = p_enable;
}

/**
 * @godot TouchScreenButton.is_passby_press_enabled
 * @source scene/2d/physics/touch_screen_button.cpp:394
 */
export function is_passby_press_enabled(self: object): boolean {
  return stateOf(self, 'is_passby_press_enabled').passby;
}

const TOUCH_SCREEN_BUTTON = {
  create: () => new Group(),
  classes: ['TouchScreenButton', 'Node2D', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_touch_screen_button_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['textureNormal', (entity, value: Texture | null) => set_texture_normal(entity, value)],
    ['texturePressed', (entity, value: Texture | null) => set_texture_pressed(entity, value)],
    ['passbyPress', (entity, value: boolean) => set_passby_press(entity, value)],
    ['action', (entity, value: string) => set_action(entity, value)],
    ['visibilityMode', (entity, value: number) => set_visibility_mode(entity, value)],
  ]),
};

/**
 * A TouchScreenButton as a scene writes it (`touch_screen_button.cpp:441`: its properties).
 *
 * @godot TouchScreenButton (protocol)
 * @source scene/2d/physics/touch_screen_button.cpp:441
 */
export function GodotTouchScreenButton(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(TOUCH_SCREEN_BUTTON, props);
}
