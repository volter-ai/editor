/**
 * A MODEL'S PLAY SCRIPT — the project module that moves the detached copy while the document
 * plays (`model-play.ts`).
 *
 * It is an ordinary project file beside the `.blend`, as the bpy script that authored it is:
 * `src/models/canyon.blend` plays `src/models/canyon.play.ts`. Its default export is called once
 * with the play context and answers the game:
 *
 *     export default (play: ModelPlayContext): ModelPlayGame => ({
 *       update(dt) { play.find('Car')!.position.x += dt; },
 *     });
 *
 * WHAT THE SCRIPT HOLDS IS THREE'S OWN GRAPH: `root` is the Model group the stage draws, one
 * `Object3D` per Blender object under it, named and parented as in the file. Inside `root`
 * the coordinates are Blender's (Z up); `root` itself carries the turn to three's Y up, so an
 * object's `getWorldPosition` is in the stage's space, where `camera` lives.
 *
 * Without UI layers, the tool imports through the live-module URL. When a UI
 * tool offers project roots, all entries share one project mount epoch.
 * A save in the mount's dependency graph prepares a replacement against the
 * same detached copy; its first successful update replaces the running mount.
 * The tool blends the camera from the editing pose for 0.8 seconds after
 * update, holding keys empty until arrival. Stop freezes the copy and blends
 * back before disposing it; Escape during either blend completes that blend.
 *
 * THE GAME'S TIME IS THE `dt` IT IS HANDED, and the runner decides it (`model-play.ts` keeps
 * the run's clock): paused, `update` is not called at all and the camera holds the last drawn
 * pose; a Step is one `update` of one nominal frame; a speed scales the frame's seconds, and a
 * scaled frame longer than a tenth of a second is run as several updates so the promise below —
 * at most a tenth per call — holds at 4× too. The camera's own blends run on the page's time,
 * because they are the editor's motion and not the game's. Restart is the document detaching a
 * fresh copy for a new runner (`restartModelPlay`); this runner, no longer the current
 * generation, stands down without ending the play.
 *
 * THE PLAY LOG KEEPS THE SAME CLOCK (`play-log.ts`): the run's log is advanced by exactly the
 * `dt` of each `update` the panel's clock counts, at the same call, so an entry's `simT` and
 * `tick` are the numbers the Game panel shows. A Restart is a fresh copy and so a fresh log,
 * opened by `play-start` and then `play-restart`; pause, resume, each step and a speed change
 * are lifecycle entries of their own.
 *
 * AUTOPLAY IS THE GAME'S BOT AND THE EDITOR'S SWITCH. A script offers one bot,
 * `play.autoplay(controller)`: a plain function the runner calls before each `update` while
 * autoplay is on, handed that update's `dt`, `simT`, `tick` and the keys the person holds, and
 * answering the keys the bot holds. The runner merges those into `keys` for that update, so the
 * bot drives through the script's own input code, exactly as a person's keys do. Whether it
 * drives is not the script's to say (`model-play.ts`): off at every Play and Restart, on only
 * from the Game panel or its verb, and off again the moment a person presses a key the game
 * would hear or presses a pointer in the game — before that key reaches `keys`. A synthetic key
 * (`editor.document.key`) is dispatched as a DOM event like a person's and is handled as one;
 * the bot's own keys never pass through the DOM, so they cannot take over from themselves. The
 * controller is called only here, inside the editor's runner: a game run anywhere else never
 * drives itself.
 *
 * A CUTSCENE IS THE FILE'S OWN MOVIE, PLAYED IN THE GAME (`play.cutscene`): the scene's animation
 * as the Timeline plays it — keyed objects and cameras, armatures on their NLA strips and assigned
 * actions, camera cuts at markers bound to cameras — for a span of scene frames, on the game's
 * clock (so pause, step and speed hold it too). The document lends it (`DocumentPlayAnimation.movie`)
 * and poses its copy at each frame; the runner owns the span, the camera and the log. While it
 * runs the script's `update` is still called (it decides a skip from `keys`), but the camera is
 * the movie's: whatever the script states is overwritten after its update. When it ends the
 * camera's own settings come back, and the camera blends from the movie's last shot to the pose
 * the script states, over `blend` seconds.
 */
