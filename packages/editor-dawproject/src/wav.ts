/**
 * A LOOP AS A WAV FILE: 24-bit little-endian PCM, stereo, written exactly as given (no
 * normalisation; a sample beyond full scale is clamped), with a RIFF `smpl` chunk that declares
 * one forward loop over the whole file. Engines that read `smpl` (Godot's WAV importer, samplers,
 * most middleware) then loop the file with no loop points set by hand.
 */

const BYTES_PER_SAMPLE = 3;
const FULL_SCALE = 8_388_607;

export function loopWav24(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const frames = Math.min(left.length, right.length);
  const channels = 2;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const dataBytes = frames * blockAlign;
  const pad = dataBytes % 2; // RIFF chunks are word-aligned
  const smplBytes = 36 + 24;
  const size = 12 + (8 + 16) + (8 + dataBytes + pad) + (8 + smplBytes);
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
