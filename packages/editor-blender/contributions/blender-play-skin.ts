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
 * THE GAME'S CLOCK DRIVES IT: the runner advances the mixers by each update's `dt`
 * (`@volter/editor-model-play`'s `play-script.ts`), so pause, step, speed and Restart hold for
 * animation exactly as they do for the script.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';
import * as THREE from 'three';
import { clipTracks } from './blender-runtime-skin';

export interface PlayAnimateOptions {
  /** Repeat until something else plays (default true). */
  readonly loop?: boolean;
  /** Seconds to crossfade from what this armature played before (default 0.2). */
  readonly fade?: number;
  /** Playback rate, 1 is the clip's own speed. */
  readonly speed?: number;
  /** Start again from the first frame when this action is already playing (default false). */
  readonly restart?: boolean;
}

/** The game's door to its characters' actions (`ModelPlayContext.setAction`). */
export interface PlayAnimation {
  /** The actions in the file, which an object's armature may be set to play. */
  clips(object: THREE.Object3D): readonly string[];
  play(object: THREE.Object3D, clip: string, options?: PlayAnimateOptions): { ok: true; armature: string } | { ok: false; why: string };
  stop(object: THREE.Object3D, fade?: number): void;
  playing(object: THREE.Object3D): string | null;
  update(dt: number): void;
  readonly warnings: readonly string[];
  dispose(): void;
}

interface Armature {
  readonly rig: ArmatureRig;
  readonly mixer: THREE.AnimationMixer;
  readonly clips: Map<string, THREE.AnimationClip>;
  readonly baking: Set<string>;
  /** Actions with nothing this armature can play: asked once, never re-baked every update. */
  readonly failed: Map<string, string>;
  current: { readonly name: string; readonly action: THREE.AnimationAction } | null;
  wanted: { readonly name: string; readonly options: PlayAnimateOptions } | null;
}

/** The copy's animation. `bake` reads one action of one armature through the clip door. */
export function playAnimation(view: BlenderRuntimeView, bake: (armature: string, action: string) => Promise<BlenderActionClip | null>): PlayAnimation {
  const warnings: string[] = [];
  const facts = view.animationFacts();
  const actions = Object.keys(facts.actions);
  const armatures = new Map<string, Armature>();
  for (const rig of view.skeletons.rigs())
    armatures.set(rig.armature, { rig, mixer: new THREE.AnimationMixer(rig.object), clips: new Map(), baking: new Set(), failed: new Map(), current: null, wanted: null });
  let disposed = false;

  const start = (armature: Armature, clip: string, options: PlayAnimateOptions): void => {
    const source = armature.clips.get(clip)!;
    const fade = Math.max(0, options.fade ?? 0.2);
    const action = armature.mixer.clipAction(source);
    action.setLoop(options.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.clampWhenFinished = options.loop === false;
    action.setEffectiveTimeScale(options.speed ?? 1);
    if (armature.current?.name === clip) {
      if (options.restart) action.reset().play();
      return;
    }
    action.reset().setEffectiveWeight(1).play();
    if (armature.current && fade > 0) armature.current.action.crossFadeTo(action, fade, false);
    else armature.current?.action.stop();
    armature.current = { name: clip, action };
  };

  const refuse = (armature: Armature, clip: string, why: string): void => {
    armature.failed.set(clip, why);
    warnings.push(`${armature.rig.armature} / ${clip}: ${why}`);
    if (armature.wanted?.name === clip) armature.wanted = null;
  };

  /** Bake `clip` for `armature` once, and start it when it lands if it is still the one wanted. */
  const want = (armature: Armature, clip: string, options: PlayAnimateOptions): void => {
    armature.wanted = { name: clip, options };
    if (armature.clips.has(clip)) { start(armature, clip, options); return; }
    if (armature.baking.has(clip)) return;
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
      if (!disposed && armature.wanted?.name === clip) start(armature, clip, armature.wanted.options);
    }, (error: unknown) => {
      armature.baking.delete(clip);
      refuse(armature, clip, `it could not be read: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  // EACH ARMATURE STARTS ON ITS ASSIGNED ACTION, as Blender's viewport plays it.
  for (const armature of armatures.values()) {
    const assigned = facts.armatures[armature.rig.armature]?.action;
    if (assigned) want(armature, assigned, {});
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

  return {
    warnings,
    clips: (object) => (armatureOf(object) ? actions : []),
    play(object, clip, options = {}) {
      const armature = armatureOf(object);
      if (!armature) return { ok: false, why: `${object.name || 'this object'} has no armature` };
      if (!(clip in facts.actions)) return { ok: false, why: `the file has no action "${clip}"` };
      const failed = armature.failed.get(clip);
      if (failed) return { ok: false, why: failed };
      want(armature, clip, options);
      return { ok: true, armature: armature.rig.armature };
    },
    stop(object, fade = 0.2) {
      const armature = armatureOf(object);
      if (!armature) return;
      armature.wanted = null;
      if (!armature.current) return;
      if (fade > 0) armature.current.action.fadeOut(fade); else armature.current.action.stop();
      armature.current = null;
    },
    // What was last set, so a script setting the same action every update while it bakes asks once.
    playing: (object) => {
      const armature = armatureOf(object);
      return armature?.wanted?.name ?? armature?.current?.name ?? null;
    },
    update(dt) { for (const armature of armatures.values()) armature.mixer.update(dt); },
    dispose() {
      disposed = true;
      for (const armature of armatures.values()) armature.mixer.stopAllAction();
    },
  };
}
