import {
  adapterEditorConfiguration,
  subscribeAdapterEditorConfiguration,
} from './adapter-editor-config';
import { effectiveSettings, subscribeSettings } from './settings-store';
/**
 * WHICH CHROME REGIONS ARE SHOWN right now — the one store the two document
 * regions (`DocumentHeaderStrip`, `DocumentShelfRail`), the title bar's own
 * strips and the inspector's presentation resolver read.
 *
 * WHAT IS NOT A KEY HERE: how the workbench names an open document. Editor
 * tabs, their strip and its presentation are the frame's, and a workspace that
 * declared them would be declaring something it cannot draw.
 *
 * Workspace and user style choices, with project adapter defaults:
 *   resolved[key] = workspace.regions[key] ?? adapter default ?? preset.regions[key] ?? default
 *  - the WORKSPACE layer is what the active workspace declares
 *    (`workspace-presets.ts`, `EditorWorkspaceRegions`) — Look hides every
 *    region and stays minimal under any preset;
 *  - the PRESET layer is what a style bundle asked for (`workspace-style.ts`,
 *    the fourth axis beside palette, material and composition), persisted
 *    like the other three so the bundle survives a reload.
 * A host with no workspaces and no bundles (a bounded host) never
 * writes either, so every region stays shown and the page pays for this
 * file alone. Same shape as every module-scope store here: value + version
 * + subscribe.
 */
export interface ChromeRegions {
  /** The workspace tab strip in the top bar (`ProjectHeader`); absent = hidden. */
  readonly workspaceTabs?: 'shown' | 'hidden';
  readonly header?: 'shown' | 'hidden';
  readonly shelf?: 'shown' | 'hidden';
  /** How the docked inspector lays its sections out — stacked (`column`) or
   *  tabbed behind a vertical rail (`properties`). Read by the presentation
   *  resolver (`inspector-presentation.ts`) beneath the user's own override. */
  readonly inspector?: 'column' | 'properties' | 'card';
  /** The bottom utility DRAWER (analytics, console, history…). Hidden means
   *  a workspace never shows it — not on a switch, not when play settles;
   *  Blender's modeling workspace has no timeline strip. */
  readonly drawer?: 'shown' | 'hidden';
  /** The top bar's runtime TELEMETRY cluster (`HeaderTelemetry`: the frame
   *  readout, its sparkline, the audio meter). A LOOK knob, not a product
   *  one — Invite and Account stay whatever this says, being identity rather
   *  than appearance, and the Profiler utility remains the door to the same
   *  numbers (the readout's own tooltip says so). Absent means shown, so
   *  every skin that predates this key is pixel-identical. */
  readonly telemetry?: 'shown' | 'hidden';
  /** The `·TypeName` a component-instance row prints after its name
   *  (`GameHierarchy.tsx`'s `hierarchy-instance-type`). A LOOK knob: measured
   *  on `outliner.png`, every Blender row carries its NAME ALONE — the type is
   *  the glyph, which is the whole reason the glyph is coloured by category.
   *
   *  Hiding it costs one VISIBLE fact, and only on rows where the name and the
   *  type differ (`EnemyBravo ·Enemy`). Where they agree it costs nothing, and
   *  that is every row of the starter template — the label IS the instance's
   *  `name` prop, which authors write as the component's own name (`Hero Box
   *  ·HeroBox`, `Ground ·Ground`). The row keeps the fact reachable when
   *  hidden: the label's own `title` carries the sentence, the inspector shows
   *  the component's sections, and the override `*` moves onto the NAME rather
   *  than leaving with the suffix it used to ride. Absent means shown, so
   *  every skin that predates this key is pixel-identical. */
  readonly hierarchyTypeSuffix?: 'shown' | 'hidden';
  /** The dotted RULE a component-instance row draws under its name
   *  (`semantic.instance`; the owner's 2026-07-31 ruling that instance identity
   *  is carried by a rule rather than by recolored text). A LOOK knob, the same
   *  kind as {@link ChromeRegions.hierarchyTypeSuffix} and measured the same
   *  way: `modeling-object-none.png` and `modeling-object-selected.png` carry
   *  NO rule, dotted or solid, under any Outliner name in any selection state —
   *  Blender marks an instance nowhere in that panel.
   *
   *  Hiding it costs the row's instance HINT, not the fact: the label's own
   *  `title`, the row's Go to Callsite / Open Component Source actions and the
   *  inspector's component sections all still say it. Absent means shown, so
   *  every skin that predates this key is pixel-identical.
   *
   *  Note the SEPARATE, older mechanism it sits above:
   *  `--vgai-tree-active-name-underline` (`theme.ts`) drops the rule on the
   *  SELECTED row alone, and only for a palette that declares an active ink,
   *  so two marks never argue on one row. That one is the palette's; this one
   *  is the look's, and where a look hides the rule outright the palette rule
   *  never gets a say. */
  readonly hierarchyInstanceRule?: 'shown' | 'hidden';
  /**
   * WHICH RESTRICTION COLUMNS an Outliner row carries at its right edge —
   * Blender's own filter, whose default decides the same thing there.
   *
   *  - `select+viewport` — this editor's own pair: a selection LOCK and the
   *    eye, packed against the row's right margin.
   *  - `viewport+render` — Blender's default filter. Measured on
   *    `outliner.png`: every object row carries exactly two marks, an eye at
   *    x 515-541 device (CSS ink 257.5-270.5, 32 px in from the area's own
   *    right edge) and a render camera at 555-581 (277.5-290.5, 12 px in);
   *    a 20 px column pitch, and NO lock glyph anywhere in the frame,
   *    Blender's Disable Selection column being off by default.
   *
   * The RENDER column is declared and left BLANK, deliberately. three.js has
   * one `Object3D.visible` governing viewport and render alike, so a second
   * toggle would write nothing and fail "a control is accepted through its own
   * click" — but Blender's columns are positions, and drawing our one eye in
   * the outer slot would put it in the render column and align it with
   * neither. Reserving the slot puts the eye exactly where Blender's eye is.
   * A skew whose adapter really does separate the two fills the column in;
   * nothing else changes.
   *
   * Absent means `select+viewport`, so every skin that predates this key is
   * pixel-identical.
   */
  readonly hierarchyRestrictions?: 'select+viewport' | 'viewport+render';
}

