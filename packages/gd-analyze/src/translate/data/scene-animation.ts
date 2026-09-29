/**
 * An AnimationPlayer's libraries as data files, and its tracks' paths resolved at import: the
 * `AnimationLibrary` a scene declares becomes the data file compat's `godot_animation_library_load`
 * reads (`Animation::_set`, `animation.cpp:59`, as its fields), and each value track's property and
 * each method track's native method on the node its path names become the bindings the player
 * receives (GODOT.md, "The output is idiomatic three.js").
 */
import type { BoundGodotResourceData } from '../../analyze/bound-project';
import type { GodotValue } from '../../read/godot-value';

/** A key value as the data file writes it (compat `animation.ts`'s `GodotAnimationKeyData`). */
export type GodotAnimationKeyData =
  | number
  | boolean
  | { readonly Vector3: readonly [number, number, number] }
  | { readonly Quaternion: readonly [number, number, number, number] }
  | { readonly Color: readonly [number, number, number, number] }
  | { readonly method: string; readonly args: readonly (number | boolean | string)[] }
  /** An audio key: the library's stream at `audio` (its `streams`), played from `start` to `end` before its length. */
  | { readonly audio: number; readonly start: number; readonly end: number };

/** An audio key as read, before its library resolves the stream: the stream's resource reference. */
export interface GodotAnimationAudioRef {
  readonly audioRef: GodotValue;
  readonly start: number;
  readonly end: number;
}

export type GodotAnimationTrackType = 'value' | 'position_3d' | 'rotation_3d' | 'scale_3d' | 'method' | 'audio';

/** An animation as the data file writes it (compat `animation.ts`'s `GodotAnimationData`). */
export interface GodotAnimationData {
  readonly length: number;
  readonly loopMode: number;
  readonly step: number;
  readonly tracks: readonly {
    readonly type: GodotAnimationTrackType;
    readonly path: string;
    readonly interp: number;
    readonly loopWrap: boolean;
    readonly enabled: boolean;
    readonly imported: boolean;
    readonly update: number;
    readonly keys: readonly (readonly [number, number, GodotAnimationKeyData | GodotAnimationAudioRef])[];
  }[];
}

/** A library's animations by name, in its `_data` order, and the streams its audio keys play (planned resource keys). */
export interface TargetGodotAnimationLibraryPlan {
  readonly animations: readonly { readonly name: string; readonly animation: GodotAnimationData }[];
  readonly streams?: readonly string[];
}

/** A compat export a track binds to. */
export interface TargetGodotAnimationExport {
  readonly module: string;
  readonly exportName: string;
  readonly localName: string;
}

/**
 * What a player's tracks resolve to: each value track's property (the setter, with its index, or a
 * script field) and each method track's native methods, by the track's path.
 */
export interface TargetGodotAnimationBindingsPlan {
  readonly values: readonly {
    readonly path: string;
    readonly binding:
      | {
          readonly setter: TargetGodotAnimationExport;
          readonly index?: number | string;
          /**
           * A sub-property (`position:y`, `surface_material_override/0:albedo_color`): the
           * property read through its getter, then its member replaced (a built-in's) or its
           * resource's property set (`Object::set_indexed`, `object.cpp:560`).
           */
          readonly getter?: TargetGodotAnimationExport;
          readonly member?: string;
          readonly resource?: { readonly setter: TargetGodotAnimationExport; readonly index?: number | string };
        }
      | { readonly field: string };
  }[];
  readonly methods: readonly { readonly path: string; readonly method: string; readonly binding: TargetGodotAnimationExport }[];
}

const f32 = Math.fround;

/** `Animation::_set`'s track types (`animation.cpp:106`) this translation writes. */
const TRACK_TYPES = new Set<GodotAnimationTrackType>(['value', 'position_3d', 'rotation_3d', 'scale_3d', 'method', 'audio']);
/** Floats per key of a packed 3D track: time, transition, the value (`animation.cpp:30`). */
const PACKED_SIZE: Readonly<Record<string, number>> = { position_3d: 5, rotation_3d: 6, scale_3d: 5 };

