/**
 * GENERATIONS in the status bar (`workspace.status`) — permanent access to the
 * paid-provider lane's results, including when there are none yet.
 *
 * It was `status-contributions.tsx`'s `GenerationsStatus`, a host module, so
 * the base host named the generation ledger to paint a pill. The pill is the
 * same; what changed is who owns it (WORK.md §The open-source launch, phase 1
 * unit 6 — the generation estate is a service lane, not a base library's
 * concern).
 */

import { CONTRIBUTED_WORKSPACE_UTILITIES } from '@editor/workspace-core-utilities';
import { editorHost } from '@vgai/editor-sdk/host';
import { Button } from '@vgai/editor-sdk/widgets';
import { useSyncExternalStore } from 'react';
import {
  generationJobIsActive,
  generationJobsSnapshot,
  generationUnreadCount,
  subscribeGenerationJobs,
} from '../src/generation/generation-jobs';

export const point = 'workspace.status';
export const title = 'Generations';
export const align = 'left';
export const order = 24;

export default function GenerationsStatus() {
  const { jobs } = useSyncExternalStore(
    subscribeGenerationJobs,
    generationJobsSnapshot,
    generationJobsSnapshot,
  );
  const unseen = generationUnreadCount(jobs);
  const running = jobs.filter(generationJobIsActive).length;
  return (
    <Button
      type="button"
      variant="ghost"
      size="compact"
      className="vgai-status-action"
      data-testid="status-generations"
      aria-label={`Generations, ${unseen} unseen, ${running} running`}
      title={`${unseen} unseen generation results, ${running} running — open Generations`}
      onClick={() =>
        editorHost().workspace.showUtility(CONTRIBUTED_WORKSPACE_UTILITIES.generations.id)
      }
    >
      Generations · {unseen}
      {running > 0 ? ` · ${running} running` : ''}
    </Button>
  );
}
