/**
 * THE PERFORMANCE: what a piece's written notes become when played. One pure function, read by
 * the editor's engine and by the export alike, so the two can never disagree about what sounds:
 *
 *   - the TEMPO MAP (`<Points target="tempo">` in `<Transport>`): beats to seconds, linear ramps
 *     between points unless a point holds;
 *   - ARTICULATIONS (`artic` on a note): staccato, staccatissimo, tenuto, accent, marcato and
 *     legato shape length and velocity; every note keeps its `artic`, so an instrument that
 *     records one apart (`articulations` on its device) plays it on that patch;
 *   - CONTROLLER LANES (`<Points target="cc11">` in a clip): sampled into controller events;
 *   - HUMANISING (`<Device plugin="humanize">` on a channel): seeded, so every render is the same,
 *     and CORRELATED (a slow random walk, not independent jitter per note), because a player who is
 *     late stays late for a while and listeners prefer that (Hennig et al., PLoS ONE 2011);
 *   - the same pitch struck again while it still sounds cuts the earlier note just before, so the
 *     second note is not choked by the first one's release (a sampler trap music-engine measured).
 *
 * Nothing here is invented for a piece: every value comes from its source.
 */

import type { Piece, PiecePoints } from './piece';

export interface PerformedNote {
  readonly track: string;
  /** The written start, in beats: which section a note belongs to (`start` may drift across it). */
  readonly beat: number;
  readonly start: number;
  readonly end: number;
  readonly pitch: number;
  readonly velocity: number;
  /** How it is played (`staccato`, `pizzicato`, …), or `null`. */
  readonly artic: string | null;
}

export interface PerformedControl {
  readonly track: string;
  /** MIDI controller number, or `pitchbend`. */
  readonly controller: number | 'pitchbend';
  readonly time: number;
  /** 0–1 for a controller; −1…1 for pitch bend. */
  readonly value: number;
}

export interface Performance {
  readonly notes: readonly PerformedNote[];
  readonly controls: readonly PerformedControl[];
  /** Seconds at a beat (the tempo map). */
  readonly secondsAt: (beat: number) => number;
  /** Beat at a second (its inverse). */
  readonly beatAt: (seconds: number) => number;
  /** Seconds the piece lasts. */
  readonly seconds: number;
}

interface TempoSegment {
  readonly beat: number;
  readonly bpm: number;
  readonly nextBeat: number;
  readonly nextBpm: number;
  readonly startSeconds: number;
}

/** Seconds from `from` to `from + span` beats over a tempo that moves linearly from `a` to `b` BPM. */
function segmentSeconds(span: number, a: number, b: number, length: number): number {
  if (span <= 0) return 0;
  if (Math.abs(b - a) < 1e-9 || length <= 0) return (span * 60) / a;
  // bpm(x) = a + (b - a) x / length; seconds = ∫ 60 / bpm dx
  const k = (b - a) / length;
  return (60 / k) * Math.log((a + k * span) / a);
}

export function tempoMap(piece: Piece): { secondsAt(beat: number): number; beatAt(seconds: number): number } {
  const lane = piece.transport.tempoPoints;
  const points = [...(lane?.points ?? [])].sort((x, y) => x.time - y.time);
  if (points.length === 0 || (points[0]?.time ?? 0) > 0) points.unshift({ id: 'tempo:0', oid: null, time: 0, value: piece.transport.tempo, hold: true });
  const segments: TempoSegment[] = [];
  let seconds = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const next = points[i + 1];
    const nextBeat = next ? next.time : Number.POSITIVE_INFINITY;
    const nextBpm = next && !point.hold ? next.value : point.value;
    segments.push({ beat: point.time, bpm: point.value, nextBeat, nextBpm, startSeconds: seconds });
    if (next) seconds += segmentSeconds(next.time - point.time, point.value, nextBpm, next.time - point.time);
  }
  const secondsAt = (beat: number): number => {
    let segment = segments[0]!;
    for (const candidate of segments) if (candidate.beat <= beat) segment = candidate;
    const length = Number.isFinite(segment.nextBeat) ? segment.nextBeat - segment.beat : 0;
    return segment.startSeconds + segmentSeconds(beat - segment.beat, segment.bpm, segment.nextBpm, length);
  };
  const beatAt = (target: number): number => {
    let low = 0;
    let high = 1;
    while (secondsAt(high) < target) high *= 2;
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      if (secondsAt(middle) < target) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  return { secondsAt, beatAt };
}

