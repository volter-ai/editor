import type {
  ProviderCredentialId,
  ProviderCredentialStatus,
  ProviderCredentialTestResult,
} from '@volter/editor-sdk/account';
import {
  type CredentialPersistence,
  createNativeCredentialStore,
  type NativeCredentialStore,
} from './native-credential-store';

interface ProviderCredentialDefinition {
  id: ProviderCredentialId;
  label: string;
  environmentVariable: string;
  test(key: string, signal: AbortSignal): Promise<Response>;
}

const checkedFetch = (input: string, init: RequestInit) => fetch(input, init);

export const PROVIDER_CREDENTIALS: readonly ProviderCredentialDefinition[] = [
  {
    id: 'fal',
    label: 'Fal',
    environmentVariable: 'FAL_KEY',
    test: (key, signal) =>
      checkedFetch('https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev', {
        headers: { Authorization: `Key ${key}` },
        signal,
      }),
  },
  {
    id: 'tripo',
    label: 'Tripo',
    environmentVariable: 'TRIPO_API_KEY',
    test: (key, signal) =>
      checkedFetch('https://api.tripo3d.ai/v2/openapi/user/balance', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal,
      }),
  },
  {
    id: 'worldlabs',
    label: 'World Labs',
    environmentVariable: 'WORLDLABS_API_KEY',
    test: (key, signal) =>
      checkedFetch('https://api.worldlabs.ai/marble/v1/worlds:list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'WLT-Api-Key': key },
        body: JSON.stringify({ page_size: 1 }),
        signal,
      }),
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    environmentVariable: 'OPENROUTER_API_KEY',
    test: (key, signal) =>
      checkedFetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${key}` },
        signal,
      }),
  },
] as const;

export interface ProviderCredentialStore {
  persistence(): Promise<CredentialPersistence>;
  read(provider: ProviderCredentialId): Promise<string | null>;
  write(provider: ProviderCredentialId, value: string): Promise<void>;
  delete(provider: ProviderCredentialId): Promise<void>;
}

export function createSystemProviderCredentialStore(
  native: NativeCredentialStore = createNativeCredentialStore(),
): ProviderCredentialStore {
  return {
    persistence: () => native.persistence(),
    read: (provider) => native.read(`provider:${provider}`),
    write: (provider, value) => native.write(`provider:${provider}`, value),
    delete: (provider) => native.delete(`provider:${provider}`),
  };
}

/**
 * What the account panel shows for a CONNECTED provider, kept beside the
 * secret rather than derived from it: the mask is the last four characters,
 * which the editor already renders in the browser, so it is not itself a
 * secret.
 */
export interface ProviderCredentialMarker {
  maskedKey: string;
  connectedAt: string;
}

/**
 * The non-secret record of WHICH providers have a key in the system store.
 * `EditorAccountService` backs this with `~/.vgai/account.json`, the file it
 * already owns; an unbacked service keeps it in memory for the process.
 */
export interface ProviderCredentialMarkerStore {
  read(): Promise<Partial<Record<ProviderCredentialId, ProviderCredentialMarker>>>;
  write(provider: ProviderCredentialId, marker: ProviderCredentialMarker | null): Promise<void>;
}

function memoryMarkerStore(): ProviderCredentialMarkerStore {
  const markers = new Map<ProviderCredentialId, ProviderCredentialMarker>();
  return {
    read: async () => Object.fromEntries(markers),
    write: async (provider, marker) => {
      if (marker) markers.set(provider, marker);
      else markers.delete(provider);
    },
  };
}

function definition(id: string): ProviderCredentialDefinition {
  const found = PROVIDER_CREDENTIALS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unsupported provider credential ${JSON.stringify(id)}.`);
  return found;
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (!key) throw new Error('API key is required.');
  if (key.length > 16_384) throw new Error('API key is too large.');
  return key;
}

function maskedKey(value: string): string {
  return value.length > 4 ? `••••${value.slice(-4)}` : '••••';
}

