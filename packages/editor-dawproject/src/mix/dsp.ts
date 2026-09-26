/**
 * THE MIX'S SIGNAL PROCESSING, one implementation for both places a piece sounds:
 *
 *   - LINEAR stages (equaliser bands, fader, pan) are written to the Web Audio specification's
 *     own formulas, so the editor can play them with native nodes (BiquadFilterNode, GainNode,
 *     StereoPannerNode) while the export computes the same filters here: two runtimes, one filter.
 *     Two spec facts decide that: low-pass and high-pass `Q` is in DECIBELS on a BiquadFilterNode,
 *     and its shelves ignore `Q` (the cookbook's slope S = 1). A band's `q` is the musician's
 *     linear Q, converted for the node by `biquadNodeQ`.
 *   - NONLINEAR stages (compressor, limiter) exist only here, and the editor runs THIS code in an
 *     AudioWorklet: two different compressors would sound different, and that is not allowed.
 *
 * Stereo buffers are `[left, right]` Float32Arrays; processors keep their state across calls, so a
 * signal can be fed in blocks (the worklet's 128 frames) or whole (the export) with one result.
 */

export type Stereo = [Float32Array, Float32Array];

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export type BandType = 'highPass' | 'lowPass' | 'lowShelf' | 'highShelf' | 'bell';

export interface Band {
  readonly type: BandType;
  readonly freq: number;
  readonly gain?: number;
  readonly q?: number;
}

/** A band as a Web Audio BiquadFilterNode configuration: `type` and a `Q` in the node's units. */
export function biquadNode(band: Band): { type: BiquadFilterType; frequency: number; gain: number; Q: number } {
  const q = band.q ?? 0.707;
  switch (band.type) {
    case 'highPass':
      return { type: 'highpass', frequency: band.freq, gain: 0, Q: 20 * Math.log10(q) };
    case 'lowPass':
      return { type: 'lowpass', frequency: band.freq, gain: 0, Q: 20 * Math.log10(q) };
    case 'lowShelf':
      return { type: 'lowshelf', frequency: band.freq, gain: band.gain ?? 0, Q: 1 };
    case 'highShelf':
      return { type: 'highshelf', frequency: band.freq, gain: band.gain ?? 0, Q: 1 };
    case 'bell':
      return { type: 'peaking', frequency: band.freq, gain: band.gain ?? 0, Q: q };
  }
}

