import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { resolveManifestPath } from '@volter/editor-project/manifest/locate';
import type {
  FileRegionAnswer,
  ImportersOf,
  RegionBinding,
} from '../src/ui-source/file-region-resolver';
import { resolveFileRegion } from '../src/ui-source/file-region-resolver';
import type { DeclaredRootSurface, SourceDialectEvidence } from '../src/ui-source/oid-transform';
import { sourceDialectEvidence, sourceProvesR3f } from '../src/ui-source/oid-transform';
import {
  ADAPTER_MODULE_FILENAME,
  adapterRegionIncludes,
  resetAdapterRegionIncludesCacheForTest,
} from './adapter-region-includes';

/**
 * The dev server's HALF of the one file→region decision: the filesystem
 * questions `../src/ui-source/file-region-resolver.ts` injects (which regions
 * does this project declare, and is THIS file one of their entries), plus the
 * OID-specific diagnostics built on the answer.
 *
 * Shared by the OID-stamping transform (`../vite-plugin-ui-oid.ts`'s
 * `transform` hook) and the HMR classifier (`./project-hmr-files.ts`'s
 * `classifyProjectHotUpdate`). Before this module existed, the two answered
 * the "is this file R3F or react-dom" question with two SEPARATE copies of
 * the same substring probe, "kept in lockstep by hand" per their own doc
 * comments — a latent drift bug of its own, independent of the probe's
 * original blind spot (see the oid-attribute-surface-decision PR). Sharing
 * this helper makes drift structurally impossible: both call the same
 * function over the same manifest-walk cache.
 *
 * There is ONE surface vocabulary — 'three' | 'canvas' | 'dom'. This module
 * carries no alias map, because `packages/project/src/manifest/schema.ts`
 * normalizes nothing (the legacy-removal doctrine): a manifest naming an old
 * spelling fails `RootAdapterSchema` loudly at load, naming the canonical
 * value — so there is nothing for this probe to translate.
 *
 * Deliberately dependency-light (no Zod, no `@vgai/project/manifest/load`) — same
 * bar `vite-plugin-ui-oid.ts`'s `nearestManifestExcludesIngestReact` already
 * holds for this vite-config-time file: a best-effort identity probe, not
 * manifest validation. A malformed manifest never crashes a transform/HMR
 * hook; it degrades to "no declared regions", which the resolver answers as
 * AMBIGUOUS and every caller already handles (the documented `data-oid`
 * default here, the plain 'react' Fast-Refresh classification in
 * `classifyProjectHotUpdate`) — loudly, never as a silent guess.
 */

function normalizeSurface(value: unknown): DeclaredRootSurface | undefined {
  if (value === 'three' || value === 'canvas' || value === 'dom') return value;
  return undefined;
}

/** Best-effort surface extraction from one root's raw (unvalidated) `adapter`
 *  field — either the bare-string shorthand or the `{ module | ingest,
 *  surface }` object forms (`RootAdapterSchema`). Never throws on a
 *  malformed shape. */
function rootDeclaredSurface(adapter: unknown): DeclaredRootSurface | undefined {
  if (typeof adapter === 'string') return normalizeSurface(adapter);
  if (adapter && typeof adapter === 'object') {
    return normalizeSurface((adapter as { surface?: unknown }).surface);
  }
  return undefined;
}

interface CachedManifestRoots {
  /** Absolute directory the manifest itself lives in — a root's `entry` is
   *  project-relative to THIS directory, not to the queried file's own. */
  readonly manifestDir: string;
  readonly roots: ReadonlyArray<{
    readonly id?: unknown;
    readonly entry?: unknown;
    readonly adapter?: unknown;
  }>;
  /** The project's regions in the resolver's vocabulary: one per declared
   *  root, carrying whatever `include` globs its `vgai.adapter.ts` states. */
  readonly regions: readonly RegionBinding[];
  /** The adapter declares a `regions` binding this tier could not read
   *  statically — reported, never read as "declares nothing". */
  readonly includesUnreadable: boolean;
}

/** Cache: absolute directory -> nearest ancestor `vgai.project.json`'s parsed
 *  roots (or `null` if none exists above it). Cached both ways (hit and
 *  miss), the same pattern `vite-plugin-ui-oid.ts`'s
 *  `nearestManifestExcludesIngestReact` uses for the identical walk — no
 *  invalidation on manifest edit; a `vgai.project.json` edit already triggers
 *  `classifyProjectHotUpdate`'s `'restart'` kind, so a stale in-process
 *  cache here is no worse than the existing precedent. */
const manifestRootsCache = new Map<string, CachedManifestRoots | null>();

