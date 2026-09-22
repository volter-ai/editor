/**
 * `/__editor/collaboration/**` — the shared session as its PARTICIPANTS see
 * it: the roster and event stream, join/leave/presence, role changes, the
 * message thread (with edits, deletions and reactions), and the team-test
 * verbs.
 *
 * The authority question every route here asks is `collaborationActor`: who is
 * this request ALLOWED to act as. A gateway participant's id is derived from a
 * verified account, so a loopback request may not simply claim one — see
 * `assertLocalActorMayAct` below, which is the whole reason these two helpers
 * live beside the routes that use them rather than on the context.
 */

import { randomUUID } from 'node:crypto';
import type {
  CollaborationPresence,
  CollaborationRole,
  ParticipantKind,
} from '@volter/editor-sdk/session/collaboration-types';
import {
  isCollaborationAgentMention,
  isCollaborationCameraPose,
  TEAM_MESSAGE_LIMITS,
} from '@volter/editor-sdk/session/collaboration-types';
import type { Request, Response } from 'express';
import { type HarnessChatSnapshot, harnessChatUiState } from '../../src/harness-chat-types';
import { parseTeamMessageReferences } from '../collaboration-session';
import { type EditorServerRouter, setGatewayParticipantRole } from '../editor-server';
import { broadcast } from '../editor-sse';
import { isGatewayParticipantId } from '../share-session-gateway';
import { teamSafeAgentText } from '../team-agent-mirror';
import type { RouteContext } from './context';

function requestedHarnessMatches(snapshot: HarnessChatSnapshot, requestedHarness: string): boolean {
  if (requestedHarness.toLowerCase() === 'agent') {
    return snapshot.mode === 'control' && Boolean(snapshot.activeHarness);
  }
  const active = snapshot.sessions.find((session) => session.id === snapshot.activeSessionId);
  return (active?.harness ?? snapshot.activeHarness ?? '')
    .toLowerCase()
    .includes(requestedHarness.toLowerCase());
}

function directPromptPlan(snapshot: HarnessChatSnapshot): 'send' | 'steer' | 'unavailable' {
  const ui = harnessChatUiState(snapshot);
  if (ui.canSend) return 'send';
  if (ui.canSteer) return 'steer';
  return 'unavailable';
}