/**
 * EVERY REGION AND ITS DEFAULT, stated once.
 *
 * Three things read this — the merge, the snapshot key, and the absolute write
 * a bundle makes — and before 2026-09-18 each spelled the key list and its
 * default out by hand, so a seventh region meant editing the same table three
 * times and the merge tripped the complexity lint on the way.
 *
 * A NEW REGION IS FIVE EDITS, not the one this comment used to claim, and the
 * last two are the ones that bite: this table, its member on {@link
 * ChromeRegions}, the same member on `@volter/editor-sdk`'s
 * `WorkspaceArrangement['regions']` (which a contributed bundle is typed
 * against), `@volter/editor-project`'s `ChromeRegionsSettingsSchema`, which is
 * `.strict()`, and the FRAME's own configuration contribution
 * (`node scripts/workbench/generate-settings.mjs --write`, which rewrites
 * `packages/editor/workbench/src/vgaiGeneratedSettings.ts` from the JSON
 * Schema).
 *
 * Miss the fourth and NOTHING fails to compile: a region value the person sets is
 * written into `~/.vgai/settings.json`, the server rejects the unknown key with a 400, and the only report is a `[settings] Could not save
 * user settings` line in the editor console — every appearance preference
 * silently stops persisting. Measured 2026-09-18, found by `vgai console`
 * after nine failed writes.
 *
 * Miss the FIFTH and the frame drops the key on the way through instead: the
 * workbench's configuration service knows only the generated list, so
 * `vgaiSettings.ts` reports "…is not a vgai setting, so it was not applied" and
 * the region reverts to its default on the next read of persisted settings.
 * Measured 2026-09-21 by `vgai console` on the first boot after a new key
 * landed, which is the reason this list says five now.
 *
 * AND THE FIFTH HAS A RELEASE IN IT, which is the part that decides where a
 * look's value belongs. The generated artifact is built INTO a Code-OSS
 * release, so a running release cut before the key reports it and ignores it
 * until the next cut — a region is not a value a look can add and use in the
 * same session. A look value that the STAGE reads (the transform gizmo's
 * screen size, which tool its shelf opens on) therefore rides the THEME
 * instead, as `density.viewport` emitted onto the theme root by the page
 * itself: it crosses nothing (`@volter/editor-sdk/looks`'
 * `DensityContribution.viewport`, `native-selection-style.ts`'s readers).
 * A region stays a region — what CHROME is shown is genuinely a persisted
 * preference a person can also set.
 *
 * Run `npm run generate-schema` with the schema edit, then the settings
 * generator.
 */
