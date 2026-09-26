import { createSignal, type GodotSignal } from './signal';

export type GodotSpawnFunction = (data: unknown) => unknown;
export type GodotVisibilityFilter = (peer: number) => boolean;

export class GodotMultiplayerSpawner {
  private readonly spawnableScenes: string[] = [];
  private readonly liveNodes: unknown[] = [];
  private readonly spawnedSignal = createSignal<readonly [unknown]>();
  private readonly despawnedSignal = createSignal<readonly [unknown]>();
  private spawnPath: unknown = '';
  private spawnLimit = 0;
  private spawnFunction: GodotSpawnFunction | null = null;

  readonly spawned: GodotSignal<readonly [unknown]> = this.spawnedSignal.signal;
  readonly despawned: GodotSignal<readonly [unknown]> = this.despawnedSignal.signal;

  add_spawnable_scene(path: string): void {
    if (path === '') throw new TypeError('MultiplayerSpawner spawnable scene path cannot be empty.');
    if (!this.spawnableScenes.includes(path)) this.spawnableScenes.push(path);
  }

  get_spawnable_scene_count(): number { return this.spawnableScenes.length; }

  get_spawnable_scene(index: number): string {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.spawnableScenes.length) return '';
    return this.spawnableScenes[index] ?? '';
  }

  clear_spawnable_scenes(): void { this.spawnableScenes.length = 0; }

  spawn(data: unknown = null): unknown {
    if (this.spawnLimit > 0 && this.liveNodes.length >= this.spawnLimit) return null;
    if (this.spawnFunction === null) return null;
    const node = this.spawnFunction(data);
    if (node === null || node === undefined) return null;
    this.liveNodes.push(node);
    this.spawnedSignal.emit(node);
    return node;
  }

  despawn(node: unknown): boolean {
    const index = this.liveNodes.indexOf(node);
    if (index < 0) return false;
    this.liveNodes.splice(index, 1);
    this.despawnedSignal.emit(node);
    return true;
  }

  get_spawn_path(): unknown { return this.spawnPath; }
  set_spawn_path(path: unknown): void { this.spawnPath = path; }
  get_spawn_limit(): number { return this.spawnLimit; }
  set_spawn_limit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('MultiplayerSpawner spawn_limit must be non-negative.');
    this.spawnLimit = limit;
  }
  get_spawn_function(): GodotSpawnFunction | null { return this.spawnFunction; }
  set_spawn_function(spawnFunction: GodotSpawnFunction | null): void { this.spawnFunction = spawnFunction; }
  get_spawned_nodes(): readonly unknown[] { return this.liveNodes; }
}

export const GODOT_VISIBILITY_PROCESS_IDLE = 0;
export const GODOT_VISIBILITY_PROCESS_PHYSICS = 1;
export const GODOT_VISIBILITY_PROCESS_NONE = 2;

export class GodotMultiplayerSynchronizer {
  private readonly synchronizedSignal = createSignal<readonly []>();
  private readonly deltaSynchronizedSignal = createSignal<readonly []>();
  private readonly visibilityChangedSignal = createSignal<readonly [number]>();
  private readonly visibilityFilters = new Set<GodotVisibilityFilter>();
  private readonly peerVisibility = new Map<number, boolean>();
  private readonly computedVisibility = new Map<number, boolean>();
  private rootPath: unknown = '';
  private replicationInterval = 0;
  private deltaInterval = 0;
  private replicationConfig: unknown = null;
  private visibilityUpdateMode = GODOT_VISIBILITY_PROCESS_IDLE;
  private publicVisibility = true;
  private replicationElapsed = 0;
  private deltaElapsed = 0;

  readonly synchronized: GodotSignal<readonly []> = this.synchronizedSignal.signal;
  readonly delta_synchronized: GodotSignal<readonly []> = this.deltaSynchronizedSignal.signal;
  readonly visibility_changed: GodotSignal<readonly [number]> = this.visibilityChangedSignal.signal;

