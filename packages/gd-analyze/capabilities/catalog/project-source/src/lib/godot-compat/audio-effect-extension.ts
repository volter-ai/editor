import { registerGodotObjectIdentity } from './object';

export interface GodotAudioEffectInstanceHooks {
  _process(source: Float32Array, destination: Float32Array, frameCount: number): void;
  _process_silence?(): boolean;
  _reset?(): void;
  _get_latency_frames?(): number;
  _get_tail_frames?(): number;
  _set_mix_rate?(mixRate: number): void;
}

export interface GodotAudioEffectExtensionHooks {
  _instantiate(): GodotAudioEffectInstance | null;
  _get_name?(): string;
  _get_category?(): string;
}

function frames(member: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${member} requires non-negative integer frames.`);
  return value;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

export class GodotAudioEffectInstance {
  private bypassValue = false;
  private enabledValue = true;
  private mixRateValue = 44_100;
  private processedFramesValue = 0;
  private silentFramesValue = 0;
  private peakLeftValue = 0;
  private peakRightValue = 0;

  constructor(private readonly hooks: GodotAudioEffectInstanceHooks) {
    if (typeof hooks._process !== 'function') throw new TypeError('AudioEffectInstance requires _process.');
    registerGodotObjectIdentity(this, 'AudioEffectInstance');
  }

  _process(source: Float32Array, destination: Float32Array, frameCount: number): void {
    const count = frames('AudioEffectInstance._process frame_count', frameCount);
    this.assertBuffer(source, count, 'source');
    this.assertBuffer(destination, count, 'destination');
    this.hooks._process(source, destination, count);
  }
  _process_silence(): boolean { return Boolean(this.hooks._process_silence?.() ?? false); }

  process(source: Float32Array, frameCount = Math.floor(source.length / 2)): Float32Array {
    const count = frames('AudioEffectInstance.process frame_count', frameCount);
    this.assertBuffer(source, count, 'source');
    const destination = new Float32Array(count * 2);
    if (!this.enabledValue || this.bypassValue) destination.set(source.subarray(0, count * 2));
    else this._process(source, destination, count);
    this.processedFramesValue += count;
    this.measure(destination, count);
    return destination;
  }

  process_into(source: Float32Array, destination: Float32Array, frameCount: number, sourceOffset = 0, destinationOffset = 0): number {
    const count = frames('AudioEffectInstance.process_into frame_count', frameCount);
    const sourceStart = frames('AudioEffectInstance source_offset', sourceOffset) * 2;
    const destinationStart = frames('AudioEffectInstance destination_offset', destinationOffset) * 2;
    if (sourceStart + count * 2 > source.length || destinationStart + count * 2 > destination.length) {
      throw new RangeError('AudioEffectInstance process range exceeds its stereo buffers.');
    }
    const input = source.subarray(sourceStart, sourceStart + count * 2);
    const output = this.process(input, count);
    destination.set(output, destinationStart);
    return count;
  }

  process_silence(frameCount: number): Float32Array {
    const count = frames('AudioEffectInstance.process_silence frame_count', frameCount);
    const silence = new Float32Array(count * 2);
    if (this.enabledValue && !this.bypassValue && this._process_silence()) this._process(silence, silence, count);
    this.silentFramesValue += count;
    this.processedFramesValue += count;
    this.measure(silence, count);
    return silence;
  }

  set_enabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('AudioEffectInstance.enabled requires bool.');
    this.enabledValue = value;
  }
  is_enabled(): boolean { return this.enabledValue; }
  set_bypass(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('AudioEffectInstance.bypass requires bool.');
    this.bypassValue = value;
  }
  is_bypassed(): boolean { return this.bypassValue; }
  set_mix_rate(value: number): void {
    this.mixRateValue = finite('AudioEffectInstance.mix_rate', value, Number.EPSILON);
    this.hooks._set_mix_rate?.(this.mixRateValue);
  }
  get_mix_rate(): number { return this.mixRateValue; }
  get_latency_frames(): number { return frames('AudioEffectInstance latency', this.hooks._get_latency_frames?.() ?? 0); }
  get_latency_seconds(): number { return this.get_latency_frames() / this.mixRateValue; }
  get_tail_frames(): number { return frames('AudioEffectInstance tail', this.hooks._get_tail_frames?.() ?? 0); }
  get_tail_seconds(): number { return this.get_tail_frames() / this.mixRateValue; }
  get_processed_frames(): number { return this.processedFramesValue; }
  get_silent_frames(): number { return this.silentFramesValue; }
  get_peak_left(): number { return this.peakLeftValue; }
  get_peak_right(): number { return this.peakRightValue; }
  reset(): void {
    this.hooks._reset?.();
    this.processedFramesValue = 0; this.silentFramesValue = 0; this.peakLeftValue = 0; this.peakRightValue = 0;
  }

  private assertBuffer(value: Float32Array, frameCount: number, member: string): void {
    if (!(value instanceof Float32Array)) throw new TypeError(`AudioEffectInstance ${member} requires Float32Array.`);
    if (value.length < frameCount * 2) throw new RangeError(`AudioEffectInstance ${member} is smaller than requested stereo frame count.`);
  }
  private measure(value: Float32Array, frameCount: number): void {
    for (let frame = 0; frame < frameCount; frame += 1) {
      this.peakLeftValue = Math.max(this.peakLeftValue, Math.abs(value[frame * 2] ?? 0));
      this.peakRightValue = Math.max(this.peakRightValue, Math.abs(value[frame * 2 + 1] ?? 0));
    }
  }
}

export class GodotAudioEffectExtension {
  private nameValue = '';
  private categoryValue = '';
  private readonly instances = new Set<GodotAudioEffectInstance>();

  constructor(private readonly hooks: GodotAudioEffectExtensionHooks) {
    if (typeof hooks._instantiate !== 'function') throw new TypeError('AudioEffectExtension requires _instantiate.');
    registerGodotObjectIdentity(this, 'AudioEffectExtension');
  }

  _instantiate(): GodotAudioEffectInstance | null {
    const instance = this.hooks._instantiate();
    if (instance !== null && !(instance instanceof GodotAudioEffectInstance)) {
      throw new TypeError('AudioEffectExtension._instantiate must return AudioEffectInstance or null.');
    }
    if (instance !== null) this.instances.add(instance);
    return instance;
  }
  instantiate(): GodotAudioEffectInstance | null { return this._instantiate(); }
  get_name(): string {
    const value = this.hooks._get_name?.() ?? this.nameValue;
    if (typeof value !== 'string') throw new TypeError('AudioEffectExtension name must be String.');
    return value;
  }
  set_name(value: string): void { if (typeof value !== 'string') throw new TypeError('AudioEffectExtension name requires String.'); this.nameValue = value; }
  get_category(): string {
    const value = this.hooks._get_category?.() ?? this.categoryValue;
    if (typeof value !== 'string') throw new TypeError('AudioEffectExtension category must be String.');
    return value;
  }
  set_category(value: string): void { if (typeof value !== 'string') throw new TypeError('AudioEffectExtension category requires String.'); this.categoryValue = value; }
  get_instances(): readonly GodotAudioEffectInstance[] { return [...this.instances]; }
  release_instance(value: GodotAudioEffectInstance): boolean { value.reset(); return this.instances.delete(value); }
  reset_instances(): void { for (const instance of this.instances) instance.reset(); }
  set_mix_rate_for_instances(value: number): void { for (const instance of this.instances) instance.set_mix_rate(value); }
}

export const createGodotAudioEffectInstance = (hooks: GodotAudioEffectInstanceHooks): GodotAudioEffectInstance => new GodotAudioEffectInstance(hooks);
export const createGodotAudioEffectExtension = (hooks: GodotAudioEffectExtensionHooks): GodotAudioEffectExtension => new GodotAudioEffectExtension(hooks);
