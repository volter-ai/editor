/**
 * The PERSISTENCE BACKEND seam for a LIVE authoring adapter, on ANY surface:
 * where a closed gesture's value goes, and what a surface says about that
 * before the gesture happens.
 *
 * IT IS KEYED ON NEITHER SURFACE NOR PROVENANCE — a per-substrate copy is
 * the fork ARCHITECTURE-CORE §Rules names, wearing a filename: an ingested Pixi
 * game needs the SAME ownership gate, the SAME per-edit refusals and the SAME
 * one-transaction-carries-both-halves rule as an ingested three game, and a seam
 * named after one substrate is how a second copy gets written instead of reused.
 * `ThreeAuthoringAdapter` and the canvas write target
 * (`pixi-live-write-target.ts`) are both its consumers; nothing in this file
 * mentions `Object3D` or `Container`, because the currency is an entity id, a
 * property path, an anchor and two values.
 *
 * The adapter owns the gesture and the session journal; it never decides the
 * destination. It hands a backend the creation-site anchor for the property
 * being edited plus the before/after values, and journals the edit live-only
 * whenever the backend declines — which is the DEFAULT, not the exception.
 *
 * ABSENCE IS A BACKEND. An adapter constructed with no backend at all persists
 * nothing and journals nothing: its edits live on the running object for the
 * session and the host injects `createEphemeralPersistence` over them. That is
 * what a play-mode adoption wants — pushing an undo entry there would write
 * play state into the edit-mode history.
 *
 * {@link createCreationSitePersistence} is the other shipped backend, and it
 * covers two of the three destinations the ownership doctrine names:
 *  - the CREATION-SITE LITERAL WRITER, when this tier can reach a dev server to
 *    write the world's own source through (`/__ingest-source/*`);
 *  - an HONEST LIVE-ONLY-WITH-REASON, when it cannot — inventing a fallback
 *    that writes somewhere else is exactly the sidecar the doctrine forbids.
 *    Every refusal still names its gate.
 *
 * The third shipped backend is `oid-source-persistence.ts`, for a world whose
 * own source the serve-time OID transform DID reach — a vendored R3F game is
 * the case that forces it to exist. There, no `new` expression in the game's
 * source constructs anything (fiber does, inside `node_modules`), so
 * creation-site anchoring is structurally empty and its writer can never fire;
 * the JSX callsite the OID stamp names is the object's real source address.
 */

import type { NodeCreationSite, WriteAnchorKind } from '@volter/editor-project/adapter';
import type {
  ChannelValue,
  CreationSiteLiteralReport,
  CreationSiteSurface,
  CreationSiteWriteScope,
} from '@volter/editor-sdk/kit/creation-site-edit';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { editorIsAuthoring } from '@volter/editor-sdk/kit/editor-session-mode';
import type { HistoryService } from '@volter/editor-sdk/kit/history/history-service';
import { ingestSourceWritesRecordedIfPrimed } from '@volter/editor-sdk/kit/ui-source/tier-source-write-backend';
import type { IngestInspectRequest } from './ingest-source-persistence';
import {
  IngestSourcePersistence,
  ingestOwnershipNow,
  reportIngestSourceRefusal,
} from './ingest-source-persistence';
import { LIVE_ONLY_DESTINATION } from '@volter/editor-sdk/kit/write-pipe';

/**
 * The adapter's own channel read/write, handed to a backend so the live half of
 * a persisted edit can be restored by undo through the SAME writers an ordinary
 * edit uses.
 */
export interface LiveChannelAccess {
  /** The value in force for one property, or `undefined` when the node is gone. */
  read(entityId: string, property: string): ChannelValue | undefined;
  /** Put a value back on the live object (undo/redo). */
  apply(entityId: string, property: string, value: ChannelValue): void;
}

/**
 * WHAT is being edited — everything a backend needs to decide, before any value
 * exists. One object rather than a positional list because the two shipped
 * backends read DIFFERENT members of it: the creation-site backend answers from
 * `anchor`/`instances`, the OID backend from `sourceOid`, and a positional
 * signature would have grown a fourth parameter nobody reading the call could
 * name.
 */
