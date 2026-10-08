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
 * baked, the armature keeps the pose it has. The clips each character STARTS on are baked before
 * the game starts (`prepare`), and a bake that could not be read is tried again, so a slow or
 * failed read at Play's start does not leave a character frozen for the run.
 *
 * THE GAME'S CLOCK DRIVES IT: the runner advances it by each update's `dt`
 * (`@volter/play`'s `play-script.ts`), so pause, step, speed and Restart hold for
 * animation exactly as they do for the script.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type { BlenderArmature } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';
import type * as THREE from 'three';
import { ArmaturePose, nlaLayers, poseClip, type ConstraintOverride, type PoseClip, type PoseLayer } from './blender-pose';
import { editorHost } from '@volter/sdk/host';
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
  /**
   * THE LOADING PHASE: bakes every clip a character starts on (its assigned action and its NLA
   * strips' actions) before the game's first update, so no character stands frozen while Blender
   * answers. Resolves with what could not be loaded; clips the game asks for later still bake on
   * first use.
   */
  prepare(): Promise<{ readonly failed: readonly string[] }>;
  /** The starting clips `prepare` is still waiting on Blender for, as `armature / action`. */
  pending(): readonly string[];
  /** What each character is playing now, bottom layer first: the animation editors' live view. */
  live(): readonly LiveArmature[];
  /** The frames an action keys, per bone, for one armature (empty until it was baked). */
  channels(armature: string, action: string): { bone: string; keys: number[] }[];
  readonly warnings: readonly string[];
  dispose(): void;
}

/** One character's animation at the game's last update. */
export interface LiveArmature {
  readonly armature: string;
  /** The layers it was posed from, bottom first: each clip, its frame, influence and blend. */
  readonly layers: readonly {
    /** Where the layer comes from: an NLA track's name, or `null` for the active action. */
    readonly track: string | null;
    readonly action: string;
    readonly frame: number;
    readonly influence: number;
    readonly blend: string;
  }[];
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
  /** The layers of the last pose, for `live`. */
  posed: LiveArmature['layers'];
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
  const lastSources = new Map<Armature, (string | null)[]>();

