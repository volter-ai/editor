/**
 * @godot-class Viewport
 * @role BINDING
 *
 * Godot 4.7's root `Viewport` (`scene/main/viewport.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the three `WebGLRenderer` the composition
 * site renders with, which it hands over as it hands over the Rapier world (`world-3d.ts`). The
 * renderer's settings are where the web platform's Compatibility rasterizer state lands: the
 * directional shadow filter the rendering server selects is the renderer's shadow-map type.
 *
 * Input reaches the tree through `push_input` in Godot's order (`viewport.cpp:3489`): the nodes
 * processing `_input` from the last in tree order, the GUI (the Control under the pointer and its
 * parents, `_gui_input_event`), shortcut input, unhandled key input and unhandled input, each stage
 * skipped once the event is handled. The root viewport's events are the root window's, so the event
 * is already in its coordinates (no stretch transform is bound). The GUI stage covers mouse buttons,
 * mouse motion, screen touches and drags; focus, drag and drop, tooltips and the cursor shape are
 * not bound.
 */

import { BasicShadowMap, type Object3D, PCFShadowMap, PCFSoftShadowMap, type ShadowMapType, type WebGLRenderer } from 'three';
import { get_global_transform_with_canvas, godot_canvas_item_is } from './canvas-item';
import { godot_control_call_gui_input, godot_control_find } from './control';
import { godot_input_set_dispatch } from './input';
import type { InputEventRecord } from './input-event';
import { type GodotInputKind, can_process, godot_node_call_input, godot_node_entity, godot_node_input_receivers, is_inside_tree } from './node';
import { affine_inverse, op_multiply as xform, type Transform2D } from './transform-2d';

const renderers = new Set<WebGLRenderer>();

/**
 * `rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality`'s registered
 * default, `SHADOW_QUALITY_SOFT_LOW` (`servers/rendering/rendering_server.cpp:3675`), which the
 * Compatibility rasterizer applies at initialization (`drivers/gles3/rasterizer_scene_gles3.cpp:4541`).
 */
let directionalShadowQuality = 2;

/**
 * The three shadow-map type for a `RenderingServer.ShadowQuality`, from the kernel the
 * Compatibility scene shader selects (`drivers/gles3/rasterizer_scene_gles3.cpp:3674`): below
 * `SOFT_LOW`, one hardware compare tap (`drivers/gles3/shaders/scene.glsl:1392`), three's
 * `BasicShadowMap`; `SOFT_LOW` to `SOFT_MEDIUM`, `SHADOW_MODE_PCF_5` (taps one texel apart,
 * `scene.glsl:1420`), three's `PCFShadowMap` (taps within one texel at the default radius);
 * `SOFT_HIGH` and above, `SHADOW_MODE_PCF_13` (taps two texels apart, `scene.glsl:1393`), three's
 * `PCFSoftShadowMap` (a filtered kernel two texels wide). Godot filters only directional shadows
 * this way; three's type is the renderer's, so it applies to every shadow the renderer draws.
 */
function shadowMapType(quality: number): ShadowMapType {
  if (quality >= 4) return PCFSoftShadowMap;
  if (quality >= 2) return PCFShadowMap;
  return BasicShadowMap;
}

function apply(renderer: WebGLRenderer): void {
  renderer.shadowMap.type = shadowMapType(directionalShadowQuality);
  renderer.shadowMap.needsUpdate = true;
}

/**
 * Attaches the renderer the composition site draws the root viewport with; releasing detaches it.
 *
 * @godot Viewport (protocol)
 * @source scene/main/viewport.cpp:5542
 */
export function godot_viewport_attach_renderer(renderer: WebGLRenderer): () => void {
  renderers.add(renderer);
  apply(renderer);
  return () => {
    renderers.delete(renderer);
  };
}

/**
 * The rendering server's directional soft-shadow quality, applied to every attached renderer.
 *
 * @godot Viewport (protocol)
 * @source drivers/gles3/rasterizer_scene_gles3.cpp:1233
 */
export function godot_viewport_directional_shadow_quality(quality: number): void {
  directionalShadowQuality = quality;
  for (const renderer of renderers) apply(renderer);
}

interface ViewportInput {
  handled: boolean;
  mouseFocus: Object3D | null;
  mouseFocusMask: number;
  readonly touchFocus: Map<number, Object3D>;
  mouseInViewport: boolean;
}

const INPUT = new WeakMap<Object3D, ViewportInput>();

function inputOf(viewport: Object3D): ViewportInput {
  let state = INPUT.get(viewport);
  if (state === undefined) {
    state = { handled: false, mouseFocus: null, mouseFocusMask: 0, touchFocus: new Map(), mouseInViewport: false };
    INPUT.set(viewport, state);
  }
  return state;
}

function viewportOf(self: object): Object3D {
  return godot_node_entity(self) as Object3D;
}

/**
 * @godot Viewport.set_input_as_handled
 * @source scene/main/viewport.cpp:3971
 */
export function set_input_as_handled(self: object): void {
  inputOf(viewportOf(self)).handled = true;
}

/**
 * @godot Viewport.is_input_handled
 * @source scene/main/viewport.cpp:3994
 */
export function is_input_handled(self: object): boolean {
  return inputOf(viewportOf(self)).handled;
}

/**
 * Whether the pointer is over the viewport (`gui.mouse_in_viewport`, set by the window's
 * mouse-enter and -exit notifications): the host reports the page's pointer entering and leaving.
 *
 * @godot Viewport (protocol)
 * @source scene/main/viewport.cpp:749
 */
