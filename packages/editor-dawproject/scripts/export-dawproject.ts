/**
 * `export-dawproject <piece.tsx> <out.dawproject>` — a piece as a DAWproject file for Bitwig,
 * Studio One, Cubase and the rest (`src/interchange/dawproject-export.ts`). Run with `tsx` from
 * the piece's project, so its JSX compiles.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pieceToDawproject } from '../src/interchange/dawproject-export';
import { componentNameOf } from '../src/interchange/midi-import';
import { everyClip } from '../src/launches';
import type { DecodedAudio } from '../src/render-offline';
import { readWav } from '../src/wav';
import { loadPiece } from './load-piece';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: export-dawproject <piece.tsx> <out.dawproject>');
  process.exit(2);
}
const piece = await loadPiece(resolve(input));
const title = componentNameOf(basename(input)).replace(/([a-z])([A-Z])/g, '$1 $2');
// A clip's recording is a path from the project root, where this runs.
const project = process.cwd();
const audio = new Map<string, DecodedAudio>();
for (const clip of piece.tracks.flatMap((track) => everyClip(piece, track))) {
  if (!clip.audio || audio.has(clip.audio.file)) continue;
  const wav = readWav(new Uint8Array(readFileSync(resolve(project, clip.audio.file))));
  audio.set(clip.audio.file, { channels: wav.channels, sampleRate: wav.sampleRate });
}
writeFileSync(resolve(output), pieceToDawproject(piece, { title, audio }));
console.log(`Wrote ${resolve(output)}`);
