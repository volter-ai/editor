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

/**
 * One frame the root Window processed, `delta` seconds after the last.
 *
 * @godot Engine (protocol)
 * @source main/main.cpp:4986
 */
export function godot_engine_frame(delta: number): void {
  frames += 1;
  elapsed += delta;
  if (elapsed > 1) {
    fps = frames;
    frames = 0;
    elapsed %= 1;
  }
}

/**
 * @godot Engine.get_frames_per_second
 * @source core/config/engine.h:134
 */
export function get_frames_per_second(): number {
  return fps;
}
