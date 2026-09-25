/**
 * NoAuthoringAdapter — what the editor can honestly offer over a mounted root
 * that exposes no authoring surface at all.
 *
 * A `{ module }` adapter is free to publish nothing authorable: it mounts, it
 * draws, and the host has no tree to bind the hierarchy/inspector/gizmo to.
 * Rather than hide that root, or fabricate a surface for it, this adapter
 * advertises exactly what is true — one informational hierarchy node and all
 * `capabilities` false — so the editor's generic panels render an honest
 * nothing-to-author state instead of pretending to edit.
 */

import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  EditorNode,
  HierarchyProvider,
} from '@volter/editor-project/adapter';
import type { ShellDocumentState } from '@volter/editor-sdk/kit/shell-document-state';

/** The one hierarchy row this adapter publishes. Exported because it is a
 *  MESSAGE, not an entity: a surface that lists entities (the command palette)
 *  has to be able to tell it apart from a thing a person can select. */
export const NO_AUTHORING_ID = 'no-authoring:root';

export function makeNoAuthoringAdapter(
  store: ShellDocumentState,
  label: string,
  secondaryLabel = 'No authoring surface',
): AuthoringAdapter {
  const node: EditorNode = {
    id: NO_AUTHORING_ID,
    label,
    secondaryLabel,
    role: 'boundary',
    kind: 'object',
    parentId: null,
    childIds: [],
  };
  const hierarchy: HierarchyProvider = {
    roots: () => [node],
    node: (id) => (id === NO_AUTHORING_ID ? node : null),
    // No `object3D`/`idForObject3D`: there is no reachable Object3D to offer.
  };
  const capabilities: AuthoringCapabilities = {
    transform: false,
    inspectorFields: false,
    persist: false,
  };
  return {
    capabilities,
    hierarchy,
    selection: {
      get: () => [...store.selectedEntityIds],
      set: (ids) => store.selectMultiple(ids),
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}
