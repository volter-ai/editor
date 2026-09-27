/**
 * THE INSTRUMENT: what a mount MEASURED about itself, assembled from the live
 * session slot and handed to the pure derivation in `coverage/capability-coverage.ts`.
 *
 * Everything here is a measurement or the plumbing of one — the mount-time
 * one-shot probe (the editor capabilities reached),
 * the live re-read of the loop verdict, the once-per-mount
 * console door, and the report the status facet and the `__vgaiIngest` hook
 * both serve. Mount PLUMBING lives in the `mount-*-ingest-root.ts` siblings
 * and deliberately not here: a reader asking "what did the editor actually
 * measure about this game, and where does that number come from" should have
 * exactly this file open.
 */

import type { AdapterReach } from '../host/adapter-reach';
import { getActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import { ingestDataWriterNow } from '../host/authoring/ingest-data-writer';
import { ingestOwnershipNow } from '../host/authoring/ingest-source-persistence';
import {
  type CapabilityCoverageReport,
  createCapabilityCoverageConsole,
  type DataWriterFacts,
  deriveCapabilityCoverage,
  measureGameContract,
  SYSTEM_ADAPTER_SLOTS,
  type SystemAdapterMeasurement,
  type WriteReachFacts,
} from '../host/coverage/capability-coverage';
import { inspectSystemAdapterSeam } from '@volter/editor-sdk/kit/system-seam-evidence';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  type MeasuredLoop,
  measuredLoop,
  type SameRealmLoopVerdict,
} from '../host/same-realm-loop-gate';
import {
  type ContractSurface,
  projectContractSystemAdapters,
} from '../runtime/adapter/ingest/contract-system-adapters';
import type { VgaiGameContract } from '@volter/editor-project/adapter/ingest/game-contract';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import { activeIngest } from './active-ingest';
import type { IngestMount } from './authoring/ingest-root-adapter';
import { activeIngestContract } from './ingest-play-control';

/**
 * The half of {@link deriveCapabilityCoverage}'s facts that is a property of THIS
 * mount and cannot be re-read later: the editor capabilities this mount
 * reached, with the mechanism that reached them. Everything else the
 * coverage report needs (the loop verdict, the declared
 * contract — its systems surface included — and the ownership answer) is read
 * live at report time, because all of them move after the mount and a frozen
 * copy would start lying.
 */
export interface MountCoverageInputs {
  readonly reach: AdapterReach | null;
  /** How this mount reached the game's runtime, in the mount's own words,
   *  carried into the warning a missing capability prints. */
  readonly reachMechanism: string | null;
  /** Read on demand because a loop verdict may arrive only after the first
   *  pause probe. Every surface supplies its own real control verdict, and a
   *  route with no gate at all supplies the reason there will never be one. */
  readonly loop: () => { loop: MeasuredLoop | null; reason: string | null };
  /**
   * How much of the mounted world an edit can actually be written back to, read
   * LIVE for the same reason the loop verdict is: a world keeps streaming
   * objects in, and a count frozen at first capture would start lying.
   *
   * ABSENT ⇒ this route has no three authoring adapter to ask (a DOM or
   * canvas ingest), and the persistence row says only what ownership answered —
   * never a reach claim nobody measured.
   */
  readonly writeReach?: (() => WriteReachFacts) | undefined;
}

/**
 * The console door for the coverage report (`coverage/capability-coverage.ts`) —
 * gaps as one warning block, the rest as one info block, ONCE per mount.
 */
const _coverageConsole = createCapabilityCoverageConsole((block) => {
  if (block.level === 'warn') editorConsole.warn(block.message, 'ingest');
  else editorConsole.log(block.message, 'ingest');
});

/** Distinguishes consecutive mounts of the SAME world for the console door's
 *  once-per-mount guard — remounting a game is a new answer, not a repeat. */
let _mountSeq = 0;
let _mountToken = '';

/** Open a new coverage answer for `sessionId`: a new mount is a new report even
 *  for the same world, and the console door's once-guard keys on this token. */
export function beginMountCoverage(sessionId: string): void {
  _mountToken = `${sessionId}#${++_mountSeq}`;
}

