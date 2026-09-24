/**
 * THE SCENE DOCUMENT (`@volter/editor-sdk/services`, a `workspace.service`
 * contribution). The kit routes every three root's edit document to
 * `workspace:scene` and no longer synthesizes it: what that document shows is
 * the project's world, mounted by the game runtime this package carries, so
 * the document is this package's (`src/host/components/scene-document.tsx`).
 *
 * The session store arrives after the contribution pass, and a project switch
 * brings a new one, so the document binds on each store's ARRIVAL
 * (`@volter/editor-core/shell-store-door`'s `onShellStore`, as Play's
 * autoplay entry does) and unbinds the previous store's binding first.
 */
import { onShellStore } from '@volter/editor-core/shell-store-door';
import { unregisterAvailableWorkspaceDocument } from '@volter/editor-core/workspace-available-documents';
import { SCENE_DOCUMENT_ID } from '@volter/editor-core/workspace-document-ids';
import { bindSceneDocument } from '../src/host/components/scene-document';

export const point = 'workspace.service';

export function start(): () => void {
  let unbind: (() => void) | null = null;
  const stopStore = onShellStore((store) => {
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
