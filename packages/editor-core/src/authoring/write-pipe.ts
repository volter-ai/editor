/**
 * THE ONE PERSISTENCE PIPE — `resolve(anchor) → write(dialect) → record(recorder)`.
 *
 * Every authored write, from every lane, runs through {@link runWritePipe}.
 * The lanes that used to be parallel stacks are now this pipe's PLUG POINTS:
 * a lane supplies a resolution (which anchor this edit lands at), a dialect
 * writer (the bytes), and a recorder (history), and the pipe supplies the
 * ordering, the awaiting, and the ack.
 *
 * ## The three defects it exists for, all measured on the vendored racing game
 *
 * 1. **The ack was the ADAPTER'S blanket answer, not this edit's.** The
 *    composite joined only its persist-CAPABLE children, so a three-root edit
 *    acked the DOM root's destination with `persisted: true`. Here the ack is
 *    produced by the component that performed the write, about that write, and
 *    there is nowhere else for a caller to get one.
 * 2. **The classifier and the writer were different components.** A subject the
 *    adapter classified `live-only` still wrote a real prop into the game's
 *    source, because the code answering `TruthProvider.resolve` was not
 *    the code performing the write. Here the anchor is resolved ONCE, and a
 *    `live-only` resolution has no `write` member at all — reaching a dialect
 *    writer from it is a type error, not a discipline.
 * 3. **The write was fired un-awaited, so the ack raced the byte.** Here the
 *    pipe awaits the dialect writer and the recorder before it acks.
 *
 * ## Why `live-only` is a destination and not a failure
 *
 * `live-only` (and its play-mode sibling, ephemeral) is a real
 * {@link WriteAnchorKind}: the edit lands on the running object for the session
 * and nothing else, and the contract of that kind is that the surface SAYS SO.
 * So the pipe's live-only branch still applies the edit — the caller has
 * already done that, synchronously, which is what keeps an `endEdit(); undo()`
 * sequence working — and answers `persisted: false` with the reason reported
 * where a user can read it. What the pipe forbids is the inverse: naming a
 * destination no byte reached.
 */

import type { WriteAck, WriteAnchorKind } from '@volter/editor-project/adapter';

export type { WriteAck } from '@volter/editor-project/adapter';

/** What a surface reports when nothing this session does reaches a file. */
export const LIVE_ONLY_DESTINATION = 'live-only (not saved)';

/** What a play-mode adoption reports: edits are real, and die with the session. */
export const EPHEMERAL_DESTINATION = 'ephemeral (discarded on stop)';

/** What `CompositeAuthoringAdapter.persistence` reports when no child of the
 *  composition can persist at all. That provider answers the SAVE-status
 *  question ("where do this surface's saves go"), never the per-edit one — the
 *  pipe's ack is the only answer to that. */
export const NO_PERSISTABLE_CHILD_DESTINATION = '(no persistable child)';

/** The honest floor, as a value: no write was performed, and saying so is the
 *  whole point. Frozen because it is shared by every lane that has no write. */
export const LIVE_ONLY_ACK: WriteAck = Object.freeze({
  destination: LIVE_ONLY_DESTINATION,
  persisted: false,
});

/**
 * A CLIPBOARD gesture reports itself by its WRITE, never by the clipboard half
 * that already succeeded.
 *
 * `StructuralClipboardOutcome` (`@volter/editor-project/adapter`) keeps `false` as the refusal
 * channel and reserves the {@link WriteAck} for a SUCCESSFUL cut/paste. A cut
 * whose removal reached no byte is a COPY: handing its `persisted: false` ack
 * straight back is truthy, so every caller — `consumer-actions.ts`'s
 * `clipboardStructureWrite`, which only shortcuts on `=== false`, and the
 * composite's `cut`, which claims clipboard ownership on anything else — reads
 * a refusal as a landed edit.
 *
 * ONE owner, because the four lanes each said this inline and one commit
 * deleted all four collapses together while widening the return type.
 */
