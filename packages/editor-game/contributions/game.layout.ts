/**
 * The GAME workspace — building and playing the game: the editor's standing
 * arrangement, unchanged (`@volter/editor-sdk/looks`, a `workspace.layout`
 * contribution). It applies to every project the game editor opens: a
 * project with no root yet is a game not yet begun, and the Game workspace is
 * where its first root is added. No captured state: the dock's own reconcile
 * builds the standing arrangement from nothing.
 */
import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'game',
  title: 'Game',
  description:
    "Building and playing the game: the editor's standing arrangement, unchanged. The default.",
  // Game authoring uses the viewport's floating controls; Blender owns its header row.
  regions: { header: 'hidden' },
};
