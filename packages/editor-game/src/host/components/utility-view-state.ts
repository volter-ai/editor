/**
 * Selected view for each bottom-drawer utility that hosts more than one
 * instrument.
 *
 * Every store is the usual `useSyncExternalStore` triple (subscribe, version,
 * active) plus `open`, which selects the view AND reveals its own utility
 * through the semantic dock command. Callers name the utility they mean:
 * `profilerView` is the engine instrument bench (Profiler/Frame).
 *
 * A game's own faces are deliberately not among them. They are PROJECT
 * contributions — the game's own vendored source, mounted through the
 * contribution registries — and a contribution owns whatever state it needs
 * inside its own module, so there is nothing for this editor-owned store to
 * hold on its behalf. This store survives on the host side only because HOST
 * chrome reads it: the header heartbeat and the Game toolbar's Capture frame
 * button both select a view of a bench that now ships in `@volter/editor-game`.
 */

import { showWorkspaceUtility } from '@volter/editor-sdk/kit/workspace-host-commands';

export type ProfilerViewId = 'profiler' | 'frame';

export interface UtilityViewState<T extends string> {
  subscribe(listener: () => void): () => void;
  /** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
  version(): number;
  active(): T;
  select(view: T): void;
  /** Select the view and reveal its utility in the bottom region. */
  open(view: T): void;
  /** Re-publish without changing the view (state this store carries beside
   *  the selected view, e.g. the selected machine, notifies through here). */
  notify(): void;
  reset(): void;
}

function createUtilityViewState<T extends string>(
  utilityId: string,
  initial: T,
): UtilityViewState<T> {
  let active = initial;
  let version = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const select = (view: T) => {
    if (active === view) return;
    active = view;
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    active: () => active,
    select,
    open(view) {
      select(view);
      showWorkspaceUtility(utilityId);
    },
    notify,
    reset() {
      active = initial;
      notify();
    },
  };
}

/** Engine instruments: the Profiler and the single-frame draw-call capture. */
export const profilerView = createUtilityViewState<ProfilerViewId>(
  // The bench is `@volter/editor-game`'s `profiler.utility` contribution, so its
  // registered id carries the host's `tool:` namespace. This store stays on
  // the host side because host chrome reads it (`HeaderTelemetry`'s heartbeat,
  // the Game toolbar's Capture frame button).
  'tool:profiler.utility',
  'profiler',
);

export function __resetUtilityViewStateForTest(): void {
  profilerView.reset();
}
