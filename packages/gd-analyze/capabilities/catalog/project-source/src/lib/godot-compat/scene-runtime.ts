/**
 * Shared Godot scene-component protocols over the port's native objects.
 *
 * These are PROTOCOL helpers: Godot's array bounds, PackedScene entry timing, current-camera rule,
 * retained JSX refs, and runtime spawn list. The translated project's scene-runtime module owns
 * only its project-specific Context/Scene/Props types and re-exports these implementations.
 */

import { bodyOwningNode } from '@volter/threejs-runtime/adapter/body-marks';
import { Container } from 'pixi.js';
import type { Object3D, OrthographicCamera, PerspectiveCamera, Vector2Like } from 'three';
import type { ExcludableBody } from './physics-space-3d';
import { bindGodotCameraViewportSize } from './spatial';
import { subViewportOf } from './viewport';
import {
  createGodotAudioStreamMp3,
  createGodotAudioStreamOggVorbis,
  createGodotAudioStreamWav,
  type GodotAudioStream,
} from './audio-stream';

/** Exact live instance count for each source scene that owns a translated DOM composition. */
const GODOT_UI_SCENE_INSTANCES = new Map<string, number>();

/**
 * Retain one source scene for the lifetime of its exact mounted translated scene instance.
 *
 * The current authored Control store is keyed by source Node identity, not a runtime instance key,
 * so rendering two live instances of the same UI PackedScene would collapse two Godot node trees
 * into one DOM composition. Refuse that unsupported shape at its lifecycle boundary rather than
 * silently sharing mutable state or fabricating a second identity.
 */
export function retainGodotUiScene(resPath: string): () => void {
  if (!resPath.startsWith('res://') || !resPath.endsWith('.tscn')) {
    throw new TypeError(
      `Godot UI scene ownership requires a res:// PackedScene path, received ${JSON.stringify(resPath)}.`,
    );
  }
  const previous = GODOT_UI_SCENE_INSTANCES.get(resPath) ?? 0;
  if (previous !== 0) {
    throw new Error(
      `Godot UI scene ${resPath} has ${String(previous + 1)} simultaneously mounted PackedScene ` +
        'instances, but its translated authored-Control identity is source-keyed and cannot render ' +
        'those instances independently.',
    );
  }
  GODOT_UI_SCENE_INSTANCES.set(resPath, 1);
  let retained = true;
  return () => {
    if (!retained) return;
    retained = false;
    const count = GODOT_UI_SCENE_INSTANCES.get(resPath);
    if (count !== 1) {
      throw new Error(
        `Godot UI scene ownership release expected one mounted ${resPath} instance, received ${String(count ?? 0)}.`,
      );
    }
    GODOT_UI_SCENE_INSTANCES.delete(resPath);
  };
}

/** Exact mounted PackedScene instance count observed by the DOM medium's source-scene shell. */
export function godotUiSceneMountedInstanceCount(resPath: string): number {
  return GODOT_UI_SCENE_INSTANCES.get(resPath) ?? 0;
}

/** Godot's `array[i]`: an element, or the runtime error the source engine raises. */
export function elementAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(
      `invalid get index ${index} (on an array of ${values.length}) — Godot raises here too`,
    );
  }
  return value;
}

/** Acquire a translated PackedScene instance before the source call receives it. */
export function enterInstancedScene<T extends { enterTree(): void }>(
  scene: T,
): T {
  scene.enterTree();
  return scene;
}

export interface GodotLoadedAudioStreamSpec {
  readonly format: 'ogg-vorbis' | 'wav' | 'mp3';
  readonly loop: boolean;
  readonly loopOffset: number;
}

function isGodotLoadedAudioStreamSpec(value: unknown): value is GodotLoadedAudioStreamSpec {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Record<keyof GodotLoadedAudioStreamSpec, unknown>>;
  return (
    (candidate.format === 'ogg-vorbis' || candidate.format === 'wav' || candidate.format === 'mp3') &&
    typeof candidate.loop === 'boolean' &&
    typeof candidate.loopOffset === 'number'
  );
}

