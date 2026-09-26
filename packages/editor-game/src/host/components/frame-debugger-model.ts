/**
 * Pure data-path logic for the Frame debugger tab and the Profiler's
 * Flamegraph/Memory views (W4b, F11) — no React/DOM, so the whole consumer
 * side of the `RenderDebugAdapter` capabilities plus the flamegraph geometry
 * is headless-testable (`frame-debugger-model.test.ts`). The rendering
 * components (`FrameDebuggerPanel.tsx`, `PerformancePanel.tsx`) own only JSX;
 * capability detection, the bounded capture ring, the draw-call grouping, and
 * every bit of layout math live here (the W3b `network-inspector-model.ts`
 * split, applied to render debugging).
 *
 * HONESTY (adapters never fabricate): a `null` capability map (no adapter)
 * stays `null` — the panel renders the register-an-adapter notice rather than
 * a fabricated all-false map; `readJsHeap` feature-detects the Chromium-only
 * `performance.memory` and returns the REASON string when it is absent, never
 * a zeroed reading. Editor code speaks only the `RenderDebugAdapter` interface
 * and the plain capture/frame shapes — never the WebGL2 instrument itself.
 */

import type { PerformanceFrame } from '@volter/game-runtime/dev/performance-profiler';
import type {
  FrameCapture,
  FrameCaptureDrawCall,
} from '../../runtime/dev/webgl-frame-capture';
import type { RenderDebugAdapter } from '@volter/editor-project/adapter';

/** Which optional render-debug capabilities the active adapter provides — the
 *  degradation ladder's per-section verdict. `null` input (no adapter = no
 *  running session, or a headless mount that registered none) stays `null`:
 *  the panel renders the register-an-adapter notice instead of a fabricated
 *  all-false map. `captureFrame` is a REQUIRED member, so `capture` is `true`
 *  whenever an adapter is present; `memorySnapshot` is the optional-within-
 *  optional capability (a mount without a real `renderer.info` omits it). */
export interface RenderDebugCapabilityMap {
  capture: boolean;
  memory: boolean;
}

export function deriveRenderDebugCapabilities(
  adapter: RenderDebugAdapter | null | undefined,
): RenderDebugCapabilityMap | null {
  if (!adapter) return null;
  return {
    capture: typeof adapter.captureFrame === 'function',
    memory: typeof adapter.memorySnapshot === 'function',
  };
}

/**
 * Bounded ring of the last N frame captures (default 10) with a selection.
 * This is a plain LIST of independent single-frame captures — not a replay
 * timeline — so `add` appends and evicts the oldest, and selecting a capture
 * that has been evicted is a no-op (the selection stays on whatever is still
 * held). A fresh capture becomes the selection.
 */
export class CaptureHistoryModel {
  private captures: FrameCapture[] = [];
  private selectedId: number | null = null;

  constructor(private readonly capacity = 10) {}

  add(capture: FrameCapture): void {
    this.captures.push(capture);
    if (this.captures.length > this.capacity) {
      this.captures.splice(0, this.captures.length - this.capacity);
    }
    this.selectedId = capture.id;
  }

  get all(): readonly FrameCapture[] {
    return this.captures;
  }

  /** Select an existing capture by id. No-op for an unknown/evicted id (the
   *  prior selection is kept — never cleared to a fabricated empty view). */
  select(id: number): void {
    if (this.captures.some((c) => c.id === id)) this.selectedId = id;
  }

  get selectedIdOrNull(): number | null {
    return this.selectedId;
  }

  get selected(): FrameCapture | null {
    if (this.selectedId === null) return null;
    return this.captures.find((c) => c.id === this.selectedId) ?? null;
  }

  clear(): void {
    this.captures = [];
    this.selectedId = null;
  }
}

/** One target's draws in a capture, for the grouped list view. */
export interface DrawCallGroup {
  /** `'canvas'` for the default framebuffer, else the capture-local
   *  framebuffer identity label (`framebuffer#N`). */
  readonly target: string;
  readonly draws: readonly FrameCaptureDrawCall[];
}

/** Group a capture's draws by render target, preserving first-seen order
 *  (draws render in list order; a target header appears where its first draw
 *  did). */
export function groupDrawCallsByTarget(capture: FrameCapture): DrawCallGroup[] {
  const groups = new Map<string, FrameCaptureDrawCall[]>();
  const order: string[] = [];
  for (const draw of capture.drawCalls) {
    const key = draw.target.kind === 'canvas' ? 'canvas' : (draw.target.label ?? 'framebuffer');
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(draw);
  }
  return order.map((target) => ({ target, draws: groups.get(target) ?? [] }));
}

