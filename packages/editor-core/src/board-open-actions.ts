/** Palette actions over discoverable component canvases, including closed tabs.
 * The registry retains the board descriptor; opening does not create another board. */

import type { EditorAction } from '@volter/editor-sdk/kit/action-registry';
import {
  availableWorkspaceDocuments,
  openAvailableWorkspaceDocument,
} from '@volter/editor-sdk/kit/workspace-available-documents';

/** Commands stay available when a board's tab is closed. */
export function buildBoardOpenActions(): EditorAction[] {
  return availableWorkspaceDocuments()
    .filter((entry) => entry.category === 'canvas')
    .map(({ descriptor }) => ({
      id: `board:${descriptor.id}`,
      label: `Open ${descriptor.title}`,
      category: 'action',
      execute: () => void openAvailableWorkspaceDocument(descriptor.id),
    }));
}
