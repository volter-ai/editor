/** Retained ResourcePreloader named resource table. */

import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import { godotDictionary, type GodotDictionary } from './variant';

function nameValue(value: unknown, member: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`ResourcePreloader.${member} requires non-empty StringName.`);
  }
  return value;
}

function resourceValue(value: unknown): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('ResourcePreloader.add_resource requires Resource.');
  }
  return value;
}

export class GodotResourcePreloader {
  private readonly entries = new Map<string, unknown>();

  constructor(resources?: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>) {
    registerGodotObjectIdentity(this, 'ResourcePreloader');
    if (resources instanceof Map) {
      for (const [name, resource] of resources) this.add_resource(name, resource);
    } else if (resources !== undefined) {
      for (const [name, resource] of Object.entries(resources)) this.add_resource(name, resource);
    }
  }

  get resources(): GodotDictionary<string, unknown> {
    return godotDictionary([...this.entries]);
  }

  set resources(value: GodotDictionary<string, unknown> | Readonly<Record<string, unknown>>) {
    this.entries.clear();
    if (value instanceof Map) {
      for (const [name, resource] of value) this.add_resource(name, resource);
      return;
    }
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('ResourcePreloader.resources requires Dictionary.');
    }
    for (const [name, resource] of Object.entries(value)) this.add_resource(name, resource);
  }

  add_resource(name: unknown, resource: unknown): void {
    const key = nameValue(name, 'add_resource');
    if (this.entries.has(key)) throw new Error(`ResourcePreloader already contains ${key}.`);
    this.entries.set(key, resourceValue(resource));
  }

  remove_resource(name: unknown): void {
    const key = nameValue(name, 'remove_resource');
    if (!this.entries.delete(key)) throw new Error(`ResourcePreloader does not contain ${key}.`);
  }

  rename_resource(name: unknown, newName: unknown): void {
    const source = nameValue(name, 'rename_resource');
    const target = nameValue(newName, 'rename_resource');
    if (!this.entries.has(source)) throw new Error(`ResourcePreloader does not contain ${source}.`);
    if (source !== target && this.entries.has(target)) throw new Error(`ResourcePreloader already contains ${target}.`);
    const resource = this.entries.get(source);
    this.entries.delete(source);
    this.entries.set(target, resource);
  }

  has_resource(name: unknown): boolean { return this.entries.has(nameValue(name, 'has_resource')); }

  get_resource(name: unknown): unknown {
    const key = nameValue(name, 'get_resource');
    if (!this.entries.has(key)) return null;
    return this.entries.get(key);
  }

  get_resource_list(): PackedStringArray { return packedStringArray([...this.entries.keys()]); }
  clear(): void { this.entries.clear(); }
}

export function createGodotResourcePreloader(): GodotResourcePreloader {
  return new GodotResourcePreloader();
}

export type GodotResourcePreloaderNode<T extends object = object> = T & {
  resources: GodotDictionary<string, unknown>;
  add_resource(name: unknown, resource: unknown): void;
  remove_resource(name: unknown): void;
  rename_resource(name: unknown, newName: unknown): void;
  has_resource(name: unknown): boolean;
  get_resource(name: unknown): unknown;
  get_resource_list(): PackedStringArray;
};

const NODE_PRELOADERS = new WeakMap<object, GodotResourcePreloader>();

/**
 * Seat ResourcePreloader's real named-resource table on the native scene-tree carrier.
 *
 * ResourcePreloader is a Node, so an authored instance must remain the same Object3D/PIXI.Container
 * its children and SceneTree paths address. The table is retained beside that native node and its
 * ClassDB surface delegates to the same implementation used by `ResourcePreloader.new()`.
 */
export function bindGodotResourcePreloader<T extends object>(
  node: T,
  resources?: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>,
): GodotResourcePreloaderNode<T> {
  const prior = NODE_PRELOADERS.get(node);
  const model = prior ?? new GodotResourcePreloader(resources);
  if (prior !== undefined && resources !== undefined) {
    model.resources = new GodotResourcePreloader(resources).resources;
  }
  NODE_PRELOADERS.set(node, model);
  Object.defineProperties(node, {
    resources: {
      configurable: true,
      enumerable: true,
      get: () => model.resources,
      set: (value: GodotDictionary<string, unknown> | Readonly<Record<string, unknown>>) => {
        model.resources = value;
      },
    },
  });
  Object.assign(node, {
    add_resource: (name: unknown, resource: unknown): void => model.add_resource(name, resource),
    remove_resource: (name: unknown): void => model.remove_resource(name),
    rename_resource: (name: unknown, newName: unknown): void => model.rename_resource(name, newName),
    has_resource: (name: unknown): boolean => model.has_resource(name),
    get_resource: (name: unknown): unknown => model.get_resource(name),
    get_resource_list: (): PackedStringArray => model.get_resource_list(),
  });
  registerGodotObjectIdentity(node, 'ResourcePreloader');
  return node as GodotResourcePreloaderNode<T>;
}
