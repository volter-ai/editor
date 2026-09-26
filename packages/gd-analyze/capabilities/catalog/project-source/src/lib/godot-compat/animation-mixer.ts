/**
 * @godot-class AnimationMixer
 * @role PROTOCOL
 *
 * Godot 4.7's `AnimationMixer` (`scene/animation/animation_mixer.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the one mixer an AnimationPlayer and an
 * AnimationTree share. Its libraries (sorted by name) make the animation set (`lib/name`); its
 * track caches resolve each track's path from the root node once per cache pass (keyed by path
 * and cache type, in `AHashMap` order: insertion, a removal moving the last entry into its place);
 * each process blends the animation instances its subclass makes (`_blend_init`,
 * `_blend_calc_total_weight`, `_blend_process`, `_blend_apply`) and applies the result.
 *
 * A value track's property and a method track's native method are bound at import: the scene
 * hands the mixer `bindings`, the setter each value track's path resolves to (or the script field)
 * and the native method each method track calls, as the translation resolved them against the
 * scene's classes. A script's own method is called by name, as `Object::callp` tries the script
 * instance first. A track whose target has no binding is an error.
 *
 * Transcribed: value tracks (continuous and discrete, bool/float/Vector3/Quaternion keys), method
 * tracks (deferred and immediate) and a Node3D's position/rotation/scale tracks. Not transcribed
 * (they throw): angle interpolation, root motion, capture, bone, blend-shape, audio, animation and
 * bezier tracks. The editor build's `can_call` (method tracks only inside the tree,
 * `animation_mixer.cpp:1226`) is the editor's; an exported game calls them, as here.
 */

import {
  type Animation,
  godot_animation_blend_variant,
  godot_animation_cast_from_blendwise,
  godot_animation_cast_to_blendwise,
  godot_animation_interpolate_via_rest,
  godot_animation_key_indices_in_range,
  godot_animation_subtract_variant,
  godot_animation_try_interpolate,
  godot_animation_zero,
  find_track,
  method_track_get_name,
  method_track_get_params,
  track_find_key,
  track_get_key_count,
  track_get_key_value,
  value_track_interpolate,
} from './animation';
import { type AnimationLibrary, godot_animation_library_listen, godot_string_name_alph_compare } from './animation-library';
import { godot_basis_from_quaternion, scaled } from './basis';
import {
  godot_is_native,
  godot_node_entity,
  godot_node_is_freed,
  godot_node_set_internal_physics,
  godot_node_set_internal_process,
  godot_node_tree_signal,
  get_node_or_null,
  is_inside_tree,
} from './node';
import { godot_node_3d_basis_euler, set_position, set_rotation, set_scale, set_transform } from './node-3d';
import { godot_message_queue_push } from './object';
import { construct as quaternion, is_normalized, type Quaternion } from './quaternion';
import { createSignal, type SignalHandle } from './signal';
import { construct as transform3d } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
const CMP_EPSILON = 0.00001;

/** `Animation::TrackType` (`animation.h:48`). */
const TYPE_VALUE = 0;
const TYPE_POSITION_3D = 1;
const TYPE_ROTATION_3D = 2;
const TYPE_SCALE_3D = 3;
const TYPE_METHOD = 5;
/** `Animation::UpdateMode`, `InterpolationType`, `FindMode` (`animation.h:60-91`). */
const UPDATE_DISCRETE = 1;
const INTERPOLATION_LINEAR_ANGLE = 3;
const INTERPOLATION_CUBIC_ANGLE = 4;
const FIND_MODE_NEAREST = 0;
const FIND_MODE_EXACT = 2;
/** `AnimationMixer::AnimationCallbackModeProcess` (`animation_mixer.h:54`). */
const PROCESS_PHYSICS = 0;
const PROCESS_IDLE = 1;
/** `AnimationCallbackModeMethod` and `AnimationCallbackModeDiscrete` (`animation_mixer.h:60`). */
const METHOD_DEFERRED = 0;
const DISCRETE_DOMINANT = 0;
const DISCRETE_RECESSIVE = 1;
const DISCRETE_FORCE_CONTINUOUS = 2;

/** `Math::is_zero_approx(float)` (`math_funcs.h:535`). */
function isZeroApprox(value: number): boolean {
  return Math.abs(value) < f32(CMP_EPSILON);
}

// --- Bindings.

/** A value track's property on its target: a bound setter (with its index), or a script field. */
export type GodotAnimationValueBinding =
  | { readonly set: (self: never, ...args: never[]) => void; readonly index?: number | string }
  | { readonly field: string };

/**
 * What the scene resolved its animations' tracks to, by track path (`Circle:rotation`): each value
 * track's property, and each method track's native methods by name.
 */
export interface GodotAnimationBindings {
  readonly values?: Readonly<Record<string, GodotAnimationValueBinding>>;
  readonly methods?: Readonly<Record<string, Readonly<Record<string, (self: never, ...args: never[]) => unknown>>>>;
}

// --- `AHashMap`'s order: insertion, a removal moving the last entry into its slot (`a_hash_map.h:349`).