const LOADED_AUDIO_RESOURCES = new WeakMap<object, Map<string, { readonly spec: string; readonly stream: GodotAudioStream }>>();

/** Resolve a runtime `load`/static `preload` to one retained decoded AudioStream Resource. */
export function godotLoadStream(
  streams: ReadonlyMap<string, AudioBuffer>,
  resPath: string | null,
  authored?: GodotLoadedAudioStreamSpec | Readonly<Record<string, GodotLoadedAudioStreamSpec>>,
): GodotAudioStream {
  const buffer = resPath === null ? undefined : streams.get(resPath);
  if (buffer === undefined) {
    throw new Error(
      `load(${resPath}) — this translated Godot world decoded ${streams.size} stream(s) and that ` +
        'path is not one of them. The set is enumerated at translate time from the string ' +
      'literals that can reach the call, so a miss means the translation missed a caller.',
    );
  }
  if (resPath === null) throw new Error('load(null) cannot resolve an AudioStream Resource.');
  const extension = resPath.slice(resPath.lastIndexOf('.') + 1).toLowerCase();
  const selected = authored === undefined
    ? undefined
    : isGodotLoadedAudioStreamSpec(authored)
      ? authored
      : authored[resPath];
  const spec: GodotLoadedAudioStreamSpec = selected ?? {
    format: extension === 'ogg' ? 'ogg-vorbis' : extension === 'wav' ? 'wav' : extension === 'mp3' ? 'mp3' : (() => {
      throw new TypeError(`load(${resPath}) is not an AudioStream resource path.`);
    })(),
    loop: false,
    loopOffset: 0,
  };
  const signature = `${spec.format}:${String(spec.loop)}:${String(spec.loopOffset)}`;
  let resources = LOADED_AUDIO_RESOURCES.get(streams);
  if (resources === undefined) {
    resources = new Map();
    LOADED_AUDIO_RESOURCES.set(streams, resources);
  }
  const retained = resources.get(resPath);
  if (retained !== undefined) {
    if (retained.spec !== signature) {
      throw new Error(`AudioStream ${resPath} was loaded with conflicting imported Resource settings.`);
    }
    return retained.stream;
  }
  const options = { buffer, loop: spec.loop, loopOffset: spec.loopOffset };
  const stream = spec.format === 'ogg-vorbis'
    ? createGodotAudioStreamOggVorbis(options)
    : spec.format === 'mp3'
      ? createGodotAudioStreamMp3(options)
      : createGodotAudioStreamWav(options);
  resources.set(resPath, { spec: signature, stream });
  return stream;
}

/** Resolve Godot's CollisionObject RID exclusion to the port's real Rapier body. */
export function excludeBodyOfNode(node: Object3D): ExcludableBody {
  const body = bodyOwningNode(node) as ExcludableBody | undefined;
  if (body === undefined) {
    throw new Error(
      `get_rid(): the node "${node.name}" carries no native Rapier body, so there is nothing to ` +
        'exclude from the ray. Only a scene root that builds its own body is tagged.',
    );
  }
  return body;
}

export type GodotCamera = PerspectiveCamera | OrthographicCamera;

export interface GodotCameraEntry {
  readonly camera: GodotCamera;
  readonly current: boolean;
  readonly viewport: Object3D | undefined;
}

export interface GodotSubViewportCamera {
  readonly viewport: Object3D;
  readonly camera: GodotCamera;
}

interface GodotCameraGroup {
  readonly cameras: readonly GodotCamera[];
  readonly viewport: Object3D | undefined;
  readonly setMainCamera?: (camera: GodotCamera) => void;
  current: GodotCamera;
}

const CAMERA_GROUPS = new WeakMap<GodotCamera, GodotCameraGroup>();
const VIEWPORT_CAMERA_GROUPS = new WeakMap<object, GodotCameraGroup>();
let mainCameraGroup: GodotCameraGroup | undefined;
const PENDING_CAMERA_CURRENT = new WeakMap<GodotCamera, { enabled: boolean; order: number }>();
let cameraCurrentOrder = 0;

