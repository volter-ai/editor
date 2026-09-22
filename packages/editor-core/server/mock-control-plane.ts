/**
 * THE MOCK GENERATIVE CONTROL PLANE — the editor server's dev twin of the
 * managed generation service. Moved here from `@vgai/generative-gateway`
 * (archived at `archive/launch-scope-2026-09-20`, launch-scope sweep,
 * 2026-09-20) because `account-service.ts` is the one remaining consumer and
 * an editor file may not import across a package that no longer exists.
 * When the managed services return from the tag, this file goes back with
 * them.
 */
import type { AccountSnapshot, AccountSpendPolicy, AccountUsageEntry } from '@volter/editor-sdk/account';
import { AccountSpendPolicySchema } from '@volter/editor-sdk/account';

interface FetcherLike {
  fetch(request: Request): Promise<Response>;
}

export interface MockGenerativePlan {
  id: 'free' | 'creator' | 'max' | 'ultra';
  name: string;
  generation: boolean;
  dailyJobs: number;
  includedCredits: number;
  monthlyPriceUsd?: number;
}

export interface MockCreditPack {
  name: string;
  credits: number;
  expiresInDays?: number;
}

export interface MockGenerativeUser {
  id: string;
  email: string;
  plan: MockGenerativePlan;
  planStatus?: 'active' | 'cancelling';
  planRenewsAt?: string;
}

export type MockGenerativeControlPlane = FetcherLike;

interface MockReservation {
  userId: string;
  provider: string;
  kind: AccountUsageEntry['kind'];
  operation?: string;
  estimatedCredits: number;
  state: 'reserved' | 'settled' | 'released';
  settledCredits?: number;
}

/** Serializable state owned by the mock control plane. Hosts may persist this
 * opaque document, but must not reproduce its accounting rules. */
export interface MockGenerativeControlPlaneState {
  version: 1;
  users: MockGenerativeUser[];
  sessions: Array<[string, string]>;
  reservations: Array<[string, MockReservation]>;
  purchasedCredits: Array<[string, number]>;
  usage: Array<[string, AccountUsageEntry[]]>;
  policies: Array<[string, AccountSpendPolicy]>;
  monthlyReloadedCredits: Array<[string, number]>;
}

export interface MockGenerativeControlPlaneOptions {
  state?: MockGenerativeControlPlaneState;
  onStateChange?: (state: MockGenerativeControlPlaneState) => void | Promise<void>;
  plans?: Record<MockGenerativePlan['id'], MockGenerativePlan>;
  creditPacks?: Record<string, MockCreditPack>;
}

const DEFAULT_MOCK_PLANS: Record<MockGenerativePlan['id'], MockGenerativePlan> = {
  free: {
    id: 'free',
    name: 'Free',
    generation: true,
    dailyJobs: 10,
    includedCredits: 100,
    monthlyPriceUsd: 0,
  },
  creator: {
    id: 'creator',
    name: 'Creator',
    generation: true,
    dailyJobs: 100,
    includedCredits: 2_000,
    monthlyPriceUsd: 20,
  },
  max: {
    id: 'max',
    name: 'Max',
    generation: true,
    dailyJobs: 500,
    includedCredits: 10_000,
    monthlyPriceUsd: 100,
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra',
    generation: true,
    dailyJobs: 2_000,
    includedCredits: 40_000,
    monthlyPriceUsd: 200,
  },
};

const DEFAULT_MOCK_CREDIT_PACKS: Record<string, MockCreditPack> = {
  'credits-500': { name: '500 credits', credits: 500 },
};

