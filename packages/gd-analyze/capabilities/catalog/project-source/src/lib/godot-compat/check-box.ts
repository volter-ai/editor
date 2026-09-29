/**
 * @godot-class CheckBox
 * @role BINDING
 *
 * Godot 4.7's `CheckBox` (`scene/gui/check_box.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a toggling Button drawn flat with a check box before
 * its text (`button.ts`'s check look), ticked while pressed.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_button_mount, godot_button_props } from './button';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['CheckBox', 'Button', 'BaseButton', 'Control', 'CanvasItem', 'Node', 'Object'];

/**
 * @godot CheckBox (protocol)
 * @source scene/gui/check_box.cpp:170
 */
export function godot_check_box_mount(entity: Object3D): void {
  godot_button_mount(entity, CLASSES, true);
}

/**
 * @godot CheckBox.CheckBox
 * @source scene/gui/check_box.cpp:170
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_check_box_mount(entity);
  return entity;
}

const CHECK_BOX = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_check_box_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>(godot_button_props()),
};

/**
 * A CheckBox as a scene writes it: `<GodotCheckBox text="Fog" buttonPressed />`.
 *
 * @godot CheckBox (protocol)
 * @source scene/gui/check_box.cpp:170
 */
export function GodotCheckBox(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CHECK_BOX, props);
}