/**
 * The manifest that OWNS `absFile` — the ancestor walk, then the open
 * project's own claim.
 *
 * A project's sources are normally under its manifest, and the walk finds
 * them. An INGEST root's are not: the racing-game's manifest lives in the
 * editor's in-tree registry while the game it mounts is vendored at
 * `vendor/games/racing-game/src/`, six levels away — measured, no
 * `vgai.project.json` is an ancestor of ANY of that game's 45 `.tsx` files, so
 * the walk answers "no project" and every declaration in its `vgai.adapter.ts`
 * is unreadable for exactly the files it is about.
 *
 * The claim is read from the manifest, not guessed: a root's `entry` (and an
 * a root's `world.entry`) is a path the manifest itself
 * states and the host EXECUTES, so the directory it names is part of that
 * project's tree by the project's own account. Nothing else extends a
 * project's reach — a file under no declared entry's directory stays
 * unclaimed, which is why opening one project cannot make the editor's own
 * sources, or another project's, look like its.
 */
function manifestOwning(absFile: string, projectRoot?: string): CachedManifestRoots | null {
  const nearest = nearestManifestRoots(dirname(absFile));
  if (nearest || projectRoot === undefined) return nearest;
  const project = nearestManifestRoots(resolve(projectRoot));
  if (!project) return null;
  return declaredEntryDirs(project).some((dir) => absFile.startsWith(`${dir}${sep}`))
    ? project
    : null;
}

/** Every directory a project's manifest names an entry in, absolute. */
function declaredEntryDirs(manifest: CachedManifestRoots): string[] {
  const dirs: string[] = [];
  for (const root of manifest.roots) {
    if (!root || typeof root !== 'object') continue;
    for (const entry of [
      (root as { entry?: unknown }).entry,
      ((root as { world?: { entry?: unknown } }).world?.entry ?? undefined) as unknown,
    ]) {
      if (typeof entry !== 'string') continue;
      dirs.push(dirname(resolve(manifest.manifestDir, entry)));
    }
  }
  return dirs;
}

function nearestManifestRoots(dir: string): CachedManifestRoots | null {
  const cached = manifestRootsCache.get(dir);
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

  let result: CachedManifestRoots | null;
  if (raw === undefined) {
    const parent = dirname(dir);
    result = parent === dir ? null : nearestManifestRoots(parent);
  } else {
    result = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      const roots = (parsed as { roots?: unknown } | null)?.roots;
      if (Array.isArray(roots)) {
        result = cachedRoots(dir, roots as CachedManifestRoots['roots']);
      }
    } catch {
      // Malformed JSON: honest "no manifest usable here" — never crash the
      // transform/HMR hook over a broken file.
      result = null;
    }
  }
  manifestRootsCache.set(dir, result);
  return result;
}

/** Join the manifest's roots to the `include` globs the project's own
 *  `vgai.adapter.ts` declares for them — the resolver's region vocabulary. */
function cachedRoots(dir: string, roots: CachedManifestRoots['roots']): CachedManifestRoots {
  const declared = adapterRegionIncludes(dir);
  const regions: RegionBinding[] = [];
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    const id = typeof root.id === 'string' ? root.id : undefined;
    const surface = rootDeclaredSurface(root.adapter);
    if (id === undefined || surface === undefined) continue;
    const include = declared.byRegionId.get(id);
    const mounts = declared.mountsByRegionId.get(id);
    regions.push({
      id,
      surface,
      ...(include ? { include } : {}),
      ...(mounts?.length ? { mounts } : {}),
    });
  }
  return { manifestDir: dir, roots, regions, includesUnreadable: declared.unreadable };
}

/**
 * Resolve the declared surface for ONE project file by walking up to the
 * nearest `vgai.project.json` and matching the file against a root's `entry`
 * path EXACTLY (resolved absolute). Returns `undefined` — "ambiguous, fall
 * back to the substring probe" — when no manifest is reachable, no root's
 * `entry` matches this exact file (e.g. an imported component that isn't
 * itself a root's entry), or the matching root's adapter shape doesn't
 * resolve to a surface. This function never throws over manifest CONTENT;
 * only a genuine filesystem error other than "not found" propagates.
 */
export function declaredSurfaceForProjectFile(file: string): DeclaredRootSurface | undefined {
  return regionOfEntry(file)?.surface;
}

/**
 * The resolver's `regionOfEntry` for this tier: walk up to the nearest
 * `vgai.project.json` and match `file` against a root's `entry` path EXACTLY
 * (resolved absolute). `undefined` when no manifest is reachable, no root's
 * `entry` is this exact file, or the matching root's adapter shape resolves to
 * no surface. Never throws over manifest CONTENT; only a genuine filesystem
 * error other than "not found" propagates.
 */
function regionOfEntry(file: string, projectRoot?: string): RegionBinding | undefined {
  const absFile = resolve(file);
  const manifest = manifestOwning(absFile, projectRoot);
  if (!manifest) return undefined;
  for (const root of manifest.roots) {
    if (!root || typeof root !== 'object') continue;
    const entry = (root as { entry?: unknown }).entry;
    if (typeof entry !== 'string') continue;
    if (resolve(manifest.manifestDir, entry) !== absFile) continue;
    const id = typeof root.id === 'string' ? root.id : undefined;
    const surface = rootDeclaredSurface((root as { adapter?: unknown }).adapter);
    if (surface === undefined) return undefined;
    return { id: id ?? entry, surface };
  }
  return undefined;
}

