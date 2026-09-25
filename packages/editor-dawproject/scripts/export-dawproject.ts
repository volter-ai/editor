/**
 * `export-dawproject <piece.tsx> <out.dawproject>` — a piece as a DAWproject file for Bitwig,
 * Studio One, Cubase and the rest (`src/interchange/dawproject-export.ts`). Run with `tsx` from
 * the piece's project, so its JSX compiles.
 */

import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pieceToDawproject } from '../src/interchange/dawproject-export';
import { componentNameOf } from '../src/interchange/midi-import';
import { loadPiece } from './load-piece';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: export-dawproject <piece.tsx> <out.dawproject>');
  process.exit(2);
}
const piece = await loadPiece(resolve(input));
const title = componentNameOf(basename(input)).replace(/([a-z])([A-Z])/g, '$1 $2');
writeFileSync(resolve(output), pieceToDawproject(piece, { title }));
console.log(`Wrote ${resolve(output)}`);