export function godot_viewport_mouse_in_viewport(self: object, inside: boolean): void {
  inputOf(viewportOf(self)).mouseInViewport = inside;
}

/** `InputEvent::xformed_by` of a pointer event: its position through `transform`. */
function moved(event: unknown, transform: Transform2D): unknown {
  const record = event as InputEventRecord;
  return 'position' in record ? { ...record, position: xform(transform, record.position) } : record;
}

/** The event in `control`'s own space (`get_global_transform_with_canvas().affine_inverse()`). */
function localized(event: InputEventRecord, control: Object3D): InputEventRecord {
  return moved(event, affine_inverse(get_global_transform_with_canvas(control))) as InputEventRecord;
}

/** `mouse_button_to_mask` (`core/input/input_enums.h:156`): `1 << (button - 1)`. */
function maskOf(button: number): number {
  return 1 << (button - 1);
}

/** `Viewport::_gui_input_event` (`viewport.cpp:1920`) for pointer events. */
function guiInputEvent(viewport: Object3D, state: ViewportInput, event: InputEventRecord): void {
  const handled = (): boolean => state.handled;
  const setHandled = (): void => {
    state.handled = true;
  };
  const call = (control: Object3D, ev: InputEventRecord): void => {
    if (can_process(control)) godot_control_call_gui_input(control, ev, true, moved, handled, setHandled);
  };
  if (event.type === 'mouse_button') {
    if (event.pressed) {
      const mask = maskOf(event.button_index);
      if (state.mouseFocusMask !== 0 && (state.mouseFocusMask & mask) === 0) {
        if (state.mouseFocus === null) return;
        state.mouseFocusMask |= mask;
      } else {
        state.mouseFocus = godot_control_find(viewport, event.position);
        if (state.mouseFocus === null) return;
        state.mouseFocusMask |= mask;
      }
      call(state.mouseFocus, localized(event, state.mouseFocus));
    } else {
      state.mouseFocusMask &= ~maskOf(event.button_index);
      const focus = state.mouseFocus;
      if (focus === null) return;
      const local = localized(event, focus);
      if (state.mouseFocusMask === 0) state.mouseFocus = null;
      call(focus, local);
    }
    return;
  }
  if (event.type === 'mouse_motion') {
    const over = state.mouseFocus ?? (state.mouseInViewport ? godot_control_find(viewport, event.position) : null);
    if (over !== null) call(over, localized(event, over));
    return;
  }
  if (event.type === 'screen_touch') {
    if (event.pressed) {
      const over = godot_control_find(viewport, event.position);
      if (over !== null) {
        state.touchFocus.set(event.index, over);
        call(over, localized(event, over));
      }
    } else {
      const over = state.touchFocus.get(event.index);
      if (over !== undefined && is_inside_tree(over)) call(over, localized(event, over));
      state.touchFocus.delete(event.index);
    }
    return;
  }
  if (event.type === 'screen_drag') {
    const over = state.touchFocus.get(event.index) ?? godot_control_find(viewport, event.position);
    if (over !== null && is_inside_tree(over)) call(over, localized(event, over));
  }
}

/**
 * `SceneTree::_call_input_pause` (`scene_tree.cpp:1430`) for one stage. For shortcut input a Control
 * with no shortcut context (none is bound) is called after the other nodes (`scene_tree.cpp:1484`).
 */
function callStage(viewport: Object3D, state: ViewportInput, kind: GodotInputKind, event: InputEventRecord): void {
  const later: Object3D[] = [];
  for (const entity of godot_node_input_receivers(viewport, kind) as Object3D[]) {
    if (state.handled) break;
    if (kind === 'shortcutInput' && godot_canvas_item_is(entity, 'Control')) {
      later.push(entity);
      continue;
    }
    godot_node_call_input(entity, kind, event, () => state.handled);
  }
  for (const entity of later) {
    if (state.handled) break;
    godot_node_call_input(entity, kind, event, () => state.handled);
  }
}

/**
 * Delivers an event to the viewport's tree: `_input`, the GUI, then (unhandled) shortcut input for
 * key and joypad-button events, unhandled key input for key events, and unhandled input.
 *
 * @godot Viewport.push_input
 * @source scene/main/viewport.cpp:3489
 */
export function push_input(self: object, p_event: InputEventRecord, p_local_coords = false): void {
  const viewport = viewportOf(self);
  if (!is_inside_tree(viewport)) return;
  const state = inputOf(viewport);
  state.handled = false;
  // The root viewport's events are in its own coordinates whether or not `p_local_coords` says so.
  void p_local_coords;
  const event = p_event;
  callStage(viewport, state, 'input', event);
  if (!state.handled) guiInputEvent(viewport, state, event);
  if (state.handled) return;
  // `_push_unhandled_input_internal` (`viewport.cpp:3620`).
  if (event.type === 'key' || event.type === 'joypad_button') callStage(viewport, state, 'shortcutInput', event);
  if (!state.handled && event.type === 'key') callStage(viewport, state, 'unhandledKeyInput', event);
  if (!state.handled) callStage(viewport, state, 'unhandledInput', event);
}

/**
 * Wires the root window's input (`Window::_window_input`, `window.cpp:2004`): each event `Input`
 * dispatches is pushed into the root viewport.
 *
 * @godot Viewport (protocol)
 * @source scene/main/window.cpp:2004
 */
export function godot_viewport_attach_input(root: object): () => void {
  godot_input_set_dispatch((event) => push_input(root, event));
  return () => godot_input_set_dispatch(undefined);
}
