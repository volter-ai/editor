/**
 * A STAGE'S OWN KEYBOARD ACTIONS — the transform modes, the view presets,
 * Frame, pivot, snap and the vertex-snap hold, bound for the stage whose
 * document is ACTIVE.
 *
 * They belong to the STAGE, and until 2026-09-19 they were mounted from
 * `stage-overlay-set.tsx`, which a stage only reaches when it has the shell
 * above it (`StageHost.tsx`'s `shellStore && !chromeless`). A document
 * contributed by a PACKAGE mounts outside `EditorProvider`, so the Model
 * document reached NONE of them: measured live in the Code-OSS frame on a
 * models project, the editor's action table held 29 entries — the shell set
 * alone — and the stage's nine (`transform.combined/translate/rotate/scale`,
 * `viewport.toggleSnap/frameSelection/cyclePivot/snapToFloor`, the four view
 * presets) were absent, so G/R/S on the Model stage answered nothing at all.
 * The overlay set is an OVERLAY condition (a bounded host must not pay for
 * the collaboration client it reaches); which keys a stage answers is not,
 * and the two were one line by accident.
 *
 * The ONE registry still means ONE holder (`hotkeys.ts`'s scope table, and
 * `key-actions.ts`'s action table under the frame): the active
 * document's stage, which is exactly the condition below.
 *
 * Lazily imported by `StageHost.tsx` so a bounded host neither loads nor pays
 * for `editor-hotkeys.ts`'s closure — the same boundary, and the same reason,
 * as `StageOverlays.tsx`.
 */
import { useEffect } from 'react';
import { registerViewportActions } from '../viewport-actions';
import { registerViewportHotkeys } from '../viewport-hotkeys';
import type { StageHandle } from './stage-overlay-set';

export function StageKeyboardBinding({ stage }: { readonly stage: StageHandle }): null {
  useEffect(
    () => registerViewportHotkeys(stage.store, stage.viewport, stage.canvas),
    [stage.store, stage.viewport, stage.canvas],
  );
  // The same stage's palette entries (`viewport-actions.ts`).
  useEffect(() => registerViewportActions(stage.store), [stage.store]);
  return null;
}
