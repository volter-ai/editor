/**
 * Workspace STATUS-CONTRIBUTION registry (W0 — the shell-contract slice of
 * §9 W0). "Status is status, not a command" (§1.5): save/dirty/failure
 * state, problem counts, connection/play state, build progress, and concise
 * selection information belong in a narrow status bar — not mixed into the
 * global command header and not spread across viewport overlays.
 *
 * Consumed since W4 by `components/StatusBar.tsx` (rendered under the
 * bottom dock/drawer strip); the core contributions live in
 * `components/status-contributions.tsx` (+ `build-documents.tsx`'s
 * `build-progress`). Migration map.
 *
 * Idioms mirror `inspector-section-registry.ts`: module-scope state,
 * `useSyncExternalStore`-shaped subscribe + monotonic version,
 * `__resetForTest`, pure-logic headless tests (`Content` is never rendered
 * here). Ids key persisted/status-bar slots, so duplicates throw (same rule
 * as `workspace-utility-registry.ts`).
 */

import type { ComponentType } from 'react';

/** The §7 status contribution contract: one compact status-bar item. */
export interface WorkspaceStatusContribution {
  /** Stable id — keys the status-bar slot (`data-testid`). */
  readonly id: string;
  /**
   * WHAT A PERSON CALLS IT. Required, because the status bar this draws into
   * is the workbench's and `IStatusbarEntry.name` is required there: it is the
   * label in the bar's own right-click menu (`Hide <item>`) and the entry's
   * aria label. Before it existed every contribution passed its raw id, so the
   * menu read `tool:blender.status`, `console-counts`, `play-state` beside VS
   * Code's own `Remote Host` and `Problems` (walk 4, 2026-09-20).
   *
   * Title Case, and a NOUN — it names the thing, not what it is doing right
   * now: the CONTENT changes, this does not.
   */
  readonly name: string;
  /** Which end of the bar (§4.1: session state left, selection info right).
   *  Default `'left'`. */
  readonly align?: 'left' | 'right';
  /** Slot order within its side (ascending; ties keep registration order).
   *  Default `0`. */
  readonly order?: number;
  /** React content host — compact, passive, non-command (§1.5). Never
   *  rendered by the registry itself. */
  readonly Content: ComponentType;
}

// --- Module-scope state (mirrors inspector-section-registry.ts) -----------

interface StoredContribution {
  readonly contribution: WorkspaceStatusContribution;
  readonly seq: number;
}

let _contributions: StoredContribution[] = [];
let _seq = 0;
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to (un)registrations. Returns an unsubscribe function. */
export function subscribeWorkspaceStatus(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function workspaceStatusRegistryVersion(): number {
  return _version;
}

/**
 * Register a status contribution. Returns an unregister function.
 * Throws on a duplicate id (ids key status-bar slots — same uniqueness rule
 * as `registerWorkspaceUtility`).
 */
export function registerWorkspaceStatus(contribution: WorkspaceStatusContribution): () => void {
  if (_contributions.some((c) => c.contribution.id === contribution.id)) {
    throw new Error(
      `registerWorkspaceStatus: id "${contribution.id}" is already registered — ` +
        'status ids key status-bar slots, so they must be unique; unregister the ' +
        'previous contribution first.',
    );
  }
  const stored: StoredContribution = { contribution, seq: _seq++ };
  _contributions = [..._contributions, stored];
  notifyChanged();
  return () => {
    if (!_contributions.includes(stored)) return;
    _contributions = _contributions.filter((c) => c !== stored);
    notifyChanged();
  };
}

/** Registered contributions for one side of the bar, in (order,
 *  registration-sequence) order; with no argument, both sides (left first). */
export function workspaceStatusContributions(
  align?: 'left' | 'right',
): WorkspaceStatusContribution[] {
  const side = (want: 'left' | 'right') =>
    [..._contributions]
      .filter((c) => (c.contribution.align ?? 'left') === want)
      .sort((a, b) => (a.contribution.order ?? 0) - (b.contribution.order ?? 0) || a.seq - b.seq)
      .map((c) => c.contribution);
  if (align) return side(align);
  return [...side('left'), ...side('right')];
}

/** Test-only reset (mirrors `__resetInspectorSectionRegistryForTest`). */
export function __resetWorkspaceStatusRegistryForTest(): void {
  _contributions = [];
  _seq = 0;
  notifyChanged();
}
