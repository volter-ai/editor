/**
 * ONE COVERAGE HEADLINE PER SESSION — the union of every derived family.
 *
 * ## The defect this closes
 *
 * Coverage grew a family at a time, and each family kept its own console door:
 * `coverage/root-coverage.ts` printed the `editor.*` rows per mounted root,
 * `coverage/native-system-coverage.ts` printed the `system.*` rows, and each
 * one's headline counted only its own rows. So the loudest sentence the product
 * says about its own completeness read "N of 21 seams are MISSING" — 21 being
 * the `AuthoringAdapter` provider vocabulary plus `editor.capture`, and nothing
 * else. A session could print "0 of 21" while an entire family of native verbs
 * (`coverage/project-verb-coverage.ts`) was absent, because no surface anywhere
 * summed the families.
 *
 * A count that names one family's total "seams" is the clean-answer failure the
 * whole derivation exists to end: it is crisp, always available, correlated
 * with the truth, and wrong in exactly the cases worth investigating. So the
 * families are UNIONED before anything is said, the headline counts the union,
 * and the per-family split rides in the same sentence — a reader sees both the
 * total and which family it is short in, and cannot mistake one for the other.
 *
 * ## What this owns, and what it does not
 *
 * It owns assembly and the console door. Every family still derives itself, in
 * its own file, from its own facts; nothing here decides a verdict. The
 * per-family facets on `vgai status` (`command-listener.ts`) stay separate for
 * the same reason they always were — a machine reader wants the rows keyed by
 * subject, and it is the HUMAN-facing sentence that has to be a union.
 */

import { mountedRootSubjects } from '@volter/editor-core/authoring/mounted-root-subjects';
import {
  type CoveragePart,
  formatCapabilityCoverageBlocks,
  unionCoverageReport,
} from '../host/coverage/capability-coverage';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { editorIsPlaying } from '@volter/editor-sdk/kit/editor-session-mode';
import { projectAdapterFacet } from '@volter/editor-core/project-adapter';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { authoringSurfaceCoverage } from './live-authoring-surface';
import { projectVerbCoverage } from './live-project-verbs';
import { nativeSystemCoverage } from './native-system-coverage';
import { type RootCoverageReport, rootCoverageFacet } from './root-coverage';

/**
 * Every family that has something to say about this session, in report order:
 * the per-root `editor.*` families first (cheapest to reason about), then the
 * game-scoped `system.*`, then the project-scoped `project.*`.
 *
 * A root's part carries its worldId as the label because the same seam
 * legitimately appears once per mounted root; the game- and project-scoped
 * families appear once and carry none.
 */
export function sessionCoverageParts(
  /** The per-root family, already derived. Grading a root is the expensive
   *  half of this whole file (it re-walks the root's tree through the
   *  conformance probe), and `reportSessionCoverage` needs the same rows for
   *  its mount-in-progress guard — deriving them twice per five-second sample
   *  was pure duplication, measured at ~175ms a copy on a 1822-node canvas
   *  world. */
  roots: readonly RootCoverageReport[] = rootCoverageFacet(),
): readonly CoveragePart[] {
  const parts: CoveragePart[] = roots.map((entry) => ({
    label: entry.worldId,
    report: entry.report,
  }));
  const systems = nativeSystemCoverage();
  if (systems) parts.push({ label: null, report: systems });
  const project = projectVerbCoverage();
  if (project) parts.push({ label: null, report: project });
  const authoring = authoringSurfaceCoverage();
  if (authoring) parts.push({ label: null, report: authoring });
  return parts;
}

/** The session's whole coverage answer as ONE report, or `null` when no family
 *  had anything to measure (nothing mounted, no project open). */
export function sessionCoverageReport(
  roots?: readonly RootCoverageReport[],
): ReturnType<typeof unionCoverageReport> | null {
  const parts = sessionCoverageParts(roots ?? rootCoverageFacet());
  if (parts.length === 0) return null;
  return unionCoverageReport(getCurrentProject()?.config.name ?? 'session', parts);
}

/**
 * Say it out loud, once per distinct gap set.
 *
 * Keyed on the rendered TEXT rather than a mount or project token, because the
 * union's inputs come and go inside one session (a root mounts, a design
 * session attaches, `vgai add` lands a script) and the honest rule is "say it
 * when the answer changes". A recurrence after a real change is a new condition
 * and gets said again; the server ledger sums repeats of an unchanged one.
 */
