/**
 * The creation-site registry — the host-side half of the index whose
 * source half is `server/creation-site-transform.ts`.
 *
 * ANTI-SHIM: the record NEVER touches the object. A `WeakMap` keyed by the
 * constructed object is the whole storage, so an ingested game cannot see that
 * it is being indexed — no new property, no symbol, no `userData` key, nothing
 * enumerable, nothing a `for…in`/`Object.keys`/JSON round-trip can pick up.
 * (This is the same rule the ingest adapter follows for its structural ids'
 * sole exception, `userData.entityId`, which is a deliberate, documented
 * identity tag; a provenance record has no such justification.)
 *
 * RESOURCE OWNERSHIP (brief-rule 4).
 *  - THE MAP is owned by this module and scoped to the editor page's realm.
 *    Every same-realm mount in the page shares it, which is correct: the
 *    stamped modules are ordinary modules in that one realm and their `new`
 *    expressions have exactly one place to report to.
 *  - IT IS NEVER CLEARED, deliberately. A `WeakMap` holds no strong reference,
 *    so a record dies with the object it describes — a game teardown that
 *    dropped its scene has already emptied the registry of everything that
 *    mattered. An explicit `clear()` on teardown would be a no-op dressed as
 *    cleanup, and it would be WRONG for the upgrade path, where a late-captured
 *    mount reuses objects constructed before the capture.
 *  - THE INSTALLED GLOBAL is the ownable resource, and it has one owner:
 *    `installGatedGameGlobals` (`gated-globals.ts`) installs it alongside the
 *    other `__vgai*` game-realm globals, once, at the same point in the
 *    lifecycle. {@link installCreationSiteRecorder} returns an uninstall for
 *    tests, which is the only caller that needs to take it back down.
 */

/** A source location a stamped `new` expression reported. */
export interface CreationSite {
  /** Project-root-RELATIVE path, POSIX separators (e.g. `src/scripts/sim/city.js`). */
  file: string;
  /** 1-based. */
  line: number;
  /** 0-based character offset. */
  col: number;
}

/**
 * What the read surfaces show for one object: either the anchor, or a NAMED
 * reason there is none. There is no third, blank state — an unanchored object
 * says why (the honest-floor rule).
 */
export type CreationSiteAnchor =
  | ({ anchored: true; kind: 'source'; display: string } & CreationSite)
  | { anchored: false; reason: string };

/** The reason for an object that exists but was not constructed by a `new`
 *  expression in a served project module — a three.js internal, a GLTF
 *  loader's mesh, anything from a bundled dependency. The anchoring does not
 *  reach these, so this is what the surfaces say, verbatim. */
export const UNANCHORED_REASON =
  'constructed outside project source (library internals or loader output)';

/** The reason for a selection with no live object behind it at all. */
export const NO_OBJECT_REASON = 'no live object for this selection';

const sites = new WeakMap<object, CreationSite>();

/**
 * How many objects each anchor has constructed — the MULTIPLICITY signal.
 *
 * SimCity builds all 256 tiles from one line (`const tile = new Tile(x, y)`,
 * `src/scripts/sim/city.js:59`), so "can this edit be written at its creation
 * site?" has a second answer beyond "is there a literal there": writing that
 * line would move every tile, and writing it for one tile is a lie about what
 * the source says. Nothing else in the system knows the count — the WeakMap
 * above is deliberately un-enumerable — so it is counted here, at the one place
 * every construction reports to.
 *
 * A PLAIN `Map`, not a WeakMap, and never decremented: the count is over
 * CONSTRUCTIONS, not live objects. That is the conservative direction — a site
 * that built and dropped a hundred objects still refuses, which costs a refusal
 * the user can read, where a count that forgot its history would eventually let
 * a shared site be written as if it were unique. It is keyed by the site string,
 * so it holds no reference to anything the game owns and cannot leak an object.
 */
const instances = new Map<string, number>();

function siteKey(site: CreationSite): string {
  return `${site.file}:${site.line}:${site.col}`;
}

/** The global name the served prelude calls through (must match
 *  `CREATION_SITE_GLOBAL` in `server/creation-site-transform.ts`; the pairing is
 *  asserted by `creation-site-registry.test.ts`). */
export const CREATION_SITE_GLOBAL = '__vgaiRecordCreationSite';

type Recorder = (o: unknown, file: string, line: number, col: number) => void;

/**
 * Record one construction. FIRST WRITE WINS: a constructor that returns an
 * already-registered object (a cache, a singleton, an interned value) must not
 * have its true creation site overwritten by the call site that merely asked
 * for it again.
 */
export function recordCreationSite(o: unknown, file: string, line: number, col: number): void {
  if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return;
  if (sites.has(o as object)) return;
  const site: CreationSite = { file, line, col };
  sites.set(o as object, site);
  const key = siteKey(site);
  instances.set(key, (instances.get(key) ?? 0) + 1);
}

/**
 * How many objects this anchor has constructed. `0` for a site nothing was ever
 * recorded at. Only `1` may be written by a single-object edit; a deliberate
 * creation-site-default edit may address the full count after naming it — see
 * `creation-site-edit.ts`'s `CreationSiteWriteScope`.
 */
export function instancesAtSite(site: CreationSite): number {
  return instances.get(siteKey(site)) ?? 0;
}

/** Test-only: forget every recorded construction count. The WeakMap needs no
 *  equivalent (it is collected with its keys) and deliberately has none. */
export function resetCreationSiteCountsForTest(): void {
  instances.clear();
}

/** The raw record for an object, or `null`. */
export function creationSiteOf(o: unknown): CreationSite | null {
  if (o === null || (typeof o !== 'object' && typeof o !== 'function')) return null;
  return sites.get(o as object) ?? null;
}

/** `src/scripts/sim/city.js:59` — the text the inspector shows and `vgai eval` reads. */
export function formatCreationSite(site: CreationSite): string {
  return `${site.file}:${site.line}`;
}

/**
 * The read-surface answer for one object: the anchor, or the named reason there
 * isn't one. `null`/a non-object means the caller had no live object to ask
 * about, which is a DIFFERENT honest answer from "the library built it".
 */
export function creationSiteAnchor(o: unknown): CreationSiteAnchor {
  if (o === null || o === undefined) return { anchored: false, reason: NO_OBJECT_REASON };
  const site = creationSiteOf(o);
  if (!site) return { anchored: false, reason: UNANCHORED_REASON };
  return { anchored: true, kind: 'source', ...site, display: formatCreationSite(site) };
}

/**
 * Publish {@link recordCreationSite} on `globalThis` for the served prelude.
 * Idempotent. Returns an uninstall — see the module header for who owns this.
 */
export function installCreationSiteRecorder(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[CREATION_SITE_GLOBAL];
  if (typeof existing === 'function') return () => {};
  const recorder: Recorder = recordCreationSite;
  g[CREATION_SITE_GLOBAL] = recorder;
  return () => {
    if (g[CREATION_SITE_GLOBAL] === recorder) delete g[CREATION_SITE_GLOBAL];
  };
}
