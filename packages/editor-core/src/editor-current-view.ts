import { type EditorView, editorViewUrl, isEditorViewUtility } from '@volter/editor-sdk';
import { object3DDocumentSession } from './authoring/object3d-document-session-registry';
import type { EditorShellStore } from './editor-shell-store';
import { activeEditorKeymap } from './keymap-presets';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentSelection,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { activeWorkspaceStaticPanel, activeWorkspaceUtility } from './workspace-host-commands';
import { activeEditorWorkspace } from './workspace-presets';
import { activeWorkspaceStyleId } from './workspace-style';

function cameraState(
  position: readonly [number, number, number] | { x: number; y: number; z: number },
  target: readonly [number, number, number] | { x: number; y: number; z: number },
  fov?: number,
) {
  const vector = (value: typeof position) =>
    'x' in value
      ? { x: value.x, y: value.y, z: value.z }
      : { x: value[0]!, y: value[1]!, z: value[2]! };
  return { position: vector(position), target: vector(target), ...(fov ? { fov } : {}) };
}

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
export function currentEditorView(store: EditorShellStore): EditorView {
  const active = activeWorkspaceDocument();
  const document = active?.descriptor.presentation?.() ?? undefined;
  const session = active ? object3DDocumentSession(active.descriptor.id) : null;
  const documentSelection = activeWorkspaceDocumentSelection();
  const selected = session
    ? session.selection()
    : (documentSelection?.adapter?.selection?.get() ??
      (active?.descriptor.id === 'workspace:scene' ? [...store.selectedEntityIds] : []));
  let viewport: EditorView['viewport'];
  if (session) {
    const pose = session.cameraPose();
    const presentation = session.presentation();
    viewport = {
      camera: cameraState(pose.position, pose.target, pose.fov),
      diagnostic: presentation.skeleton ? 'skeleton' : presentation.mode,
      grid: presentation.grid,
    };
  } else if (active?.descriptor.id === 'workspace:scene' && store.cameraPose) {
    const pose = store.cameraPose;
    viewport = {
      camera: cameraState(pose.position, pose.target, pose.fov),
      diagnostic: store.shadingMode,
      grid: store.showGrid,
    };
  }
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

export function currentEditorViewUrl(store: EditorShellStore): string {
  return editorViewUrl(currentEditorView(store), window.location.href);
}
