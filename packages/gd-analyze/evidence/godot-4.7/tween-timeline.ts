/**
 * Tween cases: nodes under the case's holder, tweens made on them or on the tree, their tweeners,
 * signals and reads, split into segments that each run in one SceneTree signal emission (the first
 * in the `process_frame` the case starts in, each later one after `await process_frame` /
 * `await physics_frame`), as `tree-timeline.ts` runs tree cases. A segment's reads sample the
 * values each frame, so a case records a tween frame by frame with its signals in the order they
 * came. The native side runs it in the official binary's main loop (fixed 60 fps); the target runs
 * the same ops through compat's exports and drives `scene-tree.ts`'s clock as `Main::iteration`
 * does. Every tween a case made is killed as it ends, on both sides.
 */
import { Group, Object3D, Scene } from 'three';
import * as CI from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-item';
import * as CT from '../../capabilities/catalog/project-source/src/lib/godot-compat/callback-tweener';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/color';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as N2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-2d';
import * as N3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/property-tweener';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as TW from '../../capabilities/catalog/project-source/src/lib/godot-compat/tween';
import * as TR from '../../capabilities/catalog/project-source/src/lib/godot-compat/tweener';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as V3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import { gd, gs } from './literals';

export type Kind = 'Node' | 'Node2D' | 'Node3D';
/** A tweened property: Node2D's `position`, `scale`, `rotation` (float) and CanvasItem's `modulate`; Node3D's `position`, `scale`. */
export type Prop = 'position' | 'scale' | 'rotation' | 'modulate';
export type Value =
  | number
  | { readonly v2: readonly [number, number] }
  | { readonly v3: readonly [number, number, number] }
  | { readonly color: readonly [number, number, number, number] };

export type TweenCall =
  | 'set_parallel'
  | 'parallel'
  | 'chain'
  | 'set_loops'
  | 'set_trans'
  | 'set_ease'
  | 'set_speed_scale'
  | 'set_process_mode'
  | 'set_pause_mode'
  | 'kill'
  | 'stop'
  | 'pause'
  | 'play'
  | 'bind_node';
export type TweenerCall = 'set_trans' | 'set_ease' | 'set_delay' | 'from' | 'from_current' | 'as_relative';
export type TweenRead = 'is_running' | 'is_valid' | 'get_loops_left' | 'get_total_elapsed_time' | 'has_tweeners';

export type Op =
  | { readonly node: string; readonly kind: Kind; readonly parent?: string }
  /** A tween made by the node's `create_tween` (bound to it), or by the tree's. */
  | { readonly tween: string; readonly on?: string }
  /** A PropertyTweener; `logNull` logs whether the call returned null. */
  | { readonly prop: string; readonly tween: string; readonly target: string; readonly property: Prop; readonly to: Value; readonly duration: number; readonly logNull?: true }
  /** A CallbackTweener whose callback logs `log`. */
  | { readonly callback: string; readonly tween: string; readonly log: string; readonly logNull?: true }
  /** A Tween method; a string argument names a node. */
  | { readonly tweenCall: string; readonly call: TweenCall; readonly args?: readonly (number | boolean | string)[] }
  | { readonly tweenerCall: string; readonly call: TweenerCall; readonly args?: readonly Value[] }
  | { readonly watch: string; readonly signal: 'finished' | 'step_finished' | 'loop_finished' }
  /** Logs a tweener's `finished`. */
  | { readonly watchTweener: string }
  | { readonly read: TweenRead; readonly of: string }
  | { readonly value: string; readonly property: Prop }
  /** A script's write to the node's property. */
  | { readonly set: string; readonly property: Prop; readonly to: Value }
  | { readonly free: string }
  | { readonly queueFree: string }
  | { readonly remove: string }
  | { readonly add: string }
  | { readonly processMode: string; readonly mode: number }
  | { readonly log: string };

export interface Segment {
  readonly await?: 'process' | 'physics';
  readonly ops: readonly Op[];
}

const DT = 1 / 60;
const FLOAT_ARGS: ReadonlySet<string> = new Set(['set_speed_scale', 'set_delay']);

function gdValue(value: Value): string {
  if (typeof value === 'number') return gd(value);
  if ('v2' in value) return `Vector2(${value.v2.map(gd).join(', ')})`;
  if ('v3' in value) return `Vector3(${value.v3.map(gd).join(', ')})`;
  return `Color(${value.color.map(gd).join(', ')})`;
}

function tsValue(value: Value): unknown {
  if (typeof value === 'number') return value;
  if ('v2' in value) return V2.construct(value.v2[0], value.v2[1]);
  if ('v3' in value) return V3.construct(value.v3[0], value.v3[1], value.v3[2]);
  return C.construct(value.color[0], value.color[1], value.color[2], value.color[3]);
}

const n = (tag: string): string => `n_${tag}`;
const t = (tag: string): string => `t_${tag}`;
const p = (tag: string): string => `p_${tag}`;

