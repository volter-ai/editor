/**
 * ANIMATION IN A GAME: Blender's own animation stack, evaluated on the game's copy of the model.
 *
 * The copy binds its own skins (`BlenderRuntimeView.detach` keeps each skinned mesh's weights and
 * the frame's armatures), and every armature is posed by the same evaluator the Timeline uses
 * (`blender-pose.ts`): its NLA tracks bottom to top, then its active action over them, blended as
 * Blender blends them, then its Damped Track constraints. So a game shows what Blender shows, and
 * what a game changes is Blender's own data, by Blender's names:
 *
 * - `play` sets the ACTIVE ACTION (`animation_data.action`), crossfaded from the last; each
 *   armature starts on the one the file assigns it. A game's actions run from when they are set
 *   and repeat unless told not to.
 * - `track` sets an NLA TRACK by name: an action for it (over the tracks the file has, or as a
 *   new track over them), its influence, or its mute. An action that keys only some bones covers
 *   only those, so an upper-body action on a track over a running action is an upper body that
 *   aims while the legs run, as in Blender.
 * - `constraint` sets a bone constraint's influence, or the object it aims at. A constraint aims
 *   at the game's copy of its target, so moving that object in the game moves the look.
 *
 * The file's own NLA strips play on the game's clock as scene frames, looping the scene's range as
 * Blender's own playback does. Every
 * clip is baked once per action, the first time it is wanted; until the clips a pose needs are
 * baked, the armature keeps the pose it has.
 *
 * THE GAME'S CLOCK DRIVES IT: the runner advances it by each update's `dt`
 * (`@volter/editor-model-play`'s `play-script.ts`), so pause, step, speed and Restart hold for
 * animation exactly as they do for the script.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type { BlenderArmature } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';
import type * as THREE from 'three';
import { ArmaturePose, nlaLayers, poseClip, type ConstraintOverride, type PoseClip, type PoseLayer } from './blender-pose';
import { editorHost } from '@volter/editor-sdk/host';
import { remedy } from './blender-runtime-skin';

export interface PlayActionOptions {
  /** Seconds to crossfade from what played before (default 0.2). */
  readonly fade?: number;
  /** Repeat until something else plays (default true); `false` plays once and holds the end. */
  readonly loop?: boolean;
  /** Playback rate, 1 is the action's own. */
  readonly speed?: number;
  /** Start again from the first frame when this action is already playing. */
  readonly restart?: boolean;
}

export interface PlayTrackOptions extends PlayActionOptions {
  /** The action the track plays from now; absent, the track plays what the file gives it. */
  readonly action?: string;
  /** The track's influence, 0 to 1, reached over `fade` (default 0, at once). */
  readonly influence?: number;
  readonly mute?: boolean;
}

export interface PlayConstraintOptions {
  readonly influence?: number;
  /** The object it aims at instead of the file's target. */
  readonly target?: THREE.Object3D | null;
}

type Answer = { ok: true; armature: string } | { ok: false; why: string };

/** The game's door to its characters' animation (`ModelPlayContext.setAction`, `setTrack`, `setConstraint`). */
export interface PlayAnimation {
  /** The actions in the file, which an object's armature may play. */
  clips(object: THREE.Object3D): readonly string[];
  play(object: THREE.Object3D, action: string, options?: PlayActionOptions): Answer;
  stop(object: THREE.Object3D, fade?: number): void;
  /** The active action, as last set. */
  playing(object: THREE.Object3D): string | null;
  /** Set an NLA track; `null` gives it back to the file (a track the game made goes). */
  track(object: THREE.Object3D, name: string, options: PlayTrackOptions | null): Answer;
  constraint(object: THREE.Object3D, bone: string, name: string, options: PlayConstraintOptions): Answer;
  update(dt: number): void;
  readonly warnings: readonly string[];
  dispose(): void;
}

/** A weight that moves toward its target at a rate (a crossfade). */
interface Ramp { weight: number; target: number; rate: number }
const ramp = (weight: number, target: number, fade: number): Ramp => ({ weight, target, rate: fade > 0 ? 1 / fade : 0 });
const step = (r: Ramp, dt: number): void => {
  r.weight = r.rate <= 0 ? r.target : r.weight < r.target ? Math.min(r.target, r.weight + dt * r.rate) : Math.max(r.target, r.weight - dt * r.rate);
};

