/**
 * Convolution reverb for the export: an impulse response (a recorded room) convolved with the
 * bus signal by FFT overlap-add. The editor plays the same IR through a native ConvolverNode with
 * `normalize = false`; both sides use the IR this module prepares (`prepareIr`): resampled to the
 * render rate, predelayed, and scaled to unit energy, so a bus's `volume` alone sets how much room
 * is heard. A stereo IR convolves left with left and right with right, as the node does.
 */
import type { Stereo } from './dsp';

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] = re[i]! / n;
    im[i] = im[i]! / n;
  }
}

/** Resample by linear interpolation (an IR's tail is noise-like; this is inaudible there). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const length = Math.max(1, Math.round((input.length * to) / from));
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const t = position - index;
    out[i] = (input[index] ?? 0) * (1 - t) + (input[index + 1] ?? 0) * t;
  }
  return out;
}

/** The IR both the editor and the export use: at `sampleRate`, predelayed, unit energy. */
export function prepareIr(channels: readonly Float32Array[], irRate: number, sampleRate: number, predelayMs: number): Stereo {
  const left = resample(channels[0] ?? new Float32Array(1), irRate, sampleRate);
  const right = resample(channels[1] ?? channels[0] ?? new Float32Array(1), irRate, sampleRate);
  const pad = Math.max(0, Math.round((predelayMs / 1000) * sampleRate));
  const out: Stereo = [new Float32Array(left.length + pad), new Float32Array(right.length + pad)];
  out[0].set(left, pad);
  out[1].set(right, pad);
  let energy = 0;
  for (const channel of out) for (const sample of channel) energy += sample * sample;
  const scale = energy > 0 ? 1 / Math.sqrt(energy / 2) : 0;
  for (const channel of out) for (let i = 0; i < channel.length; i++) channel[i] = channel[i]! * scale;
  return out;
}

/** Convolve a whole stereo signal with a stereo IR (overlap-add). Returns a new signal of the same length. */
export function convolve(signal: Stereo, ir: Stereo): Stereo {
  const out: Stereo = [new Float32Array(signal[0].length), new Float32Array(signal[1].length)];
  for (let ch = 0; ch < 2; ch++) {
    const kernel = ir[ch]!;
    // Input blocks as long as the IR: each FFT is about twice the IR, and there are as few as possible.
    const block = 2 ** Math.ceil(Math.log2(Math.max(1024, kernel.length)));
    const size = 2 ** Math.ceil(Math.log2(block + kernel.length - 1));
    const kr = new Float64Array(size);
    const ki = new Float64Array(size);
    kr.set(kernel);
    fft(kr, ki, false);
    const x = signal[ch]!;
    const y = out[ch]!;
    for (let start = 0; start < x.length; start += block) {
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      re.set(x.subarray(start, Math.min(x.length, start + block)));
      fft(re, im, false);
      for (let i = 0; i < size; i++) {
        const r = re[i]! * kr[i]! - im[i]! * ki[i]!;
        im[i] = re[i]! * ki[i]! + im[i]! * kr[i]!;
        re[i] = r;
      }
      fft(re, im, true);
      for (let i = 0; i < size && start + i < y.length; i++) y[start + i] = y[start + i]! + re[i]!;
    }
  }
  return out;
}
