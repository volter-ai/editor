/**
 * MEASURES OF A RENDERED LOOP, for an agent that cannot hear it: how peaky it is (crest factor),
 * where its energy sits in frequency (spectral centroid and a five-band split), and how wide it
 * is (side against mid). The spectrum is Welch's method: Hann-windowed frames of 4096 samples,
 * half overlapping, their power averaged, the two channels' power summed.
 */

const FRAME = 4096;
const HOP = FRAME / 2;

/** Band edges in Hz; the split reports each band's share of the total power. */
export const BANDS: readonly { readonly name: string; readonly low: number; readonly high: number }[] = [
  { name: '<120', low: 0, high: 120 },
  { name: '120-500', low: 120, high: 500 },
  { name: '500-2k', low: 500, high: 2000 },
  { name: '2k-8k', low: 2000, high: 8000 },
  { name: '>8k', low: 8000, high: Number.POSITIVE_INFINITY },
];

export interface LoopMeasures {
  /** Sample peak over RMS, both channels, in dB. */
  readonly crestFactorDb: number;
  /** Power-weighted mean frequency, Hz. */
  readonly spectralCentroidHz: number;
  /** Percent of the power in each band of {@link BANDS}; sums to 100. */
  readonly bandsPercent: Readonly<Record<string, number>>;
  /** Side energy over mid energy, dB: very negative is near mono, 0 is as wide as it is centred. */
  readonly sideMidRatioDb: number;
}

/** In-place iterative radix-2 FFT; `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
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
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const cos = Math.cos(step * k);
        const sin = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * cos - im[b]! * sin;
        const ti = re[b]! * sin + im[b]! * cos;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** Welch power spectrum of the channels, summed: `FRAME / 2 + 1` bins. */
export function powerSpectrum(channels: readonly Float32Array[]): Float64Array {
  const bins = FRAME / 2 + 1;
  const power = new Float64Array(bins);
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let frames = 0;
  for (const channel of channels) {
    for (let start = 0; start + FRAME <= channel.length; start += HOP) {
      for (let i = 0; i < FRAME; i++) {
        re[i] = (channel[start + i] ?? 0) * window[i]!;
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 0; k < bins; k++) power[k] = power[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
      frames++;
    }
  }
  if (frames > 0) for (let k = 0; k < bins; k++) power[k] = power[k]! / frames;
  return power;
}

const round = (value: number, places = 1): number => Math.round(value * 10 ** places) / 10 ** places;

export function measureLoop(left: Float32Array, right: Float32Array, sampleRate: number): LoopMeasures {
  let peak = 0;
  let sumSquares = 0;
  let mid = 0;
  let side = 0;
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSquares += l * l + r * r;
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, 2 * n));

  const power = powerSpectrum([left, right]);
  const binHz = sampleRate / FRAME;
  let total = 0;
  let weighted = 0;
  const bands = BANDS.map(() => 0);
  for (let k = 1; k < power.length; k++) {
    const p = power[k]!;
    const hz = k * binHz;
    total += p;
    weighted += p * hz;
    const band = BANDS.findIndex((candidate) => hz >= candidate.low && hz < candidate.high);
    if (band >= 0) bands[band] = bands[band]! + p;
  }
  return {
    crestFactorDb: round(20 * Math.log10(peak / Math.max(rms, 1e-12))),
    spectralCentroidHz: Math.round(weighted / Math.max(total, 1e-30)),
    bandsPercent: Object.fromEntries(BANDS.map((band, index) => [band.name, round((100 * bands[index]!) / Math.max(total, 1e-30))])),
    sideMidRatioDb: round(10 * Math.log10(Math.max(side, 1e-30) / Math.max(mid, 1e-30))),
  };
}

/** How far the stems' sum is from the mix: residual energy over mix energy, dB (−∞ is a perfect null). */
export function nullResidualDb(mix: readonly Float32Array[], stems: readonly (readonly Float32Array[])[]): number {
  let residual = 0;
  let energy = 0;
  mix.forEach((channel, c) => {
    for (let i = 0; i < channel.length; i++) {
      let sum = 0;
      for (const stem of stems) sum += stem[c]?.[i] ?? 0;
      const m = channel[i] ?? 0;
      residual += (m - sum) ** 2;
      energy += m * m;
    }
  });
  if (residual === 0) return Number.NEGATIVE_INFINITY;
  return round(10 * Math.log10(residual / Math.max(energy, 1e-30)));
}
