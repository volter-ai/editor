/** Godot 3 AnimationPlayer tracks over retained Pixi entities. */

import {
  animationTreeFrame,
  type AnimationTreeState,
  type LeafDrive,
} from './animation-tree';
import { godotEase } from './animation-transition';

export interface GodotPixiAnimationVector3Value {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GodotPixiAnimationVector2Value {
  readonly x: number;
  readonly y: number;
}

export interface GodotPixiAnimationColorValue {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface GodotPixiAnimationRect2Value {
  readonly position: GodotPixiAnimationVector2Value;
  readonly size: GodotPixiAnimationVector2Value;
}

export type GodotPixiInterpolatedValue =
  | number
  | GodotPixiAnimationVector2Value
  | GodotPixiAnimationVector3Value
  | GodotPixiAnimationColorValue
  | GodotPixiAnimationRect2Value;
export type GodotPixiAnimationValue = GodotPixiInterpolatedValue | boolean | string | null;

export interface GodotBezierKey {
  time: number;
  value: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
}

export interface GodotBezierTrackSpec {
  kind: 'bezier';
  enabled: boolean;
  path: string;
  keys: readonly GodotBezierKey[];
}

export interface GodotDiscreteTrackSpec {
  kind: 'discrete';
  enabled: boolean;
  path: string;
  keys: readonly { time: number; value: GodotPixiAnimationValue }[];
}

export interface GodotInterpolatedTrackSpec {
  kind: 'interpolated';
  enabled: boolean;
  path: string;
  interpolation: 0 | 1 | 2;
  loopWrap: boolean;
  keys: readonly {
    time: number;
    transition: number;
    value: GodotPixiInterpolatedValue;
  }[];
}

export interface GodotMethodTrackSpec {
  kind: 'method';
  enabled: boolean;
  path: string;
  keys: readonly { time: number; method: string; args: readonly unknown[] }[];
}

export type GodotPixiAnimationTrackSpec =
  | GodotBezierTrackSpec
  | GodotDiscreteTrackSpec
  | GodotInterpolatedTrackSpec
  | GodotMethodTrackSpec;

export interface GodotPixiAnimationSpec {
  name: string;
  length: number;
  loop: boolean;
  tracks: readonly GodotPixiAnimationTrackSpec[];
}

type MutableTrack =
  | { kind: 'bezier'; enabled: boolean; path: string; keys: GodotBezierKey[] }
  | { kind: 'discrete'; enabled: boolean; path: string; keys: { time: number; value: GodotPixiAnimationValue }[] }
  | {
      kind: 'interpolated';
      enabled: boolean;
      path: string;
      interpolation: 0 | 1 | 2;
      loopWrap: boolean;
      keys: { time: number; transition: number; value: GodotPixiInterpolatedValue }[];
    }
  | { kind: 'method'; enabled: boolean; path: string; keys: { time: number; method: string; args: readonly unknown[] }[] };

export class GodotPixiAnimation {
  readonly __godotClass = 'Animation';
  readonly name: string;
  readonly length: number;
  readonly loop: boolean;
  private readonly tracks: MutableTrack[];

  constructor(spec: GodotPixiAnimationSpec) {
    this.name = spec.name;
    this.length = spec.length;
    this.loop = spec.loop;
    this.tracks = spec.tracks.map((track) => ({
      ...track,
      keys: track.keys.map((key) => ({
        ...key,
        ...('value' in key && typeof key.value === 'object'
          ? { value: { ...key.value } }
          : {}),
      })),
    })) as MutableTrack[];
  }

  duplicate(_deep = false): GodotPixiAnimation {
    return new GodotPixiAnimation({
      name: this.name,
      length: this.length,
      loop: this.loop,
      tracks: this.tracks,
    });
  }

  get_track_count(): number {
    return this.tracks.length;
  }

  track_get_path(track: number): string {
    return this.track(track).path;
  }

  track_set_path(track: number, path: string): void {
    this.track(track).path = path;
  }

  track_get_key_count(track: number): number {
    return this.track(track).keys.length;
  }

  bezier_track_get_key_value(track: number, key: number): number {
    const value = this.track(track);
    if (value.kind !== 'bezier') throw new Error(`Godot Animation track ${track} is not Bezier.`);
    return this.key(value, track, key).value;
  }

