/**
 * THE THREE MEDIUM'S COMPONENT BOARD (`@vgai/editor-sdk/services`, a
 * `workspace.service` contribution): `@vgai/game` tells the host's component
 * board registry that this project's `three` stories have a `3D` board.
 *
 * TRANSCRIBED from `@vgai/dom/contributions/component-board.service.ts`,
 * landed in the same unit.
 *
 * WHY A PACKAGE AND NOT THE KIT'S CSF LANE. The board builds a THREE.Scene of
 * the project's three-medium stories on the host's Object3D stage — it is the
 * sibling of this package's `three-story-documents.tsx` (the turntable), and
 * the substrate rule decides it. Portable CSF is medium-neutral and pulls in
 * no three; a THREE.Scene builder inside it would make "do you want stories?"
 * the same question as "do you want three?".
 */

import { registerComponentBoard } from '@editor/component-board-registry';
import { threeComponentBoard } from '../src/three-board/three-component-board';

export const point = 'workspace.service';

export function start(): () => void {
  return registerComponentBoard(threeComponentBoard);
}
