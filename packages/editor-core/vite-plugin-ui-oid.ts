/**
 * Vite plugin: live OID instrumentation + source-write endpoints (C1/C2/C7/C8).
 *
 * The visual-edit "trick" made live for hand-authored React UI components: at dev
 * time it stamps `data-oid` on every JSX element in files matched by `include` (a
 * predicate, so the rest of the editor build is untouched), builds an OID→source
 * index, and serves:
 *   GET  /__ui-source/index            → the whole OID index
 *   POST /__ui-source/write {oid,prop,value} → surgical inline-style edit to source
 *   POST /__ui-source/struct {oid,op}  → structural source edit (delete)
 * Edits run the SAME `writer.ts` used in unit tests, server-side, then Vite HMR
 * reloads. `data-oid` exists only in transform output, never on disk.
 *
 * `include` widening (T6.2 slice 2): the original
 * scope was ONLY `ui-editor/editable-components/*.tsx` (the visual-edit fixture dir,
 * for `UIAuthoringAdapter`/`SourceEditPanel`). A react WORLD's entry graph is a real
 * project's `.tsx` source — the mounted template project (`packages/editor/template/
 * src/**`) or an externally-scaffolded project directory reached via the SAME
 * dev-server `fs.allow` pipeline `server/dev.ts` already builds for project scripts
 * (T3.3) — so `ReactRootAuthoringAdapter` needs those files instrumented too.
 * `defaultProjectScopeInclude` widens to PROJECT scope, not repo-global: any `.tsx`
 * file outside `node_modules`, EXCEPT the vgai tooling/engine source trees this repo
 * itself is built from (`packages/engine/src`, `packages/create-vgai-project`,
 * `packages/vgai-cli`, `packages/editor-sdk`, and `packages/editor/src` generally —
 * carving OUT `ui-editor/editable-components` so the existing UI-edit-mode surface
 * keeps working unchanged). This does NOT depend on which project happens to be
 * open — `fs.allow` already bounds what Vite can even reach, and this predicate
 * additionally keeps the vgai app's OWN react source un-instrumented.
 *
 * Vendored trees: a vendored GAME's source is STAMPED; every other `/vendor/`
 * tree is not. `data-oid` stamping is what makes a `.tsx` file addressable —
 * and, through `/__ui-source/write`, writable — so this predicate is where the
 * question "may a vendored game be authored?" is actually decided.
 *
 * It used to answer no, for every path under a `/vendor/` segment, under the
 * never-modify-vendored-source rule. The owner's code-or-data ruling
 * superseded that rule (ARCHITECTURE-CORE §Editor "Every edit edits the game's
 * own CODE or DATA", §Rules "there is no unwritable base"): ownership decides
 * the RECORDER, not whether the edit may happen. A user's folder records in
 * their git; a repo-vendored copy records in its own `UPSTREAM.lock`, written
 * in the SAME gesture as the file by `server/vendored-lock-recorder.ts` and
 * routed through {@link writeEditableSource} below. `verify-unaltered.mjs`'s
 * bar was never zero diff — it is zero UNRECORDED diff — so it stays green
 * with an authored edit present, as a patch that reverse-applies to upstream.
 *
 * What stays excluded is everything under `/vendor/` that is a DEPENDENCY
 * rather than a game: `packages/threejs-runtime/vendor/realism-effects` (a vendored
 * library) and the import analyzers' `vendor/` API dumps. See
 * {@link VENDORED_GAME_SRC_RE} for the measured characterization behind that
 * split.
 *
 * D-Y4 (wave 2, slice S3) —
 * the write-back ban becomes IDENTITY-scoped, not just location-scoped: the
 * `/vendor/` regex above only protects the repo's OWN vendored trees, but
 * wave 2 lets an `ingest-react` world live in ANY external, user-owned
 * folder (`vgai edit <folder>`) — an ingested-as-is foreign game there would
 * otherwise be silently stamped/writable, reopening the never-modify-game-
 * source rule by location rather than by identity. `nearestManifestExcludesIngestReact`
 * walks up from a candidate `.tsx`'s own directory to the NEAREST
 * `vgai.project.json`; if that manifest declares an `{ ingest }` react world,
 * the whole manifest folder's subtree is excluded — exact, not coarse:
 * `ingest-react` is single-world by construction (`binding-resolver.ts`'s
 * `MULTI_WORLD_ALLOWED_IDENTITIES` exclusion), so "the manifest folder" IS
 * the foreign game's whole tree, and D-N8 ships no authoring for it anyway —
 * excluding it from stamping loses nothing. Cached per directory (hit AND
 * miss, R-Y3) so a project with no manifest anywhere up the tree pays the
 * walk cost once, ever. Malformed JSON at the manifest path is treated as
 * "no exclusion" (never crash the transform hook over a broken file); a
 * genuine fs error OTHER than "not found" (e.g. a permission error) is not
 * swallowed — it propagates, same honesty bar the rest of this file holds.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Plugin, ViteDevServer } from 'vite';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import { CollaborationConflictError, collaborationSession } from './server/collaboration-session';
import {
  importersFromModuleGraph,
  reportOidSurfaceDiagnostics,
  resolveOidSurface,
} from './server/project-root-surface';
import {
  editorChromeStampBoundary,
  type HmrInvalidationGraph,
  staleModuleWarning,
  stampHmrInvalidation,
} from './server/project-script-hmr';
import {
  findVendoredTarget,
  settleVendoredWrite,
  writeRecordedVendoredFile,
} from './server/vendored-lock-recorder';
import { cssTextForStyleValue } from './src/authoring/css-numeric-style';
import {
  type ComponentPropSpec,
  lineColToOffset,
  type OidEntry,
  OidStore,
  oidAttributeForSurface,
  type R3fComponentContract,
  transformSource,
} from './src/ui-source/oid-transform';
import { planDeleteStory, planRenameStory, planSaveStory } from './src/ui-source/plan-csf-story';
import { planComponentExtraction } from './src/ui-source/plan-extract-component';
import { planComponentFork } from './src/ui-source/plan-fork-component';
import { planCreateClassRule } from './src/ui-source/plan-named-style';
import {
  applyStyleWriteRequest,
  planSourceEdit,
  sourceEditFiles,
} from './src/ui-source/plan-source-edit';
import {
  type EntryDiagnosticSelector,
  fileDiagnosticJoin,
} from './src/ui-source/r3f-diagnostic-index';
import {
  importedR3fContracts,
  r3fAuthoringDiagnostics,
  visibleR3fContracts,
} from './src/ui-source/r3f-project-contracts';
import type { SourceEditRequest } from './src/ui-source/source-edit-request';
import {
  detectUtilityClassSupport,
  isUtilityClassEvidenceFile,
  UTILITY_CLASS_EVIDENCE_FILES,
  type UtilityClassSupport,
} from './src/ui-source/utility-class-support';
import {
  addClassNameToken,
  collectLiteralInlineStyles,
  cssCamelToKebab,
  deleteElements,
  editTextContent,
  findTagEnd,
  getEditableText,
  groupSiblingElements,
  removeClassNameToken,
  removeInlineStyle,
  removePropAttribute,
  surgicalCssEdit,
  surgicalCssEditInMedia,
  writePropChange,
} from './src/ui-source/writer';

// `applyStyleWriteRequest` and `oidAttributeForSurface` live in browser-safe
// modules (`plan-source-edit.ts` / `oid-transform.ts`), because a PAGE reaches
// the same transform; re-exported here so this file stays the stable import
// site for both.
export { applyStyleWriteRequest, oidAttributeForSurface };

const NODE_MODULES_RE = /\/node_modules\//;
const TOOLING_SRC_RE = /\/packages\/(engine\/src|create-vgai-project|vgai-cli|editor-sdk)\//;
const EDITOR_SRC_RE = /\/packages\/editor\/src\//;
const EDITABLE_COMPONENTS_RE = /\/ui-editor\/editable-components\/.*\.tsx$/;
/** Track N, D-N4 item 2 — see the module doc comment's "Vendored-tree exclusion". */
const VENDOR_RE = /\/vendor\//;
/**
 * A vendored GAME's own source (`…/vendor/games/<id>/…`) — the ONE tree under
 * a `/vendor/` segment that is a game rather than a dependency.
 *
 * The distinction is what {@link defaultProjectScopeInclude} needs and the
 * blanket `VENDOR_RE` could not express. Characterized before it was carved,
 * because "what else does this regex protect?" is the question a scope change
 * has to answer: under every `/vendor/` root in this repo, the only `.tsx` at
 * all is `vendor/games/racing-game`'s 35 files. The rest is
 * `packages/threejs-runtime/vendor/realism-effects` (a vendored LIBRARY — built `dist`
 * JS and shaders, a dependency we happen to ship in-tree) and the two import
 * analyzers' `vendor/` API dumps (`packages/gd-analyze`,
 * `packages/rbx-analyze` — JSON only). None of those is a game, none is
 * authorable, and all of them stay excluded here.
 *
 * The Godot lane is ARCHIVED off main — `git fetch origin archive/godot-lane`, tag `archive/godot-lane-2026-09-19`.
 */
const VENDORED_GAME_SRC_RE = /\/vendor\/games\/[^/]+\//;

/** True if a parsed `vgai.project.json` body declares at least one
 *  React root with an `{ ingest }` adapter — the `{ ingest }` shape alone is
 *  the answer, because every ingest-react root is D-N8 no-authoring.
 *  Defensive against
 *  any shape (never trusts the manifest is even an object) — this is a
 *  best-effort identity probe for a WRITE-BACK BAN, not manifest validation
 *  (the real Zod schema/loader is `@vgai/project/manifest/load`, not reachable
 *  from this vite-config-time, dependency-light file by design). */
function manifestDeclaresIngestReactWorld(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const roots = (parsed as { roots?: unknown }).roots;
  if (!Array.isArray(roots)) return false;
  return roots.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const root = entry as { adapter?: unknown };
    const { adapter } = root;
    return (
      !!adapter &&
      typeof adapter === 'object' &&
      (adapter as { surface?: unknown }).surface === 'dom' &&
      'ingest' in adapter
    );
  });
}

/** Cache: absolute directory -> whether ITS OWN ancestor walk (starting AT
 *  this directory) hit an ingest-react-declaring manifest. Cached both ways
 *  (hit and miss, R-Y3) — see the module doc comment's D-Y4 section. */
const manifestAncestorExclusionCache = new Map<string, boolean>();

function nearestManifestExcludesIngestReact(dir: string): boolean {
  const cached = manifestAncestorExclusionCache.get(dir);
  if (cached !== undefined) return cached;

  const manifestPath = resolveManifestPath(dir);
  let raw: string | undefined;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    // ENOENT (no manifest at this level) -> keep walking up. Any OTHER fs
    // error (e.g. EACCES) is a real environment problem, not "no manifest
    // here" — never silently swallowed.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }

  let result: boolean;
  if (raw === undefined) {
    const parent = dirname(dir);
    result = parent === dir ? false : nearestManifestExcludesIngestReact(parent);
  } else {
    try {
      result = manifestDeclaresIngestReactWorld(JSON.parse(raw));
    } catch {
      // Malformed JSON: honest "no exclusion" (stamping stays on) — never
      // crash the transform hook over a broken manifest file.
      result = false;
    }
  }
  manifestAncestorExclusionCache.set(dir, result);
  return result;
}