export interface SourceWriteSubject {
  readonly entityId: string;
  /** An editor property path (a key of the surface's channel table). */
  readonly property: string;
  /**
   * Which surface's vocabulary {@link SourceWriteSubject.property} is in.
   * Absent ⇒ `three`. It travels with the subject rather than being fixed at
   * backend construction because it is a fact about the PROPERTY NAME, and the
   * server — which owns the channel tables — is the only thing that resolves it.
   */
  readonly surface?: CreationSiteSurface | undefined;
  /** Where the value being edited LIVES: the creation site of the object that
   *  owns the property (for a material colour, the material — not the mesh), or
   *  the record in the game's own data file that addresses this object. */
  readonly anchor: NodeCreationSite;
  /**
   * WHICH LANE this subject's write would travel, in the pinned vocabulary
   * (`WriteAnchorKind`) — planned by whoever built the subject, since that is
   * the code that chose the branch, and carried here so a caller does not have
   * to re-derive it from the anchor's shape (which cannot distinguish a JSX
   * prop from a construction literal, nor either from a body-placed spawn).
   */
  readonly anchorKind: WriteAnchorKind;
  /** How many objects that anchor has constructed. A SOURCE-anchor fact only —
   *  a data record addresses exactly one object by construction, so the count
   *  is 1 there and nothing reads it. */
  readonly instances: number;
  /** Ordinary gestures omit this and address one live object. The explicit
   * component-default gesture carries `creation-site`, authorizing a rewrite
   * whose declared effect is all `instances` objects. */
  readonly writeScope?: CreationSiteWriteScope | undefined;
  /**
   * The serve-time OID stamp of the object that OWNS the property (the same
   * owner hop `anchor` follows), when the served source carried one. Absent for
   * every unstamped world, which is what makes the two backends' domains
   * disjoint rather than overlapping.
   */
  readonly sourceOid?: string | undefined;
}

/** One property edit, fully planned, offered to the backend. */
export interface SourceWriteRequest extends SourceWriteSubject {
  readonly baseline: ChannelValue;
  readonly next: ChannelValue;
  /** History label for the transaction ("Transform Sun"). */
  readonly label: string;
}

/**
 * One REMOVAL, fully planned, offered to the backend — the same subject a write
 * carries, minus the values. The missing `baseline`/`next` IS the difference:
 * absence is not a value, and a door that took one would be a value write
 * wearing another name.
 */
export interface SourceRemoveRequest extends SourceWriteSubject {
  /** History label for the transaction ("Remove Sun position"). */
  readonly label: string;
}

/**
 * THE REMOVAL DOOR — drop the authored value at a subject's address entirely,
 * rather than writing a value into it.
 *
 * WHY A BACKEND NEEDS ONE AT ALL: every dialect writer here appends
 * (`addIfMissing`), so a gesture on a callsite that authored no `position`
 * ADDS one, and writing the old numbers back leaves that attribute standing —
 * the file ends one attribute heavier than it started and no byte-level
 * edit/revert round trip can close. Only removal expresses that absence.
 *
 * ABSENT ⇒ this backend cannot express byte-absence at all, and the adapter
 * above it declares no `TransformProvider.remove`, so the protocol's removal
 * door refuses BY NAME (`REMOVAL_UNAVAILABLE`) instead of a value write
 * pretending to be a revert. The two members are ONE optional group rather
 * than two optional methods precisely so "there is a door" and "here is who
 * may walk through it" cannot come apart.
 */
export interface SourceRemovalDoor {
  /**
   * Is there a door for THIS subject's property, right now?
   *
   * SYNCHRONOUS, because its caller is `TransformProvider.editability`, which
   * has to answer before the gesture. So it may only read what the backend
   * already holds — the same rule {@link SourcePersistenceBackend.gate} states
   * for the write side, and for the same reason.
   */
  available(subject: SourceWriteSubject): boolean;
  /**
   * Attempt the removal. `true` ⇒ the authored value is gone and this
   * backend's own transaction carries the undo. `false` ⇒ NOTHING was dropped
   * — the callsite carried no such attribute, or the writer refused it — and
   * the backend has already reported why, so the caller acks the live-only
   * floor rather than a revert nobody performed.
   */
  perform(request: SourceRemoveRequest): Promise<boolean>;
}

