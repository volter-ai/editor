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
  modelPlayClock,
  modelPlayGeneration,
  registerModelPlayStop,
  takeModelPlayStep,
} from './model-play';
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
}

export interface ModelPlayGame {
  /** Once per drawn frame, with the simulation seconds since the last call (at most a tenth).
   *  Not called while the game is paused; called once per Step; at a speed other than 1× the
   *  seconds are scaled, and a fast frame may call it more than once. */
  update(deltaSeconds: number): void;
  dispose?(): void;
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
}): () => void {
  const { blend, root, camera, onFrame, report } = options;
  const modulePath = playScriptPath(blend);
  const keys = new Set<string>();
  const heldKeys = new Set<string>();
  // The run this runner belongs to. A Restart moves the document to the next generation, whose
  // own runner takes over; this one must then stand down without ending the play.
  const generation = modelPlayGeneration(options.documentId);
  const current = (): boolean => modelPlayGeneration(options.documentId) === generation;
  const transition = cameraTransition(options.editingCamera(), { instant: consumeModelPlayRestart(options.documentId) });
  options.container.style.opacity = '0';
  const context: ModelPlayContext = {
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
  };
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
      report(`${modulePath} failed while stopping`, error instanceof Error ? error.message : String(error));
    } finally { layers?.dispose(); }
  };
  const end = (): void => {
    dispose(game, composition);
    game = null;
    composition = null;
    if (startedAt !== null) endedAt = Date.now();
    live.notifyChanged();
  };
  const start = async (): Promise<void> => {
    const mine = ++attempt;
    if (pending) { dispose(pending.game, pending.composition); pending = null; }
    let nextComposition: PlayComposition | undefined;
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
      const next = await startGame(modulePath, context, nextComposition);
      if (stopped || mine !== attempt) {
        dispose(next, nextComposition ?? null);
        return;
      }
      pending = { game: next, composition: nextComposition ?? null };
    } catch (error) {
      nextComposition?.dispose();
      if (stopped || mine !== attempt) return;
      report(`${modulePath} did not start`, error instanceof Error ? error.message : String(error));
    }
  };
  let firstFrame = true;
  let returning = false;
  const stopRequest = registerModelPlayStop(options.documentId, (escape) => {
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
    const updates = frameUpdates(options.documentId, deltaSeconds);
    if (updates.length === 0) {
      // PAUSED: no update, so nothing states the camera; hold the pose the last frame drew.
      // A pending replacement waits too — its first update is a tick of the game's time.
      // A tap made while paused is dropped; a key still held is seen by the next step.
      if (game !== null) transition.hold(camera());
      keys.clear();
      return;
    }
    let ran = 0;
    let simulated = 0;
    let replacementUpdated = false;
    if (pending) {
      const next = pending;
      pending = null;
      try {
        next.game.update(updates[0]!);
        ran = 1;
        simulated = updates[0]!;
        end();
        game = next.game;
        startedAt = Date.now();
        endedAt = null;
        composition = next.composition;
        live.notifyChanged();
        composition?.reveal();
        replacementUpdated = true;
      } catch (error) {
        dispose(next.game, next.composition);
        report(`${modulePath} did not start`, error instanceof Error ? error.message : String(error));
      }
    }
    if (game === null) return;
    try {
      for (let index = replacementUpdated ? 1 : 0; index < updates.length; index++) {
        game.update(updates[index]!);
        ran += 1;
        simulated += updates[index]!;
      }
      advanceModelPlayClock(options.documentId, simulated, ran);
      ran = 0;
      transition.frame(camera(), deltaSeconds);
      options.container.style.opacity = String(transition.hudOpacity());
      if (firstFrame) { firstFrame = false; options.ready(); }
    } catch (error) {
      advanceModelPlayClock(options.documentId, simulated, ran);
      end();
      report(`${modulePath} failed`, error instanceof Error ? error.message : String(error));
      return;
    }
    keys.clear();
    root.updateMatrixWorld(true);
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!surfaceAcceptsKey(event)) return;
    heldKeys.add(event.code);
    if (transition.acceptingKeys()) keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    // Preserve a between-frame tap until one game update has observed it.
    heldKeys.delete(event.code);
  };
  const onBlur = (): void => { keys.clear(); heldKeys.clear(); };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  const stopChanges = subscribeProjectModuleChange((changed, affected, type) => {
    // Removing this run's entry ends its lifetime. A rename can remove it
    // before the model document switches; importing that vanished entry
    // would manufacture a mount failure while the old game is still alive.
    // A missing dependency continues through the ordinary error-reporting path.
    if (type === 'delete' && projectModuleChangeMatches(changed, modulePath)) {
      finishModelPlay(options.documentId);
      return;
    }
    // A composed HUD and script must remount together, including shared-store
    // edits. A fresh epoch is threaded to both through the UI tool door.
    const entries = [modulePath, ...retryEntries, ...(composition?.entries ?? []), ...(pending?.composition?.entries ?? [])];
    if ([changed, ...(affected ?? [])].some(path => entries.some(entry => projectModuleChangeMatches(path, entry)))) void start();
  });
  void start();
  return () => {
    stopped = true;
    unregisterLive();
    stopRequest();
    // A runner replaced by Restart leaves the play running for its successor.
    if (current()) finishModelPlay(options.documentId);
    stopFrames();
    stopChanges();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    if (pending) { dispose(pending.game, pending.composition); pending = null; }
    end();
  };
}