/**
 * Cap 2 (React visual-edit parity): the scope guard for the `/__ui-source/css` endpoint.
 * A CSS file path (from a stylesheet's `data-vite-dev-id`) is editable iff it is a
 * first-party PROJECT `.css` file — same carve-outs as `defaultProjectScopeInclude`
 * (never node_modules, vendored trees, the vgai tooling/engine source, or the editor's
 * own source). Paths are normalized to forward slashes so a Windows dev-id matches. This
 * is the CSS analogue of the `.tsx` stamping scope: an out-of-scope path must not become
 * writable through a client-supplied `file`.
 */
export function isEditableCssFile(id: string): boolean {
  const clean = (id.split('?')[0] ?? id).replace(/\\/g, '/');
  if (!clean.endsWith('.css')) return false;
  if (NODE_MODULES_RE.test(clean)) return false;
  if (VENDOR_RE.test(clean)) return false;
  if (TOOLING_SRC_RE.test(clean)) return false;
  if (EDITOR_SRC_RE.test(clean)) return false;
  return true;
}

/** D-1 (Phase D, spec27 §2): sha256 hex digest — the checksum guard the
 *  `/__ui-source/restore` endpoint (below) uses to refuse a stale write. Only
 *  ever computed SERVER-SIDE: the client (`ReactRootAuthoringAdapter`) never
 *  hashes anything itself, it only echoes back a digest this server already
 *  handed it in a prior `writeStruct`/`restoreSource` response. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Stable, registry-safe identity for a source file. Project files retain their
 * human-readable relative path. An explicitly allowed file outside the Vite
 * root gets a non-leaking synthetic path instead of an invalid `../…` key. */
function sourceResourcePath(file: string, projectRoot: string): string {
  const path = relative(projectRoot, file).replace(/\\/g, '/');
  if (path && path !== '..' && !path.startsWith('../') && !isAbsolute(path)) return path;
  const identity = createHash('sha256').update(file).digest('hex').slice(0, 16);
  return `.vgai/external-source/${identity}/${basename(file)}`;
}

/**
 * Utility-class support is a property of the PACKAGE that owns the edited file,
 * not of the editor session — an ingested game's HUD lives in the game's own
 * tree, with its own `package.json` and its own build, and it is THAT build
 * that would have to compile a `bg-[#059669]`. So the probe walks up from the
 * file to the nearest enclosing `package.json` (falling back to the served
 * project root) and reads the evidence `utility-class-support.ts` names.
 *
 * Cached per resolved package directory, like `propResolvers` above: the walk
 * and the reads happen once per package per dev-server lifetime.
 */
const utilityClassSupport = new Map<string, UtilityClassSupport>();

/** The nearest ancestor of `file` holding a `package.json`, else `fallback`. */
function owningPackageDir(file: string, fallback: string): string {
  let dir = dirname(isAbsolute(file) ? file : resolve(fallback, file));
  for (let depth = 0; depth < 24; depth++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fallback;
}

/** Evidence files under `dir` — the named configs plus a bounded css/html scan. */
function utilityClassEvidence(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const read = (absolute: string, relativePath: string): void => {
    try {
      files.set(relativePath, readFileSync(absolute, 'utf8'));
    } catch {
      // Unreadable evidence is simply absent evidence — never a crash, and
      // never an upgrade to "supported".
    }
  };
  for (const name of UTILITY_CLASS_EVIDENCE_FILES) {
    const absolute = join(dir, name);
    if (existsSync(absolute)) read(absolute, name);
  }
  // Bounded walk for the css/html entry markers (`@tailwind`, a CDN script):
  // shallow, skipping the directories that never hold a project's own entry.
  const skip = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.vgai', '.claude']);
  let budget = 80;
  const walk = (current: string, prefix: string, depth: number): void => {
    if (depth > 3 || budget <= 0) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget <= 0) return;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(join(current, entry.name), relativePath, depth + 1);
        continue;
      }
      if (files.has(relativePath) || !isUtilityClassEvidenceFile(relativePath)) continue;
      budget--;
      read(join(current, entry.name), relativePath);
    }
  };
  walk(dir, '', 0);
  return files;
}

function utilityClassSupportFor(projectRoot: string, file: string): UtilityClassSupport {
  const dir = owningPackageDir(file, projectRoot);
  const cached = utilityClassSupport.get(dir);
  if (cached) return cached;
  const support = detectUtilityClassSupport(utilityClassEvidence(dir));
  utilityClassSupport.set(dir, support);
  return support;
}

/** Declared props are a property of the (file, tag) PAIR, not of each
 *  occurrence — six `<Enemy>` tags resolve the component once per index read. */
function declaredPropsOf(
  propsByTag: ReadonlyMap<string, ComponentPropSpec[]>,
  file: string,
  tag: string,
): ComponentPropSpec[] | undefined {
  const key = `${file}::${tag}`;
  return propsByTag.get(key);
}

/** Everything one project file contributes to an index read, resolved from its
 *  CURRENT bytes exactly once per read. */
interface IndexFileAnalysis {
  /** Component contracts visible in this module — `null` for a file this
   *  server does not stamp as R3F (or could not read). */
  readonly contracts: ReadonlyMap<string, R3fComponentContract> | null;
  /** H5 — which of this file's authorability diagnostics pertain to a given
   *  entry of this file. Inert for a non-R3F/unreadable file. */
  readonly selectDiagnostics: EntryDiagnosticSelector;
}

const INERT_FILE_ANALYSIS: IndexFileAnalysis = {
  contracts: null,
  selectDiagnostics: () => undefined,
};

/** The index grouped by file, each bucket keyed by oid — the shape
 *  `fileDiagnosticJoin` needs so an entry's `parentOid` resolves. */
function indexEntriesByFile(store: OidStore): Map<string, Map<string, OidEntry>> {
  const byFile = new Map<string, Map<string, OidEntry>>();
  for (const [oid, entry] of store.index) {
    const bucket = byFile.get(entry.file);
    if (bucket) bucket.set(oid, entry);
    else byFile.set(entry.file, new Map([[oid, entry]]));
  }
  return byFile;
}

/**
 * Read one file's current bytes and derive everything an index read wants from
 * it. Unreadable (deleted/renamed since it was transformed) or not stamped as
 * R3F ⇒ the inert analysis: its entries ship exactly as recorded, which is a
 * degradation, never a failure of the whole index read.
 *
 * COST, and why it went DOWN rather than up when H5 landed: this runs at most
 * once per file per index read (the caller memoizes), whereas the previous
 * shape re-read and re-surface-resolved a file for EVERY capitalized-tag entry
 * whose surface turned out not to be `userData-oid`. H5 adds one
 * `r3fAuthoringDiagnostics` pass per R3F file — the same order of work as the
 * `visibleR3fContracts` pass beside it, and it early-returns for any file
 * without an R3F reconciler import.
 */
function analyzeIndexFile(
  file: string,
  fileEntries: ReadonlyMap<string, OidEntry>,
  importersOf: ReturnType<typeof importersFromModuleGraph>,
): IndexFileAnalysis {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return INERT_FILE_ANALYSIS;
  }
  // The SAME decision the transform hook stamped with (task #45) — not a
  // second derivation that could disagree with it.
  if (resolveOidSurface(file, source, importersOf).attribute !== 'userData-oid') {
    return INERT_FILE_ANALYSIS;
  }
  return {
    contracts: visibleR3fContracts(source, file),
    // The surface check above already established this file renders through
    // the R3F reconciler, which is a stronger answer than the source-text
    // sniff the analyzer falls back on — and the one a project that imports
    // its prop shape from a shared module can actually pass.
    selectDiagnostics: fileDiagnosticJoin(
      fileEntries,
      r3fAuthoringDiagnostics(source, file, { knownThreeSurface: true }),
    ),
  };
}

/**
 * One recorded entry plus everything the current bytes add to it: its
 * component's authoring contract, its declared props, and (H5) the
 * authorability diagnostics that pertain to it. Returns the entry ITSELF when
 * there is nothing to add, so an unenriched index read allocates nothing.
 *
 * Note that the diagnostic lookup runs for EVERY entry, including a lowercase
 * host tag: R3F002/3/5 are ABOUT a component definition, and a definition's
 * root is usually an ordinary `<group>`/`<mesh>` — that entry is precisely the
 * one an instance row reaches through its boundary object's own `userData.oid`.
 */
