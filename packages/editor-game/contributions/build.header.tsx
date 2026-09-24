/**
 * THE EXPORT BUTTON (`workspace.header`) — the door into Build
 * Profiles, in the project header's contributed cluster beside the Play
 * transport. Disabled while Play runs: a build reads the project from disk,
 * and a running game holds ephemeral edits that are not on disk.
 */

import { editorHost } from '@volter/editor-sdk/host';
import { Button, EditorIcon, editorIcons } from '@volter/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';
import { openBuildProfilesDocument } from '../src/build/build-session';

export const point = 'workspace.header';
export const order = 10;

export default function BuildHeader() {
  const { session } = editorHost();
  const playState = useSyncExternalStore(session.subscribe, session.playState, session.playState);
  const playing = playState !== 'stopped';
  return (
    <Button
      variant="ghost"
      size="compact"
      data-testid="project-export"
      aria-label="Export project"
      disabled={playing}
      title={playing ? 'Stop Play mode before exporting the project' : 'Export project'}
      className="vgai-chrome-island vgai-glass-island"
      onClick={() => {
        openBuildProfilesDocument();
      }}
    >
      <EditorIcon icon={editorIcons.action.export} />
      Export
    </Button>
  );
}
