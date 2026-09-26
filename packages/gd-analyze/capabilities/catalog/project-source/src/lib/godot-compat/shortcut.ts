/** Godot 3 ShortCut / Godot 4 Shortcut Resource over retained InputEvent values. */

import { inputEventAsText, type GodotInputMapEvent } from './input';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotShortcut {
  events: readonly GodotInputMapEvent[];
  shortcut: GodotInputMapEvent | null;
  set_events(events: readonly GodotInputMapEvent[]): void;
  get_events(): readonly GodotInputMapEvent[];
  set_shortcut(event: GodotInputMapEvent | null): void;
  get_shortcut(): GodotInputMapEvent | null;
  has_valid_event(): boolean;
  is_valid(): boolean;
  matches_event(event: GodotInputMapEvent): boolean;
  get_as_text(): string;
}

interface ShortcutState {
  readonly major: 3 | 4;
  events: readonly GodotInputMapEvent[];
}

const STATE = new WeakMap<GodotShortcut, ShortcutState>();

function inputEvent(value: unknown, member: string): GodotInputMapEvent {
  if (
    typeof value !== 'object' || value === null ||
    !('__godotClass' in value) || typeof (value as { __godotClass?: unknown }).__godotClass !== 'string' ||
    !('as_text' in value) || typeof (value as { as_text?: unknown }).as_text !== 'function'
  ) {
    throw new TypeError(`Shortcut.${member} requires a retained InputEvent.`);
  }
  return value as GodotInputMapEvent;
}

function eventArray(value: unknown): readonly GodotInputMapEvent[] {
  if (!Array.isArray(value)) throw new TypeError('Shortcut.events must be an Array of InputEvent values.');
  return value.map((event) => inputEvent(event, 'events'));
}

function stateOf(shortcut: GodotShortcut): ShortcutState {
  const state = STATE.get(shortcut);
  if (state === undefined) throw new Error('Shortcut operation requires a retained Shortcut Resource.');
  return state;
}

function sameEvent(left: GodotInputMapEvent, right: GodotInputMapEvent): boolean {
  if (left.__godotClass !== right.__godotClass) return false;
  if (left.device >= 0 && right.device >= 0 && left.device !== right.device) return false;
  if (left.control !== undefined && left.control !== (right.control ?? false)) return false;
  if (left.alt_pressed !== undefined && left.alt_pressed !== (right.alt_pressed ?? false)) return false;
  if (left.shift_pressed !== undefined && left.shift_pressed !== (right.shift_pressed ?? false)) return false;
  if (left.meta_pressed !== undefined && left.meta_pressed !== (right.meta_pressed ?? false)) return false;
  if (left.__godotClass === 'InputEventKey') {
    if ((left.physical_keycode ?? 0) !== 0) return left.physical_keycode === right.physical_keycode;
    if ((left.keycode ?? 0) !== 0) {
      return left.keycode === right.keycode || left.keycode === right.physical_keycode;
    }
    return (left.scancode ?? 0) === (right.scancode ?? 0);
  }
  if (left.__godotClass === 'InputEventMouseButton') return left.button_index === right.button_index;
  if (left.__godotClass === 'InputEventJoypadButton') return left.button_index === right.button_index;
  if (left.__godotClass === 'InputEventJoypadMotion') {
    return left.axis === right.axis && Math.sign(left.axis_value ?? 0) === Math.sign(right.axis_value ?? 0);
  }
  if (left.__godotClass === 'InputEventAction') return left.action === right.action;
  return false;
}

export function isGodotShortcut(value: unknown): value is GodotShortcut {
  return typeof value === 'object' && value !== null && STATE.has(value as GodotShortcut);
}

export function getGodotShortcutMajor(shortcut: GodotShortcut): 3 | 4 {
  return stateOf(shortcut).major;
}

export function createShortcut(major: 3 | 4 = 4): GodotShortcut {
  const shortcut = {} as GodotShortcut;
  const state: ShortcutState = { major, events: [] };
  STATE.set(shortcut, state);
  registerGodotObjectIdentity(shortcut, major === 3 ? 'ShortCut' : 'Shortcut');
  Object.defineProperties(shortcut, {
    events: {
      enumerable: true,
      get: () => [...state.events],
      set: (value: readonly GodotInputMapEvent[]) => shortcut.set_events(value),
    },
    shortcut: {
      enumerable: true,
      get: () => state.events[0] ?? null,
      set: (value: GodotInputMapEvent | null) => shortcut.set_shortcut(value),
    },
  });
  Object.assign(shortcut, {
    set_events(value: readonly GodotInputMapEvent[]): void {
      if (state.major === 3) throw new Error('ShortCut.set_events does not exist in Godot 3; use set_shortcut.');
      state.events = [...eventArray(value)];
      godotResourceEmitChanged(shortcut);
    },
    get_events(): readonly GodotInputMapEvent[] { return [...state.events]; },
    set_shortcut(value: GodotInputMapEvent | null): void {
      if (value === null) state.events = [];
      else state.events = [inputEvent(value, 'shortcut')];
      godotResourceEmitChanged(shortcut);
    },
    get_shortcut(): GodotInputMapEvent | null { return state.events[0] ?? null; },
    has_valid_event(): boolean { return state.events.length > 0; },
    is_valid(): boolean { return state.events.length > 0; },
    matches_event(value: GodotInputMapEvent): boolean {
      const event = inputEvent(value, 'matches_event');
      return state.events.some((candidate) => sameEvent(candidate, event));
    },
    get_as_text(): string {
      return state.events.map((event) => inputEventAsText(event)).join(', ');
    },
  });
  bindGodotResourceProtocol(shortcut, {
    createDuplicate(source) {
      const duplicate = createShortcut(stateOf(source).major);
      stateOf(duplicate).events = [...stateOf(source).events];
      return duplicate;
    },
  });
  return shortcut;
}
