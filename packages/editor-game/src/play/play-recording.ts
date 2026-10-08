/**
 * EVERY RELAYED PLAY RECORDS, AND AN IDLE RUN STOPS ITSELF.
 *
 * The defect this closes is not a missing feature — the recorder
 * (`gameplay-recording.ts`) already existed, behind `volter-game-editor eval
 * 'editor.recording.start()'`. The defect is that verifying a game through a
 * single screenshot answers a temporal question by luck, and a capability an
 * agent has to remember to switch on is one it does not use. So there is no
 * flag: `volter-game-editor play` starts a recording, full stop, and the evidence exists
 * whether or not anyone thought to ask for it.
 *
 * WHY THE RELAYED PLAY AND NOT THE PLAY BUTTON. The binding is in
 * `play.command.ts`'s `'play'` handler, so it covers `volter-game-editor play`, the SDK's
 * `play.start`, and nothing else. Clicking Play in the editor is a HUMAN at
 * the surface: they are the witness, the idle rule below ("no player input")
 * is meaningless for them, and auto-stopping someone who is watching a
 * cutscene would be a bug, not evidence.
 *
 * WHY AUTO-STOP AT ALL. A WebM is only readable once the recorder finalizes
 * it, so an abandoned play — the agent's turn ended, the harness died, the
 * script threw — leaves a growing file that nobody can open. The idle window
 * is what converts an abandoned run into finished evidence.
 *
 * ONLY A PERSON'S INPUT KEEPS A RUN ALIVE (2026-10-07). The idle clock used to
 * reset on every relayed session command too, on the argument that an agent
 * still driving through `volter-game-editor eval` is not idle. Measured, that
 * argument is how a recording never ends: an agent's game-eval stream keeps
 * polling for as long as anything is watching, so the clock never ran out,
 * the clip never finalized, its manifest read `'recording'` for the whole
 * session, and the tab grew to 3.2 GB at 119% CPU. Agent commands — and the
 * synthetic DOM events they dispatch (`isTrusted: false`) — no longer count.
 * An agent that needs a longer run starts play again; each run's clip is its
 * own evidence. Every recording also has a hard length cap
 * (`../host/gameplay-recording.ts`'s `GAMEPLAY_RECORDING_MAX_MS`); reaching it
 * finalizes the clip and play continues unrecorded.
 *
 * WHAT RECORDING DOES *NOT* DO: gate the still (2026-08-29). `volter-game-editor screenshot`
 * used to REFUSE while a recording was live, on the argument that a single
 * frame answers a temporal question by luck. The argument is right and the
 * refusal was still the defect: because play always records, one `volter-game-editor play`
 * killed `volter-game-editor screenshot` for the rest of the session — and "what does it
 * look like" is a question a still answers exactly, and the one the whole
 * look/modeling lane asks (measured, cold fox #3: the loop is play → look).
 * Discouraging a wrong question by making a right one impossible is not a
 * trade this product makes. The clip is unchanged and unconditional; the
 * redirect now rides ON the delivered frame
 * (`../bridge/screenshot.ts`'s `screenshotRecordingNotice`), naming the file, its
 * offset-0 wall clock, the play log, and the ten-frame bar. A capture reads
 * the canvas and composites the DOM into an offscreen image, which the
 * recorder's stream never sees, so nothing about the evidence changes.
 */

import { isRootCanvas } from '@volter/sdk/kit/composite-screenshot';
import { editorConsole } from '@volter/sdk/kit/editor-console';
import {
  GAMEPLAY_RECORDING_MAX_MS,
  type GameplayRecordingCapture,
  type GameplayRecordingStarted,
  type GameplayRecordingStartOptions,
  gameplayRecordingActive,
  startGameplayRecording,
  stopGameplayRecording,
} from '../host/gameplay-recording';
import type { AudioRecordingHandle } from '@volter/project/adapter';

/**
 * How long a play run may go with NO player input before it stops itself and
 * finalizes its recording. Session commands do not count — see the module
 * note.
 *
 * ONE constant, editor-side, and deliberately generous: the thing it must
 * never do is cut a run that a person is still playing. Two minutes is longer
 * than a human's pause at the controls, while still being short enough that
 * an abandoned run becomes a readable file inside the same working session
 * rather than the next day.
 */
