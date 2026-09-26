import type { EditorKeyActionId, KeyChord, KeymapContribution, KeymapNavigation } from '@volter/editor-sdk/looks';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  adapterSettings,
  projectSettings,
  subscribeSettings,
  updatePreferenceSettings,
  updateProjectSettings,
  userSettings,
} from './settings-store';

export type { EditorKeyActionId, KeyChord } from '@volter/editor-sdk/looks';
/**
 * KEYMAPS — the binding table behind every editor keyboard action.
 *
 * The ruling (docs/ARCHITECTURE-CORE.md §Editor chrome, the "Workspaces are
 * task-named layout memories" bullet, final sentence): *"Keymaps are
 * orthogonal to workspaces: a `keymap` setting selects the binding table
 * (`vgai` default; `blender` — G/R/S, A, Alt+A, `.` frame) through one
 * indirection at the action-registry/hotkey seam."*
 *
 * ONE INDIRECTION means exactly this: nothing in the editor spells a literal
 * key for a keyboard action any more. `editor-hotkeys.ts` builds its
 * `HotkeyBinding`s from {@link keyChordsFor}, and every place that PRINTS a
 * shortcut — the command palette (via `action-registry.ts`), the viewport
 * toolstrip tooltips, the snap transient hint —
 * renders {@link shortcutFor} over the same table. Switch the keymap and the
 * chrome tells the truth on the next paint, with no reload.
 *
 * The two axes this module is deliberately NOT: it is not a workspace (that is
 * `workspace-presets.ts` — layout, keyed per project) and not an appearance
 * preference (`theme-preference.ts`). A keymap is a per-user input preference,
 * persisted the way that module persists palette/material: one settings
 * key, lazily read, written on change, broadcast to `useSyncExternalStore`
 * subscribers, and simply falling back to the default when unreadable —
 * nothing a user authored is at stake in a stored preference.
 *
 * WHAT THIS DOES NOT GOVERN — the boundary, stated once: this table is the
 * EDITOR's own chrome bindings, consumed by `hotkeys.ts`'s single `keydown`
 * dispatcher on the editor's window. Play-mode input isolation is a different
 * mechanism entirely and is untouched by a keymap switch: the engine's
 * `InputManager.setEnabled` gate plus `gated-globals.ts`'s lexical
 * `window`/`document` shadow over project modules decide whether GAME code
 * hears a key. A game never reads this table, and no keymap entry can widen or
 * narrow what a running game receives.
 */

/** Any registered keymap's id: the editor's own `vgai`, or one a package
 *  contributes (`@volter/editor-sdk/looks`, `KeymapContribution`). */
export type EditorKeymapId = string;

export interface EditorKeymapDescriptor {
  readonly id: EditorKeymapId;
  readonly title: string;
  readonly description: string;
}

/** The editor's OWN keymap, the one every project has. Every other keymap is
 *  a package's contribution (Blender's ships with `@volter/editor-blender`). */
const BUILT_IN_KEYMAPS: readonly EditorKeymapDescriptor[] = Object.freeze([
  {
    id: 'vgai',
    title: 'vgai',
    description: "The editor's own bindings: W/E/R gizmo modes, Ctrl+A select all, F frames.",
  },
] satisfies readonly EditorKeymapDescriptor[]);

interface ContributedKeymap {
  readonly descriptor: EditorKeymapDescriptor;
  readonly table: EditorKeymapTable;
  readonly navigation: KeymapNavigation | null;
}
const contributedKeymaps = new Map<string, ContributedKeymap>();
let registryVersion = 0;

/** Built-ins first, then contributions in registration order — the switch
 *  surfaces (View menu, palette) enumerate this. */
export function editorKeymaps(): readonly EditorKeymapDescriptor[] {
  return [
    ...BUILT_IN_KEYMAPS,
    ...[...contributedKeymaps.values()].map((entry) => entry.descriptor),
  ];
}

export function editorKeymapsVersion(): number {
  return registryVersion;
}

/**
 * Register a package's keymap (`workspace.keymap` contribution). The table is
 * the editor's own bindings with the contribution's chords over them, so a
 * keymap declares only where it differs. Returns the unregister. A duplicate
 * id throws — ids are the `keymap` setting's values.
 */