export function registerCollaborationRoutes(router: EditorServerRouter, ctx: RouteContext): void {
  const {
    collaborationOr400,
    currentCollaboration,
    currentCollaborationLocation,
    defaultCollaborationRole,
    harnessChat,
    markAgentTurnEnded,
    markAgentTurnRunning,
    postMirroredTeamMessages,
    teamMirror,
    trustedShareIdentity,
  } = ctx;

  /**
   * Loopback is the editor OWNER, not a free identity. It may act as any local
   * participant it likes, but never AS a remote one: a gateway participant's
   * id is derived from a verified account, and everything attributed to it —
   * messages, edits, role changes, audit records — reads as that person's act.
   * The local share host is the one account-bound id a loopback request may
   * still claim, because that id IS this editor's owner.
   */
  const assertLocalActorMayAct = (participantId: string): void => {
    if (participantId === ctx.localShareHost?.participantId) return;
    if (
      ctx.shareHost?.hasParticipant(participantId) ||
      // A gateway-minted id whose session record still carries its verified
      // account outlives the credential — a kicked participant's history is
      // still theirs, and a loopback caller may not speak as them.
      (isGatewayParticipantId(participantId) && currentCollaboration()?.accountIdFor(participantId))
    ) {
      throw new Error('That participant identity belongs to a remote share participant.');
    }
  };
  const collaborationActor = (req: Request, claimed: unknown): string => {
    if (typeof claimed !== 'string' || !claimed.trim())
      throw new Error('Expected participant identity.');
    const participantId = claimed.trim();
    const trusted = trustedShareIdentity(req);
    if (trusted && trusted.participantId !== participantId) {
      throw new Error('The authenticated share participant does not match the requested actor.');
    }
    if (trusted) return trusted.participantId;
    assertLocalActorMayAct(participantId);
    return participantId;
  };
  const collaborationError = (res: Response, error: unknown) => {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  };

  // ---- Worktree collaboration ----
  const collaborationRoles = new Set<CollaborationRole>([
    'viewer',
    'commenter',
    'tester',
    'editor',
    'terminal',
    'maintainer',
  ]);
  const collaborationKinds = new Set<ParticipantKind>(['human', 'agent']);

  router.get('/__editor/collaboration', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    if (typeof req.query['cursor'] === 'string') {
      res.json(collaboration.resume(Number(req.query['cursor'])));
      return;
    }
    res.json(collaboration.snapshot());
  });

  for (const channel of ['messages', 'revisions', 'audit'] as const) {
    router.get(`/__editor/collaboration/${channel}`, (req: Request, res: Response) => {
      const collaboration = collaborationOr400(res);
      if (!collaboration) return;
      const values = collaboration.snapshot()[channel];
      const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50));
      const before = Math.min(
        values.length,
        Math.max(0, Number(req.query['before']) || values.length),
      );
      const start = Math.max(0, before - limit);
      res.json({ items: values.slice(start, before), before: start || null, total: values.length });
    });
  }

  router.post('/__editor/collaboration/join', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body['participantId'] !== 'string' ||
      !body['participantId'].trim() ||
      typeof body['displayName'] !== 'string' ||
      !body['displayName'].trim() ||
      body['displayName'].length > 80 ||
      (body['kind'] !== undefined && !collaborationKinds.has(body['kind'] as ParticipantKind))
    ) {
      res.status(400).json({ error: 'Expected participantId, displayName, and an optional kind.' });
      return;
    }
    try {
      const participantId = collaborationActor(req, body['participantId']);
      res.json(
        collaboration.join({
          participantId,
          account: trustedShareIdentity(req)?.account ?? null,
          displayName:
            trustedShareIdentity(req)?.account.name ??
            trustedShareIdentity(req)?.account.email ??
            body['displayName'].trim(),
          kind: (body['kind'] as ParticipantKind | undefined) ?? 'human',
          role: defaultCollaborationRole(participantId, trustedShareIdentity(req)?.role),
          ephemeralRole: trustedShareIdentity(req) !== null,
          location: currentCollaborationLocation(),
        }),
      );
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/leave', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    try {
      const participantId = collaborationActor(
        req,
        (req.body as { participantId?: unknown } | undefined)?.participantId,
      );
      collaboration.leave(participantId);
      res.status(204).end();
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/presence', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const participantId = body['participantId'];
    const presence = body['presence'] as Record<string, unknown> | undefined;
    const isNullableString = (value: unknown) =>
      value === null || (typeof value === 'string' && value.length <= 1_000);
    const camera = presence?.['camera'];
    const gesture = presence?.['gesture'];
    const playtest = presence?.['playtest'];
    if (
      typeof participantId !== 'string' ||
      !presence ||
      !isNullableString(presence['document']) ||
      !isNullableString(presence['file']) ||
      !isNullableString(presence['oid']) ||
      !Array.isArray(presence['selection']) ||
      presence['selection'].length > 100 ||
      !presence['selection'].every((entry) => typeof entry === 'string' && entry.length <= 1_000) ||
      !(camera === null || isCollaborationCameraPose(camera)) ||
      !(
        gesture === null ||
        (typeof gesture === 'object' && gesture !== null && !Array.isArray(gesture))
      ) ||
      (gesture !== null && JSON.stringify(gesture).length > 16_384) ||
      !(
        playtest === undefined ||
        playtest === null ||
        (typeof playtest === 'object' &&
          playtest !== null &&
          !Array.isArray(playtest) &&
          typeof (playtest as Record<string, unknown>)['id'] === 'string' &&
          ((playtest as Record<string, unknown>)['id'] as string).length <= 1_000 &&
          ['starting', 'ready', 'error'].includes(
            String((playtest as Record<string, unknown>)['play']),
          ) &&
          ['not-declared', 'connecting', 'ready', 'error'].includes(
            String((playtest as Record<string, unknown>)['networking']),
          ) &&
          ((playtest as Record<string, unknown>)['roomName'] === null ||
            (typeof (playtest as Record<string, unknown>)['roomName'] === 'string' &&
              ((playtest as Record<string, unknown>)['roomName'] as string).length <= 1_000)) &&
          ((playtest as Record<string, unknown>)['problem'] === null ||
            (typeof (playtest as Record<string, unknown>)['problem'] === 'string' &&
              ((playtest as Record<string, unknown>)['problem'] as string).length <= 2_000)))
      )
    ) {
      res.status(400).json({ error: 'Invalid collaboration presence.' });
      return;
    }
    try {
      collaboration.updatePresence(
        collaborationActor(req, participantId),
        presence as unknown as CollaborationPresence,
      );
      res.status(204).end();
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/role', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body['actorId'] !== 'string' ||
      typeof body['participantId'] !== 'string' ||
      !collaborationRoles.has(body['role'] as CollaborationRole)
    ) {
      res.status(400).json({ error: 'Expected actorId, participantId, and a valid role.' });
      return;
    }
    try {
      const actorId = collaborationActor(req, body['actorId']);
      const participantId = body['participantId'];
      const role = body['role'] as CollaborationRole;
      // A gateway participant's role lives at the gateway. Setting it here
      // session-only would leave the tunnel authorizing the old capabilities.
      let warning: string | null = null;
      if (ctx.shareHost?.hasParticipant(participantId)) {
        warning = setGatewayParticipantRole({
          shareHost: ctx.shareHost,
          collaboration,
          actorId,
          participantId,
          role,
        }).warning;
      } else {
        collaboration.setRole(actorId, participantId, role);
      }
      // 2xx either way: the authoritative write landed. A warning names the
      // half that did not follow it rather than claiming the whole call failed.
      if (warning) res.status(200).json({ warning });
      else res.status(204).end();
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/message', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mentions = body['mentions'] ?? [];
    const references = body['references'] ?? [];
    if (
      typeof body['authorId'] !== 'string' ||
      typeof body['text'] !== 'string' ||
      body['text'].length === 0 ||
      body['text'].length > TEAM_MESSAGE_LIMITS.text ||
      !Array.isArray(mentions) ||
      mentions.length > TEAM_MESSAGE_LIMITS.mentions ||
      !mentions.every(
        (entry) => typeof entry === 'string' && entry.length <= TEAM_MESSAGE_LIMITS.mentionLength,
      ) ||
      !Array.isArray(references) ||
      references.length > TEAM_MESSAGE_LIMITS.references ||
      !(
        body['threadId'] === undefined ||
        body['threadId'] === null ||
        typeof body['threadId'] === 'string'
      )
    ) {
      res.status(400).json({ error: 'Expected authorId, text, mentions, and references.' });
      return;
    }
    try {
      const authorId = collaborationActor(req, body['authorId']);
      const message = collaboration.postMessage({
        authorId,
        text: body['text'],
        mentions,
        references: parseTeamMessageReferences(references, collaboration.snapshot().revision),
        threadId: typeof body['threadId'] === 'string' ? body['threadId'] : null,
      });
      res.json(message);
      const agentMention = mentions.find(isCollaborationAgentMention);
      if (agentMention) {
        collaboration.recordAgentInvocation(authorId, {
          messageId: message.id,
          revision: message.revision,
        });
        // Direct hand-off, deliberately not an editor-owned queue. Supercode
        // decides whether this is a new turn or mid-turn steering.
        void (async () => {
          try {
            let snapshot = await harnessChat.load(true);
            const requestedHarness = agentMention.toLowerCase();
            let newHarness: string | null = null;
            const activeMatches = requestedHarnessMatches(snapshot, requestedHarness);
            if (!activeMatches) {
              const existing =
                requestedHarness === 'agent'
                  ? (snapshot.sessions.find((session) => session.id === snapshot.activeSessionId) ??
                    snapshot.sessions[0])
                  : snapshot.sessions.find((session) =>
                      session.harness.toLowerCase().includes(requestedHarness),
                    );
              if (existing) {
                if (snapshot.availableActions.detach) {
                  snapshot = await harnessChat.actIntent({ action: 'detach' });
                }
                snapshot = await harnessChat.actIntent({ action: 'attach', key: existing.id });
                if (!snapshot.frame?.state.canResume) {
                  throw new Error(`The existing ${requestedHarness} session cannot be resumed.`);
                }
                snapshot = await harnessChat.actIntent({ action: 'resume' });
              } else {
                const harness = snapshot.harnesses.find(
                  (candidate) =>
                    candidate.installed &&
                    candidate.runtime !== 'unavailable' &&
                    (requestedHarness === 'agent' ||
                      candidate.id.toLowerCase().includes(requestedHarness)),
                );
                if (!harness || !snapshot.availableActions.start) {
                  throw new Error(`No ${requestedHarness} coding harness is ready.`);
                }
                newHarness = harness.id;
              }
            } else if (directPromptPlan(snapshot) === 'unavailable') {
              const harness = snapshot.harnesses.find(
                (candidate) =>
                  candidate.installed &&
                  candidate.runtime !== 'unavailable' &&
                  (requestedHarness === 'agent' ||
                    candidate.id.toLowerCase().includes(requestedHarness)),
              );
              if (!harness || !snapshot.availableActions.start) {
                throw new Error('No coding harness is ready for @agent.');
              }
              newHarness = harness.id;
            }
            const promptPlan = newHarness ? 'send' : directPromptPlan(snapshot);
            // The room asked, so this session may answer IN the room — once.
            // Recorded before the hand-off (a fast harness can settle before we
            // get the turn back) and against the pre-prompt transcript, which is
            // the baseline that keeps its previous answer out of the room.
            const mirrorBaseline = snapshot;
            teamMirror.requestedFromRoom(snapshot.activeSessionId, mirrorBaseline);
            const context = [
              {
                id: `team-message:${message.id}`,
                label: `Team Conversation at revision ${message.revision}`,
                detail: JSON.stringify(message.references),
              },
            ];
            if (promptPlan === 'steer') {
              await harnessChat.actIntent({ action: 'steer', text: message.text });
              return;
            }
            if (promptPlan !== 'send') {
              throw new Error('The coding harness cannot accept a prompt in its current state.');
            }
            const agentParticipantId = `agent:${snapshot.activeSessionId ?? newHarness ?? snapshot.activeHarness ?? requestedHarness}`;
            const pendingParticipant = !snapshot.activeSessionId;
            if (
              pendingParticipant &&
              !collaboration
                .snapshot()
                .participants.some(
                  (participant) => participant.participantId === agentParticipantId,
                )
            ) {
              collaboration.join({
                participantId: agentParticipantId,
                displayName: `${newHarness ?? snapshot.activeHarness ?? requestedHarness} chat`,
                kind: 'agent',
                role: collaboration.roleFor(agentParticipantId) ?? 'terminal',
                location: currentCollaborationLocation(),
                status: 'active',
              });
            }
            // Mark before dispatch: a fast harness can write files before its
            // first running snapshot reaches the editor subscription.
            markAgentTurnRunning(agentParticipantId);
            try {
              const next = await harnessChat.actIntent(
                newHarness
                  ? { action: 'new', harness: newHarness, text: message.text, context }
                  : { action: 'send', text: message.text, context },
              );
              if (next.activeSessionId !== snapshot.activeSessionId) {
                // The session id only exists once the harness starts; the ask is
                // still the room's, so it carries over to the id it landed on.
                teamMirror.requestedFromRoom(next.activeSessionId, mirrorBaseline);
              }
              postMirroredTeamMessages(next);
              if (next.turn.state !== 'running') markAgentTurnEnded(agentParticipantId);
              if (pendingParticipant) {
                const release = setTimeout(() => collaboration.leave(agentParticipantId), 2_500);
                release.unref?.();
              }
            } catch (error) {
              markAgentTurnEnded(agentParticipantId);
              if (pendingParticipant) collaboration.leave(agentParticipantId);
              throw error;
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const participantId = `agent:${agentMention.toLowerCase()}`;
            const joinedForError = !collaboration
              .snapshot()
              .participants.some((item) => item.participantId === participantId);
            if (joinedForError) {
              collaboration.join({
                participantId,
                displayName: `@${agentMention.toLowerCase()}`,
                kind: 'agent',
                role: 'terminal',
                location: currentCollaborationLocation(),
                status: 'needs-input',
              });
            }
            collaboration.postMessage({
              authorId: participantId,
              text: teamSafeAgentText(`Agent error: ${detail}`),
              references: [{ type: 'revision', revision: message.revision }],
            });
            if (joinedForError) collaboration.leave(participantId);
            broadcast('server-log', {
              level: 'error',
              message: `@agent could not start: ${detail}`,
            });
          }
        })();
      }
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.patch('/__editor/collaboration/messages/:id', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body['actorId'] !== 'string' || typeof body['text'] !== 'string') {
      res.status(400).json({ error: 'Expected actorId and text.' });
      return;
    }
    try {
      res.json(
        collaboration.editMessage(
          collaborationActor(req, body['actorId']),
          String(req.params['id'] ?? ''),
          body['text'],
        ),
      );
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.delete('/__editor/collaboration/messages/:id', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body['actorId'] !== 'string') {
      res.status(400).json({ error: 'Expected actorId.' });
      return;
    }
    try {
      res.json(
        collaboration.deleteMessage(
          collaborationActor(req, body['actorId']),
          String(req.params['id'] ?? ''),
        ),
      );
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/messages/:id/reactions', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body['actorId'] !== 'string' || typeof body['reaction'] !== 'string') {
      res.status(400).json({ error: 'Expected actorId and reaction.' });
      return;
    }
    try {
      res.json(
        collaboration.toggleMessageReaction(
          collaborationActor(req, body['actorId']),
          String(req.params['id'] ?? ''),
          body['reaction'],
        ),
      );
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/team-test', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body['participantId'] !== 'string') {
      res.status(400).json({ error: 'Expected participantId.' });
      return;
    }
    try {
      const participantId = collaborationActor(req, body['participantId']);
      const snapshot = collaboration.snapshot();
      const id = randomUUID();
      const playtest = {
        id,
        revision: snapshot.revision,
        seed: Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 8), 16),
        roomKey: `team:${id}`,
        startedBy: participantId,
        startedAt: new Date().toISOString(),
      };
      collaboration.startPlaytest(participantId, playtest);
      broadcast('team-test-start', playtest);
      res.json(playtest);
    } catch (error) {
      collaborationError(res, error);
    }
  });

  router.post('/__editor/collaboration/team-test/stop', (req: Request, res: Response) => {
    const collaboration = collaborationOr400(res);
    if (!collaboration) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body['participantId'] !== 'string' || typeof body['playtestId'] !== 'string') {
      res.status(400).json({ error: 'Expected participantId and playtestId.' });
      return;
    }
    try {
      const stopped = collaboration.stopPlaytest(
        collaborationActor(req, body['participantId']),
        body['playtestId'],
      );
      if (!stopped) {
        res.status(409).json({ error: 'That Team Test is not active.' });
        return;
      }
      broadcast('team-test-stop', { id: body['playtestId'] });
      res.status(204).end();
    } catch (error) {
      collaborationError(res, error);
    }
  });
}
