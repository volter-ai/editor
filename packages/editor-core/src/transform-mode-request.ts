/**
 * H2, third half — honest gizmo refusal.
 *
 * WHY THE TRIGGER IS TOOL ACTIVATION AND NOT DRAG-START. The design record
 * says "attempting to drag a refused node shows a transient hint". Read
 * against the code, a literal drag-start trigger is unreachable: a fully
 * refused selection never gets a gizmo in the first place —
 * `EditorViewport.syncFromStore` computes `selectedTransformWritable` and
 * calls `this.detach()` (editor-viewport.ts, the `attach`/`detach` branch), so
 * `TransformControls` fires no `dragging-changed`: there is nothing attached
 * to drag. THAT detach is the exact spot where the silence lives.
 *
 * The earliest point at which the user has made a real, unambiguous attempt to
 * transform — as opposed to merely selecting something — is therefore ARMING
 * the move/rotate/scale tool (W/E/R, the toolbar's mode buttons, the command
 * palette's Translate/Rotate/Scale Mode actions) while that refused selection
 * is live. That is the second trigger the brief explicitly allows, and
 * it is what this module implements. Every UI mode-switch call site routes
 * through {@link requestTransformMode} instead of `store.setTransformMode`.
 * (The programmatic `command-listener` path deliberately does not: an
 * automated `set-transform-mode` command is not a user attempt, and a headless
 * caller has no viewport to read a hint in.)
 *
 * The hint text is the adapter's own `reason`, verbatim — the same sentence
 * the hierarchy lock tooltip and the inspector field show (doctrine rule 2).
 * When an adapter refuses without giving a reason we show NOTHING rather than
 * invent a sentence to paraphrase it with.
 */

import { getActiveAuthoring } from './authoring/active-adapter';
import type { TransformMode } from './editor-shell-store';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { transformLockSummary } from '@volter/editor-sdk/kit/hierarchy-row-model';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';

/** Set the transform mode, and NAME the refusal if the live selection is one
 *  the active adapter will not write. */
export function requestTransformMode(store: ShellStore, mode: TransformMode): void {
  store.setTransformMode(mode);
  // Arming SELECT is not an attempt to transform anything — it is the tool
  // that transforms nothing (`TransformMode`'s own note) — so the refusal
  // below, whose whole trigger is "a real, unambiguous attempt to transform",
  // has nothing to report about it.
  if (mode === 'select') return;
  const ids = [...store.selectedEntityIds];
  if (ids.length === 0) return;
  const editability = getActiveAuthoring(store).transforms?.editability;
  if (!editability) return;
  let reason: string | undefined;
  for (const id of ids) {
    const summary = transformLockSummary((channel) => editability(id, channel));
    // Anything movable in the selection means the gesture is not refused —
    // the gizmo attaches and moves what it can.
    if (!summary.locked) return;
    reason ??= summary.reason;
  }
  if (reason) showTransientHint(reason);
}