/** One-line rollup of a capture for the history strip. */
export interface CaptureSummary {
  readonly id: number;
  readonly drawCalls: number;
  readonly unattributed: number;
  readonly truncated: number;
  readonly targets: number;
}

export function summarizeCapture(capture: FrameCapture): CaptureSummary {
  const targets = new Set<string>();
  for (const draw of capture.drawCalls) {
    targets.add(draw.target.kind === 'canvas' ? 'canvas' : (draw.target.label ?? 'framebuffer'));
  }
  return {
    id: capture.id,
    drawCalls: capture.totals.drawCalls,
    unattributed: capture.totals.unattributed,
    truncated: capture.totals.truncated,
    targets: targets.size,
  };
}

// --- Flamegraph geometry ----------------------------------------------------

/** One rectangle in the flamegraph: `depth` is the nesting row (0 = frame,
 *  1 = phase, 2 = system, 3 = component), `x`/`w` in pixels within `width`. */
export interface FlameRect {
  readonly x: number;
  readonly w: number;
  readonly depth: number;
  readonly label: string;
  readonly ms: number;
}

/**
 * Absolutely-positioned rectangles for a frame's flamegraph — pure layout math
 * from the profiler's MEASURED per-span `startMs`/`ms` (never synthesized).
 * Rows by kind: the frame root (depth 0) spans its `cpuMs`; phases (depth 1),
 * systems (depth 2), and — while recording — components (depth 3) sit at their
 * measured start offsets. GPU is never a row: only measured CPU spans exist
 * (the profiler's `gpuMs` is a whole-frame aggregate, drawn as an n/a header,
 * not a fabricated lane). Scaled so the whole frame fits `width`; a system that
 * ran within its phase stays within that phase's x-span by construction.
 */
export function flamegraphRows(frame: PerformanceFrame, width: number): FlameRect[] {
  let maxEnd = Math.max(0, frame.cpuMs);
  for (const p of frame.phases) maxEnd = Math.max(maxEnd, (p.startMs ?? 0) + p.ms);
  for (const s of frame.systems) maxEnd = Math.max(maxEnd, s.startMs + s.ms);
  for (const c of frame.components) maxEnd = Math.max(maxEnd, c.startMs + c.ms);
  const total = maxEnd > 0 ? maxEnd : 1;
  const scale = width / total;

  const rect = (startMs: number, ms: number, depth: number, label: string): FlameRect => ({
    x: Math.max(0, startMs * scale),
    w: Math.max(0, ms * scale),
    depth,
    label,
    ms,
  });

  const rows: FlameRect[] = [rect(0, frame.cpuMs, 0, `frame ${frame.id}`)];
  for (const p of frame.phases) rows.push(rect(p.startMs ?? 0, p.ms, 1, p.name));
  for (const s of frame.systems) rows.push(rect(s.startMs, s.ms, 2, s.name));
  for (const c of frame.components) rows.push(rect(c.startMs, c.ms, 3, c.name));
  return rows;
}

/** One bar in the frame-history selector strip. */
export interface FrameBar {
  readonly index: number;
  readonly frameId: number;
  readonly x: number;
  readonly w: number;
  readonly h: number;
  readonly cpuMs: number;
}

/**
 * Bars for the frame-selector strip — the `sparklinePoints` idiom as discrete
 * bars: one per recorded frame, height scaled to the tallest `cpuMs` (min 1 so
 * an all-zero series draws flat, not NaN). Empty input → `[]` (nothing yet).
 */
export function frameHistoryBars(
  frames: readonly PerformanceFrame[],
  width: number,
  height: number,
): FrameBar[] {
  if (frames.length === 0) return [];
  const max = Math.max(1, ...frames.map((f) => f.cpuMs));
  const barW = width / frames.length;
  return frames.map((frame, index) => ({
    index,
    frameId: frame.id,
    x: index * barW,
    w: barW,
    h: Math.max(0, (frame.cpuMs / max) * height),
    cpuMs: frame.cpuMs,
  }));
}

// --- JS heap ----------------------------------------------------------------

