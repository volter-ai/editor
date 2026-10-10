/**
 * A PLAY SCRIPT RUN WITHOUT THE EDITOR: the per-frame core of `play-script.ts` with no editor
 * service in it, for a game exported to a page of its own (`cyclotron export web`).
 *
 * It hands the script the same context the editor does (`play-context.ts`), and each frame does
 * what the editor's runner does with it: the frame's seconds split into updates of at most a
 * tenth, the characters' clips advanced by each update's `dt` (`animation.update`), the script's
 * `update(dt)`, then the material copies kept on the meshes (`materials.frame()`) and the world
 * matrices brought up to date. Keys come from the window by `KeyboardEvent.code`, as in the
 * editor: held keys are seen every update, a tap between two frames by one update.
 *
 * WHAT THE EDITOR ADDS AND THIS DOES NOT: the Game panel's clock (pause, step, speed, restart),
 * reloading on save, the camera's blend in and out of Play, and autoplay. A game offers its bot
 * with `play.autoplay` as ever; nothing here drives it, as a game run outside the editor never
 * drives itself. Escape is the game's: there is no editor for it to stop.
 *
 * THE LOG is kept in memory (the newest `logCapacity` entries, stamped with simulation seconds
 * and the update's number as in the editor), for the page to show or a person to read with
 * `runner.log()` from the console.
 */
import type * as THREE from 'three';
import type { DocumentPlayAnimation } from '@volter/sdk/kit/document-play-extension';
import { materialOverrides } from './play-materials';
import { moviePlayer } from './play-movie';
import {
  isModelPlayGame,
  modelPlayContext,
  splitUpdateSeconds,
  type ModelPlayContext,
  type ModelPlayGame,
  type ModelPlayScriptLife,
} from './play-context';

export type { ModelPlayContext, ModelPlayGame } from './play-context';

export interface PlayRunnerLogEntry {
  /** Simulation seconds when it was written, and the update's number. */
  readonly simT: number;
  readonly tick: number;
  /** `play` is the runner's own entry; `script` one the script wrote with `play.log`. */
  readonly source: 'play' | 'script';
  readonly kind: string;
  readonly facts?: unknown;
}

export interface PlayRunnerOptions {
  /** The Model group the page draws (the copy's root). */
  readonly root: THREE.Object3D;
  /** The camera the page draws with; the script poses it every update. */
  readonly camera: () => THREE.Camera;
  /** The copy's characters' clips bound to `root`; absent, they stand in their exported pose. */
  readonly animation?: DocumentPlayAnimation | undefined;
  /** A copy of one of `root`'s materials that one object can wear alone (`play.tint`). */
  readonly ownMaterial?: ((material: THREE.Material) => THREE.Material | null) | undefined;
  /** Where key and focus events are heard; the window by default. */
  readonly events?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** A script that failed to start, threw in `update` or while stopping. */
  readonly report?: (title: string, detail: string) => void;
  /** The newest entries kept (5000). */
  readonly logCapacity?: number;
}

export interface PlayRunner {
  /** Call the script's default export with its context; resolves once it answered its game. */
  start(script: { readonly default?: unknown }, name?: string): Promise<void>;
  /** One drawn frame of `seconds` real seconds: the updates that run it, then the materials. */
  frame(seconds: number): void;
  /** A game is running: started, and not stopped by a throw. */
  readonly running: boolean;
  /** Simulation seconds and updates run so far. */
  readonly clock: { readonly time: number; readonly tick: number };
  log(): readonly PlayRunnerLogEntry[];
  dispose(): void;
}

const editable = (target: EventTarget | null): boolean =>
  typeof HTMLElement !== 'undefined' && target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('input, textarea, select') !== null);

