export type CredentialPersistence = 'system' | 'session';

export interface NativeCredentialStore {
  persistence(): Promise<CredentialPersistence>;
  read(account: string): Promise<string | null>;
  write(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/**
 * Normalized per-credential handle over `@napi-rs/keyring`'s `AsyncEntry` /
 * `Entry` classes. Restores keytar's calmer contract: a missing credential is
 * `null` / `false`, never an error.
 */
interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

type KeyringEntryFactory = (service: string, account: string) => KeyringEntry;

type KeyringLoader = () => Promise<unknown>;

interface RawKeyringEntry {
  getPassword(): unknown;
  setPassword(value: string): unknown;
  deleteCredential?(): unknown;
  deletePassword?(): unknown;
}

type RawEntryConstructor = new (service: string, account: string) => RawKeyringEntry;

/**
 * `keyring-rs` reports an absent credential as a NoEntry error. Message text
 * varies by binding/version: keyring-rs v2/v3 says "No matching entry found
 * in secure storage", while the actually-shipped `@napi-rs/keyring@^1.3.0`
 * native binary says "No matching credential found" (confirmed via `strings`
 * on the installed binary). keytar returned `null`/`false` for the same
 * situation; treat NoEntry as "not found", not as a broken credential manager,
 * regardless of which wording the binding uses.
 */
function isNoEntryError(error: unknown): boolean {
  return error instanceof Error && /no matching (entry|credential)/i.test(error.message);
}

function keyringApi(module: unknown): KeyringEntryFactory | null {
  if (!module || typeof module !== 'object') return null;
  const imported = module as Record<string, unknown>;
  const candidate =
    imported['default'] && typeof imported['default'] === 'object'
      ? (imported['default'] as Record<string, unknown>)
      : imported;
  // Prefer AsyncEntry (does not block the event loop); accept sync Entry too.
  const EntryConstructor = [candidate['AsyncEntry'], candidate['Entry']].find(
    (value): value is RawEntryConstructor =>
      typeof value === 'function' &&
      typeof (value as { prototype?: Record<string, unknown> }).prototype?.['getPassword'] ===
        'function' &&
      typeof (value as { prototype?: Record<string, unknown> }).prototype?.['setPassword'] ===
        'function',
  );
  if (!EntryConstructor) return null;
  return (service, account) => {
    const entry = new EntryConstructor(service, account);
    return {
      async getPassword() {
        try {
          const value = await entry.getPassword();
          return typeof value === 'string' ? value : null;
        } catch (error) {
          if (isNoEntryError(error)) return null;
          throw error;
        }
      },
      async setPassword(value) {
        await entry.setPassword(value);
      },
      async deletePassword() {
        try {
          const deleted =
            typeof entry.deleteCredential === 'function'
              ? await entry.deleteCredential()
              : await entry.deletePassword?.();
          return deleted !== false;
        } catch (error) {
          if (isNoEntryError(error)) return false;
          throw error;
        }
      },
    };
  };
}

/**
 * One editor-global secret boundary. Native builds use macOS Keychain,
 * Windows Credential Manager, or Linux Secret Service through
 * `@napi-rs/keyring`, the maintained native credential-store binding. A host
 * without that optional dependency is deliberately session-only: it never
 * turns a missing credential manager into a plaintext file.
 */
export function createNativeCredentialStore(
  service = 'ai.vgai.editor',
  loadKeyring: KeyringLoader = () => import('@napi-rs/keyring'),
): NativeCredentialStore {
  const memory = new Map<string, string>();
  let modulePromise: Promise<KeyringEntryFactory | null> | undefined;
  let degraded = false;
  const keyring = () => {
    modulePromise ??= loadKeyring()
      .then(keyringApi)
      .catch(() => null);
    return modulePromise;
  };

  return {
    async persistence() {
      return (await keyring()) && !degraded ? 'system' : 'session';
    },
    async read(account) {
      const native = await keyring();
      if (native && !degraded) {
        try {
          const value = await native(service, account).getPassword();
          if (value === null) memory.delete(account);
          else memory.set(account, value);
          return value;
        } catch {
          degraded = true;
        }
      }
      return memory.get(account) ?? null;
    },
    async write(account, value) {
      const native = await keyring();
      if (native && !degraded) {
        try {
          await native(service, account).setPassword(value);
          memory.set(account, value);
          return;
        } catch {
          degraded = true;
        }
      }
      memory.set(account, value);
    },
    async delete(account) {
      const native = await keyring();
      if (native) {
        try {
          await native(service, account).deletePassword();
        } catch {
          degraded = true;
          throw new Error(
            'The native credential manager could not confirm that the credential was deleted.',
          );
        }
      }
      memory.delete(account);
    },
  };
}
