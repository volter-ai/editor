import {
  type CollaborationAgentIdentity,
  type CollaborationSnapshot,
  collaborationParticipantColor,
  type ParticipantKind,
  type ParticipantStatus,
} from '@volter/editor-sdk/session/collaboration-types';
import type { EditorSession } from './session-registry';

export interface RepositoryParticipantPresence {
  participantId: string;
  displayName: string;
  kind: ParticipantKind;
  color: string;
  status: ParticipantStatus;
  lastSeenAt: string;
  agent: { harness: string; conversationId: string } | null;
  changeCount: number;
}

export interface RepositorySessionPresence {
  sessionId: string;
  repositoryId: string;
  worktreeId: string;
  branch: string | null;
  updatedAt: string;
  participants: RepositoryParticipantPresence[];
}

interface SessionIdentityResponse {
  session?: {
    sessionId?: unknown;
    repositoryId?: unknown;
    worktreeId?: unknown;
    projectRelativePath?: unknown;
    branch?: unknown;
    ephemeral?: unknown;
  };
}

function participantProjection(value: unknown): RepositoryParticipantPresence | null {
  if (!value || typeof value !== 'object') return null;
  const participant = value as Record<string, unknown>;
  const kind = participant['kind'];
  const participantId = participant['participantId'];
  const presence = participant['presence'];
  const gesture =
    presence && typeof presence === 'object'
      ? (presence as Record<string, unknown>)['gesture']
      : null;
  const gestureRecord = gesture && typeof gesture === 'object' ? gesture : null;
  const agent =
    kind === 'agent' ? participantAgent(participant['agent'], gestureRecord, participantId) : null;
  const status = participantStatus(participant['status'], kind, gestureRecord);
  if (
    typeof participantId !== 'string' ||
    typeof participant['displayName'] !== 'string' ||
    (kind !== 'human' && kind !== 'agent') ||
    !status ||
    typeof participant['lastSeenAt'] !== 'string' ||
    !Number.isFinite(Date.parse(participant['lastSeenAt']))
  ) {
    return null;
  }
  const color = participant['color'];
  return {
    participantId,
    displayName: kind === 'agent' ? (agent?.harness ?? 'Coding agent') : participant['displayName'],
    kind,
    color:
      typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
        ? color
        : collaborationParticipantColor(participantId),
    status,
    lastSeenAt: participant['lastSeenAt'],
    agent,
    changeCount: 0,
  };
}

function participantAgent(
  value: unknown,
  gesture: object | null,
  participantId: unknown,
): CollaborationAgentIdentity | null {
  if (value && typeof value === 'object') {
    const agent = value as Record<string, unknown>;
    if (typeof agent['harness'] === 'string' && typeof agent['conversationId'] === 'string') {
      return { harness: agent['harness'], conversationId: agent['conversationId'] };
    }
  }
  const harness = gesture ? (gesture as Record<string, unknown>)['harness'] : undefined;
  return typeof harness === 'string' && typeof participantId === 'string'
    ? { harness, conversationId: participantId }
    : null;
}

function participantStatus(
  value: unknown,
  kind: unknown,
  gesture: object | null,
): ParticipantStatus | null {
  if (value === 'active' || value === 'idle' || value === 'needs-input' || value === 'done') {
    return value;
  }
  if (kind === 'human') return 'active';
  if (kind !== 'agent') return null;
  const turn = gesture ? (gesture as Record<string, unknown>)['turn'] : undefined;
  if (turn === 'idle') return 'idle';
  if (turn === 'needs-input') return 'needs-input';
  return 'active';
}

async function readJson(
  url: string,
  fetchImpl: typeof fetch,
  controlSecret: string | null | undefined,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(3_000),
    ...(controlSecret ? { headers: { 'x-vgai-editor-control': controlSecret } } : {}),
  });
  if (!response.ok) throw new Error(`Session presence request failed (${response.status}).`);
  return response.json();
}

/** Build an ephemeral, browser-safe directory from live editor sessions. The
 * session registry supplies reachability; the serving process must repeat its
 * identity before any participant projection is accepted.
 *
 * Scope is the PROJECT — `(repositoryId, projectRelativePath)` — not the
 * repository alone. A repository id names the Git repo, and one repo can hold
 * many unrelated projects (this monorepo's template, every example, test
 * fixtures); matching on repositoryId alone put strangers editing a sibling
 * project into each other's collaborator lists. */
