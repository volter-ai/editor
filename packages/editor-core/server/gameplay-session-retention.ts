/** Byte-budget retention for editor-managed Gameplay Session artifacts. */

import { appendFile, lstat, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GAMEPLAY_SESSION_CLIP_BUDGET_BYTES,
  GAMEPLAY_SESSION_LOG_BUDGET_BYTES,
} from './support/play/session-record';

/** Structured logs are the durable Analytics source. At the current event
 * density this keeps hundreds of substantial sessions, without allowing one
 * project to grow forever. */
/** Automatically named session clips are working evidence, not keepsakes.
 * Two GiB provides a useful history while making long recordings pay their
 * actual disk cost. Explicitly named recordings are outside this budget. */
export {
  GAMEPLAY_SESSION_CLIP_BUDGET_BYTES,
  GAMEPLAY_SESSION_LOG_BUDGET_BYTES,
} from './support/play/session-record';

interface SizedFile {
  readonly file: string;
  readonly bytes: number;
}

async function sizedFiles(directory: string, files: readonly string[]): Promise<SizedFile[]> {
  const sized = await Promise.all(
    files.map(async (file): Promise<SizedFile | null> => {
      const info = await stat(join(directory, file)).catch(() => null);
      return info?.isFile() ? { file, bytes: info.size } : null;
    }),
  );
  return sized.filter((value): value is SizedFile => value !== null);
}

async function unlinkIfPresent(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

async function pathBytes(path: string): Promise<number> {
  const info = await lstat(path).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  const children = await readdir(path).catch(() => []);
  const sizes = await Promise.all(children.map((child) => pathBytes(join(path, child))));
  return sizes.reduce((sum, bytes) => sum + bytes, 0);
}

async function removeReplaySidecar(recordingsDir: string, stem: string): Promise<void> {
  await rm(join(recordingsDir, `${stem}.replay`), { recursive: true, force: true });
}

/** Prune oldest durable records only when their combined bytes exceed the log
 * allotment. The newest record is always retained, even if it alone is large. */
export async function pruneGameplaySessionLogs(
  projectRoot: string,
  budgetBytes = GAMEPLAY_SESSION_LOG_BUDGET_BYTES,
): Promise<string[]> {
  const logsDir = join(projectRoot, 'logs');
  const files = (await readdir(logsDir).catch(() => []))
    .filter((file) => file.startsWith('play-') && file.endsWith('.jsonl'))
    .sort();
  const sized = await sizedFiles(logsDir, files);
  let total = sized.reduce((sum, value) => sum + value.bytes, 0);
  const removed: string[] = [];
  for (const value of sized.slice(0, -1)) {
    if (total <= budgetBytes) break;
    const clipRemoved = await unlinkIfPresent(
      join(projectRoot, '.vgai', 'recordings', `${value.file.slice(0, -'.jsonl'.length)}.webm`),
    );
    if (!clipRemoved) continue;
    await removeReplaySidecar(
      join(projectRoot, '.vgai', 'recordings'),
      value.file.slice(0, -'.jsonl'.length),
    );
    const logRemoved = await unlinkIfPresent(join(logsDir, value.file));
    if (!logRemoved) continue;
    total -= value.bytes;
    removed.push(value.file);
  }
  return removed;
}

/** Prune only automatic clips paired by stem with a durable session log.
 * Named recordings are caller-owned keepsakes and never enter this pool. The
 * log remains when its optional clip is evicted, so Analytics history stays. */
export async function pruneGameplaySessionClips(
  projectRoot: string,
  budgetBytes = GAMEPLAY_SESSION_CLIP_BUDGET_BYTES,
): Promise<string[]> {
  const logsDir = join(projectRoot, 'logs');
  const recordingsDir = join(projectRoot, '.vgai', 'recordings');
  const logStems = new Set(
    (await readdir(logsDir).catch(() => []))
      .filter((file) => file.startsWith('play-') && file.endsWith('.jsonl'))
      .map((file) => file.slice(0, -'.jsonl'.length)),
  );
  const files = (await readdir(recordingsDir).catch(() => []))
    .filter((file) => file.endsWith('.webm') && logStems.has(file.slice(0, -'.webm'.length)))
    .sort();
  const sized = await Promise.all(
    (await sizedFiles(recordingsDir, files)).map(async (value) => ({
      ...value,
      bytes:
        value.bytes +
        (await pathBytes(join(recordingsDir, `${value.file.slice(0, -'.webm'.length)}.replay`))),
    })),
  );
  let total = sized.reduce((sum, value) => sum + value.bytes, 0);
  const removed: string[] = [];
  for (const value of sized.slice(0, -1)) {
    if (total <= budgetBytes) break;
    const logFile = join(logsDir, `${value.file.slice(0, -'.webm'.length)}.jsonl`);
    const evictedAt = Date.now();
    const recorded = await appendFile(
      logFile,
      `${JSON.stringify({
        t: evictedAt,
        level: 'info',
        source: 'gameplay-recording',
        msg: 'evicted',
        meta: {
          file: value.file,
          bytes: value.bytes,
          reason: 'managed-clip-byte-budget',
          evictedAt,
        },
      })}\n`,
      'utf-8',
    )
      .then(() => true)
      .catch(() => false);
    if (!recorded) continue;
    const deleted = await unlink(join(recordingsDir, value.file))
      .then(() => true)
      .catch(() => false);
    if (!deleted) continue;
    await removeReplaySidecar(recordingsDir, value.file.slice(0, -'.webm'.length));
    total -= value.bytes;
    removed.push(value.file);
  }
  return removed;
}
