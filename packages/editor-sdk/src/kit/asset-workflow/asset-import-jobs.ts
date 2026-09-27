import { connectEvents } from '@volter/editor-sdk/kit/editor-api';
import type { AssetImportStage } from './import-contract';

export interface AssetImportJob {
  id: string;
  label: string;
  stage: AssetImportStage;
  loaded: number;
  total: number;
  status: 'running' | 'imported' | 'skipped' | 'failed' | 'cancelled';
  message?: string;
  controller: AbortController;
  retry?: () => void;
}

const jobs = new Map<string, AssetImportJob>();
const listeners = new Set<() => void>();
let version = 0;
function notify(): void {
  version++;
  for (const listener of listeners) listener();
}
export function assetImportJobsVersion(): number {
  return version;
}
export function subscribeAssetImportJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function assetImportJobs(): readonly AssetImportJob[] {
  return [...jobs.values()];
}

export function beginAssetImportJob(id: string, label: string): AssetImportJob {
  const existing = jobs.get(id);
  if (existing?.status === 'running') return existing;
  const job: AssetImportJob = {
    id,
    label,
    stage: 'fetch',
    loaded: 0,
    total: 0,
    status: 'running',
    controller: new AbortController(),
  };
  jobs.set(id, job);
  notify();
  return job;
}
export function updateAssetImportJob(
  id: string,
  patch: Partial<Omit<AssetImportJob, 'id' | 'controller'>>,
): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
  notify();
}
export function cancelAssetImportJob(id: string): void {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return;
  job.controller.abort(new DOMException('Import cancelled', 'AbortError'));
  job.status = 'cancelled';
  job.message = 'Cancelled before project commit.';
  notify();
}
export function clearFinishedAssetImportJobs(): void {
  for (const [id, job] of jobs) if (job.status !== 'running') jobs.delete(id);
  notify();
}
export function resetAssetImportJobs(): void {
  jobs.clear();
  notify();
}

/** Keep jobs progressing independently of whether the Library document is mounted. */
export function connectAssetImportProgressEvents(): () => void {
  const source = connectEvents();
  const listener = (event: MessageEvent) => {
    try {
      const update = JSON.parse(event.data as string) as {
        jobId?: string;
        stage?: AssetImportStage;
        loaded?: number;
        total?: number;
        message?: string;
      };
      if (!update.jobId || !update.stage) return;
      updateAssetImportJob(update.jobId, {
        stage: update.stage,
        loaded: Math.max(0, update.loaded ?? 0),
        total: Math.max(0, update.total ?? 0),
        ...(update.message ? { message: update.message } : {}),
      });
    } catch {
      // Optional progress cannot break a running import.
    }
  };
  source.addEventListener('asset-import-progress', listener);
  return () => {
    source.removeEventListener('asset-import-progress', listener);
    source.close();
  };
}
