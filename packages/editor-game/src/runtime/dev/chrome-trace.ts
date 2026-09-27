/**
 * Chrome Trace Event Format exporter (W4b, F11 profiler → chrome://tracing /
 * Perfetto). A PURE, deterministic function over recorded
 * {@link PerformanceFrame}s — no clock reads, no randomness, no I/O — so the
 * same frames always serialize to byte-identical output (asserted by the unit
 * test).
 *
 * Format (https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU):
 *  - `M` metadata events name the process and thread.
 *  - One `X` (complete) event per frame — `ts` at the frame's absolute start,
 *    `dur` the frame's CPU time — with nested `X` events per phase and per
 *    system placed at their MEASURED `startMs` offsets inside the frame.
 *  - One `C` (counter) event per frame carries the render draw/triangle
 *    counters, so the trace viewer draws them as a graph track.
 *
 * All times are microseconds (the format's unit); our profiler measures ms, so
 * every ms value is × 1000. Every event carries the full key set
 * (`ph/ts/dur/pid/tid/name/cat`) for uniformity — metadata/counter events
 * would normally omit `dur`, but a constant `dur: 0` is harmless to the viewer
 * and lets a consumer read every event without per-`ph` branching.
 */

import type { PerformanceFrame } from './performance-profiler';

export interface ChromeTraceEvent {
  readonly name: string;
  readonly cat: string;
  readonly ph: 'X' | 'M' | 'C';
  /** Timestamp, microseconds. */
  readonly ts: number;
  /** Duration, microseconds (0 for metadata/counter events). */
  readonly dur: number;
  readonly pid: number;
  readonly tid: number;
  readonly args?: Record<string, unknown>;
}

export interface ChromeTraceFile {
  readonly traceEvents: readonly ChromeTraceEvent[];
  readonly displayTimeUnit: 'ms';
  readonly otherData: Record<string, unknown>;
}

export interface ChromeTraceOptions {
  processName: string;
  threadName: string;
}

const PID = 1;
const TID = 1;
const MS_TO_US = 1000;

function ms(value: number): number {
  return Math.round(value * MS_TO_US);
}

export function buildChromeTrace(
  frames: readonly PerformanceFrame[],
  options: ChromeTraceOptions,
): ChromeTraceFile {
  const events: ChromeTraceEvent[] = [];

  // Metadata: name the process + thread the frames live on.
  events.push({
    name: 'process_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    dur: 0,
    pid: PID,
    tid: TID,
    args: { name: options.processName },
  });
  events.push({
    name: 'thread_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    dur: 0,
    pid: PID,
    tid: TID,
    args: { name: options.threadName },
  });

  for (const frame of frames) {
    // Absolute frame start (ms): timestamp is the frame's END, cpuMs its span.
    const frameStartMs = frame.timestamp - frame.cpuMs;
    const frameStartUs = ms(frameStartMs);

    events.push({
      name: `frame ${frame.id}`,
      cat: 'frame',
      ph: 'X',
      ts: frameStartUs,
      dur: ms(frame.cpuMs),
      pid: PID,
      tid: TID,
      args: {
        id: frame.id,
        drawCalls: frame.render.drawCalls,
        triangles: frame.render.triangles,
      },
    });

    for (const phase of frame.phases) {
      events.push({
        name: phase.name,
        cat: 'phase',
        ph: 'X',
        ts: ms(frameStartMs + (phase.startMs ?? 0)),
        dur: ms(phase.ms),
        pid: PID,
        tid: TID,
      });
    }

    for (const system of frame.systems) {
      events.push({
        name: system.name,
        cat: 'system',
        ph: 'X',
        ts: ms(frameStartMs + system.startMs),
        dur: ms(system.ms),
        pid: PID,
        tid: TID,
        args: { phase: system.phase },
      });
    }

    // Counter track: render draw/triangle counts at this frame's start.
    events.push({
      name: 'render',
      cat: 'counter',
      ph: 'C',
      ts: frameStartUs,
      dur: 0,
      pid: PID,
      tid: TID,
      args: { drawCalls: frame.render.drawCalls, triangles: frame.render.triangles },
    });
  }

  return {
    traceEvents: events,
    displayTimeUnit: 'ms',
    otherData: {
      version: 2,
      processName: options.processName,
      threadName: options.threadName,
      frameCount: frames.length,
    },
  };
}
