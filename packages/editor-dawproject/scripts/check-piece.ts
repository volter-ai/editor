/**
 * `tsx check-piece.ts <piece.tsx>` — the structural checks of `src/checks.ts` on one piece, as it
 * mounts, without rendering audio: prints a summary and every problem, and exits non-zero when
 * there is any. `render-piece` runs the same checks into its report. Run from the project folder:
 * the sound banks the piece's devices name are read from there, so every note is checked against
 * the samples that play it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { pathToFileURL } from 'node:url';
import { readPiece } from '@volter/dawproject/piece';
import { createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';
import { checkPiece } from '../src/checks';

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
process.exit(problems.length > 0 ? 1 : 0);
