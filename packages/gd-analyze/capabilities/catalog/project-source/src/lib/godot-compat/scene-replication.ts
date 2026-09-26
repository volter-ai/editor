/** Retained Godot 4 scene-replication resources and node-side configuration state. */
import { godotNodePathNew, godotNodePathString, type GodotNodePath } from './node-path';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  godotResourceEmitChanged,
} from './resource-io';

export const SCENE_REPLICATION_MODE_NEVER = 0;
export const SCENE_REPLICATION_MODE_ALWAYS = 1;
export const SCENE_REPLICATION_MODE_ON_CHANGE = 2;

export type GodotSceneReplicationMode = 0 | 1 | 2;

interface ReplicationProperty {
  readonly path: GodotNodePath;
  spawn: boolean;
  mode: GodotSceneReplicationMode;
}

export interface GodotSceneReplicationConfig {
  get_properties(): readonly GodotNodePath[];
  add_property(path: GodotNodePath | string, index?: number): void;
  has_property(path: GodotNodePath | string): boolean;
  remove_property(path: GodotNodePath | string): void;
  property_get_index(path: GodotNodePath | string): number;
  property_get_spawn(path: GodotNodePath | string): boolean;
  property_set_spawn(path: GodotNodePath | string, enabled: boolean): void;
  property_get_sync(path: GodotNodePath | string): boolean;
  property_set_sync(path: GodotNodePath | string, enabled: boolean): void;
  property_get_watch(path: GodotNodePath | string): boolean;
  property_set_watch(path: GodotNodePath | string, enabled: boolean): void;
  property_get_replication_mode(path: GodotNodePath | string): GodotSceneReplicationMode;
  property_set_replication_mode(path: GodotNodePath | string, mode: number): void;
}

export interface GodotSceneReplicationPropertySeed {
  readonly path: GodotNodePath | string;
  readonly spawn?: boolean;
  readonly sync?: boolean;
  readonly watch?: boolean;
  readonly replicationMode?: GodotSceneReplicationMode;
}

function pathValue(value: GodotNodePath | string): GodotNodePath {
  return godotNodePathNew(value);
}