function numbersOf(value: GodotValue | undefined): number[] | undefined {
  if (value?.kind === 'ctor' && (value.name === 'PackedFloat32Array' || value.name === 'PackedFloat64Array')) {
    const out = value.args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
    return out.every((entry): entry is number => entry !== undefined) ? out : undefined;
  }
  if (value?.kind === 'array') {
    const out = value.items.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
    return out.every((entry): entry is number => entry !== undefined) ? out : undefined;
  }
  return undefined;
}

function entry(value: GodotValue | undefined, key: string): GodotValue | undefined {
  return value?.kind === 'dict' ? value.entries.find((item) => item.key === key)?.value : undefined;
}

/** A value key as the data file writes it, or why it has none. */
function valueKey(value: GodotValue): GodotAnimationKeyData | string {
  if (value.kind === 'bool') return value.value;
  if (value.kind === 'number') return value.variantType === 'int' ? 'an int key' : value.value;
  if (value.kind === 'ctor' && (value.name === 'Vector3' || value.name === 'Quaternion' || value.name === 'Color')) {
    const args = value.args.map((arg) => (arg.kind === 'number' ? f32(arg.value) : undefined));
    if (!args.every((arg): arg is number => arg !== undefined)) return `a ${value.name} key`;
    if (value.name === 'Vector3' && args.length === 3) return { Vector3: args as [number, number, number] };
    if (value.name === 'Quaternion' && args.length === 4) return { Quaternion: args as [number, number, number, number] };
    if (value.name === 'Color' && args.length === 4) return { Color: args as [number, number, number, number] };
  }
  return `a ${value.kind === 'ctor' ? value.name : value.kind} key`;
}

/** A method key (`{ "args": […], "method": &"name" }`), or why it has none. */
function methodKey(value: GodotValue): GodotAnimationKeyData | string {
  const method = entry(value, 'method');
  const args = entry(value, 'args');
  if (method?.kind !== 'string' || args?.kind !== 'array') return 'a method key without a method name and arguments';
  const out: (number | boolean | string)[] = [];
  for (const arg of args.items) {
    if (arg.kind === 'number' || arg.kind === 'bool' || arg.kind === 'string') out.push(arg.value);
    else return `a method argument of kind ${arg.kind === 'ctor' ? arg.name : arg.kind}`;
  }
  return { method: method.value, args: out };
}

/**
 * An `Animation` resource as its data file, or why it has none (a track type, interpolation or key
 * this translation does not write, compressed tracks, markers).
 */
