/**
 * The Play TRANSPORT in the project header (`@vgai/editor-sdk/chrome`, a
 * `workspace.header` contribution): play, pause, step, restart, stop, the
 * run-configuration picker and the instance count. Only for a project that
 * declares something to run (ARCHITECTURE-CORE §Roots); a folder of models
 * renders nothing here.
 */
import { editorHost } from '@vgai/editor-sdk/host';
import { useSyncExternalStore } from 'react';
import { PlayBar } from '../src/play-bar/PlayBar';

export const point = 'workspace.header';
export const order = 0;

export default function TransportHeader() {
  const { project } = editorHost();
  const mounts = useSyncExternalStore(project.subscribe, project.mounts, project.mounts);
  return mounts ? <PlayBar /> : null;
}
