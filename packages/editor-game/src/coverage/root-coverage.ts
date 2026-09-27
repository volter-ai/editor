/**
 * PER-ROOT COVERAGE — the generated capability report for EVERY root the editor
 * currently has mounted, native and ingested alike.
 *
 * ## The defect this closes
 *
 * Coverage used to be an ingest-only instrument: `ingest/mount-coverage.ts`
 * assembled facts for the one ingested world and nothing said anything about a
 * native root at all. So a per-root gap on a first-party root — the measured
 * case was a project's HUD (`dom`) root whose inspector was dead — surfaced
 * only as a one-off session error, never as a standing row, and closing it
 * depended on somebody remembering it existed.
 *
 * The generator does not care which lane produced a root. It asks each mounted
 * root's own `AuthoringAdapter` which providers it exposes
 * (`measureAuthoringProviders`, whose vocabulary the compiler pins to the
 * contract), diffs that against the full contract minus what the root's SURFACE
 * kind cannot have, and every delta is a standing row. Nothing here consults a
 * game's id, its route, or its manifest.
 *
 * ## Where the rows go
 *
 * Two doors, one derivation — the same shape `ingest/mount-coverage.ts` already
 * uses:
 *
 *  - `vgai status`, through {@link rootCoverageFacet}, so an agent reads the
 *    same answer without opening the editor;
 *  - the editor console, through `coverage/session-coverage.ts`, which unions
 *    this family with the game- and project-scoped ones so the warning's
 *    headline counts every seam rather than this family's 21. The console
 *    ledger turns that into a standing unresolved condition, loud on every
 *    `vgai` command until it is closed.
 */

import { measureAdapter } from '../host/adapter-reach';
import {
  type MountedRootSubject,
  mountedRootSubjects,
} from '@volter/editor-sdk/kit/authoring/mounted-root-subjects';
import {
  type CapabilityCoverageReport,
  deriveCapabilityCoverage,
} from '../host/coverage/capability-coverage';
import type { AdapterSurface } from '@volter/editor-project/adapter/adapter-surface';

/** One root's report. `surface` rides along because it is what decides which
 *  absences were excused, and a reader must be able to check that. */
export interface RootCoverageReport {
  readonly worldId: string;
  readonly surface: AdapterSurface | null;
  readonly report: CapabilityCoverageReport;
}

/**
 * The generated report for one root.
 *
 * A root owns only authoring reach. Runtime, system-registry, and project facts
 * are omitted, so the universal derivation produces no rows for those families.
 */
export function deriveRootCoverage(subject: MountedRootSubject): RootCoverageReport {
  const report = deriveCapabilityCoverage({
    worldId: subject.worldId,
    reach: measureAdapter(subject.adapter, subject.worldId),
    surface: subject.surface,
    reachMechanism: null,
  });
  return {
    worldId: subject.worldId,
    surface: subject.surface,
    report,
  };
}

/** Every mounted root's report, re-derived on read — a root's adapter gains and
 *  loses providers during a session (a design session swaps itself in), so a
 *  cached answer would start lying. */
export function rootCoverageFacet(): readonly RootCoverageReport[] {
  return mountedRootSubjects().map(deriveRootCoverage);
}
