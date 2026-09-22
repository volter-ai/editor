import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { basename } from 'node:path';
import type {
  CreatedShareInvitation,
  ShareInvitationRecord,
  ShareParticipant,
  ShareStatus,
  ShareTunnelHealth,
} from '@volter/editor-sdk/share';
import { editorHmrPort } from '@volter/editor-project/manifest/editor-port';
import type { EditorAccountService } from './account-service';
import {
  createCollaborationAccountHandoff,
  deliverCollaborationInvitation,
  redeemCollaborationAccountGrant,
} from './collaboration-account-client';
import {
  createSessionShareGateway,
  type GatewayParticipant,
  type SessionShareGateway,
  type ShareRole,
} from './share-session-gateway';
import {
  type ShareTunnel,
  type ShareTunnelProvider,
  type ShareTunnelStarter,
  shareTunnelStarter,
} from './share-tunnel';

export type {
  CreatedShareInvitation,
  ShareInvitationRecord,
  ShareTunnelHealth,
} from '@volter/editor-sdk/share';
export type { ShareTunnel, ShareTunnelProvider, ShareTunnelStarter } from './share-tunnel';

export type ShareTunnelHealthProbe = (publicUrl: string) => Promise<ShareTunnelHealth>;

/**
 * Resolve a tunnel hostname through DNS-over-HTTPS when the SYSTEM resolver
 * cannot. Two real failure shapes make the system answer untrustworthy here:
 * a freshly-minted Quick Tunnel subdomain that has not propagated to the local
 * resolver yet, and — measured on a real network — a router/filtering resolver
 * that answers the `trycloudflare.com` APEX but silently drops its WILDCARD
 * subdomains. In both, the tunnel works for every REMOTE participant (their
 * resolvers are fine); only the host's own probe fails, and a probe that
 * fails closed on the host's resolver kills shares that would have worked.
 */
async function resolveOverDoH(hostname: string): Promise<string | null> {
  for (const resolver of ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve']) {
    try {
      const response = await fetch(`${resolver}?name=${encodeURIComponent(hostname)}&type=A`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        Answer?: Array<{ type?: number; data?: string }>;
      };
      const a = body.Answer?.find(
        (record) => record.type === 1 && /^\d+\.\d+\.\d+\.\d+$/.test(record.data ?? ''),
      );
      if (a?.data) return a.data;
    } catch {
      // Try the next public resolver; a null answer falls back to the
      // system-resolver error already recorded.
    }
  }
  return null;
}

/** HEAD the gateway health route on a KNOWN IP while keeping TLS honest:
 * `servername` carries the real hostname for SNI and certificate checks. */
function probeHealthViaAddress(
  hostname: string,
  address: string,
): Promise<{ ok: boolean; ready: boolean; status: number }> {
  return new Promise((resolveProbe, rejectProbe) => {
    const request = httpsRequest(
      {
        host: address,
        servername: hostname,
        headers: { host: hostname },
        path: '/__vgai_share/health',
        method: 'HEAD',
        timeout: 5_000,
      },
      (response) => {
        response.resume();
        resolveProbe({
          ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
          ready: response.headers['x-vgai-share-gateway'] === 'ready',
          status: response.statusCode ?? 0,
        });
      },
    );
    request.once('timeout', () => request.destroy(new Error('Health probe timed out.')));
    request.once('error', rejectProbe);
    request.end();
  });
}

