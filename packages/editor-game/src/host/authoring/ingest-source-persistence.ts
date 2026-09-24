/**
 * Creation-site persistence for an ingested game — the client half of
 * "an ingest edit writes the game's OWN source at the line that built the
 * object".
 *
 * WHAT THIS OWNS
 *  1. THE SESSION-WIDE GATES. Two independent facts, both of which must hold
 *     before a byte moves: the base must be user-owned and writable (a server
 *     fact — see `server/creation-site-write.ts`), which decides WHO RECORDS the
 *     resulting diff; and the gesture must be an authoring one rather than a
 *     play-time one (`editorIsAuthoring()`), which is what the surface the edit
 *     was made on already says.
 *  2. THE TRANSACTION. One gesture produces one history transaction carrying
 *     BOTH halves — the source file's bytes and the live object's value — so a
 *     single undo puts the game and the file back together. See
 *     {@link IngestSourcePersistence.liveResource} for why the live half needs
 *     a resource of its own here where R3F needs none.
 *
 * WHAT THIS DOES NOT OWN. Whether an edit CAN be written is decided entirely by
 * `creation-site-edit.ts` against the game's real bytes, on the server. Nothing
 * in this file guesses, retries with looser rules, or falls back to a sidecar —
 * a refusal comes back with its reason and becomes the label the user reads.
 * The doctrine's words: persistence exists exactly where ownership does, and a
 * property that cannot be honestly source-anchored presents as live-only.
 */

import type { NodeCreationSite } from '@volter/editor-project/adapter';
import { base64ToBytes, bytesToBase64, sha256Hex } from '@volter/editor-core/bytes-codec';
import type {
  ChannelValue,
  CreationSiteLiteralReport,
  CreationSiteSurface,
  CreationSiteWriteScope,
} from '@volter/editor-core/creation-site-edit';
import { editorConsole } from '@volter/editor-core/editor-console';
import { editorIsAuthoring } from '@volter/editor-core/editor-session-mode';
import type { HistoryService } from '@volter/editor-core/history/history-service';
import { projectSourceAppliedChange } from '@volter/editor-core/history/source-history-backend';
import type { ResourceDriver, ResourceKey } from '@volter/editor-core/history/types';
import type { SourceWriteBackend } from '@volter/editor-core/ui-source/source-write-backend';
import {
  type DataEditPlan,
  dataPlacementRefusal,
  dataRecordAnchor,
  ingestDataWriterNow,
} from './ingest-data-writer';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ────────────────────────────────────────────────────────────── ownership

export interface IngestSourceOwnership {
  readonly writable: boolean;
  readonly reason?: string;
  readonly projectRoot: string | null;
  /** Who accounts for the diff an edit produces — the server's phrase, shown
   *  verbatim. Present whenever `writable`; ownership decides the RECORDER, not
   *  whether the write happens. */
  readonly recorder?: string;
}

/** Unknown until the server answers — and "unknown" is NOT "writable". */
let ownership: IngestSourceOwnership | null = null;
let ownershipRequest: Promise<IngestSourceOwnership> | null = null;

export function ingestOwnershipNow(): IngestSourceOwnership | null {
  return ownership;
}

/** Test-only: forget the server's answer so the next test asks again. */
export function resetIngestOwnershipForTest(): void {
  ownership = null;
  ownershipRequest = null;
}

/**
 * Ask the dev server whether this session's base may be written. Cached for the
 * session: ownership is a property of the opened folder, and a project switch
 * rebuilds the editor's adapters anyway.
 *
 * A transport failure is NOT treated as permission. There is exactly one safe
 * direction for this question to fail in.
 */
