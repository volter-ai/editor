/** tsx freeze-clip.ts <piece.tsx> --track <name> --clip <n> [--out <path>] */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { freezeClip, unusedNames } from '../src/freeze-clip';
import { loadPieceGraph } from './load-piece';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { track: { type: 'string' }, clip: { type: 'string' }, out: { type: 'string' } } });
  if (positionals.length !== 1 || !values.track || !values.clip) throw new Error('Usage: freeze-clip <piece.tsx> --track <name> --clip <n> [--out <path>].');
  const index = Number(values.clip);
  if (!Number.isSafeInteger(index) || index < 1) throw new Error('Clip must be a positive 1-based integer.');
  const path = resolve(positionals[0]!);
  const source = await readFile(path, 'utf8');
  const frozen = freezeClip(source, await loadPieceGraph(path), values.track, index);
  const before = unusedNames(source);
  const unused = [...unusedNames(frozen)].filter((name) => !before.has(name));
  await writeFile(resolve(values.out ?? path), frozen);
  if (unused.length) console.error(`now unused: ${unused.join(', ')}`);
} catch (error) {
  console.error((error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' '));
  process.exitCode = 1;
}
