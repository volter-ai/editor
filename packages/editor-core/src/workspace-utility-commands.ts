/** Semantic commands and failure auto-open policy for workspace utilities. */

import { getMountFailureReports, subscribeToMountFailures } from '@volter/editor-sdk/kit/mount-failure-report';
import { editorConsole } from './editor-console';
import type { HistoryService } from './history/history-service';
import { showWorkspaceUtility, toggleWorkspaceUtility } from './workspace-host-commands';
import { activeChromeRegions } from './workspace-regions';

export const CONSOLE_UTILITY_ID = 'console';

/**
 * Only actionable failures open a utility automatically.
 *
 * A world that did not mount is the most actionable failure the editor has —
 * the project is showing something that is not the game — and revealing the
 * Console (where every mount route already wrote its full line) is what keeps
 * it LOUD without a second error surface. This replaced a top-of-shell red
 * banner: the reveal, not the banner, is the answer to "the Console is not
 * the default bottom tab". Fires on the empty→failing EDGE only, so a second
 * failing world in the same attempt does not yank the region back.
 *
 * Source persistence failures arrive through the project history that guarded
 * and rolled back the write. Watch its failure EDGE directly: this keeps the
 * Console reveal format-neutral and avoids a second adapter-specific event.
 *
 * A workspace whose regions HIDE the drawer (Blender's modeling workspace has
 * no strip below the viewport) is never yanked open by this policy: the
 * status bar's error count stays the loud surface there, and a person's own
 * gesture (a failure item, View → Console) still reveals it.
 */
export function installUtilityAutoOpen(history: HistoryService): () => void {
  let hadMountFailure = getMountFailureReports().length > 0;
  const stopMountFailures = subscribeToMountFailures(() => {
    const failing = getMountFailureReports().length > 0;
    if (failing && !hadMountFailure && activeChromeRegions().drawer !== 'hidden')
      showWorkspaceUtility(CONSOLE_UTILITY_ID);
    hadMountFailure = failing;
  });

  let hadSourceFailure = history.getSnapshot().lastError !== null;
  const stopHistory = history.subscribe(() => {
    const error = history.getSnapshot().lastError;
    const failing = error !== null;
    if (failing && !hadSourceFailure) {
      // The one place every rolled-back write is named for the DOOR: the
      // screen narrates it (a toast, the document's own message), and
      // `vgai console` must say the same — measured silent before this line.
      editorConsole.error(`Source write rolled back: ${error.message} (${error.code})`, 'history');
      if (activeChromeRegions().drawer !== 'hidden') showWorkspaceUtility(CONSOLE_UTILITY_ID);
    }
    hadSourceFailure = failing;
  });

  return () => {
    stopMountFailures();
    stopHistory();
  };
}

/** Toggle the Console utility — the semantic command every menu/hotkey/
 *  control-API caller invokes directly. It used to be reached through a
 *  `window` CustomEvent (`editor:toggle-console`) installed by
 *  `installUtilityEvents`; that indirection was a shell-era relay with no
 *  remaining second implementation, so it was deleted. */
export function toggleConsoleUtility(): void {
  toggleWorkspaceUtility(CONSOLE_UTILITY_ID);
}

/** REVEAL the Console — what a failure item clicks through to. Distinct from
 *  {@link toggleConsoleUtility} on purpose: a user acting on a reported error
 *  must never have that click HIDE the panel holding the error's trace. */
export function showConsoleUtility(): void {
  showWorkspaceUtility(CONSOLE_UTILITY_ID);
}
