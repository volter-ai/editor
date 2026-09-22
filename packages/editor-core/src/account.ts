import type {
  AccountCatalog,
  AccountSpendPolicy,
  AccountUsageEntry,
  EditorAccountSnapshot,
  GenerationAccountProjection,
  GenerationExecutionRoute,
  ProviderCredentialId,
  ProviderCredentialTestResult,
} from '@volter/editor-sdk/account';
import {
  AccountCatalogSchema,
  AccountUsageEntrySchema,
  EditorAccountSnapshotSchema,
  generationAccountProjection,
  ProviderCredentialTestResultSchema,
} from '@volter/editor-sdk/account';
import { assertEditorServerAnswered } from './editor-server-response';
import { COLLABORATION_REMOTE_SHARE } from './editor-session-attribution';

const EMPTY: EditorAccountSnapshot = {
  authenticated: false,
  backend: 'mock',
  accountEnvironment: 'test-mock',
  routes: { mock: true, managed: false, byok: false, byokProviders: [] },
  preferredRoute: 'auto',
  providerCredentials: [],
  codingInference: { enabled: false, provider: 'openrouter', model: 'z-ai/glm-5.2' },
};
let snapshot: EditorAccountSnapshot = EMPTY;
let version = 0;
let error: string | null = null;
const listeners = new Set<() => void>();

function publish(next: EditorAccountSnapshot, nextError: string | null = null) {
  // Polling identical state must not invalidate every contribution. Parsed
  // snapshots have the schema's stable field order; errors are state too.
  if (error === nextError && JSON.stringify(snapshot) === JSON.stringify(next)) return;
  snapshot = next;
  error = nextError;
  version++;
  for (const listener of listeners) listener();
}

// Every route below reads the account service's OWN `{ error }` body on a
// non-OK status (that string is the user-facing message — "Insufficient
// credits", not "402"), so each one asserts only that the EDITOR SERVER
// answered, before parsing. See `editor-server-response.ts`.
async function responseSnapshot(response: Response, what: string): Promise<EditorAccountSnapshot> {
  assertEditorServerAnswered(response, what);
  const body = (await response.json()) as EditorAccountSnapshot | { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof (body as { error?: unknown }).error === 'string'
        ? String((body as { error?: unknown }).error)
        : `Account request failed (${response.status}).`,
    );
  }
  return EditorAccountSnapshotSchema.parse(body);
}

async function mutate(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const next = await responseSnapshot(response, `${method} ${path} failed`);
  publish(next);
  return next;
}

export function accountSnapshot(): EditorAccountSnapshot {
  return snapshot;
}
/** The deliberately narrow, non-PII account view exposed to project code. */
export function contributionAccount(): GenerationAccountProjection {
  return generationAccountProjection(snapshot);
}
export function accountVersion(): number {
  return version;
}
export function accountError(): string | null {
  return error;
}
export function subscribeAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export async function refreshAccount(): Promise<EditorAccountSnapshot> {
  try {
    const next = await responseSnapshot(await fetch('/__editor/account'), 'Account read failed');
    publish(next);
    return next;
  } catch (cause) {
    publish(snapshot, cause instanceof Error ? cause.message : String(cause));
    throw cause;
  }
}
export const signInMockAccount = (email: string) =>
  mutate('/__editor/account/mock-session', 'POST', { email });
export const signInTwinAccount = (email: string) =>
  mutate('/__editor/account/twin-session', 'POST', { email });
export const signOutAccount = () => mutate('/__editor/account/session', 'DELETE');
export const updateAccountSpendPolicy = (policy: AccountSpendPolicy) =>
  mutate('/__editor/account/spend-policy', 'PUT', policy);
export const markAccountAlertsRead = () => mutate('/__editor/account/alerts/read', 'POST');
export const updatePreferredGenerationRoute = (route: GenerationExecutionRoute) =>
  mutate('/__editor/account/execution-route', 'PUT', { route });
