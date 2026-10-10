/**
 * ONE MIXER PER PRESENTED SCENE (`docs/SCENE-ANIMATION.md`, steps 3 and 4).
 *
 * Every armature's layers (`blender-mixer-pose.ts`, each bound to its own rig so bones of the same
 * name in two characters never meet) and the scene's movie (`blender-play-movie.ts`, its objects and
 * cameras) are actions on ONE `THREE.AnimationMixer` rooted at the view's root, on one clock. A
 * frame is placed in three steps, the same for the Timeline and for a game:
 *
 * 1. PLACE: each player sets its actions' times and weights for the frame (`place`).
 * 2. EVALUATE: the mixer applies every enabled action at once (`evaluate`), once per frame however
 *    many characters there are.
 * 3. SETTLE: what the mixer does not do on its own, after it (`settle`): Damped Track and Track To,
 *    a sequence placed where the game puts it, the fidelity check against Blender's own pose.
 *
 * An action left enabled keeps writing its last placement every evaluation, so a player that is not
 * placed this frame (the movie while the Timeline stands at Blender's own frame) disables its actions
 * rather than leaving them behind.
 */
import * as THREE from 'three';

export class SceneMixer {
  readonly mixer: THREE.AnimationMixer;
  /** Evaluations so far, counted so a walk can prove a frame costs one. */
  evaluations = 0;

  constructor(readonly root: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  /** Apply every placed action, all at once. */
  evaluate(): void {
    this.evaluations++;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

const mixers = new WeakMap<object, SceneMixer>();

/** The one mixer of a presented view (the document's, or a game's detached copy): made on first use,
 *  and made again when the view's root is a new object (a new present). */
export function sceneMixer(view: { readonly root: THREE.Object3D }): SceneMixer {
  const held = mixers.get(view);
  if (held && held.root === view.root) return held;
  held?.dispose();
  const made = new SceneMixer(view.root);
  mixers.set(view, made);
  return made;
}
