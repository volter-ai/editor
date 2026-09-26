/**
 * Tree cases describe nodes with small logging scripts, tree operations and reads, split into
 * segments that each run in one SceneTree signal emission: the first in the `process_frame` the case
 * starts in, each later one after `await process_frame` / `await physics_frame`. The native side
 * runs it in the official binary's main loop (fixed 60 fps); the target side registers the same
 * callbacks through `node.ts`'s binding and drives `scene-tree.ts`'s clock the way `Main::iteration`
 * does. Both return the log as it stands when the case ends (the next `process_frame` after its last
 * segment).
 */
import { Group, Object3D, Scene } from 'three';
import * as EN from '../../capabilities/catalog/project-source/src/lib/godot-compat/engine';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as O from '../../capabilities/catalog/project-source/src/lib/godot-compat/object';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as STT from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree-timer';
import { gd, gs } from './literals';

export type Op =
  | { readonly new: string; readonly kind?: 'node' | 'spatial'; readonly script?: 'full' | 'quiet' | 'none' }
  | { readonly add: string; readonly to?: string }
  | { readonly remove: string; readonly from: string }
  | { readonly free: string }
  | { readonly log: string }
  | { readonly deferred: string; readonly what: string }
  | { readonly setDeferred: string; readonly value: string }
  | { readonly readMark: string }
  | { readonly timer: string; readonly delay: number; readonly physics?: boolean }
  | { readonly readTimer: string }
  | { readonly setTimer: string; readonly value: number }
  | { readonly queueDelete: string }
  | { readonly group: string; readonly name: string }
  | { readonly ungroup: string; readonly name: string }
  | { readonly process: string; readonly on: boolean; readonly physics?: boolean }
  | { readonly rename: string; readonly to: string }
  | { readonly priority: string; readonly value: number }
  | { readonly mode: string; readonly value: number }
  | { readonly resetInterpolation: string }
  | { readonly requestReady: string }
  | { readonly read: Read };

export type Read =
  | readonly ['get_node', string, string]
  | readonly ['get_node_or_null', string, string]
  | readonly ['children', string]
  | readonly ['parent', string]
  | readonly ['in_group', string, string]
  | readonly ['inside', string]
  | readonly ['queued', string]
  | readonly ['node_ready', string]
  | readonly ['processing', string]
  | readonly ['physics_processing', string]
  | readonly ['can_process', string]
  | readonly ['physics_delta', string]
  | readonly ['process_delta', string]
  | readonly ['process_mode', string]
  | readonly ['process_priority', string]
  | readonly ['viewport_is_root', string]
  | readonly ['tree_is_same', string]
  | readonly ['name', string]
  | readonly ['frames']
  | readonly ['tree_frame']
  | readonly ['in_physics']
  | readonly ['reload'];

export interface Segment {
  readonly await?: 'process' | 'physics';
  readonly ops: readonly Op[];
}

const DT = 1 / 60;
const v = (tag: string): string => `n_${tag}`;

function script(base: 'Node' | 'Node3D', full: boolean): string {
  const lines = [
    `extends ${base}`,
    'var log: Array',
    'var tag: String',
    'var mark: String = ""',
    'func _enter_tree():',
    '\tlog.append(tag + ":enter")',
    'func _ready():',
    '\tlog.append(tag + ":ready")',
    'func _exit_tree():',
    '\tlog.append(tag + ":exit")',
    'func note(what):',
    '\tlog.append(tag + ":deferred:" + what)',
  ];
  if (full) {
    lines.push('func _process(_delta):', '\tlog.append(tag + ":process")');
    lines.push('func _physics_process(_delta):', '\tlog.append(tag + ":physics")');
  }
  return lines.join('\n');
}

