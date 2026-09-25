/** Project authoring outlives its open viewport tabs, including an empty tab set. */
import { useEffect } from 'react';
import { retainProjectAuthoringSession } from '../authoring/project-authoring-session';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';

export function ProjectAuthoringBootstrap({ store }: { store: ShellStore }) {
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
