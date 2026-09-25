/**
 * THE TEAM PLAYTEST — a collaborator with the `test` capability starts a
 * playtest, and this editor joins it (`@volter/editor-sdk/services`, a
 * `workspace.service` contribution): the snapshot's `activePlaytest` decides
 * whether this tab enters play with the team's seed and room key, and the
 * playtest's presence row reports the play and networking states back.
 *
 * It left `components/AppRoot.tsx` when Play left the host (WORK.md §The
 * workbench, P3b): the shell must not name Play to run one. Collaboration,
 * presence and the active networking adapter stay the host's and are reached
 * through the `@editor/*` alias.
 */

import { getActiveNetworking, subscribeActiveNetworking } from '@volter/editor-sdk/kit/authoring/active-systems';
import { connectCollaboration } from '@volter/editor-sdk/kit/collaboration-client';
import { reportCollaborationPresence } from '@volter/editor-sdk/kit/collaboration-presence';
import { EDITOR_PARTICIPANT_ID } from '@volter/editor-sdk/kit/editor-presence';
import { activePlaytest, enterPlayMode, exitPlayMode } from '../src/play/play-mode';

export const point = 'workspace.service';

export function start(): () => void {
  let requestedPlaytestId: string | null = null;
  const failedPlaytests = new Set<string>();
  let unsubscribeNetworking: (() => void) | null = null;
  let unsubscribeNetworkingReplacement: (() => void) | null = null;
  let subscribedNetworking = getActiveNetworking();
  const stopNetworking = () => {
    unsubscribeNetworking?.();
    unsubscribeNetworking = null;
    unsubscribeNetworkingReplacement?.();
    unsubscribeNetworkingReplacement = null;
    subscribedNetworking = null;
  };
  const disconnect = connectCollaboration((snapshot) => {
    const canTest =
      snapshot.participants
        .find((participant) => participant.participantId === EDITOR_PARTICIPANT_ID)
        ?.capabilities.includes('test') ?? false;
    const team = snapshot.activePlaytest;
    const active = activePlaytest();
    if (!canTest || !team) {
      requestedPlaytestId = null;
      stopNetworking();
      reportCollaborationPresence({ playtest: null });
      if (active?.mode === 'team') exitPlayMode();
      if (!team) failedPlaytests.clear();
      return;
    }
    if (active?.mode === 'team' && active.id === team.id) return;
    if (requestedPlaytestId === team.id) return;
    if (failedPlaytests.has(team.id)) return;
    requestedPlaytestId = team.id;
    reportCollaborationPresence({
      playtest: {
        id: team.id,
        play: 'starting',
        networking: 'connecting',
        roomName: null,
        problem: null,
      },
    });
    void enterPlayMode(team.seed, {
      mode: 'team',
      id: team.id,
      roomKey: team.roomKey,
      revision: team.revision,
      participantId: EDITOR_PARTICIPANT_ID,
    })
      .then(() => {
        if (requestedPlaytestId !== team.id) return;
        stopNetworking();
        const report = () => {
          const networking = getActiveNetworking();
          const state = networking?.getConnectionState?.();
          const room = networking?.getRoomInfo?.();
          reportCollaborationPresence({
            playtest: {
              id: team.id,
              play: 'ready',
              networking: !networking
                ? 'not-declared'
                : state === 'connected' && room
                  ? 'ready'
                  : state === 'error'
                    ? 'error'
                    : 'connecting',
              roomName: room?.roomName ?? null,
              problem: state === 'error' ? 'The game networking adapter reported an error.' : null,
            },
          });
        };
        const bindNetworking = () => {
          const networking = getActiveNetworking();
          if (networking !== subscribedNetworking) {
            unsubscribeNetworking?.();
            subscribedNetworking = networking;
            unsubscribeNetworking = networking?.subscribe(report) ?? null;
          }
          report();
        };
        unsubscribeNetworkingReplacement = subscribeActiveNetworking(bindNetworking);
        bindNetworking();
      })
      .catch((error) => {
        if (requestedPlaytestId !== team.id) return;
        requestedPlaytestId = null;
        failedPlaytests.add(team.id);
        reportCollaborationPresence({
          playtest: {
            id: team.id,
            play: 'error',
            networking: 'error',
            roomName: null,
            problem: error instanceof Error ? error.message : String(error),
          },
        });
      });
  });
  return () => {
    stopNetworking();
    disconnect();
  };
}