function gdRead(read: Read): string {
  switch (read[0]) {
    case 'get_node':
    case 'get_node_or_null':
      return `_nm(${v(read[1])}.${read[0]}(${gs(read[2])}))`;
    case 'children':
      return `_names(${v(read[1])}.get_children())`;
    case 'parent':
      return `_nm(${v(read[1])}.get_parent())`;
    case 'in_group':
      return `${v(read[1])}.is_in_group(${gs(read[2])})`;
    case 'inside':
      return `${v(read[1])}.is_inside_tree()`;
    case 'queued':
      return `${v(read[1])}.is_queued_for_deletion()`;
    case 'node_ready':
      return `${v(read[1])}.is_node_ready()`;
    case 'processing':
      return `${v(read[1])}.is_processing()`;
    case 'physics_processing':
      return `${v(read[1])}.is_physics_processing()`;
    case 'can_process':
      return `${v(read[1])}.can_process()`;
    case 'physics_delta':
      return `${v(read[1])}.get_physics_process_delta_time()`;
    case 'process_delta':
      return `${v(read[1])}.get_process_delta_time()`;
    case 'process_mode':
      return `${v(read[1])}.get_process_mode()`;
    case 'process_priority':
      return `${v(read[1])}.get_process_priority()`;
    case 'viewport_is_root':
      return `${v(read[1])}.get_viewport() == get_root()`;
    case 'tree_is_same':
      return `${v(read[1])}.get_tree() == self`;
    case 'name':
      return `String(${v(read[1])}.get_name())`;
    case 'frames':
      return `[Engine.get_physics_frames() - p0, Engine.get_process_frames() - f0]`;
    case 'tree_frame':
      return `get_frame() - t0`;
    case 'in_physics':
      return 'Engine.is_in_physics_frame()';
    case 'reload':
      return 'reload_current_scene()';
    default:
      return read satisfies never;
  }
}

function gdOp(op: Op): string[] {
  if ('new' in op) {
    const base = op.kind === 'node' ? 'Node' : 'Node3D';
    const lines = [`var ${v(op.new)} := ${base}.new()`, `${v(op.new)}.name = ${gs(op.new)}`];
    const which = op.script ?? 'full';
    if (which !== 'none') {
      const s = `_s_${base}_${which}`;
      lines.push(`${v(op.new)}.set_script(${s})`, `${v(op.new)}.log = log`, `${v(op.new)}.tag = ${gs(op.new)}`);
    }
    return lines;
  }
  if ('add' in op) return [`${op.to === undefined ? 'holder' : v(op.to)}.add_child(${v(op.add)})`];
  if ('remove' in op) return [`${v(op.from)}.remove_child(${v(op.remove)})`];
  if ('free' in op) return [`${v(op.free)}.queue_free()`];
  if ('log' in op) return [`log.append(${gs(op.log)})`];
  if ('deferred' in op) return [`${v(op.deferred)}.call_deferred("note", ${gs(op.what)})`];
  if ('setDeferred' in op) return [`${v(op.setDeferred)}.set_deferred("mark", ${gs(op.value)})`];
  if ('readMark' in op) return [`log.append(${gs(`${op.readMark}:mark:`)} + ${v(op.readMark)}.mark)`];
  if ('timer' in op) {
    return [
      `var t_${op.timer} := create_timer(${gd(op.delay)}, true, ${String(op.physics ?? false)})`,
      `t_${op.timer}.timeout.connect(func(): log.append(${gs(`${op.timer}:timeout`)}))`,
    ];
  }
  if ('readTimer' in op) return [`log.append(t_${op.readTimer}.get_time_left())`];
  if ('setTimer' in op) return [`t_${op.setTimer}.set_time_left(${gd(op.value)})`];
  if ('queueDelete' in op) return [`queue_delete(${v(op.queueDelete)})`];
  if ('group' in op) return [`${v(op.group)}.add_to_group(${gs(op.name)})`];
  if ('ungroup' in op) return [`${v(op.ungroup)}.remove_from_group(${gs(op.name)})`];
  if ('process' in op) return [`${v(op.process)}.${op.physics === true ? 'set_physics_process' : 'set_process'}(${String(op.on)})`];
  if ('rename' in op) return [`${v(op.rename)}.set_name(${gs(op.to)})`];
  if ('priority' in op) return [`${v(op.priority)}.set_process_priority(${String(op.value)})`];
  if ('mode' in op) return [`${v(op.mode)}.set_process_mode(${String(op.value)})`];
  if ('resetInterpolation' in op) return [`${v(op.resetInterpolation)}.reset_physics_interpolation()`];
  if ('requestReady' in op) return [`${v(op.requestReady)}.request_ready()`];
  return [`log.append(${gdRead(op.read)})`];
}

