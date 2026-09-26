/** tsx view-piece.ts <piece.tsx> [--bars 5-8] [--step 0.5] */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatAt, formatPitch } from '@volter/dawproject/notation';
import { literalNotes, noteMultiset, parseSource } from '../src/source-notes';
import { loadPiece } from './load-piece';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { bars: { type: 'string' }, step: { type: 'string' } } });
  if (positionals.length !== 1) throw new Error('Usage: view-piece <piece.tsx> [--bars 5-8] [--step 0.5].');
  const path = resolve(positionals[0]!);
  const piece = await loadPiece(path);
  const meter = piece.transport.beatsPerBar;
  const take = noteMultiset(literalNotes(parseSource(await readFile(path, 'utf8'), path), meter));
  const tracks = piece.tracks.map((track) => ({ name: track.name, notes: track.clips.flatMap((clip) => clip.notes).map((note) => ({ ...note, generated: !take(note) })) })).filter((track) => track.notes.length);
  const step = Number(values.step ?? 0.5);
  if (!Number.isFinite(step) || step <= 0) throw new Error('Step must be a finite positive number.');
  const range = values.bars === undefined ? [1, Math.ceil(piece.length / meter)] : /^(\d+)-(\d+)$/.exec(values.bars)?.slice(1).map(Number);
  if (!range || !range[0] || !range[1] || range[1] < range[0]) throw new Error('Bars must be a positive inclusive range such as 5-8.');
  console.log(['bar:beat', ...tracks.map((track) => track.name)].join('\t'));
  const start = (range[0] - 1) * meter;
  const end = range[1] * meter;
  for (let i = 0; start + i * step < end - 1e-9; i++) {
    const beat = start + i * step;
    const cells = tracks.map((track) => track.notes.filter((note) => note.start <= beat + 1e-9 && note.start + note.duration > beat + 1e-9)
      .sort((a, b) => a.pitch - b.pitch || a.start - b.start)
      .map((note) => `${Math.abs(note.start - beat) < 1e-9 ? formatPitch(note.pitch) : '|'}${note.generated ? '~' : ''}`).join('+') || '.');
    console.log([formatAt(beat, meter), ...cells].join('\t'));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
