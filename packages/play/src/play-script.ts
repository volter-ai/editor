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
  modelPlayStart,
  noteModelPlayPerson,
  registerModelPlayStop,
  setModelPlayAutoplay,
  setModelPlayBotState,
  setModelPlayFailure,
  setModelPlayAutoplayAvailable,
  setModelPlayPaused,
  setModelPlayStartsOffered,
  settleModelPlayAutoplay,
  subscribeModelPlayClock,
  takeModelPlayStep,
} from './model-play';
import { beginModelPlayLog } from './play-log';
import type { DocumentPlayAnimation } from '@volter/sdk/kit/document-play-extension';
import { materialOverrides } from './play-materials';
import { moviePlayer } from './play-movie';
import {
  isModelPlayGame,
  splitUpdateSeconds,
  modelPlayContext,
  type ModelPlayAutoplayController,
  type ModelPlayContext,
  type ModelPlayGame,
  type ModelPlayScriptLife,
} from './play-context';

export type {
  ModelPlayActionOptions,
  ModelPlayAutoplayController,
  ModelPlayAutoplayInput,
  ModelPlayConstraintOptions,
  ModelPlayContext,
  ModelPlayGame,
  ModelPlayTrackOptions,
} from './play-context';

type Script = ModelPlayScriptLife;
interface PlayComposition {
  readonly entries: readonly string[];
  loadScript(): Promise<{ default?: unknown }>;
  reveal(): void;
  dispose(): void;
}

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

/** The behaviour names a script's bot offers, in its order. */
function behaviorsOf(script: Script | undefined): string[] {
  return script?.bot ? Object.keys(script.bot) : [];
}

/**
 * THE UPDATES THIS DRAWN FRAME RUNS, as the `dt` each is handed: none while paused, one nominal
 * frame for a Step, and otherwise the frame's seconds times the speed, split into equal parts of
 * at most a tenth of a second (`splitUpdateSeconds`).
 */
function frameUpdates(documentId: string, frameSeconds: number): number[] {
  const clock = modelPlayClock(documentId);
  if (clock.paused) return takeModelPlayStep(documentId) ? [MODEL_PLAY_STEP_SECONDS] : [];
  return splitUpdateSeconds(frameSeconds * clock.speed);
}

/** The play script's project path for a model's `.blend`. */
export function playScriptPath(blend: string): string {
  return blend.replace(/\.blend$/i, '') + '.play.ts';
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
  if (!isModelPlayGame(game))
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
  /** The running script: the document's, until a level brings its own (`play.load`). */
  let modulePath = playScriptPath(blend);
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
  const keys = new Set<string>();
  const heldKeys = new Set<string>();
  /** What each NLA track was last set to, so the log says a change once. */
  const tracks = new Map<string, string>();
  /** The run's cutscenes and sequences: the document's movie on the game's clock (`play-movie.ts`). */
  /** The level's animation: the document's, until a level's load replaces it (`play.load`). */
  let animation = options.animation;
  const movies = moviePlayer({
    movie: () => animation?.movie ?? null,
    camera,
    root,
    append: (source, kind, facts) => run.append(source, kind, facts),
    report: (what, error) => report('update', `${modulePath}'s ${what} failed`, error),
  });
  /** LOAD A LEVEL (`play.load`): the document builds its cook into `root`, and its animation and
   *  movie replace the old level's. The script keeps running throughout. */
  let loadingLevel: Promise<void> | null = null;
  const loadLevel = (level: string): Promise<void> => {
    if (!options.loadLevel) return Promise.reject(new Error('This document cannot load levels (play.load); update the model document and @volter/play.'));
    if (loadingLevel) return Promise.reject(new Error(`play.load('${level}') was called while another level is loading.`));
    const started = performance.now();
    run.append('play', 'level-loading', { level });
    movies.end();
    loadingLevel = options.loadLevel(level).then(async (loaded) => {
      animation = loaded.animation;
      tracks.clear();
      run.append('play', 'level', { level, ms: Math.round(performance.now() - started), animation: loaded.animation !== undefined, script: loaded.script ?? null });
      // A LEVEL WITH ITS OWN SCRIPT runs it in place of this one, as a scene's scripts do in other
      // engines; state both share lives in the modules both import
      if (loaded.script && loaded.script !== modulePath) {
        modulePath = loaded.script;
        await start({ reason: 'level', path: loaded.script });
      }
    }, (error: unknown) => {
      run.append('play', 'level-failed', { level, why: error instanceof Error ? error.message : String(error) });
      throw error;
    }).finally(() => { loadingLevel = null; });
    return loadingLevel;
  };
  const preloadLevel = (level: string): Promise<void> => {
    if (!options.preloadLevel) return Promise.reject(new Error('This document cannot load levels (play.preload).'));
    const started = performance.now();
    return options.preloadLevel(level).then(() => run.append('play', 'level-preloaded', { level, ms: Math.round(performance.now() - started) }));
  };
  const contextFor = (alive: Script): ModelPlayContext => modelPlayContext({
    root, camera, keys, materials, tracks, movies,
    get animation() { return animation; },
    load: loadLevel,
    preload: preloadLevel,
    append: (source, kind, facts) => run.append(source, kind, facts),
  }, alive);
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
  let pending: { game: ModelPlayGame; composition: PlayComposition | null; level?: boolean } | null = null;
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
    const alive: Script = { value: true, bot: null, starts: null, unknown: new Set() };
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
      pending = { game: next, composition: nextComposition ?? null, level: reload?.reason === 'level' };
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
      animation?.update(dt);
      // A cutscene's frame moves on the same clock, after the clips, so it has the last word.
      movies.advance(dt);
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
        // THE CHOSEN START, set up once before the first update (`play.starts`): the script's default
        // export has built its state, and the start moves it to its situation
        const offeredStarts = scripts.get(next.game)?.starts ?? null;
        setModelPlayStartsOffered(options.documentId, offeredStarts ? Object.keys(offeredStarts) : []);
        const chosen = modelPlayStart(options.documentId).chosen;
        if (chosen !== null && !next.level) {
          const setup = offeredStarts?.[chosen];
          if (!setup) run.append('play', 'start-refused', { start: chosen, offered: offeredStarts ? Object.keys(offeredStarts) : [], why: offeredStarts ? 'the play script offers no start of that name' : 'the play script offers no starts (play.starts)' });
          else {
            setup({ name: chosen });
            run.append('play', 'start', { start: chosen });
          }
        }
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
      movies.frame(deltaSeconds);
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
    movies.end();
    end();
    materials.dispose();
    run.end({ reason: stopReason });
  };
}
