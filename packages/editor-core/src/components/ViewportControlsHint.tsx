/**
 * The camera-controls hint for a viewport with NO selection chrome. The 3D
 * toolstrip and camera readout resolve from selection (viewport-tool-context),
 * so on a fresh scene nothing tells a newcomer how to orbit — the gap a human
 * build session measured (`viewport-controls-hint.ts`). This chip takes the
 * readout's bottom-left spot until a selection brings the readout in, which
 * then carries the same line; both stop after the first real orbit.
 *
 * Both lines are FUNCTIONS, not constants, because the keys they name come
 * from the active keymap (`keymap-presets.ts`): under `blender` this line
 * reads ". : frame selection", and a hint that kept printing the vgai key
 * would be teaching a newcomer a key their editor does not have.
 */

import { EditorSurface, Text } from '@volter/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';
import { activeEditorKeymap, shortcutFor, subscribeEditorKeymap } from '../keymap-presets';
import { orbitLearned, subscribeOrbitLearned } from '../viewport-controls-hint';

export function viewportControlsHint(): string {
  const frame = shortcutFor('viewport.frameSelection');
  return `Orbit: right-drag (or Alt+drag) · Pan: middle-drag · Zoom: wheel${
    frame ? ` · ${frame}: frame selection` : ''
  }`;
}

export function viewportControlsHintTrackpad(): string {
  const snap = shortcutFor('viewport.toggleSnap');
  return `Trackpad: two-finger pan · pinch zoom · Alt+drag orbit${snap ? ` · Snap: ${snap}` : ''}`;
}

/** Subscribe a hint-printing component to live keymap switches. */
export function useEditorKeymapHints(): void {
  useSyncExternalStore(subscribeEditorKeymap, activeEditorKeymap, activeEditorKeymap);
}

export function ViewportControlsHint() {
  const learned = useSyncExternalStore(subscribeOrbitLearned, orbitLearned, orbitLearned);
  useEditorKeymapHints();
  if (learned) return null;
  return (
    <EditorSurface
      variant="overlay"
      border
      className="vgai-viewport-controls-hint vgai-chrome-island vgai-glass-island"
      data-island-scale="compact"
      // A HINT is not a click target. This island floats over the viewport's
      // bottom edge, and it was swallowing clicks aimed at objects rendered
      // low in the frame — a projected player-torso click selected NOTHING
      // because it landed on this bar (measured live, 2026-09-01). The text
      // is read, never interacted with.
      style={{ pointerEvents: 'none' }}
    >
      <Text variant="code" data-testid="viewport-controls-hint">
        {viewportControlsHint()}
      </Text>
      <Text variant="code">{viewportControlsHintTrackpad()}</Text>
    </EditorSurface>
  );
}