class OrderedMap<K, V> {
  private readonly keys: K[] = [];
  private readonly values: V[] = [];
  private readonly index = new Map<K, number>();
  get size(): number {
    return this.keys.length;
  }
  get(key: K): V | undefined {
    const at = this.index.get(key);
    return at === undefined ? undefined : this.values[at];
  }
  has(key: K): boolean {
    return this.index.has(key);
  }
  set(key: K, value: V): void {
    const at = this.index.get(key);
    if (at !== undefined) {
      this.values[at] = value;
      return;
    }
    this.index.set(key, this.keys.length);
    this.keys.push(key);
    this.values.push(value);
  }
  delete(key: K): void {
    const at = this.index.get(key);
    if (at === undefined) return;
    this.index.delete(key);
    const last = this.keys.length - 1;
    if (at < last) {
      this.keys[at] = this.keys[last] as K;
      this.values[at] = this.values[last] as V;
      this.index.set(this.keys[at] as K, at);
    }
    this.keys.pop();
    this.values.pop();
  }
  clear(): void {
    this.keys.length = 0;
    this.values.length = 0;
    this.index.clear();
  }
  *entries(): Generator<[K, V]> {
    for (let i = 0; i < this.keys.length; i += 1) yield [this.keys[i] as K, this.values[i] as V];
  }
}

// --- Track caches (`animation_mixer.h:143`).

interface TrackCacheBase {
  readonly path: string;
  readonly object: object;
  setupPass: number;
  blendIdx: number;
  totalWeight: number;
  weightAppliedAt: number;
}

interface TrackCacheValue extends TrackCacheBase {
  readonly type: typeof TYPE_VALUE;
  readonly subpath: string;
  initValue: unknown;
  value: unknown;
  isInit: boolean;
  useContinuous: boolean;
  useDiscrete: boolean;
  isUsingAngle: boolean;
}

interface TrackCacheTransform extends TrackCacheBase {
  readonly type: typeof TYPE_POSITION_3D;
  locUsed: boolean;
  rotUsed: boolean;
  scaleUsed: boolean;
  initLoc: Vector3;
  initRot: Quaternion;
  initScale: Vector3;
  loc: Vector3;
  rot: Quaternion;
  scale: Vector3;
}

interface TrackCacheMethod extends TrackCacheBase {
  readonly type: typeof TYPE_METHOD;
}

type TrackCache = TrackCacheValue | TrackCacheTransform | TrackCacheMethod;

/** `AnimationMixer::PlaybackInfo` (`animation_mixer.h:84`). */
export interface GodotAnimationPlaybackInfo {
  readonly time: number;
  readonly delta: number;
  readonly start: number;
  readonly end: number;
  readonly seeked: boolean;
  readonly isExternalSeeking: boolean;
  readonly loopedFlag: number;
  weight: number;
  readonly trackWeights?: readonly number[];
}

interface AnimationInstance {
  readonly animation: Animation;
  readonly info: GodotAnimationPlaybackInfo;
}

/** A subclass's overrides of the mixer's virtual steps (an AnimationPlayer's, an AnimationTree's). */
export interface GodotAnimationMixerHooks {
  readonly preProcess?: (delta: number, trackCount: number, trackMap: ReadonlyMap<string, number>) => boolean;
  readonly postProcess?: () => void;
  readonly capture?: (delta: number) => void;
  readonly animationChanged?: (name: string) => void;
  readonly animationRemoved?: (name: string, library: string) => void;
  readonly setActive?: (active: boolean) => void;
  /** A subclass's `advance` (AnimationPlayer's processes a just-started animation first). */
  readonly advance?: (delta: number) => void;
}

interface MixerSignals {
  readonly animation_started: SignalHandle<[string]>;
  readonly animation_finished: SignalHandle<[string]>;
  readonly animation_list_changed: SignalHandle<[]>;
  readonly animation_libraries_updated: SignalHandle<[]>;
  readonly caches_cleared: SignalHandle<[]>;
  readonly mixer_applied: SignalHandle<[]>;
  readonly mixer_updated: SignalHandle<[]>;
}

export type GodotAnimationMixerSignal = keyof MixerSignals;

interface MixerState {
  readonly entity: object;
  readonly libraries: { name: string; readonly library: AnimationLibrary; disconnect: () => void }[];
  readonly animationSet: OrderedMap<string, { animation: Animation; library: string; lastUpdate: number }>;
  animationSetUpdatePass: number;
  active: boolean;
  deterministic: boolean;
  rootNode: string;
  callbackModeProcess: number;
  callbackModeMethod: number;
  callbackModeDiscrete: number;
  resetOnSave: boolean;
  processing: boolean;
  cacheValid: boolean;
  setupPass: number;
  readonly trackCache: OrderedMap<string, TrackCache>;
  readonly trackMap: Map<string, number>;
  trackCount: number;
  readonly trackNumToCache: Map<Animation, (TrackCache | null)[]>;
  instances: AnimationInstance[];
  weightPass: number;
  bindings: GodotAnimationBindings;
  readonly hooks: GodotAnimationMixerHooks;
  readonly signals: MixerSignals;
}

const MIXERS = new WeakMap<object, MixerState>();

function stateOf(self: object, member: string): MixerState {
  const state = MIXERS.get(godot_node_entity(self));
  if (state === undefined) throw new TypeError(`godot-compat: AnimationMixer.${member} requires an AnimationMixer receiver.`);
  return state;
}

/**
 * Makes an entity an AnimationMixer (`AnimationMixer::AnimationMixer`, root node `..`, processing
 * idle, methods deferred, discrete tracks recessive), with its subclass's overrides; its caches are
 * cleared as it enters and exits the tree (`NOTIFICATION_ENTER_TREE`/`EXIT_TREE`, `:2400`).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:2546
 */
