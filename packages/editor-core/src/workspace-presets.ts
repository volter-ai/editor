/**
 * NAMED WORKSPACES — task-named arrangements of the one editor.
 *
 * The ruling (docs/ARCHITECTURE-CORE.md §Editor chrome, "Workspaces are
 * task-named layout memories, switched only by explicit act"): the single
 * The editor gains named workspaces — `Game` (default), `Model`,
 * `Sculpt`, `Texture`, `Animate`, `Look` — each an ARRANGEMENT the mounted
 * layout host applies: which regions are shown, which views sit where, and
 * which documents its areas hold.
 *
 * This module is the registry + the active-id store, and it owns no geometry
 * at all: under the frame the grid is the workbench's own, and a workspace
 * switch is the host reading this table (`frame/bridge.tsx`).
 *
 * Three rules the ruling states and this module encodes:
 *
 *  1. **Switching is an explicit act only.** `Window → Workspace`, the
 *     registered actions (palette-ready, with a cycle shortcut pair), and
 *     the session operation `editor.workspace(id)`, and an explicit change
 *     to the mounted layout's arrangement call {@link setEditorWorkspace}. Nothing derives a workspace from what the
 *     user opened: DOCUMENT-OPEN NEVER MOVES CHROME. A workspace TAB STRIP
 *     exists only as a region a style or workspace turns on
 *     (`workspaceTabs` — Blender's top bar), where a click IS the explicit
 *     act; nothing derives a workspace, and there is no mode machine. Immersive Play remains the sole automatic
 *     transition, and it restores to the workspace it left (it never sets
 *     one — it hides and re-shows groups within the active workspace).
 *  2. **A workspace positions chrome and dock groups only; it never opens
 *     documents.** The shipped defaults in `workspace-preset-layouts.ts` are
 *     normalized to carry no document panels at all.
 *  3. **Shipped defaults are authored by arranging live and snapshotting
 *     `toJSON`** — never hand-written JSON. See that module's header for the
 *     capture procedure.
 */

import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';
import { activeProduct, subscribeActiveProduct } from './active-product';
import { adapterEditorConfiguration } from '@volter/editor-sdk/kit/adapter-editor-config';
import { layoutPolicy, subscribeLayoutPolicy } from '@volter/editor-sdk/kit/layout-policy';
import { projectDeclaresDocumentKind, projectMounts, subscribeProjectShape } from '@volter/editor-sdk/kit/project-shape';
/** Imported arrangements may supply their own persistence identity. */
import { setWorkspaceAreas } from './workspace-areas';
import { setWorkspaceRegions } from '@volter/editor-sdk/kit/workspace-regions';

export type EditorWorkspaceId = string;

/**
 * WHICH CHROME REGIONS A WORKSPACE SHOWS — the knobs a skin or a preset turns,
 * as data on the workspace rather than code paths in the dock. `tabs` is the
 * center group's tab strip (Blender has none; Maya and Substance do), `header`
 * the document header strip (`DocumentHeaderStrip`), `shelf` the tool rail
 * (`DocumentShelfRail`). Absent means shown. A region hidden here is hidden
 * for every document in the workspace; a document that has no contents for a
 * region shows none regardless.
 */
export interface EditorWorkspaceRegions {
  /** The WORKSPACE tab strip in the top bar (Blender's) — a style's or a
   *  workspace's region; a click on a tab is the explicit act. Absent: hidden. */
  readonly workspaceTabs?: 'shown' | 'hidden';
  readonly tabs?: 'shown' | 'hidden';
  readonly header?: 'shown' | 'hidden';
  readonly shelf?: 'shown' | 'hidden';
  /** The docked inspector's layout: sections stacked (`column`, the default)
   *  or tabbed behind a vertical icon rail, one body at a time
   *  (`properties` — Blender's Properties editor). A user's own per-surface
   *  preference (`inspector-presentation.ts`) still outranks this. */
  readonly inspector?: 'column' | 'properties';
  /** The bottom utility drawer. `hidden` means this workspace never shows
   *  it, not even when play settles — Blender's modeling workspace has no
   *  timeline strip. Absent means shown. */
  readonly drawer?: 'shown' | 'hidden';
  /** The top bar's runtime TELEMETRY cluster (`HeaderTelemetry`). Absent
   *  means shown. */
  readonly telemetry?: 'shown' | 'hidden';
}

