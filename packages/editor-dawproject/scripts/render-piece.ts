/**
 * `render-piece <project> <piece> [out] [--out <dir>] [--target console|portable|<LUFS>] [--sections | --one-shot]` — render one piece to
 * a seamless loop and measure it, for the composing agent, which cannot hear: the numbers in
 * `report.json` are what it reads.
 *
 *   <out>/<name>.wav          24-bit loop (second pass of two, tail wrapped), with a `smpl`
 *                             chunk declaring the whole file one forward loop
 *   <out>/<name>.ogg          the same loop, Vorbis
 *   <out>/<name>.mid          the piece as a Standard MIDI File (one pass)
 *   <out>/sections/<section>.wav / .ogg  with --sections: marker sections, at the full mix gain
 *   <out>/stems/<track>.ogg   Vorbis stems, at the same gain as their WAVs
 *   <out>/stems/<track>.wav   each audible track rendered alone, at the mix's own gain, so the
 *                             stems sum back to the mix (`stems.nullResidualDb` says how nearly)
 *   <out>/report.json         loudness against the target (EBU R128 via ffmpeg), true peak, the
 *                             loop seam, crest factor, spectral centroid, band split, stereo
 *                             width, and the structural checks of `src/checks.ts`
 *
 * --one-shot keeps one pass plus a 4 s tail, fades the last 10 ms, and writes plain WAV/OGG
 * (no smpl loop chunk); it cannot be combined with --sections. --out overrides positional out.
 * report.json includes the mix and stem OGG paths, barSeconds, and optional section metadata.
 *
 * LOUDNESS TARGET: `console` is −24 LUFS, `portable` −18 LUFS (Sony ASWG-R001's two figures);
 * a number is LUFS. The default is `portable`. The true peak never exceeds −1 dBTP; when the
 * ceiling wins, the report says the target was not met.
 *
 * Run with `tsx` from a checkout; the piece is mounted with `@volter/dawproject`'s own renderer,
 * so what is measured is exactly what the editor shows.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { renderPiece } from '../src/render-piece';

const TARGETS: Record<string, number> = { console: -24, portable: -18 };
const positional: string[] = [];
let targetArg = 'portable';
let sections = false;
let oneShot = false;
let outFlag: string | undefined;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i] ?? '';
  if (arg === '--target') targetArg = argv[++i] ?? '';
  else if (arg.startsWith('--target=')) targetArg = arg.slice('--target='.length);
  else if (arg === '--sections') sections = true;
  else if (arg === '--one-shot') oneShot = true;
  else if (arg === '--out') outFlag = argv[++i];
  else if (arg.startsWith('--out=')) outFlag = arg.slice('--out='.length);
  else positional.push(arg);
}
if (oneShot && sections) {
  console.error('--one-shot and --sections cannot be used together.');
  process.exit(2);
}
const [projectArg, pieceArg, outArg] = positional;
const TARGET_LUFS = TARGETS[targetArg] ?? Number(targetArg);
if (!projectArg || !pieceArg || targetArg === '' || !Number.isFinite(TARGET_LUFS)) {
  console.error('Usage: render-piece <project dir> <piece path, project-relative> [out dir] [--out <dir>] [--target console|portable|<LUFS>] [--sections | --one-shot]');
  process.exit(2);
}
const project = resolve(projectArg);
const piecePath = resolve(project, pieceArg);
const name = basename(piecePath).replace(/\.[cm]?[jt]sx?$/, '');
const out = resolve(project, outFlag ?? outArg ?? join('out', name));

const { files, report } = await renderPiece({
  projectRoot: project, piecePath: pieceArg,
  target: targetArg === 'console' || targetArg === 'portable' ? targetArg : TARGET_LUFS,
  sections, oneShot,
});
mkdirSync(out, { recursive: true });
rmSync(join(out, 'stems'), { recursive: true, force: true });
mkdirSync(join(out, 'stems'), { recursive: true });
if (sections) {
  rmSync(join(out, 'sections'), { recursive: true, force: true });
  mkdirSync(join(out, 'sections'), { recursive: true });
}
for (const file of files) {
  const destination = join(out, file.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, file.bytes);
}
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${out}`);
