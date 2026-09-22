/**
 * THE ADAPTER LOADER — the host half of `vgai.adapter.ts`.
 *
 * ARCHITECTURE-CORE §The editor protocol: every game supplies a SERVER — its
 * adapter — and the editor is a universal CLIENT of it. This module is where a
 * project's adapter becomes a live binding table:
 *
 *   1. the project has `vgai.adapter.ts` ⇒ **the project's own file wins,
 *      always**. It is imported through the SAME door every other
 *      project-owned module goes through (`project-module-url.ts`'s
 *      `fsImportPath` — the ONE owner of `/@fs/` urls for project code, PD-3)
 *      and its default export is parsed by `parseAdapterDefinition`, which
 *      rejects an unknown key by name. This branch is FIRST because a game
 *      supplies its own protocol server: a project that ships the declaration
 *      has stated its table, and no host-side table may quietly outrank it —
 *      not even when its ingest root id happens to match a registry key
 *      (a user's `cuberun` folder is not ours);
 *   2. the project is an INGEST GAME whose adapter the host's in-tree registry
 *      holds, and it shipped none of its own ⇒ that module is the adapter.
 *      Placement follows REALM (ARCHITECTURE-CORE §The editor protocol): a
 *      vendored game's bytes are served verbatim, so its host-realm declaration
 *      lives in `ingest/games/<id>/vgai.adapter.ts` and is imported through the
 *      registry glob, never through the project's file routes. **This branch is
 *      REACHABLE only because the step-1 probe can answer "no"**: the realm
 *      rule keeps a vendored game's adapter out of its served bundle, but
 *      "the file is not on disk" and "the probe says absent" were different
 *      answers until `probeProjectFile` learned to recognize the SPA fallback
 *      — a 200 serving `index.html` for every missing project-root path, on
 *      both the dev server and the hosted surface. An existence check reading
 *      `res.ok` is a constant TRUE here and makes this branch dead code, which
 *      is exactly how every vendored game silently lost its scene table once.
 *      **A binding taken from here is NEVER silent**:
 *      the facet's `source` says `'registry'` and its `modulePath` names the
 *      repo file, so `vgai status` reports whose declaration is running. A
 *      project bound this way did not ship that table; the host did, and the
 *      user is entitled to read that off the same door as everything else;
 *   3. the project has NONE ⇒ it gets `nativeAdapter()`. **That absence IS the
 *      declared native default, not a silent fallback**: the same binding table
 *      the template ships explicitly, chosen because the project declared
 *      nothing else — there is no third behavior for "no adapter".
 *
 * The ordering also settles the one folder that can answer BOTH probes: an
 * in-tree ingest fixture keeps its manifest and its adapter side by side, so
 * opening `ingest/games/<id>/` as a folder project reaches THE SAME FILE
 * through the project door. One declaration, one winner, decided by a rule that
 * does not ask which population the project belongs to.
 *
 * It is also the ONE sanctioned importer of `@editor/finders`
 * (`packages/engine/test/finder-import-boundary.test.ts` is the tripwire). The
 * engine never runs a finder nobody selected; the loader runs exactly the
 * selections the adapter's table names, with the inputs gathered here.
 *
 * The resolved table is published as the `adapter` facet of `/__editor/state`
 * (`command-listener.ts`'s `collectState`), which is the minimal proof-of-load
 * client: `vgai status` / `vgai eval 'await editor.status()'` read which
 * adapter loaded, its regions, and its scene table.
 *
 * The OBSERVATION table has one client and it is not the facet: the ingest
 * mount's system-adapter assembly (`ingest/ingest-render-debug.ts`'s
 * `wireIngestSystems`) projects the declarations onto the host's ordinary
 * `SystemAdapters.debug` alongside the game's own contract projection, so
 * `game.providers()` / `game.state()` reach an adapter declaration through the
 * SAME door first-party content uses. The facet publishes only the statically
 * readable half (ids, kinds, whether an answer is bound); the closures travel
 * host-side through `adapter-observation.ts`, because a closure cannot be a
 * wire shape.
 *
 * The scene table has TWO real clients (ARCHITECTURE-CORE §Editor). The EDIT
 * TAB ROW is the first: `components/scene-documents.tsx` subscribes to this
 * facet and projects `scenes` as workspace documents — every authorable scene
 * a tab, the default open by default — and `command-listener.ts`'s `open` verb
 * resolves one entry through the same pure decision table
 * (`scene-document-plan.ts`). Play's `open()`, walking the table as live
 * navigation, is the second and is a later rung.
 */

