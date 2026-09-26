/**
 * THE CANVAS MEDIUM'S COMPONENT BOARD (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution): `@volter/editor-game`'s canvas medium tells the host's component
 * board registry that this project's `canvas` stories have a `2D` board.
 *
 * The same shape as `contributions/react/component-board.service.ts`.
 */

import { registerComponentBoard } from '@volter/editor-sdk/kit/component-board-registry';
import { canvasComponentBoard } from '../../src/canvas/canvas-board/canvas-component-board';

export const point = 'workspace.service';

export function start(): () => void {
  return registerComponentBoard(canvasComponentBoard);
}
