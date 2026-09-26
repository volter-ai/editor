/**
 * A LOOP AS A WAV FILE: 24-bit little-endian PCM, stereo, written exactly as given (no
 * normalisation; a sample beyond full scale is clamped), with a RIFF `smpl` chunk that declares
 * one forward loop over the whole file. Engines that read `smpl` (Godot's WAV importer, samplers,
 * most middleware) then loop the file with no loop points set by hand.
 */

const BYTES_PER_SAMPLE = 3;
const FULL_SCALE = 8_388_607;

export function loopWav24(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  return writeWav24(left, right, sampleRate, true);
}

/** Plain 24-bit stereo PCM, without sampler loop metadata. */
export function wav24(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  return writeWav24(left, right, sampleRate, false);
}

function writeWav24(left: Float32Array, right: Float32Array, sampleRate: number, loop: boolean): Uint8Array {
  const frames = Math.min(left.length, right.length);
  const channels = 2;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const dataBytes = frames * blockAlign;
  const pad = dataBytes % 2; // RIFF chunks are word-aligned
  const smplBytes = 36 + 24;
  const size = 12 + (8 + 16) + (8 + dataBytes + pad) + (loop ? 8 + smplBytes : 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const tag = (text: string): void => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
    at += 4;
  };
  const u32 = (value: number): void => {
    view.setUint32(at, value >>> 0, true);
    at += 4;
  };
  const u16 = (value: number): void => {
    view.setUint16(at, value, true);
    at += 2;
  };

  tag('RIFF');
  u32(size - 8);
  tag('WAVE');

  tag('fmt ');
  u32(16);
  u16(1); // PCM
  u16(channels);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(BYTES_PER_SAMPLE * 8);

  tag('data');
  u32(dataBytes);
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of [left, right]) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      const value = Math.round(sample * FULL_SCALE);
      bytes[at] = value & 0xff;
      bytes[at + 1] = (value >> 8) & 0xff;
      bytes[at + 2] = (value >> 16) & 0xff;
      at += 3;
    }
  }
  at += pad;

  if (!loop) return bytes;

  tag('smpl');
  u32(smplBytes);
  u32(0); // manufacturer
  u32(0); // product
  u32(Math.round(1e9 / sampleRate)); // sample period, ns
  u32(60); // MIDI unity note
  u32(0); // pitch fraction
  u32(0); // SMPTE format
  u32(0); // SMPTE offset
  u32(1); // one loop
  u32(0); // sampler data bytes
  u32(0); // cue point id
  u32(0); // type: forward
  u32(0); // start: the first sample
  u32(Math.max(0, frames - 1)); // end: the last sample (inclusive)
  u32(0); // fraction
  u32(0); // play count: forever
  return bytes;
}

/** A PCM WAV (16/24/32-bit integer or 32-bit float) as float channels: what an impulse response is read with. */
export function readWav(bytes: Uint8Array): { channels: Float32Array[]; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number): string => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Not a RIFF WAVE file.');
  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = text(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe) format = view.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE sub-format
    } else if (id === 'data') {
      const bytesPerSample = bits / 8;
      const frames = Math.floor(size / (bytesPerSample * channelCount));
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
      for (let frame = 0; frame < frames; frame++) {
        for (let ch = 0; ch < channelCount; ch++) {
          const offset = body + (frame * channelCount + ch) * bytesPerSample;
          let value: number;
          if (format === 3 && bits === 32) value = view.getFloat32(offset, true);
          else if (bits === 16) value = view.getInt16(offset, true) / 32768;
          else if (bits === 24) value = ((bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)) << 8 >> 8) / 8388608;
          else if (bits === 32) value = view.getInt32(offset, true) / 2147483648;
          else throw new Error(`Unsupported WAV sample format: ${bits}-bit, format ${format}.`);
          channels[ch]![frame] = value;
        }
      }
      return { channels, sampleRate };
    }
    at = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk.');
}