/**
 * Resolves provider-native BYOK credentials without creating a provider API
 * wrapper. The provider tools continue to call their native SDK/HTTP APIs and
 * read their conventional environment variables; this service owns only the
 * durable-secret boundary and deterministic source precedence.
 *
 * A SECRET IS READ AT THE MOMENT A JOB NEEDS IT, NEVER AT BOOT, AND ONLY FOR
 * THE PROVIDER THAT JOB NAMES. macOS prompts to unlock a Keychain item once
 * per item per calling binary per read, and `vgai edit` is a fresh process
 * every time, so a boot-time sweep of every provider is a stack of unlock
 * dialogs in front of someone who asked to open a project — and a model
 * project has no generation job at all. `ensure(provider)` is therefore THE
 * read: one item, memoised for the process, exporting that provider's
 * conventional environment variable at that moment. There is no `initialize`.
 *
 * "Is this provider configured?" is answered from the marker record above and
 * NEVER from a credential-manager read: `@napi-rs/keyring` exposes no
 * attributes-only call (`getPassword`, `getSecret` and `findCredentials` all
 * return the secret, which IS the prompt), so the account panel's reading
 * would otherwise be a stack of dialogs on every 30-second poll. Connecting
 * and disconnecting a key rewrite both the item and the marker; a real read
 * for a job refreshes the marker, so a key connected before the marker
 * existed heals into the record the first time it is used.
 */
export class ProviderCredentialService {
  private readonly environment = new Map<ProviderCredentialId, string>();
  private readonly stored = new Map<ProviderCredentialId, string>();
  private readonly storageProblems = new Map<ProviderCredentialId, string>();
  private readonly injected = new Set<ProviderCredentialId>();
  private readonly ensured = new Map<ProviderCredentialId, Promise<string | undefined>>();

  constructor(
    private readonly store: ProviderCredentialStore = createSystemProviderCredentialStore(),
    private readonly markers: ProviderCredentialMarkerStore = memoryMarkerStore(),
  ) {
    for (const provider of PROVIDER_CREDENTIALS) {
      const value = process.env[provider.environmentVariable]?.trim();
      if (value) {
        this.environment.set(provider.id, value);
        process.env[provider.environmentVariable] = value;
      }
    }
  }

  /**
   * THE credential read: one provider, one credential-manager call, memoised
   * for the process. Call it where a job needs the secret, never earlier.
   * An unknown provider id resolves to `undefined` rather than throwing —
   * `providerExecutionMode` asks about arbitrary provider names.
   */
  ensure(providerId: string): Promise<string | undefined> {
    const provider = PROVIDER_CREDENTIALS.find((candidate) => candidate.id === providerId);
    if (!provider) return Promise.resolve(undefined);
    const environment = this.environment.get(provider.id);
    if (environment !== undefined) return Promise.resolve(environment);
    let pending = this.ensured.get(provider.id);
    if (!pending) {
      pending = this.readStored(provider);
      this.ensured.set(provider.id, pending);
    }
    return pending;
  }

  /** `true` when the credential manager itself is holding the secrets, so a
   *  marker written now will still be true after a restart. */
  private async systemBacked(): Promise<boolean> {
    try {
      return (await this.store.persistence()) === 'system';
    } catch {
      return false;
    }
  }

  private async readStored(provider: ProviderCredentialDefinition): Promise<string | undefined> {
    try {
      const value = await this.store.read(provider.id);
      if (!value) {
        this.stored.delete(provider.id);
        // Only a store that is really holding secrets can say "absent";
        // a degraded one answers from memory and must not wipe the record.
        if (await this.systemBacked()) await this.markers.write(provider.id, null);
        return undefined;
      }
      this.stored.set(provider.id, value);
      process.env[provider.environmentVariable] = value;
      this.injected.add(provider.id);
      await this.remember(provider.id, value);
      return value;
    } catch {
      this.storageProblems.set(
        provider.id,
        'Secure credential storage is temporarily unavailable.',
      );
      return undefined;
    }
  }

