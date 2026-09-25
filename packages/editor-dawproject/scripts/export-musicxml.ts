/**
 * `export-musicxml <piece.tsx> <out.musicxml>` — a piece's written layer as a MusicXML 4.0 score
 * (`src/interchange/musicxml.ts`). Run with `tsx` from the piece's project, so its JSX compiles.
 */

import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { componentNameOf } from '../src/interchange/midi-import';
import { pieceToMusicXml } from '../src/interchange/musicxml';
import { loadPiece } from './load-piece';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: export-musicxml <piece.tsx> <out.musicxml>');
  process.exit(2);
}
const piece = await loadPiece(resolve(input));
const title = componentNameOf(basename(input)).replace(/([a-z])([A-Z])/g, '$1 $2');
writeFileSync(resolve(output), pieceToMusicXml(piece, { title }));
console.log(`Wrote ${resolve(output)}`);
