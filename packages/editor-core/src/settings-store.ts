/**
 * THE SETTINGS STORE — the shared layers, loaded once and read
 * synchronously everywhere (ARCHITECTURE-CORE §Editor chrome, "Settings have
 * four layers with named homes"):
 *
 *   user     ~/.vgai/settings.json            every project, this person
 *   adapter  <project>/vgai.adapter.ts        this project's own CODE
 *   project  <project>/.vgai/settings.json    this project, everyone (committed)
 *
 * `effectiveSettings()` is project over adapter over user, key by key.
 *
 * THE ADAPTER LAYER is the project's look and bindings as the adapter
 * DECLARES them — `editor: { style: blenderStyle, keymap: blenderKeymap }`,
 * imported objects, not a file the host parses (ARCHITECTURE-CORE §Adapters
 * and contributions are code, not configs). It sits above the USER layer
 * because it is a fact about THIS project and the user layer is one person's
 * cross-project default: a skew's Blender greys must not be undone by the
 * graphite a game project left in `~/.vgai/settings.json`. It sits below the
 * PROJECT layer because that file is this project's own explicit override, so
 * an appearance gesture still lands somewhere that wins. Appearance and
 * keymap choices write WHERE THE KEY IS DECLARED (`updatePreferenceSettings`):
 * the user layer, or the project layer when the project's own file carries
 * that key (a models scaffold declares its look, the way a repo's
 * `.vscode/settings.json` does) — so the gesture edits the file that wins;
 * the device preview frame is a project fact and writes the PROJECT layer. The other two layers — the project-LOCAL document
 * (`project-local-state.ts`, git-ignored) and the built-in defaults every
 * consumer carries — never pass through here.
 *
 * Boot awaits `preloadSettings()` before the first paint (`main.tsx`,
 * before React mounts), so a consumer's first synchronous read already sees
 * the person's palette; the project layer reloads whenever the active
 * project changes. A file that does not parse is reported to the editor
 * console by path — an unresolved condition, so `vgai console` carries it —
 * and that layer reads as empty until it is fixed.
 *
 * ## UNDER THE CODE-OSS FRAME THIS MODULE IS THE FALLBACK, not the truth
 *
 * ARCHITECTURE-CORE §The core is Code-OSS, U7: the frame's
 * `IConfigurationService` is the settings, and the same three layers are its
 * USER target, its MEMORY target (the adapter's declaration, gated by
 * `inspect` on the workspace value) and `.vscode/settings.json`. When
 * `settings/settings-provider.ts` reports a frame provider, every one of the
 * four layer views below is composed FROM IT, per key, through
 * `@volter/editor-project/settings/keys`'s table — so nothing that reads this module
 * changes shape, and `theme-preference.ts`, `workspace-regions.ts`,
 * `keymap-presets.ts` and `device-preview.ts` go on reading a nested
 * `EditorSettings` document exactly as they always did. The file layers are
 * still loaded, because they are what answers in the window before the
 * provider arrives and in every standalone session.
 */

import type { EditorHostSettingsInspection, EditorHostSettingsTarget } from '@volter/editor-sdk/host';
import { flattenSettings, settingsFromEntries, settingsKeys } from '@volter/editor-project/settings/keys';
import { type EditorSettings, mergeEditorSettings } from '@volter/editor-project/settings/schema';
import { activeProjectKey, getCurrentProject, onProjectChange } from '@volter/editor-sdk/kit/active-project';
import {
  adapterEditorConfiguration,
  subscribeAdapterEditorConfiguration,
} from './adapter-editor-config';
import { loadSettingsLayer, type SettingsLayer, saveSettingsLayer } from '@volter/editor-sdk/kit/api-settings';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { settingsProvider, subscribeSettingsProvider } from './settings/settings-provider';

type Listener = () => void;

let user: EditorSettings = {};
let project: EditorSettings = {};
let adapter: EditorSettings = {};
let effective: EditorSettings = {};
let userLoaded = false;
let projectLoadedFor: string | null = null;
let userLoading: Promise<void> | null = null;
let projectLoading: Promise<void> | null = null;
const listeners = new Set<Listener>();

function projectKey(): string {
  return activeProjectKey();
}

/**
 * The adapter's declared look and bindings, in the settings document's shape.
 * The style object carries the ids the registries resolve; the objects
 * themselves are registered by the package's own contributions, so a project
 * that declares the look without the package simply resolves to the editor's
 * defaults.
 *
 * This is the DECLARATION, read straight off the adapter, and it is what the
 * frame's bridge hands the configuration service to write into its MEMORY
 * target — so the frame never has a second notion of what the adapter said.
 */