export function godot_animation_mixer_adopt(entity: object, hooks: GodotAnimationMixerHooks = {}): void {
  const state: MixerState = {
    entity,
    libraries: [],
    animationSet: new OrderedMap(),
    animationSetUpdatePass: 1,
    active: true,
    deterministic: false,
    rootNode: '..',
    callbackModeProcess: PROCESS_IDLE,
    callbackModeMethod: METHOD_DEFERRED,
    callbackModeDiscrete: DISCRETE_RECESSIVE,
    resetOnSave: true,
    processing: false,
    cacheValid: false,
    setupPass: 1,
    trackCache: new OrderedMap(),
    trackMap: new Map(),
    trackCount: 0,
    trackNumToCache: new Map(),
    instances: [],
    weightPass: 0,
    bindings: {},
    hooks,
    signals: {
      animation_started: createSignal<[string]>(),
      animation_finished: createSignal<[string]>(),
      animation_list_changed: createSignal<[]>(),
      animation_libraries_updated: createSignal<[]>(),
      caches_cleared: createSignal<[]>(),
      mixer_applied: createSignal<[]>(),
      mixer_updated: createSignal<[]>(),
    },
  };
  MIXERS.set(entity, state);
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    if (!state.processing) {
      godot_node_set_internal_physics(entity, undefined);
      godot_node_set_internal_process(entity, undefined);
    }
    clearCaches(state);
  });
  godot_node_tree_signal(entity, 'tree_exiting').connect(() => clearCaches(state));
}

/**
 * Adds the value and method bindings the scene resolved for its animations' tracks.
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:694
 */
export function godot_animation_mixer_bind(self: object, bindings: GodotAnimationBindings): void {
  const state = stateOf(self, 'bind');
  state.bindings = {
    values: { ...state.bindings.values, ...bindings.values },
    methods: { ...state.bindings.methods, ...bindings.methods },
  };
}

/**
 * The mixer's signal by name (`animation_started`, `animation_finished`, …).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:2530
 */
export function godot_animation_mixer_signal<Name extends GodotAnimationMixerSignal>(self: object, name: Name): MixerSignals[Name]['signal'] {
  return stateOf(self, name).signals[name].signal as MixerSignals[Name]['signal'];
}

/**
 * Emits one of the mixer's signals, for its subclasses (`animation_started` from `play`).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_player.cpp:549
 */
export function godot_animation_mixer_emit(self: object, name: 'animation_started' | 'animation_finished', animation: string): void {
  stateOf(self, name).signals[name].emit(animation);
}

// --- Libraries and the animation set.

/** `_animation_set_cache_update` (`animation_mixer.cpp:154`). */
function animationSetCacheUpdate(state: MixerState): void {
  state.animationSetUpdatePass += 1;
  let clearNeeded = false;
  for (const lib of state.libraries) {
    for (const [name, animation] of lib.library.animations) {
      const key = lib.name === '' ? name : `${lib.name}/${name}`;
      const data = state.animationSet.get(key);
      if (data === undefined) {
        state.animationSet.set(key, { animation, library: lib.name, lastUpdate: state.animationSetUpdatePass });
        state.cacheValid = false;
      } else if (data.lastUpdate !== state.animationSetUpdatePass) {
        if (data.animation !== animation || data.library !== lib.name) {
          clearNeeded = true;
          data.animation = animation;
          data.library = lib.name;
        }
        data.lastUpdate = state.animationSetUpdatePass;
      }
    }
  }
  const erase: string[] = [];
  for (const [key, data] of state.animationSet.entries()) {
    if (data.lastUpdate !== state.animationSetUpdatePass) {
      erase.push(key);
      clearNeeded = true;
    }
  }
  for (const key of erase) state.animationSet.delete(key);
  if (clearNeeded) clearCaches(state);
  state.signals.animation_list_changed.emit();
}

function listen(state: MixerState, name: () => string, library: AnimationLibrary): () => void {
  return godot_animation_library_listen(library, {
    added: () => animationSetCacheUpdate(state),
    removed: (animation) => {
      const key = name() === '' ? animation : `${name()}/${animation}`;
      if (!state.animationSet.has(key)) return;
      animationSetCacheUpdate(state);
      state.hooks.animationRemoved?.(animation, name());
    },
    renamed: (from) => {
      const key = name() === '' ? from : `${name()}/${from}`;
      if (!state.animationSet.has(key)) return;
      animationSetCacheUpdate(state);
    },
    changed: (animation) => {
      clearCaches(state);
      state.hooks.animationChanged?.(animation);
    },
  });
}

