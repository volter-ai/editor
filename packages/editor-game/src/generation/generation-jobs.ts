import { assertEditorServerResponse, editorServerJson } from '@editor/editor-server-response';
import { runProjectTool } from '@editor/project-tools';
import type { GenerationJob, GenerationJobsDocument } from '@vgai/sdk/generations';

const EMPTY: GenerationJobsDocument = { version: 1, jobs: [] };
let document = EMPTY;
let error: string | null = null;
let version = 0;
let polling = false;
const listeners = new Set<() => void>();

function publish(next: GenerationJobsDocument, nextError: string | null = null): void {
  document = next;
  error = nextError;
  version++;
  for (const listener of listeners) listener();
}

export function generationJobsSnapshot(): GenerationJobsDocument {
  return document;
}

export function generationJobsError(): string | null {
  return error;
}

export function generationJobsVersion(): number {
  return version;
}

export function subscribeGenerationJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function generationJobIsActive(job: GenerationJob): boolean {
  return job.status === 'queued' || job.status === 'running';
}

export function generationJobIsUnread(job: GenerationJob): boolean {
  return (
    !generationJobIsActive(job) &&
    (!job.readAt || Date.parse(job.readAt) < Date.parse(job.updatedAt))
  );
}

export function generationUnreadCount(jobs: readonly GenerationJob[]): number {
  return jobs.filter(generationJobIsUnread).length;
}

export function generationAttentionCount(jobs: readonly GenerationJob[]): number {
  return jobs.filter((job) => generationJobIsActive(job) || generationJobIsUnread(job)).length;
}

export async function refreshGenerationJobs(): Promise<void> {
  try {
    const response = await fetch('/__editor/generations');
    publish(
      await editorServerJson<GenerationJobsDocument>(
        response,
        'Generation activity request failed',
      ),
    );
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    version++;
    for (const listener of listeners) listener();
  }
}

export async function pollActiveGenerationJobs(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/__editor/generations/reconcile', { method: 'POST' });
    // A page fallback answers this POST `200 OK` and nothing reconciles, so
    // `response.ok` alone reported a completed reconciliation that never ran.
    assertEditorServerResponse(response, 'Generation reconciliation failed');
    await refreshGenerationJobs();
  } finally {
    polling = false;
  }
}

/** Run the provider's native poll operation and return its unnormalized result. */
export async function inspectGenerationJob(job: GenerationJob): Promise<unknown> {
  const outcome = await runProjectTool(job.poll.tool, job.poll.input);
  if (!outcome.ok) throw new Error(outcome.error.message);
  if (outcome.generationWarning) throw new Error(outcome.generationWarning);
  await refreshGenerationJobs();
  await markGenerationJobRead(job.id);
  return outcome.data;
}

export async function acceptGenerationJob(job: GenerationJob): Promise<void> {
  if (!job.accept) throw new Error('This completed generation has no project asset to add.');
  const outcome = await runProjectTool(job.accept.tool, job.accept.input, { confirm: true });
  if (!outcome.ok) throw new Error(outcome.error.message);
  if (outcome.generationWarning) throw new Error(outcome.generationWarning);
  await refreshGenerationJobs();
  await markGenerationJobRead(job.id);
}

export async function markGenerationJobRead(id: string): Promise<void> {
  const response = await fetch(`/__editor/generations/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
  assertEditorServerResponse(response, 'Mark generation read failed');
  await refreshGenerationJobs();
}

export async function forgetGenerationJob(id: string): Promise<void> {
  const response = await fetch(`/__editor/generations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  assertEditorServerResponse(response, 'Forget generation job failed');
  await refreshGenerationJobs();
}

/** Project-lifetime observation. The editor server owns provider
 * reconciliation; browser tabs only refresh the resulting durable ledger. */
export function startGenerationJobActivity(): () => void {
  void refreshGenerationJobs();
  const refreshTimer = window.setInterval(() => void refreshGenerationJobs(), 2_000);
  return () => {
    window.clearInterval(refreshTimer);
  };
}
