/**
 * THE BLENDER TWIN'S STALLS, measured by the page and carried to `vgai status`.
 *
 * WHY (measured 2026-09-16): one `blender-execute` held the Blender worker for
 * over 1,800s and wedged the tab; the only report anyone got was a replay
 * harness timing out. Separately, a 0.86s-per-call cost in a 225-mesh scene
 * stretched under load into heartbeat timeouts that read as "tab present, did
 * not respond". The product had a number for NEITHER. Owner ruling: a tab that
 * stops answering is the product's defect regardless of what the machine is
 * doing, and the product must surface it.
 *
 * TWO MEASUREMENTS, BOTH TAKEN FROM THE PAGE, because neither blocked party can
 * report on itself:
 *  - the WORKER's call times come from `BlenderRuntime.metrics()`, which stamps
 *    each `postMessage` and its reply (`packages/blender-engine/browser/runtime.ts`);
 *    a blocked worker cannot send, but the side that posted still has a clock.
 *  - the MAIN THREAD's stalls come from the `longtask` PerformanceObserver kept
 *    here. (The sky work measured this ad hoc through a `window.__skyStall`
 *    global; this is that measurement as a proper field of the runtime host,
 *    with no global.)
 *
 * WHY A REGISTRY AND NOT A DIRECT IMPORT. The census sampler
 * (`tab-census.ts`) must not pull the Blender stack — three.js, the display
 * LUT contributions, the worker URL — into its import closure just to ask a
 * question that is usually answered "no session". The lane publishes its meter
 * here when it constructs its runtime, exactly the way a mounted game publishes
 * its render-debug adapter to `authoring/active-systems`.
 *
 * THE LANE IS A PACKAGE AND REACHES THIS THROUGH THE DOOR (2026-09-19):
 * `@volter/editor-blender` calls `host.session.reportWorkerCallMeter`
 * (`editor-host-door.ts`), which is this module's `setBlenderCallMeter`. It
 * used to import this file directly through `@editor/*` and also START the
 * observer below, which is the half that was never the package's: the LONG
 * TASKS are the host page's own, measured whether or not a lane is running,
 * and a package cannot be the thing that decides the page is being watched.
 * So publishing a meter is now what starts the watch.
 *
 * MEASUREMENT ONLY. Nothing here cancels, kills, or budgets a call, and no
 * threshold is enforced anywhere: a budget is the owner's policy, and these are
 * the numbers such a policy would have to be made from.
 */

import type { EditorHostWorkerCallMetrics } from '@volter/editor-sdk/host';
import type { BlenderTabMetrics } from '@volter/editor-sdk/tab-census';

/** What the lane publishes: a read of the live call meter. The SHAPE is the
 *  SDK's (`host.session.reportWorkerCallMeter`), and structural, so this module
 *  does not import `@volter/blender-engine/browser` (and `BlenderRuntime` does not
 *  import the editor or the SDK). */
export type BlenderCallMeter = () => EditorHostWorkerCallMetrics;

let meter: BlenderCallMeter | null = null;

/**
 * Publish (or retract, with null) the tab's Blender call meter, and start the
 * page's own stall watch behind it.
 *
 * ONE OWNER: the lane's own runtime singleton — the same lifetime as the
 * session itself. There is no per-document or per-play teardown that may
 * retract it, because the session outlives both. ONE METER rides the census, so
 * a second publisher replaces the first.
 */
export function setBlenderCallMeter(read: BlenderCallMeter | null): void {
  meter = read;
  // The observer's lifetime is the PAGE's (its history is what "during the
  // last call" is answered from), so it is started, never stopped: a retracted
  // meter simply stops the census from carrying a `blender` block at all.
  if (read !== null) startStallObserver();
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
 * Internal: {@link setBlenderCallMeter} is the one caller, so the page's watch
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

/**
 * The tab's Blender block, or null when this tab has no Blender session — the
 * census then carries no `blender` key at all, because "absent" and "idle" are
 * different claims.
 */
export function blenderTabMetrics(now: number = performance.now()): BlenderTabMetrics | null {
  const read = meter;
  if (read === null) return null;
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
  return {
    inFlightMs: calls.inFlightMs,
    lastCallMs: calls.lastCallMs,
    maxCallMs: calls.maxCallMs,
    callsOver5s: calls.callsOver5s,
    callsOver30s: calls.callsOver30s,
    longestTaskMs: longestTaskMs === null ? null : Math.round(longestTaskMs),
    tasksOver100ms,
    lastCallLongestTaskMs: duringCall === null ? null : Math.round(duringCall),
    wasmMemoryMB: calls.wasmMemoryMB,
  };
}
