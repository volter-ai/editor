/**
 * The STEP verbs of the session wire (`@vgai/editor-sdk/commands`, a
 * `workspace.command` contribution): `game-eval`, the module lane behind
 * `vgai eval`'s `game.run(...)`, and `page-script`, the in-page Playwright
 * shim behind `page(...)`. Both carry a step function's own SOURCE over the
 * wire and reconstruct it here — closures do not survive the trip — so both
 * are gated on a live game surface (a play session or an ingest mount) and
 * rooted at the game container, never editor chrome.
 *
 * The module lane's page-side door (`window.__vgaiGameEval`) and the two
 * providers it needs are installed when this module loads, which is when the
 * verbs themselves become available: one handler, two doors, registered
 * together.
 *
 * Play mode, the module resolver and the shim are the game skew's own
 * modules, still housed in the editor until Play leaves the host (WORK.md
 * §The workbench, G); they are reached through the `@editor/*` alias the
 * editor's Vite serves to every contribution, and become this package's own
 * imports when they move. Nothing here is host API.
 */

import { createGameModuleResolver, setFocusedInstanceProvider } from '@editor/game-module-access';
import { createPageShim, PageShimUnsupportedError } from '@editor/playwright-shim';
import type {
  CommandContribution,
  EditorCommandMessage,
  EditorCommandResult,
} from '@vgai/editor-sdk/commands';
import { notPlayingResult } from '../src/command-results';
import { isIngestActive } from '../src/ingest/active-ingest';
import { focusedInstanceId, getGameContainer, isPlayModeActive } from '../src/play/play-mode';

export const point = 'workspace.command';

/**
 * `game-eval` relay op — THE MODULE LANE. Reconstructs a step function's
 * source in the editor page (same wire contract as `page-script`: closures do
 * not survive) and runs it against a scope of { page, modules, instanceId } —
 * `modules(path)` importing the RUNNING mount's own module instances
 * (`game-module-access.ts`). This is what makes `vgai eval` able to touch the
 * game's exported modules directly, in the browser, with no registry: the
 * step is literal JS against the game's real functions.
 *
 * The result must survive the wire: anything unserializable is refused BY
 * NAME rather than mangled — return plain data, not live objects.
 */
/**
 * The Playwright-host door to the SAME handler: a real `page.evaluate` cannot
 * reach relay ops, so the hook exposes `game-eval` inside the page itself.
 * One handler, two doors — the lanes cannot drift.
 */
declare global {
  interface Window {
    __vgaiGameEval?: (src: string, instance?: string) => Promise<unknown>;
  }
}
if (typeof window !== 'undefined') {
  setFocusedInstanceProvider(focusedInstanceId);
  window.__vgaiGameEval = async (src: string, instance?: string) => {
    const result = await handleGameEval({
      type: 'game-eval',
      src,
      ...(instance === undefined ? {} : { instance }),
    } as unknown as EditorCommandMessage);
    if (!result.ok) throw new Error(result.error ?? 'game-eval failed');
    return (result.data as { result?: unknown } | undefined)?.result ?? null;
  };
}