/** Bind retained Three cameras to the one current-camera slot of their authored Viewport. */
export function bindGodotCameraEntries(
  entries: readonly GodotCameraEntry[],
  setMainCamera: (camera: GodotCamera) => void,
  mainViewportSize: () => Vector2Like,
): void {
  const byViewport = new Map<Object3D | undefined, GodotCameraEntry[]>();
  for (const entry of entries) {
    const cameras = byViewport.get(entry.viewport) ?? [];
    cameras.push(entry);
    byViewport.set(entry.viewport, cameras);
  }
  for (const [viewport, cameras] of byViewport) {
    for (const entry of cameras) {
      bindGodotCameraViewportSize(
        entry.camera,
        viewport === undefined ? mainViewportSize : () => subViewportOf(viewport).size,
      );
    }
    let current = cameras[0]!.camera;
    for (const entry of cameras) if (entry.current) current = entry.camera;
    const pending = cameras
      .flatMap((entry) => {
        const change = PENDING_CAMERA_CURRENT.get(entry.camera);
        return change === undefined ? [] : [{ camera: entry.camera, ...change }];
      })
      .sort((left, right) => left.order - right.order);
    for (const change of pending) {
      if (change.enabled) current = change.camera;
      else if (current === change.camera) {
        const next = cameras.find((entry) => entry.camera !== change.camera)?.camera;
        if (next === undefined) {
          throw new Error(
            `Camera3D.current=false clears the only camera from its Viewport. The host requires ` +
              `one Three camera and cannot represent Godot's camera-less draw, so translation ` +
              `refuses instead of silently leaving "${change.camera.name}" current.`,
          );
        }
        current = next;
      }
    }
    const group: GodotCameraGroup = {
      cameras: cameras.map((entry) => entry.camera),
      viewport,
      ...(viewport === undefined ? { setMainCamera } : {}),
      current,
    };
    for (const entry of cameras) CAMERA_GROUPS.set(entry.camera, group);
    if (viewport === undefined) {
      mainCameraGroup = group;
      setMainCamera(current);
    } else {
      VIEWPORT_CAMERA_GROUPS.set(viewport, group);
    }
  }
}

/** Viewport.get_camera_3d() returns the retained native current Three camera, or null. */
export function getGodotViewportCamera3D(viewportLike: unknown): GodotCamera | null {
  if (typeof viewportLike !== 'object' || viewportLike === null) {
    throw new TypeError('Viewport.get_camera_3d requires a retained Viewport identity.');
  }
  return VIEWPORT_CAMERA_GROUPS.get(viewportLike)?.current ?? mainCameraGroup?.current ?? null;
}

export function isGodotCameraCurrent(camera: GodotCamera): boolean {
  const group = CAMERA_GROUPS.get(camera);
  if (group !== undefined) return group.current === camera;
  const pending = PENDING_CAMERA_CURRENT.get(camera);
  if (pending !== undefined) return pending.enabled;
  throw new Error(
    `Camera3D.is_current() read "${camera.name}" before its complete Viewport camera set was ` +
      'bound. A pre-bind make_current/current write is carried, but guessing the default winner ' +
      'from an incomplete PackedScene subtree would silently select the wrong camera.',
  );
}

export function setGodotCameraCurrent(camera: GodotCamera, enabled: boolean): void {
  if (typeof enabled !== 'boolean') {
    throw new TypeError(`Camera3D.set_current requires bool; received ${String(enabled)}.`);
  }
  PENDING_CAMERA_CURRENT.set(camera, { enabled, order: ++cameraCurrentOrder });
  const group = CAMERA_GROUPS.get(camera);
  if (group === undefined) return;
  if (enabled) {
    for (const peer of group.cameras) {
      PENDING_CAMERA_CURRENT.set(peer, {
        enabled: peer === camera,
        order: cameraCurrentOrder,
      });
    }
    group.current = camera;
  } else if (group.current === camera) {
    const next = group.cameras.find((candidate) => candidate !== camera);
    if (next === undefined) {
      throw new Error(
        `Camera3D.current=false cannot clear sole camera "${camera.name}": the host requires a ` +
          `Three camera and cannot represent Godot's camera-less Viewport draw.`,
      );
    }
    group.current = next;
    PENDING_CAMERA_CURRENT.set(next, { enabled: true, order: cameraCurrentOrder });
  }
  if (group.viewport === undefined) group.setMainCamera?.(group.current);
}

