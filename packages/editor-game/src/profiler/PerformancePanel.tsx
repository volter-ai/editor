/**
 * The full Performance analysis UI — since W3 of the workspace-shell program
 * this renders as the Profiler view inside the bottom Debugger. The live
 * active rendered document remains visible above it. The source is selected
 * by workspace document identity, not by assuming Play mode.
 */

import {
  aggregateLongAnimationFrames,
  deriveRenderDebugCapabilities,
  type FrameBudget,
  flamegraphRows,
  formatBytes,
  frameHistoryBars,
  type LongAnimationFrameEntryLike,
  offLoopAccount,
  type TimeSpentRow,
  timeSpentRows,
} from '../host/components/frame-debugger-model';
import { isJsHeapReading, readJsHeap } from '@volter/editor-core/js-heap';
import { useActivePerformanceSource } from '../host/use-active-performance-source';
import { editorHost, useHostAvailabilitySelector } from '@volter/editor-sdk/host';
import {
  Button,
  EditorBadge,
  EditorBanner,
  EditorTab,
  EditorTabList,
  fontSizeVar,
  spaceVar,
  themeVars,
} from '@volter/editor-sdk/widgets';
import { buildChromeTrace } from '@volter/game-runtime/dev/chrome-trace';
import type {
  PerformanceFrame,
  PerformanceProfiler,
  PerformanceSnapshot,
} from '@volter/game-runtime/dev/performance-profiler';
import type { RenderMemorySnapshot } from '@volter/game-runtime/dev/render-memory';
import { useEffect, useRef, useState } from 'react';
import { createMainThreadBusySampler, type MainThreadBusySampler } from './main-thread-busy';

const EMPTY: PerformanceSnapshot = {
  enabled: false,
  recording: false,
  fps: 0,
  cpuMs: 0,
  p95Ms: 0,
  p99Ms: 0,
  frames: [],
  phases: [],
  systems: [],
  components: [],
  render: {
    gpuMs: null,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    renderPasses: null,
  },
};

/** Human-readable telemetry cadence; capture itself remains full-frame rate. */
const DISPLAY_INTERVAL_MS = 500;

