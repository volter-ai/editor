/**
 * Pure PCM -> 16-bit WAV encoder (spec §15 I6 "Encode and Mux", audio half).
 * This module takes already-rendered Float32 channel data (e.g.
 * `AudioBuffer.getChannelData(n)` from the project's own offline render — the
 * renderer is the project's, NOT the engine's, because
 * `runtime/render-audio-control.ts` deliberately keeps `tone` out of the
 * engine's dependency graph) and produces a standard
 * little-endian,
 * 16-bit-PCM, interleaved RIFF/WAVE file as raw bytes — no
 * `AudioBuffer`/`AudioContext` dependency, so this runs equally in a browser
 * render-mode page (`runtime/render-audio-control.ts`) and in plain Node (this
 * module's own `packages/engine/test/audio/wav-encode.test.ts`, no Playwright
 * needed).
 *
 * 16-bit PCM (not 32-bit float) is the deliberate choice named by the I6 AC
 * ("16-bit PCM WAV is fine") — it is universally decodable by every FFmpeg
 * build without an extra format flag, keeping the video-mux step's ffmpeg
 * invocation ordinary and portable.
 */

export interface PcmToWavInput {
  /** One `Float32Array` per channel, each sample in `[-1, 1]` (values outside
   *  that range are clamped, not thrown on — real synthesis can transiently
   *  clip). All channels must have equal length. */
  readonly channelData: readonly Float32Array[];
  readonly sampleRate: number;
}

const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const WAV_HEADER_BYTES = 44;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Encode `input` as a complete little-endian, 16-bit-PCM, interleaved
 *  RIFF/WAVE file (44-byte canonical header + data chunk). Throws on an
 *  empty/mismatched channel set rather than silently producing a malformed
 *  file — this module's own contribution to the "fail loudly, never a
 *  silent no-op" convention `runtime/render-control.ts` documents. */
export function encodeWav16(input: PcmToWavInput): Uint8Array {
  const { channelData, sampleRate } = input;
  const numChannels = channelData.length;
  if (numChannels === 0) {
    throw new Error('[wav-encode] channelData must contain at least one channel');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`[wav-encode] sampleRate must be a finite number > 0, got ${sampleRate}`);
  }
  const numFrames = channelData[0]?.length ?? 0;
  for (let ch = 0; ch < numChannels; ch++) {
    const len = channelData[ch]?.length ?? -1;
    if (len !== numFrames) {
      throw new Error(
        `[wav-encode] channel ${ch} has length ${len}, expected ${numFrames} (all channels must match)`,
      );
    }
  }

  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;

  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');

  // fmt subchunk (PCM)
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk size for PCM
  view.setUint16(20, 1, true); // audio format 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample

  // data subchunk
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = WAV_HEADER_BYTES;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = clamp(channelData[ch]?.[i] ?? 0, -1, 1);
      const intSample = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      view.setInt16(offset, intSample, true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return new Uint8Array(buffer);
}

/** RMS + peak over all channels/samples — the same "non-trivial audio, not
 *  an all-zero buffer" sanity check `tone-audio-main.ts`'s fixture computes,
 *  factored out here so both that fixture and the render-audio harness can
 *  share one implementation instead of drifting copies. */
export function pcmStats(channelData: readonly Float32Array[]): { rms: number; peak: number } {
  let sumSquares = 0;
  let peak = 0;
  let count = 0;
  for (const data of channelData) {
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? 0;
      sumSquares += v * v;
      peak = Math.max(peak, Math.abs(v));
      count++;
    }
  }
  return { rms: count > 0 ? Math.sqrt(sumSquares / count) : 0, peak };
}