export function createPlayRunner(options: PlayRunnerOptions): PlayRunner {
  const { root } = options;
  const events = options.events ?? window;
  const capacity = Math.max(1, options.logCapacity ?? 5000);
  const entries: PlayRunnerLogEntry[] = [];
  let time = 0;
  let tick = 0;
  const append = (source: 'play' | 'script', kind: string, facts?: unknown): void => {
    let snapshot: unknown = undefined;
    try { snapshot = facts === undefined ? undefined : JSON.parse(JSON.stringify(facts)); } catch { snapshot = String(facts); }
    entries.push({ simT: time, tick, source, kind, ...(snapshot === undefined ? {} : { facts: snapshot }) });
    if (entries.length > capacity) entries.splice(0, entries.length - capacity);
  };
  const report = (phase: 'start' | 'update' | 'stop', title: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    append('play', 'script-error', { phase, message: detail });
    if (options.report) options.report(title, detail);
    // biome-ignore lint/suspicious/noConsole: a page of its own has no other place to say it.
    else console.error(`${title}: ${detail}`, error);
  };
  const unsupported = new WeakSet<THREE.Mesh>();
  const materials = materialOverrides({
    root,
    ownMaterial: options.ownMaterial,
    unsupported: (mesh, material) => {
      if (unsupported.has(mesh)) return;
      unsupported.add(mesh);
      append('play', 'tint-unsupported', { object: mesh.name, material: material.name,
        why: options.ownMaterial ? 'the material is not one the document presents' : 'this document lends no material copies' });
    },
  });
  const keys = new Set<string>();
  const heldKeys = new Set<string>();
  const tracks = new Map<string, string>();
  let name = 'play script';
  /** Cutscenes and sequences from the exported movie, on the game's clock (`play-movie.ts`). */
  const movies = moviePlayer({
    movie: () => options.animation?.movie ?? null,
    camera: options.camera,
    root,
    append,
    report: (what, error) => report('update', `${name}'s ${what} failed`, error),
  });
  let game: ModelPlayGame | null = null;
  let life: ModelPlayScriptLife | null = null;
  let disposed = false;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (editable(event.target)) return;
    heldKeys.add(event.code);
    keys.add(event.code);
  };
  // Preserve a between-frame tap until one update has observed it.
  const onKeyUp = (event: KeyboardEvent): void => { heldKeys.delete(event.code); };
  const onBlur = (): void => { keys.clear(); heldKeys.clear(); };
  events.addEventListener('keydown', onKeyDown as EventListener, true);
  events.addEventListener('keyup', onKeyUp as EventListener, true);
  events.addEventListener('blur', onBlur);

  const stop = (): void => {
    const ending = game;
    game = null;
    try { ending?.dispose?.(); }
    catch (error) { report('stop', `${name} failed while stopping`, error); }
    finally { if (life) { life.value = false; life.bot = null; } }
  };

  return {
    async start(script, label) {
      if (disposed) throw new Error('This play runner was disposed.');
      if (game) stop();
      name = label ?? name;
      const alive: ModelPlayScriptLife = { value: true, bot: null, starts: null, unknown: new Set() };
      life = alive;
      append('play', 'play-start', { script: name });
      try {
        if (typeof script.default !== 'function')
          throw new Error(`${name} has no default export to call: a play script default-exports (play) => ({ update(dt) }).`);
        const context = modelPlayContext({
          root, camera: options.camera, keys, materials, tracks, movies, animation: options.animation, append,
        }, alive);
        const answered: unknown = await (script.default as (play: ModelPlayContext) => unknown)(context);
        if (!isModelPlayGame(answered))
          throw new Error(`${name}'s default export answered no game: it returns an object with update(dt).`);
        if (disposed || life !== alive) { try { answered.dispose?.(); } finally { alive.value = false; } return; }
        game = answered;
      } catch (error) {
        alive.value = false;
        report('start', `${name} did not start`, error);
        throw error;
      }
    },
    frame(seconds) {
      if (disposed) return;
      for (const key of heldKeys) keys.add(key);
      const running = game;
      if (running) {
        try {
          for (const dt of splitUpdateSeconds(Math.max(0, seconds))) {
            options.animation?.update(dt);
            movies.advance(dt);
            time += dt;
            tick += 1;
            running.update(dt);
          }
        } catch (error) {
          keys.clear();
          stop();
          report('update', `${name} failed`, error);
          return;
        }
      }
      movies.frame(Math.max(0, seconds));
      materials.frame();
      keys.clear();
      root.updateMatrixWorld(true);
    },
    get running() { return game !== null; },
    get clock() { return { time, tick }; },
    log: () => entries.slice(),
    dispose() {
      if (disposed) return;
      movies.end();
      stop();
      disposed = true;
      events.removeEventListener('keydown', onKeyDown as EventListener, true);
      events.removeEventListener('keyup', onKeyUp as EventListener, true);
      events.removeEventListener('blur', onBlur);
      materials.dispose();
      append('play', 'play-stop', { reason: 'stop' });
    },
  };
}
