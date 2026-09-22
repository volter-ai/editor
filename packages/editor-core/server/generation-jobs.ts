import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  type GenerationJob,
  type GenerationJobDraft,
  type GenerationJobsDocument,
  GenerationJobsDocumentSchema,
  type GenerationJobUpdate,
  type GenerationToolContribution,
} from '@volter/editor-sdk/generations';
import { sanitizeRecordedValue } from './redact-secrets';

export const PROJECT_GENERATIONS_PATH = '.vgai/generations.json';

const projectQueues = new Map<string, Promise<unknown>>();
function emptyDocument(): GenerationJobsDocument {
  return { version: 1, jobs: [] };
}

export async function readGenerationJobs(projectRoot: string): Promise<GenerationJobsDocument> {
  try {
    const value: unknown = JSON.parse(
      await readFile(resolve(projectRoot, PROJECT_GENERATIONS_PATH), 'utf8'),
    );
    return GenerationJobsDocumentSchema.parse(value);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return emptyDocument();
    }
    throw error;
  }
}

async function writeDocument(projectRoot: string, document: GenerationJobsDocument): Promise<void> {
  const path = resolve(projectRoot, PROJECT_GENERATIONS_PATH);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    temporary,
    `${JSON.stringify(GenerationJobsDocumentSchema.parse(document), null, 2)}\n`,
  );
  try {
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function serialize<T>(projectRoot: string, work: () => Promise<T>): Promise<T> {
  const prior = projectQueues.get(projectRoot) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(work);
  projectQueues.set(projectRoot, next);
  const cleanup = () => {
    if (projectQueues.get(projectRoot) === next) projectQueues.delete(projectRoot);
  };
  void next.then(cleanup, cleanup);
  return next;
}

function findJob(document: GenerationJobsDocument, update: GenerationJobUpdate): GenerationJob {
  const job = document.jobs.find(
    (candidate) =>
      candidate.provider === update.provider && candidate.externalId === update.externalId,
  );
  if (!job) {
    throw new Error(
      `Generation provider ${JSON.stringify(update.provider)} updated unknown job ${JSON.stringify(update.externalId)}.`,
    );
  }
  return job;
}

function applyUpdate(job: GenerationJob, update: GenerationJobUpdate, now: string): GenerationJob {
  const next = {
    ...job,
    updatedAt: now,
    ...(update.status ? { status: update.status } : {}),
    ...(update.progress !== undefined ? { progress: update.progress } : {}),
    ...(update.providerStatus !== undefined ? { providerStatus: update.providerStatus } : {}),
    ...(update.queuePosition !== undefined ? { queuePosition: update.queuePosition } : {}),
    ...(update.message !== undefined ? { message: update.message } : {}),
    ...(update.billing ? { billing: update.billing } : {}),
    ...(update.cancel ? { cancel: update.cancel } : {}),
    ...(update.accept ? { accept: update.accept } : {}),
    ...(update.accepted
      ? {
          acceptedAt: now,
          provenanceOperationId: update.accepted.provenanceOperationId,
          outputPaths: update.accepted.outputPaths,
        }
      : {}),
  };
  delete next.pollError;
  delete next.pollErrorAt;
  delete next.pollFailureCount;
  delete next.nextPollAt;
  if (update.accept === null) delete next.accept;
  return next;
}

export async function recordGenerationPollFailure(
  projectRoot: string,
  id: string,
  failure: string | null,
): Promise<void> {
  await serialize(projectRoot, async () => {
    const document = await readGenerationJobs(projectRoot);
    const job = document.jobs.find((candidate) => candidate.id === id);
    if (!job) return;
    const now = new Date().toISOString();
    document.jobs = document.jobs.map((candidate) => {
      if (candidate.id !== id) return candidate;
      if (failure === null) {
        const next = { ...candidate, updatedAt: now };
        delete next.pollError;
        delete next.pollErrorAt;
        delete next.pollFailureCount;
        delete next.nextPollAt;
        return next;
      }
      const failureCount = (candidate.pollFailureCount ?? 0) + 1;
      const backoffSeconds = Math.min(60, 5 * 2 ** Math.min(4, failureCount - 1));
      return {
        ...candidate,
        pollError: failure,
        pollErrorAt: now,
        pollFailureCount: failureCount,
        nextPollAt: new Date(Date.now() + backoffSeconds * 1_000).toISOString(),
      };
    });
    await writeDocument(projectRoot, document);
  });
}

export async function applyGenerationContribution(
  projectRoot: string,
  contribution: GenerationToolContribution,
  input: unknown,
  result: unknown,
): Promise<GenerationJob> {
  return serialize(projectRoot, async () => {
    const document = await readGenerationJobs(projectRoot);
    const now = new Date().toISOString();
    let job: GenerationJob;
    if (contribution.role === 'submit') {
      const draft: GenerationJobDraft = contribution.toJob(input, result);
      if (draft.provider !== contribution.provider) {
        throw new Error('Generation contribution returned a different provider id.');
      }
      const existing = document.jobs.find(
        (candidate) =>
          candidate.provider === draft.provider && candidate.externalId === draft.externalId,
      );
      job = GenerationJobsDocumentSchema.shape.jobs.element.parse(
        sanitizeRecordedValue({
          ...draft,
          id: existing?.id ?? randomUUID(),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }),
      );
      document.jobs = [job, ...document.jobs.filter((candidate) => candidate.id !== job.id)];
    } else {
      const update = contribution.toUpdate(input, result);
      if (update.provider !== contribution.provider) {
        throw new Error('Generation contribution returned a different provider id.');
      }
      job = applyUpdate(findJob(document, update), update, now);
      document.jobs = document.jobs.map((candidate) => (candidate.id === job.id ? job : candidate));
    }
    await writeDocument(projectRoot, document);
    return job;
  });
}

export async function forgetGenerationJob(projectRoot: string, id: string): Promise<boolean> {
  return serialize(projectRoot, async () => {
    const document = await readGenerationJobs(projectRoot);
    const next = document.jobs.filter((job) => job.id !== id);
    if (next.length === document.jobs.length) return false;
    document.jobs = next;
    await writeDocument(projectRoot, document);
    return true;
  });
}

export async function markGenerationJobRead(projectRoot: string, id: string): Promise<boolean> {
  return serialize(projectRoot, async () => {
    const document = await readGenerationJobs(projectRoot);
    const job = document.jobs.find((candidate) => candidate.id === id);
    if (!job || job.status === 'queued' || job.status === 'running') return false;
    if (job.readAt && Date.parse(job.readAt) >= Date.parse(job.updatedAt)) return false;
    const readAt = new Date().toISOString();
    document.jobs = document.jobs.map((candidate) =>
      candidate.id === id ? { ...candidate, readAt } : candidate,
    );
    await writeDocument(projectRoot, document);
    return true;
  });
}