export function godotAnimationData(resource: BoundGodotResourceData): GodotAnimationData | string {
  const props = resource.properties;
  const tracks = new Map<number, Map<string, GodotValue>>();
  let length = 1;
  let loopMode = 0;
  let step = f32(1 / 30);
  for (const [name, value] of Object.entries(props)) {
    const track = /^tracks\/(\d+)\/(.+)$/u.exec(name);
    if (track !== null) {
      const index = Number(track[1]);
      const fields = tracks.get(index) ?? new Map<string, GodotValue>();
      fields.set(track[2] as string, value);
      tracks.set(index, fields);
      continue;
    }
    if (name === 'resource_name' || (name === 'script' && value.kind === 'null')) continue;
    if (name === 'length' && value.kind === 'number') length = Math.max(value.value, 0.001);
    else if (name === 'loop_mode' && value.kind === 'number') loopMode = value.value;
    else if (name === 'step' && value.kind === 'number') step = f32(value.value);
    else return `Animation.${name} is not translated`;
  }
  if (loopMode === 2) return 'a ping-pong loop is not translated';
  const out: GodotAnimationData['tracks'][number][] = [];
  for (let index = 0; index < tracks.size; index += 1) {
    const fields = tracks.get(index);
    if (fields === undefined) return `track ${String(index)} is missing`;
    const type = fields.get('type');
    if (type?.kind !== 'string' || !TRACK_TYPES.has(type.value as GodotAnimationTrackType)) {
      return `a ${type?.kind === 'string' ? type.value : 'typeless'} track is not translated`;
    }
    const kind = type.value as GodotAnimationTrackType;
    const pathValue = fields.get('path');
    const path = pathValue?.kind === 'ctor' && pathValue.name === 'NodePath' && pathValue.args[0]?.kind === 'string' ? pathValue.args[0].value : pathValue?.kind === 'string' ? pathValue.value : undefined;
    if (path === undefined) return `track ${String(index)} has no path`;
    const bool = (name: string, initial: boolean) => {
      const value = fields.get(name);
      return value?.kind === 'bool' ? value.value : initial;
    };
    const interpValue = fields.get('interp');
    const interp = interpValue?.kind === 'number' ? interpValue.value : 1;
    // `INTERPOLATION_NEAREST`, `INTERPOLATION_LINEAR` and `INTERPOLATION_CUBIC` (`animation.h:60`),
    // cubic sampled as linear (`animation.ts`).
    if (interp !== 0 && interp !== 1 && interp !== 2) return `track ${String(index)}'s interpolation ${String(interp)} is not translated`;
    for (const name of fields.keys()) {
      // An audio track's `use_blend` mixes its volume by the blend weight (`animation_mixer.cpp:1776`); it plays at full volume here.
      if (!['type', 'path', 'interp', 'loop_wrap', 'imported', 'enabled', 'keys', ...(kind === 'audio' ? ['use_blend'] : [])].includes(name)) return `track ${String(index)}'s ${name} is not translated`;
    }
    const keysValue = fields.get('keys');
    const keys: (readonly [number, number, GodotAnimationKeyData | GodotAnimationAudioRef])[] = [];
    let update = 0;
    if (kind === 'audio') {
      // `{ "clips": [{ "start_offset", "end_offset", "stream" }], "times": … }` (`Animation::_set`, `animation.cpp:340`).
      const times = numbersOf(entry(keysValue, 'times'));
      const clips = entry(keysValue, 'clips');
      if (times === undefined || clips?.kind !== 'array' || times.length !== clips.items.length) return `track ${String(index)}'s keys are not times and clips`;
      for (let key = 0; key < times.length; key += 1) {
        const clip = clips.items[key] as GodotValue;
        const stream = entry(clip, 'stream');
        const start = entry(clip, 'start_offset');
        const end = entry(clip, 'end_offset');
        if (stream === undefined || stream.kind === 'null') return `track ${String(index)} has an audio key without a stream`;
        keys.push([f32(times[key] as number), 1, { audioRef: stream, start: start?.kind === 'number' ? start.value : 0, end: end?.kind === 'number' ? end.value : 0 }]);
      }
      out.push({ type: kind, path, interp, loopWrap: bool('loop_wrap', true), enabled: bool('enabled', true), imported: bool('imported', false), update: 0, keys });
      continue;
    }
    if (kind === 'value' || kind === 'method') {
      const times = numbersOf(entry(keysValue, 'times'));
      const transitions = entry(keysValue, 'transitions') === undefined ? undefined : numbersOf(entry(keysValue, 'transitions'));
      const values = entry(keysValue, 'values');
      if (times === undefined || values?.kind !== 'array' || times.length !== values.items.length) return `track ${String(index)}'s keys are not times and values`;
      if (transitions !== undefined && transitions.length !== times.length) return `track ${String(index)}'s transitions do not match its keys`;
      if (kind === 'value') {
        const mode = entry(keysValue, 'update');
        // `Animation::_set` clamps the update mode (`animation.cpp:230`); capture is not translated.
        update = mode?.kind === 'number' ? Math.min(Math.max(mode.value, 0), 3) : 0;
        if (update === 2) return `track ${String(index)} captures, which is not translated`;
      }
      for (let key = 0; key < times.length; key += 1) {
        const value = (kind === 'value' ? valueKey : methodKey)(values.items[key] as GodotValue);
        if (typeof value === 'string') return `track ${String(index)} has ${value}`;
        keys.push([f32(times[key] as number), f32(transitions?.[key] ?? 1), value]);
      }
    } else {
      const packed = numbersOf(keysValue);
      const size = PACKED_SIZE[kind] as number;
      if (packed === undefined || packed.length % size !== 0) return `track ${String(index)}'s keys are not packed ${kind} keys`;
      for (let at = 0; at < packed.length; at += size) {
        const v = packed.slice(at + 2, at + size).map(f32);
        keys.push([f32(packed[at] as number), f32(packed[at + 1] as number), kind === 'rotation_3d' ? { Quaternion: v as [number, number, number, number] } : { Vector3: v as [number, number, number] }]);
      }
    }
    out.push({ type: kind, path, interp, loopWrap: bool('loop_wrap', true), enabled: bool('enabled', true), imported: bool('imported', false), update, keys });
  }
  return { length, loopMode, step, tracks: out };
}

