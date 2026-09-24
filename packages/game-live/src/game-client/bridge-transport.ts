/**
 * The transport seam `GameClient` (`client.ts`) drives (#140). Two
 * implementations answer the identical contract below:
 *  - `PageTransport` (`client.ts`) — Playwright's `page.evaluate` against
 *    `window.__vgai`, for a standalone game page the caller drives itself.
 *  - `RelayTransport` (`relay-transport.ts`) — the editor dev-server's
 *    session wire (`POST /__editor/command`, `bridge-call`/
 *    `bridge-screenshot` ops), driving the SAME live session a human already
 *    has open, with no new browser/window/vite instance.
 *
 * `wait-for.ts`/`events-matcher.ts`/`failure-block.ts`, and every method
 * body on `GameClient` itself, are written against this interface only —
 * none of them may know or care which transport is underneath (load-bearing
 * for a planned default flip to relay-when-a-live-session-exists, and for a
 * future one-shot REPL client reusing the same relay op). Deliberately NO
 * `@playwright/test` import here, nor in `relay-transport.ts` — only
 * `client.ts` is allowed to touch a live `Page` (see its own module doc).
 */

import type { CaptureNotes } from './capture-notes.js';

/** Result of one generic bridge-method call — thrown page/relay-side errors
 *  never cross either transport boundary AS themselves (Node only keeps
 *  `.message` across `page.evaluate`; HTTP/JSON strips everything but what
 *  the server explicitly serializes), so both transports catch and report
 *  `code`/`data` explicitly, and `GameClient.unwrap` reconstructs a
 *  `SessionError` from that. */
export interface BridgeCallOutcome {
  ok: boolean;
  result?: unknown;
  error?: { code: string | undefined; message: string; data?: unknown };
}

export interface BridgeTransport {
  /** Sync-style bridge call (state/stateAll/providers/commands/events/
   *  snapshot/runTicks/input.*) — "sync-style" describes the PAGE side's own
   *  call, not this method, which is always async across either wire. */
  call(method: string, callArgs: unknown[]): Promise<BridgeCallOutcome>;
  /** Async bridge call — `invoke` (debug commands may themselves be async). */
  callAsync(method: string, callArgs: unknown[]): Promise<BridgeCallOutcome>;
  /** Whether the surface showing the game is currently hidden from the user
   *  (`document.hidden` on the page transport) — feeds `HiddenRecoveryDriver`. */
  isHidden(): Promise<boolean>;
  /** Bring the surface showing the game to the foreground. */
  bringToFront(): Promise<void>;
  /** Capture a screenshot to `path` (PNG), returning whatever the surface knows
   *  about the conditions the frame was taken under ({@link CaptureNotes} — a
   *  hidden surface, a near-blank frame). `{}` is the honest answer for a
   *  transport that cannot observe either. A transport that cannot support the
   *  capture at all should reject with a descriptive error rather than write a
   *  blank/corrupt file. */
  screenshot(path: string): Promise<CaptureNotes>;
  /**
   * One dialect, full capability — runs a UI-automation step
   * written as a literal `async (page) => {...}` (`GameClient.page()`,
   * `client.ts`). `src` is `step.toString()`; `step` is the ORIGINAL
   * function, wrapped so its own parameter type is erased to `unknown` (only
   * `client.ts` — the one file allowed to touch a real `Page` — ever names
   * the `Page` type itself).
   *
   * The two implementations differ ON PURPOSE, and that difference is the
   * load-bearing honesty boundary this method exists to name:
   *  - `PageTransport` (`client.ts`) calls `step` DIRECTLY against the real
   *    Playwright `Page` — no serialization, so closures over outer Node
   *    values work here exactly like any ordinary `page.evaluate` callback.
   *  - `RelayTransport` (`relay-transport.ts`) ships `src` over the wire and
   *    reconstructs it with `new Function` INSIDE the editor page, against
   *    an in-page shim (`packages/editor/src/playwright-shim.ts`) — closure
   *    capture over anything outside the step's own body does NOT survive
   *    that trip (the same limitation class as Playwright's own `evaluate`
   *    serialization).
   *
   * Because the two transports differ this way, specs meant to pass
   * unmodified under both hosts must be written as though ALWAYS
   * serialized — inline every value the step needs.
   */
  runPageScript(src: string, step: (page: unknown) => unknown): Promise<BridgeCallOutcome>;
  /**
   * THE MODULE LANE — run a step INSIDE the editor page against
   * `{ page, modules, instanceId }`, where `modules(path)` imports the
   * RUNNING mount's own instance of a project module (never a phantom
   * second copy). Same serialization contract as `runPageScript`: the
   * step's source travels as text, closures do not survive, and the return
   * value must be plain data. `instance` scopes multi-instance sessions.
   */
  runGameScript(
    src: string,
    step: (scope: unknown) => unknown,
    instance?: string,
  ): Promise<BridgeCallOutcome>;
  /**
   * P20 — reload the document showing the game, resolving only once the page
   * is BACK and taking commands again.
   *
   * Deliberately not expressible as a `runPageScript` step, which is why it
   * is on this interface at all: a step that calls `location.reload()` kills
   * the channel its own acknowledgement would travel on, so the caller's
   * promise resolves on a thrown/timed-out send and says nothing about
   * whether a page came back. Each transport therefore owns its own honest
   * completion signal — Playwright's real `page.reload()` on the page
   * transport, a new document load plus a working command round trip on the
   * relay.
   *
   * This exists because it was MISSING: P20's recovery for stale asset bytes
   * is a full document reload, and the only way to spell it through
   * `volter-game-editor eval` was `page(p => p.evaluate(() => location.reload()))` — which
   * both fails outside play mode and resolves on a send, not on a reload.
   */
  reloadPage(): Promise<void>;
}
