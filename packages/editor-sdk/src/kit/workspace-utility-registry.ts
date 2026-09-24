/**
 * Workspace UTILITY registry (W0 — the shell-contract slice of §9 W0).
 * Utilities are the TRANSIENT output/debug surfaces of §1.4/§5: Console,
 * Problems, Build Output, Dev, and story-scoped addon results. They live in
 * the on-demand bottom utility region — never substantial editors, which are
 * documents (`workspace-document-registry.ts`).
 *
 * On-demand is about the TAB: a registration with no materialized tab has no
 * presence at all. Once a tab EXISTS — pre-registered here, contributed by
 * the open project, or introduced by background activity through
 * `ensureWorkspaceUtility` — the region stays on screen COLLAPSED to its own
 * tab strip, so the tab and its badge are discoverable while the body stays
 * closed until the tab is clicked (the layout host owns that presentation).
 *
 * The layout host pre-registers default-visible tabs in a
 * zero-footprint hidden host. Semantic commands and actionable failures reveal
 * that host directly. Other registrations
 * are created on demand (built-ins register via
 * `components/core-utilities.tsx`; migration map).
 *
 * Registrations declare a `section` (`core` | `project`, default `core`) —
 * the editor's own instruments versus the open game's plane. It is the OUTER
 * sort key, so the drawer's tab strip renders the two as visually separated
 * clusters (`utilitySectionBoundaryId` names the divider's position). It is
 * presentation within the one bottom group; it is not a second dock.
 *
 * Idioms mirror `inspector-section-registry.ts`: module-scope state,
 * `useSyncExternalStore`-shaped subscribe + monotonic version,
 * `__resetForTest`, pure-logic headless tests (`Content` is never rendered
 * here). Unlike that registry, utility ids KEY tabs (test ids, persisted
 * drawer state), so duplicate registration is a programming error and
 * throws.
 */

import type { ComponentType } from 'react';

/** Attention badge a utility surfaces when its host is open; persistent
 *  signals such as Console errors are also projected into the status bar. */
export interface WorkspaceUtilityBadge {
  readonly count: number;
  readonly severity: 'info' | 'warn' | 'error';
}

/**
 * Which audience a utility belongs to, and therefore which cluster of the
 * drawer's tab strip it sits in.
 *
 *  - `core` — the EDITOR's own instruments (Console, Animation, Profiler,
 *    Network, Audio…). Present in every project.
 *  - `project` — the GAME's own plane: one tab per `workspace.utility` tool
 *    contribution the open project ships (`tool-loader.ts` registers them
 *    under `tool:<contributionId>`). Which tabs exist depends entirely on the
 *    open game, so this cluster is empty for a project that contributes none.
 */
export type WorkspaceUtilitySection = 'core' | 'project';

const SECTION_RANK: Record<WorkspaceUtilitySection, number> = { core: 0, project: 1 };

/** The §7 utility contribution contract. */
export interface WorkspaceUtilityRegistration {
  /** Stable id — keys the drawer tab (`data-testid`, persisted layout). */
  readonly id: string;
  /** Tab label (§8 naming: `Build Output`, not `Build`). */
  readonly title: string;
  /** Tab-strip cluster. Default `'core'` — a contribution that says nothing
   *  is one of the editor's own instruments. */
  readonly section?: WorkspaceUtilitySection;
  /** React content host. Never rendered by the registry itself. */
  readonly Content: ComponentType;
  /** Tab order among registered utilities (ascending; ties keep
   *  registration order). Default `0`. */
  readonly order?: number;
  /** Session-scoped availability — e.g. Network exists only while a live
   *  session exposes the owning adapter (§5 "play-only bottom utility").
   *  Default: always available. */
  readonly available?: () => boolean;
  /** Optional attention badge for the tab (may return `null` for none). */
  readonly badge?: () => WorkspaceUtilityBadge | null;
  /** Subscribe to the source read by `badge()`. Dynamic badges must provide
   * this together with `badgeSnapshot` so a dock tab updates while its panel
   * is collapsed. */
  readonly subscribeBadge?: (listener: () => void) => () => void;
  /** Stable `useSyncExternalStore` snapshot for `subscribeBadge`. */
  readonly badgeSnapshot?: () => number;
  /** Whether the tab is pre-registered in the clean layout's hidden utility
   * host. Defaults to `true`; this does not make the host itself visible.
   * Event/output surfaces can remain discoverable while creating their tab
   * only after an explicit command or relevant activity. */
  readonly visibleByDefault?: boolean;
  /** Whether a revealed utility tab may be closed. Defaults to `false`. */
  readonly closeable?: boolean;
}

// --- Module-scope state (mirrors inspector-section-registry.ts) -----------

interface StoredUtility {
  readonly registration: WorkspaceUtilityRegistration;
  readonly seq: number;
}

