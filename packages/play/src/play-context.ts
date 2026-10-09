/**
 * THE PLAY CONTEXT A SCRIPT IS HANDED, with no editor in it: `find`, `camera`, `keys`, `log`,
 * `tint`, `setOpacity`, `autoplay`, `setAction`, `setTrack`, `setConstraint` and `actions`, over
 * a root, a camera, the material copies (`play-materials.ts`) and a document's animation.
 *
 * The editor's runner (`play-script.ts`) builds every script's context here, and so does a game
 * exported to the web (`play-runner.ts`), so a script meets the same calls in both. What the host
 * keeps (its log, its clock, its bot) arrives as `append` and the `life` of one script.
 */
import type * as THREE from 'three';
import type { DocumentPlayAnimation } from '@volter/sdk/kit/document-play-extension';
import type { MaterialOverrides } from './play-materials';

export interface ModelPlayContext {
  /** The Model group: the detached copy's root. */
  readonly root: THREE.Object3D;
  /** The object a Blender object's name presents as, ready to be moved by `position`,
   *  `quaternion` and `scale`; null when the file has no such object. */
  find(name: string): THREE.Object3D | null;
  /** The camera the stage draws with. Navigation re-poses it before each call,
   * so a script states the whole pose every frame. The tool blends that pose
   * during entry and holds keys empty until the camera arrives. */
  readonly camera: THREE.Camera;
  /** The keys held now, by `KeyboardEvent.code` (`ArrowUp`, `KeyW`, `Space`). */
  readonly keys: ReadonlySet<string>;
  /**
   * Write one entry to the play log, stamped with the run's simulation time and frame
   * (`play-log.ts`): a kind and the facts that explain it, JSON-serialisable and snapshotted
   * now. Log transitions (a landing, a death and its cause, autoplay's choice), not every
   * frame. Read back with `cyclotron play-log [--since <simT>] [--kind <k>] [--json]`
   * or `editor.modelPlayLog({ since, kind })` in `eval`. Never throws, never changes the game,
   * and does nothing once this script has been replaced or Play has stopped.
   *
   *     play.log('death', { cause: 'lava', at: player.position, stage });
   */
  log(kind: string, facts?: Record<string, unknown>): void;
  /**
   * Draw an object and the meshes under it in `color` (a `THREE.Color`, `'#2bff6b'`,
   * `0x2bff6b`); an emitting surface glows in it too, an image texture is multiplied by it.
   * `null` returns the authored colours. Other objects wearing the same Blender material keep
   * theirs. An object is a name or one `find` answered.
   *
   * THE PRESENTED MATERIALS, which is why this exists: a mesh's `material` is an array with
   * one shared `MeshPhysicalMaterial` per Blender material slot (a lone material only for an
   * object without slots), so `material.color` is undefined, and editing an entry recolours
   * every object wearing that Blender material. The presenter re-assigns those slots
   * whenever it re-applies shading, `clone()` drops its shader hooks, and a node graph
   * driving Base Color or Alpha ignores `color` and `opacity`. A tinted or faded object
   * wears copies of its own slots, drawn from their constant inputs (a node graph's
   * other inputs are not drawn while it does), and keeps them through a script reload. An
   * object with a material the document cannot copy (one the script made) is left as it is,
   * and the log says so once with a `tint-unsupported` entry.
   */
  tint(object: THREE.Object3D | string, color: THREE.ColorRepresentation | null): void;
  /** Fade an object and the meshes under it to `opacity` (0 to 1); `null` returns the
   *  authored opacity. Its colour is untouched, and the copies are `tint`'s. */
  setOpacity(object: THREE.Object3D | string, opacity: number | null): void;
  /**
   * Offer this game's bot, as named BEHAVIOURS: what the bot sets out to do, each its own
   * controller. While the person (or an agent, `play autoplay on <behaviour>`) has autoplay on in
   * the Game panel, the chosen behaviour's controller is called before each `update` and the keys
   * it answers are held for that update, merged into `keys`. Offer the outcomes worth checking —
   * one that plays to win and one that loses on purpose — so a run tests an ending by saying so,
   * not by leaving the game alone. A bare function is the one behaviour `play`. Every run has a
   * limit in simulation seconds (`play autoplay on <behaviour> --for <seconds>`, 300 unless
   * given): reaching it turns autoplay off and pauses the game. Autoplay is off at every Play and
   * Restart, and a person's key or pointer in the game turns it off. One bot per script:
   * registering again replaces it, `null` withdraws it, and it goes with the script. Never bind
   * autoplay to a game key, and never start it from the script.
   *
   *     play.autoplay({
   *       win: ({ dt }) => (car.speed < 20 ? ['ArrowUp'] : []),
   *       lose: () => ['ArrowLeft'],   // drives off the track
   *     });
   */
  autoplay(bot: ModelPlayAutoplayController | Readonly<Record<string, ModelPlayAutoplayController>> | null): void;
  /**
   * Set the action an object's armature plays, as Blender's `animation_data.action` does: any
   * action in the file, by name. `object` is the armature, its skinned mesh, or an object above or
   * below them, or its name. Each armature starts a run playing the action the file assigns it.
   * Setting another crossfades over `fade` seconds (0.2), repeats unless `loop: false` (which
   * holds the last frame), and plays at `speed`; setting the action already playing does nothing,
   * so a script may set it every update from the character's state. `null` fades it out. Each
   * change is an `action` entry in the play log; a name the file lacks is `action-unknown` once
   * and returns false.
   *
   * The armature plays as Blender plays it: its NLA tracks, then this action over them, then its
   * bone constraints, all as the file sets them (and as the Timeline shows them).
   *
   *     play.setAction('Hero', moving ? 'Run' : 'Idle');
   */
  setAction(object: THREE.Object3D | string, action: string | null, options?: ModelPlayActionOptions): boolean;
  /**
   * Set one of the armature's NLA tracks, by name: the `action` it plays from now (a track the
   * file lacks is made, over the file's), its `influence` (0 to 1, reached over `fade`), or
   * `mute`. `null` gives the track back to the file. As in Blender, an action changes only the
   * bones it keys: an action keyed on the upper body, on a track over a running action, is an
   * upper body that aims while the legs run. Influences set every update blend poses between
   * authored ones (aim up, level and down by the aim's angle).
   *
   *     play.setTrack('Hero', 'Aim', { action: 'Aim_Upper' });
   *     play.setTrack('Hero', 'AimUp', { action: 'Aim_Up_Upper', influence: Math.max(0, pitch) });
   */
  setTrack(object: THREE.Object3D | string, track: string, options: ModelPlayTrackOptions | null): boolean;
  /**
   * Set one bone constraint the file gives the armature, by bone and constraint name: its
   * `influence`, or the `target` object it aims at. A constraint aims at the game's copy of its
   * file target, so moving that object in the game moves the aim with no call at all. A game
   * plays Damped Track; another type is refused with the reason.
   *
   *     play.setConstraint('Hero', 'Head', 'Look', { influence: alert ? 1 : 0 });
   */
  setConstraint(object: THREE.Object3D | string, bone: string, constraint: string, options: ModelPlayConstraintOptions): boolean;
  /** The actions an object's armature can play, by name (empty without an armature). */
  actions(object: THREE.Object3D | string): readonly string[];
}

