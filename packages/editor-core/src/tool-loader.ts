/**
 * Browser loader for editor contribution modules. Callable discovery/execution
 * stays Node-side; this module imports the contribution modules the server
 * FOUND BY SCANNING (`server/project-tools.ts`) and reads each one's own
 * declaration — `point`, `title`/`presentations`, and the `tool` it drives.
 *
 * Nothing about a contribution is written down anywhere but the module.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faScrewdriverWrench } from '@fortawesome/free-solid-svg-icons';
import { EditorClient } from '@volter/editor-sdk';
import type {
  ToolAnalyticsContributionProps,
  ToolAssetInspectorContributionMatch,
  ToolAssetInspectorContributionProps,
  ToolContributionNode,
  ToolContributionProps,
  ToolGenerationResultContributionMatch,
  ToolGenerationResultContributionProps,
  ToolInspectorContributionMatch,
  ToolInspectorContributionProps,
  ToolUtilityContributionProps,
} from '@volter/editor-sdk/contributions';
import { registerProjectModuleLoader } from '@volter/editor-sdk/contributions';
import {
  chromeContributionKind,
  isCommandContribution,
  isConfigurationKindContribution,
  isEditorLanePath,
  isFinderContribution,
  isServiceContribution,
  lookContributionKind,
  type LookContributionKind,
  TOOL_CONTRIBUTION_SUFFIXES,
} from '@volter/editor-sdk/session/tool-contribution-convention';
import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import type { ToolContributionPoint } from '@volter/editor-sdk/project-tool-catalog';
import { type ComponentType, createElement } from 'react';
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import {
  isContributableMenu,
  registerContributedActions,
  registerContributedHeaderItem,
  registerContributedMenu,
} from '@volter/editor-sdk/kit/chrome-registry';
import { contributedCommandRows, registerContributedCommands } from '@volter/editor-sdk/kit/command-registry';
import { InspectorToolSection } from './components/InspectorToolSection';
import { ToolHost } from './components/ToolHost';
import { editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';
import { CONTRIBUTED_SECTION_ORDER } from '@volter/editor-sdk/kit/inspection-model';
import {
  type InspectorSectionIcon,
  type InspectorSectionMatchContext,
  registerInspectorSections,
} from '@volter/editor-sdk/kit/inspector-section-registry';
import { registerContributedKeymap, reportUnavailableKeymap } from '@volter/editor-sdk/kit/keymap-presets';
import { projectMounts } from '@volter/editor-sdk/kit/project-shape';
import type { ProjectToolCatalog, ProjectToolCatalogEntry } from '@volter/editor-sdk/kit/project-tools';
import { publishPlayUtilitiesReady } from '@volter/editor-sdk/kit/workspace-play-utilities';
import { registerContributedWorkspace } from './workspace-presets';
import { registerWorkspaceStatus } from '@volter/editor-sdk/kit/workspace-status-registry';
import { registerContributedStyle } from './workspace-style';
import { registerViewPreset, type ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';
import { type EnvironmentImageSet, registerEnvironmentImages } from '@volter/editor-sdk/kit/environment-images';
import { registerWorkspaceUtility } from '@volter/editor-sdk/kit/workspace-utility-registry';

/**
 * A SUBJECT-DEPENDENT GLYPH NAME (see {@link LoadedToolContributionBase.icon}).
 * `adapter` is the active authoring adapter, deliberately `unknown` here for
 * the same reason it is at the contribution point: a contribution reads its
 * own adapter's native API and the host fabricates no projection of it.
 */
export type ToolContributionIconResolver = (
  node: ToolContributionNode | null,
  adapter: unknown,
) => string;

interface LoadedToolContributionBase {
  /**
   * Path-derived contribution id (`humanoid-builder.document`), or the
   * presentation id for a many-mount module. It used to be prefixed with the
   * owning tool's name because contributions were nested under one; they are
   * not, so the id is simply its own.
   */
  id: string;
  title: string;
  file: string;
  version: number;
  /**
   * `export const icon = 'properties-data'` — the NAME of the glyph that
   * stands for this contribution wherever the host shows one. A name, so the
   * active icon set paints it (and may tint it by category); the host's
   * generic tool glyph when omitted. Read by `selection.inspector` today.
   *
   * IT MAY ALSO BE A FUNCTION OF THE SUBJECT, and that is Blender's own shape
   * rather than a generalization: the Properties editor's Object Data tab
   * draws a DIFFERENT mark per object type — `buttons_context_compute`
   * (`space_buttons/buttons_context.cc:795-810`) sets `sbuts->dataicon` from
   * `RNA_struct_ui_icon(ptr->type)`, so a mesh's tab is `MESH_DATA`, an
   * armature's `ARMATURE_DATA` and a light's `OUTLINER_DATA_LIGHT`. A static
   * export cannot say that. The resolver is handed the same `(node, adapter)`
   * a `selection.inspector` matcher gets and answers a glyph NAME; the host
   * reads either shape (`inspection/compose.ts`).
   */
  icon?: string | ToolContributionIconResolver;
  /**
   * THE PACKAGE (or project folder) THIS MODULE SHIPPED IN, derived from
   * `file`. It is what makes "a document's package owns its Properties rail"
   * answerable: the composer keeps the sections whose owner is the active
   * document's own package and stands every other one down
   * (`inspection/compose.ts`, `ComposeInspectionInput.rail`).
   */
  owner: string;
  /**
   * `export const railGroup = 'scene'` — which GROUP of the Properties rail
   * this section belongs to. Blender's own rail is grouped, not a flat strip:
   * `ED_buttons_tabs_list` (`space_buttons/space_buttons.cc:201-255`) calls
   * `add_spacer()` between the tool tab, the scene group (Render, Output, View
   * Layer, Scene, World), Collection, the object group (Object … Material) and
   * Texture, and each spacer appends a `BCONTEXT_SEPARATOR` the rail draws as
   * a gap. The name is free and compared for equality only; consecutive
   * sections sharing one form a group, and the presentation rules between
   * groups (`components/InspectionProjection.tsx`). Read by
   * `selection.inspector` alone, like `order` and `icon`.
   */
  railGroup?: string;
  /**
   * `export const railDefault = true` — this is the tab the Properties rail
   * OPENS ON when nothing has been chosen for this subject yet. Blender's
   * Properties editor does not open on its first tab: the context is stored
   * per screen in the startup file, and at factory settings
   * `bpy.data.screens['Layout']` reads `OBJECT` while the rail's first tab is
   * Render (measured against Blender 5.2 LTS, walk 5 parity row 3). Without a
   * declaration the presentation falls back to the first tab, which is what
   * every non-Blender rail wants. Read by `selection.inspector` alone, like
   * `order`, `icon` and `railGroup`.
   */
  railDefault?: boolean;
  /**
   * `export const order = 2` — where this contribution sits among its
   * siblings, low first, INSIDE the contributed band
   * ({@link contributedSectionOrder}). Read where sibling sequence is a real
   * question, which today is `selection.inspector` alone.
   *
   * OPTIONAL, and a module that declares none sits BEHIND every module that
   * did, keeping its discovery position among the other silent ones:
   * declaring is how a module claims a place, and staying silent is how it
   * takes whatever is left. Range 0…{@link MAX_DECLARED_ORDER}, so no
   * declaration can climb out of the band and over a built-in block.
   *
   * It exists because the discovery scan is alphabetical, which is an
   * accident of filenames rather than a statement about the surface: the
   * dev-tools capability's four facet sections are Stats, Cheats, Tuning,
   * Autopilot in the ruling that created them, and would otherwise mount
   * Autopilot → Cheats → Stats → Tuning. A module states its own position
   * because it is the only thing that knows it.
   */
  order?: number;
}

/**
 * The points that DRIVE a callable, and therefore must name one.
 *
 * `tool` lives here rather than on the base because the PRESENTING points do
 * not: {@link UtilityToolContribution}, {@link InspectorToolContribution},
 * and {@link GlobalToolContribution} (a document may be a pure view — a
 * game's Data Book over its own src/data modules). Keeping it off the base
 * is what makes the relaxation apply to exactly those, instead of quietly
 * making every consumer of every other point handle `undefined`.
 */
interface CallableToolContributionBase extends LoadedToolContributionBase {
  /**
   * The catalog entry the module NAMED (`export const tool = 'project.x.y'`),
   * resolved here. The editor still needs the whole entry — generation role and
   * provider group the generative documents, summary/description search them —
   * so resolution happens once, at load, rather than at every consumer.
   */
  tool: ProjectToolCatalogEntry;
}