function enrichIndexEntry(
  entry: OidEntry,
  analysis: IndexFileAnalysis,
  propsByTag: ReadonlyMap<string, ComponentPropSpec[]>,
): OidEntry {
  const diagnostics = analysis.selectDiagnostics(entry);
  const custom = analysis.contracts !== null && /^[A-Z]/.test(entry.tag);
  const contract = custom ? analysis.contracts?.get(entry.tag) : undefined;
  const props = custom ? declaredPropsOf(propsByTag, entry.file, entry.tag) : undefined;
  // `props !== undefined` means the resolver ANSWERED for this tag — an empty
  // answer included. The flag is what lets the inspector's fallback tell a
  // pending cold resolver from a genuine absence (see OidEntry.propsResolved).
  const propsResolved = props !== undefined;
  if (!contract && !props?.length && !diagnostics && !propsResolved) return entry;
  return {
    ...entry,
    ...(contract ? { r3fAuthoring: contract } : {}),
    ...(props?.length ? { props } : {}),
    ...(propsResolved ? { propsResolved: true as const } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function snapshotRawOidIndex(store: OidStore): Record<string, unknown> {
  const current: Record<string, unknown> = {};
  for (const [oid, entry] of store.index) current[oid] = entry;
  return current;
}

function buildEnrichedOidIndex(
  store: OidStore,
  devServer?: ViteDevServer,
  propsByTag: ReadonlyMap<string, ComponentPropSpec[]> = new Map(),
): Record<string, unknown> {
  const importersOf = importersFromModuleGraph(devServer?.moduleGraph);
  const entriesByFile = indexEntriesByFile(store);

  const analyses = new Map<string, IndexFileAnalysis>();
  const analysisFor = (file: string): IndexFileAnalysis => {
    const cached = analyses.get(file);
    if (cached) return cached;
    const analysis = analyzeIndexFile(file, entriesByFile.get(file) ?? new Map(), importersOf);
    analyses.set(file, analysis);
    return analysis;
  };

  const current: Record<string, unknown> = {};
  for (const [oid, entry] of store.index) {
    current[oid] = enrichIndexEntry(entry, analysisFor(entry.file), propsByTag);
  }
  return current;
}

/**
 * Props/tag/diagnostic enrich is the measured 2.6 s cold cost (repeat 391 ms)
 * of first design attach: `ComponentPropResolver` builds a `ts.Program`. The Scene
 * can render without it — oids, file/line, and tags are already on the raw
 * stamp. Blocking GET /__ui-source/index on enrich froze the Vite thread
 * (and every module load) for those seconds. Serve enrichment only for an
 * unchanged source index; otherwise serve current stamps while it refreshes.
 */
let lastEnrichedIndex: {
  root: string | undefined;
  sourceIndex: ReadonlyMap<string, OidEntry>;
  index: Record<string, unknown>;
} | null = null;
let enrichQueued = false;
let propWorker: Worker | null = null;
let propRequestId = 0;
const pendingPropRequests = new Map<
  number,
  {
    resolve: (props: ReadonlyMap<string, ComponentPropSpec[]>) => void;
    reject: (error: Error) => void;
  }
>();

function componentPropWorkerUrl(): URL {
  // Source dev runs this plugin from `packages/editor/`; the published server
  // runs its bundle from `dist-server/`, beside the separately-built worker.
  const source = new URL('./server/component-prop-worker.ts', import.meta.url);
  return existsSync(fileURLToPath(source))
    ? source
    : new URL('./component-prop-worker.mjs', import.meta.url);
}

function rejectPendingPropRequests(error: Error): void {
  for (const pending of pendingPropRequests.values()) pending.reject(error);
  pendingPropRequests.clear();
}

function declaredPropWorker(): Worker {
  if (propWorker) return propWorker;
  const worker = new Worker(componentPropWorkerUrl(), { name: 'vgai-component-props' });
  worker.on(
    'message',
    (message: { id?: unknown; props?: Record<string, ComponentPropSpec[]>; error?: unknown }) => {
      if (typeof message.id !== 'number') return;
      const pending = pendingPropRequests.get(message.id);
      if (!pending) return;
      pendingPropRequests.delete(message.id);
      if (typeof message.error === 'string') {
        pending.reject(new Error(message.error));
        return;
      }
      pending.resolve(new Map(Object.entries(message.props ?? {})));
    },
  );
  worker.on('error', (error: unknown) => {
    if (propWorker === worker) propWorker = null;
    rejectPendingPropRequests(error instanceof Error ? error : new Error(String(error)));
  });
  worker.on('exit', (code) => {
    if (propWorker === worker) propWorker = null;
    if (code !== 0) {
      rejectPendingPropRequests(
        new Error(`Declared-prop worker exited before answering (status ${code}).`),
      );
    }
  });
  propWorker = worker;
  return worker;
}

function propRequestsFor(store: OidStore): Array<{ key: string; file: string; tag: string }> {
  const requests = new Map<string, { key: string; file: string; tag: string }>();
  for (const entry of store.index.values()) {
    if (!/^[A-Z]/.test(entry.tag)) continue;
    const key = `${entry.file}::${entry.tag}`;
    requests.set(key, { key, file: entry.file, tag: entry.tag });
  }
  return [...requests.values()];
}

function resolveDeclaredProps(
  projectRoot: string | undefined,
  requests: Array<{ key: string; file: string; tag: string; definition?: true }>,
): Promise<ReadonlyMap<string, ComponentPropSpec[]>> {
  if (!projectRoot || requests.length === 0) {
    return new Promise((resolveRequest) => setImmediate(() => resolveRequest(new Map())));
  }
  const id = ++propRequestId;
  return new Promise((resolveRequest, rejectRequest) => {
    pendingPropRequests.set(id, { resolve: resolveRequest, reject: rejectRequest });
    declaredPropWorker().postMessage({ id, projectRoot, requests });
  });
}

function scheduleOidIndexEnrich(
  store: OidStore,
  projectRoot?: string,
  devServer?: ViteDevServer,
): void {
  if (enrichQueued) return;
  enrichQueued = true;
  const sourceIndex = new Map(store.index);
  const requests = propRequestsFor(store);
  void resolveDeclaredProps(projectRoot, requests)
    .then((propsByTag) => {
      lastEnrichedIndex = {
        root: projectRoot,
        sourceIndex,
        index: buildEnrichedOidIndex(store, devServer, propsByTag),
      };
    })
    .catch((error) => {
      // A failed semantic resolver never removes source authoring. Contracts
      // and diagnostics still enrich on the server thread; declared props
      // degrade to the attributes physically present in source.
      process.stderr.write(
        `[ui-oid] Declared-prop analysis unavailable; using source attributes: ${String(error)}\n`,
      );
      lastEnrichedIndex = {
        root: projectRoot,
        sourceIndex,
        index: buildEnrichedOidIndex(store, devServer),
      };
    })
    .finally(() => {
      enrichQueued = false;
    });
}

function currentOidIndex(
  store: OidStore,
  projectRoot?: string,
  devServer?: ViteDevServer,
): Record<string, unknown> {
  scheduleOidIndexEnrich(store, projectRoot, devServer);
  const cached = lastEnrichedIndex;
  // Transforms replace entries even when an OID stays stable. Old locations
  // must never be paired with the newly edited source while enrichment runs.
  if (
    cached &&
    cached.root === projectRoot &&
    cached.sourceIndex.size === store.index.size &&
    [...store.index].every(([oid, entry]) => cached.sourceIndex.get(oid) === entry)
  ) {
    return cached.index;
  }
  return snapshotRawOidIndex(store);
}

/** Test-only: wait for the in-flight background enrich, if any. */
export function __flushOidIndexEnrichForTest(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      if (!enrichQueued) {
        resolve();
        return;
      }
      setImmediate(finish);
    };
    setImmediate(finish);
  });
}

/** Test-only reset. */
export function __resetOidIndexEnrichForTest(): void {
  lastEnrichedIndex = null;
  enrichQueued = false;
  if (propWorker) {
    void propWorker.terminate();
    propWorker = null;
  }
  rejectPendingPropRequests(new Error('Declared-prop worker reset.'));
}

/** Test-only: whether the last GET returned without waiting for enrich. */
export function __oidIndexEnrichStateForTest(): { queued: boolean; hasEnriched: boolean } {
  return { queued: enrichQueued, hasEnriched: lastEnrichedIndex !== null };
}

/**
 * THE write point for every `/__ui-source/*` handler — and the reason a
 * vendored game's source can be stamped without reopening silent drift.
 *
 * A source write lands in one of two recorders, decided by WHERE the file is,
 * never by what the handler was doing:
 *
 *  - inside a repo-vendored game → `writeRecordedVendoredFile`, which moves the
 *    file AND its `UPSTREAM.lock` entry as ONE journalled operation, so
 *    `verify-unaltered.mjs` is green with the edit present (the edit becomes a
 *    recorded patch that reverse-applies to upstream). Undo needs no special
 *    case: it comes back through here with the previous bytes, the lock
 *    reconciles from the bytes alone, and the edit that restores upstream's own
 *    content deletes the patch entry again.
 *  - anywhere else → the plain `writeFileSync` this file always did, because a
 *    user's own project records in the user's own git.
 *
 * Centralised deliberately. Nine handlers in this file write source; routing
 * per-handler would mean nine chances to add a tenth that forgets, and a
 * forgotten one is not a visible bug — it is a vendored tree that quietly
 * stops matching its lock.
 */
/**
 * This repo's root — `<root>/packages/editor/vite-plugin-ui-oid.ts` is where
 * this file lives, and `<root>/vendor/games/` is where the locks live. It is a
 * property of the CHECKOUT, not of the opened project, so deriving it from the
 * module's own URL is the right default for every real caller and none of them
 * passes anything.
 *
 * It is a DEFAULT rather than a constant so the estate the recorder judges
 * against is injectable — the same shape `server/creation-site-write.ts` has
 * carried all along, where `engineRoot` is an ordinary parameter of
 * `ingestSourceOwnership`/`resolveIngestSourceFile`. Without it, "does a
 * `/__ui-source/*` write reach the lock recorder?" could only be asked against
 * THIS checkout's real `vendor/games/`, i.e. by editing a shipped game — so the
 * recorder's contract was provable for the ingest routes and unprovable for
 * this family. `test/ui-source-vendored-recorder.test.ts` is the case that
 * needed it.
 */
const DEFAULT_ENGINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * THE MODULE GRAPH THE WRITE POINT ABOVE MUST INVALIDATE — and why the editor
 * cannot leave that to the file watcher.
 *
 * The editor writes the bytes itself. Making its OWN write visible to the next
 * mount is therefore its own job, and routing that through the filesystem
 * watcher makes it a property of the environment instead: Vite serves a module
 * from `ModuleGraph.transformResult` until something invalidates it, and the
 * only thing that ever did was the watcher's change event.
 *
 * Measured 2026-08-16 on `examples/third-person`, with a one-variable A/B: the
 * root config's `server.watch.ignored` carries a `.claude` glob (it is there to
 * stop one agent worktree's churn reloading every OTHER live session's tab), and
 * with it in place
 * a `position` prop written through `/__ui-source/prop` landed on disk, and the
 * dev server then served a BYTE-IDENTICAL pre-edit transform of `src/world.tsx`
 * for the rest of the session — to a cold `GET`, and to a `?t=`-busted one. A
 * page reload therefore re-derived the world from the PRE-EDIT bytes and the
 * authored value read back as the old one, with an honest-looking ack and a
 * real diff on disk behind it. Dropping that one pattern made the very next
 * fetch fresh. The write path may not depend on an ignore list it does not own:
 * an unwatched project is a silently-discarded edit.
 *
 * Graph-only, deliberately: this stamps invalidation exactly the way
 * `handleProjectScriptHotUpdate` does when it swallows Vite's HMR, and sends no
 * client event. Hot-update behaviour on a watched project is unchanged
 * (its watcher event still arrives and still drives the custom events), and
 * stamping twice is idempotent — what is NOT recoverable is the mount that
 * re-derives from bytes the server has already replaced.
 */
let writtenSourceInvalidationGraph: HmrInvalidationGraph | undefined;
let writtenSourceStampBoundary: ((moduleFile: string) => boolean) | undefined;

/** Called once by `configureServer` — the plugin has exactly one dev server.
 *  `stampBoundary` bounds the stamp's importer propagation at editor-chrome
 *  modules: a written PROJECT module must re-evaluate on its next mount, and
 *  the editor modules that imported it must not be re-instanced mid-session.
 *  This route shipped UNBOUNDED while its creation-site sibling was bounded,
 *  and that one copy was the whole failure (measured on bubbo-bubbo,
 *  2026-08-21): every creation-site write re-stamped 33 editor modules
 *  through the isolation-document import edge, the next lazy import fetched
 *  a second `play-mode.ts?t=…` instance, and every ▶ after a write refused
 *  with "Game container not mounted". See `editorChromeStampBoundary`. */
