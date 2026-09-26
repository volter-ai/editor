import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';

export const GodotAudioSampleFormat = {
  FORMAT_8_BITS: 0,
  FORMAT_16_BITS: 1,
  FORMAT_IMA_ADPCM: 2,
} as const;

export const GodotAudioSampleLoopMode = {
  LOOP_DISABLED: 0,
  LOOP_FORWARD: 1,
  LOOP_PINGPONG: 2,
  LOOP_BACKWARD: 3,
} as const;

export interface GodotAudioSamplePlaybackCarrier {
  start(playback: GodotAudioSamplePlayback, offsetSeconds: number): unknown;
  stop(handle: unknown): void;
  setPaused?(handle: unknown, paused: boolean): void;
  setPitchScale?(handle: unknown, pitchScale: number): void;
  setVolumeDb?(handle: unknown, volumeDb: number): void;
  setBus?(handle: unknown, bus: string): void;
  seek?(handle: unknown, offsetSeconds: number): void;
  getPlaybackPosition?(handle: unknown): number;
  isPlaying?(handle: unknown): boolean;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

function integer(member: string, value: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return value;
}

export class GodotAudioSample {
  private formatValue: number = GodotAudioSampleFormat.FORMAT_16_BITS;
  private loopModeValue: number = GodotAudioSampleLoopMode.LOOP_DISABLED;
  private loopBeginValue = 0;
  private loopEndValue = 0;
  private mixRateValue = 44_100;
  private stereoValue = false;
  private dataValue = packedByteArray();

  constructor() { registerGodotObjectIdentity(this, 'AudioSample'); }

  set_format(value: number): void { this.formatValue = integer('AudioSample.format', value, 0, 2); this.clampLoop(); }
  get_format(): number { return this.formatValue; }
  set_loop_mode(value: number): void { this.loopModeValue = integer('AudioSample.loop_mode', value, 0, 3); }
  get_loop_mode(): number { return this.loopModeValue; }
  set_loop_begin(value: number): void { this.loopBeginValue = integer('AudioSample.loop_begin', value); this.clampLoop(); }
  get_loop_begin(): number { return this.loopBeginValue; }
  set_loop_end(value: number): void { this.loopEndValue = integer('AudioSample.loop_end', value); this.clampLoop(); }
  get_loop_end(): number { return this.loopEndValue; }
  set_mix_rate(value: number): void { this.mixRateValue = integer('AudioSample.mix_rate', value, 1, 768_000); }
  get_mix_rate(): number { return this.mixRateValue; }
  set_stereo(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('AudioSample.stereo requires bool.');
    this.stereoValue = value; this.clampLoop();
  }
  is_stereo(): boolean { return this.stereoValue; }
  set_data(value: Iterable<number>): void { this.dataValue = packedByteArray(value); this.clampLoop(); }
  get_data(): PackedByteArray { return packedByteArray(this.dataValue); }
  get_frame_count(): number {
    const channels = this.stereoValue ? 2 : 1;
    if (this.formatValue === GodotAudioSampleFormat.FORMAT_8_BITS) return Math.floor(this.dataValue.length / channels);
    if (this.formatValue === GodotAudioSampleFormat.FORMAT_16_BITS) return Math.floor(this.dataValue.length / (channels * 2));
    return Math.floor((this.dataValue.length * 2) / channels);
  }
  get_length(): number { return this.get_frame_count() / this.mixRateValue; }
  has_loop(): boolean { return this.loopModeValue !== GodotAudioSampleLoopMode.LOOP_DISABLED && this.loopEndValue > this.loopBeginValue; }

  get_channel_data(channel: number): Float32Array {
    const channels = this.stereoValue ? 2 : 1;
    const selected = integer('AudioSample channel', channel, 0, channels - 1);
    const frames = this.get_frame_count();
    const result = new Float32Array(frames);
    if (this.formatValue === GodotAudioSampleFormat.FORMAT_8_BITS) {
      for (let frame = 0; frame < frames; frame += 1) {
        const sample = this.dataValue[frame * channels + selected] ?? 128;
        result[frame] = (sample - 128) / 128;
      }
      return result;
    }
    if (this.formatValue === GodotAudioSampleFormat.FORMAT_16_BITS) {
      const bytes = Uint8Array.from(this.dataValue);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let frame = 0; frame < frames; frame += 1) {
        const offset = (frame * channels + selected) * 2;
        result[frame] = view.getInt16(offset, true) / 32_768;
      }
      return result;
    }
    throw new Error('AudioSample IMA ADPCM channel decoding requires a codec carrier.');
  }

