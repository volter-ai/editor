/**
 * @godot-class AudioStreamWAV
 * @role BINDING
 *
 * Godot 4.7's `AudioStreamWAV` (`scene/resources/audio_stream_wav.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a Web Audio `AudioBuffer`. The `.wav`
 * file is copied beside the app and imported on the page as the `wav` importer imports it
 * (`AudioStreamWAV::load_from_buffer`, `audio_stream_wav.cpp:659`): PCM or IEEE-float samples to
 * floats, the rate limit, normalization, trimming with its fade-out, the loop mode, mono. The
 * stream's length, rate, channels, format and loop points are Godot's. Its samples are played as
 * they are before Godot's compression (`compress/mode` 1 IMA-ADPCM, 2 QOA): the compressed
 * encoding is not reproduced, so a compressed stream sounds as its source (a named deviation,
 * `audio-compression`); what is played is not compared.
 */

import { godot_audio_stream_register } from './audio-stream';
import { godot_resource_loader_track } from './resource-loader';

/** `TRIM_DB_LIMIT`, `TRIM_FADE_OUT_FRAMES` (`audio_stream_wav.cpp:37`). */
const TRIM_DB_LIMIT = -50;
const TRIM_FADE_OUT_FRAMES = 500;
/** `AudioStreamWAV::Format` (`audio_stream_wav.h:48`). */
const FORMAT_8_BITS = 0;
const FORMAT_16_BITS = 1;
const FORMAT_IMA_ADPCM = 2;
const FORMAT_QOA = 3;

const f32 = Math.fround;

/** The `wav` importer options (`resource_importer_wav.cpp:76`) the import applies. */
export interface GodotWavImport {
  readonly force8Bit: boolean;
  readonly forceMono: boolean;
  readonly forceMaxRate: boolean;
  readonly maxRateHz: number;
  readonly trim: boolean;
  readonly normalize: boolean;
  readonly loopMode: number;
  readonly loopBegin: number;
  readonly loopEnd: number;
  readonly compressMode: number;
}

export interface AudioStreamWAV {
  format: number;
  mixRate: number;
  stereo: boolean;
  loopMode: number;
  loopBegin: number;
  loopEnd: number;
  /** The samples, interleaved, as floats. */
  samples: Float32Array;
  buffer: AudioBuffer | null;
}

function frameCount(self: AudioStreamWAV): number {
  return self.samples.length / (self.stereo ? 2 : 1);
}

/**
 * A stream with no samples yet (`AudioStreamWAV.new()`): 8-bit, 44100 Hz, mono, no loop.
 *
 * @godot AudioStreamWAV (protocol)
 * @source scene/resources/audio_stream_wav.h:118
 */
export function godot_audio_stream_wav_new(): AudioStreamWAV {
  const stream: AudioStreamWAV = { format: FORMAT_8_BITS, mixRate: 44100, stereo: false, loopMode: 0, loopBegin: 0, loopEnd: 0, samples: new Float32Array(0), buffer: null };
  godot_audio_stream_register(stream, {
    // `get_length` (`audio_stream_wav.cpp:489`): the stored samples over the rate; IMA-ADPCM stores
    // each channel's samples two to a byte, padded to even, after a 4-byte header
    // (`_compress_ima_adpcm`, `audio_stream_wav.h:174`), and counts two samples per byte.
    length: () => {
      const frames = frameCount(stream);
      const stored = stream.format === FORMAT_IMA_ADPCM ? 2 * Math.ceil(frames / 2) + 8 : frames;
      return stored / stream.mixRate;
    },
    start: (audio) => {
      if (stream.buffer === null && frameCount(stream) > 0) {
        const channels = stream.stereo ? 2 : 1;
        const buffer = audio.createBuffer(channels, frameCount(stream), stream.mixRate);
        for (let c = 0; c < channels; c += 1) {
          const out = buffer.getChannelData(c);
          for (let i = 0; i < out.length; i += 1) out[i] = stream.samples[i * channels + c] as number;
        }
        stream.buffer = buffer;
      }
      const loop = stream.loopMode === 0 ? null : { begin: stream.loopBegin / stream.mixRate, end: stream.loopEnd / stream.mixRate };
      return { buffer: stream.buffer, loop, pitchScale: 1, volumeScale: 1 };
    },
  });
  return stream;
}

