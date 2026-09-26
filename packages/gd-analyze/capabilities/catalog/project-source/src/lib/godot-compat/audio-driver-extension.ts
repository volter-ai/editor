import { registerGodotObjectIdentity } from './object';

export interface GodotAudioDriverExtensionHooks {
  _get_name(): string;
  _init(): number;
  _start(): void;
  _finish(): void;
  _get_mix_rate(): number;
  _get_speaker_mode(): number;
  _lock?(): void;
  _unlock?(): void;
  _get_latency?(): number;
  _get_output_device_list?(): readonly string[];
  _get_output_device?(): string;
  _set_output_device?(device: string): void;
  _get_input_device_list?(): readonly string[];
  _get_input_device?(): string;
  _set_input_device?(device: string): void;
  _input_start?(): number;
  _input_stop?(): number;
  _submit_output?(interleaved: Float32Array, frameCount: number, channelCount: number): void;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

function integer(member: string, value: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${member} requires integer in [${minimum}, ${maximum}].`);
  return value;
}

function channelsForSpeakerMode(mode: number): number {
  switch (mode) {
    case 0: return 2;
    case 1: return 4;
    case 2: return 6;
    case 3: return 8;
    default: throw new RangeError('AudioDriverExtension speaker mode requires STEREO, SURROUND_31, SURROUND_51, or SURROUND_71.');
  }
}

export class GodotAudioDriverExtension {
  private initialized = false;
  private started = false;
  private captureActive = false;
  private lockDepth = 0;
  private outputDeviceValue = 'Default';
  private inputDeviceValue = 'Default';
  private captureBuffer = new Float32Array(0);
  private captureRead = 0;
  private captureWrite = 0;
  private captureAvailable = 0;
  private captureChannels = 2;
  private renderedFrames = 0;
  private underrunCount = 0;

  constructor(private readonly hooks: GodotAudioDriverExtensionHooks) {
    if (typeof hooks._get_name !== 'function' || typeof hooks._init !== 'function' ||
        typeof hooks._start !== 'function' || typeof hooks._finish !== 'function' ||
        typeof hooks._get_mix_rate !== 'function' || typeof hooks._get_speaker_mode !== 'function') {
      throw new TypeError('AudioDriverExtension requires name/init/start/finish/mix-rate/speaker-mode virtuals.');
    }
    registerGodotObjectIdentity(this, 'AudioDriverExtension');
  }

  _get_name(): string {
    const value = this.hooks._get_name();
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('AudioDriverExtension._get_name must return nonempty String.');
    return value;
  }
  _init(): number { return integer('AudioDriverExtension._init result', this.hooks._init()); }
  _start(): void { this.hooks._start(); }
  _finish(): void { this.hooks._finish(); }
  _get_mix_rate(): number { return finite('AudioDriverExtension._get_mix_rate', this.hooks._get_mix_rate(), Number.EPSILON); }
  _get_speaker_mode(): number { const mode = integer('AudioDriverExtension._get_speaker_mode', this.hooks._get_speaker_mode(), 0, 3); channelsForSpeakerMode(mode); return mode; }
  _lock(): void { if (this.lockDepth++ === 0) this.hooks._lock?.(); }
  _unlock(): void { if (this.lockDepth === 0) throw new Error('AudioDriverExtension._unlock called without lock.'); if (--this.lockDepth === 0) this.hooks._unlock?.(); }

  initialize(): number {
    if (this.initialized) return 0;
    const error = this._init();
    if (error === 0) this.initialized = true;
    return error;
  }
  start(): void {
    if (!this.initialized) throw new Error('AudioDriverExtension.start requires initialize first.');
    if (this.started) return;
    this._start(); this.started = true;
  }
  finish(): void {
    if (!this.initialized) return;
    if (this.captureActive) this.input_stop();
    this._finish(); this.started = false; this.initialized = false; this.reset_capture_buffer();
  }
  is_initialized(): boolean { return this.initialized; }
  is_started(): boolean { return this.started; }
  get_name(): string { return this._get_name(); }
  get_mix_rate(): number { return this._get_mix_rate(); }
  get_speaker_mode(): number { return this._get_speaker_mode(); }
  get_channel_count(): number { return channelsForSpeakerMode(this.get_speaker_mode()); }
  get_latency(): number { return finite('AudioDriverExtension latency', this.hooks._get_latency?.() ?? 0, 0); }

  mix(frameCount: number, mixer: (destination: Float32Array, frameCount: number, channelCount: number) => number | void): Float32Array {
    if (!this.started) throw new Error('AudioDriverExtension.mix requires a started driver.');
    const frames = integer('AudioDriverExtension frame_count', frameCount);
    if (typeof mixer !== 'function') throw new TypeError('AudioDriverExtension mixer requires Callable.');
    const channels = this.get_channel_count();
    const output = new Float32Array(frames * channels);
    this._lock();
    try {
      const producedValue = mixer(output, frames, channels);
      const produced = producedValue === undefined ? frames : integer('AudioDriverExtension produced frames', producedValue, 0, frames);
      if (produced < frames) this.underrunCount += 1;
      this.renderedFrames += produced;
    } finally {
      this._unlock();
    }
    this.hooks._submit_output?.(output, frames, channels);
    return output;
  }

  get_output_device_list(): string[] { return [...(this.hooks._get_output_device_list?.() ?? ['Default'])]; }
  get_output_device(): string { return this.hooks._get_output_device?.() ?? this.outputDeviceValue; }
  set_output_device(value: string): void {
    if (typeof value !== 'string') throw new TypeError('AudioDriverExtension output device requires String.');
    this.outputDeviceValue = value; this.hooks._set_output_device?.(value);
  }
  get_input_device_list(): string[] { return [...(this.hooks._get_input_device_list?.() ?? ['Default'])]; }
  get_input_device(): string { return this.hooks._get_input_device?.() ?? this.inputDeviceValue; }
  set_input_device(value: string): void {
    if (typeof value !== 'string') throw new TypeError('AudioDriverExtension input device requires String.');
    this.inputDeviceValue = value; this.hooks._set_input_device?.(value);
  }

  input_start(bufferFrames = 4096, channelCount = 2): number {
    if (!this.initialized) throw new Error('AudioDriverExtension.input_start requires initialize first.');
    const frames = integer('AudioDriverExtension input buffer frames', bufferFrames, 1);
    this.captureChannels = integer('AudioDriverExtension input channels', channelCount, 1, 8);
    const error = integer('AudioDriverExtension._input_start result', this.hooks._input_start?.() ?? 0);
    if (error !== 0) return error;
    this.captureBuffer = new Float32Array(frames * this.captureChannels);
    this.captureRead = 0; this.captureWrite = 0; this.captureAvailable = 0; this.captureActive = true;
    return 0;
  }
  input_stop(): number {
    if (!this.captureActive) return 0;
    const error = integer('AudioDriverExtension._input_stop result', this.hooks._input_stop?.() ?? 0);
    this.captureActive = false; this.reset_capture_buffer();
    return error;
  }
  is_input_active(): boolean { return this.captureActive; }
  get_input_channel_count(): number { return this.captureChannels; }
  input_buffer_write(interleaved: Float32Array): number {
    if (!this.captureActive) return 0;
    if (!(interleaved instanceof Float32Array) || interleaved.length % this.captureChannels !== 0) {
      throw new TypeError('AudioDriverExtension input buffer requires interleaved Float32Array aligned to channel count.');
    }
    let written = 0;
    for (const sample of interleaved) {
      if (this.captureAvailable === this.captureBuffer.length) {
        this.captureRead = (this.captureRead + 1) % this.captureBuffer.length;
        this.captureAvailable -= 1;
      }
      this.captureBuffer[this.captureWrite] = sample;
      this.captureWrite = (this.captureWrite + 1) % this.captureBuffer.length;
      this.captureAvailable += 1; written += 1;
    }
    return written / this.captureChannels;
  }
  input_buffer_read(frameCount: number): Float32Array {
    const requested = integer('AudioDriverExtension input read frames', frameCount);
    const availableFrames = Math.floor(this.captureAvailable / this.captureChannels);
    const count = Math.min(requested, availableFrames);
    const result = new Float32Array(count * this.captureChannels);
    for (let index = 0; index < result.length; index += 1) {
      result[index] = this.captureBuffer[this.captureRead] ?? 0;
      this.captureRead = (this.captureRead + 1) % this.captureBuffer.length;
      this.captureAvailable -= 1;
    }
    return result;
  }
  get_input_available_frames(): number { return Math.floor(this.captureAvailable / this.captureChannels); }
  get_rendered_frames(): number { return this.renderedFrames; }
  get_underrun_count(): number { return this.underrunCount; }
  reset_statistics(): void { this.renderedFrames = 0; this.underrunCount = 0; }

  private reset_capture_buffer(): void { this.captureBuffer = new Float32Array(0); this.captureRead = 0; this.captureWrite = 0; this.captureAvailable = 0; }
}

export const createGodotAudioDriverExtension = (hooks: GodotAudioDriverExtensionHooks): GodotAudioDriverExtension => new GodotAudioDriverExtension(hooks);