function stableId(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function bearer(request: Request): string | undefined {
  return request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function validUsageKind(value: unknown): value is AccountUsageEntry['kind'] {
  return ['inference', 'generation', 'workspace', 'storage', 'relay', 'deployment'].includes(
    String(value),
  );
}

/**
 * In-memory HTTP-shaped account/billing service for local development. It is
 * intentionally explicit about being a zero-charge mock and also implements
 * the gateway's production `VGAI_AUTH` service-binding contract.
 */
export function createMockGenerativeControlPlane(
  options: MockGenerativeControlPlaneOptions = {},
): MockGenerativeControlPlane {
  const initial = options.state;
  const plans = options.plans ?? DEFAULT_MOCK_PLANS;
  const creditPacks = options.creditPacks ?? DEFAULT_MOCK_CREDIT_PACKS;
  const users = new Map(
    (initial?.users ?? []).map((user) => [
      user.id,
      { ...user, plan: { ...(plans[user.plan.id] ?? user.plan), ...user.plan } },
    ]),
  );
  const sessions = new Map(initial?.sessions ?? []);
  const reservations = new Map<string, MockReservation>(initial?.reservations ?? []);
  const purchasedCredits = new Map(initial?.purchasedCredits ?? []);
  const usage = new Map(initial?.usage ?? []);
  const policies = new Map(initial?.policies ?? []);
  const monthlyReloadedCredits = new Map(initial?.monthlyReloadedCredits ?? []);

  const persistedState = (): MockGenerativeControlPlaneState => ({
    version: 1,
    users: [...users.values()],
    sessions: [...sessions.entries()],
    reservations: [...reservations.entries()],
    purchasedCredits: [...purchasedCredits.entries()],
    usage: [...usage.entries()],
    policies: [...policies.entries()],
    monthlyReloadedCredits: [...monthlyReloadedCredits.entries()],
  });
  const persist = async () => options.onStateChange?.(persistedState());

  const policy = (userId: string): AccountSpendPolicy => {
    const value = policies.get(userId) ?? {
      overageEnabled: false,
      monthlyLimitCredits: 0,
      alertThresholds: [50, 80, 100],
    };
    policies.set(userId, value);
    return value;
  };

  const account = (user: MockGenerativeUser): Extract<AccountSnapshot, { authenticated: true }> => {
    const entries = usage.get(user.id) ?? [];
    const used = entries
      .filter((entry) => entry.state === 'settled')
      .reduce((total, entry) => total + entry.credits, 0);
    const reserved = [...reservations.values()]
      .filter((entry) => entry.userId === user.id && entry.state === 'reserved')
      .reduce((total, entry) => total + entry.estimatedCredits, 0);
    const purchased = purchasedCredits.get(user.id) ?? 0;
    const allowance = user.plan.includedCredits + purchased;
    return {
      authenticated: true,
      backend: 'mock',
      user: { id: user.id, email: user.email },
      plan: {
        id: user.plan.id,
        name: user.plan.name,
        status: user.plan.id === 'free' ? 'free' : (user.planStatus ?? 'active'),
        ...(user.plan.id !== 'free'
          ? {
              interval: 'month' as const,
              ...(user.planStatus === 'cancelling'
                ? { endsAt: user.planRenewsAt }
                : { renewsAt: user.planRenewsAt }),
            }
          : {}),
      },
      credits: {
        included: user.plan.includedCredits,
        purchased,
        used,
        reserved,
        remaining: Math.max(0, allowance - used - reserved),
      },
      spendPolicy: policy(user.id),
      entitlements: { generation: user.plan.generation, dailyJobs: user.plan.dailyJobs },
    };
  };

  const createSession = async (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new Error('Mock signup requires an email address.');
    const userId = `mock_user_${stableId(normalized)}`;
    let user = users.get(userId);
    if (!user) {
      user = { id: userId, email: normalized, plan: { ...plans.free } };
      users.set(userId, user);
    }
    const token = `mock_session_${stableId(`${normalized}:${sessions.size}`)}`;
    sessions.set(token, userId);
    await persist();
    return { token, user };
  };

  const authenticated = (request: Request): MockGenerativeUser | undefined => {
    const token = bearer(request);
    const userId = token ? sessions.get(token) : undefined;
    return userId ? users.get(userId) : undefined;
  };

  return {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The mock deliberately shows its complete small HTTP account/billing contract in one inspectable dispatcher.
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/v1/sessions') {
        const body = (await request.json()) as { email?: unknown };
        if (typeof body.email !== 'string') {
          return Response.json({ error: 'email is required' }, { status: 400 });
        }
        return Response.json(
          { mode: 'mock', ...(await createSession(body.email)) },
          { status: 201 },
        );
      }

      // Internal service-binding calls are authenticated by binding identity,
      // not an end-user bearer token. This mock charges no real currency.
      if (
        request.method === 'POST' &&
        ['/generation/authorize', '/usage/authorize'].includes(url.pathname)
      ) {
        const body = (await request.json()) as {
          userId?: unknown;
          provider?: unknown;
          kind?: unknown;
          workload?: unknown;
          operation?: unknown;
          estimatedCredits?: unknown;
        };
        if (typeof body.userId !== 'string' || !users.has(body.userId)) {
          return Response.json({ error: 'Unknown billing user' }, { status: 404 });
        }
        const user = users.get(body.userId)!;
        const estimate = typeof body.estimatedCredits === 'number' ? body.estimatedCredits : 0;
        const spendPolicy = policy(user.id);
        const beforeReload = account(user);
        const autoReload = spendPolicy.autoReload;
        if (autoReload?.enabled && beforeReload.credits.remaining < autoReload.whenRemainingBelow) {
          const reloadCredits = Math.max(0, autoReload.reloadTo - beforeReload.credits.remaining);
          const reloadedThisMonth = monthlyReloadedCredits.get(user.id) ?? 0;
          if (reloadedThisMonth + reloadCredits <= autoReload.monthlyLimitCredits) {
            purchasedCredits.set(user.id, (purchasedCredits.get(user.id) ?? 0) + reloadCredits);
            monthlyReloadedCredits.set(user.id, reloadedThisMonth + reloadCredits);
          }
        }
        const current = account(user);
        // The hard limit is cumulative for the billing period, not a maximum
        // size for each individual request. `used + reserved` already includes
        // every earlier authorization, so repeated small requests cannot walk
        // past the monthly cap.
        const allowance = current.credits.included + current.credits.purchased;
        const projectedOverage = Math.max(
          0,
          current.credits.used + current.credits.reserved + estimate - allowance,
        );
        if (
          projectedOverage > 0 &&
          (!spendPolicy.overageEnabled || projectedOverage > spendPolicy.monthlyLimitCredits)
        ) {
          return Response.json(
            { error: 'Managed credit limit reached', code: 'CREDIT_LIMIT_REACHED' },
            { status: 402 },
          );
        }
        const reservationId = `mock_reservation_${stableId(`${body.userId}:${String(body.provider)}:${reservations.size}`)}`;
        reservations.set(reservationId, {
          userId: body.userId,
          provider: String(body.provider ?? 'unknown'),
          kind:
            body.workload === 'coding'
              ? 'inference'
              : validUsageKind(body.kind)
                ? body.kind
                : 'generation',
          ...(typeof body.operation === 'string' ? { operation: body.operation } : {}),
          estimatedCredits: estimate,
          state: 'reserved',
        });
        await persist();
        return Response.json({ reservationId, estimatedCredits: estimate, mode: 'mock' });
      }
      if (
        request.method === 'POST' &&
        ['/generation/quote', '/usage/quote'].includes(url.pathname)
      ) {
        const body = (await request.json()) as { userId?: unknown };
        if (typeof body.userId !== 'string' || !users.has(body.userId)) {
          return Response.json({ error: 'Unknown billing user' }, { status: 404 });
        }
        const estimate = body as { estimatedCredits?: unknown };
        const credits =
          typeof estimate.estimatedCredits === 'number' ? estimate.estimatedCredits : 0;
        return Response.json({ estimatedCredits: credits, mode: 'mock' });
      }
      if (
        request.method === 'POST' &&
        ['/generation/settle', '/usage/settle'].includes(url.pathname)
      ) {
        const body = (await request.json()) as {
          reservationId?: unknown;
          settledCredits?: unknown;
          externalId?: unknown;
        };
        if (typeof body.reservationId !== 'string' || !reservations.has(body.reservationId)) {
          return Response.json({ error: 'Unknown billing reservation' }, { status: 404 });
        }
        const reservation = reservations.get(body.reservationId)!;
        if (reservation.state === 'released') {
          return Response.json(
            { error: 'Billing reservation was already released' },
            { status: 409 },
          );
        }
        const settled =
          reservation.settledCredits ??
          (typeof body.settledCredits === 'number'
            ? body.settledCredits
            : reservation.estimatedCredits);
        reservation.settledCredits = settled;
        reservation.state = 'settled';
        if (
          !(usage.get(reservation.userId) ?? []).some((entry) => entry.id === body.reservationId)
        ) {
          usage.set(reservation.userId, [
            {
              id: body.reservationId,
              occurredAt: new Date().toISOString(),
              kind: reservation.kind,
              provider: reservation.provider,
              ...(reservation.operation ? { operation: reservation.operation } : {}),
              credits: settled,
              state: 'settled',
              ...(typeof body.externalId === 'string' ? { externalId: body.externalId } : {}),
            },
            ...(usage.get(reservation.userId) ?? []),
          ]);
        }
        await persist();
        return Response.json({ settledCredits: settled, mode: 'mock' });
      }
      if (
        request.method === 'POST' &&
        ['/generation/release', '/usage/release'].includes(url.pathname)
      ) {
        const body = (await request.json()) as {
          reservationId?: unknown;
          reason?: unknown;
          externalId?: unknown;
        };
        if (typeof body.reservationId !== 'string' || !reservations.has(body.reservationId)) {
          return Response.json({ error: 'Unknown billing reservation' }, { status: 404 });
        }
        const reservation = reservations.get(body.reservationId)!;
        if (reservation.state === 'settled') {
          return Response.json(
            { error: 'Billing reservation was already settled' },
            { status: 409 },
          );
        }
        if (reservation.state === 'released') {
          return Response.json({ released: true, mode: 'mock' });
        }
        reservation.state = 'released';
        if (
          !(usage.get(reservation.userId) ?? []).some((entry) => entry.id === body.reservationId)
        ) {
          usage.set(reservation.userId, [
            {
              id: body.reservationId,
              occurredAt: new Date().toISOString(),
              kind: reservation.kind,
              provider: reservation.provider,
              ...(reservation.operation ? { operation: reservation.operation } : {}),
              credits: 0,
              state: 'released',
              ...(typeof body.externalId === 'string' ? { externalId: body.externalId } : {}),
            },
            ...(usage.get(reservation.userId) ?? []),
          ]);
        }
        await persist();
        return Response.json({ released: true, mode: 'mock' });
      }

      const user = authenticated(request);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

      if (request.method === 'GET' && url.pathname === '/verify') {
        return Response.json({
          userId: user.id,
          entitlements: { generation: user.plan.generation, dailyJobs: user.plan.dailyJobs },
        });
      }
      if (request.method === 'GET' && url.pathname === '/v1/me') {
        return Response.json(account(user));
      }
      if (request.method === 'GET' && url.pathname === '/v1/account') {
        return Response.json(account(user));
      }
      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        return Response.json({ mode: 'mock', entries: usage.get(user.id) ?? [] });
      }
      if (request.method === 'GET' && url.pathname === '/v1/catalog') {
        return Response.json({ plans, creditPacks });
      }
      if (request.method === 'PUT' && url.pathname === '/v1/spend-policy') {
        const body = (await request.json()) as Partial<AccountSpendPolicy>;
        const current = policy(user.id);
        const next = AccountSpendPolicySchema.safeParse({
          overageEnabled:
            typeof body.overageEnabled === 'boolean' ? body.overageEnabled : current.overageEnabled,
          monthlyLimitCredits:
            typeof body.monthlyLimitCredits === 'number' && body.monthlyLimitCredits >= 0
              ? body.monthlyLimitCredits
              : current.monthlyLimitCredits,
          alertThresholds:
            Array.isArray(body.alertThresholds) &&
            body.alertThresholds.every((value) => typeof value === 'number')
              ? body.alertThresholds
              : current.alertThresholds,
          ...(body.autoReload ? { autoReload: body.autoReload } : {}),
        });
        if (!next.success) {
          return Response.json(
            { error: 'Invalid spend policy', issues: next.error.issues },
            { status: 400 },
          );
        }
        policies.set(user.id, next.data);
        await persist();
        return Response.json(account(user));
      }
      if (request.method === 'GET' && url.pathname === '/v1/entitlements') {
        return Response.json({
          mode: 'mock',
          entitlements: { generation: user.plan.generation, dailyJobs: user.plan.dailyJobs },
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/billing/checkout') {
        const body = (await request.json()) as { plan?: unknown };
        const plan =
          typeof body.plan === 'string' ? plans[body.plan as MockGenerativePlan['id']] : undefined;
        if (!plan || plan.id === 'free') {
          return Response.json(
            { error: 'Mock checkout requires a configured paid plan.' },
            { status: 400 },
          );
        }
        user.plan = { ...plan };
        user.planStatus = 'active';
        user.planRenewsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
        await persist();
        return Response.json({
          mode: 'mock',
          checkout: {
            status: 'complete',
            charged: false,
            plan: user.plan.id,
            url: `mock://checkout/${user.id}/${user.plan.id}`,
          },
          user,
        });
      }
      if (request.method === 'PUT' && url.pathname === '/v1/plan') {
        const body = (await request.json()) as { action?: unknown };
        if (user.plan.id === 'free') {
          return Response.json(
            { error: 'The Free plan has no subscription to change.' },
            { status: 400 },
          );
        }
        if (body.action !== 'cancel' && body.action !== 'resume') {
          return Response.json({ error: 'action must be cancel or resume' }, { status: 400 });
        }
        user.planStatus = body.action === 'cancel' ? 'cancelling' : 'active';
        user.planRenewsAt ??= new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
        await persist();
        return Response.json(account(user));
      }
      if (request.method === 'POST' && url.pathname === '/v1/credits/purchase') {
        const body = (await request.json()) as { packId?: unknown; credits?: unknown };
        const pack = typeof body.packId === 'string' ? creditPacks[body.packId] : undefined;
        const credits = pack?.credits ?? body.credits;
        if (typeof credits !== 'number' || credits <= 0) {
          return Response.json({ error: 'A configured credit pack is required' }, { status: 400 });
        }
        purchasedCredits.set(user.id, (purchasedCredits.get(user.id) ?? 0) + credits);
        await persist();
        return Response.json({ mode: 'mock', charged: false, account: account(user) });
      }
      if (request.method === 'POST' && url.pathname === '/v1/credits/checkout') {
        return Response.json({
          mode: 'mock',
          checkout: { url: `mock://credits/${user.id}`, charged: false },
        });
      }
      if (request.method === 'POST' && url.pathname === '/v1/billing/portal') {
        return Response.json({
          mode: 'mock',
          portal: { url: `mock://billing/${user.id}`, charged: false },
        });
      }
      return Response.json({ error: 'Not found' }, { status: 404 });
    },
  };
}