async function defaultTunnelHealthProbe(publicUrl: string): Promise<ShareTunnelHealth> {
  let lastProblem = 'The public gateway did not answer.';
  const hostname = new URL(publicUrl).hostname;
  // Quick Tunnel prints its URL before the connector registration and DNS
  // edge are necessarily ready. Give that publication a short head start,
  // then probe long enough to distinguish propagation from a broken gateway.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  for (let attempt = 0; attempt < 10; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${publicUrl.replace(/\/$/, '')}/__vgai_share/health`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok && response.headers.get('x-vgai-share-gateway') === 'ready') {
        return {
          checkedAt: new Date().toISOString(),
          latencyMs: Math.max(0, Date.now() - startedAt),
        };
      }
      lastProblem = `The public gateway returned ${response.status}.`;
    } catch (error) {
      const cause =
        error instanceof Error ? (error.cause as NodeJS.ErrnoException | undefined) : undefined;
      lastProblem =
        error instanceof Error
          ? `${error.message}${cause?.code ? ` (${cause.code})` : ''}`
          : String(error);
      if (cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN') {
        // The host's resolver cannot see the name. Ask a public resolver and
        // probe the answered edge address directly — the verdict then reflects
        // what a REMOTE participant's network would see.
        const address = await resolveOverDoH(hostname);
        if (address) {
          const viaAddressStartedAt = Date.now();
          try {
            const result = await probeHealthViaAddress(hostname, address);
            if (result.ok && result.ready) {
              return {
                checkedAt: new Date().toISOString(),
                latencyMs: Math.max(0, Date.now() - viaAddressStartedAt),
              };
            }
            lastProblem = `The public gateway returned ${result.status}.`;
          } catch (addressError) {
            lastProblem = `${lastProblem}; via ${address}: ${
              addressError instanceof Error ? addressError.message : String(addressError)
            }`;
          }
        }
      }
    }
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Tunnel URL ${publicUrl} was published but failed its gateway health check: ${lastProblem}`,
  );
}

/**
 * The stored form adds the one field that must never cross the wire. Keeping it
 * as a local EXTENSION of the wire record is what makes that structural rather
 * than remembered: `publicInvitation` destructures `tokenHash` off and the
 * result is a `ShareInvitationRecord` by type, not by care.
 */
interface StoredShareInvitation extends ShareInvitationRecord {
  tokenHash: string;
}

/** `ShareHost.status()` IS the `/share-control/status` payload. */
export type ShareHostStatus = ShareStatus;

/**
 * A gateway participant narrowed to the wire.
 *
 * The gateway's own `account` is a `ShareAccountProjection` — the wire account
 * PLUS the organization list it needs to resolve a team invitation. Nothing on
 * the other side of this route has ever declared that list, let alone read it;
 * it was riding every status poll (and into the browser panel) purely because
 * `status()` handed the gateway's array through untouched. The narrowing here
 * is what makes {@link ShareAccountProjection}'s "server-local" claim true.
 */
function publicParticipant(participant: GatewayParticipant): ShareParticipant {
  const { organizations: _organizations, ...account } = participant.account;
  return { ...participant, account };
}

export class ShareHost {
  private gateway: SessionShareGateway | null = null;
  /** The single in-flight `start()`. Without it, two callers both clear the
   * `gateway && tunnel` guard during the awaits and each spawns a gateway and
   * a tunnel child — and the loser's cloudflared keeps running with nothing
   * holding a reference to kill it. */
  private starting: Promise<ShareHostStatus> | null = null;
  private tunnel: ShareTunnel | null = null;
  private tunnelProvider: ShareTunnelProvider | null = null;
  private tunnelState: ShareHostStatus['tunnel'] = 'stopped';
  private health: ShareTunnelHealth | undefined;
  private problem: string | undefined;
  private readonly invitations = new Map<string, StoredShareInvitation>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly targetPort: number,
    private readonly sessionId: string,
    private readonly account: EditorAccountService,
    private readonly projectRoot: () => string,
    private readonly claimSecret: string,
    private readonly startTunnelOverride?: ShareTunnelStarter,
    private readonly now: () => number = Date.now,
    private readonly defaultTunnelProvider: ShareTunnelProvider = 'cloudflared',
    private readonly probeTunnelHealth: ShareTunnelHealthProbe = defaultTunnelHealthProbe,
  ) {}

  async start(provider = this.defaultTunnelProvider): Promise<ShareHostStatus> {
    if (this.starting || (this.gateway && this.tunnel)) {
      if (provider !== this.tunnelProvider) {
        throw new Error(
          `This session already uses ${this.tunnelProvider}; revoke its invitations before switching tunnel providers.`,
        );
      }
      return this.starting ?? this.status();
    }
    // Set synchronously: a concurrent caller must see the provider it has to
    // match before this method's first await yields.
    this.tunnelProvider = provider;
    this.starting = this.startNow(provider);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startNow(provider: ShareTunnelProvider): Promise<ShareHostStatus> {
    const hostAccount = await this.account.collaborationAccountSession();
    this.tunnelState = 'starting';
    this.health = undefined;
    this.problem = undefined;
    // What the invitee sees on the join card: whose session this is, and which
    // project they are being let into.
    const projectName = basename(this.projectRoot());
    const hostName = hostAccount.user.name ?? hostAccount.user.email;
    const gateway = await createSessionShareGateway({
      targetPort: this.targetPort,
      hmrPort: Number(process.env['VGAI_HMR_PORT']) || editorHmrPort(this.targetPort),
      claimSecret: this.claimSecret,
      now: this.now,
      display: {
        ...(projectName ? { projectName } : {}),
        ...(hostName ? { hostName } : {}),
      },
    });
    let tunnel: ShareTunnel | null = null;
    try {
      const startedTunnel = await (this.startTunnelOverride ?? shareTunnelStarter(provider))(
        gateway.port,
      );
      tunnel = startedTunnel;
      this.gateway = gateway;
      this.tunnel = startedTunnel;
      this.health = await this.probeTunnelHealth(startedTunnel.publicUrl);
      this.tunnelState = 'healthy';
      startedTunnel.child.once('exit', () => void this.tunnelExited(startedTunnel.child));
      return this.status();
    } catch (error) {
      if (tunnel?.child.exitCode === null) tunnel.child.kill('SIGTERM');
      this.gateway = null;
      this.tunnel = null;
      await gateway.close();
      this.tunnelState = 'failed';
      this.health = undefined;
      this.problem = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async tunnelExited(child: ChildProcess): Promise<void> {
    if (this.tunnel?.child !== child) return;
    const gateway = this.gateway;
    this.gateway = null;
    this.tunnel = null;
    this.tunnelState = 'failed';
    this.problem = `${this.tunnelProvider ?? 'Share tunnel'} exited; all collaboration invitations were revoked.`;
    this.health = undefined;
    this.invitations.clear();
    await gateway?.close();
  }

  async createInvitation(input: {
    role: ShareRole;
    ttlMs: number;
    recipientAccountId?: string;
    recipientEmail?: string;
    recipientOrganizationId?: string;
    recipientOrganizationDomain?: string;
    usePolicy: 'person' | 'team';
    tunnelProvider?: ShareTunnelProvider;
  }): Promise<CreatedShareInvitation> {
    const host = await this.account.collaborationAccountSession();
    const organization = input.recipientOrganizationId
      ? host.user.organizations?.find((candidate) => candidate.id === input.recipientOrganizationId)
      : undefined;
    if (input.recipientOrganizationId && !organization) {
      throw new Error('The host is not a member of that Volter Editor organization.');
    }
    if (input.recipientOrganizationId && input.usePolicy !== 'team') {
      throw new Error('Organization invitations must be authenticated-team links.');
    }
    const organizationDomain = input.recipientOrganizationDomain?.trim().toLowerCase();
    if (
      organizationDomain &&
      !organization?.domains.some(
        (domain) => domain.verified && domain.name.toLowerCase() === organizationDomain,
      )
    ) {
      throw new Error(
        'Organization domain invitations require a domain Clerk reports as verified.',
      );
    }
    await this.start(input.tunnelProvider);
    const gateway = this.gateway;
    const publicUrl = this.tunnel?.publicUrl;
    if (!gateway || !publicUrl) throw new Error('The share tunnel is unavailable.');
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + input.ttlMs;
    const record: StoredShareInvitation = {
      id,
      inviterAccountId: host.user.id,
      ...(input.recipientAccountId ? { recipientAccountId: input.recipientAccountId } : {}),
      ...(input.recipientEmail
        ? { recipientEmail: input.recipientEmail.trim().toLowerCase() }
        : {}),
      ...(organization
        ? {
            recipientOrganizationId: organization.id,
            recipientOrganizationName: organization.name,
          }
        : {}),
      ...(organizationDomain ? { recipientOrganizationDomain: organizationDomain } : {}),
      roleCeiling: input.role,
      usePolicy: input.usePolicy,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      tokenHash: createHash('sha256').update(token).digest('base64url'),
    };
    gateway.addInvitation({
      id,
      token,
      role: input.role,
      expiresAt: expiresAtMs,
      ...(input.recipientAccountId ? { recipientAccountId: input.recipientAccountId } : {}),
      ...(input.recipientEmail ? { recipientEmail: input.recipientEmail } : {}),
      ...(organization ? { recipientOrganizationId: organization.id } : {}),
      ...(organizationDomain ? { recipientOrganizationDomain: organizationDomain } : {}),
      usePolicy: input.usePolicy,
      authorize: async () => {
        const current = await this.account.collaborationAccountSession();
        const handoff = await createCollaborationAccountHandoff(current, {
          callbackUrl: `${publicUrl}/__vgai_share/callback`,
          sessionId: this.sessionId,
          invitationId: id,
        });
        return handoff.authorizationUrl;
      },
      redeem: (grant) =>
        redeemCollaborationAccountGrant(host.authUrl, {
          grant,
          sessionId: this.sessionId,
          invitationId: id,
        }),
    });
    const invitationUrl = `${publicUrl}/#token=${encodeURIComponent(token)}`;
    if (record.recipientEmail) {
      try {
        const deliveryHandoff = await createCollaborationAccountHandoff(host, {
          callbackUrl: `${publicUrl}/__vgai_share/callback`,
          sessionId: this.sessionId,
          invitationId: id,
        });
        const delivered = await deliverCollaborationInvitation(host, {
          emailAddress: record.recipientEmail,
          redirectUrl: invitationUrl,
          callbackUrl: `${publicUrl}/__vgai_share/callback`,
          sessionId: this.sessionId,
          invitationId: id,
          deliveryAuthorization: deliveryHandoff.deliveryAuthorization,
          expiresAt: expiresAtMs,
        });
        record.delivery = {
          channel: 'clerk-email',
          status: 'sent',
          providerInvitationId: delivered.id,
          sentAt: new Date(this.now()).toISOString(),
        };
      } catch (error) {
        record.delivery = {
          channel: 'clerk-email',
          status: 'failed',
          problem: error instanceof Error ? error.message : String(error),
        };
      }
    }
    this.invitations.set(id, record);
    this.scheduleExpiry();
    return {
      invitation: this.publicInvitation(record),
      url: invitationUrl,
    };
  }

  async restart(
    provider = this.tunnelProvider ?? this.defaultTunnelProvider,
  ): Promise<ShareHostStatus> {
    await this.stop();
    return this.start(provider);
  }

  async revokeInvitation(invitationId: string): Promise<boolean> {
    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.revokedAt) return false;
    invitation.revokedAt = new Date(this.now()).toISOString();
    this.gateway?.revokeInvitation(invitationId);
    if (
      ![...this.invitations.values()].some(
        (item) => !item.revokedAt && Date.parse(item.expiresAt) > this.now(),
      )
    ) {
      await this.stop();
    } else {
      this.scheduleExpiry();
    }
    return true;
  }

  kickParticipant(participantId: string): number {
    return this.gateway?.kickParticipant(participantId) ?? 0;
  }

  /** Whether this id names a credentialed TUNNEL participant. The editor's
   * local collaboration routes ask this before deciding whether an id may be
   * acted on locally, and whose authority owns its role. */
  hasParticipant(participantId: string): boolean {
    return this.gateway?.hasParticipant(participantId) ?? false;
  }

  setParticipantRole(participantId: string, role: ShareRole): void {
    this.gateway?.setParticipantRole(participantId, role);
  }

  status(): ShareHostStatus {
    return {
      active: Boolean(this.gateway && this.tunnel),
      sessionId: this.sessionId,
      projectRoot: this.projectRoot(),
      ...(this.tunnel ? { publicUrl: this.tunnel.publicUrl } : {}),
      ...(this.tunnelProvider ? { tunnelProvider: this.tunnelProvider } : {}),
      tunnel: this.tunnelState,
      ...(this.health ? { health: this.health } : {}),
      invitations: [...this.invitations.values()].map((invitation) =>
        this.publicInvitation(invitation),
      ),
      participants: (this.gateway?.participants() ?? []).map(publicParticipant),
      audit: this.gateway?.audit() ?? [],
      ...(this.problem ? { problem: this.problem } : {}),
    };
  }

  private publicInvitation(invitation: StoredShareInvitation): ShareInvitationRecord {
    const { tokenHash: _tokenHash, ...record } = invitation;
    return { ...record };
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const nextExpiry = Math.min(
      ...[...this.invitations.values()]
        .filter(
          (invitation) => !invitation.revokedAt && Date.parse(invitation.expiresAt) > this.now(),
        )
        .map((invitation) => Date.parse(invitation.expiresAt)),
    );
    if (!Number.isFinite(nextExpiry)) {
      if (this.gateway || this.tunnel) void this.stop();
      return;
    }
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null;
        for (const invitation of this.invitations.values()) {
          if (!invitation.revokedAt && Date.parse(invitation.expiresAt) <= this.now()) {
            this.gateway?.revokeInvitation(invitation.id);
          }
        }
        this.scheduleExpiry();
      },
      Math.max(1, nextExpiry - this.now()),
    );
    this.expiryTimer.unref?.();
  }

  async stop(): Promise<void> {
    const tunnel = this.tunnel;
    const gateway = this.gateway;
    this.starting = null;
    this.tunnel = null;
    this.tunnelProvider = null;
    this.gateway = null;
    this.invitations.clear();
    this.tunnelState = 'stopped';
    this.health = undefined;
    this.problem = undefined;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (tunnel?.child.exitCode === null) tunnel.child.kill('SIGTERM');
    await gateway?.close();
  }
}
