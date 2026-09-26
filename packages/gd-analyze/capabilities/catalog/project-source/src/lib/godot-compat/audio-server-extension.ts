import { registerGodotObjectIdentity } from './object';

export interface GodotAudioServerExtensionHooks {
  _init?(): void;
  _finish?(): void;
  _lock?(): void;
  _unlock?(): void;
  _get_mix_rate?(): number;
  _get_output_latency?(): number;
  _get_time_to_next_mix?(): number;
  _get_time_since_last_mix?(): number;
  _get_device_list?(): readonly string[];
  _get_device?(): string;
  _set_device?(device: string): void;
  _get_input_device_list?(): readonly string[];
  _get_input_device?(): string;
  _set_input_device?(device: string): void;
  _is_input_available?(): boolean;
  _set_enable_tagging_used_audio_streams?(enabled: boolean): void;
  _register_stream_as_sample?(stream: unknown): unknown;
  _unregister_stream_as_sample?(stream: unknown): void;
  _start_sample_playback?(playback: unknown): unknown;
  _stop_sample_playback?(playback: unknown): void;
  _set_sample_playback_pause?(playback: unknown, paused: boolean): void;
  _is_sample_playback_active?(playback: unknown): boolean;
  _get_sample_playback_position?(playback: unknown): number;
  _update_sample_playback_pitch_scale?(playback: unknown, pitchScale: number): void;
  _update_sample_playback_volume?(playback: unknown, volumeDb: number): void;
  _update_sample_playback_bus_volumes?(playback: unknown, busVolumes: readonly number[]): void;
}

interface AudioBusState {
  name: string;
  volumeDb: number;
  send: string;
  solo: boolean;
  mute: boolean;
  bypassEffects: boolean;
  readonly effects: Array<{ effect: unknown; enabled: boolean }>;
  peakLeftDb: number;
  peakRightDb: number;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

function index(member: string, value: number, length: number, allowEnd = false): number {
  const maximum = allowEnd ? length : length - 1;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`${member} index is out of range.`);
  return value;
}