import { editorHost } from '@volter/sdk/host';
import { getCurrentProject } from '@volter/sdk/kit/active-project';
import { surfaceAcceptsKey, surfaceHoldsKeyboard } from '@volter/sdk/kit/surface-keyboard';
import {
  projectModuleChangeMatches,
  subscribeProjectModuleChange,
} from '@volter/sdk/kit/project-module-changes';
import {
  beginLiveModuleRevision,
  liveModuleImportUrl,
} from '@volter/sdk/session/project-module-url';
import type * as THREE from 'three';
import { projectPlayLayers } from '@volter/sdk/kit/project-play-layers';
import { beginProjectMountEpoch, projectEntryImportUrl } from '@volter/sdk/session/project-module-url';
import { cameraTransition } from './camera-transition';
import {
  advanceModelPlayClock,
  consumeModelPlayRestart,
  finishModelPlay,
  MODEL_PLAY_STEP_SECONDS,
  modelPlayAutoplay,
  modelPlayClock,
  modelPlayGeneration,
  noteModelPlayPerson,
  registerModelPlayStop,
  setModelPlayAutoplay,
  setModelPlayBotState,
  setModelPlayFailure,
  setModelPlayAutoplayAvailable,
  setModelPlayPaused,
  settleModelPlayAutoplay,
  subscribeModelPlayClock,
  takeModelPlayStep,
} from './model-play';
import { beginModelPlayLog } from './play-log';
import type { DocumentPlayAnimation, DocumentPlayMovie } from '@volter/sdk/kit/document-play-extension';
import { materialOverrides } from './play-materials';
interface PlayComposition {
  readonly entries: readonly string[];
  loadScript(): Promise<{ default?: unknown }>;
  reveal(): void;
  dispose(): void;
}

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
  /**
   * Play the file's own animation for a span of scene frames, as Blender's playback plays it:
   * every keyed object and camera (their actions and NLA strips), every armature on the file's
   * NLA strips and assigned action, and the camera cuts at Timeline markers bound to a camera
   * (Bind Camera to Markers), else the scene camera. `span` is a marker's name or a frame to
   * start at (to the scene's end), `{ start, end }` with either a marker name or a frame, or
   * nothing for the scene's whole range. It runs on the game's clock; while it runs the camera is
   * the movie's and the script's `update` is still called, so the script decides a skip
   * (`cut.stop()` on a key) and should hold its own player input. When it ends the camera blends
   * back to the pose the script states; objects keep the movie's last pose, and armatures return
   * to what the game set them to. One cutscene at a time: starting another ends this one. Each
   * start, camera cut, marker passed and end is a `cutscene` entry in the play log.
   *
   *     const intro = play.cutscene('Intro', { end: 'Gameplay', onDone: () => (state = 'play') });
   *     // in update: if (play.keys.has('Space')) intro.stop();
   */
  cutscene(span?: ModelPlayCutsceneSpan, options?: ModelPlayCutsceneOptions): ModelPlayCutscene;
  /** The Timeline's markers by frame, with the camera each is bound to: for a script's own
   *  subtitles or chapter list. Empty when the document has no movie. */
  markers(): readonly ModelPlayMarker[];
}

/** One Timeline marker. */
export interface ModelPlayMarker {
  readonly name: string;
  readonly frame: number;
  /** The camera Blender cuts to at this marker (`marker.camera`), or null. */
  readonly camera: string | null;
}

/** Where a cutscene starts and ends: a marker's name or a scene frame each. */
export type ModelPlayCutsceneSpan = string | number | { readonly start?: string | number; readonly end?: string | number };

export interface ModelPlayCutsceneOptions {
  /** Where it ends when `span` names only its start: a marker's name or a frame (the scene's end). */
  readonly end?: string | number;
  /** Look through this camera object the whole time, instead of the marker cuts and the scene camera. */
  readonly camera?: string;
  /** Seconds the camera blends back to the script's own when it ends (0.5); 0 cuts. */
  readonly blend?: number;
  /** Playback rate, 1 is the scene's own frame rate. */
  readonly speed?: number;
  /** Called once when it ends, played through or stopped. */
  readonly onDone?: (result: ModelPlayCutsceneResult) => void;
  /** Called as the movie reaches each marker in the span (the start's own included): subtitles. */
  readonly onMarker?: (marker: ModelPlayMarker) => void;
}

export interface ModelPlayCutsceneResult {
  /** Stopped before its end (by `stop`, another cutscene, or the script going away). */
  readonly skipped: boolean;
  /** The scene frame it ended on. */
  readonly frame: number;
  /** Why it never played (an unknown marker, no movie), when it did not. */
  readonly refused?: string;
}

