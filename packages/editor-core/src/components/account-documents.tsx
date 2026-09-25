import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { Button, Checkbox, EditorIcon, Select, TextInput } from '@volter/editor-sdk/widgets';
import type {
  AccountCatalog,
  AccountPlanId,
  AccountSpendPolicy,
  AccountUsageEntry,
  ProviderCredentialId,
  ProviderCredentialStatus,
} from '@volter/editor-sdk/account';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  accountError,
  accountSnapshot,
  accountVersion,
  beginAccountBrowserAuthorization,
  beginAccountDeviceAuthorization,
  checkoutAccountPlan,
  fetchAccountAuthorizationMethods,
  fetchAccountCatalog,
  fetchAccountUsage,
  markAccountAlertsRead,
  openAccountBillingPortal,
  pollAccountBrowserAuthorization,
  pollAccountDeviceAuthorization,
  purchaseAccountCredits,
  quoteCodingInference,
  removeProviderCredential,
  saveProviderCredential,
  signInMockAccount,
  signInTwinAccount,
  signOutAccount,
  subscribeAccount,
  testProviderCredential,
  updateAccountPlan,
  updateAccountSpendPolicy,
  updateCodingInference,
  updatePreferredGenerationRoute,
} from '@volter/editor-sdk/kit/account-client';
import { registerDocumentOpener } from '@volter/editor-sdk/kit/document-open-registry';
import { openWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-document-registry';
import { VgaiLogo } from './VgaiLogo';

export const ACCOUNT_DOCUMENT_ID = 'account';

export function openAccountDocument(): string {
  return openWorkspaceDocument({
    id: ACCOUNT_DOCUMENT_ID,
    title: 'Account',
    kind: 'tool-contribution',
    workspaceRole: 'workspace-task',
    provenance: { origin: 'Volter account' },
    Content: AccountDocument,
    closeable: true,
    presentation: () => ({ kind: 'workspace', id: ACCOUNT_DOCUMENT_ID }),
  });
}

/**
 * The account document's own ADDRESS (`document-open-registry.ts`). Its
 * `presentation()` above already says the address is `{ kind: 'workspace', id:
 * 'account' }`; this is the other half — what turns that address back into
 * this document without the presenter importing this module. Registered at
 * module load, the shape `packages/game/src/story-documents/
 * three-story-documents.tsx:239` uses.
 *
 * `null` for any other workspace id: several modules answer the `workspace`
 * address (the project-tools catalog is the other), and every id this one does
 * not own belongs to the host's own workspace-document registry.
 */
registerDocumentOpener<{ readonly id: string }>({
  id: 'workspace',
  owner: 'account-documents',
  open: (_store, request) => (request.id === ACCOUNT_DOCUMENT_ID ? openAccountDocument() : null),
});

type AccountActionRunner = (action: () => Promise<unknown>, success?: string) => Promise<void>;

function providerSource(provider: ProviderCredentialStatus): string {
  if (provider.source === 'environment') {
    return `Environment · ${provider.environmentVariable}`;
  }
  if (provider.source === 'system') return 'Secure system storage';
  if (provider.source === 'session')
    return provider.configured ? 'Session only' : 'Session storage';
  return 'Not configured';
}

/** Quiet blue-tinted information strip (spec §4) — one icon, one line. */
function InfoStrip({ children }: { children: React.ReactNode }) {
  return (
    <div className="vgai-account-infostrip">
      <EditorIcon icon={faCircleInfo} className="vgai-account-infostrip-icon" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

interface ProviderRowProps {
  provider: ProviderCredentialStatus;
  busy: boolean;
  run: AccountActionRunner;
  editing: boolean;
  removing: boolean;
  onEdit: () => void;
  onStopEditing: () => void;
  onRemoveIntent: (provider: ProviderCredentialId | null) => void;
}

function ProviderRow({
  provider,
  busy,
  run,
  editing,
  removing,
  onEdit,
  onStopEditing,
  onRemoveIntent,
}: ProviderRowProps) {
  const [key, setKey] = useState('');
  return (
    <div className="vgai-account-provider" data-configured={provider.configured}>
      <span className="vgai-account-provider-monogram" aria-hidden="true">
        {provider.label.slice(0, 1)}
      </span>
      <div className="vgai-account-provider-main">
        <div className="vgai-account-provider-name">
          <strong>{provider.label}</strong>
          {provider.configured && (
            <>
              <span className="vgai-account-provider-dot" aria-hidden="true" />
              <span className="vgai-account-provider-key">{provider.maskedKey}</span>
            </>
          )}
        </div>
        <span className="vgai-account-provider-source">{providerSource(provider)}</span>
        {provider.source === 'session' && provider.configured && (
          <span className="vgai-account-provider-warning">
            No system credential manager is available. This key will be forgotten when the editor
            stops.
          </span>
        )}
        {provider.problem && (
          <span className="vgai-account-provider-warning" role="alert">
            {provider.problem}
          </span>
        )}
        {provider.source === 'environment' && (
          <span className="vgai-account-provider-source">
            Restart the editor after changing {provider.environmentVariable}.
          </span>
        )}
      </div>

      {editing ? (
        <form
          className="vgai-account-provider-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await saveProviderCredential(provider.provider, key);
              setKey('');
              onStopEditing();
            }, `${provider.label} credential saved.`);
          }}
        >
          <label className="vgai-field">
            <span className="vgai-field-label">{provider.label} API key</span>
            <TextInput
              autoComplete="off"
              autoFocus
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <div className="vgai-account-provider-form-actions">
            <Button type="submit" variant="primary" disabled={busy || key.trim() === ''}>
              Save key
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setKey('');
                onStopEditing();
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="vgai-account-provider-actions">
          {provider.configured && (
            <Button
              size="compact"
              disabled={busy}
              onClick={() =>
                void run(
                  () => testProviderCredential(provider.provider),
                  `${provider.label} credential is valid.`,
                )
              }
            >
              Test
            </Button>
          )}
          {provider.editable && (
            <Button
              size="compact"
              /* Spec §3: "Add key" (the row's one constructive action) is a
               * bordered secondary; "Replace" on an already-connected row
               * stays quiet. */
              variant={provider.configured ? 'ghost' : 'secondary'}
              disabled={busy}
              onClick={() => {
                /* A row's editor can be dismissed WITHOUT its Cancel/Save path
                 * (opening another row's editor closes this one), which would
                 * leave half-typed text to reappear on reopen. Opening always
                 * starts from an empty field. */
                setKey('');
                onEdit();
              }}
            >
              {provider.configured ? 'Replace' : 'Add key'}
            </Button>
          )}
          {provider.editable && provider.configured && !removing && (
            <Button
              size="compact"
              variant="ghost"
              disabled={busy}
              onClick={() => onRemoveIntent(provider.provider)}
            >
              Remove
            </Button>
          )}
          {removing && (
            <>
              <Button
                size="compact"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await removeProviderCredential(provider.provider);
                    onRemoveIntent(null);
                  }, `${provider.label} credential removed.`)
                }
              >
                Confirm remove
              </Button>
              <Button
                size="compact"
                variant="ghost"
                disabled={busy}
                onClick={() => onRemoveIntent(null)}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderConnections({ busy, run }: { busy: boolean; run: AccountActionRunner }) {
  const account = accountSnapshot();
  const [editing, setEditing] = useState<ProviderCredentialId | null>(null);
  const [removing, setRemoving] = useState<ProviderCredentialId | null>(null);

  const connectedCount = account.providerCredentials.filter(
    (provider) => provider.configured,
  ).length;

  return (
    <section className="vgai-account-card vgai-provider-connections">
      <div className="vgai-account-providers-header">
        <div>
          <h3 className="vgai-account-card-title">Provider connections</h3>
          <p className="vgai-account-card-sub">
            Keys live in this computer&apos;s credential manager — never in project files or the
            editor UI.
          </p>
        </div>
        <span className="vgai-status-dot" data-state={connectedCount > 0 ? 'on' : 'off'}>
          {connectedCount} connected
        </span>
      </div>
      <div className="vgai-account-provider-list">
        {account.providerCredentials.map((provider) => (
          <ProviderRow
            key={provider.provider}
            provider={provider}
            busy={busy}
            run={run}
            editing={editing === provider.provider}
            removing={removing === provider.provider}
            onEdit={() => {
              setRemoving(null);
              setEditing(provider.provider);
            }}
            onStopEditing={() => setEditing(null)}
            onRemoveIntent={setRemoving}
          />
        ))}
      </div>
    </section>
  );
}

function CodingInferenceCard({ busy, run }: { busy: boolean; run: AccountActionRunner }) {
  const account = accountSnapshot();
  const settings = account.codingInference;
  const [model, setModel] = useState(settings.model);
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof quoteCodingInference>> | null>(null);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  useEffect(() => setModel(settings.model), [settings.model]);
  useEffect(() => {
    setQuote(null);
    setQuoteProblem(null);
  }, [model, account.preferredRoute]);

  const save = (next: { enabled?: boolean; model?: string }) =>
    run(
      () =>
        updateCodingInference({
          ...settings,
          ...next,
          model: (next.model ?? settings.model).trim(),
        }),
      'Coding inference settings saved.',
    );

  return (
    <section className="vgai-account-card">
      <h3 className="vgai-account-card-title">Coding inference</h3>
      <p className="vgai-account-card-sub">
        Coding agents run on the login you already did — <code>codex login</code>, Claude&apos;s
        device login, <code>grok login</code> — and Volter Editor injects nothing into them. Turn this on
        only for a harness you have no subscription for: it routes that harness through OpenRouter
        on this account&apos;s managed credits or your own key, and it takes effect only while
        Preferred route above is Managed or BYOK. Existing sessions keep the route they launched
        with.
      </p>
      <label className="vgai-account-switch-row">
        <Checkbox
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
        <span className="vgai-account-switch-copy">
          <strong>Use OpenRouter for coding agents</strong>
          <small>
            Codex, Claude Code, OpenCode and Pi are configured per spawned process. Grok takes no
            provider configuration and always runs on its own device login.
          </small>
        </span>
      </label>
      <label className="vgai-field">
        <span className="vgai-field-label">Managed coding model</span>
        <Select
          value={model}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            setModel(next);
            if (next !== settings.model) void save({ model: next });
          }}
        >
          {!['z-ai/glm-5.2', 'moonshotai/kimi-k3'].includes(model) && (
            <option value={model}>{model} · custom</option>
          )}
          <option value="z-ai/glm-5.2">GLM-5.2 · managed default</option>
          <option value="moonshotai/kimi-k3">Kimi K3 · higher-cost option</option>
        </Select>
      </label>
      {account.preferredRoute === 'managed' ? (
        <div className="vgai-account-card-footer">
          <Button
            size="compact"
            disabled={busy}
            onClick={() => {
              setQuoteProblem(null);
              void quoteCodingInference({ model, promptTokens: 100_000, outputTokens: 20_000 })
                .then(setQuote)
                .catch((cause) =>
                  setQuoteProblem(cause instanceof Error ? cause.message : String(cause)),
                );
            }}
          >
            Preflight typical coding session
          </Button>
          {quote && (
            <span className="vgai-account-help">
              Estimate: {quote.estimatedCredits.toLocaleString()} Volter credits ($
              {quote.providerAmountUsd.toFixed(4)} provider cost) for 100k input + 20k output
              tokens.
            </span>
          )}
          {quoteProblem && (
            <span className="vgai-account-provider-warning" role="alert">
              {quoteProblem}
            </span>
          )}
        </div>
      ) : account.preferredRoute === 'byok' ? (
        <InfoStrip>
          BYOK coding charges OpenRouter directly and consumes zero Volter credits.
        </InfoStrip>
      ) : null}
      <InfoStrip>
        Active account route: {account.preferredRoute}. BYOK requires the OpenRouter connection
        below; managed uses the Volter balance.
      </InfoStrip>
    </section>
  );
}

