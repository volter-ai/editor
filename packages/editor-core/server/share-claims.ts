import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ShareGatewayClaims {
  participantId: string;
  invitationId: string;
  credentialId: string;
  role: 'viewer' | 'commenter' | 'tester' | 'editor' | 'terminal';
  account: { id: string; email: string; name?: string };
}

const CLAIM_HEADERS = [
  'x-vgai-share-participant-id',
  'x-vgai-share-invitation-id',
  'x-vgai-share-credential-id',
  'x-vgai-share-role',
  'x-vgai-share-account-id',
  'x-vgai-share-account-email',
  'x-vgai-share-account-name',
  'x-vgai-share-signed-at',
  'x-vgai-share-signature',
] as const;

export const shareClaimHeaders: readonly string[] = CLAIM_HEADERS;

function payload(
  method: string,
  url: string,
  claims: ShareGatewayClaims,
  signedAt: string,
): string {
  return [
    method.toUpperCase(),
    url,
    claims.participantId,
    claims.invitationId,
    claims.credentialId,
    claims.role,
    claims.account.id,
    claims.account.email,
    claims.account.name ?? '',
    signedAt,
  ].join('\n');
}

function signature(secret: string, content: string): string {
  return createHmac('sha256', secret).update(content).digest('base64url');
}

export function signedShareClaimHeaders(
  secret: string,
  method: string,
  url: string,
  claims: ShareGatewayClaims,
  now: number = Date.now(),
): Record<string, string> {
  const signedAt = String(now);
  return {
    'x-vgai-share-participant-id': claims.participantId,
    'x-vgai-share-invitation-id': claims.invitationId,
    'x-vgai-share-credential-id': claims.credentialId,
    'x-vgai-share-role': claims.role,
    'x-vgai-share-account-id': claims.account.id,
    'x-vgai-share-account-email': claims.account.email,
    ...(claims.account.name
      ? { 'x-vgai-share-account-name': encodeURIComponent(claims.account.name) }
      : {}),
    'x-vgai-share-signed-at': signedAt,
    'x-vgai-share-signature': signature(secret, payload(method, url, claims, signedAt)),
  };
}

export function verifyShareClaimHeaders(
  secret: string,
  method: string,
  url: string,
  read: (name: string) => string | undefined,
  now: number = Date.now(),
): ShareGatewayClaims | null {
  const values = Object.fromEntries(CLAIM_HEADERS.map((name) => [name, read(name)?.trim()]));
  const any = CLAIM_HEADERS.some((name) => values[name]);
  if (!any) return null;
  const participantId = values['x-vgai-share-participant-id'];
  const invitationId = values['x-vgai-share-invitation-id'];
  const credentialId = values['x-vgai-share-credential-id'];
  const role = values['x-vgai-share-role'];
  const accountId = values['x-vgai-share-account-id'];
  const accountEmail = values['x-vgai-share-account-email'];
  const encodedName = values['x-vgai-share-account-name'];
  const signedAt = values['x-vgai-share-signed-at'];
  const supplied = values['x-vgai-share-signature'];
  if (
    !participantId ||
    participantId.length > 200 ||
    !invitationId ||
    invitationId.length > 200 ||
    !credentialId ||
    credentialId.length > 200 ||
    !role ||
    !['viewer', 'commenter', 'tester', 'editor', 'terminal'].includes(role) ||
    !accountId ||
    accountId.length > 200 ||
    !accountEmail ||
    accountEmail.length > 320 ||
    !signedAt ||
    !supplied
  )
    throw new Error('Invalid share gateway claims.');
  const signedAtMs = Number(signedAt);
  if (!Number.isSafeInteger(signedAtMs) || Math.abs(now - signedAtMs) > 30_000) {
    throw new Error('Expired share gateway claims.');
  }
  let name: string | undefined;
  if (encodedName) {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      throw new Error('Invalid share gateway claims.');
    }
    if (name.length > 200) throw new Error('Invalid share gateway claims.');
  }
  const claims: ShareGatewayClaims = {
    participantId,
    invitationId,
    credentialId,
    role: role as ShareGatewayClaims['role'],
    account: { id: accountId, email: accountEmail, ...(name ? { name } : {}) },
  };
  const expected = signature(secret, payload(method, url, claims, signedAt));
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid share gateway signature.');
  }
  return claims;
}