/** Human-readable byte count (`1.50 MB`), for the memory tables/tiles. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${units[unit]}`;
}

// ---------------------------------------------------------------------------
// Off-loop accounting (the "14fps but the loop measures 1.3ms" story)
// ---------------------------------------------------------------------------

/**
 * The per-source profiler measures only what runs INSIDE the registered
 * render loop's rAF callback (its `editor`/`render` phases). Everything else
 * that spends the frame budget — compositor/GPU work (post-effects, glass
 * chrome, pixel ratio), React commits, other timers, GC — is invisible to it,
 * so a GPU-bound editor reads as "1ms of CPU at 14fps" with no explanation.
 * These helpers give the Overview an honest account of that gap. Found the
 * hard way (2026-07-31): a full-window glass chain on the center documents
 * group cost ~20ms/frame of pure compositor time that no phase could see.
 */
export interface OffLoopAccount {
  /** Representative frame interval (p95), ms. */
  readonly frameMs: number;
  /** frameMs minus the loop's measured CPU — time the profiler cannot see. */
  readonly gapMs: number;
  /**
   * True when the frame rate is actually low AND the measured loop explains
   * less than half of it — the exact situation where the phase table is
   * misleading without a callout. Never true at healthy frame rates: at
   * 60fps the "gap" is just vsync idle, not a problem to report.
   */
  readonly dominated: boolean;
}

export function offLoopAccount(p95FrameMs: number, cpuMs: number): OffLoopAccount {
  const frameMs = Math.max(0, p95FrameMs);
  const gapMs = Math.max(0, frameMs - Math.max(0, cpuMs));
  return { frameMs, gapMs, dominated: frameMs > 20 && gapMs > frameMs / 2 };
}

/** Structural shapes for `long-animation-frame` entries (not yet in TS lib). */
export interface LongAnimationFrameScriptLike {
  readonly duration: number;
  readonly invoker?: string;
  readonly sourceURL?: string;
  readonly sourceFunctionName?: string;
}
export interface LongAnimationFrameEntryLike {
  readonly startTime?: number;
  readonly duration: number;
  readonly scripts?: readonly LongAnimationFrameScriptLike[];
}

export interface LoafScriptRow {
  /** `function @ tail-of-source-url` — stable, human-readable aggregation key. */
  readonly key: string;
  readonly totalMs: number;
  readonly count: number;
}

export interface LoafSummary {
  readonly longFrameCount: number;
  readonly totalLongMs: number;
  /** Long-frame time no script accounts for: style/layout, GC, engine work. */
  readonly unattributedMs: number;
  /** Script rows, largest total first. */
  readonly scripts: readonly LoafScriptRow[];
}

/**
 * Aggregate the browser's own long-animation-frame report (frames >50ms of
 * main-thread work, WITH script attribution) into top offenders. This is the
 * half of the off-loop gap the main thread can name; a large gap with an
 * EMPTY summary is the other half — GPU/compositor — and the panel says so
 * rather than showing nothing.
 */
