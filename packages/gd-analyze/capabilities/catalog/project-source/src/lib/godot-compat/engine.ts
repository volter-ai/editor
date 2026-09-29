/**
 * @godot-class Engine
 * @role BINDING
 *
 * Godot 4.7's `Engine` singleton (`core/config/engine.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its frame rate is the count of frames drawn in the
 * last whole second, 1 until the first second ends (`Main::iteration`, `main/main.cpp:4986`). The
 * frames are the root Window's, each with the host's delta (`godot_engine_frame`).
 */

let fps = 1;
let frames = 0;
let elapsed = 0;
/** The host's time since the first frame, in seconds: the sum of its frames' deltas. */
let ticks = 0;

/**
 * One frame the root Window processed, `delta` seconds after the last.
 *
 * @godot Engine (protocol)
 * @source main/main.cpp:4986
 */
export function godot_engine_frame(delta: number): void {
  frames += 1;
  elapsed += delta;
  ticks += delta;
  if (elapsed > 1) {
    fps = frames;
    frames = 0;
    elapsed %= 1;
  }
}

/**
 * The host's time since the game's first frame, in seconds (what `Time`'s ticks count).
 *
 * @godot Engine (protocol)
 * @source main/main.cpp:4986
 */
export function godot_engine_ticks(): number {
  return ticks;
}

/**
 * @godot Engine.get_frames_per_second
 * @source core/config/engine.h:134
 */
export function get_frames_per_second(): number {
  return fps;
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