/** The GDScript body (a coroutine) of a case. */
function gdscript(segments: readonly Segment[]): string {
  const lines = [
    'var log: Array = []',
    'var f0 := Engine.get_process_frames()',
    'var p0 := Engine.get_physics_frames()',
    'var t0 := get_frame()',
  ];
  for (const base of ['Node', 'Node3D'] as const) {
    for (const full of [true, false]) {
      const name = `_s_${base}_${full ? 'full' : 'quiet'}`;
      lines.push(`var ${name} := GDScript.new()`, `${name}.source_code = ${gs(script(base, full))}`, `${name}.reload()`);
    }
  }
  for (const segment of segments) {
    if (segment.await !== undefined) lines.push(segment.await === 'physics' ? 'await physics_frame' : 'await process_frame');
    for (const op of segment.ops) lines.push(...gdOp(op));
  }
  lines.push('await process_frame', 'return log.duplicate()');
  return lines.join('\n');
}

/** The probe helpers the reads use: a node's name (or null) and a list of names. */
export const TREE_PROBE_HELPERS = `
func _nm(node) -> Variant:
\treturn null if node == null else String(node.name)

func _names(nodes: Array) -> Array:
\tvar out: Array = []
\tfor node in nodes:
\t\tout.append(String(node.name))
\treturn out
`;