export interface GlobalToolContribution extends LoadedToolContributionBase {
  point: 'workspace.document';
  /** Present when the document DRIVES a callable; absent for a pure view. */
  tool?: ProjectToolCatalogEntry;
  Component: ComponentType<ToolContributionProps>;
  /**
   * `export const standing = true` — this document is a PLACE in the project,
   * not an errand: the editor opens it with the project and it is not
   * closeable, exactly like the `3D` / `UI` / `Dev` boards. The default is an
   * action-opened document you reach from the command palette.
   *
   * A capability that owns a whole authoring surface (the `data-tables` tab is
   * the shipped case) declares this; a one-off runner does not.
   */
  standing: boolean;
  /** `export const documentKind = 'model'` — this document is THE EDITOR for
   *  every adapter-table document of that kind (`ToolDocumentEntry`): a
   *  Content entry of the kind opens as its own document mounting this
   *  contribution, never as its source. */
  documentKind?: string;
  /** `export const Toolbar` — the document's header, rendered in the host's
   *  own strip (`WorkspaceDocumentSurface`). See `ToolDocumentToolbar`. */
  Toolbar?: ComponentType<ToolContributionProps>;
  /** `export const Shelf` — the document's tool rail (`DocumentShelfRail`). */
  Shelf?: ComponentType<ToolContributionProps>;
  /**
   * `export const inspectorRail = 'owned'` — A DOCUMENT'S PACKAGE OWNS ITS
   * PROPERTIES RAIL (owner ruling, WORK.md §Blender in the tab is Blender,
   * "Inspection parity", I2 decision 1).
   *
   * On a `model` document the rail is Blender's alone. Blender's Properties
   * editor draws the tabs `ED_buttons_tabs_list` returns AND NOTHING ELSE, so
   * a rail that also carries the host's Preview, Transform, Object, Geometry
   * and Materials blocks beside them is not Blender's rail — it is Blender's
   * rail plus another editor's. Declaring this stands the host's own sections
   * down: the composer keeps only the sections contributed by THIS
   * contribution's own package ({@link LoadedToolContributionBase.owner}),
   * plus whatever built-ins {@link inspectorBuiltins} names by id.
   *
   * It is a DOCUMENT's declaration rather than a section's because the
   * question is "what does this editor show", which no single section knows.
   * A document that declares nothing is unchanged: every section composes.
   */
  inspectorRail?: 'owned';
  /**
   * `export const inspectorBuiltins = ['preview']` — the host built-ins this
   * document keeps beside its package's own sections, BY ID
   * (`inspection/model.ts`'s `PREVIEW_SECTION_ID`, `TRANSFORM_SECTION_ID`,
   * `PROPERTIES_SECTION_ID`, `STORIES_SECTION_ID`, a `group:<id>`). Read only
   * with `inspectorRail = 'owned'`; empty or absent means none.
   */
  inspectorBuiltins?: readonly string[];
}

/**
 * A project contribution that mounts as a TAB IN THE BOTTOM DRAWER
 * (`workspace-utility-registry.ts`), in that registry's `project` cluster.
 *
 * The split from {@link GlobalToolContribution} is the drawer/center split the
 * registries already draw: a document is a substantial editor you work IN, a
 * utility is a transient output/record surface you glance at while working
 * somewhere else. So there is no `standing` here — a utility's tab is its own
 * presence, and the drawer already owns whether it is revealed.
 */
export interface UtilityToolContribution extends LoadedToolContributionBase {
  point: 'workspace.utility';
  Component: ComponentType<ToolUtilityContributionProps>;
  /**
   * `export const available = () => …` — session-scoped availability, the
   * registry's own optional gate (`workspace-utility-registry.ts`): a tab
   * over a live adapter is on offer only while that adapter is registered.
   * Absent means always available.
   */
  available?: () => boolean;
  /**
   * OPTIONAL here, as it is on a {@link InspectorToolContribution}, and
   * required at the three points that RUN (`workspace.document`,
   * `asset.inspector`, `generation.result`): a record-reading panel drives no
   * single callable, so demanding one bought only a false association.
   * Declaring a real one is still allowed and still resolved.
   */
  tool?: ProjectToolCatalogEntry;
}

export interface AnalyticsToolContribution extends LoadedToolContributionBase {
  point: 'workspace.analytics';
  Component: ComponentType<ToolAnalyticsContributionProps>;
  tool?: ProjectToolCatalogEntry;
}

/**
 * A STATUS-BAR item (`workspace-status-registry.ts`): compact, passive,
 * registered under `tool:<id>` like a drawer tab. `export const align` picks
 * the bar's side (default left); `order` is the slot order within it. Never
 * mounted through `ToolHost` — it is a bare component the status bar renders.
 */
export interface StatusToolContribution extends LoadedToolContributionBase {
  point: 'workspace.status';
  Component: ComponentType;
  align: 'left' | 'right';
}

/** The two points the editor mounts as a WHOLE React surface, and therefore
 *  the two `ToolHost` renders (`components/ToolHost.tsx`). */
export type SurfaceToolContribution =
  | GlobalToolContribution
  | UtilityToolContribution
  | AnalyticsToolContribution;

type DrawerToolContribution = UtilityToolContribution | AnalyticsToolContribution;

export interface InspectorToolContribution extends LoadedToolContributionBase {
  point: 'selection.inspector';
  Component: ComponentType<ToolInspectorContributionProps>;
  match: ToolInspectorContributionMatch;
  /**
   * OPTIONAL, like a utility's: a section may present state the editor already
   * has — live readings, verbs a game registered as debug commands — and drive
   * no single registered callable. Demanding one there bought only a false
   * association. A section that DOES commit through a callable still declares
   * it and still gets the resolved entry.
   */
  tool?: ProjectToolCatalogEntry;
}

export interface AssetInspectorToolContribution extends LoadedToolContributionBase {
  point: 'asset.inspector';
  Component: ComponentType<ToolAssetInspectorContributionProps>;
  match: ToolAssetInspectorContributionMatch;
  /** OPTIONAL, like a selection inspector's: a section presents what an ASSET
   *  is, and one that declares no callable is still a section. */
  tool?: ProjectToolCatalogEntry;
}

export interface GenerationResultToolContribution extends CallableToolContributionBase {
  point: 'generation.result';
  Component: ComponentType<ToolGenerationResultContributionProps>;
  match: ToolGenerationResultContributionMatch;
}

export type LoadedToolContribution =
  | GlobalToolContribution
  | UtilityToolContribution
  | AnalyticsToolContribution
  | InspectorToolContribution
  | AssetInspectorToolContribution
  | GenerationResultToolContribution
  | StatusToolContribution;

const TEMPLATE_EXAMPLE = 'src/contributions/my-tool.document.tsx';

/**
 * Every point a contribution module may declare — the whole vocabulary, and
 * the teaching error's own list, so the two cannot disagree.
 *
 * It must stay equal to `@vgai/sdk`'s `ToolContributionPoint` union and to the
 * server scan's `TOOL_CONTRIBUTION_SUFFIXES` (`server/server-utils.ts`): a
 * point the scan finds and this loader rejects is a module that loads,
 * teaching-errors, and mounts nowhere.
 */
const CONTRIBUTION_POINTS: readonly ToolContributionPoint[] = [
  'workspace.document',
  'workspace.utility',
  'workspace.analytics',
  'workspace.status',
  'selection.inspector',
  'asset.inspector',
  'generation.result',
];

/**
 * One PRESENTATION of a contribution module.
 *
 * A module is usually mounted once and needs none of this. But one module may
 * legitimately appear many times under different identities — fal's document is
 * seven workspace documents ('generate-image', 'generate-audio', …) and switches
 * on `contributionId` to pick its endpoint. That fan-out belongs to the module,
 * next to the map it must already agree with, not to a manifest that would
 * restate it.
 */
export interface ToolPresentation {
  id: string;
  title: string;
}

/** A module's declared presentations, or `undefined` when it mounts once. */
export function readToolPresentations(mod: unknown): ToolPresentation[] | undefined {
  const declared = (mod as Record<string, unknown> | null)?.['presentations'];
  if (!Array.isArray(declared) || declared.length === 0) return undefined;
  const presentations: ToolPresentation[] = [];
  for (const entry of declared) {
    const record = entry as Record<string, unknown>;
    if (typeof record?.['id'] !== 'string' || typeof record['title'] !== 'string') return undefined;
    presentations.push({ id: record['id'], title: record['title'] });
  }
  return presentations;
}

/** `src/contributions/humanoid-builder.document.tsx` -> `humanoid-builder.document`. */
function contributionIdFromPath(entryPath: string): string {
  const base = entryPath.split(/[\\/]/).pop() ?? entryPath;
  return base.replace(/\.[jt]sx?$/, '');
}

/**
 * One contribution module that did not load, kept as STATE rather than only as
 * a console line.
 *
 * The console line existed already and is captured (`editor-console.ts`'s
 * session-lifetime wrapper puts it in `vgai status`'s `sessionErrors`). What
 * did not exist was a RECORD any consumer could read, so every downstream
 * refusal was blind: `editor.present` answered "Tool document is not
 * registered: data-tables.document" while the real answer — its capability's
 * npm dependency was never installed — sat in a console nobody was asked to
 * read (measured live, 2026-08-14, data-tables + missing `react-data-grid`).
 */
export interface ToolContributionLoadFailure {
  /** The project-relative module the catalog scan found. */
  entryPath: string;
  /** The id that module WOULD have claimed, derived from its path. A module
   *  declaring `presentations` claims other ids too, so a lookup that misses
   *  here still reports the whole failure list rather than nothing. */
  id: string;
  /** The underlying import error, stringified. */
  error: string;
}

/**
 * The highest `order` a module may declare. The inspector's built-in blocks
 * are spaced 1000 apart (`inspection/model.ts`), so the contributed band has
 * exactly that much room: keeping every declaration inside it is what stops
 * `export const order = 9000` from quietly outranking Transform.
 */
