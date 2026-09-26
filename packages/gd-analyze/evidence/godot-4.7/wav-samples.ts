/** Small WAV files built for the audio cases: tones framed by silence, in each sample format. */

export interface WavSpec {
  readonly name: string;
  readonly channels: number;
  readonly rate: number;
  readonly bits: number;
  readonly float?: boolean;
  /** Silent frames before and after the tone. */
  readonly lead: number;
  readonly tone: number;
  readonly tail: number;
  readonly amplitude: number;
}

export const WAVS: readonly WavSpec[] = [
  { name: 'mono16', channels: 1, rate: 22050, bits: 16, lead: 300, tone: 1500, tail: 400, amplitude: 0.5 },
  { name: 'stereo16', channels: 2, rate: 44100, bits: 16, lead: 50, tone: 900, tail: 700, amplitude: 0.25 },
  { name: 'mono8', channels: 1, rate: 11025, bits: 8, lead: 10, tone: 800, tail: 10, amplitude: 0.75 },
  { name: 'mono24', channels: 1, rate: 48000, bits: 24, lead: 0, tone: 1200, tail: 600, amplitude: 0.3 },
  { name: 'stereo-float', channels: 2, rate: 32000, bits: 32, float: true, lead: 120, tone: 1000, tail: 0, amplitude: 0.9 },
];

/** A two-second stream for player cases: long enough that no playback ends while a case runs. */
export const LONG_WAV: WavSpec = { name: 'long8', channels: 1, rate: 8000, bits: 8, lead: 0, tone: 16000, tail: 0, amplitude: 0.5 };

/** The file's bytes: a RIFF/WAVE with `fmt ` and `data`, the tone a stepped sine. */
export function wavBytes(spec: WavSpec): Uint8Array {
  const frames = spec.lead + spec.tone + spec.tail;
  const bytesPerSample = spec.bits >> 3;
  const dataSize = frames * spec.channels * bytesPerSample;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const text = (at: number, value: string): void => {
    for (let i = 0; i < 4; i += 1) out[at + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, spec.float === true ? 3 : 1, true);
  view.setUint16(22, spec.channels, true);
  view.setUint32(24, spec.rate, true);
  view.setUint32(28, spec.rate * spec.channels * bytesPerSample, true);
  view.setUint16(32, spec.channels * bytesPerSample, true);
  view.setUint16(34, spec.bits, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < spec.channels; c += 1) {
      const inTone = f >= spec.lead && f < spec.lead + spec.tone;
      const value = inTone ? spec.amplitude * Math.sin((f * (c + 1) * 2 * Math.PI) / 37) : 0;
      const at = 44 + (f * spec.channels + c) * bytesPerSample;
      if (spec.float === true) view.setFloat32(at, value, true);
      else if (spec.bits === 8) view.setUint8(at, Math.round(value * 127) + 128);
      else if (spec.bits === 16) view.setInt16(at, Math.round(value * 32767), true);
      else {
        const v = Math.round(value * 8388607);
        view.setUint8(at, v & 0xff);
        view.setUint8(at + 1, (v >> 8) & 0xff);
        view.setUint8(at + 2, (v >> 16) & 0xff);
      }
    }
  }
  return out;
}