function gdOp(op: Op, tweens: string[]): string[] {
  if ('node' in op) {
    return [`var ${n(op.node)} := ${op.kind}.new()`, `${n(op.node)}.name = ${gs(op.node)}`, `${op.parent === undefined ? 'holder' : n(op.parent)}.add_child(${n(op.node)})`];
  }
  if ('tween' in op && !('prop' in op) && !('callback' in op)) {
    tweens.push(op.tween);
    return [`var ${t(op.tween)} := ${op.on === undefined ? '' : `${n(op.on)}.`}create_tween()`];
  }
  if ('prop' in op) {
    return [
      `var ${p(op.prop)} = ${t(op.tween)}.tween_property(${n(op.target)}, ${gs(op.property)}, ${gdValue(op.to)}, ${gd(op.duration)})`,
      ...(op.logNull === true ? [`log.append(${p(op.prop)} == null)`] : []),
    ];
  }
  if ('callback' in op) {
    return [`var ${p(op.callback)} = ${t(op.tween)}.tween_callback(func(): log.append(${gs(op.log)}))`, ...(op.logNull === true ? [`log.append(${p(op.callback)} == null)`] : [])];
  }
  if ('tweenCall' in op) {
    const args = (op.args ?? []).map((arg) => (typeof arg === 'string' ? n(arg) : typeof arg === 'boolean' ? String(arg) : FLOAT_ARGS.has(op.call) ? gd(arg) : String(arg)));
    return [`${t(op.tweenCall)}.${op.call}(${args.join(', ')})`];
  }
  if ('tweenerCall' in op) {
    const args = (op.args ?? []).map((arg) => (typeof arg === 'number' && !FLOAT_ARGS.has(op.call) && op.call !== 'from' ? String(arg) : gdValue(arg)));
    return [`${p(op.tweenerCall)}.${op.call}(${args.join(', ')})`];
  }
  if ('watch' in op) {
    const name = `${op.watch}:${op.signal}`;
    return [
      op.signal === 'finished'
        ? `${t(op.watch)}.finished.connect(func(): log.append(${gs(name)}))`
        : `${t(op.watch)}.${op.signal}.connect(func(i): log.append([${gs(name)}, i]))`,
    ];
  }
  if ('watchTweener' in op) return [`${p(op.watchTweener)}.finished.connect(func(): log.append(${gs(`${op.watchTweener}:finished`)}))`];
  if ('read' in op) return [`log.append(${t(op.of)}.${op.read}())`];
  if ('value' in op) return [`log.append(${n(op.value)}.${op.property})`];
  if ('set' in op) return [`${n(op.set)}.${op.property} = ${gdValue(op.to)}`];
  if ('free' in op) return [`${n(op.free)}.free()`];
  if ('queueFree' in op) return [`${n(op.queueFree)}.queue_free()`];
  if ('remove' in op) return [`${n(op.remove)}.get_parent().remove_child(${n(op.remove)})`];
  if ('add' in op) return [`holder.add_child(${n(op.add)})`];
  if ('processMode' in op) return [`${n(op.processMode)}.process_mode = ${String(op.mode)}`];
  return [`log.append(${gs(op.log)})`];
}

function gdscript(segments: readonly Segment[]): string {
  const lines = ['var log: Array = []'];
  const tweens: string[] = [];
  for (const segment of segments) {
    if (segment.await !== undefined) lines.push(segment.await === 'physics' ? 'await physics_frame' : 'await process_frame');
    for (const op of segment.ops) lines.push(...gdOp(op, tweens));
  }
  lines.push('await process_frame', 'var result := log.duplicate()', ...tweens.map((tag) => `${t(tag)}.kill()`), 'return result');
  return lines.join('\n');
}

type Getter = (self: never) => unknown;
type Setter = (self: never, value: never) => void;

/** The accessors a property of a node of this kind is tweened and read through. */
function access(kind: Kind, property: Prop): TW.GodotTweenProperty {
  if (kind === 'Node3D') {
    if (property === 'position') return { get: N3.get_position as Getter, set: N3.set_position as Setter };
    if (property === 'scale') return { get: N3.get_scale as Getter, set: N3.set_scale as Setter };
  }
  if (kind === 'Node2D') {
    if (property === 'position') return { get: N2.get_position as Getter, set: N2.set_position as Setter };
    if (property === 'scale') return { get: N2.get_scale as Getter, set: N2.set_scale as Setter };
    if (property === 'rotation') return { get: N2.get_rotation as Getter, set: N2.set_rotation as Setter };
    if (property === 'modulate') return { get: CI.get_modulate as Getter, set: CI.set_modulate as Setter };
  }
  throw new Error(`no ${kind}.${property} in the tween cases`);
}

