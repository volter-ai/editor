import type { SessionFailureData } from './failure-block.js';

/**
 * Machine-readable error codes this client throws. `INPUT_GATED` is the same
 * frozen token `@vgai/sdk`'s input operations declare, so a caller classifies
 * a gated actuation identically whichever door it came through. `WAIT_FOR_*`
 * and `EVENTS_EXPECT_FAILED` are this client's own extension of the same
 * "errors carry machine-readable `code` fields" rule: nothing in the codebase
 * may identify a failure by parsing message prose, so an assertion failure
 * gets a code too.
 */
export const SESSION_ERROR_CODES = {
  INPUT_GATED: 'INPUT_GATED',
  WAIT_FOR_INVALID_BUDGET: 'WAIT_FOR_INVALID_BUDGET',
  WAIT_FOR_TIMEOUT: 'WAIT_FOR_TIMEOUT',
  EVENTS_EXPECT_FAILED: 'EVENTS_EXPECT_FAILED',
} as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[keyof typeof SESSION_ERROR_CODES];

/**
 * Base error for this client. `code` is always machine-readable; `data` (if
 * any) is structured, never prose-only. Bridge-surfaced errors (unknown
 * provider/command/action names) are re-thrown as this class carrying the
 * bridge's own `code`/`data` verbatim — see `client.ts`'s `invokeBridge`.
 */
export class SessionError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.data = data;
  }
}

/** A `delivered:false` virtual-input actuation fails loudly and immediately
 *  (Task 3.2 item: "game.input hold-tap-set"). */
export function inputGatedError(action: string, reason: string | undefined): SessionError {
  return new SessionError(
    SESSION_ERROR_CODES.INPUT_GATED,
    `INPUT_GATED: action "${action}" was not delivered — ${reason ?? 'input gated'}`,
    { action, reason },
  );
}

/** The exact `code` the engine's debug registry throws for an unknown
 *  command name (`packages/game-runtime/src/runtime/debug-registry.ts`) — not one
 *  of this client's OWN `SESSION_ERROR_CODES` above (it originates on the
 *  page side and crosses the bridge verbatim via `client.ts`'s `unwrap`),
 *  named here so `appendWarmSessionHint` below doesn't compare against a
 *  bare string literal. */
const DEBUG_COMMAND_NOT_REGISTERED_CODE = 'DEBUG_COMMAND_NOT_REGISTERED';

/** Cheapest honest fix for a blind-validation finding: a run against a WARM
 *  game server (one already up before this client attached) gives a
 *  `DEBUG_COMMAND_NOT_REGISTERED` failure an extra way to be true besides
 *  "this command was never registered" — the agent may have added the command
 *  to the game's OWN code AFTER the warm server already booted, so the running
 *  server simply predates it. Without a live page handle this client can't
 *  tell the two apart either, so the honest move is naming the possibility,
 *  not guessing. Appended ONLY for that exact (code, warm) combination — never
 *  on a fresh boot, and never for any other error code, so an ordinary "you
 *  never wrote this command" failure stays exactly as terse as before. Pure so
 *  the message logic is testable without a real bridge round trip. */
export const WARM_SESSION_STALE_COMMAND_NOTE =
  'note: this run reused a warm game server — if you added this command since the server ' +
  'booted, restart the server and re-run';

export function appendWarmSessionHint(
  message: string,
  code: string | undefined,
  warm: boolean,
): string {
  if (!warm || code !== DEBUG_COMMAND_NOT_REGISTERED_CODE) return message;
  return `${message}\n${WARM_SESSION_STALE_COMMAND_NOTE}`;
}

/**
 * A `game.waitFor` / `game.input.hold` / `game.events.expect` failure. Always
 * carries the full eight-member failure block (Task 3.3) both as the
 * rendered assertion `message` and as structured `data` for a JSON reporter.
 */
export class SessionFailure extends Error {
  readonly code: string;
  readonly data: SessionFailureData;

  constructor(code: string, block: { message: string; data: SessionFailureData }) {
    super(block.message);
    this.name = 'SessionFailure';
    this.code = code;
    this.data = block.data;
  }
}
