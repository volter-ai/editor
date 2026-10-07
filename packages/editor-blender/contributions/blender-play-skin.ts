/**
 * ANIMATION IN A GAME: actions played on the skeletons of the game's copy of the model.
 *
 * The copy binds its own skins (`BlenderRuntimeView.detach` keeps each skinned mesh's weights and
 * the frame's armatures, and its view's `skeletons` builds and binds them exactly as the editing
 * view does), so nothing here binds or reads a rig. What a game plays is Blender's: each armature
 * starts on the action the file assigns it (`animation_data.action`), and a script sets another by
 * name (`play.setAction`), as Blender's own assignment does. Any action in the file may be set; one
 * that animates none of an armature's bones refuses, with the reason, once.
 *
 * A CLIP IS BAKED ONCE PER ACTION, through the clip door, the first time it is wanted. The copy's
 * frame is the frame it was detached from, so its revisions hold for the run. Until a bake lands
 * the armature keeps what it showed before (at first, the pose Blender exported).
 *
 * LAYERS, BLENDS AND LOOK-AT: each armature has a layered mixer (`blender-play-mixer.ts`), so a
 * game plays actions on parts of a body, at weights, and turns a bone toward what only it knows.
 *
 * THE GAME'S CLOCK DRIVES IT: the runner advances the mixers by each update's `dt`
 * (`@volter/editor-model-play`'s `play-script.ts`), so pause, step, speed and Restart hold for
 * animation exactly as they do for the script.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';
import * as THREE from 'three';
import { clipTracks } from './blender-runtime-skin';
import { LayeredMixer, type LayerOptions, type LookAtOptions } from './blender-play-mixer';

export type PlayAnimateOptions = LayerOptions;

type Answer = { ok: true; armature: string } | { ok: false; why: string };

/** The game's door to its characters' actions (`ModelPlayContext.setAction`, `blend`, `lookAt`). */
export interface PlayAnimation {
  /** The actions in the file, which an object's armature may be set to play. */
  clips(object: THREE.Object3D): readonly string[];
  /** Play one action on a layer of an object's armature; the reason when it cannot. */
  play(object: THREE.Object3D, clip: string, options?: PlayAnimateOptions): Answer;
  /** Set a layer's actions at weights. */
  blend(object: THREE.Object3D, weights: Readonly<Record<string, number>>, options?: PlayAnimateOptions): Answer;
  /** Fade out what a layer plays. */
  stop(object: THREE.Object3D, fade?: number, layer?: string): void;
  /** The action that weighs most on a layer, as last set, or null. */
  playing(object: THREE.Object3D, layer?: string): string | null;
  /** Turn one of an object's bones toward a point (or object) every update, until `null`. */
  lookAt(object: THREE.Object3D, bone: string, target: THREE.Vector3 | THREE.Object3D | null, options?: LookAtOptions): Answer;
  update(dt: number): void;
  readonly warnings: readonly string[];
  dispose(): void;
}

interface Armature {
  readonly rig: ArmatureRig;
  readonly mixer: LayeredMixer;
  readonly clips: Map<string, THREE.AnimationClip>;
  readonly baking: Set<string>;
  /** Actions with nothing this armature can play: asked once, never re-baked every update. */
  readonly failed: Map<string, string>;
}