/** The node path and subnames of a track path (`Circle:rotation`). */
export function godotTrackPath(path: string): { readonly node: string; readonly subnames: readonly string[] } {
  const at = path.indexOf(':');
  return at === -1 ? { node: path, subnames: [] } : { node: path.slice(0, at), subnames: path.slice(at + 1).split(':') };
}

/**
 * A node path relative to `from` (a scene node path, `.` the root), or undefined when it leaves the
 * scene or names a unique node.
 */
export function godotResolveNodePath(from: string, path: string): string | undefined {
  if (path.startsWith('/')) return undefined;
  const parts = from === '.' ? [] : from.split('/');
  for (const name of path.split('/')) {
    if (name === '' || name === '.') continue;
    if (name.startsWith('%')) return undefined;
    if (name === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(name);
    }
  }
  return parts.length === 0 ? '.' : parts.join('/');
}

/** Where a library's data file is written, beside its scene. */
export function godotAnimationLibraryDataPath(sceneTargetPath: string, key: string): string {
  const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/gu, '_');
  return `${sceneTargetPath.replace(/\.tsx$/u, '')}.${safe(key.replace(/^(sub|ext):/u, ''))}.animations.ts`;
}

/** A blend-tree node as the data file writes it (compat `animation-tree.ts`'s `GodotAnimationNodeData`). */
export type GodotAnimationNodeData =
  | { readonly type: 'animation'; readonly animation: string }
  | { readonly type: 'blend2'; readonly sync?: boolean; readonly filterEnabled?: boolean; readonly filters?: readonly string[] }
  | { readonly type: 'time-scale' }
  | {
      readonly type: 'one-shot';
      readonly mixMode?: number;
      readonly fadeIn?: number;
      readonly fadeOut?: number;
      readonly sync?: boolean;
      readonly breakLoopAtEnd?: boolean;
      readonly abortOnReset?: boolean;
      readonly autoRestart?: boolean;
      readonly autoRestartDelay?: number;
      readonly autoRestartRandomDelay?: number;
      readonly filterEnabled?: boolean;
      readonly filters?: readonly string[];
    }
  | { readonly type: 'blend-tree'; readonly nodes: readonly { readonly name: string; readonly node: GodotAnimationNodeData }[]; readonly connections: readonly (readonly [string, number, string])[] };

/**
 * An `AnimationNode` graph as its data file, or why it has none: a blend tree
 * (`AnimationNodeBlendTree::_set`, `animation_blend_tree.cpp:1740`: `nodes/NAME/node`,
 * `node_connections`; positions and the graph offset are the editor's), its animation, Blend2 and
 * TimeScale nodes, each a resource of the same document.
 */
