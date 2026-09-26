/**
 * `AnimationPlayer` — `playback_speed` over a three `AnimationMixer`'s `timeScale`, and
 * `play`/`queue` over a name→`AnimationAction` playback head.
 *
 * ## `playback_speed` (squash-the-creeps)
 *
 * `squash-the-creeps` writes it three times and never reads it:
 * `Player.gd:32`/`:34` speed the run cycle up while the player is moving and
 * back down when it stops, and `Mob.gd:29` scales a mob's walk to the random
 * speed it was given. It maps to the MIXER rather than to one action: Godot's
 * `playback_speed` is a multiplier over the whole player, so every clip that
 * player owns scales together — `mixer.timeScale`, not `action.timeScale`.
 *
 * ## `play`/`queue` (platformer-3d)
 *
 * `platformer-3d` adds the first `play`/`queue` callers in the lane, and they are the SIMPLE
 * members — a single clip at a time, no blend graph (that is `animation-tree.ts`). `enemy.gd:40`
 * plays `"impact"` then queues `"explode"` on death, and `coin.gd:9` plays `"take"` on pickup —
 * all one-shot clips. Godot's `play(name)` stops the current clip, seeks the named one to its start
 * and plays it, clearing the queue unless the current clip just ENDED (`animation_player.cpp:604`-
 * `647`, `:935`-`940`); `queue(name)` plays immediately when nothing is playing and otherwise
 * enqueues, and the queue advances when the current NON-looping clip reaches its end
 * (`:2` `queue`, `:935` end handling). three's `AnimationMixer` fires `'finished'` for a `LoopOnce`
 * action at exactly that moment, so this head drains the queue on that event — Godot's own end
 * signal, not a compat scheduler.
 *
 * ## One player, two halves — a per-CLIP mixer
 *
 * A Godot `AnimationPlayer` owns clips of MIXED kinds: `enemy.tscn`'s player drives the Armature's
 * `Skeleton` with `impact`/`walk-cycle` AND keys ordinary node properties with `explode`, and
 * `enemy.gd:40`-`41` reaches BOTH through the one head (`play("impact")`, then `queue("explode")`).
 * three binds a keyframe track by NAME against the mixer's root, so those two halves want two roots
 * — the Skeleton (where `<bone>.quaternion` resolves) and the player's parent (where `Sphere.visible`
 * does). That is the whole of the difference: a {@link NamedClip} may carry its OWN
 * {@link NamedClip.mixer}, and {@link playAnimation}/{@link queueAnimation} dispatch per CLIP NAME to
 * whichever mixer that clip named. The playback head — current action, current name, queue — stays
 * ONE, because Godot's is one: `queue("explode")` behind a running `impact` drains on `impact`'s own
 * `'finished'`, whichever mixer fired it (hence {@link AnimationPlayerState.mixers}, which every
 * `'finished'` listener is added to and removed from together).
 *
 * ## Switching clips: BLEND, and the bind-pose trap
 *
 * Godot's `play()` does not hard-cut. `AnimationPlayer.playback_default_blend_time`
 * (`enemy.tscn` authors `0.5`) and the per-pair `blend_times` table cross-fade the outgoing
 * animation into the incoming one over that many seconds, with each clip still advancing at its
 * own rate (`animation_player.cpp` `_animation_process2` blends the playback list; it does NOT
 * warp either clip's time base). three's `AnimationAction.crossFadeFrom` is that same weight ramp,
 * so it is used with `warp = false` — warping would speed one clip up to match the other's
 * duration, which Godot never does.
 *
 * The trap is the OTHER half of a mixed player. three's `AnimationAction.stop()` deactivates the
 * action, and when the last user of a binding goes away the mixer calls `restoreOriginalState()` —
 * every bone snaps back to BIND POSE. Godot has no such rule: a stopped `AnimationPlayer` leaves
 * the pose it last wrote. That difference is invisible while both clips share one mixer (the
 * incoming action overwrites the same bindings on the same frame), and VISIBLE the moment they do
 * not: `enemy.gd:40` plays `impact` on the Skeleton's mixer then queues `explode` on the value
 * mixer, and stopping `impact` stood the corpse upright mid-explosion. So a switch to a clip on a
 * DIFFERENT mixer PAUSES the outgoing action at its weight instead of stopping it — a paused
 * three action still evaluates and accumulates its pose at the frozen playhead, which is exactly
 * "Godot retains the last written pose". The paused action is remembered per mixer
 * ({@link AnimationPlayerState.retained}) and released the next time that same mixer is driven,
 * so two clips never accumulate on one mixer at full weight.
 *
 * This is NOT a second animation system: {@link playAnimation} returns three's own
 * `AnimationAction` and every later call is three's API (return path). The caller owns the mixer and
 * clips; compat owns the small playback head — current action, name and queue — the same split
 * `animated-sprite.ts` records for the 2D lane.
 *
 * ## Resource ownership
 *
 * **Owns:** the playback head of ONE `AnimationPlayer` — current action, current name, queue, and
 * the per-mixer retained-pose action — held in a plain record, plus the one `'finished'` listener
 * {@link createAnimationPlayer} adds to EACH of the caller's mixers. **Does not own:** the
 * `AnimationMixer`s or `AnimationClip`s. **Teardown:**
 * {@link disposeAnimationPlayer} removes every listener it added; the caller disposes its mixers.
 * `playback_speed`'s two functions own nothing — a read and a write on the caller's mixer.
 */

import {
  type AnimationAction,
  type AnimationClip,
  type AnimationMixer,
  LoopOnce,
  LoopRepeat,
} from 'three';
import {
  animationLibraryEntries,
  bindGodotAnimation,
  createGodotAnimationLibrary,
  watchAnimationLibrary,
  type GodotAnimationLibrary,
} from './animation-resource';
import { packedStringArray, type PackedArrayValue } from './packed-array';
import { registerGodotObjectIdentity } from './object';
import { godotNodePathNew, type GodotNodePath } from './node-path';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import {
  getPixiAssignedAnimation,
  isPixiAnimationPlayerValid,
  setPixiAssignedAnimation,
  type GodotPixiAnimationPlayer,
} from './pixi-animation-player';

/**
 * The half of a three `AnimationMixer` this file touches.
 *
 * Structural for the reason `physics-2d.ts`'s Rapier interfaces are: declaring
 * a dependency for one number would make every project that copies this folder
 * install it, and three's own `AnimationMixer` satisfies this as it stands.
 */
export interface PlaybackSpeedMixer {
  timeScale: number;
}

