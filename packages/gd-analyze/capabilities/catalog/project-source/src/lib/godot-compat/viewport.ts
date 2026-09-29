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
 * processing `_input` from the last in tree order, the GUI, shortcut input, unhandled key input and
 * unhandled input, each stage skipped once the event is handled. The root viewport's events are
 * the root window's, so the event is already in its coordinates (the root window maps the page's
 * pointer through the stretch). The GUI is the page's own: a Control is an element, which takes
 * the pointer events that land on it (`godot-controls.tsx`), and a press that landed on one is
 * handled by the GUI stage (`godot_window_event_on_control`).
 */

import { addAfterEffect } from '@react-three/fiber';
import { BasicShadowMap, type Object3D, PCFShadowMap, PCFSoftShadowMap, type ShadowMapType, type WebGLRenderer } from 'three';
import { godot_collision_object_2d_pick } from './collision-object-2d';
import { godot_base_button_shortcuts } from './base-button';
import { is_action_pressed } from './input-event';
import { godot_input_mouse_position, godot_input_set_dispatch } from './input';
import type { InputEventRecord } from './input-event';
import { type GodotInputKind, godot_node_call_input, godot_node_entity, godot_node_input_receivers, is_inside_tree } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import type { Vector2 } from './vector2';
import { createSignal, type GodotSignal, godot_object_signal } from './signal';
import { get_size as subViewportSize, godot_sub_viewport_set_transparent } from './sub-viewport';
import { godot_window_event_on_control, godot_window_has_size, godot_window_visible_size } from './window';

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
  // Lights that cast shadows draw them (`Light3D.shadow_enabled`); three draws none unless enabled.
  renderer.shadowMap.enabled = true;
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
  mouseInViewport: boolean;
}

const INPUT = new WeakMap<Object3D, ViewportInput>();

function inputOf(viewport: Object3D): ViewportInput {
  let state = INPUT.get(viewport);
  if (state === undefined) {
    state = { handled: false, mouseInViewport: false };
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

/** `SceneTree::_call_input_pause` (`scene_tree.cpp:1430`) for one stage. */
function callStage(viewport: Object3D, state: ViewportInput, kind: GodotInputKind, event: InputEventRecord): void {
  for (const entity of godot_node_input_receivers(viewport, kind) as Object3D[]) {
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
  // The GUI stage: a press the page delivered to a Control's element is the GUI's.
  if (!state.handled && godot_window_event_on_control()) state.handled = true;
  if (state.handled) return;
  // `_push_unhandled_input_internal` (`viewport.cpp:3620`).
  if (event.type === 'key' || event.type === 'joypad_button') callStage(viewport, state, 'shortcutInput', event);
  // The page's buttons whose shortcut the event is (`BaseButton::shortcut_input`), pressed once.
  if (!state.handled && (event.type === 'key' || event.type === 'joypad_button') && typeof document !== 'undefined') {
    if (godot_base_button_shortcuts(document, (action) => is_action_pressed(event, action, false, false))) state.handled = true;
  }
  if (!state.handled && event.type === 'key') callStage(viewport, state, 'unhandledKeyInput', event);
  if (!state.handled) callStage(viewport, state, 'unhandledInput', event);
  // Physics picking, of a mouse event nothing handled (`_process_picking`, `viewport.cpp:670`).
  if (!state.handled) godot_collision_object_2d_pick(viewport, event);
}

/**
 * The rect the viewport's 2D world is laid out in: the root window's stretched size
 * (`display/window/stretch/*`), or a SubViewport's size.
 *
 * @godot Viewport.get_visible_rect
 * @source scene/main/viewport.cpp:1238
 */
export function get_visible_rect(self: object): Rect2 {
  const viewport = viewportOf(self);
  const size = godot_window_has_size(viewport) ? godot_window_visible_size(viewport) : subViewportSize(viewport);
  return rect2(0, 0, size.x, size.y);
}

/**
 * The mouse's position in the viewport: where the last mouse event was (`gui.last_mouse_pos`).
 *
 * @godot Viewport.get_mouse_position
 * @source scene/main/viewport.cpp:1183
 */
export function get_mouse_position(self: object): Vector2 {
  void self;
  return godot_input_mouse_position();
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

/**
 * The viewport's `size_changed` signal, which a changed size emits (`Viewport::_set_size`).
 *
 * @godot Viewport.size_changed
 * @source scene/main/viewport.cpp:1188
 */
export function size_changed(self: object): GodotSignal<[]> {
  return godot_object_signal<[]>(godot_node_entity(self), 'size_changed').signal;
}

/**
 * @godot Viewport.set_transparent_background
 * @source scene/main/viewport.cpp:1334
 */
export function set_transparent_background(self: object, enable: boolean): void {
  godot_sub_viewport_set_transparent(self, enable);
}

/**
 * Input reaches the page's one viewport: stored nowhere.
 *
 * @godot Viewport.set_handle_input_locally
 * @source scene/main/viewport.cpp:3947
 */
export function set_handle_input_locally(self: object, enable: boolean): void {
  void self;
  void enable;
}

/**
 * Multisampling is the page renderer's (`antialias`): stored nowhere.
 *
 * @godot Viewport.set_msaa_3d
 * @source scene/main/viewport.cpp:3677
 */
export function set_msaa_3d(self: object, msaa: number): void {
  void self;
  void msaa;
}

/** R3F's after-render effect, held while the signal has connections. */
let afterDraw: (() => void) | undefined;
// A connection arms R3F's own after-render effect (`addAfterEffect`), which emits once each frame
// has been drawn and removes itself once nothing is connected.
const FRAME_POST_DRAW = createSignal<[]>(() => {
  afterDraw ??= addAfterEffect(() => {
    FRAME_POST_DRAW.emit();
    if (!FRAME_POST_DRAW.signal.hasConnections()) {
      afterDraw?.();
      afterDraw = undefined;
    }
  });
});

/**
 * `RenderingServer.frame_post_draw`: emitted once a frame has been drawn, by R3F's after-render
 * effect while something is connected.
 *
 * @godot Viewport (protocol)
 * @source servers/rendering/rendering_server_default.cpp:222
 */
export function godot_viewport_frame_post_draw(): GodotSignal<[]> {
  return FRAME_POST_DRAW.signal;
}
