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
 * THE SCENE'S MOVIE plays on the same copy (`movie`, `blender-play-movie.ts`): while a game's
 * cutscene holds a scene frame (`movie.seek`), every armature shows the file's own stack at that
 * frame (its NLA strips and assigned action, as Blender's playback shows them, whatever the game
 * set), and every animated object and camera stands where the movie has it. `seek(null)` hands
 * the armatures back to what the game set, which kept its own clock meanwhile; objects keep the
 * movie's last pose, so a door the cutscene opened stays open.
 *
 * THE GAME'S CLOCK DRIVES IT: the runner advances it by each update's `dt`
 * (`@volter/play`'s `play-script.ts`), so pause, step, speed and Restart hold for
 * animation exactly as they do for the script.
 *
 * ONE MIXER for the copy (`blender-scene-mixer.ts`, `docs/SCENE-ANIMATION.md` step 4): every
 * armature's layers and the movie are actions on it, each update places them all, the mixer
 * evaluates once, and the constraints settle after it, as on the Timeline.
 */
import type { BlenderActionClip, BlenderSceneMovie } from '@volter/blender-engine/browser/rna';
import type { BlenderArmature } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';
import type * as THREE from 'three';
import { actionLayer, nlaLayers, type PoseLayer } from './blender-pose';
import { MixerPose, mixerClip, type ConstraintOverride, type MixerClip } from './blender-mixer-pose';
import { playMovie, type MovieMarker, type MovieScope, type PlayMovie } from './blender-play-movie';
import { remedy } from './blender-remedy';
import { sceneMixer } from './blender-scene-mixer';

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

/**
 * THE SCENE'S MOVIE, for a game's cutscene (`ModelPlayContext.cutscene`): read from Blender once,
 * in the loading phase, and played at the scene frames the cutscene asks for.
 */
export interface PlayAnimationMovie {
  /** The scene's range, rate and camera; null until read, or when it could not be. */
  scene(): { readonly start: number; readonly end: number; readonly fps: number; readonly camera: string | null } | null;
  /** The Timeline's markers by frame, each with the camera it is bound to. */
  markers(): readonly MovieMarker[];
  /** Hold the scene at `frame` (every armature on the file's stack, every animated object and
   *  camera as the movie has it), posed now; null hands the armatures back to the game. */
  seek(frame: number | null, scope?: { readonly collection?: string; readonly at?: unknown; readonly anchor?: string }): void;
  hasCollection(name: string): boolean;
  /** The camera Blender's playback looks through at `frame` (marker cuts, else the scene's). */
  cameraAt(frame: number): string | null;
  /** Look through a Blender camera as it stands now: its pose and projection, into `camera`. */
  look(camera: THREE.Camera, name: string): boolean;
  readonly warnings: readonly string[];
}

/** The game's door to its characters' animation (`ModelPlayContext.setAction`, `setTrack`, `setConstraint`). */
export interface PlayAnimation {
  /** The scene's own animation, for a cutscene. */
  readonly movie: PlayAnimationMovie;
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
  /**
   * THE CLIP LIBRARY, read in the background once the game runs: every action on each armature's
   * NLA strips, muted tracks included (a game's clip library), most-shared first, one read at a
   * time and only while no other read is waiting, so a clip the game asks for waits behind at most
   * one. Without it the first switch to a library clip stood the character still for a read.
   */
  prefetch(): void;
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
  readonly pose: MixerPose;
  readonly facts: BlenderArmature;
  /** Baked clips by action: the clip, undefined while baking, null when it plays nothing. */
  readonly clips: Map<string, MixerClip | null | undefined>;
  readonly failed: Map<string, string>;
  /** The active action and the ones fading out under it, oldest first. */
  line: Playing[];
  readonly tracks: Map<string, Track>;
  readonly constraints: Map<string, ConstraintOverride>;
  /** The layers of the last pose, for `live`. */
  posed: LiveArmature['layers'];
}

/** The copy's animation. `bake` reads one action of one armature through the clip door. */
/** Reads that outlive one Play: a document's next Play reuses them (see `shared` below). */
export type PlayClipCache = Map<string, Promise<BlenderActionClip | null>>;

/** Where the animation says what a person should hear at once (beside `warnings`): the editor's
 *  console in the editor, the page's console in a web export. Absent, only `warnings` keeps it. */
export interface PlayAnimationOptions {
  readonly warn?: (message: string) => void;
  /** The scene's movie (a cutscene's or a sequence's): Blender's `scene-movie` door in the editor,
   *  the dump's `movie.json` in a web export. Absent, a document lends no movie. */
  readonly readMovie?: () => Promise<BlenderSceneMovie | null>;
}

/**
 * The game's copy animated. It imports no editor host and no Blender (only `blender-pose.ts`, `blender-mixer-pose.ts`, `blender-play-movie.ts` and
 * three), so a web export plays it too, with `bake` answering clips baked when it was exported.
 */
export function playAnimation(view: BlenderRuntimeView, bake: (armature: string, action: string) => Promise<BlenderActionClip | null>, cache: PlayClipCache = new Map(), options: PlayAnimationOptions = {}): PlayAnimation {
  const warnings: string[] = [];
  const facts = view.animationFacts();
  const actions = Object.keys(facts.actions);
  const fps = facts.clock?.fps || 24;
  const sceneStart = facts.clock?.start ?? 1;
  const sceneLength = Math.max(1, (facts.clock?.end ?? sceneStart + 249) - sceneStart + 1);
  const armatures = new Map<string, Armature>();
  /** THE COPY'S ONE MIXER: every armature's actions and the movie's. */
  const scene = sceneMixer(view);
  let time = 0;
  let disposed = false;
  /** The scene frame a cutscene holds, or null while the game animates. */
  let movieFrame: number | null = null;
  /** The armatures the running sequence drives (null: every one). */
  let movieOnly: ReadonlySet<string> | null = null;
  let movie: PlayMovie | null = null;
  const movieWarnings: string[] = [];
  /** THE MOVIE'S READ, once, started by `prepare` (or by the first cutscene that wants it). */
  let movieRead: Promise<void> | null = null;
  const loadMovie = (): Promise<void> => movieRead ??= (async () => {
    const readMovie = options.readMovie;
    if (!readMovie) return;
    try {
      const data = await readMovie();
      if (disposed) return;
      if (!data) { movieWarnings.push("The scene's movie could not be read: Blender's session is not started."); return; }
      movie = playMovie(view, data, scene.mixer);
      movieWarnings.push(...movie.warnings);
      for (const said of movie.warnings) options.warn?.(said);
    } catch (error) {
      movieWarnings.push(`The scene's movie could not be read: ${error instanceof Error ? error.message : String(error)}`);
      options.warn?.(movieWarnings.at(-1)!);
    }
  })();
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
   * Blender idle. So armatures with the same bones share a read when the action has at most one
   * object slot (`objectSlots`, from Blender): with several, which slot plays depends on the
   * armature, and each armature reads its own.
   */
  // KEPT ACROSS PLAYS by the caller (`cache`): keyed by the action's REVISION too, so an action
  // edited between Plays is read again and an unchanged one is not read twice.
  const shared = cache;
  /** A clip whose slot Blender picked for its armature among several: never another armature's answer. */
  const ownSlot = (clip: BlenderActionClip | null): boolean => !!clip && (clip.objectSlots ?? 2) > 1;
  const readClip = (armature: Armature, action: string): Promise<BlenderActionClip | null> => {
    const name = armature.rig.armature;
    const skeleton = armature.facts.bones.map((bone) => bone.name).sort().join('\u0001');
    const key = `${facts.actions[action] ?? ''}\u0000${action}\u0000${skeleton}`;
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
  const clipOf = (armature: Armature, action: string): MixerClip | null | undefined => {
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
        const clip = baked ? mixerClip(baked) : null;
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
    const pose = new MixerPose(rig, scene.mixer);
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

  /** THE FILE'S STACK AT A SCENE FRAME (a cutscene): its NLA strips, then the action the file
   *  assigns it over them, as Blender's playback shows it; null while a clip is being baked. */
  const movieLayersOf = (armature: Armature, frame: number): PoseLayer[] | null => {
    const animation = armature.facts.animation;
    const stack = nlaLayers(animation, frame, (action) => clipOf(armature, action));
    const layers = [...stack.layers];
    const sources: (string | null)[] = layers.map(() => null);
    let waiting = stack.waiting;
    if (armature.facts.action) {
      const clip = clipOf(armature, armature.facts.action);
      if (clip === undefined) waiting = true;
      const layer = clip ? actionLayer(animation, clip, frame, stack.evaluated) : null;
      if (layer) { layers.push(layer); sources.push(null); }
    }
    lastSources.set(armature, sources);
    return waiting ? null : layers;
  };
  /** SET an armature's layers on the mixer (it moves at the next evaluation). */
  const placeArmature = (armature: Armature, layers: PoseLayer[]): void => {
    const sources = lastSources.get(armature) ?? [];
    armature.posed = layers.map((layer, i) => ({ track: sources[i] ?? null, action: layer.clip.action, frame: layer.frame, influence: layer.influence, blend: layer.blend }));
    armature.pose.place(layers);
  };
  /** AFTER THE MIXER: an armature's constraints, aimed at the copy's objects or what the game set. */
  const settleArmature = (armature: Armature): void => {
    armature.pose.settle({
      object: (name) => view.objectForBlenderName(name),
      override: (bone, name) => armature.constraints.get(`${bone}\u0000${name}`),
    });
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
    options.warn?.(said);
  };
  const none = (object: THREE.Object3D): Answer => ({ ok: false, why: `${object.name || 'this object'} has no armature` });

  return {
    warnings,
    movie: {
      scene: () => movie?.scene ?? null,
      markers: () => movie?.markers ?? [],
      seek(frame, scope) {
        if (disposed) return;
        movieFrame = frame;
        if (frame === null) { movieOnly = null; movie?.place(null); return; }
        if (!movie) void loadMovie();
        const only = scope?.collection ? movie?.collection(scope.collection) ?? new Set<string>() : null;
        movieOnly = only;
        const at = scope?.at as THREE.Object3D | undefined;
        const movieScope: MovieScope = {
          ...(only ? { only } : {}),
          ...(at && typeof at === 'object' && 'matrixWorld' in at && scope?.anchor ? { place: { at, anchor: scope.anchor } } : {}),
        };
        movie?.place(frame, movieScope);
        const placed: Armature[] = [];
        for (const armature of armatures.values()) {
          if (only && !only.has(armature.rig.armature)) continue;
          const layers = movieLayersOf(armature, frame);
          if (layers) { placeArmature(armature, layers); placed.push(armature); }
        }
        scene.evaluate();
        movie?.settle();
        for (const armature of placed) settleArmature(armature);
      },
      hasCollection: (name) => movie?.collection(name) != null,
      cameraAt: (frame) => movie?.cameraAt(frame) ?? null,
      look: (camera, name) => movie?.look(camera, name) ?? false,
      warnings: movieWarnings,
    },
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
      // The movie is read beside the clips, so a cutscene the game opens on is ready at once.
      const reading = loadMovie();
      const wanted = startingClips();
      for (let round = 0; round < READ_ATTEMPTS && !disposed; round += 1) {
        const open = wanted.filter(({ armature, action }) => armature.clips.get(action) === undefined);
        if (open.length === 0) break;
        await Promise.all(open.map(({ armature, action }) => bakeClip(armature, action)));
      }
      const failed = wanted
        .filter(({ armature, action }) => armature.clips.get(action) == null && armature.failed.has(action) && !/animates none/.test(armature.failed.get(action) ?? ''))
        .map(({ armature, action }) => `${armature.rig.armature} / ${action}: ${armature.failed.get(action)}`);
      await reading;
      return { failed };
    },
    prefetch() {
      const users = new Map<string, Armature[]>();
      for (const armature of armatures.values()) {
        const names = new Set<string>();
        if (armature.facts.action) names.add(armature.facts.action);
        for (const track of armature.facts.animation?.tracks ?? [])
          for (const strip of track.strips) if (strip.action) names.add(strip.action);
        for (const action of names) if (action in facts.actions) users.set(action, [...(users.get(action) ?? []), armature]);
      }
      const queue = [...users].sort((a, b) => b[1].length - a[1].length)
        .flatMap(([action, list]) => list.map((armature) => ({ armature, action })));
      void (async () => {
        while (!disposed) {
          if (baking.size > 0) { await Promise.allSettled([...baking.values()]); continue; }
          const next = queue.find(({ armature, action }) => !armature.clips.has(action));
          if (!next) return;
          await bakeClip(next.armature, next.action);
        }
      })();
    },
    pending() {
      return startingClips()
        .filter(({ armature, action }) => armature.clips.get(action) === undefined && !armature.failed.has(action))
        .map(({ armature, action }) => `${armature.rig.armature} / ${action}`);
    },
    update(dt) {
      if (disposed) return;
      time += dt;
      const placed: Armature[] = [];
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
        // A CUTSCENE HOLDS THE SCENE: its `seek` poses the armature at the movie's frame.
        if (movieFrame !== null && (!movieOnly || movieOnly.has(armature.rig.armature))) continue;
        const layers = layersOf(armature);
        if (!layers) continue;
        placeArmature(armature, layers);
        placed.push(armature);
      }
      // ONE EVALUATION for every character (and a cutscene's objects, held where its last seek placed
      // them: their placing and aiming is settled again after it)
      if (placed.length === 0) return;
      scene.evaluate();
      if (movieFrame !== null) movie?.settle();
      for (const armature of placed) settleArmature(armature);
    },
    channels(name, action) {
      const clip = armatures.get(name)?.clips.get(action);
      if (!clip) return [];
      return [...clip.bones].map(([bone, sampled]) => ({ bone, keys: [...sampled.keys].sort((a, b) => a - b) }));
    },
    live: () => [...armatures.values()].map((armature) => ({ armature: armature.rig.armature, layers: armature.posed })),
    dispose() {
      disposed = true;
      for (const armature of armatures.values()) armature.pose.dispose();
      armatures.clear();
      (movie as PlayMovie | null)?.dispose();
      movie = null;
    },
  };
}
