/**
 * `render-piece <project> <piece> [out]` — render one piece to a seamless loop and measure it,
 * for the composing agent, which cannot hear: the numbers in `report.json` are what it reads.
 *
 *   <out>/<name>.wav     24-bit loop (second pass of two, tail wrapped)
 *   <out>/<name>.ogg     the same loop, Vorbis
 *   <out>/<name>.mid     the piece as a Standard MIDI File (one pass)
 *   <out>/report.json    loudness (EBU R128 via ffmpeg), true peak, loop seam, and the
 *                        structural checks: notes outside their clip, bar count, ranges
 *
 * Run with `tsx` from a checkout; the piece is mounted with `@volter/dawproject`'s own renderer,
 * so what is measured is exactly what the editor shows.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPiece } from '@volter/dawproject/piece';
import { createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';
import { audioToWav } from 'spessasynth_core';
import { assignChannels, pieceToMidi, renderLoop, seamRatio } from '../src/render-offline';

const [projectArg, pieceArg, outArg] = process.argv.slice(2);
if (!projectArg || !pieceArg) {
  console.error('Usage: render-piece <project dir> <piece path, project-relative> [out dir]');
  process.exit(2);
}
const project = resolve(projectArg);
const piecePath = resolve(project, pieceArg);
const name = basename(piecePath).replace(/\.[cm]?[jt]sx?$/, '');
const out = resolve(project, outArg ?? join('out', name));

const module = (await import(pathToFileURL(piecePath).href)) as { default?: ComponentType };
if (typeof module.default !== 'function') throw new Error(`${pieceArg} has no default export component.`);
const root = createPieceRoot((error) => {
  throw error;
});
const graph = await root.render(module.default);
const piece = readPiece(graph);
root.unmount();

// Structural checks: the questions a composer answers by eye, answered by count.
const beatsPerBar = piece.transport.numerator * (4 / piece.transport.denominator);
const problems: string[] = [];
for (const track of piece.tracks) {
  for (const clip of track.clips) {
    for (const note of clip.notes) {
      if (note.time < 0 || note.time + note.duration > clip.duration + 1e-9) {
        problems.push(`${track.name}: a note at beat ${note.time} of "${clip.name ?? 'clip'}" runs outside the clip (${clip.duration} beats).`);
      }
    }
  }
}
if (Math.abs(piece.length / beatsPerBar - Math.round(piece.length / beatsPerBar)) > 1e-9) {
  problems.push(`The piece is ${piece.length} beats, not a whole number of ${beatsPerBar}-beat bars.`);
}

const assignments = assignChannels(piece);
const bankPath = [...assignments.values()][0]?.bank;
if (!bankPath) throw new Error('No track has a soundfont device; there is nothing to render.');
const bankBytes = readFileSync(resolve(project, bankPath));
const loop = await renderLoop(piece, bankBytes.buffer.slice(bankBytes.byteOffset, bankBytes.byteOffset + bankBytes.byteLength));

mkdirSync(out, { recursive: true });
const wavPath = join(out, `${name}.wav`);

/** ffmpeg's EBU R128 summary for a WAV: integrated loudness, loudness range, true peak. */
function measure(path: string): { integrated: number; range: number; truePeak: number } {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const text = run.stderr ?? '';
  const summary = text.slice(text.lastIndexOf('Summary:'));
  return {
    integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? Number.NaN),
    range: Number(/LRA:\s+(-?[\d.]+) LU/.exec(summary)?.[1] ?? Number.NaN),
    truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1] ?? Number.NaN),
  };
}

function scale(gain: number): void {
  for (const channel of [loop.left, loop.right]) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * gain;
}

// GAIN STAGING. The synth's summed output runs hot, and 16-bit WAV clips at full scale, so the
// loop is first taken 18 dB down, measured, then set to the loudness target; if that would put
// the true peak above the ceiling, the ceiling wins and the report says the target was not met.
const TARGET_LUFS = Number(process.env['TARGET_LUFS'] ?? -18);
const CEILING_DBTP = -1;
scale(10 ** (-18 / 20));
writeFileSync(wavPath, new Uint8Array(audioToWav([loop.left, loop.right], loop.sampleRate, { normalizeAudio: false, loop: { start: 0, end: loop.loopSeconds } })));
const first = measure(wavPath);
const gainDb = Math.min(TARGET_LUFS - first.integrated, CEILING_DBTP - first.truePeak);
scale(10 ** (gainDb / 20));
writeFileSync(wavPath, new Uint8Array(audioToWav([loop.left, loop.right], loop.sampleRate, { normalizeAudio: false, loop: { start: 0, end: loop.loopSeconds } })));
writeFileSync(join(out, `${name}.mid`), new Uint8Array(pieceToMidi(piece, 1).writeMIDI()));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-c:a', 'vorbis', '-strict', '-2', '-b:a', '224k', join(out, `${name}.ogg`)]);

const { integrated, range, truePeak } = measure(wavPath);
if (Math.abs(integrated - TARGET_LUFS) > 1) {
  problems.push(`Loudness is ${integrated} LUFS against a ${TARGET_LUFS} LUFS target: the ${CEILING_DBTP} dBTP ceiling limited the gain (the mix has a peak far above its average).`);
}

const notes = piece.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.notes.map((note) => ({ track: track.name, note }))));
const byTrack = Object.fromEntries(
  piece.tracks.map((track) => {
    const own = track.clips.flatMap((clip) => clip.notes);
    const pitches = own.map((note) => note.pitch);
    return [
      track.name,
      {
        notes: own.length,
        lowest: pitches.length ? Math.min(...pitches) : null,
        highest: pitches.length ? Math.max(...pitches) : null,
        pitchClasses: new Set(pitches.map((pitch) => pitch % 12)).size,
      },
    ];
  }),
);

const report = {
  piece: pieceArg,
  tempo: piece.transport.tempo,
  meter: `${piece.transport.numerator}/${piece.transport.denominator}`,
  bars: piece.length / beatsPerBar,
  loopSeconds: Math.round(loop.loopSeconds * 1000) / 1000,
  notes: notes.length,
  tracks: byTrack,
  loudness: { integratedLufs: integrated, loudnessRangeLu: range, truePeakDbfs: truePeak },
  seamRatio: Math.round(seamRatio(loop) * 1000) / 1000,
  problems,
};
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${out}`);