function bindWrittenSourceInvalidation(
  graph: HmrInvalidationGraph,
  stampBoundary?: (moduleFile: string) => boolean,
): void {
  writtenSourceInvalidationGraph = graph;
  writtenSourceStampBoundary = stampBoundary;
}

function invalidateWrittenSource(file: string): void {
  if (!writtenSourceInvalidationGraph) return;
  const outcome = stampHmrInvalidation(
    writtenSourceInvalidationGraph,
    file,
    undefined,
    writtenSourceStampBoundary,
  );
  const warning = staleModuleWarning(file, outcome);
  if (warning) console.warn(warning);
}

/**
 * The path `findVendoredTarget` must judge, symlinks resolved.
 *
 * `realpathSync` is what makes the vendored check survive a symlinked checkout
 * (`vendored-lock-recorder.test.ts` pins that), but it REQUIRES the path to
 * exist — and one write path legitimately names a file that does not exist yet:
 * `/__ui-source/fork-component` writes the fork's brand-new file (it refuses
 * outright when that path already exists). So resolve the containing DIRECTORY
 * and re-join the basename when the file itself is not there; a new file's
 * vendored-ness is decided by the folder it lands in.
 */
function realpathForWrite(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    try {
      return join(realpathSync(dirname(file)), basename(file));
    } catch {
      return file;
    }
  }
}

/**
 * THE read point for every `/__ui-source/*` handler — the twin of
 * {@link writeEditableSource} below, and centralised for the same reason it is.
 *
 * A crashed vendored write leaves a roll-forward journal, and the next request
 * that touches the game is what completes it (`settleVendoredWrite`). A read
 * that skips that step plans against bytes the crashed write has already
 * superseded — and MEASURED, that is neither caught downstream nor loud:
 *
 *  - Through the prepare/apply pair: `/__ui-source/read` returned the
 *    pre-settle bytes with a 200, `/__ui-source/prepare` planned from them, and
 *    `/__ui-source/apply` ACCEPTED, because the `ifMatchSha` gate compares the
 *    client's stale hash against the same stale bytes and so agrees with
 *    itself. A pending journal does not change the file's bytes — that is the
 *    whole point of rolling forward — so the 409 is unreachable in exactly the
 *    window it exists for.
 *  - Through any single-request write handler (`/prop` is the ordinary
 *    inspector "revert this prop" gesture): read → plan → `writeEditableSource`,
 *    which settles and THEN writes the stale-based edit over it. Strictly
 *    worse, because there is no `ifMatchSha` in the loop at all.
 *
 * Either way the journalled write vanishes, the lock comes out internally
 * consistent, and `verify-unaltered.mjs` stays green over a lost update.
 *
 * So the settle is not a line each handler remembers to add — it is welded to
 * the read, the way recorder routing is welded to the write below. Nine
 * handlers read source here; the first fix of this defect added the settle to
 * two of them and read as complete, which is the argument for a single point
 * rather than a convention.
 */
function readSettledSource(file: string, engineRoot: string): string {
  settlePendingVendoredWrite(file, engineRoot);
  return readFileSync(file, 'utf8');
}

/**
 * Roll a crashed vendored write forward, and — when it moved bytes — stamp the
 * invalidation that a write of our own would have stamped.
 *
 * Settling REPLACES the file's content, so leaving the module graph alone
 * would serve the pre-settle module and leave the oid index on pre-settle
 * offsets: the same silently-discarded-edit class {@link
 * writtenSourceInvalidationGraph} exists to close, arriving through the settle
 * instead of through the write.
 */
function settlePendingVendoredWrite(file: string, engineRoot: string): void {
  const vendored = findVendoredTarget(realpathForWrite(file), engineRoot);
  if (vendored && settleVendoredWrite(vendored)) invalidateWrittenSource(file);
}

function writeEditableSource(
  file: string,
  code: string,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): void {
  const target = findVendoredTarget(realpathForWrite(file), engineRoot);
  if (!target) {
    writeFileSync(file, code);
    invalidateWrittenSource(file);
    return;
  }
  settleVendoredWrite(target);
  const result = writeRecordedVendoredFile(target, Buffer.from(code, 'utf8'), 'editor source edit');
  if (!result.ok) {
    // REFUSE LOUDLY rather than fall through to an unrecorded write: a lock
    // that already disagrees with its folder is not a base anything may record
    // onto, and writing anyway is precisely the silent drift the lock exists
    // to make impossible.
    throw new Error(
      `vendored source write refused for ${target.id}/${target.rel}: ${result.error}`,
    );
  }
  invalidateWrittenSource(file);
}

/** Default `include` predicate (see the module doc comment above for the reasoning). */
export function defaultProjectScopeInclude(id: string): boolean {
  const clean = (id.split('?')[0] ?? id).replace(/\\/g, '/');
  if (!clean.endsWith('.tsx')) return false;
  if (NODE_MODULES_RE.test(clean)) return false;
  // A vendored GAME's source IS stamped; every other `/vendor/` tree is not.
  // The old blanket exclusion was written under the never-modify-vendored-
  // source rule, which the owner's code-or-data ruling superseded
  // (ARCHITECTURE-CORE §Editor "Every edit edits the game's own CODE or DATA",
  // §Rules "there is no unwritable base"): ownership no longer decides WHETHER
  // an edit may be written, only WHO RECORDS it. For a repo-vendored copy the
  // recorder is its own `UPSTREAM.lock`, written in the same gesture as the
  // file (`server/vendored-lock-recorder.ts`), so the zero-UNRECORDED-diff bar
  // holds WITH the edit present rather than by forbidding the edit. Stamping is
  // what makes the game's own TSX literals addressable by the gizmo and the
  // inspector; refusing it here is what used to make a vendored game
  // permanently unauthorable.
  if (VENDOR_RE.test(clean) && !VENDORED_GAME_SRC_RE.test(clean)) return false;
  if (TOOLING_SRC_RE.test(clean)) return false;
  if (EDITOR_SRC_RE.test(clean) && !EDITABLE_COMPONENTS_RE.test(clean)) return false;
  if (nearestManifestExcludesIngestReact(dirname(clean))) return false;
  return true;
}

function resolveEditableSourceFile(id: string, projectRoot: string): string | null {
  const clean = (id.split('?')[0] ?? id).replace(/\\/g, '/');
  const candidate = isAbsolute(clean) ? clean : resolve(projectRoot, clean);
  if (defaultProjectScopeInclude(candidate) || isEditableCssFile(candidate)) return candidate;

  // Whole-file transactions also serve project-owned model source. This is
  // deliberately narrower than a general project-file API: TypeScript below
  // this project's src/ tree, never vendored or an ingest-react identity.
  const projectPath = relative(projectRoot, candidate).replace(/\\/g, '/');
  if (
    projectPath.startsWith('src/') &&
    (projectPath.endsWith('.ts') || projectPath.endsWith('.tsx')) &&
    !VENDOR_RE.test(candidate) &&
    !nearestManifestExcludesIngestReact(dirname(candidate))
  ) {
    return candidate;
  }
  return null;
}

function isCanonicalProjectSourcePath(projectRoot: string, file: string): boolean {
  const absolute = isAbsolute(file) ? resolve(file) : resolve(projectRoot, file);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const next = dirname(ancestor);
    if (next === ancestor) return false;
    ancestor = next;
  }
  try {
    const root = realpathSync(projectRoot);
    const candidate = realpathSync(ancestor);
    return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  } catch {
    return false;
  }
}

/** The JSON response a source-endpoint handler produces (status defaults to 200). */
export interface HandlerResult {
  status?: number;
  body: unknown;
}

function preparedSource(
  file: string,
  prevSource: string,
  newSource: string,
  result: Record<string, unknown>,
  projectRoot: string,
): HandlerResult {
  const changed = prevSource !== newSource && result['changed'] !== false;
  return {
    body: {
      changed,
      file,
      resourcePath: sourceResourcePath(file, projectRoot),
      ...(changed
        ? {
            prevSource,
            newSource,
            prevSha: sha256(prevSource),
            newSha: sha256(newSource),
          }
        : {}),
      result: { ...result, changed, file },
    },
  };
}

/**
 * Pure source edit preparation: computes exact bytes and hashes, never writes.
 *
 * The edit itself is planned by the tier-agnostic `planSourceEdit`
 * (`src/ui-source/plan-source-edit.ts`) — this handler only supplies what is
 * genuinely server-side: the `node:fs` reads, the css scope guard, sha256, and
 * the project-relative resource path. The hosted browser backend supplies its
 * own equivalents around the SAME planner, which is what keeps the two tiers
 * from drifting into different edit semantics.
 */
export function handlePrepare(
  store: OidStore,
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const request = body as unknown as SourceEditRequest;
  if (request.kind === 'css' && (!request.file || !isEditableCssFile(request.file))) {
    return {
      status: 403,
      body: { changed: false, result: { error: 'css file out of editable scope' } },
    };
  }
  const resolveOid = (oid: string) => store.index.get(oid);
  const sources = new Map<string, string>();
  const files = sourceEditFiles(request, resolveOid);
  for (const file of files) {
    sources.set(file, readSettledSource(file, engineRoot));
  }
  // The class-vs-inline gate is a question about the EDITED FILE's own project,
  // so it is answered here (the tier that has `node:fs`) and handed to the pure
  // planner — never inferred from the element's shape. Only a style request can
  // route to a class, so nothing else pays for the probe.
  const support =
    request.kind === 'style' && files[0]
      ? utilityClassSupportFor(projectRoot, files[0])
      : undefined;
  const plan = planSourceEdit(request, sources, resolveOid, support);
  if (plan.file === null) return { body: { changed: false, result: plan.result } };
  return preparedSource(plan.file, plan.prevSource, plan.newSource, plan.result, projectRoot);
}

export function handleSourceRead(
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const file = body['file'];
  const resolved = typeof file === 'string' ? resolveEditableSourceFile(file, projectRoot) : null;
  if (!resolved) {
    return { status: 403, body: { error: 'file out of editable scope' } };
  }
  const source = readSettledSource(resolved, engineRoot);
  return {
    body: {
      source,
      sha: sha256(source),
      resourcePath: sourceResourcePath(resolved, projectRoot),
    },
  };
}

export function handleSourceApply(
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const restored = handleRestore(body, projectRoot, engineRoot);
  const value = restored.body as { restored: boolean; sha?: string; error?: string };
  return {
    ...(restored.status ? { status: restored.status } : {}),
    body: { applied: value.restored, sha: value.sha, error: value.error },
  };
}

/** POST `/__ui-source/write` — surgical inline-style/className edit (F5 routing).
 *  D-A3 (wave 13): a `value: null` body is the REMOVAL sentinel — routed via
 *  `applyStyleWriteRequest` to `removeInlineStyle` (append-aware undo); `appended`
 *  is forwarded so the client's undo can remove vs. restore. */
