/**
 * @godot-class HSlider
 * @role BINDING
 *
 * Godot 4.7's `HSlider` (`scene/gui/slider.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a horizontal Range the mouse sets: a left press puts the grabber's centre at the pointer, a drag
 * moves the value by the motion over the track's length (less the grabber's width), the wheel steps
 * it (`Slider::gui_input`), emitting `drag_started` and `drag_ended`. It draws as the default theme's
 * track and grabber (16 pixels); its minimum height is the grabber's. Ticks, the keyboard and
 * joypad actions and right-to-left layout are not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { godot_control_mount, godot_control_props, godot_control_set_gui_input, get_size } from './control';
import type { InputEventRecord } from './input-event';
import { godot_node_adopt, godot_node_entity } from './node';
import { get_as_ratio, get_step, get_value, godot_range_mount, godot_range_props, set_as_ratio, set_value } from './range';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['HSlider', 'Slider', 'Range', 'Control', 'CanvasItem', 'Node', 'Object'];
/** The default theme's grabber (`default_theme.cpp`, `grabber` of 16 by 16). */
const GRABBER = 16;

interface SliderState {
  grabbing: boolean;
  grabPos: number;
  grabRatio: number;
  before: number;
  editable: boolean;
  readonly dragStarted: SignalHandle<[]>;
  readonly dragEnded: SignalHandle<[boolean]>;
}

const SLIDERS = new WeakMap<object, SliderState>();

function minimumSize(): Vector2 {
  return vector2(0, GRABBER);
}

/** `Slider::gui_input` (`slider.cpp:47`), horizontally. */
function input(entity: Object3D, state: SliderState, event: InputEventRecord): void {
  if (!state.editable) return;
  if (event.type === 'mouse_button') {
    if (event.button_index === 1) {
      if (event.pressed) {
        state.grabPos = event.position.x;
        state.before = get_as_ratio(entity);
        state.dragStarted.emit();
        const area = get_size(entity).x - GRABBER;
        if (area > 0) set_as_ratio(entity, (state.grabPos - GRABBER / 2) / area);
        state.grabbing = true;
        state.grabRatio = get_as_ratio(entity);
      } else if (state.grabbing) {
        state.grabbing = false;
        state.dragEnded.emit(Math.abs(state.before - get_as_ratio(entity)) > 1e-5);
      }
    } else if (event.pressed && event.button_index === 4) {
      set_value(entity, get_value(entity) + get_step(entity));
    } else if (event.pressed && event.button_index === 5) {
      set_value(entity, get_value(entity) - get_step(entity));
    }
  } else if (event.type === 'mouse_motion' && state.grabbing) {
    const area = get_size(entity).x - GRABBER;
    if (area <= 0) return;
    set_as_ratio(entity, state.grabRatio + (event.position.x - state.grabPos) / area);
  }
}

const CONTENTS = new WeakMap<Object3D, readonly [HTMLElement, HTMLElement]>();

function draw(entity: Object3D, element: HTMLElement): void {
  let parts = CONTENTS.get(entity);
  if (parts === undefined) {
    const track = element.ownerDocument.createElement('div');
    track.setAttribute('data-godot-content', '');
    Object.assign(track.style, { position: 'absolute', left: '0px', right: '0px', top: '50%', height: '4px', marginTop: '-2px', borderRadius: '2px', background: 'rgba(26, 26, 26, 0.6)', pointerEvents: 'none' });
    const grabber = element.ownerDocument.createElement('div');
    Object.assign(grabber.style, { position: 'absolute', top: '50%', width: `${String(GRABBER)}px`, height: `${String(GRABBER)}px`, marginTop: `${String(-GRABBER / 2)}px`, borderRadius: '50%', background: 'rgb(224, 224, 224)', pointerEvents: 'none' });
    parts = [track, grabber];
    CONTENTS.set(entity, parts);
  }
  const [track, grabber] = parts;
  if (track.parentElement !== element) element.insertBefore(track, element.firstChild);
  if (grabber.parentElement !== element) track.after(grabber);
  const area = Math.max(get_size(entity).x - GRABBER, 0);
  grabber.style.left = `${String(get_as_ratio(entity) * area)}px`;
  const filter = godot_canvas_item_self_filter(entity, element);
  track.style.filter = filter;
  grabber.style.filter = filter;
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  return JSON.stringify([get_as_ratio(entity), get_size(entity).x, godot_canvas_item_self_filter(entity, element)]);
}

/**
 * @godot HSlider (protocol)
 * @source scene/gui/slider.cpp:46
 */
export function godot_h_slider_mount(entity: Object3D): void {
  const state: SliderState = { grabbing: false, grabPos: 0, grabRatio: 0, before: 0, editable: true, dragStarted: createSignal<[]>(), dragEnded: createSignal<[boolean]>() };
  SLIDERS.set(entity, state);
  godot_control_mount(entity, CLASSES.slice(0, -1), { minimumSize, draw, drawKey });
  godot_range_mount(entity);
  godot_control_set_gui_input(entity, { native: (event) => input(entity, state, event as InputEventRecord) });
}

/**
 * @godot HSlider.HSlider
 * @source scene/gui/slider.h:120
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_h_slider_mount(entity);
  return entity;
}

/**
 * @godot Slider.set_editable
 * @source scene/gui/slider.cpp:425
 */
export function set_editable(self: object, editable: boolean): void {
  const state = SLIDERS.get(godot_node_entity(self));
  if (state !== undefined) state.editable = editable;
}

/**
 * @godot Slider.drag_started
 * @source scene/gui/slider.cpp:462
 */
export function drag_started(self: object): GodotSignal<[]> {
  return (SLIDERS.get(godot_node_entity(self)) as SliderState).dragStarted.signal;
}

/**
 * @godot Slider.drag_ended
 * @source scene/gui/slider.cpp:463
 */
export function drag_ended(self: object): GodotSignal<[boolean]> {
  return (SLIDERS.get(godot_node_entity(self)) as SliderState).dragEnded.signal;
}

const H_SLIDER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_h_slider_mount,
  props: new Map<string, GodotElementProp<Object3D>>([...godot_control_props(), ...godot_range_props(), ['editable', (entity, value: boolean) => set_editable(entity, value)]]),
};

/**
 * An HSlider as a scene writes it: `<GodotHSlider maxValue={16} value={8} />`.
 *
 * @godot HSlider (protocol)
 * @source scene/gui/slider.cpp:447
 */
export function GodotHSlider(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(H_SLIDER, props);
}
