/** Retained Pixi implementations for Godot 2D canvas grouping, copies and remote transforms. */

import { Container, Filter, GlProgram, Matrix, Point, RenderTexture, Sprite } from 'pixi.js';
import { setNodePhysicsProcess, setNodeProcess, setNodeProcessMode } from './node-process';
import { getCanvasItemShaderFilter } from './canvas-item-material';
import { clearGodotPixiScreenTexture, setGodotPixiScreenTexture } from './shader-material';
import { updateCanvasParallaxRepeats } from './canvas-camera-2d';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { registerGodotObjectIdentity } from './object';
import { bindGodotCanvasNode2DApi, getNode, registerCanvasNodeRelease } from './node';

export interface CanvasRect2 { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface CanvasSize2 { readonly width: number; readonly height: number }

const FILTER_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;
const COPY_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
void main(void) { finalColor = texture(uTexture, vTextureCoord); }`;

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires finite float.`);
  return value;
}
function nonnegative(value: unknown, member: string): number {
  const parsed = finite(value, member);
  if (parsed < 0) throw new RangeError(`${member} requires a non-negative float.`);
  return parsed;
}
function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}
function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires int ${minimum}..${maximum}.`);
  }
  return value;
}
function rect(value: unknown, member: string): CanvasRect2 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Rect2.`);
  const candidate = value as Partial<CanvasRect2>;
  return {
    x: finite(candidate.x, `${member}.position.x`),
    y: finite(candidate.y, `${member}.position.y`),
    width: finite(candidate.width, `${member}.size.x`),
    height: finite(candidate.height, `${member}.size.y`),
  };
}
function install<T>(target: object, name: string, read: () => T, write: (value: T) => void): void {
  Object.defineProperty(target, name, { configurable: true, enumerable: true, get: read, set: write });
}

export interface CanvasGroupOptions {
  readonly fitMargin?: number;
  readonly clearMargin?: number;
  readonly useMipmaps?: boolean;
}
export interface CanvasGroupApi {
  fit_margin: number;
  clear_margin: number;
  use_mipmaps: boolean;
  set_fit_margin(value: number): void;
  get_fit_margin(): number;
  set_clear_margin(value: number): void;
  get_clear_margin(): number;
  set_use_mipmaps(value: boolean): void;
  is_using_mipmaps(): boolean;
}
export type GodotCanvasGroup = Container & CanvasGroupApi;
interface CanvasGroupState { readonly filter: Filter; fit: number; clear: number; mipmaps: boolean; warnedMipmaps: boolean }
const CANVAS_GROUPS = new WeakMap<GodotCanvasGroup, CanvasGroupState>();

function updateCanvasGroupFilter(state: CanvasGroupState): void {
  // A Pixi filter is a native offscreen render group: children alpha-composite into its target,
  // then the retained Container's own modulate/blend is applied exactly once to that texture.
  // Godot first grows the group fit bounds, then grows the clear rectangle around that fitted
  // result. The two margins are cumulative rather than competing bounds.
  state.filter.padding = Math.max(0, state.fit) + Math.max(0, state.clear);
  // Pixi's public Filter API does not expose the mip policy of its transient render texture.
  // Antialiasing is deliberately not substituted: it changes edge sampling, not minification.
  if (state.mipmaps && !state.warnedMipmaps) {
    state.warnedMipmaps = true;
    console.warn('godot-compat: CanvasGroup.use_mipmaps is retained, but Pixi does not expose mipmaps for transient filter textures; group compositing remains active without mip minification.');
  }
}