/** Deterministic PRNG (mulberry32): the same seed gives the same performance. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A slow, bounded random walk sampled per note: correlated drift, not jitter. */
function drift(seed: number, count: number, amount: number): number[] {
  const next = random(seed);
  const out: number[] = [];
  let value = 0;
  for (let i = 0; i < count; i++) {
    value = value * 0.8 + (next() * 2 - 1) * 0.45;
    out.push(Math.max(-1, Math.min(1, value)) * amount);
  }
  return out;
}

const ARTICULATION: Record<string, { length: number; velocity: number; overlap?: number }> = {
  staccato: { length: 0.5, velocity: 0.05 },
  staccatissimo: { length: 0.25, velocity: 0.08 },
  tenuto: { length: 1, velocity: 0.03 },
  accent: { length: 0.9, velocity: 0.15 },
  marcato: { length: 0.75, velocity: 0.22 },
  legato: { length: 1, velocity: 0, overlap: 0.06 },
  // Techniques, not shapes: written length and velocity; the patch plays them.
  pizzicato: { length: 1, velocity: 0 },
  tremolo: { length: 1, velocity: 0 },
};

/** Where every written note and lane of the piece sounds, in seconds. */
export function perform(piece: Piece): Performance {
  const { secondsAt, beatAt } = tempoMap(piece);
  const notes: PerformedNote[] = [];
  const controls: PerformedControl[] = [];
  for (const track of piece.tracks) {
    const humanize = track.channel?.devices.find((device) => device.plugin === 'humanize');
    const timingMs = typeof humanize?.params['timingMs'] === 'number' ? humanize.params['timingMs'] : 0;
    const velocityAmount = typeof humanize?.params['velocity'] === 'number' ? humanize.params['velocity'] : 0;
    const seed = typeof humanize?.params['seed'] === 'number' ? humanize.params['seed'] : 1;
    const written = track.clips.flatMap((clip) => clip.notes).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const timeDrift = drift(seed, written.length, timingMs / 1000);
    const velocityDrift = drift(seed + 7919, written.length, velocityAmount);
    const performed = written.map((note, index) => {
      const shape = note.artic ? ARTICULATION[note.artic] : undefined;
      const start = secondsAt(note.start) + (timeDrift[index] ?? 0);
      const writtenEnd = secondsAt(note.start + note.duration);
      const length = (writtenEnd - secondsAt(note.start)) * (shape?.length ?? 1) + (shape?.overlap ?? 0);
      return {
        track: track.id,
        beat: note.start,
        start: Math.max(0, start),
        end: Math.max(0, start) + Math.max(0.02, length),
        pitch: note.pitch,
        velocity: Math.max(0.01, Math.min(1, note.vel + (shape?.velocity ?? 0) + (velocityDrift[index] ?? 0))),
        artic: note.artic,
      };
    });
    // A pitch struck again while it sounds: end the earlier note 12 ms before the new one.
    for (let i = 0; i < performed.length; i++) {
      for (let j = i + 1; j < performed.length; j++) {
        const earlier = performed[i]!;
        const later = performed[j]!;
        if (later.start >= earlier.end) break;
        if (later.pitch === earlier.pitch && later.start > earlier.start) {
          performed[i] = { ...earlier, end: Math.max(earlier.start + 0.02, later.start - 0.012) };
        }
      }
    }
    notes.push(...performed);
    for (const clip of track.clips) {
      for (const lane of clip.lanes) controls.push(...sampleLane(track.id, lane, secondsAt));
    }
  }
  const seconds = secondsAt(piece.length);
  return { notes, controls, secondsAt, beatAt, seconds };
}

/** A lane's points as controller events: every point, plus linear steps between them (1/16 beat). */
function sampleLane(track: string, lane: PiecePoints, secondsAt: (beat: number) => number): PerformedControl[] {
  const controller = lane.target === 'pitchbend' ? 'pitchbend' : Number(/^cc(\d+)$/.exec(lane.target)?.[1] ?? Number.NaN);
  if (controller !== 'pitchbend' && !Number.isInteger(controller)) return [];
  const points = [...lane.points].sort((a, b) => a.time - b.time);
  const out: PerformedControl[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const next = points[i + 1];
    out.push({ track, controller, time: secondsAt(point.time), value: point.value });
    if (!next || point.hold) continue;
    for (let beat = point.time + 0.25; beat < next.time - 1e-9; beat += 0.25) {
      const t = (beat - point.time) / (next.time - point.time);
      out.push({ track, controller, time: secondsAt(beat), value: point.value + (next.value - point.value) * t });
    }
  }
  return out;
}