import type { EntrypointSource, FinderInput, ProjectComponentRef } from '@editor/finders';
import {
  type FinderResult,
  type ProjectSourceFile,
  registerContributedFinder,
  runFinderSelection,
} from '@editor/finders';
import { fsImportPath } from '@volter/editor-sdk/session/project-module-url';
import type {
  AdapterDefinition,
  AdapterRegion,
  DocumentEntry,
  ObservationDeclaration,
  ObservationKind,
} from '@volter/editor-project/adapter/adapter-module';
import {
  nativeAdapter,
  parseAdapterDefinition,
  regionsFromManifestRoots,
  unmatchedRegionIncludeIds,
} from '@volter/editor-project/adapter/adapter-module';
import { declaredRoots, ingestRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import type { ResolvedGameManifest } from '@volter/editor-project/manifest/load';
import { activeProjectKey } from './active-project';
import { setAdapterEditorConfiguration } from './adapter-editor-config';
import { setAdapterInputBinding, setAdapterObservations } from './adapter-observation';
import { connectSourceFileEvents } from './asset-events';
import {
  listProjectComponents,
  listProjectSourceFiles,
  probeProjectFile,
  readProjectTextFile,
} from './editor-api';
import { editorConsole } from './editor-console';
import { fetchGameManifest } from './manifest-project';
import { setPresentationRegions } from './presentation-surface';
import { type ActiveProject, getCurrentProject, onProjectChange } from './project-manager';
import { projectModuleChangeMatches, subscribeProjectModuleChange } from './project-module-changes';
import { notifyProjectShapeChanged, registerDocumentKindsSupplier } from './project-shape';
import { resolveRelativeSpecifier } from './resolve-relative-specifier';
import { storyPrefabsFinder } from './stories/prefabs-finder';
import {
  contributedFinderModules,
  documentContributionForKind,
  refreshProjectToolContributions,
  subscribeToolContributions,
} from './tool-loader';

/** The game's adapter module lives beside `vgai.project.json`, by contract. */
export const ADAPTER_MODULE_FILENAME = 'vgai.adapter.ts';

/** The resolved scene table — the adapter's declarations plus what its own
 *  finder selections found. */
export interface ResolvedDocumentTable {
  readonly entries: readonly DocumentEntry[];
  /** `null` = nothing settled a default, which stays a fact rather than a pick. */
  readonly default: string | null;
}

/**
 * One observation slot as it travels over `/__editor/state` — the statically
 * readable half of an {@link ObservationDeclaration}, and nothing else.
 *
 * `answer` is a CLOSURE the host evaluates against the mounted game, so it
 * cannot be serialized and is deliberately not here; `answered` carries the one
 * fact its presence states. That split is the two-state rule made visible on
 * the wire: `answered: false` reads as "declared, nothing binds it yet", which
 * is a different answer from the slot not appearing at all. The closures
 * themselves stay host-side in `adapter-observation.ts`, where the mount reads
 * them.
 */
export interface ProjectObservationFacet {
  readonly id: string;
  readonly kind: ObservationKind;
  /** Whether the declaration binds an `answer`. */
  readonly answered: boolean;
}

export interface ProjectAdapterFacet {
  /**
   * WHOSE declaration is running — the one field that answers it, because
   * "a module loaded" never did.
   *
   * - `project` — the project's own `vgai.adapter.ts` supplied the table.
   * - `registry` — the HOST's in-tree ingest registry supplied it, matched on
   *   this project's ingest root id. The project did not ship this
   *   declaration; a reader must be able to see that without pattern-matching
   *   a path, which is why it is a value here and not an inference from
   *   {@link modulePath}.
   * - `native` — the project declared none and got `nativeAdapter()`, the
   *   declared native default.
   */
  readonly source: 'project' | 'registry' | 'native';
  /**
   * Where the loaded module came from, or `null` for the native default:
   * project-relative for a project that owns its own file, and the REPO path
   * (`packages/editor/src/ingest/games/<id>/vgai.adapter.ts`) for a registry
   * binding, whose adapter is host-realm by the placement rule and therefore
   * has no project-relative home to name.
   */
  readonly modulePath: string | null;
  readonly editor?: Omit<NonNullable<AdapterDefinition['editor']>, 'Layout'> & {
    readonly layout?: string;
  };
  readonly regions: readonly AdapterRegion[];
  readonly scenes: ResolvedDocumentTable;
  /** The observation table, wire-shaped. See {@link ProjectObservationFacet}. */
  readonly observation: readonly ProjectObservationFacet[];
  /** Finder diagnostics — what could not be answered, and why. Never swallowed. */
  readonly notes: readonly string[];
  /** True while a declared finder has no registration yet — a contribution's
   *  finder before the contribution pass — so the table is NOT final. The
   *  chrome treats the document kinds as unknown until this clears, rather
   *  than concluding "no model" from a table the pass is about to fill. */
  readonly documentsPending: boolean;
  /**
   * A load/parse failure — or a probe that could not answer — named. Non-null
   * means the project's OWN adapter did not load, and what stood in is
   * whatever {@link source} says: a registry binding, or the declared native
   * default. Never swallowed, because the editor still opening on a broken
   * `vgai.adapter.ts` is only acceptable while it SAYS the file is broken.
   */
  readonly error: string | null;
}

let _facet: ProjectAdapterFacet | null = null;
/** The parsed declaration behind {@link _facet}, kept for
 *  {@link projectAdapterDefinition}. `null` whenever no declaration FILE was
 *  parsed — see that function for why the native default is not stored here. */
let _definition: AdapterDefinition | null = null;
let _owner = '__unscoped__';
/** The load in flight, so a reader can wait for the answer instead of racing
 *  it. See {@link projectAdapterDefinition}. */
let _inFlight: Promise<void> | null = null;
let _refreshEpoch = 0;
const _listeners = new Set<() => void>();

/** The loaded adapter table, or `null` before the first load completes —
 *  "nobody looked yet" is deliberately distinct from "the project has none". */
export function projectAdapterFacet(): ProjectAdapterFacet | null {
  return _owner === activeProjectKey() ? _facet : null;
}

/**
 * THE PARSED DECLARATION, for the one consumer that needs the whole thing:
 * `binding-resolver.ts`, which hands it to `resolveRootBinding` so it lands on
 * `binding.project.definition`.
 *
 * Two deliberate properties:
 *
 * - It **awaits the load in flight**. A resolve that read module state
 *   synchronously would answer `null` for a project whose adapter is still
 *   loading — a project-switch-then-Play race — and `null` on that binding
 *   means "this project declares no adapter", which would be a fabricated
 *   fact. Waiting is what makes the `null` honest.
 * - The **declared native default is `null` here**, not `nativeAdapter()`.
 *   `binding.project.definition` answers "what did the PROJECT declare", so a
 *   project that shipped no declaration file must read as `null`. Which table
 *   actually stood in — project, registry, or native — is
 *   {@link ProjectAdapterFacet.source}'s job, and that is where a consumer
 *   asking the other question looks.
 */
export async function projectAdapterDefinition(): Promise<AdapterDefinition | null> {
  if (_inFlight) await _inFlight;
  return _owner === activeProjectKey() ? _definition : null;
}

/** Initial layout waits for the adapter declaration, not deferred finder contributions. */
export function waitForProjectAdapter(): Promise<void> {
  const ready = () => !getCurrentProject() || Boolean(projectAdapterFacet());
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = subscribeProjectAdapter(() => {
      if (ready()) {
        stop();
        resolve();
      }
    });
  });
}