/** The copy's animation. `bake` reads one action of one armature through the clip door. */
export function playAnimation(view: BlenderRuntimeView, bake: (armature: string, action: string) => Promise<BlenderActionClip | null>): PlayAnimation {
  const warnings: string[] = [];
  const facts = view.animationFacts();
  const actions = Object.keys(facts.actions);
  const armatures = new Map<string, Armature>();
  let disposed = false;

  const refuse = (armature: Armature, clip: string, why: string): void => {
    armature.failed.set(clip, why);
    warnings.push(`${armature.rig.armature} / ${clip}: ${why}`);
  };

  /** The clip the mixer asks for: baked, or baked now (once) and given on a later update. */
  const clipFor = (armature: Armature, clip: string): THREE.AnimationClip | null => {
    const held = armature.clips.get(clip);
    if (held || disposed || armature.failed.has(clip) || armature.baking.has(clip)) return held ?? null;
    armature.baking.add(clip);
    void bake(armature.rig.armature, clip).then((baked) => {
      armature.baking.delete(clip);
      const tracks = baked && baked.clipStart !== undefined && baked.clipEnd !== undefined
        ? clipTracks(baked, armature.rig.bones, warnings) : [];
      if (!baked || !tracks.length) {
        refuse(armature, clip, baked?.reason ?? `it animates none of ${armature.rig.armature}'s bones`);
        return;
      }
      const duration = baked.duration ?? (baked.clipEnd! - baked.clipStart!) / baked.fps;
      armature.clips.set(clip, new THREE.AnimationClip(clip, duration, tracks));
    }, (error: unknown) => {
      armature.baking.delete(clip);
      refuse(armature, clip, `it could not be read: ${error instanceof Error ? error.message : String(error)}`);
    });
    return null;
  };

  for (const rig of view.skeletons.rigs()) {
    const armature: Armature = {
      rig, clips: new Map(), baking: new Set(), failed: new Map(),
      mixer: new LayeredMixer(rig.object, rig.bones, (clip) => clipFor(armature, clip)),
    };
    armatures.set(rig.armature, armature);
  }

  // EACH ARMATURE STARTS ON ITS ASSIGNED ACTION, as Blender's viewport plays it.
  for (const armature of armatures.values()) {
    const assigned = facts.armatures[armature.rig.armature]?.action;
    if (assigned) armature.mixer.set(assigned, { fade: 0 });
  }

  /** The armature that animates `object`: its own, the one its skin is bound to, or the nearest
   *  armature among its ancestors and descendants (a character's root holds its armature). */
  const own = (candidate: THREE.Object3D): Armature | null => {
    for (const armature of armatures.values()) if (armature.rig.object === candidate) return armature;
    const skin = (candidate as THREE.Mesh).geometry?.userData['blenderSkin'] as { armature: string } | undefined;
    return skin ? armatures.get(skin.armature) ?? null : null;
  };
  const armatureOf = (object: THREE.Object3D): Armature | null => {
    for (let at: THREE.Object3D | null = object; at; at = at.parent) {
      const found = own(at);
      if (found) return found;
    }
    let found: Armature | null = null;
    object.traverse((child) => { if (!found) found = own(child); });
    return found;
  };

  /** The armature, after checking every action named is one it can play. */
  const resolve = (object: THREE.Object3D, clips: readonly string[]): Armature | { why: string } => {
    const armature = armatureOf(object);
    if (!armature) return { why: `${object.name || 'this object'} has no armature` };
    for (const clip of clips) {
      if (!(clip in facts.actions)) return { why: `the file has no action "${clip}"` };
      const failed = armature.failed.get(clip);
      if (failed) return { why: failed };
    }
    return armature;
  };
  const answer = (armature: Armature, refused: string | null): Answer =>
    refused ? { ok: false, why: refused } : { ok: true, armature: armature.rig.armature };

  return {
    warnings,
    clips: (object) => (armatureOf(object) ? actions : []),
    play(object, clip, options = {}) {
      const armature = resolve(object, [clip]);
      return 'why' in armature ? { ok: false, why: armature.why } : answer(armature, armature.mixer.set(clip, options));
    },
    blend(object, weights, options = {}) {
      const armature = resolve(object, Object.keys(weights));
      return 'why' in armature ? { ok: false, why: armature.why } : answer(armature, armature.mixer.blend(weights, options));
    },
    stop(object, fade = 0.2, layer) {
      armatureOf(object)?.mixer.stop({ fade, ...(layer ? { layer } : {}) });
    },
    // What was last set, so a script setting the same action every update while it bakes asks once.
    playing: (object, layer) => armatureOf(object)?.mixer.playing(layer) ?? null,
    lookAt(object, bone, target, options = {}) {
      const armature = armatureOf(object);
      if (!armature) return { ok: false, why: `${object.name || 'this object'} has no armature` };
      return answer(armature, armature.mixer.lookAt(bone, target, options));
    },
    update(dt) { for (const armature of armatures.values()) armature.mixer.update(dt); },
    dispose() {
      disposed = true;
      for (const armature of armatures.values()) armature.mixer.dispose();
    },
  };
}
