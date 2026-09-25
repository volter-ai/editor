/**
 * THE ONE RESOLVER for "which region — and therefore which surface/dialect —
 * does THIS EXACT source file belong to?"
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference": the system answers
 * a question by reading a DECLARATION, walking GROUND TRUTH, or diagnosing
 * declared-vs-measured drift loudly. Guessing a fact the game's author could
 * have stated is a defect whose fix is a declaration slot, never a better
 * heuristic.
 *
 * A file's region is derived from **which region's IMPORT CLOSURE reaches it**.
 * That is a load-bearing reference in the doctrine's own sense — the region's
 * manifest root entry is what the host EXECUTES at mount, so the reach cannot
 * drift: the game would break first. It is not a convention, not a folder
 * rule, and not a property of the file's own bytes.
 *
 * Precedence, and there are only three rungs:
 *
 *   1. **Declared include** — a region's `include` globs name this file
 *      outright, or one of its `mounts` does
 *      (`@volter/editor-project/adapter/adapter-module`'s `AdapterRegion.include` /
 *      `AdapterRegion.mounts`). A first-party statement about this exact file
 *      wins over everything, and a root that mounts more than one surface is
 *      how a file lands on a surface its root's manifest entry does not name.
 *   2. **Root entry** — this file IS a region's entry; the manifest decides.
 *   3. **Import-graph reach** — every region whose entry reaches this file
 *      through the live import graph. Reach through several regions of the
 *      SAME surface is unambiguous (that surface). Reach through regions of
 *      DIFFERING surfaces, or through NONE at all, is `ambiguous` — and the
 *      caller reports it rather than guessing, because no answer derived from
 *      this file alone can be right for both.
 *
 * What is deliberately NOT a rung: the file's own source TEXT. Four separate
 * per-file text sniffs used to decide this (a reconciler-import substring, an
 * R3F-intrinsic regex, a DOM-intrinsic regex, a `@pixi/react` substring), and
 * every one of them was silent when wrong. The measured cost is recorded on
 * `r3f-project-contracts.ts`'s options type: a project whose 138 components
 * take their prop shape from one shared module had 12 files pass the import
 * sniff and 126 silently skipped, reported as "no findings". Reach answers all
 * 138, because reach does not care where a project centralizes its imports.
 *
 * Deliberately DEPENDENCY-FREE and SYNCHRONOUS — no `node:fs`, no `node:path`,
 * no bundler alias resolution — because its callers span all three tiers: a
 * Vite `transform` hook (sync, per project `.tsx`), the dev server's HMR
 * classifier, and the browser-hosted editor's own Content index. Filesystem
 * questions ("is this file a root's entry?") are injected as
 * {@link FileRegionInput.regionOfEntry}, answered by whichever tier is asking.
 */

/**
 * Mirrors `@volter/editor-project/adapter/adapter-surface`'s `AdapterSurface` vocabulary as a
 * bare literal union rather than importing it, for the same reason
 * `oid-transform.ts` does: this module is imported where no alias resolution is
 * available. Structurally identical; a caller holding the real
 * `AdapterSurface` may pass it directly.
 */
export type RegionSurface = 'three' | 'canvas' | 'dom';

/**
 * The subset of `AdapterRegion` this resolver reads. Structural rather than
 * imported so a page pays nothing for the engine's Zod schema; the loader
 * hands its real regions straight in.
 */
export interface RegionBinding {
  readonly id: string;
  readonly surface: RegionSurface;
  /** Project-relative globs this region OWNS — see `AdapterRegion.include`. */
  readonly include?: readonly string[];
  /**
   * Surfaces this root mounts BESIDE {@link RegionBinding.surface}, each with
   * the files that render on it — see `AdapterRegion.mounts`. Together with
   * `surface` this is the root's full mounted surface set, and it is the ONLY
   * way a file can be placed on a surface its root's manifest entry does not
   * name.
   */
  readonly mounts?: readonly RegionMountBinding[];
}

/** One additional mounted surface of a region — see `AdapterRegion.mounts`. */
export interface RegionMountBinding {
  readonly surface: RegionSurface;
  readonly include: readonly string[];
}

/** How {@link resolveFileRegion} reached its answer. */
export type FileRegionVia =
  /** A region's `include` glob names this file. */
  | 'declared-include'
  /** This file IS a region's root entry. */
  | 'root-entry'
  /** Exactly one surface reachable through the live import graph. */
  | 'import-graph'
  /** Nothing placed it — the caller applies its documented default, loudly. */
  | 'ambiguous';

/** Why an answer is {@link FileRegionVia} `'ambiguous'`. */
export type FileRegionAmbiguity =
  /** No region entry reaches this file (and none declares it). */
  | 'unreached'
  /** Reached from regions of DIFFERING surfaces — undecidable, by anyone. */
  | 'differing-surfaces';

export interface FileRegionAnswer {
  /** The region's surface, or `undefined` when the answer is ambiguous. */
  readonly surface?: RegionSurface;
  /** The owning region id when one file→region assignment settled it. */
  readonly regionId?: string;
  readonly via: FileRegionVia;
  /** Distinct surfaces the import-graph walk reached — named by diagnostics. */
  readonly reached: readonly RegionSurface[];
  readonly ambiguity?: FileRegionAmbiguity;
}

/**
 * Look up the modules that import a given (absolute) file id. Shaped
 * structurally after Vite's `ModuleGraph`/`ModuleNode` so no tier has to import
 * `vite` to satisfy it; `undefined` means "no graph available", which every
 * caller already treats the same as "no importers found".
 */
export type ImportersOf = (absFile: string) => Iterable<string> | undefined;