function target(segments: readonly Segment[]): () => unknown {
  return () => {
    const log: unknown[] = [];
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const tree = ST.godot_tree();
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const nodes = new Map<string, { readonly entity: object; readonly kind: Kind }>();
    const tweens = new Map<string, TW.Tween>();
    const tweeners = new Map<string, unknown>();
    const callbacks = new Set<unknown>();
    const node = (tag: string) => nodes.get(tag) as { readonly entity: object; readonly kind: Kind };
    const tween = (tag: string) => tweens.get(tag) as TW.Tween;
    const run = (op: Op): void => {
      if ('node' in op) {
        const entity = op.kind === 'Node3D' ? new Object3D() : new Group();
        entity.name = op.node;
        if (op.kind === 'Node2D') N2.godot_node_2d_mount(entity, ['Node2D', 'CanvasItem', 'Node']);
        else N.godot_node_adopt(entity, { kind: op.kind === 'Node3D' ? 'spatial' : 'node' });
        N.add_child(op.parent === undefined ? holder : node(op.parent).entity, entity);
        nodes.set(op.node, { entity, kind: op.kind });
      } else if ('tween' in op && !('prop' in op) && !('callback' in op)) {
        tweens.set(op.tween, op.on === undefined ? ST.create_tween(tree) : N.create_tween(node(op.on).entity));
      } else if ('prop' in op) {
        const target = node(op.target);
        const made = TW.tween_property(tween(op.tween), target.entity, op.property, tsValue(op.to), op.duration, access(target.kind, op.property));
        tweeners.set(op.prop, made);
        if (op.logNull === true) log.push(made === null);
      } else if ('callback' in op) {
        const made = TW.tween_callback(tween(op.tween), () => log.push(op.log));
        tweeners.set(op.callback, made);
        callbacks.add(made);
        if (op.logNull === true) log.push(made === null);
      } else if ('tweenCall' in op) {
        const args = (op.args ?? []).map((arg) => (typeof arg === 'string' ? node(arg).entity : arg));
        (TW[op.call] as (self: TW.Tween, ...values: unknown[]) => unknown)(tween(op.tweenCall), ...args);
      } else if ('tweenerCall' in op) {
        const made = tweeners.get(op.tweenerCall);
        const args = (op.args ?? []).map((arg) => (op.call === 'from' ? tsValue(arg) : arg));
        const module = callbacks.has(made) ? CT : PT;
        (module[op.call as keyof typeof module] as (self: unknown, ...values: unknown[]) => unknown)(made, ...args);
      } else if ('watch' in op) {
        const name = `${op.watch}:${op.signal}`;
        if (op.signal === 'finished') TW.finished(tween(op.watch)).connect(() => log.push(name));
        else TW[op.signal](tween(op.watch)).connect((i: number) => log.push([name, i]));
      } else if ('watchTweener' in op) {
        TR.finished(tweeners.get(op.watchTweener) as object).connect(() => log.push(`${op.watchTweener}:finished`));
      } else if ('read' in op) {
        log.push(TW[op.read](tween(op.of)));
      } else if ('value' in op) {
        const found = node(op.value);
        log.push(access(found.kind, op.property).get(found.entity as never));
      } else if ('set' in op) {
        const found = node(op.set);
        access(found.kind, op.property).set(found.entity as never, tsValue(op.to) as never);
      } else if ('free' in op) N.godot_node_free(node(op.free).entity);
      else if ('queueFree' in op) N.queue_free(node(op.queueFree).entity);
      else if ('remove' in op) N.remove_child(N.get_parent(node(op.remove).entity) as object, node(op.remove).entity);
      else if ('add' in op) N.add_child(holder, node(op.add).entity);
      else if ('processMode' in op) N.set_process_mode(node(op.processMode).entity, op.mode);
      else log.push(op.log);
    };
    let result: unknown[] | undefined;
    const pending: (Segment & { readonly end?: true })[] = [...segments, { await: 'process', ops: [], end: true }];
    const arm = (): void => {
      const segment = pending.shift();
      if (segment === undefined) return;
      const body = (): void => {
        if (segment.end === true) {
          result = [...log];
          for (const made of tweens.values()) TW.kill(made);
          return;
        }
        for (const op of segment.ops) run(op);
        arm();
      };
      const signal = segment.await === 'physics' ? tree.physics_frame : tree.process_frame;
      signal.connect(body, { oneShot: true });
    };
    arm();
    ST.godot_tree_frame(DT);
    for (let guard = 0; result === undefined && guard < 2000; guard += 1) {
      ST.godot_tree_physics_step(DT);
      if (result !== undefined) break;
      ST.godot_tree_frame(DT);
    }
    return result;
  };
}

export function tweenCase(segments: readonly Segment[]): { readonly gdscript: string; readonly target: () => unknown } {
  return { gdscript: gdscript(segments), target: target(segments) };
}

/** `count` process frames, each logging the reads in `sample`. */
export function frames(count: number, ...sample: Op[]): Segment[] {
  return Array.from({ length: count }, () => ({ await: 'process' as const, ops: sample }));
}