export async function repositoryPresenceDirectory(
  sessions: readonly EditorSession[],
  repositoryId: string,
  projectRelativePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RepositorySessionPresence[]> {
  const matching = sessions.filter(
    (session) =>
      session.sessionId &&
      session.repositoryId === repositoryId &&
      session.projectRelativePath === projectRelativePath &&
      session.worktreeId &&
      session.project,
  );
  const values = await Promise.all(
    matching.map(async (session): Promise<RepositorySessionPresence | null> => {
      try {
        const sessionId = session.sessionId;
        const worktreeId = session.worktreeId;
        if (!sessionId || !worktreeId) return null;
        const origin = `http://127.0.0.1:${session.port}`;
        const [identityValue, snapshotValue] = await Promise.all([
          readJson(`${origin}/__editor/project`, fetchImpl, session.controlSecret),
          readJson(`${origin}/__editor/collaboration`, fetchImpl, session.controlSecret),
        ]);
        const identity = identityValue as SessionIdentityResponse;
        const served = identity.session;
        if (
          served?.ephemeral === true ||
          served?.sessionId !== sessionId ||
          served.repositoryId !== repositoryId ||
          served.projectRelativePath !== projectRelativePath ||
          served.worktreeId !== worktreeId
        ) {
          return null;
        }
        const snapshot = snapshotValue as CollaborationSnapshot;
        if (!Array.isArray(snapshot.participants)) return null;
        const participants = snapshot.participants
          .map(participantProjection)
          .filter((participant): participant is RepositoryParticipantPresence =>
            Boolean(participant),
          )
          .map((participant) => ({
            ...participant,
            changeCount: Array.isArray(snapshot.revisions)
              ? snapshot.revisions.filter(
                  (revision) => revision.authorId === participant.participantId,
                ).length
              : 0,
          }));
        const updatedAt = participants.reduce(
          (latest, participant) =>
            Date.parse(participant.lastSeenAt) > Date.parse(latest)
              ? participant.lastSeenAt
              : latest,
          session.startedAt,
        );
        return {
          sessionId,
          repositoryId,
          worktreeId,
          branch: typeof served.branch === 'string' ? served.branch : null,
          updatedAt,
          participants,
        };
      } catch {
        return null;
      }
    }),
  );
  return values.filter((value): value is RepositorySessionPresence => value !== null);
}

/** One editor process can be polled by every collaborator. Share one bounded
 * directory read across those callers so the public projection does not fan
 * out twice per worktree for every browser independently. */
export function createRepositoryPresenceReader(options?: {
  ttlMs?: number;
  now?: () => number;
  read?: typeof repositoryPresenceDirectory;
}): (
  sessions: readonly EditorSession[],
  repositoryId: string,
  projectRelativePath: string,
) => Promise<RepositorySessionPresence[]> {
  const ttlMs = options?.ttlMs ?? 2_000;
  const now = options?.now ?? Date.now;
  const read = options?.read ?? repositoryPresenceDirectory;
  let cached:
    | {
        repositoryId: string;
        projectRelativePath: string;
        expiresAt: number;
        value: RepositorySessionPresence[] | null;
        pending: Promise<RepositorySessionPresence[]> | null;
      }
    | undefined;

  return async (sessions, repositoryId, projectRelativePath) => {
    if (
      cached?.repositoryId === repositoryId &&
      cached.projectRelativePath === projectRelativePath
    ) {
      if (cached.pending) return cached.pending;
      if (cached.value && now() < cached.expiresAt) return cached.value;
    }
    const entry = {
      repositoryId,
      projectRelativePath,
      expiresAt: 0,
      value: null as RepositorySessionPresence[] | null,
      pending: null as Promise<RepositorySessionPresence[]> | null,
    };
    const pending = read(sessions, repositoryId, projectRelativePath).then(
      (value) => {
        entry.value = value;
        entry.expiresAt = now() + ttlMs;
        entry.pending = null;
        return value;
      },
      (error) => {
        if (cached === entry) cached = undefined;
        throw error;
      },
    );
    entry.pending = pending;
    cached = entry;
    return pending;
  };
}
