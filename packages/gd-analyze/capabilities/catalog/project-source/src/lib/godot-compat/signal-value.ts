/**
 * @godot-class Signal
 * @role BINDING
 *
 * Godot 4.7's `Signal` as a value a script holds (`core/variant/callable.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a script-declared signal's field, and its
 * `emit` / `connect` / `disconnect` / `is_connected` over compat's signal (`signal.ts`), whose
 * Callables are JS functions (`callable.ts`: a script function named as a value is one function
 * per object and method, so it keeps Godot's Callable equality).
 */

import { createSignal, emitRetainedGodotSignal, type GodotSignal } from './signal';

/**
 * A script-declared signal (`signal name(...)`): its field holds the Signal, whose emitter
 * `Signal.emit` reaches (`emitRetainedGodotSignal`).
 *
 * @godot Signal (protocol)
 * @source modules/gdscript/gdscript.cpp:1651 (a script signal reads as Signal(owner, name))
 */
export function godot_script_signal(): GodotSignal<readonly unknown[]> {
  return createSignal<readonly unknown[]>().signal;
}

/** `Error` codes a script reads (`core/error/error_list.h`). */
const OK = 0;
const ERR_INVALID_PARAMETER = 31;

/**
 * Calls every connected Callable with the arguments, one-shot slots disconnected first.
 *
 * @godot Signal.emit
 * @source core/variant/callable.cpp:534
 */
export function emit(self: GodotSignal<readonly unknown[]>, ...args: readonly unknown[]): void {
  emitRetainedGodotSignal(self, args);
}

/**
 * Connects the Callable with Godot's flags (`CONNECT_ONE_SHOT` 4, `CONNECT_REFERENCE_COUNTED` 8;
 * `CONNECT_DEFERRED` 1 is not bound); a Callable already connected without the reference-counted
 * flag fails with `ERR_INVALID_PARAMETER` (`object.cpp:1561`).
 *
 * @godot Signal.connect
 * @source core/variant/callable.cpp:543
 */
export function connect(self: GodotSignal<readonly unknown[]>, callable: (...args: readonly unknown[]) => unknown, flags = 0): number {
  if ((flags & 1) !== 0) throw new Error('godot-compat: CONNECT_DEFERRED is not bound.');
  if (self.isConnected(callable) && (flags & 8) === 0) return ERR_INVALID_PARAMETER;
  self.connect((...args) => void callable(...args), { flags, oneShot: (flags & 4) !== 0 }, callable);
  return OK;
}

/**
 * A Callable not connected fails and changes nothing.
 *
 * @godot Signal.disconnect
 * @source core/variant/callable.cpp:550
 */
export function disconnect(self: GodotSignal<readonly unknown[]>, callable: (...args: readonly unknown[]) => unknown): void {
  if (!self.isConnected(callable)) return;
  self.disconnect(callable);
}

/**
 * @godot Signal.is_connected
 * @source core/variant/callable.cpp:556
 */
export function is_connected(self: GodotSignal<readonly unknown[]>, callable: (...args: readonly unknown[]) => unknown): boolean {
  return self.isConnected(callable);
}
