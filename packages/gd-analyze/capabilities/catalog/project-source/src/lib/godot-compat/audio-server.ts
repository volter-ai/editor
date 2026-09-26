/**
 * The high-reach Godot `AudioServer` bus surface over the port's one real Web Audio graph.
 *
 * Godot 3.6 `servers/audio_server.cpp` and Godot 4.4 `servers/audio_server.cpp` keep the bus
 * index/name/state on the mixer bus itself. This module does the same: it never mirrors a second
 * bus table. Reads and writes go through {@link GodotAudioGraph.buses}, whose entries own the
 * GainNodes every translated player is connected to.
 */

import type { GodotAudioEffectResource } from './audio-effects';
import type { GodotAudioGraph } from './audio-graph';

interface AudioServerRuntimeState {
  readonly solo: Set<number>;
  readonly bypass: Set<number>;
  playbackSpeedScale: number;
  lastMixTime: number;
  locked: boolean;
}

const AUDIO_SERVER_STATE = new WeakMap<GodotAudioGraph, AudioServerRuntimeState>();

function stateOf(graph: GodotAudioGraph): AudioServerRuntimeState {
  let state = AUDIO_SERVER_STATE.get(graph);
  if (state !== undefined) return state;
  state = { solo: new Set(), bypass: new Set(), playbackSpeedScale: 1, lastMixTime: graph.context.currentTime, locked: false };
  AUDIO_SERVER_STATE.set(graph, state);
  return state;
}

export function audioServerAddBus(graph: GodotAudioGraph, atPosition = -1): void {
  graph.addBus(atPosition);
}

export function audioServerSetBusName(graph: GodotAudioGraph, index: number, name: string): void {
  graph.setBusName(index, name);
}

export function audioServerSetBusSend(graph: GodotAudioGraph, index: number, send: string): void {
  graph.setBusSend(index, send);
}

export function audioServerAddBusEffect(
  graph: GodotAudioGraph,
  busIndex: number,
  effect: GodotAudioEffectResource,
  atPosition = -1,
): void {
  graph.addBusEffect(busIndex, effect, atPosition);
}

export function audioServerGetBusEffect(
  graph: GodotAudioGraph,
  busIndex: number,
  effectIndex: number,
): GodotAudioEffectResource {
  return graph.getBusEffect(busIndex, effectIndex);
}

export function audioServerGetBusEffectCount(graph: GodotAudioGraph, busIndex: number): number {
  return graph.getBusEffectCount(busIndex);
}

export function audioServerRemoveBusEffect(
  graph: GodotAudioGraph,
  busIndex: number,
  effectIndex: number,
): void {
  graph.removeBusEffect(busIndex, effectIndex);
}

export function audioServerSetBusEffectEnabled(
  graph: GodotAudioGraph,
  busIndex: number,
  effectIndex: number,
  enabled: boolean,
): void {
  graph.setBusEffectEnabled(busIndex, effectIndex, enabled);
}

/** Exact StringName lookup. Godot returns `-1` for an unknown name. */
export function audioServerGetBusIndex(graph: GodotAudioGraph, name: string): number {
  if (typeof name !== 'string') {
    throw new Error(`AudioServer.get_bus_index requires a StringName; received ${String(name)}.`);
  }
  return graph.busIndex(name);
}

/** Godot's indexed bus-name read. Invalid indexes fail loudly at the same source boundary. */
export function audioServerGetBusName(graph: GodotAudioGraph, index: number): string {
  return graph.bus(index).name;
}

/** Godot permits every real decibel value plus `-INF`; NaN and +INF are not mixer values. */
export function audioServerSetBusVolumeDb(
  graph: GodotAudioGraph,
  index: number,
  volumeDb: number,
): void {
  graph.bus(index).volumeDb = volumeDb;
}

/** Read the authored/runtime dB value, not the effective zero produced by mute. */
export function audioServerGetBusVolumeDb(graph: GodotAudioGraph, index: number): number {
  return graph.bus(index).volumeDb;
}

/** Godot 4's linear bus-volume alias over the same retained decibel value. */
export function audioServerSetBusVolumeLinear(
  graph: GodotAudioGraph,
  index: number,
  volume: number,
): void {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0) {
    throw new RangeError(`AudioServer.set_bus_volume_linear requires a finite non-negative float; received ${String(volume)}.`);
  }
  graph.bus(index).volumeDb = volume === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(volume);
}

export function audioServerGetBusVolumeLinear(graph: GodotAudioGraph, index: number): number {
  const db = graph.bus(index).volumeDb;
  return db === Number.NEGATIVE_INFINITY ? 0 : 10 ** (db / 20);
}

/** The authored/runtime send StringName remains readable even when playback falls back to Master. */
export function audioServerGetBusSend(graph: GodotAudioGraph, index: number): string {
  return graph.bus(index).send;
}

/** Mute changes the real bus gain while preserving its stored authored/runtime dB value. */
export function audioServerSetBusMute(
  graph: GodotAudioGraph,
  index: number,
  enabled: boolean,
): void {
  if (typeof enabled !== 'boolean') {
    throw new Error(`AudioServer.set_bus_mute requires a bool; received ${String(enabled)}.`);
  }
  graph.bus(index).muted = enabled;
}

