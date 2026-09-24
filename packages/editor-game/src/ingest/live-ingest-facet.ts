/**
 * The live session as the control API reports it — the assembly half of
 * `ingest/ingest-status.ts`.
 *
 * It lives beside that module rather than inside it because `ingest-status.ts`
 * is deliberately PURE (it derives a reported play state from facts a caller
 * hands it, and imports no session state, which is what makes its whole
 * decision unit-testable with no browser). This half is the opposite by
 * nature: it reads the live singletons.
 */

import { measuredLoop } from '../host/same-realm-loop-gate';
import { activeIngest } from './active-ingest';
import { getIngestPlayControl, ingestPlaying } from './ingest-play-control';
import type { IngestStatusFacet } from './ingest-status';
import { ingestCoverageReport } from './mount-coverage';

/**
 * S-1 (the SimCity ledger's false-alive status): the live ingest session as the
 * control API reports it, or `null` when nothing is ingested.
 *
 * Read straight off the session slot, which is assigned only after a mount
 * SUCCEEDS and cleared by every teardown and failure path — so a non-null facet
 * is itself the mount evidence, and a failed mount can no longer present itself
 * as a live one. `loop` is the MEASURED verdict or `null`; it is never inferred
 * from the route.
 */
export function ingestStatusFacet(): IngestStatusFacet | null {
  const active = activeIngest();
  if (!active) return null;
  // The MEASURED verdict. `null` means no verdict exists yet (the probe runs
  // at pause), never "this route does not gate".
  const mount = active.kind === 'three' ? active.session.mount : undefined;
  const canvasLoop = active.kind === 'canvas' ? active.session.loop?.() : undefined;
  const loop = measuredLoop(mount?.realmLoopVerdict?.()) ?? canvasLoop?.loop ?? null;
  const loopReason = mount?.realmLoopVerdict?.()?.reason ?? canvasLoop?.reason ?? null;
  return {
    worldId: active.worldId,
    kind: active.kind,
    playing: ingestPlaying(),
    loop,
    loopReason,
    canStep: getIngestPlayControl()?.canStep ?? false,
    coverage: ingestCoverageReport(),
  };
}
