/**
 * Animation player cases: a small tree (`R` with a Node3D `A`, an OmniLight3D `L` and an
 * AnimationPlayer `P`), animations built through the Animation API from one spec on both sides,
 * then steps split by `await process_frame` / `await physics_frame`. Each step acts on the player
 * and reads the targets back into a log with the player's signals. The native side runs it in the
 * official binary's main loop (fixed 60 fps); the target builds the same entities, gives the
 * player the value and method bindings the scene translation would resolve for these paths, and
 * drives `scene-tree.ts`'s clock as `tree-timeline.ts` does.
 */
import { Group, Object3D, PointLight, Scene } from 'three';
import * as A from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation';
import * as AL from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-library';
import * as AM from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-mixer';
import * as AP from '../../capabilities/catalog/project-source/src/lib/godot-compat/animation-player';
import * as L3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/light-3d';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as N3 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-3d';
import { godot_omni_light_3d_mount } from '../../capabilities/catalog/project-source/src/lib/godot-compat/omni-light-3d';
import * as Q from '../../capabilities/catalog/project-source/src/lib/godot-compat/quaternion';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as SK from '../../capabilities/catalog/project-source/src/lib/godot-compat/skeleton-3d';
import * as V from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector3';
import type { GodotEvidenceCase, GodotEvidenceComparator, GodotEvidenceSymbol } from '../../src/evidence/case';
import { gd, gs } from './literals';

const DT = 1 / 60;
const TRACK_TYPES = { value: 0, position_3d: 1, rotation_3d: 2, scale_3d: 3, method: 5 } as const;

/** A method argument: a float, or an int (`{ int }`). */
export type Arg = number | { readonly int: number };
export type KeyValue = number | boolean | readonly [number, number, number] | readonly [number, number, number, number] | { readonly method: string; readonly args: readonly Arg[] };

export interface TrackSpec {
  readonly type: keyof typeof TRACK_TYPES;
  readonly path: string;
  readonly update?: number;
  readonly interp?: number;
  readonly keys: readonly (readonly [number, KeyValue, number?])[];
}

export interface AnimSpec {
  readonly name: string;
  /** The library it is added to: `''` by default. */
  readonly library?: string;
  readonly length: number;
  readonly loop?: number;
  readonly tracks: readonly TrackSpec[];
}

/** One action or read, written once for each side. */
export interface Op {
  readonly gd: readonly string[];
  readonly ts: (w: World) => void;
}

export interface Step {
  readonly await?: 'process' | 'physics';
  readonly ops: readonly Op[];
}

export interface World {
  readonly log: unknown[];
  readonly a: Object3D;
  readonly l: PointLight;
  readonly p: Group;
  readonly s: Object3D;
  readonly libraries: Map<string, AL.AnimationLibrary>;
  readonly animations: Map<string, A.Animation>;
}

const gv = (value: KeyValue): string => {
  if (typeof value === 'number') return gd(value);
  if (typeof value === 'boolean') return String(value);
  if ('method' in value) return `{"method": ${gs(value.method)}, "args": [${value.args.map((arg) => (typeof arg === 'number' ? gd(arg) : String(arg.int))).join(', ')}]}`;
  return value.length === 3 ? `Vector3(${value.map(gd).join(', ')})` : `Quaternion(${value.map(gd).join(', ')})`;
};
const tv = (value: KeyValue): unknown => {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if ('method' in value) return new Map<unknown, unknown>([['method', value.method], ['args', value.args.map((arg) => (typeof arg === 'number' ? arg : arg.int))]]);
  return value.length === 3 ? V.construct(...value) : Q.construct(...value);
};

