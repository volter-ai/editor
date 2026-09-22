/** Project authoring outlives its open viewport tabs, including an empty tab set. */
import { useEffect } from 'react';
import { retainProjectAuthoringSession } from '../authoring/project-authoring-session';
import { editorConsole } from '../editor-console';
import type { EditorShellStore } from '../editor-shell-store';

export function ProjectAuthoringBootstrap({ store }: { store: EditorShellStore }) {
  useEffect(() => {
    const session = retainProjectAuthoringSession(store);
    void session.ready.catch((error: unknown) => {
      editorConsole.error(
        `Authoring session failed: ${error instanceof Error ? error.message : String(error)}`,
        'authoring',
      );
    });
    return session.dispose;
  }, [store]);
  return null;
}