export function bindCanvasGroup(node: Container, options: CanvasGroupOptions = {}): GodotCanvasGroup {
  releaseCanvasGroup(node as GodotCanvasGroup);
  const group = node as GodotCanvasGroup;
  const state: CanvasGroupState = {
    filter: new Filter({ glProgram: GlProgram.from({ vertex: FILTER_VERTEX, fragment: COPY_FRAGMENT }) }),
    fit: nonnegative(options.fitMargin ?? 10, 'CanvasGroup.fit_margin'),
    clear: nonnegative(options.clearMargin ?? 10, 'CanvasGroup.clear_margin'),
    mipmaps: options.useMipmaps ?? false,
    warnedMipmaps: false,
  };
  group.filters = [...(group.filters ?? []), state.filter];
  CANVAS_GROUPS.set(group, state);
  install(group, 'fit_margin', () => state.fit, (value) => { state.fit = nonnegative(value, 'CanvasGroup.fit_margin'); updateCanvasGroupFilter(state); });
  install(group, 'clear_margin', () => state.clear, (value) => { state.clear = nonnegative(value, 'CanvasGroup.clear_margin'); updateCanvasGroupFilter(state); });
  install(group, 'use_mipmaps', () => state.mipmaps, (value) => { state.mipmaps = boolean(value, 'CanvasGroup.use_mipmaps'); updateCanvasGroupFilter(state); });
  Object.assign(group, {
    set_fit_margin: (value: number) => { group.fit_margin = value; }, get_fit_margin: () => group.fit_margin,
    set_clear_margin: (value: number) => { group.clear_margin = value; }, get_clear_margin: () => group.clear_margin,
    set_use_mipmaps: (value: boolean) => { group.use_mipmaps = value; }, is_using_mipmaps: () => group.use_mipmaps,
  });
  updateCanvasGroupFilter(state);
  return group;
}

/** Runtime CanvasGroup.new() over the retained Pixi offscreen compositing group. */
export function createGodotCanvasGroup(options: CanvasGroupOptions = {}): GodotCanvasGroup {
  const group = bindCanvasGroup(bindGodotCanvasNode2DApi(new Container()), options);
  registerGodotObjectIdentity(group, 'CanvasGroup');
  registerCanvasNodeRelease(group, () => releaseCanvasGroup(group));
  return group;
}

export function releaseCanvasGroup(group: GodotCanvasGroup): void {
  const state = CANVAS_GROUPS.get(group);
  if (state === undefined) return;
  group.filters = (group.filters ?? []).filter((filter) => filter !== state.filter);
  state.filter.destroy();
  CANVAS_GROUPS.delete(group);
}

export const BACK_BUFFER_COPY_MODE = Object.freeze({ DISABLED: 0, RECT: 1, VIEWPORT: 2 });
export interface BackBufferCopyOptions { readonly copyMode?: number; readonly rect?: CanvasRect2 }
export interface BackBufferCopyApi {
  copy_mode: number;
  rect: CanvasRect2;
  readonly back_buffer_texture: RenderTexture | null;
  set_copy_mode(value: number): void;
  get_copy_mode(): number;
  set_rect(value: CanvasRect2): void;
  get_rect(): CanvasRect2;
}
export type GodotBackBufferCopy = Container & BackBufferCopyApi;
interface BackBufferState {
  readonly node: GodotBackBufferCopy;
  readonly root: Container;
  mode: number;
  rect: CanvasRect2;
  texture: RenderTexture | null;
  scratch: RenderTexture | null;
  readonly consumers: Set<Filter>;
}
const BACK_BUFFERS = new WeakMap<GodotBackBufferCopy, BackBufferState>();

export interface CanvasEffectsRenderer {
  render(options: { readonly container: Container; readonly target: RenderTexture; readonly clear: boolean; readonly transform?: Matrix }): void;
}

export function bindBackBufferCopy(node: Container, root: Container, options: BackBufferCopyOptions = {}): GodotBackBufferCopy {
  releaseBackBufferCopy(node as GodotBackBufferCopy);
  const copy = node as GodotBackBufferCopy;
  const state: BackBufferState = {
    node: copy,
    root,
    mode: integer(options.copyMode ?? BACK_BUFFER_COPY_MODE.RECT, 'BackBufferCopy.copy_mode', 0, 2),
    rect: rect(options.rect ?? { x: -100, y: -100, width: 200, height: 200 }, 'BackBufferCopy.rect'),
    texture: null,
    scratch: null,
    consumers: new Set(),
  };
  BACK_BUFFERS.set(copy, state);
  rootEffects(root).backBuffers.add(copy);
  install(copy, 'copy_mode', () => state.mode, (value) => { state.mode = integer(value, 'BackBufferCopy.copy_mode', 0, 2); });
  install(copy, 'rect', () => ({ ...state.rect }), (value) => { state.rect = rect(value, 'BackBufferCopy.rect'); });
  Object.defineProperty(copy, 'back_buffer_texture', { configurable: true, enumerable: false, get: () => state.texture });
  Object.assign(copy, {
    set_copy_mode: (value: number) => { copy.copy_mode = value; }, get_copy_mode: () => copy.copy_mode,
    set_rect: (value: CanvasRect2) => { copy.rect = value; }, get_rect: () => copy.rect,
  });
  return copy;
}