const MAX_DECLARED_ORDER = 998;

/** Where a module that declared no `order` lands: the back of the band. */
const UNDECLARED_ORDER = 999;

/** The rejected value, as the teaching line names it. `JSON.stringify` turns
 *  both NaN and Infinity into `"null"`, which is the one thing a message about
 *  a bad number must not say. */
function describeOrder(value: unknown): string {
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function isDeclarableOrder(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DECLARED_ORDER
  );
}

/**
 * A contributed section's absolute order — the contributed band's base plus
 * what the module declared, or the back of the band when it declared nothing.
 *
 * Pure, and the ONE place the "declared first, silent last" contract is
 * spelled, so the docblock on `order` above and the composer's sort cannot
 * describe two different arrangements.
 */
export function contributedSectionOrder(declared: number | undefined): number {
  return CONTRIBUTED_SECTION_ORDER + (declared ?? UNDECLARED_ORDER);
}

/**
 * Shape one failed contribution import into the record and the teaching line —
 * the pure half of the loudness fix, so the wording is testable without a DOM.
 */
export function describeContributionLoadFailure(
  entryPath: string,
  error: unknown,
): { failure: ToolContributionLoadFailure; message: string } {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    failure: { entryPath, id: contributionIdFromPath(entryPath), error: detail },
    message:
      `[tool contributions] failed to load ${entryPath}; fix the module, or rename it out of ` +
      `the *.document/*.utility/*.inspector/*.result convention if it is not a contribution.\n${detail}`,
  };
}

/**
 * Name the failed loads in a refusal that would otherwise name nothing.
 * `id` is the contribution the caller asked for; when a failure claims it, that
 * one failure is the answer, and when none does the whole list is — a module
 * that fans out over `presentations` fails before its ids are readable.
 * Returns `''` when nothing failed, so the caller's own message stands alone.
 */
export function contributionFailureHint(id: string): string {
  const failures = getToolContributionLoadFailures();
  if (failures.length === 0) return '';
  const owner = failures.find((failure) => failure.id === id);
  if (owner) return ` ${owner.entryPath} failed to load: ${owner.error}`;
  return ` ${failures.length} contribution module(s) failed to load: ${failures
    .map((failure) => `${failure.entryPath} (${failure.error})`)
    .join('; ')}`;
}

/**
 * Read a contribution module's OWN declaration.
 *
 * Nothing is reconciled here, because there is no second source to reconcile
 * against: the module exports `point`, `title` (or `presentations`), and the
 * NAME of the tool it drives, and the scan only says the file exists. The tool
 * name is resolved against `tools` — a name no registered callable answers is a
 * teaching error, the same class as a missing default export. The `match`
 * requirement still varies by point, because a `match` export alone is
 * ambiguous between the inspector and result points.
 */
/**
 * Resolve a contribution's declared `tool`, enforcing the point's contract.
 *
 * Three points PRESENT rather than RUN, so none has an honest name to put
 * here: a `workspace.utility` reads a record (a log, a run timeline), a
 * `selection.inspector` renders a facet of the inspected subject, and a
 * `workspace.document` may be a pure view (a game's Data Book rendering its
 * own src/data modules — the zero-magic collaboration surface). Requiring a
 * callable at any of these bought nothing but a false association: a surface
 * declaring a tool it never runs. The generation points drive exactly one
 * callable, so the teaching error stands there.
 */
function resolveDeclaredTool(
  record: Record<string, unknown>,
  point: ToolContributionPoint,
  tools: readonly ProjectToolCatalogEntry[],
  file: string,
): { tool: ProjectToolCatalogEntry | undefined } | { error: string; note?: boolean } {
  const declaredTool = record['tool'];
  const toolIsOptional =
    point === 'workspace.utility' ||
    point === 'workspace.analytics' ||
    point === 'workspace.status' ||
    point === 'selection.inspector' ||
    point === 'asset.inspector' ||
    point === 'workspace.document';
  if (typeof declaredTool !== 'string' || declaredTool.trim() === '') {
    if (!toolIsOptional || declaredTool !== undefined) {
      return {
        error: toolIsOptional
          ? `[tool contributions] ${file} exports a \`tool\` that is not a non-empty string. A ` +
            `'${point}' may omit it entirely; it may not declare a broken one. Skipped.`
          : `[tool contributions] ${file} must \`export const tool\` — the name of the registered ` +
            `tool it drives, e.g. \`export const tool = 'project.tuning';\` ` +
            `(see ${TEMPLATE_EXAMPLE}). Skipped.`,
      };
    }
  }
  const tool =
    typeof declaredTool === 'string'
      ? tools.find((entry) => entry.name === declaredTool)
      : undefined;
  if (typeof declaredTool === 'string' && !tool) {
    return {
      error:
        `[tool contributions] ${file} drives ${JSON.stringify(declaredTool)}, which no ` +
        'registered tool declares. Register it in package.json#vgai.tools, or fix the name. ' +
        'Skipped.',
    };
  }
  return { tool };
}

