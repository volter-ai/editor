import { sha256Hex } from '@volter/editor-sdk/kit/bytes-codec';
import { HistoryOperationError, type HistoryService } from '@volter/editor-sdk/kit/history/history-service';
import type { ResourceDescriptor, ResourceDriver, ResourceKind } from '@volter/editor-sdk/kit/history-types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * WHO OWNS A LIVE-EDIT JOURNAL, WHO SHARES IT, AND THE ONE PATH ALLOWED TO END
 * IT. This block is the single statement of that ownership; every journal below
 * (`three-authoring-adapter`, `pixi-live-write-target`,
 * `pixi-structure-history`, `dom-authoring-adapter`,
 * `react-world-authoring-adapter`) reads it rather than restating it.
 *
 * THE RULE: **a journal's session is its SUBJECT's, never its MOUNT's.**
 *  - OWNER — the subject named by {@link JournalSubject.session}. A held
 *    Edit-mode surface's subject is the WORLD, which outlives every remount
 *    (HMR, a scene switch, a re-entered ingest), so its journal lives in the one
 *    {@link AUTHORING_SESSION}. Play's subject is the PLAY RUN, which ends when
 *    somebody presses ■.
 *  - SHARERS — every mount of that subject, in succession. Two mounts of one
 *    world are two sharers of ONE journal: `registerSession` returns the same
 *    descriptor for the same location, so the second mount rejoins the first
 *    mount's entries instead of minting a stack of its own.
 *  - THE ONE TEARDOWN PATH — `HistoryService.expireSession(session)`, called by
 *    the owner of that session and by nobody else. Today its only caller is
 *    play's `exitPlayRootAuthoring()` (`play-mode.ts`), which ends the run it
 *    started. A journal has NO teardown verb of its own, deliberately: a mount
 *    holding one must not be able to end a session it does not own.
 *
 * WHAT THIS COST BEFORE IT WAS STATED (measured 2026-08-16, canvas held
 * surface): every journal minted `sessionId: \`pixi-${crypto.randomUUID()}\`` —
 * a fresh identity per MOUNT — and `dispose()` expired it. So a remount marked
 * the surface's whole undo stack `expired`: `canUndo` went true → false and
 * `undo()` returned false, while the entity ids the entries addressed were
 * byte-identical across the remount. A world-scoped stack ended by a per-mount
 * teardown is exactly the shape build-rule 4 exists to catch.
 *
 * SO THE TWO VERBS MEAN DIFFERENT THINGS, and conflating them was the defect:
 * {@link JsonHistoryResource.dispose} is "THIS MOUNT detaches" (unregister the
 * driver; entries stay restorable and the next mount re-registers), while
 * `HistoryService.expireSession` is "the SUBJECT is gone". `dispose()` used to
 * call `expireSession` itself, which is precisely how a sharer came to end an
 * owner's session.
 */
export interface JournalSubject {
  /** The subject's session — one path segment. {@link AUTHORING_SESSION} for
   *  every held/authoring surface; a per-run id for play. */
  readonly session: string;
  /** Unique WITHIN that session: which world's which journal. Two journals in
   *  one world (2D edits vs 2D structure) and two worlds in one session must
   *  never collide, or the second registration finds the first's driver. */
  readonly id: string;
}

/**
 * The editor's authoring session — deliberately a CONSTANT, because there is
 * exactly one of it and it lasts as long as the project is open. That is what
 * makes a remount rejoin rather than restart.
 */
export const AUTHORING_SESSION = 'authoring';

/** A held/authoring surface's journal: owned by the world, shared by its
 *  mounts, never ended by one of them. */
export function authoringJournal(id: string): JournalSubject {
  return { session: AUTHORING_SESSION, id };
}

/** A play run's journal: owned by the run, and ended by it — which is what
 *  keeps play-time edits out of the edit-mode undo stack after ■. */
export function playJournal(runId: string, id: string): JournalSubject {
  return { session: `play-${runId}`, id };
}

export interface JsonHistoryResourceOptions<T> {
  readonly history: HistoryService;
  readonly kind: ResourceKind;
  readonly scope: 'project' | 'session';
  readonly location?: string;
  /** Required for `scope: 'session'` — see {@link JournalSubject}. */
  readonly subject?: JournalSubject;
  readonly displayName?: string;
  readonly capture: () => T;
  readonly restore: (value: T) => void | Promise<void>;
  /**
   * The part of the captured state that constitutes this resource's CONFLICT
   * IDENTITY — i.e. "has something else changed this resource since the
   * transaction was recorded?". Defaults to the whole captured value.
   *
   * Override it when `capture()` deliberately includes state that is NOT part
   * of the resource's persisted content and may change on its own. The ingest
   * overlay resource is the motivating case: its snapshot carries a mirror of
   * every live `Object3D`'s pose (needed as the RESTORE payload), but an
   * ingested game is a RUNNING game that animates its own objects every frame.
   * Hashing that live simulation state as identity made every ingest
   * transaction fail preflight with `content-conflict` a frame after it was
   * recorded — so undo silently did nothing (issue #81). The resource's real
   * content is the overlay it serializes to disk, which only editor edits
   * touch.
   */
  readonly conflictIdentity?: (value: T) => unknown;
}

