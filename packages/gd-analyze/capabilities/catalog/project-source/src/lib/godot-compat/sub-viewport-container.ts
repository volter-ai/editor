/**
 * @godot-class SubViewportContainer
 * @role BINDING
 *
 * Godot 4.7's `SubViewportContainer` (`scene/gui/subviewport_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control showing its SubViewport children's images
 * (`sub-viewport.ts`) over its rect, the viewports sized to it with `stretch`.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { get_size, godot_control_mount, godot_control_props } from './control';
import { get_size as get_viewport_size, godot_sub_viewport_image, godot_sub_viewport_is, set_size as set_viewport_size } from './sub-viewport';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector2i } from './vector2i';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['SubViewportContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'];

const STATE = new WeakMap<object, { stretch: boolean; shrink: number }>();

function stateOf(self: object): { stretch: boolean; shrink: number } {
  const entity = godot_node_entity(self);
  let state = STATE.get(entity);
  if (state === undefined) {
    state = { stretch: false, shrink: 1 };
    STATE.set(entity, state);
  }
  return state;
}

/**
 * @godot SubViewportContainer.set_stretch
 * @source scene/gui/subviewport_container.cpp:52
 */
export function set_stretch(self: object, enable: boolean): void {
  stateOf(self).stretch = enable;
}

/**
 * @godot SubViewportContainer.is_stretch_enabled
 * @source scene/gui/subviewport_container.cpp:63
 */
export function is_stretch_enabled(self: object): boolean {
  return stateOf(self).stretch;
}

/**
 * @godot SubViewportContainer.set_stretch_shrink
 * @source scene/gui/subviewport_container.cpp:67
 */
export function set_stretch_shrink(self: object, ratio: number): void {
  stateOf(self).shrink = ratio;
}

/** The container's SubViewport children. */
function viewportsOf(entity: Object3D): Object3D[] {
  return entity.children.filter((child) => godot_sub_viewport_is(child));
}

/**
 * `NOTIFICATION_DRAW` (`subviewport_container.cpp:135`): each SubViewport child's image over the
 * rect, stretched to it; with `stretch`, the viewports are the rect's size over `stretch_shrink`
 * (`NOTIFICATION_RESIZED`, `:113`).
 */
function draw(entity: Object3D, element: HTMLElement): void {
  const state = stateOf(entity);
  const size = get_size(entity);
  for (const viewport of viewportsOf(entity)) {
    if (state.stretch) set_viewport_size(viewport, vector2i(Math.trunc(size.x / state.shrink), Math.trunc(size.y / state.shrink)));
    const image = godot_sub_viewport_image(viewport);
    if (image.parentElement !== element) {
      image.style.position = 'absolute';
      image.style.left = '0px';
      image.style.top = '0px';
      image.style.width = '100%';
      image.style.height = '100%';
      element.appendChild(image);
    }
  }
}

/** `get_minimum_size` (`subviewport_container.cpp:37`): none while stretching, else the largest viewport. */
function minimumSize(entity: Object3D): Vector2 {
  if (stateOf(entity).stretch) return vector2();
  let x = 0;
  let y = 0;
  for (const viewport of viewportsOf(entity)) {
    const size = get_viewport_size(viewport);
    x = Math.max(x, size.x / stateOf(entity).shrink);
    y = Math.max(y, size.y / stateOf(entity).shrink);
  }
  return vector2(x, y);
}

const SUB_VIEWPORT_CONTAINER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: (entity: Object3D) => godot_control_mount(entity, CLASSES, { draw, minimumSize }),
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['stretch', (entity, value: boolean) => set_stretch(entity, value)],
    ['stretchShrink', (entity, value: number) => set_stretch_shrink(entity, value)],
  ]),
};

/**
 * A SubViewportContainer as a scene writes it: `<GodotSubViewportContainer stretch />`.
 *
 * @godot SubViewportContainer (protocol)
 * @source scene/gui/subviewport_container.cpp:280
 */
export function GodotSubViewportContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(SUB_VIEWPORT_CONTAINER, props);
}
