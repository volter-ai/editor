/**
 * @godot-class AudioServer
 * @role BINDING
 *
 * Godot 4.7's `AudioServer` (`servers/audio/audio_server.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over the page's buses (`audio-stream.ts`): each a
 * gain node sending into its target bus, Master into the page's output; their volumes in decibels,
 * mutes and solos. Bus effects are not bound. A singleton: no receiver.
 */

import { godot_audio_bus_changed, godot_audio_buses } from './audio-stream';

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
  if (bus === undefined) return;
  bus.volumeDb = volume_db;
  godot_audio_bus_changed();
}

/**
 * @godot AudioServer.get_bus_volume_db
 * @source servers/audio/audio_server.cpp:1016
 */
export function get_bus_volume_db(bus_idx: number): number {
  return godot_audio_buses()[bus_idx]?.volumeDb ?? 0;
}

/**
 * `set_bus_volume_db(linear_to_db(volume))` (`audio_server.cpp:1021`).
 *
 * @godot AudioServer.set_bus_volume_linear
 * @source servers/audio/audio_server.cpp:1021
 */
export function set_bus_volume_linear(bus_idx: number, volume_linear: number): void {
  set_bus_volume_db(bus_idx, Math.log(volume_linear) * 8.685889638065037);
}

/**
 * `db_to_linear(get_bus_volume_db())` (`audio_server.cpp:1025`).
 *
 * @godot AudioServer.get_bus_volume_linear
 * @source servers/audio/audio_server.cpp:1025
 */
export function get_bus_volume_linear(bus_idx: number): number {
  return Math.exp(get_bus_volume_db(bus_idx) * 0.11512925464970228);
}

/**
 * @godot AudioServer.set_bus_mute
 * @source servers/audio/audio_server.cpp:1065
 */
export function set_bus_mute(bus_idx: number, enable: boolean): void {
  const bus = godot_audio_buses()[bus_idx];
  if (bus === undefined) return;
  bus.mute = enable;
  godot_audio_bus_changed();
}

/**
 * @godot AudioServer.is_bus_mute
 * @source servers/audio/audio_server.cpp:1075
 */
export function is_bus_mute(bus_idx: number): boolean {
  return godot_audio_buses()[bus_idx]?.mute ?? false;
}
