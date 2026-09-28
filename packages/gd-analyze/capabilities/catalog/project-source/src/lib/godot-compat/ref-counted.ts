/**
 * @godot-class RefCounted
 * @role BINDING
 *
 * Godot 4.7's `RefCounted` (`core/object/ref_counted.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the base a script class extends by default: an
 * object recording its class. JS's collector frees it when nothing holds it, as the count does.
 */

import { godot_node_adopt } from './node';

/**
 * A new RefCounted (`RefCounted.new()`, or the native object under a script's `new()`).
 *
 * @godot RefCounted.RefCounted
 * @source core/object/ref_counted.cpp:100
 */
export function construct(): object {
  const self = {};
  godot_node_adopt(self, { classes: ['RefCounted', 'Object'] });
  return self;
}