/** `AnimationLibrary::is_valid_library_name` (`animation_library.cpp:40`). */
function validLibraryName(name: string): boolean {
  return !/[/:,[]/u.test(name);
}

/**
 * Libraries stay sorted by name; a name or library already held fails.
 *
 * @godot AnimationMixer.add_animation_library
 * @source scene/animation/animation_mixer.cpp:295
 */
export function add_animation_library(self: object, name: string, library: AnimationLibrary | null): number {
  const state = stateOf(self, 'add_animation_library');
  if (library === null || library === undefined) return 31;
  const key = String(name);
  if (!validLibraryName(key)) return 31;
  let at = 0;
  for (const lib of state.libraries) {
    if (lib.name === key || lib.library === library) return 32;
    if (godot_string_name_alph_compare(lib.name, key) >= 0) break;
    at += 1;
  }
  const entry = { name: key, library, disconnect: () => {} };
  entry.disconnect = listen(state, () => entry.name, library);
  state.libraries.splice(at, 0, entry);
  animationSetCacheUpdate(state);
  return 0;
}

/**
 * @godot AnimationMixer.remove_animation_library
 * @source scene/animation/animation_mixer.cpp:332
 */
export function remove_animation_library(self: object, name: string): void {
  const state = stateOf(self, 'remove_animation_library');
  const at = state.libraries.findIndex((lib) => lib.name === String(name));
  if (at === -1) return;
  state.libraries[at]?.disconnect();
  state.libraries.splice(at, 1);
  animationSetCacheUpdate(state);
}

/**
 * @godot AnimationMixer.rename_animation_library
 * @source scene/animation/animation_mixer.cpp:355
 */
export function rename_animation_library(self: object, name: string, newname: string): void {
  const state = stateOf(self, 'rename_animation_library');
  const from = String(name);
  const to = String(newname);
  if (from === to || !validLibraryName(to)) return;
  let found = false;
  for (const lib of state.libraries) {
    if (lib.name === to) return;
    if (lib.name === from) {
      found = true;
      lib.name = to;
    }
  }
  if (!found) return;
  state.libraries.sort((a, b) => godot_string_name_alph_compare(a.name, b.name));
  animationSetCacheUpdate(state);
}

/**
 * @godot AnimationMixer.has_animation_library
 * @source scene/animation/animation_mixer.cpp:275
 */
export function has_animation_library(self: object, name: string): boolean {
  return stateOf(self, 'has_animation_library').libraries.some((lib) => lib.name === String(name));
}

/**
 * Null when missing.
 *
 * @godot AnimationMixer.get_animation_library
 * @source scene/animation/animation_mixer.cpp:266
 */
export function get_animation_library(self: object, name: string): AnimationLibrary | null {
  return stateOf(self, 'get_animation_library').libraries.find((lib) => lib.name === String(name))?.library ?? null;
}

/**
 * The library names, sorted.
 *
 * @godot AnimationMixer.get_animation_library_list
 * @source scene/animation/animation_mixer.cpp:252
 */
export function get_animation_library_list(self: object): string[] {
  return stateOf(self, 'get_animation_library_list').libraries.map((lib) => lib.name);
}

/**
 * The library an animation is held by, or "".
 *
 * @godot AnimationMixer.find_animation_library
 * @source scene/animation/animation_mixer.cpp:285
 */
export function find_animation_library(self: object, animation: Animation): string {
  for (const [, data] of stateOf(self, 'find_animation_library').animationSet.entries()) if (data.animation === animation) return data.library;
  return '';
}

/**
 * The animation names, sorted (`get_sorted_animation_list`, `animation_mixer.h:108`).
 *
 * @godot AnimationMixer.get_animation_list
 * @source scene/animation/animation_mixer.cpp:395
 */
export function get_animation_list(self: object): string[] {
  return [...stateOf(self, 'get_animation_list').animationSet.entries()].map(([key]) => key).sort(godot_string_name_alph_compare);
}

/**
 * Null when missing.
 *
 * @godot AnimationMixer.get_animation
 * @source scene/animation/animation_mixer.cpp:409
 */
export function get_animation(self: object, name: string): Animation | null {
  return stateOf(self, 'get_animation').animationSet.get(String(name))?.animation ?? null;
}

/**
 * @godot AnimationMixer.has_animation
 * @source scene/animation/animation_mixer.cpp:424
 */
export function has_animation(self: object, name: string): boolean {
  return stateOf(self, 'has_animation').animationSet.has(String(name));
}

/**
 * The name the animation is held under, or "".
 *
 * @godot AnimationMixer.find_animation
 * @source scene/animation/animation_mixer.cpp:428
 */
export function find_animation(self: object, animation: Animation): string {
  for (const [key, data] of stateOf(self, 'find_animation').animationSet.entries()) if (data.animation === animation) return key;
  return '';
}

/**
 * The animation a name holds, for the mixer's subclasses (their play and blend nodes).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:415
 */
export function godot_animation_mixer_animation(self: object, name: string): Animation | undefined {
  return stateOf(self, 'animation').animationSet.get(String(name))?.animation;
}

// --- Settings.

/** `_set_process` (`animation_mixer.cpp:441`): the internal processing its callback mode selects. */
function setProcess(state: MixerState, process: boolean, force = false): void {
  if (state.processing === process && !force) return;
  const on = process && state.active;
  if (state.callbackModeProcess === PROCESS_PHYSICS) {
    godot_node_set_internal_physics(state.entity, on ? (delta) => {
      if (state.active && state.callbackModeProcess === PROCESS_PHYSICS) processAnimation(state, delta);
    } : undefined);
  } else if (state.callbackModeProcess === PROCESS_IDLE) {
    godot_node_set_internal_process(state.entity, on ? (delta) => {
      if (state.active && state.callbackModeProcess === PROCESS_IDLE) processAnimation(state, delta);
    } : undefined);
  }
  state.processing = process;
}

/**
 * Starts or stops the mixer's processing, for its subclasses.
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:441
 */
export function godot_animation_mixer_set_process(self: object, process: boolean, force = false): void {
  setProcess(stateOf(self, 'set_process'), process, force);
}

/**
 * @godot AnimationMixer.set_active
 * @source scene/animation/animation_mixer.cpp:468
 */
export function set_active(self: object, active: boolean): void {
  const state = stateOf(self, 'set_active');
  if (state.active === Boolean(active)) return;
  state.active = Boolean(active);
  state.hooks.setActive?.(state.active);
  setProcess(state, state.processing, true);
  if (!state.active && is_inside_tree(state.entity)) clearCaches(state);
}

/**
 * @godot AnimationMixer.is_active
 * @source scene/animation/animation_mixer.cpp:482
 */
export function is_active(self: object): boolean {
  return stateOf(self, 'is_active').active;
}

/**
 * @godot AnimationMixer.set_root_node
 * @source scene/animation/animation_mixer.cpp:486
 */
export function set_root_node(self: object, path: string): void {
  const state = stateOf(self, 'set_root_node');
  state.rootNode = String(path);
  clearCaches(state);
}

/**
 * @godot AnimationMixer.get_root_node
 * @source scene/animation/animation_mixer.cpp:491
 */
export function get_root_node(self: object): string {
  return stateOf(self, 'get_root_node').rootNode;
}

/**
 * @godot AnimationMixer.set_deterministic
 * @source scene/animation/animation_mixer.cpp:495
 */
export function set_deterministic(self: object, deterministic: boolean): void {
  const state = stateOf(self, 'set_deterministic');
  state.deterministic = Boolean(deterministic);
  clearCaches(state);
}

/**
 * @godot AnimationMixer.is_deterministic
 * @source scene/animation/animation_mixer.cpp:500
 */
export function is_deterministic(self: object): boolean {
  return stateOf(self, 'is_deterministic').deterministic;
}

/**
 * An active mixer is stopped and restarted around the change.
 *
 * @godot AnimationMixer.set_callback_mode_process
 * @source scene/animation/animation_mixer.cpp:504
 */
export function set_callback_mode_process(self: object, mode: number): void {
  const state = stateOf(self, 'set_callback_mode_process');
  if (state.callbackModeProcess === mode) return;
  const wasActive = state.active;
  if (wasActive) set_active(self, false);
  state.callbackModeProcess = mode;
  if (wasActive) set_active(self, true);
}

/**
 * @godot AnimationMixer.get_callback_mode_process
 * @source scene/animation/animation_mixer.cpp:521
 */
export function get_callback_mode_process(self: object): number {
  return stateOf(self, 'get_callback_mode_process').callbackModeProcess;
}

/**
 * @godot AnimationMixer.set_callback_mode_method
 * @source scene/animation/animation_mixer.cpp:525
 */
export function set_callback_mode_method(self: object, mode: number): void {
  const state = stateOf(self, 'set_callback_mode_method');
  state.callbackModeMethod = mode;
  state.signals.mixer_updated.emit();
}

/**
 * @godot AnimationMixer.get_callback_mode_method
 * @source scene/animation/animation_mixer.cpp:530
 */
export function get_callback_mode_method(self: object): number {
  return stateOf(self, 'get_callback_mode_method').callbackModeMethod;
}

/**
 * @godot AnimationMixer.set_callback_mode_discrete
 * @source scene/animation/animation_mixer.cpp:534
 */
export function set_callback_mode_discrete(self: object, mode: number): void {
  const state = stateOf(self, 'set_callback_mode_discrete');
  state.callbackModeDiscrete = mode;
  clearCaches(state);
  state.signals.mixer_updated.emit();
}

/**
 * @godot AnimationMixer.get_callback_mode_discrete
 * @source scene/animation/animation_mixer.cpp:540
 */
export function get_callback_mode_discrete(self: object): number {
  return stateOf(self, 'get_callback_mode_discrete').callbackModeDiscrete;
}

/**
 * @godot AnimationMixer.set_reset_on_save_enabled
 * @source scene/animation/animation_mixer.cpp:2169
 */
export function set_reset_on_save_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_reset_on_save_enabled').resetOnSave = Boolean(enabled);
}