/** Runs a case against compat and returns its log. */
function target(segments: readonly Segment[]): () => unknown {
  return () => {
    const log: unknown[] = [];
    const root = new Scene();
    ST.godot_tree_set_root(root);
    const tree = ST.godot_tree();
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const nodes = new Map<string, object>();
    const timers = new Map<string, STT.SceneTreeTimer>();
    const f0 = EN.get_process_frames();
    const p0 = EN.get_physics_frames();
    const t0 = ST.get_frame(tree);
    const node = (tag: string): object => nodes.get(tag) as object;
    const read = (r: Read): unknown => {
      const nm = (value: unknown): unknown => (value === null ? null : N.get_name(value as object));
      switch (r[0]) {
        case 'get_node':
          return nm(N.get_node(node(r[1]), r[2]));
        case 'get_node_or_null':
          return nm(N.get_node_or_null(node(r[1]), r[2]));
        case 'children':
          return N.get_children(node(r[1])).map((child) => N.get_name(child as object));
        case 'parent':
          return nm(N.get_parent(node(r[1])));
        case 'in_group':
          return N.is_in_group(node(r[1]), r[2]);
        case 'inside':
          return N.is_inside_tree(node(r[1]));
        case 'queued':
          return O.is_queued_for_deletion(node(r[1]));
        case 'node_ready':
          return N.is_node_ready(node(r[1]));
        case 'processing':
          return N.is_processing(node(r[1]));
        case 'physics_processing':
          return N.is_physics_processing(node(r[1]));
        case 'can_process':
          return N.can_process(node(r[1]));
        case 'physics_delta':
          return N.get_physics_process_delta_time(node(r[1]));
        case 'process_delta':
          return N.get_process_delta_time(node(r[1]));
        case 'process_mode':
          return N.get_process_mode(node(r[1]));
        case 'process_priority':
          return N.get_process_priority(node(r[1]));
        case 'viewport_is_root':
          return N.get_viewport(node(r[1])) === ST.get_root(tree);
        case 'tree_is_same':
          return N.get_tree(node(r[1])) === tree;
        case 'name':
          return N.get_name(node(r[1]));
        case 'frames':
          return [EN.get_physics_frames() - p0, EN.get_process_frames() - f0];
        case 'tree_frame':
          return ST.get_frame(tree) - t0;
        case 'in_physics':
          return EN.is_in_physics_frame();
        case 'reload':
          return ST.reload_current_scene(tree);
        default:
          return r satisfies never;
      }
    };
    const run = (op: Op): void => {
      if ('new' in op) {
        const entity = op.kind === 'node' ? new Group() : new Object3D();
        entity.name = op.new;
        const which = op.script ?? 'full';
        if (which === 'none') {
          N.godot_node_adopt(entity, { kind: op.kind ?? 'spatial' });
        } else {
          const tag = op.new;
          const owner = {
            mark: '',
            note(what: string) {
              log.push(`${tag}:deferred:${what}`);
            },
          };
          N.godot_node_adopt(entity, {
            kind: op.kind ?? 'spatial',
            binding: {
              owner,
              enterTree: () => log.push(`${tag}:enter`),
              ready: () => log.push(`${tag}:ready`),
              exitTree: () => log.push(`${tag}:exit`),
              ...(which === 'full'
                ? { process: () => log.push(`${tag}:process`), physicsProcess: () => log.push(`${tag}:physics`) }
                : {}),
            },
          });
        }
        nodes.set(op.new, entity);
      } else if ('add' in op) N.add_child(op.to === undefined ? holder : node(op.to), node(op.add));
      else if ('remove' in op) N.remove_child(node(op.from), node(op.remove));
      else if ('free' in op) N.queue_free(node(op.free));
      else if ('log' in op) log.push(op.log);
      else if ('deferred' in op) O.call_deferred(N.get_node(node(op.deferred), '.') as object, 'note', op.what);
      else if ('setDeferred' in op) O.set_deferred(N.get_node(node(op.setDeferred), '.') as object, 'mark', op.value);
      else if ('readMark' in op) log.push(`${op.readMark}:mark:${(N.get_node(node(op.readMark), '.') as { mark: string }).mark}`);
      else if ('timer' in op) {
        const timer = ST.create_timer(tree, op.delay, true, op.physics ?? false);
        timer.timeout.connect(() => log.push(`${op.timer}:timeout`));
        timers.set(op.timer, timer);
      } else if ('readTimer' in op) log.push(STT.get_time_left(timers.get(op.readTimer) as STT.SceneTreeTimer));
      else if ('setTimer' in op) STT.set_time_left(timers.get(op.setTimer) as STT.SceneTreeTimer, op.value);
      else if ('queueDelete' in op) ST.queue_delete(tree, node(op.queueDelete));
      else if ('group' in op) N.add_to_group(node(op.group), op.name);
      else if ('ungroup' in op) N.remove_from_group(node(op.ungroup), op.name);
      else if ('process' in op) (op.physics === true ? N.set_physics_process : N.set_process)(node(op.process), op.on);
      else if ('rename' in op) N.set_name(node(op.rename), op.to);
      else if ('priority' in op) N.set_process_priority(node(op.priority), op.value);
      else if ('mode' in op) N.set_process_mode(node(op.mode), op.value);
      else if ('resetInterpolation' in op) N.reset_physics_interpolation(node(op.resetInterpolation));
      else if ('requestReady' in op) N.request_ready(node(op.requestReady));
      else log.push(read(op.read));
    };
    let result: unknown[] | undefined;
    const pending = [...segments, { await: 'process' as const, ops: [] as readonly Op[], end: true }];
    const arm = (): void => {
      const segment = pending.shift();
      if (segment === undefined) return;
      const body = (): void => {
        if ('end' in segment) {
          result = [...log];
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
    for (let guard = 0; result === undefined && guard < 1000; guard += 1) {
      ST.godot_tree_physics_step(DT);
      if (result !== undefined) break;
      ST.godot_tree_frame(DT);
    }
    return result;
  };
}

export function treeCase(segments: readonly Segment[]): { readonly gdscript: string; readonly target: () => unknown } {
  return { gdscript: gdscript(segments), target: target(segments) };
}
