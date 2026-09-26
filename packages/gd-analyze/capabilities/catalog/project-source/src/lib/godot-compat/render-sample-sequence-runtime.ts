export type GodotRenderSampleSequence = 'halton' | 'r2' | 'hammersley' | 'random';

export interface GodotRenderSample2D {
  readonly x: number;
  readonly y: number;
}

export interface GodotRenderSample3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GodotRenderFrameSamples {
  readonly frame: number;
  readonly view: number;
  readonly sequence: GodotRenderSampleSequence;
  readonly jitter: GodotRenderSample2D;
  readonly rotation: GodotRenderSample2D;
  readonly noiseOffset: GodotRenderSample2D;
  readonly hemisphere: readonly GodotRenderSample3D[];
  readonly disk: readonly GodotRenderSample2D[];
  readonly historyGeneration: number;
  readonly generation: number;
}

export interface GodotRenderSampleSequenceSnapshot {
  readonly frame: number;
  readonly sequence: GodotRenderSampleSequence;
  readonly period: number;
  readonly views: number;
  readonly kernelSize: number;
  readonly seed: number;
  readonly historyGeneration: number;
  readonly generation: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return result;
}

function sequence(value: unknown): GodotRenderSampleSequence {
  if (value !== 'halton' && value !== 'r2' && value !== 'hammersley' && value !== 'random') {
    throw new TypeError(`godot-compat: unknown render sample sequence ${String(value)}.`);
  }
  return value;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function radicalInverse(indexValue: number, base: number): number {
  let index = indexValue;
  let inverse = 1 / base;
  let result = 0;
  while (index > 0) {
    result += (index % base) * inverse;
    index = Math.floor(index / base);
    inverse /= base;
  }
  return result;
}

function hash(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function random01(value: number): number {
  return hash(value) / 0x1_0000_0000;
}

function concentricDisk(sample: GodotRenderSample2D): GodotRenderSample2D {
  const offsetX = sample.x * 2 - 1;
  const offsetY = sample.y * 2 - 1;
  if (offsetX === 0 && offsetY === 0) return Object.freeze({ x: 0, y: 0 });
  let radius: number;
  let angle: number;
  if (Math.abs(offsetX) > Math.abs(offsetY)) {
    radius = offsetX;
    angle = Math.PI / 4 * (offsetY / offsetX);
  } else {
    radius = offsetY;
    angle = Math.PI / 2 - Math.PI / 4 * (offsetX / offsetY);
  }
  return Object.freeze({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
}

export class GodotRenderSampleSequenceRuntime {
  private sequenceValue: GodotRenderSampleSequence = 'halton';
  private period = 16;
  private views = 1;
  private kernelSize = 16;
  private seed = 0x91e10da5;
  private frame = 0;
  private historyGeneration = 1;
  private generation = 1;
  private readonly frameCache = new Map<string, GodotRenderFrameSamples>();
  private readonly watchers = new Set<(samples: GodotRenderFrameSamples) => void>();

  configure(value: {
    readonly sequence?: GodotRenderSampleSequence;
    readonly period?: number;
    readonly views?: number;
    readonly kernelSize?: number;
    readonly seed?: number;
  }): void {
    let reset = false;
    if (value.sequence !== undefined && value.sequence !== this.sequenceValue) {
      this.sequenceValue = sequence(value.sequence);
      reset = true;
    }
    if (value.period !== undefined) {
      const period = integer(value.period, 'sample sequence period', 1, 65536);
      reset ||= period !== this.period;
      this.period = period;
    }
    if (value.views !== undefined) {
      const views = integer(value.views, 'sample sequence views', 1, 32);
      reset ||= views !== this.views;
      this.views = views;
    }
    if (value.kernelSize !== undefined) {
      const kernelSize = integer(value.kernelSize, 'sample kernel size', 1, 1024);
      reset ||= kernelSize !== this.kernelSize;
      this.kernelSize = kernelSize;
    }
    if (value.seed !== undefined) {
      const seed = integer(value.seed, 'sample sequence seed', 0, 0xffff_ffff) >>> 0;
      reset ||= seed !== this.seed;
      this.seed = seed;
    }
    if (reset) this.resetHistory();
  }

  beginFrame(frameValue: number): void {
    const nextFrame = integer(frameValue, 'sample sequence frame', 0);
    if (nextFrame < this.frame) throw new RangeError('godot-compat: sample sequence frame cannot move backwards.');
    this.frame = nextFrame;
    for (const key of this.frameCache.keys()) {
      const cachedFrame = Number(key.slice(0, key.indexOf(':')));
      if (cachedFrame < this.frame - 2) this.frameCache.delete(key);
    }
  }

  getFrameSamples(viewValue = 0): GodotRenderFrameSamples {
    const view = integer(viewValue, 'sample sequence view', 0, this.views - 1);
    const key = `${this.frame}:${view}:${this.historyGeneration}`;
    const retained = this.frameCache.get(key);
    if (retained !== undefined) return retained;
    const sampleIndex = (this.frame % this.period) * this.views + view;
    const base = this.sample2D(sampleIndex, this.period * this.views);
    const jitter = Object.freeze({ x: base.x - 0.5, y: base.y - 0.5 });
    const rotation = Object.freeze({
      x: random01(hash(this.seed ^ sampleIndex)),
      y: random01(hash(this.seed ^ sampleIndex ^ 0x68bc21eb)),
    });
    const noiseOffset = Object.freeze({
      x: hash(this.frame ^ this.seed ^ view) & 0xff,
      y: hash(this.frame ^ this.seed ^ view ^ 0x02e5be93) & 0xff,
    });
    const disk: GodotRenderSample2D[] = [];
    const hemisphere: GodotRenderSample3D[] = [];
    for (let index = 0; index < this.kernelSize; index++) {
      const sample = this.sample2D(sampleIndex * this.kernelSize + index, this.kernelSize * this.period * this.views);
      const rotated = {
        x: fract(sample.x + rotation.x),
        y: fract(sample.y + rotation.y),
      };
      disk.push(concentricDisk(rotated));
      const phi = Math.PI * 2 * rotated.x;
      const z = rotated.y;
      const radius = Math.sqrt(Math.max(0, 1 - z * z));
      hemisphere.push(Object.freeze({ x: radius * Math.cos(phi), y: radius * Math.sin(phi), z }));
    }
    const value: GodotRenderFrameSamples = Object.freeze({
      frame: this.frame,
      view,
      sequence: this.sequenceValue,
      jitter,
      rotation,
      noiseOffset,
      hemisphere: Object.freeze(hemisphere),
      disk: Object.freeze(disk),
      historyGeneration: this.historyGeneration,
      generation: ++this.generation,
    });
    this.frameCache.set(key, value);
    for (const watcher of this.watchers) watcher(value);
    return value;
  }

  getJitter(view = 0, viewportWidth = 1, viewportHeight = 1): GodotRenderSample2D {
    const width = finite(viewportWidth, 'sample viewport width', Number.EPSILON);
    const height = finite(viewportHeight, 'sample viewport height', Number.EPSILON);
    const jitter = this.getFrameSamples(view).jitter;
    return Object.freeze({ x: jitter.x / width, y: jitter.y / height });
  }

  getSample(indexValue: number, totalValue = this.period): GodotRenderSample2D {
    const index = integer(indexValue, 'render sample index', 0);
    const total = integer(totalValue, 'render sample total', 1);
    return Object.freeze(this.sample2D(index, total));
  }

  resetHistory(): void {
    this.historyGeneration++;
    this.frameCache.clear();
    this.generation++;
  }

  getSnapshot(): GodotRenderSampleSequenceSnapshot {
    return Object.freeze({
      frame: this.frame,
      sequence: this.sequenceValue,
      period: this.period,
      views: this.views,
      kernelSize: this.kernelSize,
      seed: this.seed,
      historyGeneration: this.historyGeneration,
      generation: this.generation,
    });
  }

  watch(listener: (samples: GodotRenderFrameSamples) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  dispose(): void {
    this.frameCache.clear();
    this.watchers.clear();
    this.generation++;
  }

  private sample2D(index: number, total: number): GodotRenderSample2D {
    const sequenceIndex = index + 1;
    if (this.sequenceValue === 'halton') {
      return { x: radicalInverse(sequenceIndex, 2), y: radicalInverse(sequenceIndex, 3) };
    }
    if (this.sequenceValue === 'hammersley') {
      return { x: (index % total) / total, y: radicalInverse(sequenceIndex, 2) };
    }
    if (this.sequenceValue === 'r2') {
      const plastic = 1.324717957244746;
      return { x: fract(0.5 + sequenceIndex / plastic), y: fract(0.5 + sequenceIndex / (plastic * plastic)) };
    }
    return {
      x: random01(hash(this.seed ^ sequenceIndex)),
      y: random01(hash(this.seed ^ sequenceIndex ^ 0x9e3779b9)),
    };
  }
}

export function createGodotRenderSampleSequenceRuntime(): GodotRenderSampleSequenceRuntime {
  return new GodotRenderSampleSequenceRuntime();
}
