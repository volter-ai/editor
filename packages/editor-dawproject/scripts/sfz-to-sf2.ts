/**
 * `sfz-to-sf2 <out.sf2> <library dir> <name:program:file.sfz>...` — build a SoundFont bank from SFZ
 * instruments (`src/sfz-bank.ts`), one preset per SFZ file at the program number given, so a
 * sampled library plays through the same engine in the editor and the export. Run under `tsx`.
 *
 *   npx tsx scripts/sfz-to-sf2.ts sounds/vsco2.sf2 ~/.volter/samples/vsco2-ce \
 *     "Violins:40:sfz/ViolinEnsSusVib.sfz" "Flute:73:sfz/FluteSusVib.sfz"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sfzBank } from '../src/sfz-bank';
import { readWav } from '../src/wav';

const [outArg, libraryArg, ...specs] = process.argv.slice(2);
if (!outArg || !libraryArg || specs.length === 0) {
  console.error('Usage: sfz-to-sf2 <out.sf2> <library dir> <name:program:file.sfz>...');
  process.exit(2);
}
const library = resolve(libraryArg);
const patches = specs.map((spec) => {
  const [name, program, file] = spec.split(':');
  if (!name || !file || !Number.isInteger(Number(program))) throw new Error(`${spec}: expected name:program:file.sfz`);
  return {
    name,
    program: Number(program),
    sfz: readFileSync(join(library, file), 'utf8'),
    sample: (path: string) => readWav(new Uint8Array(readFileSync(join(library, path)))),
  };
});
const bytes = sfzBank(patches);
writeFileSync(resolve(outArg), new Uint8Array(bytes));
console.log(`Wrote ${outArg}: ${patches.map((patch) => `${patch.name} (program ${patch.program})`).join(', ')}, ${(bytes.byteLength / 1e6).toFixed(1)} MB`);
