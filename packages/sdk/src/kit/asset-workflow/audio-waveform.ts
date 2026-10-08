/** Downsample a channel to display bars. Peak of each window, then normalize. */
export function peaksFromSamples(samples: ArrayLike<number>, bars: number): number[] {
  if (bars <= 0) return [];
  if (samples.length === 0) return Array.from({ length: bars }, () => 0);
  const peaks = new Array<number>(bars);
  const block = samples.length / bars;
  let max = 0;
  for (let index = 0; index < bars; index++) {
    const start = Math.floor(index * block);
    const end = Math.max(start + 1, Math.floor((index + 1) * block));
    let peak = 0;
    for (let sample = start; sample < end; sample++) {
      peak = Math.max(peak, Math.abs(samples[sample] ?? 0));
    }
    peaks[index] = peak;
    max = Math.max(max, peak);
  }
  if (max <= 1e-8) return peaks.fill(0);
  return peaks.map((peak) => peak / max);
}

export const AUDIO_WAVEFORM_BARS = 32;
