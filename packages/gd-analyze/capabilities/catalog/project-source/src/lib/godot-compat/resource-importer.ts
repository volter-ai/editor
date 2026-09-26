/** Godot ResourceImporter build-dependency protocol. */

import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';

export interface GodotResourceImporterHooks {
  _get_build_dependencies(path: string): Iterable<string>;
}

export class GodotResourceImporter {
  constructor(private readonly hooks: GodotResourceImporterHooks) {
    registerGodotObjectIdentity(this, 'ResourceImporter');
  }
  _get_build_dependencies(path: string): PackedStringArray {
    if (typeof path !== 'string' || path.length === 0) {
      throw new TypeError('ResourceImporter._get_build_dependencies requires a non-empty path.');
    }
    const dependencies = new Set<string>();
    for (const dependency of this.hooks._get_build_dependencies(path)) {
      if (typeof dependency !== 'string' || dependency.length === 0) {
        throw new TypeError('ResourceImporter build dependencies must be non-empty paths.');
      }
      dependencies.add(dependency);
    }
    return packedStringArray(dependencies);
  }
}

export function createGodotResourceImporter(hooks: GodotResourceImporterHooks): GodotResourceImporter {
  return new GodotResourceImporter(hooks);
}
