/**
 * LIVE RENDER VITALS — the frame explaining its own cost, derived ENTIRELY
 * from `PerformanceProfiler` frames (`dev/performance-profiler.ts`).
 *
 * Nothing in a viewport tells you why it is slow, and a frame-time number on
 * its own tells you only THAT it is. These readings answer the next question:
 * where did the milliseconds go, and which subtree owns them
 * (`dev/render-census.ts` is the address book half).
 *
 * ── THE MEASUREMENT SOURCE, STATED ONCE ─────────────────────────────────────
 * There is no side ledger here. Every number below is folded out of profiler
 * frames — the timing from phase spans, the counters from `reportRender`. The
 * CPU submission cost is the profiler phase {@link RENDER_SUBMIT_PHASE}, which
 * the three adapter brackets around its actual draw; the profiler's phase
 * bookkeeping is a stack precisely so that bracket can sit INSIDE the frame's
 * enclosing `render` phase without truncating it.
 *
 * ── TWO FRAME FLAVOURS, ONE FOLD ────────────────────────────────────────────
 * The real runtime runs sim and presentation on different callbacks
 * (`create-runtime.ts`: `update` → `runFrame({skipRenderPhases})` per fixed
 * substep, `render` → `runRenderFrame` once per display frame), so a profiler
 * "frame" is EITHER a sim substep OR a presentation pass. A capture/offline
 * host drives one `runFrame` that is both. {@link foldProfilerFrame} handles
 * all three the same way, and never has to know which host it is under:
 *
 *  - a frame carrying a {@link RENDER_SUBMIT_PHASE} span IS a presentation —
 *    that phase only exists when a draw actually happened;
 *  - sim CPU accumulates across every frame since the last presentation, so
 *    the substeps a display frame consumed are attributed to it;
 *  - renderer COUNTERS ride whichever frame `reportRender` landed on (the
 *    adapter reports from its `endFrame` hook, which the substep pass drives),
 *    so the latest report wins and the counters describe the last completed
 *    draw. That is the same one-frame-warm reading `renderer.info` gives any
 *    caller — three resets it when the next draw starts.
 *
 * ── WHY THE WORST FRAME IS NOT AN EMA ───────────────────────────────────────
 * A decaying average keeps a restart spike on the readout for ~30 s, long
 * after it stopped being true. The rolling two-window max
 * ({@link WORST_WINDOW_FRAMES}) holds a hitch for one to two windows and then
 * genuinely forgets it, so the number always describes recent history.
 *
 * ── RESOURCE OWNERSHIP ──────────────────────────────────────────────────────
 * OWNER: the caller of {@link createRenderVitals}, which allocates one state
 * object and one `profiler.subscribe` registration. SHARER: none — the state
 * is private to that call. TEARDOWN: the returned `dispose()`, the ONE path
 * that ends the subscription (`editor-game/src/host/roots/r3f-root.tsx` calls it
 * from the mounted root's own `dispose()`).
 */

import type { PerformanceFrame, PerformanceProfiler } from './performance-profiler';

/**
 * The profiler phase name the three adapter brackets its CPU render
 * submission with — spelled HERE and nowhere else, so the producer
 * (`editor-game/src/host/roots/r3f-root.tsx`) and the consumer ({@link foldProfilerFrame})
 * cannot drift apart. Dotted, so it reads as a decomposition of the enclosing
 * `render` phase rather than a ninth peer of `SystemPhase`.
 */
export const RENDER_SUBMIT_PHASE = 'render.submit';

/**
 * The phases whose cost is SIMULATION. Deliberately not "everything that is
 * not render": `preRender` (LOD selection, particle stepping, culling prep) is
 * neither the simulation nor the submission, so it lands in the hitch's
 * `other` bucket where an investigation can see it. `render` itself is
 * excluded because {@link RENDER_SUBMIT_PHASE} nests inside it — summing both
 * would double-count the draw.
 */
export const SIM_PHASES: readonly string[] = [
  'input',
  'prePhysics',
  'physics',
  'postPhysics',
  'gameLogic',
  'animation',
];

/** Display frames per worst-frame window — ~5 s at 60 Hz, so the reported
 *  worst (the max of the current and previous window) survives 5–10 s. */
export const WORST_WINDOW_FRAMES = 300;

/** A display frame at or above this is worth decomposing. ~3 dropped frames at
 *  60 Hz: below it, ordinary jitter would rewrite the reading constantly. */
export const HITCH_THRESHOLD_MS = 50;

/** Smoothing for the frame-time reading — a readable number, not a blur. */
export const FRAME_TIME_EMA_ALPHA = 0.05;

/** Smoothing for the render-CPU reading. Faster than frame time: submission
 *  cost is what a draw-call diet moves, and it should visibly move. */
export const RENDER_CPU_EMA_ALPHA = 0.1;

