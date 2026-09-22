export const DEFAULT_VGAI_ACCOUNT_URL = 'https://auth.videogame.ai';

/**
 * The editor ships with VGAI's managed identity boundary configured. The
 * account portal, the OAuth issuer, and the auth worker are ONE deployment, so
 * pointing the editor at a non-production instance (a dev Clerk-keyed worker, a
 * self-host) must move all three together.
 *
 * `VGAI_AUTH_URL` is the single knob for that: set it alone and the account and
 * issuer origins follow. Previously each of the three defaulted independently,
 * so setting only one silently left the other two on production — the exact
 * footgun that let a "dev" run authenticate against the live instance. The
 * per-endpoint variables still win when explicitly set, for the rare
 * split-origin self-host; `VGAI_OAUTH_CLIENT_ID` is unaffected.
 */
export function configureManagedAccountDefaults(): void {
  const base = process.env['VGAI_AUTH_URL']?.trim() || DEFAULT_VGAI_ACCOUNT_URL;
  process.env['VGAI_AUTH_URL'] = base;
  process.env['VGAI_ACCOUNT_URL'] ||= base;
  process.env['VGAI_OAUTH_ISSUER_URL'] ||= base;
  process.env['VGAI_OAUTH_CLIENT_ID'] ||= 'vgai-editor';
}
