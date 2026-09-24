/**
 * THE TAB RESOURCE CENSUS — one declaration of the profile a browser tab
 * reports about itself, for every compilation unit that speaks it.
 *
 * WHAT IT IS. What a game tab is holding: JS heap, canvas backing stores,
 * renderer resource counts, and how many project mount generations the
 * document has accumulated. Sampled by the page every five seconds and carried
 * on the heartbeat, so that a browser-level renderer death — which the presence
 * system recovers from perfectly and would otherwise leave unexplained — has a
 * number beside it. MEASUREMENT ONLY: nothing anywhere enforces a budget from
 * these. The page-side sampler and its `why` are
 * `packages/editor/src/tab-census.ts`.
 *
 * WHY IT LIVES HERE. This one shape crosses four compilation units — the page
 * that samples it (`@vgai/editor`'s browser bundle), the editor server that
 * files it (`@vgai/editor`'s node half), the editor-extension surface that
 * describes the status response (`@volter/editor-sdk`), and the session journal
 * plus the CLI row that print it (`@vgai/sdk`, `@vgai/cli`). Each of them used
 * to spell the seven fields out again. `@vgai/sdk` is the only package all four
 * already depend on: `@volter/editor-sdk` depends on `@vgai/sdk` and `@vgai/editor`
 * depends on both, so this cannot live in `@volter/editor-sdk` without a cycle —
 * and it does not belong in `@vgai/game-runtime`, whose subject is a running game,
 * not an editor session's tabs.
 *
 * Deliberately import-free so a browser bundle can take it: the census's other
 * `@vgai/sdk` home, `project/session-journal.ts`, reads `node:fs`.
 *
 * WHAT ELSE RIDES IT. The beat is the one channel that still moves when the
 * page's main thread or a lane's worker is blocked, so `workerCalls` — how long
 * each lane's worker calls are taking, keyed by the lane's own name — and
 * `stalls` — how long the main thread has been stalled — are carried here too
 * (absent until a lane publishes a meter). Same rule as the rest of this file:
 * measurement only, no budget anywhere.
 *
 * ABSENT IS NOT ZERO. `heapUsedMB`/`heapLimitMB` are null off Chromium
 * (`performance.memory` is non-standard). The renderer counts are ABSENT rather
 * than zero when no game has registered a render-debug adapter, and `programs`
 * is absent until a first render: a zero would read as "no textures", which is
 * a different claim from "nobody measured".
 */

/**
 * ONE LANE'S WORKER CALLS, as numbers.
 *
 * WHY (measured 2026-09-16): one Blender call held its worker for over 1,800s
 * and wedged the tab, and a 0.86s-per-call scene stretched into heartbeat
 * timeouts that read as "tab present, did not respond". The product had no
 * number for either. Owner ruling: a tab that stops answering is the product's
 * defect regardless of what the machine is doing, and the product has to
 * surface it — so these ride the census to `vgai status`.
 *
 * MEASURED BY THE PAGE, because neither blocked party can report on itself: the
 * worker's own loop is what is stuck, and a stalled main thread cannot send.
 * The call half is the lane's meter (`host.session.reportWorkerCallMeter`), and
 * the stall half is the host's `longtask` observer.
 *
 * MEASUREMENT ONLY. No threshold here cancels, kills or budgets a call.
 */
