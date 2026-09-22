/** Editor-owned durable Gameplay Session catalog and shared analytics cursor. */

import type {
  ToolContributionRecording,
  ToolContributionRecordingSnapshot,
  ToolGameplaySession,
  ToolGameplaySessions,
  ToolGameplaySessionsSnapshot,
} from '@volter/editor-sdk/contributions';
import { editorServerJson } from './editor-server-response';

let snapshot: ToolGameplaySessionsSnapshot = {
  sessions: [],
  selectedSessionId: null,
  selectedSession: null,
  cursorMs: 0,
  liveEdgeMs: 0,
  loading: true,
  error: null,
};
let followingLiveEdge = true;
let poll: number | null = null;
let requestedSessionId: string | null = null;
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;
const listeners = new Set<() => void>();

export interface GameplaySessionSelection {
  readonly sessionId: string | null;
  readonly latestAppeared: boolean;
}

/** Resolve one catalog refresh without confusing a deliberate history choice
 * with the arrival of a new Play interval. A newly-created latest session gets
 * focus exactly once; after it is known, the tester may select history and the
 * one-second poll preserves that choice. */
export function resolveGameplaySessionSelection(
  sessions: readonly Pick<ToolGameplaySession, 'id'>[],
  previousSessions: readonly Pick<ToolGameplaySession, 'id'>[],
  requestedId: string | null,
): GameplaySessionSelection {
  const latest = sessions[0] ?? null;
  const latestAppeared =
    latest !== null &&
    previousSessions.length > 0 &&
    !previousSessions.some((session) => session.id === latest.id);
  if (latestAppeared) return { sessionId: latest.id, latestAppeared: true };
  if (requestedId && sessions.some((session) => session.id === requestedId)) {
    return { sessionId: requestedId, latestAppeared: false };
  }
  return { sessionId: latest?.id ?? null, latestAppeared: false };
}

function publish(next: ToolGameplaySessionsSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** The catalog the session derives from the project's own play logs. */
async function fetchSessionCatalog(): Promise<ToolGameplaySession[]> {
  const response = await fetch('/__editor/gameplay-sessions');
  const data = await editorServerJson<{ sessions: ToolGameplaySession[] }>(
    response,
    'Could not load Gameplay Sessions',
  );
  return data.sessions;
}

async function fetchSessionDetail(id: string): Promise<ToolGameplaySession | null> {
  return editorServerJson<{ session: ToolGameplaySession }>(
    await fetch(`/__editor/gameplay-sessions/${encodeURIComponent(id)}`),
    'Could not load the selected Gameplay Session',
  ).then((detail) => detail.session);
}

async function refreshOnce(): Promise<void> {
  try {
    const data = { sessions: await fetchSessionCatalog() };
    const selection = resolveGameplaySessionSelection(
      data.sessions,
      snapshot.sessions,
      requestedSessionId,
    );
    const selectedId = selection.sessionId;
    if (selection.latestAppeared) followingLiveEdge = true;
    requestedSessionId = selectedId;
    const selected = selectedId ? await fetchSessionDetail(selectedId) : null;
    if (requestedSessionId !== selectedId) {
      refreshQueued = true;
      return;
    }
    const sessions = data.sessions.map((session) =>
      session.id === selected?.id ? selected : session,
    );
    const liveEdgeMs = selected?.durationMs ?? 0;
    const cursorMs = followingLiveEdge ? liveEdgeMs : Math.min(snapshot.cursorMs, liveEdgeMs);
    publish({
      sessions,
      selectedSessionId: selectedId,
      selectedSession: selected,
      cursorMs,
      liveEdgeMs,
      loading: false,
      error: null,
    });
  } catch (error) {
    publish({
      ...snapshot,
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function refresh(): Promise<void> {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }
  refreshInFlight = refreshOnce().finally(() => {
    refreshInFlight = null;
    if (refreshQueued) {
      refreshQueued = false;
      void refresh();
    }
  });
  return refreshInFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    poll = window.setInterval(() => void refresh(), 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && poll !== null) {
      window.clearInterval(poll);
      poll = null;
    }
  };
}

function select(sessionId: string): void {
  const selected = snapshot.sessions.find((session) => session.id === sessionId);
  if (!selected) return;
  requestedSessionId = selected.id;
  followingLiveEdge = true;
  publish({
    ...snapshot,
    selectedSessionId: selected.id,
    selectedSession: selected,
    cursorMs: selected.durationMs,
    liveEdgeMs: selected.durationMs,
  });
  void refresh();
}

function seek(realTimeMs: number): void {
  const cursorMs = Math.max(0, Math.min(realTimeMs, snapshot.liveEdgeMs));
  followingLiveEdge = snapshot.liveEdgeMs - cursorMs < 250;
  publish({ ...snapshot, cursorMs });
}

export const toolGameplaySessions: ToolGameplaySessions = {
  getSnapshot: () => snapshot,
  subscribe,
  select,
  seek,
  refresh,
};

/**
 * THE LIVE RECORDING's bounded visual index, as `workspace.analytics` tools
 * and the analytics header (`GameplaySessionTimeline`) read it — the
 * `ToolContributionRecording` transport of the SDK contract. The recorder
 * (Play's `gameplay-recording.ts`) PUBLISHES here; the full WebM remains the
 * recording artifact. Null while nothing records.
 */
let _recordingPreview: ToolContributionRecordingSnapshot | null = null;
const _recordingListeners = new Set<() => void>();

export const toolContributionRecording: ToolContributionRecording = {
  getSnapshot: () => _recordingPreview,
  subscribe(listener) {
    _recordingListeners.add(listener);
    return () => _recordingListeners.delete(listener);
  },
};

/** The recorder's publish: the current preview, or null once it stops. */
export function publishToolContributionRecording(
  snapshot: ToolContributionRecordingSnapshot | null,
): void {
  _recordingPreview = snapshot;
  for (const listener of _recordingListeners) {
    try {
      listener();
    } catch {
      // A project-owned observer may not break the editor-owned recorder.
    }
  }
}