async function handleGameEval(cmd: EditorCommandMessage): Promise<EditorCommandResult> {
  if (!isPlayModeActive() && !isIngestActive()) return notPlayingResult();
  const src = cmd['src'];
  if (typeof src !== 'string') {
    return { ok: false, error: 'game-eval requires a string "src" (the step\'s toString())' };
  }
  const container = getGameContainer();
  if (!container) {
    return {
      ok: false,
      error: 'game-eval: no play-mode game container is mounted yet',
      data: { code: 'GAME_EVAL_ERROR' },
    };
  }
  const instanceRaw = cmd['instance'];
  const instanceId = typeof instanceRaw === 'string' ? instanceRaw : undefined;
  let step: (scope: unknown) => unknown;
  try {
    step = new Function('scope', `return (${src})(scope)`) as (scope: unknown) => unknown;
  } catch (err) {
    return {
      ok: false,
      error: `game-eval: failed to reconstruct the step function from source — ${
        err instanceof Error ? err.message : String(err)
      }`,
      data: { code: 'GAME_EVAL_ERROR' },
    };
  }
  const scope = {
    page: createPageShim(container),
    modules: createGameModuleResolver(instanceId),
    instanceId: instanceId ?? focusedInstanceId(),
  };
  try {
    const result = await step(scope);
    const value = result === undefined ? null : result;
    try {
      JSON.stringify(value);
    } catch {
      return {
        ok: false,
        error:
          'game-eval: the step returned an unserializable value ' +
          `(${Object.prototype.toString.call(value)}) — return plain data (numbers, strings, ` +
          'arrays, plain objects), not live module objects.',
        data: { code: 'GAME_EVAL_UNSERIALIZABLE' },
      };
    }
    return { ok: true, data: { result: value } };
  } catch (err) {
    return {
      ok: false,
      error: `game-eval step failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      data: { code: 'GAME_EVAL_ERROR' },
    };
  }
}

/**
 * `page-script` relay op handler — "the playwright shim in the editor
 * page + script-mode wire op". Standalone command (like `bridge-screenshot`,
 * its sibling in `bridge.command.ts`),
 * NOT a `bridge-call` method: this is editor-page UI automation, not the
 * game-debug seam, so it deliberately stays outside `dispatchBridgeMethod`'s
 * switch — the bridge↔wire parity gate (`bridge-wire-parity.test.ts`) only
 * walks THAT switch, and must never need to know about this op.
 *
 * `cmd['src']` is a UI-automation step's `Function.prototype.toString()`
 * source (`@vgai/live`'s `RelayTransport.runPageScript` — see that file's
 * doc comment for the client-facing half of the wire contract). Reconstructed
 * here with `new Function` and run against a fresh `createPageShim` rooted at
 * the SAME game container `bridge-screenshot`'s composite capture uses
 * (`getGameContainer` — never editor chrome). `PageShimUnsupportedError`
 * (thrown the instant the step touches an unimplemented `Page`/`Locator`
 * member) is distinguished from any other step failure so a caller can tell
 * "this shim doesn't support that yet" apart from "the step's own assertion
 * failed" — both are structured failures, never a hang or a silent
 * mis-report.
 */
async function handlePageScript(cmd: EditorCommandMessage): Promise<EditorCommandResult> {
  // An ingest mount IS the live game surface even though it never creates a
  // first-party `play-mode.ts` session. Keep the Playwright-style page door on
  // the same reachability rule as bridge calls/screenshots: a real ingest
  // container is sufficient, while the genuinely-unmounted case still
  // refuses below. Without this, `vgai play` could start an ingested game and
  // `game.commands()` would work, yet `page(...)` answered "not in play mode"
  // against that very same visible game.
  if (!isPlayModeActive() && !isIngestActive()) return notPlayingResult();
  const src = cmd['src'];
  if (typeof src !== 'string') {
    return { ok: false, error: 'page-script requires a string "src" (the step\'s toString())' };
  }
  const container = getGameContainer();
  if (!container) {
    return {
      ok: false,
      error: 'page-script: no play-mode game container is mounted yet',
      data: { code: 'PAGE_SCRIPT_ERROR' },
    };
  }
  let step: (page: unknown) => unknown;
  try {
    // Reconstructing a wire-carried step's source is the documented wire
    // contract (decision 2) — the same limitation class as
    // Playwright's own evaluate serialization: closures over anything
    // outside the step's own body do NOT survive the trip.
    step = new Function('page', `return (${src})(page)`) as (page: unknown) => unknown;
  } catch (err) {
    return {
      ok: false,
      error: `page-script: failed to reconstruct the step function from source — ${
        err instanceof Error ? err.message : String(err)
      }`,
      data: { code: 'PAGE_SCRIPT_ERROR' },
    };
  }
  const page = createPageShim(container);
  try {
    const result = await step(page);
    return { ok: true, data: { result: result === undefined ? null : result } };
  } catch (err) {
    if (err instanceof PageShimUnsupportedError) {
      return {
        ok: false,
        error: err.message,
        data: { code: 'PAGE_SHIM_UNSUPPORTED', member: err.member, supported: [...err.supported] },
      };
    }
    return {
      ok: false,
      error: `page-script: step threw — ${err instanceof Error ? err.message : String(err)}`,
      data: { code: 'PAGE_SCRIPT_ERROR' },
    };
  }
}

export const commands: CommandContribution['commands'] = {
  // THE MODULE LANE: an in-page step over { page, modules, instanceId }.
  'game-eval': { timeoutMs: 60_000, derivedRefresh: 'always', handle: handleGameEval },
  'page-script': { timeoutMs: 60_000, derivedRefresh: 'always', handle: handlePageScript },
};