export async function loadIngestOwnership(
  fetchImpl: typeof fetch = fetch,
): Promise<IngestSourceOwnership> {
  if (ownership) return ownership;
  if (ownershipRequest) return ownershipRequest;
  ownershipRequest = (async () => {
    try {
      const res = await fetchImpl('/__ingest-source/ownership');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const value = (await res.json()) as IngestSourceOwnership;
      ownership = value;
    } catch (error) {
      ownership = {
        writable: false,
        reason: `the editor could not reach its dev server to check who owns this game's source (${
          error instanceof Error ? error.message : String(error)
        })`,
        projectRoot: null,
      };
    }
    return ownership;
  })();
  return ownershipRequest;
}

// ──────────────────────────────────────────────────────────────── the write

/** What a persisted edit needs to know about the object it is writing. */
export interface IngestSourceWriteRequest {
  /** Structural-path id — the key the live half restores through. */
  readonly entityId: string;
  /** An editor property path (a key of the surface's channel table). */
  readonly property: string;
  /** Which surface's vocabulary {@link IngestSourceWriteRequest.property} is in;
   *  absent ⇒ `three`. Sent to the server, which picks the channel table — the
   *  client never resolves the channel itself. */
  readonly surface?: CreationSiteSurface | undefined;
  /** The anchor of the object that OWNS the property (which for a material
   *  colour is the material, not the mesh — see `creation-site-edit.ts`). */
  readonly anchor: NodeCreationSite;
  /** How many objects that anchor has constructed. */
  readonly instances: number;
  /** Explicit authority to rewrite a shared construction default. */
  readonly writeScope?: CreationSiteWriteScope | undefined;
  readonly baseline: ChannelValue;
  readonly next: ChannelValue;
  /** History label for the transaction ("Transform Sun"). */
  readonly label: string;
}

/**
 * "What does the line that built this object SAY these properties are?" — the
 * read half of the same anchor a write uses.
 *
 * MANY PROPERTIES, ONE REQUEST, because the answer is one parse of one file: the
 * inspector asks about a whole subject at once, and a per-property round trip
 * would re-read and re-parse the game's source for every row it draws.
 */
export interface IngestInspectRequest {
  readonly anchor: NodeCreationSite;
  readonly instances: number;
  readonly writeScope?: CreationSiteWriteScope | undefined;
  readonly surface?: CreationSiteSurface | undefined;
  readonly properties: ReadonlyArray<{ readonly property: string; readonly live: ChannelValue }>;
}

/** A removal carries the subject and the label — no values. Absence is not a
 *  value, and a shape that took one would be a value write wearing another
 *  name (the same rule `SourceRemoveRequest` states at the backend seam). */
export interface IngestSourceRemoveRequest {
  readonly property: string;
  readonly surface?: CreationSiteSurface | undefined;
  readonly anchor: NodeCreationSite;
  readonly instances: number;
  readonly writeScope?: CreationSiteWriteScope | undefined;
  /** History label for the transaction ("Remove bubble position"). */
  readonly label: string;
}

export type IngestSourceWriteOutcome =
  | { readonly persisted: true; readonly file: string; readonly detail: string }
  | { readonly persisted: false; readonly reason: string };

interface PreparedResponse {
  changed?: boolean;
  reason?: string;
  file?: string;
  resourcePath?: string;
  prevSource?: string;
  newSource?: string;
  prevSha?: string;
  newSha?: string;
}

/** The live values a persisted transaction restores — narrow on purpose: only
 *  the (object, property) pairs a persisted edit actually touched, never a
 *  mirror of the running scene. */
interface LiveSnapshot {
  readonly objects: Record<string, Record<string, ChannelValue>>;
}

export interface IngestLiveAccess {
  /** The value in force for one property, or `undefined` when the object is gone. */
  read(entityId: string, property: string): ChannelValue | undefined;
  /** Put a value back on the live object (undo/redo). */
  apply(entityId: string, property: string, value: ChannelValue): void;
}

export interface IngestSourcePersistenceOptions {
  readonly history: HistoryService | null;
  readonly live: IngestLiveAccess;
  readonly fetchImpl?: typeof fetch;
}

