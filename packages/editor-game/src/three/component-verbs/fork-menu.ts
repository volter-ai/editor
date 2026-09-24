/**
 * "Fork Component…" — the instance row's definition copy, registered through
 * the host's hierarchy contribution seam.
 *
 * Same split as `extract-menu.ts`, and the SAME structural locator probe:
 * `GameHierarchy` stays contract-only and never learns that a three world has
 * a component definition to copy; THIS module resolves the owning child
 * adapter (through the composite's `ownerOf`, not by decoding the id) and
 * probes it for the fork accessors. The applicability rule and every sentence
 * are pure and live in `@editor/instance-fork-actions`; the source rewrite
 * itself is pure and lives server-side in the host's
 * `ui-source/plan-fork-component.ts`.
 *
 * WHY IT REUSES THE SOURCE MENU's LOCATOR RESOLUTION rather than the
 * composite's routing (which `internals-menu.ts` can use): the fork accessors
 * are plain methods on the R3F adapter rather than routed contract members, so
 * asking the composite directly would ask the wrong object.
 */

import { getActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import { instanceSourceLocatorFor } from '@volter/editor-core/authoring/instance-source-menu';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { registerHierarchyMenuItems } from '@volter/editor-core/hierarchy-menu-registry';
import {
  canForkInstance,
  FORK_COMPONENT_LABEL,
  type InstanceForkSource,
} from '../../host/instance-fork-actions';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';

/** The fork surface for `nodeId`, or `null` — the host's own owner walk. */
export function instanceForkSourceFor(
  adapter: AuthoringAdapter,
  nodeId: string,
): InstanceForkSource | null {
  return instanceSourceLocatorFor(adapter, nodeId) as InstanceForkSource | null;
}

function forkable(store: EditorShellStore, nodeId: string): boolean {
  const adapter = getActiveAuthoring(store);
  return canForkInstance(
    adapter.hierarchy.node(nodeId),
    instanceForkSourceFor(adapter, nodeId),
    nodeId,
  );
}

let unregister: (() => void) | null = null;

/** Idempotent install of the fork item (see `component-verbs.service.ts`). */
export function ensureInstanceForkMenuRegistered(): void {
  if (unregister) return;
  unregister = registerHierarchyMenuItems(
    ({ nodeId, store }) => forkable(store, nodeId),
    ({ nodeId, store }) => {
      const source = instanceForkSourceFor(getActiveAuthoring(store), nodeId);
      return [
        {
          label: FORK_COMPONENT_LABEL,
          action: () => {
            // Every outcome — created, refused by the plan, refused by
            // transport, or created-but-not-retargeted — comes back as a
            // sentence from the adapter. Nothing here invents wording, and no
            // click is silent.
            void source?.forkComponent?.(nodeId).then(showTransientHint);
          },
        },
      ];
    },
  );
}

/** Drop the registration — the service contribution's stop. */
export function unregisterInstanceForkMenu(): void {
  unregister?.();
  unregister = null;
}
