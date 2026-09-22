/**
 * "WHERE DID EDITOR BOOT TIME GO" — the one journal row the server writes about
 * its own start-up, emitted when the first browser tab's control channel
 * arrives (`editor-server.ts`, beside `client-connected`).
 *
 * WHY IT EXISTS. `vgai edit` prints two lines — `Editor ready at …` and
 * `Editor page connected …` — and the gap between them is the largest stage of
 * opening a project, with nothing recording it anywhere. Measured 2026-08-20 on
 * an imported Unity FPS port (528 source files): dev-server readiness was 8s and
 * the SAME stage was 83–139s, and answering "why" needed a hand-built request
 * trace plus a V8 CPU profile of the dev server. The cause turned out to be the
 * server's own event loop blocked ~85% of two minutes inside the TypeScript
 * parser (`ui-source/r3f-project-contracts.ts`) — which is exactly the shape a
 * loop-delay number reports for free. A product whose slow stage can only be
 * diagnosed by attaching a profiler is missing a door; this is that door.
 *
 * WHAT IT COSTS. One `monitorEventLoopDelay` histogram — a libuv-side C++
 * sampler, not a JS timer — plus five `Date.now()` marks. `disable()` runs at
 * the first bind, so nothing here outlives boot.
 *
 * `loopDelayP99Ms` IS THE DISCRIMINATING FIELD, and the reason the row is not
 * just a list of stage durations: a slow bind with a quiet loop is the browser
 * (or the network, or a hidden tab); a slow bind with a p99 in the hundreds of
 * ms is THIS process refusing to answer, and every per-request duration in that
 * window is queueing rather than work. Reading them the other way around is the
 * mistake this row prevents — a 38s response for a static `.svg` measured
 * nothing about the svg.
 */
import { type IntervalHistogram, monitorEventLoopDelay } from 'node:perf_hooks';

/** Every span in the boot, in the order a reader should think about them. */
export interface EditorBootTimings {
  /** Process start → Vite's `createServer` resolved. */
  readonly viteMs: number;
  /** …→ the dependency scan settled (the barrier `dev.ts` awaits before listen). */
  readonly depScanMs: number;
  /** …→ the HTTP server was listening (what `Editor ready at` announces). */
  readonly listenMs: number;
  /**
   * Listening → the first page that PROVED it is running the editor document
   * (its command listener attached). Deliberately not the control channel:
   * `index.html`'s inline bootstrap opens that before any module loads, so it
   * dates the HTML, not the app.
   */
  readonly boundMs: number;
  /**
   * Process start → the project's declared world warmup finished; `null` when
   * no project was open to warm. On the same clock as the marks above on
   * purpose: the warmup is kicked off right after `depScanMs` and deliberately
   * NOT awaited, so what a reader needs is where it LANDS relative to the
   * bind — before it (free) or across it (competing with the browser).
   */
  readonly worldWarmupDoneMs: number | null;
  /** Event-loop delay across the whole boot. A high p99 means the SERVER was the wait. */
  readonly loopDelayP99Ms: number;
  readonly loopDelayMaxMs: number;
}

export type EditorBootMark = 'vite-created' | 'dep-scan-settled' | 'listening' | 'world-warmup';

export interface EditorBootTimer {
  mark(name: EditorBootMark): void;
  /**
   * The row, ONCE — the first page to prove it is running the document ends
   * the boot, and a later reload is not a second boot. `null` on every call
   * after that, and on a call that arrives before `listening` was ever marked.
   */
  takeBoundTimings(): EditorBootTimings | null;
}

export function createEditorBootTimer(startedAt: number = Date.now()): EditorBootTimer {
  const marks = new Map<EditorBootMark, number>();
  let loop: IntervalHistogram | null = null;
  try {
    loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
  } catch {
    // A runtime without the histogram still gets every other field.
    loop = null;
  }
  let taken = false;

  return {
    mark(name) {
      if (!marks.has(name)) marks.set(name, Date.now());
    },
    takeBoundTimings() {
      const listening = marks.get('listening');
      if (taken || listening === undefined) return null;
      taken = true;
      const now = Date.now();
      loop?.disable();
      const warmup = marks.get('world-warmup');
      return {
        viteMs: (marks.get('vite-created') ?? startedAt) - startedAt,
        depScanMs: (marks.get('dep-scan-settled') ?? startedAt) - startedAt,
        listenMs: listening - startedAt,
        boundMs: now - listening,
        worldWarmupDoneMs: warmup === undefined ? null : warmup - startedAt,
        // The histogram reports NANOSECONDS.
        loopDelayP99Ms: loop === null ? 0 : Math.round(loop.percentile(99) / 1e6),
        loopDelayMaxMs: loop === null ? 0 : Math.round(loop.max / 1e6),
      };
    },
  };
}