export function audioServerIsBusMute(graph: GodotAudioGraph, index: number): boolean {
  return graph.bus(index).muted;
}

export function audioServerGetBusEffectInstance(
  graph: GodotAudioGraph,
  busIndex: number,
  effectIndex: number,
): unknown {
  return graph.busEffectInstance(busIndex, effectIndex);
}

/** The live mixer bus count; this is the graph's authored/runtime bus array, not a shadow copy. */
export function audioServerGetBusCount(graph: GodotAudioGraph): number {
  return graph.buses.length;
}

/** Web Audio renders at the AudioContext's immutable hardware-facing sample rate. */
export function audioServerGetMixRate(graph: GodotAudioGraph): number {
  const rate = graph.context.sampleRate;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`AudioServer.get_mix_rate received an invalid AudioContext sample rate ${String(rate)}.`);
  }
  return rate;
}

/**
 * Translate the output channel layout to Godot's SpeakerMode enum.
 *
 * Web Audio exposes the actual destination channel count synchronously. Layouts Godot cannot
 * name remain loud rather than being mislabeled as stereo.
 */
export function audioServerGetSpeakerMode(graph: GodotAudioGraph): number {
  const channels = graph.context.destination.channelCount;
  switch (channels) {
    case 1:
    case 2:
      return 0; // SPEAKER_MODE_STEREO (mono Web outputs are mixed through the stereo mode).
    case 4:
      return 1; // SPEAKER_SURROUND_31.
    case 6:
      return 2; // SPEAKER_SURROUND_51.
    case 8:
      return 3; // SPEAKER_SURROUND_71.
    default:
      throw new Error(
        `AudioServer.get_speaker_mode cannot represent the browser output's ${String(channels)} channels in Godot's SpeakerMode enum.`,
      );
  }
}

/** The browser audio device's reported output latency, in seconds. */
export function audioServerGetOutputLatency(graph: GodotAudioGraph): number {
  const context = graph.context as AudioContext & { readonly outputLatency?: number };
  if (typeof context.outputLatency !== 'number' || !Number.isFinite(context.outputLatency) || context.outputLatency < 0) {
    throw new Error('AudioServer.get_output_latency is unavailable because this browser does not expose AudioContext.outputLatency.');
  }
  return context.outputLatency;
}

export function audioServerSetBusSolo(graph: GodotAudioGraph, index: number, enabled: boolean): void {
  graph.bus(index);
  if (typeof enabled !== 'boolean') throw new TypeError('AudioServer.set_bus_solo requires bool.');
  if (enabled) stateOf(graph).solo.add(index);
  else stateOf(graph).solo.delete(index);
}

export function audioServerIsBusSolo(graph: GodotAudioGraph, index: number): boolean {
  graph.bus(index);
  return stateOf(graph).solo.has(index);
}

export function audioServerSetBusBypassEffects(graph: GodotAudioGraph, index: number, enabled: boolean): void {
  graph.bus(index);
  if (typeof enabled !== 'boolean') throw new TypeError('AudioServer.set_bus_bypass_effects requires bool.');
  if (enabled) stateOf(graph).bypass.add(index);
  else stateOf(graph).bypass.delete(index);
}

export function audioServerIsBusBypassingEffects(graph: GodotAudioGraph, index: number): boolean {
  graph.bus(index);
  return stateOf(graph).bypass.has(index);
}

export function audioServerIsBusEffectEnabled(graph: GodotAudioGraph, busIndex: number, effectIndex: number): boolean {
  const instance = graph.busEffectInstance(busIndex, effectIndex) as { readonly enabled?: boolean } | null;
  return instance?.enabled ?? true;
}

export function audioServerSetPlaybackSpeedScale(graph: GodotAudioGraph, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('AudioServer.playback_speed_scale requires a positive finite float.');
  stateOf(graph).playbackSpeedScale = value;
}

export function audioServerGetPlaybackSpeedScale(graph: GodotAudioGraph): number {
  return stateOf(graph).playbackSpeedScale;
}

export function audioServerLock(graph: GodotAudioGraph): void {
  stateOf(graph).locked = true;
}

export function audioServerUnlock(graph: GodotAudioGraph): void {
  stateOf(graph).locked = false;
}

export function audioServerGetDriverName(graph: GodotAudioGraph): string {
  void graph.context;
  return 'Web Audio';
}

export function audioServerGetTimeSinceLastMix(graph: GodotAudioGraph): number {
  const state = stateOf(graph);
  return Math.max(0, graph.context.currentTime - state.lastMixTime);
}

export function audioServerGetTimeToNextMix(graph: GodotAudioGraph): number {
  return Math.max(0, 128 / audioServerGetMixRate(graph) - audioServerGetTimeSinceLastMix(graph));
}

export function audioServerGetOutputDeviceList(graph: GodotAudioGraph): readonly string[] {
  void graph.context;
  return ['Default'];
}

export function audioServerGetOutputDevice(graph: GodotAudioGraph): string {
  void graph.context;
  return 'Default';
}

export function audioServerSetOutputDevice(graph: GodotAudioGraph, name: string): void {
  void graph.context;
  if (name !== 'Default') throw new Error('AudioServer output device selection is unavailable without asynchronous browser media-device authority.');
}
