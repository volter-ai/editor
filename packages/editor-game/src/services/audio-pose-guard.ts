/**
 * THE AUDIO-POSE GUARD: the editor never drives Web Audio with a pose that is
 * not a number.
 *
 * ## The failure this ends
 *
 * The editor draws scene graphs it did not author. `WebGLRenderer.render`
 * calls `scene.updateMatrixWorld()` (three's own first line, gated only on
 * `scene.matrixWorldAutoUpdate`), and that recursion reaches every
 * `THREE.AudioListener` / `THREE.PositionalAudio` in the tree. Both override
 * `updateMatrixWorld` to push their world pose straight into Web Audio via
 * `AudioParam.linearRampToValueAtTime`, which **throws** on a non-finite
 * value. So one NaN anywhere above an audio node turns the editor's own draw
 * of an adopted play scene into a thrown error, once per frame.
 *
 * The NaN is not hypothetical and its cause is already measured in this repo
 * (`content-bounds.ts`, same measurement, same game): a physics binding writes
 * `object.matrix` from worker buffers the worker has not answered into yet, so
 * at frame zero real nodes carry `NaN` transforms. In racing-game that
 * propagates two ways — a `<PositionalAudio>` parented under the cannon-driven
 * chassis, and the game camera, whose pose is lerped from a physics-derived
 * speed and which every drei-minted `AudioListener` is a child of. A single
 * NaN lerp poisons that camera permanently; there is no re-seed.
 *
 * (The design-time half of the same root cause is fixed differently and
 * upstream: `authoring/design-time-settle.ts` runs the world's physics for a
 * bounded settle at mount, so Edit mode is no longer looking at unanswered
 * worker buffers at all. This guard is what covers PLAY, where the game's own
 * loop is running and the editor is a second reader of its graph.)
 *
 * ## Why the guard is on the audio node, and not on the render call
 *
 * The throw happens INSIDE three's `updateMatrixWorld` recursion, so nothing
 * that wraps `composer.render` can intercept a single node, and
 * `matrixWorldAutoUpdate` cannot help: the subclass body runs after
 * `super.updateMatrixWorld()` regardless of any flag. The one honest intercept
 * is the two prototypes themselves. Prototype-level (not per-instance) is
 * required because these nodes are minted LATE — drei's `<PositionalAudio>`
 * does `camera.add(new AudioListener())` in an effect after its buffer
 * resolves — so any walk done at adoption time would miss them.
 *
 * Patching a library prototype to host a foreign game is an established
 * mechanism here, not a new one: `@volter/threejs-runtime/adapter/ingest/scene-capture` traps
 * `WebGLRenderer.prototype.render` for exactly the same reason (the host must
 * observe a game it does not own, at a seam the game never offered).
 *
 * ## What it does, precisely
 *
 * The scene graph stays EXACTLY correct — `Object3D.prototype.updateMatrixWorld`
 * (which is what both overrides call as `super`) always runs, so children,
 * bounds, picking and selection see the truth including the NaN. Only the Web
 * Audio push is conditional: a running context and finite pose use three's
 * own implementation; otherwise the node keeps its last good audio pose.
 * A suspended context cannot consume pose ramps, so scheduling them every
 * render would grow its automation queue while its audio clock stands still.
 *
 * The shared engine guard also installs through setupAudio in exported games.
 * Its prototype marker prevents duplicate wrapping when the packaged editor
 * and source-served runtime import separate copies against the same Three.
 */

import { editorHost } from '@volter/editor-sdk/host';
import { installAudioPoseGuard as installSharedAudioPoseGuard } from '@volter/game-runtime/audio/pose-guard';

export { audioPoseUpdatesDropped } from '@volter/game-runtime/audio/pose-guard';

let reported = false;

/** Attach the editor diagnostic to the shared runtime guard. */
export function installAudioPoseGuard(): void {
  installSharedAudioPoseGuard((type) => {
    if (reported) return;
    reported = true;
    editorHost().console.log(
      `[audio-pose-guard] dropped a Web Audio pose update for a ${type} whose ` +
        'world matrix is not finite — the scene graph is unchanged and the node keeps its ' +
        'last good pose. Reported once; see audioPoseUpdatesDropped() for the running count.',
      'authoring',
    );
  });
}
