import { createNativeCredentialStore } from './native-credential-store';

/** Refreshable product credential kept outside project and ordinary config
 * files. Access tokens remain short-lived; the system credential store owns
 * the durable refresh credential. */
export interface AccountCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface AccountCredentialStore {
  read(): Promise<AccountCredential | null>;
  write(credential: AccountCredential): Promise<void>;
  delete(): Promise<void>;
}

function parseCredential(value: string | null): AccountCredential | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed['accessToken'] !== 'string') return null;
    return {
      accessToken: parsed['accessToken'],
      ...(typeof parsed['refreshToken'] === 'string'
        ? { refreshToken: parsed['refreshToken'] }
        : {}),
      ...(typeof parsed['expiresAt'] === 'string' ? { expiresAt: parsed['expiresAt'] } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Native system credential store: macOS Keychain, Windows Credential Manager,
 * or Linux Secret Service through @napi-rs/keyring. The optional dependency may be
 * absent on a headless host; that fallback is deliberately memory-only rather
 * than silently writing a bearer token into plaintext config.
 */
export function createSystemAccountCredentialStore(
  accountUrl: string | undefined,
): AccountCredentialStore {
  const account = accountUrl?.replace(/\/$/, '') || 'default';
  const native = createNativeCredentialStore();

  return {
    async read() {
      // Keep the historical account name so existing Keychain credentials
      // survive this store generalization.
      return parseCredential(await native.read(account));
    },
    async write(credential) {
      await native.write(account, JSON.stringify(credential));
    },
    async delete() {
      await native.delete(account);
    },
  };
}