  set_root_path(path: unknown): void { this.rootPath = path; }
  get_root_path(): unknown { return this.rootPath; }

  set_replication_interval(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('MultiplayerSynchronizer replication_interval must be non-negative.');
    this.replicationInterval = milliseconds;
  }

  get_replication_interval(): number { return this.replicationInterval; }

  set_delta_interval(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('MultiplayerSynchronizer delta_interval must be non-negative.');
    this.deltaInterval = milliseconds;
  }

  get_delta_interval(): number { return this.deltaInterval; }
  set_replication_config(config: unknown): void { this.replicationConfig = config; }
  get_replication_config(): unknown { return this.replicationConfig; }

  set_visibility_update_mode(mode: number): void {
    if (mode < GODOT_VISIBILITY_PROCESS_IDLE || mode > GODOT_VISIBILITY_PROCESS_NONE || !Number.isSafeInteger(mode)) {
      throw new RangeError('MultiplayerSynchronizer visibility_update_mode is invalid.');
    }
    this.visibilityUpdateMode = mode;
  }

  get_visibility_update_mode(): number { return this.visibilityUpdateMode; }

  update_visibility(forPeer = 0): void {
    if (forPeer !== 0) {
      this.updatePeerVisibility(forPeer);
      return;
    }
    const peers = new Set([...this.peerVisibility.keys(), ...this.computedVisibility.keys()]);
    for (const peer of peers) this.updatePeerVisibility(peer);
  }

  set_visibility_public(visible: boolean): void {
    this.publicVisibility = visible;
    this.update_visibility();
  }

  is_visibility_public(): boolean { return this.publicVisibility; }
  add_visibility_filter(filter: GodotVisibilityFilter): void { this.visibilityFilters.add(filter); }
  remove_visibility_filter(filter: GodotVisibilityFilter): void { this.visibilityFilters.delete(filter); }

  set_visibility_for(peer: number, visible: boolean): void {
    if (!Number.isSafeInteger(peer) || peer < 1) throw new RangeError('MultiplayerSynchronizer peer must be positive.');
    this.peerVisibility.set(peer, visible);
    this.updatePeerVisibility(peer);
  }

  get_visibility_for(peer: number): boolean {
    return this.computedVisibility.get(peer) ?? this.calculateVisibility(peer);
  }

  process(deltaMilliseconds: number, physics = false): void {
    const expectedPhysics = this.visibilityUpdateMode === GODOT_VISIBILITY_PROCESS_PHYSICS;
    if (this.visibilityUpdateMode !== GODOT_VISIBILITY_PROCESS_NONE && physics === expectedPhysics) this.update_visibility();
    this.replicationElapsed += deltaMilliseconds;
    this.deltaElapsed += deltaMilliseconds;
    if (this.replicationInterval === 0 || this.replicationElapsed >= this.replicationInterval) {
      this.replicationElapsed = 0;
      this.synchronizedSignal.emit();
    }
    if (this.deltaInterval === 0 || this.deltaElapsed >= this.deltaInterval) {
      this.deltaElapsed = 0;
      this.deltaSynchronizedSignal.emit();
    }
  }

  private calculateVisibility(peer: number): boolean {
    if (!(this.peerVisibility.get(peer) ?? this.publicVisibility)) return false;
    for (const filter of this.visibilityFilters) if (!filter(peer)) return false;
    return true;
  }

  private updatePeerVisibility(peer: number): void {
    const visible = this.calculateVisibility(peer);
    if (this.computedVisibility.get(peer) === visible) return;
    this.computedVisibility.set(peer, visible);
    this.visibilityChangedSignal.emit(peer);
  }
}

export function createGodotMultiplayerSpawner(): GodotMultiplayerSpawner { return new GodotMultiplayerSpawner(); }
export function createGodotMultiplayerSynchronizer(): GodotMultiplayerSynchronizer { return new GodotMultiplayerSynchronizer(); }
