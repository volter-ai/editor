/**
 * Input delivery cases: nodes under the root viewport whose scripts log the input callbacks they
 * get (and may handle the event), fed events through `Input.parse_input_event` and flushed, as the
 * display server dispatches them to the root window. Printed as GDScript (scripts compiled at run
 * time) for the official binary, and run through compat exports for the target.
 *
 * The headless binary's root window is 64x64 (`DEFAULT_WINDOW_SIZE` is 100, the headless display
 * server's window 64); the target's root window is given that size.
 */
import { Group, type Object3D, Scene } from 'three';
import * as CI from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-item';
import * as CL from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-layer';
import * as C from '../../capabilities/catalog/project-source/src/lib/godot-compat/control';
import * as I from '../../capabilities/catalog/project-source/src/lib/godot-compat/input';
import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as N from '../../capabilities/catalog/project-source/src/lib/godot-compat/node';
import * as ST from '../../capabilities/catalog/project-source/src/lib/godot-compat/scene-tree';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import * as VP from '../../capabilities/catalog/project-source/src/lib/godot-compat/viewport';
import * as W from '../../capabilities/catalog/project-source/src/lib/godot-compat/window';
import * as CT from '../../capabilities/catalog/project-source/src/lib/godot-compat/canvas-texture';
import * as N2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/node-2d';
import * as PT from '../../capabilities/catalog/project-source/src/lib/godot-compat/placeholder-texture-2d';
import * as SP from '../../capabilities/catalog/project-source/src/lib/godot-compat/sprite-2d';
import * as T2D from '../../capabilities/catalog/project-source/src/lib/godot-compat/texture-2d';
import * as TSB from '../../capabilities/catalog/project-source/src/lib/godot-compat/touch-screen-button';
import { gd } from './literals';

export type Callback = 'input' | 'gui_input' | 'shortcut_input' | 'unhandled_input' | 'unhandled_key_input';

/** The callbacks a node's script defines, each `true` when it also handles the event. */
export type Script = Partial<Record<Callback, boolean>>;

export type Kind = 'Node' | 'Control' | 'CanvasLayer' | 'Node2D' | 'Sprite2D' | 'TouchScreenButton';

export type Event =
  | { readonly touch: number; readonly at: readonly [number, number]; readonly pressed: boolean }
  | { readonly drag: number; readonly at: readonly [number, number] }
  | { readonly button: number; readonly at: readonly [number, number]; readonly pressed: boolean }
  | { readonly motion: readonly [number, number] }
  | { readonly key: number; readonly pressed: boolean };

export type Op =
  | { readonly node: string; readonly kind: Kind; readonly parent?: string; readonly script?: Script }
  | { readonly call: string; readonly on: string; readonly args?: readonly Arg[] }
  /** A texture resource: a `PlaceholderTexture2D` of `size`, or a `CanvasTexture` with no diffuse texture. */
  | { readonly texture: string; readonly size?: readonly [number, number] }
  /** An input action in the InputMap (added natively, loaded in the target). */
  | { readonly action: string }
  /** Reads `Input.is_action_pressed`. */
  | { readonly pressedAction: string }
  /** Logs `[node, signal]` when the node's signal is emitted. */
  | { readonly watch: string; readonly signal: 'pressed' | 'released' }
  | { readonly read: string; readonly on: string; readonly then?: string }
  | { readonly event: Event }
  | { readonly remove: string }
  /** Reads the root window's size, after setting it when given. */
  | { readonly rootSize: readonly [number, number] | null };

export type Arg = number | boolean | string | readonly [number, number] | { readonly ref: string };

const CLASS: Readonly<Record<InputEventRecord['type'], string>> = {
  key: 'InputEventKey',
  mouse_button: 'InputEventMouseButton',
  mouse_motion: 'InputEventMouseMotion',
  joypad_button: 'InputEventJoypadButton',
  joypad_motion: 'InputEventJoypadMotion',
  screen_touch: 'InputEventScreenTouch',
  screen_drag: 'InputEventScreenDrag',
  action: 'InputEventAction',
};

