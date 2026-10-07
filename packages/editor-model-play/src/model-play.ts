/**
 * WHETHER A MODEL DOCUMENT IS PLAYING (Play in the Game panel, `blender-game-panel.tsx`; drawn by
 * `blender-runtime.document.tsx`). Playing, the document's area shows a detached copy of the
 * model (`BlenderRuntimeView.detach`) that the project's play script moves
 * (`play-script.ts`); the model, its selection and its history stand as they were, and Stop
 * returns to them. Kept for the page's life and never stored: a reload opens the model, not a
 * game.
 *
 * AND HOW ITS CLOCK RUNS. Pause, step, speed and restart are state of the RUN, so they are kept
 * here beside "is it playing", and the runner (`play-script.ts`) reads them on every frame: the
 * `dt` a script's `update` receives is the only time a play script is given, so holding it is
 * what freezes the game and scaling it is what speeds the game up. A script that reads the
 * page's own clock (`performance.now()`, `Date.now()`) instead is outside that reach.
 *
 * AND WHO DRIVES. Autoplay is the editor's switch, not the game's: a script only offers a bot
 * (`play.autoplay(controller)`, `play-script.ts`), and whether that bot drives is kept here. It
 * is off whenever a run begins — Play, Restart, Stop — and only the Game panel's toggle or its
 * verb (`volter.model-play.autoplay`) turns it on. The runner turns it off the moment a person
 * presses a key or touches the game (`takeover`), or when the running script stops offering a
 * bot (`script`). Its changes are announced through the clock's subscription, which the panel
 * and the runner already hold.
 */
const listeners = new Set<() => void>();
const clockListeners = new Set<() => void>();
const playing = new Set<string>();
const stops = new Map<string, { readonly stop: (escape: boolean) => void; readonly generation: number }>();

/** The speeds the transport offers, slowest first (simulation seconds per real second). */
export const MODEL_PLAY_SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4];
/** The `dt` one Step hands the game: one nominal 60 Hz frame, whatever the speed. */
export const MODEL_PLAY_STEP_SECONDS = 1 / 60;

export interface ModelPlayClock {
  readonly time: number;
  readonly tick: number;
  readonly paused: boolean;
  readonly speed: number;
  /** The run is playing but no game runs: the script failed to start, or threw (`play-script.ts`). */
  readonly failure: string | null;
  /** A game has started in this run and runs (`DocumentPlayClock.running`). */
  readonly running: boolean;
}
const STILL: ModelPlayClock = { time: 0, tick: 0, paused: false, speed: 1, failure: null, running: false };
/** Replaced, never mutated, so a snapshot read by `useSyncExternalStore` changes identity
 *  exactly when it changes value. */
const clocks = new Map<string, ModelPlayClock>();
/** Steps asked for while paused and not yet run; the runner takes one per drawn frame. */
const steps = new Map<string, number>();
/** Bumped by Restart; the document keys its detached copy on it (`DocumentPlayTransport`). */
const generations = new Map<string, number>();
/** Documents whose next run was begun by Restart, and so enters without the camera's blend. */
const restarted = new Set<string>();

/** Who last switched autoplay: the panel's toggle, a verb (CLI or `eval`), a person's input
 *  in the game, or the running script no longer offering a bot (replaced, failed, or its bot
 *  threw). */
export type ModelPlayAutoplayBy = 'panel' | 'cli' | 'takeover' | 'script';
export interface ModelPlayAutoplay {
  /** The bot drives: its keys are merged into the keys the script reads. */
  readonly on: boolean;
  /** The running script registered a bot with `play.autoplay`. */
  readonly available: boolean;
  readonly by: ModelPlayAutoplayBy | null;
}
const NO_BOT: ModelPlayAutoplay = { on: false, available: false, by: null };
/** Replaced, never mutated, as the clocks are. Absent is {@link NO_BOT}: a new run's state. */
const autoplays = new Map<string, ModelPlayAutoplay>();

function publish(): void {
  for (const listener of [...listeners]) listener();
}
function publishClock(): void {
  for (const listener of [...clockListeners]) listener();
}
function setClock(documentId: string, next: Partial<ModelPlayClock>): void {
  clocks.set(documentId, { ...modelPlayClock(documentId), ...next });
  publishClock();
}

export function modelPlaying(documentId: string): boolean {
  return playing.has(documentId);
}

export function setModelPlaying(documentId: string, value: boolean): void {
  if (playing.has(documentId) === value) return;
  const stop = value ? null : currentStop(documentId);
  if (stop) { stop(false); return; }
  if (value) {
    playing.add(documentId);
    // A new run starts its clock at zero and running; the speed is the person's and stays.
    steps.delete(documentId);
    autoplays.delete(documentId);
    setClock(documentId, { time: 0, tick: 0, paused: false, failure: null, running: false });
  } else {
    playing.delete(documentId);
    restarted.delete(documentId);
    steps.delete(documentId);
    autoplays.delete(documentId);
    // The clock keeps the stopped run's time and tick, so the panel still says how far it got.
    // Re-issued even unchanged, after `playing` has changed: every way a game stops (Stop,
    // Escape, a deleted script, a mode switch, an agent's `stop`) ends here, and a reader of
    // the clock alone must see the run end too.
    setClock(documentId, { paused: false, failure: null, running: false });
  }
  publish();
}

export function finishModelPlay(documentId: string): void {
  stops.delete(documentId);
  setModelPlaying(documentId, false);
}

export function escapeModelPlay(documentId: string): void {
  const stop = currentStop(documentId);
  if (stop) stop(true);
  else finishModelPlay(documentId);
}

