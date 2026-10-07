/**
 * ANIMATION IN PLAY: the same skin and clips the Timeline plays (`blender-runtime-skin.ts`), bound
 * to Play's detached copy and driven by the game.
 *
 * Play runs a game on a copy of the model (`BlenderRuntimeView.detach`). Until this module the copy
 * was built without its skins, so every rigged character was a frozen mesh in a game while the same
 * character played in Movie. Nothing here is a second animation system: the rigs are bound by
 * `bindRig` and the clips built by `clipTracks`, the Timeline's own code, over the copy's graph.
 *
 * WHAT A GAME PLAYS is any action that animates an armature's bones, assigned or not, so a file can
 * hold a clip library (Idle, Run, Attack, Die side by side) and a game chooses among them by name.
 * Each armature has its own `THREE.AnimationMixer`; a play crossfades from what played before.
 *
 * THE GAME'S CLOCK DRIVES IT: the runner advances the mixers by the `dt` each `update` is handed
 * (`@volter/editor-model-play`'s `play-script.ts`), so pause, step, speed and Restart hold for
 * animation exactly as they do for the script. Nothing advances on the page's own time.
 *
 * READ ONCE PER PLAY: the rig and every clip are read from the engine when Play starts (`rna_rig`
 * walks every vertex of every rigged mesh, a clip bakes every bone per frame), never per frame.
 */
import type { BlenderActionClip, BlenderRig } from '@volter/blender-engine/browser/rna';
import * as THREE from 'three';
import { blenderActionClip, blenderArmatureActions, blenderRig } from '../host/blender-runtime-host';
import { bindRig, clipTracks, type BoundRig, type SkinPresentation } from './blender-runtime-skin';

/** What Play reads from the engine: the rigs, and every armature's clips by name. */
export interface PlayClipLibrary {
  readonly rig: BlenderRig | null;
  /** Armature name → its clips by action name. */
  readonly clips: ReadonlyMap<string, ReadonlyMap<string, BlenderActionClip>>;
  readonly warnings: readonly string[];
}

