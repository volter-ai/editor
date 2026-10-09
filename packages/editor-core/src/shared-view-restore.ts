/**
 * A SHARED VIEW LINK, restored once the session's own restore has settled.
 *
 * `editorViewFromUrl` reads the view a share link carries; presenting it has
 * to wait for the workspace's documents, or the presentation lands on a
 * document that is about to be replaced. It lives beside the editor rather
 * than inside a layout because there is exactly ONE layout host now
 * (`frame/bridge.tsx`) and a hook a layout owns is a hook one layout can
 * forget: this is the session's behaviour, called from the one workspace that
 * exists.
 */

import { editorViewFromUrl } from '@volter/sdk';
import { useEffect } from 'react';
import { activeProjectKey } from '@volter/sdk/kit/active-project';
import { editorConsole } from '@volter/sdk/kit/editor-console';
import type { ShellStore } from '@volter/sdk/kit/shell-store';
import { presentEditorView } from '@volter/sdk/kit/editor-view-presentation';
import { restorePinnedWorkspaceDocumentActivation } from '@volter/sdk/kit/workspace-document-registry';
import { PINNED_ASYNC_DOCUMENT_IDS } from '@volter/sdk/kit/workspace-document-ids';
import { waitForWorkspaceStateRestore } from './workspace-state-persistence';

export function useSharedViewRestore(store: ShellStore): void {
  useEffect(() => {
    const view = editorViewFromUrl(window.location.href);
    if (!view) return;
    let disposed = false;
    const project = activeProjectKey();
    const current = () => !disposed && activeProjectKey() === project;
    void waitForWorkspaceStateRestore()
      .then(() => {
        if (current()) return presentEditorView(store, view, { updateUrl: false, origin: 'link' });
      })
      .catch((error) => {
        // A BOARD THAT REGISTERS LATE is not a broken link. The UI board exists once story
        // discovery has published, which waits on the first model frame — after this
        // restore's window. The workspace restore REMEMBERS such an id and activates it
        // when it opens; a shared view of one does the same instead of failing (measured
        // 2026-10-08: every start whose last view was the UI board logged "Could not
        // restore shared editor view" and showed the model instead).
        const document = view.document;
        if (current() && document?.kind === 'workspace' && PINNED_ASYNC_DOCUMENT_IDS.has(document.id)) {
          restorePinnedWorkspaceDocumentActivation(document.id);
          return;
        }
        editorConsole.error(
          `Could not restore shared editor view: ${error instanceof Error ? error.message : String(error)}`,
          'editor',
        );
      });
    return () => {
      disposed = true;
    };
  }, [store]);
}
