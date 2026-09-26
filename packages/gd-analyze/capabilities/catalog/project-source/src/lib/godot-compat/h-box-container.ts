/**
 * @godot-class HBoxContainer
 * @role PROTOCOL
 *
 * Godot 4.7's `HBoxContainer` (`scene/gui/box_container.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a horizontal `BoxContainer` whose orientation is fixed.
 */

import type { Object3D } from 'three';
import { godot_box_container_mount } from './box-container';

/**
 * Makes `entity` an HBoxContainer (`HBoxContainer() : BoxContainer(false)`), a node of that class.
 *
 * @godot HBoxContainer (protocol)
 * @source scene/gui/box_container.h:85
 */
export function godot_h_box_container_mount(entity: Object3D): void {
  godot_box_container_mount(entity, ['HBoxContainer', 'BoxContainer', 'Container', 'Control', 'CanvasItem', 'Node'], false);
}
