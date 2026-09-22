import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  type AccountCatalog,
  AccountCatalogSchema,
  type AccountOrganization,
  type AccountSnapshot,
  AccountSnapshotSchema,
  type AccountSpendPolicy,
  AccountSpendPolicySchema,
  type AccountUsageEntry,
  AccountUsageEntrySchema,
  type CodingInferenceSettings,
  CodingInferenceSettingsSchema,
  type EditorAccountSnapshot,
  type GenerationExecutionRoute,
  type ProviderCredentialId,
  type ProviderCredentialTestResult,
} from '@volter/editor-sdk/account';
import type { ProviderExecutionMode } from '@volter/editor-sdk/tools/provider-execution';
import {
  type AccountCredential,
  type AccountCredentialStore,
  createSystemAccountCredentialStore,
} from './account-credentials';
import {
  createMockGenerativeControlPlane,
  type MockGenerativeControlPlane,
  type MockGenerativeControlPlaneState,
} from './mock-control-plane';
import {
  createSystemProviderCredentialStore,
  type ProviderCredentialMarker,
  type ProviderCredentialMarkerStore,
  ProviderCredentialService,
  type ProviderCredentialStore,
} from './provider-credentials';
import { mintTwinSessionToken, signInToTwin } from './twin-auth';

interface PersistedAccount {
  version: 1;
  backend: 'mock' | 'live';
  userId?: string;
  email?: string;
  name?: string;
  /**
   * Managed-twin identity (the placeholder-IdP path of the `live` backend, active when
   * `VGAI_TWIN_URL` is set). The durable handle is the SESSION id, not a token: session
   * tokens are ≈60s-lived and re-minted on demand. See `twin-auth.ts`.
   */
  twinUserId?: string;
  twinSessionId?: string;
  /**
   * Managed service endpoints captured at sign-in. Persisted so a STANDALONE `vgai deploy`
   * (a separate process from the editor, with none of its env) can mint a fresh relay token
   * from the stored session and reach the relay-token endpoint — see
   * `packages/vgai-cli/src/managed-deploy-auth.ts`, the reader of these fields.
   */
  twinUrl?: string;
  accountUrl?: string;
  oauthIssuerUrl?: string;
  authUrl?: string;
  /**
   * NON-SECRET record of which provider keys are connected, and the mask the
   * account panel renders for each. It exists so "is Fal connected?" is
   * answerable without a credential-manager read — see
   * `provider-credentials.ts`'s header for why that read may never happen on
   * a boot or poll path.
   */
  providerCredentials?: Partial<Record<ProviderCredentialId, ProviderCredentialMarker>>;
  mockControlState?: MockGenerativeControlPlaneState;
  /** v1 migration only; moved into the OS credential store on first read. */
  accessToken?: string;
  planId?: 'free' | 'creator' | 'max' | 'ultra';
  planStatus?: 'active' | 'cancelling';
  planRenewsAt?: string;
  purchasedCredits?: number;
  spendPolicy?: AccountSpendPolicy;
  preferredRoute?: GenerationExecutionRoute;
  codingInference?: CodingInferenceSettings;
}

export interface ResolvedCodingInference {
  provider: 'openrouter';
  route: 'managed' | 'byok';
  /** The person's own stored account-panel choice, carried VERBATIM (never narrowed) so
   * the launch seam can gate on it. A coding harness runs on the login the person
   * already did unless this says `'managed'` or `'byok'`; `'auto'` is not a choice. */
  preferredRoute: GenerationExecutionRoute;
  model: string;
  /** OpenAI-compatible API root, including `/v1`. */
  baseUrl: string;
  /** Trusted process-launch credential. Never serialize this into the editor. */
  apiKey: string;
}

export interface CodingInferenceQuote {
  model: string;
  promptTokens: number;
  outputTokens: number;
  providerAmountUsd: number;
  estimatedCredits: number;
}

const DEFAULT_CODING_INFERENCE: CodingInferenceSettings = {
  enabled: false,
  provider: 'openrouter',
  model: 'z-ai/glm-5.2',
};

interface PendingBrowserAuthorization {
  verifier: string;
  redirectUri: string;
  expiresAt: string;
  status: 'pending' | 'complete' | 'failed';
  error?: string;
}

interface OAuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint?: string;
}

export interface CollaborationAccountSession {
  accessToken: string;
  authUrl: string;
  user: { id: string; email: string; name?: string; organizations?: AccountOrganization[] };
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

const ACCOUNT_PATH = process.env['VGAI_ACCOUNT_PATH']
  ? resolve(process.env['VGAI_ACCOUNT_PATH'])
  : join(homedir(), '.vgai', 'account.json');
async function readPersisted(path: string): Promise<PersistedAccount> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<PersistedAccount> & {
      mode?: unknown;
    };
    // Legacy migration: v1 files written before the backend rename used `mode`.
    let migrated = false;
    if (
      value.version === 1 &&
      (value as { mode?: unknown }).mode !== undefined &&
      value.backend === undefined
    ) {
      const legacyMode = (value as { mode?: unknown }).mode;
      if (legacyMode === 'mock' || legacyMode === 'live') {
        value.backend = legacyMode;
        delete (value as { mode?: unknown }).mode;
        migrated = true;
      }
    }
    if (value.version !== 1 || (value.backend !== 'mock' && value.backend !== 'live')) {
      throw new Error('Unsupported account state.');
    }
    if ((value as { preferredRoute?: unknown }).preferredRoute === 'direct') {
      value.preferredRoute = 'byok';
      migrated = true;
    }
    // The shipped editor now has a managed account provider by default. A
    // persisted local-mock selection from an older build must not silently
    // keep production collaboration disabled forever. The explicit Clerk twin
    // remains a development backend and therefore does not trigger this move.
    if (
      value.backend === 'mock' &&
      process.env['VGAI_ACCOUNT_URL'] &&
      !process.env['VGAI_TWIN_URL']
    ) {
      value.backend = 'live';
      delete value.userId;
      delete value.email;
      delete value.name;
      delete value.planId;
      delete value.planStatus;
      delete value.planRenewsAt;
      delete value.purchasedCredits;
      delete value.spendPolicy;
      migrated = true;
    }
    if (migrated) await writePersisted(path, value as PersistedAccount);
    return value as PersistedAccount;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        version: 1,
        backend: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'live',
        preferredRoute: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'auto',
      };
    }
    throw error;
  }
}

