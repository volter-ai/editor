import { meterPercent } from '@vgai/game-runtime/adapter/audio-meter';
import type { PerformanceFrame } from '@vgai/game-runtime/dev/performance-profiler';

export const AUDIO_METER_SEGMENTS = 8;
export const PERFORMANCE_SPARKLINE_SAMPLES = 24;
export const FRAME_BUDGET_60_FPS_MS = 1000 / 60;

export type PerformanceTelemetryTone = 'normal' | 'warning' | 'danger';

/** Discrete VU fill for the header: instantaneous magnitude, not history. */
export function audioMeterSegmentCount(level: number, segments = AUDIO_METER_SEGMENTS): number {
  if (!(level > 0) || segments <= 0) return 0;
  return Math.min(segments, Math.max(1, Math.round((meterPercent(level) / 100) * segments)));
}

export interface FrameIntervalSample {
  /** Newest frame consumed, even when no valid interval was available. */
  readonly frameId: number;
  /** P95 interval across the fresh frames, preserving spikes without plotting
   * every noisy render tick. Null means the batch had no measured interval. */
  readonly intervalMs: number | null;
}

/** Collapse every frame after `afterFrameId` into one stable history point.
 * The header calls this on a slow cadence; the full profiler retains raw
 * per-frame history for detailed inspection. */
export function sampleFrameInterval(
  frames: readonly PerformanceFrame[],
  afterFrameId: number,
): FrameIntervalSample {
  const fresh = frames.filter((frame) => frame.id > afterFrameId);
  const frameId = fresh.at(-1)?.id ?? afterFrameId;
  const intervals = fresh
    .map((frame) => frame.intervalMs)
    .filter((interval) => Number.isFinite(interval) && interval > 0)
    .sort((a, b) => a - b);
  if (intervals.length === 0) return { frameId, intervalMs: null };
  const index = Math.floor((intervals.length - 1) * 0.95);
  return { frameId, intervalMs: intervals[index] ?? null };
}

/** Alert only on a sustained trend. A single hitch remains visible as a spike
 * but does not flash the whole instrument; three consecutive samples over the
 * 60 FPS budget warn, and two severe half-second samples mark danger. */
export function performanceTelemetryTone(intervals: readonly number[]): PerformanceTelemetryTone {
  const recent = intervals.slice(-3);
  if (recent.slice(-2).length === 2 && recent.slice(-2).every((value) => value >= 50)) {
    return 'danger';
  }
  if (recent.length === 3 && recent.every((value) => value > FRAME_BUDGET_60_FPS_MS * 1.05)) {
    return 'warning';
  }
  return 'normal';
}

/** SVG point string for a time-series sparkline. Unlike the segmented audio
 * meter this preserves ordering: slow-frame spikes move across the strip. */
export function frameSparklinePoints(
  intervals: readonly number[],
  width: number,
  height: number,
  ceilingMs = 50,
): string {
  if (intervals.length === 0 || width <= 0 || height <= 0) return '';
  const denominator = Math.max(1, intervals.length - 1);
  return intervals
    .map((interval, index) => {
      const x = (index / denominator) * width;
      const normalized = Math.min(1, Math.max(0, interval / ceilingMs));
      const y = height - normalized * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
