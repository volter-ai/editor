/**
 * `render-piece <project> <piece> [out] [--out <dir>] [--target console|portable|<LUFS>] [--sections | --one-shot]` — render one piece to
 * a seamless loop and measure it, for the composing agent, which cannot hear: the numbers in
 * `report.json` are what it reads.
 *
 *   <out>/<name>.wav          24-bit loop (second pass of two, tail wrapped), with a `smpl`
 *                             chunk declaring the whole file one forward loop
 *   <out>/<name>.ogg          the same loop, Vorbis
 *   <out>/<name>.mid          the piece as a Standard MIDI File (one pass)
 *   <out>/sections/<section>.wav / .ogg  with --sections: marker sections, at the full mix gain
 *   <out>/stems/<track>.ogg   Vorbis stems, at the same gain as their WAVs
 *   <out>/stems/<track>.wav   each audible track rendered alone, at the mix's own gain, so the
 *                             stems sum back to the mix (`stems.nullResidualDb` says how nearly)
 *   <out>/report.json         loudness against the target (EBU R128 via ffmpeg), true peak, the
 *                             loop seam, crest factor, spectral centroid, band split, stereo
 *                             width, and the structural checks of `src/checks.ts`
 *
 * --one-shot keeps one pass plus a 4 s tail, fades the last 10 ms, and writes plain WAV/OGG
 * (no smpl loop chunk); it cannot be combined with --sections. --out overrides positional out.
 * report.json includes the mix and stem OGG paths, barSeconds, and optional section metadata.
 *
 * LOUDNESS TARGET: `console` is −24 LUFS, `portable` −18 LUFS (Sony ASWG-R001's two figures);
 * a number is LUFS. The default is `portable`. The true peak never exceeds −1 dBTP; when the
 * ceiling wins, the report says the target was not met.
 *
 * Run with `tsx` from a checkout; the piece is mounted with `@volter/dawproject`'s own renderer,
 * so what is measured is exactly what the editor shows.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { perform } from '@volter/dawproject/perform';
import { readPiece } from '@volter/dawproject/piece';
import { createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';
import { checkPiece } from '../src/checks';
import { measureLoop, nullResidualDb } from '../src/measure';
import { assignChannels, audibleTracks, mixLoop, mixOneShot, pieceToMidi, type RenderedLoop, renderChannels, seamRatio } from '../src/render-offline';
import type { ImpulseResponse } from '../src/mix/offline-mix';
import { loopWav24, wav24, readWav } from '../src/wav';

const TARGETS: Record<string, number> = { console: -24, portable: -18 };
const positional: string[] = [];
let targetArg = 'portable';
let sections = false;
let oneShot = false;
let outFlag: string | undefined;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i] ?? '';
  if (arg === '--target') targetArg = argv[++i] ?? '';
  else if (arg.startsWith('--target=')) targetArg = arg.slice('--target='.length);
  else if (arg === '--sections') sections = true;
  else if (arg === '--one-shot') oneShot = true;
  else if (arg === '--out') outFlag = argv[++i];
  else if (arg.startsWith('--out=')) outFlag = arg.slice('--out='.length);
  else positional.push(arg);
}
if (oneShot && sections) {
  console.error('--one-shot and --sections cannot be used together.');
  process.exit(2);
}
const [projectArg, pieceArg, outArg] = positional;
const TARGET_LUFS = TARGETS[targetArg] ?? Number(targetArg);
if (!projectArg || !pieceArg || targetArg === '' || !Number.isFinite(TARGET_LUFS)) {
  console.error('Usage: render-piece <project dir> <piece path, project-relative> [out dir] [--out <dir>] [--target console|portable|<LUFS>] [--sections | --one-shot]');
  process.exit(2);
}
const project = resolve(projectArg);
const piecePath = resolve(project, pieceArg);
const name = basename(piecePath).replace(/\.[cm]?[jt]sx?$/, '');
const out = resolve(project, outFlag ?? outArg ?? join('out', name));

const module = (await import(pathToFileURL(piecePath).href)) as { default?: ComponentType };
if (typeof module.default !== 'function') throw new Error(`${pieceArg} has no default export component.`);
const root = createPieceRoot((error) => {
  throw error;
});
const graph = await root.render(module.default);
const piece = readPiece(graph);
root.unmount();

const beatsPerBar = piece.transport.beatsPerBar;
const problems: string[] = [...checkPiece(piece).problems];

const assignments = assignChannels(piece);
const bankPath = [...assignments.values()][0]?.bank;
if (!bankPath) throw new Error('No track has a soundfont device; there is nothing to render.');
const bankBytes = readFileSync(resolve(project, bankPath));
const bank = bankBytes.buffer.slice(bankBytes.byteOffset, bankBytes.byteOffset + bankBytes.byteLength);
// Impulse responses the piece's convolution devices name, read from the project.
const irs = new Map<string, ImpulseResponse>();
for (const track of piece.tracks) {
  for (const device of track.channel?.devices ?? []) {
    const path = device.plugin === 'convolution' ? device.params['ir'] : undefined;
    if (typeof path !== 'string' || irs.has(path)) continue;
    const wav = readWav(new Uint8Array(readFileSync(resolve(project, path))));
    irs.set(path, { channels: wav.channels, sampleRate: wav.sampleRate });
  }
}
const rendered = await renderChannels(piece, bank, undefined, undefined, irs, oneShot ? 1 : 2);
const mixRender = oneShot ? mixOneShot : mixLoop;
const writeWav = oneShot ? wav24 : loopWav24;
const loop = mixRender(rendered);
// Each audible track alone, through the same render: the same channels, the same performance.
const stems: { track: string; loop: RenderedLoop }[] = [];
for (const track of audibleTracks(piece)) {
  stems.push({ track: track.name, loop: mixRender(rendered, new Set([track.id])) });
}

mkdirSync(out, { recursive: true });
const wavPath = join(out, `${name}.wav`);
const stemsDir = join(out, 'stems');
rmSync(stemsDir, { recursive: true, force: true });
mkdirSync(stemsDir, { recursive: true });

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

function scale(target: RenderedLoop, gain: number): void {
  for (const channel of [target.left, target.right]) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * gain;
}

// GAIN STAGING. The synth's summed output runs hot and the WAV clamps at full scale, so the loop
// is first taken down (18 dB, or further if its sample peak needs it), measured, then set to the
// loudness target; if that would put the true peak above the ceiling, the ceiling wins and the
// report says the target was not met. Every stem gets exactly the mix's gain: nothing is
// re-normalised, so the stems sum back to the mix.
const CEILING_DBTP = -1;
let samplePeak = 0;
for (const channel of [loop.left, loop.right]) for (const sample of channel) samplePeak = Math.max(samplePeak, Math.abs(sample));
const preGain = Math.min(10 ** (-18 / 20), 0.9 / Math.max(samplePeak, 1e-9));
scale(loop, preGain);
writeFileSync(wavPath, writeWav(loop.left, loop.right, loop.sampleRate));
const first = measure(wavPath);
const gainDb = Math.min(TARGET_LUFS - first.integrated, CEILING_DBTP - first.truePeak);
scale(loop, 10 ** (gainDb / 20));
writeFileSync(wavPath, writeWav(loop.left, loop.right, loop.sampleRate));
function encodeOgg(wav: string, ogg: string): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-c:a', 'vorbis', '-strict', '-2', '-b:a', '224k', ogg]);
}
const safeName = (value: string): string => value.replace(/[/\\:*?"<>|]/g, '-') || 'unnamed';
const stemFiles: { track: string; file: string }[] = [];
for (const stem of stems) {
  scale(stem.loop, preGain * 10 ** (gainDb / 20));
  const file = safeName(stem.track);
  writeFileSync(join(stemsDir, `${file}.wav`), writeWav(stem.loop.left, stem.loop.right, stem.loop.sampleRate));
  encodeOgg(join(stemsDir, `${file}.wav`), join(stemsDir, `${file}.ogg`));
  stemFiles.push({ track: stem.track, file: `stems/${file}.ogg` });
}
const residual = nullResidualDb(
  [loop.left, loop.right],
  stems.map((stem) => [stem.loop.left, stem.loop.right]),
);
writeFileSync(join(out, `${name}.mid`), new Uint8Array(pieceToMidi(piece, 1).writeMIDI()));
encodeOgg(wavPath, join(out, `${name}.ogg`));

const sectionReports: { name: string; bar: number; bars: number; seconds: number; file: string }[] = [];
if (sections) {
  const directory = join(out, 'sections');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const markers = [...piece.markers].sort((a, b) => a.time - b.time);
  const used = new Set<string>();
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    const end = markers[i + 1]?.time ?? piece.length;
    // The section is that stretch of the whole piece's performance, looped on itself.
    const audio = mixLoop(await renderChannels(piece, bank, undefined, undefined, irs, 2, { fromBeat: marker.time, toBeat: end }));
    scale(audio, preGain * 10 ** (gainDb / 20));
    const base = safeName(marker.name);
    let file = base;
    for (let suffix = 2; used.has(file); suffix++) file = `${base}-${suffix}`;
    used.add(file);
    const wav = join(directory, `${file}.wav`);
    writeFileSync(wav, loopWav24(audio.left, audio.right, audio.sampleRate));
    encodeOgg(wav, join(directory, `${file}.ogg`));
    sectionReports.push({ name: marker.name, bar: marker.time / beatsPerBar + 1, bars: (end - marker.time) / beatsPerBar, seconds: audio.loopSeconds, file: `sections/${file}.ogg` });
  }
}
const performance = perform(piece);
const barSeconds = Array.from({ length: Math.floor(piece.length / beatsPerBar) + 1 }, (_, bar) => performance.secondsAt(bar * beatsPerBar));

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
  file: `${name}.ogg`,
  barSeconds,
  ...(sections ? { sections: sectionReports } : {}),
  tempo: piece.transport.tempo,
  meter: `${piece.transport.numerator}/${piece.transport.denominator}`,
  bars: piece.length / beatsPerBar,
  ...(oneShot ? { oneShot: true, seconds: loop.left.length / loop.sampleRate } : { loopSeconds: Math.round(loop.loopSeconds * 1000) / 1000 }),
  notes: notes.length,
  tracks: byTrack,
  loudness: {
    target: targetArg in TARGETS ? targetArg : 'custom',
    targetLufs: TARGET_LUFS,
    ceilingDbtp: CEILING_DBTP,
    integratedLufs: integrated,
    loudnessRangeLu: range,
    truePeakDbfs: truePeak,
  },
  measures: measureLoop(loop.left, loop.right, loop.sampleRate),
  stems: {
    files: stemFiles,
    // Residual energy of (mix − sum of stems) against the mix, dB; null is an exact null.
    nullResidualDb: Number.isFinite(residual) ? residual : null,
  },
  ...(oneShot ? {} : { seamRatio: Math.round(seamRatio(loop) * 1000) / 1000 }),
  problems,
};
writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${out}`);