/**
 * The `SourceWriteBackend` slice `projectSourceAppliedChange` and the source
 * resource driver need, pointed at `/__ingest-source/*`.
 *
 * The JSX verbs (`writeStyle`/`removeStyle`/`writeStruct`) are structurally
 * required by the interface and are genuinely NOT reachable through this
 * backend — an ingested game has no oids. They throw, loudly and by name,
 * rather than resolving to a shape that reads like a successful no-op: this is
 * the honest-degradation rule, not a stub waiting to be filled in.
 */
function createIngestSourceBackend(fetchImpl: typeof fetch): SourceWriteBackend {
  const post = async <T>(url: string, body: unknown): Promise<T> => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as T;
    if (!res.ok && url.endsWith('/read')) {
      throw new Error(
        `Reading ingested game source failed with HTTP ${res.status}: ${JSON.stringify(payload)}`,
      );
    }
    return payload;
  };
  /**
   * The encoding each file came back in, remembered from its own read.
   *
   * The wire is deliberately explicit rather than sniffed (`creation-site-write.ts`
   * §decodeSource: a client that forgets it gets a wrong SHA and a refusal, not a
   * corrupted game), so the WRITE half has to say what the READ half said. Every
   * restore is preceded by that resource's `preflight`, which reads — so by the
   * time `applySource` runs for undo, this map has the answer. A file this
   * backend has never read is text, which is what every source file is.
   *
   * Nothing here is per-game or per-format: base64 is simply what the server
   * returns for bytes that are not text, and this echoes it back.
   */
  const encodingOf = new Map<string, 'utf8' | 'base64'>();
  const unreachable = (verb: string): never => {
    throw new Error(
      `The creation-site source backend has no "${verb}" — an ingested game has no JSX oids; ` +
        'ingest edits are anchored by creation site.',
    );
  };
  return {
    historyIdentity: INGEST_SOURCE_HISTORY_IDENTITY,
    readSource: async (file) => {
      const read = await post<{
        source: string;
        sha: string;
        resourcePath: string;
        encoding?: unknown;
      }>('/__ingest-source/read', { file });
      const binary = read.encoding === 'base64';
      encodingOf.set(file, binary ? 'base64' : 'utf8');
      return binary ? { ...read, bytes: base64ToBytes(read.source) } : read;
    },
    applySource: (file, source, ifMatchSha) =>
      post('/__ingest-source/apply', {
        file,
        source: typeof source === 'string' ? source : bytesToBase64(source),
        ifMatchSha,
        encoding: typeof source === 'string' ? (encodingOf.get(file) ?? 'utf8') : 'base64',
      }),
    writeStyle: () => unreachable('writeStyle'),
    removeStyle: () => unreachable('removeStyle'),
    writeStruct: () => unreachable('writeStruct'),
  };
}

const INGEST_SOURCE_HISTORY_IDENTITY = {};

export class IngestSourcePersistence {
  private readonly backend: SourceWriteBackend;
  private readonly fetchImpl: typeof fetch;
  private readonly history: HistoryService | null;
  private readonly live: IngestLiveAccess;
  private liveResourceKey: ResourceKey | null = null;
  private unregisterLive: (() => void) | null = null;

  constructor(options: IngestSourcePersistenceOptions) {
    this.history = options.history;
    this.live = options.live;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.backend = createIngestSourceBackend(this.fetchImpl);
    void loadIngestOwnership(this.fetchImpl);
  }

  dispose(): void {
    this.unregisterLive?.();
    this.unregisterLive = null;
  }