function handleWrite(
  store: OidStore,
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  // A numeric `value` stays a NUMBER all the way to the writer — the JSX then
  // carries a bare `12` (React px-ifies it) instead of `'12'`, which React
  // passes through and the CSSOM rejects, keeping the previous value.
  const { oid, prop, value } = body as {
    oid: string;
    prop: string;
    value: string | number | null;
  };
  const entry = store.index.get(oid);
  if (!entry) return { body: { changed: false, error: 'unknown oid' } };
  const src = readSettledSource(entry.file, engineRoot);
  const off = lineColToOffset(src, entry.line, entry.col);
  const result = applyStyleWriteRequest(
    src,
    off,
    prop,
    value,
    utilityClassSupportFor(projectRoot, entry.file),
  );
  if (result.changed) writeEditableSource(entry.file, result.code, engineRoot);
  return {
    body: {
      changed: result.changed,
      dynamic: result.dynamic,
      route: result.route,
      appended: result.appended,
      ...(result.tokenRef ? { tokenRef: result.tokenRef } : {}),
      ...(result.error ? { error: result.error } : {}),
      file: entry.file,
    },
  };
}

/**
 * POST `/__ui-source/css` — Cap 2 surgical CSS-FILE edit. The client (adapter) resolves
 * the target rule from live matched-rule data (`inspect.ts` getMatchedCssRules) and sends
 * the rule's source file + selector; this edits that file in place. The file path is
 * client-supplied, so it MUST pass the first-party CSS scope guard before any read/write
 * — an out-of-scope path is rejected, not touched. A selector not present in source is
 * generated CSS (`generated: true`); the client re-routes to class/inline.
 *
 * Exported (unlike its sibling handlers above, which close over the live
 * `OidStore`) so it's directly unit-testable without a dev server — it's pure
 * body-in/HandlerResult-out plus real fs I/O on a client-supplied, scope-
 * guarded path, no store/session state involved.
 */
export function handleCss(
  body: Record<string, unknown>,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { file, selector, prop, value, media } = body as {
    file: string;
    selector: string;
    prop: string;
    value: string;
    media?: string;
  };
  if (!file || !isEditableCssFile(file)) {
    return { body: { changed: false, error: 'css file out of editable scope' } };
  }
  const cleanFile = file.split('?')[0] ?? file;
  const src = readSettledSource(cleanFile, engineRoot);
  // `media` scopes the edit to a breakpoint: the rule inside `@media <media>`
  // (block and rule both created on demand — a breakpoint's first edit IS
  // what mints it). The base-path `generated` probe does not apply: the
  // media write can always land.
  const edited =
    typeof media === 'string' && media.trim().length > 0
      ? surgicalCssEditInMedia(src, media, selector, prop, value)
      : surgicalCssEdit(src, selector, prop, value);
  if (edited === null) return { body: { changed: false, generated: true, file: cleanFile } };
  if (edited !== src) writeEditableSource(cleanFile, edited, engineRoot);
  return { body: { changed: edited !== src, file: cleanFile } };
}

/**
 * POST `/__ui-source/text` — Cap 3 text-content edit. Replaces a leaf element's pure-text
 * body in place (guarded: refuses a body with `{expression}` or child elements). Returns
 * `prevText` (the editable text before the edit) for the client's undo inverse.
 */
function handleText(
  store: OidStore,
  body: Record<string, unknown>,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { oid, text } = body as { oid: string; text: string };
  const entry = store.index.get(oid);
  if (!entry) return { body: { changed: false, error: 'unknown oid' } };
  const src = readSettledSource(entry.file, engineRoot);
  const off = lineColToOffset(src, entry.line, entry.col);
  const prevText = getEditableText(src, off);
  const result = editTextContent(src, off, text);
  if (result.changed) writeEditableSource(entry.file, result.code, engineRoot);
  return {
    body: { changed: result.changed, dynamic: result.dynamic, prevText, file: entry.file },
  };
}

/**
 * POST `/__ui-source/prop` — Cap 4 component prop / attribute edit at the call site. The
 * client sends the CALL-SITE oid (resolved from the fiber, `inspect.ts` getCallSiteOid)
 * whose index entry points at the `<Component …>` tag. Guards a dynamic (non-literal) prop
 * and the event-handler / structural props.
 */
function handleProp(
  store: OidStore,
  body: Record<string, unknown>,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { oid, prop, value } = body as { oid: string; prop: string; value: string | null };
  const entry = store.index.get(oid);
  if (!entry) return { body: { changed: false, error: 'unknown oid' } };
  const src = readSettledSource(entry.file, engineRoot);
  const off = lineColToOffset(src, entry.line, entry.col);
  // `value: null` is the REMOVAL sentinel, the same shape `/__ui-source/write`
  // uses for `removeStyle` (D-A3). Removing a prop attribute is how the
  // inspector reverts a prop to the component's declared default.
  if (value === null) {
    const removed = removePropAttribute(src, off, prop);
    if (removed.changed) writeEditableSource(entry.file, removed.code, engineRoot);
    return { body: { changed: removed.changed, dynamic: removed.dynamic, file: entry.file } };
  }
  const result = writePropChange(src, off, prop, value, {
    addIfMissing: body['addIfMissing'] === true,
    // R2: opt-in scalar→tuple shape
    // upgrade — see writePropChange's own doc comment. Absent/false on every
    // pre-existing caller, so react-dom prop writes are byte-identical.
    allowShapeUpgrade: body['allowShapeUpgrade'] === true,
  });
  if (result.changed) writeEditableSource(entry.file, result.code, engineRoot);
  return { body: { changed: result.changed, dynamic: result.dynamic, file: entry.file } };
}

/**
 * POST `/__ui-source/struct` — Cap 5 structural source edits. Ops: `delete`, `duplicate`,
 * `wrap` (+wrapperTag), `unwrap`, `create` (insert a `<tag/>` child of `oid`),
 * `create-sibling` (insert the `snippet` immediately AFTER `oid` — how a top-level element
 * is added to a world whose root JSX is an OID-less fragment), `reorder`
 * (move `oid` before `targetOid`, or to the end of `parentOid`), and `reparent` (move `oid`
 * into `parentOid`). An insert may carry `ensureImport` when its snippet names a component.
 * Multi-oid ops resolve every oid to an offset in the SAME file (a
 * cross-file move is refused) — OID-resolved, immune to index races.
 *
 * D-1 (Phase D, spec27 §2 "known limitation to schedule, not hide"): when the op actually
 * changes the file, the response also carries the WHOLE file's `prevSource`/`newSource`
 * (before/after this write) and their `prevSha`/`newSha` (sha256 digests, computed here —
 * the client never hashes anything itself). `ReactRootAuthoringAdapter.structOp` uses
 * these to push a checksum-guarded whole-file-snapshot undo/redo entry — the sound inverse
 * for a structural op (a per-OID inverse is unsound: OIDs are content-signature keyed,
 * reorder/delete reassign occurrence indices, and delete has no inverse payload). Exported
 * (like `handleCss`) so it's directly unit-testable without a running dev server.
 *
 * The op switch itself lives in `planSourceEdit` and NOWHERE else. It used to be written
 * out a second time here, and the two copies drifted the moment `reparent` grew rules of
 * its own (R1–R4): one caller routed through the planner and got them, this
 * one did not. Everything that remains below is what is genuinely server-side — the
 * `node:fs` read/write, sha256, and the response envelope.
 */
export function handleStruct(
  store: OidStore,
  body: Record<string, unknown>,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { oid, op } = body as { oid?: unknown; op?: unknown };
  if (typeof oid !== 'string' || typeof op !== 'string') {
    return { body: { changed: false, error: 'struct requests need an oid and an op' } };
  }
  const request = { ...body, kind: 'struct', oid, op } as unknown as SourceEditRequest;
  const resolveOid = (id: string): OidEntry | undefined => store.index.get(id);
  const sources = new Map<string, string>();
  for (const file of sourceEditFiles(request, resolveOid)) {
    sources.set(file, readSettledSource(file, engineRoot));
  }
  const plan = planSourceEdit(request, sources, resolveOid);
  if (plan.file === null) return { body: { changed: false, ...plan.result } };
  const { changed: _planned, ...detail } = plan.result;
  if (!plan.changed) return { body: { changed: false, file: plan.file, ...detail } };
  writeEditableSource(plan.file, plan.newSource, engineRoot);
  return {
    body: {
      changed: true,
      file: plan.file,
      ...detail,
      prevSource: plan.prevSource,
      newSource: plan.newSource,
      prevSha: sha256(plan.prevSource),
      newSha: sha256(plan.newSource),
    },
  };
}

/**
 * POST `/__ui-source/struct-many` — one source snapshot and one history boundary
 * for structural operations involving several OIDs. `group` wraps source siblings
 * beneath an ordinary R3F group. `delete` retains the delete-order-residual fix
 * (50f90a6d): it resolves EVERY `oid` in `oids` to an offset against ONE shared
 * `readFileSync` snapshot, then applies them via `deleteElements` (`writer.ts`) —
 * highest offset first, so
 * no still-queued target's offset is ever shifted out from under it, REGARDLESS of
 * what order the caller listed `oids` in. This is what makes the batch immune to the
 * delete-order-residual: `deleteSelection` (`editor-hotkeys.ts`)'s per-id fallback
 * loop derives its delete order from the CALLER's own hierarchy walk (DOM order for
 * `ReactRootAuthoringAdapter` — see `walkOidTree`), which can diverge from true
 * SOURCE order when a component's live DOM child order is a runtime permutation of
 * its JSX (e.g. `{[...els].reverse()}`); this endpoint never consults that walk order
 * at all, only each oid's own registered `{line, col}` and ONE shared file read, so
 * caller order is irrelevant to correctness. Explicitly NOT a re-scan/re-transform of
 * the file per oid (see `deleteElements`'s doc comment for why that would be UNSOUND
 * here — a live re-transform mid-batch reassigns occurrence-index-based oid identity
 * out from under the very oids this batch is still trying to resolve). One write, one
 * `prevSource`/`newSource` pair — one undo entry for the whole batch (a bonus over
 * the N-entry per-id fallback, not the point of this fix, but free from reusing
 * `pushStructUndo`'s existing whole-file-snapshot inverse unchanged).
 */
export function handleStructMany(
  store: OidStore,
  body: Record<string, unknown>,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { oids, op, wrapperTag } = body as {
    oids?: unknown;
    op?: string;
    wrapperTag?: string;
  };
  if (op !== 'delete' && op !== 'group') {
    return { body: { changed: false, error: `unsupported batch op: ${op}` } };
  }
  if (!Array.isArray(oids) || oids.length === 0) {
    return { body: { changed: false, error: 'oids must be a non-empty array' } };
  }
  const uniqueOids = [...new Set(oids as string[])];
  const entries = uniqueOids.map((oid) => ({ oid, entry: store.index.get(oid) }));
  const missing = entries.find((e) => !e.entry);
  if (missing) return { body: { changed: false, error: `unknown oid: ${missing.oid}` } };
  const file = entries[0]!.entry!.file;
  const crossFile = entries.find((e) => e.entry!.file !== file);
  if (crossFile) return { body: { changed: false, error: 'cannot batch-edit across files' } };

  const src = readSettledSource(file, engineRoot); // ONE snapshot every offset below resolves against
  const offsets = entries.map((e) => lineColToOffset(src, e.entry!.line, e.entry!.col));
  const result =
    op === 'group' ? groupSiblingElements(src, offsets, wrapperTag) : deleteElements(src, offsets);
  if (!result.changed) return { body: { changed: false, file } };
  const prevSource = src;
  const newSource = result.code;
  writeEditableSource(file, newSource, engineRoot);
  return {
    body: {
      changed: true,
      file,
      prevSource,
      newSource,
      prevSha: sha256(prevSource),
      newSha: sha256(newSource),
    },
  };
}