/** The chunks' samples as floats (`load_from_buffer`'s `fmt ` and `data` chunks). */
function readWav(bytes: Uint8Array): { channels: number; rate: number; bits: number; data: Float32Array; smplLoop: readonly [number, number, number] | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('godot-compat: not a WAV file');
  let at = 12;
  let code = 1;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: Float32Array | null = null;
  let smplLoop: [number, number, number] | null = null;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const start = at + 8;
    if (id === 'fmt ' && channels === 0) {
      code = view.getUint16(start, true);
      if (code !== 1 && code !== 3) throw new Error('godot-compat: a WAV file that is not PCM or IEEE float');
      channels = view.getUint16(start + 2, true);
      rate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    }
    if (id === 'data' && data === null) {
      const available = Math.min(size, bytes.length - start);
      const frames = Math.trunc(Math.trunc(available / channels) / (bits >> 3));
      data = new Float32Array(frames * channels);
      for (let i = 0; i < frames * channels; i += 1) {
        const p = start + i * (bits >> 3);
        if (code === 3) data[i] = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
        else if (bits === 8) data[i] = f32(((view.getUint8(p) - 128) << 24 >> 24) / 128);
        else if (bits === 16) data[i] = f32(view.getInt16(p, true) / 32768);
        else {
          let s = 0;
          for (let b = 0; b < bits >> 3; b += 1) s |= view.getUint8(p + b) << (b * 8);
          s = (s << (32 - bits)) | 0;
          data[i] = f32((s >> 16) / 32768);
        }
      }
    }
    if (id === 'smpl' && size >= 52) {
      const type = view.getUint32(start + 40, true);
      if (type <= 2) smplLoop = [type, view.getUint32(start + 44, true), view.getUint32(start + 48, true)];
    }
    at = start + size + (size & 1);
  }
  if (data === null || channels === 0) throw new Error('godot-compat: a WAV file without format or data');
  return { channels, rate, bits, data, smplLoop };
}

/**
 * `load_from_buffer` (`audio_stream_wav.cpp:659`) with the importer's options: the stream's
 * samples, rate, channels, format and loop.
 *
 * @godot AudioStreamWAV (protocol)
 * @source scene/resources/audio_stream_wav.cpp:659
 */