function pathKey(value: GodotNodePath | string): string {
  return godotNodePathString(pathValue(value));
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function mode(value: unknown): GodotSceneReplicationMode | undefined {
  if (value !== 0 && value !== 1 && value !== 2) {
    return undefined;
  }
  return value;
}

function seededMode(seed: GodotSceneReplicationPropertySeed): GodotSceneReplicationMode {
  if (seed.replicationMode !== undefined) {
    return mode(seed.replicationMode) ?? SCENE_REPLICATION_MODE_ALWAYS;
  }
  let result: GodotSceneReplicationMode = SCENE_REPLICATION_MODE_ALWAYS;
  if (seed.sync !== undefined) {
    result = bool(seed.sync, 'SceneReplicationConfig sync seed')
      ? SCENE_REPLICATION_MODE_ALWAYS
      : SCENE_REPLICATION_MODE_NEVER;
  }
  if (seed.watch !== undefined) {
    const watch = bool(seed.watch, 'SceneReplicationConfig watch seed');
    if (watch) result = SCENE_REPLICATION_MODE_ON_CHANGE;
  }
  return result;
}

export function createGodotSceneReplicationConfig(
  seeds: readonly GodotSceneReplicationPropertySeed[] = [],
): GodotSceneReplicationConfig {
  const properties: ReplicationProperty[] = [];
  const keys = new Set<string>();
  for (const seed of seeds) {
    const path = pathValue(seed.path);
    const key = godotNodePathString(path);
    if (key === '' || keys.has(key)) continue;
    keys.add(key);
    properties.push({
      path,
      spawn: seed.spawn === undefined ? true : bool(seed.spawn, 'SceneReplicationConfig spawn seed'),
      mode: seededMode(seed),
    });
  }

  const find = (path: GodotNodePath | string): number => {
    const key = pathKey(path);
    return properties.findIndex((property) => godotNodePathString(property.path) === key);
  };
  const property = (path: GodotNodePath | string): ReplicationProperty | undefined => {
    const index = find(path);
    return index < 0 ? undefined : properties[index];
  };
  const changed = (): void => godotResourceEmitChanged(config);
  const config: GodotSceneReplicationConfig = {
    get_properties: () => properties.map((property) => pathValue(property.path)),
    add_property(path, index = -1) {
      if (!Number.isSafeInteger(index) || index > properties.length) return;
      const next = pathValue(path);
      const key = godotNodePathString(next);
      if (key === '' || find(next) >= 0) return;
      const property: ReplicationProperty = {
        path: next,
        spawn: true,
        mode: SCENE_REPLICATION_MODE_ALWAYS,
      };
      if (index < 0) properties.push(property);
      else properties.splice(index, 0, property);
      changed();
    },
    has_property: (path) => find(path) >= 0,
    remove_property(path) {
      const index = find(path);
      if (index < 0) return;
      properties.splice(index, 1);
      changed();
    },
    property_get_index: find,
    property_get_spawn: (path) => property(path)?.spawn ?? false,
    property_set_spawn(path, enabled) {
      const current = property(path);
      if (current === undefined) return;
      const next = bool(enabled, 'SceneReplicationConfig.property_set_spawn');
      if (current.spawn === next) return;
      current.spawn = next;
      changed();
    },
    property_get_sync: (path) => property(path)?.mode === SCENE_REPLICATION_MODE_ALWAYS,
    property_set_sync(path, enabled) {
      const current = property(path);
      if (current === undefined) return;
      const on = bool(enabled, 'SceneReplicationConfig.property_set_sync');
      const next = on
        ? SCENE_REPLICATION_MODE_ALWAYS
        : current.mode === SCENE_REPLICATION_MODE_ALWAYS
          ? SCENE_REPLICATION_MODE_NEVER
          : current.mode;
      if (current.mode === next) return;
      current.mode = next;
      changed();
    },
    property_get_watch: (path) => property(path)?.mode === SCENE_REPLICATION_MODE_ON_CHANGE,
    property_set_watch(path, enabled) {
      const current = property(path);
      if (current === undefined) return;
      const on = bool(enabled, 'SceneReplicationConfig.property_set_watch');
      const next = on
        ? SCENE_REPLICATION_MODE_ON_CHANGE
        : current.mode === SCENE_REPLICATION_MODE_ON_CHANGE
          ? SCENE_REPLICATION_MODE_NEVER
          : current.mode;
      if (current.mode === next) return;
      current.mode = next;
      changed();
    },
    property_get_replication_mode: (path) => property(path)?.mode ?? SCENE_REPLICATION_MODE_NEVER,
    property_set_replication_mode(path, value) {
      const current = property(path);
      const next = mode(value);
      if (current === undefined || next === undefined || current.mode === next) return;
      current.mode = next;
      changed();
    },
  };
  registerGodotObjectIdentity(config, 'SceneReplicationConfig');
  SCENE_REPLICATION_CONFIGS.add(config);
  bindGodotResourceProtocol(config, {
    createDuplicate: () => createGodotSceneReplicationConfig(properties.map((property) => ({
      path: property.path,
      spawn: property.spawn,
      replicationMode: property.mode,
    }))),
  });
  return config;
}

const SCENE_REPLICATION_CONFIGS = new WeakSet<object>();

interface MultiplayerSynchronizerState {
  rootPath: GodotNodePath;
  replicationInterval: number;
  deltaInterval: number;
  config: GodotSceneReplicationConfig | null;
}

const SYNCHRONIZERS = new WeakMap<object, MultiplayerSynchronizerState>();

function synchronizer(node: object): MultiplayerSynchronizerState {
  let current = SYNCHRONIZERS.get(node);
  if (current === undefined) {
    current = {
      rootPath: godotNodePathNew('..'),
      replicationInterval: 0,
      deltaInterval: 0,
      config: null,
    };
    SYNCHRONIZERS.set(node, current);
  }
  return current;
}

export function bindGodotMultiplayerSynchronizer(
  node: object,
  options: {
    readonly rootPath?: GodotNodePath | string;
    readonly replicationInterval?: number;
    readonly deltaInterval?: number;
    readonly replicationConfig?: GodotSceneReplicationConfig | null;
  } = {},
): void {
  const state = synchronizer(node);
  if (options.rootPath !== undefined) state.rootPath = pathValue(options.rootPath);
  if (options.replicationInterval !== undefined) setGodotReplicationInterval(node, options.replicationInterval);
  if (options.deltaInterval !== undefined) setGodotDeltaInterval(node, options.deltaInterval);
  if (options.replicationConfig !== undefined) setGodotReplicationConfig(node, options.replicationConfig);
  registerGodotObjectIdentity(node, 'MultiplayerSynchronizer');
}

function nonnegative(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${member} requires a non-negative finite number.`);
  }
  return value;
}

export function setGodotSynchronizerRootPath(node: object, path: GodotNodePath | string): void {
  synchronizer(node).rootPath = pathValue(path);
}
export function getGodotSynchronizerRootPath(node: object): GodotNodePath {
  return pathValue(synchronizer(node).rootPath);
}
export function setGodotReplicationInterval(node: object, value: number): void {
  synchronizer(node).replicationInterval = nonnegative(value, 'MultiplayerSynchronizer.replication_interval');
}
export function getGodotReplicationInterval(node: object): number { return synchronizer(node).replicationInterval; }
export function setGodotDeltaInterval(node: object, value: number): void {
  synchronizer(node).deltaInterval = nonnegative(value, 'MultiplayerSynchronizer.delta_interval');
}
export function getGodotDeltaInterval(node: object): number { return synchronizer(node).deltaInterval; }
export function setGodotReplicationConfig(node: object, value: GodotSceneReplicationConfig | null): void {
  if (value !== null && (typeof value !== 'object' || !SCENE_REPLICATION_CONFIGS.has(value))) {
    throw new TypeError('MultiplayerSynchronizer.replication_config requires SceneReplicationConfig or null.');
  }
  synchronizer(node).config = value;
}
export function getGodotReplicationConfig(node: object): GodotSceneReplicationConfig | null {
  return synchronizer(node).config;
}
