export interface PerformanceTiming {
  readonly name: string;
  readonly ms: number;
  /**
   * Offset (ms) from THIS frame's start (`frameStart`) at which the timing
   * began — a MEASURED value (e.g. a phase's `phaseStart - frameStart`), never
   * synthesized. Present on per-frame phase timings (W4b, so a Chrome trace
   * can place each phase span under its frame at the real offset). OMITTED on
   * cross-frame aggregate rollups (`PerformanceSnapshot.phases`/`systems`/
   * `components`), where no single start point exists — absent, never a
   * fabricated 0.
   */
  readonly startMs?: number;
}

/**
 * One MEASURED span within a frame (W4b) — a system or component invocation,
 * with the phase it ran in and its measured start offset from `frameStart`.
 * Distinct from {@link PerformanceTiming}: a span is a single timed
 * invocation carrying `phase` + always-present `startMs` (the trace/flame
 * unit), whereas a `PerformanceTiming` may be a cross-frame rollup.
 */
export interface PerformanceSpan {
  readonly name: string;
  readonly phase: string;
  /** Measured offset (ms) from `frameStart` at which this span began. */
  readonly startMs: number;
  readonly ms: number;
}

/** Renderer counters accumulated over a frame (from `renderer.info`). */
export interface PerformanceRenderStats {
  readonly gpuMs: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  /**
   * How many top-level `renderer.render()` submissions the last presentation
   * took (`renderer.info.render.frame`'s delta across one draw) — a composer
   * chain, a shadow pass and a post stack each cost one. `null` (never a
   * fabricated 0, same rule as `gpuMs`) when no reporter counted them: a
   * reporter that omits `renderPasses` is saying it does not know, which is
   * different from saying nothing was drawn.
   */
  readonly renderPasses: number | null;
}

export interface PerformanceFrame {
  readonly id: number;
  readonly timestamp: number;
  readonly intervalMs: number;
  readonly cpuMs: number;
  readonly phases: readonly PerformanceTiming[];
  /**
   * Per-invocation system spans measured this frame (W4b). Ordered by
   * `startMs` (execution order), NOT accumulated — a system that ran twice
   * (two substeps) appears twice. Empty when the profiler saw no named
   * systems this frame.
   */
  readonly systems: readonly PerformanceSpan[];
  /**
   * Per-invocation component spans measured this frame (W4b) — populated ONLY
   * while `recording` (component timing is gated on recording, matching
   * `beginComponent`/`endComponent`). Empty otherwise.
   */
  readonly components: readonly PerformanceSpan[];
  /**
   * Renderer counters reported during this frame (W4b) — a snapshot of the
   * accumulated `reportRender` totals taken at `endFrame`. `gpuMs` is `null`
   * when no GPU timer reported (headless/SwiftShader), never a fabricated 0.
   */
  readonly render: PerformanceRenderStats;
}

export interface PerformanceSnapshot {
  readonly enabled: boolean;
  readonly recording: boolean;
  readonly fps: number;
  readonly cpuMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly frames: readonly PerformanceFrame[];
  readonly phases: readonly PerformanceTiming[];
  readonly systems: readonly PerformanceTiming[];
  readonly components: readonly PerformanceTiming[];
  readonly render: PerformanceRenderStats;
}

const now = () => globalThis.performance?.now() ?? Date.now();

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