/**
 * POST `/__ui-source/fork-component` — H7 "Fork Component…" (wave 6).
 *
 * The ONE thing this endpoint does that the client cannot: create a file. Every
 * other `/__ui-source/*` write targets a file the OID index already knows, and
 * the whole-file `apply`/`restore` pair is checksum-guarded against a file that
 * exists — there is no create path through the client write seam at all. So the
 * new module is written HERE with `node:fs`, and the CALLSITE edit is handed
 * back to the client unwritten, so it can go through project history like every
 * other source write (the fork is undoable at the callsite; the new file, being
 * outside history, survives an undo as an inert module nothing imports).
 *
 * ORDER AND ATOMICITY. `planComponentFork` computes BOTH edits from both files'
 * current bytes before anything is written, and refuses — with a sentence — on
 * every failure it can see (definition not found, tag no longer matches, name
 * or file collision). Only then is the new file written, and only if nothing is
 * at that path already: `existsSync` is checked here as well as in the planner,
 * because the planner reads a directory LISTING the caller supplied and this is
 * the last moment before the write.
 */
export function handleForkComponent(
  store: OidStore,
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { oid, definitionOid, name } = body as {
    oid?: string;
    definitionOid?: string;
    name?: string;
  };
  const callsite = typeof oid === 'string' ? store.index.get(oid) : undefined;
  if (!callsite) return { body: { ok: false, error: 'unknown oid' } };
  const definition = typeof definitionOid === 'string' ? store.index.get(definitionOid) : undefined;
  if (!definition) return { body: { ok: false, error: 'unknown definition oid' } };

  const definitionDir = dirname(definition.file);
  let siblingFiles: string[] = [];
  try {
    siblingFiles = readdirSync(definitionDir);
  } catch {
    // An unreadable directory is not a reason to refuse: the collision checks
    // below (and `existsSync`) still hold, they are just less informed.
  }
  const planned = planComponentFork({
    callsiteFile: callsite.file,
    callsiteSource: readSettledSource(callsite.file, engineRoot),
    callsiteLine: callsite.line,
    callsiteCol: callsite.col,
    definitionFile: definition.file,
    definitionSource: readSettledSource(definition.file, engineRoot),
    tag: callsite.tag,
    nameSeed: typeof name === 'string' ? name : undefined,
    siblingFiles,
  });
  if (!planned.ok) return { body: { ok: false, error: planned.reason } };

  const plan = planned.plan;
  const newFile = join(definitionDir, plan.newFileName);
  if (existsSync(newFile)) {
    return {
      body: {
        ok: false,
        error: `${sourceResourcePath(newFile, projectRoot)} already exists — fork will not overwrite a file.`,
      },
    };
  }
  writeEditableSource(newFile, plan.newFileSource, engineRoot);
  return {
    body: {
      ok: true,
      newName: plan.newName,
      tag: plan.tag,
      newFile,
      newResourcePath: sourceResourcePath(newFile, projectRoot),
      importSpecifier: plan.importSpecifier,
      label: plan.historyLabel,
      callsiteFile: plan.callsiteFile,
      callsiteResourcePath: sourceResourcePath(plan.callsiteFile, projectRoot),
      callsitePrevSource: plan.callsitePrevSource,
      callsiteNewSource: plan.callsiteNewSource,
      callsitePrevSha: sha256(plan.callsitePrevSource),
      callsiteNewSha: sha256(plan.callsiteNewSource),
    },
  };
}

/**
 * POST `/__ui-source/extract-component` — P1 "Extract Component…".
 *
 * The fork route's sibling, and the SECOND file-creating seam on this
 * middleware (the header on `/__ui-source/fork-component` records why file
 * creation lives server-side at all). `planComponentExtraction` computes the
 * two new modules (component + portable CSF story under `src/prefabs/`) and
 * the callsite edit from current bytes before anything is written, refusing
 * with a sentence on every failure it can see (subtree gone, lexical capture,
 * module-local reference, name/file collision). Only then are the new files
 * written — `existsSync`-guarded here as well as in the planner, because the
 * planner reads a directory LISTING and this is the last moment before the
 * write — and the CALLSITE edit is handed back unwritten so the client pushes
 * it through project history: undo restores the callsite and leaves the two
 * new files behind as an inert module + story nothing imports.
 */
export function handleExtractComponent(
  store: OidStore,
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { oid, name } = body as { oid?: string; name?: string };
  const entry = typeof oid === 'string' ? store.index.get(oid) : undefined;
  if (!entry) return { body: { ok: false, error: 'unknown oid' } };

  const prefabDir = join(projectRoot, 'src', 'prefabs');
  let siblingFiles: string[] = [];
  try {
    siblingFiles = readdirSync(prefabDir);
  } catch {
    // No prefab folder yet — the write below creates it.
  }
  const planned = planComponentExtraction({
    sourceFile: entry.file,
    source: readSettledSource(entry.file, engineRoot),
    line: entry.line,
    col: entry.col,
    nameSeed: typeof name === 'string' ? name : undefined,
    prefabDir,
    siblingFiles,
  });
  if (!planned.ok) return { body: { ok: false, error: planned.reason } };

  const plan = planned.plan;
  for (const file of [plan.componentFile, plan.storyFile]) {
    if (existsSync(file)) {
      return {
        body: {
          ok: false,
          error: `${sourceResourcePath(file, projectRoot)} already exists — extraction will not overwrite a file.`,
        },
      };
    }
  }
  mkdirSync(prefabDir, { recursive: true });
  writeEditableSource(plan.componentFile, plan.componentSource, engineRoot);
  writeEditableSource(plan.storyFile, plan.storySource, engineRoot);
  return {
    body: {
      ok: true,
      newName: plan.newName,
      tag: plan.tag,
      componentFile: plan.componentFile,
      componentResourcePath: sourceResourcePath(plan.componentFile, projectRoot),
      storyFile: plan.storyFile,
      storyResourcePath: sourceResourcePath(plan.storyFile, projectRoot),
      importSpecifier: plan.importSpecifier,
      label: plan.historyLabel,
      callsiteFile: plan.callsiteFile,
      callsiteResourcePath: sourceResourcePath(plan.callsiteFile, projectRoot),
      callsitePrevSource: plan.callsitePrevSource,
      callsiteNewSource: plan.callsiteNewSource,
      callsitePrevSha: sha256(plan.callsitePrevSource),
      callsiteNewSha: sha256(plan.callsiteNewSource),
    },
  };
}

/**
 * POST `/__ui-source/csf-story` — the CSF write half (design ledger:
 * stories composed and framed everywhere, written nowhere): save an arg
 * set as a new story export, rename one, or delete one. The grammar and
 * every refusal live in the pure planner (`ui-source/plan-csf-story.ts`);
 * this handler is scope-guard + read + plan + write.
 */
export function handleCsfStory(
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { op, file, name, newName, args } = body as {
    op?: 'save' | 'rename' | 'delete';
    file?: string;
    name?: string;
    newName?: string;
    args?: Record<string, unknown>;
  };
  if (typeof file !== 'string' || typeof name !== 'string' || !op) {
    return { status: 400, body: { changed: false, error: 'csf-story requires {op, file, name}.' } };
  }
  const resolved = resolveEditableSourceFile(file, projectRoot);
  if (!resolved) {
    return { status: 403, body: { changed: false, error: 'file out of editable scope' } };
  }
  const source = readSettledSource(resolved, engineRoot);
  const plan =
    op === 'save'
      ? planSaveStory(source, name, args ?? {})
      : op === 'rename'
        ? planRenameStory(source, name, typeof newName === 'string' ? newName : '')
        : planDeleteStory(source, name);
  if (!plan.ok) return { body: { changed: false, error: plan.reason } };
  writeEditableSource(resolved, plan.nextSource, engineRoot);
  return { body: { changed: true, summary: plan.summary, file } };
}

/** A JSX literal style value as CSS TEXT (`'8px'` → `8px`, `8` → `8px` per the
 *  react px-ifying rule in `css-numeric-style.ts`), or null for a literal that
 *  has no CSS reading (a boolean) — such a member stays inline, unmoved. */
