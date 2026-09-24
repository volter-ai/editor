/**
 * What a capture knows about ITSELF beyond its pixels — and the one place the
 * caveat sentence is spelled.
 *
 * A PNG is silent about the conditions it was taken under. Four of those
 * conditions matter, and each is already measured elsewhere in the stack.
 * Three change what the frame is worth as EVIDENCE: the editor page reports
 * `loopRecoveryFrame` when the host loop was starved and the runtime had to
 * render one deterministic tick on demand (`command-listener.ts`'s
 * `handleBridgeScreenshot`), and it reports
 * a `flatness.warning` sentence when the frame is nine-tenths one flat surface
 * (`composite-screenshot.ts`'s `measureFlatness`), and it names the CLIP a
 * frame of a recorded run belongs to (`command-listener.ts`'s
 * `screenshotRecordingNotice`). Until now these stopped at a
 * `console.warn` inside the relay transport — visible to a human watching a
 * terminal, invisible to anything that later reads the file.
 *
 * The fourth is not about the frame at all but about what taking it COST: a
 * capture written under the served project root goes through the dev server's
 * file watcher on every shot (measured ~3x slower frame rates), and the
 * out-path resolver is the only place that knows
 * (`screenshot-target.ts`'s `underWatchedProjectRoot`).
 *
 * So the transport seam carries them back as {@link CaptureNotes}, and
 * {@link describeCaptureCaveat} turns them into the ONE sentence every surface
 * says. Its two callers are the transport's own console warning and
 * `GameClient.screenshot`, which hands the composed caveat to every capture
 * listener — so the words a human reads in the terminal and the words a run
 * record carries beside the frame cannot drift apart.
 */

/** The conditions a capture was taken under, as facts. Every field is
 *  optional and absent means "not so": an ordinary frame carries no notes. */
export interface CaptureNotes {
  /** The host loop was starved, so the frame exists only because the runtime
   *  was asked for one deterministic tick. */
  readonly loopRecoveryFrame?: boolean;
  /** The page's own near-blank-frame sentence, verbatim (it owns the wording;
   *  see `composite-screenshot.ts`'s `CaptureFlatness.warning`). */
  readonly flatnessWarning?: string;
  /** The clip this frame is one frame OF — every `volter-game-editor play` records
   *  (`play-recording.ts`). Not a degradation: the still is delivered and is
   *  the right instrument for a look question. It is here because a still of a
   *  MOVING game answers a temporal question only by luck, and a reader of the
   *  persisted record has to be able to find the door that answers it. */
  readonly recordingPath?: string;
  /** The SERVED project root this capture was written under, when it was.
   *  Not a degradation of the frame — a cost of taking it; see
   *  {@link WATCHED_CAPTURE_PATH_CAVEAT}. */
  readonly watchedProjectRoot?: string;
}

/** One capture, as reported to a {@link CaptureListener} after the bytes are
 *  on disk. `caveat` is already composed — see {@link describeCaptureCaveat} —
 *  so a listener never has to know how a degraded frame is detected, only that
 *  this one is and what to say about it. */
export interface CaptureRecord {
  /** The caller's own `screenshot()` argument, label or path, unaltered. */
  readonly label: string;
  /** The absolute file the bytes landed at. */
  readonly path: string;
  /** What a reader must know about this frame, or `null` for an ordinary one. */
  readonly caveat: string | null;
}

/** Notified after every capture a `GameClient` writes. May be async — the
 *  client awaits it, so a listener that needs to read the game (to stamp the
 *  capture with where the run was standing, say) can. */
export type CaptureListener = (capture: CaptureRecord) => void | Promise<void>;

/** The loop-recovery sentence. Spelled once because it is said in two places
 *  (a live console warning and a persisted record) and a second copy is a
 *  second wording. */
/**
 * The cost of writing a capture INSIDE the served project.
 *
 * The dev server watches the project root, and its ignore list names build
 * output only — nothing about capture output — so every PNG written under the
 * root goes through the watcher. Measured cost class: ~3x slower frame rates
 * while a capture loop wrote there. Named, not fixed: where a capture goes is
 * the caller's decision, and this door's job is to stop that decision being
 * made blind.
 */
const WATCHED_CAPTURE_PATH_CAVEAT =
  'writing captures under the project root triggers the dev server’s file watcher; expect ~3× ' +
  'slower frame rates — write outside the project or to the session’s own capture dir';

const LOOP_RECOVERY_FRAME_CAVEAT =
  'LOOP-RECOVERY FRAME — the host loop was starved, so the runtime rendered one ' +
  'deterministic tick on demand. It is current, not stale; it was not produced by ordinary presentation.';

/**
 * What a reader must be told about this frame, or `null` when there is nothing
 * to tell.
 *
 * Any of them can be true at once (an on-demand recovery tick that also came
 * out near-blank, in a recorded run), and each is said — a capture that is
 * degraded twice over must not report only the first reason.
 */
export function describeCaptureCaveat(notes: CaptureNotes): string | null {
  const parts: string[] = [];
  if (notes.loopRecoveryFrame === true) parts.push(LOOP_RECOVERY_FRAME_CAVEAT);
  if (typeof notes.flatnessWarning === 'string' && notes.flatnessWarning !== '') {
    parts.push(notes.flatnessWarning);
  }
  if (typeof notes.recordingPath === 'string' && notes.recordingPath !== '') {
    parts.push(
      `ONE FRAME of a recorded run — ${notes.recordingPath} holds the whole of it. A still ` +
        'answers what it looks like; a temporal question (did the jump land) needs the clip.',
    );
  }
  if (typeof notes.watchedProjectRoot === 'string' && notes.watchedProjectRoot !== '') {
    parts.push(`${WATCHED_CAPTURE_PATH_CAVEAT} (${notes.watchedProjectRoot}).`);
  }
  return parts.length === 0 ? null : parts.join(' ');
}
