/**
 * COMPING: which take of an audio clip sounds where, as both mixes play it. A clip of one
 * recording is one segment, the whole clip. A clip of several takes plays the newest until its
 * first `<Comp>`, then each comp's take until the next; where the take changes, the outgoing one
 * runs on for {@link COMP_FADE} seconds falling linearly to silence while the incoming one rises
 * from silence over the same stretch.
 *
 * The offline mix applies each segment's envelope per sample and the editor's graph schedules
 * the same points as linear ramps, so the two mixes stay equal across a comp.
 */
import type { PieceAudio, PieceClip } from '@volter/dawproject/piece';

/** Seconds two takes cross at a comp boundary. */
export const COMP_FADE = 0.005;

/** One stretch of a clip played from one take, in piece-seconds. */
export interface AudioSegment {
  readonly audio: PieceAudio;
  /** Where the segment starts and stops sounding; `to` includes its fade-out. */
  readonly from: number;
  readonly to: number;
  /** Where in the take's file `from` falls, in seconds. */
  readonly sourceAt: number;
  /** Its level as (second, gain) points, linear between them and held beyond; the take's gain included. */
  readonly envelope: readonly (readonly [number, number])[];
}

/** The clip's segments, from `secondsAt` (the piece's tempo map). Empty for a note clip. */
export function audioSegments(clip: PieceClip, secondsAt: (beat: number) => number): AudioSegment[] {
  const newest = clip.takes.at(-1);
  if (!newest) return [];
  const clipStart = secondsAt(clip.time);
  const clipEnd = secondsAt(clip.time + clip.duration);
  const byName = new Map(clip.takes.map((take) => [take.take, take]));
  // Each boundary inside the clip where a known take starts; the newest plays before the first.
  const picks: { audio: PieceAudio; at: number }[] = [{ audio: newest, at: clipStart }];
  if (clip.takes.length > 1) {
    for (const comp of clip.comps) {
      const audio = byName.get(comp.take);
      const at = secondsAt(comp.time);
      if (!audio || at >= clipEnd) continue;
      if (at <= clipStart) picks[0] = { audio, at: clipStart };
      else picks.push({ audio, at });
    }
  }
  const segments: AudioSegment[] = [];
  for (let i = 0; i < picks.length; i++) {
    const { audio, at } = picks[i]!;
    const next = picks[i + 1]?.at ?? clipEnd;
    if (next <= at) continue;
    const gain = 10 ** (audio.gain / 20);
    const fadeIn = i > 0;
    const fadeOut = i + 1 < picks.length;
    const to = fadeOut ? next + COMP_FADE : next;
    const envelope: [number, number][] = fadeIn ? [[at, 0], [at + COMP_FADE, gain]] : [[at, gain]];
    if (fadeOut) envelope.push([next, gain], [next + COMP_FADE, 0]);
    segments.push({ audio, from: at, to, sourceAt: audio.offset + (at - clipStart), envelope });
  }
  return segments;
}

/** A segment's gain at a piece-second (its envelope, linear between points, held outside them). */
export function envelopeAt(envelope: readonly (readonly [number, number])[], second: number): number {
  const first = envelope[0];
  if (!first || second <= first[0]) return first?.[1] ?? 0;
  for (let i = 0; i < envelope.length - 1; i++) {
    const [t0, v0] = envelope[i]!;
    const [t1, v1] = envelope[i + 1]!;
    if (second < t1) return t1 > t0 ? v0 + ((v1 - v0) * (second - t0)) / (t1 - t0) : v1;
  }
  return envelope[envelope.length - 1]![1];
}