/**
 * What `playback_speed`/`speed_scale` can be written ON — the TWO shapes a translated
 * `AnimationPlayer` node is emitted as, because Godot's one class is two different things here.
 *
 * A player whose clips are only autoplayed (`squash-the-creeps`' model-transform bob) needs no
 * playback head at all and is emitted as a bare `AnimationMixer`. A player a script `play()`s is
 * emitted as an {@link AnimationPlayerState}, which OWNS its mixers and is not one. Both are the
 * same Godot node and the same property, so this pair takes either rather than making the emitter
 * guess which handle its own scene built.
 *
 * The state case scales EVERY mixer, not just the default one: Godot's `speed_scale` multiplies the
 * delta the whole player advances by, and a MIXED player's halves are separate three mixers
 * ({@link AnimationPlayerState.mixers} — see this file's header). Scaling only the default one would
 * run a mixed player's two halves at different rates.
 */
export type PlaybackSpeedTarget = PlaybackSpeedMixer | AnimationPlayerState;

interface MixerActiveState {
  active: boolean;
  speed: number;
}

const ACTIVE_MIXER_STATE = new WeakMap<PlaybackSpeedMixer, MixerActiveState>();

function retainedMixerActiveState(mixer: PlaybackSpeedMixer): MixerActiveState {
  let state = ACTIVE_MIXER_STATE.get(mixer);
  if (state !== undefined) return state;
  state = { active: true, speed: mixer.timeScale };
  ACTIVE_MIXER_STATE.set(mixer, state);
  return state;
}

/** Every mixer a write must reach, for whichever of the two shapes the caller holds. */
function speedMixersOf(target: PlaybackSpeedTarget): readonly PlaybackSpeedMixer[] {
  return 'mixers' in target ? target.mixers : [target];
}

/** `animation_player.playback_speed` / `animation_player.speed_scale`. A player's mixers are kept
 *  in lockstep by {@link setPlaybackSpeed}, so the first one answers for all of them. */
export function getPlaybackSpeed(target: PlaybackSpeedTarget): number {
  const mixer = speedMixersOf(target)[0];
  if (mixer === undefined) return 1;
  const active = ACTIVE_MIXER_STATE.get(mixer);
  return active?.active === false ? active.speed : mixer.timeScale;
}

/**
 * `animation_player.playback_speed = v` — `Player.gd:32`, `:34`; `Mob.gd:29`; and Godot 4's
 * spelling of the same property, `speed_scale` — `starter-kit-3d-platformer` `player.gd:98`/`:100`.
 *
 * @throws on a negative speed. Godot plays the animation BACKWARDS at a
 * negative `playback_speed` and three's mixer does too, so this would be a
 * legal write — but no measured caller does it, and the two engines disagree
 * about what a backwards clip does at its own loop boundary. Refusing names the
 * gap; absorbing it would be a lookalike that desynchronises after one loop.
 */
export function setPlaybackSpeed(target: PlaybackSpeedTarget, value: number): void {
  if (value < 0) {
    throw new Error(
      `godot-compat: AnimationPlayer.playback_speed = ${value} plays the clip BACKWARDS. Godot ` +
        "and three's AnimationMixer both accept it and disagree about the loop boundary, so " +
        'this backend refuses rather than drifting a frame per loop. Nothing measured writes a ' +
        'negative speed.',
    );
  }
  for (const mixer of speedMixersOf(target)) {
    const active = retainedMixerActiveState(mixer);
    active.speed = value;
    if (active.active) mixer.timeScale = value;
  }
}

/**
 * One named clip a caller hands an {@link AnimationPlayerState}: the three `AnimationClip` and whether
 * Godot's `Animation.loop` is set. The loop flag decides the action's loop mode — a non-looping
 * one-shot (`impact`/`explode`/`take`) is `LoopOnce` so the mixer fires `'finished'` and the queue
 * can advance; a looping clip is `LoopRepeat`.
 */
export interface NamedClip {
  readonly clip: AnimationClip;
  readonly loop: boolean;
  /**
   * The mixer this clip plays on, when it is NOT the player's own — the second half of a MIXED
   * player (see this file's header). three binds a keyframe track by name against the mixer's root,
   * so a clip whose tracks key a different root than the player's default names that root's mixer
   * here. Absent for every single-rooted player, which is all of them but `enemy.tscn`'s.
   */
  readonly mixer?: AnimationMixer;
}

/** One authored `blend_times` entry — Godot stores the table as flat `[from, to, seconds]` triples
 *  on the `AnimationPlayer` (`animation_player.cpp` `_set("blend_times")`). It is DIRECTIONAL: the
 *  time for `a → b` says nothing about `b → a`. */
export interface AnimationBlendTime {
  readonly from: string;
  readonly to: string;
  readonly seconds: number;
}

/**
 * The separator {@link blendKey} joins an ordered clip pair with: U+0000, spelled as the ESCAPE
 * `'\u0000'` and never as a literal byte.
 *
 * A Godot clip name is an arbitrary `String` map key on the `AnimationPlayer` (`anims/<name>`);
 * Godot restricts no character class, so a SPACE is a legal clip name character and joining on one
 * collides — `blend_times` entries `("run fast", "idle")` and `("run", "fast idle")` would produce
 * the identical key and the later write would silently cross-fade one of the pairs over the other's
 * duration. NUL is the one character a Godot clip name cannot contain, so this key is injective by
 * construction.
 *
 * The ESCAPE matters as much as the character. This constant used to be a raw NUL byte typed into
 * the template literal and into the sentence explaining it, which renders as a space in every
 * viewer — so the file read as if it joined on a space, and the fidelity catalog recorded it as
 * exactly that defect. An invisible byte cannot be reviewed, and any tool that normalizes control
 * characters would change the separator with nothing to notice.
 */
const BLEND_KEY_SEPARATOR = '\u0000';

/** The key {@link AnimationPlayerState.blendTimes} is stored under — the ordered pair joined by
 *  {@link BLEND_KEY_SEPARATOR}, which no Godot clip name can contain. */
function blendKey(from: string, to: string): string {
  return `${from}${BLEND_KEY_SEPARATOR}${to}`;
}

/**
 * The runtime playback head of ONE `AnimationPlayer`: the mixer + named clips the caller supplies, and
 * the current action / name / queue compat maintains. Built by {@link createAnimationPlayer}.
 */