interface Coefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The Audio EQ Cookbook coefficients exactly as the Web Audio specification applies them. */
export function coefficients(band: Band, sampleRate: number): Coefficients {
  const w0 = (2 * Math.PI * Math.min(band.freq, sampleRate / 2 - 1)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = 10 ** ((band.gain ?? 0) / 40);
  const q = band.q ?? 0.707;
  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;
  switch (band.type) {
    case 'lowPass': {
      const alpha = sin / (2 * q);
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case 'highPass': {
      const alpha = sin / (2 * q);
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    }
    case 'bell': {
      const alpha = sin / (2 * q);
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    }
    case 'lowShelf': {
      const alpha = (sin / 2) * Math.SQRT2;
      const k = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + k);
      b1 = 2 * A * (A - 1 - (A + 1) * cos);
      b2 = A * (A + 1 - (A - 1) * cos - k);
      a0 = A + 1 + (A - 1) * cos + k;
      a1 = -2 * (A - 1 + (A + 1) * cos);
      a2 = A + 1 + (A - 1) * cos - k;
      break;
    }
    case 'highShelf': {
      const alpha = (sin / 2) * Math.SQRT2;
      const k = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + k);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - k);
      a0 = A + 1 - (A - 1) * cos + k;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - k;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** One biquad on a stereo signal (direct form I, per channel). */
export class Biquad {
  private readonly c: Coefficients;
  private readonly state = [new Float64Array(4), new Float64Array(4)];
  constructor(band: Band, sampleRate: number) {
    this.c = coefficients(band, sampleRate);
  }
  process(signal: Stereo): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    for (let ch = 0; ch < 2; ch++) {
      const x = signal[ch]!;
      const s = this.state[ch]!;
      let [x1, x2, y1, y2] = [s[0]!, s[1]!, s[2]!, s[3]!];
      for (let i = 0; i < x.length; i++) {
        const input = x[i]!;
        const output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = input;
        y2 = y1;
        y1 = output;
        x[i] = output;
      }
      s[0] = x1;
      s[1] = x2;
      s[2] = y1;
      s[3] = y2;
    }
  }
}

/**
 * The Web Audio StereoPannerNode's algorithm for a stereo input (specification §StereoPanner):
 * a pan left folds some of the right channel into the left, and vice versa, equal-power.
 */
export function pan(signal: Stereo, position: number): void {
  const x = Math.max(-1, Math.min(1, position));
  const [left, right] = signal;
  if (x <= 0) {
    const p = ((x + 1) * Math.PI) / 2;
    const gainL = Math.cos(p);
    const gainR = Math.sin(p);
    for (let i = 0; i < left.length; i++) {
      const l = left[i]!;
      const r = right[i]!;
      left[i] = l + r * gainL;
      right[i] = r * gainR;
    }
  } else {
    const p = (x * Math.PI) / 2;
    const gainL = Math.cos(p);
    const gainR = Math.sin(p);
    for (let i = 0; i < left.length; i++) {
      const l = left[i]!;
      const r = right[i]!;
      left[i] = l * gainL;
      right[i] = r + l * gainR;
    }
  }
}

export function gain(signal: Stereo, factor: number): void {
  for (const channel of signal) for (let i = 0; i < channel.length; i++) channel[i] = channel[i]! * factor;
}

export interface CompressorParams {
  readonly threshold: number;
  readonly ratio: number;
  readonly attack: number;
  readonly release: number;
  readonly knee: number;
  readonly makeup: number;
}

export function compressorParams(params: Readonly<Record<string, unknown>>): CompressorParams {
  const n = (key: string, fallback: number): number => (typeof params[key] === 'number' ? (params[key] as number) : fallback);
  return {
    threshold: n('threshold', -18),
    ratio: Math.max(1, n('ratio', 2)),
    attack: Math.max(0.1, n('attack', 20)),
    release: Math.max(1, n('release', 200)),
    knee: Math.max(0, n('knee', 6)),
    makeup: n('makeup', 0),
  };
}

/**
 * A feed-forward compressor, stereo-linked on the louder channel, with a soft knee and
 * attack/release smoothing of the gain reduction in decibels.
 */
export class Compressor {
  private reduction = 0;
  /** The most gain reduction applied so far, dB, and the loudest peak heard, dBFS: what it did. */
  maxReductionDb = 0;
  maxInputDb = -Infinity;
  private readonly attackCoef: number;
  private readonly releaseCoef: number;
  constructor(
    private readonly params: CompressorParams,
    sampleRate: number,
  ) {
    this.attackCoef = Math.exp(-1 / ((params.attack / 1000) * sampleRate));
    this.releaseCoef = Math.exp(-1 / ((params.release / 1000) * sampleRate));
  }
  private gainComputer(levelDb: number): number {
    const { threshold, ratio, knee } = this.params;
    const over = levelDb - threshold;
    if (2 * over < -knee) return 0;
    if (knee > 0 && Math.abs(2 * over) <= knee) return ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
    return (1 / ratio - 1) * over;
  }
  process(signal: Stereo): void {
    const [left, right] = signal;
    const makeup = dbToGain(this.params.makeup);
    for (let i = 0; i < left.length; i++) {
      const peak = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      const levelDb = 20 * Math.log10(peak + 1e-12);
      if (levelDb > this.maxInputDb) this.maxInputDb = levelDb;
      const target = -this.gainComputer(levelDb);
      const coef = target > this.reduction ? this.attackCoef : this.releaseCoef;
      this.reduction = coef * this.reduction + (1 - coef) * target;
      if (this.reduction > this.maxReductionDb) this.maxReductionDb = this.reduction;
      const g = dbToGain(-this.reduction) * makeup;
      left[i] = left[i]! * g;
      right[i] = right[i]! * g;
    }
  }
}

/**
 * A lookahead peak limiter: the signal is delayed by the lookahead, and the gain reaches what the
 * coming peak needs by the time the peak arrives, then recovers over `release`. It never lets a
 * sample exceed `ceiling` dBFS (sample peak; the export measures true peak separately).
 */
export class Limiter {
  private readonly ceiling: number;
  private readonly lookahead: number;
  private readonly releaseCoef: number;
  private readonly delay: [Float32Array, Float32Array];
  private write = 0;
  private gainNow = 1;
  private minGain = 1;
  /** The most gain reduction applied so far, dB. */
  get maxReductionDb(): number {
    return -20 * Math.log10(this.minGain);
  }
  /** The window's minimum need, kept by a monotonic queue of (sample index, need). */
  private readonly queueIndex: Float64Array;
  private readonly queueNeed: Float32Array;
  private head = 0;
  private tail = 0;
  private sample = 0;
  constructor(params: Readonly<Record<string, unknown>>, sampleRate: number) {
    const ceiling = typeof params['ceiling'] === 'number' ? (params['ceiling'] as number) : -1;
    const release = typeof params['release'] === 'number' ? (params['release'] as number) : 80;
    this.ceiling = dbToGain(ceiling);
    this.lookahead = Math.max(1, Math.round(0.003 * sampleRate));
    this.releaseCoef = Math.exp(-1 / ((release / 1000) * sampleRate));
    this.delay = [new Float32Array(this.lookahead), new Float32Array(this.lookahead)];
    this.queueIndex = new Float64Array(this.lookahead + 1);
    this.queueNeed = new Float32Array(this.lookahead + 1);
  }
  /** Push this sample's need and return the minimum over the last `lookahead` samples. */
  private windowMinimum(need: number): number {
    const size = this.queueNeed.length;
    while (this.tail !== this.head && this.queueNeed[(this.tail - 1 + size) % size]! >= need) this.tail = (this.tail - 1 + size) % size;
    this.queueIndex[this.tail] = this.sample;
    this.queueNeed[this.tail] = need;
    this.tail = (this.tail + 1) % size;
    while (this.queueIndex[this.head]! <= this.sample - this.lookahead) this.head = (this.head + 1) % size;
    this.sample++;
    return this.queueNeed[this.head]!;
  }
  process(signal: Stereo): void {
    const [left, right] = signal;
    for (let i = 0; i < left.length; i++) {
      const peak = Math.max(Math.abs(left[i]!), Math.abs(right[i]!));
      const need = this.windowMinimum(peak > this.ceiling ? this.ceiling / peak : 1);
      // Down immediately toward what the window needs; recover smoothly.
      this.gainNow = need < this.gainNow ? need : this.releaseCoef * this.gainNow + (1 - this.releaseCoef) * need;
      if (this.gainNow < this.minGain) this.minGain = this.gainNow;
      const delayedL = this.delay[0][this.write]!;
      const delayedR = this.delay[1][this.write]!;
      this.delay[0][this.write] = left[i]!;
      this.delay[1][this.write] = right[i]!;
      this.write = (this.write + 1) % this.lookahead;
      left[i] = delayedL * this.gainNow;
      right[i] = delayedR * this.gainNow;
    }
  }
}
