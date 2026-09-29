/**
 * @godot-class SubViewportContainer
 * @role BINDING
 *
 * Godot 4.7's `SubViewportContainer` (`scene/gui/subviewport_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control showing its SubViewport children's images
 * over its rect. The sub-viewport draws itself over the frame (`sub-viewport.ts`), which is the
 * container's rect: the plan carries only a container covering the whole viewport, whose layout
 * it states no prop for; `stretch` and `stretch_shrink` are stored.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
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

const SUB_VIEWPORT_CONTAINER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: (entity: Object3D) => void entity,
  props: new Map<string, GodotElementProp<Object3D>>([
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
