/**
 * `bridge-call` — the handler behind the verb, moved out of the editor's
 * `command-listener.ts` with it (WORK.md §The workbench). The method table it
 * dispatches through is `./dispatch.ts`; play mode, the ingest latch and the
 * editor console are reached through the `@editor/*` alias until those
 * modules move too. Nothing here is host API.
 */

import type { EditorCommandMessage, EditorCommandResult } from '@vgai/editor-sdk/commands';
import { notPlayingResult, structuredErrorResult } from '../command-results';
import { isIngestActive } from '../ingest/active-ingest';
import { isPlayModeActive } from '../play/play-mode';
import { dispatchBridgeMethod, hasLiveDebugPlane } from './dispatch';

/** `bridge-call` relay op handler — an unreachable debug seam is the one
 *  precondition checked up front (mirrors every other debug-seam verb of
 *  this package); everything else is `dispatchBridgeMethod`'s own structured
 *  failure, caught here and shipped back via `structuredErrorResult` so
 *  `code`/`data` survive the relay round trip byte-equivalent to the
 *  page-transport's `unwrap()` path (`packages/vgai-live/src/game-client/client.ts`). */
export async function handleBridgeCall(cmd: EditorCommandMessage): Promise<EditorCommandResult> {
  // The precondition is "no plane at all", not "not playing" — see
  // `hasLiveDebugPlane`. The per-method preconditions inside
  // `dispatchBridgeMethod` are unchanged and still refuse honestly: the
  // run-shaped methods (`runTicks`, `input.*`, `holdFor`) resolve through
  // `getPlayRuntimeAccess()`, which is null outside play, so they answer
  // `RUN_TICKS_UNAVAILABLE`/`DEBUG_INPUT_UNAVAILABLE` rather than pretending
  // the still edit world can be driven.
  if (!isPlayModeActive() && !hasLiveDebugPlane()) {
    // A LIVE INGEST that publishes no plane is a third state, and answering it
    // with "not in play mode" sends the reader to `vgai play` over a game that
    // is already running and visible. MEASURED on the `flappy` canvas ingest:
    // `game.waitSimTime(...)` refused with the play sentence while the mount's
    // own play state read `playing`. The mount is what is missing a plane, so
    // the refusal says so — and deliberately stays a REFUSAL, because the
    // alternative (letting the call through to answer `[]`) would report "this
    // game registered no commands", which is a different and equally false
    // claim.
    return isIngestActive()
      ? {
          ok: false,
          error:
            'this ingest mount is live, but it publishes no debug plane — the mount installs no ' +
            'SystemAdapters.debug, so there is nothing to enumerate, read or drive through the ' +
            'game seam. Starting play will not change that; the game itself must declare the ' +
            'vgai game contract (or carry a contract shim beside it) for these calls to have an ' +
            'answer.',
        }
      : notPlayingResult();
  }
  const method = cmd['method'] as string;
  const callArgs = (cmd['callArgs'] as unknown[] | undefined) ?? [];
  try {
    const instance = cmd['instance'] as string | undefined;
    const result = await dispatchBridgeMethod(method, callArgs, instance);
    return { ok: true, data: { result } };
  } catch (err) {
    return structuredErrorResult(err);
  }
}