/** Read the rigs and clips a game can play. Empty (no rig, no clips) when the file has none. */
export async function readPlayClipLibrary(): Promise<PlayClipLibrary> {
  const warnings: string[] = [];
  const [rig, listing] = await Promise.all([blenderRig(), blenderArmatureActions()]);
  const clips = new Map<string, Map<string, BlenderActionClip>>();
  for (const { armature, actions } of listing?.armatures ?? []) {
    const byName = new Map<string, BlenderActionClip>();
    for (const action of actions) {
      try {
        const clip = await blenderActionClip({ object: armature, action });
        if (clip?.tracks.length && clip.clipStart !== undefined && clip.clipEnd !== undefined) byName.set(action, clip);
        else if (clip?.reason) warnings.push(`${armature} / ${action}: ${clip.reason}`);
      } catch (error) {
        warnings.push(`${armature} / ${action} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (byName.size) clips.set(armature, byName);
  }
  return { rig, clips, warnings };
}

export interface PlayAnimateOptions {
  /** Repeat until something else plays (default true). */
  readonly loop?: boolean;
  /** Seconds to crossfade from what this armature played before (default 0.2). */
  readonly fade?: number;
  /** Playback rate, 1 is the clip's own speed. */
  readonly speed?: number;
  /** Start again from the first frame when this clip is already playing (default false). */
  readonly restart?: boolean;
}

/** The game's door to its characters' clips (`ModelPlayContext.animate`). */
export interface PlayAnimation {
  /** The clips an object can play: its own armature's, or the armature its rigged mesh is bound to. */
  clips(object: THREE.Object3D): readonly string[];
  /** Play a clip on an object's armature; the reason when it cannot. */
  play(object: THREE.Object3D, clip: string, options?: PlayAnimateOptions): { ok: true; armature: string } | { ok: false; why: string };
  /** Fade out whatever the object's armature plays. */
  stop(object: THREE.Object3D, fade?: number): void;
  /** The clip the object's armature plays now, or null. */
  playing(object: THREE.Object3D): string | null;
  /** Advance every mixer by one update's `dt` (the game's clock). */
  update(dt: number): void;
  readonly warnings: readonly string[];
  dispose(): void;
}

interface Armature {
  readonly name: string;
  readonly object: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
  current: { readonly name: string; readonly action: THREE.AnimationAction } | null;
}

/** Bind the library's rigs and clips to Play's copy. */
export function bindPlayAnimation(presentation: SkinPresentation, library: PlayClipLibrary): PlayAnimation {
  const warnings = [...library.warnings];
  const rigs: BoundRig[] = [];
  for (const rig of library.rig?.rigs ?? []) {
    if (!rig.object || !rig.armature || !rig.skinIndexBase64 || !rig.skinWeightBase64) {
      if (rig.reason) warnings.push(rig.reason);
      continue;
    }
    const bound = bindRig(presentation, rig, library.rig!.frame, warnings);
    if (bound) rigs.push(bound);
  }
  const armatures = new Map<string, Armature>();
  /** A mesh's presented object → the armature its skin is bound to. */
  const meshArmature = new Map<THREE.Object3D, string>();
  for (const rig of rigs) meshArmature.set(rig.mesh, rig.armature);
  for (const [name, byAction] of library.clips) {
    const object = presentation.objectForBlenderName(name);
    if (!object) continue;
    const bones = new Map<string, THREE.Bone>();
    for (const rig of rigs) if (rig.armature === name) for (const bone of rig.bones) bones.set(bone.name, bone);
    if (!bones.size) { warnings.push(`${name} has clips but no skinned mesh is bound to it, so they would move nothing.`); continue; }
    const clips = new Map<string, THREE.AnimationClip>();
    for (const [action, clip] of byAction) {
      const tracks = clipTracks(clip, bones, warnings);
      if (!tracks.length) continue;
      const duration = clip.duration ?? (clip.clipEnd! - clip.clipStart!) / clip.fps;
      clips.set(action, new THREE.AnimationClip(action, duration, tracks));
    }
    if (clips.size) armatures.set(name, { name, object, mixer: new THREE.AnimationMixer(object), clips, current: null });
  }
  const objectArmature = new Map<THREE.Object3D, Armature>();
  for (const armature of armatures.values()) objectArmature.set(armature.object, armature);
  /** The armature that animates `object`: itself, the one its skin is bound to, or the nearest
   *  armature among its ancestors and descendants (a character's root empty holds its armature). */
  const armatureOf = (object: THREE.Object3D): Armature | null => {
    const own = objectArmature.get(object) ?? armatures.get(meshArmature.get(object) ?? '');
    if (own) return own;
    for (let parent = object.parent; parent; parent = parent.parent) {
      const found = objectArmature.get(parent);
      if (found) return found;
    }
    let found: Armature | null = null;
    object.traverse((child) => { if (!found) found = objectArmature.get(child) ?? armatures.get(meshArmature.get(child) ?? '') ?? null; });
    return found;
  };
  return {
    warnings,
    clips: (object) => [...(armatureOf(object)?.clips.keys() ?? [])],
    play(object, clip, options = {}) {
      const armature = armatureOf(object);
      if (!armature) return { ok: false, why: `${object.name || 'this object'} has no armature with clips` };
      const source = armature.clips.get(clip);
      if (!source) return { ok: false, why: `${armature.name} has no clip "${clip}"; it has ${[...armature.clips.keys()].join(', ')}` };
      const fade = Math.max(0, options.fade ?? 0.2);
      const action = armature.mixer.clipAction(source);
      action.setLoop(options.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      action.clampWhenFinished = options.loop === false;
      action.setEffectiveTimeScale(options.speed ?? 1);
      if (armature.current?.name === clip) {
        if (options.restart) action.reset().play();
        return { ok: true, armature: armature.name };
      }
      action.reset().setEffectiveWeight(1).play();
      if (armature.current && fade > 0) armature.current.action.crossFadeTo(action, fade, false);
      else armature.current?.action.stop();
      armature.current = { name: clip, action };
      return { ok: true, armature: armature.name };
    },
    stop(object, fade = 0.2) {
      const armature = armatureOf(object);
      if (!armature?.current) return;
      if (fade > 0) armature.current.action.fadeOut(fade); else armature.current.action.stop();
      armature.current = null;
    },
    playing: (object) => armatureOf(object)?.current?.name ?? null,
    update(dt) { for (const armature of armatures.values()) armature.mixer.update(dt); },
    dispose() {
      for (const armature of armatures.values()) armature.mixer.stopAllAction();
      for (const rig of rigs) rig.skeleton.dispose();
    },
  };
}
