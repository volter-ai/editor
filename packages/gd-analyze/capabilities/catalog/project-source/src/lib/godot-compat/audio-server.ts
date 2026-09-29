/**
 * @godot-class AudioServer
 * @role BINDING
 *
 * Godot 4.7's `AudioServer` (`servers/audio/audio_server.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over the page's buses (`audio-stream.ts`): a bus's
 * volume is its volume gain node's value in decibels, its mute its mute gain node. Bus effects are
 * not bound. A singleton: no receiver.
 */

import { godot_audio_buses } from './audio-stream';

/**
 * @godot AudioServer.get_bus_count
 * @source servers/audio/audio_server.cpp:944
 */
export function get_bus_count(): number {
  return godot_audio_buses().length;
}

/**
 * @godot AudioServer.get_bus_name
 * @source servers/audio/audio_server.cpp:992
 */
export function get_bus_name(bus_idx: number): string {
  return godot_audio_buses()[bus_idx]?.name ?? '';
}

/**
 * @godot AudioServer.get_bus_index
 * @source servers/audio/audio_server.cpp:997
 */
export function get_bus_index(bus_name: string): number {
  return godot_audio_buses().findIndex((bus) => bus.name === String(bus_name));
}

/**
 * @godot AudioServer.set_bus_volume_db
 * @source servers/audio/audio_server.cpp:1006
 */
export function set_bus_volume_db(bus_idx: number, volume_db: number): void {
  const bus = godot_audio_buses()[bus_idx];
  if (bus !== undefined) bus.volume.gain.value = 10 ** (volume_db / 20);
}

/**
 * @godot AudioServer.get_bus_volume_db
 * @source servers/audio/audio_server.cpp:1016
 */
export function get_bus_volume_db(bus_idx: number): number {
  const bus = godot_audio_buses()[bus_idx];
  return bus === undefined ? 0 : 20 * Math.log10(bus.volume.gain.value);
}

/**
 * @godot AudioServer.set_bus_volume_linear
 * @source servers/audio/audio_server.cpp:1021
 */
export function set_bus_volume_linear(bus_idx: number, volume_linear: number): void {
  const bus = godot_audio_buses()[bus_idx];
  if (bus !== undefined) bus.volume.gain.value = volume_linear;
}

/**
 * @godot AudioServer.get_bus_volume_linear
 * @source servers/audio/audio_server.cpp:1025
 */
export function get_bus_volume_linear(bus_idx: number): number {
  return godot_audio_buses()[bus_idx]?.volume.gain.value ?? 1;
}

/**
 * @godot AudioServer.set_bus_mute
 * @source servers/audio/audio_server.cpp:1065
 */
export function set_bus_mute(bus_idx: number, enable: boolean): void {
  const bus = godot_audio_buses()[bus_idx];
  if (bus !== undefined) bus.mute.gain.value = enable ? 0 : 1;
}

/**
 * @godot AudioServer.is_bus_mute
 * @source servers/audio/audio_server.cpp:1075
 */
export function is_bus_mute(bus_idx: number): boolean {
  return godot_audio_buses()[bus_idx]?.mute.gain.value === 0;
}