/**
 * @godot AnimationMixer.is_reset_on_save_enabled
 * @source scene/animation/animation_mixer.cpp:2173
 */
export function is_reset_on_save_enabled(self: object): boolean {
  return stateOf(self, 'is_reset_on_save_enabled').resetOnSave;
}

/**
 * A root motion track is not transcribed.
 *
 * @godot AnimationMixer.set_root_motion_track
 * @source scene/animation/animation_mixer.cpp:2124
 */
export function set_root_motion_track(self: object, path: string): void {
  stateOf(self, 'set_root_motion_track');
  if (String(path) !== '') throw new Error('godot-compat: AnimationMixer root motion is not transcribed.');
}

/**
 * @godot AnimationMixer.get_root_motion_track
 * @source scene/animation/animation_mixer.cpp:2129
 */
export function get_root_motion_track(self: object): string {
  stateOf(self, 'get_root_motion_track');
  return '';
}

// --- Caches (`animation_mixer.cpp:586-1013`).

function clearCaches(state: MixerState): void {
  state.trackCache.clear();
  state.trackNumToCache.clear();
  state.cacheValid = false;
  state.signals.caches_cleared.emit();
}

/**
 * @godot AnimationMixer.clear_caches
 * @source scene/animation/animation_mixer.cpp:2116
 */
export function clear_caches(self: object): void {
  clearCaches(stateOf(self, 'clear_caches'));
}

/**
 * Clears the mixer's caches, for its subclasses (`_clear_caches`).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:586
 */
export function godot_animation_mixer_clear_caches(self: object): void {
  clearCaches(stateOf(self, 'clear_caches'));
}

/** `Animation::get_cache_type` (`animation.cpp:1055`). */
function cacheType(type: number): number {
  return type === TYPE_ROTATION_3D || type === TYPE_SCALE_3D ? TYPE_POSITION_3D : type;
}

/** The node and subnames of a track path, resolved from the root node (`get_node_and_resource`). */
function resolve(parent: object, path: string): { readonly object: object; readonly subnames: readonly string[] } | undefined {
  const at = path.indexOf(':');
  const nodePath = at === -1 ? path : path.slice(0, at);
  const subnames = at === -1 ? [] : path.slice(at + 1).split(':');
  const found = nodePath === '' ? parent : get_node_or_null(parent, nodePath);
  if (found === null || found === undefined) return undefined;
  return { object: found as object, subnames };
}