/**
 * A RUNNER'S STOP, BOUND TO ITS GENERATION. Stop and Escape go to the runner of the CURRENT
 * generation, which blends the camera back first; a stop a Restart has superseded is never
 * asked, because that runner stands still from the moment its generation passes
 * (`play-script.ts`) and would never finish the blend — the stop would be lost. With no current
 * runner (a restarted game still preparing) the play simply ends.
 */
export function registerModelPlayStop(documentId: string, stop: (escape: boolean) => void): () => void {
  const entry = { stop, generation: modelPlayGeneration(documentId) };
  stops.set(documentId, entry);
  return () => { if (stops.get(documentId) === entry) stops.delete(documentId); };
}

function currentStop(documentId: string): ((escape: boolean) => void) | null {
  const entry = stops.get(documentId);
  return entry !== undefined && entry.generation === modelPlayGeneration(documentId) ? entry.stop : null;
}

/** The runner's report that no game runs although the run plays (`null` once one does, which
 *  is also the moment the run is `running`). */
export function setModelPlayFailure(documentId: string, failure: string | null): void {
  const clock = modelPlayClock(documentId);
  const running = failure === null;
  if (!playing.has(documentId) || (clock.failure === failure && clock.running === running)) return;
  setClock(documentId, { failure, running });
}

export function subscribeModelPlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function modelPlayClock(documentId: string): ModelPlayClock {
  return clocks.get(documentId) ?? STILL;
}

export function subscribeModelPlayClock(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
  };
}

/** Hold or release the game's updates. Only a playing document has updates to hold. */
export function setModelPlayPaused(documentId: string, paused: boolean): void {
  if (!playing.has(documentId) || modelPlayClock(documentId).paused === paused) return;
  if (!paused) steps.delete(documentId);
  setClock(documentId, { paused });
}

/** One update while paused. Steps asked for faster than frames are drawn queue, one per frame,
 *  so each one is seen. */
export function stepModelPlay(documentId: string): void {
  if (!playing.has(documentId) || !modelPlayClock(documentId).paused) return;
  steps.set(documentId, (steps.get(documentId) ?? 0) + 1);
}

/** The runner's half of {@link stepModelPlay}: whether this frame runs a step. */
export function takeModelPlayStep(documentId: string): boolean {
  const pending = steps.get(documentId) ?? 0;
  if (pending === 0) return false;
  if (pending === 1) steps.delete(documentId);
  else steps.set(documentId, pending - 1);
  return true;
}

export function setModelPlaySpeed(documentId: string, speed: number): void {
  if (!MODEL_PLAY_SPEEDS.includes(speed))
    throw new Error(`Play speed ${speed} is not one the transport offers: ${MODEL_PLAY_SPEEDS.join(', ')}.`);
  if (modelPlayClock(documentId).speed !== speed) setClock(documentId, { speed });
}

/** The runner's report of the updates it ran this frame. */
export function advanceModelPlayClock(documentId: string, seconds: number, ticks: number): void {
  if (ticks === 0) return;
  const clock = modelPlayClock(documentId);
  setClock(documentId, { time: clock.time + seconds, tick: clock.tick + ticks });
}

export function modelPlayGeneration(documentId: string): number {
  return generations.get(documentId) ?? 0;
}

/**
 * BEGIN THE RUN AGAIN ON A FRESH COPY. Playing stays true throughout — nothing returns to the
 * model — and the generation moves, which is what makes the document detach a new copy and mount
 * a new runner over it; the old runner sees it is no longer the current generation and stands
 * down without ending the play. A document that is not playing simply starts.
 */
export function restartModelPlay(documentId: string): void {
  if (!playing.has(documentId)) { setModelPlaying(documentId, true); return; }
  generations.set(documentId, modelPlayGeneration(documentId) + 1);
  restarted.add(documentId);
  steps.delete(documentId);
  autoplays.delete(documentId);
  setClock(documentId, { time: 0, tick: 0, paused: false, failure: null, running: false });
  publish();
}

/** Whether the run starting now was begun by Restart (asked once, by that run's runner). */
export function consumeModelPlayRestart(documentId: string): boolean {
  return restarted.delete(documentId);
}

export function modelPlayAutoplay(documentId: string): ModelPlayAutoplay {
  return autoplays.get(documentId) ?? NO_BOT;
}

function setAutoplay(documentId: string, next: Partial<ModelPlayAutoplay>): void {
  autoplays.set(documentId, { ...modelPlayAutoplay(documentId), ...next });
  publishClock();
}

/** Switch the running script's bot on or off. On asks for a playing document whose script
 *  registered a bot; off always succeeds. */
export function setModelPlayAutoplay(documentId: string, on: boolean, by: ModelPlayAutoplayBy): void {
  const now = modelPlayAutoplay(documentId);
  if (on && !playing.has(documentId))
    throw new Error(`Nothing is playing in ${documentId}, so there is no bot to switch on; \`play\` starts it.`);
  if (on && !now.available)
    throw new Error('This game provides no bot: its play script registers none with `play.autoplay(controller)`.');
  if (now.on !== on) setAutoplay(documentId, { on, by });
}

/** The runner's report of whether the running script offers a bot. Losing it turns autoplay off. */
export function setModelPlayAutoplayAvailable(documentId: string, available: boolean): void {
  const now = modelPlayAutoplay(documentId);
  if (now.available === available || !playing.has(documentId)) return;
  setAutoplay(documentId, available || !now.on ? { available } : { available, on: false, by: 'script' });
}