export interface EditorWorkspaceDescriptor {
  readonly id: EditorWorkspaceId;
  /** What this workspace needs the project to DECLARE before it applies
   *  (ARCHITECTURE-CORE §Roots). `'mounts'`: at least one root — the Game
   *  workspace plays a world, and a project with none has nothing for it.
   *  Omitted: applies to every project. */
  readonly requires?: 'mounts' | { readonly documentKind: string };
  readonly title: string;
  readonly description: string;
  /** See {@link EditorWorkspaceRegions}. Absent means every region shown. */
  readonly regions?: EditorWorkspaceRegions;
  /**
   * Whose SHIPPED arrangement this workspace starts from — its own, for every
   * contributed workspace (a package whose workspaces open alike ships them the
   * same captured geometry, as `@volter/editor-blender` does for Sculpt and Texture: their
   * reserved panels ship WITH their programs, never as empty chrome); the
   * host's own may alias another's. Every workspace keeps its OWN persisted
   * layout the moment the user touches it, so aliasing only ever describes the
   * first-open default.
   */
  readonly arrangement: EditorWorkspaceId;
  /** The workspace's EDITOR AREAS beside the centre document — a Blender area
   *  IS an editor group (orchestrator ruling 2026-09-19; see
   *  `WorkspaceAreaContribution` and `workspace-areas.ts`). Absent: the centre
   *  document alone, which is every host workspace. */
  readonly areas?: WorkspaceLayoutContribution['areas'];
}

/**
 * The workspaces EVERY project gets — the host's own. Every other workspace is
 * a package's `workspace.layout` contribution (Game ships with `@vgai/game`;
 * Model, Sculpt and Texture with `@volter/editor-blender`), registered through
 * {@link registerContributedWorkspace} and listed by {@link editorWorkspaces}.
 * Animate and Design stay here until their packages exist (WORK.md §The
 * workbench).
 */
const BUILT_IN_WORKSPACES: readonly EditorWorkspaceDescriptor[] = Object.freeze([
  {
    id: 'animate',
    title: 'Animate',
    // WHAT IT DRAWS TODAY, which is the centre document alone. A workspace's
    // second surface is an `areas` entry (`WorkspaceAreaContribution` — the
    // Model workspace's timeline strip is one), and this workspace declares
    // none, so promising "a docked timeline" described a screen nobody could
    // get. It says what it is until the animation package ships the timeline
    // document an area could name (walk 4, W-animate).
    description: 'Animating: the viewport, with the outliner and properties beside it.',
    arrangement: 'animate',
  },
  {
    id: 'design',
    title: 'Design',
    description:
      "Designing UI: the UI board, every one of the project's UI stories laid out as a frame.",
    arrangement: 'game',
  },
  {
    id: 'look',
    title: 'Look',
    description: 'Marmoset-shaped look development: a near-fullscreen document, minimal chrome.',
    arrangement: 'look',
    regions: { header: 'hidden', shelf: 'hidden', drawer: 'hidden' },
  },
] satisfies readonly EditorWorkspaceDescriptor[]);

interface ContributedWorkspace {
  readonly descriptor: EditorWorkspaceDescriptor;
}
const contributedWorkspaces = new Map<string, ContributedWorkspace>();
let registryVersion = 0;
const registryListeners = new Set<() => void>();

/** Contributions first, in registration order, then the host's own — so a
 *  project's packages name the workspaces it opens in (Game, Model) before
 *  the ones every project has. The switch surfaces enumerate this. */
export function editorWorkspaces(): readonly EditorWorkspaceDescriptor[] {
  return [
    ...[...contributedWorkspaces.values()].map((entry) => entry.descriptor),
    ...BUILT_IN_WORKSPACES,
  ];
}

export function editorWorkspacesVersion(): number {
  return registryVersion;
}