/** Game-owned, bounded external store for browser-native performance diagnostics. */
export function createPerformanceProfiler(initiallyEnabled = false) {
  const listeners = new Set<() => void>();
  const frames: PerformanceFrame[] = [];
  const currentPhases = new Map<string, { ms: number; startMs: number }>();
  const currentSystems = new Map<string, number>();
  const currentComponents = new Map<string, number>();
  // Per-frame span logs (W4b) — cleared each beginFrame, snapshotted into the
  // frame at endFrame. Distinct from the accumulate-by-name aggregate maps
  // above (which back the cross-frame snapshot rollups): these preserve every
  // individual invocation and its measured start offset, for the trace.
  let frameSystems: PerformanceSpan[] = [];
  let frameComponents: PerformanceSpan[] = [];
  let enabled = initiallyEnabled;
  // The header's always-visible FPS sparkline needs frame INTERVALS without
  // turning on the full profiler. Full profiling measures phases/systems,
  // issues GPU timer queries at render sites, and intentionally warns about
  // overhead; a glanceable heartbeat must not silently opt the user into all
  // of that work. `telemetryEnabled` records only the frame envelope.
  let telemetryEnabled = false;
  let recording = false;
  let frameId = 0;
  let frameStart = 0;
  let lastFrameStart = 0;
  /**
   * Phase start times, innermost last. A STACK rather than the single slot
   * this used to be, because phases NEST: the three adapter brackets its CPU
   * render submission as its own phase (`render.submit`,
   * `dev/render-vitals.ts`) from inside the frame's enclosing `render` phase.
   * With one slot the inner `beginPhase()` overwrote the outer's start, so the
   * outer `endPhase('render')` measured only the tail after the inner phase —
   * silently under-reporting the very phase the inner one was decomposing.
   * Balanced callers are unaffected; `endPhase` with an empty stack falls back
   * to `frameStart` rather than a stale start from a previous frame.
   */
  const phaseStack: number[] = [];
  let systemStart = 0;
  let componentStart = 0;
  let render: PerformanceRenderStats = {
    gpuMs: null,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    renderPasses: null,
  };
  let snapshot: PerformanceSnapshot = {
    enabled,
    recording,
    fps: 0,
    cpuMs: 0,
    p95Ms: 0,
    p99Ms: 0,
    frames: [],
    phases: [],
    systems: [],
    components: [],
    render,
  };

  function publish(): void {
    const latest = frames.at(-1);
    // Frame-only subscribers need no percentile work. Keep this window stable
    // so a retained snapshot's first percentile read still describes its frames.
    const snapshotFrames = frames.slice();
    let sortedIntervals: number[] | undefined;
    const readPercentile = (fraction: number): number => {
      sortedIntervals ??= snapshotFrames
        .map((frame) => frame.intervalMs)
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      return percentile(sortedIntervals, fraction);
    };
    snapshot = {
      enabled,
      recording,
      fps: latest?.intervalMs ? 1000 / latest.intervalMs : 0,
      cpuMs: latest?.cpuMs ?? 0,
      get p95Ms() {
        return readPercentile(0.95);
      },
      get p99Ms() {
        return readPercentile(0.99);
      },
      frames: snapshotFrames,
      phases: latest?.phases ?? [],
      systems: [...currentSystems].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms),
      components: [...currentComponents]
        .map(([name, ms]) => ({ name, ms }))
        .sort((a, b) => b.ms - a.ms),
      render,
    };
    for (const listener of listeners) listener();
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      if (enabled === value) return;
      enabled = value;
      if (value && !telemetryEnabled) lastFrameStart = 0;
      publish();
    },
    get telemetryEnabled() {
      return telemetryEnabled;
    },
    set telemetryEnabled(value: boolean) {
      if (telemetryEnabled === value) return;
      const wasInactive = !enabled && !telemetryEnabled;
      telemetryEnabled = value;
      if (value && wasInactive) lastFrameStart = 0;
      publish();
    },
    get recording() {
      return recording;
    },
    startRecording() {
      const wasInactive = !enabled && !telemetryEnabled;
      enabled = true;
      if (wasInactive) lastFrameStart = 0;
      recording = true;
      frames.length = 0;
      publish();
    },
    stopRecording() {
      recording = false;
      publish();
    },
    clear() {
      frames.length = 0;
      publish();
    },
    beginFrame() {
      if (!enabled && !telemetryEnabled) return;
      currentPhases.clear();
      currentSystems.clear();
      currentComponents.clear();
      frameSystems = [];
      frameComponents = [];
      // A frame that threw mid-phase leaves entries on the stack; a fresh
      // frame starts from nothing rather than inheriting them.
      phaseStack.length = 0;
      render = {
        gpuMs: null,
        drawCalls: 0,
        triangles: 0,
        geometries: 0,
        textures: 0,
        renderPasses: null,
      };
      frameStart = now();
    },
    beginPhase() {
      if (!enabled) return;
      phaseStack.push(now());
    },
    endPhase(name: string) {
      if (!enabled) return;
      // See `phaseStack`: pop restores the ENCLOSING phase's own start, so a
      // nested bracket measures itself without truncating its parent.
      const phaseStart = phaseStack.pop() ?? frameStart;
      const elapsed = now() - phaseStart;
      const existing = currentPhases.get(name);
      // Accumulate ms across re-entries of the same phase, but keep the FIRST
      // measured start offset (earliest entry) as the span's startMs.
      currentPhases.set(name, {
        ms: (existing?.ms ?? 0) + elapsed,
        startMs: existing?.startMs ?? phaseStart - frameStart,
      });
      if (recording)
        performance.measure(`vgai.phase.${name}`, { start: phaseStart, duration: elapsed });
    },
    systemObserver: {
      beginSystem() {
        if (!enabled) return;
        systemStart = now();
      },
      endSystem(scope: string, phase: string, name: string) {
        if (!enabled) return;
        const end = now();
        const key = `${scope} / ${phase} / ${name}`;
        currentSystems.set(key, (currentSystems.get(key) ?? 0) + end - systemStart);
        frameSystems.push({
          name: key,
          phase,
          startMs: systemStart - frameStart,
          ms: end - systemStart,
        });
      },
    },
    beginComponent() {
      if (!recording) return;
      componentStart = now();
    },
    endComponent(name: string, phase = '') {
      if (!recording) return;
      const end = now();
      currentComponents.set(name, (currentComponents.get(name) ?? 0) + end - componentStart);
      frameComponents.push({
        name,
        phase,
        startMs: componentStart - frameStart,
        ms: end - componentStart,
      });
    },
    reportRender(stats: {
      gpuMs: number | null;
      drawCalls: number;
      triangles: number;
      geometries: number;
      textures: number;
      /** Omit when this reporter does not count passes — see
       *  {@link PerformanceRenderStats.renderPasses}. */
      renderPasses?: number;
    }) {
      if (!enabled) return;
      render = {
        gpuMs: stats.gpuMs ?? render.gpuMs,
        drawCalls: render.drawCalls + stats.drawCalls,
        triangles: render.triangles + stats.triangles,
        geometries: render.geometries + stats.geometries,
        textures: render.textures + stats.textures,
        renderPasses:
          stats.renderPasses === undefined
            ? render.renderPasses
            : (render.renderPasses ?? 0) + stats.renderPasses,
      };
    },
    endFrame() {
      if (!enabled && !telemetryEnabled) return;
      const timestamp = now();
      const intervalMs = lastFrameStart === 0 ? 0 : frameStart - lastFrameStart;
      lastFrameStart = frameStart;
      const frame: PerformanceFrame = {
        id: ++frameId,
        timestamp,
        intervalMs,
        cpuMs: timestamp - frameStart,
        phases: [...currentPhases]
          .map(([name, { ms, startMs }]) => ({ name, ms, startMs }))
          .sort((a, b) => b.ms - a.ms),
        systems: frameSystems.slice(),
        components: frameComponents.slice(),
        render: { ...render },
      };
      frames.push(frame);
      if (frames.length > 600) frames.splice(0, frames.length - 600);
      if (recording)
        performance.measure('vgai.frame', { start: frameStart, duration: frame.cpuMs });
      publish();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    exportJSON() {
      // version 2 (W4b): frames now carry per-frame `systems`/`components`
      // spans, per-frame `render` counters, and `startMs` on phase timings.
      return JSON.stringify({ version: 2, capturedAt: new Date().toISOString(), frames }, null, 2);
    },
  };
}

export type PerformanceProfiler = ReturnType<typeof createPerformanceProfiler>;