export function registerContributedKeymap(contribution: KeymapContribution): () => void {
  if (
    BUILT_IN_KEYMAPS.some((entry) => entry.id === contribution.id) ||
    contributedKeymaps.has(contribution.id)
  )
    throw new Error(
      `registerContributedKeymap: keymap "${contribution.id}" is already registered.`,
    );
  const entry: ContributedKeymap = {
    descriptor: {
      id: contribution.id,
      title: contribution.title,
      description: contribution.description,
    },
    table: Object.freeze({ ...VGAI_KEYMAP, ...contribution.bindings }) as EditorKeymapTable,
    navigation: contribution.navigation ?? null,
  };
  contributedKeymaps.set(contribution.id, entry);
  registryVersion++;
  // A stored preference this contribution satisfies applies now, not on the
  // next reload: the cache re-reads the setting against the wider registry.
  cachedKeymap = null;
  emit();
  return () => {
    if (contributedKeymaps.get(contribution.id) !== entry) return;
    contributedKeymaps.delete(contribution.id);
    registryVersion++;
    cachedKeymap = null;
    emit();
  };
}

export function isEditorKeymapId(value: unknown): value is EditorKeymapId {
  return (
    typeof value === 'string' &&
    (BUILT_IN_KEYMAPS.some((entry) => entry.id === value) || contributedKeymaps.has(value))
  );
}

export type EditorKeymapTable = Readonly<Record<EditorKeyActionId, readonly KeyChord[]>>;

/**
 * The vgai table reproduces the bindings the editor shipped before keymaps
 * existed, chord for chord. It is the regression bar: any change here is a
 * change to the default editor, not to a keymap.
 */
const VGAI_KEYMAP: EditorKeymapTable = Object.freeze({
  'edit.undo': [{ key: 'z', mod: true }],
  // Ctrl+Y mirrors Ctrl+Shift+Z (Windows convention).
  'edit.redo': [
    { key: 'z', mod: true, shift: true },
    { key: 'y', mod: true },
  ],
  'edit.copy': [{ key: 'c', mod: true }],
  'edit.cut': [{ key: 'x', mod: true }],
  'edit.paste': [{ key: 'v', mod: true }],
  'edit.duplicate': [{ key: 'd', mod: true }],
  'edit.group': [{ key: 'g', mod: true }],
  'edit.wrap': [{ key: 'g', mod: true, alt: true }],
  'edit.unwrap': [{ key: 'g', mod: true, shift: true }],
  'edit.selectAll': [{ key: 'a', mod: true }],
  // No dedicated chord: Escape is the vgai deselect, and it carries the
  // scope-exit semantics too (`edit.exitScopeOrDeselect`). An empty chord list
  // registers no binding; the printed hint falls back to Escape's.
  'edit.deselectAll': [],
  'edit.save': [{ key: 's', mod: true }],
  'edit.delete': [{ key: 'delete' }, { key: 'backspace' }],
  'edit.enterScope': [{ key: 'enter' }],
  'edit.exitScopeOrDeselect': [{ key: 'escape' }],
  'edit.nudgeUp': [{ key: 'arrowup' }],
  'edit.nudgeUpCoarse': [{ key: 'arrowup', shift: true }],
  'edit.nudgeDown': [{ key: 'arrowdown' }],
  'edit.nudgeDownCoarse': [{ key: 'arrowdown', shift: true }],
  'edit.nudgeLeft': [{ key: 'arrowleft' }],
  'edit.nudgeLeftCoarse': [{ key: 'arrowleft', shift: true }],
  'edit.nudgeRight': [{ key: 'arrowright' }],
  'edit.nudgeRightCoarse': [{ key: 'arrowright', shift: true }],
  'view.resetPan': [{ key: '0', mod: true }],
  'view.commandPalette': [{ key: 'k', mod: true }],
  'view.toggleConsole': [{ key: '`' }],
  'view.focusMode': [{ key: 'f', mod: true, shift: true }],
  // Blender's own workspace cycle keys, and free in this registry.
  'workspace.cycleNext': [{ key: 'pagedown', mod: true }],
  'workspace.cyclePrevious': [{ key: 'pageup', mod: true }],
  // UNBOUND HERE, DELIBERATELY: this editor's own four transform tools already
  // hold T/W/E/R, and the Select tool arrived with the Blender look (whose
  // keymap puts it on Blender's own `W`). An empty list is the table's way of
  // saying a keymap binds nothing to an action, and the strip's button is the
  // tool's other door.
  'transform.select': [],
  'transform.combined': [{ key: 't' }],
  'transform.translate': [{ key: 'w' }],
  'transform.rotate': [{ key: 'e' }],
  'transform.scale': [{ key: 'r' }],
  'viewport.toggleSnap': [{ key: 's', shift: true }],
  'viewport.frameSelection': [{ key: 'f' }],
  'viewport.cyclePivot': [{ key: '.' }],
  'viewport.vertexSnapHold': [{ key: 'v' }],
  'viewport.snapToFloor': [{ key: '', code: 'PageDown' }],
  'view.top': [{ key: '', code: 'Numpad7' }],
  'view.front': [{ key: '', code: 'Numpad1' }],
  'view.right': [{ key: '', code: 'Numpad3' }],
  'view.perspective': [{ key: '', code: 'Numpad5' }],
  'view.camera': [{ key: '', code: 'Numpad0' }],
} satisfies EditorKeymapTable);

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

