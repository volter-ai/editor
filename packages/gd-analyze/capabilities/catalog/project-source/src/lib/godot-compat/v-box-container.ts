/**
 * @godot-class VBoxContainer
 * @role PROTOCOL
 *
 * Godot 4.7's `VBoxContainer` (`scene/gui/box_container.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a vertical `BoxContainer` whose orientation is fixed.
 */

import type { Object3D } from 'three';
import { godot_box_container_mount } from './box-container';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { set_alignment } from './box-container';
import { godot_control_props } from './control';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

/**
 * Makes `entity` a VBoxContainer (`VBoxContainer() : BoxContainer(true)`), a node of that class.
 *
 * @godot VBoxContainer (protocol)
 * @source scene/gui/box_container.h:94
 */
export function godot_v_box_container_mount(entity: Object3D): void {
  godot_box_container_mount(entity, ['VBoxContainer', 'BoxContainer', 'Container', 'Control', 'CanvasItem', 'Node'], true);
}

const V_BOX_CONTAINER = {
  create: () => new Group(),
  classes: ['VBoxContainer', 'BoxContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_v_box_container_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['alignment', (entity, value: number) => set_alignment(entity, value)],
  ]),
};

/**
 * A VBoxContainer as a scene writes it (`box_container.cpp:440`: BoxContainer's alignment).
 *
 * @godot VBoxContainer (protocol)
 * @source scene/gui/box_container.cpp:440
 */
export function GodotVBoxContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(V_BOX_CONTAINER, props);
}