function name(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires StringName.`);
  return value;
}

function defaultBus(busName = 'Master'): AudioBusState {
  return { name: busName, volumeDb: 0, send: '', solo: false, mute: false, bypassEffects: false, effects: [], peakLeftDb: -200, peakRightDb: -200 };
}

export class GodotAudioServerExtension {
  private readonly buses: AudioBusState[] = [defaultBus()];
  private readonly registeredSamples = new Map<unknown, unknown>();
  private readonly activeSamplePlaybacks = new Set<unknown>();
  private initialized = false;
  private lockDepth = 0;
  private taggingEnabled = false;
  private deviceValue = 'Default';
  private inputDeviceValue = 'Default';
  private playbackSpeedScaleValue = 1;
  private busLayoutValue: unknown = null;

  constructor(private readonly hooks: GodotAudioServerExtensionHooks = {}) {
    registerGodotObjectIdentity(this, 'AudioServerExtension');
  }

  _init(): void { if (!this.initialized) { this.hooks._init?.(); this.initialized = true; } }
  _finish(): void {
    if (!this.initialized) return;
    for (const playback of this.activeSamplePlaybacks) this.hooks._stop_sample_playback?.(playback);
    this.activeSamplePlaybacks.clear(); this.registeredSamples.clear();
    this.hooks._finish?.(); this.initialized = false;
  }
  _lock(): void { if (this.lockDepth++ === 0) this.hooks._lock?.(); }
  _unlock(): void {
    if (this.lockDepth === 0) throw new Error('AudioServerExtension.unlock called without lock.');
    if (--this.lockDepth === 0) this.hooks._unlock?.();
  }
  is_initialized(): boolean { return this.initialized; }
  is_locked(): boolean { return this.lockDepth > 0; }
  get_mix_rate(): number { return finite('AudioServerExtension mix_rate', this.hooks._get_mix_rate?.() ?? 44_100, Number.EPSILON); }
  get_output_latency(): number { return finite('AudioServerExtension output_latency', this.hooks._get_output_latency?.() ?? 0, 0); }
  get_time_to_next_mix(): number { return finite('AudioServerExtension time_to_next_mix', this.hooks._get_time_to_next_mix?.() ?? 0, 0); }
  get_time_since_last_mix(): number { return finite('AudioServerExtension time_since_last_mix', this.hooks._get_time_since_last_mix?.() ?? 0, 0); }

  set_bus_count(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('AudioServerExtension bus_count requires integer >= 1.');
    while (this.buses.length < count) this.buses.push(defaultBus(`Bus ${this.buses.length}`));
    this.buses.splice(count);
    this.buses[0]!.name = 'Master';
  }
  get_bus_count(): number { return this.buses.length; }
  add_bus(atPosition = -1): void {
    const at = atPosition < 0 ? this.buses.length : index('AudioServerExtension.add_bus', atPosition, this.buses.length, true);
    this.buses.splice(at, 0, defaultBus(`Bus ${this.buses.length}`));
    this.buses[0]!.name = 'Master';
  }
  remove_bus(busIndex: number): void {
    const at = index('AudioServerExtension.remove_bus', busIndex, this.buses.length);
    if (at === 0) throw new Error('AudioServerExtension cannot remove Master bus.');
    this.buses.splice(at, 1);
  }
  move_bus(busIndex: number, toIndex: number): void {
    const from = index('AudioServerExtension.move_bus from', busIndex, this.buses.length);
    const to = index('AudioServerExtension.move_bus to', toIndex, this.buses.length);
    if (from === 0 || to === 0) throw new Error('AudioServerExtension cannot move Master bus.');
    const bus = this.buses.splice(from, 1)[0]!; this.buses.splice(to, 0, bus);
  }
  set_bus_name(busIndex: number, value: string): void {
    const at = index('AudioServerExtension.set_bus_name', busIndex, this.buses.length);
    const next = name('AudioServerExtension bus name', value);
    if (at === 0 && next !== 'Master') throw new Error('AudioServerExtension Master bus name is immutable.');
    if (this.get_bus_index(next) >= 0 && this.buses[at]!.name !== next) throw new Error(`AudioServerExtension duplicate bus ${JSON.stringify(next)}.`);
    this.buses[at]!.name = next;
  }
  get_bus_name(busIndex: number): string { return this.bus(busIndex).name; }
  get_bus_index(busName: string): number { return this.buses.findIndex((bus) => bus.name === name('AudioServerExtension.get_bus_index', busName)); }
  set_bus_volume_db(busIndex: number, value: number): void { this.bus(busIndex).volumeDb = finite('AudioServerExtension bus volume', value); }
  get_bus_volume_db(busIndex: number): number { return this.bus(busIndex).volumeDb; }
  set_bus_volume_linear(busIndex: number, value: number): void {
    const linear = finite('AudioServerExtension bus volume_linear', value, 0);
    this.bus(busIndex).volumeDb = linear === 0 ? -200 : 20 * Math.log10(linear);
  }
  get_bus_volume_linear(busIndex: number): number { return 10 ** (this.bus(busIndex).volumeDb / 20); }
  set_bus_send(busIndex: number, value: string): void { this.bus(busIndex).send = name('AudioServerExtension bus send', value); }
  get_bus_send(busIndex: number): string { return this.bus(busIndex).send; }
  set_bus_solo(busIndex: number, value: boolean): void { this.bus(busIndex).solo = Boolean(value); }
  is_bus_solo(busIndex: number): boolean { return this.bus(busIndex).solo; }
  set_bus_mute(busIndex: number, value: boolean): void { this.bus(busIndex).mute = Boolean(value); }
  is_bus_mute(busIndex: number): boolean { return this.bus(busIndex).mute; }
  set_bus_bypass_effects(busIndex: number, value: boolean): void { this.bus(busIndex).bypassEffects = Boolean(value); }
  is_bus_bypassing_effects(busIndex: number): boolean { return this.bus(busIndex).bypassEffects; }
  add_bus_effect(busIndex: number, effect: unknown, atPosition = -1): void {
    if (effect === null || (typeof effect !== 'object' && typeof effect !== 'function')) throw new TypeError('AudioServerExtension bus effect requires AudioEffect.');
    const effects = this.bus(busIndex).effects;
    const at = atPosition < 0 ? effects.length : index('AudioServerExtension.add_bus_effect', atPosition, effects.length, true);
    effects.splice(at, 0, { effect, enabled: true });
  }
  remove_bus_effect(busIndex: number, effectIndex: number): void { const effects = this.bus(busIndex).effects; effects.splice(index('AudioServerExtension.remove_bus_effect', effectIndex, effects.length), 1); }
  get_bus_effect_count(busIndex: number): number { return this.bus(busIndex).effects.length; }
  get_bus_effect(busIndex: number, effectIndex: number): unknown { const effects = this.bus(busIndex).effects; return effects[index('AudioServerExtension.get_bus_effect', effectIndex, effects.length)]!.effect; }
  swap_bus_effects(busIndex: number, first: number, second: number): void {
    const effects = this.bus(busIndex).effects;
    const a = index('AudioServerExtension.swap_bus_effects', first, effects.length);
    const b = index('AudioServerExtension.swap_bus_effects', second, effects.length);
    [effects[a], effects[b]] = [effects[b]!, effects[a]!];
  }
  set_bus_effect_enabled(busIndex: number, effectIndex: number, enabled: boolean): void { const effects = this.bus(busIndex).effects; effects[index('AudioServerExtension.set_bus_effect_enabled', effectIndex, effects.length)]!.enabled = Boolean(enabled); }
  is_bus_effect_enabled(busIndex: number, effectIndex: number): boolean { const effects = this.bus(busIndex).effects; return effects[index('AudioServerExtension.is_bus_effect_enabled', effectIndex, effects.length)]!.enabled; }
  get_bus_peak_volume_left_db(busIndex: number, _channel = 0): number { return this.bus(busIndex).peakLeftDb; }
  get_bus_peak_volume_right_db(busIndex: number, _channel = 0): number { return this.bus(busIndex).peakRightDb; }
  set_bus_peak_volume_db(busIndex: number, left: number, right: number): void { const bus = this.bus(busIndex); bus.peakLeftDb = finite('AudioServerExtension peak left', left); bus.peakRightDb = finite('AudioServerExtension peak right', right); }

  set_bus_layout(value: unknown): void { this.busLayoutValue = value; }
  generate_bus_layout(): unknown { return this.busLayoutValue; }
  set_playback_speed_scale(value: number): void { this.playbackSpeedScaleValue = finite('AudioServerExtension playback_speed_scale', value, Number.EPSILON); }
  get_playback_speed_scale(): number { return this.playbackSpeedScaleValue; }
  get_device_list(): string[] { return [...(this.hooks._get_device_list?.() ?? ['Default'])]; }
  get_device(): string { return this.hooks._get_device?.() ?? this.deviceValue; }
  set_device(value: string): void { this.deviceValue = name('AudioServerExtension device', value); this.hooks._set_device?.(this.deviceValue); }
  get_input_device_list(): string[] { return [...(this.hooks._get_input_device_list?.() ?? ['Default'])]; }
  get_input_device(): string { return this.hooks._get_input_device?.() ?? this.inputDeviceValue; }
  set_input_device(value: string): void { this.inputDeviceValue = name('AudioServerExtension input_device', value); this.hooks._set_input_device?.(this.inputDeviceValue); }
  is_input_available(): boolean { return Boolean(this.hooks._is_input_available?.() ?? false); }
  set_enable_tagging_used_audio_streams(value: boolean): void { this.taggingEnabled = Boolean(value); this.hooks._set_enable_tagging_used_audio_streams?.(this.taggingEnabled); }
  is_tagging_used_audio_streams(): boolean { return this.taggingEnabled; }

  register_stream_as_sample(stream: unknown): unknown {
    if (this.registeredSamples.has(stream)) return this.registeredSamples.get(stream);
    const sample = this.hooks._register_stream_as_sample?.(stream) ?? stream;
    this.registeredSamples.set(stream, sample); return sample;
  }
  unregister_stream_as_sample(stream: unknown): void { this.hooks._unregister_stream_as_sample?.(stream); this.registeredSamples.delete(stream); }
  start_sample_playback(playback: unknown): unknown { const handle = this.hooks._start_sample_playback?.(playback) ?? playback; this.activeSamplePlaybacks.add(playback); return handle; }
  stop_sample_playback(playback: unknown): void { this.hooks._stop_sample_playback?.(playback); this.activeSamplePlaybacks.delete(playback); }
  set_sample_playback_pause(playback: unknown, paused: boolean): void { this.hooks._set_sample_playback_pause?.(playback, Boolean(paused)); }
  is_sample_playback_active(playback: unknown): boolean { return this.hooks._is_sample_playback_active?.(playback) ?? this.activeSamplePlaybacks.has(playback); }
  get_sample_playback_position(playback: unknown): number { return finite('AudioServerExtension sample playback position', this.hooks._get_sample_playback_position?.(playback) ?? 0, 0); }
  update_sample_playback_pitch_scale(playback: unknown, value: number): void { this.hooks._update_sample_playback_pitch_scale?.(playback, finite('AudioServerExtension sample pitch', value, Number.EPSILON)); }
  update_sample_playback_volume(playback: unknown, value: number): void { this.hooks._update_sample_playback_volume?.(playback, finite('AudioServerExtension sample volume', value)); }
  update_sample_playback_bus_volumes(playback: unknown, values: readonly number[]): void { this.hooks._update_sample_playback_bus_volumes?.(playback, values.map((value) => finite('AudioServerExtension bus volume', value))); }

  private bus(busIndex: number): AudioBusState { return this.buses[index('AudioServerExtension bus', busIndex, this.buses.length)]!; }
}

export const createGodotAudioServerExtension = (hooks: GodotAudioServerExtensionHooks = {}): GodotAudioServerExtension => new GodotAudioServerExtension(hooks);