export function aggregateLongAnimationFrames(
  entries: readonly LongAnimationFrameEntryLike[],
): LoafSummary {
  const rows = new Map<string, { totalMs: number; count: number }>();
  let totalLongMs = 0;
  let attributedMs = 0;
  for (const entry of entries) {
    totalLongMs += entry.duration;
    for (const script of entry.scripts ?? []) {
      attributedMs += script.duration;
      const source = script.sourceURL ? script.sourceURL.split('/').slice(-2).join('/') : '';
      const name = script.sourceFunctionName || script.invoker || '(anonymous)';
      const key = source ? `${name} @ ${source}` : name;
      const row = rows.get(key) ?? { totalMs: 0, count: 0 };
      row.totalMs += script.duration;
      row.count += 1;
      rows.set(key, row);
    }
  }
  return {
    longFrameCount: entries.length,
    totalLongMs: Math.round(totalLongMs),
    unattributedMs: Math.round(Math.max(0, totalLongMs - attributedMs)),
    scripts: [...rows.entries()]
      .map(([key, row]) => ({ key, totalMs: Math.round(row.totalMs), count: row.count }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 8),
  };
}

/**
 * The full per-frame accounting the Overview renders as "Where the frame
 * goes" — the identity is `frameMs = loopMs + otherMainMs + pipelineMs`, so
 * the breakdown always ADDS UP to the observed frame interval instead of
 * leaving a mystery between "1ms of phases" and "14fps".
 *
 * - `loopMs` — measured: the profiled loop's own rAF callback CPU.
 * - `otherMainMs` — measured (busy sampler, `main-thread-busy.ts`) minus the
 *   loop's share; `null` when the sampler has not covered the window, never
 *   a fabricated 0.
 * - `pipelineMs` — the arithmetic remainder: GPU + compositor (post-effects,
 *   glass chrome) + waiting for vsync. Not directly measurable from JS —
 *   `gpuDrawMs` (timer queries, when the context supports them) names the
 *   loop's own share of it.
 */
export interface FrameBudget {
  readonly frames: number;
  readonly fps: number;
  readonly frameMs: number;
  readonly loopMs: number;
  readonly otherMainMs: number | null;
  readonly pipelineMs: number;
  /** Mean resolved GPU time of the loop's own draw; null when unmeasured. */
  readonly gpuDrawMs: number | null;
}

/** Below this many frames (or busy samples) the window is noise, not data. */
const BUDGET_MIN_FRAMES = 5;
const BUDGET_MIN_BUSY_SAMPLES = 20;

export function frameBudget(
  frames: readonly PerformanceFrame[],
  windowStartMs: number,
  busy: { busyMs: number; sampleCount: number } | null,
): FrameBudget | null {
  const windowed = frames.filter(
    (frame) => frame.timestamp >= windowStartMs && frame.intervalMs > 0,
  );
  if (windowed.length < BUDGET_MIN_FRAMES) return null;
  let sumInterval = 0;
  let sumCpu = 0;
  let sumGpu = 0;
  let gpuCount = 0;
  for (const frame of windowed) {
    sumInterval += frame.intervalMs;
    sumCpu += frame.cpuMs;
    if (frame.render.gpuMs !== null) {
      sumGpu += frame.render.gpuMs;
      gpuCount++;
    }
  }
  const count = windowed.length;
  const frameMs = sumInterval / count;
  const loopMs = sumCpu / count;
  const otherMainMs =
    busy !== null && busy.sampleCount >= BUDGET_MIN_BUSY_SAMPLES
      ? Math.max(0, busy.busyMs - sumCpu) / count
      : null;
  return {
    frames: count,
    fps: frameMs > 0 ? 1000 / frameMs : 0,
    frameMs,
    loopMs,
    otherMainMs,
    pipelineMs: Math.max(0, frameMs - loopMs - (otherMainMs ?? 0)),
    gpuDrawMs: gpuCount > 0 ? sumGpu / gpuCount : null,
  };
}

// ---------------------------------------------------------------------------
// The hierarchical "time spent" tree (owner direction, 2026-07-31)
// ---------------------------------------------------------------------------

/**
 * One row of the Overview's structural time-spent breakdown. Every row is a
 * MEAN MS PER FRAME over the same window, so children sum to their parent
 * and depth-1 rows sum to the frame interval — one tree, one denominator,
 * replacing the flat budget table + latest-frame phase table + standalone
 * systems table that each answered with a different unit.
 *
 * `parallel` marks an overlapping measure (the GPU draw executes while the
 * CPU rows run) — rendered as an annotation, excluded from sum checking.
 * `ms: null` is honest absence (e.g. the busy sampler has no coverage yet).
 */
export interface TimeSpentRow {
  readonly label: string;
  readonly depth: number;
  readonly ms: number | null;
  readonly note?: string;
  readonly parallel?: boolean;
}

/** Remainder rows below this are noise, not information. */
const TIME_SPENT_EPSILON_MS = 0.05;
const MAX_SYSTEMS_PER_PHASE = 3;
const MAX_SCRIPT_ROWS = 4;

function windowedFrames(
  frames: readonly PerformanceFrame[],
  windowStartMs: number,
): PerformanceFrame[] {
  return frames.filter((frame) => frame.timestamp >= windowStartMs && frame.intervalMs > 0);
}

function meanByKey(
  entries: readonly (readonly [string, number])[],
  count: number,
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const [key, ms] of entries) sums.set(key, (sums.get(key) ?? 0) + ms);
  const means = new Map<string, number>();
  for (const [key, sum] of sums) means.set(key, sum / count);
  return means;
}

