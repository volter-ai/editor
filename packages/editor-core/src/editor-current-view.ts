import { type EditorView, editorViewUrl, isEditorViewUtility } from '@volter/editor-sdk';
import { documentViewport } from '@volter/editor-sdk/kit/document-viewports';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { activeEditorKeymap } from './keymap-presets';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { activeWorkspaceStaticPanel, activeWorkspaceUtility } from './workspace-host-commands';
import { activeEditorWorkspace } from './workspace-presets';
import { activeWorkspaceStyleId } from './workspace-style';

/** Inverse of `revealUtility` (editor-view-presentation.ts): map the live
 *  utility id back into `@volter/editor-sdk`'s public link vocabulary — one of
 *  the editor's own named instruments, or a `tool:` tab a package or the open
 *  project contributes. A live utility the vocabulary cannot name (the story
 *  addons) reads as no utility rather than as a fabricated one. */
function presentedUtility(): EditorView['utility'] {
  const utility = activeWorkspaceUtility();
  return utility && isEditorViewUtility(utility) ? utility : undefined;
}

/** Derive the projection from live document/session state. This is the
 * inverse of presentEditorView, not a cache of the last agent request. */
export function currentEditorView(store: ShellStore): EditorView {
  const active = activeWorkspaceDocument();
  const document = active?.descriptor.presentation?.() ?? undefined;
  // The stage showing the active document answers for its viewport
  // (`@volter/editor-sdk/kit/document-viewports`), and for its selection when
  // it keeps its own; a document with no viewport has neither.
  const stage = documentViewport(active?.descriptor.id);
  const documentSelection = activeWorkspaceDocumentSelection();
  const selected = stage?.selection
    ? stage.selection.read()
    : (documentSelection?.adapter?.selection?.get() ?? (stage ? [...store.selectedEntityIds] : []));
  const viewport: EditorView['viewport'] = stage?.read() ?? undefined;
  const utility = presentedUtility();
  // The static panel holding the dock's focus, straight from the dock's own
  // active-panel readout — the inverse of `revealStaticPanel`.
  const panel = activeWorkspaceStaticPanel();
  return {
    version: 1,
    workspace: activeEditorWorkspace(),
    ...(activeWorkspaceStyleId() === null ? {} : { style: activeWorkspaceStyleId() as string }),
    keymap: activeEditorKeymap(),
    ...(document ? { document } : {}),
    ...(selected.length > 0 ? { selection: { ids: [...selected] } } : {}),
    ...(viewport ? { viewport } : {}),
    ...(panel ? { panel } : {}),
    ...(utility ? { utility } : {}),
  };
}

export function currentEditorViewUrl(store: ShellStore): string {
  return editorViewUrl(currentEditorView(store), window.location.href);
}
