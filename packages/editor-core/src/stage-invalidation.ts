/**
 * THE EDITOR'S OWN CHANGES TO A STAGE'S PICTURE, announced.
 *
 * A stage whose content announces its changes (`ToolObject3DPreviewSource.
 * onChange`) draws only when something changed (`StageHost`'s frame). The
 * content's own changes, the camera, input on the stage, the stage store and
 * playback are each watched there. What remains is the editor acting on a
 * stage from outside all of those -- a view-menu toggle reaching the document
 * session, a helper handed in, a postprocessing chunk that finished loading --
 * and each of those calls {@link invalidateStages}.
 *
 * One counter for every stage rather than a flag per stage: such changes are
 * rare, and a stage that draws one frame it did not strictly need costs
 * nothing, while one that misses a change shows a stale picture.
 */
let generation = 0;

export function invalidateStages(): void {
  generation++;
}

/** Compared by each stage against the value it last drew at. */
export function stageGeneration(): number {
  return generation;
}