async function writePersisted(path: string, value: PersistedAccount): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class EditorAccountService {
  private statePromise: Promise<PersistedAccount>;
  private credential: AccountCredential | null = null;
  private readonly environmentAccessToken: string | undefined;
  private readonly cloudInferenceGrant: string | undefined;
  private readonly cloudInferenceModel: string | undefined;
  private readonly cloudInferenceRoute: 'managed' | 'byok' | undefined;
  private readonly cloudAccount: AccountSnapshot | undefined;
  private readonly credentialStore: AccountCredentialStore;
  private readonly providerCredentials: ProviderCredentialService;
  private mockControl: MockGenerativeControlPlane | undefined;
  private mockControlOwner: PersistedAccount | undefined;
  private mockToken: string | undefined;
  /** In-memory cache of the current twin session token; re-minted before it expires. */
  private twinToken: { jwt: string; expiresAtMs: number } | undefined;
  private readonly browserAuthorizations = new Map<string, PendingBrowserAuthorization>();
  private oauthMetadataPromise: Promise<OAuthServerMetadata> | undefined;

  constructor(
    private readonly accountPath = ACCOUNT_PATH,
    credentialStore?: AccountCredentialStore,
    providerCredentialStore?: ProviderCredentialStore,
  ) {
    this.statePromise = readPersisted(accountPath);
    this.environmentAccessToken = process.env['VGAI_ACCESS_TOKEN'];
    this.cloudInferenceGrant = process.env['VGAI_CLOUD_INFERENCE_GRANT'];
    this.cloudInferenceModel = process.env['VGAI_CLOUD_INFERENCE_MODEL'];
    this.cloudInferenceRoute =
      process.env['VGAI_CLOUD_INFERENCE_ROUTE'] === 'byok' ? 'byok' : 'managed';
    this.cloudAccount = parseCloudAccount(process.env['VGAI_CLOUD_ACCOUNT_JSON']);
    delete process.env['VGAI_CLOUD_INFERENCE_GRANT'];
    delete process.env['VGAI_CLOUD_ACCOUNT_JSON'];
    this.credentialStore =
      credentialStore ?? createSystemAccountCredentialStore(process.env['VGAI_ACCOUNT_URL']);
    this.providerCredentials = new ProviderCredentialService(
      providerCredentialStore ?? createSystemProviderCredentialStore(),
      this.providerCredentialMarkers(),
    );
  }

  /**
   * Makes ONE provider's stored BYOK credential available to its native tool,
   * reading the credential manager at that moment and no earlier. Callers are
   * the job paths that know which provider they are about to run.
   */
  async ensureProviderCredential(provider: string): Promise<void> {
    await this.providerCredentials.ensure(provider);
  }

  /** The marker record lives in this service's own account file. */
  private providerCredentialMarkers(): ProviderCredentialMarkerStore {
    return {
      read: async () => (await this.state()).providerCredentials ?? {},
      write: async (provider, marker) => {
        const state = await this.state();
        const markers = { ...(state.providerCredentials ?? {}) };
        if (marker) markers[provider] = marker;
        else delete markers[provider];
        if (Object.keys(markers).length > 0) state.providerCredentials = markers;
        else delete state.providerCredentials;
        await writePersisted(this.accountPath, state);
      },
    };
  }

  /** Resolve credentials and billing inside the trusted account boundary. */
  async providerExecutionMode(
    provider: string,
    pinned?: ProviderExecutionMode,
  ): Promise<ProviderExecutionMode> {
    // The job path's own read: this provider's secret, now, and no other's.
    const configured = (await this.providerCredentials.ensure(provider)) !== undefined;
    const state = await this.state();
    const mock = state.backend === 'mock' && process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1';
    if (pinned === 'mock' || (!pinned && mock && state.preferredRoute === 'mock')) {
      if (!mock) throw new Error('This recorded mock job requires its development account.');
      return 'mock';
    }
    if (pinned === 'direct' || (!pinned && configured && state.preferredRoute !== 'managed')) {
      if (!configured) throw new Error(`Reconnect ${provider} in Account to continue this job.`);
      return 'direct';
    }
    if (!pinned && state.preferredRoute === 'byok')
      throw new Error(`Connect ${provider} in Account before generating with your own key.`);
    const token = await this.accessToken();
    if (process.env['VGAI_GENERATION_GATEWAY'] && token) return 'managed';

    throw new Error(`Connect ${provider} or sign in to Volter Editor in Account before generating.`);
  }

  private async state(): Promise<PersistedAccount> {
    const state = await this.statePromise;
    if (state.accessToken) {
      await this.credentialStore.write({ accessToken: state.accessToken });
      this.credential = { accessToken: state.accessToken };
      delete state.accessToken;
      await writePersisted(this.accountPath, state);
    }
    return state;
  }

  /**
   * The managed twin base URL, or undefined when the twin path is not configured. When
   * set, the `live` backend is twin-backed (identity is minted against the twin's Backend
   * API) instead of the OAuth authorization-code flow. `VGAI_TWIN_SECRET` is optional and
   * cosmetic — the twin accepts any Bearer.
   */
  private twinBaseUrl(): string | undefined {
    const url = process.env['VGAI_TWIN_URL'];
    if (!url || url.trim().length === 0) return undefined;
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    ) {
      throw new Error('VGAI_TWIN_URL must be an HTTP loopback Clerk Twin URL.');
    }
    return parsed.toString().replace(/\/$/, '');
  }

  private twinSecret(): string | undefined {
    return process.env['VGAI_TWIN_SECRET'];
  }

  /**
   * A fresh twin session token, minting on demand and caching it until it nears its ≈60s
   * expiry. The token is never persisted — the durable handle is `state.twinSessionId`.
   * Also mirrored onto `VGAI_ACCESS_TOKEN` so provider-native managed transports and a
   * spawned deploy read the same conventional credential (same seam as the OAuth path).
   */
  private async twinAccessToken(state: PersistedAccount): Promise<string | undefined> {
    const baseUrl = this.twinBaseUrl();
    if (!baseUrl || !state.twinSessionId) return undefined;
    // Re-mint with a 10s safety margin against the ≈60s TTL.
    if (!this.twinToken || this.twinToken.expiresAtMs <= Date.now() + 10_000) {
      const jwt = await mintTwinSessionToken(baseUrl, state.twinSessionId, this.twinSecret());
      this.twinToken = { jwt, expiresAtMs: Date.now() + 50_000 };
    }
    process.env['VGAI_ACCESS_TOKEN'] = this.twinToken.jwt;
    return this.twinToken.jwt;
  }

  /**
   * Sign in against the managed twin: get-or-create the user, open a durable session, and
   * mint the first token. Identity flows from here to managed generation (`/verify`)
   * via the shared `VGAI_ACCESS_TOKEN`.
   */
  async signInTwin(email: string): Promise<EditorAccountSnapshot> {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new Error('Enter a valid email address.');
    const baseUrl = this.twinBaseUrl();
    if (!baseUrl) throw new Error('No managed twin is configured (VGAI_TWIN_URL is unset).');
    const identity = await signInToTwin(baseUrl, normalized, this.twinSecret());
    // Capture the managed endpoints so a standalone `vgai deploy` can mint from the session
    // (VGAI_AUTH_URL is the vgai-auth base; its `/relay/token` is the deploy's mint endpoint).
    const authUrl = process.env['VGAI_AUTH_URL'];
    const state: PersistedAccount = {
      version: 1,
      backend: 'live',
      email: normalized,
      twinUserId: identity.userId,
      userId: identity.userId,
      twinSessionId: identity.sessionId,
      twinUrl: baseUrl,
      ...(authUrl && authUrl.trim().length > 0 ? { authUrl } : {}),
      preferredRoute: 'managed',
    };
    await writePersisted(this.accountPath, state);
    this.statePromise = Promise.resolve(state);
    this.twinToken = undefined;
    await this.credentialStore.delete();
    this.credential = null;
    await this.twinAccessToken(state);
    return this.snapshot();
  }

  private async accessToken(): Promise<string | undefined> {
    if (this.environmentAccessToken) return this.environmentAccessToken;
    const state = await this.statePromise;
    if (this.twinBaseUrl() && state.twinSessionId) return this.twinAccessToken(state);
    this.credential ??= await this.credentialStore.read();
    if (!this.credential) return undefined;
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const expiresSoon =
      this.credential.expiresAt !== undefined &&
      Date.parse(this.credential.expiresAt) <= Date.now() + 60_000;
    if (expiresSoon && this.credential.refreshToken && accountUrl) {
      this.credential = await this.refreshCredential(this.credential);
      if (!this.credential) return undefined;
    }
    // Provider-native managed transports read this conventional process-local
    // credential. Project tools already run as trusted Node code; the security
    // boundary here is durable storage and browser/contribution exposure.
    process.env['VGAI_ACCESS_TOKEN'] = this.credential.accessToken;
    return this.credential.accessToken;
  }

  private async refreshCredential(
    credential: AccountCredential,
  ): Promise<AccountCredential | null> {
    if (!credential.refreshToken) return credential;
    const metadata = await this.oauthMetadata();
    const response = await fetch(metadata.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: this.oauthClientId(),
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      if (
        response.status === 401 ||
        body['error'] === 'invalid_grant' ||
        body['error'] === 'invalid_token'
      ) {
        await this.credentialStore.delete();
        return null;
      }
      throw new Error(`Account refresh failed (${response.status}).`);
    }
    if (typeof body['access_token'] !== 'string') {
      throw new Error('Account refresh returned no access token.');
    }
    const refreshed: AccountCredential = {
      accessToken: body['access_token'],
      refreshToken:
        typeof body['refresh_token'] === 'string' ? body['refresh_token'] : credential.refreshToken,
      ...(typeof body['expires_in'] === 'number'
        ? { expiresAt: new Date(Date.now() + body['expires_in'] * 1_000).toISOString() }
        : {}),
    };
    await this.credentialStore.write(refreshed);
    return refreshed;
  }

  private oauthClientId(): string {
    return process.env['VGAI_OAUTH_CLIENT_ID'] ?? 'vgai-editor';
  }

  private oauthMetadata(): Promise<OAuthServerMetadata> {
    this.oauthMetadataPromise ??= (async () => {
      const accountUrl = process.env['VGAI_ACCOUNT_URL'];
      const issuerUrl = process.env['VGAI_OAUTH_ISSUER_URL'] ?? accountUrl;
      if (!issuerUrl) throw new Error('No production Volter account service is configured.');
      const response = await fetch(
        `${issuerUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
      );
      if (!response.ok) throw new Error(`OAuth discovery failed (${response.status}).`);
      const body = (await response.json()) as Record<string, unknown>;
      if (
        typeof body['authorization_endpoint'] !== 'string' ||
        typeof body['token_endpoint'] !== 'string'
      ) {
        throw new Error('OAuth discovery returned invalid authorization endpoints.');
      }
      return {
        authorizationEndpoint: body['authorization_endpoint'],
        tokenEndpoint: body['token_endpoint'],
        ...(typeof body['device_authorization_endpoint'] === 'string'
          ? { deviceAuthorizationEndpoint: body['device_authorization_endpoint'] }
          : {}),
      };
    })();
    return this.oauthMetadataPromise;
  }

  async authorizationMethods(): Promise<{ browser: true; device: boolean }> {
    const metadata = await this.oauthMetadata();
    return { browser: true, device: metadata.deviceAuthorizationEndpoint !== undefined };
  }

  private async editorProjection(
    state: PersistedAccount,
    hasAccessToken = false,
    managedServicesAllowed = false,
  ) {
    const providerCredentials = await this.providerCredentials.snapshot();
    const byokProviders = providerCredentials
      .filter((provider) => provider.configured)
      .map((provider) => provider.provider);
    const routes = {
      mock: true as const,
      managed: Boolean(
        state.backend === 'live' &&
          process.env['VGAI_GENERATION_GATEWAY'] &&
          hasAccessToken &&
          managedServicesAllowed,
      ),
      byok: byokProviders.length > 0,
      byokProviders,
    };
    let preferredRoute = state.preferredRoute ?? 'auto';
    if (
      preferredRoute !== 'auto' &&
      (!routes[preferredRoute] || (preferredRoute === 'mock' && state.backend !== 'mock'))
    ) {
      preferredRoute = 'auto';
      state.preferredRoute = preferredRoute;
      await writePersisted(this.accountPath, state);
    }
    return {
      accountEnvironment:
        state.backend === 'mock'
          ? ('test-mock' as const)
          : this.twinBaseUrl()
            ? ('development-twin' as const)
            : ('production' as const),
      routes,
      providerCredentials,
      preferredRoute,
      codingInference: CodingInferenceSettingsSchema.parse(
        state.codingInference ?? DEFAULT_CODING_INFERENCE,
      ),
    };
  }

  private mock(state: PersistedAccount): MockGenerativeControlPlane {
    if (this.mockControl && this.mockControlOwner === state) return this.mockControl;
    this.mockControlOwner = state;
    this.mockControl = createMockGenerativeControlPlane({
      ...(state.mockControlState ? { state: state.mockControlState } : {}),
      onStateChange: async (controlState) => {
        // Mock sessions are process-local just like live access tokens. The
        // durable fixture ledger contains users/accounting, never bearer-like
        // session strings; restart simply creates another zero-charge session.
        state.mockControlState = { ...controlState, sessions: [] };
        await writePersisted(this.accountPath, state);
      },
    });
    return this.mockControl;
  }

  private async mockFetch(
    state: PersistedAccount,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.mockToken) headers.set('Authorization', `Bearer ${this.mockToken}`);
    return this.mock(state).fetch(new Request(`https://account.mock${path}`, { ...init, headers }));
  }

  private async ensureMockSession(state: PersistedAccount): Promise<void> {
    if (this.mockToken || !state.email) return;
    const response = await this.mockFetch(state, '/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.email }),
    });
    const body = (await response.json()) as { token?: unknown };
    if (!response.ok || typeof body.token !== 'string') {
      throw new Error('Could not create the local mock account session.');
    }
    this.mockToken = body.token;

    // One-time migration from the pre-control-plane editor mock. The control
    // plane becomes the only implementation of plan, policy, credit, and usage
    // rules; the editor retains only its opaque serialized state and session.
    if (state.planId && state.planId !== 'free') {
      await this.mockFetch(state, '/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: state.planId }),
      });
      if (state.planStatus === 'cancelling') {
        await this.mockFetch(state, '/v1/plan', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel' }),
        });
      }
    }
    if (state.purchasedCredits && state.purchasedCredits > 0) {
      await this.mockFetch(state, '/v1/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits: state.purchasedCredits }),
      });
    }
    if (state.spendPolicy) {
      await this.mockFetch(state, '/v1/spend-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.spendPolicy),
      });
    }
    delete state.planId;
    delete state.planStatus;
    delete state.planRenewsAt;
    delete state.purchasedCredits;
    delete state.spendPolicy;
    await writePersisted(this.accountPath, state);
  }

  private async mockSnapshot(state: PersistedAccount): Promise<EditorAccountSnapshot> {
    const projection = await this.editorProjection(state);
    if (!state.email) {
      return {
        authenticated: false,
        backend: 'mock',
        ...projection,
      };
    }
    await this.ensureMockSession(state);
    const response = await this.mockFetch(state, '/v1/account');
    if (!response.ok) throw new Error(`Mock account request failed (${response.status}).`);
    const account = AccountSnapshotSchema.parse(await response.json());
    return { ...account, ...projection };
  }

  /** Development uses the same managed-account ledger contract as production;
   * only its identity and payment providers are Clerk and Polar twins. */
  private async twinSnapshot(state: PersistedAccount): Promise<EditorAccountSnapshot> {
    const token = await this.twinAccessToken(state);
    if (!state.email || !state.twinSessionId) {
      return {
        authenticated: false,
        backend: 'live',
        ...(await this.editorProjection(state, Boolean(token))),
      };
    }
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    if (!accountUrl || !token) {
      throw new Error('Clerk Twin development requires the managed account service.');
    }
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}/v1/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Twin account request failed (${response.status}).`);
    const account = AccountSnapshotSchema.parse(await response.json());
    const projection = await this.editorProjection(
      state,
      Boolean(token),
      account.authenticated && account.entitlements.generation,
    );
    return { ...account, ...projection };
  }

  async snapshot(): Promise<EditorAccountSnapshot> {
    const state = await this.state();
    if (this.cloudAccount) {
      state.backend = 'live';
      state.preferredRoute = 'managed';
      state.codingInference = {
        enabled: true,
        provider: 'openrouter',
        model: this.cloudInferenceModel ?? 'z-ai/glm-5.2',
      };
      const projection = await this.editorProjection(
        state,
        true,
        this.cloudAccount.authenticated && this.cloudAccount.entitlements.generation,
      );
      const route = this.cloudInferenceRoute ?? 'managed';
      return {
        ...this.cloudAccount,
        ...projection,
        routes: {
          ...projection.routes,
          managed: route === 'managed' && projection.routes.managed,
          byok: route === 'byok',
          byokProviders: route === 'byok' ? ['openrouter'] : [],
        },
        preferredRoute: route,
      };
    }
    if (state.backend === 'mock') return this.mockSnapshot(state);
    // A configured twin makes the `live` backend twin-backed (identity minted against the
    // twin's Backend API), superseding the OAuth authorization-code path.
    if (this.twinBaseUrl()) return this.twinSnapshot(state);
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const token = await this.accessToken();
    if (!accountUrl || !token) {
      return {
        authenticated: false,
        backend: 'live',
        ...(await this.editorProjection(state, Boolean(token))),
      };
    }
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}/v1/account`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Account request failed (${response.status}).`);
    const account = AccountSnapshotSchema.parse(await response.json());
    if (account.authenticated) {
      const identityChanged =
        state.userId !== account.user.id ||
        state.email !== account.user.email ||
        state.name !== account.user.name;
      if (identityChanged) {
        state.userId = account.user.id;
        state.email = account.user.email;
        if (account.user.name) state.name = account.user.name;
        else delete state.name;
        await writePersisted(this.accountPath, state);
      }
    }
    return {
      ...account,
      ...(await this.editorProjection(
        state,
        true,
        account.authenticated && account.entitlements.generation,
      )),
    };
  }

  /** Trusted Node-only account authority used by the session-owned share
   * host. Tokens never cross an editor HTTP response or enter project state. */
  async collaborationAccountSession(): Promise<CollaborationAccountSession> {
    const state = await this.state();
    if (state.backend !== 'live') {
      throw new Error('Sign in to a live Volter account before sharing this editor.');
    }
    if (state.twinSessionId || state.twinUrl) {
      throw new Error(
        'The development Clerk twin cannot host a public share. Sign in through the production Volter account provider.',
      );
    }
    const snapshot = await this.snapshot();
    if (!snapshot.authenticated) throw new Error('Sign in to your Volter account before sharing.');
    const accessToken = await this.accessToken();
    const authUrl = process.env['VGAI_AUTH_URL']?.trim() || state.authUrl?.trim();
    if (!accessToken || !authUrl) {
      throw new Error('The signed-in Volter account is missing collaboration authorization config.');
    }
    // Identity-only, deliberately NOT `/verify`: that route also enforces
    // managed-services admission (a hand-set billing flag), and hosting a
    // share needs to know WHO the host is, never whether they bought managed
    // generation. Routed through `/verify`, a freshly signed-up account could
    // not host a share at all.
    const response = await fetch(`${authUrl.replace(/\/$/, '')}/collaboration/verify`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const verified = (await response.json().catch(() => undefined)) as
      | { userId?: unknown }
      | undefined;
    if (!response.ok || verified?.userId !== snapshot.user.id) {
      throw new Error('The Volter account session expired or does not match the editor account.');
    }
    return {
      accessToken,
      authUrl: authUrl.replace(/\/$/, ''),
      user: {
        id: snapshot.user.id,
        email: snapshot.user.email,
        ...(snapshot.user.name ? { name: snapshot.user.name } : {}),
        organizations: snapshot.organizations ?? [],
      },
    };
  }

  async setProviderCredential(
    provider: ProviderCredentialId,
    key: string,
  ): Promise<EditorAccountSnapshot> {
    await this.providerCredentials.set(provider, key);
    return this.snapshot();
  }

  async deleteProviderCredential(provider: ProviderCredentialId): Promise<EditorAccountSnapshot> {
    const credentials = await this.providerCredentials.delete(provider);
    const state = await this.state();
    if (state.preferredRoute === 'byok' && !credentials.some((item) => item.configured)) {
      state.preferredRoute = 'auto';
      await writePersisted(this.accountPath, state);
    }
    return this.snapshot();
  }

  testProviderCredential(provider: ProviderCredentialId): Promise<ProviderCredentialTestResult> {
    return this.providerCredentials.test(provider);
  }

  async signInMock(email: string): Promise<EditorAccountSnapshot> {
    if (process.env['VGAI_TEST_ACCOUNT_MOCK'] !== '1') {
      throw new Error('The in-process account mock is available only to isolated tests.');
    }
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new Error('Enter a valid email address.');
    const prior = await this.state();
    const state: PersistedAccount = {
      version: 1,
      backend: 'mock',
      email: normalized,
      preferredRoute: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'auto',
      ...(prior.mockControlState ? { mockControlState: prior.mockControlState } : {}),
    };
    await writePersisted(this.accountPath, state);
    this.statePromise = Promise.resolve(state);
    await this.credentialStore.delete();
    this.credential = null;
    if (!this.environmentAccessToken) delete process.env['VGAI_ACCESS_TOKEN'];
    this.mockControl = undefined;
    this.mockControlOwner = undefined;
    this.mockToken = undefined;
    await this.ensureMockSession(state);
    return this.snapshot();
  }

  async signOut(): Promise<EditorAccountSnapshot> {
    const prior = await this.state();
    const state: PersistedAccount = {
      version: 1,
      backend: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'live',
      preferredRoute: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'auto',
      ...(prior.mockControlState ? { mockControlState: prior.mockControlState } : {}),
    };
    await writePersisted(this.accountPath, state);
    this.statePromise = Promise.resolve(state);
    this.mockToken = undefined;
    this.twinToken = undefined;
    await this.credentialStore.delete();
    this.credential = null;
    if (!this.environmentAccessToken) delete process.env['VGAI_ACCESS_TOKEN'];
    return this.snapshot();
  }

  async updateSpendPolicy(input: unknown): Promise<EditorAccountSnapshot> {
    const state = await this.state();
    if (state.backend === 'live') return this.liveMutation('/v1/spend-policy', 'PUT', input);
    const policy = AccountSpendPolicySchema.parse(input);
    await this.ensureMockSession(state);
    const response = await this.mockFetch(state, '/v1/spend-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
    });
    if (!response.ok) throw new Error(`Mock spend policy update failed (${response.status}).`);
    return this.snapshot();
  }

  async setPreferredRoute(route: GenerationExecutionRoute): Promise<EditorAccountSnapshot> {
    const state = await this.state();
    const { routes } = await this.snapshot();
    if (route !== 'auto' && (!routes[route] || (route === 'mock' && state.backend !== 'mock'))) {
      throw new Error(`${route} execution is not available.`);
    }
    state.preferredRoute = route;
    await writePersisted(this.accountPath, state);
    return this.snapshot();
  }

  async setCodingInference(input: unknown): Promise<EditorAccountSnapshot> {
    const settings = CodingInferenceSettingsSchema.parse(input);
    const state = await this.state();
    state.codingInference = settings;
    await writePersisted(this.accountPath, state);
    return this.snapshot();
  }

  async quoteCodingInference(input: unknown): Promise<CodingInferenceQuote> {
    const value = input as Record<string, unknown>;
    const model = typeof value?.['model'] === 'string' ? value['model'].trim() : '';
    const promptTokens = Number(value?.['promptTokens']);
    const outputTokens = Number(value?.['outputTokens']);
    if (
      !/^[A-Za-z0-9._:/-]{1,200}$/.test(model) ||
      !Number.isSafeInteger(promptTokens) ||
      promptTokens < 0 ||
      !Number.isSafeInteger(outputTokens) ||
      outputTokens < 0
    ) {
      throw new Error('A model and non-negative token estimates are required.');
    }
    const gateway = process.env['VGAI_GENERATION_GATEWAY']?.replace(/\/$/, '');
    const token = this.cloudInferenceGrant ?? (await this.accessToken());
    if (!gateway || !token) throw new Error('Managed coding pricing is unavailable.');
    const modelPath = this.cloudInferenceGrant
      ? '/coding/openrouter/api/v1/models'
      : '/openrouter/api/v1/models';
    const modelsResponse = await fetch(`${gateway}${modelPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const modelsBody = (await modelsResponse.json().catch(() => undefined)) as
      | { data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }> }
      | undefined;
    if (!modelsResponse.ok)
      throw new Error(`OpenRouter pricing failed (${modelsResponse.status}).`);
    const pricing = modelsBody?.data?.find((entry) => entry.id === model)?.pricing;
    const promptPrice = Number(pricing?.prompt);
    const completionPrice = Number(pricing?.completion);
    if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice)) {
      throw new Error(`OpenRouter returned no pricing for ${model}.`);
    }
    const providerAmountUsd = promptTokens * promptPrice + outputTokens * completionPrice;
    const quoteResponse = await fetch(`${gateway}/billing/quote`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'inference',
        provider: 'openrouter',
        operation: model,
        workload: 'coding',
        model,
        providerPrice: { currency: 'USD', amount: providerAmountUsd },
      }),
    });
    const quoteBody = (await quoteResponse.json().catch(() => undefined)) as
      | { estimatedCredits?: unknown; error?: unknown }
      | undefined;
    if (!quoteResponse.ok || typeof quoteBody?.estimatedCredits !== 'number') {
      throw new Error(
        typeof quoteBody?.error === 'string'
          ? quoteBody.error
          : `Managed coding quote failed (${quoteResponse.status}).`,
      );
    }
    return {
      model,
      promptTokens,
      outputTokens,
      providerAmountUsd,
      estimatedCredits: quoteBody.estimatedCredits,
    };
  }

  /** Resolve the account-owned coding route for a spawned harness — the OPT-IN only.
   * A CODING HARNESS IS NOT A PROVIDER (owner ruling, 2026-09-21; ARCHITECTURE-CORE
   * §Managed services): a harness is a program the person already signed into, so this
   * answers `null` — inject nothing, run the stock CLI on their own login — for every
   * route but the `'managed'`/`'byok'` they chose for themselves in the account panel.
   * `'auto'` is NOT a choice here, which is the one semantic that differs from the
   * generation lane, where fal/tripo/worldlabs really are providers. Managed processes
   * receive only a short-lived grant scoped to the hashed workspace and exact model;
   * the reusable account token stays in this trusted server. */
  async resolvedCodingInference(workspace: string): Promise<ResolvedCodingInference | null> {
    if (this.cloudInferenceGrant) {
      const gateway = process.env['VGAI_GENERATION_GATEWAY']?.replace(/\/$/, '');
      const model = this.cloudInferenceModel ?? 'z-ai/glm-5.2';
      if (!gateway || !/^https:\/\//.test(gateway) || !/^[A-Za-z0-9._:/-]{1,200}$/.test(model)) {
        throw new Error('Cloud managed coding is not configured securely.');
      }
      // A hosted container has no device login to fall back to, so the deployment's own
      // `VGAI_CLOUD_INFERENCE_ROUTE` IS the explicit choice the gate reads.
      const route = this.cloudInferenceRoute ?? 'managed';
      return {
        provider: 'openrouter',
        route,
        preferredRoute: route,
        model,
        baseUrl: `${gateway}/coding/openrouter/api/v1`,
        apiKey: this.cloudInferenceGrant,
      };
    }
    const state = await this.state();
    const settings = CodingInferenceSettingsSchema.parse(
      state.codingInference ?? DEFAULT_CODING_INFERENCE,
    );
    if (!settings.enabled) return null;
    // THE GATE. The person's own stored choice, read straight off disk so the default
    // path costs no account round-trip: `'auto'` and `'mock'` both mean "run the stock
    // CLI on the login they already did". `editorProjection` demotes a route the
    // account can no longer serve back to `'auto'` whenever the panel loads, so a stale
    // opt-in self-heals into that default rather than stranding the launch.
    const preferredRoute = state.preferredRoute ?? 'auto';
    if (preferredRoute !== 'managed' && preferredRoute !== 'byok') return null;
    if ((await this.providerExecutionMode('openrouter')) === 'direct') {
      const apiKey = await this.providerCredentials.credential('openrouter');
      if (!apiKey)
        throw new Error('Add an OpenRouter credential before starting this coding agent.');
      return {
        provider: 'openrouter',
        route: 'byok',
        preferredRoute,
        model: settings.model,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey,
      };
    }
    const gateway = process.env['VGAI_GENERATION_GATEWAY']?.replace(/\/$/, '');
    const accessToken = await this.accessToken();
    const authUrl = process.env['VGAI_AUTH_URL']?.trim() || state.authUrl?.trim();
    if (!gateway || !accessToken || !authUrl) {
      throw new Error('Managed OpenRouter coding is unavailable for this account session.');
    }
    const response = await fetch(`${authUrl.replace(/\/$/, '')}/inference/grant`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: `workspace:${createHash('sha256').update(workspace).digest('hex')}`,
        provider: 'openrouter',
        workload: 'coding',
        model: settings.model,
      }),
    });
    const body = (await response.json().catch(() => undefined)) as
      | { grant?: unknown; error?: unknown }
      | undefined;
    if (!response.ok || typeof body?.grant !== 'string' || body.grant.length < 32) {
      const detail = typeof body?.error === 'string' ? `: ${body.error}` : '';
      throw new Error(`Managed coding grant failed (${response.status})${detail}`);
    }
    return {
      provider: 'openrouter',
      route: 'managed',
      preferredRoute,
      model: settings.model,
      baseUrl: `${gateway}/coding/openrouter/api/v1`,
      apiKey: body.grant,
    };
  }

  async checkout(
    plan: string,
    idempotencyKey: string,
  ): Promise<{ account: EditorAccountSnapshot; checkoutUrl?: string; mock: boolean }> {
    const state = await this.state();
    if (state.backend === 'live') {
      const checkoutUrl = await this.hostedCheckout(
        '/v1/billing/checkout',
        { plan },
        idempotencyKey,
      );
      return {
        account: await this.snapshot(),
        ...(checkoutUrl ? { checkoutUrl } : {}),
        mock: false,
      };
    }
    if (!state.email) throw new Error('Sign in before changing plans.');
    await this.ensureMockSession(state);
    const response = await this.mockFetch(state, '/v1/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) throw new Error(`Mock checkout failed (${response.status}).`);
    return { account: await this.snapshot(), mock: true };
  }

  async updatePlan(action: 'cancel' | 'resume'): Promise<EditorAccountSnapshot> {
    const state = await this.state();
    if (state.backend === 'live') {
      return this.liveMutation('/v1/billing/subscription', 'PATCH', {
        cancelAtPeriodEnd: action === 'cancel',
      });
    }
    await this.ensureMockSession(state);
    const response = await this.mockFetch(state, '/v1/plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: unknown };
      throw new Error(typeof body.error === 'string' ? body.error : 'Mock plan update failed.');
    }
    return this.snapshot();
  }

  async purchaseCredits(
    packId: string,
    idempotencyKey: string,
  ): Promise<{ account: EditorAccountSnapshot; checkoutUrl?: string; mock: boolean }> {
    const state = await this.state();
    if (state.backend === 'live') {
      const checkoutUrl = await this.hostedCheckout(
        '/v1/credits/checkout',
        { packId },
        idempotencyKey,
      );
      return {
        account: await this.snapshot(),
        ...(checkoutUrl ? { checkoutUrl } : {}),
        mock: false,
      };
    }
    await this.ensureMockSession(state);
    const response = await this.mockFetch(state, '/v1/credits/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId }),
    });
    if (!response.ok) throw new Error(`Mock credit purchase failed (${response.status}).`);
    return { account: await this.snapshot(), mock: true };
  }

  async accountUsage(): Promise<AccountUsageEntry[]> {
    const state = await this.state();
    if (state.backend === 'mock') {
      if (!state.email) return [];
      await this.ensureMockSession(state);
      const response = await this.mockFetch(state, '/v1/usage');
      if (!response.ok) throw new Error(`Mock usage request failed (${response.status}).`);
      const body = (await response.json()) as { entries?: AccountUsageEntry[] };
      return AccountUsageEntrySchema.array().parse(body.entries ?? []);
    }
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const token = await this.accessToken();
    if (!accountUrl || !token) return [];
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}/v1/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Usage request failed (${response.status}).`);
    const body = (await response.json()) as { entries?: AccountUsageEntry[] };
    return AccountUsageEntrySchema.array().parse(body.entries ?? []);
  }

  async accountCatalog(): Promise<AccountCatalog> {
    const state = await this.state();
    if (state.backend === 'mock') {
      await this.ensureMockSession(state);
      const response = await this.mockFetch(state, '/v1/catalog');
      if (!response.ok) throw new Error(`Mock catalog request failed (${response.status}).`);
      return AccountCatalogSchema.parse(await response.json());
    }
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const token = await this.accessToken();
    if (!accountUrl || !token) throw new Error('Sign in before loading the billing catalog.');
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}/v1/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
    return AccountCatalogSchema.parse(await response.json());
  }

  async billingPortal(): Promise<{ url: string; mock: boolean }> {
    const state = await this.state();
    if (state.backend === 'mock')
      return { url: `mock://billing/${state.email ?? 'signed-out'}`, mock: true };
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const token = await this.accessToken();
    if (!accountUrl || !token) throw new Error('Sign in before opening billing.');
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}/v1/billing/portal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Billing portal request failed (${response.status}).`);
    const body = (await response.json()) as { portal?: { url?: unknown } };
    if (typeof body.portal?.url !== 'string') throw new Error('Billing portal returned no URL.');
    return { url: body.portal.url, mock: false };
  }

  async confirmCheckout(checkoutId: string): Promise<EditorAccountSnapshot> {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(checkoutId)) throw new Error('Invalid checkout id.');
    const state = await this.state();
    if (state.backend === 'mock') return this.snapshot();
    return this.liveMutation('/v1/billing/confirm', 'POST', { checkoutId });
  }

  async confirmTwinCheckout(checkoutId: string): Promise<EditorAccountSnapshot> {
    if (!this.twinBaseUrl()) throw new Error('Twin checkout is unavailable outside development.');
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(checkoutId)) throw new Error('Invalid checkout id.');
    return this.liveMutation('/v1/billing/twin-confirm', 'POST', { checkoutId });
  }

  async markAlertsRead(): Promise<EditorAccountSnapshot> {
    const state = await this.state();
    if (state.backend === 'mock') return this.snapshot();
    return this.liveMutation('/v1/alerts/read', 'POST', {});
  }

  async beginDeviceAuthorization(): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresAt: string;
    intervalSeconds: number;
  }> {
    const metadata = await this.oauthMetadata();
    if (!metadata.deviceAuthorizationEndpoint) {
      throw new Error('This account provider does not advertise OAuth device authorization.');
    }
    const response = await fetch(metadata.deviceAuthorizationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.oauthClientId(),
        scope: 'openid profile email',
      }),
    });
    if (!response.ok) throw new Error(`Account authorization failed (${response.status}).`);
    const body = (await response.json()) as Record<string, unknown>;
    if (
      typeof body['device_code'] !== 'string' ||
      typeof body['user_code'] !== 'string' ||
      typeof body['verification_uri'] !== 'string' ||
      typeof body['expires_in'] !== 'number'
    ) {
      throw new Error('Account authorization returned an invalid device flow.');
    }
    return {
      deviceCode: body['device_code'],
      userCode: body['user_code'],
      verificationUri: body['verification_uri'],
      expiresAt: new Date(Date.now() + body['expires_in'] * 1_000).toISOString(),
      intervalSeconds: typeof body['interval'] === 'number' ? body['interval'] : 5,
    };
  }

  /** Primary desktop login: system browser + authorization code with PKCE.
   * The browser sees only the one-time authorization URL; token exchange and
   * durable credential storage remain in this trusted Node boundary. */
  async beginBrowserAuthorization(redirectOrigin: string): Promise<{
    authorizationId: string;
    authorizationUrl: string;
    expiresAt: string;
  }> {
    const metadata = await this.oauthMetadata();
    const origin = new URL(redirectOrigin).origin;
    if (!['http:', 'https:'].includes(new URL(origin).protocol)) {
      throw new Error('The editor origin cannot receive an account callback.');
    }
    const authorizationId = base64Url(randomBytes(24));
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const redirectUri = `${origin}/__editor/account/browser-authorization/callback`;
    this.browserAuthorizations.set(authorizationId, {
      verifier,
      redirectUri,
      expiresAt,
      status: 'pending',
    });
    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('client_id', this.oauthClientId());
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('state', authorizationId);
    authorizationUrl.searchParams.set('code_challenge', challenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    authorizationUrl.searchParams.set('scope', 'openid profile email');
    return { authorizationId, authorizationUrl: authorizationUrl.toString(), expiresAt };
  }

  async completeBrowserAuthorization(state: string, code: string): Promise<void> {
    const pending = this.browserAuthorizations.get(state);
    if (!pending || pending.status !== 'pending') {
      throw new Error('This account authorization is missing, expired, or already used.');
    }
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.browserAuthorizations.delete(state);
      throw new Error('This account authorization expired. Return to the editor and try again.');
    }
    const metadata = await this.oauthMetadata();
    try {
      const response = await fetch(metadata.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.oauthClientId(),
          code,
          redirect_uri: pending.redirectUri,
          code_verifier: pending.verifier,
        }),
      });
      if (!response.ok) throw new Error(`Account token exchange failed (${response.status}).`);
      const body = (await response.json()) as Record<string, unknown>;
      const accessToken = body['access_token'];
      const refreshToken = body['refresh_token'];
      const expiresIn = body['expires_in'];
      if (typeof accessToken !== 'string') {
        throw new Error('Account token exchange returned no access token.');
      }
      this.credential = {
        accessToken,
        ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
        ...(typeof expiresIn === 'number'
          ? { expiresAt: new Date(Date.now() + expiresIn * 1_000).toISOString() }
          : {}),
      };
      await this.credentialStore.write(this.credential);
      const persisted: PersistedAccount = {
        version: 1,
        backend: 'live',
        preferredRoute: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'auto',
        ...(process.env['VGAI_ACCOUNT_URL'] ? { accountUrl: process.env['VGAI_ACCOUNT_URL'] } : {}),
        ...(process.env['VGAI_OAUTH_ISSUER_URL']
          ? { oauthIssuerUrl: process.env['VGAI_OAUTH_ISSUER_URL'] }
          : {}),
        ...(process.env['VGAI_AUTH_URL'] ? { authUrl: process.env['VGAI_AUTH_URL'] } : {}),
      };
      await writePersisted(this.accountPath, persisted);
      this.statePromise = Promise.resolve(persisted);
      process.env['VGAI_ACCESS_TOKEN'] = accessToken;
      pending.status = 'complete';
    } catch (error) {
      pending.status = 'failed';
      pending.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  failBrowserAuthorization(state: string, message: string): void {
    const pending = this.browserAuthorizations.get(state);
    if (!pending || pending.status !== 'pending') return;
    pending.status = 'failed';
    pending.error = message;
  }

  async pollBrowserAuthorization(
    authorizationId: string,
  ): Promise<{ pending: true } | { pending: false; account: EditorAccountSnapshot }> {
    const pending = this.browserAuthorizations.get(authorizationId);
    if (!pending) throw new Error('This account authorization is no longer active.');
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      this.browserAuthorizations.delete(authorizationId);
      throw new Error('This account authorization expired.');
    }
    if (pending.status === 'failed') {
      this.browserAuthorizations.delete(authorizationId);
      throw new Error(pending.error ?? 'Account authorization failed.');
    }
    if (pending.status === 'pending') return { pending: true };
    this.browserAuthorizations.delete(authorizationId);
    return { pending: false, account: await this.snapshot() };
  }

  async pollDeviceAuthorization(
    deviceCode: string,
  ): Promise<{ pending: true } | { pending: false; account: EditorAccountSnapshot }> {
    const metadata = await this.oauthMetadata();
    const response = await fetch(metadata.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.oauthClientId(),
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      if (body['error'] === 'authorization_pending' || body['error'] === 'slow_down') {
        return { pending: true };
      }
      throw new Error(`Account authorization failed (${response.status}).`);
    }
    if (typeof body['access_token'] !== 'string') {
      throw new Error('Completed account authorization returned no access token.');
    }
    const state: PersistedAccount = {
      version: 1,
      backend: 'live',
      preferredRoute: process.env['VGAI_TEST_ACCOUNT_MOCK'] === '1' ? 'mock' : 'auto',
      ...(process.env['VGAI_ACCOUNT_URL'] ? { accountUrl: process.env['VGAI_ACCOUNT_URL'] } : {}),
      ...(process.env['VGAI_OAUTH_ISSUER_URL']
        ? { oauthIssuerUrl: process.env['VGAI_OAUTH_ISSUER_URL'] }
        : {}),
      ...(process.env['VGAI_AUTH_URL'] ? { authUrl: process.env['VGAI_AUTH_URL'] } : {}),
    };
    this.credential = {
      accessToken: body['access_token'],
      ...(typeof body['refresh_token'] === 'string' ? { refreshToken: body['refresh_token'] } : {}),
      ...(typeof body['expires_in'] === 'number'
        ? { expiresAt: new Date(Date.now() + body['expires_in'] * 1_000).toISOString() }
        : {}),
    };
    await this.credentialStore.write(this.credential);
    await writePersisted(this.accountPath, state);
    this.statePromise = Promise.resolve(state);
    process.env['VGAI_ACCESS_TOKEN'] = this.credential.accessToken;
    return { pending: false, account: await this.snapshot() };
  }

  private async liveMutation(
    path: string,
    method: 'POST' | 'PUT' | 'PATCH',
    input: unknown,
  ): Promise<EditorAccountSnapshot> {
    await this.state();
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const token = await this.accessToken();
    if (!accountUrl || !token) throw new Error('Sign in before managing the account.');
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Account update failed (${response.status}).`);
    return this.snapshot();
  }

  private async hostedCheckout(
    path: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<string | undefined> {
    await this.state();
    const accountUrl = process.env['VGAI_ACCOUNT_URL'];
    const token = await this.accessToken();
    if (!accountUrl || !token) throw new Error('Sign in before opening checkout.');
    const response = await fetch(`${accountUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Checkout request failed (${response.status}).`);
    const body = (await response.json()) as { checkout?: { url?: unknown }; url?: unknown };
    const url = body.checkout?.url ?? body.url;
    if (typeof url === 'string') return url;
    const subscription = body as { subscription?: { id?: unknown } };
    if (typeof subscription.subscription?.id === 'string') return undefined;
    throw new Error('Checkout returned neither a hosted URL nor a subscription update.');
  }
}

function parseCloudAccount(value: string | undefined): AccountSnapshot | undefined {
  if (!value) return undefined;
  try {
    const account = AccountSnapshotSchema.parse(JSON.parse(value));
    if (!account.authenticated || account.backend !== 'live') {
      throw new Error('Cloud account projection is not an authenticated live account.');
    }
    return account;
  } catch (error) {
    throw new Error(
      `Cloud account projection is invalid: ${error instanceof Error ? error.message : 'invalid JSON'}`,
    );
  }
}