function downloadCapture(profiler: PerformanceProfiler): void {
  const url = URL.createObjectURL(new Blob([profiler.exportJSON()], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vgai-performance-${new Date().toISOString().replaceAll(':', '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Export the recorded frames as a Chrome Trace Event Format file
 *  (chrome://tracing / Perfetto) — the same download idiom as `downloadCapture`,
 *  over the M1 pure exporter. `main` is the only thread we measure on. */
function downloadTrace(profiler: PerformanceProfiler, processName: string): void {
  const trace = buildChromeTrace(profiler.getSnapshot().frames, {
    processName,
    threadName: 'main',
  });
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vgai-trace-${new Date().toISOString().replaceAll(':', '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

type ProfilerView = 'overview' | 'flamegraph' | 'memory';

const FLAME_WIDTH = 720;
const FLAME_ROW_H = 18;
const STRIP_H = 40;

const FLAME_DEPTH_COLORS = [
  themeVars.accent.default,
  themeVars.semantic.success,
  themeVars.semantic.warning,
  themeVars.content.muted,
];

/** Flamegraph view: a frame-history strip (click to select a frame) over one
 *  frame's measured CPU spans as absolutely-positioned rows. GPU is never a
 *  row — only measured CPU spans exist; the header prints GPU n/a exactly like
 *  the overview. */
function FlamegraphView({ snapshot }: { snapshot: PerformanceSnapshot }) {
  const frames = snapshot.frames;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const effectiveIndex =
    selectedIndex !== null && selectedIndex < frames.length ? selectedIndex : frames.length - 1;
  const frame: PerformanceFrame | undefined = frames[effectiveIndex];
  const bars = frameHistoryBars(frames, FLAME_WIDTH, STRIP_H);
  const rows = frame ? flamegraphRows(frame, FLAME_WIDTH) : [];
  const maxDepth = rows.reduce((d, r) => Math.max(d, r.depth), 0);

  if (frames.length === 0) {
    return (
      <div
        data-testid="flamegraph-empty"
        style={{ padding: spaceVar[6], color: themeVars.content.muted }}
      >
        No frames recorded yet. Frames accumulate while the profiler is enabled; use{' '}
        <strong>Record capture</strong> to also collect per-component spans.
      </div>
    );
  }

  return (
    <div data-testid="flamegraph-view" style={{ padding: spaceVar[4] }}>
      <div style={{ marginBottom: spaceVar[4], color: themeVars.content.muted }}>
        Frame <span style={{ color: themeVars.content.primary }}>{frame ? frame.id : '—'}</span> ·{' '}
        {frame ? `${frame.cpuMs.toFixed(2)} ms CPU` : ''} · GPU{' '}
        <span style={{ color: themeVars.content.primary }}>
          {frame && frame.render.gpuMs !== null ? `${frame.render.gpuMs.toFixed(2)} ms` : 'n/a'}
        </span>
      </div>
      {/* Frame-history strip */}
      <div
        data-testid="flame-frame-strip"
        style={{
          position: 'relative',
          width: FLAME_WIDTH,
          height: STRIP_H,
          // §2.31: hairline-bounded strip — the bars carry the data, the
          // panel surface shows through.
          boxShadow: `inset 0 0 0 1px ${themeVars.boundary.default}`,
          marginBottom: spaceVar[5],
        }}
      >
        {bars.map((bar) => (
          // A data-viz bar (not a form control) — a clickable div, the same
          // idiom the Network inspector's tree rows use, so it needs neither a
          // raw native button (product-chrome ban) nor Button paint overrides.
          <div
            key={bar.frameId}
            role="button"
            tabIndex={0}
            data-testid="flame-frame-bar"
            data-frame-index={bar.index}
            data-selected={bar.index === effectiveIndex || undefined}
            title={`frame ${bar.frameId} · ${bar.cpuMs.toFixed(2)} ms`}
            onClick={() => setSelectedIndex(bar.index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelectedIndex(bar.index);
            }}
            style={{
              position: 'absolute',
              left: bar.x,
              bottom: 0,
              width: Math.max(1, bar.w - 1),
              height: Math.max(1, bar.h),
              cursor: 'pointer',
              background:
                bar.index === effectiveIndex
                  ? themeVars.semantic.warning
                  : themeVars.accent.default,
            }}
          />
        ))}
      </div>
      {/* Selected frame's flame rows */}
      <div
        data-testid="flamegraph-rows"
        style={{
          position: 'relative',
          width: FLAME_WIDTH,
          height: (maxDepth + 1) * FLAME_ROW_H,
        }}
      >
        {rows.map((row, i) => (
          <div
            key={`${row.depth}-${i}-${row.label}`}
            data-testid="flame-rect"
            data-depth={row.depth}
            data-name={row.label}
            title={`${row.label} · ${row.ms.toFixed(3)} ms`}
            style={{
              position: 'absolute',
              left: row.x,
              top: row.depth * FLAME_ROW_H,
              width: Math.max(1, row.w),
              height: FLAME_ROW_H - 1,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              fontSize: fontSizeVar.sm,
              lineHeight: `${FLAME_ROW_H - 1}px`,
              paddingLeft: 3,
              color: themeVars.content.onAccent,
              background: FLAME_DEPTH_COLORS[Math.min(row.depth, FLAME_DEPTH_COLORS.length - 1)],
              borderRight: `1px solid ${themeVars.surface.inset}`,
            }}
          >
            {row.label}
          </div>
        ))}
      </div>
      <div
        style={{ marginTop: spaceVar[3], fontSize: fontSizeVar.sm, color: themeVars.content.dim }}
      >
        Rows: frame · phase · system{snapshot.recording ? ' · component (recording)' : ''}. Only
        measured CPU spans are drawn — GPU time is a whole-frame aggregate, never a fabricated lane.
      </div>
    </div>
  );
}

function ByteTable({
  title,
  entries,
  estimated,
  testId,
}: {
  title: string;
  entries: readonly { name: string; bytes: number }[];
  estimated: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        // §2.31: hairline-only cards — no interior fill over the surface.
        marginTop: spaceVar[5],
        border: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      <div
        style={{
          padding: `${spaceVar[3]} ${spaceVar[5]}`,
          borderBottom: `1px solid ${themeVars.boundary.default}`,
          color: themeVars.content.muted,
        }}
      >
        {title}
        {estimated && (
          <span
            style={{
              marginLeft: spaceVar[3],
              fontSize: fontSizeVar.xs,
              color: themeVars.content.dim,
            }}
          >
            ESTIMATED
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <div
          style={{
            padding: `${spaceVar[2]} ${spaceVar[5]}`,
            color: themeVars.content.dim,
            fontSize: fontSizeVar.base,
          }}
        >
          none
        </div>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: spaceVar[8],
              padding: '3px 10px',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.name}
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatBytes(entry.bytes)}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** Memory view: the render-memory snapshot (counts + ESTIMATED VRAM + top-N +
 *  the unestimated list) polled at 1 Hz from the render-debug adapter, plus the
 *  browser JS-heap tile. Every unmeasurable fact is shown as absent-with-reason,
 *  never a fabricated number. */
function MemoryView() {
  const adapter = useHostAvailabilitySelector(
    () => editorHost().systems.inspected().renderDebug ?? null,
  );
  const caps = deriveRenderDebugCapabilities(adapter);
  const [snap, setSnap] = useState<RenderMemorySnapshot | null>(null);

  useEffect(() => {
    if (!adapter?.memorySnapshot) {
      setSnap(null);
      return;
    }
    const poll = () => setSnap(adapter.memorySnapshot?.() ?? null);
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [adapter]);

  const heap = readJsHeap();

  return (
    <div style={{ padding: spaceVar[4] }}>
      {/* JS heap tile — browser-only, honest reason when absent. */}
      <div
        data-testid="memory-heap"
        style={{
          border: `1px solid ${themeVars.boundary.default}`,
          padding: spaceVar[5],
          marginBottom: spaceVar[5],
        }}
      >
        <div
          style={{
            color: themeVars.content.dim,
            textTransform: 'uppercase',
            fontSize: fontSizeVar.sm,
          }}
        >
          JS heap (performance.memory)
        </div>
        {isJsHeapReading(heap) ? (
          <div style={{ fontSize: fontSizeVar.xl, color: themeVars.content.primary, marginTop: 3 }}>
            {formatBytes(heap.usedBytes)}{' '}
            <span style={{ fontSize: fontSizeVar.base, color: themeVars.content.muted }}>
              used / {formatBytes(heap.totalBytes)} total
            </span>
          </div>
        ) : (
          <div
            data-testid="memory-heap-unavailable"
            style={{
              fontSize: fontSizeVar.base,
              color: themeVars.content.muted,
              marginTop: 3,
              fontStyle: 'italic',
            }}
          >
            {heap.unavailable}
          </div>
        )}
      </div>

      {!caps?.memory ? (
        <div
          data-testid="memory-absent"
          style={{
            padding: spaceVar[4],
            color: themeVars.content.muted,
            fontSize: fontSizeVar.base,
            fontStyle: 'italic',
          }}
        >
          Render-memory introspection is not provided by this world's adapter — a headless mount has
          no <code>renderer.info</code>, and a canvas (PixiJS) world's renderer publishes no managed
          geometry collection to measure at all. Enter Play with a first-party three world to
          inspect geometry/texture footprints.
        </div>
      ) : snap === null ? (
        <div
          style={{
            padding: spaceVar[4],
            color: themeVars.content.muted,
            fontSize: fontSizeVar.base,
          }}
        >
          Waiting for the first render-memory sample…
        </div>
      ) : (
        <div data-testid="memory-section">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(80px, 1fr))',
              gap: spaceVar[4],
            }}
          >
            {[
              ['Geometries', String(snap.counts.geometries)],
              ['Textures', String(snap.counts.textures)],
              [
                'Programs',
                snap.counts.programs === null
                  ? 'n/a until first render'
                  : String(snap.counts.programs),
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${themeVars.boundary.default}`,
                  padding: spaceVar[5],
                }}
              >
                <div
                  style={{
                    color: themeVars.content.dim,
                    textTransform: 'uppercase',
                    fontSize: fontSizeVar.sm,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontSize: fontSizeVar['2xl'],
                    color: themeVars.content.primary,
                    marginTop: 3,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div
            data-testid="memory-vram-totals"
            style={{
              display: 'flex',
              gap: 18,
              marginTop: spaceVar[5],
              fontSize: fontSizeVar.base,
              color: themeVars.content.muted,
            }}
          >
            <span>
              geometry buffers{' '}
              <span style={{ color: themeVars.content.primary }}>
                {formatBytes(snap.estimatedGeometryBytes)}
              </span>{' '}
              <span style={{ fontSize: fontSizeVar.xs, color: themeVars.content.dim }}>EXACT</span>
            </span>
            <span>
              texture VRAM{' '}
              <span style={{ color: themeVars.content.primary }}>
                {formatBytes(snap.estimatedTextureBytes)}
              </span>{' '}
              <span style={{ fontSize: fontSizeVar.xs, color: themeVars.content.dim }}>
                ESTIMATED
              </span>
            </span>
          </div>
          <ByteTable
            title="Top geometries"
            entries={snap.topGeometries}
            estimated={false}
            testId="memory-top-geometries"
          />
          <ByteTable
            title="Top textures"
            entries={snap.topTextures}
            estimated
            testId="memory-top-textures"
          />
          {snap.unestimated.length > 0 && (
            <div
              data-testid="memory-unestimated"
              style={{
                marginTop: spaceVar[5],
                border: `1px solid ${themeVars.boundary.default}`,
              }}
            >
              <div
                style={{
                  padding: `${spaceVar[3]} ${spaceVar[5]}`,
                  borderBottom: `1px solid ${themeVars.boundary.default}`,
                  color: themeVars.content.muted,
                }}
              >
                Unmeasured textures ({snap.unestimated.length}) — excluded from the total, not
                zeroed
              </div>
              {snap.unestimated.map((entry) => (
                <div
                  key={entry.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: spaceVar[8],
                    padding: '3px 10px',
                    fontSize: fontSizeVar.base,
                  }}
                >
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {entry.name}
                  </span>
                  <span style={{ color: themeVars.content.dim }}>{entry.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Rolling window of the browser's long-animation-frame entries (frames with
 * >50ms of main-thread work, WITH script attribution) while a profiler
 * source is mounted. The entries land in a ref — the section reads them on
 * the panel's existing 500ms snapshot cadence, so it updates with the same
 * display throttle and freezes with "Freeze view".
 */
function useLongAnimationFrames(profiler: PerformanceProfiler | null): {
  entries: readonly LongAnimationFrameEntryLike[];
  supported: boolean;
} {
  const entriesRef = useRef<LongAnimationFrameEntryLike[]>([]);
  const supported =
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes('long-animation-frame');
  useEffect(() => {
    if (!profiler || !supported) return;
    entriesRef.current = [];
    const observer = new PerformanceObserver((list) => {
      const entries = entriesRef.current;
      for (const entry of list.getEntries()) {
        entries.push(entry as unknown as LongAnimationFrameEntryLike);
      }
      if (entries.length > 40) entries.splice(0, entries.length - 40);
    });
    observer.observe({ type: 'long-animation-frame' } as PerformanceObserverInit);
    return () => observer.disconnect();
  }, [profiler, supported]);
  return { entries: entriesRef.current, supported };
}

/**
 * The time-spent tree for the Overview: runs the main-thread busy sampler
 * while a profiler source is mounted and folds it with the profiler's frame
 * window and the LoAF entries. Recomputed on the snapshot's 500ms display
 * cadence; the frame window, the busy-sample window, and the tree's LoAF
 * attribution are the SAME last second, so every level of the tree sums.
 */
function useTimeSpent(
  profiler: PerformanceProfiler | null,
  snapshot: PerformanceSnapshot,
  loafEntries: readonly LongAnimationFrameEntryLike[],
): { rows: readonly TimeSpentRow[]; budget: FrameBudget } | null {
  const samplerRef = useRef<MainThreadBusySampler | null>(null);
  if (samplerRef.current === null) samplerRef.current = createMainThreadBusySampler();
  useEffect(() => {
    const sampler = samplerRef.current;
    if (!profiler || !sampler) return;
    sampler.start();
    return () => sampler.stop();
  }, [profiler]);
  const windowStart = performance.now() - 1000;
  return timeSpentRows(
    snapshot.frames,
    windowStart,
    samplerRef.current.busySince(windowStart),
    loafEntries,
  );
}

/** One tree row: indented label + note, share bar scaled to the frame
 *  interval, tabular ms. Parallel (overlapping) measures render dimmed and
 *  italic — they annotate the tree, they do not sum into it. */
function TimeSpentRowView({ row, rootMs }: { row: TimeSpentRow; rootMs: number }) {
  const share = row.ms !== null && rootMs > 0 ? Math.min(1, row.ms / rootMs) : 0;
  const root = row.depth === 0;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr 70px',
        gap: spaceVar[5],
        padding: `${spaceVar[2]} ${spaceVar[5]}`,
        paddingLeft: 10 + row.depth * 16,
      }}
    >
      <span
        style={{
          color: root || row.depth === 1 ? themeVars.content.primary : themeVars.content.muted,
          fontStyle: row.parallel ? 'italic' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={row.note ? `${row.label} — ${row.note}` : row.label}
      >
        {row.label}
        {row.note && (
          <span
            style={{
              marginLeft: spaceVar[3],
              fontSize: fontSizeVar.sm,
              color: themeVars.content.dim,
            }}
          >
            {row.note}
          </span>
        )}
      </span>
      <div
        style={{
          background: themeVars.surface.raised,
          height: 6,
          marginTop: 5,
          opacity: row.parallel ? 0.45 : 1,
        }}
      >
        <div
          style={{
            width: `${share * 100}%`,
            height: '100%',
            background:
              !root && row.ms !== null && row.ms > 8
                ? themeVars.semantic.warning
                : themeVars.accent.default,
          }}
        />
      </div>
      <span
        style={{
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: root ? themeVars.content.primary : undefined,
        }}
      >
        {row.ms === null ? '—' : `${row.ms.toFixed(1)} ms`}
      </span>
    </div>
  );
}

/**
 * The structural "where the frame goes" tree: one hierarchy, one denominator
 * (mean ms/frame over the last second), every level summing to its parent —
 * frame interval → { scene loop → phases → systems, other main thread →
 * named scripts + unattributed, display pipeline → GPU draw ∥ + compositor/
 * vsync }. Born from the 2026-07-31 glass-chain incident, where "14fps with
 * 1.1ms of render" had no answer in the panel: ~20ms/frame of compositor
 * cost that no phase could ever show. Below the tree, the browser's
 * long-animation-frame report keeps a longer (10s) memory of named
 * main-thread offenders.
 */
function OffLoopSection({
  snapshot,
  timeSpent,
  entries,
  loafSupported,
}: {
  snapshot: PerformanceSnapshot;
  timeSpent: { rows: readonly TimeSpentRow[]; budget: FrameBudget } | null;
  entries: readonly LongAnimationFrameEntryLike[];
  loafSupported: boolean;
}) {
  const budget = timeSpent?.budget ?? null;
  // The prose verdict reads from the SAME window as the tree when one exists
  // (mean-based) — a p95 verdict beside mean rows contradicted itself
  // whenever hitches skewed the tail.
  const account = budget
    ? offLoopAccount(budget.frameMs, budget.loopMs)
    : offLoopAccount(snapshot.p95Ms, snapshot.cpuMs);
  // The named-offender list keeps a longer memory than the tree's 1s window:
  // attribution needs persistence (a 1s window forgets a hitch immediately),
  // but it is time-windowed, not count-windowed — "last 40 entries" silently
  // reached back to boot hitches and printed totals with no denominator.
  const loafWindowMs = 10_000;
  const loaf = aggregateLongAnimationFrames(
    entries.filter((entry) => (entry.startTime ?? 0) >= performance.now() - loafWindowMs),
  );
  if (timeSpent === null && !account.dominated && loaf.longFrameCount === 0) return null;
  return (
    <div
      data-testid="time-spent-section"
      style={{ marginTop: spaceVar[6], border: `1px solid ${themeVars.boundary.default}` }}
    >
      <div
        style={{
          padding: '7px 10px',
          borderBottom: `1px solid ${themeVars.boundary.default}`,
          color: themeVars.content.muted,
        }}
      >
        Where the frame goes
      </div>
      {timeSpent !== null && (
        <div data-testid="time-spent-tree" style={{ paddingBottom: spaceVar[1] }}>
          {timeSpent.rows.map((row) => (
            <TimeSpentRowView
              key={`${row.depth}:${row.label}`}
              row={row}
              rootMs={timeSpent.budget.frameMs}
            />
          ))}
        </div>
      )}
      {account.dominated && (
        <div
          style={{
            padding: `${spaceVar[3]} ${spaceVar[5]}`,
            color: themeVars.content.muted,
            borderTop: `1px solid ${themeVars.boundary.default}`,
          }}
        >
          The measured loop explains less than half of the frame time — the bottleneck is{' '}
          {loaf.scripts.length > 0
            ? 'partly the main-thread work below, and the rest'
            : 'not on the main thread: look at the display pipeline'}{' '}
          (GPU/compositor: post-effects, glass chrome, pixel ratio) or browser throttling.
        </div>
      )}
      {loaf.scripts.length > 0 && (
        <div
          style={{
            padding: '5px 10px 2px',
            borderTop: `1px solid ${themeVars.boundary.default}`,
            fontSize: fontSizeVar.sm,
            color: themeVars.content.dim,
          }}
        >
          Named main-thread offenders — longer memory than the tree (last 10s of long frames)
        </div>
      )}
      {loaf.scripts.map((row) => (
        <div
          key={row.key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: spaceVar[8],
            padding: `${spaceVar[2]} ${spaceVar[5]}`,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.key}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {row.totalMs} ms ×{row.count}
          </span>
        </div>
      ))}
      {loaf.longFrameCount > 0 && (
        <div
          style={{
            padding: `${spaceVar[2]} ${spaceVar[5]}`,
            fontSize: fontSizeVar.sm,
            color: themeVars.content.dim,
          }}
        >
          {loaf.longFrameCount} long main-thread frame{loaf.longFrameCount === 1 ? '' : 's'} (
          {loaf.totalLongMs} ms total, {loaf.unattributedMs} ms unattributed style/layout/GC) —
          browser long-animation-frame report, last 10s.
        </div>
      )}
      {!loafSupported && (
        <div
          style={{
            padding: `${spaceVar[2]} ${spaceVar[5]}`,
            fontSize: fontSizeVar.sm,
            color: themeVars.content.dim,
          }}
        >
          Main-thread attribution unavailable — this browser does not support long-animation-frame
          timing.
        </div>
      )}
    </div>
  );
}

export function PerformancePanel() {
  const source = useActivePerformanceSource();
  const profiler = source?.profiler ?? null;
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot>(EMPTY);
  const [displayFrozen, setDisplayFrozen] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [view, setView] = useState<ProfilerView>('overview');
  const displayFrozenRef = useRef(false);
  const loaf = useLongAnimationFrames(profiler);
  const timeSpent = useTimeSpent(profiler, snapshot, loaf.entries);

  const toggleDisplayFreeze = () => {
    const next = !displayFrozenRef.current;
    displayFrozenRef.current = next;
    setDisplayFrozen(next);
    if (!next && profiler) setSnapshot(profiler.getSnapshot());
  };

  const toggleProfiler = () => {
    if (!profiler) return;
    const enabled = !profiler.enabled;
    if (enabled) setWarningDismissed(false);
    profiler.enabled = enabled;
    setSnapshot(profiler.getSnapshot());
  };

  useEffect(() => {
    if (!profiler) {
      setSnapshot(EMPTY);
      return;
    }
    displayFrozenRef.current = false;
    setDisplayFrozen(false);
    setWarningDismissed(false);
    // Opening the Profiler is the explicit opt-in. It measures continuously
    // while this surface is mounted; Record capture adds detailed marks.
    const enabledBeforePanel = profiler.enabled;
    profiler.enabled = true;
    setSnapshot(profiler.getSnapshot());
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPublishedAt = performance.now();
    const publish = () => {
      timer = null;
      if (displayFrozenRef.current) return;
      lastPublishedAt = performance.now();
      setSnapshot(profiler.getSnapshot());
    };
    const unsubscribe = profiler.subscribe(() => {
      if (displayFrozenRef.current || timer !== null) return;
      const remaining = Math.max(0, DISPLAY_INTERVAL_MS - (performance.now() - lastPublishedAt));
      timer = setTimeout(publish, remaining);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      // Automatic live measurement belongs to this visible instrument. An
      // explicit capture keeps running; a source already enabled elsewhere
      // (for example the Game stats overlay) retains its prior state.
      if (!enabledBeforePanel && !profiler.recording) profiler.enabled = false;
    };
  }, [profiler]);

  if (!profiler) {
    // B-8: the same lightweight paragraph empty-state treatment the other
    // surfaces (Data/Stories/Dev) give their "nothing here yet".
    return (
      <div
        style={{
          padding: spaceVar[6],
          fontSize: fontSizeVar.md,
          color: themeVars.content.muted,
          maxWidth: 480,
        }}
      >
        <p style={{ margin: 0 }}>
          {editorHost().documents.active()
            ? 'The active document has no live render loop to profile.'
            : 'Open a rendered document to profile it.'}
        </p>
      </div>
    );
  }

  return (
    <div
      className="vgai-content-frost"
      style={{
        height: '100%',
        overflow: 'auto',
        padding: spaceVar[6],
        color: themeVars.content.primary,
        fontSize: fontSizeVar.md,
      }}
    >
      <div style={{ marginBottom: spaceVar[5], color: themeVars.content.muted }}>
        Profiling <span style={{ color: themeVars.content.primary }}>{source?.label}</span>
        {snapshot.enabled && warningDismissed && (
          <EditorBadge style={{ marginLeft: spaceVar[4] }}>Profiling active</EditorBadge>
        )}
      </div>
      {snapshot.enabled && !warningDismissed && (
        <EditorBanner
          tone="warning"
          style={{ marginBottom: spaceVar[5] }}
          actions={
            <Button size="compact" variant="ghost" onClick={() => setWarningDismissed(true)}>
              Dismiss
            </Button>
          }
        >
          Live profiling is active and adds measurement overhead. Displayed timings include that
          cost
          {snapshot.recording ? '; capture recording adds detailed timing marks' : ''}.
        </EditorBanner>
      )}
      {/* B-5: these four were the dock's one off-palette button family
          (#303030/#454545/#ddd) — now the shared dock button language. */}
      <div
        style={{
          display: 'flex',
          gap: spaceVar[4],
          alignItems: 'center',
          marginBottom: spaceVar[6],
        }}
      >
        <Button size="compact" onClick={toggleDisplayFreeze}>
          {displayFrozen ? 'Resume view' : 'Freeze view'}
        </Button>
        <Button size="compact" onClick={toggleProfiler}>
          {snapshot.enabled ? 'Disable' : 'Enable'} profiler
        </Button>
        <Button
          size="compact"
          onClick={() =>
            snapshot.recording ? profiler.stopRecording() : profiler.startRecording()
          }
        >
          {snapshot.recording ? 'Stop capture' : 'Record capture'}
        </Button>
        <Button size="compact" onClick={() => profiler.clear()}>
          Clear
        </Button>
        <Button size="compact" onClick={() => downloadCapture(profiler)}>
          Export JSON
        </Button>
        <Button
          size="compact"
          data-testid="profiler-export-trace"
          onClick={() => downloadTrace(profiler, source?.label ?? 'vgai')}
        >
          Export Chrome trace
        </Button>
      </div>
      <EditorTabList aria-label="Profiler views" style={{ marginBottom: spaceVar[6] }}>
        {(
          [
            ['overview', 'Overview'],
            ['flamegraph', 'Flamegraph'],
            ['memory', 'Memory'],
          ] as const
        ).map(([id, label]) => (
          <EditorTab
            key={id}
            selected={view === id}
            data-testid={`profiler-view-${id}`}
            onClick={() => setView(id)}
          >
            {label}
          </EditorTab>
        ))}
      </EditorTabList>
      {view === 'flamegraph' && <FlamegraphView snapshot={snapshot} />}
      {view === 'memory' && <MemoryView />}
      {view === 'overview' && (
        <>
          <div
            style={{
              display: 'grid',
              // F9 (U6.5): `repeat(7, …)` forced a 608px min track sum, so in a
              // narrower console card the chip row overflowed horizontally past
              // the card's rounded-glass lens. `auto-fit` lets the chips wrap to
              // the next row when the card is narrow — they never spill past the
              // card bounds, and still lay out as a single 7-up row when wide.
              gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
              gap: spaceVar[4],
            }}
          >
            {[
              ['FPS', snapshot.fps.toFixed(0)],
              ['CPU', `${snapshot.cpuMs.toFixed(2)} ms`],
              ['p95 frame', `${snapshot.p95Ms.toFixed(2)} ms`],
              ['p99 frame', `${snapshot.p99Ms.toFixed(2)} ms`],
              [
                'GPU',
                snapshot.render.gpuMs === null ? 'n/a' : `${snapshot.render.gpuMs.toFixed(2)} ms`,
              ],
              ['Draw calls', String(snapshot.render.drawCalls)],
              ['Triangles', snapshot.render.triangles.toLocaleString()],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  border: `1px solid ${themeVars.boundary.default}`,
                  padding: spaceVar[5],
                }}
              >
                <div
                  style={{
                    color: themeVars.content.dim,
                    textTransform: 'uppercase',
                    fontSize: fontSizeVar.sm,
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 18, color: themeVars.content.primary, marginTop: 3 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          {/* The time-spent tree ABSORBED the former "Current frame by engine
              phase" table and the standalone Systems table (owner direction,
              2026-07-31: one structural hierarchy instead of three flat views
              with three different denominators) — phases and their systems now
              appear as windowed means under "Scene loop (CPU)"; the Flamegraph
              view remains the per-frame drill-down. */}
          <OffLoopSection
            snapshot={snapshot}
            timeSpent={timeSpent}
            entries={loaf.entries}
            loafSupported={loaf.supported}
          />
          {[['Components (recording)', snapshot.components]].map(([label, timings]) => (
            <div
              key={label as string}
              style={{
                marginTop: spaceVar[6],
                border: `1px solid ${themeVars.boundary.default}`,
              }}
            >
              <div
                style={{
                  padding: '7px 10px',
                  borderBottom: `1px solid ${themeVars.boundary.default}`,
                  color: themeVars.content.muted,
                }}
              >
                {label as string}
              </div>
              {(timings as readonly { name: string; ms: number }[]).slice(0, 12).map((timing) => (
                <div
                  key={timing.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: spaceVar[8],
                    padding: `${spaceVar[2]} ${spaceVar[5]}`,
                  }}
                >
                  <span
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {timing.name}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {timing.ms.toFixed(2)} ms
                  </span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