/** Runtime BackBufferCopy.new() sharing the host's retained screen-texture capture pipeline. */
export function createGodotBackBufferCopy(root: Container, options: BackBufferCopyOptions = {}): GodotBackBufferCopy {
  const copy = bindBackBufferCopy(bindGodotCanvasNode2DApi(new Container()), root, options);
  registerGodotObjectIdentity(copy, 'BackBufferCopy');
  registerCanvasNodeRelease(copy, () => releaseBackBufferCopy(copy));
  return copy;
}

export function releaseBackBufferCopy(copy: GodotBackBufferCopy): void {
  const state = BACK_BUFFERS.get(copy);
  if (state === undefined) return;
  rootEffects(state.root).backBuffers.delete(copy);
  state.texture?.destroy(true);
  state.scratch?.destroy(true);
  for (const consumer of state.consumers) clearGodotPixiScreenTexture(consumer);
  BACK_BUFFERS.delete(copy);
}

export interface RemoteTransform2DOptions {
  readonly remotePath: string;
  readonly useGlobalCoordinates?: boolean;
  readonly updatePosition?: boolean;
  readonly updateRotation?: boolean;
  readonly updateScale?: boolean;
  readonly resolve: (path: string) => Container | null;
}
export interface RemoteTransform2DApi {
  remote_path: string;
  use_global_coordinates: boolean;
  update_position: boolean;
  update_rotation: boolean;
  update_scale: boolean;
  set_remote_node(path: string): void;
  get_remote_node(): string;
  force_update_cache(): void;
  set_use_global_coordinates(value: boolean): void;
  get_use_global_coordinates(): boolean;
  set_update_position(value: boolean): void;
  get_update_position(): boolean;
  set_update_rotation(value: boolean): void;
  get_update_rotation(): boolean;
  set_update_scale(value: boolean): void;
  get_update_scale(): boolean;
}
export type GodotRemoteTransform2D = Container & RemoteTransform2DApi;
interface RemoteTransformState {
  readonly node: GodotRemoteTransform2D;
  readonly root: Container;
  readonly resolve: (path: string) => Container | null;
  path: string;
  useGlobal: boolean;
  position: boolean;
  rotation: boolean;
  scale: boolean;
  target: Container | null;
  refresh(): void;
}
const REMOTE_TRANSFORMS = new WeakMap<GodotRemoteTransform2D, RemoteTransformState>();

function nodePath(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('RemoteTransform2D.remote_path requires NodePath/string.');
  return value;
}

export function bindRemoteTransform2D(node: Container, root: Container, options: RemoteTransform2DOptions): GodotRemoteTransform2D {
  releaseRemoteTransform2D(node as GodotRemoteTransform2D);
  const remote = node as GodotRemoteTransform2D;
  const state: RemoteTransformState = {
    node: remote, root, resolve: options.resolve, path: nodePath(options.remotePath),
    useGlobal: options.useGlobalCoordinates ?? true,
    position: options.updatePosition ?? true,
    rotation: options.updateRotation ?? true,
    scale: options.updateScale ?? true,
    target: null,
    refresh: () => undefined,
  };
  REMOTE_TRANSFORMS.set(remote, state);
  rootEffects(root).remoteTransforms.add(remote);
  const refresh = (): void => {
    state.target = null;
    if (state.path === '') return;
    const candidate = state.resolve(state.path);
    if (candidate === null) return;
    const contains = (ancestor: Container, descendant: Container): boolean => {
      for (let current: Container | null = descendant; current !== null; current = current.parent) {
        if (current === ancestor) return true;
      }
      return false;
    };
    if (candidate === remote || contains(remote, candidate) || contains(candidate, remote)) {
      throw new Error('godot-compat: RemoteTransform2D remote_path cannot target itself, an ancestor, or a descendant.');
    }
    state.target = candidate;
  };
  state.refresh = refresh;
  install(remote, 'remote_path', () => state.path, (value) => { state.path = nodePath(value); refresh(); });
  install(remote, 'use_global_coordinates', () => state.useGlobal, (value) => { state.useGlobal = boolean(value, 'RemoteTransform2D.use_global_coordinates'); });
  install(remote, 'update_position', () => state.position, (value) => { state.position = boolean(value, 'RemoteTransform2D.update_position'); });
  install(remote, 'update_rotation', () => state.rotation, (value) => { state.rotation = boolean(value, 'RemoteTransform2D.update_rotation'); });
  install(remote, 'update_scale', () => state.scale, (value) => { state.scale = boolean(value, 'RemoteTransform2D.update_scale'); });
  Object.assign(remote, {
    set_remote_node: (value: string) => { remote.remote_path = value; }, get_remote_node: () => remote.remote_path,
    force_update_cache: refresh,
    set_use_global_coordinates: (value: boolean) => { remote.use_global_coordinates = value; }, get_use_global_coordinates: () => remote.use_global_coordinates,
    set_update_position: (value: boolean) => { remote.update_position = value; }, get_update_position: () => remote.update_position,
    set_update_rotation: (value: boolean) => { remote.update_rotation = value; }, get_update_rotation: () => remote.update_rotation,
    set_update_scale: (value: boolean) => { remote.update_scale = value; }, get_update_scale: () => remote.update_scale,
  });
  refresh();
  return remote;
}

