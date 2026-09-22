import type { CollaborationAccountSession } from './account-service';
import {
  type ShareAccountProjection,
  type ShareGrantRedemption,
  ShareGrantServiceError,
} from './share-session-gateway';

function accountOrganizations(
  value: unknown,
): NonNullable<ShareAccountProjection['organizations']> {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('Volter Editor collaboration grant returned invalid organization membership.');
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Volter Editor collaboration grant returned invalid organization membership.');
    }
    const organization = candidate as Record<string, unknown>;
    const domains = organization['domains'];
    if (
      typeof organization['id'] !== 'string' ||
      typeof organization['name'] !== 'string' ||
      typeof organization['role'] !== 'string' ||
      !Array.isArray(domains) ||
      domains.length > 50
    ) {
      throw new Error('Volter Editor collaboration grant returned invalid organization membership.');
    }
    return {
      id: organization['id'],
      name: organization['name'],
      ...(typeof organization['slug'] === 'string' ? { slug: organization['slug'] } : {}),
      role: organization['role'],
      domains: domains.map((domainValue) => {
        if (!domainValue || typeof domainValue !== 'object' || Array.isArray(domainValue)) {
          throw new Error('Volter Editor collaboration grant returned an invalid organization domain.');
        }
        const domain = domainValue as Record<string, unknown>;
        const enrollmentMode = domain['enrollmentMode'];
        if (
          typeof domain['name'] !== 'string' ||
          typeof domain['verified'] !== 'boolean' ||
          ![
            'manual_invitation',
            'automatic_invitation',
            'automatic_suggestion',
            'enterprise_sso',
          ].includes(String(enrollmentMode))
        ) {
          throw new Error('Volter Editor collaboration grant returned an invalid organization domain.');
        }
        return {
          name: domain['name'],
          verified: domain['verified'],
          enrollmentMode: enrollmentMode as NonNullable<
            ShareAccountProjection['organizations']
          >[number]['domains'][number]['enrollmentMode'],
        };
      }),
    };
  });
}

export async function createCollaborationAccountHandoff(
  account: CollaborationAccountSession,
  binding: { callbackUrl: string; sessionId: string; invitationId: string },
): Promise<{ authorizationUrl: string; deliveryAuthorization: string; expiresAt: number }> {
  const response = await fetch(`${account.authUrl}/collaboration/handoff`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(binding),
  });
  const body = (await response.json().catch(() => undefined)) as
    | {
        authorizationUrl?: unknown;
        deliveryAuthorization?: unknown;
        expiresAt?: unknown;
        error?: unknown;
      }
    | undefined;
  if (
    !response.ok ||
    typeof body?.authorizationUrl !== 'string' ||
    typeof body.deliveryAuthorization !== 'string' ||
    typeof body.expiresAt !== 'number'
  ) {
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `Volter Editor collaboration authorization failed (${response.status}).`,
    );
  }
  return {
    authorizationUrl: body.authorizationUrl,
    deliveryAuthorization: body.deliveryAuthorization,
    expiresAt: body.expiresAt,
  };
}

export async function deliverCollaborationInvitation(
  account: CollaborationAccountSession,
  input: {
    emailAddress: string;
    redirectUrl: string;
    callbackUrl: string;
    sessionId: string;
    invitationId: string;
    deliveryAuthorization: string;
    expiresAt: number;
  },
): Promise<{ id: string; status: string; emailAddress: string }> {
  const response = await fetch(`${account.authUrl}/collaboration/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => undefined)) as
    | { id?: unknown; status?: unknown; emailAddress?: unknown; error?: unknown }
    | undefined;
  if (
    !response.ok ||
    typeof body?.id !== 'string' ||
    typeof body.status !== 'string' ||
    typeof body.emailAddress !== 'string'
  ) {
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `Volter Editor collaboration invitation delivery failed (${response.status}).`,
    );
  }
  return { id: body.id, status: body.status, emailAddress: body.emailAddress };
}

export async function redeemCollaborationAccountGrant(
  authUrl: string,
  binding: { grant: string; sessionId: string; invitationId: string },
): Promise<ShareGrantRedemption> {
  // The gateway may try several live invitations against one grant, so
  // "this invitation does not own that grant" (4xx) has to stay separable from
  // "the account service never answered" — the second must not be reported as
  // a rejected grant to the person waiting on the callback page.
  let response: Response;
  try {
    response = await fetch(`${authUrl.replace(/\/$/, '')}/collaboration/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(binding),
    });
  } catch (error) {
    throw new ShareGrantServiceError(
      `Volter Editor collaboration grant redemption could not reach the account service: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (response.status >= 500) {
    throw new ShareGrantServiceError(
      `Volter Editor collaboration grant redemption failed (${response.status}).`,
    );
  }
  const body = (await response.json().catch(() => undefined)) as
    | {
        jti?: unknown;
        participant?: {
          id?: unknown;
          email?: unknown;
          name?: unknown;
          organizations?: unknown;
        };
        error?: unknown;
      }
    | undefined;
  if (
    !response.ok ||
    typeof body?.jti !== 'string' ||
    typeof body.participant?.id !== 'string' ||
    typeof body.participant.email !== 'string' ||
    (body.participant.name !== undefined && typeof body.participant.name !== 'string') ||
    !Array.isArray(body.participant.organizations)
  )
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `Volter Editor collaboration grant redemption failed (${response.status}).`,
    );
  return {
    jti: body.jti,
    participant: {
      id: body.participant.id,
      email: body.participant.email,
      ...(body.participant.name ? { name: body.participant.name } : {}),
      organizations: accountOrganizations(body.participant.organizations),
    },
  };
}
