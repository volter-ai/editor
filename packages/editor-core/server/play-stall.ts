/**
 * THE ANSWER A STUCK PLAY OWES ITS CALLER.
 *
 * ## What this replaces
 *
 * Measured 2026-08-20 with `packages/editor/scripts/scale-harness`, canvas lane,
 * N=20000, four consecutive runs. `vgai play` spent its full 120s budget and was
 * refused with
 *
 *     Command timed out — the tab is present (last heartbeat 0.8s ago) and
 *     did not respond.
 *
 * and then `screenshot` (15s) and `stop` (30s) were refused with that same
 * sentence. Three silent timeouts in a row, and every reader — `vgai status`,
 * the tab table, the journal — described a healthy session, because the
 * heartbeat is a WORKER and kept beating at 0.4s while the page's main thread
 * sat inside one 199.5-second synchronous block.
 *
 * The sentence was true and useless. It named the tab (fine), the beat (fine),
 * and nothing about the eight-step boot that was actually stuck.
 *
 * ## The rule
 *
 * The page publishes each play-boot phase BEFORE that phase's work starts
 * (`src/play-boot-phase.ts`), on the control channel, as its own tiny message —
 * never inside the state snapshot, which is the expensive derivation a wedged
 * page cannot produce. So the server always holds the phase the page was
 * ENTERING when it went quiet, and this module turns that into the refusal, the
 * journal row and the console entry.
 *
 * Pure and clock-injected: no I/O, no globals. `test/play-stall.test.ts` drives
 * every branch directly.
 */

/** What the page last said about its play boot, as the server holds it. */
export interface PlayPhaseRecord {
  readonly source?: string;
  readonly sequence?: number;
  /** The phase being entered, or `null` once the boot settled either way. */
  readonly phase: string | null;
  /** Page clock: when it entered that phase. Never used for arithmetic — the
   *  two clocks are not the same clock — only carried for the record. */
  readonly at: number;
  /** The play attempt's ordinal on the page. */
  readonly run: number;
  /** SERVER clock: when this report landed. Every age below is measured from
   *  here, because it is the only timestamp both parties agree on. */
  readonly receivedAt: number;
}

/** The page socket and heartbeat race. A delayed copy must not resurrect a
 * completed operation or reset its age. Sequence belongs to a page-load source,
 * not a wall clock; a new page may start again at one. */
export function acceptPagePhase(
  previous: PlayPhaseRecord | null, next: PlayPhaseRecord,
): PlayPhaseRecord {
  if (previous?.source !== undefined && previous.source === next.source &&
      previous.sequence !== undefined && next.sequence !== undefined &&
      next.sequence <= previous.sequence) return previous;
  return next;
}

/** Commands whose timeout is about play whether or not a boot is in flight. */
const PLAY_FAMILY = new Set(['play', 'restart', 'stop', 'pause', 'resume', 'step']);

export interface PlayStallDiagnosis {
  /** The full refusal the caller receives. */
  readonly message: string;
  /** The phase named, or `null` when no boot was in flight. */
  readonly phase: string | null;
  /** How long the page had been in it when the command expired, or `null`. */
  readonly phaseAgeMs: number | null;
}

/**
 * Compose the refusal for a relayed command that ran out of budget.
 *
 * `base` is the sentence the relay already produces (`Command timed out — the
 * tab is present (…) and did not respond.`). It is kept VERBATIM and only
 * extended: the CLI's own retry classifier matches fragments of these
 * refusals (`vgai-cli/src/play-retry.ts`), and a rewritten message would
 * silently change which failures it treats as retryable.
 */
export function playStallDiagnosis(args: {
  readonly command: unknown;
  readonly base: string;
  readonly phase: PlayPhaseRecord | null;
  readonly now: number;
}): PlayStallDiagnosis {
  const { base, phase, now } = args;
  const command = typeof args.command === 'string' ? args.command : '';
  const booting = phase !== null && phase.phase !== null;

  if (booting) {
    const ageMs = Math.max(0, now - phase.receivedAt);
    return {
      phase: phase.phase,
      phaseAgeMs: ageMs,
      message:
        `${base} The last announced unfinished work is "${phase.phase}" ` +
        `(reported ${(ageMs / 1000).toFixed(1)}s ago). This is an operation label, not a stack trace ` +
        'or proof of the cause. The heartbeat runs separately from the page. ' +
        '`volter-editor status` and the session journal carry the same observation.',
    };
  }

  if (PLAY_FAMILY.has(command)) {
    const settled = phase === null ? null : Math.max(0, now - phase.receivedAt);
    const when =
      settled === null
        ? 'this session has never reported one'
        : `the last one settled ${(settled / 1000).toFixed(1)}s ago`;
    return {
      phase: null,
      phaseAgeMs: null,
      message:
        `${base} No play boot is in flight (${when}), so the page went quiet somewhere other ` +
        'than play start — a heartbeat proves the tab, never the page.',
    };
  }

  return { phase: null, phaseAgeMs: null, message: base };
}

/**
 * The console-ledger condition text for a stalled command.
 *
 * Deliberately keyed on the PHASE and not on the elapsed time: the ledger
 * fingerprints on the message, so putting a duration in it would make every
 * occurrence a fresh condition and turn a repeating stall into a wall of
 * one-count rows — the exact dedup failure `console-ledger.ts` exists to
 * prevent, in the other direction.
 */
export function playStallConsoleMessage(command: unknown, phase: string | null): string {
  const verb = typeof command === 'string' && command.length > 0 ? command : 'a command';
  return phase === null
    ? `\`${verb}\` timed out against a beating tab whose page never answered, with no announced page work in flight.`
    : `\`${verb}\` timed out while the page was inside "${phase}".`;
}