export function extractProjectToolContribution(
  mod: unknown,
  file: string,
  version: number,
  tools: readonly ProjectToolCatalogEntry[],
  presentation?: ToolPresentation,
): { contribution: LoadedToolContribution } | { error: string } {
  const record = (mod ?? {}) as Record<string, unknown>;
  const Component = record['default'];
  if (typeof Component !== 'function') {
    return {
      error:
        `[tool contributions] ${file} has no default-exported React component ` +
        `(see ${TEMPLATE_EXAMPLE}). Skipped.`,
    };
  }
  // POINT FIRST, because it decides whether a `tool` is required at all.
  const point = record['point'];
  if (typeof point !== 'string' || !CONTRIBUTION_POINTS.includes(point as ToolContributionPoint)) {
    return {
      error:
        `[tool contributions] ${file} must \`export const point\` — one of ` +
        `${CONTRIBUTION_POINTS.map((value) => `'${value}'`).join(', ')} ` +
        `(see ${TEMPLATE_EXAMPLE}). Skipped.`,
    };
  }
  const resolvedTool = resolveDeclaredTool(record, point as ToolContributionPoint, tools, file);
  if ('error' in resolvedTool) return resolvedTool;
  const tool = resolvedTool.tool;
  const declaredTitle = presentation?.title ?? record['title'];
  if (typeof declaredTitle !== 'string' || declaredTitle.trim() === '') {
    return {
      error:
        `[tool contributions] ${file} must \`export const title\` (non-empty), or list its ` +
        'presentations in `export const presentations`. Skipped.',
    };
  }
  const declaredOrder = record['order'];
  // `typeof NaN === 'number'` and so does `-1`, and both are silent: `NaN`
  // poisons the composer's `a.order - b.order` comparator, and a negative one
  // lifts the contribution over built-in blocks it was never meant to
  // outrank. A loader that teaches on every other malformed export teaches
  // here too, rather than clamping something the module plainly meant.
  if (declaredOrder !== undefined && !isDeclarableOrder(declaredOrder)) {
    return {
      error:
        `[tool contributions] ${file} exports an \`order\` of ${describeOrder(declaredOrder)}. ` +
        `It is an optional whole number from 0 to ${MAX_DECLARED_ORDER} — low first, e.g. ` +
        '`export const order = 2;` — and a module that omits it sits behind every module that ' +
        'declared one. Skipped.',
    };
  }
  const declaredIcon = record['icon'];
  if (
    declaredIcon !== undefined &&
    typeof declaredIcon !== 'function' &&
    (typeof declaredIcon !== 'string' || declaredIcon.trim() === '')
  ) {
    return {
      error:
        `[tool contributions] ${file} exports an \`icon\` that is not a glyph name. It is an ` +
        'optional non-empty string naming a glyph in the active icon set — e.g. ' +
        "`export const icon = 'properties-data';` — or a FUNCTION of the inspected subject " +
        "answering one, e.g. `export const icon = (node, adapter) => 'properties-data-mesh';`. " +
        'Skipped.',
    };
  }
  /** A SECTION'S RAIL GROUP (`selection.inspector`): the Properties
   *  presentation draws a separator between groups, the way
   *  `ED_buttons_tabs_list` (`space_buttons/space_buttons.cc:201-255`) inserts
   *  `BCONTEXT_SEPARATOR` between its tab groups. A free name, compared for
   *  equality only; sections that declare none form one trailing group. */
  const declaredRailGroup = record['railGroup'];
  if (
    declaredRailGroup !== undefined &&
    (typeof declaredRailGroup !== 'string' || declaredRailGroup.trim() === '')
  ) {
    return {
      error:
        `[tool contributions] ${file} exports a \`railGroup\` that is not a non-empty string. ` +
        'It names the rail group this section belongs to — e.g. `export const railGroup = ' +
        "'scene';` — and the presentation rules between groups. Skipped.",
    };
  }
  /** A SECTION'S RAIL DEFAULT (`selection.inspector`): the tab the Properties
   *  presentation opens on before a person has chosen one — Blender's stored
   *  `SpaceProperties.context`, which at factory settings is OBJECT and not
   *  the rail's first tab. */
  const declaredRailDefault = record['railDefault'];
  if (declaredRailDefault !== undefined && typeof declaredRailDefault !== 'boolean') {
    return {
      error:
        `[tool contributions] ${file} exports a \`railDefault\` that is not a boolean. ` +
        'It says this is the tab the Properties rail opens on — `export const railDefault = ' +
        'true;` — and nothing else takes a value. Skipped.',
    };
  }
  const base = {
    id: presentation?.id ?? contributionIdFromPath(file),
    title: declaredTitle.trim(),
    file,
    // The package (or project folder) this module shipped in — see
    // `LoadedToolContributionBase.owner`.
    owner: packageNameOf(file),
    version,
    ...(declaredOrder === undefined ? {} : { order: declaredOrder }),
    ...(declaredIcon === undefined
      ? {}
      : {
          icon:
            typeof declaredIcon === 'function'
              ? (declaredIcon as ToolContributionIconResolver)
              : declaredIcon.trim(),
        }),
    ...(typeof declaredRailGroup === 'string' ? { railGroup: declaredRailGroup.trim() } : {}),
    ...(declaredRailDefault === true ? { railDefault: true } : {}),
  };
  // The two points with no required callable, returned before `tool` is
  // narrowed below.
  if (point === 'workspace.utility') {
    const available = record['available'];
    if (available !== undefined && typeof available !== 'function') {
      return {
        error:
          `[tool contributions] ${file} exports an \`available\` that is not a function. It is ` +
          'optional: `export const available = () => …` gates the tab on session state. Skipped.',
      };
    }
    return {
      contribution: {
        ...base,
        point,
        ...(tool ? { tool } : {}),
        ...(available ? { available: available as () => boolean } : {}),
        Component: Component as ComponentType<ToolUtilityContributionProps>,
      },
    };
  }
  if (point === 'workspace.status') {
    const align = record['align'] ?? 'left';
    if (align !== 'left' && align !== 'right') {
      return {
        error:
          `[tool contributions] ${file} exports an \`align\` of ${JSON.stringify(align)}; a status ` +
          "item's align is 'left' (default) or 'right'. Skipped.",
      };
    }
    return {
      contribution: {
        ...base,
        point,
        align,
        Component: Component as ComponentType,
      },
    };
  }
  if (point === 'workspace.analytics') {
    return {
      contribution: {
        ...base,
        point,
        ...(tool ? { tool } : {}),
        Component: Component as ComponentType<ToolAnalyticsContributionProps>,
      },
    };
  }
  if (point === 'selection.inspector') {
    const match = record['match'];
    if (typeof match !== 'function') {
      return {
        error:
          `[tool contributions] ${file} declares 'selection.inspector' but does not export ` +
          '`match(node, adapter)`. Skipped.',
      };
    }
    return {
      contribution: {
        ...base,
        point,
        ...(tool ? { tool } : {}),
        Component: Component as ComponentType<ToolInspectorContributionProps>,
        match: match as ToolInspectorContributionMatch,
      },
    };
  }
  if (point === 'workspace.document') {
    // The third presenting point: a pure-view document (a game's Data Book)
    // carries no tool; one that DRIVES a callable still names it above.
    const toolbar = record['Toolbar'];
    if (toolbar !== undefined && typeof toolbar !== 'function') {
      return {
        error:
          `[tool contributions] ${file} exports 'Toolbar' but it is not a component. ` +
          'A document header is `export const Toolbar = (props) => …`. Skipped.',
      };
    }
    const documentKind = record['documentKind'];
    if (documentKind !== undefined && (typeof documentKind !== 'string' || documentKind === '')) {
      return {
        error:
          `[tool contributions] ${file} exports 'documentKind' but it is not a non-empty string. ` +
          "The kind a document edits is `export const documentKind = 'model'`. Skipped.",
      };
    }
    const shelf = record['Shelf'];
    if (shelf !== undefined && typeof shelf !== 'function') {
      return {
        error:
          `[tool contributions] ${file} exports 'Shelf' but it is not a component. ` +
          'A document shelf is `export const Shelf = (props) => …`. Skipped.',
      };
    }
    const inspectorRail = record['inspectorRail'];
    if (inspectorRail !== undefined && inspectorRail !== 'owned') {
      return {
        error:
          `[tool contributions] ${file} exports an \`inspectorRail\` of ` +
          `${JSON.stringify(inspectorRail)}. The one value is 'owned' — this document's package ` +
          "owns its Properties rail (`export const inspectorRail = 'owned';`). Skipped.",
      };
    }
    const inspectorBuiltins = record['inspectorBuiltins'];
    if (
      inspectorBuiltins !== undefined &&
      (!Array.isArray(inspectorBuiltins) ||
        inspectorBuiltins.some((id) => typeof id !== 'string' || id.trim() === ''))
    ) {
      return {
        error:
          `[tool contributions] ${file} exports an \`inspectorBuiltins\` that is not a list of ` +
          "section ids — e.g. `export const inspectorBuiltins = ['preview'];`. Skipped.",
      };
    }
    return {
      contribution: {
        ...base,
        point,
        ...(tool ? { tool } : {}),
        Component: Component as ComponentType<ToolContributionProps>,
        standing: record['standing'] === true,
        ...(typeof documentKind === 'string' ? { documentKind } : {}),
        ...(toolbar ? { Toolbar: toolbar as ComponentType<ToolContributionProps> } : {}),
        ...(shelf ? { Shelf: shelf as ComponentType<ToolContributionProps> } : {}),
        ...(inspectorRail === 'owned' ? { inspectorRail } : {}),
        ...(Array.isArray(inspectorBuiltins)
          ? { inspectorBuiltins: inspectorBuiltins as readonly string[] }
          : {}),
      },
    };
  }
  if (point === 'asset.inspector') {
    // Presents an ASSET, the way a selection inspector presents a node: the
    // callable is optional.
    const match = record['match'];
    if (typeof match !== 'function') {
      return {
        error:
          `[tool contributions] ${file} declares 'asset.inspector' but does not export ` +
          '`match(asset)`. Skipped.',
      };
    }
    return {
      contribution: {
        ...base,
        point,
        ...(tool ? { tool } : {}),
        Component: Component as ComponentType<ToolAssetInspectorContributionProps>,
        match: match as ToolAssetInspectorContributionMatch,
      },
    };
  }
  if (!tool) {
    return {
      error:
        `[tool contributions] ${file} must \`export const tool\` — the name of the registered ` +
        `tool it drives, e.g. \`export const tool = 'project.tuning';\` ` +
        `(see ${TEMPLATE_EXAMPLE}). Skipped.`,
    };
  }
  const callable = { ...base, tool };
  if (point === 'generation.result') {
    const match = record['match'];
    if (typeof match !== 'function') {
      return {
        error:
          `[tool contributions] ${file} declares 'generation.result' but does not export ` +
          '`match(job, result)`. Skipped.',
      };
    }
    return {
      contribution: {
        ...callable,
        point,
        Component: Component as ComponentType<ToolGenerationResultContributionProps>,
        match: match as ToolGenerationResultContributionMatch,
      },
    };
  }
  return {
    error: `[tool contributions] ${file} declares unhandled point '${point}'. Skipped.`,
  };
}

/**
 * THE BUNDLED PACKAGES — what the PRODUCT composed into this page, whatever the
 * open project declares (ARCHITECTURE-CORE §The universal editor).
 *
 * The kit names none of them (rule 1). A product's entry is the only writer:
 * `product({ packages: { '@volter/editor-blender': blender, … } })`
 * (`frame/product.ts`) hands over the lists it imported as
 * `vgai:contributions/<package>` modules, each row synthesized from that
 * package's own `package.json#vgai.contributions`
 * (`vite-plugin-product-contributions.ts`).
 *
 * The SESSION is what decides which of these actually mount: its catalog
 * (`server/project-tools.ts`, `packageContributionModules`) lists the product's
 * composed packages BY SPECIFIER — exactly the key this map is built on, which
 * is how a bundled module is imported from the page instead of fetched a second
 * time through `/@fs/` — and the open project's own declared packages by
 * absolute path. A package on both lists is listed once, as the product's.
 *
 * Filled at the product entry's module scope, before its `mountVgai` can be
 * called, so no refresh pass can see a half-composed page.
 */
// The product registers once at module evaluation. A loader-only HMR update
// must retain that composition; otherwise package specifiers fall through to
// project-relative /@fs/ URLs and every bundled contribution fails to load.
const bundledPackageLoaders: Map<string, () => Promise<unknown>> =
  import.meta.hot?.data['bundledPackageLoaders'] ?? new Map();
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data['bundledPackageLoaders'] = bundledPackageLoaders;
  });
}

/** One contribution a product bundles. The shape
 *  `vite-plugin-product-contributions.ts` emits and this module consumes. */
export interface BundledPackageContribution {
  readonly entryPath: string;
  readonly load: () => Promise<unknown>;
}

/** The product's composition, handed over by `frame/product.ts`. */
export function setBundledPackageContributions(
  contributions: readonly BundledPackageContribution[],
): void {
  bundledPackageLoaders.clear();
  for (const entry of contributions) bundledPackageLoaders.set(entry.entryPath, entry.load);
}