/**
 * The loop facts for a three-route mount, read live.
 *
 * A verdict is a MEASUREMENT, produced by the gate's own probe at the first
 * pause — and it travels WITH the evidence it was concluded from
 * ({@link MeasuredLoop}), which is what keeps it distinguishable from the
 * manifest's declared intent word. Where the mount installed no gate at all the
 * honest answer is "no verdict will ever be measured here", never the
 * pending-probe sentence, which promises a measurement that does not come.
 */
export function threeMountLoopFacts(mount: IngestMount): {
  loop: MeasuredLoop | null;
  reason: string | null;
} {
  const loop = measuredLoop(mount.realmLoopVerdict?.());
  const reason = mount.realmLoopVerdict?.()?.reason ?? null;
  if (loop !== null || reason !== null) return { loop, reason };
  if (mount.realmLoopVerdict) return { loop: null, reason: null };
  return { loop: null, reason: LOOP_PROBE_ABSENT };
}

/**
 * The loop facts for a native-React (`dom`) mount — its SIBLING to
 * {@link threeMountLoopFacts}, and the reason it exists as a named function
 * rather than a literal at the mount site.
 *
 * This route used to assert `loop: 'gated'` outright, on the strength of the
 * sentence below. That sentence is true and it is still printed, but it
 * describes a MECHANISM, not a measurement of one: no probe on this route has
 * ever held this game's scheduling and watched whether anything ran anyway
 * (`ingest/same-realm-loop-gate.ts`'s `verifySameRealmLoopControl` is the only
 * thing that can answer that, and nothing calls it here). The word it emitted
 * was the manifest's DECLARED intent vocabulary wearing a measurement's
 * clothes, so the coverage report printed `loop ✓ gated` about every
 * native-React ingest — including one whose own `setInterval` the host's play
 * pause never touches.
 *
 * Same shape and same reason as `mount-canvas-ingest-root.ts`'s two branches,
 * which reach the identical conclusion about their own unprobed controls.
 */
export function domMountLoopFacts(): { loop: null; reason: string } {
  return {
    loop: null,
    reason:
      "⏸ calls the host runtime's own play pause on this route, but no probe has measured " +
      "whether that reaches this game's frames — an unmodified React game that schedules its " +
      'own timers is not held by the host loop',
  };
}

/** What a mount with no loop gate at all can honestly say about its frames. */
export const LOOP_PROBE_ABSENT =
  'this mount installs no loop gate, so no verdict will ever be measured here — nothing in ' +
  "the editor holds this game's frames";

/**
 * The terminal state of every `SystemAdapters` slot for a live mount.
 *
 * TWO independent sources, deliberately: `bound` is read off the editor's own
 * live registry (the very object its panels call, so a slot that "registered"
 * but never reached the registry reports honestly), while `empty`/`malformed`
 * come from the game's declared carrier. Nothing consults the route or the
 * game's id, and no slot is bound and empty at once — a bound adapter wins,
 * because the registry is the stronger measurement.
 *
 * Exported and pure over its inputs so the whole table is unit-testable with no
 * browser and no live session.
 */
export function measureSystemAdapters(
  active: SystemAdapters,
  contract: VgaiGameContract | null,
  /** The mount's surface when the caller has one — see
   *  `contract-system-adapters.ts`'s header for the one slot it decides
   *  (`physics`, whose vocabulary follows the surface). */
  surface?: ContractSurface | undefined,
): readonly SystemAdapterMeasurement[] {
  const projection = projectContractSystemAdapters(contract?.systems, surface);
  const empty = new Map(projection.empty.map((e) => [e.slot as string, e.evidence]));
  const malformed = new Map(projection.malformed.map((m) => [m.slot as string, m.reason]));
  return SYSTEM_ADAPTER_SLOTS.map((slot): SystemAdapterMeasurement => {
    if (active[slot] != null) {
      return {
        slot,
        state: 'bound',
        proof: inspectSystemAdapterSeam({
          slot,
          adapter: active[slot] as NonNullable<SystemAdapters[typeof slot]>,
          subject: 'game',
        }),
      };
    }
    const evidence = empty.get(slot);
    if (evidence !== undefined) return { slot, state: 'empty', evidence };
    const reason = malformed.get(slot);
    if (reason !== undefined) return { slot, state: 'malformed', evidence: reason };
    return { slot, state: 'unanswered' };
  });
}

