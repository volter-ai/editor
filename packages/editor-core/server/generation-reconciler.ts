import type { GenerationJob } from '@volter/editor-sdk/generations';
import type { EditorAccountService } from './account-service';
import { readGenerationJobs, recordGenerationPollFailure } from './generation-jobs';
import { reconcileAcceptedGenerationProvenance } from './project-output-writer';
import {
  executeProjectTool,
  type ProjectModuleLoader,
  type ProjectToolExecution,
} from './project-tools';

export interface GenerationReconcileReport {
  attempted: number;
  succeeded: number;
  failed: Array<{ id: string; message: string }>;
}

function executionFailure(result: ProjectToolExecution): string | null {
  return result.body.ok ? (result.body.generationWarning ?? null) : result.body.error.message;
}

async function reconcileJob(
  projectRoot: string,
  loadModule: ProjectModuleLoader | undefined,
  job: GenerationJob,
  account?: EditorAccountService,
): Promise<string | null> {
  try {
    if (job.status === 'queued' || job.status === 'running') {
      const result = await executeProjectTool({
        account,
        projectRoot,
        loadModule,
        name: job.poll.tool,
        input: job.poll.input,
        confirmed: false,
      });
      const failure = executionFailure(result);
      if (failure) throw new Error(failure);
    }
    // Read again: polling or a concurrent explicit save may have completed it.
    const current = (await readGenerationJobs(projectRoot)).jobs.find(
      (entry) => entry.id === job.id,
    );
    if (current?.status === 'succeeded' && current.accept && !current.acceptedAt) {
      const result = await executeProjectTool({
        account,
        projectRoot,
        loadModule,
        name: current.accept.tool,
        input: current.accept.input,
        confirmed: true,
      });
      const failure =
        executionFailure(result) ??
        (result.body.ok && !result.body.generation?.acceptedAt ? 'Output was not saved.' : null);
      if (failure) throw new Error(`Saving output failed: ${failure}`);
    }
    await recordGenerationPollFailure(projectRoot, job.id, null);
    return null;
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await recordGenerationPollFailure(projectRoot, job.id, failure);
    return failure;
  }
}

/** Server-owned, bounded reconciliation. Browser tabs observe this state and
 * never multiply provider polls merely because several editors are open. */
async function reconcileProjectGenerationJobs(
  projectRoot: string,
  loadModule: ProjectModuleLoader | undefined,
  concurrency = 3,
  account?: EditorAccountService,
): Promise<GenerationReconcileReport> {
  const allJobs = (await readGenerationJobs(projectRoot)).jobs;
  const failed: GenerationReconcileReport['failed'] = [];
  await Promise.all(
    allJobs
      .filter((job) => job.acceptedAt && job.provenanceOperationId)
      .map(async (job) => {
        try {
          await reconcileAcceptedGenerationProvenance(projectRoot, job);
        } catch (error) {
          failed.push({
            id: job.id,
            message: `Provenance settlement repair failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }),
  );
  const now = Date.now();
  const jobs = allJobs.filter(
    (job) =>
      (job.status === 'queued' ||
        job.status === 'running' ||
        (job.status === 'succeeded' &&
          job.accept &&
          !job.acceptedAt &&
          (job.pollFailureCount ?? 0) < 5)) &&
      (!job.nextPollAt || Date.parse(job.nextPollAt) <= now),
  );
  let cursor = 0;
  let succeeded = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (!job) continue;
      const failure = await reconcileJob(projectRoot, loadModule, job, account);
      if (failure) failed.push({ id: job.id, message: failure });
      else succeeded++;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), jobs.length) }, () => worker()),
  );
  return { attempted: jobs.length, succeeded, failed };
}

const inFlight = new Map<string, Promise<GenerationReconcileReport>>();

/** The timer and explicit refresh share the same poll/save pass. */
export function reconcileGenerationJobs(
  projectRoot: string,
  loadModule: ProjectModuleLoader | undefined,
  concurrency = 3,
  account?: EditorAccountService,
): Promise<GenerationReconcileReport> {
  const pending = inFlight.get(projectRoot);
  if (pending) return pending;
  const work = reconcileProjectGenerationJobs(projectRoot, loadModule, concurrency, account);
  inFlight.set(projectRoot, work);
  const cleanup = () => {
    if (inFlight.get(projectRoot) === work) inFlight.delete(projectRoot);
  };
  void work.then(cleanup, cleanup);
  return work;
}