const REGION_DEFAULTS = {
  workspaceTabs: 'hidden',
  header: 'shown',
  shelf: 'shown',
  inspector: 'column',
  drawer: 'shown',
  telemetry: 'shown',
  hierarchyTypeSuffix: 'shown',
  hierarchyInstanceRule: 'shown',
  hierarchyRestrictions: 'select+viewport',
} as const satisfies Required<ChromeRegions>;

const REGION_KEYS = Object.keys(REGION_DEFAULTS) as ReadonlyArray<keyof ChromeRegions>;

/** The regions whose values are not the `shown`/`hidden` pair, for
 *  {@link isRegions}. A key absent here takes that pair. */
const REGION_VALUES: Partial<Record<keyof ChromeRegions, readonly string[]>> = {
  inspector: ['column', 'properties', 'card'],
  hierarchyRestrictions: ['select+viewport', 'viewport+render'],
};

function isRegions(value: unknown): value is ChromeRegions {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(REGION_KEYS as readonly string[]).includes(key)) return false;
    const allowed = REGION_VALUES[key as keyof ChromeRegions] ?? ['shown', 'hidden'];
    if (!allowed.includes(record[key] as string)) return false;
  }
  return true;
}

/** The person's own region choices, in the settings layers as `appearance.regions`
 *  (`settings-store.ts`). A style never writes them: which regions exist is function, a
 *  workspace's and the person's (ARCHITECTURE.md rule 7). */
function readPersistedPreset(): ChromeRegions {
  const stored: unknown = effectiveSettings().appearance?.regions;
  return isRegions(stored) ? stored : {};
}

let _workspace: ChromeRegions = {};
let _preset: ChromeRegions = readPersistedPreset();
let _version = 0;
const _listeners = new Set<() => void>();

function resolved(key: keyof ChromeRegions): string | undefined {
  // `inspector` alone has a THIRD layer between the workspace and the preset:
  // the project adapter's own declaration (`adapter-editor-config.ts`).
  if (key === 'inspector')
    return _workspace.inspector ?? adapterEditorConfiguration().inspector ?? _preset.inspector;
  return _workspace[key] ?? _preset[key];
}

function merged(): ChromeRegions {
  const next: Record<string, string> = {};
  for (const key of REGION_KEYS) {
    const value = resolved(key);
    if (value) next[key] = value;
  }
  return next as ChromeRegions;
}

let _merged: ChromeRegions = merged();

export function activeChromeRegions(): ChromeRegions {
  return _merged;
}

/** The preset layer alone — what `workspace-style.ts` derives the active
 *  bundle from. */

/** A stable string, because `useSyncExternalStore` compares snapshots by
 *  identity and a fresh object would loop. */
export function chromeRegionsKey(): string {
  return regionsKey(_merged);
}

export function regionsKey(regions: ChromeRegions): string {
  return REGION_KEYS.map((key) => `${key}:${regions[key] ?? REGION_DEFAULTS[key]}`).join(' ');
}

function publish(): void {
  const before = chromeRegionsKey();
  _merged = merged();
  if (chromeRegionsKey() === before) return;
  _version += 1;
  for (const listener of _listeners) listener();
}

/** The active workspace's declaration (`workspace-presets.ts`). */
export function setWorkspaceRegions(regions: ChromeRegions): void {
  _workspace = regions;
  publish();
}


// A settings load or a project's own override changes the preset underneath.
function syncPreset(): void {
  const next = readPersistedPreset();
  if (regionsKey(next) === regionsKey(_preset)) return;
  _preset = next;
  publish();
}

subscribeSettings(syncPreset);

subscribeAdapterEditorConfiguration(publish);

export function subscribeChromeRegions(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export function chromeRegionsVersion(): number {
  return _version;
}

export function __resetChromeRegionsForTest(): void {
  _workspace = {};
  _preset = {};
  _merged = {};
  _version = 0;
}