export const DEFAULT_EDITOR_KEYMAP: EditorKeymapId = 'vgai';

let cachedKeymap: EditorKeymapId | null = null;
let settingsSyncInstalled = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The editor's own keymap ids — the ones that exist in every project. */
function isBuiltInKeymapId(value: unknown): boolean {
  return typeof value === 'string' && BUILT_IN_KEYMAPS.some((entry) => entry.id === value);
}

/** What the PROJECT selects: its adapter's declaration, its own settings over it. */
function projectScopedKeymap(): unknown {
  return projectSettings().keymap ?? adapterSettings().keymap;
}

/**
 * A keymap a PACKAGE contributes is project-scoped: it exists only where that
 * package is declared, so only the project may select it — its adapter
 * (`editor: { keymap: blenderKeymap }`) or its own `.vgai/settings.json`. The
 * USER layer chooses among the editor's own, because a cross-project default
 * naming a skew's bindings is how a models project's G/R/S reached a game
 * project that merely happens to declare the same package.
 */
function readStoredKeymap(): EditorKeymapId {
  const scoped = projectScopedKeymap();
  if (isEditorKeymapId(scoped)) return scoped;
  const preferred = userSettings().keymap;
  return isBuiltInKeymapId(preferred) ? (preferred as EditorKeymapId) : DEFAULT_EDITOR_KEYMAP;
}

const saidUnavailable = new Set<string>();
/**
 * Say, once per id, that the STORED keymap is one nothing in this project
 * contributes, so a models project opened without its Blender package
 * explains the W/E/R it is showing. Called by the loader AFTER a contribution
 * pass has registered what the project's packages ship — asked at boot it
 * would warn about every keymap a package is about to contribute (measured
 * 2026-09-17: "blender is not available" on a project whose mesh package
 * registered it a moment later).
 */
export function reportUnavailableKeymap(): void {
  const stored = projectScopedKeymap();
  if (typeof stored !== 'string' || stored === DEFAULT_EDITOR_KEYMAP) return;
  if (isEditorKeymapId(stored) || saidUnavailable.has(stored)) return;
  saidUnavailable.add(stored);
  editorConsole.warn(
    `Keymap "${stored}" is not available in this project: no declared package contributes it ` +
      `(a package ships one as a \`workspace.keymap\` contribution). Using "${DEFAULT_EDITOR_KEYMAP}".`,
    'editor',
  );
}

/** The setting is `keymap` in the settings layers (`settings-store.ts`); a
 *  load finishing or a project's own override becoming active must not leave
 *  this module's cache lying. Installed on first read so the module has no
 *  load-time side effect. */
function ensureSettingsSync(): void {
  if (settingsSyncInstalled) return;
  settingsSyncInstalled = true;
  subscribeSettings(() => {
    const next = readStoredKeymap();
    if (next === cachedKeymap) return;
    cachedKeymap = next;
    emit();
  });
}

