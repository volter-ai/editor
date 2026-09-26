/** Mutable AnimationNode filter protocol over the graph's plain authored node records. */
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export interface AnimationNodeFilterSnapshot {
  readonly enabled: boolean;
  readonly paths: readonly string[];
}

export interface GodotAnimationNodeFilter {
  filter_enabled: boolean;
  set_filter_enabled(enabled: boolean): void;
  is_filter_enabled(): boolean;
  set_filter_path(path: string, enabled: boolean): void;
  is_path_filtered(path: string): boolean;
}

interface MutableAnimationNodeFilter {
  enabled: boolean;
  readonly paths: Set<string>;
}

const FILTERS = new WeakMap<object, MutableAnimationNodeFilter>();

function pathValue(path: unknown): string {
  if (typeof path !== 'string') {
    throw new TypeError('godot-compat: AnimationNode filter path must be a NodePath/string');
  }
  return path;
}

function enabledValue(enabled: unknown): boolean {
  if (typeof enabled !== 'boolean') {
    throw new TypeError('godot-compat: AnimationNode filter enabled value must be boolean');
  }
  return enabled;
}

/** Attach Godot's filter methods without replacing the plain graph object or making a hierarchy. */
export function bindAnimationNodeFilter<T extends object>(
  node: T,
  className: 'AnimationNodeBlend2' | 'AnimationNodeBlend3' | 'AnimationNodeAdd2' |
    'AnimationNodeAdd3' | 'AnimationNodeSub2' | 'AnimationNodeOneShot',
  initial: AnimationNodeFilterSnapshot,
): T & GodotAnimationNodeFilter {
  const state: MutableAnimationNodeFilter = {
    enabled: initial.enabled,
    paths: new Set(initial.paths),
  };
  FILTERS.set(node, state);
  Object.defineProperties(node, {
    filter_enabled: {
      enumerable: false,
      configurable: true,
      get: () => state.enabled,
      set: (value: unknown) => {
        state.enabled = enabledValue(value);
        Reflect.set(node, 'filterEnabled', state.enabled);
        godotResourceEmitChanged(node);
      },
    },
    set_filter_enabled: {
      enumerable: false,
      configurable: true,
      value: (value: unknown) => {
        state.enabled = enabledValue(value);
        Reflect.set(node, 'filterEnabled', state.enabled);
        godotResourceEmitChanged(node);
      },
    },
    is_filter_enabled: {
      enumerable: false,
      configurable: true,
      value: () => state.enabled,
    },
    set_filter_path: {
      enumerable: false,
      configurable: true,
      value: (path: unknown, enabled: unknown) => {
        const normalized = pathValue(path);
        if (enabledValue(enabled)) state.paths.add(normalized);
        else state.paths.delete(normalized);
        Reflect.set(node, 'filterPaths', [...state.paths].sort());
        godotResourceEmitChanged(node);
      },
    },
    is_path_filtered: {
      enumerable: false,
      configurable: true,
      value: (path: unknown) => state.paths.has(pathValue(path)),
    },
  });
  registerGodotObjectIdentity(node, className);
  return node as T & GodotAnimationNodeFilter;
}

/** Current dynamic filter state. Unbound records retain their authored immutable fields. */
export function animationNodeFilterSnapshot(
  node: object,
  authored: AnimationNodeFilterSnapshot,
): AnimationNodeFilterSnapshot {
  const state = FILTERS.get(node);
  return state === undefined
    ? authored
    : { enabled: state.enabled, paths: [...state.paths].sort() };
}
