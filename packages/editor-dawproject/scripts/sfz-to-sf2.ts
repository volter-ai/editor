/**
 * Build SoundFont banks from SFZ instruments (`src/sfz-bank.ts`), one preset per SFZ file at the
 * program number given, so a sampled library plays through the same engine in the editor and the
 * export. Run under `tsx`.
 *
 *   sfz-to-sf2 <out.sf2> <library dir> <name:program:file.sfz>...     one bank
 *   sfz-to-sf2 --table <table.json> <library dir> <out dir>            every bank a table lists
 *
 * A table (`banks/vsco2-ce.json` is VSCO 2 Community Edition's) lists banks, each
 * `{ bank: "vsco2/violins.sf2", patches: [{ name, program, sfz, bankNumber? }] }`; one bank per
 * instrument keeps what a piece loads to the instruments it uses. SFZ files are read from
 * `<library dir>/sfz/`, samples from the paths the SFZ names under `<library dir>`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type SfzPatch, sfzBank, sfzHeadroom } from '../src/sfz-bank';
import { readWav } from '../src/wav';
import { oggenc } from './oggenc';

interface TableBank {
  readonly bank: string;
  readonly patches: readonly { readonly name: string; readonly program: number; readonly sfz: string; readonly bankNumber?: number }[];
}

function patchesIn(library: string, entries: TableBank['patches']): SfzPatch[] {
  return entries.map((entry) => ({
    name: entry.name,
    program: entry.program,
    ...(entry.bankNumber === undefined ? {} : { bankNumber: entry.bankNumber }),
    sfz: readFileSync(join(library, 'sfz', entry.sfz), 'utf8'),
    sample: (path: string) => readWav(new Uint8Array(readFileSync(join(library, path)))),
  }));
}

async function write(out: string, patches: readonly SfzPatch[], headroomDb?: number): Promise<void> {
  const bytes = await sfzBank(patches, headroomDb, out.endsWith('.sf3') ? oggenc : undefined);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, new Uint8Array(bytes));
  console.log(`Wrote ${out}: ${patches.map((patch) => `${patch.name} (${patch.program})`).join(', ')}, ${(bytes.byteLength / 1e6).toFixed(1)} MB`);
}

const args = process.argv.slice(2);
if (args[0] === '--table') {
  const [, tableArg, libraryArg, outArg] = args;
  if (!tableArg || !libraryArg || !outArg) {
    console.error('Usage: sfz-to-sf2 --table <table.json> <library dir> <out dir>');
    process.exit(2);
  }
  const table = JSON.parse(readFileSync(resolve(tableArg), 'utf8')) as { banks: TableBank[] };
  const library = resolve(libraryArg);
  // One headroom for the whole library, so instruments keep their balance across banks.
  const headroom = Math.max(...table.banks.map((bank) => sfzHeadroom(patchesIn(library, bank.patches))));
  console.log(`Library headroom: ${headroom.toFixed(1)} dB`);
  for (const bank of table.banks) await write(join(resolve(outArg), bank.bank), patchesIn(library, bank.patches), headroom);
} else {
  const [outArg, libraryArg, ...specs] = args;
  if (!outArg || !libraryArg || specs.length === 0) {
    console.error('Usage: sfz-to-sf2 <out.sf2> <library dir> <name:program:file.sfz>...  |  sfz-to-sf2 --table <table.json> <library dir> <out dir>');
    process.exit(2);
  }
  const entries = specs.map((spec) => {
    const [name, program, file] = spec.split(':');
    if (!name || !file || !Number.isInteger(Number(program))) throw new Error(`${spec}: expected name:program:file.sfz`);
    return { name, program: Number(program), sfz: file.replace(/^sfz\//, '') };
  });
  await write(resolve(outArg), patchesIn(resolve(libraryArg), entries));
}
