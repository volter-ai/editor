/**
 * "Extract Component…" — the native row's structural extraction, registered
 * through the host's hierarchy contribution seam.
 *
 * The fork menu's mirror (`fork-menu.ts`), reusing the host's locator
 * resolution for the same reason it does: the extract accessors are plain
 * methods on the R3F adapter rather than routed contract members, so ownership
 * is resolved through the composite's public `ownerOf` walk and the owning
 * child is probed directly. The applicability rule and every sentence are pure
 * and live in `@editor/instance-extract-actions`; the source rewrite is pure
 * and lives server-side in the host's `ui-source/plan-extract-component.ts`.
 */

import { getActiveAuthoring } from '@editor/authoring/active-adapter';
import { instanceSourceLocatorFor } from '@editor/authoring/instance-source-menu';
import type { EditorShellStore } from '@editor/editor-shell-store';
import { registerHierarchyMenuItems } from '@editor/hierarchy-menu-registry';
import {
  canExtractNode,
  EXTRACT_COMPONENT_LABEL,
  type InstanceExtractSource,
} from '@editor/instance-extract-actions';
import { showTransientHint } from '@editor/transient-hint';
import type { AuthoringAdapter } from '@vgai/project/adapter';

/** The extract surface for `nodeId`, or `null` — the host's own owner walk. */
export function instanceExtractSourceFor(
  adapter: AuthoringAdapter,
  nodeId: string,
): InstanceExtractSource | null {
  return instanceSourceLocatorFor(adapter, nodeId) as InstanceExtractSource | null;
}

function extractable(store: EditorShellStore, nodeId: string): boolean {
  const adapter = getActiveAuthoring(store);
  return canExtractNode(
    adapter.hierarchy.node(nodeId),
    instanceExtractSourceFor(adapter, nodeId),
    nodeId,
  );
}

let unregister: (() => void) | null = null;

/** Idempotent install of the extract item (see `component-verbs.service.ts`). */
export function ensureInstanceExtractMenuRegistered(): void {
  if (unregister) return;
  unregister = registerHierarchyMenuItems(
    ({ nodeId, store }) => extractable(store, nodeId),
    ({ nodeId, store }) => {
      const source = instanceExtractSourceFor(getActiveAuthoring(store), nodeId);
      return [
        {
          label: EXTRACT_COMPONENT_LABEL,
          action: () => {
            // Every outcome — created, refused by the plan, refused by
            // transport, or created-but-not-replaced — comes back as a
            // sentence from the adapter. No click is silent.
            void source?.extractComponent?.(nodeId).then(showTransientHint);
          },
        },
      ];
    },
  );
}

/** Drop the registration — the service contribution's stop. */
export function unregisterInstanceExtractMenu(): void {
  unregister?.();
  unregister = null;
}
