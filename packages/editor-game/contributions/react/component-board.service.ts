/**
 * THE DOM MEDIUM'S COMPONENT BOARD (`@vgai/editor-sdk/services`, a
 * `workspace.service` contribution): `@vgai/dom` tells the host's component
 * board registry that this project's `dom` stories have a `UI` board, when it
 * exists, and what to say when it does not.
 *
 * TRANSCRIBED from `design-time-mount.service.ts` beside it — the same
 * package, the same point, a sibling registry. The board module is loaded
 * eagerly rather than behind a dynamic `import()` (which that mount uses)
 * because `presence()` is asked the moment the host reconciles, not when a
 * candidate appears: a promise cannot answer a verdict thunk.
 */

import { registerComponentBoard } from '@editor/component-board-registry';
import { uiComponentBoard } from '../src/ui-component-board';

export const point = 'workspace.service';

export function start(): () => void {
  return registerComponentBoard(uiComponentBoard);
}
