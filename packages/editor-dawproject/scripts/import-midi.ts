/**
 * `import-midi <in.mid> <out piece.tsx> [--bank sounds/MuseScore_General.sf3]` — a Standard MIDI
 * File as a piece's source: literal `<Note>`s in written units, tempo and controller lanes,
 * markers (`src/interchange/midi-import.ts`). Run with `tsx` from a checkout.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { componentNameOf, importMidi } from '../src/interchange/midi-import';

const args = process.argv.slice(2);
const bankIndex = args.indexOf('--bank');
const bank = bankIndex >= 0 ? args.splice(bankIndex, 2)[1] : 'sounds/MuseScore_General.sf3';
const [input, output] = args;
if (!input || !output || !bank) {
  console.error('Usage: import-midi <in.mid> <out piece.tsx> [--bank <project-relative sound bank>]');
  process.exit(2);
}
const bytes = readFileSync(resolve(input));
const source = importMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
  source: basename(input),
  bank,
  componentName: componentNameOf(basename(output)),
});
writeFileSync(resolve(output), source);
console.log(`Wrote ${resolve(output)}`);