export function subscribeProjectAdapter(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function publish(
  next: ProjectAdapterFacet | null,
  observation: readonly ObservationDeclaration[] = [],
  input: AdapterDefinition['input'] = undefined,
  definition: AdapterDefinition | null = null,
): void {
  _owner = activeProjectKey();
  _facet = next;
  _definition = definition;
  setAdapterEditorConfiguration(definition?.editor);
  // The region table's OTHER reader, pushed rather than pulled: the capture and
  // staleness sites ask "what is this project presented on" from inside the
  // ingest mount and play-mode, and having them import this loader would drag
  // its whole graph along. See `presentation-surface.ts`'s note — this stays the
  // one place regions are decided.
  setPresentationRegions(next?.regions ?? []);
  // Same push, same reason, for the half of the observation table that cannot
  // travel over the wire: the `answer` closures the ingest mount evaluates
  // against the mounted game (`adapter-observation.ts`).
  setAdapterObservations(observation);
  setAdapterInputBinding(input ?? null);
  for (const fn of _listeners) fn();
  notifyProjectShapeChanged();
}

/** The wire half of one declaration — closures stripped, the fact of one kept. */
function observationFacet(declaration: ObservationDeclaration): ProjectObservationFacet {
  return {
    id: declaration.id,
    kind: declaration.kind,
    answered: declaration.answer !== undefined,
  };
}

/** Test seam: drop the loaded table, both halves of it. */
export function __resetProjectAdapterForTest(): void {
  _facet = null;
  _definition = null;
  _inFlight = null;
  _refreshEpoch++;
  setAdapterEditorConfiguration();
  setAdapterObservations([]);
  setAdapterInputBinding(null);
}

/**
 * Import the project's own adapter module. Cache-busted like every other
 * design-time project load, because a saved `vgai.adapter.ts` must be readable
 * without restarting the editor.
 *
 * The url is built by `fsImportPath` (project-module-url.ts) and NOT by
 * `projectEntryImportUrl`: a mount epoch exists to keep the roots of ONE mount
 * on one module instance, and the adapter is not part of any mount — it is a
 * binding table read WITHOUT booting the game. Taking an epoch here would
 * inflate the mount-epoch census for a module no root shares.
 */
function editorConfigurationFacet(editor: NonNullable<AdapterDefinition['editor']>) {
  const { Layout, ...configuration } = editor;
  return {
    ...configuration,
    ...(Layout ? { layout: Layout.displayName ?? Layout.name ?? 'Project layout' } : {}),
  };
}

async function importAdapterModule(rootPath: string): Promise<unknown> {
  // The server-less tier has no `/@fs/`. A storage-backed project's adapter
  // loads through the same in-browser bundling door as every project module
  // (fresh bundle per call — the cache-bust for free); a STAGED hosted
  // example/ingest — reached only when the realm-correct probe found the
  // file among its served bytes — bundles it from its own staged URL. Never
  // the backend for those: it still holds some other project
  // (`browserProjectStorageBacked`, the 2026-08-27 leak).
  const url = `${fsImportPath(rootPath, ADAPTER_MODULE_FILENAME)}?t=${Date.now()}`;
  return (await import(/* @vite-ignore */ url)) as unknown;
}

/**
 * Map a component to its region by SURFACE. Exact, not heuristic: the manifest
 * schema enforces at most ONE world root per medium (ARCHITECTURE-CORE
 * §Roots), so a surface names at most one region.
 */
function regionForSurface(regions: readonly AdapterRegion[], surface: string): string | null {
  return regions.find((region) => region.surface === surface)?.id ?? null;
}

/**
 * Resolve one of an entrypoint's relative import specifiers against the paths
 * the project's own component index reports. Extension/index resolution is a
 * filesystem question and the finders are pure, so the host answers it here —
 * from a real index, never by guessing an extension onto a path.
 */
function makeResolveModule(
  components: readonly { readonly path: string }[],
): (specifier: string, fromPath: string) => string | null {
  const paths = new Set(components.map((component) => component.path));
  return (specifier, fromPath) => resolveRelativeSpecifier(specifier, fromPath, paths);
}

/**
 * The ingest game this project IS, or `null` — the key the in-tree adapter
 * registry is looked up by.
 *
 * It is the manifest's own single `{ ingest }` root id, which is a DECLARATION
 * read off the project (never a folder-name guess), and it is the same id
 * `ingest/mount-ingest-root.ts` mounts by. Two ingest roots is not this
 * module's error to report — that route already fails loudly on it
 * (`reportTooManyIngestRoots`) — so here it simply names no game rather than
 * picking one.
 */
function ingestGameIdOf(manifest: ResolvedGameManifest): string | null {
  const declared = ingestRoots(manifest);
  return declared.length === 1 ? declared[0]!.id : null;
}

/** What a table with no finder selections is resolved against. */
const NO_FINDER_INPUT: FinderInput = { entrypoints: [], components: [] };

async function gatherFinderInput(
  manifest: ResolvedGameManifest,
  regions: readonly AdapterRegion[],
  definition: AdapterDefinition,
): Promise<FinderInput> {
  const entrypoints: EntrypointSource[] = [];
  for (const root of declaredRoots(manifest)) {
    if (!root.entry) continue;
    entrypoints.push({
      regionId: root.id,
      path: root.entry,
      source: await readProjectTextFile(root.entry),
    });
  }

  let components: ProjectComponentRef[] = [];
  const listing = await listProjectComponents().catch(
    (error: unknown): Awaited<ReturnType<typeof listProjectComponents>> => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
  if (listing.ok) {
    components = listing.entries.map((component) => ({
      name: component.name,
      path: component.path,
      region: regionForSurface(regions, component.surface),
    }));
  } else {
    // No component index (the route is unavailable): prefabs
    // still resolve from their stories, they just carry no source path. That
    // degrade is fine; being silent about it was not — a prefab missing its
    // source path looked like the prefab, not like the index.
    editorConsole.warn(
      `Component index unavailable, so prefabs resolve without source paths: ${listing.reason}`,
      'project',
    );
  }

  // Every selection's `include` globs, read once: a contributed finder sees
  // the project through these sources and nothing else.
  const includes = new Set<string>();
  for (const selection of definition.documents.find ?? []) {
    for (const glob of (selection as { include?: readonly string[] }).include ?? [])
      includes.add(glob);
  }
  const sources: ProjectSourceFile[] = [];
  const files: string[] = [];
  if (includes.size > 0) {
    // Newest first: the table keeps this order, so "the one being worked on"
    // is the first candidate when a fresh checkout has to pick a document.
    const paths = await listProjectSourceFiles([...includes], { order: 'mtime' }).catch(
      () => [] as string[],
    );
    for (const path of paths) {
      files.push(path);
      // A BINARY document is listed, never decoded. `@volter/editor-blender`'s finder
      // includes `.blend` files, and reading one as text would hand a finder a
      // string of replacement characters and call it a source. A NUL byte is
      // the test because it is the one thing no text source contains, and it
      // asks the bytes rather than a list of extensions the host would then
      // own. COST, named rather than hidden: the bytes are fetched and decoded
      // before the test can run, so a binary under a finder's globs is read
      // once per adapter resolve. A selection that declared it wants paths
      // only would close it; no shipped finder needs that yet.
      const source = await readProjectTextFile(path);
      if (source !== null && !source.includes('\0')) sources.push({ path, source });
    }
  }
  return {
    entrypoints,
    components,
    sources,
    files,
    resolveModule: makeResolveModule(components),
  };
}

export type { EntrypointSource, FinderInput, ProjectComponentRef };

/**
 * Assemble finder input from parts the caller already gathered. The live
 * loader reads those parts off the editor session; the headless portfolio
 * run reads them off disk. Both hand the SAME shape to
 * {@link resolveDocumentTable}, which is the one fold.
 */
export function buildFinderInput(parts: {
  readonly entrypoints: readonly EntrypointSource[];
  readonly components?: readonly ProjectComponentRef[];
}): FinderInput {
  const components = parts.components ?? [];
  return {
    entrypoints: parts.entrypoints,
    components,
    resolveModule: makeResolveModule(components),
  };
}

/** Run the adapter's own finder selections and fold them into one table. */
export function resolveDocumentTable(
  definition: AdapterDefinition,
  input: FinderInput,
): {
  table: ResolvedDocumentTable;
  notes: string[];
  /** Selections whose finder is not registered (yet). */
  unresolved: number;
} {
  const entries: DocumentEntry[] = [...(definition.documents.entries ?? [])];
  const notes: string[] = [];
  const settled: string[] = [];
  let unresolved = 0;
  for (const selection of definition.documents.find ?? []) {
    let result: FinderResult;
    try {
      result = runFinderSelection(selection, input);
    } catch (error) {
      // A finder a CONTRIBUTION registers is not there until the contribution
      // pass has run, which follows the first adapter load; the table is
      // resolved again when it does (`subscribeToolContributions` below). A
      // selection that stays unresolved is a standing note, never a throw.
      notes.push(
        `finder ${JSON.stringify(selection.finder)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      unresolved += 1;
      continue;
    }
    entries.push(...result.entries);
    notes.push(...result.notes);
    if (result.default !== undefined) settled.push(result.default);
  }
  // THE SESSION'S OWN MODEL DOCUMENT (ARCHITECTURE-CORE §The project model,
  // "A model is Blender data"): `@volter/editor-blender`'s Model document opens a
  // project's `.blend` files, which its `modelsFromBlendFiles` finder lists
  // above. A project that declares the package but holds no `.blend` of its
  // own still needs ONE — it is what `blender-start` presents into and what a
  // first bpy call models in, saved to the session's default
  // `models/model.blend` — so the standing `blender:runtime` entry stands
  // exactly there: where that package's document is registered AND the table
  // found no model of the project's own. Never as an entry no editor can
  // open, and never as a second Model beside a real one.
  if (
    documentContributionForKind('model') !== undefined &&
    !entries.some((entry) => entry.kind === 'model')
  ) {
    entries.push({
      id: 'blender:runtime',
      label: 'Model',
      kind: 'model',
      region: null,
      authorable: true,
      reach: { kind: 'root-mount' },
    });
  }
  // The adapter's own declaration wins; otherwise a default stands only when
  // exactly one finder settled one. Two candidates is a CHOICE, and the host
  // does not make choices the game's author can state.
  const fallback = settled.length === 1 ? settled[0]! : null;
  return {
    table: { entries, default: definition.documents.default ?? fallback },
    notes,
    unresolved,
  };
}

/** Which adapter this project resolved to, and the provenance of the choice. */
export interface ResolvedAdapterChoice {
  readonly definition: AdapterDefinition;
  readonly source: 'project' | 'registry' | 'native';
  readonly modulePath: string | null;
  readonly error: string | null;
}

/** The project's own `vgai.adapter.ts` probe, as data — the live loader and
 *  the headless run answer this the same way, from different IO. */
export type ProjectAdapterProbe =
  | { readonly kind: 'present'; readonly module: unknown }
  | { readonly kind: 'broken'; readonly error: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreachable'; readonly error: string };

/**
 * AN ADAPTER DEFINITION IS SOURCED, NOT GLOBBED — the door a LANE registers
 * its host-realm declarations through, in the family of
 * `workspace-document-restore.ts` (a kind owns its persisted state),
 * `document-open-registry.ts` (a kind owns how it opens),
 * `chrome-slot-registry.ts` (the host owns the place, a package owns what sits
 * there) and `content-entry-source-registry.ts` (the host owns the Content
 * scope, a package owns why a component is content).
 *
 * IT LIVES IN THIS FILE, not beside those, and the reason is the meter. Its
 * only consumer is {@link resolveAdapterDefinition} below — the one place the
 * three-way precedence lives — so a separate module is a host file traded for
 * a host file: MEASURED, `main.tsx` stayed at 494 with the door split out and
 * dropped to 493 with it here. A registry whose whole readership is one
 * function belongs in that function's module.
 *
 * WHAT IT REPLACED. This module used to import `ingest/registry.ts` directly
 * for branch 2, so the host's boot closure carried the ingest lane's
 * `import.meta.glob` over `src/ingest/games/*` — every repo-vendored game's
 * manifest and adapter module in every editor boot, a `models` build that
 * mounts no unmodified game included. The lane that OWNS those declarations is
 * `@vgai/game`, which already imports that registry from three of its own
 * ingest modules; it registers here from `contributions/ingest.service.ts`.
 *
 * NOTHING REGISTERED IS A REAL ANSWER, AND IT IS A LOUD ONE — see
 * {@link RegistryAdapterProbe}'s `unanswered`.
 */
export interface AdapterDefinitionSource {
  /** The source's id, in its own vocabulary. Part of every teaching message. */
  readonly id: string;
  /** Which module registered it. Re-registering the same owner+id REPLACES,
   *  so an HMR re-evaluation leaves one source, not two. */
  readonly owner: string;
  /** Ascending; ties keep registration order. */
  readonly order?: number;
  /** The repo path of the declaration this source holds for `rootId`, or
   *  `null` when it holds none. Never throws — a source that cannot answer
   *  says so by returning `null`. */
  readonly modulePathFor: (rootId: string) => string | null;
  /** Import that declaration. Only called when `modulePathFor` named a file;
   *  a module that exists and throws is LEFT to throw, so the loader can name
   *  the failure rather than swallow it. */
  readonly importModule: (rootId: string) => Promise<unknown>;
}

const _adapterSources: AdapterDefinitionSource[] = [];

/** Install a source. Returns the teardown. */
export function registerAdapterDefinitionSource(source: AdapterDefinitionSource): () => void {
  const stale = _adapterSources.findIndex(
    (item) => item.owner === source.owner && item.id === source.id,
  );
  if (stale >= 0) _adapterSources.splice(stale, 1);
  _adapterSources.push(source);
  _adapterSources.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return () => {
    const at = _adapterSources.indexOf(source);
    if (at >= 0) _adapterSources.splice(at, 1);
  };
}

/** The first source that claims this root id, and the file it claims it
 *  through — `null` when none does, which is NOT "this project has no
 *  adapter" (see {@link RegistryAdapterProbe}). */
function adapterDefinitionBinding(
  rootId: string,
): { readonly source: AdapterDefinitionSource; readonly modulePath: string } | null {
  for (const source of _adapterSources) {
    const modulePath = source.modulePathFor(rootId);
    if (modulePath !== null) return { source, modulePath };
  }
  return null;
}

/**
 * The SOURCED-declaration probe, as data (`adapter-definition-source-registry.ts`).
 *
 * `unanswered` is this half's `unreachable`, and it exists for the same reason
 * the project half's does: a manifest that DECLARES an ingest root has stated
 * which lane owns its declaration, so "no registered source holds one" is an
 * unanswered question about the BUILD, never an absence in the project. It is
 * the anti-shim rule's standing warning — the native default still stands in so
 * the editor opens, and the failure is named rather than mounted quietly.
 *
 * `absent` remains the honest answer of the DISK half (`coverage/
 * portfolio-resolve.ts`), which looks at the filesystem and can genuinely say
 * the file is not there.
 */
export type RegistryAdapterProbe =
  | { readonly kind: 'present'; readonly module: unknown; readonly path: string }
  | { readonly kind: 'broken'; readonly path: string; readonly error: string }
  | { readonly kind: 'unanswered'; readonly rootId: string; readonly sources: number }
  | { readonly kind: 'absent' };

function adapterModuleDefault(module_: unknown): unknown {
  if (module_ !== null && typeof module_ === 'object' && 'default' in module_) {
    return (module_ as { default: unknown }).default;
  }
  return module_;
}

/**
 * THE THREE-WAY PRECEDENCE as a pure function over already-loaded modules.
 * {@link resolveAdapterDefinition} is the live IO half; the headless portfolio
 * run is the disk half. Neither may invent a fourth branch.
 */
export function selectAdapterDefinition(
  project: ProjectAdapterProbe,
  registry: RegistryAdapterProbe,
): ResolvedAdapterChoice {
  if (project.kind === 'present') {
    try {
      return {
        definition: parseAdapterDefinition(adapterModuleDefault(project.module)),
        source: 'project',
        modulePath: ADAPTER_MODULE_FILENAME,
        error: null,
      };
    } catch (err) {
      return {
        definition: nativeAdapter(),
        source: 'native',
        modulePath: null,
        error: `${ADAPTER_MODULE_FILENAME} did not load — ${describe(err)}`,
      };
    }
  }
  if (project.kind === 'broken') {
    return {
      definition: nativeAdapter(),
      source: 'native',
      modulePath: null,
      error: `${ADAPTER_MODULE_FILENAME} did not load — ${project.error}`,
    };
  }

  const unknown = project.kind === 'unreachable' ? project.error : null;

  if (registry.kind === 'present') {
    try {
      return {
        definition: parseAdapterDefinition(adapterModuleDefault(registry.module)),
        source: 'registry',
        modulePath: registry.path,
        error: unknown,
      };
    } catch (err) {
      return {
        definition: nativeAdapter(),
        source: 'native',
        modulePath: null,
        error: `${registry.path} did not load — ${describe(err)}`,
      };
    }
  }
  if (registry.kind === 'broken') {
    return {
      definition: nativeAdapter(),
      source: 'native',
      modulePath: null,
      error: `${registry.path} did not load — ${registry.error}`,
    };
  }
  if (registry.kind === 'unanswered') {
    return {
      definition: nativeAdapter(),
      source: 'native',
      modulePath: null,
      error:
        `vgai.project.json declares the ingest root \`${registry.rootId}\`, and no registered ` +
        `adapter-definition source holds a declaration for it ` +
        `(${registry.sources} source${registry.sources === 1 ? '' : 's'} registered). The lane ` +
        `that owns a vendored game's declaration is \`@vgai/game\`, which registers through ` +
        `its \`ingest.service.ts\` contribution — so either this product does not compose that ` +
        `package, ` +
        `or its contribution pass did not load it. The declared native default is standing in, ` +
        `which means this game's own scene table is NOT what the editor is showing.`,
    };
  }

  return { definition: nativeAdapter(), source: 'native', modulePath: null, error: unknown };
}

/**
 * Regions + scene table + observation from a chosen definition. The live
 * loader and the headless run both land here — one fold, two IO fronts.
 */
export function projectAdapterTableFrom(
  manifest: ResolvedGameManifest,
  choice: ResolvedAdapterChoice,
  finderInput: FinderInput,
): ProjectAdapterFacet {
  const { definition, source, modulePath, error } = choice;
  const regions =
    definition.regions === 'manifest-roots'
      ? regionsFromManifestRoots(declaredRoots(manifest), definition.regionIncludes)
      : [...definition.regions];
  const unmatchedRegions = unmatchedRegionIncludeIds(
    declaredRoots(manifest),
    definition.regionIncludes,
  );
  const { table, notes, unresolved } = resolveDocumentTable(definition, finderInput);
  return {
    source,
    modulePath,
    regions,
    scenes: table,
    documentsPending: unresolved > 0,
    ...(definition.editor ? { editor: editorConfigurationFacet(definition.editor) } : {}),
    observation: definition.observation.map(observationFacet),
    notes:
      unmatchedRegions.length > 0
        ? [
            ...notes,
            `adapter: regionIncludes names ${unmatchedRegions.map((id) => `\`${id}\``).join(', ')}, ` +
              `which no root in vgai.project.json declares (roots: ${declaredRoots(manifest)
                .map((root) => `\`${root.id}\``)
                .join(', ')}) — those globs were merged onto nothing.`,
          ]
        : notes,
    error,
  };
}

/**
 * PICK THE ADAPTER — the three-way decision this module's header states, and
 * the ONLY place the precedence lives.
 *
 * The project's OWN file is probed FIRST and outranks the registry, whatever id
 * its ingest root declares.
 *
 * `probeProjectFile`, not `projectFileExists`, and that is the correctness of
 * this function rather than a style preference: an existence probe that reads
 * `res.ok` is a MEASURED CONSTANT TRUE here, because both shipped surfaces
 * answer a missing project-root path with the editor's own `index.html` at 200
 * (the dev server's SPA fallback; `docs/DEPLOY.md` §Surface 3 for hosted).
 * Ordering a can't-say-no probe ahead of the registry made the registry branch
 * unreachable — every vendored game lost its scene table to a fabricated
 * "vgai.adapter.ts did not load". The probe now discriminates by CONTENT (an
 * HTML document is the fallback, not the file) and reports "could not tell" as
 * an answer of its own.
 *
 * Never throws: every failure comes back as a named `error` beside a table that
 * still stands up, because an editor that dies on a project's config file
 * cannot be used to fix that file.
 */
async function resolveAdapterDefinition(
  project: ActiveProject,
  manifest: ResolvedGameManifest,
): Promise<ResolvedAdapterChoice> {
  const ingestGameId = ingestGameIdOf(manifest);
  const presence = await probeProjectFile(ADAPTER_MODULE_FILENAME);

  if (presence === 'present') {
    try {
      const module_ = (await importAdapterModule(project.rootPath)) as { default?: unknown };
      return selectAdapterDefinition({ kind: 'present', module: module_ }, { kind: 'absent' });
    } catch (err) {
      // NO fallback to the registry. The file is really there and it is really
      // broken, and quietly running the host's table for a game whose author is
      // staring at their own syntax error is exactly the silence the
      // project-first rule exists to remove. The failure is named and the
      // declared native default stands in, so the editor still opens.
      return selectAdapterDefinition({ kind: 'broken', error: describe(err) }, { kind: 'absent' });
    }
  }

  // `unreachable` is not an absence — it is an unanswered question, and saying
  // so is the difference between "this project has no adapter" and "we could
  // not find out". A table is published either way, because the editor has to
  // open; which one stood in is what `source` says.
  const projectProbe: ProjectAdapterProbe =
    presence === 'unreachable'
      ? {
          kind: 'unreachable',
          error:
            `${ADAPTER_MODULE_FILENAME} could not be probed — the project's file routes did not ` +
            `answer, so whether this project owns an adapter is UNKNOWN.`,
        }
      : { kind: 'absent' };

  if (ingestGameId === null) return selectAdapterDefinition(projectProbe, { kind: 'absent' });

  // THE MANIFEST ALREADY KNOWS THE LANE, so the host is not guessing. This
  // project declares an ingest root and shipped no adapter of its own, which
  // means its declaration lives in a SOURCE a package registers
  // ({@link registerAdapterDefinitionSource}) — and contributions load behind
  // the opening viewport frame (`project-tool-discovery.ts`), while this runs
  // at editor init (`startProjectAdapterLoad`). A document whose owner has not
  // loaded cannot resolve; saying so by WAITING is honest, where mounting the
  // native default and re-mounting when the registration lands is a silent
  // degrade followed by a correction (owner decision, WORK.md §The open-source
  // launch, "THE GAP IS 2"). The wait is paid ONLY here: a project with no
  // ingest root never reaches this line, and one whose source is already
  // registered (any resolve after the first) short-circuits below.
  let binding = adapterDefinitionBinding(ingestGameId);
  if (binding === null) {
    await waitForContributedAdapterSources(ingestGameId);
    binding = adapterDefinitionBinding(ingestGameId);
  }

  if (binding === null) {
    const unanswered = selectAdapterDefinition(projectProbe, {
      kind: 'unanswered',
      rootId: ingestGameId,
      sources: _adapterSources.length,
    });
    // THE FACET IS NOT A DOOR THE USER READS. `error` reaches
    // `/__editor/state` and `vgai status` prints it, but `vgai console` stayed
    // SILENT while the editor showed a vendored game the native default's
    // scene table — measured live, 2026-09-19, by removing the wait above and
    // reading both doors. "Unresolved editor console is remaining work" is the
    // contract every `vgai` verb enforces, so a standing warning that never
    // enters that ledger is not standing. Warning weight, not error: the
    // editor opens and is usable, and what is wrong is the BUILD's lane list.
    if (unanswered.error) editorConsole.warn(unanswered.error, 'ingest');
    return unanswered;
  }

  try {
    const module_ = (await binding.source.importModule(ingestGameId)) as { default?: unknown };
    return selectAdapterDefinition(projectProbe, {
      kind: 'present',
      module: module_,
      path: binding.modulePath,
    });
  } catch (err) {
    return selectAdapterDefinition(projectProbe, {
      kind: 'broken',
      path: binding.modulePath,
      error: describe(err),
    });
  }
}

/**
 * THE WAIT, AND ITS NARRATION — one contribution pass per project open.
 *
 * `refreshProjectToolContributions` resolves only once the NEWEST pass has
 * installed (its own docblock, and the four callers that already treat it that
 * way — `project-tool-discovery.ts`, `components/tool-documents.tsx`,
 * `workspace-state-persistence.ts`, `editor-view-presentation.ts`). It is a
 * known startup cost, not a hung fetch: the workspace restore takes the same
 * await for the same reason and records it at ~9s on a cold `full` scaffold.
 *
 * LATCHED PER PROJECT, and that is correctness rather than thrift. The pass's
 * completion fires `subscribeToolContributions`, whose hook below re-resolves
 * the table when the FINDER set changed — so an unlatched await would start a
 * fresh pass inside every re-resolve it caused, and the two would drive each
 * other forever. One pass per project open; every later resolve reads the
 * settled promise.
 *
 * AND IT SAYS SO ON SCREEN. `components/ProjectLayout.tsx` already holds the
 * boot behind `waitForProjectAdapter()` with a `role="status"` line; while this
 * promise is pending that line NAMES the mechanism instead of reading "Loading
 * project layout…" for nine silent seconds. An action whose success can be
 * invisible must narrate itself.
 */
let _sourceWaitOwner: string | null = null;
let _sourceWait: Promise<void> | null = null;
let _waitNarration: string | null = null;

/** What the adapter load is waiting for, for the boot's own status line —
 *  `null` whenever it is not waiting on anything a user should be told about. */
export function projectAdapterWaitNarration(): string | null {
  return _waitNarration;
}

function waitForContributedAdapterSources(rootId: string): Promise<void> {
  const owner = activeProjectKey();
  if (_sourceWaitOwner !== owner) {
    _sourceWaitOwner = owner;
    _sourceWait = null;
  }
  if (!_sourceWait) {
    _waitNarration =
      `Loading the ingest lane — this project declares the unmodified-game root ` +
      `“${rootId}”, whose adapter declaration a package supplies.`;
    for (const fn of _listeners) fn();
    _sourceWait = refreshProjectToolContributions()
      .catch(() => {})
      .finally(() => {
        _waitNarration = null;
        for (const fn of _listeners) fn();
      });
  }
  return _sourceWait;
}

/**
 * Load the open project's adapter and publish the resolved table.
 *
 * Never throws, for the reason {@link resolveAdapterDefinition} records.
 */
/** The project's contributed finders, registered into this host's registry
 *  before the table resolves (ARCHITECTURE-CORE §The project model). A
 *  module that is not a finder is reported by path, never silently skipped. */
let unregisterContributedFinders: Array<() => void> = [];
let registeredFinderSignature = '';
function registerProjectFinders(): void {
  const modules = contributedFinderModules();
  const signature = modules.map((m) => m.entryPath).join('|');
  if (
    signature === registeredFinderSignature &&
    modules.every((m) => registeredModules.has(m.module as object))
  )
    return;
  for (const off of unregisterContributedFinders) off();
  unregisterContributedFinders = [];
  registeredModules = new WeakSet();
  for (const { entryPath, module } of modules) {
    try {
      unregisterContributedFinders.push(
        registerContributedFinder((module as { finder?: unknown } | null)?.finder, entryPath),
      );
      registeredModules.add(module as object);
    } catch (error) {
      editorConsole.error(error instanceof Error ? error.message : String(error), 'project');
    }
  }
  registeredFinderSignature = signature;
}
let registeredModules = new WeakSet<object>();

// THE KIT'S OWN FINDER, registered once. `prefabsFromStories` is portable
// CSF's — the kit's design-time state (ARCHITECTURE-CORE §The target shape) —
// and it reads the story registry itself rather than taking a `FinderInput`
// field, which is what keeps the finder contract free of one lane's data.
// This file is the ONE sanctioned importer of the engine's finder namespace
// (`@editor/finders`'s header states the rule), so the registration is
// here rather than beside the rest of the lane in `stories/story-lane.ts`.
registerContributedFinder(storyPrefabsFinder, 'packages/editor/src/stories/prefabs-finder.ts');

// A contribution pass that changed the finder set re-resolves the table.
subscribeToolContributions(() => {
  const modules = contributedFinderModules();
  const changed =
    modules.map((m) => m.entryPath).join('|') !== registeredFinderSignature ||
    !modules.every((m) => registeredModules.has(m.module as object));
  if (changed && getCurrentProject()) void refreshProjectAdapter();
});

registerDocumentKindsSupplier(() =>
  _facet && !_facet.documentsPending
    ? [...new Set(_facet.scenes.entries.map((entry) => entry.kind))]
    : null,
);

export function refreshProjectAdapter(): Promise<void> {
  const run = loadAndPublishProjectAdapter(++_refreshEpoch, getCurrentProject());
  _inFlight = run;
  void run.then(() => {
    if (_inFlight === run) _inFlight = null;
  });
  return run;
}

async function loadAndPublishProjectAdapter(
  epoch: number,
  project: ActiveProject | null,
): Promise<void> {
  // Declaration, story, and contribution refreshes can overlap. Only the
  // latest pass for the still-active project may replace its document table.
  const current = (): boolean => epoch === _refreshEpoch && getCurrentProject() === project;
  if (!project) {
    publish(null);
    return;
  }

  let manifest: ResolvedGameManifest;
  try {
    manifest = await fetchGameManifest();
  } catch (error) {
    if (!current()) return;
    publish({
      source: 'native',
      modulePath: null,
      regions: [],
      scenes: { entries: [], default: null },
      observation: [],
      notes: [],
      documentsPending: false,
      error: `adapter: the project's manifest did not load, so no region could be derived — ${describe(error)}`,
    });
    return;
  }

  if (!current()) return;
  const choice = await resolveAdapterDefinition(project, manifest);
  if (!current()) return;
  registerProjectFinders();

  // Gathering finder input reads the project's own entrypoint sources and
  // component index; a table with no finder SELECTIONS has nothing to feed, and
  // an ingest game's sources are not the host's to read at all. Skipping is the
  // honest read of the declaration, not an optimization dressed as one.
  const regionsPreview =
    choice.definition.regions === 'manifest-roots'
      ? regionsFromManifestRoots(declaredRoots(manifest), choice.definition.regionIncludes)
      : [...choice.definition.regions];
  const input =
    (choice.definition.documents.find ?? []).length > 0
      ? await gatherFinderInput(manifest, regionsPreview, choice.definition)
      : NO_FINDER_INPUT;
  if (!current()) return;
  const facet = projectAdapterTableFrom(manifest, choice, input);
  // `native` is the DECLARED DEFAULT standing in for a project that shipped no
  // declaration file, so it is not a declaration this project made — see
  // `projectAdapterDefinition`.
  publish(
    facet,
    choice.definition.observation,
    choice.definition.input,
    choice.source === 'native' ? null : choice.definition,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Does a project-relative path fall under any declared finder's `include`? */
function finderIncludesMatch(path: string): boolean {
  // No parsed declaration in hand (the native default, or a load in flight):
  // the globs are unknown, so a src change is treated as relevant rather than
  // dropped — a stale table costs more than a spare resolve.
  if (!_definition) return true;
  const selections = (_definition.documents.find ?? []) as ReadonlyArray<{
    include?: readonly string[];
  }>;
  for (const selection of selections) {
    for (const glob of selection.include ?? []) {
      if (globToRegExp(glob).test(path)) return true;
    }
  }
  return false;
}

/** `src/models/**\/*.ts` → a RegExp over a project-relative path. `**` spans
 *  directories, `*` stays inside one; everything else is literal. */
function globToRegExp(glob: string): RegExp {
  const DEEP = '__DEEP__';
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, DEEP)
    .replace(/\*/g, '[^/]*')
    .split(DEEP)
    .join('(?:.*/)?');
  return new RegExp(`^${escaped}$`);
}

/**
 * Load the adapter once at editor init and again on every project switch —
 * the same lifecycle shape `project-story-discovery.ts` uses, for the same
 * reason: the adapter is a PROJECT capability, not a side effect of mounting
 * a particular root.
 */
export function startProjectAdapterLoad(): () => void {
  void refreshProjectAdapter();
  const changed = (path: string) => {
    if (
      projectModuleChangeMatches(path, ADAPTER_MODULE_FILENAME) ||
      /(?:^|\/)src\/.+\.[jt]sx?$/.test(path)
    ) {
      void refreshProjectAdapter();
    }
  };
  const stopModules = subscribeProjectModuleChange(changed);
  const stopProject = onProjectChange(() => {
    if (_owner !== activeProjectKey()) publish(null);
    void refreshProjectAdapter();
  });
  // A finder's SOURCE changed on disk — a model module written, a page added.
  // Nothing imports those files, so this is the only signal the table gets.
  const stopSources = connectSourceFileEvents((path) => {
    if (path === '' || finderIncludesMatch(path)) void refreshProjectAdapter();
  });
  return () => {
    stopModules();
    stopProject();
    stopSources();
  };
}