const VIRTUAL: Readonly<Record<Callback, string>> = {
  input: '_input',
  gui_input: '_gui_input',
  shortcut_input: '_shortcut_input',
  unhandled_input: '_unhandled_input',
  unhandled_key_input: '_unhandled_key_input',
};

function gdArg(value: Arg): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : gd(value);
  if ('ref' in value) return `n_${value.ref}`;
  return `Vector2(${gd(value[0])}, ${gd(value[1])})`;
}

/** A script's source: each callback logs `[tag, callback, class, position, pressed, device]`. */
function scriptSource(kind: Kind, script: Script): string {
  const lines = [`extends ${kind}`, 'var sink: Array', "var tag := ''"];
  for (const [callback, handles] of Object.entries(script) as [Callback, boolean][]) {
    lines.push(`func ${VIRTUAL[callback]}(e: InputEvent) -> void:`);
    lines.push(`\\tsink.append([tag, '${callback}', e.get_class(), e.get('position'), e.get('pressed'), e.device])`);
    if (handles) lines.push('\\tget_viewport().set_input_as_handled()');
  }
  return lines.join('\\n');
}

function gdEvent(event: Event, k: number): string[] {
  const v = `ev${String(k)}`;
  if ('touch' in event) return [`var ${v} := InputEventScreenTouch.new()`, `${v}.index = ${String(event.touch)}`, `${v}.position = Vector2(${gd(event.at[0])}, ${gd(event.at[1])})`, `${v}.pressed = ${String(event.pressed)}`];
  if ('drag' in event) return [`var ${v} := InputEventScreenDrag.new()`, `${v}.index = ${String(event.drag)}`, `${v}.position = Vector2(${gd(event.at[0])}, ${gd(event.at[1])})`];
  if ('button' in event) {
    return [`var ${v} := InputEventMouseButton.new()`, `${v}.button_index = ${String(event.button)}`, `${v}.position = Vector2(${gd(event.at[0])}, ${gd(event.at[1])})`, `${v}.global_position = ${v}.position`, `${v}.pressed = ${String(event.pressed)}`];
  }
  if ('motion' in event) return [`var ${v} := InputEventMouseMotion.new()`, `${v}.position = Vector2(${gd(event.motion[0])}, ${gd(event.motion[1])})`, `${v}.global_position = ${v}.position`];
  return [`var ${v} := InputEventKey.new()`, `${v}.keycode = ${String(event.key)}`, `${v}.physical_keycode = ${String(event.key)}`, `${v}.pressed = ${String(event.pressed)}`];
}

function record(event: Event): InputEventRecord {
  if ('touch' in event) return { type: 'screen_touch', index: event.touch, position: V2.construct(...event.at), pressed: event.pressed, device: 0 };
  if ('drag' in event) return { type: 'screen_drag', index: event.drag, position: V2.construct(...event.at), device: 0 };
  if ('button' in event) return { type: 'mouse_button', button_index: event.button, position: V2.construct(...event.at), pressed: event.pressed };
  if ('motion' in event) return { type: 'mouse_motion', position: V2.construct(...event.motion) };
  return { type: 'key', keycode: event.key, physical_keycode: event.key, key_label: 0, pressed: event.pressed };
}