function transformCache(path: string, object: object): TrackCacheTransform {
  return {
    type: TYPE_POSITION_3D,
    path,
    object,
    setupPass: 0,
    blendIdx: -1,
    totalWeight: 0,
    weightAppliedAt: 0,
    locUsed: false,
    rotUsed: false,
    scaleUsed: false,
    initLoc: vector3(),
    initRot: quaternion(0, 0, 0, 1),
    initScale: vector3(1, 1, 1),
    loc: vector3(),
    rot: quaternion(0, 0, 0, 1),
    scale: vector3(1, 1, 1),
  };
}

function markUsed(track: TrackCacheTransform, type: number): void {
  if (type === TYPE_POSITION_3D) track.locUsed = true;
  else if (type === TYPE_ROTATION_3D) track.rotUsed = true;
  else track.scaleUsed = true;
}

/** `_update_caches` (`animation_mixer.cpp:651`). */
function updateCaches(state: MixerState): boolean {
  state.setupPass += 1;
  const names = [...state.animationSet.entries()].map(([key]) => key);
  const parent = get_node_or_null(state.entity, state.rootNode);
  if (parent === null || parent === undefined) {
    state.cacheValid = false;
    return false;
  }
  const reset = state.animationSet.get('RESET')?.animation;
  for (const name of names) {
    const anim = state.animationSet.get(name)?.animation as Animation;
    anim.tracks.forEach((source, i) => {
      if (!source.enabled) return;
      const path = source.path;
      const type = cacheType(source.type);
      const id = `${path}\0${String(type)}`;
      let track = state.trackCache.get(id);
      if (track !== undefined && (track.type !== type || godot_node_is_freed(track.object))) {
        state.trackCache.delete(id);
        track = undefined;
      }
      if (track === undefined) {
        const found = resolve(parent as object, path);
        if (found === undefined) return;
        switch (source.type) {
          case TYPE_VALUE: {
            if (track_get_key_count(anim, i) === 0) return;
            const subpath = found.subnames.join(':');
            if (found.subnames.length !== 1) throw new Error(`godot-compat: the value track '${path}' needs one property subname.`);
            let initValue = godot_animation_zero(track_get_key_value(anim, i, 0));
            if (reset !== undefined) {
              const rt = find_track(reset, path, source.type);
              if (rt >= 0 && reset.tracks[rt]?.enabled === true && track_get_key_count(reset, rt) > 0) initValue = track_get_key_value(reset, rt, 0);
            }
            const angle = source.interpolation === INTERPOLATION_LINEAR_ANGLE || source.interpolation === INTERPOLATION_CUBIC_ANGLE;
            if (angle) throw new Error('godot-compat: angle interpolation is not transcribed.');
            track = {
              type: TYPE_VALUE,
              path,
              object: found.object,
              subpath,
              setupPass: 0,
              blendIdx: -1,
              totalWeight: 0,
              weightAppliedAt: 0,
              initValue,
              value: undefined,
              isInit: false,
              useContinuous: false,
              useDiscrete: false,
              isUsingAngle: false,
            };
            break;
          }
          case TYPE_POSITION_3D:
          case TYPE_ROTATION_3D:
          case TYPE_SCALE_3D: {
            if (!godot_is_native(found.object, 'Node3D')) return;
            if (found.subnames.length > 0) throw new Error(`godot-compat: the bone track '${path}' is not transcribed.`);
            const xform = transformCache(path, found.object);
            markUsed(xform, source.type);
            if (reset !== undefined) {
              const rt = find_track(reset, path, source.type);
              if (rt >= 0 && reset.tracks[rt]?.enabled === true && track_get_key_count(reset, rt) > 0) {
                const value = track_get_key_value(reset, rt, 0);
                if (source.type === TYPE_POSITION_3D) xform.initLoc = value as Vector3;
                else if (source.type === TYPE_ROTATION_3D) xform.initRot = value as Quaternion;
                else xform.initScale = value as Vector3;
              }
            }
            track = xform;
            break;
          }
          case TYPE_METHOD:
            if (found.subnames.length > 0) throw new Error(`godot-compat: the method track '${path}' on a resource is not transcribed.`);
            track = { type: TYPE_METHOD, path, object: found.object, setupPass: 0, blendIdx: -1, totalWeight: 0, weightAppliedAt: 0 };
            break;
          default:
            throw new Error(`godot-compat: Animation track type ${String(source.type)} is not transcribed.`);
        }
        state.trackCache.set(id, track);
      } else if (track.type === TYPE_POSITION_3D) {
        if (track.setupPass !== state.setupPass) {
          track.locUsed = false;
          track.rotUsed = false;
          track.scaleUsed = false;
        }
        markUsed(track, source.type);
      }
      track.setupPass = state.setupPass;
    });
  }
  const stale: string[] = [];
  for (const [id, track] of state.trackCache.entries()) if (track.setupPass !== state.setupPass) stale.push(id);
  for (const id of stale) state.trackCache.delete(id);
  state.trackMap.clear();
  let idx = 0;
  for (const [, track] of state.trackCache.entries()) {
    state.trackMap.set(track.path, idx);
    idx += 1;
  }
  for (const [, track] of state.trackCache.entries()) track.blendIdx = state.trackMap.get(track.path) as number;
  state.trackNumToCache.clear();
  for (const name of names) {
    const anim = state.animationSet.get(name)?.animation as Animation;
    if (state.trackNumToCache.has(anim)) continue;
    state.trackNumToCache.set(
      anim,
      anim.tracks.map((source) => state.trackCache.get(`${source.path}\0${String(cacheType(source.type))}`) ?? null),
    );
  }
  state.trackCount = idx;
  state.cacheValid = true;
  return true;
}

// --- Blending (`animation_mixer.cpp:1015-2075`).