export const PLAY_IDLE_AUTOSTOP_MS = 120_000;

/** How often the watchdog checks the clock. Coarse on purpose — this is a
 *  2-minute window, and a hidden tab's timers are clamped to about 1 Hz
 *  anyway, so anything finer would just be a number that is not true. */
const IDLE_POLL_MS = 5_000;

/** Discrete signals that a human is at the controls. Movement is included
 *  because for most games it IS the input; a player aiming a mouse is not
 *  idle. Every listener is passive and capture-phase, so nothing here can
 *  affect what the game or the editor sees. Only TRUSTED events count: an
 *  event a script dispatched (an agent's game-eval pressing a key) is
 *  `isTrusted: false`, and is exactly the activity that must not hold a
 *  recording open. Input injected through DevTools emulation IS trusted and
 *  is indistinguishable from a person here; the length cap is the bound for
 *  it. Gamepads have no input events, so the watchdog samples them instead
 *  ({@link gamepadEngaged}). */
const INPUT_EVENTS = [
  'keydown',
  'keyup',
  'pointerdown',
  'pointermove',
  'wheel',
  'touchstart',
  'touchmove',
  'gamepadconnected',
] as const;

/** A stick past this is a hand on it, not resting drift. */
const GAMEPAD_AXIS_DEADZONE = 0.25;

/**
 * Whether any connected gamepad is being held right now — a button down or a
 * stick off-centre. Sampled on the watchdog's poll, so a tap between two
 * samples is missed; a person playing with a pad holds something at some
 * sample inside a two-minute window. Never throws: a page whose permissions
 * policy blocks the Gamepad API simply has no pads.
 */
function gamepadEngaged(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return false;
    }
    return navigator
      .getGamepads()
      .some(
        (pad) =>
          pad !== null &&
          (pad.buttons.some((button) => button.pressed) ||
            pad.axes.some((axis) => Math.abs(axis) > GAMEPAD_AXIS_DEADZONE)),
      );
  } catch {
    return false;
  }
}

interface LivePlayRecording {
  readonly started: GameplayRecordingStarted;
  lastActivityMs: number;
  poll: number | null;
  releaseInput: (() => void) | null;
  /** Set the instant a stop begins, so the watchdog, an explicit stop, and a
   *  teardown racing each other cannot finalize the same recording twice. */
  ending: boolean;
}

let live: LivePlayRecording | null = null;

/**
 * A stop that has BEGUN but not finished.
 *
 * The recorder's own "already active" guard is released at the END of
 * `stopGameplayRecording` (it awaits the in-flight frame, the recorder's stop
 * event, and the chunk uploads). `live` is cleared at the START. So a restart —
 * `volter-game-editor play` over a running play, which tears down through `exitPlayMode`'s
 * fire-and-forget teardown and then starts the next recording — would look
 * finished to this module while the recorder was still busy, and the next start
 * would refuse. This handle is what a start waits on; without it the second
 * play of any session silently records nothing.
 */
let pendingStop: Promise<GameplayRecordingCapture | null> | null = null;
/** Which stop owns `pendingStop` — a finished stop must not clear a newer
 *  one's handle out from under a start that is waiting on it. */
let stopGeneration = 0;

/** The last recording this session finalized — the "most recent recording"
 *  a refusal points at once play is over. */
let lastFinalized: GameplayRecordingCapture | null = null;

/**
 * What ended play, in the caller's own words.
 *
 * `'idle-autostop'` is the one this module produces itself; the rest come from
 * whoever tore play down, so a reader of the journal never has to guess
 * whether a clip ended because the run ended or because nobody was there.
 */
export type PlayRecordingEndReason =
  | 'stop'
  | 'idle-autostop'
  | 'length-cap'
  | 'restart'
  | 'teardown';

/** Called by the auto-stop to end play itself. Bound once, by `play-mode.ts`,
 *  so this module never imports the play lifecycle it is driven by. */
let stopPlay: (() => void) | null = null;

export function bindPlayRecordingStop(stop: () => void): void {
  stopPlay = stop;
}

