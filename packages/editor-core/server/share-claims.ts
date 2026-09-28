import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ShareGatewayClaims {
  participantId: string;
  invitationId: string;
  credentialId: string;
  role: 'viewer' | 'commenter' | 'tester' | 'editor' | 'terminal';
  account: { id: string; email: string; name?: string };
}

const CLAIM_HEADERS = [
  'x-volter-share-participant-id',
  'x-volter-share-invitation-id',
  'x-volter-share-credential-id',
  'x-volter-share-role',
  'x-volter-share-account-id',
  'x-volter-share-account-email',
  'x-volter-share-account-name',
  'x-volter-share-signed-at',
  'x-volter-share-signature',
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
    'x-volter-share-participant-id': claims.participantId,
    'x-volter-share-invitation-id': claims.invitationId,
    'x-volter-share-credential-id': claims.credentialId,
    'x-volter-share-role': claims.role,
    'x-volter-share-account-id': claims.account.id,
    'x-volter-share-account-email': claims.account.email,
    ...(claims.account.name
      ? { 'x-volter-share-account-name': encodeURIComponent(claims.account.name) }
      : {}),
    'x-volter-share-signed-at': signedAt,
    'x-volter-share-signature': signature(secret, payload(method, url, claims, signedAt)),
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
  const participantId = values['x-volter-share-participant-id'];
  const invitationId = values['x-volter-share-invitation-id'];
  const credentialId = values['x-volter-share-credential-id'];
  const role = values['x-volter-share-role'];
  const accountId = values['x-volter-share-account-id'];
  const accountEmail = values['x-volter-share-account-email'];
  const encodedName = values['x-volter-share-account-name'];
  const signedAt = values['x-volter-share-signed-at'];
  const supplied = values['x-volter-share-signature'];
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
