/**
 * THE SCENE DOCUMENT (`@volter/editor-sdk/services`, a `workspace.service`
 * contribution). The kit routes every three root's edit document to
 * `workspace:scene` and no longer synthesizes it: what that document shows is
 * the project's world, mounted by the game runtime this package carries, so
 * the document is this package's (`src/host/components/scene-document.tsx`).
 *
 * The session store arrives after the contribution pass, and a project switch
 * brings a new one, so the document binds on each store's ARRIVAL
 * (`@volter/editor-sdk/kit/shell-store-door`'s `onShellStore`, as Play's
 * autoplay entry does) and unbinds the previous store's binding first.
 */
import { unregisterAvailableWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-available-documents';
import { SCENE_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { bindSceneDocument } from '../src/host/components/scene-document';
import { onThreeStore } from '@volter/editor-threejs/kit/three-state';

export const point = 'workspace.service';

export function start(): () => void {
  let unbind: (() => void) | null = null;
  const stopStore = onThreeStore((store) => {
    unbind?.();
    unbind = bindSceneDocument(store);
  });
  return () => {
    stopStore();
    unbind?.();
    unbind = null;
    unregisterAvailableWorkspaceDocument(SCENE_DOCUMENT_ID);
  };
}
