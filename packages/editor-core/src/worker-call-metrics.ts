/**
 * A LANE'S WORKER STALLS, measured by the page and carried to `vgai status`.
 *
 * WHY (measured 2026-09-16): one Blender call held its worker for over 1,800s
 * and wedged the tab; the only report anyone got was a replay harness timing
 * out. Separately, a 0.86s-per-call cost in a 225-mesh scene stretched under
 * load into heartbeat timeouts that read as "tab present, did not respond". The
 * product had a number for NEITHER. Owner ruling: a tab that stops answering is
 * the product's defect regardless of what the machine is doing, and the product
 * must surface it.
 *
 * TWO MEASUREMENTS, BOTH TAKEN FROM THE PAGE, because neither blocked party can
 * report on itself:
 *  - the WORKER's call times come from the lane's meter, which stamps each
 *    `postMessage` and its reply; a blocked worker cannot send, but the side
 *    that posted still has a clock.
 *  - the MAIN THREAD's stalls come from the `longtask` PerformanceObserver kept
 *    here.
 *
 * WHY A REGISTRY AND NOT A DIRECT IMPORT. The census sampler (`tab-census.ts`)
 * must not pull a lane's stack into its import closure just to ask a question
 * that is usually answered "no lane". A lane publishes its meter through
 * `host.session.reportWorkerCallMeter` (`editor-host-door.ts`) when it
 * constructs its runtime, the way a mounted game publishes its render-debug
 * adapter to `authoring/active-systems`. The LONG TASKS are the host page's
 * own, so publishing a meter is what starts the watch; no lane decides the page
 * is watched.
 *
 * MEASUREMENT ONLY. Nothing here cancels, kills, or budgets a call, and no
 * threshold is enforced anywhere: a budget is the owner's policy, and these are
 * the numbers such a policy would have to be made from.
 */

import type { EditorHostWorkerCallMetrics } from '@volter/editor-sdk/host';
import type { TabStallMetrics, WorkerCallTabMetrics } from '@volter/editor-sdk/tab-census';

/** What a lane publishes: a read of its live call meter. */
export type WorkerCallMeter = () => EditorHostWorkerCallMetrics;

const meters = new Map<string, WorkerCallMeter>();

/**
 * Publish (or retract, with null) one lane's call meter, and start the page's
 * own stall watch behind it.
 *
 * ONE OWNER per name: the lane's own runtime singleton, the same lifetime as
 * the session itself. There is no per-document or per-play teardown that may
 * retract it, because the session outlives both.
 */
export function setWorkerCallMeter(lane: string, read: WorkerCallMeter | null): void {
  if (read === null) {
    meters.delete(lane);
    return;
  }
  meters.set(lane, read);
  // The observer's lifetime is the PAGE's (its history is what "during the
  // last call" is answered from), so it is started, never stopped.
  startStallObserver();
}

/** A long task, kept only as long as it can still be attributed to a call. */
interface StallEntry {
  readonly start: number;
  readonly duration: number;
}

/**
 * How many recent long tasks to keep for the "during the last call" question.
 *
 * A long task is >50ms by spec, so this is minutes of a badly-stalled tab and
 * nothing at all on a healthy one. Bounded because the observer runs for the
 * life of the page.
 */
const STALL_HISTORY = 128;

let recent: StallEntry[] = [];
let longestTaskMs: number | null = null;
let tasksOver100ms = 0;
let observing = false;

/**
 * Start watching the main thread. Idempotent, and silent where the Long Tasks
 * API does not exist (Safari/Firefox): `longestTaskMs` then stays null, which
 * says "nobody measured" rather than the falsehood a 0 would tell.
 *
 * Internal: {@link setWorkerCallMeter} is the one caller, so the page's watch
 * begins the moment a lane has calls to attribute stalls to, and no package has
 * to know the page is watched at all.
 */
function startStallObserver(): () => void {
  if (observing) return () => {};
  if (typeof PerformanceObserver === 'undefined') return () => {};
  let observer: PerformanceObserver;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        if (longestTaskMs === null || duration > longestTaskMs) longestTaskMs = duration;
        if (duration >= 100) tasksOver100ms += 1;
        recent.push({ start: entry.startTime, duration });
        if (recent.length > STALL_HISTORY) recent = recent.slice(-STALL_HISTORY);
      }
    });
    // `buffered` picks up the boot-time stalls that happened before this ran —
    // a cold editor boot is one of the longest tasks a session ever has, and it
    // is not measurable any other way.
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // An unsupported entry type throws here on some engines. Same answer as an
    // absent API: no numbers, rather than invented ones.
    return () => {};
  }
  observing = true;
  return () => {
    observer.disconnect();
    observing = false;
  };
}

/** The main thread's stalls, or null until a lane's meter started the watch. */
export function tabStallMetrics(): TabStallMetrics | null {
  if (!observing) return null;
  return {
    longestTaskMs: longestTaskMs === null ? null : Math.round(longestTaskMs),
    tasksOver100ms,
  };
}

/**
 * Every published lane's calls, keyed by lane, or null when no lane has
 * published — the census then carries no `workerCalls` key at all, because
 * "absent" and "idle" are different claims.
 */
export function workerCallTabMetrics(
  now: number = performance.now(),
): Record<string, WorkerCallTabMetrics> | null {
  if (meters.size === 0) return null;
  const out: Record<string, WorkerCallTabMetrics> = {};
  for (const [lane, read] of meters) {
    const calls = read();
    const window = calls.lastCallWindow;
    let duringCall: number | null = null;
    if (window !== null) {
      const end = window.end ?? now;
      for (const task of recent) {
        // Overlap, not containment: the task that matters most is the one that
        // was ALREADY running when the call was posted.
        if (task.start + task.duration < window.start || task.start > end) continue;
        if (duringCall === null || task.duration > duringCall) duringCall = task.duration;
      }
    }
    out[lane] = {
      inFlightMs: calls.inFlightMs,
      lastCallMs: calls.lastCallMs,
      maxCallMs: calls.maxCallMs,
      callsOver5s: calls.callsOver5s,
      callsOver30s: calls.callsOver30s,
      lastCallLongestTaskMs: duringCall === null ? null : Math.round(duringCall),
      wasmMemoryMB: calls.wasmMemoryMB,
    };
  }
  return out;
}
