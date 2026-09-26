/**
 * Input cases describe an InputMap, a timeline of input and frame steps, and the queries read at
 * each point. The native side runs it in the official binary's main loop (`await physics_frame` /
 * `await process_frame`, fixed 60 fps: one physics step per iteration); the target side replays the
 * same main loop through `input.ts`'s protocol: `flush_buffered_events` at each iteration start,
 * `godot_input_frame` at each physics step and process step, as `Main::iteration` orders them.
 */
import * as I from '../../capabilities/catalog/project-source/src/lib/godot-compat/input';
import type { InputEventRecord } from '../../capabilities/catalog/project-source/src/lib/godot-compat/input-event';
import * as V2 from '../../capabilities/catalog/project-source/src/lib/godot-compat/vector2';
import { gd, gs } from './literals';

export interface ActionSpec {
  readonly name: string;
  readonly deadzone?: number;
  readonly events: readonly InputEventRecord[];
}

export type Query =
  | readonly ['is_action_pressed' | 'is_action_just_pressed' | 'is_action_just_released', string, boolean?]
  | readonly ['get_action_strength' | 'get_action_raw_strength', string, boolean?]
  | readonly ['get_axis', string, string]
  | readonly ['get_vector', string, string, string, string, number?];

export type Step =
  | { readonly parse: InputEventRecord }
  | { readonly press: string; readonly strength?: number }
  | { readonly release: string }
  | { readonly cursor: number }
  | { readonly flush: true }
  | { readonly await: 'physics' | 'process' }
  | { readonly read: Query };

const CLASSES: Readonly<Record<InputEventRecord['type'], string>> = {
  key: 'InputEventKey',
  mouse_button: 'InputEventMouseButton',
  mouse_motion: 'InputEventMouseMotion',
  joypad_button: 'InputEventJoypadButton',
  joypad_motion: 'InputEventJoypadMotion',
  screen_touch: 'InputEventScreenTouch',
  screen_drag: 'InputEventScreenDrag',
  action: 'InputEventAction',
};

/** GDScript lines building `event` into the variable `name`. */
export function gdEvent(name: string, event: InputEventRecord, rename: (action: string) => string): string[] {
  const lines = [`var ${name} := ${CLASSES[event.type]}.new()`];
  for (const [field, value] of Object.entries(event)) {
    if (field === 'type') continue;
    let text: string;
    if (field === 'action') text = gs(rename(value as string));
    else if (typeof value === 'boolean') text = String(value);
    else if (typeof value === 'number') text = field === 'axis_value' || field === 'strength' ? gd(value) : String(value);
    else {
      const v = value as { x: number; y: number };
      text = `Vector2(${gd(v.x)}, ${gd(v.y)})`;
    }
    lines.push(`${name}.${field} = ${text}`);
  }
  return lines;
}

function renameEvent(event: InputEventRecord, rename: (action: string) => string): InputEventRecord {
  return event.type === 'action' ? { ...event, action: rename(event.action) } : event;
}

function gdQuery(query: Query, rename: (action: string) => string): string {
  const [method, ...args] = query;
  const text = args
    .filter((arg) => arg !== undefined)
    .map((arg) => (typeof arg === 'string' ? gs(rename(arg)) : typeof arg === 'boolean' ? String(arg) : gd(arg as number)));
  return `Input.${method}(${text.join(', ')})`;
}

function runQuery(query: Query, rename: (action: string) => string): unknown {
  const [method, ...args] = query;
  const values = args.filter((arg) => arg !== undefined).map((arg) => (typeof arg === 'string' ? rename(arg) : arg));
  return (I[method] as (...values: unknown[]) => unknown)(...values);
}

let caseNumber = 0;

/** The GDScript body and target thunk of one timeline. */
export function timeline(actions: readonly ActionSpec[], steps: readonly Step[]): { readonly gdscript: string; readonly target: () => unknown } {
  caseNumber += 1;
  const prefix = `c${String(caseNumber)}_`;
  const rename = (action: string): string => `${prefix}${action}`;
  const lines: string[] = ['var out: Array = []'];
  let eventNumber = 0;
  for (const action of actions) {
    lines.push(`InputMap.add_action(${gs(rename(action.name))}${action.deadzone === undefined ? '' : `, ${gd(action.deadzone)}`})`);
    for (const event of action.events) {
      const name = `m${String((eventNumber += 1))}`;
      lines.push(...gdEvent(name, event, rename), `InputMap.action_add_event(${gs(rename(action.name))}, ${name})`);
    }
  }
  for (const step of steps) {
    if ('parse' in step) {
      const name = `e${String((eventNumber += 1))}`;
      lines.push(...gdEvent(name, step.parse, rename), `Input.parse_input_event(${name})`);
    } else if ('press' in step) {
      lines.push(`Input.action_press(${gs(rename(step.press))}${step.strength === undefined ? '' : `, ${gd(step.strength)}`})`);
    } else if ('release' in step) {
      lines.push(`Input.action_release(${gs(rename(step.release))})`);
    } else if ('cursor' in step) {
      lines.push(`Input.set_custom_mouse_cursor(null, ${String(step.cursor)})`);
    } else if ('flush' in step) {
      lines.push('Input.flush_buffered_events()');
    } else if ('await' in step) {
      lines.push(step.await === 'physics' ? 'await physics_frame' : 'await process_frame');
    } else {
      lines.push(`out.append(${gdQuery(step.read, rename)})`);
    }
  }
  // Leave the main loop in a process step, where every case starts, with no event pending.
  lines.push('await process_frame', 'Input.flush_buffered_events()');
  for (const action of actions) lines.push(`InputMap.erase_action(${gs(rename(action.name))})`);
  lines.push('return out');

  const target = (): unknown => {
    let physics = 1000;
    let process = 1000;
    let phase: 'physics' | 'process' = 'process';
    I.godot_input_frame(physics, process, false);
    I.godot_input_map_load(actions.map((action) => ({ ...action, name: rename(action.name), events: action.events.map((event) => renameEvent(event, rename)) })));
    const nextIteration = (): void => {
      process += 1;
      I.godot_input_frame(physics, process, false);
      I.flush_buffered_events();
      physics += 1;
      I.godot_input_frame(physics, process, true);
      phase = 'physics';
    };
    const out: unknown[] = [];
    for (const step of steps) {
      if ('parse' in step) I.parse_input_event(renameEvent(step.parse, rename));
      else if ('press' in step) I.action_press(rename(step.press), ...(step.strength === undefined ? [] : [step.strength]));
      else if ('release' in step) I.action_release(rename(step.release));
      else if ('cursor' in step) I.set_custom_mouse_cursor(null, step.cursor);
      else if ('flush' in step) I.flush_buffered_events();
      else if ('await' in step) {
        if (step.await === 'physics') {
          nextIteration();
        } else {
          if (phase === 'process') nextIteration();
          I.godot_input_frame(physics, process, false);
          phase = 'process';
        }
      } else out.push(runQuery(step.read, rename));
    }
    I.flush_buffered_events();
    return out;
  };
  return { gdscript: lines.join('\n'), target };
}

export const vec = (x: number, y: number): V2.Vector2 => V2.construct(x, y);