export interface WorkerCallTabMetrics {
  /** Age of the oldest OUTSTANDING worker call, or null when the worker is idle.
   *  The only field with a number during a wedge. */
  readonly inFlightMs: number | null;
  /** Duration of the newest completed call; null before the first one. */
  readonly lastCallMs: number | null;
  /** The longest call this page has seen, counting an outstanding one. */
  readonly maxCallMs: number | null;
  /** Calls past 5s, and past 30s, since this page loaded. */
  readonly callsOver5s: number;
  readonly callsOver30s: number;
  /** The longest long task that overlapped the newest call's window — what the
   *  MAIN thread was doing while the worker was busy. Null when there has been
   *  no call yet, or no long task during it. */
  readonly lastCallLongestTaskMs: number | null;
  /**
   * THE ENGINE'S OWN MEMORY: the lane's wasm module's linear memory in MB, read
   * in its worker and posted after every call; null when the lane has none.
   *
   * It is here because no other number on this census answers the question.
   * `heapUsedMB` is the PAGE's JS heap — a few tens of MB — while an engine's
   * memory can be the larger half of the tab by far, and a reader looking at
   * the heap line alone concludes the tab is cheap. wasm32 memory never
   * shrinks, so this is simultaneously the current size and the session's
   * high-water mark.
   */
  readonly wasmMemoryMB: number | null;
}

/** THE MAIN THREAD'S STALLS since page load, from the host's `longtask`
 *  observer, which starts when the first lane publishes a meter. */
export interface TabStallMetrics {
  /** Longest `longtask` entry, in ms; null off Chromium (the Long Tasks API is
   *  not implemented everywhere) — never 0, which would read as "the main
   *  thread never stalled". */
  readonly longestTaskMs: number | null;
  /** How many long tasks ran past 100ms. */
  readonly tasksOver100ms: number;
}

/**
 * A census as a CURRENT page produces it and the server files it.
 *
 * Every field here is guaranteed by a producer that always writes it, and
 * `packages/editor/server/tab-heartbeat.ts`'s `parseCensus` is where that is
 * checked: a beat frame missing `canvases`, `canvasMB` or `mountEpochs` is
 * rejected outright rather than filed as a partial profile.
 */
export interface TabCensus {
  /** `performance.memory.usedJSHeapSize` in MB; null off Chromium. */
  readonly heapUsedMB: number | null;
  /** `performance.memory.jsHeapSizeLimit` in MB; null off Chromium. */
  readonly heapLimitMB: number | null;
  /** Distinct project mount generations fetched by this document. */
  readonly mountEpochs: number;
  /** How many `<canvas>` elements the document holds. */
  readonly canvases: number;
  /** Their total pixel-buffer footprint: Σ width×height×4 bytes, in MB. */
  readonly canvasMB: number;
  /** `renderer.info.memory.textures` — absent with no mounted adapter. */
  readonly textures?: number;
  /** `renderer.info.memory.geometries` — absent with no mounted adapter. */
  readonly geometries?: number;
  /** Compiled programs — absent with no adapter, or before the first render. */
  readonly programs?: number;
  /** Each lane's {@link WorkerCallTabMetrics}, keyed by the name the lane
   *  published under — absent until a lane publishes a meter. */
  readonly workerCalls?: Readonly<Record<string, WorkerCallTabMetrics>>;
  /** {@link TabStallMetrics} — absent until the host is watching its stalls. */
  readonly stalls?: TabStallMetrics;
}

/**
 * A census read back out of a RECORD, where the writer may predate a field.
 *
 * Exactly one field varies, and this is the only place that is said: a session
 * journal line written before the mount census existed has no `mountEpochs`,
 * and neither does a status response from an older editor server. The
 * difference is a property of the READER's input, so it is named on the
 * reader's type rather than by softening {@link TabCensus} — which is what the
 * four hand-copied declarations did, and how the producers' own guarantee got
 * lost on the way to the two SDKs.
 *
 * There is no runtime narrowing to point at because neither reader has a parse
 * step to put one in: the journal is `JSON.parse` per line by recorded design
 * (`session-journal.ts`: "nothing reads a journal back through a validator"),
 * and the CLI reads the status body as JSON. So the absence is carried in the
 * type and handled where it is printed — `formatTabCensus` omits the words
 * rather than printing a fabricated count. Every {@link TabCensus} is a valid
 * value of this type; the reverse is not.
 */
export type RecordedTabCensus = Omit<TabCensus, 'mountEpochs'> & {
  readonly mountEpochs?: number;
};