export function godot_audio_stream_wav_import(stream: AudioStreamWAV, bytes: Uint8Array, options: GodotWavImport): void {
  const wav = readWav(bytes);
  let channels = wav.channels;
  let data = wav.data;
  const rate = wav.rate;
  let frames = data.length / channels;
  let loopMode = 0;
  let loopBegin = 0;
  let loopEnd = 0;
  if (options.loopMode === 0 && wav.smplLoop !== null) {
    loopMode = [1, 2, 3][wav.smplLoop[0]] as number;
    loopBegin = wav.smplLoop[1];
    loopEnd = wav.smplLoop[2];
  }
  if (options.forceMaxRate && rate > options.maxRateHz && rate > 0 && frames > 0) {
    throw new Error('godot-compat: the wav importer\'s rate limit is not applied');
  }
  if (options.normalize) {
    let max = 0;
    for (const sample of data) max = Math.max(max, Math.abs(sample));
    if (max > 0) {
      const mult = f32(1 / max);
      data = data.map((sample) => f32(sample * mult));
    }
  }
  if (options.trim && loopMode === 0 && channels > 0) {
    let first = 0;
    let last = Math.trunc(frames / channels) - 1;
    let found = false;
    // `Math::db_to_linear(float)` (`core/math/math_funcs.h:620`).
    const limit = f32(Math.exp(f32(TRIM_DB_LIMIT * f32(0.11512925464970228))));
    for (let i = 0; i < data.length / channels; i += 1) {
      let sum = 0;
      for (let j = 0; j < channels; j += 1) sum = f32(sum + Math.abs(data[i * channels + j] as number));
      const amp = Math.abs(f32(sum / channels));
      if (!found && amp > limit) {
        first = i;
        found = true;
      }
      if (found && amp > limit) last = i;
    }
    if (first < last) {
      const trimmed = new Float32Array((last - first) * channels);
      for (let i = first; i < last; i += 1) {
        const fade = last - i < TRIM_FADE_OUT_FRAMES ? f32(f32(last - i - 1) / TRIM_FADE_OUT_FRAMES) : 1;
        for (let j = 0; j < channels; j += 1) trimmed[(i - first) * channels + j] = f32((data[i * channels + j] as number) * fade);
      }
      data = trimmed;
      frames = data.length / channels;
    }
  }
  if (options.loopMode >= 2) {
    loopMode = options.loopMode - 1;
    loopBegin = options.loopBegin;
    loopEnd = options.loopEnd;
    if (loopBegin < 0) loopBegin = Math.min(Math.max(loopBegin + frames, 0), frames - 1);
    if (loopEnd < 0) loopEnd = Math.min(Math.max(loopEnd + frames, 0), frames - 1);
  }
  if (options.forceMono && channels === 2) {
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) mono[i] = f32(((data[i * 2] as number) + (data[i * 2 + 1] as number)) / 2);
    data = mono;
    channels = 1;
  }
  stream.format = options.compressMode === 1 ? FORMAT_IMA_ADPCM : options.compressMode === 2 ? FORMAT_QOA : wav.bits === 8 || options.force8Bit ? FORMAT_8_BITS : FORMAT_16_BITS;
  stream.mixRate = rate;
  stream.stereo = channels === 2;
  stream.loopMode = loopMode;
  stream.loopBegin = loopBegin;
  stream.loopEnd = loopEnd;
  stream.samples = data;
  stream.buffer = null;
}

/**
 * `load()` of an imported `.wav`: the stream now, its samples once the copied file at `url` is
 * fetched and imported; the load is tracked so the scenes mount after it.
 *
 * @godot AudioStreamWAV (protocol)
 * @source scene/resources/audio_stream_wav.cpp:659
 */
export function godot_audio_stream_wav_load(url: string, options: GodotWavImport): AudioStreamWAV {
  const stream = godot_audio_stream_wav_new();
  godot_resource_loader_track(
    fetch(url)
      .then((response) => response.arrayBuffer())
      .then((buffer) => godot_audio_stream_wav_import(stream, new Uint8Array(buffer), options)),
  );
  return stream;
}

/**
 * @godot AudioStreamWAV.get_mix_rate
 * @source scene/resources/audio_stream_wav.cpp:469
 */
export function get_mix_rate(self: AudioStreamWAV): number {
  return self.mixRate;
}

/**
 * @godot AudioStreamWAV.is_stereo
 * @source scene/resources/audio_stream_wav.cpp:477
 */
export function is_stereo(self: AudioStreamWAV): boolean {
  return self.stereo;
}

/**
 * @godot AudioStreamWAV.get_format
 * @source scene/resources/audio_stream_wav.cpp:436
 */
export function get_format(self: AudioStreamWAV): number {
  return self.format;
}

/**
 * @godot AudioStreamWAV.get_loop_mode
 * @source scene/resources/audio_stream_wav.cpp:444
 */
export function get_loop_mode(self: AudioStreamWAV): number {
  return self.loopMode;
}

/**
 * @godot AudioStreamWAV.get_loop_begin
 * @source scene/resources/audio_stream_wav.cpp:452
 */
export function get_loop_begin(self: AudioStreamWAV): number {
  return self.loopBegin;
}

/**
 * @godot AudioStreamWAV.get_loop_end
 * @source scene/resources/audio_stream_wav.cpp:460
 */
export function get_loop_end(self: AudioStreamWAV): number {
  return self.loopEnd;
}