/**
 * THE coverage report for the live mount — re-derived on every read (see
 * {@link MountCoverageInputs} for what is frozen at mount and what is not).
 * `null` when nothing is mounted, or when the mounted route recorded no
 * coverage inputs: not measured is its own answer, never a clean one.
 *
 * The contract comes from `activeIngestContract` — the same read
 * `getIngestPlayControl` acts on, so a game that declared its contract
 * somewhere the host cannot see reports the same gap the editor actually has,
 * and one that declared it through a host-added contract shim beside the game
 * gets credit for exactly what the play control can use.
 */
/**
 * The declared data writer's state, in the coverage vocabulary. `absent` — the
 * common case — is `null`, not a gap: a game with no data file to write is not
 * missing anything.
 */
function dataWriterFacts(): DataWriterFacts | null {
  const state = ingestDataWriterNow();
  switch (state.state) {
    case 'absent':
      return null;
    case 'loading':
      return { state: 'loading' };
    case 'ready':
      return { state: 'ready', dataFile: state.writer.dataFile };
    default:
      return { state: 'failed', reason: state.reason };
  }
}

export function ingestCoverageReport(): CapabilityCoverageReport | null {
  const active = activeIngest();
  const inputs = active?.coverage;
  if (!active || !inputs) return null;
  const ownership = ingestOwnershipNow();
  const loop = inputs.loop();
  const contract = activeIngestContract();
  return deriveCapabilityCoverage({
    worldId: active.worldId,
    reach: inputs.reach,
    // The session's own render substrate IS the surface kind the coverage
    // derivation needs (`IngestKind` and `AdapterSurface` are the same three
    // words by construction), so nothing has to be declared twice.
    surface: active.kind,
    reachMechanism: inputs.reachMechanism,
    loop: loop.loop,
    loopReason: loop.reason,
    contract: measureGameContract(contract),
    // `active.kind` IS the surface (`IngestKind` and `ContractSurface` are the
    // same three words by construction), so the physics slot's keying is
    // checked against the surface this mount actually is.
    systemAdapters: measureSystemAdapters(getActiveSystems(), contract, active.kind),
    ownership: ownership
      ? {
          writable: ownership.writable,
          reason: ownership.reason ?? null,
          recorder: ownership.recorder ?? null,
        }
      : null,
    dataWriter: dataWriterFacts(),
    // The `project.*` family is about the opened PROJECT, not this mount, and
    // it has one producer for both lanes (`@volter/editor-game/coverage/live-project-verbs.ts`).
    // Reporting it here too would print two verdicts for one capability.
    projectVerbs: [],
    writeReach: inputs.writeReach?.() ?? null,
  });
}

/**
 * Record this mount's frozen coverage inputs and say the result out loud, once.
 *
 * Called from every mount path right after the session is published, so the
 * report describes a mount that exists.
 */
export function recordMountCoverage(inputs: MountCoverageInputs): void {
  const active = activeIngest();
  if (!active) return;
  active.coverage = inputs;
  const report = ingestCoverageReport();
  if (report) _coverageConsole.report(_mountToken, report);
}

/**
 * Report the MEASURED loop verdict for a three ingest mount (honesty
 * gate, ARCHITECTURE-CORE §Editor).
 *
 * `loop` is a claim about whether anything in this editor actually controls the
 * game's frames, so it is only ever printed from the gate's own probe
 * (`ingest/same-realm-loop-gate.ts`) — never inferred from the manifest. A
 * route that does no gating at all passes `undefined` and this says nothing,
 * which is also honest.
 */
export function reportMeasuredLoop(
  worldId: string,
  verdict: SameRealmLoopVerdict | undefined,
): void {
  if (!verdict) return;
  const line = `Ingest "${worldId}" loop: ${verdict.loop} — ${verdict.reason}`;
  if (verdict.loop === 'gated') editorConsole.log(line, 'ingest');
  else editorConsole.warn(line, 'adapter');
}