export const updateCodingInference = (input: EditorAccountSnapshot['codingInference']) =>
  mutate('/__editor/account/coding-inference', 'PUT', input);
export async function quoteCodingInference(input: {
  model: string;
  promptTokens: number;
  outputTokens: number;
}): Promise<{
  model: string;
  promptTokens: number;
  outputTokens: number;
  providerAmountUsd: number;
  estimatedCredits: number;
}> {
  const response = await fetch('/__editor/account/coding-inference/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  assertEditorServerAnswered(response, 'Coding quote failed');
  const body = (await response.json()) as {
    model?: unknown;
    promptTokens?: unknown;
    outputTokens?: unknown;
    providerAmountUsd?: unknown;
    estimatedCredits?: unknown;
    error?: unknown;
  };
  if (
    !response.ok ||
    typeof body.model !== 'string' ||
    typeof body.promptTokens !== 'number' ||
    typeof body.outputTokens !== 'number' ||
    typeof body.providerAmountUsd !== 'number' ||
    typeof body.estimatedCredits !== 'number'
  ) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Coding quote failed.');
  }
  return body as {
    model: string;
    promptTokens: number;
    outputTokens: number;
    providerAmountUsd: number;
    estimatedCredits: number;
  };
}
export const saveProviderCredential = (provider: ProviderCredentialId, key: string) =>
  mutate(`/__editor/account/provider-credentials/${encodeURIComponent(provider)}`, 'PUT', { key });
export const removeProviderCredential = (provider: ProviderCredentialId) =>
  mutate(`/__editor/account/provider-credentials/${encodeURIComponent(provider)}`, 'DELETE');
export async function testProviderCredential(
  provider: ProviderCredentialId,
): Promise<ProviderCredentialTestResult> {
  const response = await fetch(
    `/__editor/account/provider-credentials/${encodeURIComponent(provider)}/test`,
    { method: 'POST' },
  );
  assertEditorServerAnswered(response, 'Credential test failed');
  const body = (await response.json()) as ProviderCredentialTestResult & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string' ? body.error : `Credential test failed (${response.status}).`,
    );
  }
  return ProviderCredentialTestResultSchema.parse(body);
}
export const updateAccountPlan = (action: 'cancel' | 'resume') =>
  mutate('/__editor/account/plan', 'PUT', { action });
async function checkoutAction(
  path: string,
  body: unknown,
): Promise<{ checkoutUrl?: string; mock: boolean }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  assertEditorServerAnswered(response, 'Checkout failed');
  const result = (await response.json()) as {
    account?: unknown;
    checkoutUrl?: unknown;
    mock?: unknown;
    error?: unknown;
  };
  if (!response.ok || !result.account) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Checkout failed.');
  }
  publish(EditorAccountSnapshotSchema.parse(result.account));
  return {
    ...(typeof result.checkoutUrl === 'string' ? { checkoutUrl: result.checkoutUrl } : {}),
    mock: result.mock === true,
  };
}
export const checkoutAccountPlan = (plan: string) =>
  checkoutAction('/__editor/account/checkout', { plan });
export const purchaseAccountCredits = (packId: string) =>
  checkoutAction('/__editor/account/credits', { packId });
