/**
 * THE STRUCTURAL WRITE PIPE — the ONE producer of the `source-structure`
 * resolution and its live-only floor, shared by every source-document lane.
 *
 * Extracted from three near-verbatim copies (owner-directed overlap audit,
 * 2026-08-22): `R3fSourceAuthoringAdapter` (`structOp`/`removeMany`/
 * `groupMany`/`pipedStructWrite`/`structRefusal`), `ReactRootAuthoringAdapter`
 * (`structOp`/`removeManyElements`/`pipedStructWrite`/`structRefusal`) and
 * `pixi-source-write-target` (`structOp`/`structMany`/`pipedStruct`/
 * `structRefusal`). The copies had already drifted in the small ways their own
 * doc comments warn about — refusal spellings, destination defaults — and one
 * module makes the drift impossible rather than policed.
 *
 * WHY THE STRUCT DIALECT RESOLVES ON ITS OWN VERB (kept from every copy's
 * header): `writeStruct`/`writeStructMany` is a DIFFERENT DOOR from the
 * attribute writer, so it acks `source-structure`, never `source-prop` —
 * resolving a delete on `writeProp`'s presence is how a lane comes to name a
 * value lane that never carried the bytes. `record` is a no-op because the
 * backend is wrapped in `withProjectSourceHistory`: the sha-guarded whole-file
 * transaction that carries the bytes IS the undo entry, and journaling here
 * would make one gesture two undos.
 *
 * WHAT STAYS PER-LANE, deliberately: OID RESOLUTION (identity is the lane's
 * own scheme — a caller hands in the resolved oid), the DESTINATION sentence,
 * and the ON-CHANGED hook (react marks dirty and queues a source reconcile;
 * the canvas target refreshes its index; r3f notifies the store). A lane hands
 * those in; this module never guesses them.
 */

import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import type { SourceWriteBackend } from '@volter/editor-core/ui-source/source-write-backend';
import { resolvesLiveOnly, runWritePipe, type WriteAck, type WriteResolution } from '@volter/editor-sdk/kit/write-pipe';

/** The `writeStruct` options bag, spelled once (the backend's own shape). */
export type StructOpOptions = Parameters<SourceWriteBackend['writeStruct']>[2];

export interface StructWritePipeConfig {
  /** The lane's own refusal/no-op reporter — prefix included, e.g.
   *  `` (m) => console.warn(`[R3fSourceAuthoringAdapter] ${m}`) ``. */
  report(message: string): void;
  /** The live-only floor's reason when no struct door is bound. */
  readonly noWriterReason: string;
  /** The lane's backend, read at call time (a session can gain or lose one). */
  backend(): SourceWriteBackend | null | undefined;
  /** Ran after a LANDED structural write, before the ack resolves — the
   *  lane's own reconcile/notify choreography. */
  onChanged(): void | Promise<void>;
}

export interface StructWritePipe {
  /** Every structural source write, through the pipe on the struct verb. */
  pipedStruct(
    write: () => Promise<boolean>,
    op: string,
    bound: boolean,
    destination: string,
  ): Promise<WriteAck>;
  /** A structural verb that never reaches a writer, answered THROUGH the pipe
   *  so the lane has exactly ONE producer of the live-only floor. `hint`, when
   *  given, is the sentence the author who made the gesture also sees. */
  structRefusal(reason: string, hint?: string): Promise<WriteAck>;
  /** One `writeStruct` op against a resolved oid; `null` oid refuses by name. */
  structOp(
    oid: string | null | undefined,
    subjectLabel: string,
    op: string,
    opts: StructOpOptions,
    destination: string,
  ): Promise<WriteAck>;
  /** One `writeStructMany` batch. The CALLER owns oid collection and any
   *  every-node-addressable refusal — batching policy is lane policy. */
  structMany(
    oids: readonly string[],
    op: string,
    opts: { wrapperTag?: string } | undefined,
    destination: string,
  ): Promise<WriteAck>;
}

export function createStructWritePipe(config: StructWritePipeConfig): StructWritePipe {
  const pipedStruct: StructWritePipe['pipedStruct'] = (write, op, bound, destination) =>
    runWritePipe({
      resolve: (): WriteResolution =>
        bound
          ? { reaches: 'writer', anchorKind: 'source-structure', destination, write }
          : resolvesLiveOnly(config.noWriterReason),
      record: () => undefined,
      report: (reason) => config.report(`"${op}" stays live-only — ${reason}.`),
    });

  const structRefusal: StructWritePipe['structRefusal'] = (reason, hint) =>
    runWritePipe({
      resolve: () => resolvesLiveOnly(reason),
      record: () => undefined,
      report: (said) => {
        config.report(said);
        if (hint) showTransientHint(hint);
      },
    });

  return {
    pipedStruct,
    structRefusal,
    structOp: (oid, subjectLabel, op, opts, destination) => {
      if (!oid) {
        return structRefusal(`"${op}" refused: "${subjectLabel}" has no source stamp.`);
      }
      return pipedStruct(
        async () => {
          const backend = config.backend()!;
          const res = await backend.writeStruct(oid, op, opts);
          if (!res.changed) {
            config.report(
              `struct "${op}" refused/no-op for oid "${oid}": ${res.error ?? 'no change'}`,
            );
            return false;
          }
          await config.onChanged();
          return true;
        },
        op,
        config.backend()?.writeStruct !== undefined,
        destination,
      );
    },
    structMany: (oids, op, opts, destination) =>
      pipedStruct(
        async () => {
          const backend = config.backend()!;
          const res = await backend.writeStructMany!(oids, op, opts);
          if (!res.changed) {
            config.report(`batch "${op}" refused/no-op: ${res.error ?? 'no change'}`);
            return false;
          }
          await config.onChanged();
          return true;
        },
        `${op} (batch)`,
        config.backend()?.writeStructMany !== undefined,
        destination,
      ),
  };
}