  const fail = (armature: Armature, action: string, why: string): void => {
    armature.clips.set(action, null);
    armature.failed.set(action, why);
    warnings.push(`${armature.rig.armature} / ${action}: ${why}`);
  };
  /** Reads that failed (Blender busy, the call refused) per clip: tried again up to this many times. */
  const READ_ATTEMPTS = 3;
  const attempts = new Map<string, number>();
  const baking = new Map<string, Promise<void>>();
  /**
   * ONE BAKE PER ACTION AND SKELETON. A bake depends on the action, the armature's bones and the
   * action slot Blender picks for it (`rna_action_clip`), never on the armature otherwise; each
   * read holds the Blender worker for about 1.5 s. Read per armature, fifteen enemies placed from
   * one piece baked the same clip fifteen times, and an action the game switched one to waited
   * behind all of them: measured on Heck Plungers, half the characters still unposed 20 s in with
   * Blender idle. So armatures with the same bones share a read, unless the slot is this
   * armature's own (named for it) or Blender had to choose among several (its `reason` says so):
   * then the next armature asks for its own.
   */
  const shared = new Map<string, Promise<BlenderActionClip | null>>();
  /** A clip whose slot Blender picked for its own armature: never another armature's answer. */
  const ownSlot = (clip: BlenderActionClip | null): boolean => !!clip && (clip.slot === clip.armature || /object slots/.test(clip.reason ?? ''));
  const readClip = (armature: Armature, action: string): Promise<BlenderActionClip | null> => {
    const name = armature.rig.armature;
    const skeleton = armature.facts.bones.map((bone) => bone.name).sort().join('\u0001');
    const key = `${action}\u0000${skeleton}`;
    const known = shared.get(key);
    if (known) return known.then((clip) => (ownSlot(clip) && clip!.armature !== name ? bake(name, action) : clip));
    const read = bake(name, action).then((clip) => {
      if (ownSlot(clip)) shared.delete(key);
      return clip;
    }, (error: unknown) => {
      shared.delete(key);
      throw error;
    });
    shared.set(key, read);
    return read;
  };
  const clipOf = (armature: Armature, action: string): PoseClip | null | undefined => {
    if (armature.clips.has(action)) return armature.clips.get(action);
    void bakeClip(armature, action);
    return undefined;
  };
  const bakeClip = (armature: Armature, action: string): Promise<void> => {
    const key = `${armature.rig.armature}\u0000${action}`;
    const running = baking.get(key);
    if (running) return running;
    if (armature.clips.has(action) && armature.clips.get(action) !== undefined) return Promise.resolve();
    armature.clips.set(action, undefined);
    const done = readClip(armature, action).then((baked) => {
      // A clip that cannot be posed is that clip's failure, named like the others; it never
      // rejects the bake, so the loading phase that awaits it always settles.
      try {
        const clip = baked ? poseClip(baked) : null;
        for (const thing of clip?.unsupported ?? []) warnings.push(`${armature.rig.armature}: ${thing} plays only in Blender, not in a game.${remedy([thing])}`);
        if (clip) armature.clips.set(action, clip);
        else fail(armature, action, baked?.reason ?? `it animates none of ${armature.rig.armature}'s bones`);
      } catch (error) {
        fail(armature, action, `it could not be posed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, (error: unknown) => {
      const tried = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, tried);
      const why = `it could not be read: ${error instanceof Error ? error.message : String(error)}`;
      // A READ THAT FAILED is not the clip's answer: the next pose asks again, up to READ_ATTEMPTS.
      if (tried < READ_ATTEMPTS && !disposed) armature.clips.delete(action);
      else fail(armature, action, why);
    }).finally(() => baking.delete(key));
    baking.set(key, done);
    return done;
  };

  /**
   * Each armature's assigned action and the strips' actions of the NLA tracks it plays (enabled as
   * `layersOf` reads them: NLA on, under a solo only the soloed track, else the unmuted ones): the
   * clips it starts on. A muted track's strips are a clip library, baked when the game asks.
   */
  const startingClips = (): { armature: Armature; action: string }[] => [...armatures.values()].flatMap((armature) => {
    const names = new Set<string>();
    if (armature.facts.action) names.add(armature.facts.action);
    const animation = armature.facts.animation;
    const solo = animation?.tracks.some((track) => track.solo) ?? false;
    for (const track of animation && animation.useNla ? animation.tracks : [])
      if (solo ? track.solo : !track.mute)
        for (const strip of track.strips) if (strip.action) names.add(strip.action);
    return [...names].filter((name) => name in facts.actions).map((action) => ({ armature, action }));
  });

  for (const rig of view.skeletons.rigs()) {
    const entry = facts.armatures[rig.armature];
    if (!entry) continue;
    const pose = new ArmaturePose(rig);
    pose.facts(entry);
    for (const thing of pose.unsupported()) warnings.push(`${rig.armature}: ${thing} plays only in Blender, not in a game.${remedy([thing])}`);
    const armature: Armature = { rig, pose, facts: entry, clips: new Map(), failed: new Map(), line: [], tracks: new Map(), constraints: new Map(), posed: [] };
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
    /** Each layer's source, by index: a track's name, or null for the active action. */
    const sources: (string | null)[] = [];
    let source: string | null = null;
    let waiting = false;
    /** Whether an enabled track has strips (or a game's track plays): what places the active action. */
    let evaluated = false;
    const take = (layer: PoseLayer | null | undefined): void => {
      if (layer === undefined) waiting = true;
      else if (layer) { layers.push(layer); sources.push(source); }
    };
    const animation = armature.facts.animation;
    // THE SCENE FRAME, wrapping at the scene's end as Blender's playback wraps.
    const frame = sceneStart + ((time * fps) % sceneLength);
    const solo = animation?.tracks.some((track) => track.solo) ?? false;
    for (const track of animation && animation.useNla ? animation.tracks : []) {
      const set = armature.tracks.get(track.name);
      // ENABLED as Blender says: under a solo only the soloed track, muted or not.
      if (solo ? !track.solo : (set ? set.mute : track.mute)) continue;
      const influence = set ? set.influence.weight : 1;
      source = track.name;
      if (set?.action) {
        const blend = track.strips[0]?.blendType ?? 'REPLACE';
        if (set.previous) take(playedLayer(armature, set.previous, influence, blend));
        take(playedLayer(armature, set.action, influence, blend));
        evaluated = true;
        continue;
      }
      const stack = nlaLayers({ ...animation!, tracks: [{ ...track, mute: false, solo: false }] }, frame, (action) => clipOf(armature, action));
      if (stack.waiting) waiting = true;
      if (stack.evaluated) evaluated = true;
      for (const layer of stack.layers) { layers.push({ ...layer, influence: layer.influence * influence }); sources.push(track.name); }
    }
    for (const [name, set] of armature.tracks) {
      if (!set.own || set.mute || !set.action) continue;
      source = name;
      if (set.previous) take(playedLayer(armature, set.previous, set.influence.weight, 'REPLACE'));
      take(playedLayer(armature, set.action, set.influence.weight, 'REPLACE'));
      evaluated = true;
    }
    // THE ACTIVE ACTION as Blender places it: not at all under a soloed track, alone and whole when
    // no enabled track has strips, else at its influence and blend type over them.
    const nla = !!animation?.useNla;
    const strips = nla && evaluated;
    source = null;
    for (const played of nla && solo ? [] : armature.line)
      take(playedLayer(armature, played, strips ? animation!.influence : 1, strips ? animation!.blendType : 'REPLACE'));
    lastSources.set(armature, sources);
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
    async prepare() {
      const wanted = startingClips();
      for (let round = 0; round < READ_ATTEMPTS && !disposed; round += 1) {
        const open = wanted.filter(({ armature, action }) => armature.clips.get(action) === undefined);
        if (open.length === 0) break;
        await Promise.all(open.map(({ armature, action }) => bakeClip(armature, action)));
      }
      const failed = wanted
        .filter(({ armature, action }) => armature.clips.get(action) == null && armature.failed.has(action) && !/animates none/.test(armature.failed.get(action) ?? ''))
        .map(({ armature, action }) => `${armature.rig.armature} / ${action}: ${armature.failed.get(action)}`);
      return { failed };
    },
    pending() {
      return startingClips()
        .filter(({ armature, action }) => armature.clips.get(action) === undefined && !armature.failed.has(action))
        .map(({ armature, action }) => `${armature.rig.armature} / ${action}`);
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
        const sources = lastSources.get(armature) ?? [];
        armature.posed = layers.map((layer, i) => ({ track: sources[i] ?? null, action: layer.clip.action, frame: layer.frame, influence: layer.influence, blend: layer.blend }));
        armature.pose.apply(layers, {
          object: (name) => view.objectForBlenderName(name),
          override: (bone, name) => armature.constraints.get(`${bone}\u0000${name}`),
        });
      }
    },
    channels(name, action) {
      const clip = armatures.get(name)?.clips.get(action);
      if (!clip) return [];
      const bones = new Map<string, Set<number>>();
      for (const channel of clip.channels) {
        let frames = bones.get(channel.bone);
        if (!frames) bones.set(channel.bone, frames = new Set());
        for (const curve of channel.curves) if (curve) for (let i = 0; i < curve.keys.length; i += 6) frames.add(Math.round(curve.keys[i]! * 1000) / 1000);
      }
      return [...bones].map(([bone, frames]) => ({ bone, keys: [...frames].sort((a, b) => a - b) }));
    },
    live: () => [...armatures.values()].map((armature) => ({ armature: armature.rig.armature, layers: armature.posed })),
    dispose() {
      disposed = true;
      armatures.clear();
    },
  };
}
