/**
 * The SF3 sample encoder for `sfzBank`: libvorbis's reference encoder (`oggenc`, from
 * vorbis-tools) over raw 16-bit mono, quality 6. Node only; bank builds are authoring-time, like
 * renders' ffmpeg.
 */

import { execFileSync } from 'node:child_process';

export async function oggenc(audio: Float32Array, sampleRate: number): Promise<Uint8Array> {
  const pcm = Buffer.alloc(audio.length * 2);
  for (let i = 0; i < audio.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((audio[i] ?? 0) * 32767))), i * 2);
  // A fixed stream serial: oggenc otherwise draws a random one per stream, so the same library
  // built different bytes every time.
  const ogg = execFileSync('oggenc', ['-Q', '-r', '-B', '16', '-C', '1', '-R', String(sampleRate), '--raw-endianness', '0', '-q', '6', '--serial', '1', '-o', '-', '-'], {
    input: pcm,
    maxBuffer: 1 << 30,
  });
  return new Uint8Array(ogg.buffer, ogg.byteOffset, ogg.byteLength);
}