export async function fetchAccountUsage(): Promise<AccountUsageEntry[]> {
  const response = await fetch('/__editor/account/usage');
  assertEditorServerAnswered(response, 'Usage failed');
  const body = (await response.json()) as { entries?: AccountUsageEntry[]; error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Usage failed.');
  return AccountUsageEntrySchema.array().parse(body.entries ?? []);
}
export async function fetchAccountCatalog(): Promise<AccountCatalog> {
  const response = await fetch('/__editor/account/catalog');
  assertEditorServerAnswered(response, 'Catalog failed');
  const body = (await response.json()) as AccountCatalog & { error?: unknown };
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : 'Catalog failed.');
  return AccountCatalogSchema.parse(body);
}
export async function openAccountBillingPortal(): Promise<{ url: string; mock: boolean }> {
  const response = await fetch('/__editor/account/billing-portal', { method: 'POST' });
  assertEditorServerAnswered(response, 'Billing portal failed');
  const body = (await response.json()) as { url?: unknown; mock?: unknown; error?: unknown };
  if (!response.ok || typeof body.url !== 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : 'Billing portal failed.');
  }
  return { url: body.url, mock: body.mock === true };
}
export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}
export interface BrowserAuthorization {
  authorizationId: string;
  authorizationUrl: string;
  expiresAt: string;
}
export async function fetchAccountAuthorizationMethods(): Promise<{
  browser: true;
  device: boolean;
}> {
  const response = await fetch('/__editor/account/authorization-methods');
  assertEditorServerAnswered(response, 'Sign-in methods are unavailable');
  const body = (await response.json()) as {
    browser?: unknown;
    device?: unknown;
    error?: unknown;
  };
  if (!response.ok || body.browser !== true || typeof body.device !== 'boolean') {
    throw new Error(
      typeof body.error === 'string' ? body.error : 'Sign-in methods are unavailable.',
    );
  }
  return { browser: true, device: body.device };
}
export async function beginAccountBrowserAuthorization(): Promise<BrowserAuthorization> {
  const response = await fetch('/__editor/account/browser-authorization', { method: 'POST' });
  assertEditorServerAnswered(response, 'Sign-in failed');
  const body = (await response.json()) as BrowserAuthorization & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Sign-in failed.');
  }
  return body;
}
export async function pollAccountBrowserAuthorization(authorizationId: string): Promise<boolean> {
  const response = await fetch(
    `/__editor/account/browser-authorization/${encodeURIComponent(authorizationId)}`,
  );
  assertEditorServerAnswered(response, 'Sign-in failed');
  const body = (await response.json()) as
    | { pending: true; error?: unknown }
    | { pending: false; account: EditorAccountSnapshot; error?: unknown };
  if (response.status === 202) return false;
  if (!response.ok || body.pending !== false) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Sign-in failed.');
  }
  publish(EditorAccountSnapshotSchema.parse(body.account));
  return true;
}
export async function beginAccountDeviceAuthorization(): Promise<DeviceAuthorization> {
  const response = await fetch('/__editor/account/device-authorization', { method: 'POST' });
  assertEditorServerAnswered(response, 'Sign-in failed');
  const body = (await response.json()) as DeviceAuthorization & { error?: unknown };
  if (!response.ok)
    throw new Error(typeof body.error === 'string' ? body.error : 'Sign-in failed.');
  return body;
}
export async function pollAccountDeviceAuthorization(deviceCode: string): Promise<boolean> {
  const response = await fetch(
    `/__editor/account/device-authorization/${encodeURIComponent(deviceCode)}`,
  );
  assertEditorServerAnswered(response, 'Sign-in failed');
  const body = (await response.json()) as
    | { pending: true; error?: unknown }
    | { pending: false; account: EditorAccountSnapshot; error?: unknown };
  if (response.status === 202) return false;
  if (!response.ok || body.pending !== false) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Sign-in failed.');
  }
  publish(EditorAccountSnapshotSchema.parse(body.account));
  return true;
}
export function startAccountActivity(): () => void {
  if (COLLABORATION_REMOTE_SHARE) return () => {};
  const checkoutId = new URLSearchParams(window.location.search).get('checkout_id');
  if (checkoutId) {
    void mutate('/__editor/account/checkout/confirm', 'POST', { checkoutId })
      .then(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('checkout');
        url.searchParams.delete('checkout_id');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      })
      // Into the module's own error channel (`accountError()`, rendered by the
      // account UI) rather than a bare swallow: a confirm that reached nothing
      // used to clear the URL params and look done.
      .catch((cause: unknown) =>
        publish(snapshot, cause instanceof Error ? cause.message : String(cause)),
      );
  } else {
    void refreshAccount().catch(() => undefined);
  }
  const timer = window.setInterval(() => void refreshAccount().catch(() => undefined), 30_000);
  return () => window.clearInterval(timer);
}