export interface FileRegionInput {
  /** Absolute path of the file being placed. */
  readonly file: string;
  /**
   * The same file as the PROJECT-RELATIVE path an `include` glob is written
   * against. Omit when the caller has no project root (an ad-hoc transform, a
   * file outside any project) — declared includes are then simply not
   * consulted, which is the honest read of "there is no project to declare".
   */
  readonly projectRelative?: string;
  /** The loaded adapter's regions. Empty/omitted = pure reach. */
  readonly regions?: readonly RegionBinding[];
  /**
   * "Is THIS file a region's root entry, and which one?" — the filesystem half,
   * injected because it differs per tier (a manifest walk on the dev server, the
   * loaded manifest in the browser).
   */
  readonly regionOfEntry: (file: string) => RegionBinding | undefined;
  /** The live import graph, when the calling tier has one. */
  readonly importersOf?: ImportersOf;
}

/**
 * Translate ONE glob segment-vocabulary pattern into a `RegExp`.
 *
 * `**` matches any number of segments (including none, so `src/**` names `src`
 * itself); `*` matches within one segment; `?` matches one character. Every
 * other character is literal — regex metacharacters are escaped, so a pattern
 * is never accidentally a regex.
 */
function globToRegExp(glob: string): RegExp {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `a/**/b` must also match `a/b`: swallow the following slash.
        out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 3 : 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

/** Normalize a project-relative path to the form globs are written against. */
function normalizeRelative(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
}

/** True when `relativePath` matches any of `globs`. Exported for the resolver's
 *  own tests and for callers that report which glob claimed a file. */
export function matchesAnyGlob(relativePath: string, globs: readonly string[]): boolean {
  const normalized = normalizeRelative(relativePath);
  return globs.some((glob) => globToRegExp(normalizeRelative(glob)).test(normalized));
}

/** What a declaration says about one file: which region owns it, and on which
 *  of that region's mounted surfaces it renders. */
interface DeclaredClaim {
  readonly surface: RegionSurface;
  readonly regionId: string;
}

/**
 * The single declaration that names `projectRelative`, or `undefined`.
 *
 * A region claims a file through its own `include` (its PRIMARY surface) or
 * through one of its `mounts` (an ADDITIONAL surface that same root mounts —
 * the R3F world whose game also adopts a DOM HUD). Both are first-party
 * statements about this exact file and neither outranks the other.
 *
 * TWO claims on one file is a contradiction in the game's own declaration, not
 * something to resolve by array order — whether they come from two regions or
 * from one region's `include` and its own mount. It answers `undefined` so the
 * file falls through to reach and, failing that, to the caller's loud ambiguous
 * path.
 */
function declaredClaim(
  projectRelative: string | undefined,
  regions: readonly RegionBinding[],
): DeclaredClaim | undefined {
  if (projectRelative === undefined) return undefined;
  const claims: DeclaredClaim[] = [];
  for (const region of regions) {
    if (region.include !== undefined && matchesAnyGlob(projectRelative, region.include)) {
      claims.push({ surface: region.surface, regionId: region.id });
    }
    for (const mount of region.mounts ?? []) {
      if (matchesAnyGlob(projectRelative, mount.include)) {
        claims.push({ surface: mount.surface, regionId: region.id });
      }
    }
  }
  return claims.length === 1 ? claims[0] : undefined;
}

/**
 * Bounded BFS up the import graph from `absFile`, collecting the surface of
 * every region entry reachable through it.
 *
 * A project's import graph is finite and shallow in practice (a handful of hops
 * from any component to its world entry); the depth cap only keeps a
 * pathological or cyclic graph from spinning.
 *
 * Ordering rationale for why a "cold graph" is not a live risk in Vite's dev
 * pipeline: a child module's own `transform` hook runs only once the browser
 * requests it, and the browser requests it only because its PARENT's transform
 * already ran and import-analysis already rewrote the parent's specifiers —
 * which is exactly when the parent→child edge is registered. By the time a
 * file's own transform fires, every importer that caused it to be requested has
 * a graph node. The one case with no importers is a region's OWN entry, and
 * that is answered by rung 2 without the graph at all.
 */
function reachedSurfaces(
  absFile: string,
  importersOf: ImportersOf,
  regionOfEntry: (file: string) => RegionBinding | undefined,
): Set<RegionSurface> {
  const visited = new Set<string>([absFile]);
  const found = new Set<RegionSurface>();
  let frontier: string[] = [absFile];
  for (let depth = 0; depth < 64 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const importer of importersOf(id) ?? []) {
        if (!importer || visited.has(importer)) continue;
        visited.add(importer);
        const region = regionOfEntry(importer);
        if (region) found.add(region.surface);
        else next.push(importer);
      }
    }
    frontier = next;
  }
  return found;
}

/** The ONE file→region decision, in its three rungs. */
export function resolveFileRegion(input: FileRegionInput): FileRegionAnswer {
  const regions = input.regions ?? [];

  const declared = declaredClaim(input.projectRelative, regions);
  if (declared) {
    return {
      surface: declared.surface,
      regionId: declared.regionId,
      via: 'declared-include',
      reached: [],
    };
  }

  const entry = input.regionOfEntry(input.file);
  if (entry) {
    return { surface: entry.surface, regionId: entry.id, via: 'root-entry', reached: [] };
  }

  const reached = input.importersOf
    ? [...reachedSurfaces(input.file, input.importersOf, input.regionOfEntry)]
    : [];
  if (reached.length === 1) {
    return { surface: reached[0]!, via: 'import-graph', reached };
  }
  return {
    via: 'ambiguous',
    reached,
    ambiguity: reached.length > 1 ? 'differing-surfaces' : 'unreached',
  };
}