  /**
   * The ONE cheap-gate decision, shared by the label and by the write.
   *
   * These were two functions once, and they disagreed: the label checked
   * `instances > 1` while the write required `instances === 1`, so an object at
   * a creation site with a count of ZERO was labelled "Persisting to …" and
   * then silently journaled live-only. Found live on SimCity, not by a test —
   * which is exactly the class of bug two parallel condition lists produce, so
   * there is now one list and both callers read it.
   *
   * It is SYNCHRONOUS and reads only cached state, because the live-only path
   * must stay as synchronous as it was before this feature existed:
   * `transforms.endEdit` journals the session's undo entry inline, and
   * deferring that to a microtask broke an `endEdit(); undo()` sequence that
   * had worked for as long as ingest editing has
   * (`three-structural-authoring.test.ts`).
   */
  gate(
    anchor: NodeCreationSite,
    instances: number,
    property: string,
    writeScope: CreationSiteWriteScope = 'instance',
  ): { ok: true } | { ok: false; reason: string } {
    if (!anchor.anchored) return { ok: false, reason: anchor.reason };
    const at =
      anchor.kind === 'data' ? `held at ${anchor.display}` : `created at ${anchor.display}`;
    if (anchor.kind === 'data') {
      // FIRST, because it is the only refusal about the PROPERTY rather than
      // the session: a format that cannot hold this property will not start
      // holding it in another mode, so the sentence the user reads should be
      // about the format and not about anything they could go change.
      const unplaceable = dataPlacementRefusal(property);
      if (unplaceable) return { ok: false, reason: `${at}, but ${unplaceable}` };
    }
    const owned = ownership;
    if (!owned) return { ok: false, reason: `${at}; still checking who owns this game's source` };
    if (!owned.writable) {
      return {
        ok: false,
        reason: `${at}; ${owned.reason ?? 'this game’s source is not writable'}`,
      };
    }
    // `instances` is a SOURCE fact — how many objects one `file:line` built —
    // and it has no data-side analogue: a record index addresses exactly one
    // record, so the ambiguity this rule exists to refuse cannot arise. Reusing
    // the count here would be inventing a number rather than reading one.
    if (anchor.kind === 'source' && instances !== 1 && writeScope !== 'creation-site') {
      return {
        ok: false,
        reason:
          instances === 0
            ? `${at}, but nothing was recorded as constructed there — the editor cannot tell whether that line builds this object alone`
            : `${at}, but that creation site constructs ${instances} objects; a per-object edit cannot be written there`,
      };
    }
    // LAST, because it is the only one a user can change without changing the
    // game: everything above says "no, whatever mode you are in".
    if (!editorIsAuthoring()) {
      return {
        ok: false,
        reason: `${at}, but this game is playing — hold it to author, or the edit stays live-only`,
      };
    }
    return { ok: true };
  }

  /** Would a write even be ATTEMPTED for this object? */
  canAttempt(anchor: NodeCreationSite, instances: number, property: string): boolean {
    return this.gate(anchor, instances, property).ok;
  }

  /**
   * The sentence a surface shows for one object BEFORE any edit.
   *
   * An ANCHORED object always names its `file:line`, even when a gate is shut —
   * "we know exactly where this came from and still cannot write it, because X"
   * is strictly more useful than X alone, and it builds on the creation-site
   * read surface rather than replacing it.
   */
  describe(
    anchor: NodeCreationSite,
    instances: number,
    property: string,
    writeScope: CreationSiteWriteScope = 'instance',
  ): string {
    const verdict = this.gate(anchor, instances, property, writeScope);
    return verdict.ok
      ? `Persisting to ${(anchor as { display: string }).display}.`
      : `Live-only edit — ${verdict.reason}.`;
  }

