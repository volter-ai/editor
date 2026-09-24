/**
 * The worktree board: which checkouts this repository has, which of them an
 * editor is serving, and the create / open / delegate / archive / stop verbs.
 */

import { assertEditorServerAnswered } from '@volter/editor-sdk/kit/editor-server-response';
import { BASE } from '@volter/editor-sdk/kit/api-base';
export interface EditorRepositoryParticipant {
  participantId: string;
  displayName: string;
  kind: 'human' | 'agent';
  color: string;
  status: 'active' | 'idle' | 'needs-input' | 'done';
  lastSeenAt: string;
  agent: { harness: string; conversationId: string } | null;
  changeCount: number;
}

export interface EditorRepositoryPresenceSession {
  sessionId: string;
  worktreeId: string;
  branch: string | null;
  updatedAt: string;
  participants: Array<
    Omit<EditorRepositoryParticipant, 'agent'> & { agent: { harness: string } | null }
  >;
}

export interface EditorRepositoryPresence {
  currentWorktreeId: string | null;
  sessions: EditorRepositoryPresenceSession[];
}

/** Browser-safe repository directory. Unlike worktree management, this is
 * available through a shared session and contains no host filesystem data. */
export async function getEditorRepositoryPresence(): Promise<EditorRepositoryPresence> {
  const response = await fetch(`${BASE}/repository-presence`, { cache: 'no-store' });
  // An empty presence is a MEASUREMENT ("nobody else is here"), so it may only
  // be returned when the editor server said so — never when a page fallback did.
  assertEditorServerAnswered(response, 'Could not read repository presence');
  if (!response.ok) return { currentWorktreeId: null, sessions: [] };
  const payload = (await response
    .json()
    .catch(() => null)) as Partial<EditorRepositoryPresence> | null;
  return {
    currentWorktreeId:
      typeof payload?.currentWorktreeId === 'string' ? payload.currentWorktreeId : null,
    sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
  };
}

export interface EditorWorktreeSession {
  sessionId: string | null;
  port: number;
  pid: number | null;
  presence?: {
    updatedAt: string;
    participants: EditorRepositoryParticipant[];
  };
}

export interface EditorWorktree {
  root: string;
  branch: string | null;
  headCommit: string | null;
  worktreeId: string;
  current: boolean;
  project: string | null;
  dirty: boolean;
  ahead: number | null;
  behind: number | null;
  locked: string | null;
  prunable: string | null;
  sessions: EditorWorktreeSession[];
}

export interface EditorBranch {
  name: string;
  headCommit: string;
  updatedAt: number;
  worktreeId: string | null;
  current: boolean;
}

export interface EditorWorktreeState {
  worktrees: EditorWorktree[];
  branches: EditorBranch[];
}

export interface EditorSessionWorktreeIdentity {
  branch: string | null;
  worktreeId: string | null;
}

/** The cheap, already-owned session identity used by persistent header chrome.
 * Repository-wide worktree inspection is intentionally a separate, on-demand
 * operation: asking Git for every checkout's status can take seconds in a
 * repository with many agent worktrees and must never sit on viewport boot. */
export async function getEditorSessionWorktreeIdentity(): Promise<EditorSessionWorktreeIdentity> {
  const response = await fetch(`${BASE}/project`, { cache: 'no-store' });
  assertEditorServerAnswered(response, 'Could not read this session’s worktree identity');
  if (!response.ok) return { branch: null, worktreeId: null };
  const payload = (await response.json().catch(() => null)) as {
    session?: { branch?: unknown; worktreeId?: unknown };
  } | null;
  return {
    branch: typeof payload?.session?.branch === 'string' ? payload.session.branch : null,
    worktreeId:
      typeof payload?.session?.worktreeId === 'string' ? payload.session.worktreeId : null,
  };
}

async function worktreeRequest(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}/worktrees${path}`, init);
  // Every verb below reports by returning, and `.json().catch(() => null)`
  // turned a page fallback into `{}` — an archive/stop/delegate that touched
  // nothing, answered with an empty worktree board.
  assertEditorServerAnswered(response, `Worktree operation ${path || '(list)'} failed`);
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.['error'] === 'string'
        ? payload['error']
        : `Worktree operation failed (${response.status}).`,
    );
  }
  return payload ?? {};
}

function parseEditorWorktreeState(payload: Record<string, unknown>): EditorWorktreeState {
  return {
    worktrees: Array.isArray(payload['worktrees'])
      ? (payload['worktrees'] as EditorWorktree[])
      : [],
    branches: Array.isArray(payload['branches']) ? (payload['branches'] as EditorBranch[]) : [],
  };
}

/** The harnesses supercode reports able to start a delegated task here. */
export async function listDelegateHarnesses(): Promise<Array<{ id: string; label: string }>> {
  const payload = await worktreeRequest('/harnesses');
  return Array.isArray(payload['harnesses'])
    ? (payload['harnesses'] as Array<{ id: string; label: string }>)
    : [];
}

export async function listEditorWorktrees(): Promise<EditorWorktreeState> {
  const payload = await worktreeRequest('');
  return parseEditorWorktreeState(payload);
}

export async function openEditorWorktree(
  worktreeId: string,
): Promise<{ url: string; status: string }> {
  return (await worktreeRequest('/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreeId }),
  })) as { url: string; status: string };
}

export async function createEditorWorktree(
  branch: string,
  from = 'HEAD',
): Promise<{ url: string; status: string }> {
  return (await worktreeRequest('/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch, from }),
  })) as { url: string; status: string };
}

export async function delegateEditorTask(input: {
  task: string;
  harness: string;
  isolation: 'worktree' | 'current';
  branch?: string;
  from?: string;
}): Promise<Record<string, unknown>> {
  return worktreeRequest('/delegate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function archiveEditorWorktree(worktreeId: string): Promise<EditorWorktree[]> {
  const payload = await worktreeRequest('/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreeId }),
  });
  return parseEditorWorktreeState(payload).worktrees;
}

export async function stopEditorWorktreeSession(
  worktreeId: string,
  sessionId: string,
): Promise<void> {
  await worktreeRequest('/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worktreeId, sessionId }),
  });
}
