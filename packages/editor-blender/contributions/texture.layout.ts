/**
 * The TEXTURE workspace — Substance-Painter-shaped texturing over a `model`
 * document. Borrows Model's arrangement until the texture program ships its
 * layer stack (see `sculpt.layout.ts` for why).
 */

import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'texture',
  title: 'Texture',
  description:
    "Substance-Painter-shaped texturing. Uses Model's arrangement until the texture program ships its layer stack.",
  requires: { documentKind: 'model' },
};
