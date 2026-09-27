/**
 * Load a piece file in Node the way `render-piece` does: import its module, mount its default
 * export with `@volter/dawproject`'s own renderer, and read the graph as a piece. Run under `tsx`.
 */

import { pathToFileURL } from 'node:url';
import { type Piece, readPiece } from '@volter/dawproject/piece';
import { type DawNode, createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';

export async function loadPieceGraph(path: string): Promise<DawNode> {
  const module = (await import(pathToFileURL(path).href)) as { default?: ComponentType };
  if (typeof module.default !== 'function') throw new Error(`${path} has no default export component.`);
  const root = createPieceRoot((error) => {
    throw error;
  });
  try {
    return await root.render(module.default);
  } finally {
    root.unmount();
  }
}

export async function loadPiece(path: string): Promise<Piece> {
  return readPiece(await loadPieceGraph(path));
}
