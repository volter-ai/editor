/**
 * Mount-failure report — D-W3: every manifest world's auto-launch route
 * degrades to exactly one `editorConsole.error` line today (§0.4 — ground
 * truth: the default Untitled scene is already showing by the time a manifest
 * route fails, so a broken world mounts to what LOOKS like a normal empty
 * project). This module is the structured half of the fix: a global mount-
 * failure slot every manifest-route catch block populates.
 *
 * WHERE IT SHOWS — there is ONE error home, the editor's bottom surface, and
 * this slot rides it rather than owning a surface of its own:
 *
 *   1. the `editorConsole.error` line each route already writes (the full
 *      trace lives there, and the status bar's `console-counts` counts it);
 *   2. the status bar's `mount-failure` contribution
 *      (`../components/status-contributions.tsx`) — a sticky, danger-toned
 *      "N worlds failed to mount" item that names each world in its title and
 *      opens the Console on click. Sticky is the point: a dead world stays
 *      dead until it is fixed, so unlike a transient hint this item persists
 *      until the slot clears;
 *   3. the Console utility is REVEALED on the empty→failing edge
 *      (`../workspace-utility-commands.ts`'s auto-open policy, the same one a
 *      failed build uses) — that reveal is what makes a mount failure loud
 *      without a second surface, and it is why the Console not being the
 *      default bottom tab is no longer an argument for one.
 *
 * A separate top-of-shell banner used to render this slot. It was a SECOND
 * error home — users had to learn two places to look — and it is gone.
 *
 * D-V5 (composite): a composite manifest (one ingest world + siblings,
 * `ingest-siblings.ts`) can fail SEVERAL roots independently in one mount
 * attempt (a `default-three` sibling, a throwing `default-react` sibling, …)
 * — a single-slot "last failure wins" model would silently drop every failure
 * but the latest, the exact F9 anti-pattern this module exists to close. The
 * slot is an ORDERED LIST: `addMountFailureReport` (deduped by `worldId` — a
 * re-attempt for the SAME world replaces that world's entry in place, keeping
 * list order stable), `getMountFailureReports()`,
 * `clearMountFailureReports()`.
 *
 * The slot owns its own `subscribe` (same shape as
 * `../asset-workflow/asset-materialization-report.ts`) rather than
 * piggybacking on `EditorShellStore.subscribe`: the readers are no longer
 * mounted inside a store-subscribed panel, and the per-world clears
 * (`clearMountFailureReport`) run from root-level lifecycles that do not all
 * broadcast a store notification. `getMountFailureReports()` returns a frozen
 * snapshot whose identity changes only when the list does, so it is a valid
 * `useSyncExternalStore` getSnapshot.
 */

/** One manifest world's mount failure — the exact fields the status item shows. */
export interface MountFailureReport {
  /** The failing world's manifest id (`ResolvedAdapterRoot.id`), or the
   *  vendored/fixture route's discovered game/folder id. */
  readonly worldId: string;
  /** The world's render substrate kind (`ResolvedAdapterRoot.kind`, e.g.
   *  `'three'`/`'canvas'`/`'react'`) — or, for the URL-fallback route
   *  (which has no `ResolvedAdapterRoot` to read a kind from), the same
   *  vocabulary inferred from which fixture glob resolved the id. */
  readonly kind: string;
  /** The resolved adapter identity (`ResolvedAdapter['identity']` — e.g.
   *  `'ingest-three'`/`'ingest-pixi'`/`'ingest-react'`/`'module'`). */
  readonly identity: string;
  /** The caught error's message — never the raw `Error` object (never
   *  fabricated; empty only if the thrown value truly stringifies empty). */
  readonly message: string;
}

/** D-V5: an ORDERED list now backs the slot (insertion order — the order
 *  roots actually failed in, which for a composite's sibling loop is
 *  manifest order). Every accessor below is a thin view over this same
 *  array — never a second, parallel source of truth. Replaced wholesale
 *  rather than mutated so the snapshot identity is a real change signal. */
let _reports: readonly MountFailureReport[] = [];
const _listeners = new Set<() => void>();

function notify(): void {
  for (const listener of _listeners) listener();
}

/** `useSyncExternalStore`-compatible subscribe for the status contribution
 *  and the Console auto-open policy. */
export function subscribeToMountFailures(callback: () => void): () => void {
  _listeners.add(callback);
  return () => {
    _listeners.delete(callback);
  };
}

/**
 * D-V5: append one world's failure, deduped by `worldId` — a re-attempt for
 * a world that already has an entry REPLACES it in place (keeps list order
 * stable: retrying world B in `[A, B]` yields `[A, B']`, never `[A, B]` moved
 * to the end).
 */
export function addMountFailureReport(report: MountFailureReport): void {
  const index = _reports.findIndex((r) => r.worldId === report.worldId);
  if (index === -1) {
    _reports = [..._reports, report];
  } else {
    const next = [..._reports];
    next[index] = report;
    _reports = next;
  }
  notify();
}

/** D-V5: every mount failure from the current attempt, oldest first. */
export function getMountFailureReports(): readonly MountFailureReport[] {
  return _reports;
}

/** Drop every recorded failure — what a successful mount (or a torn-down
 *  session, which has nothing left to report) calls. */
export function clearMountFailureReports(): void {
  if (_reports.length === 0) return;
  _reports = [];
  notify();
}

/**
 * PD-1: drop ONE world's recorded failure — what a route that mounts a single
 * world calls after that world mounts successfully.
 *
 * `clearMountFailureReports()` above is the whole-attempt reset an ingest/
 * module route can afford because it owns the entire mount. The R3F design
 * session and the design-time layer loop do NOT: they mount roots
 * independently, so a blanket clear on one root's success would erase a
 * SIBLING root's still-true failure — the exact D-V5 drop the ordered list
 * exists to prevent. Keyed by the same `worldId` `addMountFailureReport`
 * dedupes on, and a no-op when that world has no entry.
 *
 * Not clearing at all is what PD-1 measured: an R3F world that failed to mount
 * once kept reporting that failure through `vgai status`'s "MOUNT FAILED —
 * THIS WORLD IS NOT RUNNING" line (and the in-editor surface) for the rest of
 * the page's life, including while the very same world was mounted and
 * PLAYING. A diagnostic that cannot go back to healthy is worse than none.
 */
export function clearMountFailureReport(worldId: string): void {
  const index = _reports.findIndex((r) => r.worldId === worldId);
  if (index === -1) return;
  _reports = _reports.filter((_, i) => i !== index);
  notify();
}

/**
 * Build a `MountFailureReport['message']` from a caught value the same way
 * every route's existing `editorConsole.error` line already stringifies it
 * (`` `...failed: ${err}` `` — kept byte-for-byte at each call site so the
 * console's full trace is unchanged) — an `Error`'s own `.message` reads
 * better in a one-line summary than its `String(err)` form (`"Error: <msg>"`),
 * so the report uses this instead of the console's template-literal form.
 */
export function formatMountFailureMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
