/**
 * @godot-class HBoxContainer
 * @role PROTOCOL
 *
 * Godot 4.7's `HBoxContainer` (`scene/gui/box_container.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a horizontal `BoxContainer` whose orientation is fixed.
 */

import type { Object3D } from 'three';
import { godot_box_container_mount } from './box-container';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { set_alignment } from './box-container';
import { godot_control_props } from './control';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

/**
 * Makes `entity` an HBoxContainer (`HBoxContainer() : BoxContainer(false)`), a node of that class.
 *
 * @godot HBoxContainer (protocol)
 * @source scene/gui/box_container.h:85
 */
export function godot_h_box_container_mount(entity: Object3D): void {
  godot_box_container_mount(entity, ['HBoxContainer', 'BoxContainer', 'Container', 'Control', 'CanvasItem', 'Node'], false);
}

const H_BOX_CONTAINER = {
  create: () => new Group(),
  classes: ['HBoxContainer', 'BoxContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_h_box_container_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['alignment', (entity, value: number) => set_alignment(entity, value)],
  ]),
};

/**
 * An HBoxContainer as a scene writes it (`box_container.cpp:440`: BoxContainer's alignment).
 *
 * @godot HBoxContainer (protocol)
 * @source scene/gui/box_container.cpp:440
 */
export function GodotHBoxContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(H_BOX_CONTAINER, props);
}
