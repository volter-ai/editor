/**
 * IS THIS REJECTION A CANCELLATION? — the one predicate, shared by the two
 * page-level `unhandledrejection` listeners this editor installs
 * (`editor-presence.ts`'s boot reporter and `editor-console.ts`'s
 * session-lifetime capture).
 *
 * ## Why this is not "exempting a source"
 *
 * The recorded doctrine at `installEditorConsoleCapture` is that SEVERITY
 * decides what reaches the ledger and never SOURCE, "because exempting a
 * source would teach the gate to find less". This is not that. A cancellation
 * is not a low-severity error, it is the platform's word for *an operation
 * that was asked to stop and did* — the same judgement the workbench makes
 * about its own (`onUnexpectedError` returns early on `isCancellationError`)
 * and the same one the Fetch and Streams specs make (`AbortError`). It is
 * applied identically to OUR rejections and to anyone else's: a vgai fetch
 * abandoned because the document moved on is exactly as much of a non-event.
 *
 * ## What made it necessary
 *
 * MEASURED 2026-09-19, the Code-OSS frame's blind walk, beat 9: a
 * `--template game` scaffold reported
 * `[runtime] editor app failed to start: Canceled: Canceled` while its editor
 * was running fine. Under the frame the page is a WORKBENCH, and a workbench
 * raises `CancellationError` (`name === 'Canceled'`) whenever a quick input is
 * dismissed or a search is superseded — none of which any page-level listener
 * can attribute, because a rejection carries no author. The ledger spans two
 * codebases there (docs/CODE-OSS.md, "The console ledger now spans two
 * codebases"), and this is the one class of line that can be ruled on without
 * asking WHOSE it is.
 *
 * ## Its own file, deliberately
 *
 * `editor-presence.ts` is the pre-React bootstrap module and is
 * dependency-light on purpose (its own comments say so); importing the console
 * from it would pull the console's whole closure into the page's first script.
 * A five-line predicate copied into both is the duplication this codebase
 * treats as a defect, so it is one module with no imports of its own.
 */

/**
 * True when a rejection reason means "this was cancelled", by any of the three
 * spellings in play on our page:
 *
 *  - VS Code's `CancellationError`, whose constructor sets
 *    `name = message = 'Canceled'`;
 *  - the platform's `AbortError` — a `DOMException` from `AbortSignal`, and
 *    what `fetch` rejects with when its signal fires;
 *  - the older `AbortError` shape any library may throw as a plain `Error`.
 *
 * Deliberately NOT a message match: a message is prose and drifts, while these
 * names are contract.
 */
export function isCancellationReason(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null) return false;
  const name = (reason as { name?: unknown }).name;
  return name === 'Canceled' || name === 'CancellationError' || name === 'AbortError';
}