const _said = new Set<string>();
let _pendingSignature: string | null = null;
let _pendingSamples = 0;

function clearPendingCoverage(): void {
  _pendingSignature = null;
  _pendingSamples = 0;
}

export function reportSessionCoverage(): void {
  // Edit-time source authoring is the subject of the per-root provider rows.
  // Play temporarily swaps those adapters for runtime/live projections with a
  // deliberately smaller vocabulary. Recording that temporary projection in
  // the unresolved ledger makes a successful Play look like a standing Edit
  // defect after Play has ended, so the report waits for Edit's adapters.
  if (editorIsPlaying()) {
    clearPendingCoverage();
    return;
  }
  // ONE grading pass per sample. Every guard below and the report itself read
  // these same rows.
  const roots = rootCoverageFacet();
  const report = sessionCoverageReport(roots);
  if (!report || report.summary.gaps === 0) {
    clearPendingCoverage();
    return;
  }
  // Say nothing while nothing is MOUNTED. The families each stand down for
  // states they cannot measure, but the project family legitimately has
  // manifest-fact rows pre-mount — and a pre-mount headline is still a
  // transient the ledger would hold forever (measured: a boot-time "N of N
  // seams MISSING" snapshot stood beside the real post-mount report as a
  // second unresolved warning). The mount is the moment the session becomes
  // the thing coverage describes; until then, silence is the honest report.
  //
  // "Mounted" is what `mountedRootSubjects()` means by it, and a root the
  // editor has merely DISCLOSED does not count — see that function's
  // `isBoundaryDisclosure`. A declared world wears the boundary disclosure
  // adapter for the whole of its mount's assembly, so a session mid-assembly
  // has subjects that are not yet the thing coverage describes. The guard lives
  // HERE, in the one report path, precisely so no caller's timing can plant a
  // transient: the vitals sampler is periodic and lands wherever it lands.
  const mounted = mountedRootSubjects();
  if (mounted.length === 0) {
    clearPendingCoverage();
    return;
  }
  // A multi-root project assembles its composite incrementally. The first live
  // child is not yet the declared authoring surface, and the ledger cannot
  // retract the partial-root warning after the remaining children attach.
  // Wait for every shipped region by source-owned id; a single-root/bare
  // adapter keeps its historical `root` identity and is already atomic.
  const declared = projectAdapterFacet()?.regions ?? [];
  if (declared.length > 1) {
    const mountedIds = new Set(mounted.map((subject) => subject.worldId));
    if (declared.some((region) => !mountedIds.has(region.id))) {
      clearPendingCoverage();
      return;
    }
  }
  // A root whose hierarchy has not completed one valid operation is not yet a
  // stable authoring subject. Provider gaps observed before that point are an
  // assembly snapshot: the adapter object exists, but the tree every provider
  // addresses does not. Do not make that snapshot permanent in the server
  // ledger. The live status facet and Doctor's final coverage phase still
  // report a hierarchy that genuinely never becomes valid; this guard only
  // keeps the periodic console reporter from treating "mount in progress" as
  // a completed session.
  if (
    roots.some(
      (root) => root.report.rows.find((row) => row.seam === 'editor.capture')?.status !== 'ok',
    )
  ) {
    clearPendingCoverage();
    return;
  }
  const head = `session coverage "${report.summary.worldId}"`;
  const warnings = formatCapabilityCoverageBlocks(report, head).filter(
    (block) => block.level === 'warn',
  );
  const signature = warnings.map((block) => block.message).join('\n---\n');
  if (_pendingSignature === signature) _pendingSamples++;
  else {
    _pendingSignature = signature;
    _pendingSamples = 1;
  }
  // HMR and cold-remount replace an adapter between two snapshots. A single
  // conformance failure during that handoff is not a standing condition; the
  // next five-second sample must reproduce the exact gap set before it enters
  // the unresolved ledger. Genuine gaps remain loud one sample later.
  if (_pendingSamples < 2) return;
  for (const block of warnings) {
    if (_said.has(block.message)) continue;
    _said.add(block.message);
    editorConsole.warn(block.message, 'coverage');
  }
}
