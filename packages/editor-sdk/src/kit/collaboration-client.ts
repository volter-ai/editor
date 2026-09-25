import type {
  CollaborationEvent,
  CollaborationPresence,
  CollaborationRole,
  CollaborationSnapshot,
  TeamMessage,
  TeamMessageReference,
  TeamPlaytest,
} from '@volter/editor-sdk/session/collaboration-types';
import { connectEvents, EDITOR_PARTICIPANT_ID, type EditorEventSource } from './editor-presence';
import { assertEditorServerAnswered } from '@volter/editor-sdk/kit/editor-server-response';
import { setCollaborationRevision } from '@volter/editor-sdk/kit/editor-session-attribution';

const BASE = '/__editor/collaboration';
const EVENT_CHANNELS = [
  'participants',
  'presence',
  'messages',
  'revisions',
  'audit',
  'team-test',
] as const;
let current: CollaborationSnapshot | null = null;
const listeners = new Set<(snapshot: CollaborationSnapshot) => void>();
const revisionListeners = new Set<(revision: number) => void>();
// High-water mark of already-published source revisions. Only a SOURCE
// revision advances `revision`; presence-only publishes reuse it. Tracked on
// EVERY publish (with or without revision listeners), so a subscriber's
// baseline is the current revision at subscribe time and it never fires
// retroactively for a revision already in effect.
let lastNotifiedRevision = 0;

function publish(snapshot: CollaborationSnapshot): void {
  current = snapshot;
  setCollaborationRevision(snapshot.revision);
  for (const listener of listeners) listener(snapshot);
  if (snapshot.revision > lastNotifiedRevision) {
    lastNotifiedRevision = snapshot.revision;
    for (const listener of revisionListeners) listener(snapshot.revision);
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  // 204 carries no body and so no content type; everything else here is JSON,
  // failures included. A shared session reaches this route through a TUNNEL,
  // where a page fallback is a live possibility rather than a theoretical one.
  if (response.status !== 204) {
    assertEditorServerAnswered(response, `Collaboration request ${path} failed`);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? body.error : `Collaboration request failed.`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export function collaborationSnapshot(): CollaborationSnapshot | null {
  return current;
}

let streamRelease: (() => void) | null = null;
let streamRefCount = 0;

/**
 * Connect ONCE to the shared editor SSE stream and drive `publish` from it,
 * ref-counted so every consumer — the collaboration panel AND a design
 * session subscribing for revision advances — shares ONE set of collaboration
 * listeners over the single page-lifetime `connectEvents()` socket. The last
 * release removes those listeners and closes its `connectEvents` handle.
 */
function acquireCollaborationStream(): () => void {
  streamRefCount++;
  if (!streamRelease) {
    const events: EditorEventSource = connectEvents();
    const onSnapshot = (event: MessageEvent) => {
      try {
        publish(JSON.parse(event.data) as CollaborationSnapshot);
      } catch {
        // A malformed event is ignored; the next complete snapshot repairs it.
      }
    };
    let refreshPending = false;
    const refresh = () => {
      if (refreshPending) return;
      refreshPending = true;
      void json<CollaborationSnapshot>('')
        .then(publish)
        .catch(() => {})
        .finally(() => {
          refreshPending = false;
        });
    };
    const onTypedEvent = (message: MessageEvent) => {
      try {
        const event = JSON.parse(message.data) as CollaborationEvent;
        if (!current || event.sequence <= current.sequence) return;
        if (event.channel !== 'presence') {
          refresh();
          return;
        }
        const payload = event.payload as { participantId?: unknown; presence?: unknown };
        if (typeof payload.participantId !== 'string' || !payload.presence) return;
        publish({
          ...current,
          sequence: event.sequence,
          participants: current.participants.map((participant) =>
            participant.participantId === payload.participantId
              ? { ...participant, presence: payload.presence as CollaborationPresence }
              : participant,
          ),
        });
      } catch {
        // The next snapshot or typed event repairs malformed transient input.
      }
    };
    events.addEventListener('collaboration-snapshot', onSnapshot);
    for (const channel of EVENT_CHANNELS) {
      events.addEventListener(`collaboration-${channel}`, onTypedEvent);
    }
    void json<CollaborationSnapshot>('')
      .then(publish)
      .catch(() => {});
    streamRelease = () => {
      events.removeEventListener('collaboration-snapshot', onSnapshot);
      for (const channel of EVENT_CHANNELS) {
        events.removeEventListener(`collaboration-${channel}`, onTypedEvent);
      }
      events.close();
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    streamRefCount--;
    if (streamRefCount <= 0) {
      streamRefCount = 0;
      streamRelease?.();
      streamRelease = null;
    }
  };
}

export function connectCollaboration(
  listener: (snapshot: CollaborationSnapshot) => void,
): () => void {
  listeners.add(listener);
  if (current) listener(current);
  const releaseStream = acquireCollaborationStream();
  return () => {
    listeners.delete(listener);
    releaseStream();
  };
}

/**
 * Fire `listener(revision)` whenever the collaboration snapshot's source
 * revision strictly ADVANCES — the reliable signal that a collaborator (or
 * this editor) changed project source, delivered over the same SSE stream
 * presence rides rather than the fragile HMR websocket. It ensures that
 * stream is connected, so a subscriber is self-sufficient even if the
 * collaboration panel never opened, and shares the single ref-counted
 * connection every other consumer uses (the last unsubscribe closes it). The
 * current revision is the baseline: a subscriber never fires for a revision
 * already in effect at subscribe time, only for a strictly greater one after.
 */
export function subscribeCollaborationRevision(listener: (revision: number) => void): () => void {
  revisionListeners.add(listener);
  const releaseStream = acquireCollaborationStream();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    revisionListeners.delete(listener);
    releaseStream();
  };
}

export async function updateCollaborationPresence(presence: CollaborationPresence): Promise<void> {
  await json<void>('/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: EDITOR_PARTICIPANT_ID, presence }),
  });
}

export async function postTeamMessage(
  text: string,
  options: {
    mentions?: readonly string[];
    references?: readonly TeamMessageReference[];
    threadId?: string | null;
  } = {},
): Promise<TeamMessage> {
  return json<TeamMessage>('/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authorId: EDITOR_PARTICIPANT_ID,
      text,
      mentions: options.mentions ?? [],
      references: options.references ?? [],
      threadId: options.threadId ?? null,
    }),
  });
}

export async function editTeamMessage(messageId: string, text: string): Promise<TeamMessage> {
  return json<TeamMessage>(`/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: EDITOR_PARTICIPANT_ID, text }),
  });
}

export async function deleteTeamMessage(messageId: string): Promise<TeamMessage> {
  return json<TeamMessage>(`/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: EDITOR_PARTICIPANT_ID }),
  });
}

export async function toggleTeamMessageReaction(
  messageId: string,
  reaction: string,
): Promise<TeamMessage> {
  return json<TeamMessage>(`/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: EDITOR_PARTICIPANT_ID, reaction }),
  });
}

export async function setCollaborationRole(
  participantId: string,
  role: CollaborationRole,
): Promise<void> {
  await json<void>('/role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: EDITOR_PARTICIPANT_ID, participantId, role }),
  });
}

export async function startTeamTest(): Promise<TeamPlaytest> {
  return json('/team-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId: EDITOR_PARTICIPANT_ID }),
  });
}

export async function stopTeamTest(playtestId: string): Promise<void> {
  await json<void>('/team-test/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId: EDITOR_PARTICIPANT_ID,
      playtestId,
    }),
  });
}