export function godotAnimationNodeData(resource: BoundGodotResourceData, resolve: (value: GodotValue) => BoundGodotResourceData | undefined): GodotAnimationNodeData | string {
  const props = resource.properties;
  const own = Object.entries(props).filter(([name, value]) => name !== 'resource_name' && !(name === 'script' && value.kind === 'null'));
  switch (resource.type) {
    case 'AnimationNodeAnimation': {
      let animation = '';
      for (const [name, value] of own) {
        if (name === 'animation' && value.kind === 'string') animation = value.value;
        else return `AnimationNodeAnimation.${name} is not translated`;
      }
      return { type: 'animation', animation };
    }
    case 'AnimationNodeBlend2': {
      let sync = false;
      let filterEnabled = false;
      const filters: string[] = [];
      for (const [name, value] of own) {
        if (name === 'sync' && value.kind === 'bool') sync = value.value;
        else if (name === 'filter_enabled' && value.kind === 'bool') filterEnabled = value.value;
        else if (name === 'filters' && value.kind === 'array' && value.items.every((item) => item.kind === 'string')) filters.push(...value.items.map((item) => (item as { readonly value: string }).value));
        else return `AnimationNodeBlend2.${name} is not translated`;
      }
      return { type: 'blend2', ...(sync ? { sync } : {}), ...(filterEnabled ? { filterEnabled } : {}), ...(filters.length === 0 ? {} : { filters }) };
    }
    case 'AnimationNodeOneShot': {
      // `AnimationNodeOneShot`'s properties (`animation_blend_tree.cpp:520`); the fade curves are not translated.
      const out: Record<string, unknown> = {};
      const names: Readonly<Record<string, string>> = {
        mix_mode: 'mixMode',
        fadein_time: 'fadeIn',
        fadeout_time: 'fadeOut',
        sync: 'sync',
        break_loop_at_end: 'breakLoopAtEnd',
        abort_on_reset: 'abortOnReset',
        autorestart: 'autoRestart',
        autorestart_delay: 'autoRestartDelay',
        autorestart_random_delay: 'autoRestartRandomDelay',
        filter_enabled: 'filterEnabled',
      };
      const filters: string[] = [];
      for (const [name, value] of own) {
        const key = names[name];
        if (key !== undefined && (value.kind === 'number' || value.kind === 'bool')) out[key] = value.value;
        else if (name === 'filters' && value.kind === 'array' && value.items.every((item) => item.kind === 'string')) filters.push(...value.items.map((item) => (item as { readonly value: string }).value));
        else return `AnimationNodeOneShot.${name} is not translated`;
      }
      return { type: 'one-shot', ...out, ...(filters.length === 0 ? {} : { filters }) };
    }
    case 'AnimationNodeTimeScale':
      return own.length === 0 ? { type: 'time-scale' } : `AnimationNodeTimeScale.${own[0]?.[0] ?? ''} is not translated`;
    case 'AnimationNodeBlendTree': {
      const nodes: { name: string; node: GodotAnimationNodeData }[] = [];
      const connections: (readonly [string, number, string])[] = [];
      for (const [name, value] of own) {
        const node = /^nodes\/([^/]+)\/(node|position)$/u.exec(name);
        if (node !== null) {
          if (node[2] === 'position') continue;
          const child = resolve(value);
          if (child === undefined) return `the blend tree's ${node[1] as string} is not a resource of this document`;
          const data = godotAnimationNodeData(child, resolve);
          if (typeof data === 'string') return data;
          nodes.push({ name: node[1] as string, node: data });
        } else if (name === 'node_connections' && value.kind === 'array') {
          for (let at = 0; at + 2 < value.items.length; at += 3) {
            const [input, index, output] = value.items.slice(at, at + 3) as [GodotValue, GodotValue, GodotValue];
            if (input.kind !== 'string' || index.kind !== 'number' || output.kind !== 'string') return 'a blend tree connection that is not a node, an input and a node';
            connections.push([input.value, index.value, output.value]);
          }
        } else if (name !== 'graph_offset') {
          return `AnimationNodeBlendTree.${name} is not translated`;
        }
      }
      return { type: 'blend-tree', nodes, connections };
    }
    default:
      return `a ${resource.type} is not translated`;
  }
}

/**
 * The parameters an AnimationTree over this graph has, by full name (`parameters/run/blend_amount`),
 * as compat's `animation-tree.ts` lists them (`parametersOf`, `updateProperties`): every node's
 * `current_length`, `current_position` and `current_delta` (`AnimationNode::get_parameter_list`,
 * animation_tree.cpp:54), an animation's `backward`, a Blend2's `blend_amount`, a TimeScale's
 * `scale`; a blend tree's `output` and nodes under its path.
 */
export function godotAnimationTreeParameters(root: GodotAnimationNodeData): ReadonlySet<string> {
  const names = new Set<string>();
  const core = ['current_length', 'current_position', 'current_delta'];
  const visit = (path: string, node: GodotAnimationNodeData | undefined): void => {
    const own = node === undefined ? [] : node.type === 'animation' ? ['backward'] : node.type === 'blend2' ? ['blend_amount'] : node.type === 'time-scale' ? ['scale'] : [];
    for (const name of [...core, ...own]) names.add(`${path}${name}`);
    if (node?.type !== 'blend-tree') return;
    // The tree's `output` node (`_initialize_node_tree`, animation_blend_tree.cpp:1934).
    visit(`${path}output/`, undefined);
    for (const entry of node.nodes) visit(`${path}${entry.name}/`, entry.node);
  };
  visit('parameters/', root);
  return names;
}

/** Where a blend tree's data file is written, beside its scene. */
export function godotAnimationTreeDataPath(sceneTargetPath: string, key: string): string {
  return godotAnimationLibraryDataPath(sceneTargetPath, key).replace(/\.animations\.ts$/u, '.animation-tree.ts');
}