function cssValueFromJsxLiteral(name: string, raw: string): string | null {
  const t = raw.trim();
  if (/^['"`]/.test(t)) return t.slice(1, -1);
  const num = Number(t);
  if (Number.isFinite(num)) return cssTextForStyleValue(name, num);
  return null;
}

/**
 * POST `/__ui-source/named-style` — the design ledger's NAMED STYLES order
 * (Webflow prior art: a reusable style is a CSS CLASS in the project's own
 * stylesheet). Three ops on one door:
 *
 * - `create` — mint `.className` in the given first-party stylesheet
 *   (`file`, guarded by {@link isEditableCssFile}), MOVING the element's
 *   literal inline declarations into it (dynamic members stay inline — they
 *   are not the writer's to move), and adding the class token to the
 *   element. Both files are planned before either is written, so a refusal
 *   (duplicate class, dynamic className) leaves nothing half-done.
 * - `apply` / `remove` — add/remove the bare class token on the element.
 *
 * Every refusal names its gate; a `className={expr}` is never rewritten.
 */
export function handleNamedStyle(
  store: OidStore,
  body: Record<string, unknown>,
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { op, oid, className, file } = body as {
    op?: 'create' | 'apply' | 'remove';
    oid?: string;
    className?: string;
    file?: string;
  };
  if (
    (op !== 'create' && op !== 'apply' && op !== 'remove') ||
    typeof oid !== 'string' ||
    typeof className !== 'string'
  ) {
    return {
      status: 400,
      body: { changed: false, error: 'named-style requires {op, oid, className}.' },
    };
  }
  const entry = store.index.get(oid);
  if (!entry) return { body: { changed: false, error: 'unknown oid' } };
  const src = readSettledSource(entry.file, engineRoot);
  const off = lineColToOffset(src, entry.line, entry.col);

  if (op === 'apply' || op === 'remove') {
    const r = (op === 'apply' ? addClassNameToken : removeClassNameToken)(src, off, className);
    if (r.dynamic) {
      return {
        body: {
          changed: false,
          error: "the element's className is a dynamic expression — refusing to rewrite it.",
        },
      };
    }
    if (r.changed) writeEditableSource(entry.file, r.code, engineRoot);
    return { body: { changed: r.changed, file: entry.file } };
  }

  // No stylesheet named ⇒ MINT one beside the element's own module (and make
  // the module import it — an unimported stylesheet never paints, and a bare
  // `import './styles.css'` is exactly the ecosystem-native form Vite and the
  // game's own build both honor). No example or fresh scaffold ships project
  // CSS today, so without this the whole feature would open on a refusal.
  const cleanCss =
    typeof file === 'string'
      ? (file.split('?')[0] ?? file)
      : join(dirname(entry.file), 'styles.css');
  if (!isEditableCssFile(cleanCss)) {
    return { body: { changed: false, error: 'css file out of editable scope' } };
  }
  const cssSrc = existsSync(cleanCss) ? readSettledSource(cleanCss, engineRoot) : '';
  const decls: { prop: string; value: string }[] = [];
  const moved: string[] = [];
  for (const member of collectLiteralInlineStyles(src, off)) {
    const value = cssValueFromJsxLiteral(member.name, member.raw);
    if (value === null) continue;
    decls.push({ prop: cssCamelToKebab(member.name), value });
    moved.push(member.name);
  }
  const plan = planCreateClassRule(cssSrc, className, decls);
  if (!plan.ok) return { body: { changed: false, error: plan.reason } };
  let code = src;
  for (const name of moved) code = removeInlineStyle(code, off, name).code;
  const applied = addClassNameToken(code, off, className);
  if (applied.dynamic) {
    return {
      body: {
        changed: false,
        error: "the element's className is a dynamic expression — refusing to rewrite it.",
      },
    };
  }
  let elementCode = applied.code;
  // Bulk removal leaves each moved member's line as bare indentation — collapse
  // the blank lines inside the opening tag so the authored source stays clean.
  const tagEnd = findTagEnd(elementCode, off);
  if (tagEnd > 0) {
    const seg = elementCode.slice(off, tagEnd);
    const collapsed = seg.replace(/\n(?:[ \t]*\n)+/g, '\n');
    elementCode = elementCode.slice(0, off) + collapsed + elementCode.slice(off + seg.length);
  }
  const specifier = `./${basename(cleanCss)}`;
  if (
    dirname(cleanCss) === dirname(entry.file) &&
    !new RegExp(`import\\s+['"]\\.?/?${basename(cleanCss).replace('.', '\\.')}['"]`).test(
      elementCode,
    )
  ) {
    elementCode = `import '${specifier}';\n${elementCode}`;
  }
  writeEditableSource(cleanCss, plan.nextSource, engineRoot);
  if (elementCode !== src) writeEditableSource(entry.file, elementCode, engineRoot);
  return {
    body: { changed: true, file: cleanCss, elementFile: entry.file, moved, summary: plan.summary },
  };
}

/**
 * POST `/__ui-source/create-file` — create a NEW project source file. The
 * pasteboard "materialize" action's door (extraction and fork keep their own
 * purpose-built routes); creation is the ONLY thing it does — edits go
 * through the surgical writers, and an existing file is a refusal, never an
 * overwrite. Same editable-scope guard as every other source route.
 */
export function handleCreateSourceFile(
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { file, source } = body as { file?: string; source?: string };
  if (typeof file !== 'string' || typeof source !== 'string') {
    return {
      status: 400,
      body: { created: false, error: 'create-file requires {file, source}.' },
    };
  }
  const resolved = resolveEditableSourceFile(file, projectRoot);
  if (!resolved) {
    return { status: 403, body: { created: false, error: 'file out of editable scope' } };
  }
  if (existsSync(resolved)) {
    return {
      body: {
        created: false,
        error: `${sourceResourcePath(resolved, projectRoot)} already exists — create-file never overwrites.`,
      },
    };
  }
  mkdirSync(dirname(resolved), { recursive: true });
  writeEditableSource(resolved, source, engineRoot);
  return { body: { created: true, file } };
}

/**
 * POST `/__ui-source/restore` — D-1 (Phase D, spec27 §2): the checksum-guarded whole-file
 * restore that makes Cap-5 structural edits (delete/duplicate/wrap/unwrap/reorder/reparent/
 * create) undoable. `ReactRootAuthoringAdapter.structOp` captures `{prevSource, newSource,
 * prevSha, newSha}` from a struct write's response (`handleStruct`, above) and, on undo/
 * redo, posts the INVERSE `{file, source, ifMatchSha}` here: undo sends `source: prevSource,
 * ifMatchSha: newSha` (the hash of what SHOULD be on disk right now); redo sends the mirror
 * image. Refuses — WITHOUT writing — when the file's CURRENT sha256 doesn't match
 * `ifMatchSha` (an out-of-band change since: a hand-edit, a since-diverged reload, …);
 * `restored: false` is the caller's cue to surface a loud refusal instead of silently
 * corrupting the file. Scope-guarded the same way `handleCss`'s client-supplied `file` is
 * (`defaultProjectScopeInclude` — restore targets the SAME `.tsx` project files struct ops
 * do). Exported (like `handleCss`) so it's directly unit-testable without a dev server.
 */
export function handleRestore(
  body: Record<string, unknown>,
  projectRoot = process.cwd(),
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): HandlerResult {
  const { file, source, ifMatchSha } = body as {
    file: string;
    source: string;
    ifMatchSha: string;
  };
  const resolved = file ? resolveEditableSourceFile(file, projectRoot) : null;
  if (!resolved) {
    return { status: 403, body: { restored: false, error: 'file out of editable scope' } };
  }
  let current: string;
  try {
    current = readSettledSource(resolved, engineRoot);
  } catch (e) {
    return { status: 404, body: { restored: false, error: String(e) } };
  }
  const currentSha = sha256(current);
  if (currentSha !== ifMatchSha) {
    return {
      status: 409,
      body: {
        restored: false,
        error: 'stale: the file changed since this undo/redo entry was recorded',
        sha: currentSha,
      },
    };
  }
  writeEditableSource(resolved, source, engineRoot);
  return { body: { restored: true, sha: sha256(source) } };
}

/**
 * This plugin's Vite name — the ONE spelling, so a host can ask its own
 * resolved plugin list whether it serves `/__ui-source/*` instead of declaring
 * the same fact a second time. See {@link servesUiSourceRoutes}.
 */
export const UI_OID_PLUGIN_NAME = 'vgai-ui-oid';

/**
 * Does this Vite instance serve the `/__ui-source/*` read/write endpoints?
 *
 * Read off the RESOLVED plugin list, never declared: an editor host that boots
 * a Vite instance registers `uiOidPlugin()` or it does not, and that
 * registration is the only fact there is. A host with no Vite at all has no
 * plugins and correctly answers `false`.
 *
 * This is what `/__editor/project`'s `sourceWrite` reports and what the editor
 * client's `tier-source-write-backend.ts` reads to decide whether authoring
 * edits are recorded to the game's own source or are honestly live-only — the
 * axis that used to be (wrongly) `import.meta.env.DEV`.
 */
export function servesUiSourceRoutes(plugins: readonly { name: string }[]): boolean {
  return plugins.some((plugin) => plugin.name === UI_OID_PLUGIN_NAME);
}

export function uiOidPlugin(
  include: RegExp | ((id: string) => boolean) = defaultProjectScopeInclude,
  projectRoot?: string | (() => string | undefined),
  /** The vendored ESTATE this plugin's writes are recorded against — see
   *  {@link DEFAULT_ENGINE_ROOT}. A parameter, not a config option: no shipped
   *  caller passes it and none should, it exists so a test can stand up a
   *  synthetic `vendor/games/` instead of editing a real one. */
  engineRoot: string = DEFAULT_ENGINE_ROOT,
): Plugin {
  const test = typeof include === 'function' ? include : (id: string) => include.test(id);
  const store = new OidStore();
  // Captured by `configureServer` below, read by `transform` — the dev
  // server's own `ModuleGraph` is what lets `declaredSurfaceForProjectFileViaGraph`
  // reach a root entry's surface through a NON-entry file's importer chain
  // (a child component with no direct fiber/world3d-react import of its
  // own). `undefined` in a build/SSR context without `configureServer`
  // (e.g. a one-off transform in a test) degrades to the direct-entry-only
  // answer, same as before this existed.
  let devServer: ViteDevServer | undefined;
  return {
    name: UI_OID_PLUGIN_NAME,
    enforce: 'pre',
    transform(code, id) {
      // A VIRTUAL MODULE IS NOT A FILE, and everything below this line treats
      // `clean` as one — `resolveOidSurface` walks up from it looking for the
      // owning `vgai.project.json`, and `transformSource` records it as the
      // stamped file's path. Vite's convention is that a `\0`-prefixed id was
      // synthesized by a plugin and has no path behind it, so a path plugin
      // skips it.
      //
      // The `test(clean)` below happens to reject today's virtual ids for the
      // wrong reason (they carry no extension); a synthesized id may legally
      // end in `.tsx`, and then the extension test passes and a NUL byte
      // reaches `readFileSync`. That exact throw was measured one layer down
      // on 2026-09-21 — see `importerFiles` in `server/project-root-surface.ts`
      // for the failure and what it looked like from the editor.
      if (id.startsWith('\0')) return null;
      const clean = id.split('?')[0] ?? id;
      if (!test(clean)) return null;
      // W1 — R3F-dialect files get ` userData-oid` (fiber pierces it into
      // `object.userData.oid`); react-dom files keep ` data-oid` unchanged.
      // WHICH REGION owns this exact file decides: a declaration the project
      // made (an `include` glob or a `mounts` entry in `vgai.adapter.ts`), the
      // manifest root whose `entry` it is, or reach from one through the live
      // import graph. Nothing is inferred from the file's own bytes; a file
      // nothing places gets the documented `data-oid` default, said out loud.
      // The project root is threaded because an INGEST root's sources live
      // outside its manifest's directory (see `manifestOwning`), so the walk
      // alone cannot find the project that declares them.
      const decision = resolveOidSurface(
        clean,
        code,
        importersFromModuleGraph(devServer?.moduleGraph),
        typeof projectRoot === 'function' ? projectRoot() : projectRoot,
      );
      const { code: out, entries } = transformSource(code, clean, store, {
        attribute: decision.attribute,
        canvasComponents: decision.surface === 'canvas',
        importedR3fContracts: importedR3fContracts(code, clean),
      });
      // Task #45: a wrong stamp must not be silent. Reported only when this
      // file actually GOT stamps — a module with no JSX has no selection to
      // break, so its (irrelevant) attribute is not worth a terminal line.
      if (entries.length > 0) reportOidSurfaceDiagnostics(decision);
      return { code: out, map: null };
    },
    configureServer(server) {
      devServer = server;
      const activeProjectRoot = (): string =>
        (typeof projectRoot === 'function' ? projectRoot() : projectRoot) ?? server.config.root;
      // The editor's own writes invalidate the modules they replace — see
      // `writtenSourceInvalidationGraph` for the measured stale-remount this
      // closes, and why the watcher is not allowed to be the only path. The
      // stamp is BOUNDED at editor chrome (see `bindWrittenSourceInvalidation`).
      bindWrittenSourceInvalidation(
        server.moduleGraph,
        editorChromeStampBoundary(engineRoot, activeProjectRoot),
      );
      // The Express host may apply express.json() app-wide, consuming the body and
      // leaving the parsed object on req.body. Prefer that; else read the raw stream.
      const readJson = async (
        req: import('node:http').IncomingMessage,
      ): Promise<Record<string, unknown>> => {
        const pre = (req as unknown as { body?: unknown }).body;
        if (pre && typeof pre === 'object') return pre as Record<string, unknown>;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8');
        return raw ? JSON.parse(raw) : {};
      };
      const json = (res: import('node:http').ServerResponse, obj: unknown, code = 200): void => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };
      const mutationFiles = (body: Record<string, unknown>, result?: HandlerResult): string[] => {
        const files = new Set<string>();
        const suppliedFile = body['file'];
        if (typeof suppliedFile === 'string') files.add(suppliedFile.split('?')[0] ?? suppliedFile);
        const oid = body['oid'];
        if (typeof oid === 'string') {
          const entry = store.index.get(oid);
          if (entry) files.add(entry.file);
        }
        const oids = body['oids'];
        if (Array.isArray(oids)) {
          for (const candidate of oids) {
            if (typeof candidate !== 'string') continue;
            const entry = store.index.get(candidate);
            if (entry) files.add(entry.file);
          }
        }
        const response = result?.body as Record<string, unknown> | undefined;
        for (const key of ['file', 'newFile', 'callsiteFile']) {
          const file = response?.[key];
          if (typeof file === 'string') files.add(file);
        }
        return [...files];
      };
      const resourcePath = (file: string) =>
        sourceResourcePath(
          isAbsolute(file) ? file : resolve(activeProjectRoot(), file),
          activeProjectRoot(),
        );
      /**
       * Record this write with the collaboration session and REPORT THE
       * REVISION IT PRODUCED.
       *
       * The revision is what the next mutation's optimistic-concurrency guard
       * (`assertSourceMutation`, below) compares against, and the client only
       * learned it from the collaboration SSE stream — one event loop later.
       * A gesture that writes the same file TWICE therefore sent a revision
       * that its own first write had already superseded, and the second write
       * was rejected: measured on a canvas transform drag, whose `position`
       * channel is two props (`x` and `y`) by construction, so EVERY drag lost
       * its whole gesture to the compensation path. An R3F pivot-rotate
       * (position + rotation) has the same shape.
       *
       * Returning it here closes the window without a second channel: the
       * writer already awaits this response, so adopting the number it carries
       * is exactly as fresh as the write itself (`source-write-backend.ts`'s
       * `postJson`).
       */
      const recordEditorMutation = (
        participantId: string,
        files: readonly string[],
      ): number | undefined => {
        const resources = files.map((file) => {
          const absolute = isAbsolute(file) ? file : resolve(activeProjectRoot(), file);
          return {
            path: resourcePath(absolute),
            sha: existsSync(absolute) ? sha256(readFileSync(absolute, 'utf8')).slice(0, 16) : null,
          };
        });
        if (resources.length === 0) return undefined;
        const session = collaborationSession(activeProjectRoot());
        // `null` means the bytes were already recorded (a filesystem observer
        // won the race) — the session's CURRENT revision is still the honest
        // answer to "what must the next write expect".
        return (
          session.recordSourceMutation({ authorId: participantId, source: 'editor', resources })
            ?.revision ?? session.snapshot().revision
        );
      };
      // Single middleware switching on the URL — avoids connect prefix-matching subtleties.
      // Each POST endpoint delegates to a small module-level handler (below) so this
      // dispatcher stays flat; the try/catch + JSON plumbing lives here once.
      const post = async (
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse,
        url: string,
        handler: (body: Record<string, unknown>) => HandlerResult,
      ): Promise<void> => {
        try {
          const body = await readJson(req);
          const claimedParticipantId = body['participantId'];
          const trustedParticipantId = req.headers['x-vgai-share-participant-id'];
          const trustedRole = req.headers['x-vgai-share-role'];
          if (
            typeof trustedParticipantId === 'string' &&
            typeof claimedParticipantId === 'string' &&
            trustedParticipantId !== claimedParticipantId
          ) {
            throw new Error(
              'The authenticated share participant does not match the source mutation author.',
            );
          }
          const participantId =
            typeof trustedParticipantId === 'string' ? trustedParticipantId : claimedParticipantId;
          const expectedRevision = body['expectedRevision'];
          const readOnlySourceRequest =
            url === '/__ui-source/prepare' || url === '/__ui-source/read';
          const beforeFiles = mutationFiles(body);
          if (
            typeof trustedParticipantId === 'string' &&
            beforeFiles.some((file) => !isCanonicalProjectSourcePath(activeProjectRoot(), file))
          ) {
            throw new Error('Shared source path leaves the project root.');
          }
          if (!readOnlySourceRequest && beforeFiles.length > 0) {
            if (typeof participantId !== 'string' || !Number.isInteger(expectedRevision)) {
              throw new Error('Source mutations require participantId and expectedRevision.');
            }
            if (
              typeof trustedRole === 'string' &&
              trustedRole !== 'editor' &&
              trustedRole !== 'terminal' &&
              trustedRole !== 'maintainer'
            ) {
              throw new Error(`The ${trustedRole} share role cannot edit source.`);
            }
            collaborationSession(activeProjectRoot()).assertSourceMutation(
              participantId,
              expectedRevision as number,
              beforeFiles.map(resourcePath),
            );
          }
          const result = handler(body);
          const response = result.body as Record<string, unknown>;
          const changed =
            response['changed'] === true ||
            response['applied'] === true ||
            response['restored'] === true ||
            ((url === '/__ui-source/fork-component' || url === '/__ui-source/extract-component') &&
              response['ok'] === true) ||
            (url === '/__ui-source/create-file' && response['created'] === true) ||
            (url === '/__ui-source/csf-story' && response['changed'] === true);
          const revision =
            !readOnlySourceRequest && changed && typeof participantId === 'string'
              ? recordEditorMutation(participantId, mutationFiles(body, result))
              : undefined;
          json(
            res,
            revision === undefined ? result.body : { ...response, revision },
            result.status ?? 200,
          );
        } catch (e) {
          json(
            res,
            { changed: false, error: e instanceof Error ? e.message : String(e) },
            e instanceof CollaborationConflictError ? 409 : 400,
          );
        }
      };
      // POST route table — keeps the dispatcher flat (one lookup, no per-endpoint branch).
      const postRoutes: Record<string, (body: Record<string, unknown>) => HandlerResult> = {
        '/__ui-source/prepare': (b) => handlePrepare(store, b, activeProjectRoot(), engineRoot),
        '/__ui-source/read': (b) => handleSourceRead(b, activeProjectRoot(), engineRoot),
        '/__ui-source/apply': (b) => handleSourceApply(b, activeProjectRoot(), engineRoot),
        '/__ui-source/write': (b) => handleWrite(store, b, activeProjectRoot(), engineRoot),
        '/__ui-source/css': (b) => handleCss(b, engineRoot),
        '/__ui-source/text': (b) => handleText(store, b, engineRoot),
        '/__ui-source/prop': (b) => handleProp(store, b, engineRoot),
        '/__ui-source/struct': (b) => handleStruct(store, b, engineRoot),
        '/__ui-source/struct-many': (b) => handleStructMany(store, b, engineRoot),
        '/__ui-source/create-file': (b) => handleCreateSourceFile(b, activeProjectRoot()),
        '/__ui-source/csf-story': (b) => handleCsfStory(b, activeProjectRoot()),
        '/__ui-source/named-style': (b) => handleNamedStyle(store, b, engineRoot),
        '/__ui-source/fork-component': (b) =>
          handleForkComponent(store, b, activeProjectRoot(), engineRoot),
        '/__ui-source/extract-component': (b) =>
          handleExtractComponent(store, b, activeProjectRoot(), engineRoot),
      };
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        if (url === '/__ui-source/index') {
          // Re-resolve contracts from current project bytes on every index
          // read — but OFF the request: a cold enrich is a 2.6 s ts.Program
          // and must not freeze first paint. The handler returns the last
          // enriched map (or the raw stamp) immediately; see currentOidIndex.
          //
          // H5 (wave 4): the R3F
          // authorability DIAGNOSTICS ride this same response, per entry.
          // Deliberately not a channel of their own — attaching them to the
          // payload the R3F adapter's `refreshSourceState()` already fetches is
          // what makes their freshness structurally identical to the index's,
          // with no second fetch, no polling loop and no cache to invalidate.

          const indexStarted = Date.now();
          const index = currentOidIndex(store, activeProjectRoot(), server);
          res.setHeader('Server-Timing', `index;dur=${Date.now() - indexStarted}`);
          res.setHeader(
            'X-Vgai-Oid-Index-Enriched',
            index === lastEnrichedIndex?.index ? '1' : '0',
          );
          if (typeof req.headers['x-vgai-share-participant-id'] !== 'string') {
            return json(res, index);
          }
          return json(
            res,
            Object.fromEntries(
              Object.entries(index).filter(([, value]) => {
                const file = (value as { file?: unknown } | null)?.file;
                return (
                  typeof file === 'string' &&
                  isCanonicalProjectSourcePath(activeProjectRoot(), file)
                );
              }),
            ),
          );
        }
        if (url === '/__ui-source/component-props' && req.method === 'GET') {
          // THE PER-DEFINITION DOOR: the props a prefab DECLARES, asked before
          // any callsite exists. The index above only knows tags already used
          // in a file; a drop needs the declaration itself so a REQUIRED enum
          // prop can be written with its first option instead of nothing
          // (`<WeaponPickup>` rendered NOTHING until `kind` was set — runhuman
          // pass 123). Same worker, same checker, one request.
          const params = new URL(req.url ?? '', 'http://localhost').searchParams;
          const file = params.get('file') ?? '';
          const name = params.get('name') ?? '';
          const root = activeProjectRoot();
          if (!root || !file || !name) return json(res, { props: [] });
          const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file);
          if (
            !isCanonicalProjectSourcePath(root, absolute) ||
            resolveEditableSourceFile(absolute, root) === null
          ) {
            return json(res, { props: [] });
          }
          const key = `${absolute}::${name}::definition`;
          try {
            const props = await resolveDeclaredProps(root, [
              { key, file: absolute, tag: name, definition: true },
            ]);
            return json(res, { props: props.get(key) ?? [] });
          } catch (error) {
            return json(res, {
              props: [],
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const handler = req.method === 'POST' ? postRoutes[url] : undefined;
        if (handler) return post(req, res, url, handler);
        next();
      });
    },
  };
}