  private async remember(provider: ProviderCredentialId, key: string): Promise<void> {
    if (!(await this.systemBacked())) return;
    await this.markers.write(provider, {
      maskedKey: maskedKey(key),
      connectedAt: new Date().toISOString(),
    });
  }

  /** Trusted Node-only value for a provider process launch. Never expose this
   * through an editor HTTP response or project-owned file. */
  credential(providerId: ProviderCredentialId): Promise<string | undefined> {
    return this.ensure(providerId);
  }

  async snapshot(): Promise<ProviderCredentialStatus[]> {
    const markers = await this.markers.read();
    let persistence: CredentialPersistence = 'session';
    try {
      persistence = await this.store.persistence();
    } catch {
      // The per-provider problem below remains visible. Session is the only
      // persistence level it is safe to claim when the backend cannot answer.
    }
    return PROVIDER_CREDENTIALS.map((provider) => {
      const environment = this.environment.get(provider.id);
      const key = environment ?? this.stored.get(provider.id);
      const masked = key !== undefined ? maskedKey(key) : markers[provider.id]?.maskedKey;
      const configured = masked !== undefined;
      return {
        provider: provider.id,
        label: provider.label,
        environmentVariable: provider.environmentVariable,
        configured,
        source: environment ? 'environment' : configured ? persistence : 'none',
        editable: environment === undefined,
        persistence,
        ...(masked ? { maskedKey: masked } : {}),
        ...(this.storageProblems.get(provider.id)
          ? { problem: this.storageProblems.get(provider.id) }
          : {}),
      } satisfies ProviderCredentialStatus;
    });
  }

  async set(providerId: ProviderCredentialId, value: string): Promise<ProviderCredentialStatus[]> {
    const provider = definition(providerId);
    if (this.environment.has(provider.id)) {
      throw new Error(
        `${provider.label} is controlled by ${provider.environmentVariable}. Remove that environment override and restart the editor before changing it here.`,
      );
    }
    const key = normalizeKey(value);
    await this.store.write(provider.id, key);
    this.storageProblems.delete(provider.id);
    this.stored.set(provider.id, key);
    process.env[provider.environmentVariable] = key;
    this.injected.add(provider.id);
    this.ensured.set(provider.id, Promise.resolve(key));
    await this.remember(provider.id, key);
    return this.snapshot();
  }

  async delete(providerId: ProviderCredentialId): Promise<ProviderCredentialStatus[]> {
    const provider = definition(providerId);
    if (this.environment.has(provider.id)) {
      throw new Error(
        `${provider.label} is controlled by ${provider.environmentVariable}. Remove that environment override and restart the editor to disable it.`,
      );
    }
    await this.store.delete(provider.id);
    this.storageProblems.delete(provider.id);
    this.stored.delete(provider.id);
    this.ensured.set(provider.id, Promise.resolve(undefined));
    if (this.injected.delete(provider.id)) delete process.env[provider.environmentVariable];
    await this.markers.write(provider.id, null);
    return this.snapshot();
  }

  async test(providerId: ProviderCredentialId): Promise<ProviderCredentialTestResult> {
    const provider = definition(providerId);
    const key = await this.ensure(provider.id);
    if (!key) throw new Error(`${provider.label} is not configured.`);
    let response: Response;
    try {
      response = await provider.test(key, AbortSignal.timeout(15_000));
    } catch {
      throw new Error(`Could not reach ${provider.label}.`);
    }
    if (!response.ok) {
      throw new Error(`${provider.label} rejected the credential (${response.status}).`);
    }
    if (provider.id === 'tripo') {
      const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
      if (body?.code !== 0) throw new Error(`${provider.label} rejected the credential.`);
    }
    return {
      provider: provider.id,
      ok: true,
      testedAt: new Date().toISOString(),
    };
  }
}
