import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { perform } from '@volter/dawproject/perform';
import { readPiece } from '@volter/dawproject/piece';
import { createPieceRoot } from '@volter/dawproject/render';
import type { ComponentType } from 'react';
import { checkPiece } from './checks';
import { SoundBankLoader } from 'spessasynth_core';
import { measureLoop, nullResidualDb } from './measure';
import { assignChannels, audibleTracks, mixLoop, mixOneShot, pieceToMidi, type RenderedLoop, renderChannels, seamRatio } from './render-offline';
import type { DynamicsReport, ImpulseResponse } from './mix/offline-mix';
import { loopWav24, wav24, readWav } from './wav';

const TARGETS: Record<string, number> = { console: -24, portable: -18 };

export interface RenderPieceOptions {
  projectRoot: string;
  piecePath: string;
  loadModule?: (absolutePath: string) => Promise<unknown>;
  target?: 'console' | 'portable' | number;
  sections?: boolean;
  oneShot?: boolean;
}

export interface RenderedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

const MEDIA_TYPES: Record<string, string> = { wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mid: 'audio/midi', json: 'application/json' };

/** Every file under a render folder, by its path in it. */
function renderedFiles(directory: string, prefix = ''): RenderedFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    return entry.isDirectory()
      ? renderedFiles(join(directory, entry.name), `${path}/`)
      : [{ path, bytes: readFileSync(join(directory, entry.name)), mediaType: MEDIA_TYPES[path.split('.').pop()!]! }];
  });
}

/**
 * `renderPiece` in its own Node process: this package's `render-piece` CLI under `tsx`, with the
 * project's tsconfig (a piece compiles with the project's JSX runtime), into a temporary folder
 * read back and removed. A render is seconds to minutes of synthesis and mixing on one thread;
 * inside the editor's session process it stalled everything the session serves, the
 * workbench's own connection included (it timed out during a 52 s render). `signal` stops it.
 */
