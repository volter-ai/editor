import { assertEditorServerAnswered } from '@volter/editor-sdk/kit/editor-server-response';

export interface SourceConflictResource {
  path: string;
  revision: number;
  sha: string | null;
}

export interface SourceConflictNotice {
  id: string;
  conflictId: string;
  label: string;
  expectedRevision: number;
  currentRevision: number;
  conflicts: SourceConflictResource[];
  attempted: Record<string, string | null>;
  base: Record<string, string | null>;
  reapply?: (() => Promise<void>) | undefined;
}

const listeners = new Set<(notice: SourceConflictNotice | null) => void>();
let current: SourceConflictNotice | null = null;

export function sourceConflictNotice(): SourceConflictNotice | null {
  return current;
}

export function subscribeSourceConflict(
  listener: (notice: SourceConflictNotice | null) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearSourceConflict(): void {
  current = null;
  for (const listener of listeners) listener(null);
}

export async function handleProjectMutationFailure(
  response: Response,
  input: {
    label: string;
    attempted?: Record<string, string | null>;
    reapply?: () => Promise<void>;
  },
): Promise<never> {
  const payload = (await response.json().catch(() => null)) as {
    code?: unknown;
    conflictId?: unknown;
    error?: unknown;
    expectedRevision?: unknown;
    currentRevision?: unknown;
    conflicts?: unknown;
    bases?: unknown;
  } | null;
  if (
    response.status === 409 &&
    payload?.code === 'SOURCE_REVISION_CONFLICT' &&
    typeof payload.conflictId === 'string' &&
    Number.isInteger(payload.expectedRevision) &&
    Number.isInteger(payload.currentRevision) &&
    Array.isArray(payload.conflicts)
  ) {
    current = {
      id: globalThis.crypto?.randomUUID?.() ?? `conflict-${Date.now()}`,
      conflictId: payload.conflictId,
      label: input.label,
      expectedRevision: payload.expectedRevision as number,
      currentRevision: payload.currentRevision as number,
      conflicts: payload.conflicts as SourceConflictResource[],
      attempted: { ...(input.attempted ?? {}) },
      base:
        payload.bases && typeof payload.bases === 'object' && !Array.isArray(payload.bases)
          ? { ...(payload.bases as Record<string, string | null>) }
          : {},
      ...(input.reapply ? { reapply: input.reapply } : {}),
    };
    for (const listener of listeners) listener(current);
    throw new Error(
      `${input.label} conflicts with source revision ${current.currentRevision}; inspect it before reapplying.`,
    );
  }
  throw new Error(
    typeof payload?.error === 'string'
      ? payload.error
      : `${input.label} failed with HTTP ${response.status}.`,
  );
}

export async function resolveSourceConflict(
  notice: SourceConflictNotice,
  resources: Record<string, string | null>,
): Promise<void> {
  const { sourceMutationAttribution } = await import('@volter/editor-sdk/kit/editor-session-attribution');
  const response = await fetch('/__editor/source-conflict/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conflictId: notice.conflictId,
      resources: Object.entries(resources).map(([path, content]) => ({ path, content })),
      ...sourceMutationAttribution(),
    }),
  });
  // This function REPORTS BY RETURNING, so a page fallback (which is `ok`)
  // used to close the conflict banner over a resolution nobody applied.
  assertEditorServerAnswered(response, 'Conflict resolution failed');
  if (!response.ok) {
    if (response.status === 409) {
      await handleProjectMutationFailure(response, {
        label: 'Resolve source conflict',
        attempted: resources,
      });
    }
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `Conflict resolution failed (${response.status}).`,
    );
  }
}