export interface AnimationPlayerState {
  readonly godotMajor: 3 | 4;
  /** The player's DEFAULT mixer — the one a clip that names none plays on. */
  readonly mixer: AnimationMixer;
  readonly clips: Map<string, NamedClip>;
  readonly libraries: Map<string, GodotAnimationLibrary>;
  readonly libraryReleases: Map<GodotAnimationLibrary, () => void>;
  /** Authored AnimationPlayer root NodePath consumed when the native mixer roots are built. */
  rootNode: GodotNodePath;
  /** Every distinct mixer this player's clips play on — {@link mixer} first, then each
   *  {@link NamedClip.mixer}. The `'finished'` listener is on all of them, because the ONE queue
   *  advances on whichever half just ended. */
  readonly mixers: readonly AnimationMixer[];
  /** `playback_default_blend_time` — seconds to cross-fade an outgoing clip into an incoming one
   *  when no per-pair time is authored. Godot's own default is `0` (a hard cut). */
  defaultBlendTime: number;
  /** The authored per-pair `blend_times`, keyed by {@link blendKey}. Overrides
   *  {@link defaultBlendTime} for that ordered pair. */
  readonly blendTimes: Map<string, number>;
  readonly nextAnimations: Map<string, string>;
  autoplay: string;
  autoCapture: boolean;
  autoCaptureDuration: number;
  autoCaptureTransitionType: number;
  autoCaptureEaseType: number;
  movieQuitOnFinish: boolean;
  sectionStart: number | null;
  sectionEnd: number | null;
  active: boolean;
  deterministic: boolean;
  resetOnSave: boolean;
  callbackModeProcess: number;
  callbackModeMethod: number;
  callbackModeDiscrete: number;
  current: AnimationAction | null;
  currentName: string | null;
  /** Godot's playback head owns this flag independently from the assigned clip. A one-shot keeps
   *  its final position after it stops playing, so `current` alone is not the predicate. */
  playing: boolean;
  readonly queue: string[];
  /** Per mixer, the action PAUSED to hold the pose it last wrote — see this file's header. Godot
   *  needs no such record (it never restores a bind pose); three does, so the next clip driving
   *  that same mixer can release it instead of blending against it. */
  readonly retained: Map<AnimationMixer, AnimationAction>;
  /** Godot's inherited AnimationMixer signals over the same native playback head. */
  readonly animationFinished: SignalHandle<readonly [animationName: string]>;
  readonly animationStarted: SignalHandle<readonly [animationName: string]>;
  /** The `'finished'` listener, retained so {@link disposeAnimationPlayer} can remove it. */
  readonly onFinished: (event: { readonly action: AnimationAction }) => void;
}

/**
 * The cross-fade Godot would use for this switch: `play`'s own `custom_blend` when the caller
 * passed a non-negative one, else the authored `blend_times` entry for the ordered pair, else
 * `playback_default_blend_time`.
 *
 * That ORDER is Godot's, and the three branches are one `blend_time` local in the engine —
 * `AnimationPlayer::play_section` (4.7-stable, `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 *
 * ```cpp
 * if (Animation::is_greater_or_equal_approx(p_custom_blend, 0)) {
 *     blend_time = p_custom_blend;
 * } else if (blend_times.has(bk)) {
 *     blend_time = blend_times[bk];
 * } …
 * if (Animation::is_less_approx(p_custom_blend, 0) && Math::is_zero_approx(blend_time) && default_blend_time) {
 *     blend_time = default_blend_time;
 * }
 * ```
 *
 * The SIGN is the whole of the test, and it is why this is `>= 0` rather than a `??` or a `||`:
 *
 *  - A NEGATIVE `custom_blend` is Godot's own default (`play(name, custom_blend = -1)` in both
 *    pinned dumps) and means "use the table". A `customBlend ?? …` would pass `-1` on as a
 *    duration, cross-fading for a negative window.
 *  - An explicitly-ZERO `custom_blend` is a HARD CUT, not "unset": the `default_blend_time`
 *    fallback is gated on `p_custom_blend < 0`, so `play(x, 0)` cuts even on a node that authors a
 *    default. A `customBlend || …` would fall back to that default instead.
 *  - Any non-negative value OVERRIDES the authored table, not merely the default — Godot never
 *    consults `blend_times` on that branch.
 */
function blendTimeFor(
  state: AnimationPlayerState,
  from: string,
  to: string,
  customBlend: number | undefined,
): number {
  if (customBlend !== undefined && customBlend >= 0) return customBlend;
  return state.blendTimes.get(blendKey(from, to)) ?? state.defaultBlendTime;
}

function startClip(
  state: AnimationPlayerState,
  name: string,
  clearQueue: boolean,
  customBlend?: number,
): AnimationAction {
  refreshPlayerClips(state);
  const named = state.clips.get(name);
  if (named === undefined) {
    throw new Error(
      `godot-compat: AnimationPlayer.play("${name}") — no such clip. The caller builds the clip map ` +
        'from the model; a missing name is a build error, and Godot ERR_FAILs here too.',
    );
  }
  if (clearQueue) state.queue.length = 0;
  const previous = state.current;
  const previousName = state.currentName;
  const mixer = named.mixer ?? state.mixer;
  const action = mixer.clipAction(named.clip);
  action.setLoop(named.loop ? LoopRepeat : LoopOnce, named.loop ? Number.POSITIVE_INFINITY : 1);
  // A one-shot holds its last frame rather than snapping back, matching Godot leaving the head at
  // the end when a non-looping clip finishes with nothing queued.
  action.clampWhenFinished = !named.loop;
  action.reset();
  action.timeScale = 1;
  action.play();
  const switching = previous !== null && previousName !== null && previousName !== name;
  if (switching && previous !== null && previousName !== null) {
    if (previous.getMixer() !== mixer) {
      // A DISJOINT-mixer switch. Stopping here would restore the outgoing mixer's bind pose and no
      // incoming action would overwrite it (the two mixers share no bindings), so the outgoing
      // action is paused at its weight — it keeps applying the pose Godot would have left behind.
      previous.paused = true;
      state.retained.set(previous.getMixer(), previous);
    } else {
      const blend = blendTimeFor(state, previousName, name, customBlend);
      if (blend > 0) {
        // three's own weight ramp, un-warped: Godot blends WEIGHTS over `blend_time` while each
        // clip keeps its own time base.
        action.crossFadeFrom(previous, blend, false);
      } else {
        // Godot stops the outgoing clip's caches when the animation changes with no blend
        // (animation_player.cpp:619); on ONE mixer the incoming action rewrites the same bindings
        // on the same frame, so there is no bind-pose flash to avoid.
        previous.stop();
      }
    }
  }
  // Release any pose this mixer was holding for a disjoint-mixer switch — done AFTER `play()` so the
  // incoming action already holds the shared bindings and nothing is restored to bind pose.
  const held = state.retained.get(mixer);
  if (held !== undefined) {
    state.retained.delete(mixer);
    if (held !== action) held.stop();
  }
  state.current = action;
  state.currentName = name;
  state.playing = true;
  state.animationStarted.emit(name);
  return action;
}

