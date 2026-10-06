/**
 * A MODEL'S PLAY SCRIPT — the project module that moves the detached copy while the document
 * plays (`model-play.ts`).
 *
 * It is an ordinary project file beside the `.blend`, as the bpy script that authored it is:
 * `src/models/track.blend` plays `src/models/track.play.ts`. Its default export is called once
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
import { editorHost } from '@volter/editor-sdk/host';
import { getCurrentProject } from '@volter/editor-sdk/kit/active-project';
import { surfaceAcceptsKey, surfaceHoldsKeyboard } from '@volter/editor-sdk/kit/surface-keyboard';
import {
  projectModuleChangeMatches,
  subscribeProjectModuleChange,
} from '@volter/editor-sdk/kit/project-module-changes';
import {
  beginLiveModuleRevision,
  liveModuleImportUrl,
} from '@volter/editor-sdk/session/project-module-url';
import type * as THREE from 'three';
import { projectPlayLayers } from '@volter/editor-sdk/kit/project-play-layers';
import { beginProjectMountEpoch, projectEntryImportUrl } from '@volter/editor-sdk/session/project-module-url';
import { cameraTransition } from './camera-transition';
import {
  advanceModelPlayClock,
  consumeModelPlayRestart,
  finishModelPlay,
  MODEL_PLAY_STEP_SECONDS,
  modelPlayAutoplay,
  modelPlayClock,
  modelPlayGeneration,
  registerModelPlayStop,
  setModelPlayAutoplay,
  setModelPlayAutoplayAvailable,
  subscribeModelPlayClock,
  takeModelPlayStep,
} from './model-play';
import { beginModelPlayLog } from './play-log';
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
   * frame. Read back with `volter-model-editor play-log [--since <simT>] [--kind <k>] [--json]`
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
   * Offer this game's bot. While the person (or an agent, `play autoplay on`) has autoplay on in
   * the Game panel, `controller` is called before each `update` and the keys it answers are held
   * for that update, merged into `keys`. Autoplay is off at every Play and Restart, and a
   * person's key or pointer in the game turns it off. One bot per script: registering again
   * replaces it, `null` withdraws it, and it goes with the script. Never bind autoplay to a game
   * key, and never start it from the script.
   *
   *     play.autoplay(({ dt }) => (car.speed < 20 ? ['ArrowUp'] : []));
   */
  autoplay(controller: ModelPlayAutoplayController | null): void;
}

/** What the bot is handed before each `update` it drives. */
export interface ModelPlayAutoplayInput {
  /** The `dt` the coming `update` is handed. */
  readonly dt: number;
  /** Simulation seconds and the update's number, as that update's log entries carry them. */
  readonly simT: number;
  readonly tick: number;
  /** The keys the person holds, by `KeyboardEvent.code`; the bot's are merged with them. */
  readonly keys: ReadonlySet<string>;
}
/** A game's bot: the keys (`KeyboardEvent.code`) it holds for the coming update. */
export type ModelPlayAutoplayController = (input: ModelPlayAutoplayInput) => Iterable<string> | null | undefined;

export interface ModelPlayGame {
  /** Once per drawn frame, with the simulation seconds since the last call (at most a tenth).
   *  Not called while the game is paused; called once per Step; at a speed other than 1× the
   *  seconds are scaled, and a fast frame may call it more than once. */
  update(deltaSeconds: number): void;
  dispose?(): void;
}

/** One script's lifetime: `value` until it is replaced, fails or the run stops; `bot` is what it
 *  offered `play.autoplay`. */