/** Runtime RemoteTransform2D.new() resolving NodePaths against the retained canvas scene tree. */
export function createGodotRemoteTransform2D(root: Container): GodotRemoteTransform2D {
  const remote = bindRemoteTransform2D(bindGodotCanvasNode2DApi(new Container()), root, {
    remotePath: '',
    resolve(path: string): Container | null {
      try { return getNode(root, path); } catch { return null; }
    },
  });
  registerGodotObjectIdentity(remote, 'RemoteTransform2D');
  registerCanvasNodeRelease(remote, () => releaseRemoteTransform2D(remote));
  return remote;
}

export function releaseRemoteTransform2D(remote: GodotRemoteTransform2D): void {
  const state = REMOTE_TRANSFORMS.get(remote);
  if (state === undefined) return;
  rootEffects(state.root).remoteTransforms.delete(remote);
  REMOTE_TRANSFORMS.delete(remote);
}

function updateRemoteTransform(state: RemoteTransformState): void {
  if (state.target === null) state.refresh();
  const target = state.target;
  if (target === null || target === state.node) return;
  if (!state.useGlobal) {
    if (state.position) target.position.copyFrom(state.node.position);
    if (state.rotation) target.rotation = state.node.rotation;
    if (state.scale) target.scale.copyFrom(state.node.scale);
    return;
  }
  // Pixi's world matrix is the retained Node2D affine transform. Convert it through the target
  // parent's full inverse before decomposition; this preserves reflection, skew and rotated or
  // non-uniformly-scaled parents, unlike component-wise world rotation/scale arithmetic.
  const parent = target.parent ?? state.root;
  const desiredLocal = parent.worldTransform.clone().invert().append(state.node.worldTransform);
  const oldPosition = target.position.clone();
  const oldRotation = target.rotation;
  const oldScale = target.scale.clone();
  const oldSkew = target.skew.clone();
  target.setFromMatrix(desiredLocal);
  if (!state.position) target.position.copyFrom(oldPosition);
  if (!state.rotation) {
    target.rotation = oldRotation;
    target.skew.copyFrom(oldSkew);
  }
  if (!state.scale) target.scale.copyFrom(oldScale);
}

interface RootEffects {
  readonly backBuffers: Set<GodotBackBufferCopy>;
  readonly remoteTransforms: Set<GodotRemoteTransform2D>;
  readonly visibilityEnablers: Set<GodotVisibleOnScreenEnabler2D>;
}
const ROOT_EFFECTS = new WeakMap<Container, RootEffects>();
function rootEffects(root: Container): RootEffects {
  let state = ROOT_EFFECTS.get(root);
  if (state === undefined) { state = { backBuffers: new Set(), remoteTransforms: new Set(), visibilityEnablers: new Set() }; ROOT_EFFECTS.set(root, state); }
  return state;
}

export interface VisibilityEnabler2DOptions {
  readonly legacy?: boolean;
  readonly notifierOnly?: boolean;
  readonly rect?: CanvasRect2;
  readonly enableMode?: number;
  readonly enableNodePath?: string;
  readonly processParent?: boolean;
  readonly physicsProcessParent?: boolean;
  readonly pauseAnimations?: boolean;
  readonly pauseAnimatedSprites?: boolean;
  readonly pauseParticles?: boolean;
  readonly freezeBodies?: boolean;
  readonly resolve: (path: string) => object | null;
}

