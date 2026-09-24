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

import { editorViewFromUrl } from '@volter/editor-sdk';
import { useEffect } from 'react';
import { activeProjectKey } from '@volter/editor-sdk/kit/active-project';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from './editor-shell-store';
import { presentEditorView } from './editor-view-presentation';
import { waitForWorkspaceStateRestore } from './workspace-state-persistence';

export function useSharedViewRestore(store: EditorShellStore): void {
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