let globalContributions: GlobalToolContribution[] = [];
let utilityContributions: DrawerToolContribution[] = [];
let surfaceContributions: SurfaceToolContribution[] = [];
let assetInspectorContributions: AssetInspectorToolContribution[] = [];
let generationResultContributions: GenerationResultToolContribution[] = [];
let contributionLoadFailures: ToolContributionLoadFailure[] = [];
const listeners = new Set<() => void>();
let contributionRefreshEpoch = 0;

/** The contribution modules the last discovery pass could not import. Read by
 *  the refusals that would otherwise name nothing, and by the Project Tools
 *  document, which lists them beside the server's own `loadErrors`. */
export function getToolContributionLoadFailures(): ToolContributionLoadFailure[] {
  return contributionLoadFailures;
}

export function getGlobalToolContributions(): GlobalToolContribution[] {
  return globalContributions;
}

/**
 * Every contribution the editor mounts as a WHOLE React surface — the center
 * documents and the drawer utilities together, documents first.
 *
 * It exists because a project utility's TAB has to have a door. A drawer
 * registration is `visibleByDefault: false` (a project tab does not force
 * itself into a clean layout), so nothing presents it until a command asks:
 * this is the list the Tools menu enumerates, and `showWorkspaceUtility` is
 * what it calls. Reading `getGlobalToolContributions` there instead — which is
 * documents-only — is a contribution that loads, registers, and can never be
 * opened by the human the drawer exists for.
 *
 * A STABLE array, rebuilt once per load pass when both halves have been
 * written, because it is a `useSyncExternalStore` snapshot (`Object.is`; a
 * fresh array per call loops).
 */
export function getSurfaceToolContributions(): SurfaceToolContribution[] {
  return surfaceContributions;
}

export function getDocumentToolContributions(): GlobalToolContribution[] {
  return globalContributions.filter((item) => item.point === 'workspace.document');
}

/** The document contribution registered as the editor for table documents of
 *  `kind` (`export const documentKind`), or `undefined` when none is. */
export function documentContributionForKind(kind: string): GlobalToolContribution | undefined {
  return globalContributions.find(
    (item): item is GlobalToolContribution =>
      item.point === 'workspace.document' && item.documentKind === kind,
  );
}

export function getAssetInspectorToolContributions(): AssetInspectorToolContribution[] {
  return assetInspectorContributions;
}

export function getGenerationResultContribution(
  pollTool: string,
  job: import('@volter/editor-sdk/generations').GenerationJob,
  result: unknown,
): GenerationResultToolContribution | undefined {
  const matches: GenerationResultToolContribution[] = [];
  for (const item of generationResultContributions) {
    if (item.tool.name !== pollTool) continue;
    try {
      if (item.match(job, result)) matches.push(item);
    } catch (error) {
      teachingError(
        `[tool contributions] ${item.file}'s generation result match() threw.\n${String(error)}`,
      );
    }
  }
  if (matches.length > 1) {
    teachingError(
      `[tool contributions] generation result for ${JSON.stringify(job.operation)} matched ` +
        `${matches.length} renderers (${matches.map((item) => item.id).join(', ')}). ` +
        'Falling back to native JSON until the matchers are unambiguous.',
    );
    return undefined;
  }
  return matches[0];
}

export function subscribeToolContributions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let editorClient: EditorClient | null = null;

export function getToolContributionClient(): EditorClient {
  if (!editorClient) {
    const origin = globalThis.location?.origin;
    editorClient = new EditorClient({ ...(origin ? { url: origin } : {}) });
  }
  return editorClient;
}

let unregisterInspectorContributions: Array<() => void> = [];

/** A declared glyph NAME as the icon registry wants it: the wrench drawing
 *  under that name, so a set carrying the name paints its own glyph and one
 *  that does not still draws something sensible. No name is the generic
 *  project-tool wrench. */
function glyph(name: string | undefined): IconDefinition {
  return name
    ? { ...faScrewdriverWrench, iconName: name as IconDefinition['iconName'] }
    : faScrewdriverWrench;
}

function registrationForInspectorContribution(item: InspectorToolContribution): () => void {
  let warned = false;
  const teachOnce = (what: string, error: unknown): void => {
    if (warned) return;
    warned = true;
    teachingError(
      `[tool contributions] ${item.file}'s ${what} threw; ` +
        `treating it as absent until the file is fixed and saved.\n${String(error)}`,
    );
  };
  // A FUNCTION `icon` is resolved PER SUBJECT, so Blender's Object Data tab
  // can draw the mark its object type earns
  // (`LoadedToolContributionBase.icon`). It is wrapped the way `match` is:
  // project code that throws teaches once and falls back to the generic
  // glyph, rather than taking the whole composition down.
  const declaredIcon = item.icon;
  const icon: InspectorSectionIcon =
    typeof declaredIcon === 'function'
      ? (node, adapter) => {
          try {
            return glyph(declaredIcon(node, adapter));
          } catch (error) {
            teachOnce('icon()', error);
            return glyph(undefined);
          }
        }
      : glyph(declaredIcon);
  return registerInspectorSections({
    match: (
      node: EditorNode | null,
      adapter: AuthoringAdapter,
      context: InspectorSectionMatchContext,
    ) => {
      try {
        // The match context travels UNCHANGED to project code: it is how a
        // contribution scopes itself to one empty-state subject (the play
        // surface's Game) instead of every surface's.
        return item.match(node, adapter, context);
      } catch (error) {
        teachOnce('match()', error);
        return false;
      }
    },
    // A project tool's section id is namespaced by its contribution id, so two
    // tools never collide with each other or with a built-in block's id.
    id: `tool:${item.id}`,
    title: item.title,
    // The contribution's OWN glyph by name when it declared one — the icon
    // set paints it and may tint it by category — else a project TOOL's
    // generic glyph. Only the NAME changes: the drawing beneath stays the
    // wrench, so a set that lacks the name still draws something sensible.
    icon,
    // The package this section shipped in — what a document's OWNED rail
    // filters by (`inspection/compose.ts`, `ComposeInspectionInput.rail`).
    owner: item.owner,
    // Which group of the rail it belongs to, and so where the separators fall.
    ...(item.railGroup === undefined ? {} : { railGroup: item.railGroup }),
    // The tab the rail opens on when nothing has been chosen for this subject.
    ...(item.railDefault === undefined ? {} : { railDefault: item.railDefault }),
    // Contributions sit after every built-in block, and among THEMSELVES in
    // the order each module declared (`export const order`). Without it the
    // arrangement is the discovery scan's alphabetical accident — a facet set
    // whose sequence is part of its meaning cannot be left to filenames.
    order: contributedSectionOrder(item.order),
    Section: ({ adapter, nodeId }) =>
      createElement(InspectorToolSection, {
        id: item.id,
        title: item.title,
        file: item.file,
        ...(item.tool ? { tool: item.tool } : {}),
        Component: item.Component,
        adapter,
        nodeId,
      }),
  });
}

function applyInspectorContributions(items: InspectorToolContribution[]): void {
  for (const unregister of unregisterInspectorContributions) unregister();
  unregisterInspectorContributions = items.map(registrationForInspectorContribution);
}

let unregisterUtilityContributions: Array<() => void> = [];
let unregisterStatusContributions: Array<() => void> = [];

/** A look contribution as loaded: which point, and the module's one export. */
interface LookModule {
  readonly entryPath: string;
  readonly kind: LookContributionKind;
  readonly module: unknown;
}

/**
 * Each look kind's registry and the contract its export is checked against, keyed by the
 * convention's own kinds (`LookContributionKind`), so a kind the convention names cannot be
 * scanned without being registered.
 */
const LOOK_REGISTRARS: {
  readonly [K in LookContributionKind]: { readonly contract: string; readonly register: (value: unknown) => () => void };
} = {
  layout: {
    contract: 'WorkspaceLayoutContribution (@volter/editor-sdk/looks)',
    register: (value) => registerContributedWorkspace(value as Parameters<typeof registerContributedWorkspace>[0]),
  },
  keymap: {
    contract: 'KeymapContribution (@volter/editor-sdk/looks)',
    register: (value) => registerContributedKeymap(value as Parameters<typeof registerContributedKeymap>[0]),
  },
  style: {
    contract: 'StyleContribution (@volter/editor-sdk/looks)',
    register: (value) => registerContributedStyle(value as Parameters<typeof registerContributedStyle>[0]),
  },
  view: {
    contract: 'ViewPreset (@volter/editor-sdk/kit/viewport-presentation)',
    register: (value) => registerViewPreset(value as ViewPreset),
  },
  environment: {
    contract: 'EnvironmentImageSet (@volter/editor-sdk/kit/environment-images)',
    register: (value) => registerEnvironmentImages(value as EnvironmentImageSet),
  },
};
let unregisterLookContributions: Array<() => void> = [];

interface CommandModule {
  readonly entryPath: string;
  readonly module: unknown;
}

interface ServiceModule {
  readonly entryPath: string;
  readonly module: unknown;
}
/** The running services by entry path, with the module instance each was
 *  started from. */
let runningServices = new Map<string, { module: unknown; stop: (() => void) | null }>();

/** Start the contributed SERVICES (`@volter/editor-sdk/services`) after a
 *  pass. A service whose module is the SAME instance as the one running keeps
 *  running: a service owns state (the Scene document is one), and stopping an
 *  unchanged one on every pass closed that state under the person — the Scene
 *  opened, then a second pass seconds later stopped its service, which
 *  withdrew the document, and nothing reopened it. A changed, added or removed
 *  service is stopped and started. A service that throws on start teaches and
 *  is skipped; one that throws on stop is reported and the rest still stop. */