/**
 * A hitch, split into the three buckets that route an investigation. `other`
 * is the diagnostic payload, not a rounding remainder: when it dominates, the
 * thief is neither the renderer nor the simulation — it is GC, asset decode,
 * a layout-thrashing DOM overlay, or the browser itself — and every minute
 * spent on draw calls would have been wasted.
 */
export interface HitchDecomposition {
  /** The display frame's wall-clock cost. */
  readonly totalMs: number;
  /** CPU spent submitting draws ({@link RENDER_SUBMIT_PHASE}). */
  readonly renderMs: number;
  /** CPU spent in {@link SIM_PHASES}, summed over the substeps this frame
   *  consumed. */
  readonly simMs: number;
  /** Everything else in the wall clock — see this interface's own note. May be
   *  negative if a measurement straddles the frame boundary; reported as
   *  measured rather than clamped to a tidier lie. */
  readonly otherMs: number;
  /** The one-line reading: `"NNms = render X + sim Y + other Z"`. */
  readonly text: string;
}

/** Split one display frame's wall clock into render / sim / other. Pure. */
export function decomposeHitch(
  totalMs: number,
  renderMs: number,
  simMs: number,
): HitchDecomposition {
  const otherMs = totalMs - renderMs - simMs;
  return {
    totalMs,
    renderMs,
    simMs,
    otherMs,
    text:
      `${totalMs.toFixed(0)}ms = render ${renderMs.toFixed(0)} + ` +
      `sim ${simMs.toFixed(0)} + other ${otherMs.toFixed(0)}`,
  };
}

/** What `render.vitals` reads. Every field is `null` until the fold has
 *  actually measured it — a stopped, headless or never-drawn game reports
 *  emptiness rather than a fabricated `0 ms / 0 draws`. */
export interface RenderVitalsReading {
  /** Smoothed wall-clock ms per display frame. */
  readonly frameTimeMs: number | null;
  /** Frames per second implied by {@link frameTimeMs}. */
  readonly fps: number | null;
  /** Draw calls in the last reported draw. */
  readonly drawCalls: number | null;
  /** Triangles in the last reported draw. */
  readonly triangles: number | null;
  /** Smoothed CPU ms spent submitting draws — invisible in frame time once
   *  vsync caps the loop, and exactly what fewer draw calls would improve. */
  readonly renderCpuMs: number | null;
  /** Top-level `renderer.render()` submissions the last presentation took. */
  readonly renderPasses: number | null;
  /** Worst display frame in the last one-to-two windows. */
  readonly worstFrameMs: number | null;
  /** The most recent frame over {@link HITCH_THRESHOLD_MS}, decomposed. */
  readonly lastHitch: HitchDecomposition | null;
  /** How many display frames the fold has seen. `0` reads as "nothing has
   *  presented yet", which is why every reading above is `null`. */
  readonly presentedFrames: number;
}

/** The fold's accumulator. Mutable by design (one allocation for the life of a
 *  mount, written once per profiler frame); read through
 *  {@link readRenderVitals}. */
export interface RenderVitalsState {
  /** Highest profiler frame id already folded — the dedupe that makes the fold
   *  safe to drive from `profiler.subscribe`, which also fires for
   *  enabled/recording changes that publish no new frame. */
  lastFrameId: number;
  /** `timestamp` of the last presentation, or `null` before the first (there
   *  is no interval to measure from one sample). */
  lastPresentAt: number | null;
  /** Sim CPU accumulated since the last presentation. */
  pendingSimMs: number;
  frameTimeMs: number | null;
  renderCpuMs: number | null;
  drawCalls: number | null;
  triangles: number | null;
  renderPasses: number | null;
  /** Running max of the CURRENT worst-frame window. */
  worstCurrentMs: number;
  /** The PREVIOUS window's max, kept so the reading does not drop to zero the
   *  instant a window rolls over. */
  worstPreviousMs: number;
  /** Display frames counted into the current window. */
  worstWindowFrames: number;
  lastHitch: HitchDecomposition | null;
  presentedFrames: number;
}

export function createRenderVitalsState(): RenderVitalsState {
  return {
    lastFrameId: 0,
    lastPresentAt: null,
    pendingSimMs: 0,
    frameTimeMs: null,
    renderCpuMs: null,
    drawCalls: null,
    triangles: null,
    renderPasses: null,
    worstCurrentMs: 0,
    worstPreviousMs: 0,
    worstWindowFrames: 0,
    lastHitch: null,
    presentedFrames: 0,
  };
}

/** Sum of one frame's phase timings whose names are in `names`. */
function sumPhases(frame: PerformanceFrame, names: readonly string[]): number {
  let total = 0;
  for (const timing of frame.phases) if (names.includes(timing.name)) total += timing.ms;
  return total;
}

