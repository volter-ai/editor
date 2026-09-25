/**
 * Edit-mode authoring — project open loads `vgai.project.json` and
 * installs a {@link CompositeAuthoringAdapter} over EVERY declared world, so a
 * project's composition is disclosed in edit mode. Unlike play mode,
 * roots are NOT running here: a world whose SURFACE has a registered live
 * adapter factory (`active-adapter.ts`'s `setBaseAuthoringFactory`, filled by
 * that surface's integration) gets a live projection over whatever is mounted
 * into the store; every other declared world gets a read-only
 * {@link BoundaryAuthoringAdapter} describing it from the manifest, upgraded
 * to a live adapter only once its design-time layer actually mounts.
 *
 * THIS MODULE NAMES NO SURFACE. It used to pick the project's `three` root by
 * name and build that one adapter itself; the surface key is what replaced
 * that, so a second integration is a registration rather than a branch here.
 *
 * A project with one world and a project with
 * many roots use the SAME game/world authoring tree. Cardinality may affect
 * presentation density, never hierarchy semantics, routing, or persistence.
 * Manifest-less projects still synthesize the conventional `main` world, so
 * every project reaches this one path.
 */

import { declaredRoots } from '@volter/editor-project/adapter/manifest-interpreter';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { assertEditorServerAnswered } from '@volter/editor-sdk/kit/editor-server-response';
import { sourceMutationAttribution } from '@volter/editor-sdk/kit/editor-session-attribution';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { hierarchyProjectionFromProjectConfig } from '@volter/editor-sdk/kit/hierarchy-projection';
import { getProjectFileHistory, type ProjectFileHistory } from '@volter/editor-sdk/kit/history/project-file-history';
import { getManifestHistoryBackend } from '@volter/editor-sdk/kit/history/project-root-history-backends';
import { fetchRawGameManifest } from '../manifest-project';
import { getCurrentProject } from '../project-manager';
import { handleProjectMutationFailure } from '@volter/editor-sdk/kit/source-conflict';
import {
  activeOverrideIsEditMode,
  baseAuthoringFactory,
  getAuthoringOverride,
  hasAuthoringOverride,
  markEditModeOverride,
  setActiveAuthoring,
} from '@volter/editor-sdk/kit/authoring/active-adapter';
import { beginAuthoringBootstrap } from './bootstrap-state';
import { makeNoAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/no-authoring-adapter';
import { BoundaryAuthoringAdapter, type BoundaryRootInfo } from './boundary-authoring-adapter';
import {
  CompositeAuthoringAdapter,
  type CompositeChild,
  type RootManifestProvider,
} from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';

/**
 * The mounted Scene document's acknowledged edit-mode reinstall owner.
 *
 * A rebuild request can land while Play's dock transition has no Scene
 * document mounted. A one-shot `window` event loses that request forever: Stop
 * restores the already-suspended composite, whose R3F child now points at no
 * scene, and the Hierarchy stays empty even though the Edit viewport still
 * draws. Keeping the request HERE until an owner binds makes the handoff a
 * completion path rather than timing choreography.
 */
/**
 * The `surface` of the ONE placeholder root installed when `vgai.project.json`
 * cannot be parsed. `world-documents.tsx` reads it to keep the Scene document
 * (and with it the edit-mode rebuild OWNER) mounted through that state, so a
 * manifest that becomes valid again can remount without a reload.
 */
export const INVALID_MANIFEST_SURFACE = '(invalid manifest)';

type EditModeRebuildOwner = () => void | Promise<void>;

let editModeRebuildRequested = false;
let editModeRebuildScheduled = false;
let editModeRebuildRunning = false;
let editModeRebuildOwner: EditModeRebuildOwner | null = null;

function drainEditModeRebuild(): void {
  if (
    editModeRebuildScheduled ||
    editModeRebuildRunning ||
    !editModeRebuildRequested ||
    !editModeRebuildOwner
  )
    return;
  editModeRebuildScheduled = true;
  const owner = editModeRebuildOwner;
  queueMicrotask(() => {
    editModeRebuildScheduled = false;
    if (editModeRebuildOwner !== owner) {
      drainEditModeRebuild();
      return;
    }
    // Coalesce requests received before the install starts. Only a request
    // arriving during the actual install earns another pass.
    editModeRebuildRequested = false;
    editModeRebuildRunning = true;
    void Promise.resolve()
      .then(owner)
      .catch((error: unknown) => {
        editorConsole.error(
          `Edit-mode rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
          'authoring',
        );
      })
      .finally(() => {
        editModeRebuildRunning = false;
        drainEditModeRebuild();
      });
  });
}

/** Bind the project session that reinstalls edit composition and its attached stages. */
export function bindEditModeRebuildOwner(owner: EditModeRebuildOwner): () => void {
  editModeRebuildOwner = owner;
  drainEditModeRebuild();
  return () => {
    if (editModeRebuildOwner === owner) editModeRebuildOwner = null;
  };
}

/** Request one acknowledged reinstall after the current transition settles. */
export function queueEditModeRebuild(): void {
  editModeRebuildRequested = true;
  drainEditModeRebuild();
}

/**
 * The display-relevant slice of a manifest world entry this module needs —
 * deliberately LOOSE (a bare `string` `surface`, not the engine's validated
 * `AdapterRoot['surface']` union) so a world that fails schema validation
 * (an unknown surface) can still be represented and surfaced as an error node
 * (#18). Built by the LENIENT parse below (`parseEditModeManifest`), reachable
 * from the production project-open path — NOT gated on strict Zod, which would
 * reject the whole file for one bad world and make every declared world vanish
 * (defect 2).
 */
export interface EditModeRootSpec {
  readonly id: string;
  readonly surface: string;
  readonly adapter?: string | undefined;
  readonly scene?: string | undefined;
  readonly entry?: string | undefined;
  readonly zOrder?: number | undefined;
  readonly pausable?: boolean | undefined;
  /**
   * `world` — the component this root's world IS, in the game's own source.
   * When present it is what EDIT mounts (a design-time document,
   * `r3f-design-session.ts`); `entry` stays what PLAY mounts.
   */
  readonly world?: { readonly entry: string; readonly export?: string | undefined } | undefined;
}

export interface EditModeManifest {
  readonly roots: readonly EditModeRootSpec[];
}

const KNOWN_WORLD_KINDS = new Set(['three', 'canvas', 'dom']);

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * The raw root-level `world` fact, read as defensively as everything else in
 * this module's lenient parse: anything but an object carrying a string
 * `entry` is simply absent, which puts the root back on its `entry` for both
 * modes rather than failing the whole manifest.
 *
 * It is read off the ROOT, not off any adapter: the split it names — "`entry`
 * mounts the running game, this names the thing an author edits" — belongs to
 * a vendored ingest and a translated first-party port alike.
 */
function readDesignWorld(root: Record<string, unknown>): EditModeRootSpec['world'] {
  const world = root['world'];
  if (!world || typeof world !== 'object') return undefined;
  const entry = asString((world as Record<string, unknown>)['entry']);
  if (!entry) return undefined;
  return { entry, export: asString((world as Record<string, unknown>)['export']) };
}

/** Display string for a raw `adapter` field — informational only (the Boundary
 *  inspector's read-only `adapter` property). Read defensively: the raw JSON
 *  may be a string ('default'), a `{ module }`/`{ ingest }` object, or absent. */
function displayAdapter(adapter: unknown): string | undefined {
  if (adapter === undefined || adapter === null) return undefined;
  if (typeof adapter === 'string') return adapter;
  if (typeof adapter === 'object') {
    const obj = adapter as Record<string, unknown>;
    if (typeof obj['module'] === 'string') return `module:${obj['module']}`;
    const ingest = obj['ingest'];
    if (ingest && typeof ingest === 'object') return 'ingest';
  }
  return undefined;
}

/**
 * LENIENT parse (defect 2): read a raw `vgai.project.json` object's `roots[]`
 * defensively into `EditModeRootSpec[]`, so a single bad world (unknown
 * `surface`, missing `scene`+`entry`) becomes an error node (#18) while its VALID
 * siblings still open — never the strict-Zod all-or-nothing of
 * `loadGameManifest`. Returns `null` when there is no usable `roots` array at
 * all (a present-but-unusable manifest, distinct from an ABSENT one) so the
 * caller can fall back to the synthesized single-world floor. A world missing
 * an `id` gets a positional placeholder so it still surfaces rather than
 * vanishing. `surface` is carried through verbatim (even a bogus string) —
 * `resolveRootFailureReason` decides resolvability downstream.
 */
export function parseEditModeManifest(raw: unknown): EditModeManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const worldsRaw = (raw as Record<string, unknown>)['roots'];
  if (worldsRaw === undefined) return null;
  // Zero roots is a real shape (ARCHITECTURE-CORE §Roots): nothing mounts,
  // and the editor derives its chrome from what IS declared.
  if (!Array.isArray(worldsRaw)) return null;
  const roots: EditModeRootSpec[] = worldsRaw.map((entry, i) => {
    const w = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const zOrderRaw = w['zOrder'];
    const pausableRaw = w['pausable'];
    return {
      id: asString(w['id']) ?? `(world ${i})`,
      // Missing/non-string surface is itself unresolvable — carry a sentinel so
      // resolveRootFailureReason names it, rather than crashing on undefined.
      surface:
        (typeof w['adapter'] === 'string' ? asString(w['adapter']) : undefined) ??
        asString(
          w['adapter'] && typeof w['adapter'] === 'object'
            ? (w['adapter'] as Record<string, unknown>)['surface']
            : undefined,
        ) ??
        '(missing adapter surface)',
      adapter: displayAdapter(w['adapter']),
      scene: asString(w['scene']),
      entry: asString(w['entry']),
      zOrder: typeof zOrderRaw === 'number' ? zOrderRaw : undefined,
      pausable: typeof pausableRaw === 'boolean' ? pausableRaw : undefined,
      dev: w['dev'] === true,
      world: readDesignWorld(w),
    };
  });
  return { roots };
}

/**
 * Structural resolvability (#18) — NOT a filesystem check: "missing entry/scene
 * file" here means the world declares NEITHER field (mirrors the manifest
 * schema's own `checkAdapterSceneEntryRules`, `manifest/load.ts`). A live "does
 * the file actually exist on disk" probe is B1 territory (the design-time mount
 * attempt itself degrades to this same error-node floor when a layer throws) —
 * out of scope here, where only the Three world is fetched by this surface.
 */
export function resolveRootFailureReason(world: EditModeRootSpec): string | null {
  if (!KNOWN_WORLD_KINDS.has(world.surface)) {
    return `Unknown world surface "${world.surface}" — expected one of: three, canvas, react.`;
  }
  if (!world.scene && !world.entry) {
    return `World "${world.id}" declares neither \`scene\` nor \`entry\` — nothing to mount.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A4 (D8) — ManifestAuthoring: read-modify-write root composition properties
// ---------------------------------------------------------------------------

/** A raw `vgai.project.json` world entry, read/written defensively — same
 *  looseness as {@link EditModeRootSpec}, but this is the RAW (unknown)
 *  object, never Zod-parsed, so unrelated fields survive a round trip. */
type RawAdapterRoot = Record<string, unknown>;

function findRawRoot(raw: Record<string, unknown>, worldId: string): RawAdapterRoot | undefined {
  const roots = raw['roots'];
  if (!Array.isArray(roots)) return undefined;
  return roots.find(
    (w): w is RawAdapterRoot =>
      !!w && typeof w === 'object' && (w as RawAdapterRoot)['id'] === worldId,
  );
}

/** Materialize D19's inferred world only when a user edits one of its
 * manifest-backed properties. Until then the raw file remains minimal. */
function ensureRawRoot(raw: Record<string, unknown>, worldId: string): RawAdapterRoot | undefined {
  return findRawRoot(raw, worldId);
}

/**
 * ManifestAuthoring (A4, D8) — authored roots' manifest-backed
 * {@link RootManifestProvider}: holds the RAW parsed `vgai.project.json`
 * object (read-modify-write — NEVER round-tripped through the strict Zod
 * schema, so fields this module doesn't know about survive untouched) and
 * writes it back via `POST /__editor/manifest` (the one manifest-write verb,
 * `editor-server.ts`).
 *
 * Two write modes:
 *  - a REAL manifest (`synthesized: false`) writes through on every edit —
 *    the acceptance's "round-trips vgai.project.json on disk" needs no separate
 *    save step.
 *  - a SYNTHESIZED manifest (`synthesized: true`, no `vgai.project.json` on disk
 *    yet) BUFFERS edits in memory only; nothing is written until the
 *    explicit `materialize()` call (the generic inspector's "Create
 *    vgai.project.json" action). D19 makes this branch reachable for a
 *    manifest-less conventional project because its inferred root is always
 *    present.
 *
 * File-watcher landmine: `chokidar` only watches `public/` (`editor-server.ts`),
 * so a manifest write at the PROJECT ROOT emits no SSE — `notifyIngestEdit()`
 * after every successful write is what keeps the hierarchy panel's badges
 * live instead of stale until reopen.
 */
export class ManifestAuthoring implements RootManifestProvider {
  private readonly raw: Record<string, unknown>;
  private synthesizedValue: boolean;
  private readonly store: ShellStore;
  private readonly fileHistory: ProjectFileHistory | null;
  private readonly unsubscribeHistory: (() => void) | null;

  constructor(raw: Record<string, unknown>, synthesized: boolean, store: ShellStore) {
    this.raw = raw;
    this.synthesizedValue = synthesized;
    this.store = store;
    const history = store.projectHistory;
    this.fileHistory = history
      ? getProjectFileHistory(history, getManifestHistoryBackend(), 'project-manifest')
      : null;
    this.unsubscribeHistory = this.fileHistory
      ? this.fileHistory.subscribeAll((path) => {
          if (path !== 'vgai.project.json') return;
          void getManifestHistoryBackend()
            .readBytes(path)
            .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)
            .then((next) => {
              for (const key of Object.keys(this.raw)) delete this.raw[key];
              Object.assign(this.raw, next);
              this.store.notifyIngestEdit();
            })
            .catch(() => {});
        })
      : null;
  }

  getGameName(): string {
    const name = this.raw['name'];
    return typeof name === 'string' ? name : '';
  }

  get synthesized(): boolean {
    return this.synthesizedValue;
  }

  setGameName(name: string): void {
    this.raw['name'] = name;
    this.persist('Rename Game');
  }

  getRootContentSource(worldId: string): string | undefined {
    const world = findRawRoot(this.raw, worldId);
    if (!world) return undefined;
    const scene = world['scene'];
    if (typeof scene === 'string') return `Scene · ${scene}`;
    const entry = world['entry'];
    if (typeof entry === 'string') return `Entry · ${entry}`;
    return 'Adapter-owned runtime content';
  }

  getRootZOrder(worldId: string): number {
    const z = findRawRoot(this.raw, worldId)?.['zOrder'];
    return typeof z === 'number' ? z : 0;
  }

  setRootZOrder(worldId: string, value: number): void {
    const world = ensureRawRoot(this.raw, worldId);
    if (!world) return;
    world['zOrder'] = value;
    this.persist('Change World Order');
  }

  getRootPausable(worldId: string): boolean {
    const p = findRawRoot(this.raw, worldId)?.['pausable'];
    return typeof p === 'boolean' ? p : true;
  }

  setRootPausable(worldId: string, value: boolean): void {
    const world = ensureRawRoot(this.raw, worldId);
    if (!world) return;
    world['pausable'] = value;
    this.persist('Change World Pausing');
  }

  /** The "Create vgai.project.json" action (generic inspector, while
   *  `synthesized`) — materializes the buffered edits to disk. Also safe to
   *  call on a non-synthesized instance (equivalent to an explicit re-save). */
  async materialize(): Promise<boolean> {
    const written = await this.write('Create Game Manifest');
    if (written) this.synthesizedValue = false;
    return written;
  }

  dispose(): void {
    this.unsubscribeHistory?.();
  }

  private persist(label: string): void {
    if (this.synthesized) return; // buffered only — wait for materialize()
    void this.write(label);
  }

  private async write(label: string): Promise<boolean> {
    const content = JSON.stringify(this.raw, null, 2);
    try {
      if (this.fileHistory) {
        await this.fileHistory.write('vgai.project.json', content, {
          label,
          kind: 'manifest',
          contentType: 'application/json',
        });
        this.store.notifyIngestEdit();
        return true;
      }
      // `vgai.project.json` is PROJECT-ROOT-relative, which is why it is
      // written through the session's own manifest route rather than the
      // asset storage backend (that one is rooted at `public/`).
      const write = async () => {
        const res = await fetch('/__editor/manifest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: 'vgai.project.json',
            content,
            ...sourceMutationAttribution(),
          }),
        });
        // `!res.ok` alone read a page fallback as a written manifest.
        assertEditorServerAnswered(res, 'Write vgai.project.json failed');
        if (!res.ok) {
          await handleProjectMutationFailure(res, {
            label: 'Write vgai.project.json',
            attempted: { 'vgai.project.json': content },
            reapply: write,
          });
        }
      };
      await write();
      // No SSE for a project-root write (file-watcher only covers `public/`)
      // — notify directly so the hierarchy panel's badges refresh in place.
      this.store.notifyIngestEdit();
      return true;
    } catch (err) {
      if (this.fileHistory) {
        void getManifestHistoryBackend()
          .readBytes('vgai.project.json')
          .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>)
          .then((next) => {
            for (const key of Object.keys(this.raw)) delete this.raw[key];
            Object.assign(this.raw, next);
            this.store.notifyIngestEdit();
          })
          .catch(() => {});
      }
      editorConsole.error(`Failed to write vgai.project.json: ${err}`, 'project');
      return false;
    }
  }
}

let _manifestAuthoring: ManifestAuthoring | null = null;
/** The message a project with no roots shows, while it is installed. */
let _emptyProjectAuthoring: AuthoringAdapter | null = null;

/**
 * Build the composite over every declared world and install it as the active
 * authoring override for every non-empty composition
 * (D19). Always returns the built composite so callers can inspect it.
 *
 * The project's sole three content root gets the live Three adapter. The
 * manifest rejects a second content root of the same medium, so this function
 * accepts no focus parameter and never arbitrates between competing Three
 * documents.
 *
 * `rawManifestInfo` (A4, D8, optional) — the RAW parsed `vgai.project.json` +
 * whether it was synthesized (never written to disk); when given and the
 * composite has a world, a `ManifestAuthoring` is built over it
 * and passed to `CompositeAuthoringAdapter` as its root-property manifest
 * surface. When omitted, composition properties are read-only.
 */
export function installEditModeAuthoring(
  store: ShellStore,
  manifest: EditModeManifest,
  rawManifestInfo?: { raw: Record<string, unknown>; synthesized: boolean },
): CompositeAuthoringAdapter {
  const children: CompositeChild[] = declaredRoots(manifest).map((world) => {
    // D12 (B4) — install-time zOrder for every child, not just the Boundary's
    // own inspector-displayed value: `childAdapters()`'s pick/paint-order
    // consumers (the layered pick walk, the hierarchy zOrder badge) need it
    // off ANY child, including a live world.
    const zOrder = world.zOrder ?? 0;
    // A SURFACE whose integration registered a live adapter gets it; every
    // other declared world gets the manifest-only Boundary disclosure, to be
    // upgraded when its design-time layer actually mounts. This installer
    // names no surface: `active-adapter.ts`'s factory seam is keyed by the
    // world's own `surface`, and the schema allows at most one root per
    // medium, so there is nothing to choose between. An integration that
    // registers AFTER this ran asks for `queueEditModeRebuild()`, the same
    // door a source change uses.
    const live = baseAuthoringFactory(world.surface);
    if (live) {
      return {
        worldId: world.id,
        kind: world.surface,
        adapter: live(store, world.id),
        zOrder,
      };
    }
    const reason = resolveRootFailureReason(world);
    const info: BoundaryRootInfo = {
      id: world.id,
      kind: world.surface,
      adapter: world.adapter,
      entryOrScenePath: world.scene ?? world.entry,
      zOrder,
      pausable: world.pausable ?? true,
    };
    return {
      worldId: world.id,
      kind: world.surface,
      adapter: new BoundaryAuthoringAdapter(store, info, reason ?? undefined),
      zOrder,
    };
  });

  // D19 — every composition, including one root, uses the same adapter projection.
  // A synthesized manifest uses the same tree; its manifest-backed
  // edits remain buffered until an explicit project change materializes it.
  const manifestAuthoring =
    rawManifestInfo && children.length >= 1
      ? new ManifestAuthoring(rawManifestInfo.raw, rawManifestInfo.synthesized, store)
      : undefined;
  _manifestAuthoring = manifestAuthoring ?? null;
  const projection = hierarchyProjectionFromProjectConfig(getCurrentProject()?.config);
  const composite = new CompositeAuthoringAdapter(children, manifestAuthoring, projection);

  if (children.length >= 1) {
    // Symmetry with `exitEditModeAuthoring`, which already refuses to clear an
    // override it does not own ("never clobbers a DIFFERENT session, e.g.
    // ingest/play, that took over afterward"). Installing owed the same
    // courtesy and did not give it: a FOREIGN session — an ingested game — was
    // silently overwritten here, which handed the shared Hierarchy/Inspector
    // panels back to the project mid-session. The user saw the project's roots
    // where the ingested game's tree belonged, and, for an opaque bundle, a
    // neighbouring world's fields where the editor owed them the honest
    // no-authoring ceiling. Teardown-aware but install-blind is not a safe
    // asymmetry for a single-slot override.
    if (hasAuthoringOverride() && !activeOverrideIsEditMode()) {
      editorConsole.warn(
        'Edit-mode authoring not installed: a foreign session (ingest/play) owns the authoring override.',
        'authoring',
      );
      return composite;
    }
    // Brand BEFORE installing so the store's save guard sees it the instant
    // the override is live (defect 1: the focused first-party child must be
    // able to Ctrl+S/autosave through the store, unlike a foreign override).
    markEditModeOverride(composite);
    setActiveAuthoring(composite);
    store.notifyIngestEdit();
  } else if (!hasAuthoringOverride()) {
    // A project that declares no roots has nothing to author yet, and the panels say
    // what would change that rather than the generic floor's "no authoring adapter".
    _emptyProjectAuthoring = makeNoAuthoringAdapter(
      store,
      'No world yet',
      'Declare a root in vgai.project.json',
    );
    setActiveAuthoring(_emptyProjectAuthoring);
    store.notifyIngestEdit();
  }

  return composite;
}

/** Teardown symmetric to `installEditModeAuthoring` — clears the override
 *  ONLY if it is still exactly the composite this module last installed
 *  (never clobbers a DIFFERENT session, e.g. ingest/play, that took over
 *  afterward). */
export function exitEditModeAuthoring(installed?: CompositeAuthoringAdapter): void {
  if (installed && getAuthoringOverride() === installed) {
    setActiveAuthoring(null);
  }
  if (_emptyProjectAuthoring && getAuthoringOverride() === _emptyProjectAuthoring) {
    setActiveAuthoring(null);
  }
  _emptyProjectAuthoring = null;
  _manifestAuthoring?.dispose();
  _manifestAuthoring = null;
}

/**
 * Project-open wiring: fetch the RAW `vgai.project.json` and install the edit-mode
 * composite via the LENIENT parse (defect 2) — a manifest with one bad world
 * still opens its valid roots, surfacing the bad one as an error node (#18).
 * ONLY a genuinely ABSENT manifest (the route 404s → `fetchRawGameManifest`
 * returns `null`), or one so malformed it has no usable `roots` array,
 * synthesizes a single `{ id: 'main', surface: 'three', scene: <resolved> }`
 * game IN MEMORY (never written to disk), where `<resolved>` mirrors
 * `loadInitialScene`'s OWN resolution order. This is the only call site that
 * should call `installEditModeAuthoring` at ordinary project open. The shell-owned
 * `project-authoring-session.ts` installs it independently of open viewport tabs.
 */
export async function installEditModeAuthoringForProject(
  store: ShellStore,
): Promise<CompositeAuthoringAdapter> {
  const finishBootstrap = beginAuthoringBootstrap(store);
  let manifest: EditModeManifest;
  // The RAW object backing `ManifestAuthoring` (read-modify-write, never
  // round-tripped through Zod). An omitted roots field is a real manifest
  // using D19's convention, not a synthesized/unsaved manifest.
  let rawManifestInfo: { raw: Record<string, unknown>; synthesized: boolean } | undefined;
  try {
    const raw = await fetchRawGameManifest();
    const parsed = raw !== null && parseEditModeManifest(raw);
    if (parsed) {
      manifest = parsed;
      rawManifestInfo = { raw: raw as Record<string, unknown>, synthesized: false };
    } else {
      throw new Error('manifest has no `roots` array (zero roots is fine; a missing field is not)');
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    editorConsole.error(`Failed to load vgai.project.json: ${detail}`, 'project');
    manifest = {
      roots: [{ id: 'manifest', surface: INVALID_MANIFEST_SURFACE, adapter: detail }],
    };
  }
  try {
    return installEditModeAuthoring(store, manifest, rawManifestInfo);
  } finally {
    finishBootstrap();
  }
}
