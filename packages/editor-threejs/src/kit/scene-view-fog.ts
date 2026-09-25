import type * as THREE from 'three';

/**
 * Why the Scene viewport draws a world's fog OUT.
 *
 * ## The measured defect
 *
 * Fog is calibrated in metres from THE GAME'S OWN CAMERA. The racing-game
 * mount declares `<fog args={['white', 0, 500]}>`, which is exactly right at
 * its chase camera 20 units behind the car and meaningless anywhere else: its
 * world is ~800 units across, so the editor framing that shows the whole track
 * sits ~700 units back, and every visible surface is past the fog's far plane.
 * Measured on that mount (2026-08-15): the framed Scene view is a featureless
 * white blob — the track, the canyon and the horizon are all the same white.
 *
 * The Scene camera is not the game's camera. It is placed by framing, by a
 * seed, or by the reader's own orbit, at whatever distance the world needs —
 * so a distance-calibrated effect authored for another camera is not a look,
 * it is an erasure.
 *
 * ## Why a view policy and not fog-aware framing
 *
 * The alternative was to have the framing respect the fog range — pick a
 * distance inside it. It cannot work, and the numbers say so rather than an
 * argument: this world's content diagonal is ~1,100 units against a fog far
 * plane of 500, so no distance both shows the track and stays readable. Any
 * fog-aware framing would have to stop showing the world to keep the fog,
 * which is backwards — the first look exists to show the world.
 *
 * So the fog goes, as a VIEW POLICY, in the same class as the shading modes:
 * presentation-only, restored before anything else can observe it, and applied
 * only to the editor's own draw. This is also the established answer in the
 * genre — Unity's Scene view renders fog OFF by default and offers it as a
 * scene-view effect toggle, for exactly this reason.
 *
 * The game's own look is not touched anywhere it belongs: the Game tab, play
 * mode and every exported build render the game's camera through the game's
 * fog. Only the authoring camera is exempted, and there is deliberately no
 * toggle for it — a Scene view that can be washed white by a setting is a
 * fault the reader has to diagnose, and nothing here is worth that.
 *
 * ## Why the parameters and not `scene.fog = null`
 *
 * `!!scene.fog` is part of three's shader-program cache key, so nulling it for
 * one draw and restoring it for the next compiles and keeps a SECOND program
 * variant for every material in the world. Neutralising the fog's own numbers
 * leaves the program identical and the fog term at zero.
 */

/** Far enough that no real depth reaches it; `near < far` keeps the linear
 *  fog's `smoothstep(near, far, depth)` well-defined. */
const NEUTRAL_FOG_NEAR = 1e20;
const NEUTRAL_FOG_FAR = 2e20;

type LinearFog = THREE.Fog & { isFog: true };
type ExpFog = THREE.FogExp2 & { isFogExp2: true };

/**
 * Run `draw` with `scene`'s fog contributing nothing, then put it back exactly
 * as it was — including when `draw` throws.
 *
 * A scene with no fog costs one property read.
 */
export function withSceneFogNeutralized(scene: THREE.Scene, draw: () => void): void {
  const fog = scene.fog;
  if (!fog) {
    draw();
    return;
  }
  const linear = (fog as LinearFog).isFog ? (fog as LinearFog) : null;
  const exponential = (fog as ExpFog).isFogExp2 ? (fog as ExpFog) : null;
  const near = linear?.near;
  const far = linear?.far;
  const density = exponential?.density;
  if (linear) {
    linear.near = NEUTRAL_FOG_NEAR;
    linear.far = NEUTRAL_FOG_FAR;
  }
  if (exponential) exponential.density = 0;
  try {
    draw();
  } finally {
    if (linear && near !== undefined && far !== undefined) {
      linear.near = near;
      linear.far = far;
    }
    if (exponential && density !== undefined) exponential.density = density;
  }
}