/** The editor owns this producer-side wire shape. Its exact keys are pinned by
 * `play-recording.test.ts`; the SDK independently pins its consumer shape. */
export interface PlayRecordingStatus {
  readonly path: string;
  readonly format: 'composite-webm' | 'canvas-dom';
  readonly replayPath: string | null;
  readonly startedAt: string;
  readonly rotates: boolean;
  readonly logFile: string | null;
  readonly idleAutoStopMs: number;
}

/** The live play recording's facts, or `null` when nothing is recording. */
export function livePlayRecording(): PlayRecordingStatus | null {
  if (!live || !gameplayRecordingActive()) return null;
  return {
    path: live.started.path,
    format: live.started.format,
    replayPath: live.started.replayPath,
    startedAt: live.started.startedAt,
    rotates: live.started.rotates,
    logFile: live.started.logFile,
    idleAutoStopMs: PLAY_IDLE_AUTOSTOP_MS,
  };
}

/** The most recent recording this session finished, or `null`. */
export function lastPlayRecording(): GameplayRecordingCapture | null {
  return lastFinalized;
}

/**
 * Reset the idle clock.
 *
 * "Not idle" means a PERSON at the controls: a trusted key, pointer, wheel or
 * touch event (the listeners installed below) or a held gamepad (sampled by
 * the watchdog). Relayed session commands deliberately do not reset it — see
 * the module note. The one other caller is the video export
 * (`play.command.ts`'s `bridge-recording-export`), an editor operation that
 * owns the paused run frame by frame and must not have it stopped under it.
 */
export function notePlayActivity(): void {
  if (live) live.lastActivityMs = Date.now();
}

function installInputListeners(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onInput = (event: Event): void => {
    if (event.isTrusted) notePlayActivity();
  };
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, onInput, { capture: true, passive: true });
  }
  return () => {
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, onInput, { capture: true });
    }
  };
}

/**
 * Start this play run's recording.
 *
 * Never throws: a browser that cannot record must not be a browser that cannot
 * PLAY. The failure is reported to the editor console (which is what
 * `volter-game-editor console` and every command's trailing console summary read) and play
 * continues with no clip, rather than an ack that refuses a working game
 * because its evidence path is unavailable.
 */
export async function beginPlayRecording(
  container: HTMLElement | null,
  options: {
    name?: string | null;
    audio?: AudioRecordingHandle | null;
    refreshFrame?: () => void;
    canvasFrame?: GameplayRecordingStartOptions['canvasFrame'];
  } = {},
): Promise<PlayRecordingStatus | null> {
  // A restart plays over a live run. End the old clip first — its bytes are
  // real evidence of the run that just ended, and abandoning the recorder
  // would leave the next start refusing with "already active".
  if (live) await endPlayRecording('restart');
  // …and wait out a stop ALREADY in flight (`exitPlayMode`'s fire-and-forget
  // teardown is exactly that, on every restart). See `pendingStop`.
  await pendingStop;
  if (!container) {
    editorConsole.warn(
      'Play started, but gameplay recording did not: no game surface is mounted to record.',
      'play-recording',
    );
    return null;
  }
  try {
    const started = await startGameplayRecording(container, {
      format:
        Array.from(container.querySelectorAll('canvas')).filter(isRootCanvas).length === 1
          ? 'canvas-dom'
          : 'composite-webm',
      ...(options.name ? { name: options.name } : {}),
      ...(options.audio ? { audio: options.audio } : {}),
      ...(options.refreshFrame ? { refreshFrame: options.refreshFrame } : {}),
      ...(options.canvasFrame ? { canvasFrame: options.canvasFrame } : {}),
      // The recorder's length cap ends the clip through OUR stop, so it is the
      // same finalize every other end takes (`pendingStop`, `lastFinalized`)
      // rather than a second one racing it.
      onLengthCap: () => void capPlayRecording(),
    });
    live = {
      started,
      lastActivityMs: Date.now(),
      poll: null,
      releaseInput: installInputListeners(),
      ending: false,
    };
    live.poll = window.setInterval(() => {
      const current = live;
      if (!current || current.ending) return;
      if (gamepadEngaged()) notePlayActivity();
      if (Date.now() - current.lastActivityMs < PLAY_IDLE_AUTOSTOP_MS) return;
      void autoStopIdlePlay();
    }, IDLE_POLL_MS);
    return livePlayRecording();
  } catch (error) {
    editorConsole.warn(
      `Play started, but gameplay recording did not: ${error instanceof Error ? error.message : String(error)}`,
      'play-recording',
    );
    return null;
  }
}

