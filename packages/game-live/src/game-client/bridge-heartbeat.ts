/**
 * run-3 dogfood friction #2 — a legitimately-progressing script built from
 * many short `game.input.hold()` calls looked WEDGED to anything watching its
 * stdout for liveness, even though it was making real progress. Root cause: `GameInput.hold` (client.ts) collapsed
 * what used to be a `waitSimTime` POLL loop into a single bridge call per
 * hold (see its own doc comment — deliberately, to cut transport round
 * trips), so a spec built from many holds and little else can go silent on
 * stdout between them for minutes at a time.
 *
 * `wait-for.ts`'s `maybeHeartbeat` already solves the analogous problem for
 * the `waitFor`/`waitSimTime` POLL loop, but it is deliberately SIM-TICK
 * aware (a frozen sim clock must stay heartbeat-silent so that loop's own
 * ~30s stall guard, `WAIT_FOR_STALL_POLL_LIMIT`, can still diagnose a
 * genuinely-stuck game rather than a heartbeat papering over it). This is
 * the companion for `GameClient`'s generic bridge dispatch
 * (`callBridge`/`callBridgeAsync`), which has no poll loop and no sim tick
 * to check at all: "wire activity" here just means a bridge call was
 * actually DISPATCHED — sequential awaits mean a new dispatch can only
 * happen once the previous one resolved, so a genuinely wedged page (bridge
 * calls that never resolve at all) still goes — and stays — silent. The
 * throttle exists only to bound
 * stdout volume during a burst of fast calls, not to filter out "fake"
 * activity.
 */

export const BRIDGE_HEARTBEAT_INTERVAL_MS = 30_000;

/** Mutable-by-replacement bookkeeping a caller threads through successive
 *  `maybeBridgeHeartbeat` calls — mirrors `wait-for.ts`'s `HeartbeatState`
 *  shape/style, minus the tick field (no sim-progress condition here). */
export interface BridgeHeartbeatState {
  lastEmitWallMs: number;
}

/** The liveness line this prints to stdout — greppable, and prefixed
 *  distinctly from `wait-for.ts`'s `vgai-heartbeat` so the two liveness
 *  sources are distinguishable in a run's log. */
export function formatBridgeHeartbeatLine(testTitle: string, method: string): string {
  return `vgai-bridge-heartbeat ${testTitle} method=${method}`;
}

/**
 * Pure decision, called once per bridge dispatch: should a heartbeat print
 * now, and what's the updated bookkeeping? Returns the SAME `state` object
 * (referentially) when nothing should emit, so a caller can cheaply no-op.
 */
export function maybeBridgeHeartbeat(opts: {
  nowMs: number;
  method: string;
  testTitle: string;
  state: BridgeHeartbeatState;
}): { line: string | null; state: BridgeHeartbeatState } {
  const wallElapsed = opts.nowMs - opts.state.lastEmitWallMs;
  if (wallElapsed >= BRIDGE_HEARTBEAT_INTERVAL_MS) {
    return {
      line: formatBridgeHeartbeatLine(opts.testTitle, opts.method),
      state: { lastEmitWallMs: opts.nowMs },
    };
  }
  return { line: null, state: opts.state };
}
