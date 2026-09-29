/**
 * @godot-class Time
 * @role BINDING
 *
 * Godot 4.7's `Time` singleton (`core/os/time.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the ticks since the engine started, R3F's clock
 * (`engine.ts`).
 */

import { godot_engine_ticks } from './engine';

/**
 * @godot Time.get_ticks_msec
 * @source core/os/time.cpp:383
 */
export function get_ticks_msec(): number {
  return Math.floor(godot_engine_ticks() * 1000);
}

/**
 * @godot Time.get_ticks_usec
 * @source core/os/time.cpp:387
 */
export function get_ticks_usec(): number {
  return Math.floor(godot_engine_ticks() * 1_000_000);
}
