/**
 * READINESS, declared vs measured — and the three sentences a failed mount is
 * allowed to say (M29).
 *
 * ARCHITECTURE-CORE §The editor protocol, "Zero inference": the system answers
 * a question by reading a DECLARATION, by walking ground truth, or by
 * diagnosing declared-vs-measured drift — and a guess at a fact the game's
 * author could have stated is a defect whose fix is a declaration slot. "Is
 * this game ready?" was the guess: the host polled draw counts, watched a
 * scene's child count stop growing, and waited fixed windows.
 *
 * The declaration is `window.vgaiGame.ready` ({@link VgaiGameReady} in
 * `game-contract.ts`) for a self-booting game, and MOUNT COMPLETION for a
 * host-mounted (exported-composition) root — the host runs that mount, so it
 * answers the question without the game writing a line. The measured waits
 * stay for everything else; what they stop being is silent, which is what
 * {@link ReadinessSource} is for.
 *
 * M29's defect: a game that threw during its own async init reported as
 * "rendered no capturable frame within timeout" — the wait's expiry, which is a
 * CONSEQUENCE of the crash, presented as the blocker. It misdirected two sweep
 * measurements. {@link describeMountFailure} is the fix: three different
 * sentences pointing at three different blockers, chosen from facts the host
 * already has (did the game declare readiness; did anything throw during its
 * boot window).
 */

/**
 * WHERE a readiness answer came from.
 *
 * `declared` — the game (or, for a host-mounted root, the host's own completed
 * mount) STATED it. `measured` — nobody stated it, so a host-side wait stood in.
 * Both are legitimate; only one of them is a fact about the game, which is why
 * every reporting surface carries this field instead of presenting the two as
 * the same answer.
 */
export type ReadinessSource = 'declared' | 'measured';

/**
 * The three blockers a mount that never reached a live world can have. Carried
 * on the report so a reader (status bar, `vgai status`, the Console line) can
 * branch without re-parsing the sentence.
 */
export type MountFailureKind =
  /** Something threw during the game's own boot window. Fix that first. */
  | 'crashed-before-ready'
  /** The game DECLARED `ready`, yet no capturable render arrived and nothing
   *  was thrown. (The host awaits `ready` only after the first captured
   *  render, so whether it resolved was not observed — the sentence states
   *  exactly that.) */
  | 'declared-ready-never-resolved'
  /** No declaration at all: the measured fallback wait is what expired. */
  | 'no-readiness-declaration';

export interface MountFailureDescription {
  readonly kind: MountFailureKind;
  /** The one sentence every surface prints. */
  readonly message: string;
  /** The errors thrown during the boot window, ATTACHED rather than left for
   *  the reader to correlate by timestamp in a console they may not have open.
   *  Empty for the two non-crash kinds. */
  readonly pageErrors: readonly string[];
}

export interface MountFailureInput {
  /** The game's manifest/root id, as every other report names it. */
  readonly gameId: string;
  /** The capture window that expired, in VISIBLE ms. */
  readonly timeoutMs: number;
  /** Where the readiness answer would have come from — see {@link ReadinessSource}. */
  readonly readinessSource: ReadinessSource;
  /** Errors observed during the game's boot window, oldest first. */
  readonly pageErrors: readonly string[];
  /** The underlying rejection's own text, kept verbatim at the end. */
  readonly cause: string;
}

/** The clause every kind shares: hidden time was not charged to the game, so
 *  nobody reads this as a backgrounded-tab failure (it was, twice). */
const VISIBLE_TIME_CLAUSE =
  'Time the tab spent hidden was NOT counted against it, so this is not a backgrounded-tab ' +
  'failure.';

/**
 * Which of the three sentences this failure gets.
 *
 * A CRASH wins over everything: if something threw during the boot window,
 * every other reading is downstream of it, and the old single sentence's whole
 * defect was reporting the downstream one. After that the split is the
 * declaration itself — a game that stated `ready` and never resolved it has a
 * different blocker (and a different owner) from a game that stated nothing and
 * outlasted a host-side guess.
 */
export function describeMountFailure(input: MountFailureInput): MountFailureDescription {
  const { gameId, timeoutMs, readinessSource, pageErrors, cause } = input;
  const budget = `${timeoutMs}ms of VISIBLE time`;

  if (pageErrors.length > 0) {
    const listed = pageErrors.map((error) => `  · ${error}`).join('\n');
    return {
      kind: 'crashed-before-ready',
      pageErrors: [...pageErrors],
      message:
        `Ingest game "${gameId}" CRASHED BEFORE IT BECAME READY: ${pageErrors.length} error(s) ` +
        `were thrown while it was booting, and the capture window (${budget}) then expired. ` +
        'The expiry is a CONSEQUENCE of the crash, not the blocker — fix these first:\n' +
        `${listed}\n` +
        `${VISIBLE_TIME_CLAUSE} Underlying wait: ${cause}`,
    };
  }

  if (readinessSource === 'declared') {
    return {
      kind: 'declared-ready-never-resolved',
      pageErrors: [],
      message:
        `Ingest game "${gameId}" DECLARED A READINESS SIGNAL AND STILL PRODUCED NO CAPTURABLE ` +
        `RENDER: it stated \`window.vgaiGame.ready\`, but the capture window (${budget}) expired ` +
        "before the editor's three saw a render, and nothing was thrown. (The host awaits " +
        '`ready` only after the first captured render, so whether it resolved was not observed.) ' +
        "Nothing is wrong with the host's wait — the likely blocker is whatever the game's own " +
        'boot is waiting on (an asset fetch, a socket, a user gesture the editor never makes), ' +
        'or a game that draws through a renderer the capture trap cannot see. ' +
        `${VISIBLE_TIME_CLAUSE} Underlying wait: ${cause}`,
    };
  }

  return {
    kind: 'no-readiness-declaration',
    pageErrors: [],
    message:
      `Ingest game "${gameId}" DECLARED NO READINESS SIGNAL, and the MEASURED fallback wait ` +
      `expired: the editor's three saw no render within ${budget} and nothing was thrown, so ` +
      'the host has no way to tell a slow boot from a stopped one. Recovery: declare ' +
      '`window.vgaiGame.ready` (a promise resolved when the game has built its world) so this ' +
      'question stops being measured — or, if the game genuinely needs longer on screen, raise ' +
      `"captureTimeoutMs" in the root's ingest block. ${VISIBLE_TIME_CLAUSE} ` +
      `Underlying wait: ${cause}`,
  };
}
