/**
 * Load a piece file in Node the way `render-piece` does: import its module, mount its default
 * export with `@volter/dawproject`'s own renderer, and read the graph as a piece. Run under `tsx`.
 */

import { pathToFileURL } from 'node:url';
import { type Piece, readPiece } from '@volter/dawproject/piece';
import { createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';

export async function loadPiece(path: string): Promise<Piece> {
  const module = (await import(pathToFileURL(path).href)) as { default?: ComponentType };
  if (typeof module.default !== 'function') throw new Error(`${path} has no default export component.`);
  const root = createPieceRoot((error) => {
    throw error;
  });
  const graph = await root.render(module.default);
  const piece = readPiece(graph);
  root.unmount();
  return piece;
}
