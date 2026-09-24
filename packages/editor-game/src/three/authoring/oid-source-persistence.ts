/**
 * OID-SOURCE persistence — the {@link SourcePersistenceBackend} backend for a live
 * three world whose OWN source the serve-time OID transform reached.
 *
 * WHY IT EXISTS, measured rather than assumed. `createCreationSitePersistence`
 * anchors an edit at the `new` expression that constructed the object, read
 * from the creation-site registry (`creation-site-registry.ts`). A vendored R3F
 * game has none: every `THREE.Mesh`/`THREE.PointLight` in it is constructed by
 * react-three-fiber's reconciler inside `node_modules`, so the registry answers
 * `constructed outside project source` for EVERY object in the world and the
 * creation-site writer can never fire once. The game's own source still says
 * exactly where each object came from — it says it in JSX
 * (`<mesh position={[0, 1, 0]}>`), and `vite-plugin-ui-oid.ts` already stamps
 * that callsite onto the constructed object as `userData.oid`. This backend is
 * the other end of that stamp.
 *
 * THE WRITE LANE IS THE NATIVE ONE, not a second implementation of it: a write
 * is `SourceWriteBackend.writeProp(oid, prop, value)` — the same
 * `/__ui-source/prop` endpoint the first-party R3F adapter's gizmo commits
 * through (`r3f-source-authoring-adapter.ts`), so the JSX planning, the
 * expression-bound refusal, the checksum guard and the vendored-lock recorder
 * (`writeEditableSource`) are literally the same code for a vendored game as
 * for a project's own world. Wrapped in `withProjectSourceHistory`, so one
 * gesture is one checksum-guarded, undoable project-history transaction.
 *
 * NO LIVE-HALF HISTORY RESOURCE, and that is a fact about R3F rather than an
 * omission. `IngestSourcePersistence.ensureLiveResource` exists because an
 * unmodified imperative game does not re-derive its scene from source —
 * nothing re-runs `#setupLights()` because a literal changed — so undoing the
 * file alone would leave the running game showing the edit it just undid. A
 * fiber world DOES re-derive: restoring the file re-renders the component and
 * the object's props come back from source, which is the same reason the
 * first-party R3F lane needs no live half either. Where there is no HMR at all
 * (a dev server whose watcher ignores the tree), the file is still truth and
 * the next mount shows it.
 */

import { reportIngestSourceRefusal } from '@editor/authoring/ingest-source-persistence';
import type { SourcePersistenceBackend } from '@editor/authoring/source-persistence-backend';
import { LIVE_ONLY_DESTINATION } from '@editor/authoring/write-pipe';
import type { ChannelValue } from '@editor/creation-site-edit';
import { channelFor } from '@editor/creation-site-edit';
import { editorConsole } from '@editor/editor-console';
import { editorIsAuthoring } from '@editor/editor-session-mode';
import type { HistoryService } from '@editor/history/history-service';
import { withProjectSourceHistory } from '@editor/history/source-history-backend';
import { getCurrentProject } from '@editor/project-manager';
import type { OidEntry } from '@editor/ui-source/oid-transform';
import { bodyPlacedChannel, physicsRefusal } from '@editor/ui-source/r3f-physics-binding';
import type { SourceWriteBackend } from '@editor/ui-source/source-write-backend';
import { sourceWriteBackendIfPrimed } from '@editor/ui-source/tier-source-write-backend';
import type { NodeCreationSite, WriteAck } from '@vgai/project/adapter';

/** What `AuthoringAdapter.persistence.destination` reports once this backend is
 *  actually able to write. */
export const OID_SOURCE_DESTINATION = "the game's own JSX source (source-stamp write-back)";

/**
 * The editor property paths this backend can express as a JSX attribute, and
 * the attribute each one IS.
 *
 * Deliberately a subset of `CREATION_SITE_CHANNELS` rather than a parallel
 * table: a path absent here is refused BY NAME (`gate` says which), never
 * guessed at. `material.color` is the notable absence — its owner hop lands on
 * the material, and a material's own JSX tag (`<meshStandardMaterial color=…>`)
 * carries its own stamp, so the adapter hands us that oid and `color` is the
 * right attribute on it. `name`/`visible`/shadow flags are ordinary R3F props
 * on the object's own tag.
 */