export function clipboardOutcome(ack: WriteAck): false | WriteAck {
  return ack.persisted ? ack : false;
}

/** An anchor kind that has somewhere to land. `live-only` is excluded BY THE
 *  TYPE, which is what makes "a live-only resolution cannot reach a writer" a
 *  compile-time fact rather than a convention. */
export type AnchoredWriteKind = Exclude<WriteAnchorKind, 'live-only'>;

/**
 * Step 1's product: what THIS edit's anchor resolved to.
 *
 * The two arms are not "success" and "failure" — they are the two honest
 * outcomes of asking where an edit lands. Only the `writer` arm carries a
 * `write`, so a lane cannot accidentally write through a resolution that said
 * there was nowhere to write.
 */
export type WriteResolution =
  | {
      readonly reaches: 'writer';
      /** Which lane carries it — the SAME fact `TruthProvider.resolve`
       *  must report for this subject, because both read this resolution. */
      readonly anchorKind: AnchoredWriteKind;
      /** Where the bytes go, in the dialect writer's own words. */
      readonly destination: string;
      /** Step 2 — the dialect writer, already bound to this edit. `true` ⇒ the
       *  bytes landed and the writer's own transaction carries both halves. */
      readonly write: () => Promise<boolean>;
    }
  | {
      readonly reaches: 'live-only';
      /** {@link LIVE_ONLY_DESTINATION} or {@link EPHEMERAL_DESTINATION}. */
      readonly destination: string;
      /** Why there is nowhere to write — reported to the user by the lane's
       *  own reporter, never swallowed. */
      readonly reason: string;
    };

/** One edit, offered to the pipe. */
export interface PipedWrite {
  /**
   * Step 1 — resolve THIS edit's anchor. Called EXACTLY ONCE by the pipe, so
   * the classification a caller reads and the route the write takes are the
   * same object rather than two evaluations that can disagree.
   */
  resolve(): WriteResolution;
  /**
   * Step 3 — the recorder. Called exactly once, after the write step settled,
   * with what actually happened. `persisted: true` ⇒ the dialect writer's own
   * transaction already carries both the file and the live half, so the
   * recorder skips its session journal rather than adding a second entry.
   *
   * This is where undo/redo integrates, and it is the ONLY place: a lane that
   * journals outside the pipe forks history, which is what the pipe replaced.
   */
  record(persisted: boolean): void;
  /**
   * Show a live-only reason where the user can read it. Called only for the
   * `live-only` arm, and only when the lane wants it said (an unarmed backend
   * refusing on every frame of a game somebody is playing is noise, so lanes
   * gate this themselves).
   */
  report?(reason: string): void;
}

/**
 * RUN ONE EDIT THROUGH THE PIPE, and answer for it.
 *
 * The ordering is the contract: resolve, then write (awaited), then record
 * (before the ack). A caller that awaits this ack has awaited the byte.
 *
 * A dialect writer that comes back `false` has already reported its own reason
 * (that is its contract — every refusal names its gate), and the edit degrades
 * to the live-only floor: the value is on the running object, the recorder
 * journals it so it can be undone, and the ack says no byte moved.
 */
export async function runWritePipe(edit: PipedWrite): Promise<WriteAck> {
  const resolution = edit.resolve();
  if (resolution.reaches === 'live-only') {
    edit.report?.(resolution.reason);
    edit.record(false);
    return { destination: resolution.destination, persisted: false };
  }
  const persisted = await resolution.write();
  edit.record(persisted);
  return persisted
    ? { destination: resolution.destination, persisted: true }
    : { destination: LIVE_ONLY_DESTINATION, persisted: false };
}

/** Spell a live-only resolution — the one form, so no lane invents a second
 *  phrasing of "there is nowhere to write". */
export function resolvesLiveOnly(
  reason: string,
  destination: string = LIVE_ONLY_DESTINATION,
): WriteResolution {
  return { reaches: 'live-only', destination, reason };
}
