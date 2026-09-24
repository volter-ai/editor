/** Session attachment for contributed center documents.
 * Document owners register their own content and initial documents. The host
 * does not synthesize a Scene tab or own a game's root evaluator.
 */
import { useEffect } from 'react';
import type { EditorShellStore } from '../editor-shell-store';
import { bindLiveDocument, syncLiveDocumentPlayState } from '../live-document';
import { closeAllWorkspaceDocuments } from '@volter/editor-sdk/kit/workspace-document-registry';

export function useCenterDocuments(store: EditorShellStore): void {
  useEffect(() => {
    const unbind = bindLiveDocument({ onActivate: () => store.setActiveViewportTab('play') });
    const sync = () => syncLiveDocumentPlayState(store.playState !== 'stopped');
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      unbind();
      closeAllWorkspaceDocuments();
    };
  }, [store]);
}
