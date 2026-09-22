/**
 * THE EDITOR'S KEY ACTIONS — every action a chord can reach, as DATA.
 *
 * THERE IS ONE KEYBOARD AND IT IS VS CODE'S (ARCHITECTURE-CORE §The core is
 * Code-OSS rule 3). The editor installs no `keydown` dispatcher of its own;
 * what it publishes is this table, and the frame turns each entry into a
 * `vgai.<id>` command with a `when` clause over our panes' context keys
 * (`scripts/workbench/generate-keymaps.mjs` writes one keybinding rule per
 * (action, chord, keymap) into a built-in extension, read from this repo's own
 * keymap tables — so a chord is written in ONE place whichever keyboard is
 * driving).
 *
 * WHY, measured: with two listeners on one page, `1,1,1,2,2,2` typed into
 * Monaco arrived as `,,,,,`, the file saved as `BoxGeometry(,,,,,)`, and a
 * `Control+W` meant for the workbench opened Edit Mode's Inset tool.
 *
 * An action's BODY is written once, in `editor-hotkeys.ts`'s `bind()` call —
 * the same call that fills this table also fills the binding row — so a
 * handler cannot exist for one keyboard and not the other.
 */ import type { EditorKeyActionId } from '@volter/editor-sdk/looks';

export type KeyActionScope = 'stage' | 'panel' | 'global';

export interface KeyActionEntry {
  readonly id: EditorKeyActionId;
  /** Run the action. The event is the host dispatcher's; the frame has none. */
  readonly run: (event?: KeyboardEvent) => void;
  readonly scope: KeyActionScope;
  /**
   * The action's own runtime gate, where it can be asked without an event —
   * the play-state and clipboard-ownership conditions. A gate that reads the
   * EVENT (undo/redo's editable-target test) is not lifted here: under the
   * frame the focus condition it approximates is a `when` clause, and under
   * the host the dispatcher still applies its own `when`.
   */
  readonly enabled?: () => boolean;
}

const actions = new Map<EditorKeyActionId, KeyActionEntry>();
let actionsVersion = 0;
const actionListeners = new Set<() => void>();

function emitActions(): void {
  actionsVersion++;
  for (const listener of actionListeners) listener();
}

/**
 * Record what one action DOES. Last registration wins: the shell and viewport
 * binding sets rebuild on every keymap switch (`registerKeymapBindings`), and
 * a rebuild re-registers the same ids with fresh closures over the same store.
 * Returns the removal, which only fires if this entry is still the live one.
 */
export function registerKeyAction(entry: KeyActionEntry): () => void {
  actions.set(entry.id, entry);
  emitActions();
  return () => {
    if (actions.get(entry.id) !== entry) return;
    actions.delete(entry.id);
    emitActions();
  };
}

/** Every action the editor currently has a handler for. */
export function registeredKeyActions(): readonly KeyActionEntry[] {
  return [...actions.values()];
}

export function keyActionsVersion(): number {
  return actionsVersion;
}

export function subscribeKeyActions(listener: () => void): () => void {
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}

/**
 * Run one action by id — the frame's door. `false` means the editor has no
 * handler for it right now (the viewport set is registered only while a three
 * stage is mounted) or its own gate refused; the frame's command answers the
 * same, so a keybinding that reaches a dead action is visible rather than
 * silent.
 */
export function invokeKeyAction(id: EditorKeyActionId): boolean {
  const entry = actions.get(id);
  if (!entry) return false;
  if (entry.enabled && !entry.enabled()) return false;
  entry.run();
  return true;
}