  duplicate(): GodotAudioSample {
    const copy = new GodotAudioSample();
    copy.formatValue = this.formatValue; copy.loopModeValue = this.loopModeValue;
    copy.loopBeginValue = this.loopBeginValue; copy.loopEndValue = this.loopEndValue;
    copy.mixRateValue = this.mixRateValue; copy.stereoValue = this.stereoValue;
    copy.dataValue = packedByteArray(this.dataValue);
    return copy;
  }

  private clampLoop(): void {
    const frames = this.get_frame_count();
    this.loopBeginValue = Math.min(this.loopBeginValue, frames);
    this.loopEndValue = Math.min(this.loopEndValue, frames);
    if (this.loopEndValue < this.loopBeginValue) this.loopEndValue = this.loopBeginValue;
  }
}

export class GodotAudioSamplePlayback {
  private sampleValue: GodotAudioSample | null = null;
  private offsetValue = 0;
  private pitchScaleValue = 1;
  private volumeDbValue = 0;
  private busValue = 'Master';
  private pausedValue = false;
  private handle: unknown = null;

  constructor(private readonly carrier: GodotAudioSamplePlaybackCarrier) {
    registerGodotObjectIdentity(this, 'AudioSamplePlayback');
  }

  set_sample(value: GodotAudioSample | null): void {
    if (value !== null && !(value instanceof GodotAudioSample)) throw new TypeError('AudioSamplePlayback.sample requires AudioSample or null.');
    if (this.is_playing()) this.stop();
    this.sampleValue = value; this.offsetValue = 0;
  }
  get_sample(): GodotAudioSample | null { return this.sampleValue; }
  set_offset(value: number): void {
    const maximum = this.sampleValue?.get_length() ?? Number.POSITIVE_INFINITY;
    const next = finite('AudioSamplePlayback.offset', value, 0);
    if (next > maximum) throw new RangeError('AudioSamplePlayback.offset exceeds sample length.');
    this.offsetValue = next; if (this.handle !== null) this.carrier.seek?.(this.handle, next);
  }
  get_offset(): number { return this.handle === null ? this.offsetValue : this.carrier.getPlaybackPosition?.(this.handle) ?? this.offsetValue; }
  set_pitch_scale(value: number): void { this.pitchScaleValue = finite('AudioSamplePlayback.pitch_scale', value, Number.EPSILON); if (this.handle !== null) this.carrier.setPitchScale?.(this.handle, this.pitchScaleValue); }
  get_pitch_scale(): number { return this.pitchScaleValue; }
  set_volume_db(value: number): void { this.volumeDbValue = finite('AudioSamplePlayback.volume_db', value); if (this.handle !== null) this.carrier.setVolumeDb?.(this.handle, value); }
  get_volume_db(): number { return this.volumeDbValue; }
  set_bus(value: string): void { if (typeof value !== 'string' || value === '') throw new TypeError('AudioSamplePlayback.bus requires nonempty StringName.'); this.busValue = value; if (this.handle !== null) this.carrier.setBus?.(this.handle, value); }
  get_bus(): string { return this.busValue; }
  set_paused(value: boolean): void { if (typeof value !== 'boolean') throw new TypeError('AudioSamplePlayback.paused requires bool.'); this.pausedValue = value; if (this.handle !== null) this.carrier.setPaused?.(this.handle, value); }
  is_paused(): boolean { return this.pausedValue; }

  play(fromPosition = this.offsetValue): void {
    if (this.sampleValue === null) throw new Error('AudioSamplePlayback.play requires an assigned sample.');
    if (this.handle !== null) this.carrier.stop(this.handle);
    this.offsetValue = finite('AudioSamplePlayback from_position', fromPosition, 0);
    this.handle = this.carrier.start(this, this.offsetValue);
    this.carrier.setPitchScale?.(this.handle, this.pitchScaleValue);
    this.carrier.setVolumeDb?.(this.handle, this.volumeDbValue);
    this.carrier.setBus?.(this.handle, this.busValue);
    if (this.pausedValue) this.carrier.setPaused?.(this.handle, true);
  }
  stop(): void { if (this.handle !== null) this.carrier.stop(this.handle); this.handle = null; this.offsetValue = 0; }
  is_playing(): boolean { return this.handle !== null && (this.carrier.isPlaying?.(this.handle) ?? true); }
  get_native_handle(): unknown { return this.handle; }
}

export const createGodotAudioSample = (): GodotAudioSample => new GodotAudioSample();
export const createGodotAudioSamplePlayback = (carrier: GodotAudioSamplePlaybackCarrier): GodotAudioSamplePlayback => new GodotAudioSamplePlayback(carrier);