/**
 * Build the playback head for one `AnimationPlayer` and wire the queue drain to the mixer's own
 * `'finished'` event.
 *
 * `clips` is the caller's map from CLIP NAME to the three clip plus its Godot loop flag. The
 * `'finished'` listener advances the queue exactly when a non-looping current clip ends — Godot's
 * `end_reached` path (`animation_player.cpp:935`-`940`).
 *
 * `defaultBlendTime`/`blendTimes` are the node's authored `playback_default_blend_time` and
 * `blend_times` table; both default to Godot's own default of a hard cut.
 */
export function createAnimationPlayer(options: {
  readonly godotMajor: 3 | 4;
  readonly mixer: AnimationMixer;
  readonly clips: ReadonlyMap<string, NamedClip>;
  readonly defaultBlendTime?: number;
  readonly blendTimes?: readonly AnimationBlendTime[];
  readonly rootNode?: GodotNodePath | string;
}): AnimationPlayerState {
  const animationFinished = createSignal<readonly [animationName: string]>();
  const animationStarted = createSignal<readonly [animationName: string]>();
  const mixers: AnimationMixer[] = [options.mixer];
  for (const named of options.clips.values()) {
    if (named.mixer !== undefined && !mixers.includes(named.mixer)) mixers.push(named.mixer);
  }
  const defaultBlendTime = options.defaultBlendTime ?? 0;
  if (defaultBlendTime < 0) {
    throw new Error(
      `godot-compat: AnimationPlayer.playback_default_blend_time = ${defaultBlendTime}. A blend ` +
        'time is a duration; Godot clamps it at 0 and a negative one is a malformed .tscn.',
    );
  }
  const blendTimes = new Map<string, number>();
  for (const entry of options.blendTimes ?? []) {
    blendTimes.set(blendKey(entry.from, entry.to), entry.seconds);
  }
  const clips = new Map<string, NamedClip>();
  for (const [clipName, named] of options.clips) {
    const clip = bindGodotAnimation(named.clip, options.godotMajor, named.loop);
    clips.set(clipName, { ...named, clip });
  }
  const state: AnimationPlayerState = {
    godotMajor: options.godotMajor,
    mixer: options.mixer,
    clips,
    libraries: new Map(),
    libraryReleases: new Map(),
    rootNode: godotNodePathNew(options.rootNode ?? '..'),
    mixers,
    defaultBlendTime,
    blendTimes,
    nextAnimations: new Map(),
    autoplay: '',
    autoCapture: true,
    autoCaptureDuration: -1,
    autoCaptureTransitionType: 0,
    autoCaptureEaseType: 0,
    movieQuitOnFinish: false,
    sectionStart: null,
    sectionEnd: null,
    active: true,
    deterministic: true,
    resetOnSave: true,
    callbackModeProcess: 1,
    callbackModeMethod: 0,
    callbackModeDiscrete: 0,
    current: null,
    currentName: null,
    playing: false,
    queue: [],
    retained: new Map<AnimationMixer, AnimationAction>(),
    animationFinished,
    animationStarted,
    onFinished: (event) => {
      if (event.action !== state.current) return;
      const finishedName = state.currentName;
      if (finishedName !== null) state.animationFinished.emit(finishedName);
      const next = state.queue.shift() ??
        (state.currentName === null ? undefined : state.nextAnimations.get(state.currentName));
      // Godot advances to the queued clip WITHOUT clearing the rest of the queue (it pops one and
      // plays it via the same play() while end_reached is still true, :935-:940).
      if (next !== undefined) startClip(state, next, false);
      else state.playing = false;
    },
  };
  const defaultLibrary = createGodotAnimationLibrary(options.godotMajor);
  for (const [clipName, named] of clips) defaultLibrary.add_animation(clipName, named.clip);
  state.libraries.set('', defaultLibrary);
  watchPlayerLibrary(state, '', defaultLibrary);
  registerGodotObjectIdentity(state, 'AnimationPlayer');
  // three types the mixer event loosely; the listener only reads `event.action`. A MIXED player's
  // halves are separate mixers and each fires its own 'finished', so all of them feed the one queue.
  for (const mixer of mixers) {
    mixer.addEventListener('finished', state.onFinished as (event: unknown) => void);
  }
  return state;
}

export function getAnimationPlayerRootNode(state: AnimationPlayerState): GodotNodePath {
  return godotNodePathNew(state.rootNode);
}

export function getAnimationFinishedSignal(
  state: AnimationPlayerState,
): GodotSignal<readonly [animationName: string]> {
  return state.animationFinished.signal;
}

export function getAnimationStartedSignal(
  state: AnimationPlayerState,
): GodotSignal<readonly [animationName: string]> {
  return state.animationStarted.signal;
}

/** Remove the `'finished'` listener {@link createAnimationPlayer} added to each of the player's
 *  mixers. The caller disposes the mixers themselves. */
export function disposeAnimationPlayer(state: AnimationPlayerState): void {
  for (const mixer of state.mixers) {
    mixer.removeEventListener('finished', state.onFinished as (event: unknown) => void);
  }
  for (const release of state.libraryReleases.values()) release();
  state.libraryReleases.clear();
}

/**
 * `AnimationPlayer.play(name, custom_blend)` — `enemy.gd:40` (`"impact"`), `coin.gd:9` (`"take"`),
 * `starter-kit-3d-platformer` `player.gd:85`/`:95`/`:103` (`play("walk", 0.1)` and its two siblings).
 *
 * Seeks the named clip to its start, plays it, and clears the queue (a fresh `play` is not an
 * end-driven advance, so `animation_player.cpp:643` clears `queued`). What happens to the OUTGOING
 * clip is the blend/bind-pose story in this file's header: a same-mixer switch cross-fades over
 * `blend_time` (or hard-cuts at `0`), a disjoint-mixer switch pauses it so its pose survives.
 * Returns three's own `AnimationAction` so the caller keeps driving it with three's API.
 * The action comes from the clip's OWN {@link NamedClip.mixer} when it named one — that is the whole
 * of a mixed player's dispatch, by clip name (see this file's header).
 *
 * `customBlend` is Godot's SECOND argument and it is a real one: `player.gd` cross-fades every gait
 * change over `0.1`s while `character.tscn` authors `playback_default_blend_time = 0.2`, so dropping
 * it would run every transition at twice the length the game asked for. It is not a second blend
 * mechanism — it feeds the SAME `blend_time` the authored table feeds, one branch earlier
 * ({@link blendTimeFor} quotes the engine), and therefore the same `crossFadeFrom` weight ramp.
 * Omit it (or pass a negative, which is Godot's own default) to use the authored table.
 */