  bezier_track_set_key_value(track: number, key: number, value: number): void {
    if (!Number.isFinite(value)) throw new Error(`Godot Animation Bezier value must be finite: ${value}`);
    const selected = this.track(track);
    if (selected.kind !== 'bezier') throw new Error(`Godot Animation track ${track} is not Bezier.`);
    this.key(selected, track, key).value = value;
  }

  sample(track: number, time: number): number {
    const value = this.track(track);
    if (value.kind !== 'bezier') throw new Error(`Godot Animation track ${track} is not Bezier.`);
    return sampleBezier(value.keys, time);
  }

  path(track: number): string {
    return this.track_get_path(track);
  }

  authoredTrack(track: number): Readonly<MutableTrack> {
    return this.track(track);
  }

  private track(index: number): MutableTrack {
    const track = this.tracks[index];
    if (track === undefined) throw new RangeError(`Godot Animation track ${index} is out of range.`);
    return track;
  }

  private key(track: Extract<MutableTrack, { kind: 'bezier' }>, trackIndex: number, index: number): GodotBezierKey {
    const key = track.keys[index];
    if (key === undefined) throw new RangeError(`Godot Animation track ${trackIndex} key ${index} is out of range.`);
    return key;
  }
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * inverse * a
    + 3 * inverse * inverse * t * b
    + 3 * inverse * t * t * c
    + t * t * t * d;
}

/** Pinned Animation::bezier_track_interpolate: ten x-axis bisections, then one linear finish. */
function sampleBezier(keys: readonly GodotBezierKey[], time: number): number {
  if (keys.length === 0) return 0;
  if (keys.length === 1 || time <= (keys[0] as GodotBezierKey).time) {
    return (keys[0] as GodotBezierKey).value;
  }
  let index = keys.length - 1;
  for (let candidate = 0; candidate < keys.length - 1; candidate += 1) {
    if (time < (keys[candidate + 1] as GodotBezierKey).time) {
      index = candidate;
      break;
    }
  }
  if (index >= keys.length - 1) return (keys[keys.length - 1] as GodotBezierKey).value;
  const start = keys[index] as GodotBezierKey;
  const end = keys[index + 1] as GodotBezierKey;
  const localTime = time - start.time;
  const duration = end.time - start.time;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const middle = (low + high) / 2;
    const x = cubic(0, start.outX, duration + end.inX, duration, middle);
    if (x < localTime) low = middle;
    else high = middle;
  }
  const lowX = cubic(0, start.outX, duration + end.inX, duration, low);
  const highX = cubic(0, start.outX, duration + end.inX, duration, high);
  const lowY = cubic(start.value, start.value + start.outY, end.value + end.inY, end.value, low);
  const highY = cubic(start.value, start.value + start.outY, end.value + end.inY, end.value, high);
  const weight = highX === lowX ? 0 : (localTime - lowX) / (highX - lowX);
  return lowY + (highY - lowY) * weight;
}

function isVectorValue(value: GodotPixiInterpolatedValue): value is GodotPixiAnimationVector2Value | GodotPixiAnimationVector3Value {
  return typeof value === 'object' && 'x' in value;
}

function isVector3Value(value: GodotPixiInterpolatedValue): value is GodotPixiAnimationVector3Value {
  return isVectorValue(value) && 'z' in value;
}

function isColorValue(value: GodotPixiInterpolatedValue): value is GodotPixiAnimationColorValue {
  return typeof value === 'object' && 'r' in value;
}

function isRect2Value(value: GodotPixiInterpolatedValue): value is GodotPixiAnimationRect2Value {
  return typeof value === 'object' && 'position' in value && 'size' in value;
}

function valueKind(value: GodotPixiInterpolatedValue): 'number' | 'vector2' | 'vector3' | 'color' | 'rect2' {
  if (typeof value === 'number') return 'number';
  if (isColorValue(value)) return 'color';
  if (isRect2Value(value)) return 'rect2';
  return isVector3Value(value) ? 'vector3' : 'vector2';
}

function assertMatchingValueKinds(
  left: GodotPixiInterpolatedValue,
  right: GodotPixiInterpolatedValue,
): void {
  if (valueKind(left) !== valueKind(right)) {
    throw new TypeError('Godot Pixi Animation cannot interpolate key values of different Variant types.');
  }
}

function mapValue(
  value: GodotPixiInterpolatedValue,
  operation: (component: number) => number,
): GodotPixiInterpolatedValue {
  return isRect2Value(value)
    ? {
        position: { x: operation(value.position.x), y: operation(value.position.y) },
        size: { x: operation(value.size.x), y: operation(value.size.y) },
      }
    : isVectorValue(value)
    ? isVector3Value(value)
      ? { x: operation(value.x), y: operation(value.y), z: operation(value.z) }
      : { x: operation(value.x), y: operation(value.y) }
    : isColorValue(value)
      ? { r: operation(value.r), g: operation(value.g), b: operation(value.b), a: operation(value.a) }
    : operation(value);
}

function zipValue(
  left: GodotPixiInterpolatedValue,
  right: GodotPixiInterpolatedValue,
  operation: (left: number, right: number) => number,
): GodotPixiInterpolatedValue {
  assertMatchingValueKinds(left, right);
  if (isRect2Value(left) && isRect2Value(right)) {
    return {
      position: {
        x: operation(left.position.x, right.position.x),
        y: operation(left.position.y, right.position.y),
      },
      size: {
        x: operation(left.size.x, right.size.x),
        y: operation(left.size.y, right.size.y),
      },
    };
  }
  if (!isVectorValue(left) || !isVectorValue(right)) {
    if (isColorValue(left) && isColorValue(right)) {
      return {
        r: operation(left.r, right.r),
        g: operation(left.g, right.g),
        b: operation(left.b, right.b),
        a: operation(left.a, right.a),
      };
    }
    return operation(left as number, right as number);
  }
  return isVector3Value(left) && isVector3Value(right) ? {
    x: operation(left.x, right.x),
    y: operation(left.y, right.y),
    z: operation(left.z, right.z),
  } : { x: operation(left.x, right.x), y: operation(left.y, right.y) };
}

function scaleValue(value: GodotPixiInterpolatedValue, weight: number): GodotPixiInterpolatedValue {
  return mapValue(value, (component) => component * weight);
}

function addValue(
  left: GodotPixiInterpolatedValue,
  right: GodotPixiInterpolatedValue,
): GodotPixiInterpolatedValue {
  return zipValue(left, right, (a, b) => a + b);
}

function linearValue(
  from: GodotPixiInterpolatedValue,
  to: GodotPixiInterpolatedValue,
  weight: number,
): GodotPixiInterpolatedValue {
  return zipValue(from, to, (a, b) => a + (b - a) * weight);
}

/** Godot 3 Variant cubic interpolation: Catmull-Rom componentwise for numbers and vectors. */
function cubicValue(
  pre: GodotPixiInterpolatedValue,
  from: GodotPixiInterpolatedValue,
  to: GodotPixiInterpolatedValue,
  post: GodotPixiInterpolatedValue,
  weight: number,
): GodotPixiInterpolatedValue {
  assertMatchingValueKinds(pre, from);
  assertMatchingValueKinds(from, to);
  assertMatchingValueKinds(to, post);
  // Godot 3's generic Variant cubic path has dedicated Catmull-Rom cases for numbers and vectors,
  // but Color falls through to Variant::interpolate, which is componentwise LINEAR.
  if ((isColorValue(from) && isColorValue(to)) || (isRect2Value(from) && isRect2Value(to))) {
    return linearValue(from, to, weight);
  }
  const t2 = weight * weight;
  const t3 = t2 * weight;
  const component = (p0: number, p1: number, p2: number, p3: number): number => 0.5 * (
    2 * p1
    + (-p0 + p2) * weight
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
  if (!isVectorValue(pre) || !isVectorValue(from) || !isVectorValue(to) || !isVectorValue(post)) {
    return component(pre as number, from as number, to as number, post as number);
  }
  return isVector3Value(pre) && isVector3Value(from) && isVector3Value(to) && isVector3Value(post) ? {
    x: component(pre.x, from.x, to.x, post.x),
    y: component(pre.y, from.y, to.y, post.y),
    z: component(pre.z, from.z, to.z, post.z),
  } : {
    x: component(pre.x, from.x, to.x, post.x),
    y: component(pre.y, from.y, to.y, post.y),
  };
}

function sampleInterpolated(
  track: Extract<MutableTrack, { kind: 'interpolated' }>,
  animation: GodotPixiAnimation,
  time: number,
): GodotPixiInterpolatedValue | undefined {
  const keys = track.keys.filter((key) => key.time <= animation.length);
  if (keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0]!.value;
  let index = -1;
  for (let candidate = 0; candidate < keys.length; candidate += 1) {
    if (keys[candidate]!.time <= time) index = candidate;
    else break;
  }
  let next = 0;
  let weight = 0;
  if (animation.loop && track.loopWrap) {
    if (index >= 0) {
      if (index + 1 < keys.length) {
        next = index + 1;
        const duration = keys[next]!.time - keys[index]!.time;
        weight = duration === 0 ? 0 : (time - keys[index]!.time) / duration;
      } else {
        next = 0;
        const duration = animation.length - keys[index]!.time + keys[next]!.time;
        weight = duration === 0 ? 0 : (time - keys[index]!.time) / duration;
      }
    } else {
      index = keys.length - 1;
      next = 0;
      const endTime = Math.max(0, animation.length - keys[index]!.time);
      const duration = endTime + keys[next]!.time;
      weight = duration === 0 ? 0 : (endTime + time) / duration;
    }
  } else if (index >= 0) {
    if (index + 1 < keys.length) {
      next = index + 1;
      const duration = keys[next]!.time - keys[index]!.time;
      weight = duration === 0 ? 0 : (time - keys[index]!.time) / duration;
    } else next = index;
  } else if (animation.loop) {
    index = 0;
    next = 0;
  } else return undefined;

  const from = keys[index]!;
  if (from.transition === 0 || index === next || track.interpolation === 0) return from.value;
  const eased = from.transition === 1 ? weight : godotEase(weight, from.transition);
  const to = keys[next]!.value;
  if (track.interpolation === 1) return linearValue(from.value, to, eased);
  let pre = index - 1;
  if (pre < 0) pre = animation.loop && track.loopWrap ? keys.length - 1 : 0;
  let post = next + 1;
  if (post >= keys.length) post = animation.loop && track.loopWrap ? 0 : next;
  return cubicValue(keys[pre]!.value, from.value, to, keys[post]!.value, eased);
}

export type GodotPixiAnimationSetter = (value: GodotPixiAnimationValue) => void;

export interface GodotPixiAnimationPlayer {
  readonly __godotPixiAnimationPlayer: true;
  readonly clips: Map<string, GodotPixiAnimation>;
  readonly next: ReadonlyMap<string, string>;
  readonly resolve: (path: string) => GodotPixiAnimationSetter;
  readonly invoke: (path: string, method: string, args: readonly unknown[]) => void;
  readonly defer: (invoke: () => void) => void;
  readonly methodCallMode: 0 | 1;
  readonly defaultBlendTime: number;
  readonly values: Map<string, GodotPixiAnimationValue>;
  /** Stable property pose under additive AnimationTree branches; never feed last frame back in. */
  readonly treeBaseValues: Map<string, GodotPixiInterpolatedValue>;
  readonly treePositions: Map<string, number>;
  readonly queue: string[];
  blendFrom: Map<string, GodotPixiAnimationValue> | undefined;
  blendElapsed: number;
  blendDuration: number;
  playbackSpeed: number;
  direction: 1 | -1;
  currentName: string;
  position: number;
  playing: boolean;
}

export function createPixiAnimationPlayer(options: {
  animations: readonly GodotPixiAnimationSpec[];
  next?: Readonly<Record<string, string>>;
  resolve: (path: string) => GodotPixiAnimationSetter;
  invoke?: (path: string, method: string, args: readonly unknown[]) => void;
  defer: (invoke: () => void) => void;
  methodCallMode?: 0 | 1;
  playbackSpeed?: number;
  defaultBlendTime?: number;
  autoplay?: string;
}): GodotPixiAnimationPlayer {
  const clips = new Map(options.animations.map((spec) => [spec.name, new GodotPixiAnimation(spec)]));
  const speed = options.playbackSpeed ?? 1;
  const blend = options.defaultBlendTime ?? 0;
  const methodCallMode = options.methodCallMode ?? 0;
  if (!Number.isFinite(speed) || speed < 0) throw new Error(`Godot Pixi AnimationPlayer cannot carry playback_speed ${speed}.`);
  if (!Number.isFinite(blend) || blend < 0) throw new Error(`Godot Pixi AnimationPlayer blend time is invalid: ${blend}.`);
  if (methodCallMode !== 0 && methodCallMode !== 1) {
    throw new RangeError('Godot Pixi AnimationPlayer method_call_mode must be DEFERRED (0) or IMMEDIATE (1).');
  }
  if (typeof options.defer !== 'function') {
    throw new TypeError('Godot Pixi AnimationPlayer requires the SceneTree deferred-call queue.');
  }
  const player: GodotPixiAnimationPlayer = {
    __godotPixiAnimationPlayer: true,
    clips,
    next: new Map(Object.entries(options.next ?? {})),
    resolve: options.resolve,
    invoke: options.invoke ?? ((path, method) => { throw new Error(`Godot Animation method track cannot invoke "${method}" on "${path}".`); }),
    defer: options.defer,
    methodCallMode,
    defaultBlendTime: blend,
    values: new Map(),
    treeBaseValues: new Map(),
    treePositions: new Map(),
    queue: [],
    blendFrom: undefined,
    blendElapsed: 0,
    blendDuration: 0,
    playbackSpeed: speed,
    direction: 1,
    currentName: '',
    position: 0,
    playing: false,
  };
  if (options.autoplay !== undefined && options.autoplay !== '') playPixiAnimation(player, options.autoplay);
  return player;
}

/** Godot 3 AnimationPlayer's METHOD_CALL_DEFERRED/IMMEDIATE dispatch at the crossed key. */
function invokePixiAnimationMethod(
  player: GodotPixiAnimationPlayer,
  path: string,
  method: string,
  args: readonly unknown[],
): void {
  const invoke = (): void => player.invoke(path, method, args);
  if (player.methodCallMode === 0) player.defer(invoke);
  else invoke();
}

/**
 * An authoring-only prefab retains authored method-track data but has no mounted ScriptInstance.
 * Keep the refusal at the runtime boundary: importing the document is valid; executing its absent
 * target is not.
 */
export function refuseOffRuntimePixiAnimationMethod(
  scenePath: string,
  nodePath: string,
  method: string,
  args: readonly unknown[],
): never {
  throw new Error(
    `godot-compat: Animation method ${scenePath}#${nodePath}.${method}/${args.length} has no live ` +
      'ScriptInstance because this prefab is outside the mounted runtime closure.',
  );
}

/**
 * An authoring-only prefab retains authored value-track data but has no mounted ScriptInstance.
 * Source analysis has already proved that the property exists and accepts this Variant shape;
 * execution remains a runtime error until the prefab belongs to the mounted runtime closure.
 */
export function refuseOffRuntimePixiAnimationProperty(
  scenePath: string,
  nodePath: string,
  property: string,
  value: unknown,
): never {
  void value;
  throw new Error(
    `godot-compat: Animation property ${scenePath}#${nodePath}:${property} has no live ` +
      'ScriptInstance because this prefab is outside the mounted runtime closure.',
  );
}

export function hasPixiAnimation(player: GodotPixiAnimationPlayer, name: string): boolean {
  return player.clips.has(name);
}

export function getPixiAnimation(player: GodotPixiAnimationPlayer, name: string): GodotPixiAnimation {
  const animation = player.clips.get(name);
  if (animation === undefined) throw new Error(`Godot AnimationPlayer has no animation "${name}".`);
  return animation;
}

export function addPixiAnimation(player: GodotPixiAnimationPlayer, name: string, animation: GodotPixiAnimation): number {
  if (name === '') return 31; // ERR_INVALID_PARAMETER
  player.clips.set(name, animation);
  return 0;
}

export function playPixiAnimation(player: GodotPixiAnimationPlayer, name: string, customBlend = -1): void {
  getPixiAnimation(player, name);
  if (!Number.isFinite(customBlend) || customBlend < -1) throw new Error(`Godot AnimationPlayer custom_blend is invalid: ${customBlend}`);
  player.blendDuration = customBlend >= 0 ? customBlend : player.defaultBlendTime;
  player.blendFrom = player.playing && player.blendDuration > 0 ? new Map(player.values) : undefined;
  player.blendElapsed = 0;
  player.position = 0;
  player.direction = 1;
  player.currentName = name;
  player.playing = true;
  applyPixiAnimation(player);
}

/** Runtime Object.call/callv entry preserving Godot's optional play argument count. */
export function playPixiAnimationDynamic(
  player: GodotPixiAnimationPlayer,
  args: readonly unknown[],
): void {
  if (args.length > 2) {
    throw new Error(
      'godot-compat: AnimationPlayer.play dynamic dispatch supports name and custom_blend; ' +
        'custom_speed/from_end require playback axes this retained player does not carry.',
    );
  }
  const name = args[0] ?? '';
  if (typeof name !== 'string') {
    throw new TypeError('godot-compat: AnimationPlayer.play requires an animation name.');
  }
  const blend = args[1];
  if (blend !== undefined && typeof blend !== 'number') {
    throw new TypeError('godot-compat: AnimationPlayer.play custom_blend requires a number.');
  }
  playPixiAnimation(player, name, blend);
}

export function playPixiAnimationBackwards(player: GodotPixiAnimationPlayer, name: string, customBlend = -1): void {
  const animation = getPixiAnimation(player, name);
  for (let track = 0; track < animation.get_track_count(); track += 1) {
    if (animation.authoredTrack(track).kind === 'method') {
      throw new Error('AnimationPlayer.play_backwards cannot carry reverse method-track invocation order.');
    }
  }
  playPixiAnimation(player, name, customBlend);
  player.position = animation.length;
  player.direction = -1;
  applyPixiAnimation(player);
}

/** Queue a named clip behind the retained playback head; an idle player starts immediately. */
export function queuePixiAnimation(player: GodotPixiAnimationPlayer, name: string): void {
  getPixiAnimation(player, name);
  if (!player.playing) {
    playPixiAnimation(player, name);
    return;
  }
  player.queue.push(name);
}

export function getPixiAnimationQueue(player: GodotPixiAnimationPlayer): readonly string[] {
  return [...player.queue];
}

export function clearPixiAnimationQueue(player: GodotPixiAnimationPlayer): void {
  player.queue.length = 0;
}

export function isPixiAnimationPlaying(player: GodotPixiAnimationPlayer): boolean {
  return player.playing;
}

export function pausePixiAnimation(player: GodotPixiAnimationPlayer): void {
  player.playing = false;
}

export function getPixiAnimationPlayingSpeed(player: GodotPixiAnimationPlayer): number {
  return player.playing ? player.playbackSpeed : 0;
}

export function isPixiAnimationPlayerValid(player: GodotPixiAnimationPlayer): boolean {
  return player.__godotPixiAnimationPlayer === true;
}

export function getPixiPlaybackSpeed(player: GodotPixiAnimationPlayer): number {
  return player.playbackSpeed;
}

export function setPixiPlaybackSpeed(player: GodotPixiAnimationPlayer, speed: number): void {
  if (!Number.isFinite(speed) || speed < 0) throw new Error(`Godot AnimationPlayer playback_speed cannot be carried: ${speed}`);
  player.playbackSpeed = speed;
}

export function getPixiCurrentAnimation(player: GodotPixiAnimationPlayer): string {
  return player.currentName;
}

export function getPixiAssignedAnimation(player: GodotPixiAnimationPlayer): string {
  return player.currentName;
}

export function setPixiAssignedAnimation(player: GodotPixiAnimationPlayer, name: string): void {
  if (typeof name !== 'string') throw new TypeError('AnimationPlayer.assigned_animation requires StringName.');
  if (name === '') {
    player.currentName = '';
    player.position = 0;
    player.playing = false;
    return;
  }
  getPixiAnimation(player, name);
  player.currentName = name;
  player.position = 0;
  player.playing = false;
}

export function setPixiCurrentAnimation(player: GodotPixiAnimationPlayer, name: string): void {
  if (name === '') {
    stopPixiAnimation(player);
    return;
  }
  if (player.playing && player.currentName === name) return;
  playPixiAnimation(player, name);
}

export function getPixiAnimationPosition(player: GodotPixiAnimationPlayer): number {
  return player.position;
}

export function getPixiAnimationLength(player: GodotPixiAnimationPlayer): number {
  return player.currentName === '' ? 0 : getPixiAnimation(player, player.currentName).length;
}

export function stopPixiAnimation(player: GodotPixiAnimationPlayer, reset = true): void {
  player.playing = false;
  if (reset) {
    player.currentName = '';
    player.position = 0;
  }
}

export function seekPixiAnimation(player: GodotPixiAnimationPlayer, time: number, update = false): void {
  player.position = time;
  if (update && player.currentName !== '') applyPixiAnimation(player);
}

export function advancePixiAnimationPlayer(player: GodotPixiAnimationPlayer, delta: number): void {
  if (!player.playing || player.currentName === '') return;
  if (!Number.isFinite(delta) || delta < 0) {
    throw new Error(`Godot Pixi AnimationPlayer cannot carry negative/non-finite advance(${delta}).`);
  }
  const playbackName = player.currentName;
  const animation = getPixiAnimation(player, player.currentName);
  const previous = player.position;
  const elapsed = delta * player.playbackSpeed;
  if (!Number.isFinite(elapsed)) {
    throw new Error(`Godot Pixi AnimationPlayer advance(${delta}) overflows at playback_speed ${player.playbackSpeed}.`);
  }
  const unwrappedPosition = previous + elapsed * player.direction;
  if (animation.loop && animation.length > 0 && Math.abs(Math.floor(unwrappedPosition / animation.length)) > 1) {
    throw new Error(
      `Godot Pixi AnimationPlayer advance(${delta}) crosses more than one loop of "${playbackName}"; ` +
      'method-track key order would be ambiguous on this retained frame clock.',
    );
  }
  player.position = unwrappedPosition;
  player.blendElapsed += delta;
  let wrapped = false;
  if (animation.loop && animation.length > 0) {
    player.position = ((unwrappedPosition % animation.length) + animation.length) % animation.length;
    wrapped = unwrappedPosition >= animation.length || unwrappedPosition < 0;
  }
  else if (player.position >= animation.length || player.position <= 0) {
    player.position = player.direction > 0 ? animation.length : 0;
    player.playing = false;
  }
  for (let track = 0; track < animation.get_track_count(); track += 1) {
    const authored = animation.authoredTrack(track);
    if (!authored.enabled || authored.kind !== 'method') continue;
    const invokeInterval = (after: number, through: number, includeStart: boolean): void => {
      for (const key of authored.keys) {
        if ((includeStart ? key.time >= after : key.time > after) && key.time <= through) {
          invokePixiAnimationMethod(player, authored.path, key.method, key.args);
        }
      }
    };
    if (wrapped) {
      invokeInterval(previous, animation.length, false);
      invokeInterval(0, player.position, true);
    } else invokeInterval(previous, player.position, false);
  }
  applyPixiAnimation(player);
  if (player.blendElapsed >= player.blendDuration) player.blendFrom = undefined;
  if (!player.playing) {
    const next = player.queue.shift() ?? player.next.get(playbackName);
    if (next !== undefined && next !== '') playPixiAnimation(player, next);
  }
}

function applyPixiAnimation(player: GodotPixiAnimationPlayer): void {
  const animation = getPixiAnimation(player, player.currentName);
  for (let track = 0; track < animation.get_track_count(); track += 1) {
    const authored = animation.authoredTrack(track);
    if (!authored.enabled) continue;
    let value: GodotPixiAnimationValue | undefined;
    if (authored.kind === 'bezier') {
      value = animation.sample(track, player.position);
    } else if (authored.kind === 'discrete') {
      const key = [...authored.keys].reverse().find((candidate) => candidate.time <= player.position);
      if (key !== undefined) value = key.value;
    } else if (authored.kind === 'interpolated') {
      value = sampleInterpolated(authored, animation, player.position);
    }
    if (authored.kind !== 'method' && value !== undefined) {
      const from = player.blendFrom?.get(authored.path);
      if (
        authored.kind !== 'discrete' &&
        from !== undefined && from !== null && typeof from !== 'boolean' && typeof from !== 'string' &&
        value !== null && typeof value !== 'boolean' && typeof value !== 'string' &&
        player.blendDuration > 0
      ) {
        const weight = Math.min(1, player.blendElapsed / player.blendDuration);
        value = linearValue(from, value, weight);
      }
      player.resolve(authored.path)(value);
      player.values.set(authored.path, value);
    }
  }
}

function pixiTrackIncluded(drive: LeafDrive, path: string): boolean {
  return drive.trackScopes?.every((scope) => {
    const matched = scope.paths.some((candidate) => candidate === path || candidate.endsWith(`:${path}`));
    return scope.include ? matched : !matched;
  }) ?? true;
}

/** Drive the retained Pixi properties from the same authored AnimationTree evaluator Three uses. */
export function applyPixiAnimationTree(
  tree: AnimationTreeState,
  player: GodotPixiAnimationPlayer,
  delta: number,
): void {
  const timings = new Map([...player.clips].map(([name, clip]) => [name, {
    length: clip.length,
    loop: clip.loop,
  }]));
  const drives = animationTreeFrame(tree, timings, delta);
  if (!tree.active) {
    player.playing = false;
    return;
  }
  player.playing = true;
  const weighted = new Map<string, {
    normal: GodotPixiInterpolatedValue | undefined;
    additive: GodotPixiInterpolatedValue | undefined;
    normalWeight: number;
  }>();
  let dominant: LeafDrive | undefined;
  for (const drive of drives) {
    const animation = getPixiAnimation(player, drive.clip);
    const previous = player.treePositions.get(drive.clip) ?? 0;
    let position = drive.reset ? 0 : previous;
    if (drive.seek !== undefined) position = Math.max(0, drive.seek);
    else position += delta * drive.timeScale * player.playbackSpeed;
    if (animation.loop && animation.length > 0) {
      position = ((position % animation.length) + animation.length) % animation.length;
    } else position = Math.max(0, Math.min(animation.length, position));
    player.treePositions.set(drive.clip, position);
    if (dominant === undefined || drive.weight > dominant.weight) dominant = drive;
    for (let track = 0; track < animation.get_track_count(); track += 1) {
      const authored = animation.authoredTrack(track);
      if (!authored.enabled || authored.kind === 'method' || !pixiTrackIncluded(drive, authored.path)) continue;
      const value = authored.kind === 'bezier'
        ? animation.sample(track, position)
        : authored.kind === 'interpolated'
          ? sampleInterpolated(authored, animation, position)
          : [...authored.keys].reverse().find((candidate) => candidate.time <= position)?.value ?? 0;
      if (value === undefined) continue;
      if (typeof value === 'boolean' || typeof value === 'string' || value === null) {
        throw new TypeError(`Godot Pixi AnimationTree cannot weight non-interpolable discrete track ${authored.path}.`);
      }
      const entry = weighted.get(authored.path) ?? { normal: undefined, additive: undefined, normalWeight: 0 };
      const contribution = scaleValue(value, drive.weight);
      if (drive.blendMode === 'additive') {
        entry.additive = entry.additive === undefined ? contribution : addValue(entry.additive, contribution);
      }
      else {
        entry.normal = entry.normal === undefined ? contribution : addValue(entry.normal, contribution);
        entry.normalWeight += drive.weight;
      }
      weighted.set(authored.path, entry);
    }
    const wrapped = animation.loop && animation.length > 0 && position < previous;
    if (position >= previous || wrapped) {
      for (let track = 0; track < animation.get_track_count(); track += 1) {
        const authored = animation.authoredTrack(track);
        if (!authored.enabled || authored.kind !== 'method' || drive.weight <= 0) continue;
        for (const key of authored.keys) {
          if ((!wrapped && key.time > previous && key.time <= position) ||
              (wrapped && (key.time > previous || key.time <= position))) {
            invokePixiAnimationMethod(player, authored.path, key.method, key.args);
          }
        }
      }
    }
  }
  for (const [path, value] of weighted) {
    const shape = value.normal ?? value.additive ?? 0;
    if (!player.treeBaseValues.has(path)) {
      const retained = player.values.get(path);
      if (retained === null || typeof retained === 'boolean' || typeof retained === 'string') {
        throw new TypeError(
          `Godot Pixi AnimationTree cannot blend interpolated track ${path} over a discrete base value.`,
        );
      }
      player.treeBaseValues.set(path, retained ?? mapValue(shape, () => 0));
    }
    const base = value.normalWeight > 0
      ? value.normal as GodotPixiInterpolatedValue
      : player.treeBaseValues.get(path) as GodotPixiInterpolatedValue;
    const resolved = value.additive === undefined ? base : addValue(base, value.additive);
    player.resolve(path)(resolved);
    player.values.set(path, resolved);
  }
  player.currentName = dominant?.clip ?? '';
  player.position = dominant === undefined ? 0 : (player.treePositions.get(dominant.clip) ?? 0);
}