function gdAnimation(spec: AnimSpec, index: number): string[] {
  const v = `an${String(index)}`;
  const lines = [`var ${v} := Animation.new()`, `${v}.length = ${gd(spec.length)}`, `${v}.loop_mode = ${String(spec.loop ?? 0)}`];
  spec.tracks.forEach((track, t) => {
    const id = `${v}t${String(t)}`;
    lines.push(`var ${id} := ${v}.add_track(${String(TRACK_TYPES[track.type])})`, `${v}.track_set_path(${id}, ${gs(track.path)})`);
    if (track.update !== undefined) lines.push(`${v}.value_track_set_update_mode(${id}, ${String(track.update)})`);
    if (track.interp !== undefined) lines.push(`${v}.track_set_interpolation_type(${id}, ${String(track.interp)})`);
    for (const [time, value, transition] of track.keys) lines.push(`${v}.track_insert_key(${id}, ${gd(time)}, ${gv(value)}, ${gd(transition ?? 1)})`);
  });
  const lib = `lib_${spec.library ?? ''}`;
  lines.push(`${lib}.add_animation(${gs(spec.name)}, ${v})`);
  return lines;
}

function tsAnimation(spec: AnimSpec): A.Animation {
  const a = A.construct();
  A.set_length(a, spec.length);
  A.set_loop_mode(a, spec.loop ?? 0);
  for (const track of spec.tracks) {
    const t = A.add_track(a, TRACK_TYPES[track.type]);
    A.track_set_path(a, t, track.path);
    if (track.update !== undefined) A.value_track_set_update_mode(a, t, track.update);
    if (track.interp !== undefined) A.track_set_interpolation_type(a, t, track.interp);
    for (const [time, value, transition] of track.keys) A.track_insert_key(a, t, time, tv(value), transition ?? 1);
  }
  return a;
}

/** The bindings the scene translation resolves for the paths these cases animate. */
export const BINDINGS: AM.GodotAnimationBindings = {
  values: {
    'A:position': { set: N3.set_position },
    'A:rotation': { set: N3.set_rotation },
    'A:scale': { set: N3.set_scale },
    'L:omni_range': { set: L3.set_param, index: 4 },
    'L:light_energy': { set: L3.set_param, index: 0 },
    'L:shadow_enabled': { set: L3.set_shadow },
  },
  methods: {
    L: { set_param: L3.set_param },
    A: { rotate_y: N3.rotate_y, set_position: N3.set_position },
  },
};

export interface Timeline {
  readonly animations: readonly AnimSpec[];
  /** Before the player enters the tree (its properties as a scene sets them). */
  readonly setup?: readonly Op[];
  readonly steps: readonly Step[];
}

/** Reads of the tree's state, written once for each side. */
export const read = {
  a: (): Op => ({ gd: ['log.append([a.position, a.rotation, a.scale])'], ts: (w) => w.log.push([N3.get_position(w.a), N3.get_rotation(w.a), N3.get_scale(w.a)]) }),
  l: (): Op => ({ gd: ['log.append([l.omni_range, l.light_energy, l.shadow_enabled])'], ts: (w) => w.log.push([L3.get_param(w.l, 4), L3.get_param(w.l, 0), L3.has_shadow(w.l)]) }),
  /** The skeleton `S`'s bones `b0` and `b1`: each pose's position, rotation and scale. */
  s: (): Op => ({
    gd: ['log.append([s.get_bone_pose_position(0), s.get_bone_pose_rotation(0), s.get_bone_pose_scale(0), s.get_bone_pose_position(1), s.get_bone_pose_rotation(1)])'],
    ts: (w) => w.log.push([SK.get_bone_pose_position(w.s, 0), SK.get_bone_pose_rotation(w.s, 0), SK.get_bone_pose_scale(w.s, 0), SK.get_bone_pose_position(w.s, 1), SK.get_bone_pose_rotation(w.s, 1)]),
  }),
  p: (): Op => ({
    gd: ['log.append([String(p.current_animation), String(p.assigned_animation), p.is_playing(), p.get_current_animation_position() if p.is_animation_active() else -1.0])'],
    ts: (w) => w.log.push([AP.get_current_animation(w.p), AP.get_assigned_animation(w.p), AP.is_playing(w.p), AP.is_animation_active(w.p) ? AP.get_current_animation_position(w.p) : -1]),
  }),
};