interface Script {
  value: boolean;
  bot: ModelPlayAutoplayController | null;
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
}): () => void {
  const { blend, root, camera, onFrame } = options;
  const modulePath = playScriptPath(blend);
  // A fresh copy is a fresh run: its log starts empty, its clock at zero. Writes go through
  // this run's handle, which is inert once the run has ended.
  const run = beginModelPlayLog(options.documentId, modulePath);
  const report = (phase: 'start' | 'update' | 'stop' | 'autoplay', title: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    run.append('play', 'script-error', { phase, message: detail });
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
  // An unknown name is the script's typo, not a reason to stop its game: said once per name.
  const unknown = new Set<string>();
  const objectOf = (target: THREE.Object3D | string, call: 'tint' | 'setOpacity'): THREE.Object3D | null => {
    if (typeof target !== 'string') return target;
    const object = root.getObjectByName(target) ?? null;
    if (!object && !unknown.has(target)) {
      unknown.add(target);
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
    if (bot.on !== seenBot.on) run.append('play', bot.on ? 'autoplay-on' : 'autoplay-off', { by: bot.by });
    seenBot = bot;
  });
  options.container.style.opacity = '0';
  /** One script's context: its log, tint, opacity and bot do nothing once that script is gone
   *  (replaced, failed, or the run stopped), so a stale timer cannot reach a later one. */
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
      const target = alive.value ? objectOf(object, 'tint') : null;
      if (target) materials.tint(target, color);
    },
    setOpacity(object, opacity) {
      const target = alive.value ? objectOf(object, 'setOpacity') : null;
      if (target) materials.setOpacity(target, opacity);
    },
    autoplay(controller) {
      if (controller !== null && typeof controller !== 'function')
        throw new Error('play.autoplay takes a function (the bot) or null.');
      if (alive.value) alive.bot = controller;
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
    const alive: Script = { value: true, bot: null };
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
  let returning = false;
  let stopReason = 'stop';
  const stopRequest = registerModelPlayStop(options.documentId, (escape) => {
    if (escape) stopReason = 'escape';
    keys.clear();
    heldKeys.clear();
    if (firstFrame || transition.stop(escape)) finishModelPlay(options.documentId);
  });
  const stopFrames = onFrame((deltaSeconds) => {
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
    if (current()) setModelPlayAutoplayAvailable(options.documentId, game !== null && scripts.get(game)?.bot != null);
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
    const drive = (script: ModelPlayGame, dt: number): void => {
      const bot = driving ? scripts.get(script)?.bot : null;
      // Asked again per update: the bot's own failure, or a takeover, ends it mid-frame.
      if (!bot || !modelPlayAutoplay(options.documentId).on) return;
      keys.clear();
      for (const key of person) keys.add(key);
      try {
        for (const key of bot({ dt, simT: clock.time + simulated, tick: clock.tick + ran, keys: person }) ?? []) keys.add(String(key));
      } catch (error) {
        keys.clear();
        for (const key of person) keys.add(key);
        setModelPlayAutoplay(options.documentId, false, 'script');
        report('autoplay', `${modulePath}'s autoplay failed`, error);
      }
    };
    // A paused frame that runs an update is a Step; its entry carries the step's own tick.
    const stepping = modelPlayClock(options.documentId).paused;
    const tick = (dt: number): void => {
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
        tick(updates[0]!);
        drive(next.game, updates[0]!);
        next.game.update(updates[0]!);
        end();
        game = next.game;
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
    if (game === null) { advanceModelPlayClock(options.documentId, simulated, ran); return; }
    try {
      for (let index = firstSlot; index < updates.length; index++) {
        tick(updates[index]!);
        drive(game, updates[index]!);
        game.update(updates[index]!);
      }
      advanceModelPlayClock(options.documentId, simulated, ran);
      ran = 0;
      transition.frame(camera(), deltaSeconds);
      options.container.style.opacity = String(transition.hudOpacity());
      if (firstFrame) { firstFrame = false; options.ready(); }
    } catch (error) {
      advanceModelPlayClock(options.documentId, simulated, ran);
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
    if (current() && modelPlayAutoplay(options.documentId).on) setModelPlayAutoplay(options.documentId, false, 'takeover');
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!surfaceAcceptsKey(event)) return;
    // A repeat is a key already held, not a new press.
    if (!event.repeat) takeover();
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
    end();
    materials.dispose();
    run.end({ reason: stopReason });
  };
}