/** Plan/status pills shown beside the email in the identity header. Suppresses
 * a status that merely repeats the plan (the mock account reports plan "Free"
 * with status "free"). */
function PlanChips({
  plan,
}: {
  plan: {
    name: string;
    status: string;
    renewsAt?: string | undefined;
    endsAt?: string | undefined;
  };
}) {
  const status = plan.status.replace('_', ' ');
  const redundant =
    plan.status === 'active' || status.toLowerCase() === plan.name.trim().toLowerCase();
  return (
    <span className="vgai-account-plan-chips">
      <span className="vgai-chip" data-tone="accent">
        {plan.name} plan
      </span>
      {!redundant && (
        <span className="vgai-chip" data-tone={plan.status === 'cancelling' ? 'warn' : undefined}>
          {status}
        </span>
      )}
      {(plan.renewsAt || plan.endsAt) && (
        <span className="vgai-chip">
          {plan.endsAt ? 'Access ends' : 'Renews'}{' '}
          {new Date(plan.endsAt ?? plan.renewsAt!).toLocaleDateString()}
        </span>
      )}
    </span>
  );
}

/** Global account subject. It can be hosted either as an editor workspace
 * document or directly by the projectless product shell. Account ownership is
 * product-global, so rendering it must never require an open game project. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One account form intentionally keeps interdependent plan, balance, route, and spend-policy disclosure in a single inspectable document.
export function AccountDocument() {
  useSyncExternalStore(subscribeAccount, accountVersion, accountVersion);
  const account = accountSnapshot();
  const [email, setEmail] = useState('builder@example.test');
  const [usage, setUsage] = useState<AccountUsageEntry[]>([]);
  const [catalog, setCatalog] = useState<AccountCatalog | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<AccountPlanId>('creator');
  const [selectedPack, setSelectedPack] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [authorization, setAuthorization] = useState<Awaited<
    ReturnType<typeof beginAccountDeviceAuthorization>
  > | null>(null);
  const [browserAuthorization, setBrowserAuthorization] = useState<Awaited<
    ReturnType<typeof beginAccountBrowserAuthorization>
  > | null>(null);
  const [deviceAuthorizationAvailable, setDeviceAuthorizationAvailable] = useState(false);

  useEffect(() => {
    if (
      account.authenticated ||
      account.backend !== 'live' ||
      account.accountEnvironment === 'development-twin'
    ) {
      setDeviceAuthorizationAvailable(false);
      return;
    }
    void fetchAccountAuthorizationMethods()
      .then((methods) => setDeviceAuthorizationAvailable(methods.device))
      .catch(() => setDeviceAuthorizationAvailable(false));
  }, [account.authenticated, account.backend]);

  useEffect(() => {
    if (!browserAuthorization) return;
    const poll = () => {
      void pollAccountBrowserAuthorization(browserAuthorization.authorizationId)
        .then((complete) => {
          if (complete) setBrowserAuthorization(null);
        })
        .catch((cause) => {
          setNotice(cause instanceof Error ? cause.message : String(cause));
          setBrowserAuthorization(null);
        });
    };
    poll();
    const timer = window.setInterval(poll, 1_000);
    return () => window.clearInterval(timer);
  }, [browserAuthorization]);

  useEffect(() => {
    if (!authorization) return;
    const poll = () => {
      void pollAccountDeviceAuthorization(authorization.deviceCode)
        .then((complete) => {
          if (complete) setAuthorization(null);
        })
        .catch((cause) => {
          setNotice(cause instanceof Error ? cause.message : String(cause));
          setAuthorization(null);
        });
    };
    const timer = window.setInterval(poll, Math.max(1, authorization.intervalSeconds) * 1_000);
    return () => window.clearInterval(timer);
  }, [authorization]);

  useEffect(() => {
    if (!account.authenticated) {
      setUsage([]);
      return;
    }
    void fetchAccountUsage()
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [
    account.authenticated,
    account.authenticated ? account.user.id : 'signed-out',
    account.authenticated ? account.credits.used : 0,
  ]);

  useEffect(() => {
    if (!account.authenticated) {
      setCatalog(null);
      return;
    }
    void fetchAccountCatalog()
      .then((next) => {
        setCatalog(next);
        const paid = (['creator', 'max', 'ultra'] as const).find((id) => id !== account.plan.id);
        setSelectedPlan(paid ?? 'creator');
        setSelectedPack(Object.keys(next.creditPacks)[0] ?? '');
      })
      .catch(() => setCatalog(null));
  }, [account.authenticated, account.authenticated ? account.user.id : 'signed-out']);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!account.authenticated) {
    return (
      <div className="vgai-account" data-testid="account-document">
        <div className="vgai-account-signin-stack">
          {/* §4-R cinematic sign-in: the key-lit mark floats on the CANVAS above
           * the card (hub empty-state anatomy) — the card carries only the form. */}
          <div className="vgai-account-signin-hero">
            <span className="vgai-account-signin-mark" aria-hidden="true">
              <VgaiLogo size={52} animation="static" />
            </span>
            <h1 className="vgai-account-signin-title">Sign in to Volter Editor</h1>
          </div>
          {account.accountEnvironment === 'development-twin' ? (
            <form
              className="vgai-account-card vgai-account-signin-card"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => signInTwinAccount(email), 'Signed in through the local Clerk Twin.');
              }}
            >
              <label className="vgai-field">
                <span className="vgai-field-label">Development email</span>
                <TextInput
                  value={email}
                  type="email"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <Button type="submit" variant="primary" disabled={busy || !email.includes('@')}>
                {busy ? 'Signing in…' : 'Use Clerk Twin account'}
              </Button>
              <InfoStrip>
                Local Clerk and Polar twins — fake identity and checkout, with the real Volter account
                and credit boundaries.
              </InfoStrip>
            </form>
          ) : account.backend === 'live' ? (
            <section className="vgai-account-card vgai-account-signin-card">
              <Button
                variant="primary"
                disabled={busy || authorization !== null || browserAuthorization !== null}
                onClick={() =>
                  void run(async () => {
                    const next = await beginAccountBrowserAuthorization();
                    setBrowserAuthorization(next);
                    window.open(next.authorizationUrl, '_blank', 'noopener,noreferrer');
                  })
                }
              >
                {browserAuthorization ? 'Waiting for browser sign-in…' : 'Continue in browser'}
              </Button>
              {deviceAuthorizationAvailable && (
                <Button
                  variant="ghost"
                  disabled={busy || authorization !== null || browserAuthorization !== null}
                  onClick={() =>
                    void run(async () => {
                      const next = await beginAccountDeviceAuthorization();
                      setAuthorization(next);
                      window.open(next.verificationUri, '_blank', 'noopener,noreferrer');
                    })
                  }
                >
                  Use a device code instead
                </Button>
              )}
              {authorization && (
                <div className="vgai-account-device-code">
                  <strong>{authorization.userCode}</strong>
                  <span>
                    Complete authorization in the browser. This editor polls without receiving your
                    password.
                  </span>
                </div>
              )}
              <InfoStrip>
                Authorization happens in your browser — this editor never sees your password.
              </InfoStrip>
            </section>
          ) : (
            <form
              className="vgai-account-card vgai-account-signin-card"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => signInMockAccount(email),
                  'Signed in to the zero-charge local account.',
                );
              }}
            >
              <label className="vgai-field">
                <span className="vgai-field-label">Email</span>
                <TextInput
                  value={email}
                  type="email"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <Button type="submit" variant="primary" disabled={busy || !email.includes('@')}>
                {busy ? 'Signing in…' : 'Use local mock account'}
              </Button>
              <InfoStrip>Local mock — no payment, network identity, or provider request.</InfoStrip>
            </form>
          )}
          <ul className="vgai-account-signin-points">
            <li>Every paid generation shows its route and estimate first</li>
            <li>Spend controls and hard limits are on by default</li>
            <li>Provider keys stay in your system credential manager</li>
          </ul>
          <CodingInferenceCard busy={busy} run={run} />
          <ProviderConnections busy={busy} run={run} />
          {(notice || accountError()) && (
            <div className="vgai-account-status" role="status">
              {notice ?? accountError()}
            </div>
          )}
        </div>
      </div>
    );
  }

  const totalCredits = account.credits.included + account.credits.purchased;
  const usedPercent =
    totalCredits === 0 ? 0 : Math.min(100, (account.credits.used / totalCredits) * 100);
  const reservedPercent =
    totalCredits === 0
      ? 0
      : Math.max(0, Math.min(100 - usedPercent, (account.credits.reserved / totalCredits) * 100));
  const overQuota = totalCredits > 0 && account.credits.used > totalCredits;
  const managedAccess = account.backend === 'mock' || account.entitlements.generation;
  const updatePolicy = (patch: Partial<AccountSpendPolicy>) =>
    updateAccountSpendPolicy({ ...account.spendPolicy, ...patch });

  return (
    <div className="vgai-account" data-testid="account-document">
      <h1 className="vgai-sr-only">Account</h1>
      <div className="vgai-account-stack">
        <header className="vgai-account-identity">
          <span className="vgai-account-avatar" aria-hidden="true">
            {account.user.email.slice(0, 1)}
          </span>
          <div className="vgai-account-identity-main">
            <div className="vgai-account-identity-row">
              <h2 className="vgai-account-identity-email">{account.user.email}</h2>
              <PlanChips plan={account.plan} />
            </div>
            <p className="vgai-account-identity-note">
              {account.accountEnvironment === 'development-twin'
                ? 'Clerk + Polar Twin development account'
                : account.backend === 'mock'
                  ? 'Isolated test account'
                  : 'Volter account'}
            </p>
          </div>
          <Button
            variant="ghost"
            className="vgai-account-signout"
            disabled={busy}
            onClick={() => void run(signOutAccount)}
          >
            Sign out
          </Button>
        </header>

        <section className="vgai-account-card">
          <div className="vgai-account-card-head">
            <h3 className="vgai-account-card-title">Credits</h3>
            {account.plan.id !== 'free' && account.plan.status === 'cancelling' && (
              <Button
                size="compact"
                disabled={busy}
                onClick={() => void run(() => updateAccountPlan('resume'))}
              >
                Resume subscription
              </Button>
            )}
          </div>
          {!managedAccess && (
            <InfoStrip>
              This account has not been admitted to Volter managed services. Signing up or paying does
              not grant provider access; contact the Volter team for admission.
            </InfoStrip>
          )}
          {catalog && (
            <div className="vgai-account-card-footer">
              <label className="vgai-field">
                <span className="vgai-field-label">Subscription tier</span>
                <Select
                  value={selectedPlan}
                  disabled={busy || !managedAccess}
                  onChange={(event) => setSelectedPlan(event.target.value as AccountPlanId)}
                >
                  {(Object.keys(catalog.plans) as AccountPlanId[]).map((id) => {
                    const plan = catalog.plans[id];
                    const price = plan.monthlyPriceUsd;
                    return (
                      <option key={id} value={id} disabled={id === 'free'}>
                        {plan.name}
                        {price !== undefined ? ` · $${price}/month` : ''} ·{' '}
                        {plan.includedCredits.toLocaleString()} credits
                        {id === account.plan.id ? ' · current' : ''}
                      </option>
                    );
                  })}
                </Select>
              </label>
              <Button
                variant="primary"
                size="compact"
                disabled={
                  busy ||
                  !managedAccess ||
                  selectedPlan === account.plan.id ||
                  selectedPlan === 'free'
                }
                onClick={() =>
                  void run(async () => {
                    const checkout = await checkoutAccountPlan(selectedPlan);
                    if (checkout.checkoutUrl)
                      window.open(checkout.checkoutUrl, '_blank', 'noopener,noreferrer');
                    else
                      setNotice(
                        checkout.mock
                          ? `Mock ${catalog.plans[selectedPlan].name} upgrade completed. No payment occurred.`
                          : `Subscription changed to ${catalog.plans[selectedPlan].name}.`,
                      );
                  })
                }
              >
                Choose {catalog.plans[selectedPlan].name}
              </Button>
            </div>
          )}
          <div className="vgai-account-credit-figure">
            <span className="vgai-account-credit-number">
              {account.credits.remaining.toLocaleString()}
            </span>
            <span className="vgai-account-credit-unit">credits remaining</span>
          </div>
          <div
            className="vgai-meter"
            role="progressbar"
            aria-label="Credits used"
            aria-valuenow={Math.round(usedPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            data-state={overQuota ? 'over' : undefined}
          >
            <span className="vgai-meter-fill" style={{ width: `${usedPercent}%` }} />
            {reservedPercent > 0 && (
              <span
                className="vgai-meter-fill"
                data-part="reserved"
                style={{ left: `${usedPercent}%`, width: `${reservedPercent}%` }}
              />
            )}
          </div>
          <p className="vgai-account-cycle-line">
            {account.credits.used.toLocaleString()} of {totalCredits.toLocaleString()} used this
            cycle
            {account.credits.resetsAt && (
              <> · resets {new Date(account.credits.resetsAt).toLocaleDateString()}</>
            )}
            {overQuota && <span className="vgai-account-cycle-over"> · over allowance</span>}
          </p>
          <div className="vgai-account-legend" data-state={overQuota ? 'over' : undefined}>
            <span className="vgai-account-legend-item" data-part="included">
              <span className="vgai-account-legend-dot" aria-hidden="true" />
              {account.credits.included.toLocaleString()} included
            </span>
            <span className="vgai-account-legend-item" data-part="used">
              <span className="vgai-account-legend-dot" aria-hidden="true" />
              {account.credits.used.toLocaleString()} used
            </span>
            <span className="vgai-account-legend-item" data-part="reserved">
              <span className="vgai-account-legend-dot" aria-hidden="true" />
              {account.credits.reserved.toLocaleString()} reserved
            </span>
            <span className="vgai-account-legend-item" data-part="purchased">
              <span className="vgai-account-legend-dot" aria-hidden="true" />
              {account.credits.purchased.toLocaleString()} purchased
            </span>
          </div>
          {account.credits.purchasedExpiresAt && (
            <p className="vgai-account-help vgai-account-expiry">
              Purchased credits expire{' '}
              {new Date(account.credits.purchasedExpiresAt).toLocaleDateString()}.
            </p>
          )}
          <div className="vgai-account-card-footer">
            {catalog && selectedPack && catalog.creditPacks[selectedPack] && (
              <>
                <Select
                  aria-label="Credit pack"
                  value={selectedPack}
                  disabled={busy || !managedAccess}
                  onChange={(event) => setSelectedPack(event.target.value)}
                >
                  {Object.entries(catalog.creditPacks).map(([id, pack]) => (
                    <option key={id} value={id}>
                      {pack.name} · {pack.credits.toLocaleString()} credits
                    </option>
                  ))}
                </Select>
                <Button
                  size="compact"
                  disabled={busy || !managedAccess}
                  onClick={() =>
                    void run(async () => {
                      const pack = catalog.creditPacks[selectedPack];
                      const checkout = await purchaseAccountCredits(selectedPack);
                      if (checkout.checkoutUrl)
                        window.open(checkout.checkoutUrl, '_blank', 'noopener,noreferrer');
                      else
                        setNotice(
                          `Added ${pack?.credits.toLocaleString() ?? ''} mock credits. No payment occurred.`,
                        );
                    })
                  }
                >
                  Buy credits
                </Button>
              </>
            )}
            <Button
              size="compact"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const portal = await openAccountBillingPortal();
                  if (portal.mock) setNotice('Mock billing portal: no payment page was opened.');
                  else window.open(portal.url, '_blank', 'noopener,noreferrer');
                })
              }
            >
              Billing and invoices
            </Button>
            {account.plan.id !== 'free' && account.plan.status === 'active' && (
              <Button
                size="compact"
                variant="ghost"
                className="vgai-account-quiet-danger"
                disabled={busy}
                onClick={() => void run(() => updateAccountPlan('cancel'))}
              >
                Cancel at renewal
              </Button>
            )}
          </div>
        </section>

        <section className="vgai-account-card">
          <h3 className="vgai-account-card-title">Generation routing</h3>
          <p className="vgai-account-card-sub">
            Billing preference for AI usage. Provider libraries apply it automatically; requests
            show the resolved account and cost before submission.
          </p>
          <label className="vgai-field">
            <span className="vgai-field-label">Preferred route</span>
            <Select
              value={account.preferredRoute}
              onChange={(event) =>
                void run(() =>
                  updatePreferredGenerationRoute(
                    event.target.value as 'auto' | 'mock' | 'managed' | 'byok',
                  ),
                )
              }
            >
              {account.accountEnvironment === 'test-mock' && (
                <option value="mock">Mock · free and local</option>
              )}
              <option value="auto">Automatic · saved key or Volter account</option>
              <option value="managed" disabled={!account.routes.managed}>
                Managed · Volter credits{account.routes.managed ? '' : ' (unavailable)'}
              </option>
              <option value="byok" disabled={!account.routes.byok}>
                BYOK · provider dollars{account.routes.byok ? '' : ' (no key found)'}
              </option>
            </Select>
          </label>
        </section>

        <CodingInferenceCard busy={busy} run={run} />
        <ProviderConnections busy={busy} run={run} />

        {(account.alerts?.length ?? 0) > 0 && (
          <section className="vgai-account-card">
            <div className="vgai-account-card-head">
              <h3 className="vgai-account-card-title">Account alerts</h3>
              {account.alerts?.some((alert) => !alert.readAt) && (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(markAccountAlertsRead)}
                >
                  Mark read
                </Button>
              )}
            </div>
            <div className="vgai-account-usage">
              {account.alerts?.map((alert) => (
                <div className="vgai-account-usage-row" key={alert.id}>
                  <span>
                    <strong>{alert.readAt ? 'Notice' : 'New'}</strong>
                    <small>{alert.message}</small>
                  </span>
                  <span>{new Date(alert.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="vgai-account-card">
          <h3 className="vgai-account-card-title">Spend controls</h3>
          <p className="vgai-account-card-sub">
            Alerts at {account.spendPolicy.alertThresholds.join('%, ')}% of the available allowance.
          </p>
          <label className="vgai-account-switch-row">
            <Checkbox
              checked={account.spendPolicy.overageEnabled}
              onChange={(event) =>
                void run(() =>
                  updatePolicy({
                    overageEnabled: event.target.checked,
                    monthlyLimitCredits:
                      event.target.checked && account.spendPolicy.monthlyLimitCredits === 0
                        ? 1_000
                        : account.spendPolicy.monthlyLimitCredits,
                  }),
                )
              }
            />
            <span className="vgai-account-switch-copy">
              <strong>Allow paid overage</strong>
              <small>Off by default. Managed requests stop before provider submission.</small>
            </span>
          </label>
          <div className="vgai-account-limit-field">
            <label className="vgai-field">
              <span className="vgai-field-label">Monthly overage hard limit</span>
              <span className="vgai-account-input-suffix">
                <TextInput
                  key={account.spendPolicy.monthlyLimitCredits}
                  type="number"
                  min={0}
                  defaultValue={account.spendPolicy.monthlyLimitCredits}
                  disabled={!account.spendPolicy.overageEnabled}
                  onBlur={(event) =>
                    void run(() =>
                      updatePolicy({ monthlyLimitCredits: Number(event.target.value) }),
                    )
                  }
                />
                <span className="vgai-account-suffix" aria-hidden="true">
                  credits
                </span>
              </span>
            </label>
          </div>
          <label className="vgai-account-switch-row">
            <Checkbox
              checked={account.spendPolicy.autoReload?.enabled === true}
              onChange={(event) =>
                void run(() =>
                  updatePolicy({
                    autoReload: {
                      enabled: event.target.checked,
                      whenRemainingBelow: account.spendPolicy.autoReload?.whenRemainingBelow ?? 100,
                      reloadTo: account.spendPolicy.autoReload?.reloadTo ?? 500,
                      monthlyLimitCredits:
                        account.spendPolicy.autoReload?.monthlyLimitCredits ?? 2_000,
                    },
                  }),
                )
              }
            />
            <span className="vgai-account-switch-copy">
              <strong>Automatically reload credits</strong>
              <small>Optional, independently capped, and never enabled by checkout.</small>
            </span>
          </label>
          {account.spendPolicy.autoReload?.enabled && (
            <div className="vgai-account-policy-fields">
              <label className="vgai-field">
                <span className="vgai-field-label">Reload below</span>
                <span className="vgai-account-input-suffix">
                  <TextInput
                    key={account.spendPolicy.autoReload.whenRemainingBelow}
                    type="number"
                    min={0}
                    defaultValue={account.spendPolicy.autoReload.whenRemainingBelow}
                    onBlur={(event) =>
                      void run(() =>
                        updatePolicy({
                          autoReload: {
                            ...account.spendPolicy.autoReload!,
                            whenRemainingBelow: Number(event.target.value),
                          },
                        }),
                      )
                    }
                  />
                  <span className="vgai-account-suffix" aria-hidden="true">
                    credits
                  </span>
                </span>
              </label>
              <label className="vgai-field">
                <span className="vgai-field-label">Reload balance to</span>
                <span className="vgai-account-input-suffix">
                  <TextInput
                    key={account.spendPolicy.autoReload.reloadTo}
                    type="number"
                    min={1}
                    defaultValue={account.spendPolicy.autoReload.reloadTo}
                    onBlur={(event) =>
                      void run(() =>
                        updatePolicy({
                          autoReload: {
                            ...account.spendPolicy.autoReload!,
                            reloadTo: Number(event.target.value),
                          },
                        }),
                      )
                    }
                  />
                  <span className="vgai-account-suffix" aria-hidden="true">
                    credits
                  </span>
                </span>
              </label>
              <label className="vgai-field">
                <span className="vgai-field-label">Monthly reload cap</span>
                <span className="vgai-account-input-suffix">
                  <TextInput
                    key={account.spendPolicy.autoReload.monthlyLimitCredits}
                    type="number"
                    min={0}
                    defaultValue={account.spendPolicy.autoReload.monthlyLimitCredits}
                    onBlur={(event) =>
                      void run(() =>
                        updatePolicy({
                          autoReload: {
                            ...account.spendPolicy.autoReload!,
                            monthlyLimitCredits: Number(event.target.value),
                          },
                        }),
                      )
                    }
                  />
                  <span className="vgai-account-suffix" aria-hidden="true">
                    credits
                  </span>
                </span>
              </label>
            </div>
          )}
        </section>

        <section className="vgai-account-card">
          <h3 className="vgai-account-card-title">Current-cycle usage</h3>
          {usage.length === 0 ? (
            <p className="vgai-account-help">
              No managed credit usage has been settled in this account.
            </p>
          ) : (
            <div className="vgai-account-usage">
              {usage.map((entry) => (
                <div className="vgai-account-usage-row" key={entry.id}>
                  <span>
                    {entry.kind} · {entry.provider} · {entry.operation ?? 'managed operation'}
                  </span>
                  <strong>{entry.credits.toLocaleString()} credits</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        {(notice || accountError()) && (
          <div className="vgai-account-status" role="status">
            {notice ?? accountError()}
          </div>
        )}
      </div>
    </div>
  );
}