  /**
   * READ what the construction statement says, for every property in one go.
   *
   * `{}` — not a throw and not a fabricated row — whenever the question has no
   * answer here: an unanchored object, a data anchor (a binary record names no
   * literal), or a tier with no `/__ingest-source/*` route at all. The caller
   * shows nothing rather than a default it invented, which is the same rule the
   * write path follows when a gate is shut.
   *
   * NO MODE GATE. This reads the game's own bytes and changes nothing, so the
   * write path's question — is this gesture authoring or play? — does not arise:
   * asking it here would blank the inspector's read surface for a game that is
   * merely running, which is the state an ingest spends most of its life in.
   */
  async inspect(request: IngestInspectRequest): Promise<Record<string, CreationSiteLiteralReport>> {
    const anchor = request.anchor;
    if (!anchor.anchored || anchor.kind !== 'source') return {};
    if (request.properties.length === 0) return {};
    try {
      const answer = await this.post<{
        properties?: Record<string, CreationSiteLiteralReport>;
      }>('/__ingest-source/inspect', {
        site: { file: anchor.file, line: anchor.line, col: anchor.col },
        instances: request.instances,
        ...(request.writeScope ? { writeScope: request.writeScope } : {}),
        ...(request.surface ? { surface: request.surface } : {}),
        properties: request.properties,
      });
      return answer.properties ?? {};
    } catch {
      // A transport failure is an absence of knowledge, never a claim about the
      // source — the same direction `loadIngestOwnership` fails in.
      return {};
    }
  }

  /**
   * Attempt to write one property edit into the game's own truth.
   *
   * The session-wide gates first (cheap, local, and the answer the user is
   * owed), then the plan against the real bytes, then ONE transaction carries
   * the file and the live value together. WHICH truth is the anchor's own
   * answer: a source
   * anchor plans on the server against a `file:line`, a data anchor plans in
   * the browser through the game's declared writer (see
   * `ingest-data-writer.ts` for why the two halves sit where they do). Both
   * land through the SAME guarded apply route, so the checksum guard and the
   * vendored-lock recorder are identical for either.
   */
  async persist(request: IngestSourceWriteRequest): Promise<IngestSourceWriteOutcome> {
    if (!editorIsAuthoring()) {
      return {
        persisted: false,
        reason: 'this game is playing — a play-time edit lives on the running object only',
      };
    }
    const anchor = request.anchor;
    if (!anchor.anchored) {
      return { persisted: false, reason: anchor.reason };
    }
    const owned = await loadIngestOwnership(this.fetchImpl);
    if (!owned.writable) {
      return { persisted: false, reason: owned.reason ?? 'this game’s source is not writable' };
    }
    if (!this.history) {
      return { persisted: false, reason: 'this session has no project history to record into' };
    }
    if (anchor.kind === 'data') return this.persistData(request, anchor);

    const prepared = await this.post<PreparedResponse>('/__ingest-source/prepare', {
      site: {
        file: anchor.file,
        line: anchor.line,
        col: anchor.col,
      },
      instances: request.instances,
      ...(request.writeScope ? { writeScope: request.writeScope } : {}),
      property: request.property,
      ...(request.surface ? { surface: request.surface } : {}),
      baseline: request.baseline,
      next: request.next,
    });
    if (
      !prepared.changed ||
      !prepared.file ||
      !prepared.resourcePath ||
      prepared.prevSource === undefined ||
      prepared.newSource === undefined ||
      !prepared.prevSha
    ) {
      return { persisted: false, reason: prepared.reason ?? 'the edit was refused' };
    }

    // ONE surgical write, planned in full before this line. The apply is
    // checksum-guarded server-side, so a file that moved under us refuses
    // rather than clobbers — and where the base is a repo-vendored game, that
    // same route brings the game's lock along in the same operation.
    //
    // `note` goes through this direct post rather than `backend.applySource`
    // because it is a property of THIS gesture (which property, at which
    // creation site) and the backend's apply is also the undo/redo path, which
    // has no gesture. The server treats it as a hint over a record it derives
    // from the bytes either way.
    const applied = await this.post<{ applied?: boolean; error?: string }>(
      '/__ingest-source/apply',
      {
        file: prepared.file,
        source: prepared.newSource,
        ifMatchSha: prepared.prevSha,
        note: `${request.property} at ${anchor.display}`,
      },
    );
    if (!applied.applied) {
      return { persisted: false, reason: applied.error ?? 'the write was refused' };
    }

    await this.recordEdit(request, {
      file: prepared.file,
      resourcePath: prepared.resourcePath,
      before: prepared.prevSource,
      after: prepared.newSource,
    });
    return {
      persisted: true,
      file: prepared.file,
      detail: `${request.property} → ${prepared.file}:${anchor.line}`,
    };
  }