export type SourceWriteVerdict = { ok: true } | { ok: false; reason: string };

export interface SourcePersistenceBackend {
  /** Called once by the adapter, before any gesture. */
  attach(live: LiveChannelAccess): void;
  /**
   * The source address this backend would write `sourceOid` at, when it knows
   * one — the adapter prefers it over the creation-site registry's answer, so a
   * stamped object's "created at" line names its real JSX callsite instead of
   * the registry's honest-but-useless "constructed outside project source".
   *
   * ABSENT on a backend with no OID index (the creation-site one), and `null`
   * for an oid this backend's index has not resolved. Never a guess.
   */
  anchor?(sourceOid: string): NodeCreationSite | null;
  /**
   * Is the value at `sourceOid`'s anchor read by a PHYSICS BODY BINDING — i.e.
   * would a write here land at a spawn a simulation re-poses from, rather than
   * at a prop the element itself keeps?
   *
   * Only a backend holding the game's own source index can answer, which is why
   * it lives here rather than on the adapter: the fact is `physicsBinding` /
   * `r3fAuthoring.bodyForwarded` on the served `OidEntry`
   * (`ui-source/r3f-physics-binding.ts`). ABSENT ⇒ this backend indexes no
   * source and every anchor it plans is classified by its own branch alone.
   */
  physicsPlaced?(sourceOid: string, property: string): boolean;
  /** The sentence `transforms.editability` cites for this node + property. */
  describe(subject: SourceWriteSubject): string;
  /** Synchronous "is a write even on the table?", with the reason when not.
   *  Must not await: the live-only path stays as synchronous as it was before
   *  any of this existed, so an `endEdit(); undo()` sequence still works. */
  gate(subject: SourceWriteSubject): SourceWriteVerdict;
  /**
   * Could this backend write at all right now — a reachable writer, and a
   * session that is AUTHORING rather than playing? Decides only whether a
   * CHEAP-gate refusal is worth telling the user about: "that property has no
   * source anchor" is honesty during an authoring gesture and noise on every
   * frame of a game somebody is playing.
   */
  armed(): boolean;
  /** Report a refusal where the user can see it. */
  report(label: string, reason: string): void;
  /**
   * READ what the construction statement says these properties are — the
   * component-instance diff's other half ("the site's literal is the default,
   * the live object is the instance").
   *
   * ABSENT ⇒ this backend has no readable source behind its subjects, and the
   * adapter reports no component-instance description at all rather than one
   * whose defaults it made up. Present ⇒ every property gets an answer or is
   * simply missing from the map, which is the honest "the site names none".
   */
  readSiteLiterals?(
    request: IngestInspectRequest,
  ): Promise<Record<string, CreationSiteLiteralReport>>;
  /** Attempt the write. `true` ⇒ persisted, and the adapter skips its journal
   *  because the backend's own transaction already carries both halves. */
  write(request: SourceWriteRequest): Promise<boolean>;
  /**
   * The other half of `write` for a backend that can express ABSENCE — see
   * {@link SourceRemovalDoor}. Absent on a backend that cannot, which is how a
   * lane honestly reports that byte-absence is unreachable through it rather
   * than reverting with a value write.
   */
  readonly removal?: SourceRemovalDoor;
  /** What `AuthoringAdapter.persistence.destination` reports. */
  destination(): string;
  dispose(): void;
}

export interface CreationSitePersistenceOptions {
  readonly history: HistoryService | null;
  /**
   * Injectable so a unit test can drive the write path without a dev server.
   * Absent in production: the backend builds its own when the tier can reach
   * one, and stays at the honest live-only floor when it cannot.
   */
  readonly writer?: IngestSourcePersistence | undefined;
}