export interface ModelPlayActionOptions {
  readonly loop?: boolean;
  readonly fade?: number;
  readonly speed?: number;
  /** Start again from the first frame when this action is already playing. */
  readonly restart?: boolean;
}

export interface ModelPlayTrackOptions extends ModelPlayActionOptions {
  /** The action the track plays from now; absent, what the file gives it. */
  readonly action?: string;
  readonly influence?: number;
  readonly mute?: boolean;
}

export interface ModelPlayConstraintOptions {
  readonly influence?: number;
  /** The object it aims at (or its name) instead of the file's target. */
  readonly target?: THREE.Object3D | string | null;
}

/** What the bot is handed before each `update` it drives. */
export interface ModelPlayAutoplayInput {
  /** The behaviour driving (`play autoplay on <behaviour>`), for a controller shared by several. */
  readonly behavior: string;
  /** The `dt` the coming `update` is handed. */
  readonly dt: number;
  /** Simulation seconds and the update's number, as that update's log entries carry them. */
  readonly simT: number;
  readonly tick: number;
  /** The keys the person holds, by `KeyboardEvent.code`; the bot's are merged with them. */
  readonly keys: ReadonlySet<string>;
}
/**
 * A game's bot: the keys (`KeyboardEvent.code`) it holds for the coming update — or those keys
 * with what it is doing now, `{ keys, state: 'heading to nest 2' }`. The state is the bot
 * explaining itself: the Game panel shows it beside the driver, `play state` reports it, and
 * each change is a `bot-state` entry in the play log. Say intentions and their reasons (a goal,
 * a target, why it is waiting), not per-frame numbers.
 */