export function declaredAdapterSettings(): EditorSettings {
  const editor = adapterEditorConfiguration();
  const style = editor.style;
  const layer: Record<string, unknown> = {};
  if (style) {
    const appearance: Record<string, unknown> = {
      palette: style.paletteId,
      material: style.materialId,
    };
    const icons = style.iconSetId ?? style.icons?.id;
    if (icons !== undefined) appearance['icons'] = icons;
    if (style.regions !== undefined) appearance['regions'] = style.regions;
    layer['appearance'] = appearance;
  }
  if (editor.keymap) layer['keymap'] = editor.keymap.id;
  return layer as EditorSettings;
}

/** The adapter layer AS IT IS IN FORCE — the declaration standalone, the
 *  configuration service's MEMORY target under the frame (where a project
 *  value for a key has already cleared it). Standalone it is read LIVE rather
 *  than from the cache below, so a reader that runs before the first
 *  `recompute()` sees the adapter's declaration and not an empty layer. */
export function adapterSettings(): EditorSettings {
  return settingsProvider() ? adapter : declaredAdapterSettings();
}

/** The adapter's declaration as dotted `vgai.*` keys — what the frame writes
 *  to the MEMORY target. */
export function declaredAdapterSettingEntries(): ReadonlyMap<string, unknown> {
  return flattenSettings(declaredAdapterSettings());
}

function recompute(): void {
  const provider = settingsProvider();
  if (provider) {
    // THE FRAME'S LAYERS, one key at a time. `inspect` is the only door that
    // separates them — the effective value alone cannot say whether a gesture
    // on this key will stick, and `keymap-presets.ts` and `device-preview.ts`
    // both ask exactly that.
    const users: [string, unknown][] = [];
    const adapters: [string, unknown][] = [];
    const projects: [string, unknown][] = [];
    const effectives: [string, unknown][] = [];
    for (const { key } of settingsKeys()) {
      const layered = provider.inspect(key);
      users.push([key, layered.user]);
      adapters.push([key, layered.adapter]);
      projects.push([key, layered.project]);
      effectives.push([key, layered.effective]);
    }
    user = settingsFromEntries(users);
    adapter = settingsFromEntries(adapters);
    project = settingsFromEntries(projects);
    effective = settingsFromEntries(effectives);
  } else {
    adapter = {};
    effective = mergeEditorSettings(mergeEditorSettings(user, declaredAdapterSettings()), project);
  }
  for (const listener of listeners) listener();
}

function report(layer: SettingsLayer, path: string | null, issues: readonly string[]): void {
  if (issues.length === 0) return;
  editorConsole.warn(
    `${layer} settings ${path ?? ''} did not parse and is ignored — ${issues.join('; ')}`,
    'settings',
  );
}

function loadUser(): Promise<void> {
  if (userLoaded) return Promise.resolve();
  userLoading ??= loadSettingsLayer('user')
    .then((read) => {
      user = read.settings;
      report('user', read.path, read.issues);
    })
    .catch(() => {
      user = {};
    })
    .finally(() => {
      userLoaded = true;
      userLoading = null;
    });
  return userLoading;
}

function loadProject(): Promise<void> {
  const key = projectKey();
  if (projectLoadedFor === key) return Promise.resolve();
  // In flight for another project: this one loads after it, never joins it.
  if (projectLoading) return projectLoading.then(() => loadProject());
  if (!getCurrentProject()) {
    project = {};
    projectLoadedFor = key;
    return Promise.resolve();
  }
  projectLoading = loadSettingsLayer('project')
    .then((read) => {
      project = read.settings;
      report('project', read.path, read.issues);
    })
    .catch(() => {
      project = {};
    })
    .finally(() => {
      projectLoadedFor = key;
      projectLoading = null;
    });
  return projectLoading;
}

/** Load both layers (memoized per layer; the project layer per project) and
 *  publish. Idempotent — every boot seam may await it. */
export function preloadSettings(): Promise<void> {
  return Promise.all([loadUser(), loadProject()]).then(recompute);
}

/** Project over adapter over user. */
export function effectiveSettings(): EditorSettings {
  return effective;
}

export function userSettings(): EditorSettings {
  return user;
}

export function projectSettings(): EditorSettings {
  return project;
}

/** Every layer's own value for one `vgai.*` key, plus the effective one —
 *  the door's `inspect`, answered from whichever side owns the settings. */