  /**
   * Drop a property's authored value from the game's own source — the removal
   * half of {@link persist}, on the SAME route (`prepare` with `remove: true`,
   * then the checksum-guarded `apply` that brings a vendored game's lock along
   * in the same gesture). The plan itself is `planCreationSiteRemoval`: the
   * one deletable shape is the whole own-line assignment statement the
   * insertion arm writes, so this is the byte-exact inverse of an insertion.
   *
   * The recorded transaction is SOURCE-ONLY, unlike {@link recordEdit}'s
   * two-halves shape: a removal has no live half. The running object keeps
   * its value (an unmodified ingested game does not re-derive its scene from
   * source), so there is nothing to restore live on undo — the undo that
   * matters is the file's own bytes, and recording a live half would make one
   * removal restore a value nothing changed.
   */
  async remove(request: IngestSourceRemoveRequest): Promise<IngestSourceWriteOutcome> {
    if (!editorIsAuthoring()) {
      return {
        persisted: false,
        reason: 'this game is playing — a play-time edit lives on the running object only',
      };
    }
    const anchor = request.anchor;
    if (!anchor.anchored) {
      return { persisted: false, reason: anchor.reason };
    }
    const owned = await loadIngestOwnership(this.fetchImpl);
    if (!owned.writable) {
      return { persisted: false, reason: owned.reason ?? 'this game’s source is not writable' };
    }
    if (!this.history) {
      return { persisted: false, reason: 'this session has no project history to record into' };
    }
    if (anchor.kind === 'data') {
      return {
        persisted: false,
        reason:
          "a level-data record has no removable source statement — its property is the record's " +
          'own field, not an authored override',
      };
    }
    const prepared = await this.post<PreparedResponse>('/__ingest-source/prepare', {
      site: { file: anchor.file, line: anchor.line, col: anchor.col },
      instances: request.instances,
      ...(request.writeScope ? { writeScope: request.writeScope } : {}),
      property: request.property,
      ...(request.surface ? { surface: request.surface } : {}),
      remove: true,
    });
    if (
      !prepared.changed ||
      !prepared.file ||
      !prepared.resourcePath ||
      prepared.prevSource === undefined ||
      prepared.newSource === undefined ||
      !prepared.prevSha
    ) {
      return { persisted: false, reason: prepared.reason ?? 'the removal was refused' };
    }
    const applied = await this.post<{ applied?: boolean; error?: string }>(
      '/__ingest-source/apply',
      {
        file: prepared.file,
        source: prepared.newSource,
        ifMatchSha: prepared.prevSha,
        note: `${request.property} removed at ${anchor.display}`,
      },
    );
    if (!applied.applied) {
      return { persisted: false, reason: applied.error ?? 'the removal was refused' };
    }
    const sourceChange = projectSourceAppliedChange(this.backend, this.history, {
      file: prepared.file,
      resourcePath: prepared.resourcePath,
      before: prepared.prevSource,
      after: prepared.newSource,
    });
    await this.history.recordAppliedTransaction(
      { label: request.label, resources: [sourceChange.resource], scope: 'project' },
      [sourceChange],
    );
    return {
      persisted: true,
      file: prepared.file,
      detail: `${request.property} dropped from ${prepared.file}:${anchor.line}`,
    };
  }

