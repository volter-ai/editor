/**
 * POLL UNTIL A LIVE PREDICATE HOLDS — the one wait the editor's async doors
 * share, and the one place its cadence is spelled.
 *
 * It lived private in `editor-view-presentation.ts` while the presenter was
 * the only module that addressed a document. Now that each document family
 * answers its own address (`document-open-registry.ts`), the families do the
 * waiting their own addresses need — a table entry that arrives on a later
 * adapter resolution, a contribution that registers after the first
 * discovery pass — so the helper is shared rather than duplicated four times.
 *
 * NOT a general scheduling utility: it polls, which is what a registry with no
 * per-entry subscription leaves you. Where a seam DOES publish changes
 * (`subscribeToolContributions`, `subscribeProjectAdapter`), subscribe to it.
 */

/**
 * How long an EXPLICIT address waits for the thing it names. A view link, a
 * restored layout and an agent's `present` are all durable intent, so a
 * document that is merely late must still land; the window is bounded because
 * "it is not coming" has to be sayable.
 */
export const DOCUMENT_REGISTRATION_TIMEOUT_MS = 10_000;

/** `true` once `predicate()` holds, `false` if `timeoutMs` elapses first. */
export async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  if (predicate()) return true;
  const started = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) resolve(true);
      else if (performance.now() - started >= timeoutMs) resolve(false);
      else setTimeout(tick, 25);
    };
    setTimeout(tick, 0);
  });
}
