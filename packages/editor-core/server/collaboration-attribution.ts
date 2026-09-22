/**
 * WHO a change is attributed to, and what a participant is allowed to be.
 *
 * The agent-author lease is the load-bearing piece: a filesystem write made
 * while an agent turn is running is that agent's, and a turn that has ended
 * keeps a grace window so the write that lands a beat after the turn does not
 * get filed as the human's. `running` closes on the observed turn and stays
 * closed, so a later idle snapshot cannot re-open it.
 */

import type { CollaborationRole } from '@volter/editor-sdk/session/collaboration-types';
import type { CollaborationSession } from './collaboration-session';
import type { ShareHost } from './share-host';
import { isShareRole } from './share-session-gateway';

/**
 * How long an agent's authorship survives its turn. Long enough to cover the
 * write that lands a beat after the turn ends; short enough that the next
 * human edit is not filed as the agent's.
 */
export const AGENT_AUTHOR_LEASE_MS = 60_000;

export interface AgentAuthorLease {
  participantId: string;
  until: number;
  /** Open on an observed running turn; false once the turn's grace window is
   * all that is left, so a later idle snapshot cannot re-close it. */
  running: boolean;
}

/** The lease a freshly-observed running turn opens. */
export function agentAuthorLease(
  participantId: string,
  now: number = Date.now(),
): AgentAuthorLease {
  return { participantId, until: now + AGENT_AUTHOR_LEASE_MS, running: true };
}

/** Who a host-side filesystem write is credited to. `'host'` is the floor: an
 * expired lease is indistinguishable from no agent having been here at all. */
export function filesystemMutationAuthor(
  lease: Pick<AgentAuthorLease, 'participantId' | 'until'> | null,
  now: number = Date.now(),
): string {
  return lease && lease.until >= now ? lease.participantId : 'host';
}

/**
 * The role a LOOPBACK page joins (or rejoins) the room with.
 *
 * A remote participant never reaches this: its invitation role is a
 * connection-scoped ceiling supplied by the gateway. A loopback page is the
 * editor's owner — it already holds the checkout on disk — which is why it, and
 * only it, is the recovery for a room that has lost its last maintainer. That
 * room is otherwise unmanageable forever: handing 'maintain' back requires
 * 'maintain', and the last-maintainer guard only refuses DEMOTION, not the sole
 * maintainer closing their tab.
 */
export function localCollaborationRole(
  hasMaintainer: boolean,
  recalledRole: CollaborationRole | null,
): CollaborationRole {
  if (!hasMaintainer) return 'maintainer';
  return recalledRole ?? 'editor';
}

/**
 * THE role write for a participant who reached this editor through the share
 * gateway — used by `/__editor/share-control/participants/:id/role` and by
 * `/__editor/collaboration/role` alike.
 *
 * A gateway participant has exactly one durable role, and the gateway holds
 * it: `shareRoleAllows` gates every proxied request on the gateway's copy, and
 * the gateway's assigned-role map is what a re-redemption restores. The
 * session's copy is a projection for the UI — writing only the session moves
 * the badge while the tunnel keeps authorizing the old capabilities, and the
 * participant's next ephemeral re-join puts the old badge back.
 *
 * Order matters: the actor's authority is checked BEFORE the gateway is
 * touched, so an unauthorized caller cannot demote anyone by having the
 * session write fail afterwards.
 *
 * Everything that can refuse the change is therefore checked before EITHER
 * store moves. Past that point the gateway's write is the outcome, and the
 * session's projection can still fall behind it — most easily through the
 * session's own ephemeral ceiling, which is a snapshot of the gateway role the
 * participant last CONNECTED with, not of the invitation. Reporting that as a
 * failure would tell the caller nothing happened about a change that did
 * happen, so it returns a warning instead: the projection re-derives from the
 * gateway on the participant's next connection.
 */
export function setGatewayParticipantRole(input: {
  shareHost: Pick<ShareHost, 'setParticipantRole'>;
  collaboration: CollaborationSession | null;
  /** The participant performing the change, or null when the caller is the
   * local owner acting through private session control (no session actor). */
  actorId: string | null;
  participantId: string;
  role: CollaborationRole;
}): { warning: string | null } {
  const { shareHost, collaboration, actorId, participantId, role } = input;
  if (actorId !== null && collaboration && !collaboration.allows(actorId, 'maintain')) {
    throw new Error(`${actorId} does not have 'maintain' permission.`);
  }
  if (!isShareRole(role)) {
    throw new Error('The requested role exceeds this participant invitation ceiling.');
  }
  shareHost.setParticipantRole(participantId, role);
  // A gateway participant that redeemed but never opened the editor has no
  // session record to mirror into; the gateway's own role still moved.
  if (actorId === null || !collaboration?.allows(participantId, 'view')) return { warning: null };
  try {
    collaboration.setRole(actorId, participantId, role);
  } catch (error) {
    return {
      warning: `The share role is now ${role}, but this editor session still shows ${
        collaboration.roleFor(participantId) ?? 'no role'
      } until the participant reconnects: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { warning: null };
}