export function inputGdscript(ops: readonly Op[]): string {
  const lines = ['var log: Array = []', 'var nodes: Array = []'];
  let k = 0;
  for (const op of ops) {
    k += 1;
    if ('texture' in op) {
      if (op.size === undefined) lines.push(`var n_${op.texture} := CanvasTexture.new()`);
      else lines.push(`var n_${op.texture} := PlaceholderTexture2D.new()`, `n_${op.texture}.size = Vector2(${gd(op.size[0])}, ${gd(op.size[1])})`);
      continue;
    }
    if ('action' in op) {
      lines.push(`if not InputMap.has_action(${JSON.stringify(op.action)}):`, `\tInputMap.add_action(${JSON.stringify(op.action)})`);
      continue;
    }
    if ('pressedAction' in op) {
      lines.push(`log.append(Input.is_action_pressed(${JSON.stringify(op.pressedAction)}))`);
      continue;
    }
    if ('watch' in op) {
      lines.push(`n_${op.watch}.${op.signal}.connect(func() -> void: log.append([${JSON.stringify(op.watch)}, ${JSON.stringify(op.signal)}]))`);
      continue;
    }
    if ('node' in op) {
      lines.push(`var n_${op.node} := ${op.kind}.new()`, `n_${op.node}.name = ${JSON.stringify(op.node)}`);
      if (op.script !== undefined) {
        lines.push(`var s_${op.node} := GDScript.new()`, `s_${op.node}.source_code = "${scriptSource(op.kind, op.script)}"`, `s_${op.node}.reload()`, `n_${op.node}.set_script(s_${op.node})`);
        lines.push(`n_${op.node}.set("sink", log)`, `n_${op.node}.set("tag", ${JSON.stringify(op.node)})`);
      }
      lines.push(`${op.parent === undefined ? 'holder' : `n_${op.parent}`}.add_child(n_${op.node})`, `nodes.append(n_${op.node})`);
    } else if ('event' in op) {
      lines.push(...gdEvent(op.event, k), `Input.parse_input_event(ev${String(k)})`, 'Input.flush_buffered_events()');
    } else if ('remove' in op) {
      lines.push(`n_${op.remove}.get_parent().remove_child(n_${op.remove})`);
    } else if ('rootSize' in op) {
      if (op.rootSize !== null) lines.push(`holder.get_tree().root.size = Vector2i(${String(op.rootSize[0])}, ${String(op.rootSize[1])})`);
      lines.push('log.append(holder.get_tree().root.size)');
    } else if ('call' in op) {
      lines.push(`n_${op.on}.${op.call}(${(op.args ?? []).map(gdArg).join(', ')})`);
    } else {
      lines.push(`log.append(n_${op.on}.${op.read}()${op.then === undefined ? '' : `.${op.then}()`})`);
    }
  }
  lines.push('return log');
  return lines.join('\n');
}

type Exports = Readonly<Record<string, unknown>>;
const MODULES: Readonly<Record<Kind, readonly Exports[]>> = {
  Node: [N],
  Control: [C, CI, N],
  CanvasLayer: [CL, N],
  Node2D: [N2, CI, N],
  Sprite2D: [SP, N2, CI, N],
  TouchScreenButton: [TSB, N2, CI, N],
};