type CallArg = Arg | string | boolean;
const literal = (value: CallArg) =>
  typeof value === 'number' ? gd(value) : typeof value === 'string' ? gs(value) : typeof value === 'boolean' ? String(value) : String(value.int);
const plain = (value: CallArg): unknown => (typeof value === 'object' ? value.int : value);
const PLAYER_MODULE: Readonly<Record<string, unknown>> = { ...AM, ...AP };
const invoke = (w: World, member: string, args: readonly CallArg[]): unknown =>
  (PLAYER_MODULE[member] as (self: object, ...values: unknown[]) => unknown)(w.p, ...args.map(plain));

/** A call on the player, the same arguments on both sides. */
export function call(member: string, ...args: readonly CallArg[]): Op {
  return { gd: [`p.${member}(${args.map(literal).join(', ')})`], ts: (w) => void invoke(w, member, args) };
}

/** A call on the player whose result (a NodePath) is logged as its text. */
export function logString(member: string): Op {
  return { gd: [`log.append(String(p.${member}()))`], ts: (w) => w.log.push(invoke(w, member, [])) };
}

/** A call on the player whose result is logged. */
export function log(member: string, ...args: readonly CallArg[]): Op {
  return { gd: [`log.append(p.${member}(${args.map(literal).join(', ')}))`], ts: (w) => w.log.push(invoke(w, member, args)) };
}

function gdscript(timeline: Timeline): string {
  const libraries = [...new Set(timeline.animations.map((spec) => spec.library ?? ''))];
  const lines = [
    'var log: Array = []',
    'var r := Node3D.new()',
    'r.name = "R"',
    'holder.add_child(r)',
    'var a := Node3D.new()',
    'a.name = "A"',
    'r.add_child(a)',
    'var l := OmniLight3D.new()',
    'l.name = "L"',
    'r.add_child(l)',
    'var s := Skeleton3D.new()',
    's.name = "S"',
    'r.add_child(s)',
    's.add_bone("b0")',
    's.add_bone("b1")',
    'var p := AnimationPlayer.new()',
    'p.name = "P"',
    'p.animation_started.connect(func(n): log.append("started:" + n))',
    'p.animation_finished.connect(func(n): log.append("finished:" + n))',
    'p.animation_changed.connect(func(o, n): log.append("changed:" + o + ">" + n))',
    'p.current_animation_changed.connect(func(n): log.append("current:" + n))',
    ...libraries.map((name) => `var lib_${name} := AnimationLibrary.new()`),
    ...timeline.animations.flatMap((spec, index) => gdAnimation(spec, index)),
    ...libraries.map((name) => `p.add_animation_library(${gs(name)}, lib_${name})`),
    ...(timeline.setup ?? []).flatMap((op) => op.gd),
    'r.add_child(p)',
  ];
  for (const step of timeline.steps) {
    if (step.await !== undefined) lines.push(step.await === 'physics' ? 'await physics_frame' : 'await process_frame');
    for (const op of step.ops) lines.push(...op.gd);
  }
  // Every case ends in a process frame, so the next one starts where each begins.
  lines.push('await process_frame', 'return log');
  return lines.join('\n');
}