export interface VisibleOnScreenEnabler2DApi {
  rect: CanvasRect2;
  readonly screen_entered: GodotSignal<[]>;
  readonly screen_exited: GodotSignal<[]>;
  enable_mode: number;
  enable_node_path: string;
  process_parent: boolean;
  physics_process_parent: boolean;
  pause_animations: boolean;
  pause_animated_sprites: boolean;
  pause_particles: boolean;
  freeze_bodies: boolean;
  set_enable_mode(value: number): void;
  get_enable_mode(): number;
  set_enable_node_path(value: string): void;
  get_enable_node_path(): string;
  set_enabler(which: number, enabled: boolean): void;
  is_enabler_enabled(which: number): boolean;
  set_rect(value: CanvasRect2): void;
  get_rect(): CanvasRect2;
  is_on_screen(): boolean;
}
export type GodotVisibleOnScreenEnabler2D = Container & VisibleOnScreenEnabler2DApi;
export type GodotVisibleOnScreenNotifier2D = Container & Pick<VisibleOnScreenEnabler2DApi, 'rect' | 'screen_entered' | 'screen_exited' | 'set_rect' | 'get_rect' | 'is_on_screen'>;
interface VisibilityEnablerState {
  readonly node: GodotVisibleOnScreenEnabler2D;
  readonly root: Container;
  readonly resolve: (path: string) => object | null;
  readonly legacy: boolean;
  readonly notifierOnly: boolean;
  readonly screenEntered: SignalHandle<[]>;
  readonly screenExited: SignalHandle<[]>;
  rect: CanvasRect2;
  mode: number;
  path: string;
  process: boolean;
  physics: boolean;
  animations: boolean;
  animatedSprites: boolean;
  particles: boolean;
  bodies: boolean;
  onScreen: boolean | null;
}
const VISIBILITY_ENABLERS = new WeakMap<GodotVisibleOnScreenEnabler2D, VisibilityEnablerState>();

type LegacyVisibilityCategory = 'process' | 'physics' | 'animations' | 'animatedSprites' | 'particles' | 'bodies';

function setLegacyVisibilityCategory(state: VisibilityEnablerState, category: LegacyVisibilityCategory, enabled: boolean): void {
  const target = state.legacy ? state.node.parent : state.resolve(state.path);
  if (target === null) return;
  if (category === 'process') { setNodeProcess(target, enabled); return; }
  if (category === 'physics') { setNodePhysicsProcess(target, enabled); return; }
  const visit = (candidate: object): void => {
    const item = candidate as {
      children?: readonly object[];
      set_active?: (value: boolean) => void;
      playing?: boolean;
      emitting?: boolean;
      sleeping?: boolean;
    };
    if (category === 'animations' && typeof item.set_active === 'function') item.set_active(enabled);
    if (category === 'animatedSprites' && typeof item.playing === 'boolean') item.playing = enabled;
    if (category === 'particles' && typeof item.emitting === 'boolean') item.emitting = enabled;
    if (category === 'bodies' && typeof item.sleeping === 'boolean') item.sleeping = !enabled;
    for (const child of item.children ?? []) visit(child);
  };
  visit(target);
}

function setVisibilityTargetEnabled(state: VisibilityEnablerState, enabled: boolean): void {
  if (state.notifierOnly || (!state.legacy && state.path === '')) return;
  if (!state.legacy) {
    const target = state.resolve(state.path);
    if (target === null) return;
    const processMode = !enabled ? 4 : state.mode === 0 ? 0 : state.mode === 1 ? 3 : 2;
    setNodeProcessMode(target, processMode);
    return;
  }
  const categories: readonly LegacyVisibilityCategory[] = ['process', 'physics', 'animations', 'animatedSprites', 'particles', 'bodies'];
  for (const category of categories) if (state[category]) setLegacyVisibilityCategory(state, category, enabled);
}

