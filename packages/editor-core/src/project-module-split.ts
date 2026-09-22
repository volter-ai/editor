/**
 * PD-3's runtime backstop: DETECT a cross-root module split and report it
 * LOUDLY, so the next one can never be silent the way the measured one was
 * ("HUD rendered defaults forever while `game.state()` moved; no error, no
 * warning").
 *
 * `project-module-url.ts` removes the deterministic CAUSE (one mount epoch
 * shared by every root's entry url). This module is the tripwire for whatever
 * that guarantee does not cover — a future root resolver that hand-builds a
 * url, a `/@fs//doubled-slash` form reappearing, a symlink-uncanonical root,
 * or a source edit landing between two roots' transforms inside one mount.
 *
 * HOW IT MEASURES, and why this observable and not another
 * --------------------------------------------------------
 * Browser ES-module identity is per-URL and a module is EVALUATED exactly
 * once per url, so "two live instances of one file" is exactly "two distinct
 * urls for one file were fetched as modules". Resource Timing already records
 * every one of those fetches with a timestamp, which makes the whole check a
 * pure function over `performance.getEntriesByType('resource')` — no
 * instrumentation injected into project code, no per-module cost, and
 * trivially unit-testable against a synthetic entry list.
 *
 * The window matters, and is what keeps this SOUND rather than noisy:
 *
 *  - Counting over the whole session would fire on every healthy remount —
 *    an edited module legitimately gets a new `?t=` url each mount, and the
 *    superseded instance's fetch stays in the timeline forever.
 *  - Counting only fetches made DURING one mount cannot false-positive: a
 *    single mount has no legitimate reason to evaluate one file twice. A file
 *    reused from the browser's module registry is not re-fetched, so it never
 *    inflates the count.
 *
 * The cost of that soundness is the honest gap recorded here: the ONE case
 * this cannot see is a root that reuses a cached module while a sibling
 * evaluates a fresh one (the original PD-3 shape) — the cached side performs
 * no fetch at all. That case is closed by construction upstream, in
 * `project-module-url.ts`; this module is deliberately the second line, not
 * the first.
 */

/** The Resource Timing fields this module reads — declared structurally so a
 *  test can hand over a plain array and so nothing here depends on the DOM
 *  lib's `PerformanceResourceTiming`. */
export interface ResourceTimingLike {
  readonly name: string;
  readonly startTime: number;
}

/** One file that was evaluated more than once inside a single mount. */
export interface ProjectModuleSplit {
  /** The file's path (query stripped) — the `/@fs/…` pathname as fetched, so
   *  it names the module the way every other editor/dev-server message does. */
  readonly path: string;
  /** Every distinct url the file was fetched under during the window, in
   *  fetch order. Always length >= 2. */
  readonly urls: readonly string[];
}

/** Module-graph extensions vite serves for a NON-module purpose — the same
 *  file legitimately produces a different module for each of these, so two
 *  urls differing only by one of them is not a split. */
const NON_MODULE_QUERY_KEYS = new Set(['raw', 'url', 'worker', 'sharedworker', 'inline', 'init']);

import { PROJECT_MOUNT_QUERY } from '@volter/editor-sdk/session/project-module-url';

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const STORY_MODULE_PATTERN = /\.stories\.[cm]?[jt]sx?$/i;

function pathAndQuery(name: string): { path: string; query: string } | null {
  // Resource Timing `name` is an absolute url. Parsing against a fixed base
  // keeps this pure (no `window.location` read) and works for both forms.
  let parsed: URL;
  try {
    parsed = new URL(name, 'http://vgai.invalid');
  } catch {
    return null;
  }
  return { path: parsed.pathname, query: parsed.search };
}

function isNonModuleQuery(query: string): boolean {
  const params = new URLSearchParams(query);
  for (const key of params.keys()) {
    if (NON_MODULE_QUERY_KEYS.has(key)) return true;
  }
  return false;
}

/**
 * The pure half: given the Resource Timing entries of one mount window and
 * the project's absolute root, return every project file fetched under more
 * than one url.
 *
 * `projectRoot` is matched against the `/@fs/`-mounted pathname, which is how
 * every project module the editor imports is served in dev. A project served
 * some other way simply yields no candidates — an empty result, never a
 * fabricated one.
 */
/** The one candidate test: is this fetch a MODULE of the project under test?
 *  Split out so the grouping loop stays one thing. */
function projectModuleFetch(
  entry: ResourceTimingLike,
  root: string,
  since: number,
): { group: string; path: string; url: string } | null {
  if (entry.startTime < since) return null;
  const parts = pathAndQuery(entry.name);
  if (!parts) return null;
  const { path, query } = parts;
  if (!path.includes(root)) return null;
  if (!MODULE_EXTENSIONS.some((ext) => path.endsWith(ext))) return null;
  // Portable CSF is a design-time document, not part of a mounted root's
  // runtime module graph. Story discovery deliberately gives every refresh a
  // fresh `?t=` URL (`stories/story-discovery.ts`), and a board refresh may
  // overlap this Play mount window. Counting that intentional reload as a
  // cross-root split makes a healthy multi-root game report an error even
  // though every root entry still shares the one `vgai-mount` epoch.
  if (STORY_MODULE_PATTERN.test(path)) return null;
  if (isNonModuleQuery(query)) return null;
  // The mount id is not a variant of a module — it names WHICH INSTANCE's copy
  // this is, and per-instance module graphs are the isolation working (see
  // ARCHITECTURE-CORE §Multiplayer authoring). Two instances fetch every
  // project module under different urls BY DESIGN, so comparing across them
  // would report the entire project as split the moment a second one mounts —
  // every module, every time, on the loudest diagnostic in the play path.
  // Group per instance instead: the question this watch asks ("did the roots
  // of one mount fail to share a module?") is a per-instance question. With
  // one instance — every mount today — there is one group and nothing changes.
  const params = new URLSearchParams(query);
  const mount = params.get(PROJECT_MOUNT_QUERY) ?? '';
  params.delete(PROJECT_MOUNT_QUERY);
  const rest = params.toString();
  return {
    group: `${mount}\u0000${path}`,
    path,
    url: `${path}${rest ? `?${rest}` : ''}`,
  };
}

