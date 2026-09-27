/**
 * AudioStreamWAV: small WAV files imported in official Godot (`AudioStreamWAV.load_from_buffer`
 * with the `wav` importer's options) and on the page (`godot_audio_stream_wav_import`), read back:
 * rate, channels, format and loop points after trimming, normalizing, loop modes and mono.
 */
import * as W from '../../capabilities/catalog/project-source/src/lib/godot-compat/audio-stream-wav';
import type { GodotEvidenceCaseFile } from '../../src/evidence/case';
import { resourceCases } from './resource-cases';
import { WAVS, wavBytes } from './wav-samples';

const c = resourceCases('AudioStreamWAV');

export interface WavOptions {
  readonly trim: boolean;
  readonly normalize: boolean;
  readonly loopMode: number;
  readonly loopBegin: number;
  readonly loopEnd: number;
  readonly forceMono: boolean;
  readonly compressMode: number;
}

export const OPTIONS: readonly (readonly [string, WavOptions])[] = [
  ['plain', { trim: false, normalize: false, loopMode: 0, loopBegin: 0, loopEnd: -1, forceMono: false, compressMode: 0 }],
  ['platformer', { trim: true, normalize: true, loopMode: 0, loopBegin: 0, loopEnd: -1, forceMono: false, compressMode: 2 }],
  ['loop', { trim: true, normalize: true, loopMode: 2, loopBegin: 0, loopEnd: -1, forceMono: false, compressMode: 2 }],
  ['pingpong', { trim: false, normalize: false, loopMode: 3, loopBegin: 100, loopEnd: -50, forceMono: true, compressMode: 1 }],
];

/** The GDScript loading `bytes` with `options` into `s`. */
export function nativeLoad(bytes: Uint8Array, options: WavOptions): string {
  const dict = `{"edit/trim": ${String(options.trim)}, "edit/normalize": ${String(options.normalize)}, "edit/loop_mode": ${String(options.loopMode)}, "edit/loop_begin": ${String(options.loopBegin)}, "edit/loop_end": ${String(options.loopEnd)}, "force/mono": ${String(options.forceMono)}, "compress/mode": ${String(options.compressMode)}}`;
  return `var s := AudioStreamWAV.load_from_buffer(PackedByteArray([${[...bytes].join(', ')}]), ${dict})`;
}

export function targetLoad(bytes: Uint8Array, options: WavOptions): W.AudioStreamWAV {
  const stream = W.godot_audio_stream_wav_new();
  W.godot_audio_stream_wav_import(stream, bytes, { ...options, force8Bit: false, forceMaxRate: false, maxRateHz: 44100 });
  return stream;
}

for (const spec of WAVS) {
  const bytes = wavBytes(spec);
  for (const [name, options] of OPTIONS) {
    for (const member of ['get_mix_rate', 'is_stereo', 'get_format', 'get_loop_mode', 'get_loop_begin', 'get_loop_end'] as const) {
      c.add(`${member}-${spec.name}-${name}`, member, [nativeLoad(bytes, options), `return s.${member}()`], () => W[member](targetLoad(bytes, options)));
    }
  }
}

const EVIDENCE: GodotEvidenceCaseFile = { godotClass: 'AudioStreamWAV', compatModule: 'lib/godot-compat/audio-stream-wav', cases: c.cases };
export default EVIDENCE;