export function playAnimation(
  state: AnimationPlayerState,
  name: string,
  customBlend?: number,
): AnimationAction {
  return startClip(state, name, true, customBlend);
}

/** Runtime Object.call/callv entry: preserve optional arity and refuse unsupported play axes. */
export function playAnimationDynamic(
  state: AnimationPlayerState,
  args: readonly unknown[],
): AnimationAction {
  if (args.length > 2) {
    throw new Error(
      'godot-compat: AnimationPlayer.play dynamic dispatch supports name and custom_blend; ' +
        'custom_speed/from_end require playback axes this retained player does not carry.',
    );
  }
  const name = args[0] ?? '';
  if (typeof name !== 'string') {
    throw new TypeError('godot-compat: AnimationPlayer.play requires an animation name.');
  }
  const blend = args[1];
  if (blend !== undefined && typeof blend !== 'number') {
    throw new TypeError('godot-compat: AnimationPlayer.play custom_blend requires a number.');
  }
  return playAnimation(state, name, blend);
}

export function playAnimationBackwards(
  state: AnimationPlayerState,
  name: string,
  customBlend?: number,
): AnimationAction {
  const action = startClip(state, name, true, customBlend);
  action.time = action.getClip().duration;
  action.timeScale = -1;
  return action;
}

/**
 * `AnimationPlayer.queue(name)` — `enemy.gd:41` (`"explode"`).
 *
 * Plays immediately when nothing is running, otherwise enqueues to play when the current non-looping
 * clip ends (`animation_player.cpp` `queue`). `is_playing()` maps to the current action running.
 */
export function queueAnimation(state: AnimationPlayerState, name: string): void {
  if (!state.playing) {
    playAnimation(state, name);
    return;
  }
  state.queue.push(name);
}

/**
 * `animation_player.current_animation` — the name of the clip the head is on, `""` when there is
 * none.
 *
 * `starter-kit-3d-platformer` `player.gd:84`/`:94`/`:97`/`:102` compares it against `"walk"`,
 * `"idle"` and `"jump"` to decide whether a re-`play()` is needed at all, so the EMPTY-STRING
 * answer is load-bearing: `null` here would make all four comparisons pass a `!=` they should fail
 * on the first frame.
 *
 * Godot's getter is gated on the player still PLAYING, not merely on something having been played
 * (4.7-stable `animation_player.cpp`):
 *
 * ```cpp
 * StringName AnimationPlayer::get_current_animation() const {
 *     return (is_playing() ? playback.assigned : StringName());
 * }
 * ```
 *
 * So there are TWO stopped answers and both are `""`: nothing has played yet, and a non-looping
 * clip has reached its end with an empty queue (Godot clears `playing` on `end_reached`). The
 * second one is why this asks three's action rather than only the name — a `LoopOnce` action that
 * has finished is no longer running (`AnimationAction.isRunning()` is false once `_update` has
 * paused or disabled it), which is the same predicate {@link queueAnimation} already uses to decide
 * whether Godot would have played immediately.
 *
 * The name itself is {@link AnimationPlayerState.currentName}, which {@link playAnimation} already
 * maintains — there is no second record of what is playing. It is `playback.assigned` rather than
 * the blend list's head, so a read DURING a cross-fade answers the INCOMING clip from the frame
 * `play()` was called, exactly as Godot does.
 */
export function getCurrentAnimation(state: AnimationPlayerState): string {
  if (!state.playing) return '';
  return state.currentName ?? '';
}

/**
 * `animation_player.current_animation = name`.
 *
 * Godot's setter is not an inert field write (`AnimationMixer::set_current_animation`): an empty
 * name STOPS the player, and any other name PLAYS it. This carries both halves and the same
 * `play()` path, so a script that assigns the name and a script that calls `play(name)` cannot
 * diverge. Nothing measured writes it — the four measured touches are reads — and it ships anyway
 * because a getter without its setter would be a property answered in one direction with nothing
 * saying so.
 */
export function setCurrentAnimation(state: AnimationPlayerState, name: string): void {
  if (name === '') {
    // 3.x calls stop() unconditionally. 4.x defers `stop(false)` only while playing; once a
    // one-shot naturally finishes this is a no-op and preserves assigned head/position/length.
    if (state.godotMajor === 3 || state.playing) stopAnimation(state);
    return;
  }
  if (state.playing && state.currentName === name) return;
  playAnimation(state, name);
}

/** Godot's playback flag, kept separately from the assigned action so a completed one-shot can
 * retain its final position while correctly answering `false`. */
export function isAnimationPlaying(state: AnimationPlayerState): boolean {
  return state.playing;
}

/**
 * Stop the playback head. The structural major normalizes Godot 3's `reset` argument and Godot 4's
 * inverted `keep_state` argument onto one `reset` decision. A paused three action is the native way
 * to retain either evaluated pose without the next mixer tick restoring bind pose.
 */
export function stopAnimation(state: AnimationPlayerState, dialectArgument?: boolean): void {
  // The same bool was inverted by the API rename, but the effects are not symmetric. 3.x reset
  // clears its head without evaluating frame zero; 4.x always clears and keep_state only controls
  // whether it seeks/evaluates the start pose first.
  const resetGodot3 = state.godotMajor === 3 && (dialectArgument ?? true);
  const evaluateStartGodot4 = state.godotMajor === 4 && !(dialectArgument ?? false);
  state.queue.length = 0;
  const action = state.current;
  if (action !== null) {
    if (evaluateStartGodot4) {
      action.paused = false;
      action.time = 0;
      action.getMixer().update(0);
    }
    action.paused = true;
    state.retained.set(action.getMixer(), action);
  }
  state.playing = false;
  // Godot 3 `stop(reset=false)` retains the assigned playback and its position. Godot 4 always
  // disables/clears current playback; `keep_state` controls only which pose remains evaluated.
  if (state.godotMajor === 4 || resetGodot3) {
    state.current = null;
    state.currentName = null;
  }
}

/** Position of the assigned clip, or Godot's error-return value `0` when there is none. */
export function getCurrentAnimationPosition(state: AnimationPlayerState): number {
  return state.current?.time ?? 0;
}

/** Length of the assigned clip, or Godot's error-return value `0` when there is none. */
export function getCurrentAnimationLength(state: AnimationPlayerState): number {
  return state.current?.getClip().duration ?? 0;
}