function addScaled(a: Vector3, b: Vector3, c: Vector3, weight: number): Vector3 {
  // `a += (b - c) * weight`, each operation in `real_t`.
  const w = f32(weight);
  return vector3(f32(a.x + f32(f32(b.x - c.x) * w)), f32(a.y + f32(f32(b.y - c.y) * w)), f32(a.z + f32(f32(b.z - c.z) * w)));
}

/** `_blend_init` (`animation_mixer.cpp:1060`). */
function blendInit(state: MixerState): void {
  if (!state.cacheValid && !updateCaches(state)) return;
  for (const [, track] of state.trackCache.entries()) {
    track.totalWeight = 0;
    if (track.type === TYPE_POSITION_3D) {
      track.loc = track.initLoc;
      track.rot = track.initRot;
      track.scale = track.initScale;
    } else if (track.type === TYPE_VALUE) {
      track.value = godot_animation_cast_to_blendwise(track.initValue);
      track.useContinuous = false;
      track.useDiscrete = false;
    }
  }
}

/** `_blend_calc_total_weight` (`animation_mixer.cpp:1162`). */
function blendCalcTotalWeight(state: MixerState): void {
  for (const instance of state.instances) {
    const weight = f32(instance.info.weight);
    if (isZeroApprox(weight)) continue;
    const caches = state.trackNumToCache.get(instance.animation);
    if (caches === undefined) continue;
    state.weightPass += 1;
    const pass = state.weightPass;
    instance.animation.tracks.forEach((source, i) => {
      if (!source.enabled) return;
      const track = caches[i];
      if (track === null || track === undefined || track.weightAppliedAt === pass) return;
      const weights = instance.info.trackWeights;
      const blend = weights !== undefined && track.blendIdx < weights.length ? f32((weights[track.blendIdx] as number) * weight) : weight;
      track.totalWeight = f32(track.totalWeight + blend);
      track.weightAppliedAt = pass;
    });
  }
}

/** A value track's property set on its target (`Object::set_indexed`), through the scene's binding. */
function setValue(state: MixerState, track: TrackCacheValue, value: unknown): void {
  const binding = state.bindings.values?.[track.path];
  if (binding === undefined) throw new Error(`godot-compat: the value track '${track.path}' has no property binding.`);
  if ('field' in binding) {
    (track.object as Record<string, unknown>)[binding.field] = value;
    return;
  }
  const entity = godot_node_entity(track.object);
  const set = binding.set as (self: object, ...args: unknown[]) => void;
  if (binding.index === undefined) set(entity, value);
  else set(entity, binding.index, value);
}

/** `_call_object` (`animation_mixer.cpp:2077`): the script's method first, then the bound native one. */
function callObject(state: MixerState, track: TrackCacheMethod, method: string, params: unknown[], deferred: boolean): void {
  const run = (): void => {
    if (godot_node_is_freed(track.object)) return;
    const object = track.object as Record<string, unknown>;
    const entity = godot_node_entity(track.object);
    if (entity !== track.object && typeof object[method] === 'function') {
      (object[method] as (...args: unknown[]) => unknown).apply(object, params);
      return;
    }
    const bound = state.bindings.methods?.[track.path]?.[method] as ((self: object, ...args: unknown[]) => unknown) | undefined;
    if (bound === undefined) throw new Error(`godot-compat: the method track '${track.path}' calls ${method}, which has no binding.`);
    bound(entity, ...params);
  };
  if (deferred) godot_message_queue_push(track.object, run);
  else run();
}

/** `_blend_process` (`animation_mixer.cpp:1223`), for the transcribed track types. */
function blendProcess(state: MixerState, delta: number, updateOnly: boolean): void {
  for (const instance of state.instances) {
    const a = instance.animation;
    const { time, start, end, seeked, isExternalSeeking, loopedFlag } = instance.info;
    const weight = f32(instance.info.weight);
    const backward = Object.is(instance.info.delta, -0) || instance.info.delta < 0;
    const seekedBackward = Object.is(delta, -0) || delta < 0;
    const caches = state.trackNumToCache.get(a);
    if (caches === undefined) continue;
    a.tracks.forEach((source, i) => {
      if (!source.enabled) return;
      const track = caches[i];
      if (track === null || track === undefined) return;
      const weights = instance.info.trackWeights;
      let blend = weights !== undefined && track.blendIdx < weights.length ? f32((weights[track.blendIdx] as number) * weight) : weight;
      if (!state.deterministic) {
        if (isZeroApprox(track.totalWeight)) return;
        blend = f32(blend / track.totalWeight);
      }
      switch (source.type) {
        case TYPE_POSITION_3D:
        case TYPE_ROTATION_3D:
        case TYPE_SCALE_3D: {
          if (isZeroApprox(blend)) return;
          const t = track as TrackCacheTransform;
          const value = godot_animation_try_interpolate(a, i, time);
          if (value === undefined) return;
          if (source.type === TYPE_POSITION_3D) t.loc = addScaled(t.loc, value as Vector3, t.initLoc, blend);
          else if (source.type === TYPE_ROTATION_3D) t.rot = godot_animation_interpolate_via_rest(t.rot, value as Quaternion, blend, t.initRot);
          else t.scale = addScaled(t.scale, value as Vector3, t.initScale, blend);
          return;
        }
        case TYPE_VALUE: {
          if (isZeroApprox(blend)) return;
          const t = track as TrackCacheValue;
          const discrete = source.update_mode === UPDATE_DISCRETE;
          const forceContinuous = state.callbackModeDiscrete === DISCRETE_FORCE_CONTINUOUS;
          if (!discrete || forceContinuous) {
            t.useContinuous = true;
            let value = value_track_interpolate(a, i, time, discrete && forceContinuous ? backward : false);
            if (value === null || value === undefined) return;
            value = godot_animation_cast_to_blendwise(value);
            value = godot_animation_subtract_variant(value, godot_animation_cast_to_blendwise(t.initValue));
            t.value = godot_animation_blend_variant(t.value, value, blend);
          } else if (seeked) {
            const idx = track_find_key(a, i, time, isExternalSeeking ? FIND_MODE_NEAREST : FIND_MODE_EXACT, false, seekedBackward);
            if (idx < 0) return;
            t.useDiscrete = true;
            setValue(state, t, track_get_key_value(a, i, idx));
          } else {
            for (const index of godot_animation_key_indices_in_range(a, i, time, instance.info.delta, start, end, loopedFlag)) {
              t.useDiscrete = true;
              setValue(state, t, track_get_key_value(a, i, index));
            }
          }
          return;
        }
        case TYPE_METHOD: {
          if (updateOnly || isZeroApprox(blend)) return;
          const t = track as TrackCacheMethod;
          const deferred = state.callbackModeMethod === METHOD_DEFERRED;
          if (seeked) {
            const idx = track_find_key(a, i, time, isExternalSeeking ? FIND_MODE_NEAREST : FIND_MODE_EXACT, true);
            if (idx < 0) return;
            callObject(state, t, method_track_get_name(a, i, idx), method_track_get_params(a, i, idx), deferred);
          } else {
            for (const index of godot_animation_key_indices_in_range(a, i, time, instance.info.delta, start, end, loopedFlag)) {
              callObject(state, t, method_track_get_name(a, i, index), method_track_get_params(a, i, index), deferred);
            }
          }
          return;
        }
        default:
          throw new Error(`godot-compat: Animation track type ${String(source.type)} is not transcribed.`);
      }
    });
  }
}