export async function renderPieceInChildProcess(
  options: Omit<RenderPieceOptions, 'loadModule'> & { readonly signal?: AbortSignal },
): Promise<{ files: RenderedFile[]; report: Record<string, unknown> }> {
  const project = resolve(options.projectRoot);
  const fromProject = createRequire(join(project, 'package.json'));
  const tsxDir = dirname(fromProject.resolve('tsx/package.json'));
  const tsxBin = (JSON.parse(readFileSync(join(tsxDir, 'package.json'), 'utf8')) as { bin: string | Record<string, string> }).bin;
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'render-piece.ts');
  const out = mkdtempSync(join(tmpdir(), 'render-piece-'));
  try {
    const target = options.target ?? 'portable';
    const args = [
      join(tsxDir, typeof tsxBin === 'string' ? tsxBin : (tsxBin['tsx'] ?? Object.values(tsxBin)[0]!)),
      '--tsconfig', join(project, 'tsconfig.json'),
      cli, project, options.piecePath, '--out', out, '--target', String(target),
      ...(options.sections ? ['--sections'] : []),
      ...(options.oneShot ? ['--one-shot'] : []),
    ];
    await new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, args, { cwd: project, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      const abort = (): void => {
        child.kill();
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      child.once('error', fail);
      child.once('close', (code, signal) => {
        options.signal?.removeEventListener('abort', abort);
        if (code === 0) done();
        else fail(new Error(options.signal?.aborted ? 'The render was cancelled.' : `The render failed (${signal ?? `exit ${code}`}): ${stderr.trim()}`));
      });
    });
    const files = renderedFiles(out);
    const report = JSON.parse(Buffer.from(files.find((file) => file.path === 'report.json')!.bytes).toString('utf8')) as Record<string, unknown>;
    return { files, report };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** Render a complete output batch without writing into the project. */
export async function renderPiece({
  projectRoot, piecePath: pieceArg, loadModule = (path) => import(pathToFileURL(path).href),
  target = 'portable', sections = false, oneShot = false,
}: RenderPieceOptions): Promise<{
  files: { path: string; bytes: Uint8Array; mediaType: string }[];
  report: object;
}> {
  if (oneShot && sections) throw new Error('--one-shot and --sections cannot be used together.');
  const targetArg = String(target);
  const TARGET_LUFS = TARGETS[targetArg] ?? Number(targetArg);
  if (targetArg === '' || !Number.isFinite(TARGET_LUFS)) throw new Error('Invalid loudness target.');
  const project = resolve(projectRoot);
  const piecePath = resolve(project, pieceArg);
  const name = basename(piecePath).replace(/\.[cm]?[jt]sx?$/, '');
  const out = mkdtempSync(join(tmpdir(), 'render-piece-'));
  try {
    const module = (await loadModule(piecePath)) as { default?: ComponentType };
    if (typeof module.default !== 'function') throw new Error(`${pieceArg} has no default export component.`);
    const root = createPieceRoot((error) => {
      throw error;
    });
    const graph = await root.render(module.default);
    const piece = readPiece(graph);
    root.unmount();

    const beatsPerBar = piece.transport.beatsPerBar;
    const assignments = assignChannels(piece);
    if (assignments.size === 0) throw new Error('No track has a soundfont device; there is nothing to render.');
    // Every bank a soundfont device names, read from the project.
    const bank = new Map<string, ArrayBuffer>();
    for (const { bank: path } of assignments.values()) {
      if (bank.has(path)) continue;
      const bytes = readFileSync(resolve(project, path));
      bank.set(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    // The checks, with every note tested against the samples its bank has.
    const problems: string[] = [...checkPiece(piece, new Map([...bank].map(([path, bytes]) => [path, SoundBankLoader.fromArrayBuffer(bytes)]))).problems];
    // Impulse responses the piece's convolution devices name, read from the project.
    const irs = new Map<string, ImpulseResponse>();
    for (const track of piece.tracks) {
      for (const device of track.channel?.devices ?? []) {
        const path = device.plugin === 'convolution' ? device.params['ir'] : undefined;
        if (typeof path !== 'string' || irs.has(path)) continue;
        const wav = readWav(new Uint8Array(readFileSync(resolve(project, path))));
        irs.set(path, { channels: wav.channels, sampleRate: wav.sampleRate });
      }
    }
    const rendered = await renderChannels(piece, bank, undefined, undefined, irs, oneShot ? 1 : 2);
    const mixRender = oneShot ? mixOneShot : mixLoop;
    const writeWav = oneShot ? wav24 : loopWav24;
    // What the mix's compressors and limiters did, for a composer who cannot hear them.
    const dynamics: DynamicsReport[] = [];
    const loop = mixRender(rendered, undefined, (report) => dynamics.push(report));
    for (const stage of dynamics) {
      if (stage.device === 'compressor' && stage.maxReductionDb < 0.1) {
        problems.push(
          `${stage.track}: the compressor never acts: its threshold is ${stage.threshold} dB and the loudest peak it hears is ${stage.maxInputDb?.toFixed(1)} dB. Lower the threshold, or take the device out.`,
        );
      }
    }
    // Each audible track alone, through the same render: the same channels, the same performance.
    const stems: { track: string; loop: RenderedLoop }[] = [];
    for (const track of audibleTracks(piece)) {
      stems.push({ track: track.name, loop: mixRender(rendered, new Set([track.id])) });
    }

    mkdirSync(out, { recursive: true });
    const wavPath = join(out, `${name}.wav`);
    const stemsDir = join(out, 'stems');
    rmSync(stemsDir, { recursive: true, force: true });
    mkdirSync(stemsDir, { recursive: true });

    /** ffmpeg's EBU R128 summary for a WAV: integrated loudness, loudness range, true peak. */
    function measure(path: string): { integrated: number; range: number; truePeak: number } {
      const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
      const text = run.stderr ?? '';
      const summary = text.slice(text.lastIndexOf('Summary:'));
      return {
        integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? Number.NaN),
        range: Number(/LRA:\s+(-?[\d.]+) LU/.exec(summary)?.[1] ?? Number.NaN),
        truePeak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1] ?? Number.NaN),
      };
    }

    function scale(target: RenderedLoop, gain: number): void {
      for (const channel of [target.left, target.right]) for (let i = 0; i < channel.length; i++) channel[i] = (channel[i] ?? 0) * gain;
    }

    // GAIN STAGING. The synth's summed output runs hot and the WAV clamps at full scale, so the loop
    // is first taken down (18 dB, or further if its sample peak needs it), measured, then set to the
    // loudness target; if that would put the true peak above the ceiling, the ceiling wins and the
    // report says the target was not met. Every stem gets exactly the mix's gain: nothing is
    // re-normalised, so the stems sum back to the mix.
    const CEILING_DBTP = -1;
    let samplePeak = 0;
    for (const channel of [loop.left, loop.right]) for (const sample of channel) samplePeak = Math.max(samplePeak, Math.abs(sample));
    const preGain = Math.min(10 ** (-18 / 20), 0.9 / Math.max(samplePeak, 1e-9));
    scale(loop, preGain);
    writeFileSync(wavPath, writeWav(loop.left, loop.right, loop.sampleRate));
    const first = measure(wavPath);
    const gainDb = Math.min(TARGET_LUFS - first.integrated, CEILING_DBTP - first.truePeak);
    scale(loop, 10 ** (gainDb / 20));
    writeFileSync(wavPath, writeWav(loop.left, loop.right, loop.sampleRate));
    /**
     * A WAV as the two delivery formats: Ogg Vorbis, and AAC in an `.m4a` for the players that
     * cannot decode Vorbis (Safari on iOS before 17.4). Bitexact: the Ogg muxer otherwise draws a
     * random stream serial per run, and both muxers stamp the encoder's version, so the same
     * render gave a different file (and a new provenance digest) every time.
     */
    function encode(wav: string, base: string): void {
      const exact = ['-fflags', '+bitexact', '-flags:a', '+bitexact'];
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...exact, '-c:a', 'vorbis', '-strict', '-2', '-b:a', '224k', `${base}.ogg`]);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...exact, '-c:a', 'aac', '-b:a', '192k', `${base}.m4a`]);
    }
    const safeName = (value: string): string => value.replace(/[/\\:*?"<>|]/g, '-') || 'unnamed';
    /** A file name not yet used in its folder: `name`, else `name-2`, `name-3`, … */
    const uniqueName = (used: Set<string>, value: string): string => {
      const base = safeName(value);
      let file = base;
      for (let suffix = 2; used.has(file.toLowerCase()); suffix++) file = `${base}-${suffix}`;
      used.add(file.toLowerCase());
      return file;
    };
    const stemFiles: { track: string; file: string; fileM4a: string }[] = [];
    const stemNames = new Set<string>();
    for (const stem of stems) {
      scale(stem.loop, preGain * 10 ** (gainDb / 20));
      const file = uniqueName(stemNames, stem.track);
      writeFileSync(join(stemsDir, `${file}.wav`), writeWav(stem.loop.left, stem.loop.right, stem.loop.sampleRate));
      encode(join(stemsDir, `${file}.wav`), join(stemsDir, file));
      stemFiles.push({ track: stem.track, file: `stems/${file}.ogg`, fileM4a: `stems/${file}.m4a` });
    }
    const residual = nullResidualDb(
      [loop.left, loop.right],
      stems.map((stem) => [stem.loop.left, stem.loop.right]),
    );
    writeFileSync(join(out, `${name}.mid`), new Uint8Array(pieceToMidi(piece, 1).writeMIDI()));
    encode(wavPath, join(out, name));

    const performance = perform(piece);
    const sectionReports: { name: string; bar: number; bars: number; start: number; seconds: number; file: string; fileM4a: string }[] = [];
    if (sections) {
      const directory = join(out, 'sections');
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      const markers = [...piece.markers].sort((a, b) => a.time - b.time);
      const used = new Set<string>();
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i]!;
        // A marker that starts no stretch of music makes no section: one at or past the end, or
        // one on the same beat as the marker before it (that one's section starts there).
        if (marker.time >= piece.length) {
          problems.push(`Marker "${marker.name}" is at or past the piece's end (bar ${marker.time / beatsPerBar + 1}); it makes no section.`);
          continue;
        }
        const before = markers[i - 1];
        if (before && before.time === marker.time) {
          problems.push(`Marker "${marker.name}" is on the same beat as "${before.name}" (bar ${marker.time / beatsPerBar + 1}); it makes no section.`);
          continue;
        }
        // A section ends at the next marker with a later beat.
        const end = Math.min(piece.length, markers.slice(i + 1).find((next) => next.time > marker.time)?.time ?? piece.length);
        // The section is that stretch of the whole piece's performance, looped on itself.
        const audio = mixLoop(await renderChannels(piece, bank, undefined, undefined, irs, 2, { fromBeat: marker.time, toBeat: end }));
        scale(audio, preGain * 10 ** (gainDb / 20));
        const file = uniqueName(used, marker.name);
        const wav = join(directory, `${file}.wav`);
        writeFileSync(wav, loopWav24(audio.left, audio.right, audio.sampleRate));
        encode(wav, join(directory, file));
        sectionReports.push({
          name: marker.name, bar: marker.time / beatsPerBar + 1, bars: (end - marker.time) / beatsPerBar,
          start: performance.secondsAt(marker.time), seconds: audio.loopSeconds,
          file: `sections/${file}.ogg`, fileM4a: `sections/${file}.m4a`,
        });
      }
    }
    const barSeconds = Array.from({ length: Math.floor(piece.length / beatsPerBar) + 1 }, (_, bar) => performance.secondsAt(bar * beatsPerBar));

    const { integrated, range, truePeak } = measure(wavPath);
    if (Math.abs(integrated - TARGET_LUFS) > 1) {
      problems.push(`Loudness is ${integrated} LUFS against a ${TARGET_LUFS} LUFS target: the ${CEILING_DBTP} dBTP ceiling limited the gain (the mix has a peak far above its average).`);
    }

    const notes = piece.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.notes.map((note) => ({ track: track.name, note }))));
    const byTrack = Object.fromEntries(
      piece.tracks.map((track) => {
        const own = track.clips.flatMap((clip) => clip.notes);
        const pitches = own.map((note) => note.pitch);
        return [
          track.name,
          {
            notes: own.length,
            lowest: pitches.length ? Math.min(...pitches) : null,
            highest: pitches.length ? Math.max(...pitches) : null,
            pitchClasses: new Set(pitches.map((pitch) => pitch % 12)).size,
          },
        ];
      }),
    );

    const report = {
      piece: pieceArg,
      file: `${name}.ogg`,
      fileM4a: `${name}.m4a`,
      barSeconds,
      ...(sections ? { sections: sectionReports } : {}),
      tempo: piece.transport.tempo,
      meter: `${piece.transport.numerator}/${piece.transport.denominator}`,
      bars: piece.length / beatsPerBar,
      ...(oneShot ? { oneShot: true, seconds: loop.left.length / loop.sampleRate } : { loopSeconds: Math.round(loop.loopSeconds * 1000) / 1000 }),
      notes: notes.length,
      tracks: byTrack,
      loudness: {
        target: targetArg in TARGETS ? targetArg : 'custom',
        targetLufs: TARGET_LUFS,
        ceilingDbtp: CEILING_DBTP,
        integratedLufs: integrated,
        loudnessRangeLu: range,
        truePeakDbfs: truePeak,
      },
      measures: measureLoop(loop.left, loop.right, loop.sampleRate),
      dynamics: dynamics.map((stage) => ({
    ...stage,
    maxReductionDb: Math.round(stage.maxReductionDb * 10) / 10,
    ...(stage.maxInputDb === undefined ? {} : { maxInputDb: Math.round(stage.maxInputDb * 10) / 10 }),
  })),
  stems: {
        files: stemFiles,
        // Residual energy of (mix − sum of stems) against the mix, dB; null is an exact null.
        nullResidualDb: Number.isFinite(residual) ? residual : null,
      },
      ...(oneShot ? {} : { seamRatio: Math.round(seamRatio(loop) * 1000) / 1000 }),
      problems,
    };
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

    return { files: renderedFiles(out), report };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
