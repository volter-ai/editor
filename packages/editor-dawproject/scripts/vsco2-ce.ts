/**
 * `vsco2-ce [cache dir]` — VS Chamber Orchestra 2 Community Edition (CC0, Versilian Studios) as
 * SoundFont banks, one per instrument (`banks/vsco2-ce.json`), built into a machine-wide cache
 * (default `~/.volter/banks/vsco2-ce`): the SFZ files and just the samples the conversion reads
 * are fetched from the library's repository (skipping what is already there), then every bank is
 * built at one headroom. A project reaches them through a link:
 * `ln -sfn ~/.volter/banks/vsco2-ce/vsco2 sounds/vsco2`, and a track names
 * `params={{ bank: 'sounds/vsco2/violins.sf2', program: 48 }}`. Run under `tsx`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sfzBank, sfzHeadroom, sfzSamples } from '../src/sfz-bank';
import { readWav } from '../src/wav';

const REPOSITORY = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE';
const cache = resolve(process.argv[2] ?? join(homedir(), '.volter', 'banks', 'vsco2-ce'));
const library = join(cache, 'library');
const table = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'banks', 'vsco2-ce.json'), 'utf8')) as {
  banks: { bank: string; patches: { name: string; program: number; sfz: string; bankNumber?: number }[] }[];
};

async function fetchTo(url: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, new Uint8Array(await response.arrayBuffer()));
  renameSync(`${file}.part`, file);
}

// The SFZ files, then every sample they read, eight at a time.
const sfzFiles = table.banks.flatMap((bank) => bank.patches.map((patch) => patch.sfz));
await Promise.all(sfzFiles.map((file) => fetchTo(`${REPOSITORY}/SFZ/${encodeURIComponent(file)}`, join(library, 'sfz', file))));
const samples = [...new Set(sfzFiles.flatMap((file) => sfzSamples(readFileSync(join(library, 'sfz', file), 'utf8'))))];
let fetched = 0;
for (let i = 0; i < samples.length; i += 8) {
  await Promise.all(
    samples.slice(i, i + 8).map((path) => fetchTo(`${REPOSITORY}/master/${path.split('/').map(encodeURIComponent).join('/')}`, join(library, path))),
  );
  fetched = Math.min(samples.length, i + 8);
  if (fetched % 200 < 8) console.log(`samples: ${fetched} of ${samples.length}`);
}

const patchesOf = (bank: (typeof table.banks)[number]) =>
  bank.patches.map((patch) => ({
    ...patch,
    sfz: readFileSync(join(library, 'sfz', patch.sfz), 'utf8'),
    sample: (path: string) => readWav(new Uint8Array(readFileSync(join(library, path)))),
  }));
const headroom = Math.max(...table.banks.map((bank) => sfzHeadroom(patchesOf(bank))));
for (const bank of table.banks) {
  const out = join(cache, bank.bank);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, new Uint8Array(sfzBank(patchesOf(bank), headroom)));
  console.log(`${bank.bank}: ${bank.patches.map((patch) => `${patch.name} (${patch.program})`).join(', ')}`);
}
console.log(`Built ${table.banks.length} banks in ${cache} (headroom ${headroom.toFixed(1)} dB).`);
