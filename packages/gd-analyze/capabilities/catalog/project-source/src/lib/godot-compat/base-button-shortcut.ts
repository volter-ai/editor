/** BaseButton.shortcut over retained Shortcut/InputMap identities. */

import { createInputEventAction, type GodotInputMapEvent } from './input';
import { optionalControlBinding } from './control-state';
import {
  getGodotShortcutMajor,
  isGodotShortcut,
  type GodotShortcut,
} from './shortcut';

interface ShortcutBinding {
  readonly major: 3 | 4;
  readonly activate: () => void;
  shortcut: GodotShortcut | null;
}

const BINDINGS = new WeakMap<object, ShortcutBinding>();
const ACCEPTED_ACTIONS = new WeakMap<object, Set<string>>();

export function bindBaseButtonShortcut(
  button: object,
  major: 3 | 4,
  activate: () => void,
): () => void {
  if (BINDINGS.has(button)) throw new Error('BaseButton.shortcut is already bound.');
  const binding: ShortcutBinding = { major, activate, shortcut: null };
  BINDINGS.set(button, binding);
  return () => { BINDINGS.delete(button); };
}

function bindingOf(button: object): ShortcutBinding {
  const binding = BINDINGS.get(button);
  if (binding === undefined) throw new Error('BaseButton.shortcut requires a retained BaseButton entity.');
  return binding;
}

export function getBaseButtonShortcut(button: object): GodotShortcut | null {
  return bindingOf(button).shortcut;
}

export function setBaseButtonShortcut(button: object, shortcut: GodotShortcut | null): void {
  const binding = bindingOf(button);
  if (shortcut !== null) {
    if (!isGodotShortcut(shortcut)) throw new TypeError('BaseButton.shortcut requires a retained Shortcut Resource.');
    if (getGodotShortcutMajor(shortcut) !== binding.major) {
      throw new TypeError(`BaseButton.shortcut requires a Godot ${binding.major} Shortcut Resource.`);
    }
  }
  binding.shortcut = shortcut;
}

interface ShortcutInputMap {
  getActions(): string[];
  getActionList(action: string): GodotInputMapEvent[];
  isActionJustPressed(action: string): boolean;
}

/** Poll the mounted engine InputMap, then route its retained InputEvent through Shortcut matching. */
export function pollBaseButtonShortcut(button: object, input: ShortcutInputMap): boolean {
  const binding = bindingOf(button);
  if (binding.shortcut === null) return false;
  if (Reflect.get(button, 'disabled') === true) return false;
  const control = optionalControlBinding(button);
  if (control !== undefined) {
    let id: string | undefined = control.id;
    const visited = new Set<string>();
    while (id !== undefined && !visited.has(id)) {
      visited.add(id);
      const authored = control.state.authored(id);
      const retained = control.state.read(id);
      if ((retained.visible ?? authored?.visible ?? true) === false) return false;
      id = authored?.parentId;
    }
    if (Reflect.has(button, 'parent')) {
      if (Reflect.get(button, 'parent') === null) return false;
    } else {
      const element = control.state.read(control.id).focusElement;
      if (element === undefined || element === null || !element.isConnected) return false;
    }
  } else {
    let current: unknown = button;
    let attached = false;
    while (typeof current === 'object' && current !== null) {
      if (Reflect.get(current, 'visible') === false) return false;
      const parent = Reflect.get(current, 'parent');
      if (parent === null || parent === undefined) break;
      attached = true;
      current = parent;
    }
    if (!attached) {
      throw new Error('BaseButton.shortcut activation requires the button to be inside the retained scene tree.');
    }
  }
  for (const action of input.getActions()) {
    if (!input.isActionJustPressed(action)) continue;
    const actionEvent = createInputEventAction();
    actionEvent.action = action;
    const matchesAction = binding.shortcut.matches_event(actionEvent);
    const matchesPhysical = input
      .getActionList(action)
      .some((event) => binding.shortcut?.matches_event(event) === true);
    if (!matchesAction && !matchesPhysical) continue;
    let accepted = ACCEPTED_ACTIONS.get(input as object);
    if (accepted === undefined) {
      accepted = new Set();
      ACCEPTED_ACTIONS.set(input as object, accepted);
      queueMicrotask(() => { ACCEPTED_ACTIONS.delete(input as object); });
    }
    if (accepted.has(action)) return false;
    accepted.add(action);
    binding.activate();
    return true;
  }
  return false;
}