export function bindVisibleOnScreenEnabler2D(node: Container, root: Container, options: VisibilityEnabler2DOptions): GodotVisibleOnScreenEnabler2D {
  releaseVisibleOnScreenEnabler2D(node as GodotVisibleOnScreenEnabler2D);
  const enabler = node as GodotVisibleOnScreenEnabler2D;
  const state: VisibilityEnablerState = {
    node: enabler,
    root,
    resolve: options.resolve,
    legacy: options.legacy ?? false,
    notifierOnly: options.notifierOnly ?? false,
    screenEntered: createSignal<[]>(),
    screenExited: createSignal<[]>(),
    rect: rect(options.rect ?? { x: -10, y: -10, width: 20, height: 20 }, 'VisibleOnScreenEnabler2D.rect'),
    mode: integer(options.enableMode ?? 0, 'VisibleOnScreenEnabler2D.enable_mode', 0, 2),
    path: nodePath(options.enableNodePath ?? ''),
    process: options.processParent ?? false,
    physics: options.physicsProcessParent ?? false,
    animations: options.pauseAnimations ?? true,
    animatedSprites: options.pauseAnimatedSprites ?? true,
    particles: options.pauseParticles ?? true,
    bodies: options.freezeBodies ?? true,
    onScreen: null,
  };
  VISIBILITY_ENABLERS.set(enabler, state);
  rootEffects(root).visibilityEnablers.add(enabler);
  install(enabler, 'rect', () => ({ ...state.rect }), (value) => { state.rect = rect(value, 'VisibleOnScreenEnabler2D.rect'); });
  Object.defineProperty(enabler, 'screen_entered', { configurable: true, enumerable: true, value: state.screenEntered.signal });
  Object.defineProperty(enabler, 'screen_exited', { configurable: true, enumerable: true, value: state.screenExited.signal });
  const reapply = (): void => { if (state.onScreen !== null) setVisibilityTargetEnabled(state, state.onScreen); };
  const setLegacyFlag = (category: LegacyVisibilityCategory, value: unknown, member: string): void => {
    const enabled = boolean(value, member);
    const wasEnabled = state[category];
    if (state.legacy && state.onScreen === false && wasEnabled && !enabled) {
      // `_node_removed`/flag removal releases only the category this enabler formerly owned.
      setLegacyVisibilityCategory(state, category, true);
    }
    state[category] = enabled;
    if (state.legacy && state.onScreen !== null && enabled) setLegacyVisibilityCategory(state, category, state.onScreen);
  };
  install(enabler, 'enable_mode', () => state.mode, (value) => { state.mode = integer(value, 'VisibleOnScreenEnabler2D.enable_mode', 0, 2); reapply(); });
  install(enabler, 'enable_node_path', () => state.path, (value) => { state.path = nodePath(value); reapply(); });
  install(enabler, 'process_parent', () => state.process, (value) => { setLegacyFlag('process', value, 'VisibilityEnabler2D.process_parent'); });
  install(enabler, 'physics_process_parent', () => state.physics, (value) => { setLegacyFlag('physics', value, 'VisibilityEnabler2D.physics_process_parent'); });
  install(enabler, 'pause_animations', () => state.animations, (value) => { setLegacyFlag('animations', value, 'VisibilityEnabler2D.pause_animations'); });
  install(enabler, 'pause_animated_sprites', () => state.animatedSprites, (value) => { setLegacyFlag('animatedSprites', value, 'VisibilityEnabler2D.pause_animated_sprites'); });
  install(enabler, 'pause_particles', () => state.particles, (value) => { setLegacyFlag('particles', value, 'VisibilityEnabler2D.pause_particles'); });
  install(enabler, 'freeze_bodies', () => state.bodies, (value) => { setLegacyFlag('bodies', value, 'VisibilityEnabler2D.freeze_bodies'); });
  // Pinned 3.6 Enabler enum: animations, bodies, particles, parent process,
  // parent physics process, animated sprites.
  const legacy = [
    () => state.animations,
    () => state.bodies,
    () => state.particles,
    () => state.process,
    () => state.physics,
    () => state.animatedSprites,
  ];
  Object.assign(enabler, {
    set_enable_mode: (value: number) => { enabler.enable_mode = value; }, get_enable_mode: () => enabler.enable_mode,
    set_enable_node_path: (value: string) => { enabler.enable_node_path = value; }, get_enable_node_path: () => enabler.enable_node_path,
    set_enabler: (which: number, enabled: boolean) => {
      const index = integer(which, 'VisibilityEnabler2D.set_enabler', 0, legacy.length - 1);
      const names = ['pause_animations', 'freeze_bodies', 'pause_particles', 'process_parent', 'physics_process_parent', 'pause_animated_sprites'] as const;
      enabler[names[index]!] = boolean(enabled, 'VisibilityEnabler2D.set_enabler.enabled');
    },
    is_enabler_enabled: (which: number) => legacy[integer(which, 'VisibilityEnabler2D.is_enabler_enabled', 0, legacy.length - 1)]!(),
    set_rect: (value: CanvasRect2) => { enabler.rect = value; },
    get_rect: () => enabler.rect,
    is_on_screen: () => state.onScreen === true,
  });
  return enabler;
}

