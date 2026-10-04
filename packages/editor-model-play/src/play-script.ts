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
 * A save disposes and rebuilds that composition against the same detached copy.
 */
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
interface PlayComposition { loadScript(): Promise<{ default?: unknown }>; dispose(): void; }

export interface ModelPlayContext {
  /** The Model group: the detached copy's root. */
  readonly root: THREE.Object3D;
  /** The object a Blender object's name presents as, ready to be moved by `position`,
   *  `quaternion` and `scale`; null when the file has no such object. */
  find(name: string): THREE.Object3D | null;
  /** The camera the stage draws with. The script's pose is the frame's last word, and the
   *  stage's own navigation re-poses it before each call, so a script states the whole pose
   *  every frame. */
  readonly camera: THREE.Camera;
  /** The keys held now, by `KeyboardEvent.code` (`ArrowUp`, `KeyW`, `Space`). */
  readonly keys: ReadonlySet<string>;
}

export interface ModelPlayGame {
  /** Once per drawn frame, with the seconds since the last one (at most a tenth). */
  update(deltaSeconds: number): void;
  dispose?(): void;
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
  readonly blend: string;
  readonly root: THREE.Object3D;
  readonly camera: () => THREE.Camera;
  readonly onFrame: (fn: (deltaSeconds: number) => void) => () => void;
  readonly report: (title: string, detail: string) => void;
  readonly container: HTMLElement;
  readonly ready: () => void;
}): () => void {
  const { blend, root, camera, onFrame, report } = options;
  const modulePath = playScriptPath(blend);
  const keys = new Set<string>();
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
  const mountLayers = projectPlayLayers();
  const end = (): void => {
    const ending = game;
    game = null;
    try {
      ending?.dispose?.();
    } catch (error) {
      report(`${modulePath} failed while stopping`, error instanceof Error ? error.message : String(error));
    }
    composition?.dispose();
    composition = null;
  };
  const start = async (): Promise<void> => {
    const mine = ++attempt;
    end();
    let nextComposition: PlayComposition | undefined;
    try {
      if (mountLayers) {
        const project = getCurrentProject();
        if (!project) throw new Error('No project is open.');
        const epoch = beginProjectMountEpoch();
        const dispose = await mountLayers({ projectRoot: project.rootPath, epoch, container: options.container });
        nextComposition = {
          loadScript: () => import(/* @vite-ignore */ projectEntryImportUrl(project.rootPath, modulePath, epoch)),
          dispose,
        };
      }
      if (stopped || mine !== attempt) { nextComposition?.dispose(); return; }
      const next = await startGame(modulePath, context, nextComposition);
      if (stopped || mine !== attempt) {
        next.dispose?.();
        nextComposition?.dispose();
        return;
      }
      game = next;
      composition = nextComposition ?? null;
    } catch (error) {
      nextComposition?.dispose();
      if (stopped || mine !== attempt) return;
      report(`${modulePath} did not start`, error instanceof Error ? error.message : String(error));
    }
  };
  let firstFrame = true;
  const stopFrames = onFrame((deltaSeconds) => {
    if (game === null) return;
    if (!surfaceHoldsKeyboard()) keys.clear();
    try {
      game.update(deltaSeconds);
      if (firstFrame) { firstFrame = false; options.ready(); }
    } catch (error) {
      end();
      report(`${modulePath} failed`, error instanceof Error ? error.message : String(error));
      return;
    }
    root.updateMatrixWorld(true);
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (surfaceAcceptsKey(event)) keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const onBlur = (): void => keys.clear();
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  const stopChanges = subscribeProjectModuleChange((changed) => {
    // A composed HUD and script must remount together, including shared-store
    // edits. A fresh epoch is threaded to both through the UI tool door.
    if (mountLayers || projectModuleChangeMatches(changed, modulePath)) void start();
  });
  void start();
  return () => {
    stopped = true;
    stopFrames();
    stopChanges();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    end();
  };
}
