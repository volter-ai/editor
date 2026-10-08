/**
 * A 2D view's keys, from the active keymap, while it is the active one: its transform tools (the
 * three viewport binds the same actions for its own store, `viewport-hotkeys.ts`) and Godot's
 * Pan and Ruler modes. Kept apart from the view so the workbench keymap generator, which reads
 * every `bindActions([...])` call, hashes this small file rather than the whole view.
 */

import { editorHost } from '@volter/sdk/host';
import type { ShellStore } from '@volter/sdk/kit/shell-store';
import { requestTransformMode } from '@volter/sdk/kit/transform-mode-request';

export type CanvasSceneKeyMode = 'pan' | 'ruler';

export function bindCanvasSceneKeys(
  store: ShellStore,
  /** Leave any canvas mode (a transform tool's key leaves List Select, Pivot, Pan and Ruler, even
   *  when its tool was the one already armed under them). */
  clearMode: () => void,
  /** Switch a canvas mode on, or off when it is the one on. */
  toggleMode: (mode: CanvasSceneKeyMode) => void,
  /** View › Grid › Toggle Grid. */
  toggleGrid: () => void,
): () => void {
  const arm = (mode: 'select' | 'translate' | 'rotate' | 'scale') => () => {
    clearMode();
    requestTransformMode(store, mode);
  };
  return editorHost().keyboard.bindActions([
    { id: 'transform.select', scope: 'stage', run: arm('select') },
    { id: 'transform.translate', scope: 'stage', run: arm('translate') },
    { id: 'transform.rotate', scope: 'stage', run: arm('rotate') },
    { id: 'transform.scale', scope: 'stage', run: arm('scale') },
    { id: 'canvas.panMode', scope: 'stage', run: () => toggleMode('pan') },
    { id: 'canvas.rulerMode', scope: 'stage', run: () => toggleMode('ruler') },
    { id: 'canvas.toggleGrid', scope: 'stage', run: toggleGrid },
  ]);
}