function applyServiceContributions(items: readonly ServiceModule[]): void {
  const next = new Map<string, ServiceModule>(items.map((item) => [item.entryPath, item]));
  const kept = new Map<string, { module: unknown; stop: (() => void) | null }>();
  for (const [entryPath, running] of runningServices) {
    if (next.get(entryPath)?.module === running.module) {
      kept.set(entryPath, running);
      continue;
    }
    try {
      running.stop?.();
    } catch (error) {
      teachingError(`[tool contributions] a service could not stop.\n${String(error)}`);
    }
  }
  runningServices = kept;
  for (const item of items) {
    if (runningServices.has(item.entryPath)) continue;
    const record = (item.module ?? {}) as Record<string, unknown>;
    if (record['point'] !== 'workspace.service') {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export const point = 'workspace.service'\` ` +
          '(its filename names that point). Skipped.',
      );
      continue;
    }
    const start = record['start'];
    if (typeof start !== 'function') {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export function start()\` returning its stop ` +
          '(@volter/editor-sdk/services). Skipped.',
      );
      continue;
    }
    try {
      const stop = (start as () => unknown)();
      runningServices.set(item.entryPath, {
        module: item.module,
        stop: typeof stop === 'function' ? (stop as () => void) : null,
      });
    } catch (error) {
      teachingError(`[tool contributions] ${item.entryPath} could not start.\n${String(error)}`);
    }
  }
}

interface ChromeModule {
  readonly entryPath: string;
  readonly kind: 'action' | 'menu' | 'header';
  readonly module: unknown;
}
let unregisterChromeContributions: Array<() => void> = [];

/** Republish the contributed CHROME (`@volter/editor-sdk/chrome`): palette
 *  actions and menu items. Data, no component; the same
 *  unregister-then-register discipline as every other point. */
function applyChromeContributions(items: readonly ChromeModule[]): void {
  for (const unregister of unregisterChromeContributions) unregister();
  unregisterChromeContributions = [];
  for (const item of items) {
    const record = (item.module ?? {}) as Record<string, unknown>;
    const expectedPoint = `workspace.${item.kind}`;
    if (record['point'] !== expectedPoint) {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export const point = '${expectedPoint}'\` ` +
          '(its filename names that point). Skipped.',
      );
      continue;
    }
    try {
      if (item.kind === 'header') {
        const Component = record['default'];
        if (typeof Component !== 'function') {
          teachingError(
            `[tool contributions] ${item.entryPath} has no default-exported React component. Skipped.`,
          );
          continue;
        }
        const order = record['order'];
        const placement = record['placement'];
        unregisterChromeContributions.push(
          registerContributedHeaderItem({
            id: `tool:${contributionIdFromPath(item.entryPath)}`,
            order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
            placement: placement === 'object3d-document' ? 'object3d-document' : 'transport',
            Component: Component as ComponentType<{ documentId: string }>,
          }),
        );
        continue;
      }
      if (item.kind === 'action') {
        const actions = record['actions'];
        if (!Array.isArray(actions) && typeof actions !== 'function') {
          teachingError(
            `[tool contributions] ${item.entryPath} must \`export const actions\` — an array of ` +
              '`ContributedAction`, or a function returning one for a live set ' +
              '(@volter/editor-sdk/chrome). Skipped.',
          );
          continue;
        }
        const subscribe = record['subscribe'];
        unregisterChromeContributions.push(
          registerContributedActions({
            actions,
            ...(typeof subscribe === 'function' ? { subscribe } : {}),
          } as Parameters<typeof registerContributedActions>[0]),
        );
      } else {
        const menu = record['menu'] as { menu?: unknown; items?: unknown } | undefined;
        if (!menu || !isContributableMenu(menu.menu) || !Array.isArray(menu.items)) {
          teachingError(
            `[tool contributions] ${item.entryPath} must \`export const menu\` — a ` +
              "`MenuContribution` naming one of 'view', 'window', 'debug', 'tools', 'help' and " +
              'its items (@volter/editor-sdk/chrome). Skipped.',
          );
          continue;
        }
        unregisterChromeContributions.push(
          registerContributedMenu(menu as Parameters<typeof registerContributedMenu>[0]),
        );
      }
    } catch (error) {
      teachingError(`[tool contributions] ${item.entryPath} could not register.\n${String(error)}`);
    }
  }
}
let unregisterCommandContributions: Array<() => void> = [];

/**
 * Republish the contributed COMMANDS (`@volter/editor-sdk/commands`): each
 * module's `commands` table into the registry, then the registered rows to
 * the server, which sizes its relay wait per verb from them. The same
 * unregister-then-register discipline as every other point.
 */
function applyCommandContributions(items: readonly CommandModule[]): void {
  for (const unregister of unregisterCommandContributions) unregister();
  unregisterCommandContributions = [];
  for (const item of items) {
    const record = (item.module ?? {}) as Record<string, unknown>;
    if (record['point'] !== 'workspace.command') {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export const point = 'workspace.command'\` ` +
          '(its filename names that point). Skipped.',
      );
      continue;
    }
    const commands = record['commands'];
    if (typeof commands !== 'object' || commands === null) {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export const commands\` — a table of ` +
          '`CommandSpec` by verb (@volter/editor-sdk/commands). Skipped.',
      );
      continue;
    }
    try {
      unregisterCommandContributions.push(
        registerContributedCommands(
          item.entryPath,
          commands as Parameters<typeof registerContributedCommands>[1],
        ),
      );
    } catch (error) {
      teachingError(`[tool contributions] ${item.entryPath} could not register.\n${String(error)}`);
    }
  }
  void reportContributedCommandRows();
}

/** The server's relay reads the host's table for its per-verb wait; a
 *  contributed verb's row reaches it here, or it would fall to the generic
 *  budget — the exact failure `command-table.ts` records. */
async function reportContributedCommandRows(): Promise<void> {
  try {
    const response = await fetch('/__editor/contributed-commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commands: contributedCommandRows() }),
    });
    if (!response.ok)
      teachingError(
        `[tool contributions] the server refused the contributed command rows (${response.status}).`,
      );
  } catch (error) {
    teachingError(
      `[tool contributions] could not report contributed command rows: ${String(error)}`,
    );
  }
}

/**
 * Republish the looks — workspaces, keymaps and style bundles a project's
 * packages contribute (`@volter/editor-sdk/looks`). Data, no component: each
 * module's one named export is handed to its registry, which is also where
 * a duplicate id or a bad palette document refuses by name. The same
 * unregister-then-register discipline as the utilities, so a reload never
 * doubles a workspace.
 */
function applyLookContributions(items: readonly LookModule[]): void {
  for (const unregister of unregisterLookContributions) unregister();
  unregisterLookContributions = [];
  for (const item of items) {
    const record = (item.module ?? {}) as Record<string, unknown>;
    const expectedPoint = `workspace.${item.kind}`;
    if (record['point'] !== expectedPoint) {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export const point = '${expectedPoint}'\` ` +
          `(its filename names that point). Skipped.`,
      );
      continue;
    }
    const value = record[item.kind];
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { id?: unknown }).id !== 'string'
    ) {
      teachingError(
        `[tool contributions] ${item.entryPath} must \`export const ${item.kind}\` — an object with a ` +
          `string \`id\` (see \`${LOOK_REGISTRARS[item.kind].contract}\`). Skipped.`,
      );
      continue;
    }
    try {
      unregisterLookContributions.push(LOOK_REGISTRARS[item.kind].register(value));
    } catch (error) {
      teachingError(`[tool contributions] ${item.entryPath} could not register.\n${String(error)}`);
    }
  }
}
let statusContributions: StatusToolContribution[] = [];

/** Republish the status bar's contributed items — the same
 *  unregister-then-register discipline as {@link applyUtilityContributions}. */
function applyStatusContributions(items: StatusToolContribution[]): void {
  for (const unregister of unregisterStatusContributions) unregister();
  unregisterStatusContributions = [];
  const claimed: StatusToolContribution[] = [];
  for (const item of items) {
    try {
      unregisterStatusContributions.push(
        registerWorkspaceStatus({
          id: `tool:${item.id}`,
          // The contribution's own TITLE is what a person calls it, and the
          // status bar's `Hide <item>` menu is where they read it.
          name: item.title,
          align: item.align,
          order: contributedSectionOrder(item.order),
          Content: item.Component,
        }),
      );
      claimed.push(item);
    } catch (error) {
      teachingError(
        `[tool contributions] ${item.file} could not claim its status-bar slot.\n${String(error)}`,
      );
    }
  }
  statusContributions = claimed;
}

/** The status items the last load pass claimed (diagnostics; the bar reads
 *  the registry itself). */
export function getStatusToolContributions(): readonly StatusToolContribution[] {
  return statusContributions;
}
/** A project's finder contribution, imported and waiting for the
 *  document-table host to register it (ARCHITECTURE-CORE §The project model). */
export interface ContributedFinderModule {
  readonly entryPath: string;
  readonly module: unknown;
}
let contributedFinders: readonly ContributedFinderModule[] = [];