/** Seek within the assigned clip without changing whether the player is running. */
export function seekAnimation(
  state: AnimationPlayerState,
  seconds: number,
  update = false,
  updateOnly = false,
): void {
  if (!Number.isFinite(seconds)) {
    throw new Error(`godot-compat: AnimationPlayer.seek time must be finite; received ${seconds}.`);
  }
  if (updateOnly) {
    throw new Error(
      'godot-compat: AnimationPlayer.seek(update_only = true) is a Godot 4 process-side-effect ' +
        'mode the native Three mixer head cannot reproduce.',
    );
  }
  const action = state.current;
  if (action === null) return;
  action.time = seconds;
  if (update) {
    // Both pinned engines retain raw `p_time` as the observable position but clamp the local value
    // used for immediate evaluation. Three has one time field, so evaluate the clamp then restore
    // the raw position after the zero-delta mixer step.
    action.time = Math.min(Math.max(seconds, 0), action.getClip().duration);
    action.getMixer().update(0);
    action.time = seconds;
  }
}

/** Immediately process this player's native mixers by `seconds`, using their existing timeScale. */
export function advanceAnimationPlayer(state: AnimationPlayerState, seconds: number): void {
  if (!Number.isFinite(seconds)) {
    throw new Error(`godot-compat: AnimationPlayer.advance time must be finite; received ${seconds}.`);
  }
  if (!state.active) return;
  for (const mixer of state.mixers) mixer.update(seconds);
}

function playerName(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`godot-compat: AnimationPlayer.${member} requires StringName`);
  return value;
}

function refreshPlayerClips(state: AnimationPlayerState): void {
  const existing = new Map(state.clips);
  state.clips.clear();
  for (const [libraryName, library] of state.libraries) {
    for (const [animationName, clip] of animationLibraryEntries(library)) {
      const qualified = libraryName === '' ? animationName : `${libraryName}/${animationName}`;
      const retained = existing.get(qualified);
      const loopMode = Reflect.get(clip, 'get_loop_mode');
      const loop = typeof loopMode === 'function'
        ? Number(Reflect.apply(loopMode, clip, [])) !== 0
        : (retained?.clip === clip && retained.loop) === true;
      state.clips.set(qualified, {
        clip,
        loop,
        ...(retained?.mixer === undefined ? {} : { mixer: retained.mixer }),
      });
    }
  }
  if (state.currentName !== null && !state.clips.has(state.currentName)) {
    state.current?.stop();
    state.current = null;
    state.currentName = null;
    state.playing = false;
    state.queue.length = 0;
  }
}

function watchPlayerLibrary(
  state: AnimationPlayerState,
  _initialName: string,
  library: GodotAnimationLibrary,
): void {
  if (state.libraryReleases.has(library)) return;
  const release = watchAnimationLibrary(library, (change) => {
    const libraryName = [...state.libraries].find((entry) => entry[1] === library)?.[0];
    if (libraryName === undefined) return;
    const qualify = (animationName: string): string =>
      libraryName === '' ? animationName : `${libraryName}/${animationName}`;
    if (change.type === 'rename') {
      const from = qualify(change.from);
      const to = qualify(change.to);
      renamePlayerReferences(state, (animationName) => animationName === from ? to : animationName);
    }
    refreshPlayerClips(state);
  });
  state.libraryReleases.set(library, release);
}

export function hasPlayerAnimation(state: AnimationPlayerState, animationName: string): boolean {
  refreshPlayerClips(state);
  return state.clips.has(playerName(animationName, 'has_animation'));
}

export function getPlayerAnimation(
  state: AnimationPlayerState,
  animationName: string,
): AnimationClip | null {
  refreshPlayerClips(state);
  return state.clips.get(playerName(animationName, 'get_animation'))?.clip ?? null;
}

export function getPlayerAnimationList(state: AnimationPlayerState): PackedArrayValue<string> {
  refreshPlayerClips(state);
  return packedStringArray([...state.clips.keys()].sort());
}

export function findPlayerAnimation(state: AnimationPlayerState, animation: AnimationClip): string {
  refreshPlayerClips(state);
  for (const [animationName, named] of state.clips) if (named.clip === animation) return animationName;
  return '';
}

export function addPlayerAnimation(
  state: AnimationPlayerState,
  animationName: string,
  animation: AnimationClip,
): number {
  const key = playerName(animationName, 'add_animation');
  const library = state.libraries.get('');
  if (library === undefined) throw new Error('godot-compat: AnimationPlayer default library is unavailable');
  const error = library.add_animation(key, animation);
  if (error === 0) refreshPlayerClips(state);
  return error;
}

export function removePlayerAnimation(state: AnimationPlayerState, animationName: string): void {
  const key = playerName(animationName, 'remove_animation');
  const slash = key.indexOf('/');
  const libraryName = slash < 0 ? '' : key.slice(0, slash);
  const localName = slash < 0 ? key : key.slice(slash + 1);
  state.libraries.get(libraryName)?.remove_animation(localName);
  if (state.currentName === key) stopAnimation(state);
  refreshPlayerClips(state);
}

export function renamePlayerAnimation(
  state: AnimationPlayerState,
  animationName: string,
  replacementName: string,
): void {
  const current = playerName(animationName, 'rename_animation');
  const replacement = playerName(replacementName, 'rename_animation new_name');
  if (current.includes('/') || replacement.includes('/')) {
    throw new Error('godot-compat: AnimationPlayer.rename_animation cannot move an animation between libraries');
  }
  state.libraries.get('')?.rename_animation(current, replacement);
  renamePlayerReferences(state, (name) => name === current ? replacement : name);
  refreshPlayerClips(state);
}

function renamePlayerReferences(
  state: AnimationPlayerState,
  rename: (animationName: string) => string,
): void {
  if (state.currentName !== null) state.currentName = rename(state.currentName);
  state.autoplay = rename(state.autoplay);
  for (let index = 0; index < state.queue.length; index += 1) state.queue[index] = rename(state.queue[index]!);
  const blendEntries = [...state.blendTimes];
  state.blendTimes.clear();
  for (const [key, seconds] of blendEntries) {
    const separator = key.indexOf(BLEND_KEY_SEPARATOR);
    const from = separator < 0 ? key : key.slice(0, separator);
    const to = separator < 0 ? '' : key.slice(separator + BLEND_KEY_SEPARATOR.length);
    state.blendTimes.set(blendKey(rename(from), rename(to)), seconds);
  }
  const nextEntries = [...state.nextAnimations];
  state.nextAnimations.clear();
  for (const [from, to] of nextEntries) state.nextAnimations.set(rename(from), rename(to));
}

export function addAnimationLibrary(
  state: AnimationPlayerState,
  libraryName: string,
  library: GodotAnimationLibrary,
): number {
  const key = playerName(libraryName, 'add_animation_library');
  if (state.libraries.has(key) || [...state.libraries.values()].includes(library)) return 31;
  animationLibraryEntries(library);
  state.libraries.set(key, library);
  watchPlayerLibrary(state, key, library);
  refreshPlayerClips(state);
  return 0;
}

