/**
 * AUDIO RECORDING: the browser's audio input captured while Rec runs on an audio track, saved into
 * the project as a WAV and placed as an `<Audio>` clip where it was played.
 *
 * The capture starts at the context time of its first frame; the file is padded with silence
 * back to the bar line it began in, so the clip starts on that bar and plays the take from its
 * own start (`offset` 0). The input is taken as it arrives, with the browser's echo cancelling,
 * noise suppression and gain control off (a recording, not a call).
 */

import { formatAt } from '@volter/dawproject/notation';
import type { Piece, PieceTrack } from '@volter/dawproject/piece';
import captureUrl from './capture.worklet.ts?worker&url';
import { type SourceIndex } from './source-index';
import { attributeText, elementAt, indentOf, insertElement, parseSource } from './source-notes';
import { wav24 } from './wav';

/** A take being captured; `stop()` ends it and answers what was heard and when it began. */
export interface AudioCapture {
  stop(): { readonly left: Float32Array; readonly right: Float32Array; readonly sampleRate: number; readonly startTime: number } | null;
}

/** Start capturing the default audio input on `context` (the engine's own, so times share one clock). */
export async function captureInput(context: AudioContext): Promise<AudioCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  await context.audioWorklet.addModule(captureUrl);
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'volter-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
  const blocks: { left: Float32Array; right: Float32Array }[] = [];
  let startTime: number | null = null;
  node.port.onmessage = (event: MessageEvent<{ time: number; left: Float32Array; right: Float32Array }>) => {
    startTime ??= event.data.time;
    blocks.push({ left: event.data.left, right: event.data.right });
  };
  source.connect(node);
  return {
    stop() {
      source.disconnect();
      node.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
      if (startTime === null || blocks.length === 0) return null;
      const length = blocks.reduce((sum, block) => sum + block.left.length, 0);
      const left = new Float32Array(length);
      const right = new Float32Array(length);
      let at = 0;
      for (const block of blocks) {
        left.set(block.left, at);
        right.set(block.right, at);
        at += block.left.length;
      }
      return { left, right, sampleRate: context.sampleRate, startTime };
    },
  };
}

/** The take as WAV bytes, padded with `padSeconds` of silence before it. */
export function takeWav(take: { readonly left: Float32Array; readonly right: Float32Array; readonly sampleRate: number }, padSeconds: number): Uint8Array {
  const pad = Math.max(0, Math.round(padSeconds * take.sampleRate));
  const left = new Float32Array(pad + take.left.length);
  const right = new Float32Array(pad + take.right.length);
  left.set(take.left, pad);
  right.set(take.right, pad);
  return wav24(left, right, take.sampleRate);
}

/**
 * A take cut into one per pass of the loop it was played over: each pass as its own recording,
 * padded back to the region's start so every take lines up with the clip over the region. The
 * part of a take played before the region (a play started ahead of the loop) is dropped, and a
 * last pass cut short by Stop is a take like the rest. `null` when the take lies in one pass.
 */
export function takesPerPass(
  take: { readonly left: Float32Array; readonly right: Float32Array; readonly sampleRate: number },
  elapsed: number,
  region: { readonly start: number; readonly end: number },
): { left: Float32Array; right: Float32Array; sampleRate: number; pad: number }[] | null {
  const length = region.end - region.start;
  const seconds = take.left.length / take.sampleRate;
  if (length <= 0 || elapsed + seconds <= region.end + 1e-3 || elapsed >= region.end) return null;
  const passes: { left: Float32Array; right: Float32Array; sampleRate: number; pad: number }[] = [];
  // From the region's start (or the take's, when later), one pass at a time.
  let from = Math.max(elapsed, region.start);
  while (from < elapsed + seconds - 1e-3) {
    const inPass = region.start + ((from - region.start) % length);
    const to = Math.min(elapsed + seconds, from + (region.end - inPass));
    const a = Math.round((from - elapsed) * take.sampleRate);
    const b = Math.round((to - elapsed) * take.sampleRate);
    passes.push({ left: take.left.slice(a, b), right: take.right.slice(a, b), sampleRate: take.sampleRate, pad: inPass - region.start });
    from = to;
  }
  return passes;
}

/**
 * The source with a recorded clip on `track`: `<Clip at bars name="take">` holding an `<Audio>`
 * per path (named takes 1, 2, … when there are several), from bar `firstBar` for `bars` bars,
 * after the clip that starts before it (or the channel).
 */
export function writeAudioTake(source: string, pieceFile: string, piece: Piece, track: PieceTrack, index: SourceIndex, paths: readonly string[], firstBar: number, bars: number): string {
  const beatsPerBar = piece.transport.beatsPerBar;
  const own = (oid: string | null): oid is string => oid !== null && (piece.oidCounts.get(oid) ?? 0) === 1;
  const before = track.clips.filter((clip) => clip.time <= firstBar * beatsPerBar && own(clip.oid)).at(-1);
  const anchorOid = before?.oid ?? (own(track.channel?.oid ?? null) ? track.channel!.oid : null);
  if (!anchorOid || !own(track.oid)) throw new Error(`${track.name} is generated, so a recorded clip has no single place to go.`);
  const entry = index.get(anchorOid);
  if (!entry) throw new Error('The source index has not caught up with the piece yet; try again.');
  const file = parseSource(source, pieceFile);
  const anchor = elementAt(file, entry.line, entry.col, entry.tag);
  if (!anchor) throw new Error('The source index has not caught up with the piece yet; try again.');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const indent = indentOf(source, file, anchor);
  const clip = `<Clip ${attributeText('at', formatAt(firstBar * beatsPerBar, beatsPerBar, { bar: true }))} ${attributeText('bars', bars)} ${attributeText('name', 'take')}>`;
  // One recording, or one take per pass: the newest (last) plays until the clip is comped.
  const takes = paths.map((path, i) => `${newline}${indent}  <Audio ${attributeText('file', path)}${paths.length > 1 ? ` ${attributeText('take', String(i + 1))}` : ''} />`).join('');
  return insertElement(source, file, anchor, 'after', `${clip}${takes}${newline}${indent}</Clip>`);
}
