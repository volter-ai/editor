import type { AuthoringAdapter } from '@volter/editor-project/adapter';

/**
 * The inspection SUBJECT id — the selection resolution minus the adapter's
 * own boot state, and the ONE resolution `Inspector.tsx`,
 * `CompactInspectorCard.tsx` and the workspace host's availability gate all
 * read; two of these disagreeing is exactly how the editor booted with an
 * inspector the dock refused to mount (measured live, 2026-08-06).
 *
 * Explicit document contexts (model/source editors) remain sovereign, then
 * the shared EditorShellStore is the most recent user selection, then the
 * adapter's own selection — EXCEPT that an adapter which volunteers its
 * single hierarchy ROOT before the user has selected anything (the R3F world
 * binding does, so gizmo/hierarchy state has somewhere to live) is not
 * naming a subject: the root IS the document, and the document's inspector
 * representation is the surface's NO-SELECTION subject
 * (`inspection/null-subject.ts` — the same reading the dom provider applies
 * when it titles its empty state after its one root). A sovereign document
 * selection of the root and any user selection remain real subjects.
 *
 * "MOST RECENT" IS THE LAST ENTRY, and this read the FIRST until 2026-09-18.
 * The store's selection is an insertion-ordered `Set`, so `[0]` is the OLDEST
 * id in a multi-selection while the store's own `selectedEntityId` — what the
 * transform gizmo binds to — is `[...selection].at(-1)`. The two disagreed:
 * click A, ctrl-click B, and the gizmo moved to B while the inspector kept
 * showing A, with nothing on screen explaining either. One id now, which is
 * also what lets the Outliner mark its active row (`GameHierarchy.tsx`'s
 * `selectionAnchorId`). A single selection is a set of one and is unaffected.
 */
export function resolveInspectionSubjectId(
  documentSelection: { readonly nodeId: string | null } | null,
  storeSelection: ReadonlySet<string>,
  adapter: AuthoringAdapter,
): string | null {
  if (documentSelection) return documentSelection.nodeId;
  const stored = [...storeSelection].at(-1);
  if (stored) return stored;
  const volunteered = adapter.selection?.get().at(-1) ?? null;
  if (volunteered === null) return null;
  const roots = adapter.hierarchy.roots();
  return roots.length === 1 && roots[0]?.id === volunteered ? null : volunteered;
}