/** The finder contributions the last pass imported; `subscribeToolContributions`
 *  fires when the list changes. */
export function contributedFinderModules(): readonly ContributedFinderModule[] {
  return contributedFinders;
}

function registrationForUtilityContribution(item: DrawerToolContribution): () => void {
  return registerWorkspaceUtility({
    // Namespaced by contribution id exactly as the inspector sections are, so
    // a project tab can never collide with one of the editor's own utilities
    // (ids key drawer tabs and persisted layout — the registry throws).
    id: `tool:${item.id}`,
    title: item.title,
    // The GAME's plane, not the editor's instruments.
    section: 'project',
    Content: () => createElement(ToolHost, { contribution: item }),
    // A project tab is revealed by the Window menu / a command, like every
    // other on-demand utility; it does not force itself into a clean layout.
    visibleByDefault: false,
    closeable: true,
    // Analytics reads a RUNNING world; a project that mounts nothing has no
    // run to read (ARCHITECTURE-CORE §Roots), so the tab is not on offer. A
    // utility gates itself on whatever session state it declared.
    ...(item.point === 'workspace.analytics'
      ? { available: projectMounts }
      : item.available
        ? { available: item.available }
        : {}),
  });
}

/**
 * Republish the drawer's project cluster — unregister the previous load's
 * tabs, then register this one's.
 *
 * Unregister-then-register (rather than diffing) is the same discipline
 * {@link applyInspectorContributions} uses, and it is what makes the id
 * registry's duplicate THROW survivable across an HMR save: the old
 * registration is always gone before the new one claims the id. A registration
 * that still throws (an id some other surface owns) teaches and is skipped,
 * because one bad contribution must not strand the rest of the load with no
 * tabs at all.
 */
function applyUtilityContributions(items: DrawerToolContribution[]): void {
  for (const unregister of unregisterUtilityContributions) unregister();
  unregisterUtilityContributions = [];
  const claimed: DrawerToolContribution[] = [];
  for (const item of items) {
    try {
      unregisterUtilityContributions.push(registrationForUtilityContribution(item));
      claimed.push(item);
    } catch (error) {
      teachingError(
        `[tool contributions] ${item.file} could not claim its drawer tab.\n${String(error)}`,
      );
    }
  }
  // Only the ones that HOLD a tab: the menu entry's whole job is revealing that
  // tab, so listing a contribution whose registration threw would be a door
  // onto nothing.
  utilityContributions = claimed;
}

/** Clear every contribution point this loader owns. Shared by the
 *  no-project and no-host paths so neither leaves a previous load's tabs,
 *  sections and documents standing over a project that cannot supply them. */
function clearProjectToolContributions(): void {
  publishPlayUtilitiesReady(false);
  assetInspectorContributions = [];
  generationResultContributions = [];
  contributionLoadFailures = [];
  applyGlobalContributions([]);
  applyInspectorContributions([]);
  applyUtilityContributions([]);
  applyStatusContributions([]);
  applyLookContributions([]);
  applyCommandContributions([]);
  applyChromeContributions([]);
  applyServiceContributions([]);
  publishToolContributions();
}

/** `@vgai/game/contributions/x.ts` → `@vgai/game`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? specifier);
}

/**
 * The newest in-flight pass. A pass that is superseded mid-flight installs
 * nothing (the epoch check at its end), so an awaiter that only waited for
 * ITS pass could resume with the registry still empty while the newer pass
 * is loading — measured live (2026-09-02, load average 60) as a shared-view
 * URL restore refusing "Tool document is not registered" for a contribution
 * that was on disk and opened fine seconds later. Every awaiter now returns
 * only once the newest pass has installed.
 */
/**
 * The origin that served THIS module — the editor's own dev server (the `vgai
 * edit` session), which is also what serves the open project's modules.
 *
 * Everywhere but one shape it equals the page's origin. Inside the Code-OSS
 * DESKTOP frame it does not: the page is `vscode-file://vscode-app` and the
 * session is loopback http (docs/CODE-OSS.md §Desktop). Taken once, as a plain
 * string, because `new URL(<expression>, import.meta.url)` is Vite's asset-URL
 * pattern and is rewritten statically at transform time.
 */
const MODULE_SERVING_ORIGIN = new URL(import.meta.url).origin;

let latestContributionRefresh: Promise<void> | null = null;

export async function refreshProjectToolContributions(): Promise<void> {
  const pass = runContributionRefresh();
  latestContributionRefresh = pass;
  await pass;
  while (latestContributionRefresh !== null && latestContributionRefresh !== pass) {
    const newer: Promise<void> = latestContributionRefresh;
    await newer;
    if (latestContributionRefresh === newer) break;
  }
}

