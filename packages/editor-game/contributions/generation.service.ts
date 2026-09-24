/**
 * THE GENERATION ESTATE (`@vgai/editor-sdk/services`, a `workspace.service`
 * contribution): the paid-provider lane's editor surface — the Generations
 * drawer gallery over the durable job ledger, the Create-generation document
 * and the per-job result document.
 *
 * They were host modules (`generation-jobs.ts`, `components/GenerationActivity
 * .tsx`, `components/generation-documents.tsx`, `components/generation-
 * presentation.ts`), which put a metered service's ledger, its provider
 * vocabulary and its billing strings inside a base library for making IDEs
 * (WORK.md §The open-source launch, phase 1 unit 6). Nothing here is generic
 * over document kinds or surfaces; every line is about one lane.
 *
 * TWO DOORS, both already the host's:
 *  - the drawer TAB is `registerWorkspaceUtility` — a `.utility` contribution
 *    would be the shorter spelling, but that point carries no attention BADGE
 *    and the tab's whole job is to say how many results are unseen, so the
 *    registry call is made here directly (the story documents' service does
 *    the same, for the same reason);
 *  - the two DOCUMENTS open through `document-open-registry.ts` under the
 *    `generation` VIEW ADDRESS — the kind `@vgai/editor-sdk`'s `EditorView`
 *    already names — so `editor-view-presentation.ts` addresses a generation
 *    without importing one, and a build without this package answers `null`
 *    to the address instead of pretending.
 *
 * The SERVER half (`packages/editor/server/generation-jobs.ts`, the
 * reconciler, `routes/generations.ts`) is still the editor's: there is no
 * server-side service point yet (WORKBENCH.md §Contribution points, `service`
 * — "the SERVER side … is still the editor's"). This module talks to those
 * routes over HTTP exactly as it did when it lived in the host.
 */

import { registerDocumentOpener } from '@editor/document-open-registry';
import { CONTRIBUTED_WORKSPACE_UTILITIES } from '@editor/workspace-core-utilities';
import { registerWorkspaceUtility } from '@editor/workspace-utility-registry';
import { GenerationActivity } from '../src/generation/GenerationActivity';
import {
  openGenerationCreateDocument,
  openGenerationDocument,
} from '../src/generation/generation-documents';
import {
  generationJobsSnapshot,
  generationJobsVersion,
  generationUnreadCount,
  refreshGenerationJobs,
  startGenerationJobActivity,
  subscribeGenerationJobs,
} from '../src/generation/generation-jobs';

export const point = 'workspace.service';

/** The `generation` view address (`EditorView['document']`, `@vgai/editor-sdk`).
 *  `id` is a job id, or `create` for the submit document. */
const GENERATION_VIEW_ADDRESS = 'generation';

function generationsBadge() {
  const count = generationUnreadCount(generationJobsSnapshot().jobs);
  return count > 0 ? ({ count, severity: 'info' } as const) : null;
}

export function start(): () => void {
  const stops = [
    // The ledger POLL, and its cadence, are this lane's own: it was
    // `EditorContext.tsx`'s `useEffect`, so the host held a 2-second timer for
    // a metered service. Deliberately NOT `session.onSample` — that door is the
    // five-second VITALS tick for derivations of the session, and hanging a
    // remote-ledger fetch on it would slow a visible result by 3s for no
    // measured reason. The service owns the interval and ends it on stop.
    startGenerationJobActivity(),
    registerWorkspaceUtility({
      ...CONTRIBUTED_WORKSPACE_UTILITIES.generations,
      order: 15,
      Content: GenerationActivity,
      badge: generationsBadge,
      subscribeBadge: subscribeGenerationJobs,
      badgeSnapshot: generationJobsVersion,
      visibleByDefault: false,
      closeable: true,
    }),
    registerDocumentOpener<{ readonly id: string }>({
      id: GENERATION_VIEW_ADDRESS,
      owner: '@vgai/game/generation',
      open: (_store, request) => {
        if (request.id === 'create') return openGenerationCreateDocument();
        const job = generationJobsSnapshot().jobs.find((entry) => entry.id === request.id);
        return job ? openGenerationDocument(job) : null;
      },
      // A job the page has not fetched yet is not a missing job: refresh the
      // ledger once and the address resolves.
      settle: refreshGenerationJobs,
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
