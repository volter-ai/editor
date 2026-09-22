/**
 * The SCULPT workspace — ZBrush-shaped sculpting over a `model` document. It
 * borrows Model's arrangement until the sculpt program ships its brush rail
 * (a reserved task panel ships WITH its capability program, never as empty
 * chrome); it keeps its OWN persisted layout the moment a person touches it.
 */

import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'sculpt',
  title: 'Sculpt',
  description:
    "ZBrush-shaped sculpting. Uses Model's arrangement until the sculpt program ships its brush rail.",
  requires: { documentKind: 'model' },
  // `tabs` unstated — see `model.layout.ts`: the workspace layer wins over the
  // style bundle, so restating the host default shadows it.
  regions: {
    header: 'shown',
    shelf: 'shown',
    inspector: 'properties',
    drawer: 'hidden',
  },
};
