// Editor-side client for the managed Clerk TWIN's Backend API — the placeholder IdP
// behind the managed relay/generation lane (see packages/vgai-auth). A developer signs
// in by minting a real, RS256-signed twin session token that `vgai-auth` verifies with
// its pinned key (`CLERK_JWT_KEY`); that token then authorizes managed generation
// (`/verify`) and relay-token bakes (`/relay/token`).
//
// PLACEHOLDER-SHAPED, DELIBERATELY: talking to the twin's Backend API directly from the
// editor is how identity is minted WHILE the IdP is the twin. When real Clerk replaces
// the twin, this whole module is replaced by Clerk's client sign-in (Frontend API +
// publishable key + hosted/embedded UI) — the editor must NEVER hold real Clerk Backend
// API (admin) access. The twin accepts any Bearer (it does not model the vendor's 401 on
// a bad key), so `secret` here is cosmetic request-shape parity, never a real credential.
//
// These are mechanical helpers over the twin's HTTP surface: each returns the twin's own
// data (an id, a jwt) and gets out of the way. No wrapper, no hidden state.

/** A durable twin identity: the user + the session tokens are minted from. */
export interface TwinIdentity {
  userId: string;
  sessionId: string;
}

const DEFAULT_TWIN_SECRET = 'sk_twin';

async function twinFetch(
  baseUrl: string,
  path: string,
  init: { method: string; body?: unknown },
  secret: string | undefined,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret ?? DEFAULT_TWIN_SECRET}`,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: init.method,
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * Resolve the twin user id for `email`, creating the user if absent. The twin's create
 * is not idempotent (a second create for the same email fails), so a non-2xx create
 * falls back to a lookup — exactly the get-or-create the twin's own browser bootstrap uses.
 */
export async function getOrCreateTwinUser(
  baseUrl: string,
  email: string,
  secret?: string,
): Promise<string> {
  const created = await twinFetch(
    baseUrl,
    '/v1/users',
    {
      method: 'POST',
      body: {
        email_address: [email],
      },
    },
    secret,
  );
  const createdId = (created.body as { id?: unknown } | undefined)?.id;
  if (created.ok && typeof createdId === 'string') return createdId;

  const listed = await twinFetch(
    baseUrl,
    `/v1/users?email_address=${encodeURIComponent(email)}`,
    { method: 'GET' },
    secret,
  );
  const first = Array.isArray(listed.body) ? (listed.body[0] as { id?: unknown }) : undefined;
  if (listed.ok && typeof first?.id === 'string') return first.id;

  throw new Error(
    `Twin sign-in: could not create or resolve a user for ${email} (${created.status}/${listed.status}).`,
  );
}

/** Open a twin session for a user and return its durable session id. */
export async function createTwinSession(
  baseUrl: string,
  userId: string,
  secret?: string,
): Promise<string> {
  const response = await twinFetch(
    baseUrl,
    '/v1/sessions',
    { method: 'POST', body: { user_id: userId } },
    secret,
  );
  const id = (response.body as { id?: unknown } | undefined)?.id;
  if (!response.ok || typeof id !== 'string') {
    throw new Error(`Twin sign-in: could not open a session (${response.status}).`);
  }
  return id;
}

/**
 * Mint a fresh, short-lived (≈60s) session token (a real RS256 JWT) from a durable
 * session id. Called on demand right before each downstream use — the token is never
 * stored; the SESSION is the durable handle.
 */
export async function mintTwinSessionToken(
  baseUrl: string,
  sessionId: string,
  secret?: string,
): Promise<string> {
  const response = await twinFetch(
    baseUrl,
    `/v1/sessions/${encodeURIComponent(sessionId)}/tokens`,
    { method: 'POST' },
    secret,
  );
  const jwt = (response.body as { jwt?: unknown } | undefined)?.jwt;
  if (!response.ok || typeof jwt !== 'string' || jwt.length === 0) {
    throw new Error(`Twin sign-in: could not mint a session token (${response.status}).`);
  }
  return jwt;
}

/** Get-or-create the user, then open a session — the durable identity a sign-in stores. */
export async function signInToTwin(
  baseUrl: string,
  email: string,
  secret?: string,
): Promise<TwinIdentity> {
  const userId = await getOrCreateTwinUser(baseUrl, email, secret);
  const sessionId = await createTwinSession(baseUrl, userId, secret);
  return { userId, sessionId };
}
