/**
 * @godot-class Resource
 * @role BINDING
 *
 * Godot 4.7's `Resource` (`core/io/resource.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`)
 * as the base a script's own resource class extends (`extends Resource`): an object recording its
 * class, whose script instance holds the script's properties. Its path is the file it was loaded
 * from, empty for one made in code.
 */

import { godot_node_adopt } from './node';

const PATHS = new WeakMap<object, string>();

/**
 * A new Resource (`Resource.new()`, or the native object under a script resource's `new()`).
 *
 * @godot Resource.Resource
 * @source core/io/resource.cpp:707
 */
export function construct(): object {
  const self = {};
  godot_node_adopt(self, { classes: ['Resource', 'RefCounted', 'Object'] });
  return self;
}

/**
 * Records the file a resource was loaded from (`Resource::set_path`).
 *
 * @godot Resource (protocol)
 * @source core/io/resource.cpp:59
 */
export function godot_resource_set_path(self: object, path: string): void {
  PATHS.set(self, path);
}

/**
 * @godot Resource.get_path
 * @source core/io/resource.cpp:100
 */
export function get_path(self: object): string {
  return PATHS.get(self) ?? '';
}
