/**
 * DECLARED READINESS, per root — the facet that makes "is this game ready?" an
 * answer with a stated PROVENANCE instead of a host-side guess nobody can see.
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference". The question has
 * exactly three answerers, and this module is where each one's answer lands:
 *
 *   · `host-mount` — a HOST-MOUNTED (exported-composition) root. The host runs
 *     the mount, so mount completion IS readiness; no game code is needed and
 *     the answer is `declared` for every first-party project by construction.
 *   · `contract-ready` — a SELF-BOOTING game that declares
 *     `window.vgaiGame.ready` (`@volter/editor-project/adapter/ingest/game-contract`). Also
 *     `declared`: the game stated it.
 *   · `measured-wait` — a self-booting game that declares nothing. The measured
 *     waits remain (they are the documented fallback), and this is the whole
 *     point of the facet: that root reports `source: 'measured'`, so "nobody
 *     stated this" is a visible fact rather than silence.
 *
 * Published as the `readiness` facet of `/__editor/state`
 * (`command-listener.ts`'s `collectState`), which is what `vgai status` reads.
 */

import type {
  MountFailureKind,
  ReadinessSource,
} from '@volter/editor-project/adapter/ingest/mount-readiness';

/** How a root's readiness is answered. See this module's header for each. */
export type ReadinessMechanism = 'host-mount' | 'contract-ready' | 'measured-wait';

export interface RootReadiness {
  /** The manifest root id, as every other per-root facet names it. */
  readonly rootId: string;
  readonly mechanism: ReadinessMechanism;
  /** `declared` for `host-mount`/`contract-ready`, `measured` otherwise — the
   *  one field that makes a fallback legible as a fallback. */
  readonly source: ReadinessSource;
  /** `waiting` is a real state, not a missing answer: a self-booting game on a
   *  hidden tab parks there indefinitely and nothing is wrong. */
  readonly state: 'waiting' | 'ready' | 'failed';
  /** Which of M29's three blockers, for a `failed` root. */
  readonly failure?: MountFailureKind;
}

/**
 * RESOURCE OWNERSHIP: one entry per root, written by the mount path that owns
 * that root's lifecycle (`play-mode.ts` for host-mounted roots,
 * `authoring/ingest-root-adapter.ts` for self-booting ones) and cleared by that
 * same path's teardown. `clearRootReadiness` is per-root for the reason
 * `clearMountFailureReport` is: a composite manifest mounts roots
 * independently, and a blanket clear on one root's teardown would erase a
 * sibling's still-true answer.
 */
const _readiness = new Map<string, RootReadiness>();
let _snapshot: readonly RootReadiness[] = [];
const _listeners = new Set<() => void>();

function publish(): void {
  _snapshot = [..._readiness.values()];
  for (const listener of _listeners) listener();
}

/** `useSyncExternalStore`-compatible subscription for viewport explanations. */
export function subscribeRootReadiness(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export function recordRootReadiness(entry: RootReadiness): void {
  _readiness.set(entry.rootId, entry);
  publish();
}

export function clearRootReadiness(rootId: string): void {
  if (!_readiness.delete(rootId)) return;
  publish();
}

/** Test seam. Every production teardown clears PER ROOT (see the ownership note
 *  above), so nothing but a test has the whole map's lifetime to drop. */
export function clearAllRootReadiness(): void {
  if (_readiness.size === 0) return;
  _readiness.clear();
  publish();
}

/**
 * Every root's readiness, in the order they were recorded. `[]` means nothing
 * has mounted — deliberately NOT the same as "nothing is ready", which is what
 * a bare boolean would have said.
 */
export function readinessFacet(): readonly RootReadiness[] {
  return _snapshot;
}

/**
 * The one sentence a reader gets when a project's readiness is entirely
 * measured — i.e. no root stated it and every answer here is a host-side wait.
 * `null` when there is nothing to say (nothing mounted, or at least one root
 * declared), because a warning that fires on healthy projects is a warning
 * people learn to skip.
 */
export function measuredReadinessWarning(): string | null {
  const entries = readinessFacet();
  if (entries.length === 0) return null;
  const measured = entries.filter((entry) => entry.source === 'measured');
  if (measured.length === 0) return null;
  return (
    `${measured.length} of ${entries.length} root(s) have NO readiness declaration ` +
    `(${measured.map((entry) => entry.rootId).join(', ')}) — the host is measuring instead. ` +
    'A self-booting game states it with `window.vgaiGame.ready`.'
  );
}