export type ModelPlayAutoplayController = (input: ModelPlayAutoplayInput) =>
  Iterable<string> | { readonly keys?: Iterable<string> | null; readonly state?: string | null } | null | undefined;

export interface ModelPlayGame {
  /** Once per drawn frame, with the simulation seconds since the last call (at most a tenth).
   *  Not called while the game is paused; called once per Step; at a speed other than 1× the
   *  seconds are scaled, and a fast frame may call it more than once. */
  update(deltaSeconds: number): void;
  dispose?(): void;
}

/** The longest `dt` one update is handed; longer frames are split (`splitUpdateSeconds`). */
export const MAX_UPDATE_SECONDS = 0.1;

/** A frame's simulation seconds as the updates that run it: equal parts of at most a tenth, so
 *  the promise `update` makes (at most a tenth per call) holds at any speed and frame rate. */
export function splitUpdateSeconds(seconds: number): number[] {
  const parts = Math.max(1, Math.ceil(seconds / MAX_UPDATE_SECONDS - 1e-9));
  return Array.from({ length: parts }, () => seconds / parts);
}

export function isModelPlayGame(value: unknown): value is ModelPlayGame {
  return typeof value === 'object' && value !== null && typeof (value as ModelPlayGame).update === 'function';
}

/** One script's lifetime: `value` until it is replaced, fails or the run stops; `bot` is what it
 *  offered `play.autoplay`; `unknown` the object names it asked for that the model lacks, each
 *  logged once — per script, so a typo that survives a reload is said again for the new one. */
export interface ModelPlayScriptLife {
  value: boolean;
  /** The bot's behaviours by name, in the order offered; null without a bot. */
  bot: Readonly<Record<string, ModelPlayAutoplayController>> | null;
  readonly unknown: Set<string>;
}

/** `play.autoplay`'s argument as behaviours by name: a bare function is the one behaviour `play`. */
export function botBehaviors(bot: unknown): Readonly<Record<string, ModelPlayAutoplayController>> | null {
  if (bot === null) return null;
  if (typeof bot === 'function') return { play: bot as ModelPlayAutoplayController };
  if (typeof bot === 'object' && !Array.isArray(bot)) {
    const entries = Object.entries(bot as Record<string, unknown>);
    if (entries.length === 0) throw new Error('play.autoplay was given no behaviours: offer at least one, `{ win: (input) => keys }`.');
    for (const [name, controller] of entries) {
      if (!/^[A-Za-z][\w-]{0,39}$/.test(name)) throw new Error(`play.autoplay behaviour "${name}" is not a name: letters, digits, - and _, starting with a letter.`);
      if (typeof controller !== 'function') throw new Error(`play.autoplay behaviour "${name}" is not a function (the controller).`);
    }
    return Object.freeze({ ...(bot as Record<string, ModelPlayAutoplayController>) });
  }
  throw new Error('play.autoplay takes a function (the bot), its behaviours by name (`{ win, lose }`), or null.');
}

/** What a context reaches of its runner. */
export interface ModelPlayContextHost {
  readonly root: THREE.Object3D;
  readonly camera: () => THREE.Camera;
  /** The keys the script reads; the runner fills and clears them. */
  readonly keys: ReadonlySet<string>;
  readonly materials: Pick<MaterialOverrides, 'tint' | 'setOpacity'>;
  /** The document's animation bound to `root`; absent, rigged objects stand in their exported pose. */
  readonly animation: DocumentPlayAnimation | undefined;
  /** One entry in the run's log: the runner's own (`play`) or the script's (`script`). */
  append(source: 'play' | 'script', kind: string, facts?: Record<string, unknown>): void;
  /** What each NLA track was last set to, kept for the run so the log says a change once. */
  readonly tracks: Map<string, string>;
}

/** One script's context: its log, tint, opacity and bot do nothing once that script is gone
 *  (replaced, failed, or the run stopped), so a stale timer cannot reach a later one. */