export function makeGodotCameraCurrent(camera: GodotCamera): void {
  setGodotCameraCurrent(camera, true);
}

function resolveViewportCamera(
  entries: readonly GodotCameraEntry[],
): GodotCamera | undefined {
  const bound = entries[0] === undefined ? undefined : CAMERA_GROUPS.get(entries[0].camera);
  if (bound !== undefined) return bound.current;
  let current: GodotCamera | undefined;
  for (const entry of entries) if (entry.current) current = entry.camera;
  return current ?? entries[0]?.camera;
}

/** Godot's main-viewport ENTER_TREE current-camera rule. */
export function resolveGodotCurrentCamera(
  entries: readonly GodotCameraEntry[],
): GodotCamera | undefined {
  return resolveViewportCamera(
    entries.filter((entry) => entry.viewport === undefined),
  );
}

/** The independently selected current camera of every authored SubViewport. */
export function resolveGodotSubViewportCameras(
  entries: readonly GodotCameraEntry[],
): GodotCamera[] {
  const byViewport = new Map<Object3D, GodotCameraEntry[]>();
  for (const entry of entries) {
    if (entry.viewport === undefined) continue;
    const cameras = byViewport.get(entry.viewport) ?? [];
    cameras.push(entry);
    byViewport.set(entry.viewport, cameras);
  }
  return [...byViewport.values()].flatMap((cameras) => {
    const current = resolveViewportCamera(cameras);
    return current === undefined ? [] : [current];
  });
}

export function resolveGodotSubViewports(
  entries: readonly GodotCameraEntry[],
): GodotSubViewportCamera[] {
  const byViewport = new Map<Object3D, GodotCameraEntry[]>();
  for (const entry of entries) {
    if (entry.viewport === undefined) continue;
    const cameras = byViewport.get(entry.viewport) ?? [];
    cameras.push(entry);
    byViewport.set(entry.viewport, cameras);
  }
  return [...byViewport].flatMap(([viewport, cameras]) => {
    const camera = resolveViewportCamera(cameras);
    return camera === undefined ? [] : [{ viewport, camera }];
  });
}

/** Reduce one translated value to a bounded, wire-safe debug value. */
export function godotDebugValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === 'number' || type === 'string' || type === 'boolean')
    return value;
  if (type !== 'object') return type;
  if (depth >= 2) return Array.isArray(value) ? `[${value.length}]` : 'object';
  if (Array.isArray(value))
    return value.map((one) => godotDebugValue(one, depth + 1));
  const record = value as Record<string, unknown>;
  const proto = Object.getPrototypeOf(record) as object | null;
  if (proto === Object.prototype || proto === null) {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(record))
      out[key] = godotDebugValue(held, depth + 1);
    return out;
  }
  return record.constructor?.name ?? 'object';
}

/** Read a native three/Pixi node's world position structurally. */
export function godotDebugPosition(
  node: unknown,
): Record<string, number> | null {
  const three = node as {
    updateWorldMatrix?: (parents: boolean, children: boolean) => void;
    matrixWorld?: { elements: ArrayLike<number> };
  };
  if (
    typeof three.updateWorldMatrix === 'function' &&
    three.matrixWorld !== undefined
  ) {
    three.updateWorldMatrix(true, false);
    const e = three.matrixWorld.elements;
    return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
  }
  const pixi = node as { getGlobalPosition?: () => { x: number; y: number } };
  if (typeof pixi.getGlobalPosition === 'function') {
    const p = pixi.getGlobalPosition();
    return { x: p.x, y: p.y };
  }
  return null;
}