  /**
   * The DATA half: read the game's own data file, let the GAME'S OWN writer
   * produce the next bytes, and write them through the same guarded route.
   *
   * Nothing here knows what any byte means. The host's whole contribution is
   * transport, gating and the transaction; every judgement about the file —
   * whether the record exists, whether the property is one this format can
   * hold, whether the new value is even placeable — belongs to the writer and
   * comes back as `{changed: false, reason}` when it is no.
   *
   * BINARY ALL THE WAY THROUGH. The file is carried base64 on both legs and its
   * history snapshots hold that same base64 text while declaring the RAW bytes'
   * sha, which is what makes undo byte-exact: restore hands the previous base64
   * back to `applySource`, the server decodes it, and the digest it reports is
   * the one the snapshot recorded.
   */
  private async persistData(
    request: IngestSourceWriteRequest,
    anchor: Extract<NodeCreationSite, { kind: 'data' }>,
  ): Promise<IngestSourceWriteOutcome> {
    const state = ingestDataWriterNow();
    if (state.state !== 'ready') {
      // Re-ask the anchor mint rather than restating its sentences here: it is
      // the one place a writer's state becomes a reason, so the refusal a user
      // reads mid-gesture is the same one the inspector showed beforehand.
      const now = dataRecordAnchor(anchor.record);
      return {
        persisted: false,
        reason: now.anchored ? "this game's data writer changed mid-gesture" : now.reason,
      };
    }
    const read = await this.post<{
      source?: string;
      sha?: string;
      resourcePath?: string;
      encoding?: string;
      error?: string;
    }>('/__ingest-source/read', { file: anchor.file });
    if (typeof read.source !== 'string' || !read.sha || !read.resourcePath) {
      return {
        persisted: false,
        reason: read.error ?? `this game's data file ${anchor.file} could not be read`,
      };
    }
    if (read.encoding !== 'base64') {
      return {
        persisted: false,
        reason:
          `${anchor.file} came back as ${read.encoding ?? 'utf8'} text, not bytes — a data writer ` +
          'edits binary game data, and writing text back through it would change the file',
      };
    }

    let plan: DataEditPlan;
    try {
      plan = await state.writer.planDataEdit(base64ToBytes(read.source), {
        record: anchor.record,
        property: request.property,
        baseline: request.baseline,
        next: request.next,
      });
    } catch (error) {
      return {
        persisted: false,
        reason: `this game's data writer refused: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (!plan.changed) return { persisted: false, reason: plan.reason };

    const nextSource = bytesToBase64(plan.bytes);
    const applied = await this.post<{ applied?: boolean; error?: string }>(
      '/__ingest-source/apply',
      {
        file: anchor.file,
        source: nextSource,
        encoding: 'base64',
        ifMatchSha: read.sha,
        note: `${request.property} at ${anchor.display}`,
      },
    );
    if (!applied.applied) {
      return { persisted: false, reason: applied.error ?? 'the write was refused' };
    }

    // The FILE's bytes into history, not the base64 the wire carried: a
    // snapshot's `sha256` is the file's own digest, which is what undo compares
    // the apply's answer against.
    await this.recordEdit(request, {
      file: anchor.file,
      resourcePath: read.resourcePath,
      before: base64ToBytes(read.source),
      after: plan.bytes,
    });
    return {
      persisted: true,
      file: anchor.file,
      detail: `${request.property} → ${anchor.display}`,
    };
  }

  /**
   * ONE history transaction carrying BOTH halves of a persisted edit — the
   * file's bytes and the live object's value — so a single undo puts the game
   * and the file back together. Shared by the source and data paths because the
   * property it guarantees is the same one either way.
   */
  private async recordEdit(
    request: IngestSourceWriteRequest,
    file: {
      file: string;
      resourcePath: string;
      before: string | Uint8Array;
      after: string | Uint8Array;
    },
  ): Promise<void> {
    const history = this.history!;
    const liveKey = this.ensureLiveResource();
    const sourceChange = projectSourceAppliedChange(this.backend, history, file);
    const before: LiveSnapshot = {
      objects: { [request.entityId]: { [request.property]: request.baseline } },
    };
    const after: LiveSnapshot = {
      objects: { [request.entityId]: { [request.property]: request.next } },
    };
    await history.recordAppliedTransaction(
      { label: request.label, resources: [sourceChange.resource, liveKey], scope: 'project' },
      [
        sourceChange,
        {
          resource: liveKey,
          beforeBytes: encoder.encode(JSON.stringify(before)),
          afterBytes: encoder.encode(JSON.stringify(after)),
          contentType: 'application/json',
        },
      ],
    );
  }

  private async post<T>(url: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  /**
   * The live half's history resource, registered on first use.
   *
   * WHY IT EXISTS AT ALL. In the R3F precedent the source IS the live tree's
   * truth, so restoring the file re-renders the objects and one resource covers
   * both. An unmodified ingested game does not re-derive its scene from source
   * — nothing re-runs `#setupLights()` because a literal changed — so undoing
   * only the file would leave the running game showing the edit it just
   * "undid". This resource is the missing half, and it is deliberately narrow:
   * its snapshots name only the (object, property) pairs a persisted edit
   * touched, never a mirror of the scene.
   *
   * PREFLIGHT ALWAYS PASSES, for the reason `JsonHistoryResource`'s
   * `conflictIdentity` exists (issue #81): an ingested game is a RUNNING game
   * that moves its own objects every frame, so a byte-comparison of live state
   * against a snapshot taken moments ago is guaranteed to differ and would make
   * every undo fail with `content-conflict`. The conflict that actually matters
   * here — someone else editing the file — is caught by the SOURCE resource's
   * preflight, which is in the same transaction.
   */
  private ensureLiveResource(): ResourceKey {
    if (this.liveResourceKey) return this.liveResourceKey;
    const history = this.history!;
    const descriptor = history.registry.registerProject(
      'overlay',
      '.vgai/ingest-live-objects',
      'Ingested game objects',
    );
    const driver: ResourceDriver = {
      descriptor,
      // Never reached on this resource's own path: it is journaled ONLY through
      // `recordAppliedTransaction`, which supplies both snapshots itself and
      // never captures. It is implemented honestly anyway (empty = "no tracked
      // live values", with a real digest) rather than as a throw, because the
      // driver contract belongs to the history service, not to this caller.
      capture: async () => {
        const bytes = encoder.encode(JSON.stringify({ objects: {} } satisfies LiveSnapshot));
        return {
          revision: 0,
          contentType: 'application/json',
          bytes,
          sha256: await sha256Hex(bytes),
        };
      },
      preflight: async () => ({ ok: true }),
      restore: async (snapshot) => {
        const value = JSON.parse(
          decoder.decode(history.snapshots.read(snapshot).bytes),
        ) as LiveSnapshot;
        for (const [entityId, properties] of Object.entries(value.objects)) {
          for (const [property, propertyValue] of Object.entries(properties)) {
            this.live.apply(entityId, property, propertyValue);
          }
        }
      },
      estimateBytes: (snapshot) => snapshot.byteLength,
    };
    this.unregisterLive = history.registerDriver(driver);
    this.liveResourceKey = descriptor.key;
    return descriptor.key;
  }
}

/**
 * Report a refusal where the user can see it, once per gesture.
 *
 * A WARNING, not a log line, because of where each one goes: `vgai status`
 * surfaces `sessionWarnings` and shows nothing at all for `log`. A refused
 * write was invisible to every door the product has — the user's edit did not
 * reach their file and the only explanation lived in a panel nobody could read
 * from a terminal, which is the class of gap that sends people to an
 * out-of-band tool. A write the user asked for and did not get is exactly what
 * a warning is for. Successes stay `log`.
 */
export function reportIngestSourceRefusal(label: string, reason: string): void {
  editorConsole.warn(`[ingest] ${label} stayed live-only — ${reason}.`);
}