export function modelPlayContext(host: ModelPlayContextHost, alive: ModelPlayScriptLife): ModelPlayContext {
  const { root, camera, keys, materials, animation, append, tracks } = host;
  // An unknown name is the script's typo, not a reason to stop its game: said once per name, per script.
  const objectOf = (script: ModelPlayScriptLife, target: THREE.Object3D | string, call: 'tint' | 'setOpacity'): THREE.Object3D | null => {
    if (typeof target !== 'string') return target;
    const object = root.getObjectByName(target) ?? null;
    if (!object && !script.unknown.has(target)) {
      script.unknown.add(target);
      append('play', 'tint-unknown-object', { object: target, call });
    }
    return object;
  };
  /** The object an animation call names, and the document's animation; `action-unknown` once
   *  per object and name when either is missing. */
  const animated = (alive: ModelPlayScriptLife, object: THREE.Object3D | string, what: string | null, call: string) => {
    const name = typeof object === 'string' ? object : object.name;
    const unknown = (why: string): false => {
      const key = `${name}\u0000${call}\u0000${what}`;
      if (!alive.unknown.has(key)) { alive.unknown.add(key); append('play', 'action-unknown', { object: name, call, action: what, why }); }
      return false;
    };
    if (!alive.value) return { ok: false as const };
    const target = typeof object === 'string' ? root.getObjectByName(object) ?? null : object;
    if (!target) return { ok: unknown('the model has no such object') };
    if (!animation) return { ok: unknown('this document lends no animation') };
    return { ok: true as const, target, animation, unknown };
  };
  return {
    root,
    find(name) {
      const object = root.getObjectByName(name) ?? null;
      // The presenter states each object's matrix outright; a script moves it by its parts.
      if (object !== null && object !== root) object.matrixAutoUpdate = true;
      return object;
    },
    get camera() {
      return camera();
    },
    keys,
    log(kind, facts) { if (alive.value) append('script', kind, facts); },
    tint(object, color) {
      const target = alive.value ? objectOf(alive, object, 'tint') : null;
      if (target) materials.tint(target, color);
    },
    setOpacity(object, opacity) {
      const target = alive.value ? objectOf(alive, object, 'setOpacity') : null;
      if (target) materials.setOpacity(target, opacity);
    },
    autoplay(bot) {
      const behaviors = botBehaviors(bot);
      if (alive.value) alive.bot = behaviors;
    },
    setAction(object, action, options) {
      const found = animated(alive, object, action, 'setAction');
      if (!found.ok) return false;
      const { target, animation } = found;
      const before = animation.playing(target);
      if (action === null) {
        animation.stop(target, options?.fade);
        if (before !== null) append('play', 'action', { object: target.name, action: null, from: before });
        return true;
      }
      const answer = animation.play(target, action, options);
      if (!answer.ok) return found.unknown(answer.why);
      if (before !== action || options?.restart) append('play', 'action', { armature: answer.armature, action, from: before });
      return true;
    },
    setTrack(object, track, options) {
      const found = animated(alive, object, track, 'setTrack');
      if (!found.ok) return false;
      const answer = found.animation.track(found.target, track, options);
      if (!answer.ok) return found.unknown(answer.why);
      // Influences change every update; the log keeps what the track plays and whether it is muted.
      const key = `${answer.armature} ${track}`;
      const now = options === null ? 'file' : JSON.stringify([options.action ?? null, options.mute ?? false]);
      if (tracks.get(key) !== now) {
        tracks.set(key, now);
        append('play', 'track', { armature: answer.armature, track, ...(options === null ? { file: true } : { action: options.action ?? null, mute: options.mute ?? false }) });
      }
      return true;
    },
    setConstraint(object, bone, constraint, options) {
      const found = animated(alive, object, `${bone}/${constraint}`, 'setConstraint');
      if (!found.ok) return false;
      let aim: THREE.Object3D | null | undefined = undefined;
      if (typeof options.target === 'string') {
        aim = root.getObjectByName(options.target) ?? null;
        if (!aim) return found.unknown(`the model has no object "${options.target}" to aim at`);
      } else aim = options.target;
      const answer = found.animation.constraint(found.target, bone, constraint, {
        ...(options.influence === undefined ? {} : { influence: options.influence }),
        ...(aim === undefined ? {} : { target: aim }),
      });
      if (!answer.ok) return found.unknown(answer.why);
      if (aim !== undefined) append('play', 'constraint', { armature: answer.armature, bone, constraint, target: aim?.name ?? null });
      return true;
    },
    actions(object) {
      const target = typeof object === 'string' ? root.getObjectByName(object) ?? null : object;
      return target && animation ? animation.clips(target) : [];
    },
  };
}