export function removeAnimationLibrary(state: AnimationPlayerState, libraryName: string): void {
  const key = playerName(libraryName, 'remove_animation_library');
  const library = state.libraries.get(key);
  state.libraries.delete(key);
  if (library !== undefined) {
    state.libraryReleases.get(library)?.();
    state.libraryReleases.delete(library);
  }
  refreshPlayerClips(state);
}

export function renameAnimationLibrary(
  state: AnimationPlayerState,
  libraryName: string,
  replacementName: string,
): void {
  const current = playerName(libraryName, 'rename_animation_library');
  const replacement = playerName(replacementName, 'rename_animation_library new_name');
  if (state.libraries.has(replacement)) return;
  const library = state.libraries.get(current);
  if (library === undefined) return;
  state.libraries.delete(current);
  state.libraries.set(replacement, library);
  const currentPrefix = current === '' ? '' : `${current}/`;
  const replacementPrefix = replacement === '' ? '' : `${replacement}/`;
  renamePlayerReferences(state, (animationName) => {
    if (animationName === '') return '';
    if (current === '') return animationName.includes('/') ? animationName : `${replacementPrefix}${animationName}`;
    if (!animationName.startsWith(currentPrefix)) return animationName;
    return `${replacementPrefix}${animationName.slice(currentPrefix.length)}`;
  });
  refreshPlayerClips(state);
}

export function hasAnimationLibrary(state: AnimationPlayerState, libraryName: string): boolean {
  return state.libraries.has(playerName(libraryName, 'has_animation_library'));
}

export function getAnimationLibrary(
  state: AnimationPlayerState,
  libraryName: string,
): GodotAnimationLibrary | null {
  return state.libraries.get(playerName(libraryName, 'get_animation_library')) ?? null;
}

export function getAnimationLibraryList(state: AnimationPlayerState): PackedArrayValue<string> {
  return packedStringArray([...state.libraries.keys()].sort());
}

export function setAnimationBlendTime(
  state: AnimationPlayerState,
  from: string,
  to: string,
  seconds: number,
): void {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration < 0) throw new RangeError('godot-compat: AnimationPlayer blend time must be non-negative');
  const source = playerName(from, 'set_blend_time from');
  const target = playerName(to, 'set_blend_time to');
  refreshPlayerClips(state);
  if (!state.clips.has(source) || !state.clips.has(target)) {
    throw new Error('godot-compat: AnimationPlayer.set_blend_time requires two existing animations');
  }
  const key = blendKey(source, target);
  if (Math.abs(duration) <= 0.00001) state.blendTimes.delete(key);
  else state.blendTimes.set(key, duration);
}

export function getAnimationBlendTime(state: AnimationPlayerState, from: string, to: string): number {
  return state.blendTimes.get(blendKey(
    playerName(from, 'get_blend_time from'),
    playerName(to, 'get_blend_time to'),
  )) ?? 0;
}

export function setDefaultAnimationBlendTime(state: AnimationPlayerState, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('godot-compat: default blend time must be non-negative');
  state.defaultBlendTime = seconds;
}

export function getDefaultAnimationBlendTime(state: AnimationPlayerState): number {
  return state.defaultBlendTime;
}

export function setAnimationAutoplay(state: AnimationPlayerState, animationName: string): void {
  const key = playerName(animationName, 'autoplay');
  state.autoplay = key;
}

export function getAnimationAutoplay(state: AnimationPlayerState): string { return state.autoplay; }

export function resetAnimationPlayer(state: AnimationPlayerState): void {
  refreshPlayerClips(state);
  const named = state.clips.get('RESET');
  if (named === undefined) return;
  const mixer = named.mixer ?? state.mixer;
  const resetAction = mixer.clipAction(named.clip);
  const current = state.current?.getMixer() === mixer ? state.current : null;
  const currentWeight = current?.getEffectiveWeight() ?? 0;
  if (current !== null && current !== resetAction) current.setEffectiveWeight(0);
  resetAction.reset().setEffectiveWeight(1).play();
  resetAction.time = 0;
  mixer.update(0);
  resetAction.stop();
  if (state.retained.get(mixer) === resetAction) state.retained.delete(mixer);
  if (current !== null && current !== resetAction) current.setEffectiveWeight(currentWeight);
}

export function canApplyAnimationReset(state: AnimationPlayerState): boolean {
  refreshPlayerClips(state);
  return state.clips.has('RESET');
}

export function getAssignedAnimation(state: AnimationPlayerState | GodotPixiAnimationPlayer): string {
  if (isPixiAnimationPlayerValid(state as GodotPixiAnimationPlayer)) {
    return getPixiAssignedAnimation(state as GodotPixiAnimationPlayer);
  }
  return state.currentName ?? '';
}

export function setAssignedAnimation(
  state: AnimationPlayerState | GodotPixiAnimationPlayer,
  animationName: string,
): void {
  if (isPixiAnimationPlayerValid(state as GodotPixiAnimationPlayer)) {
    setPixiAssignedAnimation(state as GodotPixiAnimationPlayer, animationName);
    return;
  }
  const player = state as AnimationPlayerState;
  const key = playerName(animationName, 'assigned_animation');
  if (key === '') {
    player.current = null;
    player.currentName = null;
    player.playing = false;
    return;
  }
  refreshPlayerClips(player);
  const named = player.clips.get(key);
  if (named === undefined) throw new Error(`godot-compat: AnimationPlayer has no animation ${JSON.stringify(key)}`);
  const mixer = named.mixer ?? player.mixer;
  player.current = mixer.clipAction(named.clip);
  player.currentName = key;
  player.playing = false;
}

export function getAnimationQueue(state: AnimationPlayerState): PackedArrayValue<string> {
  return packedStringArray(state.queue);
}

export function clearAnimationQueue(state: AnimationPlayerState): void { state.queue.length = 0; }

export function pauseAnimationPlayer(state: AnimationPlayerState): void {
  if (state.current !== null) state.current.paused = true;
  state.playing = false;
}

export function getAnimationPlayingSpeed(state: AnimationPlayerState): number {
  if (!state.playing || state.current === null) return 0;
  return state.current.timeScale * state.current.getMixer().timeScale;
}

export function isAnimationPlayerValid(state: AnimationPlayerState): boolean {
  return state.current !== null && state.currentName !== null && state.clips.has(state.currentName);
}

export function setNextAnimation(state: AnimationPlayerState, from: string, to: string): void {
  const source = playerName(from, 'animation_set_next from');
  const target = playerName(to, 'animation_set_next to');
  if (target === '') state.nextAnimations.delete(source);
  else state.nextAnimations.set(source, target);
}

