/**
 * `tsx check-piece.ts <piece.tsx>` — the structural checks of `src/checks.ts` on one piece, as it
 * mounts, without rendering audio: prints a summary and every problem, and exits non-zero when
 * there is any. `render-piece` runs the same checks into its report.
 */

import { resolve } from 'node:path';
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

const { problems, parallels } = checkPiece(piece);
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
