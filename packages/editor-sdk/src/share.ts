/**
 * THE share-session wire — `/__editor/share-control`'s payloads, declared once.
 *
 * This route has three clients living in three different compilation units:
 * the editor SERVER that serves it (`packages/editor/server/`), the browser
 * PANEL that polls it (`packages/editor/src/`), and the `vgai share` CLI
 * (`packages/vgai-cli/src/`). Each of them used to declare its own copy of the
 * payload, and the copies had already drifted — silently, in both directions,
 * because an under-declared read of a JSON superset is a type error nowhere:
 *
 *   - the CLI's invitation had no `delivery`, so `vgai share` could not report
 *     that the invitation email had FAILED to send — the one state the field
 *     exists for;
 *   - the CLI's audit rows typed `type` and `capability` as bare `string`,
 *     which accepts any spelling of an event the server never emits;
 *   - the browser panel's invitation had no `inviterAccountId`;
 *   - the browser panel had no `audit` at all, and re-declared the tunnel
 *     health shape inline instead of naming it.
 *
 * This package is the right home for all three: `@vgai/editor` and `@vgai/cli`
 * both already depend on it, it depends on neither, and the CLI's esbuild
 * bundle inlines it. (The CLI's standing "no editor-package dependency" rule is
 * about `@vgai/editor` — the server+UI package whose express/vite/chokidar
 * graph the standalone bundle must not drag in. This is a types-only module.)
 *
 * Two things deliberately stay OFF this wire, and stay off it structurally
 * rather than by memory:
 *
 *   - the invitation TOKEN HASH, which is a local extension on the server
 *     (`share-host.ts`'s `StoredShareInvitation extends ShareInvitationRecord`);
 *   - a participant's ORGANIZATION list, which the gateway holds on its own
 *     `ShareAccountProjection` to resolve team invitations. {@link ShareAccount}
 *     is what a participant projects to, so `status()` narrows to it.
 */

/**
 * A share role, least authority first.
 *
 * `maintainer` is deliberately absent: it is local-only and has no share role,
 * which is why the editor's `CollaborationRole` is this union PLUS `maintainer`
 * rather than the other way around.
 */
export type ShareRole = 'viewer' | 'commenter' | 'tester' | 'editor' | 'terminal';

export type ShareTunnelProvider = 'cloudflared' | 'ngrok';

export type ShareTunnelState = 'stopped' | 'starting' | 'healthy' | 'failed';

export interface ShareTunnelHealth {
  checkedAt: string;
  latencyMs: number;
}

/**
 * The capability vocabulary a grant is checked against.
 *
 * Wider than the roles on purpose: `public` and `never-share` are DECLARATIONS
 * a route makes about itself, and `maintain` is the local-only authority no
 * share role reaches — so this union is not derivable from {@link ShareRole}.
 */
export type ShareCapability =
  | 'public'
  | 'view'
  | 'comment'
  | 'test'
  | 'edit'
  | 'terminal'
  | 'maintain'
  | 'never-share';

/** A verified VGAI account, as a share participant projects onto the wire. */
export interface ShareAccount {
  id: string;
  email: string;
  name?: string;
}

/**
 * How the invitation was DELIVERED, when we delivered it.
 *
 * Present-and-`failed` is the state this field exists for: an invitation
 * created whose email never left is otherwise indistinguishable, on every
 * surface, from one that arrived.
 */
export interface ShareInvitationDelivery {
  channel: 'clerk-email';
  status: 'sent' | 'failed';
  providerInvitationId?: string;
  sentAt?: string;
  problem?: string;
}

export interface ShareInvitationRecord {
  id: string;
  inviterAccountId: string;
  recipientAccountId?: string;
  recipientEmail?: string;
  recipientOrganizationId?: string;
  recipientOrganizationName?: string;
  recipientOrganizationDomain?: string;
  /** The highest role this invitation may ever be raised to. */
  roleCeiling: ShareRole;
  usePolicy: 'person' | 'team';
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  delivery?: ShareInvitationDelivery;
}

export interface ShareParticipant {
  participantId: string;
  account: ShareAccount;
  invitationId: string;
  role: ShareRole;
  roleCeiling: ShareRole;
  credentials: number;
  joined: boolean;
}

export type ShareAuditEventType =
  | 'auth-failed'
  | 'auth-started'
  | 'invite-redeemed'
  | 'capability-denied'
  | 'role-changed'
  | 'participant-kicked'
  | 'invitation-revoked'
  | 'terminal-invoked';

export interface ShareAuditEvent {
  at: string;
  type: ShareAuditEventType;
  invitationId?: string;
  participantId?: string;
  accountId?: string;
  capability?: ShareCapability;
  /** The role a `role-changed` event settled on. */
  role?: ShareRole;
}

/** The `/__editor/share-control/status` payload. */
export interface ShareStatus {
  active: boolean;
  sessionId: string;
  projectRoot: string;
  publicUrl?: string;
  tunnelProvider?: ShareTunnelProvider;
  tunnel: ShareTunnelState;
  health?: ShareTunnelHealth;
  invitations: readonly ShareInvitationRecord[];
  participants: readonly ShareParticipant[];
  audit: readonly ShareAuditEvent[];
  problem?: string;
}

/** The `/__editor/share-control/invitations` reply. */
export interface CreatedShareInvitation {
  invitation: ShareInvitationRecord;
  url: string;
}