export function createCreationSitePersistence(
  options: CreationSitePersistenceOptions,
): SourcePersistenceBackend {
  let writer: IngestSourcePersistence | null = null;
  return {
    attach(live) {
      // Whether an ingest edit is RECORDED is what this session's host serves
      // (`/__ingest-source/*`, from `creationSiteWritePlugin`), never how the
      // editor shell was built — the packaged editor runs a production bundle
      // and serves that route, so `import.meta.env.DEV` refused the write on the
      // one tier a registry install has. See
      // `../ui-source/tier-source-write-backend.ts`.
      writer =
        options.writer ??
        (ingestSourceWritesRecordedIfPrimed('An ingest root’s source persistence')
          ? new IngestSourcePersistence({ history: options.history, live })
          : null);
    },
    describe({ anchor, instances, property, writeScope }) {
      if (writer) return writer.describe(anchor, instances, property, writeScope);
      if (!anchor.anchored) return `Live-only edit — ${anchor.reason}.`;
      return anchor.kind === 'data'
        ? `Live-only edit — this object is ${anchor.display}.`
        : `Live-only edit — this object is created at ${anchor.display}.`;
    },
    gate({ anchor, instances, property, writeScope }) {
      if (!writer) return { ok: false, reason: 'this editor tier cannot write project source' };
      return writer.gate(anchor, instances, property, writeScope);
    },
    armed: () => writer !== null && editorIsAuthoring(),
    readSiteLiterals: (request) => (writer ? writer.inspect(request) : Promise.resolve({})),
    report: (label, reason) => reportIngestSourceRefusal(label, reason),
    async write(request) {
      if (!writer) return false;
      try {
        const outcome = await writer.persist(request);
        if (outcome.persisted) {
          editorConsole.log(
            `[ingest] ${request.label} written to the game's own source — ${outcome.detail}`,
          );
          return true;
        }
        reportIngestSourceRefusal(request.label, outcome.reason);
        return false;
      } catch (error) {
        reportIngestSourceRefusal(
          request.label,
          `the write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    /**
     * THE REMOVAL DOOR on the creation-site lane — the byte-absence half the
     * insertion arm makes necessary: an authored transform can ADD a
     * `receiver.member.axis = value;` statement for an axis the source never
     * named, and no value write can revert an added property. The plan is
     * `planCreationSiteRemoval` (server-side, same `prepare`/`apply` route and
     * checksum guard as a value write, so a vendored game's lock rides along
     * in the same gesture): the ONE deletable shape is the whole own-line
     * assignment statement insertion writes; everything else — constructor
     * literals, `.set(…)` arguments, alias writes, computed expressions —
     * refuses in the planner's own words.
     *
     * `available` answers for the DOOR (a writer exists and the gate is open
     * for this subject), the same honesty split the OID lane records: whether
     * the site currently AUTHORS such a statement is the file's fact, and
     * `perform` — which returns the server plan's own verdict — answers it.
     */
    removal: {
      available(subject) {
        if (!writer) return false;
        return writer.gate(subject.anchor, subject.instances, subject.property, subject.writeScope)
          .ok;
      },
      async perform(request) {
        if (!writer) return false;
        try {
          const outcome = await writer.remove({
            property: request.property,
            surface: request.surface,
            anchor: request.anchor,
            instances: request.instances,
            writeScope: request.writeScope,
            label: request.label,
          });
          if (outcome.persisted) {
            editorConsole.log(
              `[ingest] ${request.label} — dropped from the game's own source (${outcome.detail})`,
            );
            return true;
          }
          reportIngestSourceRefusal(request.label, outcome.reason);
          return false;
        } catch (error) {
          reportIngestSourceRefusal(
            request.label,
            `the removal failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        }
      },
    },
    destination() {
      const owned = ingestOwnershipNow();
      return editorIsAuthoring() && owned?.writable && writer
        ? "the game's own source (creation-site write-back)"
        : LIVE_ONLY_DESTINATION;
    },
    dispose() {
      writer?.dispose();
      writer = null;
    },
  };
}
