/**
 * CAPABILITY COVERAGE (`@vgai/editor-sdk/services`, a `workspace.service`
 * contribution): the four derived families that GRADE a mounted game's
 * adapters, and the union headline the editor console says out loud.
 *
 * ## Why this is the game skew's and not the host's
 *
 * Every row here is a question about a GAME — which providers this root's
 * `AuthoringAdapter` exposes, which `SystemAdapters` slots the running game
 * bound, whether the open project can build and prove itself, whether its
 * adapter table became real Edit documents. A host with no game skew loaded
 * (the models build) has no adapters to grade and asked none of it; it kept
 * paying for the derivation anyway, because the families were host fields on
 * `collectState` and a direct call in the host's vitals tick.
 *
 * ## The two doors, both the host's own, neither of them new vocabulary
 *
 *  - `session.reportFacet(collect, { reusableKeys })` — the four `vgai status`
 *    facets. The keys are declared REUSABLE because grading a root re-walks
 *    its tree (76ms–1.3s, measured), which is exactly the cost
 *    `command-listener.ts`'s `REUSABLE_DERIVED_FACETS` exists to keep off the
 *    interaction path: a collect handed a `reuse` snapshot copies them, and
 *    the host strips them from an interaction PATCH by name.
 *  - `session.onSample(fn)` — the host's own five-second vitals sample
 *    (`coverage/session-vitals.ts`), which `reportSessionCoverage` used to be
 *    a direct call inside. Subscribing keeps the promise that module's header
 *    makes: ONE watcher, one instant, one answer per cadence. A second
 *    interval here would sample the same session a fraction of a second later
 *    and publish a second story about one moment.
 *
 * A `restart` says "my project's files changed", so the project family's file
 * cache is dropped on it — through `session.onCommandDispatched`, the door
 * that already reports every relayed command, rather than a line in the
 * host's dispatch naming this package.
 */
import { editorHost } from '@vgai/editor-sdk/host';
import { authoringSurfaceCoverage } from '../src/coverage/live-authoring-surface';
import {
  invalidateProjectFileFacts,
  projectVerbCoverage,
} from '../src/coverage/live-project-verbs';
import { nativeSystemCoverage } from '../src/coverage/native-system-coverage';
import { rootCoverageFacet } from '../src/coverage/root-coverage';
import { reportSessionCoverage } from '../src/coverage/session-coverage';

export const point = 'workspace.service';

/** The four keys this facet serves, and the ones the host strips from an
 *  interaction patch. Named once. */
const REUSABLE_KEYS = [
  'rootCoverage',
  'systemCoverage',
  'projectCoverage',
  'authoringCoverage',
] as const;

function coverageFacets(reuse: Record<string, unknown> | null): Record<string, unknown> {
  if (reuse)
    return {
      rootCoverage: reuse['rootCoverage'] ?? [],
      systemCoverage: reuse['systemCoverage'] ?? null,
      projectCoverage: reuse['projectCoverage'] ?? null,
      authoringCoverage: reuse['authoringCoverage'] ?? null,
    };
  const systems = nativeSystemCoverage();
  const project = projectVerbCoverage();
  const authoring = authoringSurfaceCoverage();
  return {
    // THE DERIVED COVERAGE, per mounted root — native and ingested alike. The
    // row vocabulary is generated from the `AuthoringAdapter` contract itself
    // (`src/coverage/root-coverage.ts`), so a capability nobody remembered to
    // enumerate still appears here as a standing row. `[]` when nothing is
    // mounted, which is not the same as "no gaps".
    rootCoverage: rootCoverageFacet().map((entry) => ({
      worldId: entry.worldId,
      surface: entry.surface,
      summary: entry.report.summary,
      rows: entry.report.rows.map((row) => ({ ...row })),
    })),
    // The GAME-scoped companion to `rootCoverage`: one row per
    // `SystemAdapters` slot, read off the editor's own live registry. `null`
    // for an ingested mount, whose declared-carrier measurement in
    // `ingest.coverage` is stronger, and for a session with no open project.
    systemCoverage: systems
      ? { summary: systems.summary, rows: systems.rows.map((row) => ({ ...row })) }
      : null,
    // The THIRD derived family, and the one that lives outside both adapter
    // contracts: the native verbs whose subject is the PROJECT rather than a
    // mounted root — its committed proof route, whether `vgai add` can land a
    // capability here, and whether it can produce a standalone build at all
    // (`@editor/coverage/project-verb-coverage`). Without it a project could
    // be green in the other two families and silently have none of the three.
    // `null` only when no project is open.
    projectCoverage: project
      ? { summary: project.summary, rows: project.rows.map((row) => ({ ...row })) }
      : null,
    // The PROJECT-level authoring surface: whether the resolved adapter table
    // became real Edit documents and Content pieces. Runtime/root coverage can
    // be green while both are absent, so this family has its own status facet.
    authoringCoverage: authoring
      ? { summary: authoring.summary, rows: authoring.rows.map((row) => ({ ...row })) }
      : null,
  };
}

export function start(): () => void {
  const session = editorHost().session;
  const stopFacet = session.reportFacet(coverageFacets, { reusableKeys: REUSABLE_KEYS });
  const stopSample = session.onSample(reportSessionCoverage);
  const stopCommands = session.onCommandDispatched((type) => {
    if (type === 'restart') invalidateProjectFileFacts();
  });
  return () => {
    stopFacet();
    stopSample();
    stopCommands();
  };
}
