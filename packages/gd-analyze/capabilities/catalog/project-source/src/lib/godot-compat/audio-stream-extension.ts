import { registerGodotObjectIdentity } from './object';

export interface GodotAudioStreamPlaybackExtensionHooks {
  _start(fromPosition: number): void;
  _stop(): void;
  _is_playing(): boolean;
  _get_loop_count(): number;
  _get_playback_position(): number;
  _seek(time: number): void;
  _mix?(buffer: Float32Array, rateScale: number, frames: number): number;
  _tag_used_streams?(): void;
  _set_sample_playback?(playback: unknown): void;
}

export interface GodotAudioStreamExtensionHooks {
  _instantiate_playback(): GodotAudioStreamPlaybackExtension | null;
  _get_stream_name?(): string;
  _get_length?(): number;
  _is_monophonic?(): boolean;
  _get_bpm?(): number;
  _get_beat_count?(): number;
  _get_bar_beats?(): number;
  _has_loop?(): boolean;
  _get_tags?(): Readonly<Record<string, unknown>>;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

function integer(member: string, value: number, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${member} requires an integer >= ${minimum}.`);
  return value;
}

export class GodotAudioStreamPlaybackExtension {
  private samplePlayback: unknown = null;
  private playingValue = false;
  private positionValue = 0;
  private loopCountValue = 0;

  constructor(private readonly hooks: GodotAudioStreamPlaybackExtensionHooks) {
    if (typeof hooks._start !== 'function' || typeof hooks._stop !== 'function' ||
        typeof hooks._is_playing !== 'function' || typeof hooks._get_loop_count !== 'function' ||
        typeof hooks._get_playback_position !== 'function' || typeof hooks._seek !== 'function') {
      throw new TypeError('AudioStreamPlaybackExtension requires all playback virtual methods.');
    }
    registerGodotObjectIdentity(this, 'AudioStreamPlaybackExtension');
  }

  _start(fromPosition: number): void { this.hooks._start(finite('AudioStreamPlaybackExtension._start', fromPosition, 0)); }
  _stop(): void { this.hooks._stop(); }
  _is_playing(): boolean { return Boolean(this.hooks._is_playing()); }
  _get_loop_count(): number { return integer('AudioStreamPlaybackExtension._get_loop_count', this.hooks._get_loop_count()); }
  _get_playback_position(): number { return finite('AudioStreamPlaybackExtension._get_playback_position', this.hooks._get_playback_position(), 0); }
  _seek(time: number): void { this.hooks._seek(finite('AudioStreamPlaybackExtension._seek', time, 0)); }
  _mix(buffer: Float32Array, rateScale: number, frameCount: number): number {
    if (!(buffer instanceof Float32Array)) throw new TypeError('AudioStreamPlaybackExtension._mix buffer requires Float32Array.');
    const frames = integer('AudioStreamPlaybackExtension._mix frames', frameCount);
    if (buffer.length < frames * 2) throw new RangeError('AudioStreamPlaybackExtension._mix buffer is too small.');
    if (this.hooks._mix === undefined) return 0;
    const mixed = integer('AudioStreamPlaybackExtension._mix result', this.hooks._mix(buffer, finite('AudioStreamPlaybackExtension rate_scale', rateScale, Number.EPSILON), frames));
    if (mixed > frames) throw new RangeError('AudioStreamPlaybackExtension._mix returned more frames than requested.');
    return mixed;
  }
  _tag_used_streams(): void { this.hooks._tag_used_streams?.(); }
  _set_sample_playback(value: unknown): void { this.samplePlayback = value; this.hooks._set_sample_playback?.(value); }

  start(fromPosition = 0): void {
    const offset = finite('AudioStreamPlaybackExtension.start', fromPosition, 0);
    this._start(offset); this.positionValue = offset; this.playingValue = true;
  }
  stop(): void { this._stop(); this.positionValue = 0; this.playingValue = false; }
  is_playing(): boolean { return this._is_playing(); }
  get_loop_count(): number { return this._get_loop_count(); }
  get_playback_position(): number { return this._get_playback_position(); }
  seek(time: number): void { const position = finite('AudioStreamPlaybackExtension.seek', time, 0); this._seek(position); this.positionValue = position; }
  mix(buffer: Float32Array, rateScale: number, frameCount: number): number {
    const mixed = this._mix(buffer, rateScale, frameCount);
    this.positionValue = this._get_playback_position();
    this.loopCountValue = this._get_loop_count();
    this.playingValue = this._is_playing();
    return mixed;
  }
  tag_used_streams(): void { this._tag_used_streams(); }
  set_sample_playback(value: unknown): void { this._set_sample_playback(value); }
  get_sample_playback(): unknown { return this.samplePlayback; }
  get_cached_position(): number { return this.positionValue; }
  get_cached_loop_count(): number { return this.loopCountValue; }
  get_cached_playing(): boolean { return this.playingValue; }
}

export class GodotAudioStreamExtension {
  private streamNameValue = '';
  private tagsValue: Readonly<Record<string, unknown>> = {};

  constructor(private readonly hooks: GodotAudioStreamExtensionHooks) {
    if (typeof hooks._instantiate_playback !== 'function') throw new TypeError('AudioStreamExtension requires _instantiate_playback.');
    registerGodotObjectIdentity(this, 'AudioStreamExtension');
  }

  _instantiate_playback(): GodotAudioStreamPlaybackExtension | null {
    const playback = this.hooks._instantiate_playback();
    if (playback !== null && !(playback instanceof GodotAudioStreamPlaybackExtension)) {
      throw new TypeError('AudioStreamExtension._instantiate_playback must return AudioStreamPlaybackExtension or null.');
    }
    return playback;
  }
  _get_stream_name(): string {
    const value = this.hooks._get_stream_name?.() ?? this.streamNameValue;
    if (typeof value !== 'string') throw new TypeError('AudioStreamExtension._get_stream_name must return String.');
    return value;
  }
  _get_length(): number { return finite('AudioStreamExtension._get_length', this.hooks._get_length?.() ?? 0, 0); }
  _is_monophonic(): boolean { return Boolean(this.hooks._is_monophonic?.() ?? false); }
  _get_bpm(): number { return finite('AudioStreamExtension._get_bpm', this.hooks._get_bpm?.() ?? 0, 0); }
  _get_beat_count(): number { return integer('AudioStreamExtension._get_beat_count', this.hooks._get_beat_count?.() ?? 0); }
  _get_bar_beats(): number { return integer('AudioStreamExtension._get_bar_beats', this.hooks._get_bar_beats?.() ?? 4, 1); }
  _has_loop(): boolean { return Boolean(this.hooks._has_loop?.() ?? false); }
  _get_tags(): Readonly<Record<string, unknown>> {
    const value = this.hooks._get_tags?.() ?? this.tagsValue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('AudioStreamExtension._get_tags must return Dictionary.');
    return { ...value };
  }

  instantiate_playback(): GodotAudioStreamPlaybackExtension | null { return this._instantiate_playback(); }
  get_stream_name(): string { return this._get_stream_name(); }
  set_stream_name(value: string): void { if (typeof value !== 'string') throw new TypeError('AudioStreamExtension.stream_name requires String.'); this.streamNameValue = value; }
  get_length(): number { return this._get_length(); }
  is_monophonic(): boolean { return this._is_monophonic(); }
  get_bpm(): number { return this._get_bpm(); }
  get_beat_count(): number { return this._get_beat_count(); }
  get_bar_beats(): number { return this._get_bar_beats(); }
  has_loop(): boolean { return this._has_loop(); }
  get_tags(): Readonly<Record<string, unknown>> { return this._get_tags(); }
  set_tags(value: Readonly<Record<string, unknown>>): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('AudioStreamExtension.tags requires Dictionary.');
    this.tagsValue = { ...value };
  }
}

export const createGodotAudioStreamPlaybackExtension = (hooks: GodotAudioStreamPlaybackExtensionHooks): GodotAudioStreamPlaybackExtension => new GodotAudioStreamPlaybackExtension(hooks);
export const createGodotAudioStreamExtension = (hooks: GodotAudioStreamExtensionHooks): GodotAudioStreamExtension => new GodotAudioStreamExtension(hooks);
