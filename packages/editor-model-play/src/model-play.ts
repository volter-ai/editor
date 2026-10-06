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
 */
const listeners = new Set<() => void>();
const clockListeners = new Set<() => void>();
const playing = new Set<string>();
const stops = new Map<string, (escape: boolean) => void>();

/** The speeds the transport offers, slowest first (simulation seconds per real second). */
export const MODEL_PLAY_SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4];
/** The `dt` one Step hands the game: one nominal 60 Hz frame, whatever the speed. */
export const MODEL_PLAY_STEP_SECONDS = 1 / 60;

export interface ModelPlayClock {
  readonly time: number;
  readonly tick: number;
  readonly paused: boolean;
  readonly speed: number;
}
const STILL: ModelPlayClock = { time: 0, tick: 0, paused: false, speed: 1 };
/** Replaced, never mutated, so a snapshot read by `useSyncExternalStore` changes identity
 *  exactly when it changes value. */
const clocks = new Map<string, ModelPlayClock>();
/** Steps asked for while paused and not yet run; the runner takes one per drawn frame. */
const steps = new Map<string, number>();
/** Bumped by Restart; the document keys its detached copy on it (`DocumentPlayTransport`). */
const generations = new Map<string, number>();
/** Documents whose next run was begun by Restart, and so enters without the camera's blend. */
const restarted = new Set<string>();

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
  if (!value && stops.has(documentId)) { stops.get(documentId)!(false); return; }
  if (value) {
    playing.add(documentId);
    // A new run starts its clock at zero and running; the speed is the person's and stays.
    steps.delete(documentId);
    setClock(documentId, { time: 0, tick: 0, paused: false });
  } else {
    playing.delete(documentId);
    restarted.delete(documentId);
    steps.delete(documentId);
    // The clock keeps the stopped run's time and tick, so the panel still says how far it got.
    // Re-issued even unchanged, after `playing` has changed: every way a game stops (Stop,
    // Escape, a deleted script, a mode switch, an agent's `stop`) ends here, and a reader of
    // the clock alone must see the run end too.
    setClock(documentId, { paused: false });
  }
  publish();
}

export function finishModelPlay(documentId: string): void {
  stops.delete(documentId);
  setModelPlaying(documentId, false);
}

export function escapeModelPlay(documentId: string): void {
  const stop = stops.get(documentId);
  if (stop) stop(true);
  else finishModelPlay(documentId);
}

export function registerModelPlayStop(documentId: string, stop: (escape: boolean) => void): () => void {
  stops.set(documentId, stop);
  return () => { if (stops.get(documentId) === stop) stops.delete(documentId); };
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
  setClock(documentId, { time: 0, tick: 0, paused: false });
  publish();
}

/** Whether the run starting now was begun by Restart (asked once, by that run's runner). */
export function consumeModelPlayRestart(documentId: string): boolean {
  return restarted.delete(documentId);
}
