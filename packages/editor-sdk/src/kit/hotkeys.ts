let _installed = false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HotkeyScope =
  | 'viewport'
  | 'hierarchy'
  | 'inspector'
  | 'asset-browser'
  | 'workspace'
  | 'global';

const HOTKEY_SCOPES = new Set<HotkeyScope>([
  'viewport',
  'hierarchy',
  'inspector',
  'asset-browser',
  'workspace',
  'global',
]);

export interface HotkeyBinding {
  /** The key to match (`e.key`, lowercase). Ignored when `code` is set. */
  key: string;
  /** Match on `e.code` instead of `e.key` (for numpad keys). */
  code?: string;
  /** Require Ctrl (Win/Linux) or Cmd (Mac). */
  mod?: boolean;
  /** Require the Control key itself, on every platform. */
  ctrl?: boolean;
  /** Require Shift. */
  shift?: boolean;
  /** Require Alt/Option (D4 — `wrap`'s `Ctrl+Alt+G`). */
  alt?: boolean;
  /** Scope(s) this binding belongs to. `'global'` bindings fire regardless of panel focus. */
  scope: HotkeyScope | readonly HotkeyScope[];
  /** Action to execute when the binding matches. */
  action: (e: KeyboardEvent) => void;
  /** Optional runtime gate. When it returns false, the binding yields to the
   * browser and does not call preventDefault(). Use this for commands whose
   * shortcut overlaps native behavior, such as Copy with a DOM text selection. */
  when?: (e: KeyboardEvent) => boolean;
  /** Allow this binding while a form control/contenteditable owns focus.
   * Reserved for commands such as Save that are expected inside editors. */
  allowInEditable?: boolean;
  /** Human-readable label for menus / tooltips. */
  label?: string;
}

// ---------------------------------------------------------------------------
// Active scope (which panel was last interacted with)
// ---------------------------------------------------------------------------

let _activeScope: HotkeyScope = 'viewport';

const ACTIVE_SCOPE_DATA_KEY = 'editorActiveHotkeyScope';

export function getActiveScope(): HotkeyScope {
  const shared = document.documentElement.dataset[ACTIVE_SCOPE_DATA_KEY];
  if (shared && HOTKEY_SCOPES.has(shared as HotkeyScope)) return shared as HotkeyScope;
  return _activeScope;
}

export function setActiveScope(scope: HotkeyScope): void {
  _activeScope = scope;
  // Vite can temporarily retain both pre- and post-HMR module instances.
  // The editor shell is the durable ownership authority, so mirror the value
  // onto the shared document rather than trusting one module-local singleton.
  document.documentElement.dataset[ACTIVE_SCOPE_DATA_KEY] = scope;
}

/** True when a DOM target belongs to a native text-editing surface. Shared
 * by the global dispatcher and panel-local handlers so bubbled Backspace,
 * Delete, and clipboard shortcuts cannot mutate editor state while typing. */
/**
 * Fields that COMMIT PER KEYSTROKE — the inspector's numeric transform/prop
 * inputs — carry no meaningful native text-undo: they are controlled inputs
 * whose value is re-rendered from committed state, so the browser's own
 * Cmd+Z is a dead key inside them. Marking one with this attribute lets the
 * app's undo/redo bindings fire while it holds focus (measured 2026-08-27:
 * after typing a transform value, undo silently did nothing until the field
 * was blurred). Everything else keeps the editable guard — a rename box or a
 * chat composer must keep native text undo.
 */
export const APP_UNDO_PASSTHROUGH_ATTR = 'data-editor-app-undo';

/** True when `target` sits inside a field that opted into app undo/redo. */
export function allowsAppUndoWhileEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${APP_UNDO_PASSTHROUGH_ATTR}]`) !== null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable]:not([contenteditable="false"])'));
}

function scopeFromOwnershipEvent(event: Event): HotkeyScope | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    // A layout host moves focus through internal navigation sentinels that
    // sit directly under the shell. A focusin on that infrastructure must not
    // erase the concrete panel established by the preceding pointerdown.
    // Pointerdown still uses the fallback, so genuinely clicking unclaimed
    // chrome neutralizes authoring commands as intended.
    if (event.type === 'focusin' && target.hasAttribute('data-editor-hotkey-fallback')) continue;
    const candidate = target.dataset['editorHotkeyScope'];
    if (candidate && HOTKEY_SCOPES.has(candidate as HotkeyScope)) {
      return candidate as HotkeyScope;
    }
  }
  return null;
}

function handleOwnershipEvent(event: Event): void {
  const scope = scopeFromOwnershipEvent(event);
  if (scope) setActiveScope(scope);
}

// ---------------------------------------------------------------------------
// Binding registry
// ---------------------------------------------------------------------------

const _bindings: HotkeyBinding[] = [];

/**
 * Register hotkey bindings. Returns a dispose function that removes them.
 */
export function registerHotkeys(bindings: HotkeyBinding[]): () => void {
  _bindings.push(...bindings);
  return () => {
    for (const b of bindings) {
      const idx = _bindings.indexOf(b);
      if (idx >= 0) _bindings.splice(idx, 1);
    }
  };
}

// ---------------------------------------------------------------------------
// Play-mode bare-key yield (owner ruling, 2026-08-30)
// ---------------------------------------------------------------------------

/**
 * While Play runs and the GAME holds the keyboard, bare-key shell bindings
 * yield — W/E/R belong to the game, not the transform gizmo — and ⌘/Ctrl
 * chords stay the editor's (undo, save, palette). The predicate lives with
 * play-mode (which owns play/tab state); this module stays dependency-free
 * and just asks. Registered null ⇒ no yield (editor-only sessions, tests).
 */
/**
 * Attach the scope-ownership listeners. Call once at startup.
 *
 * THERE IS NO KEYDOWN LISTENER HERE, and that is the whole shape of this
 * module: VS Code's keybinding service is the one keyboard, and every editor
 * action reaches it as a `vgai.<id>` command with a `when` clause over our
 * panes' context keys (`scripts/workbench/generate-keymaps.mjs` writes one rule per
 * (action, chord, keymap) into a built-in extension). A second window-level
 * listener here would be the second owner the ruling forbids — and it was
 * measured as exactly that: `1,1,1,2,2,2` typed into Monaco arrived as
 * `,,,,,`, the file saved as `BoxGeometry(,,,,,)`, and a `Control+W` meant for
 * the workbench opened Edit Mode's Inset tool.
 *
 * The SCOPE listeners are still ours and still needed: `getActiveScope()` is
 * read by panel chrome as well as by the frame's `when` clauses, and they
 * consume no keys. Ownership is captured before React's panel-local bubble
 * handlers run, so the closest declarative scope in the composed path wins and
 * the shell's `workspace` marker is a safe neutral fallback.
 */
export function installHotkeys(): void {
  if (_installed) return;
  window.addEventListener('pointerdown', handleOwnershipEvent, true);
  window.addEventListener('focusin', handleOwnershipEvent, true);
  _installed = true;
}

/** Detach the scope-ownership listeners. */
export function uninstallHotkeys(): void {
  window.removeEventListener('pointerdown', handleOwnershipEvent, true);
  window.removeEventListener('focusin', handleOwnershipEvent, true);
  _installed = false;
}