async function runContributionRefresh(): Promise<void> {
  publishPlayUtilitiesReady(false);
  const epoch = ++contributionRefreshEpoch;
  const project = getCurrentProject();
  if (!project) {
    clearProjectToolContributions();
    return;
  }

  let catalog: ProjectToolCatalog;
  try {
    const response = await fetch('/__editor/project-tools');
    // Never `res.json()` on an unexamined content type — see
    // `editor-server-response.ts` for why `response.ok` cannot answer this.
    catalog = await editorServerJson<ProjectToolCatalog>(response, 'Catalog request failed');
  } catch (error) {
    // A load that cannot happen is reported, never swallowed: the panel reads
    // `getToolContributionLoadFailures()`, so this is what stands between a
    // real host failure and a blank "No project tools registered."
    clearProjectToolContributions();
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    contributionLoadFailures = [
      {
        entryPath: '/__editor/project-tools',
        id: 'project-tool-catalog',
        error: detail,
      },
    ];
    teachingError(`[tool contributions] could not read the project tool catalog.\n${detail}`);
    publishToolContributions();
    return;
  }

  reportContributionConventionSkew(catalog.suffixes);

  const version = Date.now();
  const nextGlobal: GlobalToolContribution[] = [];
  const nextUtility: Array<UtilityToolContribution | AnalyticsToolContribution> = [];
  const nextStatus: StatusToolContribution[] = [];
  const nextInspector: InspectorToolContribution[] = [];
  const nextAssetInspector: AssetInspectorToolContribution[] = [];
  const nextGenerationResult: GenerationResultToolContribution[] = [];
  const nextFailures: ToolContributionLoadFailure[] = [];
  // A bundled package's entry is listed by specifier; the page loads it through the
  // loader its bundle registered, or, when the bundle predates the entry (a checkout's
  // source moved past its build), from the file the host names. Joined to the project
  // root it named `<project>/@volter/…`, which exists nowhere.
  const bundledFiles = new Map(
    (catalog.contributions ?? []).flatMap((item) => (item.filePath ? [[item.entryPath, item.filePath] as const] : [])),
  );
  const absolute = (entryPath: string) =>
    entryPath.startsWith('/') || bundledPackageLoaders.has(entryPath)
      ? entryPath
      : (bundledFiles.get(entryPath) ?? `${project.rootPath}/${entryPath}`);
  // The host serves a contribution through its own Vite (`/@fs/`,
  // cache-busted per refresh); a package this build bundles is already in the
  // page and loads through its own registered loader.
  const importContribution = (entryPath: string) =>
    bundledPackageLoaders.get(entryPath)?.() ??
    import(/* @vite-ignore */ `/@fs/${absolute(entryPath)}?t=${version}`);
  // The same door, handed to the contributions themselves for the project
  // modules THEY need (`@volter/editor-sdk/contributions` `importProjectModule`).
  registerProjectModuleLoader({
    import: (path) =>
      import(/* @vite-ignore */ `/@fs/${absolute(path)}?t=${version}`) as Promise<
        Record<string, unknown>
      >,
    // Resolved against the ORIGIN THAT SERVED THIS MODULE, never the
    // page's. A project module is served by the session that served this
    // file, and those two are the same origin in every shape but one:
    // inside the Code-OSS DESKTOP frame the page is
    // `vscode-file://vscode-app` (Electron's app root) while the session
    // stays on loopback http, so a url built from the page sent the Model
    // document's save-time re-import at the app root, where it 404s
    // (docs/CODE-OSS.md §Desktop, measured 2026-09-19).
    //
    // NOTE THE SHAPE, and do not "simplify" it back:
    // `new URL(<expression>, import.meta.url)` is Vite's own ASSET-URL
    // pattern, which its `assetImportMetaUrl` plugin rewrites statically
    // at transform time — with a computed first argument it resolves to
    // `undefined` and this door silently hands out
    // `<origin>/packages/editor/src/undefined` (measured the same day).
    // `new URL(import.meta.url)` with ONE argument is not that pattern,
    // so the origin is taken first and used as a plain base string.
    url: (path) => new URL(`/@fs/${absolute(path)}`, MODULE_SERVING_ORIGIN),
    // The file's TEXT through Vite's own `?raw` door (the HTTP storage
    // backend is rooted at `public/`, and a plain fetch of a `.ts` URL
    // answers with the transformed module). A fresh query each time:
    // the module may have just been written.
    source: (path) =>
      (
        import(
          /* @vite-ignore */ `/@fs/${absolute(path)}?raw&vgai-source=${Date.now()}`
        ) as Promise<{ default?: unknown }>
      ).then((raw) => {
        if (typeof raw.default !== 'string') {
          throw new Error(`${path}: the dev server did not answer with the file's text`);
        }
        return raw.default;
      }),
  });
  const moduleImports = new Map<string, Promise<unknown>>();
  for (const { entryPath } of catalog.contributions ?? []) {
    // Kind contributions are the manifest hosts' (server, validate script);
    // the page mounts nothing from them.
    if (isConfigurationKindContribution(entryPath)) continue;
    const modulePath = absolute(entryPath);
    moduleImports.set(modulePath, moduleImports.get(modulePath) ?? importContribution(entryPath));
  }
  const nextFinderModules: ContributedFinderModule[] = [];
  const nextLooks: LookModule[] = [];
  const nextCommands: CommandModule[] = [];
  const nextChrome: ChromeModule[] = [];
  const nextServices: ServiceModule[] = [];
  const claimedIds = new Set<string>();
  for (const { entryPath } of catalog.contributions ?? []) {
    if (isConfigurationKindContribution(entryPath)) continue; // a kind is the manifest hosts'
    if (isServiceContribution(entryPath)) {
      try {
        const mod = await moduleImports.get(absolute(entryPath))!;
        nextServices.push({ entryPath, module: mod });
      } catch (error) {
        const { failure, message } = describeContributionLoadFailure(entryPath, error);
        nextFailures.push(failure);
        teachingError(message);
      }
      continue;
    }
    const chrome = chromeContributionKind(entryPath);
    if (chrome) {
      try {
        const mod = await moduleImports.get(absolute(entryPath))!;
        nextChrome.push({ entryPath, kind: chrome, module: mod });
      } catch (error) {
        const { failure, message } = describeContributionLoadFailure(entryPath, error);
        nextFailures.push(failure);
        teachingError(message);
      }
      continue;
    }
    if (isCommandContribution(entryPath)) {
      try {
        const mod = await moduleImports.get(absolute(entryPath))!;
        nextCommands.push({ entryPath, module: mod });
      } catch (error) {
        const { failure, message } = describeContributionLoadFailure(entryPath, error);
        nextFailures.push(failure);
        teachingError(message);
      }
      continue;
    }
    const look = lookContributionKind(entryPath);
    if (look) {
      // A look is DATA for a registry (`applyLookContributions`), never a
      // mounted component.
      try {
        const mod = await moduleImports.get(absolute(entryPath))!;
        nextLooks.push({ entryPath, kind: look, module: mod });
      } catch (error) {
        const { failure, message } = describeContributionLoadFailure(entryPath, error);
        nextFailures.push(failure);
        teachingError(message);
      }
      continue;
    }
    if (isFinderContribution(entryPath)) {
      // A finder is the document-table host's (`project-adapter.ts`), which
      // registers what is collected here after this pass publishes.
      try {
        const mod = await moduleImports.get(absolute(entryPath))!;
        nextFinderModules.push({ entryPath, module: mod });
      } catch (error) {
        const { failure, message } = describeContributionLoadFailure(entryPath, error);
        nextFailures.push(failure);
        teachingError(message);
      }
      continue;
    }
    let mod: unknown;
    try {
      mod = await moduleImports.get(absolute(entryPath))!;
    } catch (error) {
      const { failure, message } = describeContributionLoadFailure(entryPath, error);
      nextFailures.push(failure);
      teachingError(message);
      continue;
    }
    // A module declaring `presentations` mounts once PER presentation.
    for (const presentation of readToolPresentations(mod) ?? [undefined]) {
      const result = extractProjectToolContribution(
        mod,
        entryPath,
        version,
        catalog.tools,
        presentation,
      );
      if ('error' in result) {
        if ('note' in result && result.note) teachingNote(result.error);
        else teachingError(result.error);
        continue;
      }
      // Ids are the editor's mount keys and are no longer tool-qualified, so
      // two files with the same basename would silently shadow one another.
      if (claimedIds.has(result.contribution.id)) {
        // The project's own module registers first, so the loser is the
        // later one — a package's, when a project still carries the copy a
        // capability shipped before it became a package.
        const packaged = entryPath.startsWith('@vgai/') || entryPath.includes('/node_modules/');
        teachingError(
          `[tool contributions] ${entryPath} claims id ${JSON.stringify(result.contribution.id)}, ` +
            'which another contribution already uses. ' +
            (packaged
              ? 'This one ships in a package the project declares; if the other is a copy under ' +
                'src/contributions/ from before that capability became a package, delete the copy. '
              : 'Rename one of them. ') +
            'Skipped.',
        );
        continue;
      }
      claimedIds.add(result.contribution.id);
      if (result.contribution.point === 'selection.inspector') {
        nextInspector.push(result.contribution);
      } else if (
        result.contribution.point === 'workspace.utility' ||
        result.contribution.point === 'workspace.analytics'
      ) {
        nextUtility.push(result.contribution);
      } else if (result.contribution.point === 'workspace.status') {
        nextStatus.push(result.contribution);
      } else if (result.contribution.point === 'asset.inspector') {
        nextAssetInspector.push(result.contribution);
      } else if (result.contribution.point === 'generation.result') {
        nextGenerationResult.push(result.contribution);
      } else {
        nextGlobal.push(result.contribution);
      }
    }
  }
  if (epoch !== contributionRefreshEpoch || getCurrentProject()?.rootPath !== project.rootPath) {
    return;
  }
  assetInspectorContributions = nextAssetInspector;
  generationResultContributions = nextGenerationResult;
  contributionLoadFailures = nextFailures;
  applyGlobalContributions(nextGlobal);
  applyInspectorContributions(nextInspector);
  applyUtilityContributions(nextUtility);
  applyStatusContributions(nextStatus);
  applyLookContributions(nextLooks);
  applyCommandContributions(nextCommands);
  applyChromeContributions(nextChrome);
  applyServiceContributions(nextServices);
  // Only now is "no package contributes it" a fact about this project.
  reportUnavailableKeymap();
  publishPlayUtilitiesReady(true);
  contributedFinders = nextFinderModules;
  publishToolContributions();
}

function applyGlobalContributions(next: GlobalToolContribution[]): void {
  globalContributions = next;
}

/**
 * The ONE publish of a load pass: rebuild the surface snapshot from both halves
 * and notify every subscriber exactly once.
 *
 * The `apply*` functions above only WRITE their half; none of them notifies.
 * That split is the point — a load pass writes five stores (documents,
 * utilities, inspector sections, asset inspectors, generation results), and a
 * notify from inside any one of them publishes a half-updated editor: the new
 * documents beside the previous load's utilities, in a `useSyncExternalStore`
 * snapshot subscribers then render and reconcile from. Notifying per half also
 * ran every subscriber's work twice per refresh (dock reconcile, menu rebuild).
 */
function publishToolContributions(): void {
  surfaceContributions = [...globalContributions, ...utilityContributions];
  for (const fn of listeners) fn();
}

export function __publishGlobalToolContributionsForTest(next: GlobalToolContribution[]): void {
  applyGlobalContributions(next);
  publishToolContributions();
}

/**
 * A page bundle and a host from different revisions disagree about which files
 * are contributions, and the page then drops or misloads them with no word on
 * which half is behind. The host lists the suffixes it scans; this compares.
 */
let reportedConventionSkew: string | null = null;
function reportContributionConventionSkew(hostSuffixes: readonly string[] | undefined): void {
  if (!hostSuffixes) return;
  const page = new Set<string>(TOOL_CONTRIBUTION_SUFFIXES);
  const host = new Set(hostSuffixes);
  const hostOnly = [...host].filter((suffix) => !page.has(suffix));
  const pageOnly = [...page].filter((suffix) => !host.has(suffix));
  if (hostOnly.length === 0 && pageOnly.length === 0) return;
  const key = `${hostOnly.join(',')}|${pageOnly.join(',')}`;
  if (reportedConventionSkew === key) return;
  reportedConventionSkew = key;
  teachingError(
    [
      '[tool contributions] This page and the session server are different builds.',
      ...(hostOnly.length > 0
        ? [`The server lists ${hostOnly.map((s) => `*${s}`).join(', ')} contributions this page does not know, so the PAGE BUNDLE is older: rebuild the product's page bundle, then reload.`]
        : []),
      ...(pageOnly.length > 0
        ? [`This page knows ${pageOnly.map((s) => `*${s}`).join(', ')} contributions the server does not scan, so the SERVER is older: rebuild the kit's server, then restart the session.`]
        : []),
    ].join(' '),
  );
}

function teachingError(message: string): void {
  // biome-ignore lint/suspicious/noConsole: broken project contributions must be loud without crashing the editor
  console.error(message);
}

/** A contribution that is fine but INAPPLICABLE HERE — nothing is broken and
 *  nothing on this tier can fix it, so it must not spend the console's error
 *  badge (the "unresolved console is remaining work" rule only holds while
 *  every error is real work). */
function teachingNote(message: string): void {
  // biome-ignore lint/suspicious/noConsole: the tier's own explanation, at warning weight
  console.warn(message);
}

if (import.meta.hot) {
  import.meta.hot.on('vgai:script-update', (data: { file: string }) => {
    if (!isEditorLanePath(data.file)) return;
    void refreshProjectToolContributions();
  });
}