/** Re-exported so this tier's callers keep ONE import for the graph seam. */
export type { ImportersOf } from '../src/ui-source/file-region-resolver';

/** Structural (not imported) shape of Vite's `ModuleGraph`. */
interface ModuleNodeLike {
  readonly id: string | null;
  /** Vite's query-free physical source path. Present for file-backed nodes. */
  readonly file?: string | null;
  readonly importers: Iterable<ModuleNodeLike>;
}

export interface ModuleGraphLike {
  getModuleById(id: string): ModuleNodeLike | undefined;
  /**
   * One physical project file can have several module nodes: mount isolation
   * gives every instance its own `?vgai-mount=` URL. Surface ownership is a
   * property of the source file, so the adapter must visit every variant.
   */
  getModulesByFile?(file: string): Set<ModuleNodeLike> | undefined;
}

/** Query/hash-free file identity for Vite module ids and `/@fs/` urls. */
function moduleFileId(id: string): string {
  const clean = id.split(/[?#]/, 1)[0] ?? id;
  return clean.startsWith('/@fs/') ? clean.slice('/@fs'.length) : clean;
}

function moduleVariants(graph: ModuleGraphLike, id: string, file: string): ModuleNodeLike[] {
  const variants = graph.getModulesByFile?.(file);
  if (variants?.size) return [...variants];
  const node = graph.getModuleById(id) ?? graph.getModuleById(file);
  return node ? [node] : [];
}

/**
 * The importing FILES of these nodes — and a virtual module is not one.
 *
 * Vite's convention is that a `\0`-prefixed id was synthesized by a plugin and
 * has no path behind it; `ModuleNode.file` is `null` for exactly those, which
 * is why the `?? importer.id` fallback below can hand back something that is
 * not a path at all. Every caller of this set treats a member as a file:
 * `regionOfEntry` resolves it absolute and walks up looking for the
 * `vgai.project.json` that owns it.
 *
 * MEASURED 2026-09-21 (WORK.md step 3 P1), in a live session: a product's
 * `vgai:contributions/@volter/editor-blender` module imports that package's
 * contributions, so `\0vgai:contributions/@volter/editor-blender` arrived here as an
 * importer, `resolve()` made it `<cwd>/\0vgai:contributions/@vgai`, and the
 * manifest walk's `readFileSync` threw `The argument 'path' must be a string,
 * Uint8Array, or URL without null bytes`. That is a 500 from the OID plugin on
 * every contribution of that package, which the editor reported as "the editor
 * app failed to start: Failed to fetch dynamically imported module" — the
 * cause named nowhere near the symptom.
 *
 * DROPPING IT IS THE ANSWER, not skipping past it to ITS importers: a region is
 * a claim about the project's own files, so a module with no file can neither
 * be a region's entry nor a step on a path to one.
 */
function importerFiles(nodes: readonly ModuleNodeLike[]): Set<string> {
  const files = new Set<string>();
  for (const node of nodes) {
    for (const importer of node.importers) {
      const importerFile = importer.file ?? importer.id;
      if (!importerFile || importerFile.startsWith('\0')) continue;
      files.add(moduleFileId(importerFile));
    }
  }
  return files;
}

/** Adapts a `ModuleGraphLike` (a live Vite dev server's `server.moduleGraph`)
 *  into an `ImportersOf` callback. `undefined` in, `undefined` out — every
 *  caller already treats "no graph available" the same as "no importers
 *  found", both degrading to the entry-only answer. */
export function importersFromModuleGraph(graph: ModuleGraphLike | undefined): ImportersOf {
  return (id: string) => {
    if (!graph) return undefined;
    const file = moduleFileId(id);
    const nodes = moduleVariants(graph, id, file);
    if (nodes.length === 0) return undefined;
    return importerFiles(nodes);
  };
}

/**
 * The dev server's file->region answer, in the shared resolver's terms:
 * declared include, then root entry, then live import-graph reach.
 *
 * A per-root BUNDLE would answer this for free — every file its `onLoad`
 * touches genuinely belongs to that entry's root. The dev server has no
 * per-root build:
 * Vite serves one shared module graph for the whole project, so reach up the
 * graph (`importersOf`, backed by Vite's own `ModuleGraph` via
 * `importersFromModuleGraph`) is how a file that is not itself an entry gets
 * placed. That reach is the load-bearing fact — the region's entry is what the
 * host EXECUTES at mount — which is why it is the only automatic rung.
 */
export function resolveProjectFileRegion(
  file: string,
  importersOf?: ImportersOf,
  projectRoot?: string,
): FileRegionAnswer {
  const absFile = resolve(file);
  const manifest = manifestOwning(absFile, projectRoot);
  return resolveFileRegion({
    file: absFile,
    ...(manifest ? { projectRelative: relative(manifest.manifestDir, absFile) } : {}),
    ...(manifest ? { regions: manifest.regions } : {}),
    regionOfEntry: (candidate) => regionOfEntry(candidate, projectRoot),
    ...(importersOf ? { importersOf } : {}),
  });
}

/** The surface half of {@link resolveProjectFileRegion} — `undefined` when the
 *  answer is ambiguous, which every caller reports rather than guesses around. */
export function declaredSurfaceForProjectFileViaGraph(
  file: string,
  importersOf?: ImportersOf,
): DeclaredRootSurface | undefined {
  return resolveProjectFileRegion(file, importersOf).surface;
}

/** Test-only: clear the manifest cache between cases that plant/replace a
 *  `vgai.project.json` at the same path. */
export function resetDeclaredSurfaceCacheForTest(): void {
  manifestRootsCache.clear();
  resetAdapterRegionIncludesCacheForTest();
  reportedDiagnostics.clear();
}

// ---------------------------------------------------------------------------
// The DIAGNOSTIC half: an ambiguous stamp must never be silent.
//
// `resolveProjectFileRegion` above answers "which region?" from declarations
// and reach alone. When nothing places a file it answers AMBIGUOUS, and the
// stamper applies the documented default (`data-oid`) — VISIBLY. Until this
// section existed the ambiguous cases looked identical from outside: the
// surface still rendered, selection just stopped resolving, with nothing
// printed anywhere.
//
// The reasons, and what each earns:
//   1. No `vgai.project.json` above the file at all (ingest, ad-hoc source, the
//      editor's own `ui-editor/editable-components/*.tsx`). NOT diagnosable —
//      there is no project to be wrong about, and warning here would fire on
//      every non-project file. Silent by design.
//   2. The file is inside a project but no region reaches it and none declares
//      it. The attribute is then a pure DEFAULT, not a decision -> `OID001`,
//      naming the region-include fix. Portable story modules are exempt: they
//      are explicit design-time documents, not runtime-root candidates, and
//      their rendered subject's own module owns selectable spatial nodes.
//   3. Reached from regions of DIFFERING surfaces — a genuinely shared module.
//      Not resolvable from this file's bytes, by anyone, ever: the diagnostic
//      IS the deliverable, and the region include is the repair -> `OID002`.
//   4. The file's own rendered HOST ELEMENTS contradict the region that owns
//      it -> `OID003`. DECLARED-VS-MEASURED DRIFT, which ARCHITECTURE-CORE
//      §The editor protocol names as the third and only remaining answer when
//      a declaration and the world disagree: the region still decides the
//      attribute, and the disagreement is said out loud so the author can fix
//      the declaration (or the file).
// Plus one that is not an ambiguity at all but is equally silent and equally
// fatal to selection: a file that renders BOTH R3F-only and DOM-only
// intrinsics -> `OID004`. A per-FILE attribute cannot serve both dialects, so
// no answer is correct; this is reported, never guessed around.
//
// THE SOURCE-TEXT SCANS THAT REMAIN, AND WHY. `sourceDialectEvidence` feeds
// this section's diagnostic PROSE (`evidenceSummary`, OID003, OID004) —
// reporting what a file renders is not classifying it, and NO attribute below
// is decided from a file's own bytes. Not one: the region decides every stamp,
// and where the region and the file's rendered tags disagree the disagreement
// is said out loud at the volume its consequence deserves.
// ---------------------------------------------------------------------------

export type OidSurfaceDiagnosticCode = 'OID001' | 'OID002' | 'OID003' | 'OID004';

export interface OidSurfaceDiagnostic {
  code: OidSurfaceDiagnosticCode;
  /** Self-contained: names the file, the attribute that was stamped, why, and
   *  what the author can do about it. Written to be readable on its own in a
   *  terminal line or an editor console row — no engine source required. */
  message: string;
}

/** How `resolveOidSurface` reached its answer. */
export type OidSurfaceVia =
  /** A region's `include` glob names this exact file. */
  | 'declared-include'
  /** This exact file is a manifest root's `entry` — the manifest decides. */
  | 'root-entry'
  /** Reachable from exactly one region `entry` through the live import graph. */
  | 'import-graph'
  /** Nothing decided; `data-oid` is the default. */
  | 'default';

export interface OidSurfaceDecision {
  readonly file: string;
  readonly attribute: 'data-oid' | 'userData-oid';
  readonly surface?: DeclaredRootSurface;
  readonly via: OidSurfaceVia;
  readonly diagnostics: readonly OidSurfaceDiagnostic[];
}

/** One root as the diagnostic reports it — `id → surface (entry)`. */
function describeRoots(manifest: CachedManifestRoots): string {
  const described = manifest.roots.map((root) => {
    if (!root || typeof root !== 'object') return '(malformed root)';
    const id = (root as { id?: unknown }).id;
    const entry = typeof root.entry === 'string' ? root.entry : '(no entry)';
    const surface = rootDeclaredSurface(root.adapter) ?? '(no surface)';
    return `${typeof id === 'string' ? id : '(no id)'} → ${surface} (${entry})`;
  });
  return described.length > 0 ? described.join(', ') : '(no roots)';
}

/** Portable CSF is a design-time document. A component-only story commonly
 * renders `<Story />` or a provider decorator and is reached from no runtime
 * root, but importing it from one or giving it a manifest root would be exactly
 * the wrong repair. The preview lane qualifies its rendered output
 * independently, while selectable nodes retain the OIDs stamped in the
 * prefab/component source they came from. */
function isPortableStoryModule(file: string): boolean {
  return /\.stories\.[jt]sx?$/i.test(file);
}

function evidenceSummary(evidence: SourceDialectEvidence): string {
  const parts: string[] = [];
  if (evidence.reconcilerImport) parts.push('imports the R3F reconciler');
  if (evidence.r3fOnlyTags.length > 0) {
    parts.push(`renders R3F-only <${evidence.r3fOnlyTags.slice(0, 4).join('>, <')}>`);
  }
  if (evidence.domOnlyTags.length > 0) {
    parts.push(`renders DOM-only <${evidence.domOnlyTags.slice(0, 4).join('>, <')}>`);
  }
  return parts.length > 0 ? parts.join('; ') : 'carries no dialect evidence of its own';
}

/**
 * The file's own host elements are DOM elements: it renders at least one
 * DOM-only intrinsic and NOT ONE R3F-only intrinsic.
 *
 * READ ONLY BY DIAGNOSTICS. It decides no attribute anywhere — every stamp
 * below comes from the region answer (or, for a THREE host element, from the
 * crash guard). What it is for is telling the difference between a
 * disagreement worth an author's attention and one that is not:
 *
 *   - a file the region places on `three` while its host elements are DOM is
 *     DRIFT, and `OID003` says so (the region still stamps, so the drift is
 *     visible in the editor rather than papered over);
 *   - an UNPLACED file whose host elements are DOM already carries the right
 *     attribute by construction — the default IS `data-oid` — so `OID001`
 *     stays quiet for it. Measured with this same resolver over the shipped
 *     projects: warning there would add 5 lines to a fresh template scaffold's
 *     boot and 6-8 to each example, on files whose stamp is correct. A
 *     diagnostic channel agents are told to trust cannot cry wolf.
 */
function rendersOnlyDomHosts(evidence: SourceDialectEvidence): boolean {
  return evidence.domOnlyTags.length > 0 && evidence.r3fOnlyTags.length === 0;
}

/**
 * The file's own host elements are THREE objects: it renders at least one
 * R3F-only intrinsic and NOT ONE DOM-only intrinsic.
 *
 * READ ONLY BY DIAGNOSTICS, exactly like {@link rendersOnlyDomHosts} — it
 * decides no attribute. The asymmetry it feeds is in the diagnostic's PROSE,
 * not in the answer: `userData-oid` on a DOM host element is NOISY (React logs
 * an unrecognized prop and selection does not resolve), while `data-oid` on an
 * R3F host element is FATAL and silently so for exactly one mount — fiber's
 * `applyProps` pierces the dashed prop, `data` is not a property of any THREE
 * class, so the first apply writes `object.data = '<oid>'` and the SECOND
 * pierces into that string and throws `R3F: Cannot set "data-oid". Ensure it is
 * an object before setting "oid".` (`userData` exists on every THREE object, so
 * `userData-oid` is idempotent — proven in `ui-source-r3f-dialect.test.ts`.)
 *
 * MEASURED (2026-08-16, the starter-kit-3d-platformer port, live editor
 * session): prefab modules whose only importer in Vite's graph at transform
 * time was their own colocated `*.stories.tsx` were stamped `data-oid`; the
 * second mount of the same story threw on the prefab's module-level shared
 * geometry, 8 uncaught page errors in one session. Reach is an ORDER-DEPENDENT
 * fact about one dev server's graph at one moment, which is why the repair is a
 * DECLARATION — the region `include` this diagnostic names — and not a
 * byte-level override that would make the declaration untestable.
 */
function rendersOnlyR3fHosts(evidence: SourceDialectEvidence): boolean {
  return evidence.r3fOnlyTags.length > 0 && evidence.domOnlyTags.length === 0;
}

/**
 * THE FATAL DIRECTION of declared-vs-measured drift: a `dom`/`canvas` region
 * owning a file whose host elements are THREE objects — see
 * {@link rendersOnlyR3fHosts} for what `data-oid` does to one of those.
 *
 * Reported, and the region still stamps: which region owns a file is the game's
 * to state, and the include glob is where it states it. `why` names how the
 * non-`three` answer came to be believed, so the diagnostic reads as one
 * sentence.
 */
function r3fHostDriftDiagnostic(
  absFile: string,
  why: string,
  evidence: SourceDialectEvidence,
  rootsNote: string,
): OidSurfaceDiagnostic {
  return {
    code: 'OID003',
    message:
      `${absFile} ${why}, but the file itself ${evidenceSummary(evidence)} and renders no DOM ` +
      'element at all — its host elements are THREE objects, and `data-oid` on one of those is ' +
      'not a degraded stamp: react-three-fiber pierces the dash, writes `object.data` on the ' +
      'first apply and THROWS on the next one (`R3F: Cannot set "data-oid"`), so this file will ' +
      'break the running game, not merely fail to select. If it really is part of a ' +
      `\`dom\`/\`canvas\` region, move its R3F elements out of it; otherwise give it a \`three\` ` +
      `root of its own, or declare it onto the \`three\` surface with an \`include\` glob (or a ` +
      `\`mounts\` entry, if this root mounts \`three\` beside another surface) in ` +
      `${ADAPTER_MODULE_FILENAME}. Roots considered: ${rootsNote}.`,
  };
}

/** `via` in the OID vocabulary for a region answer. */
function viaOf(answer: FileRegionAnswer): OidSurfaceVia {
  return answer.via === 'ambiguous' ? 'default' : answer.via;
}

/** How the diagnostic names the way a `three` surface came to be believed. */
function whyOf(answer: FileRegionAnswer): string {
  if (answer.via === 'declared-include') {
    return `is declared onto the \`${answer.regionId}\` region's \`three\` surface in ${ADAPTER_MODULE_FILENAME}`;
  }
  if (answer.via === 'root-entry')
    return 'is declared as a `three` root entry in vgai.project.json';
  return 'is reached only from a `three` root';
}

/** OID001's extra clause about what the defaulted file's own bytes say — the
 *  consequence, graded. A file whose HOST elements are THREE objects gets the
 *  `data-oid` default and will THROW inside fiber on the second apply (see
 *  {@link rendersOnlyR3fHosts}), so its clause says so; a file that merely
 *  IMPORTS the reconciler has nothing for a wrong stamp to land on and only
 *  fails to select. */
function unresolvableClause(evidence: SourceDialectEvidence): string {
  if (rendersOnlyR3fHosts(evidence)) {
    return (
      ` — and this file ${evidenceSummary(evidence)}, so the \`data-oid\` default lands on THREE ` +
      'objects: react-three-fiber pierces the dash, writes `object.data` on the first apply and ' +
      'THROWS on the next one. Declaring this file is not optional cleanup — the running game ' +
      'breaks without it'
    );
  }
  return sourceProvesR3f(evidence)
    ? ` — and this file ${evidenceSummary(evidence)}, so its selection will NOT resolve`
    : '';
}

/**
 * The ONE decision the dev server's OID stamping and HMR classification
 * both make, now WITH its reasoning attached.
 *
 * Precedence is the shared resolver's, and it has no source-text rung:
 *  1. a region's `include` glob — or one of its `mounts` — names this file;
 *  2. this file IS a region's `entry`;
 *  3. exactly one surface reached through the live import graph.
 * Anything else is AMBIGUOUS: `data-oid` is stamped as the documented DEFAULT
 * (`via: 'default'`) and said out loud, rather than inferred from the file's
 * own bytes. There is no exception in either direction — a file whose host
 * elements contradict its region keeps the region's stamp and gets `OID003`,
 * whichever way the contradiction points. A file that renders both dialects'
 * intrinsics gets neither and the `OID004` diagnostic.
 */
export function resolveOidSurface(
  file: string,
  code: string,
  importersOf?: ImportersOf,
  projectRoot?: string,
): OidSurfaceDecision {
  const absFile = resolve(file);
  const evidence = sourceDialectEvidence(code);
  const diagnostics: OidSurfaceDiagnostic[] = [];
  const manifest = manifestOwning(absFile, projectRoot);

  if (evidence.r3fOnlyTags.length > 0 && evidence.domOnlyTags.length > 0) {
    diagnostics.push({
      code: 'OID004',
      message:
        `${absFile} renders BOTH R3F-only (<${evidence.r3fOnlyTags.slice(0, 3).join('>, <')}>) ` +
        `and DOM-only (<${evidence.domOnlyTags.slice(0, 3).join('>, <')}>) elements. The editor ` +
        'stamps ONE source-id attribute per file (`userData-oid` for the R3F reconciler, ' +
        '`data-oid` for react-dom), so selection can only resolve for one of the two dialects ' +
        'in this file. Split the DOM part (e.g. the contents of a drei <Html>) into its own ' +
        'module to make both halves selectable.',
    });
  }

  const answer = resolveProjectFileRegion(absFile, importersOf, projectRoot);
  if (answer.surface !== undefined) {
    // DRIFT, REPORTED AND NOT ACTED ON: a `three` region owning a file whose
    // HOST ELEMENTS are DOM elements. The region still stamps — it is the
    // game's own statement about which surface this file renders on, and a
    // stamp derived from the file's bytes instead would make the declaration
    // untestable, which is how a wrong declaration used to stay invisible. What
    // the author sees is the disagreement itself, plus the two declarations
    // that resolve it.
    if (answer.surface === 'three' && rendersOnlyDomHosts(evidence)) {
      diagnostics.push({
        code: 'OID003',
        message:
          `${absFile} ${whyOf(answer)}, but the file itself ${evidenceSummary(evidence)} and ` +
          'renders no R3F element at all — its host elements are DOM elements, so the ' +
          '`userData-oid` stamped from that region is an unrecognized React prop on every one of ' +
          'them and selection resolves for neither dialect. This is the normal shape for ' +
          'HUD/overlay modules that import `@react-three/fiber` only for `addEffect`/`useFrame`: ' +
          `declare them onto this root's \`dom\` surface with a \`mounts\` entry in ` +
          `${ADAPTER_MODULE_FILENAME}, or give them a \`dom\` root of their own in ` +
          'vgai.project.json. If this file really does author R3F content, render an R3F element ' +
          `in it. Roots considered: ${manifest ? describeRoots(manifest) : '(none)'}.`,
      });
    }
    // DRIFT, REPORTED AND NOT ACTED ON — the FATAL direction: a non-`three`
    // region owning a file whose HOST ELEMENTS are THREE objects. The region
    // still stamps, for the same reason it does above: a stamp derived from the
    // file's bytes would make the declaration untestable. What differs is the
    // consequence, and the diagnostic says it (`r3fHostDriftDiagnostic`).
    if (answer.surface !== 'three' && rendersOnlyR3fHosts(evidence)) {
      diagnostics.push(
        r3fHostDriftDiagnostic(
          absFile,
          `belongs to a \`${answer.surface}\` region (${answer.via})`,
          evidence,
          manifest ? describeRoots(manifest) : '(none)',
        ),
      );
    }
    // DRIFT, REPORTED AND NOT ACTED ON: a non-`three` region reaching a file
    // that IMPORTS the R3F reconciler but renders no host element of either
    // dialect. Import reach is not render reach — a `dom` root CAN render an
    // R3F `<Canvas>`, and its children are reached through the graph — so this
    // is a real, nameable disagreement between the declaration and the source,
    // with nothing in the file for a wrong stamp to land on. "Which region owns
    // this file" stays the game's to state, and the include glob is where it
    // states it; the diagnostic is the part that was load-bearing.
    if (
      answer.surface !== 'three' &&
      evidence.reconcilerImport &&
      evidence.r3fOnlyTags.length === 0 &&
      evidence.domOnlyTags.length === 0
    ) {
      diagnostics.push({
        code: 'OID003',
        message:
          `${absFile} belongs to a \`${answer.surface}\` region (${answer.via}), but the file ` +
          `itself ${evidenceSummary(evidence)} — import reach is not render reach (a ` +
          `\`${answer.surface}\` root can render an R3F <Canvas>). \`data-oid\` is stamped from ` +
          'the region, so any R3F element here will not resolve to a selection. Give this file a ' +
          `\`three\` root of its own, or declare it onto the \`three\` surface with an \`include\` ` +
          `glob (or a \`mounts\` entry) in ${ADAPTER_MODULE_FILENAME}. Roots considered: ` +
          `${manifest ? describeRoots(manifest) : '(none)'}.`,
      });
    }
    return {
      file: absFile,
      attribute: answer.surface === 'three' ? 'userData-oid' : 'data-oid',
      surface: answer.surface,
      via: viaOf(answer),
      diagnostics,
    };
  }

  if (answer.ambiguity === 'differing-surfaces') {
    diagnostics.push({
      code: 'OID002',
      message:
        `${absFile} is reached from regions of DIFFERING surfaces (${answer.reached.join(', ')}), ` +
        'so which reconciler renders its JSX is genuinely undecidable from reach — the editor ' +
        'stamped `data-oid`, the documented DEFAULT, and selection will not resolve for the ' +
        'other surface. Split the shared part into a module per surface, or declare it via a ' +
        `region \`include\` glob in ${ADAPTER_MODULE_FILENAME}. Roots considered: ` +
        `${manifest ? describeRoots(manifest) : '(none)'}.`,
    });
  } else if (
    manifest &&
    importersOf &&
    // The noise gate — see `rendersOnlyDomHosts`: an unplaced file whose host
    // elements are DOM already carries the attribute it needs, because the
    // default IS `data-oid`. Warning there would fire on ordinary components in
    // every shipped project, and noise is how a real signal gets ignored.
    !rendersOnlyDomHosts(evidence) &&
    // The story exemption is a NOISE gate too, and it stops at the fatal case:
    // an unplaced story whose own host elements are THREE objects takes the
    // `data-oid` default onto them and throws inside fiber on the second mount
    // (see `rendersOnlyR3fHosts` — that is the exact shape the 2026-08-16
    // measurement took). Silence about a crash is not noise reduction.
    (!isPortableStoryModule(absFile) || rendersOnlyR3fHosts(evidence))
  ) {
    // Gated on `importersOf` because "no region reaches it" is only a FINDING
    // when a graph was actually consulted; without one (a `vite build` of the
    // hosted editor, a one-off transform in a test) it is just ignorance, and
    // claiming it would warn about every non-entry file in the project.
    diagnostics.push({
      code: 'OID001',
      message:
        `${absFile} is inside the project at ${join(manifest.manifestDir, 'vgai.project.json')} but ` +
        'no region reaches it and none declares it, so the source-id attribute it carries is a ' +
        `DEFAULT, not a decision${unresolvableClause(evidence)}. Import it from a region entry (directly or ` +
        'transitively), give it a root, or declare it via a region `include` glob in ' +
        `${ADAPTER_MODULE_FILENAME}. Roots considered: ${describeRoots(manifest)}.`,
    });
  }

  if (manifest?.includesUnreadable) {
    diagnostics.push({
      code: 'OID001',
      message:
        `${absFile}: ${join(manifest.manifestDir, ADAPTER_MODULE_FILENAME)} declares a \`regions\` ` +
        'binding this tier could not read statically, so any `include` globs in it were NOT ' +
        'consulted for this file. The adapter table must be statically evaluable — write the ' +
        'regions as an array of object literals with literal `id` and `include` values.',
    });
  }

  return { file: absFile, attribute: 'data-oid', via: 'default', diagnostics };
}

/**
 * The graph-FREE subset of the diagnostics above: the conflicts that a file's
 * own bytes and the manifest settle between them, with no live import graph
 * involved. Called by `server/project-validation.ts`'s `validateSource`, which
 * runs on every project source write and reports through the three surfaces
 * issue #103 established — the terminal, the editor console (the `server-log`
 * SSE event), and `/__editor/state` (what `vgai status` prints).
 *
 * Excludes `OID001`/`OID002` by construction: both need graph reach to be true,
 * and without a graph EVERY non-entry file looks unreachable — a warning on
 * every child component would be noise, and noise is how a real signal gets
 * ignored. (`resolveOidSurface` already refuses to emit `OID001` without an
 * `importersOf`; the filter below states the same intent locally.) Those two are
 * emitted at stamp time instead, where the graph exists.
 */
export function oidSurfaceSourceConflicts(
  file: string,
  code: string,
): readonly OidSurfaceDiagnostic[] {
  const absFile = resolve(file);
  const evidence = sourceDialectEvidence(code);
  // OID003 is kept as well as OID004 here: with no graph, the only OID003s
  // `resolveOidSurface` can reach are its HOST-ELEMENT disagreements firing on
  // a file the manifest itself places (a root `entry`, or a declared
  // `include`/`mounts`) — genuine declaration-vs-source conflicts, graph-free by
  // construction. Each reports the stamp it produced, so nothing below repeats
  // them.
  const diagnostics = resolveOidSurface(absFile, code).diagnostics.filter(
    (diagnostic) => diagnostic.code === 'OID004' || diagnostic.code === 'OID003',
  );
  const direct = declaredSurfaceForProjectFile(absFile);
  // The leftover case those do not cover: an entry that IMPORTS the reconciler
  // while rendering no host element of EITHER dialect. A `dom`/`canvas` entry
  // that imports fiber for `addEffect`/`useFrame` and renders DOM elements has
  // no R3F element to fail to resolve; one that renders THREE objects is the
  // fatal-direction drift, already reported above.
  if (
    direct !== undefined &&
    direct !== 'three' &&
    evidence.reconcilerImport &&
    evidence.r3fOnlyTags.length === 0 &&
    evidence.domOnlyTags.length === 0
  ) {
    diagnostics.push({
      code: 'OID003',
      message:
        `${absFile} is declared as a \`${direct}\` root entry in vgai.project.json, but the file ` +
        `${evidenceSummary(evidence)}. The manifest wins (\`data-oid\` is stamped), so any R3F ` +
        'element here will not resolve to a selection. Declare a `three` root for the R3F part.',
    });
  }
  return diagnostics;
}

/** Warn-once keys, so a hot module re-transformed on every keystroke prints its
 *  diagnostic once per reason instead of once per edit. */
const reportedDiagnostics = new Set<string>();

/**
 * Print a decision's diagnostics to the dev server's terminal, once per
 * (file, code). `[ui-oid]` is the prefix the OID plugin's existing warnings
 * already use, so this lands in the same place an author is already reading
 * when `vgai edit` is running.
 */
export function reportOidSurfaceDiagnostics(
  decision: OidSurfaceDecision,
  warn: (message: string) => void = (message) => console.warn(message),
): void {
  for (const diagnostic of decision.diagnostics) {
    const key = `${decision.file}::${diagnostic.code}`;
    if (reportedDiagnostics.has(key)) continue;
    reportedDiagnostics.add(key);
    warn(`[ui-oid] ${diagnostic.code}: ${diagnostic.message}`);
  }
}
