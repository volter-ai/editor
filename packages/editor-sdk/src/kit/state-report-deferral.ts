/**
 * Keeping the editor's status snapshot off the interaction critical path.
 *
 * `collectState` (command-listener.ts) is not a read — it RE-DERIVES the whole
 * status surface. Two families dominate, and both scale with the size of the
 * project rather than with the size of the change:
 *
 *   - the hierarchy walk behind `entities`/`entityCount`, and
 *   - the capability GRADING facets (`rootCoverage`, `systemCoverage`,
 *     `projectCoverage`, `authoringCoverage`, `ontologyInvariants`), each
 *     documented as re-derived on read; `rootCoverage`'s conformance probe
 *     walks the hierarchy AGAIN, once per mounted root, allocating a receipt
 *     object and a formatted sentence per node.
 *
 * Measured 2026-08-19 through the session journal on `examples/first-person`
 * in play mode, 251 hierarchy nodes:
 *
 *     collectState total 76ms  =  rootCoverage 30ms
 *                              +  2 x hierarchy walk 23ms
 *     JSON.stringify of the 41KB result: 0.0ms.  Sending it: 0.1ms.
 *
 * So none of the cost is serialization or transport; all of it is derivation,
 * and it is superlinear in node count (56 nodes: 1.5ms per walk; 251 nodes:
 * 23ms). On a game-heavy project the same function measured 1.2-1.3s of
 * main-thread block.
 *
 * That would be survivable if it ran rarely. It does not: `reportLatestState`
 * is wired to the store's own change notification, to restart-required, to the
 * ingest capture wait, to the adapter load, to every command completion, and
 * to focus/blur/visibilitychange. So the whole derivation ran on every
 * selection click and several times over during a mount — which is why the
 * defect reads as "the editor is slow to touch" while an idle tab is fine.
 *
 * The fix is not to derive less truth, it is to derive it OFF the critical
 * path: an interaction reports immediately with the cheap fields fresh and the
 * derived families reused from the last full snapshot, and schedules ONE
 * deferred full collect that makes them current again. `vgai status` readers
 * are never handed a snapshot older than that deferral, and the snapshot
 * already carries its own age.
 */

/**
 * How long the deferred full collect may wait for an idle moment before the
 * browser runs it anyway. Short enough that "current shortly after the change"
 * stays true for a `vgai status` reader; long enough that the interaction that
 * triggered it paints first, which is the entire point.
 */
export const DEFERRED_FULL_REPORT_TIMEOUT_MS = 500;

interface IdleCallbackHost {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Run `report` off the critical path — at the next idle moment, or when
 * {@link DEFERRED_FULL_REPORT_TIMEOUT_MS} expires, whichever comes first.
 * Returns the canceller the caller's teardown must run.
 *
 * Falls back to a task (`setTimeout`) where `requestIdleCallback` is missing
 * (Safari before 17, and jsdom): still off the triggering handler's own frame,
 * which is what makes the interaction cheap.
 */
export function scheduleDeferredFullReport(report: () => void): () => void {
  const host = globalThis as IdleCallbackHost;
  const idle = host.requestIdleCallback;
  if (typeof idle === 'function') {
    const handle = idle.call(globalThis, report, { timeout: DEFERRED_FULL_REPORT_TIMEOUT_MS });
    return () => host.cancelIdleCallback?.call(globalThis, handle);
  }
  const handle = setTimeout(report, 0);
  return () => clearTimeout(handle);
}