export function inspectSetting(key: string): EditorHostSettingsInspection {
  const provider = settingsProvider();
  if (provider) return provider.inspect(key);
  const read = (document: EditorSettings): unknown => flattenSettings(document).get(key);
  return {
    // The standalone layers are FILES; nothing under them carries a built-in
    // value, so answering anything here would be a fabricated layer.
    default: undefined,
    user: read(user),
    adapter: read(adapterSettings()),
    project: read(project),
    effective: read(effective),
  };
}

/** The effective value of one `vgai.*` key. */
export function getSetting(key: string): unknown {
  const provider = settingsProvider();
  return provider ? provider.get(key) : flattenSettings(effective).get(key);
}

/**
 * Which layer a gesture on this key must land in for it to stick: the project
 * when this project's ADAPTER or its own settings already declare the key,
 * the user layer otherwise.
 *
 * One rule, one implementation, both shapes — writing `appearance` to the
 * user layer in a project whose adapter declares a style is a gesture that
 * silently does nothing, and that is as true of the configuration service's
 * MEMORY target as it is of `.vgai/settings.json`.
 */
function targetFor(key: string): EditorHostSettingsTarget {
  if (!getCurrentProject()) return 'user';
  const layered = inspectSetting(key);
  return layered.adapter !== undefined || layered.project !== undefined ? 'project' : 'user';
}

/**
 * Write a set of `vgai.*` keys, grouped so each LAYER is written once.
 *
 * The grouping is not a micro-optimisation: standalone, a layer write is a
 * whole-document POST, so a two-key patch sent as two writes is two POSTs of
 * two different documents racing each other on the server's side — the same
 * "one document, one writer" reasoning `project-local-state.ts`'s header
 * gives for its sections.
 */
function applySettings(
  entries: Iterable<readonly [string, unknown]>,
  forced?: EditorHostSettingsTarget,
): void {
  const toUser: (readonly [string, unknown])[] = [];
  const toProject: (readonly [string, unknown])[] = [];
  for (const entry of entries) {
    const target = forced ?? targetFor(entry[0]);
    (target === 'project' ? toProject : toUser).push(entry);
  }
  const provider = settingsProvider();
  if (provider) {
    for (const [key, value] of toUser) provider.set(key, value, 'user');
    for (const [key, value] of toProject) provider.set(key, value, 'project');
    return;
  }
  if (toUser.length > 0) writeUserLayer(settingsFromEntries(toUser));
  if (toProject.length > 0) writeProjectLayer(settingsFromEntries(toProject));
}

/** Write one `vgai.*` key. With no target, {@link targetFor} picks the layer
 *  that wins. */
export function setSetting(key: string, value: unknown, target?: EditorHostSettingsTarget): void {
  applySettings([[key, value]], target);
}

/** Merge `patch` into the USER layer and write `~/.vgai/settings.json`. */
function writeUserLayer(patch: EditorSettings): void {
  user = mergeEditorSettings(user, patch);
  recompute();
  void saveSettingsLayer('user', user).catch((cause: unknown) => {
    editorConsole.error(`Could not save user settings: ${(cause as Error).message}`, 'settings');
  });
}

/**
 * Merge a PREFERENCE patch where each key lands WHERE IT WINS — see
 * {@link targetFor}. The patch is a nested document because that is the shape
 * every caller already holds; it is flattened to keys here, which is the one
 * place the two spellings meet.
 */
export function updatePreferenceSettings(patch: EditorSettings): void {
  applySettings(flattenSettings(patch));
}

/** Merge `patch` into the PROJECT layer. */
export function updateProjectSettings(patch: EditorSettings): void {
  if (!getCurrentProject()) return;
  applySettings(flattenSettings(patch), 'project');
}

function writeProjectLayer(patch: EditorSettings): void {
  if (!getCurrentProject()) return;
  project = mergeEditorSettings(project, patch);
  recompute();
  void saveSettingsLayer('project', project).catch((cause: unknown) => {
    editorConsole.error(`Could not save project settings: ${(cause as Error).message}`, 'settings');
  });
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

onProjectChange(() => {
  void loadProject().then(recompute);
});

// The adapter layer changes when a project's adapter module loads or unloads.
subscribeAdapterEditorConfiguration(recompute);

// And under the frame, when the configuration service says any layer moved —
// including the MEMORY value the frame clears the instant a project value for
// that key appears, which is what puts the project back above the adapter.
subscribeSettingsProvider(recompute);