const JSX_PROP_BY_CHANNEL: Readonly<Record<string, string>> = {
  position: 'position',
  rotation: 'rotation',
  scale: 'scale',
  visible: 'visible',
  name: 'name',
  'material.color': 'color',
  'light.color': 'color',
  'light.intensity': 'intensity',
  'light.distance': 'distance',
  'camera.fov': 'fov',
  'camera.near': 'near',
  'camera.far': 'far',
  'shadow.cast': 'castShadow',
  'shadow.receive': 'receiveShadow',
};

/** ≤4 decimals, no trailing zeros — the same notation the R3F source adapter
 *  writes tuples in, so a hand-written file and a gizmo-written one read alike. */
function fmt(n: number): string {
  const rounded = Math.round(n * 1e4) / 1e4;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * One channel value as the RAW value text `writeProp` takes — `[0, 26, 20]`,
 * `26`, `false`, `#ff8800`.
 *
 * NOT the attribute text. The writer decides the wrapper itself
 * (`ui-source/writer.ts`'s `formatPropReplacement`/`formatNewAttr`): it matches
 * the shape of the literal already in source, and a value arriving pre-wrapped
 * in `{…}` is a SHAPE MISMATCH it silently refuses — `{changed:false}` with no
 * error, which is the quietest possible failure and is exactly what this got
 * wrong first (measured live: the gesture reached the server and reported
 * "the source writer made no change"). The first-party R3F lane's
 * `commitTransformEdit` sends the same raw form.
 *
 * `null` ⇒ this backend cannot express the value, which is a refusal with a
 * reason rather than a best effort.
 */
export function jsxPropValueText(property: string, value: ChannelValue): string | null {
  const kind = channelFor(property)?.kind;
  if (kind === 'vector3' || kind === 'euler') {
    if (!Array.isArray(value) || value.length !== 3) return null;
    if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return `[${(value as number[]).map(fmt).join(', ')}]`;
  }
  if (kind === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? fmt(value) : null;
  }
  if (kind === 'boolean') return typeof value === 'boolean' ? String(value) : null;
  if (kind === 'color' || kind === 'string') {
    return typeof value === 'string' ? value.replace(/["\\]/g, '') : null;
  }
  return null;
}

/**
 * Why a component callsite's OWN transform prop would be ignored if written —
 * `null` when there is no reason, which is the ordinary case.
 *
 * The index carries the component's source-proven authoring contract, so this
 * is read from an analysis of the definition rather than guessed: a component
 * that neither accepts nor spreads the prop would take the write silently and
 * render exactly as before, which is source that lies. The first-party R3F lane
 * makes the same two refusals from the same field
 * (`r3f-source-authoring-adapter.ts`'s `transformEditability`).
 */
function contractRefusal(entry: OidEntry | null, prop: string): string | null {
  // A body binding outranks the contract question: when a simulation owns this
  // element's transform, "does not forward position" is not merely unhelpful,
  // it is about the wrong artifact (`ui-source/r3f-physics-binding.ts`).
  const physics = physicsRefusal(entry ?? undefined, prop);
  if (physics) return physics;
  const contract = entry?.r3fAuthoring;
  if (!contract) return null;
  if (prop !== 'position' && prop !== 'rotation' && prop !== 'scale') return null;
  const tag = `<${entry?.tag ?? 'this component'}>`;
  if (contract.simulationOwnedTransform === true) {
    return (
      `${tag} drives its own ${prop} every frame — this instance is placed by the simulation, ` +
      'not by the editor'
    );
  }
  if (!(contract.transformProps as readonly string[]).includes(prop)) {
    return `${tag} does not forward ${prop} to its native root`;
  }
  return null;
}

export interface OidTransformSourceCommitter {
  availability(sourceOid: string | undefined): { available: boolean; reason?: string };
  commit(
    sourceOid: string | undefined,
    values: Readonly<Record<string, ChannelValue>>,
  ): Promise<WriteAck>;
}

function oidSourceAnchor(
  entry: OidEntry,
): Extract<NodeCreationSite, { anchored: true; kind: 'source' }> {
  const normalized = entry.file.replaceAll('\\', '/');
  const root = getCurrentProject()?.rootPath.replaceAll('\\', '/').replace(/\/$/, '');
  const file =
    root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
  return {
    anchored: true,
    kind: 'source',
    file,
    line: entry.line,
    col: entry.col,
    display: `${file}:${entry.line}`,
  };
}

/** Read source locations without granting persistence to a running world. */
export async function readOidSourceAnchors(
  backend?: SourceWriteBackend,
): Promise<(sourceOid: string) => NodeCreationSite | null> {
  try {
    const source = backend ?? sourceWriteBackendIfPrimed('Live source locations');
    const index = await source?.index?.();
    return (sourceOid) => {
      const entry = index?.[sourceOid];
      return entry ? oidSourceAnchor(entry) : null;
    };
  } catch {
    // Missing provenance must not prevent the game from starting.
    return () => null;
  }
}

async function writeTransformLiterals(
  backend: SourceWriteBackend,
  sourceOid: string,
  writes: readonly { property: string; text: string }[],
): Promise<number> {
  const writeProp = backend.writeProp;
  if (!writeProp) throw new Error('the gesture-scoped source writer cannot write JSX props');
  let changed = 0;
  for (const { property, text } of writes) {
    const result = await writeProp(sourceOid, property, text, {
      addIfMissing: true,
      allowShapeUpgrade: true,
    });
    if (result.dynamic) {
      throw new Error(`${property} is bound to a JSX expression, not an authored literal`);
    }
    if (!result.changed && result.error) throw new Error(result.error);
    if (result.changed) changed++;
  }
  return changed;
}

/** The explicit Play→source door. It is deliberately separate from
 * createOidSourcePersistence: that backend's ordinary gesture gate refuses
 * Play, while this one is invoked only after the user explicitly attributes a
 * selected live pose to source. Both still use the exact same OID writer and
 * project-history transaction. */
export function createOidTransformSourceCommitter(
  options: OidSourcePersistenceOptions,
): OidTransformSourceCommitter {
  const raw = options.backend ?? sourceWriteBackendIfPrimed('The Play→source transform committer');
  const backend = withProjectSourceHistory(raw, options.history);
  const availability = (sourceOid: string | undefined): { available: boolean; reason?: string } => {
    if (!sourceOid) {
      return {
        available: false,
        reason: 'This live node has no OID source stamp, so no authored literal owns its pose.',
      };
    }
    if (!backend?.runGesture || !backend.writeProp || !backend.index) {
      return {
        available: false,
        reason: 'This editor session cannot open a checksum-guarded project-source gesture.',
      };
    }
    return { available: true };
  };
  const refuse = (reason: string): WriteAck => {
    editorConsole.warn(`[play] Commit live transform to source refused: ${reason}`, 'play-mode');
    return { destination: LIVE_ONLY_DESTINATION, persisted: false };
  };

  return {
    availability,
    async commit(sourceOid, values) {
      const available = availability(sourceOid);
      if (!available.available || !sourceOid || !backend?.runGesture || !backend.index) {
        return refuse(available.reason ?? 'the source writer is unavailable');
      }
      const index = await backend.index();
      const entry = index[sourceOid] ?? null;
      if (!entry) return refuse(`the current source index has no entry for OID "${sourceOid}"`);
      const writes = ['position', 'rotation', 'scale'].map((property) => {
        const blocked = contractRefusal(entry, property);
        if (blocked) throw new Error(blocked);
        const value = values[property];
        const text = value === undefined ? null : jsxPropValueText(property, value);
        if (text === null) throw new Error(`${property} is not a finite transform literal`);
        return { property, text };
      });
      let changed: number;
      try {
        changed = await backend.runGesture('Commit Play Transform to Source', (scoped) =>
          writeTransformLiterals(scoped, sourceOid, writes),
        );
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error));
      }
      if (changed === 0) {
        editorConsole.log(
          '[play] Source already matches the selected live transform.',
          'play-mode',
        );
        return { destination: 'source already matched the live transform', persisted: false };
      }
      editorConsole.log(
        `[play] Committed ${changed} live transform literal(s) to ${entry.file}:${entry.line}.`,
        'play-mode',
      );
      return { destination: OID_SOURCE_DESTINATION, persisted: true };
    },
  };
}

export interface OidSourcePersistenceOptions {
  readonly history: HistoryService | null;
  /**
   * Injectable so a unit test can drive the whole gesture without a server.
   * Absent in production: the backend builds the ordinary HTTP one when THIS
   * SESSION'S HOST serves the `/__ui-source/*` recorder, and stays at the
   * honest live-only floor when it does not. See
   * `../ui-source/tier-source-write-backend.ts`.
   */
  readonly backend?: SourceWriteBackend | undefined;
}

export function createOidSourcePersistence(
  options: OidSourcePersistenceOptions,
): SourcePersistenceBackend {
  let backend: SourceWriteBackend | null = null;
  /** oid → where the served source says that element is. Fetched once per
   *  attach and refreshed after every accepted write, because a write moves
   *  the lines below it. */
  let index = new Map<string, OidEntry>();
  let indexLoaded = false;

  const refreshIndex = async (): Promise<void> => {
    const raw = backend?.index;
    if (!raw) return;
    try {
      index = new Map(Object.entries(await raw.call(backend)));
      indexLoaded = true;
    } catch {
      // Honest degradation: without the index this backend still WRITES (the
      // server resolves the oid itself); it just cannot name the file:line in
      // the sentence it shows beforehand.
    }
  };

  const entryOf = (sourceOid: string | undefined): OidEntry | null =>
    sourceOid ? (index.get(sourceOid) ?? null) : null;

  const displayOf = (sourceOid: string | undefined): string | null => {
    const entry = entryOf(sourceOid);
    return entry ? oidSourceAnchor(entry).display : null;
  };

  /**
   * The cheap gate, read from cached state only — the live-only path must stay
   * synchronous (see `SourcePersistenceBackend.gate`).
   *
   * The literal-vs-expression question is deliberately NOT asked here: it is
   * answered against the game's real bytes by the same server planner the
   * first-party R3F lane uses, which comes back `dynamic: true` and is reported
   * as the refusal it is. Guessing at it from a stale client-side copy of the
   * source is how two condition lists start disagreeing.
   */
  const verdict = (
    sourceOid: string | undefined,
    property: string,
  ): { ok: true } | { ok: false; reason: string } => {
    if (!sourceOid) {
      return {
        ok: false,
        reason:
          'this object carries no source stamp — the game built it at runtime rather than ' +
          'writing it as an element of its own source',
      };
    }
    if (!backend?.writeProp) {
      return { ok: false, reason: 'this editor tier cannot write project source' };
    }
    const prop = JSX_PROP_BY_CHANNEL[property];
    if (!prop) {
      return { ok: false, reason: `${property} has no JSX attribute this seam can write` };
    }
    const ignored = contractRefusal(entryOf(sourceOid), prop);
    if (ignored) return { ok: false, reason: ignored };
    // The MODE, last: everything above is a fact about this element that no
    // amount of holding the game would change.
    if (!editorIsAuthoring()) {
      const at = displayOf(sourceOid);
      return {
        ok: false,
        reason: `${at ? `written at ${at}` : 'source-stamped'}, but this game is playing — hold it to author`,
      };
    }
    return { ok: true };
  };

  return {
    attach() {
      const raw =
        options.backend ??
        sourceWriteBackendIfPrimed('This world’s OID source persistence') ??
        null;
      backend = raw ? (withProjectSourceHistory(raw, options.history) ?? raw) : null;
      void refreshIndex();
    },
    anchor(sourceOid) {
      const entry = index.get(sourceOid);
      if (!entry) return null;
      return oidSourceAnchor(entry);
    },
    physicsPlaced(sourceOid, property) {
      // `r3f-physics-binding.ts` owns this derivation, and the first-party R3F
      // lane's own classifier reads the same function — two copies of "does a
      // body read this value?" is how two lanes come to disagree about one
      // element.
      return bodyPlacedChannel(
        entryOf(sourceOid) ?? undefined,
        JSX_PROP_BY_CHANNEL[property] ?? property,
      );
    },
    describe({ sourceOid, property }) {
      const decided = verdict(sourceOid, property);
      if (!decided.ok) return `Live-only edit — ${decided.reason}.`;
      const at = displayOf(sourceOid);
      return at
        ? `Persisting to ${at}.`
        : `Persisting to this element's own JSX${indexLoaded ? '' : ' (source index still loading)'}.`;
    },
    gate({ sourceOid, property }) {
      return verdict(sourceOid, property);
    },
    armed: () => backend?.writeProp !== undefined && editorIsAuthoring(),
    report: (label, reason) => reportIngestSourceRefusal(label, reason),
    async write(request) {
      const decided = verdict(request.sourceOid, request.property);
      if (!decided.ok) {
        reportIngestSourceRefusal(request.label, decided.reason);
        return false;
      }
      const prop = JSX_PROP_BY_CHANNEL[request.property]!;
      const text = jsxPropValueText(request.property, request.next);
      if (text === null) {
        reportIngestSourceRefusal(
          request.label,
          `the new ${request.property} is not a value this seam can spell as a JSX literal`,
        );
        return false;
      }
      try {
        const result = await backend!.writeProp!(request.sourceOid!, prop, text, {
          addIfMissing: true,
          allowShapeUpgrade: true,
        });
        if (result.dynamic) {
          reportIngestSourceRefusal(
            request.label,
            `${prop} at ${displayOf(request.sourceOid) ?? 'this element'} is bound to a JSX expression, not a literal`,
          );
          return false;
        }
        if (!result.changed) {
          reportIngestSourceRefusal(
            request.label,
            result.error ?? 'the source writer made no change',
          );
          return false;
        }
        editorConsole.log(
          `[ingest] ${request.label} written to the game's own source — ${prop} → ${
            displayOf(request.sourceOid) ?? request.sourceOid
          }`,
        );
        // The write moved the lines below it; every later `describe` reads this
        // index, so a stale copy would start naming the wrong line.
        void refreshIndex();
        return true;
      } catch (error) {
        reportIngestSourceRefusal(
          request.label,
          `the write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    /**
     * THE REMOVAL DOOR, on the SAME native lane as the write: the
     * `/__ui-source/prop` endpoint's `value: null` sentinel
     * (`SourceWriteBackend.removeProp`), which the middleware routes to
     * `removePropAttribute` and writes through `writeEditableSource` — so a
     * removal on a repo-vendored game records in that game's lock in the same
     * gesture a value write does. Nothing here is a second implementation of
     * anything; the recorder, the checksum guard and the project-history
     * transaction (`withProjectSourceHistory` wraps `removeProp` too) are
     * literally the same code.
     */
    removal: {
      /**
       * The write gate, plus the one extra fact a removal needs: this
       * session's recorder has a `removeProp` at all (`writeProp`'s absence
       * already refuses the write half).
       *
       * WHAT THIS ANSWER DOES NOT CLAIM, and cannot: whether the callsite
       * CURRENTLY carries the attribute. This client holds an oid → file:line
       * index, never the game's source text — the same structural fact that
       * makes `anchor` honestly `null` for an oid the index has not resolved,
       * and the reason `writeProp` sends the OID for the SERVER to resolve.
       * The first-party R3F lane can read its own file and so answers both
       * halves (`r3f-source-authoring-adapter.ts`'s `transformEditability`);
       * this one answers for the DOOR and lets `perform` — which returns the
       * server's own `changed` — answer for the drop. What it must never do is
       * the inverse: ack a removal that took no byte, and it does not.
       */
      available({ sourceOid, property }) {
        if (!backend?.removeProp) return false;
        return verdict(sourceOid, property).ok;
      },
      async perform(request) {
        const decided = verdict(request.sourceOid, request.property);
        if (!decided.ok || !backend?.removeProp) {
          reportIngestSourceRefusal(
            request.label,
            decided.ok ? 'this editor tier cannot remove project source' : decided.reason,
          );
          return false;
        }
        const prop = JSX_PROP_BY_CHANNEL[request.property]!;
        try {
          const result = await backend.removeProp(request.sourceOid!, prop);
          if (result.dynamic) {
            reportIngestSourceRefusal(
              request.label,
              `${prop} at ${displayOf(request.sourceOid) ?? 'this element'} is bound to a JSX expression — removing it would delete the game's own wiring, not an override`,
            );
            return false;
          }
          if (!result.changed) {
            reportIngestSourceRefusal(
              request.label,
              result.error ??
                `${displayOf(request.sourceOid) ?? 'this element'} authors no ${prop} attribute, so there was nothing to drop`,
            );
            return false;
          }
          editorConsole.log(
            `[ingest] ${request.label} — ${prop} dropped from the game's own source at ${
              displayOf(request.sourceOid) ?? request.sourceOid
            }`,
          );
          // A removal moves the lines below it exactly as a write does.
          void refreshIndex();
          return true;
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
      return backend?.writeProp && editorIsAuthoring()
        ? OID_SOURCE_DESTINATION
        : LIVE_ONLY_DESTINATION;
    },
    dispose() {
      backend = null;
      index = new Map();
      indexLoaded = false;
    },
  };
}
