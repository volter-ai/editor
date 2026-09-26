/**
 * "Reveal Internals" / "Hide Internals" — the instance row's toggle,
 * registered through the host's hierarchy contribution seam.
 *
 * Same split as `extract-menu.ts`: `GameHierarchy` stays contract-only and
 * never learns that a three world has hidden internals; THIS module probes the
 * active adapter for the optional capability and owns the session state. The
 * projection math and the read-only rule are pure and stay in the HIERARCHY
 * PANEL's own modules (`@editor/hierarchy-internals`,
 * `@editor/hierarchy-row-model`), which the panel itself reads while rendering
 * — `components/GameHierarchy.tsx:158` imports `internalsProjection` and
 * `applyRevealExpansionDefaults` directly. The projection is the panel's; only
 * the MENU that toggles it is this lane's.
 *
 * NO OWNER WALK IS NEEDED HERE (unlike the source menu's
 * `instanceSourceLocatorFor`): the composite ROUTES
 * `hasInternals`/`internalChildren` to the owning child by `route(id)`, so
 * probing the active adapter is already asking the right one.
 */

import { getActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import {
  type InternalsSource,
  internalsProjection,
  isInternalsRevealed,
  revealedInternalsIds,
  toggleInternalsRevealed,
} from '@volter/editor-sdk/kit/hierarchy-internals';
import { registerHierarchyMenuItems } from '@volter/editor-sdk/kit/hierarchy-menu-registry';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';

/** Menu capitalization follows the panel's Title Case idiom (`Rename`,
 *  `Go to Callsite`). */
export const REVEAL_INTERNALS_LABEL = 'Reveal Internals';
export const HIDE_INTERNALS_LABEL = 'Hide Internals';

/**
 * Whether THIS row may be revealed/hidden.
 *
 * Two conditions, and the second is the one that is easy to miss: the row must
 * hide something (`hasInternals`), and the row must not ITSELF be a revealed
 * internal. An internal row's own children are already on screen — the reveal
 * walk is transitive — so offering "Reveal Internals" there would be a toggle
 * with no effect and a second, meaningless piece of state.
 */
export function internalsToggleFor(
  adapter: AuthoringAdapter,
  nodeId: string,
): { label: string; toggle: () => void } | null {
  const source = adapter as unknown as InternalsSource;
  if (typeof source.hasInternals !== 'function' || !source.hasInternals(nodeId)) return null;
  if (internalsProjection(source, revealedInternalsIds()).isInternal(nodeId)) return null;
  return {
    label: isInternalsRevealed(nodeId) ? HIDE_INTERNALS_LABEL : REVEAL_INTERNALS_LABEL,
    toggle: () => {
      toggleInternalsRevealed(nodeId);
    },
  };
}

let unregister: (() => void) | null = null;

/** Idempotent install of the internals item (see `component-verbs.service.ts`). */
export function ensureInstanceInternalsMenuRegistered(): void {
  if (unregister) return;
  unregister = registerHierarchyMenuItems(
    ({ nodeId, store }) => internalsToggleFor(getActiveAuthoring(store), nodeId) !== null,
    ({ nodeId, store }) => {
      const entry = internalsToggleFor(getActiveAuthoring(store), nodeId);
      if (!entry) return [];
      return [
        {
          label: entry.label,
          action: () => {
            entry.toggle();
            // The revealed set is module state the panel reads while rendering;
            // this is the notify every source-write path already uses to make
            // the hierarchy re-read its world.
            store.notifyIngestEdit();
          },
        },
      ];
    },
  );
}

/** Drop the registration — the service contribution's stop. */
export function unregisterInstanceInternalsMenu(): void {
  unregister?.();
  unregister = null;
}
