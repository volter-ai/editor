/**
 * Format-neutral shell document operations.
 *
 * Save destination, save state, hierarchy rows and select-all are questions
 * about a DOCUMENT, and the shell owns none. Answering them from store fields
 * would bind the shell chrome — status bar, application menus, command relay,
 * hotkeys — to one format; these helpers ask the ACTIVE
 * {@link AuthoringAdapter} instead, so the same chrome works for a TSX/R3F
 * world, a React root, and an ingested game alike.
 */

import type { AuthoringAdapter, NodeCreationSite, WriteAnchorKind } from '@volter/editor-project/adapter';
import type { ShellDocumentState } from '../shell-document-state';
import { forEachHierarchyNode } from '../hierarchy-walk';
import { getActiveAuthoring } from './active-adapter';
import { saveAuthoringDocument, setAuthoringSelection } from './consumer-actions';
import { resolvePanelAuthoring } from './panel-authoring';

/** The authoring adapter owned by the active center document. This is the same
 * resolution used by Hierarchy and Inspector; shell commands must not keep
 * driving the scene adapter after an asset/source document becomes active. */
export function activeDocumentAuthoring(store: ShellDocumentState): AuthoringAdapter {
  return resolvePanelAuthoring(store).adapter;
}

/** One flattened hierarchy row — the wire shape `editor.hierarchy.inspect` reports. */
export interface ShellHierarchyRow {
  id: string;
  name: string;
  childIds: string[];
}

/**
 * The active adapter's hierarchy, flattened breadth-first to id/name/childIds
 * rows. `[]` when the adapter owns no tree (the no-authoring floor).
 */
export function activeHierarchyRows(store: ShellDocumentState): ShellHierarchyRow[] {
  const rows: ShellHierarchyRow[] = [];
  forEachHierarchyNode(activeDocumentAuthoring(store).hierarchy, (node) => {
    rows.push({ id: node.id, name: node.label, childIds: [...node.childIds] });
  });
  return rows;
}

/**
 * The source path represented by an adapter's document node.
 *
 * Source-authored adapters persist edits immediately and intentionally expose
 * no PersistenceProvider. Their hierarchy still owns an honest document node
 * whose secondary label is the project-relative source path (`src/world.tsx`,
 * for example). Prefer that source identity for document chrome instead of
 * leaking a composite persistence fallback such as "(no persistable child)".
 */
export function authoringDocumentSourcePath(adapter: AuthoringAdapter): string | null {
  let found: string | null = null;
  forEachHierarchyNode(adapter.hierarchy, (node) => {
    const sourcePath = node.secondaryLabel?.trim();
    if (node.role !== 'document' || !sourcePath) return;
    found = sourcePath;
    return false; // the first document row answers; never walk the whole tree for it
  });
  return found;
}

/** The active source-authored document path, when its adapter exposes one. */
export function activeDocumentSourcePath(store: ShellDocumentState): string | null {
  return authoringDocumentSourcePath(getActiveAuthoring(store));
}

/** The exact source filename represented by a project-relative path. */
export function sourceFileName(sourcePath: string | null | undefined): string | null {
  const trimmed = sourcePath?.trim();
  if (!trimmed) return null;
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

/**
 * Where a save would land, straight from the active adapter's
 * `PersistenceProvider`, or `null` when this adapter persists nothing.
 */
export function activeSaveDestination(store: ShellDocumentState): string | null {
  const adapter = getActiveAuthoring(store);
  return adapter.capabilities.persist ? (adapter.persistence?.destination ?? null) : null;
}

/**
 * Whether the active adapter has unsaved edits.
 *
 * A source-backed adapter may be clean because it rolled a failed write back.
 * Its provider still reports that failure until a later successful write
 * clears the project-history error; clean and successful are not synonyms.
 */
export function activeSaveState(store: ShellDocumentState): 'saved' | 'unsaved' | 'failed' {
  const persistence = getActiveAuthoring(store).persistence;
  if (persistence?.lastError?.()) return 'failed';
  return persistence?.isDirty() ? 'unsaved' : 'saved';
}

/** The active adapter's human-readable persistence failure, when any. */
export function activeSaveFailure(store: ShellDocumentState): string | null {
  return getActiveAuthoring(store).persistence?.lastError?.() ?? null;
}

/**
 * The creation-site anchor for the CURRENT selection, as the control
 * API reports it (`vgai status` / `vgai eval`'s `editor.status()`).
 *
 * `null` has one meaning and one only: there is nothing to ask about — no
 * selection, or an active adapter that indexes no creation sites. Whenever the
 * adapter DOES index them the answer is a record, anchored or reasoned; a
 * silent blank for "we couldn't find it" is exactly what the honest-floor rule
 * forbids.
 */
export function activeSelectionCreationSite(store: ShellDocumentState): NodeCreationSite | null {
  const adapter = activeDocumentAuthoring(store);
  const id = adapter.selection?.get()[0] ?? null;
  if (!id) return null;
  return adapter.truth?.resolve(id, 'position').site ?? null;
}

/**
 * The WRITE-side sibling of {@link activeSelectionCreationSite}: which lane
 * would carry an edit to the current selection (`WriteAnchorKind`).
 *
 * Reported beside the anchor because the anchor alone cannot answer it — two
 * subjects at the same kind of `file:line` can belong to different lanes with
 * different correctness contracts. A caller sweeping the hierarchy for one
 * subject per lane reads this per row; `vgai doctor`'s edit-write walk is that
 * caller, and it is what makes the walk exhaustive over the kinds a world has
 * instead of stopping at whichever row answered first.
 *
 * `null` on the same terms as the anchor: nothing selected, or an adapter that
 * plans no distinguishable lanes.
 *
 * READ THROUGH THE SAME BINDING THE WRITE TAKES ({@link activeDocumentAuthoring},
 * which is what `setActiveInspectionField` resolves too). A classifier reached
 * through a different resolver than the writer is how a subject came to be
 * reported in one lane while its edit travelled another.
 */
export function activeSelectionWriteAnchorKind(store: ShellDocumentState): WriteAnchorKind | null {
  const adapter = activeDocumentAuthoring(store);
  const id = adapter.selection?.get()[0] ?? null;
  if (!id) return null;
  return adapter.truth?.resolve(id, 'position').writeAnchorKind ?? null;
}

/** Current document-local selection, shared by UI actions and the control API. */
export function activeSelectionIds(store: ShellDocumentState): string[] {
  return [...(activeDocumentAuthoring(store).selection?.get() ?? store.selectedEntityIds)];
}

/** Route selection through the active document's native adapter. */
export function selectAuthoringNodes(store: ShellDocumentState, ids: readonly string[]): void {
  const adapter = activeDocumentAuthoring(store);
  if (!setAuthoringSelection(adapter, ids)) store.selectMultiple([...ids]);
}

/** Select every node the active adapter's hierarchy exposes. */
export function selectAllAuthoringNodes(store: ShellDocumentState): void {
  selectAuthoringNodes(
    store,
    activeHierarchyRows(store).map((row) => row.id),
  );
}

/** Save through the active adapter's persistence provider (no-op when it has none). */
export async function saveActiveAuthoring(store: ShellDocumentState): Promise<void> {
  await saveAuthoringDocument(getActiveAuthoring(store), 'the shell saved the active document');
}