export function findProjectModuleSplits(
  resources: readonly ResourceTimingLike[],
  opts: { readonly projectRoot: string; readonly since: number },
): ProjectModuleSplit[] {
  const root = opts.projectRoot.endsWith('/') ? opts.projectRoot.slice(0, -1) : opts.projectRoot;
  if (root.length === 0) return [];
  const byGroup = new Map<string, { path: string; urls: string[] }>();

  for (const entry of resources) {
    const fetched = projectModuleFetch(entry, root, opts.since);
    if (!fetched) continue;
    const seen = byGroup.get(fetched.group);
    if (seen === undefined) byGroup.set(fetched.group, { path: fetched.path, urls: [fetched.url] });
    else if (!seen.urls.includes(fetched.url)) seen.urls.push(fetched.url);
  }

  const splits: ProjectModuleSplit[] = [];
  for (const { path, urls } of byGroup.values()) {
    if (urls.length > 1) splits.push({ path, urls });
  }
  return splits;
}

/**
 * The message a split is reported with. Pure (and exported) so the wording is
 * a testable contract rather than an inline string: a silent split is the
 * entire defect, so the report has to NAME the module and show the two urls
 * that prove it.
 */
export function formatProjectModuleSplitMessage(split: ProjectModuleSplit): string {
  return (
    `Cross-root module split: ${split.path} was loaded ${split.urls.length} times in one mount, ` +
    'so each root holds its OWN copy of its module-level state (a `let` written by one root is ' +
    'invisible to the other). Urls: ' +
    split.urls.join('  |  ')
  );
}

// ---------------------------------------------------------------------------
// The stateful half — one mount window, and the reports it produced
// ---------------------------------------------------------------------------

interface PerformanceLike {
  now(): number;
  getEntriesByType(type: string): ResourceTimingLike[];
}

function performanceHost(): PerformanceLike | null {
  const candidate = (globalThis as { performance?: unknown }).performance;
  if (!candidate || typeof candidate !== 'object') return null;
  const perf = candidate as Partial<PerformanceLike>;
  if (typeof perf.now !== 'function' || typeof perf.getEntriesByType !== 'function') return null;
  return perf as PerformanceLike;
}

// Capture this diagnostic window independently of the browser's bounded
// Resource Timing history. Module lookup is owned by the game realm.
let resourceObserver: PerformanceObserver | null = null;
let windowResources: ResourceTimingLike[] = [];

let windowStart: number | null = null;
let reports: ProjectModuleSplit[] = [];

/** Open the mount window. Called immediately before a composition's roots are
 *  resolved/imported; clears the previous mount's reports so the diagnostic
 *  can always go back to healthy (the PD-1 lesson — a report that cannot
 *  clear itself is worse than none). */
export function beginProjectModuleSplitWatch(): void {
  reports = [];
  resourceObserver?.disconnect();
  resourceObserver = null;
  windowResources = [];
  const perf = performanceHost();
  if (!perf) {
    windowStart = null;
    return;
  }
  windowStart = perf.now();
  if (typeof PerformanceObserver !== 'undefined') {
    resourceObserver = new PerformanceObserver((list) => {
      windowResources.push(...list.getEntries());
    });
    resourceObserver.observe({ type: 'resource' });
  }
}

/**
 * Close the mount window and record what it found. Called after every root
 * has mounted (not merely resolved) so a root that imports its entry lazily
 * inside `mount()` is inside the window too. Returns the reports so the
 * caller can log them; a no-op window (no `performance`, or no `begin`) is an
 * empty result, never a guess.
 */
export function endProjectModuleSplitWatch(projectRoot: string): readonly ProjectModuleSplit[] {
  const perf = performanceHost();
  if (!perf || windowStart === null) {
    windowStart = null;
    return reports;
  }
  const entries = resourceObserver
    ? [...windowResources, ...resourceObserver.takeRecords()]
    : perf.getEntriesByType('resource');
  resourceObserver?.disconnect();
  resourceObserver = null;
  windowResources = [];
  reports = findProjectModuleSplits(entries, {
    projectRoot,
    since: windowStart,
  });
  windowStart = null;
  return reports;
}

/** What the last closed mount window found — `[]` on a healthy mount. Read by
 *  `command-listener.ts`'s `collectState` so `vgai status` carries it. */
export function getProjectModuleSplitReports(): readonly ProjectModuleSplit[] {
  return reports;
}

/** Drop every recorded split — what a torn-down play session calls. */
export function clearProjectModuleSplitReports(): void {
  resourceObserver?.disconnect();
  resourceObserver = null;
  windowResources = [];
  reports = [];
  windowStart = null;
}
