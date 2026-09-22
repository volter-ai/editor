import type { TranscriptEntryModel } from '@volter-ai-dev/supercode-ui/core';
import { type HarnessChatSnapshot, harnessChatUiState } from '../src/harness-chat-types';

/**
 * THE LAW: the Team Conversation is a room of PEOPLE, and a coding agent speaks
 * in it only when the room asked it something. Worktree rooms and agent
 * sessions are PEERS (docs/ARCHITECTURE-CORE.md) — a session someone started in
 * a terminal is beside the room, not inside it, so its turns are nobody's
 * business there. The room's one way to ask is an `@agent`/`@claude`/`@codex`
 * mention, which is exactly the invocation `requestedFromRoom` records; without
 * that record `drain` returns nothing, however chatty the session is.
 *
 * Lifetime of a request: ONE answer. The room asked one question, so it gets
 * one reply and the session falls silent again — a mark that outlived the turn
 * would put a session invoked once at 9am back on the room's wall all
 * afternoon, which is the very complaint this scoping answers. Asking again is
 * the same cheap gesture that armed it the first time.
 *
 * Two deliberate consequences, stated so the next reader does not read them as
 * bugs:
 * - Errors post while a request is outstanding but do NOT close it: a
 *   recoverable mid-turn error must be visible in the room without eating the
 *   answer the room is still waiting for. If a request errors fatally and no
 *   answer ever comes, the mark stays armed and the session's NEXT final —
 *   which may have been typed in a terminal — posts once and closes it. One
 *   stray message from a session the room did invoke is the bound; silence
 *   about a failed ask is not.
 * - A request records the transcript's last answer as its BASELINE, so arming a
 *   long-running session never re-posts the answer it happened to be sitting on.
 */
export class TeamAgentMirror {
  /** Keyed by harness session id; present only while the room is owed a reply. */
  readonly #requests = new Map<
    string,
    { baselineFinalId: string | null; errorKey: string | null }
  >();

  /**
   * The room just asked this session for something. `baseline` is the snapshot
   * as it stood BEFORE the prompt was handed over — its last assistant message
   * is the one answer we must not mistake for the new one.
   */
  requestedFromRoom(sessionId: string | null | undefined, baseline: HarnessChatSnapshot): void {
    if (!sessionId) return;
    this.#requests.set(sessionId, {
      baselineFinalId: lastAssistantMessage(baseline)?.id ?? null,
      errorKey: null,
    });
  }

  /** The session is gone; it can no longer owe the room anything. */
  forget(sessionId: string): void {
    this.#requests.delete(sessionId);
  }

  /** What, if anything, this snapshot owes the room — already scrubbed. */
  drain(snapshot: HarnessChatSnapshot): readonly string[] {
    const sessionId = snapshot.activeSessionId;
    if (!sessionId || snapshot.mode === 'none') return [];
    const request = this.#requests.get(sessionId);
    if (!request) return [];
    const posts: string[] = [];
    if (snapshot.turn.state === 'idle') {
      const final = lastAssistantMessage(snapshot);
      if (final && final.id !== request.baselineFinalId) {
        this.#requests.delete(sessionId);
        posts.push(teamSafeAgentText(final.text));
      }
    }
    if (snapshot.error) {
      // Keyed by the error itself, not by revision: a stuck error is one event,
      // not one per snapshot bump. A repeat ask re-arms and may report it again.
      const key = `${snapshot.error.code}:${snapshot.error.message}`;
      if (request.errorKey !== key) {
        request.errorKey = key;
        posts.push(teamSafeAgentText(`Agent error: ${snapshot.error.message}`));
      }
    }
    return posts;
  }
}

function lastAssistantMessage(snapshot: HarnessChatSnapshot): TranscriptEntryModel | undefined {
  return [...harnessChatUiState(snapshot).transcript]
    .reverse()
    .find((entry) => entry.role === 'assistant');
}

/** Agent transcripts are written for the terminal; the room is a shared surface. */
export function teamSafeAgentText(value: string): string {
  return value
    .replace(/\/(?:Users|home)\/[^\s"']+/g, '[local path]')
    .replace(/\b(?:sk|pk|key|token)_[A-Za-z0-9_-]{12,}\b/gi, '[redacted credential]')
    .slice(0, 10_000);
}
