/**
 * Editor-session authoring bootstrap readiness.
 *
 * The workspace restores before a project's async authoring adapter
 * necessarily exists. During that interval, "no Inspector subject" is UNKNOWN rather
 * than a final answer: destructively reconciling it removes the user's saved
 * Inspector group, and the later adapter mount can only recreate that group
 * at its default position. This tiny project-keyed signal lets workspace
 * geometry preserve optional authoring chrome until the real adapter has
 * answered once. State is keyed by the session's ShellStore, so closing
 * and reopening the same project cannot inherit a previous mount's readiness.
 */

import type { ShellStore } from '../shell-store';

type BootstrapState = {
  readonly generation: number;
  readonly settled: boolean;
};

const states = new WeakMap<ShellStore, BootstrapState>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Begin one bootstrap generation and return its race-safe completion hook. */
export function beginAuthoringBootstrap(store: ShellStore): () => void {
  const generation = (states.get(store)?.generation ?? 0) + 1;
  states.set(store, { generation, settled: false });
  notify();
  return () => {
    const current = states.get(store);
    if (!current || current.generation !== generation || current.settled) return;
    states.set(store, { generation, settled: true });
    notify();
  };
}

/** False before this project's first real adapter bootstrap has completed. */
export function authoringBootstrapSettled(store: ShellStore): boolean {
  return states.get(store)?.settled === true;
}

export function subscribeAuthoringBootstrap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