function target(timeline: Timeline): () => unknown {
  return () => {
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const tree = ST.godot_tree();
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const log: unknown[] = [];
    const r = new Object3D();
    r.name = 'R';
    N.godot_node_adopt(r, { kind: 'spatial', classes: ['Node3D', 'Node', 'Object'] });
    N.add_child(holder, r);
    const a = new Object3D();
    a.name = 'A';
    N.godot_node_adopt(a, { kind: 'spatial', classes: ['Node3D', 'Node', 'Object'] });
    N.add_child(r, a);
    const l = new PointLight();
    l.name = 'L';
    N.godot_node_adopt(l, { kind: 'spatial', classes: ['OmniLight3D', 'Light3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'] });
    godot_omni_light_3d_mount(l);
    N.add_child(r, l);
    const s = new Object3D();
    s.name = 'S';
    N.godot_node_adopt(s, { kind: 'spatial', classes: ['Skeleton3D', 'Node3D', 'Node', 'Object'] });
    N.add_child(r, s);
    SK.add_bone(s, 'b0');
    SK.add_bone(s, 'b1');
    const p = new Group();
    p.name = 'P';
    N.godot_node_adopt(p, { kind: 'node', classes: ['AnimationPlayer', 'AnimationMixer', 'Node', 'Object'] });
    AP.godot_animation_player_mount(p);
    AM.godot_animation_mixer_bind(p, BINDINGS);
    AM.godot_animation_mixer_signal(p, 'animation_started').connect((n) => log.push(`started:${n}`));
    AM.godot_animation_mixer_signal(p, 'animation_finished').connect((n) => log.push(`finished:${n}`));
    AP.godot_animation_player_signal(p, 'animation_changed').connect((o, n) => log.push(`changed:${o}>${n}`));
    AP.godot_animation_player_signal(p, 'current_animation_changed').connect((n) => log.push(`current:${n}`));
    const libraries = new Map<string, AL.AnimationLibrary>();
    const animations = new Map<string, A.Animation>();
    for (const spec of timeline.animations) {
      const name = spec.library ?? '';
      if (!libraries.has(name)) libraries.set(name, AL.construct());
      const animation = tsAnimation(spec);
      animations.set(name === '' ? spec.name : `${name}/${spec.name}`, animation);
      AL.add_animation(libraries.get(name) as AL.AnimationLibrary, spec.name, animation);
    }
    for (const [name, library] of libraries) AM.add_animation_library(p, name, library);
    const world: World = { log, a, l, p, s, libraries, animations };
    for (const op of timeline.setup ?? []) op.ts(world);
    let result: unknown[] | undefined;
    const pending: Step[] = [...timeline.steps, { await: 'process', ops: [] }];
    const runStep = (step: Step): void => {
      for (const op of step.ops) op.ts(world);
    };
    // The probe's case starts in a `process_frame` emission: the tree is entered there.
    const first = (): void => {
      N.add_child(r, p);
      arm();
    };
    const arm = (): void => {
      const step = pending.shift();
      if (step === undefined) {
        result = [...log];
        return;
      }
      if (step.await === undefined) {
        runStep(step);
        arm();
        return;
      }
      const signal = step.await === 'physics' ? tree.physics_frame : tree.process_frame;
      signal.connect(
        () => {
          runStep(step);
          arm();
        },
        { oneShot: true },
      );
    };
    tree.process_frame.connect(first, { oneShot: true });
    ST.godot_tree_frame(DT);
    for (let guard = 0; result === undefined && guard < 2000; guard += 1) {
      ST.godot_tree_physics_step(DT);
      if (result !== undefined) break;
      ST.godot_tree_frame(DT);
    }
    return result;
  };
}

/**
 * A timeline case for a member of `owner`. A rotation track's slerp goes through the platform's
 * `acosf`/`sinf` (`quaternion.ts`): a case that animates one compares within one float ulp.
 */
export function timelineCase(id: string, symbol: GodotEvidenceSymbol, timeline: Timeline, comparator: GodotEvidenceComparator = 'exact'): GodotEvidenceCase {
  return { id, symbol, gdscript: gdscript(timeline), target: target(timeline), comparator };
}

/** `n` process frames, reading after each. */
export function frames(n: number, ...reads: readonly Op[]): Step[] {
  return Array.from({ length: n }, () => ({ await: 'process' as const, ops: reads }));
}