export function bindVisibleOnScreenNotifier2D(node: Container, root: Container, rectValue?: CanvasRect2): GodotVisibleOnScreenNotifier2D {
  return bindVisibleOnScreenEnabler2D(node, root, {
    notifierOnly: true,
    ...(rectValue === undefined ? {} : { rect: rectValue }),
    resolve: () => null,
  });
}

export function createGodotVisibleOnScreenNotifier2D(root: Container): GodotVisibleOnScreenNotifier2D {
  const notifier = bindVisibleOnScreenNotifier2D(new Container(), root);
  registerGodotObjectIdentity(notifier, 'VisibleOnScreenNotifier2D');
  return notifier;
}

/** Runtime VisibleOnScreenEnabler2D.new() resolving its enable target inside the canvas tree. */
export function createGodotVisibleOnScreenEnabler2D(root: Container): GodotVisibleOnScreenEnabler2D {
  const enabler = bindVisibleOnScreenEnabler2D(new Container(), root, {
    enableNodePath: '',
    resolve(path: string): object | null {
      try { return getNode(root, path); } catch { return null; }
    },
  });
  registerGodotObjectIdentity(enabler, 'VisibleOnScreenEnabler2D');
  return enabler;
}

export function releaseVisibleOnScreenEnabler2D(enabler: GodotVisibleOnScreenEnabler2D): void {
  const state = VISIBILITY_ENABLERS.get(enabler);
  if (state === undefined) return;
  rootEffects(state.root).visibilityEnablers.delete(enabler);
  if (state.legacy && state.onScreen === false) setVisibilityTargetEnabled(state, true);
  VISIBILITY_ENABLERS.delete(enabler);
}

export function releaseVisibleOnScreenNotifier2D(notifier: GodotVisibleOnScreenNotifier2D): void {
  releaseVisibleOnScreenEnabler2D(notifier as GodotVisibleOnScreenEnabler2D);
}