/** Concrete JSON document/session resource backed by the project HistoryService. */
export class JsonHistoryResource<T> {
  readonly descriptor: ResourceDescriptor;
  private revision = 0;
  private readonly unregister: () => void;
  private disposed = false;
  /**
   * Has THIS MOUNT written to the resource yet? The conflict check below is the
   * only reader, and the reason is the other half of making a journal outlive
   * its mount: {@link conflictIdentity} is per-mount bookkeeping (which props
   * the editor has touched), so a REJOINING mount starts empty and every
   * inherited entry failed preflight with `content-conflict` — the stack
   * survived the remount and then refused to restore, which is no better than
   * losing it. A mount that has recorded nothing has observed no divergence and
   * has no basis to refuse; within a mount the check is unchanged, which is
   * what keeps issue #81's protection intact.
   */
  private recorded = false;

  constructor(private readonly options: JsonHistoryResourceOptions<T>) {
    if (options.scope === 'project') {
      if (!options.location) throw new Error('A project JSON history resource needs a location.');
      this.descriptor = options.history.registry.registerProject(
        options.kind,
        options.location,
        options.displayName,
      );
    } else {
      if (!options.subject) throw new Error('A session JSON history resource needs a subject.');
      this.descriptor = options.history.registry.registerSession(
        options.kind,
        options.subject.session,
        options.subject.id,
        options.displayName,
      );
    }

    const driver: ResourceDriver = {
      descriptor: this.descriptor,
      capture: async () => {
        const bytes = this.encode(options.capture());
        return {
          revision: this.revision,
          contentType: 'application/json',
          bytes,
          sha256: await sha256Hex(bytes),
        };
      },
      preflight: async (expected) => {
        const bytes = this.encode(options.capture());
        const actualSha256 = await sha256Hex(bytes);
        // A mount that has not written here cannot have seen anything diverge.
        if (!this.recorded) return { ok: true };
        // Fast path (and the behavior for every resource that does NOT narrow
        // its identity): the full captured bytes still hash to what the
        // transaction expects, so nothing has diverged.
        if (actualSha256 === expected.sha256) return { ok: true };
        // Otherwise the bytes differ — but that only counts as a CONFLICT if the
        // part that identifies the resource differs. Compare the narrowed
        // identity against the expected snapshot's own identity, decoded from
        // the stored blob. (See `conflictIdentity` — an ingested game mutates
        // the live-object mirror in its snapshot every frame on its own.)
        if (options.conflictIdentity) {
          const expectedValue = JSON.parse(
            decoder.decode(options.history.snapshots.read(expected).bytes),
          ) as T;
          const expectedIdentity = JSON.stringify(options.conflictIdentity(expectedValue));
          const actualIdentity = JSON.stringify(options.conflictIdentity(options.capture()));
          if (expectedIdentity === actualIdentity) return { ok: true };
        }
        return {
          ok: false,
          reason: 'content-conflict',
          actualRevision: this.revision,
          actualSha256,
        };
      },
      restore: async (snapshot) => {
        const bytes = options.history.snapshots.read(snapshot).bytes;
        await options.restore(JSON.parse(decoder.decode(bytes)) as T);
        this.revision++;
      },
      estimateBytes: (snapshot) => snapshot.byteLength,
    };
    this.unregister = options.history.registerDriver(driver);
  }

  record(label: string, before: T, after: T): Promise<boolean> {
    if (this.disposed) return Promise.reject(new Error('JSON history resource is disposed.'));
    this.options.history.assertCanRecordAppliedChange();
    this.revision++;
    this.recorded = true;
    return this.options.history
      .recordAppliedTransaction(
        {
          label,
          resources: [this.descriptor.key],
          scope: this.descriptor.scope,
          ...(this.descriptor.sessionId ? { sessionId: this.descriptor.sessionId } : {}),
        },
        [
          {
            resource: this.descriptor.key,
            beforeBytes: this.encode(before),
            afterBytes: this.encode(after),
            contentType: 'application/json',
          },
        ],
      )
      .catch(async (error: unknown) => {
        try {
          await this.options.restore(structuredClone(before));
          this.revision++;
        } catch (compensationError) {
          throw this.options.history.blockForCompensationFailure(label, [this.descriptor.key], {
            operationError: error,
            compensationError,
          });
        }
        if (!(error instanceof HistoryOperationError)) {
          this.options.history.reportAppliedChangeFailure(label, [this.descriptor.key], error);
        }
        throw error;
      });
  }

  /** Must be called immediately before a live or overlay mutation begins. */
  assertCanMutate(): void {
    if (this.disposed) throw new Error('JSON history resource is disposed.');
    this.options.history.assertCanRecordAppliedChange();
  }

  /**
   * THIS MOUNT DETACHES — see the ownership block at the top of this file.
   *
   * Unregisters the driver and nothing else: the entries stay restorable, and
   * the next mount of the same subject re-registers over the same descriptor
   * and inherits them. This deliberately does NOT expire; a mount ending is not
   * its subject ending, and treating it as one is what emptied a held surface's
   * undo stack on every remount.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister();
  }

  private encode(value: T): Uint8Array {
    return encoder.encode(JSON.stringify(value, null, 2));
  }
}
