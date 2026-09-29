/**
 * @godot-class AudioServer
 * @role BINDING
 *
 * Godot 4.7's `AudioServer` (`servers/audio/audio_server.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the page's one bus, `Master`: a gain node every
 * player sounds through into the page's output, its volume in decibels and its mute. A player on a
 * bus the layout does not have sounds on Master, as Godot's does (`AudioServer::thread_find_bus_index`
 * falls back to 0). Other buses, their effects and sends are not bound. A singleton: no receiver.
 */

import { godot_audio_bus_set_gain } from './audio-stream';

interface Bus {
  readonly name: string;
  volumeDb: number;
  mute: boolean;
}

const BUSES: Bus[] = [{ name: 'Master', volumeDb: 0, mute: false }];

/** The Master bus's gain on the page's output (`audio-stream.ts`), from its volume and mute. */
function applied(): void {
  const master = BUSES[0] as Bus;
  godot_audio_bus_set_gain(master.mute ? 0 : 10 ** (master.volumeDb / 20));
}

/**
 * @godot AudioServer.get_bus_count
 * @source servers/audio/audio_server.cpp:944
 */
export function get_bus_count(): number {
  return BUSES.length;
}

/**
 * @godot AudioServer.get_bus_name
 * @source servers/audio/audio_server.cpp:992
 */
export function get_bus_name(bus_idx: number): string {
  return BUSES[bus_idx]?.name ?? '';
}

/**
 * @godot AudioServer.get_bus_index
 * @source servers/audio/audio_server.cpp:997
 */
export function get_bus_index(bus_name: string): number {
  return BUSES.findIndex((bus) => bus.name === String(bus_name));
}

/**
 * @godot AudioServer.set_bus_volume_db
 * @source servers/audio/audio_server.cpp:1006
 */
export function set_bus_volume_db(bus_idx: number, volume_db: number): void {
  const bus = BUSES[bus_idx];
  if (bus === undefined) return;
  bus.volumeDb = volume_db;
  applied();
}

/**
 * @godot AudioServer.get_bus_volume_db
 * @source servers/audio/audio_server.cpp:1016
 */
export function get_bus_volume_db(bus_idx: number): number {
  return BUSES[bus_idx]?.volumeDb ?? 0;
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
  const bus = BUSES[bus_idx];
  if (bus === undefined) return;
  bus.mute = enable;
  applied();
}

/**
 * @godot AudioServer.is_bus_mute
 * @source servers/audio/audio_server.cpp:1075
 */
export function is_bus_mute(bus_idx: number): boolean {
  return BUSES[bus_idx]?.mute ?? false;
}