function phaseRows(windowed: readonly PerformanceFrame[], loopMs: number): TimeSpentRow[] {
  const count = windowed.length;
  const phases = meanByKey(
    windowed.flatMap((frame) => frame.phases.map((p) => [p.name, p.ms] as const)),
    count,
  );
  const systems = meanByKey(
    windowed.flatMap((frame) => frame.systems.map((s) => [`${s.phase} ${s.name}`, s.ms] as const)),
    count,
  );
  const rows: TimeSpentRow[] = [];
  let phaseSum = 0;
  for (const [name, ms] of [...phases.entries()].sort((a, b) => b[1] - a[1])) {
    phaseSum += ms;
    rows.push({ label: name, depth: 2, ms });
    const inPhase = [...systems.entries()]
      .filter(([key]) => key.startsWith(`${name} `))
      .map(([key, sysMs]) => {
        // Span names are `scope / phase / name` — the tree already says the
        // phase, so show the tail.
        const spanName = key.slice(name.length + 1);
        return [spanName.split(' / ').at(-1) ?? spanName, sysMs] as const;
      })
      .sort((a, b) => b[1] - a[1]);
    for (const [sysName, sysMs] of inPhase.slice(0, MAX_SYSTEMS_PER_PHASE)) {
      rows.push({ label: sysName, depth: 3, ms: sysMs });
    }
    const rest = inPhase.slice(MAX_SYSTEMS_PER_PHASE);
    if (rest.length > 0) {
      rows.push({
        label: `${rest.length} more system${rest.length === 1 ? '' : 's'}`,
        depth: 3,
        ms: rest.reduce((sum, [, sysMs]) => sum + sysMs, 0),
      });
    }
  }
  const unphased = loopMs - phaseSum;
  if (unphased > TIME_SPENT_EPSILON_MS) {
    rows.push({ label: 'outside the phases', depth: 2, ms: unphased });
  }
  return rows;
}

function otherMainRows(
  otherMainMs: number | null,
  loafEntries: readonly LongAnimationFrameEntryLike[],
  windowStartMs: number,
  frameCount: number,
): TimeSpentRow[] {
  if (otherMainMs === null) return [];
  const loaf = aggregateLongAnimationFrames(
    loafEntries.filter((entry) => (entry.startTime ?? 0) >= windowStartMs),
  );
  const rows: TimeSpentRow[] = [];
  let attributed = 0;
  for (const script of loaf.scripts.slice(0, MAX_SCRIPT_ROWS)) {
    const ms = Math.min(script.totalMs / frameCount, otherMainMs - attributed);
    if (ms <= TIME_SPENT_EPSILON_MS) continue;
    attributed += ms;
    rows.push({ label: script.key, depth: 2, ms, note: 'named by the browser (long frames)' });
  }
  const unattributed = otherMainMs - attributed;
  if (unattributed > TIME_SPENT_EPSILON_MS || rows.length === 0) {
    rows.push({
      label: 'unattributed',
      depth: 2,
      ms: Math.max(0, unattributed),
      note: "below the browser's 50ms attribution threshold",
    });
  }
  return rows;
}

/**
 * Build the whole tree, or null while the window lacks data. Invariants
 * (unit-tested): depth-1 non-parallel rows sum to the frame interval; each
 * level's non-parallel children sum to their parent (within epsilon).
 */
export function timeSpentRows(
  frames: readonly PerformanceFrame[],
  windowStartMs: number,
  busy: { busyMs: number; sampleCount: number } | null,
  loafEntries: readonly LongAnimationFrameEntryLike[],
): { rows: TimeSpentRow[]; budget: FrameBudget } | null {
  const budget = frameBudget(frames, windowStartMs, busy);
  if (budget === null) return null;
  const windowed = windowedFrames(frames, windowStartMs);
  const rows: TimeSpentRow[] = [
    {
      label: 'Frame interval',
      depth: 0,
      ms: budget.frameMs,
      note: `${budget.frames} frames at ${budget.fps.toFixed(0)} fps`,
    },
    { label: 'Scene loop (CPU)', depth: 1, ms: budget.loopMs },
    ...phaseRows(windowed, budget.loopMs),
    {
      label: 'Other main thread',
      depth: 1,
      ms: budget.otherMainMs,
      note: budget.otherMainMs === null ? 'not sampled yet' : 'React, timers, observers',
    },
    ...otherMainRows(budget.otherMainMs, loafEntries, windowStartMs, budget.frames),
    {
      label: 'Display pipeline',
      depth: 1,
      ms: budget.pipelineMs,
      note: 'everything after the main thread — the remainder',
    },
  ];
  if (budget.gpuDrawMs !== null) {
    rows.push({
      label: 'viewport GPU draw',
      depth: 2,
      ms: budget.gpuDrawMs,
      note: 'measured; runs in parallel with the CPU rows',
      parallel: true,
    });
    rows.push({
      label: 'compositor + vsync wait',
      depth: 2,
      ms: Math.max(0, budget.pipelineMs - budget.gpuDrawMs),
      note: 'post-effects, glass chrome, waiting for the next frame slot',
    });
  }
  return { rows, budget };
}