export function subscribeEditorWorkspaces(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

/**
 * Register a package's workspace (`workspace.layout` contribution). Returns
 * the unregister. A duplicate id throws — ids key persisted state. A
 * workspace whose contribution arrives after the session chose a PROVISIONAL
 * workspace (nothing recorded, nothing declared) re-runs that choice, so a
 * game project opens in Game whichever loads first.
 */
export function registerContributedWorkspace(
  contribution: WorkspaceLayoutContribution,
): () => void {
  if (
    BUILT_IN_WORKSPACES.some((entry) => entry.id === contribution.id) ||
    contributedWorkspaces.has(contribution.id)
  )
    throw new Error(
      `registerContributedWorkspace: workspace "${contribution.id}" is already registered.`,
    );
  const entry: ContributedWorkspace = {
    descriptor: {
      id: contribution.id,
      title: contribution.title,
      description: contribution.description,
      arrangement: contribution.id,
      ...(contribution.requires ? { requires: contribution.requires } : {}),
      ...(contribution.regions ? { regions: contribution.regions } : {}),
      ...(contribution.areas ? { areas: contribution.areas } : {}),
    },
  };
  contributedWorkspaces.set(contribution.id, entry);
  registryVersion++;
  for (const listener of registryListeners) listener();
  if (_provisional) setEditorWorkspace(defaultEditorWorkspace(), { provisional: true });
  // A CONTRIBUTION THAT ARRIVES UNDER THE ACTIVE WORKSPACE'S OWN ID republishes
  // it: the per-project restore picks a workspace by id at boot, before the
  // package that DEFINES it has loaded, so its regions and its areas were both
  // read off a descriptor that did not exist yet.
  //
  // THE TEST IS UNCONDITIONAL, and it was an `else if` until 2026-09-20, which
  // is a defect the Timeline's first walk found: a PROVISIONAL session whose
  // default workspace is ALREADY this id takes the branch above, and
  // `setEditorWorkspace` returns early on an unchanged id — so the publish
  // never ran and the workspace stood up with its regions and its AREAS
  // unread. Measured on a `--template models` scaffold: `model` is the
  // provisional default, `@volter/editor-blender` registers it a moment later, and its
  // Timeline area simply did not open. The two branches answer different
  // questions ("did the default change?" and "is this contribution the active
  // workspace?") and only the second one decides whether to publish.
  if (activeEditorWorkspace() === contribution.id) publishWorkspaceRegions();
  return () => {
    if (contributedWorkspaces.get(contribution.id) !== entry) return;
    contributedWorkspaces.delete(contribution.id);
    registryVersion++;
    for (const listener of registryListeners) listener();
    if (activeEditorWorkspace() === contribution.id)
      setEditorWorkspace(defaultEditorWorkspace(), { provisional: true });
  };
}

export function editorWorkspaceIds(): readonly EditorWorkspaceId[] {
  return editorWorkspaces().map((entry) => entry.id);
}

export function isEditorWorkspaceId(value: unknown): value is EditorWorkspaceId {
  return (
    typeof value === 'string' &&
    (layoutPolicy()?.arrangement?.id === value ||
      editorWorkspaces().some((entry) => entry.id === value))
  );
}

export function editorWorkspaceDescriptor(
  id: EditorWorkspaceId,
): EditorWorkspaceDescriptor | undefined {
  const registered = editorWorkspaces().find((entry) => entry.id === id);
  const arrangement = layoutPolicy()?.arrangement;
  if (arrangement?.id === id)
    // THE PROJECT'S LAYOUT POLICY OVERRIDES THE TITLE AND THE REGIONS; IT DOES
    // NOT REPLACE THE WORKSPACE. This branch used to synthesize a descriptor
    // from the policy alone, which SILENTLY DROPPED the contributed
    // workspace's `areas` — the Timeline's first walk found it (2026-09-20):
    // on a `--template models` scaffold the project's arrangement id IS
    // `model`, so `@volter/editor-blender`'s Model workspace was resolved through here
    // and its bottom Timeline area was never published, while `uv-editing` —
    // which no project names as its arrangement — worked. A policy says how a
    // project wants its chrome laid out; which EDITORS a workspace opens is
    // the contribution's, and nothing in a project's layout policy can even
    // spell one.
    return {
      ...(registered ?? {}),
      id,
      title: arrangement.title,
      description: 'Project layout',
      arrangement: id,
      ...(arrangement.regions ? { regions: arrangement.regions } : {}),
    };
  return registered;
}

/** `game` IS today's editor: its shipped "preset" is simply the layout the
 *  reconcile already builds, so an existing project sees no change at all.
 *  It is the default for every project that MOUNTS something; the default
 *  for a project that declares no roots is the first workspace whose
 *  requirement it meets ({@link defaultEditorWorkspace}). */
export const DEFAULT_EDITOR_WORKSPACE: EditorWorkspaceId = 'look';

/** Does `id`'s workspace apply to the active project's declared shape? */
export function workspaceApplies(id: EditorWorkspaceId): boolean {
  const entry = editorWorkspaces().find((candidate) => candidate.id === id);
  if (!entry?.requires) return true;
  if (entry.requires === 'mounts') return projectMounts();
  return projectDeclaresDocumentKind(entry.requires.documentKind);
}

/**
 * The workspace a project opens in when this checkout has none recorded, in
 * order of who said it:
 *
 *  1. THE PROJECT — its `editor.workspace` in `vgai.adapter.ts`, or an imported
 *     arrangement's id, when the project's shape meets it;
 *  2. THE PRODUCT — `frame/product.ts`'s `workspace`. A product is
 *     composition-scoped (ARCHITECTURE-CORE §The target shape, rule 3), and
 *     which workspace its editor opens in is exactly that kind of choice: the
 *     game editor opens in Game, the model editor in Model;
 *  3. registry order — the first workspace whose requirement this project
 *     meets, which is what a host with no product composed answers.
 *
 * Registry order is a poor THIRD and was a poor FIRST: contributions come in
 * load order, so two packages that both register an unconditional workspace
 * made the default a race. The product naming one is what settles it.
 */
export function defaultEditorWorkspace(): EditorWorkspaceId {
  // The workspace this checkout was left in outranks every default, once the
  // package that contributes it has registered and the project's shape meets it.
  if (
    _restoredCandidate !== null &&
    isEditorWorkspaceId(_restoredCandidate) &&
    workspaceApplies(_restoredCandidate)
  )
    return _restoredCandidate;
  const declared = layoutPolicy()?.arrangement?.id ?? adapterEditorConfiguration().workspace;
  if (isEditorWorkspaceId(declared) && workspaceApplies(declared)) return declared;
  const product = activeProduct()?.workspace;
  if (product !== undefined && isEditorWorkspaceId(product) && workspaceApplies(product))
    return product;
  return (
    editorWorkspaces().find((entry) => workspaceApplies(entry.id))?.id ?? DEFAULT_EDITOR_WORKSPACE
  );
}

let _workspace: EditorWorkspaceId = DEFAULT_EDITOR_WORKSPACE;
/** The workspace this checkout's record names, while its contribution or the
 *  project shape it needs has not arrived yet. */
let _restoredCandidate: string | null = null;

/** Offer the recorded workspace a restore could not apply yet; the provisional
 *  default takes it as soon as it registers and applies. */
export function offerRestoredEditorWorkspace(id: string): void {
  _restoredCandidate = id;
}
/** Whether the active workspace was a FALLBACK (nothing recorded for this
 *  checkout, nothing declared by the adapter) rather than a choice — a
 *  contribution registering later may improve on a fallback, never on a
 *  choice. */
let _provisional = true;
const _listeners = new Set<() => void>();

/** Current workspace id (`useSyncExternalStore`-shaped snapshot). */
export function activeEditorWorkspace(): EditorWorkspaceId {
  return _workspace;
}

/**
 * Switch workspaces. EXPLICIT ACTS ONLY (see the module header) — the menu,
 * the registered actions, the `editor.workspace(id)` session operation, and
 * the per-project restore at boot.
 */
/** The active workspace's region choices (see {@link EditorWorkspaceRegions}). */
export function activeWorkspaceRegions(): EditorWorkspaceRegions {
  return editorWorkspaceDescriptor(activeEditorWorkspace())?.regions ?? {};
}

/** The active workspace's EDITOR AREAS (see {@link EditorWorkspaceDescriptor.areas}). */
export function activeWorkspaceAreaContributions(): NonNullable<
  WorkspaceLayoutContribution['areas']
> {
  return editorWorkspaceDescriptor(activeEditorWorkspace())?.areas ?? [];
}

/** Push the active workspace's regions into the store the host regions read
 *  (`workspace-regions.ts`) — on every switch, and once at load for the
 *  restored workspace — and its AREAS into `workspace-areas.ts`, which opens
 *  the documents they name. The two travel together on purpose: they are the
 *  two halves of "apply this workspace", and a caller that could do one
 *  without the other is how a workspace ends up with a group and no editor
 *  in it. */
function publishWorkspaceRegions(): void {
  setWorkspaceRegions(activeWorkspaceRegions());
  setWorkspaceAreas(activeWorkspaceAreaContributions());
}

export function setEditorWorkspace(
  id: EditorWorkspaceId,
  options: { readonly provisional?: boolean } = {},
): void {
  _provisional = options.provisional === true;
  if (!_provisional) _restoredCandidate = null;
  if (_workspace === id) return;
  _workspace = id;
  for (const listener of _listeners) listener();
  publishWorkspaceRegions();
}

export function subscribeEditorWorkspace(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

/** The cycle action's step, in registry order and wrapping both ways. */
export function cycleEditorWorkspace(step: 1 | -1): EditorWorkspaceId {
  // Only the workspaces the project's declared shape meets take part.
  const ids = editorWorkspaceIds().filter(workspaceApplies);
  const index = ids.indexOf(activeEditorWorkspace());
  const next = ids[(index + step + ids.length) % ids.length] ?? defaultEditorWorkspace();
  setEditorWorkspace(next);
  return next;
}

// ---- "the workspace has been applied" -------------------------------------
// A workspace switch is a store flip; the surfaces it names re-render on the
// next paint. That is invisible to a scripted caller, so `editor.workspace(id)`
// must be able to ack the ARRANGEMENT rather than the intent — otherwise the
// very next screenshot photographs the outgoing one. The layout host calls
// {@link notifyEditorWorkspaceApplied} once it has committed the new
// workspace's documents (`frame/bridge.tsx`'s workspace effect); the frame
// sizes its editor groups from the same registry change, in the same beat.

const _appliedWaiters = new Set<() => void>();

export function notifyEditorWorkspaceApplied(): void {
  const waiters = [..._appliedWaiters];
  _appliedWaiters.clear();
  for (const resolve of waiters) resolve();
}

/** Resolves on the NEXT applied workspace. Call BEFORE the store flip. */
export function whenEditorWorkspaceApplied(): Promise<void> {
  return new Promise((resolve) => _appliedWaiters.add(resolve));
}

export function __resetEditorWorkspaceForTest(): void {
  _workspace = DEFAULT_EDITOR_WORKSPACE;
  _restoredCandidate = null;
  _listeners.clear();
  _appliedWaiters.clear();
}

// The restored workspace's regions are live before the first render.
publishWorkspaceRegions();

// A project that declares a different shape than the workspace it was left in
// (a zero-root folder reopened from a Game-workspace record, or the reverse)
// moves to the first workspace its shape meets — one of the explicit acts the
// module header allows, and the one that lets chrome follow declarations.
subscribeProjectShape(() => {
  // A fallback improves when the shape arrives, as it does for a late
  // contribution; a choice moves only when the shape no longer meets it.
  if (_provisional) setEditorWorkspace(defaultEditorWorkspace(), { provisional: true });
  else if (!workspaceApplies(_workspace)) setEditorWorkspace(defaultEditorWorkspace());
});

// An imported layout may change its region choices without remounting.
subscribeLayoutPolicy(publishWorkspaceRegions);

// A product composes before it mounts, but this module is in its import graph
// and therefore evaluates first — so the product's own default arrives after
// this module's provisional choice and re-runs it, exactly as a late
// contribution does.
subscribeActiveProduct(() => {
  if (_provisional) setEditorWorkspace(defaultEditorWorkspace(), { provisional: true });
});
