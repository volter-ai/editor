/**
 * THE WORKTREE'S GIT WIRE — status, stage, checkpoint, publish, pull request.
 *
 * It lived in `share-control-client.ts` because the editor server answers
 * these on the same `/__editor/share-control` prefix, and one file spelling
 * one prefix looked like one subject. It is not: moving a project's changes
 * into another checkout is what the worktree board does whether or not a
 * session is shared, and the only surface that ever called these is
 * `components/VersionControlSection.tsx`. The SHARE half of that file is the
 * collaboration lane's and lives in `@vgai/collaboration`.
 *
 * The status shape is declared ONCE, in `api/git-wire.ts`, which the editor
 * server and the `vgai` CLI read too.
 */

import { assertEditorServerAnswered, editorServerJson } from '@volter/editor-sdk/kit/editor-server-response';

export type { GitWorkflowStatus as EditorGitStatus } from '@volter/editor-sdk/kit/api-git-wire';

import type { GitWorkflowStatus as EditorGitStatus } from '@volter/editor-sdk/kit/api-git-wire';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/__editor/share-control${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  // A 204 carries no body and so no content type; every other answer on this
  // route is JSON, including its failures. These routes are reachable through
  // a TUNNEL, which is exactly where a page fallback stands in for the editor
  // server — a git operation must never read one as success.
  if (response.status !== 204) {
    assertEditorServerAnswered(response, `Git request ${path} failed`);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof body?.error === 'string' ? body.error : `Git request failed (${response.status}).`,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function editorGitStatus(): Promise<EditorGitStatus> {
  const response = await fetch('/__editor/git/status');
  return editorServerJson<EditorGitStatus>(response, 'Git status failed');
}

export function checkpointEditorGit(input: {
  paths: readonly string[];
  message: string;
}): Promise<EditorGitStatus> {
  return request('/git/checkpoint', { method: 'POST', body: JSON.stringify(input) });
}

export function publishEditorGit(signal?: AbortSignal): Promise<EditorGitStatus> {
  return request('/git/publish', { method: 'POST', ...(signal ? { signal } : {}) });
}

export function stageEditorGit(input: {
  path: string;
  staged: boolean;
  hunkId?: string;
}): Promise<EditorGitStatus> {
  return request('/git/stage', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchEditorGit(signal?: AbortSignal): Promise<EditorGitStatus> {
  return request('/git/fetch', { method: 'POST', ...(signal ? { signal } : {}) });
}

export function updateEditorGit(signal?: AbortSignal): Promise<EditorGitStatus> {
  return request('/git/update', { method: 'POST', ...(signal ? { signal } : {}) });
}

export function resolveEditorGitRebase(action: 'continue' | 'abort'): Promise<EditorGitStatus> {
  return request('/git/rebase', { method: 'POST', body: JSON.stringify({ action }) });
}

export function checkEditorGitReadiness(): Promise<{
  ready: boolean;
  reasons: string[];
  validation: string | null;
  status: EditorGitStatus;
}> {
  return request('/git/readiness', { method: 'POST' });
}

export function createEditorPullRequest(input: {
  title: string;
  body?: string;
}): Promise<{ url: string; status: EditorGitStatus }> {
  return request('/git/pull-request', { method: 'POST', body: JSON.stringify(input) });
}

export function editorPullRequestStatus(): Promise<{
  available: boolean;
  url?: string;
  state?: string;
  draft?: boolean;
  mergeState?: string;
  reviewDecision?: string;
  checks?: { total: number; pending: number; failed: number; passed: number };
  reason?: string;
}> {
  return request('/git/pull-request/status');
}

export function mergeEditorPullRequest(
  signal?: AbortSignal,
): Promise<{ url: string; merged: boolean }> {
  return request('/git/pull-request/merge', {
    method: 'POST',
    ...(signal ? { signal } : {}),
  });
}
