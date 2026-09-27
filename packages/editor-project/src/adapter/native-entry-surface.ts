/**
 * THE ENTRY MODULE'S DECLARED SURFACE — what a project's root entry may export
 * for its own debugger, and the already-validated bindings a host hands on.
 *
 * This is the contract, not an implementation: a root entry writes
 *
 *   export { debug } from './commands';
 *
 * and the command module imports no vgai API — its functions are the
 * application's own functions over its own stores. The READER that validates
 * one of these exports, and the adapter that projects it onto the session's
 * debug/input doors, are the game runtime's
 * (`@volter/editor-game/runtime/adapter/native-debug-module`).
 */

import type { ContractSystemEmptySlot } from './ingest/contract-system-slots';
import type { SystemAdapters } from './system-adapter';

export const NATIVE_INPUT_VALUE_TYPES = [
  'digital',
  'scalar',
  'vector2',
  'pointerDelta',
  'pointerPosition',
] as const;
export type NativeInputValueType = (typeof NATIVE_INPUT_VALUE_TYPES)[number];
export type NativeInputValue = boolean | number | { readonly x: number; readonly y: number };

/** A table may be a THUNK, evaluated once at install (after every project
 *  module has run), so a game whose declarations accrete during module
 *  evaluation — the dev-tools registry's `stat()`/`cheat()` lines beside each
 *  mechanic — hands a complete snapshot without ordering its own imports
 *  around the debugger. */
export type NativeTable<T> = Readonly<Record<string, T>> | (() => Readonly<Record<string, T>>);

/** A command is a plain function, or `{ description, run }` when it wants the
 *  session's `game.commands()` listing to say what it does. Argument
 *  validation stays inside the function — the game's words at the game's
 *  door. */
export type NativeCommandEntry =
  | ((...args: unknown[]) => unknown)
  | { readonly description?: string; readonly run: (...args: unknown[]) => unknown };

export interface NativeDebugModule {
  readonly commands?: NativeTable<NativeCommandEntry>;
  readonly state?: NativeTable<() => unknown>;
  readonly input?: {
    /** May be a thunk, read LIVE on every use — an app whose action set loads
     *  asynchronously (an input map fetched at boot) answers with what it has
     *  NOW rather than freezing the empty pre-load set at install. */
    readonly actions:
      | Readonly<Record<string, NativeInputValueType>>
      | (() => Readonly<Record<string, NativeInputValueType>>);
    readonly set: (action: string, value: NativeInputValue) => void;
    readonly clear: () => void;
    /** Optional native-scheduler operation. The adapter never synthesizes one. */
    readonly tap?: (action: string) => void;
    /** Optional native-scheduler operation. The adapter never adds a host phase. */
    readonly scheduleAtTick?: (tick: number, action: string, value: NativeInputValue) => void;
  };
  /** The app's own EVENT STREAM, bridged into the session's tick-stamped
   *  event log at install — the entry-export replacement for the react
   *  emit hook. The app owns the emitter; the host only forwards. */
  readonly events?: {
    readonly subscribe: (listener: (event: string, detail?: unknown) => void) => () => void;
  };
  /**
   * `false` while the app is intentionally BETWEEN worlds — a scene remount in flight (a
   * `reload_current_scene`-style restart unmounts the running scene and the fresh one arrives
   * on an ASYNC React commit). Session tick drivers (`runTicksWhenSettled`, behind both
   * run-ticks doors) wait for `true` before each tick, so which tick first runs the fresh
   * world is a function of the sim, never of wall timing between driver calls. Omitted =
   * always settled.
   */
  readonly settled?: () => boolean;
}

/** One root's `debug` export, already read and validated, with the root it came from. */
export interface NativeDebugBinding {
  readonly rootId: string;
  readonly debug: NativeDebugModule;
}

/** One root's statically declared, already-validated system-adapter slots. */
export interface NativeSystemsBinding {
  readonly rootId: string;
  readonly slots: Readonly<Partial<SystemAdapters>>;
  /**
   * The slots this root's `systems` table answered with `absent(reason)` — the
   * positive absences, in the game's own words.
   *
   * They are carried rather than dropped because they are the ONLY thing that
   * can tell a coverage reader "this game has no networking" apart from "nobody
   * ever looked". Nothing is installed for them (that would be the stub adapter
   * `absent()`'s own comment forbids); they exist to be READ — through
   * `binding.observation.entrySystems`, which is the product door the coverage
   * table renders from.
   */
  readonly absent: readonly ContractSystemEmptySlot[];
}
