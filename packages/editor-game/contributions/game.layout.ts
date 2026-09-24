/**
 * The GAME workspace — building and playing the game: the editor's standing
 * arrangement, unchanged (`@vgai/editor-sdk/looks`, a `workspace.layout`
 * contribution). It applies to a project with at least one root that plays;
 * a project with none has nothing for it. No captured state: the dock's own
 * reconcile builds the standing arrangement from nothing.
 */
import type { WorkspaceLayoutContribution } from '@vgai/editor-sdk/looks';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'game',
  title: 'Game',
  description:
    "Building and playing the game: the editor's standing arrangement, unchanged. The default.",
  requires: 'mounts',
  // Game authoring uses the viewport's floating controls; Blender owns its header row.
  regions: { header: 'hidden' },
};
