/**
 * EDIT-TIME NETWORKING (`@volter/editor-sdk/services`, a `workspace.service`
 * contribution): the networking adapter the editor inspects while nothing is
 * playing, bound to the open project's own Colyseus client/room exports.
 *
 * Unlike audio (universal, install-once), it is project-dependent — it
 * installs only when the open project declares a server — so it re-installs
 * on every project change.
 *
 * It was `components/EditModeNetworkingBootstrap.tsx`, a component that
 * rendered `null` so the shell's layout could run an effect. A service is what
 * that always was, and the shell no longer names it (WORK.md §The workbench,
 * P3b).
 */
import { onProjectChange } from '@volter/editor-core/project-manager';
import { installEditModeNetworking } from '../src/edit-mode/edit-mode-networking';

export const point = 'workspace.service';

export function start(): () => void {
  let dispose = installEditModeNetworking();
  const stop = onProjectChange(() => {
    dispose();
    dispose = installEditModeNetworking();
  });
  return () => {
    stop();
    dispose();
  };
}