/** Read a native three/Pixi node's local rotation structurally. */
export function godotDebugRotation(
  node: unknown,
): Record<string, number> | number | null {
  const three = node as {
    rotation?: { x?: number; y?: number; z?: number } | number;
  };
  if (three.rotation !== null && typeof three.rotation === 'object') {
    const r = three.rotation;
    if (
      typeof r.x === 'number' &&
      typeof r.y === 'number' &&
      typeof r.z === 'number'
    ) {
      return { x: r.x, y: r.y, z: r.z };
    }
    return null;
  }
  if (typeof three.rotation === 'number') return three.rotation;
  return null;
}

/** Read one preloaded resource, loudly preserving Godot's non-null load contract. */
export function resourceAt<T>(
  resources: ReadonlyMap<string, T>,
  path: string,
  kind: string,
): T {
  const resource = resources.get(path);
  if (resource === undefined) {
    throw new Error(
      `the world did not preload ${kind} "${path}". Every emitted lookup is recorded into the ` +
        'world preload list; a miss means those two generated facts drifted.',
    );
  }
  return resource;
}

export function textureAt<T>(
  textures: ReadonlyMap<string, T>,
  path: string,
): T {
  return resourceAt(textures, path, 'texture');
}

export function fontAt(
  fonts: ReadonlyMap<string, string>,
  path: string,
): string {
  return resourceAt(fonts, path, 'font');
}

export function audioAt<T>(audio: ReadonlyMap<string, T>, path: string): T {
  return resourceAt(audio, path, 'audio stream');
}

export interface SpawnEntry<T> {
  readonly id: number;
  readonly value: T;
  readonly authoredTreeParent?: object;
}

/** Runtime instances of one translated scene, rendered by its native React component. */
export class SpawnList<T> {
  private entries: readonly SpawnEntry<T>[] = [];
  private next = 0;

  onChange: (() => void) | undefined;
  readonly snapshot = (): readonly SpawnEntry<T>[] => this.entries;

  add(value: T, authoredTreeParent?: object): void {
    this.entries = [...this.entries, {
      id: this.next,
      value,
      ...(authoredTreeParent === undefined ? {} : { authoredTreeParent }),
    }];
    this.next += 1;
    this.onChange?.();
  }

  remove(value: unknown): void {
    const kept = this.entries.filter(
      (entry) => (entry.value as unknown) !== value,
    );
    if (kept.length === this.entries.length) return;
    this.entries = kept;
    this.onChange?.();
  }
}

/** Restore the exact live Pixi parent after @pixi/react adopts a spawned scene root. */
export function restoreRuntimeCanvasParent(parent: object | undefined, child: Container): void {
  if (parent === undefined) return;
  if (!(parent instanceof Container)) {
    throw new TypeError('godot-compat: a runtime canvas scene parent must retain PIXI.Container identity.');
  }
  if (child.parent === parent) return;
  parent.addChild(child);
}

/** Native JSX refs belonging to one translated scene component. */
export class SceneRefs<T extends object> {
  readonly draft: Partial<T> = {};
  private readonly setters = new Map<keyof T, (value: never) => void>();
  private waiting:
    { readonly missing: Set<keyof T>; readonly then: () => void } | undefined;

  set<K extends keyof T>(key: K): (value: T[K] | null) => void {
    const cached = this.setters.get(key);
    if (cached !== undefined) return cached as (value: T[K] | null) => void;
    const setter = (value: T[K] | null): void => {
      if (value === null) return;
      this.draft[key] = value;
      const waiting = this.waiting;
      if (waiting === undefined) return;
      waiting.missing.delete(key);
      if (waiting.missing.size > 0) return;
      this.waiting = undefined;
      waiting.then();
    };
    this.setters.set(key, setter as (value: never) => void);
    return setter;
  }

  whenComplete(keys: readonly (keyof T)[], then: () => void): () => void {
    const missing = new Set(
      keys.filter((key) => this.draft[key] === undefined),
    );
    if (missing.size === 0) {
      then();
      return () => {};
    }
    this.waiting = { missing, then };
    return () => {
      this.waiting = undefined;
    };
  }

  resolve(): T {
    return this.draft as T;
  }
}