export function getNextAnimation(state: AnimationPlayerState, from: string): string {
  return state.nextAnimations.get(playerName(from, 'animation_get_next')) ?? '';
}

export function setAnimationMixerActive(state: AnimationPlayerState | PlaybackSpeedMixer, active: boolean): void {
  if (typeof active !== 'boolean') throw new TypeError('godot-compat: AnimationMixer.active requires bool');
  if ('mixers' in state) state.active = active;
  for (const mixer of speedMixersOf(state)) {
    const retained = retainedMixerActiveState(mixer);
    if (retained.active === active) continue;
    if (active) mixer.timeScale = retained.speed;
    else {
      retained.speed = mixer.timeScale;
      mixer.timeScale = 0;
    }
    retained.active = active;
  }
}

export function isAnimationMixerActive(state: AnimationPlayerState | PlaybackSpeedMixer): boolean {
  return 'mixers' in state ? state.active : ACTIVE_MIXER_STATE.get(state)?.active ?? true;
}

export function setAnimationMixerDeterministic(state: AnimationPlayerState, deterministic: boolean): void {
  if (typeof deterministic !== 'boolean') throw new TypeError('godot-compat: AnimationMixer.deterministic requires bool');
  if (!deterministic) {
    throw new Error('godot-compat: AnimationMixer.deterministic=false changes blend accumulation ordering unavailable in Three AnimationMixer.');
  }
  state.deterministic = deterministic;
}

export function isAnimationMixerDeterministic(state: AnimationPlayerState): boolean { return state.deterministic; }

export function setAnimationResetOnSave(state: AnimationPlayerState, reset: boolean): void {
  if (typeof reset !== 'boolean') throw new TypeError('godot-compat: AnimationMixer.reset_on_save requires bool');
  state.resetOnSave = reset;
}

export function isAnimationResetOnSave(state: AnimationPlayerState): boolean { return state.resetOnSave; }

export function setAnimationCallbackModeProcess(state: AnimationPlayerState, mode: number): void {
  if (!Number.isInteger(mode) || mode < 0 || mode > 2) throw new RangeError('godot-compat: callback_mode_process must be 0..2');
  if (mode !== 1) {
    throw new Error('godot-compat: AnimationMixer callback_mode_process only carries IDLE; PHYSICS/MANUAL require a different emitted host phase.');
  }
  state.callbackModeProcess = mode;
}

export function getAnimationCallbackModeProcess(state: AnimationPlayerState): number { return state.callbackModeProcess; }

export function setAnimationCallbackModeMethod(state: AnimationPlayerState, mode: number): void {
  if (!Number.isInteger(mode) || mode < 0 || mode > 2) throw new RangeError('godot-compat: callback_mode_method must be 0..2');
  if (mode !== 0) {
    throw new Error('godot-compat: AnimationMixer non-default method callback timing is not routed through the emitted frame phase.');
  }
  state.callbackModeMethod = mode;
}

export function getAnimationCallbackModeMethod(state: AnimationPlayerState): number { return state.callbackModeMethod; }

export function setAnimationCallbackModeDiscrete(state: AnimationPlayerState, mode: number): void {
  if (!Number.isInteger(mode) || mode < 0 || mode > 2) throw new RangeError('godot-compat: callback_mode_discrete must be 0..2');
  if (mode !== 0) {
    throw new Error('godot-compat: AnimationMixer non-default discrete callback blending has no exact Three action mode.');
  }
  state.callbackModeDiscrete = mode;
}

export function getAnimationCallbackModeDiscrete(state: AnimationPlayerState): number { return state.callbackModeDiscrete; }

export function setAnimationAutoCapture(state: AnimationPlayerState, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('godot-compat: AnimationPlayer.auto_capture requires bool');
  state.autoCapture = enabled;
}

export function isAnimationAutoCapture(state: AnimationPlayerState): boolean { return state.autoCapture; }

export function setAnimationAutoCaptureDuration(state: AnimationPlayerState, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < -1) throw new RangeError('godot-compat: auto_capture_duration requires -1 or a non-negative finite duration');
  state.autoCaptureDuration = seconds;
}

export function getAnimationAutoCaptureDuration(state: AnimationPlayerState): number { return state.autoCaptureDuration; }

export function setAnimationAutoCaptureTransitionType(state: AnimationPlayerState, transition: number): void {
  if (!Number.isSafeInteger(transition) || transition < 0 || transition > 10) throw new RangeError('godot-compat: auto_capture_transition_type requires Tween TransitionType 0..10');
  state.autoCaptureTransitionType = transition;
}

export function getAnimationAutoCaptureTransitionType(state: AnimationPlayerState): number { return state.autoCaptureTransitionType; }

export function setAnimationAutoCaptureEaseType(state: AnimationPlayerState, ease: number): void {
  if (!Number.isSafeInteger(ease) || ease < 0 || ease > 3) throw new RangeError('godot-compat: auto_capture_ease_type requires Tween EaseType 0..3');
  state.autoCaptureEaseType = ease;
}

export function getAnimationAutoCaptureEaseType(state: AnimationPlayerState): number { return state.autoCaptureEaseType; }

export function setAnimationMovieQuitOnFinish(state: AnimationPlayerState, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('godot-compat: movie_quit_on_finish requires bool');
  state.movieQuitOnFinish = enabled;
}

export function isAnimationMovieQuitOnFinish(state: AnimationPlayerState): boolean { return state.movieQuitOnFinish; }

export function setAnimationSection(state: AnimationPlayerState, startTime: number, endTime = -1): void {
  if (!Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(endTime)) {
    throw new RangeError('godot-compat: AnimationPlayer section requires finite non-negative start and finite end');
  }
  const length = getCurrentAnimationLength(state);
  const end = endTime < 0 ? length : endTime;
  if (end < startTime || end > length) throw new RangeError('godot-compat: AnimationPlayer section must remain inside the assigned animation');
  state.sectionStart = startTime;
  state.sectionEnd = end;
  if (state.current !== null) state.current.time = Math.max(startTime, Math.min(end, state.current.time));
}

export function resetAnimationSection(state: AnimationPlayerState): void {
  state.sectionStart = null;
  state.sectionEnd = null;
}

export function hasAnimationSection(state: AnimationPlayerState): boolean {
  return state.sectionStart !== null && state.sectionEnd !== null;
}

export function getAnimationSectionStartTime(state: AnimationPlayerState): number {
  return state.sectionStart ?? 0;
}

export function getAnimationSectionEndTime(state: AnimationPlayerState): number {
  return state.sectionEnd ?? getCurrentAnimationLength(state);
}
