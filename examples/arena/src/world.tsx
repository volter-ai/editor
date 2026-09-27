/** Thin Three-root entrypoint: persistent policy plus the active complete scene. */

import { ArenaRenderFinish } from './components/environment/ArenaEnvironment';
import { InputRig } from './components/InputRig';
import { inputDebugBinding } from './lib/input';
import { ArenaScene } from './scenes/ArenaScene';

// The game's declared system adapters, as a static module export — the host
// reads them at mount (its navigation, which the editor bakes and draws),
// without this world importing any vgai runtime.
// The arena's own readings and setup functions are ordinary exports of the
// modules that own them, reached through `game.run(({ modules }) => …)`.
export { systems } from './systems';

/**
 * THE SESSION INPUT DOOR, wired to this game's own input store (`src/lib/input`).
 *
 * The root's entry may export a `debug` object, and its `input` member is
 * where `game.input.hold('fire', …)` — the one honest way to press this
 * game's keys from a session — actually lands
 * (`@volter/game-runtime/adapter/native-debug-module`). Without it the bridge has no
 * virtual-input target for this root and every press refuses with
 * `DEBUG_INPUT_UNAVAILABLE` (or, worse, reaches a DIFFERENT manager and
 * silently does nothing, which is what this example did until 2026-09-20:
 * `src/lib/input/index.ts` exported `inputDebugBinding()` and documented it
 * as "spread into the entry's `debug` export", and nothing spread it — a
 * named function with no caller, which is exactly the defect the build rules
 * name).
 *
 * A live thunk on purpose: `actions` reports the bindings as soon as
 * `.inputmap.json` finishes loading, rather than the empty set the map's
 * fetch had not populated at mount.
 */
export const debug = { input: inputDebugBinding() };

export default function World() {
  return (
    <>
      <ArenaRenderFinish />
      {/* The game-owned input store's frame tick — before every mechanic. */}
      <InputRig />
      <ArenaScene name="Arena Scene" />
    </>
  );
}