/** `_blend_apply` (`animation_mixer.cpp:1902`). */
function blendApply(state: MixerState): void {
  for (const [, track] of state.trackCache.entries()) {
    const zero = isZeroApprox(track.totalWeight);
    if (!state.deterministic && zero) continue;
    if (track.type === TYPE_POSITION_3D) {
      if (godot_node_is_freed(track.object)) return;
      const node = godot_node_entity(track.object) as Parameters<typeof set_position>[0];
      if (track.locUsed && track.rotUsed && track.scaleUsed) {
        set_transform(node, transform3d(scaled(godot_basis_from_quaternion(track.rot), track.scale), track.loc));
      } else {
        if (track.locUsed) set_position(node, track.loc);
        // `Quaternion::get_euler` fails for an unnormalized quaternion (`MATH_CHECKS`).
        if (track.rotUsed) set_rotation(node, is_normalized(track.rot) ? godot_node_3d_basis_euler(godot_basis_from_quaternion(track.rot)) : vector3());
        if (track.scaleUsed) set_scale(node, track.scale);
      }
    } else if (track.type === TYPE_VALUE) {
      const mode = state.callbackModeDiscrete;
      if (mode === DISCRETE_FORCE_CONTINUOUS) track.isInit = false;
      else if (!track.useContinuous && (track.useDiscrete || !state.deterministic)) track.isInit = true;
      if ((track.isInit && (zero || !track.useContinuous)) || (mode !== DISCRETE_FORCE_CONTINUOUS && !zero && mode === DISCRETE_DOMINANT && track.useDiscrete)) continue;
      if (mode !== DISCRETE_FORCE_CONTINUOUS) track.isInit = !track.useContinuous;
      if (!godot_node_is_freed(track.object)) setValue(state, track, godot_animation_cast_from_blendwise(track.value, track.initValue));
    }
  }
}

/** `_process_animation` (`animation_mixer.cpp:1015`). */
function processAnimation(state: MixerState, delta: number, updateOnly = false): void {
  blendInit(state);
  if (state.cacheValid && (state.hooks.preProcess?.(delta, state.trackCount, state.trackMap) ?? true)) {
    state.hooks.capture?.(delta);
    blendCalcTotalWeight(state);
    blendProcess(state, delta, updateOnly);
    state.instances = [];
    blendApply(state);
    state.hooks.postProcess?.();
    state.signals.mixer_applied.emit();
  } else {
    state.instances = [];
  }
}

/**
 * Processes the mixer by `delta`, for its subclasses (`_process_animation`).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:1015
 */
export function godot_animation_mixer_process(self: object, delta: number, updateOnly = false): void {
  processAnimation(stateOf(self, 'process'), delta, updateOnly);
}

/**
 * Adds an animation instance to the next blend (`make_animation_instance`).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:2097
 */
export function godot_animation_mixer_make_instance(self: object, name: string, info: GodotAnimationPlaybackInfo): void {
  const state = stateOf(self, 'make_instance');
  const animation = state.animationSet.get(name)?.animation;
  if (animation === undefined) return;
  state.instances.push({ animation, info });
}

/**
 * @godot AnimationMixer.advance
 * @source scene/animation/animation_mixer.cpp:2112
 */
export function advance(self: object, delta: number): void {
  const state = stateOf(self, 'advance');
  if (state.hooks.advance !== undefined) state.hooks.advance(delta);
  else processAnimation(state, delta);
}

/**
 * The mixer's `libraries/NAME` as a scene states it (`AnimationMixer::_set`, `:57`): the library
 * under that name, replacing one it holds.
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:84
 */
export function godot_animation_mixer_set_library(self: object, name: string, library: AnimationLibrary): void {
  const state = stateOf(self, 'set_library');
  if (has_animation_library(self, name)) remove_animation_library(self, name);
  add_animation_library(self, name, library);
  state.signals.animation_libraries_updated.emit();
}