let _utilities: StoredUtility[] = [];
let _seq = 0;
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to (un)registrations. Returns an unsubscribe function. */
export function subscribeWorkspaceUtilities(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function workspaceUtilityRegistryVersion(): number {
  return _version;
}

/**
 * Register a utility contribution. Returns an unregister function.
 * Throws on a duplicate id — utility ids key tabs and persisted layout, so
 * two live registrations sharing one id is always a bug (re-registration
 * flows, e.g. project-tool HMR, unregister first — tool-loader's own
 * discipline).
 */
export function registerWorkspaceUtility(registration: WorkspaceUtilityRegistration): () => void {
  if (_utilities.some((u) => u.registration.id === registration.id)) {
    throw new Error(
      `registerWorkspaceUtility: id "${registration.id}" is already registered — ` +
        'utility ids key drawer tabs and persisted layout, so they must be unique; ' +
        'unregister the previous contribution first.',
    );
  }
  const stored: StoredUtility = { registration, seq: _seq++ };
  _utilities = [..._utilities, stored];
  notifyChanged();
  return () => {
    if (!_utilities.includes(stored)) return;
    _utilities = _utilities.filter((u) => u !== stored);
    notifyChanged();
  };
}

/** A registration's cluster, defaulting to the editor's own instruments. */
export function workspaceUtilitySection(
  registration: WorkspaceUtilityRegistration,
): WorkspaceUtilitySection {
  return registration.section ?? 'core';
}

function sorted(): WorkspaceUtilityRegistration[] {
  return [..._utilities]
    .sort(
      (a, b) =>
        // Section is the OUTER key: the two clusters never interleave, so the
        // tab strip's divider is a single boundary rather than a repeated one.
        SECTION_RANK[workspaceUtilitySection(a.registration)] -
          SECTION_RANK[workspaceUtilitySection(b.registration)] ||
        (a.registration.order ?? 0) - (b.registration.order ?? 0) ||
        a.seq - b.seq,
    )
    .map((u) => u.registration);
}

/**
 * The id of the tab the `project` cluster STARTS at, for a given rendered tab
 * order — i.e. the first project-section utility that some core-section
 * utility precedes. `null` when the order has no such boundary (one cluster
 * only, or the project cluster leads). Pure: the caller passes the list it is
 * actually rendering, which after a user tab-drag need not be registry order.
 */
export function utilitySectionBoundaryId(
  utilities: readonly WorkspaceUtilityRegistration[],
): string | null {
  let sawCore = false;
  for (const utility of utilities) {
    if (workspaceUtilitySection(utility) === 'core') {
      sawCore = true;
      continue;
    }
    if (sawCore) return utility.id;
  }
  return null;
}

/**
 * Where a NEWLY ADDED utility tab belongs among the tabs already in the
 * drawer, per registry order — the count of existing tabs that sort at or
 * before it. Registrations arrive at different times (core utilities at
 * module init, project-tool contributions after the async tool load), so
 * appending would interleave the clusters by arrival order; inserting at
 * this index makes any arrival order converge to registry order. Ids the
 * registry no longer knows (a stale persisted tab) sort AFTER every known
 * one, and an unknown `id` appends. Pure: the caller passes the tab ids it
 * is actually hosting, which after a user drag need not be registry order —
 * rank-counting still yields a stable, in-bounds index there.
 */
export function utilityInsertionIndex(
  existingIds: readonly string[],
  id: string,
): number | undefined {
  const rank = new Map(availableWorkspaceUtilities().map((utility, index) => [utility.id, index]));
  const target = rank.get(id);
  if (target === undefined) return undefined;
  let index = 0;
  for (const existing of existingIds) {
    const existingRank = rank.get(existing);
    if (existingRank !== undefined && existingRank <= target) index += 1;
  }
  return index;
}

/** Every registered utility, in (order, registration-sequence) order. */
export function registeredWorkspaceUtilities(): WorkspaceUtilityRegistration[] {
  return sorted();
}

/** The registered utilities whose `available()` currently returns true
 *  (guarded: a THROWING `available` counts as unavailable — a broken
 *  contribution must not take the drawer down; same failure physics as
 *  tool-loader's match guard). */
export function availableWorkspaceUtilities(): WorkspaceUtilityRegistration[] {
  return sorted().filter((u) => {
    if (!u.available) return true;
    try {
      return u.available();
    } catch {
      return false;
    }
  });
}

/** Order-preserving fingerprint of the available utility ids — a stable
 *  STRING, so `useAvailabilitySelector` consumers (the dock's reconciler)
 *  re-render only when the available SET changes, not on every 250ms tick. */
export function availableUtilityFingerprint(): string {
  return availableWorkspaceUtilities()
    .map((u) => u.id)
    .join('\n');
}

/** A utility's current badge (guarded: a throwing `badge` yields `null`). */
export function workspaceUtilityBadge(id: string): WorkspaceUtilityBadge | null {
  const found = _utilities.find((u) => u.registration.id === id);
  if (!found?.registration.badge) return null;
  try {
    return found.registration.badge();
  } catch {
    return null;
  }
}

/** Test-only reset (mirrors `__resetInspectorSectionRegistryForTest`). */
export function __resetWorkspaceUtilityRegistryForTest(): void {
  _utilities = [];
  _seq = 0;
  notifyChanged();
}