/** Current keymap id (`useSyncExternalStore`-shaped snapshot). */
export function activeEditorKeymap(): EditorKeymapId {
  ensureSettingsSync();
  cachedKeymap ??= readStoredKeymap();
  return cachedKeymap;
}

/**
 * Switch keymaps. Live: every binding registration re-derives from the new
 * table on this call (`editor-hotkeys.ts`) and every printed hint re-renders,
 * so there is no reload and no restart. Choosing one of the editor's OWN
 * keymaps writes where the key is declared; choosing a package's writes the
 * PROJECT layer, because that is the only layer a contributed keymap is read
 * from (see {@link readStoredKeymap}) — a gesture must land somewhere it wins.
 */
export function setEditorKeymapPreference(id: EditorKeymapId): void {
  if (activeEditorKeymap() === id) return;
  cachedKeymap = id;
  if (isBuiltInKeymapId(id)) updatePreferenceSettings({ keymap: id });
  else updateProjectSettings({ keymap: id });
  emit();
}

export function subscribeEditorKeymap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function __resetEditorKeymapForTest(): void {
  cachedKeymap = null;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// The one lookup
// ---------------------------------------------------------------------------

/** The active table's chords for one action. Empty means deliberately unbound. */
export function keyChordsFor(action: EditorKeyActionId): readonly KeyChord[] {
  return keymapTable(activeEditorKeymap())[action];
}

/** The active keymap's viewport mouse (`KeymapContribution.navigation`), the editor's own when
 *  it states none: orbit on the right button. */
export function activeKeymapNavigation(): KeymapNavigation {
  return contributedKeymaps.get(activeEditorKeymap())?.navigation ?? { orbit: 'right' };
}

/** A named table, for a surface that must show a keymap it is not running.
 *  An unregistered id answers the editor's own table. */
export function keymapTable(id: EditorKeymapId): EditorKeymapTable {
  return contributedKeymaps.get(id)?.table ?? VGAI_KEYMAP;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
}

/** Named keys whose label is neither the raw `key` nor its uppercase form. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  delete: 'Del',
  backspace: 'Backspace',
  escape: 'Esc',
  enter: 'Enter',
  pagedown: 'PgDn',
  pageup: 'PgUp',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
  tab: 'Tab',
};

const CODE_LABELS: Readonly<Record<string, string>> = {
  Numpad0: 'Num0',
  Numpad1: 'Num1',
  Numpad2: 'Num2',
  Numpad3: 'Num3',
  Numpad4: 'Num4',
  Numpad5: 'Num5',
  Numpad6: 'Num6',
  Numpad7: 'Num7',
  Numpad8: 'Num8',
  Numpad9: 'Num9',
  NumpadDecimal: 'Num.',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
  End: 'End',
  KeyG: 'G',
  KeyH: 'H',
  KeyJ: 'J',
  KeyK: 'K',
};

function keyLabel(chord: KeyChord): string {
  if (chord.code) return CODE_LABELS[chord.code] ?? chord.code;
  return KEY_LABELS[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
}

/**
 * Render one chord the way the editor's chrome has always rendered them —
 * BOTH existing conventions preserved verbatim, because changing a printed
 * string is a visible regression: a mod-prefixed chord reads `⌘⇧Z` / `Ctrl+⇧Z`
 * (the command palette's shape), while a modless chord spells its modifiers
 * out, `Shift+S` (the toolstrip's shape).
 */
export function formatChord(chord: KeyChord): string {
  const label = keyLabel(chord);
  if (chord.mod) {
    const mod = isMacPlatform() ? '⌘' : 'Ctrl+';
    return `${mod}${chord.alt ? '⌥' : ''}${chord.shift ? '⇧' : ''}${label}`;
  }
  const parts: string[] = [];
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(label);
  return parts.join('+');
}

/**
 * The printed hint for an action under the ACTIVE keymap — the first chord,
 * which every table lists in "the one to teach" order. `undefined` when the
 * action is deliberately unbound, so a caller can fall back or omit the hint
 * rather than print a lie.
 */
export function shortcutFor(action: EditorKeyActionId): string | undefined {
  const chord = keyChordsFor(action)[0];
  return chord ? formatChord(chord) : undefined;
}
