/**
 * `tsx check-piece.ts <piece.tsx>` — the structural checks of `src/checks.ts` on one piece, as it
 * mounts, without rendering audio: prints a summary and every problem, and exits non-zero when
 * there is any. `render-piece` runs the same checks into its report. Run from the project folder:
 * the sound banks the piece's devices name are read from there, so every note is checked against
 * the samples that play it.
 *
 * Then the analysis (`src/analysis.ts`): the key and chords of each section with their degrees,
 * the cadence it ends on and the one its loop returns through, low muddy intervals and crossing
 * parts, each melodic line's numbers, and how many of its melodic figures the other pieces in the
 * same folder already use. Those are information, never a failure.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { type BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { pathToFileURL } from 'node:url';
import { readPiece } from '@volter/dawproject/piece';
import { createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';
import { formatAt, formatPitch } from '@volter/dawproject/notation';
import { analyzePiece, chordName, keyName, romanNumeral } from '../src/analysis';
import { checkPiece } from '../src/checks';
import { loadPiece } from './load-piece';

const [pieceArg] = process.argv.slice(2);
if (!pieceArg) {
  console.error('Usage: check-piece <piece.tsx>');
  process.exit(2);
}
const module = (await import(pathToFileURL(resolve(pieceArg)).href)) as { default?: ComponentType };
if (typeof module.default !== 'function') throw new Error(`${pieceArg} has no default export component.`);
const root = createPieceRoot((error) => {
  throw error;
});
const piece = readPiece(await root.render(module.default));
root.unmount();

const banks = new Map<string, BasicSoundBank>();
for (const track of piece.tracks) {
  for (const device of track.channel?.devices ?? []) {
    const path = device.plugin === 'soundfont' ? device.params['bank'] : undefined;
    if (typeof path !== 'string' || banks.has(path)) continue;
    const file = resolve(path);
    if (!existsSync(file)) {
      console.error(`${track.name}: the bank ${path} is not in this project (run from the project folder).`);
      continue;
    }
    const bytes = readFileSync(file);
    banks.set(path, SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  }
}
const { problems, parallels } = checkPiece(piece, banks);
console.log(
  JSON.stringify(
    {
      piece: pieceArg,
      tempo: piece.transport.tempo,
      meter: `${piece.transport.numerator}/${piece.transport.denominator}`,
      bars: piece.length / piece.transport.beatsPerBar,
      tracks: piece.tracks.map((track) => ({ name: track.name, notes: track.clips.reduce((sum, clip) => sum + clip.notes.length, 0) })),
      parallels,
      problems: problems.length,
    },
    null,
    2,
  ),
);
for (const problem of problems) console.log(`- ${problem}`);

// The analysis, against the other pieces in the piece's folder.
const others = new Map<string, Awaited<ReturnType<typeof loadPiece>>>();
const folder = dirname(resolve(pieceArg));
for (const file of readdirSync(folder).filter((name) => name.endsWith('.tsx') && name !== basename(pieceArg)).sort()) {
  others.set(file, await loadPiece(join(folder, file)).catch(() => null as never));
}
for (const [name, other] of others) if (!other) others.delete(name);
const analysis = analyzePiece(piece, others);
const meter = piece.transport.beatsPerBar;
const at = (beat: number): string => `bar ${formatAt(beat, meter).replace(':', ' beat ')}`;
const percent = (share: number): string => `${Math.round(share * 100)}%`;
console.log(`\nKey: ${keyName(analysis.key)} (fit ${analysis.key.fit.toFixed(2)})`);
for (const section of analysis.sections) {
  const { key } = section;
  console.log(`\n${section.name}: ${keyName(key)} (fit ${key.fit.toFixed(2)}), bars ${section.span[0] / meter + 1}–${section.span[1] / meter}`);
  for (let i = 0; i < section.bars.length; i += 4) {
    console.log(`  ${section.bars.slice(i, i + 4).map(({ bar, chords }) => `${bar}: ${chords.map((chord) => `${chordName(chord, key)} ${romanNumeral(chord, key)}`).join(' | ')}`).join('    ')}`);
  }
  console.log(`  ends ${chordName(section.cadence.from, key)} → ${chordName(section.cadence.to, key)}: ${section.cadence.kind}; loops back ${chordName(section.seam.from, key)} → ${chordName(section.seam.to, key)}: ${section.seam.kind}`);
}
console.log('\nLines:');
for (const line of analysis.lines) {
  const leap = line.largestLeap ? `, largest leap ${line.largestLeap.semitones} at ${at(line.largestLeap.beat)}` : '';
  console.log(`  ${line.name}: ${line.notes} notes, ${formatPitch(line.low)}–${formatPitch(line.high)}; steps ${percent(line.steps)}, leaps ${percent(line.leaps)}${leap}; bars repeated ${percent(line.repeatedBars)}, sequenced ${percent(line.sequencedBars)}; figure variety ${line.variety.toFixed(2)}`);
}
const { lowCloseIntervals, crossings } = analysis.voicing;
console.log(`\nVoicing: ${lowCloseIntervals.length} close intervals below C3${lowCloseIntervals.length ? ` (first ${lowCloseIntervals.slice(0, 3).map((entry) => `${entry.parts} ${entry.pitches.map((pitch) => formatPitch(pitch)).join('+')} at ${at(entry.beat)}`).join('; ')})` : ''}`);
for (const crossing of crossings) console.log(`  ${crossing.lower} rises above ${crossing.upper} ${crossing.runs} times (first at ${at(crossing.first)})`);
if (analysis.novelty.length) console.log(`\nMelodic figures shared: ${analysis.novelty.map((entry) => `${percent(entry.shared)} with ${entry.piece}`).join(', ')}`);
process.exit(problems.length > 0 ? 1 : 0);
