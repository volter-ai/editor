/**
 * A TRACK'S MIXER AUTOMATION, as both mixes apply it: a `<Points>` child of `<Track>` whose
 * target is `volume` or `send:<bus>` (dB) or `pan` (−1…1), and the channel's `<Lfo>`s on the
 * same targets, whose waves add to the lane (or to the written value where there is no lane).
 *
 * The lane's value runs piecewise-linear between its points in its own units (a `hold` point
 * steps), and is held flat before its first point and after its last. What a mix APPLIES is that
 * value sampled every {@link AUTOMATION_GRID} seconds of piece time, as a gain or a pan position,
 * with a straight line between neighbouring grid values. The editor's Web Audio graph schedules
 * exactly those lines (`linearRampToValueAtTime` between grid points) and the offline mix computes
 * the same lines per sample, so the two mixes stay equal with a lane that curves in dB.
 */
import type { PieceLfo, PiecePoints, PieceTrack } from '@volter/dawproject/piece';
import { dbToGain } from './dsp';

/** Seconds between the values a mix applies. 5 ms: finer than a fader move a person can hear. */
export const AUTOMATION_GRID = 0.005;

/** The parameter of a strip a track lane drives. */
export type MixTarget = { readonly kind: 'volume' } | { readonly kind: 'pan' } | { readonly kind: 'send'; readonly to: string };

/** A track lane's target, or `null` when it names no parameter a strip has. */
export function mixTarget(target: string): MixTarget | null {
  if (target === 'volume') return { kind: 'volume' };
  if (target === 'pan') return { kind: 'pan' };
  if (target.startsWith('send:') && target.length > 'send:'.length) return { kind: 'send', to: target.slice('send:'.length) };
  return null;
}

/** The track's lane for a target, when it has one (the first, when it has several). */
export function laneFor(track: PieceTrack, target: string): PiecePoints | undefined {
  return track.lanes.find((lane) => lane.target === target && lane.points.length > 0);
}

/** An LFO's wave at a beat of the piece, −1…1 times its depth. */
export function lfoValue(lfo: PieceLfo, beat: number): number {
  const cycle = beat / lfo.period + lfo.phase;
  const p = cycle - Math.floor(cycle);
  // Every shape starts its cycle where a sine does, rising through 0 (the saw from −1).
  const wave =
    lfo.shape === 'triangle'
      ? 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5)
      : lfo.shape === 'square'
        ? p < 0.5
          ? 1
          : -1
        : lfo.shape === 'saw'
          ? 2 * p - 1
          : Math.sin(2 * Math.PI * p);
  return wave * lfo.depth;
}

/**
 * What moves one strip parameter: its lane (if any) and the LFOs on it, around `base`, the value
 * written on the channel. `null` when nothing moves it.
 */
export interface Motion {
  readonly lane: PiecePoints | undefined;
  readonly lfos: readonly PieceLfo[];
  readonly base: number;
}

/** The motion of a track's `target` parameter, or `null` when it holds its written value. */
export function motionFor(track: PieceTrack, target: string): Motion | null {
  const parsed = mixTarget(target);
  const channel = track.channel;
  if (!parsed || !channel) return null;
  const lane = laneFor(track, target);
  const lfos = channel.lfos.filter((lfo) => lfo.target === target && lfo.depth !== 0 && lfo.period > 0);
  if (!lane && lfos.length === 0) return null;
  const base =
    parsed.kind === 'volume' ? channel.volume : parsed.kind === 'pan' ? channel.pan : (channel.sends.find((send) => send.to === parsed.to)?.level ?? 0);
  return { lane, lfos, base };
}

/** A moving parameter's value at a beat, in its own units: the lane (or the written value) plus every LFO's wave. */
export function motionValueAtBeat(motion: Motion): (beat: number) => number {
  const laneAt = motion.lane ? laneValueAtBeat(motion.lane) : () => motion.base;
  return (beat) => motion.lfos.reduce((sum, lfo) => sum + lfoValue(lfo, beat), laneAt(beat));
}

/** The lane's value at a beat of the piece, as a function (its points sorted once). */
export function laneValueAtBeat(lane: PiecePoints): (beat: number) => number {
  const points = [...lane.points].sort((a, b) => a.time - b.time);
  return (beat) => {
    const first = points[0];
    if (!first) return 0;
    if (beat <= first.time) return first.value;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (beat < b.time) {
        if (a.hold || b.time <= a.time) return a.value;
        return a.value + ((b.value - a.value) * (beat - a.time)) / (b.time - a.time);
      }
    }
    return points[points.length - 1]!.value;
  };
}

/** What a strip applies for a lane value: a linear gain for volume and sends, a clamped pan. */
export function appliedValue(target: MixTarget, value: number): number {
  return target.kind === 'pan' ? Math.max(-1, Math.min(1, value)) : dbToGain(value);
}

/**
 * The applied value at a piece-second, as both mixes compute it: the grid values either side of
 * it (`beatAt` maps a second to the beat the lane is written in) and the line between them. The
 * returned function caches each grid value it computes.
 */
export function automationCurve(motion: Motion, target: MixTarget, beatAt: (second: number) => number): {
  readonly at: (second: number) => number;
  readonly grid: (k: number) => number;
} {
  const valueAt = motionValueAtBeat(motion);
  const cache = new Map<number, number>();
  const grid = (k: number): number => {
    let value = cache.get(k);
    if (value === undefined) {
      value = appliedValue(target, valueAt(beatAt(k * AUTOMATION_GRID)));
      cache.set(k, value);
    }
    return value;
  };
  return {
    grid,
    at(second) {
      const k = Math.floor(second / AUTOMATION_GRID);
      const v0 = grid(k);
      return v0 + ((grid(k + 1) - v0) * (second - k * AUTOMATION_GRID)) / AUTOMATION_GRID;
    },
  };
}