export function inputTarget(ops: readonly Op[]): () => unknown {
  return () => {
    const root = new Scene();
    ST.godot_tree_set_root(root);
    W.godot_window_set_size(root, { x: 64, y: 64 });
    const detach = VP.godot_viewport_attach_input(root);
    const holder = new Group();
    N.godot_node_adopt(holder, { kind: 'node' });
    N.add_child(root, holder);
    const log: unknown[] = [];
    const nodes = new Map<string, { readonly entity: Object3D; readonly kind: Kind }>();
    const textures = new Map<string, object>();
    const actions: string[] = [];
    const entry = (tag: string, callback: Callback, event: unknown, handles: boolean): void => {
      const e = event as InputEventRecord;
      const position = 'position' in e ? e.position : null;
      const pressed = 'pressed' in e ? e.pressed : null;
      log.push([tag, callback, CLASS[e.type], position, pressed, e.device ?? (e.type === 'key' ? 16 : e.type.startsWith('mouse') ? 32 : 0)]);
      if (handles) VP.set_input_as_handled(root);
    };
    for (const op of ops) {
      if ('texture' in op) {
        const texture = op.size === undefined ? CT.godot_canvas_texture_new() : PT.godot_placeholder_texture_2d_new();
        if (op.size !== undefined) PT.set_size(texture, V2.construct(...op.size));
        textures.set(op.texture, texture);
        continue;
      }
      if ('action' in op) {
        actions.push(op.action);
        I.godot_input_map_load(actions.map((name) => ({ name, events: [] })));
        continue;
      }
      if ('pressedAction' in op) {
        log.push(I.is_action_pressed(op.pressedAction));
        continue;
      }
      if ('watch' in op) {
        const entity = nodes.get(op.watch)?.entity as Object3D;
        TSB.godot_touch_screen_button_signal(entity, op.signal).connect(() => log.push([op.watch, op.signal]));
        continue;
      }
      if ('node' in op) {
        const entity = new Group();
        entity.name = op.node;
        const script = op.script ?? {};
        const handler = (callback: Callback) => (script[callback] === undefined ? undefined : (event: unknown) => entry(op.node, callback, event, script[callback] === true));
        const input = handler('input');
        const shortcutInput = handler('shortcut_input');
        const unhandledInput = handler('unhandled_input');
        const unhandledKeyInput = handler('unhandled_key_input');
        const binding = {
          owner: {},
          ...(input === undefined ? {} : { input }),
          ...(shortcutInput === undefined ? {} : { shortcutInput }),
          ...(unhandledInput === undefined ? {} : { unhandledInput }),
          ...(unhandledKeyInput === undefined ? {} : { unhandledKeyInput }),
        };
        if (op.kind === 'Control') C.godot_control_mount(entity, ['Control', 'CanvasItem', 'Node']);
        else if (op.kind === 'Node2D') N2.godot_node_2d_mount(entity, ['Node2D', 'CanvasItem', 'Node']);
        else if (op.kind === 'Sprite2D') SP.godot_sprite_2d_mount(entity);
        else if (op.kind === 'TouchScreenButton') TSB.godot_touch_screen_button_mount(entity);
        else if (op.kind === 'CanvasLayer') {
          N.godot_node_adopt(entity, { kind: 'node', classes: ['CanvasLayer', 'Node'] });
          CL.godot_canvas_layer_mount(entity);
        } else N.godot_node_adopt(entity, { kind: 'node' });
        if (op.script !== undefined) N.godot_node_adopt(entity, { binding });
        const gui = handler('gui_input');
        if (gui !== undefined) C.godot_control_set_gui_input(entity, { script: gui });
        N.add_child(op.parent === undefined ? holder : (nodes.get(op.parent)?.entity as Object3D), entity);
        nodes.set(op.node, { entity, kind: op.kind });
      } else if ('event' in op) {
        I.parse_input_event(record(op.event));
        I.flush_buffered_events();
      } else if ('remove' in op) {
        const entity = nodes.get(op.remove)?.entity as Object3D;
        N.remove_child(entity.parent as Object3D, entity);
      } else if ('rootSize' in op) {
        if (op.rootSize !== null) W.godot_window_set_size(root, { x: op.rootSize[0], y: op.rootSize[1] });
        log.push(W.get_size(root));
      } else {
        const node = nodes.get(op.on);
        const resource = textures.get(op.on);
        if (node === undefined && resource === undefined) throw new Error(`no node ${op.on}`);
        const name = 'call' in op ? op.call : op.read;
        const modules: readonly Exports[] = node !== undefined ? MODULES[node.kind] : [CT, PT, T2D];
        const fn = modules.find((module) => typeof module[name] === 'function')?.[name] as ((...args: unknown[]) => unknown) | undefined;
        if (fn === undefined) throw new Error(`no compat export ${name} for ${op.on}`);
        const args = ('call' in op ? (op.args ?? []) : []).map((value): unknown =>
          Array.isArray(value) ? V2.construct(value[0] as number, value[1] as number) : typeof value === 'object' && value !== null && 'ref' in value ? (textures.get(value.ref) ?? nodes.get(value.ref)?.entity) : value,
        );
        const result = fn(node !== undefined ? node.entity : resource, ...args);
        if ('read' in op) log.push(op.then === undefined ? result : (T2D as Exports)[op.then] instanceof Function ? ((T2D as Exports)[op.then] as (value: unknown) => unknown)(result) : undefined);
      }
    }
    detach();
    return log;
  };
}

export function inputCase(ops: readonly Op[]): { readonly gdscript: string; readonly target: () => unknown } {
  return { gdscript: inputGdscript(ops), target: inputTarget(ops) };
}