/** This frame's CPU render submission, or `null` when it was not a
 *  presentation (no draw happened, so no bracket was recorded). */
function submissionMs(frame: PerformanceFrame): number | null {
  for (const timing of frame.phases) if (timing.name === RENDER_SUBMIT_PHASE) return timing.ms;
  return null;
}

function ema(previous: number | null, sample: number, alpha: number): number {
  return previous === null ? sample : previous * (1 - alpha) + sample * alpha;
}

/**
 * Fold ONE profiler frame into the accumulator. Pure with respect to time and
 * randomness — every input is on the frame — which is what makes the whole
 * derivation testable from synthetic frames with no renderer, no clock and no
 * game.
 *
 * Returns `true` when the frame was a presentation (the readings moved).
 */
export function foldProfilerFrame(state: RenderVitalsState, frame: PerformanceFrame): boolean {
  // Re-publishes and the ring's own re-reads must not double-count. Frame ids
  // are monotonic for the profiler's whole life, including across `clear()`.
  if (frame.id <= state.lastFrameId) return false;
  state.lastFrameId = frame.id;

  // Counters ride whichever frame `reportRender` landed on — see the module
  // note. `renderPasses !== null` is the marker that a reporter spoke at all;
  // a frame nobody reported on leaves the previous reading standing rather
  // than blanking it to a zero that would read as "nothing is drawn".
  if (frame.render.renderPasses !== null) {
    state.drawCalls = frame.render.drawCalls;
    state.triangles = frame.render.triangles;
    state.renderPasses = frame.render.renderPasses;
  }

  state.pendingSimMs += sumPhases(frame, SIM_PHASES);

  const renderMs = submissionMs(frame);
  if (renderMs === null) return false; // a sim substep: its cost is now pending

  const simMs = state.pendingSimMs;
  state.pendingSimMs = 0;
  state.presentedFrames += 1;
  state.renderCpuMs = ema(state.renderCpuMs, renderMs, RENDER_CPU_EMA_ALPHA);

  const previousAt = state.lastPresentAt;
  state.lastPresentAt = frame.timestamp;
  // The FIRST presentation has no interval behind it. Everything that needs a
  // dt (frame time, worst frame, the hitch) waits for the second one; the
  // alternative is to invent an interval from the profiler's own start, which
  // would report the mount cost as a frame time forever.
  if (previousAt === null) return true;

  const dt = frame.timestamp - previousAt;
  state.frameTimeMs = ema(state.frameTimeMs, dt, FRAME_TIME_EMA_ALPHA);

  if (dt > state.worstCurrentMs) state.worstCurrentMs = dt;
  state.worstWindowFrames += 1;
  if (state.worstWindowFrames >= WORST_WINDOW_FRAMES) {
    state.worstPreviousMs = state.worstCurrentMs;
    state.worstCurrentMs = 0;
    state.worstWindowFrames = 0;
  }

  // Blame the hitch with THIS frame's own measurements: `dt` spans the work
  // between the two presentations, which is exactly the submission just
  // measured plus the substeps that ran in between.
  if (dt >= HITCH_THRESHOLD_MS) state.lastHitch = decomposeHitch(dt, renderMs, simMs);

  return true;
}

function round(value: number | null, places: number): number | null {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The provider body — pure over the accumulator. */
export function readRenderVitals(state: RenderVitalsState): RenderVitalsReading {
  const frameTimeMs = round(state.frameTimeMs, 2);
  const worst = Math.max(state.worstCurrentMs, state.worstPreviousMs);
  return {
    frameTimeMs,
    fps: frameTimeMs !== null && frameTimeMs > 0 ? round(1000 / frameTimeMs, 1) : null,
    drawCalls: state.drawCalls,
    triangles: state.triangles,
    renderCpuMs: round(state.renderCpuMs, 2),
    renderPasses: state.renderPasses,
    worstFrameMs: state.frameTimeMs === null ? null : round(worst, 2),
    lastHitch: state.lastHitch,
    presentedFrames: state.presentedFrames,
  };
}

/** What {@link createRenderVitals} hands back. */
export interface RenderVitals {
  /** The `render.vitals` provider body. */
  read(): RenderVitalsReading;
  /** See the module's ownership note — the ONE path that ends the
   *  subscription. Idempotent. */
  dispose(): void;
}

/**
 * Attach a fold to a live profiler. `subscribe` fires once per published
 * frame (and on enabled/recording changes, which the id dedupe absorbs), so
 * nothing here polls and nothing here owns a timer.
 */
export function createRenderVitals(profiler: PerformanceProfiler): RenderVitals {
  const state = createRenderVitalsState();
  const unsubscribe = profiler.subscribe(() => {
    const frame = profiler.getSnapshot().frames.at(-1);
    if (frame) foldProfilerFrame(state, frame);
  });
  let disposed = false;
  return {
    read: () => readRenderVitals(state),
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}
