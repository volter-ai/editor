/**
 * The INGEST LANE's status facet — what `session.reportFacet('ingest')`
 * publishes about a mounted unmodified game (`live-ingest-facet.ts` builds it).
 *
 * The derivation of the SESSION's reported play state is NOT here: it names no
 * lane and is the host's (`@editor/reported-play-state.ts`, asked of the
 * live-session registry). This module is only the lane's own description of
 * what it mounted.
 */

import type { CapabilityCoverageReport } from '../host/coverage/capability-coverage';
import type { MeasuredLoop } from '../host/same-realm-loop-gate';

/**
 * The live ingest session, as the control API reports it. Every field is read
 * from the session itself — never inferred from the manifest or the route.
 *
 * The facet's mere PRESENCE is the mount truth: `ingest/active-ingest.ts` assigns its
 * `_active` slot only after a mount actually succeeded, and clears it on every
 * teardown and every failure path. There is deliberately no `mounted: true`
 * field — a field that can never be false is not evidence.
 */
export interface IngestStatusFacet {
  /** The mounted world's manifest id. */
  readonly worldId: string;
  /** The session's render substrate (`ingest/active-ingest.ts`'s `IngestKind`). */
  readonly kind: string;
  /** `IngestPlayControl.playing` — whether the game's loop was last told to run. */
  readonly playing: boolean;
  /**
   * The MEASURED loop verdict WITH its evidence
   * (`same-realm-loop-gate.ts`'s `MeasuredLoop`), or `null` when no probe
   * has run yet.
   *
   * Never inferred from the manifest — and now structurally unable to be: the
   * manifest declares the SAME two words as an author's intent
   * (`@volter/editor-project/manifest/schema`'s `loop`), so a bare string here left a
   * declaration and a measurement indistinguishable to every reader of this
   * facet. Evidence is producible only by the probe.
   */
  readonly loop: MeasuredLoop | null;
  /** Why — the probe's own words, so a reader can see what was measured rather
   *  than take the one-word verdict on faith. */
  readonly loopReason: string | null;
  /** Whether a single-frame step is a real operation on this mount. */
  readonly canStep: boolean;
  /**
   * WHAT THE EDITOR CANNOT DO with this game, and the mechanism that would fix
   * each gap — the derived seam report (`coverage/capability-coverage.ts`). Rides
   * along on the facet so a CLI reader gets the same answer the editor console
   * printed at mount, instead of "the editor just has less" arriving as silence
   * in every door at once.
   *
   * Re-derived on every read (the loop verdict, the ownership answer and the
   * registered adapters all move after mount), so it is never a stale claim.
   *
   * `null` means NOT MEASURED — the coverage inputs are recorded by the three
   * mount paths, so a pixi/react ingest has no report yet rather than a
   * fabricated clean one. Absence of a report is not a report of no gaps.
   */
  readonly coverage: CapabilityCoverageReport | null;
}