/** An action a game set, on its own clock from when it was set. */
interface Playing { readonly action: string; readonly from: number; readonly loop: boolean; readonly speed: number; readonly weight: Ramp }

interface Track { action: Playing | null; previous: Playing | null; readonly influence: Ramp; mute: boolean; readonly own: boolean }

interface Armature {
  readonly rig: ArmatureRig;
  readonly pose: ArmaturePose;
  readonly facts: BlenderArmature;
  /** Baked clips by action: the clip, undefined while baking, null when it plays nothing. */
  readonly clips: Map<string, PoseClip | null | undefined>;
  readonly failed: Map<string, string>;
  /** The active action and the ones fading out under it, oldest first. */
  line: Playing[];
  readonly tracks: Map<string, Track>;
  readonly constraints: Map<string, ConstraintOverride>;
}

/** The copy's animation. `bake` reads one action of one armature through the clip door. */
export function playAnimation(view: BlenderRuntimeView, bake: (armature: string, action: string) => Promise<BlenderActionClip | null>): PlayAnimation {
  const warnings: string[] = [];
  const facts = view.animationFacts();
  const actions = Object.keys(facts.actions);
  const fps = facts.clock?.fps || 24;
  const sceneStart = facts.clock?.start ?? 1;
  const sceneLength = Math.max(1, (facts.clock?.end ?? sceneStart + 249) - sceneStart + 1);
  const armatures = new Map<string, Armature>();
  let time = 0;
  let disposed = false;

  const fail = (armature: Armature, action: string, why: string): void => {
    armature.clips.set(action, null);
    armature.failed.set(action, why);
    warnings.push(`${armature.rig.armature} / ${action}: ${why}`);
  };
  const clipOf = (armature: Armature, action: string): PoseClip | null | undefined => {
    if (armature.clips.has(action)) return armature.clips.get(action);
    armature.clips.set(action, undefined);
    void bake(armature.rig.armature, action).then((baked) => {
      const clip = baked ? poseClip(baked) : null;
      for (const thing of clip?.unsupported ?? []) warnings.push(`${armature.rig.armature}: ${thing} plays only in Blender, not in a game.${remedy([thing])}`);
      if (clip) armature.clips.set(action, clip);
      else fail(armature, action, baked?.reason ?? `it animates none of ${armature.rig.armature}'s bones`);
    }, (error: unknown) => fail(armature, action, `it could not be read: ${error instanceof Error ? error.message : String(error)}`));
    return undefined;
  };

  for (const rig of view.skeletons.rigs()) {
    const entry = facts.armatures[rig.armature];
    if (!entry) continue;
    const pose = new ArmaturePose(rig);
    pose.facts(entry);
    for (const thing of pose.unsupported()) warnings.push(`${rig.armature}: ${thing} plays only in Blender, not in a game.${remedy([thing])}`);
    const armature: Armature = { rig, pose, facts: entry, clips: new Map(), failed: new Map(), line: [], tracks: new Map(), constraints: new Map() };
    // EACH ARMATURE STARTS ON ITS ASSIGNED ACTION, as Blender's viewport plays it.
    if (entry.action) armature.line = [{ action: entry.action, from: 0, loop: true, speed: 1, weight: ramp(1, 1, 0) }];
    armatures.set(rig.armature, armature);
  }

  /** A game's action as a layer now: its frame on its own clock, repeated or held at its end. */
  const playedLayer = (armature: Armature, played: Playing, influence: number, blend: string): PoseLayer | null | undefined => {
    const clip = clipOf(armature, played.action);
    if (!clip) return clip;
    const length = clip.end - clip.start;
    const elapsed = (time - played.from) * fps * played.speed;
    const frame = length > 0 && played.loop ? clip.start + (((elapsed % length) + length) % length) : Math.min(clip.end, clip.start + elapsed);
    return { clip, frame, influence: influence * played.weight.weight, blend };
  };

  /** Every layer of one armature now, bottom to top; null while a clip it needs is being baked. */
  const layersOf = (armature: Armature): PoseLayer[] | null => {
    const layers: PoseLayer[] = [];
    let waiting = false;
    /** Whether any strip is evaluated now: what places the active action, as in Blender. */
    let evaluated = false;
    const take = (layer: PoseLayer | null | undefined): void => {
      if (layer === undefined) waiting = true;
      else if (layer) layers.push(layer);
    };
    const animation = armature.facts.animation;
    // THE SCENE FRAME, wrapping at the scene's end as Blender's playback wraps.
    const frame = sceneStart + ((time * fps) % sceneLength);
    const solo = animation?.tracks.some((track) => track.solo) ?? false;
    for (const track of animation && animation.useNla ? animation.tracks : []) {
      const set = armature.tracks.get(track.name);
      if ((set ? set.mute : track.mute) || (solo && !track.solo)) continue;
      const influence = set ? set.influence.weight : 1;
      if (set?.action) {
        const blend = track.strips[0]?.blendType ?? 'REPLACE';
        if (set.previous) take(playedLayer(armature, set.previous, influence, blend));
        take(playedLayer(armature, set.action, influence, blend));
        if (influence > 0) evaluated = true;
        continue;
      }
      const stack = nlaLayers({ ...animation!, tracks: [{ ...track, mute: false, solo: false }] }, frame, (action) => clipOf(armature, action));
      if (stack.waiting) waiting = true;
      if (stack.evaluated && influence > 0) evaluated = true;
      for (const layer of stack.layers) layers.push({ ...layer, influence: layer.influence * influence });
    }
    for (const set of armature.tracks.values()) {
      if (!set.own || set.mute || !set.action) continue;
      if (set.previous) take(playedLayer(armature, set.previous, set.influence.weight, 'REPLACE'));
      take(playedLayer(armature, set.action, set.influence.weight, 'REPLACE'));
      if (set.influence.weight > 0) evaluated = true;
    }
    // THE ACTIVE ACTION as Blender places it: not at all under a soloed track, alone and whole when
    // no strip is evaluated now, else at its influence and blend type over them.
    const nla = !!animation?.useNla;
    const strips = nla && evaluated;
    for (const played of nla && solo ? [] : armature.line)
      take(playedLayer(armature, played, strips ? animation!.influence : 1, strips ? animation!.blendType : 'REPLACE'));
    return waiting ? null : layers;
  };

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
  const refusal = (armature: Armature, action: string): string | null =>
    !(action in facts.actions) ? `the file has no action "${action}"` : armature.failed.get(action) ?? null;
  const start = (action: string, options: PlayActionOptions, weight: Ramp): Playing => ({
    action, from: time, loop: options.loop ?? true, speed: options.speed ?? 1, weight,
  });
  const ok = (armature: Armature): Answer => ({ ok: true, armature: armature.rig.armature });
  const warned = new Set<string>();
  /** An action nothing keeps (no user, no fake user) vanishes on the file's next save: said once. */
  const kept = (action: string): void => {
    if (!facts.unkept.includes(action) || warned.has(action)) return;
    warned.add(action);
    const said = `The game plays "${action}", which nothing in the file uses and has no fake user, so Blender drops it the next time the file saves. Give it a fake user (action.use_fake_user = True) or assign it.`;
    warnings.push(said);
    editorHost().console.warn(said, 'blender-animation');
  };
  const none = (object: THREE.Object3D): Answer => ({ ok: false, why: `${object.name || 'this object'} has no armature` });

  return {
    warnings,
    clips: (object) => (armatureOf(object) ? actions : []),
    play(object, action, options = {}) {
      const armature = armatureOf(object);
      if (!armature) return none(object);
      const refused = refusal(armature, action);
      if (refused) return { ok: false, why: refused };
      kept(action);
      const current = armature.line.at(-1);
      if (current?.action === action && current.weight.target > 0) {
        if (options.restart) armature.line[armature.line.length - 1] = { ...current, from: time };
        return ok(armature);
      }
      const fade = Math.max(0, options.fade ?? 0.2);
      // A CROSSFADE is the new action over the old at a rising influence; the old goes once covered.
      armature.line = current && fade > 0 ? [...armature.line, start(action, options, ramp(0, 1, fade))] : [start(action, options, ramp(1, 1, 0))];
      return ok(armature);
    },
    stop(object, fade = 0.2) {
      const armature = armatureOf(object);
      if (!armature) return;
      if (fade <= 0) armature.line = [];
      else for (const played of armature.line) Object.assign(played.weight, ramp(played.weight.weight, 0, fade));
    },
    playing: (object) => {
      const current = armatureOf(object)?.line.at(-1);
      return current && current.weight.target > 0 ? current.action : null;
    },
    track(object, name, options) {
      const armature = armatureOf(object);
      if (!armature) return none(object);
      const inFile = armature.facts.animation?.tracks.some((track) => track.name === name) ?? false;
      const set = armature.tracks.get(name);
      if (options === null) {
        if (set?.own) Object.assign(set.influence, ramp(set.influence.weight, 0, 0.2));
        else armature.tracks.delete(name);
        return ok(armature);
      }
      if (options.action) {
        const refused = refusal(armature, options.action);
        if (refused) return { ok: false, why: refused };
        kept(options.action);
      } else if (!inFile && !set) {
        return { ok: false, why: `${armature.rig.armature} has no NLA track "${name}"; give it an \`action\` to make one` };
      }
      const track: Track = set ?? { action: null, previous: null, influence: ramp(1, 1, 0), mute: false, own: !inFile };
      if (options.influence !== undefined)
        Object.assign(track.influence, ramp(track.influence.weight, Math.max(0, Math.min(1, options.influence)), Math.max(0, options.fade ?? 0)));
      if (options.mute !== undefined) track.mute = options.mute;
      if (options.action && (track.action?.action !== options.action || options.restart)) {
        const crossfade = Math.max(0, options.fade ?? 0.2);
        track.previous = track.action && crossfade > 0 ? track.action : null;
        track.action = start(options.action, options, ramp(track.previous ? 0 : 1, 1, crossfade));
      }
      armature.tracks.set(name, track);
      return ok(armature);
    },
    constraint(object, bone, name, options) {
      const armature = armatureOf(object);
      if (!armature) return none(object);
      const declared = armature.facts.bones.find((one) => one.name === bone);
      if (!declared) return { ok: false, why: `${armature.rig.armature} has no bone "${bone}"` };
      const constraint = declared.constraints?.find((one) => one.name === name);
      if (!constraint) return { ok: false, why: `bone "${bone}" has no constraint "${name}"; it has ${(declared.constraints ?? []).map((one) => `"${one.name}"`).join(', ') || 'none'}` };
      if (constraint.type !== 'DAMPED_TRACK') return { ok: false, why: `"${name}" is a ${constraint.type} constraint, which plays only in Blender; a game plays Damped Track` };
      const key = `${bone}\u0000${name}`;
      armature.constraints.set(key, { ...armature.constraints.get(key), ...options });
      return ok(armature);
    },
    update(dt) {
      if (disposed) return;
      time += dt;
      for (const armature of armatures.values()) {
        for (const played of armature.line) step(played.weight, dt);
        // What the newest action covers whole is gone; so is what has faded to nothing.
        let covering = -1;
        armature.line.forEach((played, index) => { if (played.weight.weight >= 1) covering = index; });
        if (covering > 0) armature.line = armature.line.slice(covering);
        armature.line = armature.line.filter((played) => played.weight.weight > 0 || played.weight.target > 0);
        for (const [name, track] of armature.tracks) {
          step(track.influence, dt);
          if (track.action) step(track.action.weight, dt);
          if (track.previous && track.action && track.action.weight.weight >= 1) track.previous = null;
          if (track.own && track.influence.weight === 0 && track.influence.target === 0) armature.tracks.delete(name);
        }
        const layers = layersOf(armature);
        if (!layers) continue;
        armature.pose.apply(layers, {
          object: (name) => view.objectForBlenderName(name),
          override: (bone, name) => armature.constraints.get(`${bone}\u0000${name}`),
        });
      }
    },
    dispose() {
      disposed = true;
      armatures.clear();
    },
  };
}