/**
 * Finalize this run's recording. Idempotent, and safe to call when nothing is
 * recording (the ordinary case for a play that never got one).
 */
export async function endPlayRecording(
  reason: PlayRecordingEndReason,
): Promise<GameplayRecordingCapture | null> {
  const current = live;
  if (!current || current.ending) return pendingStop;
  current.ending = true;
  if (current.poll !== null) window.clearInterval(current.poll);
  current.releaseInput?.();
  live = null;
  if (!gameplayRecordingActive()) return null;
  // Published BEFORE the first await, so a start racing this stop can find it.
  const generation = ++stopGeneration;
  const stop = (async () => {
    try {
      const capture = await stopGameplayRecording(reason);
      lastFinalized = capture;
      return capture;
    } catch (error) {
      editorConsole.warn(
        `Gameplay recording could not be finalized: ${error instanceof Error ? error.message : String(error)}`,
        'play-recording',
      );
      return null;
    } finally {
      // Only OUR stop clears the slot — a newer one may already own it.
      if (stopGeneration === generation) pendingStop = null;
    }
  })();
  pendingStop = stop;
  return stop;
}

/** One sentence, used by both the auto-stop note and the `volter-game-editor screenshot`
 *  refusal, so the two doors cannot describe the same clip differently. */
export function describeCapture(capture: GameplayRecordingCapture): string {
  const seconds = Math.round(capture.durationMs / 100) / 10;
  return (
    `${capture.path} — ${seconds}s at ${capture.effectiveFps} fps` +
    `${capture.hidden ? ' (tab hidden; that is the cadence actually captured, not the requested one)' : ''}`
  );
}

/**
 * Nobody has touched this run for the idle window: finalize the evidence and
 * stop play.
 *
 * Recording first, THEN play. A WebM is only readable once its recorder
 * finalizes it, and tearing down the game surface underneath a live composite
 * loop is how a clip ends up truncated at exactly the moment worth watching.
 *
 * This is NOT an error. An unattended run reaching its window is the designed
 * outcome — the point is that the file is closed and named — so it is a
 * console note, and the session journal carries the same fact as a
 * `play-recording` row.
 */
async function autoStopIdlePlay(): Promise<void> {
  const idleSeconds = Math.round(PLAY_IDLE_AUTOSTOP_MS / 1000);
  const capture = await endPlayRecording('idle-autostop');
  editorConsole.log(
    capture === null
      ? `Play auto-stopped after ${idleSeconds}s with no player input.`
      : `Play auto-stopped after ${idleSeconds}s with no player input. ` +
          `Recording finalized: ${describeCapture(capture)}`,
    'play-recording',
  );
  stopPlay?.();
}

/**
 * The recording reached its hard length cap (`GAMEPLAY_RECORDING_MAX_MS`):
 * finalize it and let play continue.
 *
 * Play is NOT stopped. A run still busy at the cap has a person at the
 * controls (the idle window would have closed it otherwise), and taking the
 * game away from them would be a bug; what the cap bounds is the clip and
 * everything it holds open. Like the idle stop this is the designed outcome,
 * so it is a console note, and the journal's `play-recording` row carries
 * `reason: 'length-cap'`.
 */
async function capPlayRecording(): Promise<void> {
  const minutes = Math.round(GAMEPLAY_RECORDING_MAX_MS / 60_000);
  const capture = await endPlayRecording('length-cap');
  editorConsole.log(
    capture === null
      ? `Gameplay recording stopped at its ${minutes}-minute length cap; play continues unrecorded.`
      : `Gameplay recording stopped at its ${minutes}-minute length cap; play continues unrecorded. ` +
          `Recording finalized: ${describeCapture(capture)}`,
    'play-recording',
  );
}
