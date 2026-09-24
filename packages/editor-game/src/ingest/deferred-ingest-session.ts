/**
 * THE SESSION FACT for a deferred ingest Play run.
 *
 * Kept in a dependency-free leaf because both the deferred mount orchestrator
 * and the editor-wide mode predicate must read it. Putting the latch in either
 * owner creates a cycle through `ingest-play-control` or `play-mode` and, more
 * importantly, lets one consumer silently forget this is a Play SESSION even
 * though it is not a first-party `play-mode.ts` session.
 */

let active = false;

export function deferredIngestPlayActive(): boolean {
  return active;
}

export function beginDeferredIngestPlaySession(): void {
  active = true;
}

export function endDeferredIngestPlaySession(): void {
  active = false;
}