function updateVisibilityEnabler(state: VisibilityEnablerState, viewport: CanvasSize2): void {
  const corners = [
    state.node.toGlobal(new Point(state.rect.x, state.rect.y)),
    state.node.toGlobal(new Point(state.rect.x + state.rect.width, state.rect.y)),
    state.node.toGlobal(new Point(state.rect.x, state.rect.y + state.rect.height)),
    state.node.toGlobal(new Point(state.rect.x + state.rect.width, state.rect.y + state.rect.height)),
  ];
  const left = Math.min(...corners.map((point) => point.x));
  const right = Math.max(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const bottom = Math.max(...corners.map((point) => point.y));
  const onScreen = right >= 0 && left <= viewport.width && bottom >= 0 && top <= viewport.height;
  if (state.onScreen === onScreen) return;
  const prior = state.onScreen;
  state.onScreen = onScreen;
  if (onScreen || prior !== null) (onScreen ? state.screenEntered : state.screenExited).emit();
  setVisibilityTargetEnabled(state, onScreen);
}

function captureBackBuffer(state: BackBufferState, renderer: CanvasEffectsRenderer, viewport: CanvasSize2): void {
  if (state.mode === BACK_BUFFER_COPY_MODE.DISABLED) return;
  const requested = state.mode === BACK_BUFFER_COPY_MODE.VIEWPORT
    ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
    : state.rect;
  const capture = {
    x: Math.max(0, requested.x),
    y: Math.max(0, requested.y),
    width: Math.max(0, Math.min(viewport.width, requested.x + requested.width) - Math.max(0, requested.x)),
    height: Math.max(0, Math.min(viewport.height, requested.y + requested.height) - Math.max(0, requested.y)),
  };
  if (capture.width <= 0 || capture.height <= 0) return;
  // SCREEN_UV is always normalized against the complete render target. A rect copy updates that
  // subregion in-place; it never creates a rect-sized texture with a different UV domain.
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (state.texture === null || state.texture.width !== width || state.texture.height !== height) {
    state.texture?.destroy(true);
    state.texture = RenderTexture.create({ width, height, resolution: 1 });
  }
  // BackBufferCopy snapshots only canvas commands issued before this node. Render the retained
  // root synchronously while suppressing the copy node and every later item in depth-first Pixi
  // draw order, then restore the native renderable flags before the actual frame render.
  const ordered: Container[] = [];
  const walk = (container: Container): void => {
    if (container.sortableChildren) container.sortChildren();
    ordered.push(container);
    for (const child of container.children) if (child instanceof Container) walk(child);
  };
  walk(state.root);
  const boundary = ordered.indexOf(state.node);
  if (boundary < 0) throw new Error('godot-compat: BackBufferCopy must remain inside its bound canvas root.');
  const restored: Array<readonly [Container, boolean]> = [];
  for (let index = boundary; index < ordered.length; index += 1) {
    const item = ordered[index]!;
    restored.push([item, item.renderable]);
    item.renderable = false;
  }
  try {
    if (state.mode === BACK_BUFFER_COPY_MODE.VIEWPORT) {
      renderer.render({ container: state.root, target: state.texture, clear: true });
    } else {
      const scratchWidth = Math.ceil(capture.width);
      const scratchHeight = Math.ceil(capture.height);
      if (state.scratch === null || state.scratch.width !== scratchWidth || state.scratch.height !== scratchHeight) {
        state.scratch?.destroy(true);
        state.scratch = RenderTexture.create({ width: scratchWidth, height: scratchHeight, resolution: 1 });
      }
      renderer.render({
        container: state.root,
        target: state.scratch,
        clear: true,
        transform: new Matrix().translate(-capture.x, -capture.y),
      });
      const patch = new Sprite({ texture: state.scratch, x: capture.x, y: capture.y });
      renderer.render({ container: patch, target: state.texture, clear: false });
      patch.destroy();
    }
  } finally {
    for (const [item, renderable] of restored) item.renderable = renderable;
  }
  // Godot 4 screen samplers read the most recent BackBufferCopy preceding their CanvasItem.
  // Assign only to later draw-order shader consumers; a subsequent copy overwrites them again.
  for (let index = boundary + 1; index < ordered.length; index += 1) {
    const filter = getCanvasItemShaderFilter(ordered[index]!);
    if (filter !== null) {
      setGodotPixiScreenTexture(filter, state.texture);
      state.consumers.add(filter);
    }
  }
}

/** Host-owned pre-render update; compat owns state, never a scheduler. */
export function updateCanvasEffects(root: Container, renderer: CanvasEffectsRenderer, viewport: CanvasSize2): void {
  updateCanvasParallaxRepeats(root, renderer, { x: viewport.width, y: viewport.height });
  const state = ROOT_EFFECTS.get(root);
  if (state === undefined) return;
  for (const remote of state.remoteTransforms) {
    const binding = REMOTE_TRANSFORMS.get(remote);
    if (binding !== undefined) updateRemoteTransform(binding);
  }
  for (const enabler of state.visibilityEnablers) {
    const binding = VISIBILITY_ENABLERS.get(enabler);
    if (binding !== undefined) updateVisibilityEnabler(binding, viewport);
  }
  const drawOrder = new Map<Container, number>();
  let nextOrder = 0;
  const walk = (container: Container): void => {
    if (container.sortableChildren) container.sortChildren();
    drawOrder.set(container, nextOrder++);
    for (const child of container.children) if (child instanceof Container) walk(child);
  };
  walk(root);
  const orderedCopies = [...state.backBuffers].sort(
    (left, right) => (drawOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (drawOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
  // Rebuild screen-texture ownership from current draw order every frame. A disabled/moved copy
  // must not leave its previous texture installed, and a later active copy may then replace the
  // earlier copy for only the consumers that follow it.
  for (const copy of orderedCopies) {
    const binding = BACK_BUFFERS.get(copy);
    if (binding === undefined) continue;
    for (const consumer of binding.consumers) clearGodotPixiScreenTexture(consumer);
    binding.consumers.clear();
  }
  for (const copy of orderedCopies) {
    const binding = BACK_BUFFERS.get(copy);
    if (binding !== undefined) captureBackBuffer(binding, renderer, viewport);
  }
}
