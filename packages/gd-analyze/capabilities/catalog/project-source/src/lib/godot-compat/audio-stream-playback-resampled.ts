import { registerGodotObjectIdentity } from './object';

export interface GodotAudioStreamPlaybackResampledCarrier {
  getStreamSamplingRate(): number;
  mixResampled(destination: Float32Array, frameCount: number): number;
  start?(fromPosition: number): void;
  stop?(): void;
  isPlaying?(): boolean;
  getLoopCount?(): number;
  getPlaybackPosition?(): number;
  seek?(time: number): void;
  tagUsedStreams?(): void;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

function frames(member: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${member} requires non-negative integer frames.`);
  return value;
}

export class GodotAudioStreamPlaybackResampled {
  private playingValue = false;
  private playbackPositionValue = 0;
  private loopCountValue = 0;
  private sourceBuffer = new Float32Array(0);
  private sourceFrames = 0;
  private sourceCursor = 0;
  private phase = 0;
  private previousLeft = 0;
  private previousRight = 0;
  private nextLeft = 0;
  private nextRight = 0;
  private primed = false;

  constructor(private readonly carrier: GodotAudioStreamPlaybackResampledCarrier) {
    registerGodotObjectIdentity(this, 'AudioStreamPlaybackResampled');
  }

  start(fromPosition = 0): void {
    const offset = finite('AudioStreamPlaybackResampled.start', fromPosition, 0);
    this.resetResampler();
    this.playbackPositionValue = offset;
    this.loopCountValue = 0;
    this.playingValue = true;
    this.carrier.start?.(offset);
  }

  stop(): void {
    this.carrier.stop?.();
    this.playingValue = false;
    this.playbackPositionValue = 0;
    this.resetResampler();
  }

  is_playing(): boolean { return this.carrier.isPlaying?.() ?? this.playingValue; }
  get_loop_count(): number { return this.carrier.getLoopCount?.() ?? this.loopCountValue; }
  get_playback_position(): number { return this.carrier.getPlaybackPosition?.() ?? this.playbackPositionValue; }
  seek(time: number): void {
    const position = finite('AudioStreamPlaybackResampled.seek', time, 0);
    this.carrier.seek?.(position);
    this.playbackPositionValue = position;
    this.resetResampler();
  }
  tag_used_streams(): void { this.carrier.tagUsedStreams?.(); }
  get_stream_sampling_rate(): number {
    return finite('AudioStreamPlaybackResampled stream sampling rate', this.carrier.getStreamSamplingRate(), Number.EPSILON);
  }

  mix(outputRate: number, frameCount: number, rateScale = 1): Float32Array {
    const destinationRate = finite('AudioStreamPlaybackResampled output_rate', outputRate, Number.EPSILON);
    const count = frames('AudioStreamPlaybackResampled frame_count', frameCount);
    const scale = finite('AudioStreamPlaybackResampled rate_scale', rateScale, Number.EPSILON);
    const output = new Float32Array(count * 2);
    if (!this.is_playing() || count === 0) return output;
    const sourceRate = this.get_stream_sampling_rate();
    const step = sourceRate * scale / destinationRate;
    if (!this.prime()) { this.playingValue = false; return output; }

    let produced = 0;
    for (; produced < count; produced += 1) {
      const index = produced * 2;
      output[index] = this.previousLeft + (this.nextLeft - this.previousLeft) * this.phase;
      output[index + 1] = this.previousRight + (this.nextRight - this.previousRight) * this.phase;
      this.phase += step;
      while (this.phase >= 1) {
        this.phase -= 1;
        this.previousLeft = this.nextLeft;
        this.previousRight = this.nextRight;
        const sample = this.nextSourceFrame();
        if (sample === null) {
          this.playingValue = false;
          produced += 1;
          this.playbackPositionValue += produced / destinationRate * scale;
          return output;
        }
        this.nextLeft = sample[0];
        this.nextRight = sample[1];
      }
    }
    this.playbackPositionValue += count / destinationRate * scale;
    return output;
  }

  mix_into(destination: Float32Array, outputRate: number, frameCount: number, rateScale = 1, frameOffset = 0): number {
    if (!(destination instanceof Float32Array)) throw new TypeError('AudioStreamPlaybackResampled destination requires PackedVector2Array-compatible Float32Array.');
    const count = frames('AudioStreamPlaybackResampled frame_count', frameCount);
    const offset = frames('AudioStreamPlaybackResampled frame_offset', frameOffset);
    if ((offset + count) * 2 > destination.length) throw new RangeError('AudioStreamPlaybackResampled destination is too small.');
    const mixed = this.mix(outputRate, count, rateScale);
    destination.set(mixed, offset * 2);
    return this.is_playing() ? count : this.nonzeroFrames(mixed);
  }

  notify_loop(): void { this.loopCountValue += 1; }
  set_playing(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('AudioStreamPlaybackResampled playing requires bool.');
    this.playingValue = value;
  }
  reset_resampler(): void { this.resetResampler(); }

  private prime(): boolean {
    if (this.primed) return true;
    const first = this.nextSourceFrame();
    if (first === null) return false;
    const second = this.nextSourceFrame() ?? first;
    this.previousLeft = first[0]; this.previousRight = first[1];
    this.nextLeft = second[0]; this.nextRight = second[1];
    this.primed = true;
    return true;
  }

  private nextSourceFrame(): readonly [number, number] | null {
    if (this.sourceCursor >= this.sourceFrames && !this.refill()) return null;
    const index = this.sourceCursor * 2;
    const left = this.sourceBuffer[index] ?? 0;
    const right = this.sourceBuffer[index + 1] ?? left;
    this.sourceCursor += 1;
    return [left, right];
  }

  private refill(): boolean {
    const requestFrames = 1024;
    if (this.sourceBuffer.length !== requestFrames * 2) this.sourceBuffer = new Float32Array(requestFrames * 2);
    this.sourceBuffer.fill(0);
    const mixed = this.carrier.mixResampled(this.sourceBuffer, requestFrames);
    this.sourceFrames = frames('AudioStreamPlaybackResampled carrier frame count', mixed);
    if (this.sourceFrames > requestFrames) throw new RangeError('AudioStreamPlaybackResampled carrier returned more frames than requested.');
    this.sourceCursor = 0;
    return this.sourceFrames > 0;
  }

  private resetResampler(): void {
    this.sourceFrames = 0; this.sourceCursor = 0; this.phase = 0;
    this.previousLeft = 0; this.previousRight = 0; this.nextLeft = 0; this.nextRight = 0; this.primed = false;
  }

  private nonzeroFrames(value: Float32Array): number {
    let last = -1;
    for (let index = 0; index < value.length; index += 2) {
      if ((value[index] ?? 0) !== 0 || (value[index + 1] ?? 0) !== 0) last = index / 2;
    }
    return last + 1;
  }
}

export const createGodotAudioStreamPlaybackResampled = (carrier: GodotAudioStreamPlaybackResampledCarrier): GodotAudioStreamPlaybackResampled => new GodotAudioStreamPlaybackResampled(carrier);
