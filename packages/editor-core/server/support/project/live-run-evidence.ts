import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A live lane's successful run, observed by the editor server. Kept separate
 * from Play recordings: a document runner need not own a recording session. */
const FILE = 'live-run.json';

export function recordLiveRunEvidence(projectRoot: string, run: unknown, sessionStartedAt: number, observedAt: number): void {
  if (!run || typeof run !== 'object') return;
  const startedAt = (run as Record<string, unknown>)['startedAt'];
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) ||
      startedAt < sessionStartedAt || startedAt > observedAt) return;
  const folder = join(projectRoot, 'logs');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, FILE), JSON.stringify({ startedAt, observedAt }) + '\n');
}

/** Read the recorded observation, never the mtime of a later file touch. */
export function latestLiveRunEvidence(projectRoot: string): number | null {
  try {
    const evidence = JSON.parse(readFileSync(join(projectRoot, 'logs', FILE), 'utf8')) as Record<string, unknown>;
    const startedAt = evidence['startedAt'], observedAt = evidence['observedAt'];
    return typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0 &&
      typeof observedAt === 'number' && Number.isFinite(observedAt) && observedAt >= startedAt
      ? observedAt : null;
  } catch { return null; }
}
