/**
 * @godot-class Engine
 * @role BINDING
 *
 * Godot 4.7's `Engine` singleton (`core/config/engine.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over R3F's root: the time since the game began is
 * R3F's clock, and the frame rate the frames three's renderer has drawn over that time. Godot counts
 * the frames of the last whole second (`Main::iteration`, `main/main.cpp:4986`); this is the rate
 * since the game began, and 1 until its first second ends.
 */

import type { RootState } from '@react-three/fiber';

/** R3F's root, handed over by the root Window (`useGodotRootWindow`). */
let host: (() => RootState) | undefined;

/**
 * Hands the engine R3F's root state; the returned call releases it.
 *
 * @godot Engine (protocol)
 * @source main/main.cpp:4986
 */
export function godot_engine_attach(get: () => RootState): () => void {
  host = get;
  return () => {
    if (host === get) host = undefined;
  };
}

/**
 * The time since the game began, in seconds: R3F's clock (what `Time`'s ticks count).
 *
 * @godot Engine (protocol)
 * @source main/main.cpp:4986
 */
export function godot_engine_ticks(): number {
  return host?.().clock.elapsedTime ?? 0;
}

/**
 * @godot Engine.get_frames_per_second
 * @source core/config/engine.h:134
 */
export function get_frames_per_second(): number {
  const state = host?.();
  const elapsed = state?.clock.elapsedTime ?? 0;
  if (state === undefined || elapsed < 1) return 1;
  return Math.floor(state.gl.info.render.frame / elapsed);
}

/**
 * The page runs the game, never the editor.
 *
 * @godot Engine.is_editor_hint
 * @source core/config/engine.h:172
 */
export function is_editor_hint(): boolean {
  return false;
}