/** A running cutscene. */
export interface ModelPlayCutscene {
  /** The scene frame showing now, fractional between whole frames. */
  readonly frame: number;
  readonly playing: boolean;
  /** The last marker it reached, or null before any. */
  readonly marker: ModelPlayMarker | null;
  /** Settles when it ends, as `onDone` is called. */
  readonly done: Promise<ModelPlayCutsceneResult>;
  /** End it now. `'end'` (the default) poses the movie's last frame first, so what the cutscene
   *  does (a door it opens) is done; `'here'` leaves everything where it is. */
  stop(at?: 'end' | 'here'): void;
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

/** The longest bot state kept: a line for the panel, not a report. */
const BOT_STATE_CHARACTERS = 160;

/** A controller's answer as its keys and its state (undefined: it said nothing about its state). */
function botAnswer(answer: ReturnType<ModelPlayAutoplayController>): { keys: Iterable<string>; state: string | null | undefined } {
  if (answer === null || answer === undefined) return { keys: [], state: undefined };
  if (typeof (answer as Iterable<string>)[Symbol.iterator] === 'function') return { keys: answer as Iterable<string>, state: undefined };
  const { keys, state } = answer as { keys?: Iterable<string> | null; state?: string | null };
  const said = state === undefined ? undefined : state === null ? null : String(state).replace(/\s+/g, ' ').trim().slice(0, BOT_STATE_CHARACTERS) || null;
  return { keys: keys ?? [], state: said };
}

export interface ModelPlayGame {
  /** Once per drawn frame, with the simulation seconds since the last call (at most a tenth).
   *  Not called while the game is paused; called once per Step; at a speed other than 1× the
   *  seconds are scaled, and a fast frame may call it more than once. */
  update(deltaSeconds: number): void;
  dispose?(): void;
}

/** A cutscene the runner plays (`ModelPlayContext.cutscene`). */
interface Cutscene {
  readonly owner: Script;
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  readonly speed: number;
  readonly blend: number;
  /** The camera it looks through throughout, or null for the movie's own cuts. */
  readonly camera: string | null;
  elapsed: number;
  frame: number;
  /** The frame of the last marker said. */
  passed: number;
  marker: ModelPlayMarker | null;
  /** The camera looked through last (undefined before the first frame). */
  shot: string | null | undefined;
  playing: boolean;
  /** Put the camera's own settings back. */
  readonly restore: () => void;
  readonly resolve: (result: ModelPlayCutsceneResult) => void;
  readonly onDone: ((result: ModelPlayCutsceneResult) => void) | undefined;
  readonly onMarker: ((marker: ModelPlayMarker) => void) | undefined;
}

/** One script's lifetime: `value` until it is replaced, fails or the run stops; `bot` is what it
 *  offered `play.autoplay`; `unknown` the object names it asked for that the model lacks, each
 *  logged once — per script, so a typo that survives a reload is said again for the new one. */
interface Script {
  value: boolean;
  /** The bot's behaviours by name, in the order offered; null without a bot. */
  bot: Readonly<Record<string, ModelPlayAutoplayController>> | null;
  readonly unknown: Set<string>;
}

/** The behaviour names a script's bot offers, in its order. */
function behaviorsOf(script: Script | undefined): string[] {
  return script?.bot ? Object.keys(script.bot) : [];
}

/** `play.autoplay`'s argument as behaviours by name: a bare function is the one behaviour `play`. */
function botBehaviors(bot: unknown): Readonly<Record<string, ModelPlayAutoplayController>> | null {
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

/** The longest `dt` one update is handed; longer scaled frames are split (`frameUpdates`). */
const MAX_UPDATE_SECONDS = 0.1;

/**
 * THE UPDATES THIS DRAWN FRAME RUNS, as the `dt` each is handed: none while paused, one nominal
 * frame for a Step, and otherwise the frame's seconds times the speed, split into equal parts of
 * at most {@link MAX_UPDATE_SECONDS}.
 */
function frameUpdates(documentId: string, frameSeconds: number): number[] {
  const clock = modelPlayClock(documentId);
  if (clock.paused) return takeModelPlayStep(documentId) ? [MODEL_PLAY_STEP_SECONDS] : [];
  const scaled = frameSeconds * clock.speed;
  const parts = Math.max(1, Math.ceil(scaled / MAX_UPDATE_SECONDS - 1e-9));
  return Array.from({ length: parts }, () => scaled / parts);
}

/** The play script's project path for a model's `.blend`. */
export function playScriptPath(blend: string): string {
  return blend.replace(/\.blend$/i, '') + '.play.ts';
}

function isGame(value: unknown): value is ModelPlayGame {
  return typeof value === 'object' && value !== null && typeof (value as ModelPlayGame).update === 'function';
}

async function startGame(modulePath: string, context: ModelPlayContext, composition?: PlayComposition): Promise<ModelPlayGame> {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  const namespace = composition ? await composition.loadScript() : (await import(
    /* @vite-ignore */ liveModuleImportUrl(project.rootPath, modulePath, beginLiveModuleRevision())
  )) as { default?: unknown };
  if (typeof namespace.default !== 'function')
    throw new Error(`${modulePath} has no default export to call: a play script default-exports (play) => ({ update(dt) }).`);
  const game: unknown = await (namespace.default as (play: ModelPlayContext) => unknown)(context);
  if (!isGame(game))
    throw new Error(`${modulePath}'s default export answered no game: it returns an object with update(dt).`);
  return game;
}

/**
 * Run a model's play script over `root` until the returned stop is called.
 *
 * `onFrame` is the stage's own frame hook (`ViewportStage.onFrame`), so the script runs after
 * the stage's navigation and before its draw. A script that throws stops being called and its
 * error is reported once; the next save starts it again.
 */
export function runPlayScript(options: {
  readonly documentId: string;
  readonly blend: string;
  readonly root: THREE.Object3D;
  readonly camera: () => THREE.Camera;
  readonly editingCamera: () => THREE.Camera;
  readonly onFrame: (fn: (deltaSeconds: number) => void) => () => void;
  readonly report: (title: string, detail: string) => void;
  readonly container: HTMLElement;
  readonly ready: () => void;
  readonly returning: () => void;
  readonly ownMaterial?: ((material: THREE.Material) => THREE.Material | null) | undefined;
  /** The document's skins and clips bound to `root`; absent, characters stand in their exported pose. */
  readonly animation?: DocumentPlayAnimation | undefined;
}): () => void {
  const { blend, root, camera, onFrame } = options;
  const options_ = options;
  const modulePath = playScriptPath(blend);
  // A fresh copy is a fresh run: its log starts empty, its clock at zero. Writes go through
  // this run's handle, which is inert once the run has ended.
  const run = beginModelPlayLog(options.documentId, modulePath);
  const report = (phase: 'start' | 'update' | 'stop' | 'autoplay', title: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    run.append('play', 'script-error', { phase, message: detail });
    // NO GAME RUNS NOW (a first start that failed, or the running game threw): the run still
    // plays, and a save retries it, but what is on screen is not a game. Said on the clock, so
    // the Game panel can say so and the document drops a Restart's cover (`failure`).
    if ((phase === 'start' || phase === 'update') && game === null && current())
      setModelPlayFailure(options.documentId, `${title}: ${detail}`);
    options.report(title, detail);
  };
  // Said once per object: a script that tints every frame would otherwise fill the log.
  const unsupported = new WeakSet<THREE.Mesh>();
  const materials = materialOverrides({
    root,
    ownMaterial: options.ownMaterial,
    unsupported: (mesh, material) => {
      if (unsupported.has(mesh)) return;
      unsupported.add(mesh);
      run.append('play', 'tint-unsupported', { object: mesh.name, material: material.name,
        why: options.ownMaterial ? 'the material is not one the document presents' : 'this document lends no material copies' });
    },
  });
  // An unknown name is the script's typo, not a reason to stop its game: said once per name, per script.
  const objectOf = (script: Script, target: THREE.Object3D | string, call: 'tint' | 'setOpacity'): THREE.Object3D | null => {
    if (typeof target !== 'string') return target;
    const object = root.getObjectByName(target) ?? null;
    if (!object && !script.unknown.has(target)) {
      script.unknown.add(target);
      run.append('play', 'tint-unknown-object', { object: target, call });
    }
    return object;
  };
  const keys = new Set<string>();
  const heldKeys = new Set<string>();
  // The run this runner belongs to. A Restart moves the document to the next generation, whose
  // own runner takes over; this one must then stand down without ending the play.
  const generation = modelPlayGeneration(options.documentId);
  const current = (): boolean => modelPlayGeneration(options.documentId) === generation;
  const restarted = consumeModelPlayRestart(options.documentId);
  const transition = cameraTransition(options.editingCamera(), { instant: restarted });
  // THE TRANSPORT'S CHANGES, IN THE LOG. Pause, resume and speed are the person's (or an
  // agent's) calls on `model-play.ts`, between frames; this run notes each as it lands. A run
  // that Restart has replaced notes nothing more — its successor's log has the restart.
  let seen = modelPlayClock(options.documentId);
  let seenBot = modelPlayAutoplay(options.documentId);
  if (restarted) run.append('play', 'play-restart', { speed: seen.speed });
  else if (seen.speed !== 1) run.append('play', 'speed', { speed: seen.speed });
  const stopClock = subscribeModelPlayClock(() => {
    const now = modelPlayClock(options.documentId);
    if (!current()) return;
    if (now.paused !== seen.paused) run.append('play', now.paused ? 'pause' : 'resume');
    if (now.speed !== seen.speed) run.append('play', 'speed', { speed: now.speed, from: seen.speed });
    seen = now;
    const bot = modelPlayAutoplay(options.documentId);
    if (bot.on !== seenBot.on || (bot.on && (bot.behavior !== seenBot.behavior || bot.since !== seenBot.since)))
      run.append('play', bot.on ? 'autoplay-on' : 'autoplay-off', bot.on ? { by: bot.by, behavior: bot.behavior, limit: bot.limit } : { by: bot.by, behavior: seenBot.behavior });
    // An arm dropped before it was taken: a takeover, or a script that offers no bot. (Stop's
    // reset has no `by`, and its `play-stop` says enough.)
    else if (seenBot.armed && !bot.armed && bot.by !== null) run.append('play', 'autoplay-off', { by: bot.by, armed: true, ...(bot.refused ? { why: bot.refused } : {}) });
    seenBot = bot;
  });
  options.container.style.opacity = '0';
  /** One script's context: its log, tint, opacity and bot do nothing once that script is gone
   *  (replaced, failed, or the run stopped), so a stale timer cannot reach a later one. */
  /** The object an animation call names, and the document's animation; `action-unknown` once
   *  per object and name when either is missing. */
  const animated = (alive: Script, object: THREE.Object3D | string, what: string | null, call: string) => {
    const name = typeof object === 'string' ? object : object.name;
    const unknown = (why: string): false => {
      const key = `${name}\u0000${call}\u0000${what}`;
      if (!alive.unknown.has(key)) { alive.unknown.add(key); run.append('play', 'action-unknown', { object: name, call, action: what, why }); }
      return false;
    };
    if (!alive.value) return { ok: false as const };
    const target = typeof object === 'string' ? root.getObjectByName(object) ?? null : object;
    if (!target) return { ok: unknown('the model has no such object') };
    if (!options_.animation) return { ok: unknown('this document lends no animation') };
    return { ok: true as const, target, animation: options_.animation, unknown };
  };
  /** What each NLA track was last set to, so the log says a change once. */
  const tracks = new Map<string, string>();
  /** THE RUNNING CUTSCENE, and the camera blending back from the last one. */
  let cutscene: Cutscene | null = null;
  let handBack: ReturnType<typeof cameraTransition> | null = null;
  const movie = (): DocumentPlayMovie | null => options_.animation?.movie ?? null;
  /** The span a cutscene asked for, as scene frames, or why it cannot play. */
  const spanOf = (span: ModelPlayCutsceneSpan | undefined, end: string | number | undefined):
    { start: number; end: number } | { refused: string } => {
    const lent = movie();
    const scene = lent?.scene();
    if (!lent || !scene) return { refused: lent ? "the scene's movie could not be read" : 'this document lends no movie' };
    const markers = lent.markers();
    const frameOf = (at: string | number | undefined, fallback: number): number | string => {
      if (at === undefined) return fallback;
      if (typeof at === 'number') return Number.isFinite(at) ? at : `${at} is not a frame`;
      const marker = markers.find((one) => one.name === at);
      return marker ? marker.frame : `the Timeline has no marker "${at}"${markers.length ? `; it has ${markers.map((one) => `"${one.name}"`).join(', ')}` : ''}`;
    };
    const bounds = typeof span === 'object' && span !== null ? span : { start: span, end };
    const from = frameOf(bounds.start, scene.start);
    if (typeof from === 'string') return { refused: from };
    const to = frameOf(bounds.end ?? end, scene.end);
    if (typeof to === 'string') return { refused: to };
    if (to < from) return { refused: `it ends (frame ${to}) before it starts (frame ${from})` };
    return { start: from, end: to };
  };
  /** The camera's own settings, put back when a cutscene ends. */
  const cameraSettings = (cam: THREE.Camera) => {
    const perspective = cam as THREE.PerspectiveCamera;
    const saved = {
      position: cam.position.clone(), quaternion: cam.quaternion.clone(),
      ...(perspective.isPerspectiveCamera ? { fov: perspective.fov, near: perspective.near, far: perspective.far, zoom: perspective.zoom, filmOffset: perspective.filmOffset, view: perspective.view ? { ...perspective.view } : null } : {}),
    };
    return (): void => {
      cam.position.copy(saved.position);
      cam.quaternion.copy(saved.quaternion);
      if (perspective.isPerspectiveCamera && saved.fov !== undefined) {
        Object.assign(perspective, { fov: saved.fov, near: saved.near, far: saved.far, zoom: saved.zoom, filmOffset: saved.filmOffset, view: saved.view });
      }
      (cam as THREE.PerspectiveCamera).updateProjectionMatrix?.();
      cam.updateMatrixWorld(true);
    };
  };
  /**
   * End the running cutscene: `at` the span's end (posed there first) or where it is. The camera
   * is handed back (`'blend'`: its own settings restored, then blended to from the movie's last
   * shot), restored at once (`'restore'`, another cutscene takes it), or left alone (`'leave'`,
   * the run is ending and Play's own return owns the camera).
   */
  const finishCutscene = (scene: Cutscene, skipped: boolean, at: 'end' | 'here', cameraBack: 'blend' | 'restore' | 'leave'): void => {
    if (cutscene !== scene || !scene.playing) return;
    scene.playing = false;
    cutscene = null;
    const lent = movie();
    if (at === 'end') scene.frame = scene.end;
    const cam = camera();
    if (lent) {
      lent.seek(scene.frame);
      // THE LAST SHOT, looked through once more, is where the hand-back blend starts.
      const shot = scene.camera ?? lent.cameraAt(scene.frame);
      if (shot && cameraBack === 'blend') lent.look(cam, shot);
      lent.seek(null);
    }
    handBack = cameraBack === 'blend' && scene.blend > 0 ? cameraTransition(cam, { instant: false, duration: scene.blend }) : null;
    if (cameraBack !== 'leave') scene.restore();
    const result: ModelPlayCutsceneResult = { skipped, frame: scene.frame };
    run.append('play', 'cutscene', { event: 'end', frame: scene.frame, skipped });
    scene.resolve(result);
    if (scene.owner.value && scene.onDone) {
      try { scene.onDone(result); }
      catch (error) { report('update', `${modulePath}'s cutscene onDone failed`, error); }
    }
  };
  /** The markers between the last frame shown and this one, each said once. */
  const passMarkers = (scene: Cutscene, upTo: number): void => {
    const lent = movie();
    if (!lent) return;
    for (const marker of lent.markers()) {
      if (marker.frame < scene.start || marker.frame > upTo || marker.frame <= scene.passed) continue;
      scene.passed = marker.frame;
      scene.marker = marker;
      run.append('play', 'cutscene', { event: 'marker', marker: marker.name, frame: marker.frame });
      if (scene.owner.value && scene.onMarker) {
        try { scene.onMarker(marker); }
        catch (error) { report('update', `${modulePath}'s cutscene onMarker failed`, error); }
      }
    }
  };
  /** One update's worth of the running cutscene, on the game's clock. */
  const advanceCutscene = (dt: number): void => {
    const scene = cutscene;
    if (!scene) return;
    // A cutscene goes with the script that started it (replaced, failed, or stopped).
    if (!scene.owner.value) { finishCutscene(scene, true, 'here', 'blend'); return; }
    scene.elapsed += dt;
    const raw = scene.start + scene.elapsed * scene.fps * scene.speed;
    // THE LAST FRAME IS SHOWN FOR A FRAME, as Blender's playback shows it, before it ends.
    if (raw >= scene.end + 1 || (scene.end === scene.start && scene.elapsed > 0)) { finishCutscene(scene, false, 'end', 'blend'); return; }
    scene.frame = Math.min(scene.end, raw);
    passMarkers(scene, Math.floor(scene.frame));
    movie()?.seek(scene.frame);
  };
  /** After the frame's updates: the movie's camera while a cutscene runs, else the hand-back blend. */
  const cutsceneCamera = (deltaSeconds: number): void => {
    const lent = movie();
    const scene = cutscene;
    if (scene && lent) {
      const shot = scene.camera ?? lent.cameraAt(scene.frame);
      const looked = shot !== null && lent.look(camera(), shot);
      if (shot !== scene.shot) {
        scene.shot = shot;
        // A camera the model lacks (a typo in `camera`) is said with the cut; the script's own
        // camera then stays.
        run.append('play', 'cutscene', { event: 'cut', camera: shot, frame: Math.floor(scene.frame), ...(shot !== null && !looked ? { missing: true } : {}) });
      }
      return;
    }
    if (handBack) {
      handBack.frame(camera(), deltaSeconds);
      if (handBack.acceptingKeys()) handBack = null;
    }
  };
  const contextFor = (alive: Script): ModelPlayContext => ({
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
    log(kind, facts) { if (alive.value) run.append('script', kind, facts); },
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
        if (before !== null) run.append('play', 'action', { object: target.name, action: null, from: before });
        return true;
      }
      const answer = animation.play(target, action, options);
      if (!answer.ok) return found.unknown(answer.why);
      if (before !== action || options?.restart) run.append('play', 'action', { armature: answer.armature, action, from: before });
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
        run.append('play', 'track', { armature: answer.armature, track, ...(options === null ? { file: true } : { action: options.action ?? null, mute: options.mute ?? false }) });
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
      if (aim !== undefined) run.append('play', 'constraint', { armature: answer.armature, bone, constraint, target: aim?.name ?? null });
      return true;
    },
    actions(object) {
      const target = typeof object === 'string' ? root.getObjectByName(object) ?? null : object;
      return target && options_.animation ? options_.animation.clips(target) : [];
    },
    markers() {
      return (movie()?.markers() ?? []).map((marker) => ({ ...marker }));
    },
    cutscene(span, options = {}) {
      let resolve!: (result: ModelPlayCutsceneResult) => void;
      const done = new Promise<ModelPlayCutsceneResult>((settle) => { resolve = settle; });
      const bounds = alive.value ? spanOf(span, options.end) : { refused: 'the script that asked has stopped' };
      const lent = movie();
      const scene = lent?.scene();
      if ('refused' in bounds || !lent || !scene) {
        const refused = 'refused' in bounds ? bounds.refused : 'this document lends no movie';
        const frame = 'refused' in bounds ? scene?.start ?? 0 : bounds.start;
        if (alive.value) run.append('play', 'cutscene', { event: 'refused', span: span ?? null, why: refused });
        const result: ModelPlayCutsceneResult = { skipped: true, frame, refused };
        resolve(result);
        if (alive.value && options.onDone) queueMicrotask(() => { if (alive.value) options.onDone!(result); });
        return { frame, playing: false, marker: null, done, stop() {} };
      }
      // ONE AT A TIME: a running cutscene ends where it is, and the new one takes the camera.
      if (cutscene) finishCutscene(cutscene, true, 'here', 'restore');
      // A hand-back still blending is cut short: the camera is the movie's again.
      handBack = null;
      const restore = cameraSettings(camera());
      const running: Cutscene = {
        owner: alive, start: bounds.start, end: bounds.end, fps: scene.fps, speed: Math.max(0, options.speed ?? 1),
        blend: Math.max(0, options.blend ?? 0.5), camera: options.camera ?? null, elapsed: 0, frame: bounds.start,
        passed: -Infinity, marker: null, shot: undefined, playing: true, restore, resolve,
        onDone: options.onDone, onMarker: options.onMarker,
      };
      cutscene = running;
      run.append('play', 'cutscene', { event: 'start', from: bounds.start, to: bounds.end, fps: scene.fps,
        camera: options.camera ?? lent.cameraAt(bounds.start), span: span ?? null });
      passMarkers(running, bounds.start);
      lent.seek(bounds.start);
      return {
        get frame() { return running.frame; },
        get playing() { return running.playing; },
        get marker() { return running.marker; },
        done,
        stop(at = 'end') { finishCutscene(running, true, at, 'blend'); },
      };
    },
  });
  const scripts = new WeakMap<ModelPlayGame, Script>();
  let stopped = false;
  let attempt = 0;
  let game: ModelPlayGame | null = null;
  let composition: PlayComposition | null = null;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  const live = editorHost().live;
  const unregisterLive = live.register({
    id: `model-script:${options.documentId}`,
    mounted: () => !stopped && game !== null,
    // The live game owns the viewport through the camera return. Its update
    // loop is held during that transition; Edit begins when disposal completes.
    playing: () => !stopped && game !== null,
    stop: () => { if (!stopped) finishModelPlay(options.documentId); },
    instanceContainer: (id) => !id && !stopped && game !== null ? options.container : null,
    startedAt: () => startedAt,
    endedAt: () => endedAt,
    surface: () => 'three',
  });
  let pending: { game: ModelPlayGame; composition: PlayComposition | null } | null = null;
  // A failed mount/update still owns a dependency graph whose next save retries it.
  let retryEntries: readonly string[] = [];
  const mountLayers = projectPlayLayers();
  const dispose = (ending: ModelPlayGame | null, layers: PlayComposition | null): void => {
    try { ending?.dispose?.(); }
    catch (error) {
      report('stop', `${modulePath} failed while stopping`, error);
    } finally {
      // After its own dispose, which may still log; nothing it scheduled may.
      const alive = ending && scripts.get(ending);
      if (alive) { alive.value = false; alive.bot = null; }
      layers?.dispose();
    }
  };
  const end = (): void => {
    dispose(game, composition);
    game = null;
    composition = null;
    if (startedAt !== null) endedAt = Date.now();
    live.notifyChanged();
  };
  /** `reload` says why a replacement mounts, for the log's `script-reload`; null for Play's first start. */
  const start = async (reload: { readonly reason: string; readonly path: string } | null): Promise<void> => {
    const mine = ++attempt;
    if (pending) { dispose(pending.game, pending.composition); pending = null; }
    let nextComposition: PlayComposition | undefined;
    const alive: Script = { value: true, bot: null, unknown: new Set() };
    try {
      if (mountLayers) {
        const project = getCurrentProject();
        if (!project) throw new Error('No project is open.');
        const epoch = beginProjectMountEpoch();
        const container = document.createElement('div');
        container.dataset['mountEpoch'] = String(epoch);
        Object.assign(container.style, { position: 'absolute', inset: '0', visibility: 'hidden', pointerEvents: 'none' });
        options.container.appendChild(container);
        let layers;
        try {
          layers = await mountLayers({ projectRoot: project.rootPath, epoch, container,
            onEntries: (entries) => { if (!stopped && mine === attempt) retryEntries = [...entries]; },
          });
        }
        catch (error) { container.remove(); throw error; }
        nextComposition = {
          entries: layers.entries,
          loadScript: () => import(/* @vite-ignore */ projectEntryImportUrl(project.rootPath, modulePath, epoch)),
          reveal: () => { container.style.visibility = 'visible'; },
          dispose: () => { layers.dispose(); container.remove(); },
        };
      }
      if (stopped || mine !== attempt) { nextComposition?.dispose(); return; }
      // Before the replacement's default export runs, so what it logs follows this.
      if (reload) run.append('play', 'script-reload', reload);
      const next = await startGame(modulePath, contextFor(alive), nextComposition);
      scripts.set(next, alive);
      if (stopped || mine !== attempt) {
        dispose(next, nextComposition ?? null);
        return;
      }
      pending = { game: next, composition: nextComposition ?? null };
    } catch (error) {
      alive.value = false;
      nextComposition?.dispose();
      if (stopped || mine !== attempt) return;
      report('start', `${modulePath} did not start`, error);
    }
  };
  let firstFrame = true;
  /** Whether the last script to run its first update offered a bot (null before any did), so
   *  `autoplay-unavailable` is said once per run, and again only after a bot came and went. */
  let offeredBot: boolean | null = null;
  let returning = false;
  let stopReason = 'stop';
  const stopRequest = registerModelPlayStop(options.documentId, (escape) => {
    if (escape) stopReason = 'escape';
    keys.clear();
    heldKeys.clear();
    if (firstFrame || transition.stop(escape)) finishModelPlay(options.documentId);
  });
  const stopFrames = onFrame((deltaSeconds) => {
    // REPLACED BY A RESTART, and not yet unmounted: the document keeps this copy on screen until
    // the new one has drawn, so it stands as it is — no update, no clock, the camera held.
    if (!current()) {
      if (game !== null) transition.hold(camera());
      keys.clear();
      return;
    }
    if (transition.leaving()) {
      options.container.style.opacity = String(transition.hudOpacity());
      if (!returning && transition.approachingEdit()) { returning = true; options.returning(); }
      if (transition.frame(camera(), deltaSeconds)) finishModelPlay(options.documentId);
      return;
    }
    if (!surfaceHoldsKeyboard()) { keys.clear(); heldKeys.clear(); }
    else if (!transition.acceptingKeys()) keys.clear();
    else for (const key of heldKeys) keys.add(key);
    // The panel's toggle is enabled by the bot the running script offers, as of the last frame.
    if (current()) setModelPlayAutoplayAvailable(options.documentId, game !== null ? behaviorsOf(scripts.get(game)) : []);
    const updates = frameUpdates(options.documentId, deltaSeconds);
    if (updates.length === 0) {
      // PAUSED: no update, so nothing states the camera; hold the pose the last frame drew.
      // A pending replacement waits too — its first update is a tick of the game's time.
      // A tap made while paused is dropped; a key still held is seen by the next step.
      if (game !== null) transition.hold(camera());
      keys.clear();
      return;
    }
    // Each update is counted — by the panel's clock and the log alike — as it is CALLED, so an
    // update that throws still took its tick, in both.
    let ran = 0;
    let simulated = 0;
    // THE BOT'S KEYS, per update: the person's keys of this frame and what the bot holds now. It
    // drives only once the camera has arrived, as a person's keys reach the game only then.
    const clock = modelPlayClock(options.documentId);
    const driving = current() && modelPlayAutoplay(options.documentId).on && transition.acceptingKeys();
    const person: ReadonlySet<string> = driving ? new Set(keys) : keys;
    /** `keys` back to the person's alone. Only ever after `drive` has added the bot's, when
     *  `person` is a copy — never `keys` itself. */
    const restorePerson = (): void => {
      keys.clear();
      for (const key of person) keys.add(key);
    };
    /** Merge the bot's keys into `keys` for one update; true when it did, and the caller then
     *  restores the person's keys after that update, however it ends. */
    const drive = (script: ModelPlayGame, dt: number): boolean => {
      // Asked again per update: the bot's own failure, a takeover, its limit, or
      // `play.autoplay(null)` ends it mid-frame.
      const now = modelPlayAutoplay(options.documentId);
      const behavior = driving && now.on ? now.behavior : null;
      const bot = behavior !== null ? scripts.get(script)?.bot?.[behavior] : undefined;
      if (!bot || behavior === null) return false;
      restorePerson();
      try {
        const answer = botAnswer(bot({ behavior, dt, simT: clock.time + simulated, tick: clock.tick + ran, keys: person }));
        for (const key of answer.keys) keys.add(String(key));
        if (answer.state !== undefined && answer.state !== now.state) {
          setModelPlayBotState(options.documentId, answer.state);
          run.append('play', 'bot-state', { behavior, state: answer.state });
        }
        return true;
      } catch (error) {
        restorePerson();
        setModelPlayAutoplay(options.documentId, false, 'script');
        report('autoplay', `${modulePath}'s autoplay failed`, error);
        return false;
      }
    };
    /** One update, bot-driven or not. The bot's keys hold for this update only: restored in a
     *  `finally`, so neither a bot withdrawn mid-frame, nor an update that throws, nor a reloaded
     *  script leaves them reading as held. */
    const update = (script: ModelPlayGame, dt: number): void => {
      tick(dt);
      const driven = drive(script, dt);
      try { script.update(dt); }
      finally { if (driven) restorePerson(); }
    };
    // A paused frame that runs an update is a Step; its entry carries the step's own tick.
    const stepping = modelPlayClock(options.documentId).paused;
    const tick = (dt: number): void => {
      // The characters' clips move on the game's clock, one update's `dt` at a time.
      options.animation?.update(dt);
      // A cutscene's frame moves on the same clock, after the clips, so it has the last word.
      advanceCutscene(dt);
      run.advance(dt);
      ran += 1;
      simulated += dt;
      if (stepping) run.append('play', 'step', { dt });
    };
    // A replacement's first update takes the frame's first slot whether it starts or throws; a
    // running game that a failed replacement leaves in place runs the rest of the frame.
    let firstSlot = 0;
    if (pending) {
      firstSlot = 1;
      const next = pending;
      pending = null;
      try {
        update(next.game, updates[0]!);
        end();
        game = next.game;
        // NOW THE SCRIPT HAS SAID WHETHER IT OFFERS A BOT (its default export and first update
        // are where `play.autoplay` is called): said before `running`, so no reader sees a running
        // game with its bot not yet counted, and an arm made while stopped is taken or dropped.
        const behaviors = behaviorsOf(scripts.get(next.game));
        const offered = behaviors.length > 0;
        if (!offered && offeredBot !== false)
          run.append('play', 'autoplay-unavailable', { why: 'the play script registers no bot with play.autoplay(controller)' });
        offeredBot = offered;
        // A KEY THE PERSON ALREADY HOLDS is a takeover the runner did not hear: it was pressed while
        // the stage was still preparing, before these listeners existed, and has only repeated
        // since. The person is driving, so an arm waiting for this update is dropped.
        if (heldKeys.size > 0 && modelPlayAutoplay(options.documentId).armed) takeover();
        settleModelPlayAutoplay(options.documentId, behaviors);
        setModelPlayFailure(options.documentId, null);
        startedAt = Date.now();
        endedAt = null;
        composition = next.composition;
        live.notifyChanged();
        composition?.reveal();
      } catch (error) {
        dispose(next.game, next.composition);
        report('start', `${modulePath} did not start`, error);
      }
    }
    if (game === null) { advanceModelPlayClock(options.documentId, simulated, ran); keys.clear(); return; }
    try {
      for (let index = firstSlot; index < updates.length; index++) {
        update(game, updates[index]!);
      }
      advanceModelPlayClock(options.documentId, simulated, ran);
      ran = 0;
      // THE RUN'S LIMIT: a bot still driving when its simulation seconds are spent is stopped and
      // the game held, so a game that never ends cannot keep a bot (and whoever waits on it) going.
      const bot = modelPlayAutoplay(options.documentId);
      if (current() && bot.on && bot.limit !== null && bot.since !== null) {
        const now = modelPlayClock(options.documentId).time;
        if (now - bot.since >= bot.limit) {
          run.append('play', 'autoplay-limit', { behavior: bot.behavior, limit: bot.limit, ran: now - bot.since, state: bot.state });
          setModelPlayAutoplay(options.documentId, false, 'limit');
          setModelPlayPaused(options.documentId, true);
        }
      }
      cutsceneCamera(deltaSeconds);
      transition.frame(camera(), deltaSeconds);
      options.container.style.opacity = String(transition.hudOpacity());
      if (firstFrame) { firstFrame = false; options.ready(); }
    } catch (error) {
      advanceModelPlayClock(options.documentId, simulated, ran);
      keys.clear();
      end();
      report('update', `${modulePath} failed`, error);
      return;
    }
    materials.frame();
    keys.clear();
    root.updateMatrixWorld(true);
  });
  // THE PERSON ALWAYS WINS: a new key press the game would hear, or a pointer pressed anywhere
  // in the game's area (its HUD included), hands control back before the input is the game's.
  // Untrusted events count: `editor.document.key` and the probe's clicks are how an agent plays
  // by hand.
  const surface = options.container.parentElement ?? options.container;
  const takeover = (): void => {
    if (!current()) return;
    // Whether or not a bot was driving, the person is driving from here on in this run.
    noteModelPlayPerson(options.documentId);
    // An arm still waiting for the bot counts too: the person is driving before it could start.
    const now = modelPlayAutoplay(options.documentId);
    if (now.on || now.armed) setModelPlayAutoplay(options.documentId, false, 'takeover');
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!surfaceAcceptsKey(event)) return;
    // A repeat is a key already held, not a new press — unless this runner never saw it go down:
    // then it was pressed before the runner was listening, and that press was a takeover.
    if (!event.repeat || !heldKeys.has(event.code)) takeover();
    heldKeys.add(event.code);
    if (transition.acceptingKeys()) keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    // Preserve a between-frame tap until one game update has observed it.
    heldKeys.delete(event.code);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && surface.contains(event.target)) takeover();
  };
  const onBlur = (): void => { keys.clear(); heldKeys.clear(); };
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  const stopChanges = subscribeProjectModuleChange((changed, affected, type) => {
    // Removing this run's entry ends its lifetime. A rename can remove it
    // before the model document switches; importing that vanished entry
    // would manufacture a mount failure while the old game is still alive.
    // A missing dependency continues through the ordinary error-reporting path.
    if (type === 'delete' && projectModuleChangeMatches(changed, modulePath)) {
      stopReason = 'script-deleted';
      finishModelPlay(options.documentId);
      return;
    }
    // A composed HUD and script must remount together, including shared-store
    // edits. A fresh epoch is threaded to both through the UI tool door.
    const entries = [modulePath, ...retryEntries, ...(composition?.entries ?? []), ...(pending?.composition?.entries ?? [])];
    if ([changed, ...(affected ?? [])].some(path => entries.some(entry => projectModuleChangeMatches(path, entry))))
      void start({ reason: type === 'delete' ? 'dependency-deleted' : 'saved', path: changed });
  });
  void start(null);
  return () => {
    stopped = true;
    unregisterLive();
    stopRequest();
    // A runner replaced by Restart leaves the play running for its successor.
    if (current()) finishModelPlay(options.documentId);
    stopFrames();
    stopClock();
    stopChanges();
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    if (pending) { dispose(pending.game, pending.composition); pending = null; }
    if (cutscene) finishCutscene(cutscene, true, 'here', 'leave');
    end();
    materials.dispose();
    run.end({ reason: stopReason });
  };
}
