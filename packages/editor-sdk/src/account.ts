import { z } from 'zod';

// Account identity and billing preference are host configuration, never generation-call inputs.
export const AccountBackendSchema = z.enum(['mock', 'live']);
export const AccountPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['free', 'trialing', 'active', 'past_due', 'cancelling']),
  interval: z.enum(['month', 'year']).optional(),
  renewsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export const AccountCreditsSchema = z.object({
  included: z.number().nonnegative(),
  purchased: z.number().nonnegative(),
  used: z.number().nonnegative(),
  reserved: z.number().nonnegative(),
  remaining: z.number().nonnegative(),
  resetsAt: z.string().datetime().optional(),
  purchasedExpiresAt: z.string().datetime().optional(),
});
export const AccountSpendPolicySchema = z.object({
  overageEnabled: z.boolean(),
  monthlyLimitCredits: z.number().nonnegative(),
  alertThresholds: z.array(z.number().min(1).max(100)).max(8),
  autoReload: z
    .object({
      enabled: z.boolean(),
      whenRemainingBelow: z.number().nonnegative(),
      reloadTo: z.number().positive(),
      monthlyLimitCredits: z.number().nonnegative(),
    })
    .optional(),
});
export const AccountAlertSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['threshold', 'auto_reload_succeeded', 'auto_reload_failed']),
  message: z.string().min(1),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().optional(),
});
export const AccountUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).optional(),
});
export const AccountOrganizationDomainSchema = z.object({
  name: z.string().min(1),
  verified: z.boolean(),
  enrollmentMode: z.enum([
    'manual_invitation',
    'automatic_invitation',
    'automatic_suggestion',
    'enterprise_sso',
  ]),
});
export const AccountOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  role: z.string().min(1),
  domains: z.array(AccountOrganizationDomainSchema).max(50),
});
export const AccountUsageEntrySchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
  kind: z.enum(['inference', 'generation', 'workspace', 'storage', 'relay', 'deployment']),
  provider: z.string().min(1),
  operation: z.string().optional(),
  credits: z.number().nonnegative(),
  state: z.enum(['reserved', 'settled', 'released']),
  externalId: z.string().optional(),
});
export const AccountPlanIdSchema = z.enum(['free', 'creator', 'max', 'ultra']);
export const AccountCatalogSchema = z.object({
  plans: z.object({
    free: z.object({
      name: z.string().min(1),
      includedCredits: z.number().int().nonnegative(),
      monthlyPriceUsd: z.number().nonnegative().optional(),
    }),
    creator: z.object({
      name: z.string().min(1),
      includedCredits: z.number().int().nonnegative(),
      monthlyPriceUsd: z.number().nonnegative().optional(),
    }),
    max: z.object({
      name: z.string().min(1),
      includedCredits: z.number().int().nonnegative(),
      monthlyPriceUsd: z.number().nonnegative().optional(),
    }),
    ultra: z.object({
      name: z.string().min(1),
      includedCredits: z.number().int().nonnegative(),
      monthlyPriceUsd: z.number().nonnegative().optional(),
    }),
  }),
  creditPacks: z.record(
    z.string().min(1),
    z.object({
      name: z.string().min(1),
      credits: z.number().int().positive(),
      expiresInDays: z.number().int().positive().optional(),
    }),
  ),
});
export const AccountSnapshotSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false), backend: AccountBackendSchema }),
  z.object({
    authenticated: z.literal(true),
    backend: AccountBackendSchema,
    user: AccountUserSchema,
    organizations: z.array(AccountOrganizationSchema).max(100).optional(),
    plan: AccountPlanSchema,
    credits: AccountCreditsSchema,
    spendPolicy: AccountSpendPolicySchema,
    alerts: z.array(AccountAlertSchema).max(100).optional(),
    entitlements: z.object({
      generation: z.boolean(),
      dailyJobs: z.number().int().positive().optional(),
    }),
  }),
]);
/** Product-facing routes. Provider tools may translate BYOK to their native
 * transport name (`direct`) internally. */
export const GenerationExecutionRouteSchema = z.enum(['auto', 'mock', 'managed', 'byok']);
export const ProviderCredentialIdSchema = z.enum(['fal', 'tripo', 'worldlabs', 'openrouter']);
export const CodingInferenceSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('openrouter'),
  model: z.string().trim().min(1).max(256),
});
export const ProviderCredentialSourceSchema = z.enum(['environment', 'system', 'session', 'none']);
export const ProviderCredentialStatusSchema = z.object({
  provider: ProviderCredentialIdSchema,
  label: z.string().min(1),
  environmentVariable: z.string().min(1),
  configured: z.boolean(),
  source: ProviderCredentialSourceSchema,
  editable: z.boolean(),
  persistence: z.enum(['system', 'session']),
  maskedKey: z.string().min(1).optional(),
  problem: z.string().min(1).optional(),
});
export const ProviderCredentialTestResultSchema = z.object({
  provider: ProviderCredentialIdSchema,
  ok: z.literal(true),
  testedAt: z.string().datetime(),
});

export type AccountBackend = z.infer<typeof AccountBackendSchema>;
export type AccountPlan = z.infer<typeof AccountPlanSchema>;
export type AccountCredits = z.infer<typeof AccountCreditsSchema>;
export type AccountSpendPolicy = z.infer<typeof AccountSpendPolicySchema>;
export type AccountAlert = z.infer<typeof AccountAlertSchema>;
export type AccountUser = z.infer<typeof AccountUserSchema>;
export type AccountOrganization = z.infer<typeof AccountOrganizationSchema>;
export type AccountOrganizationDomain = z.infer<typeof AccountOrganizationDomainSchema>;
export type AccountUsageEntry = z.infer<typeof AccountUsageEntrySchema>;
export type AccountPlanId = z.infer<typeof AccountPlanIdSchema>;
export type AccountCatalog = z.infer<typeof AccountCatalogSchema>;
export type AccountSnapshot = z.infer<typeof AccountSnapshotSchema>;
export type GenerationExecutionRoute = z.infer<typeof GenerationExecutionRouteSchema>;
export type CodingInferenceSettings = z.infer<typeof CodingInferenceSettingsSchema>;
export type ProviderCredentialId = z.infer<typeof ProviderCredentialIdSchema>;
export type ProviderCredentialSource = z.infer<typeof ProviderCredentialSourceSchema>;
export type ProviderCredentialStatus = z.infer<typeof ProviderCredentialStatusSchema>;
export type ProviderCredentialTestResult = z.infer<typeof ProviderCredentialTestResultSchema>;
export type EditorAccountSnapshot = AccountSnapshot & {
  /** Which identity/payment surface backs this editor session. The in-process
   * mock value exists only for isolated unit tests. */
  accountEnvironment: 'test-mock' | 'development-twin' | 'production';
  routes: { mock: true; managed: boolean; byok: boolean; byokProviders: string[] };
  preferredRoute: GenerationExecutionRoute;
  /** Editor-only metadata. Credential values never cross the server boundary. */
  providerCredentials: ProviderCredentialStatus[];
  codingInference: CodingInferenceSettings;
};
export interface GenerationAccountProjection {
  routes: EditorAccountSnapshot['routes'];
  preferredRoute: GenerationExecutionRoute;
}
export function generationAccountProjection(
  account: EditorAccountSnapshot,
): GenerationAccountProjection {
  return {
    routes: {
      mock: true,
      managed: account.routes.managed,
      byok: account.routes.byok,
      byokProviders: [...account.routes.byokProviders],
    },
    preferredRoute: account.preferredRoute,
  };
}
export const EditorAccountSnapshotSchema: z.ZodType<EditorAccountSnapshot> = z.intersection(
  AccountSnapshotSchema,
  z.object({
    accountEnvironment: z.enum(['test-mock', 'development-twin', 'production']),
    routes: z.object({
      mock: z.literal(true),
      managed: z.boolean(),
      byok: z.boolean(),
      byokProviders: z.array(z.string().min(1)),
    }),
    preferredRoute: GenerationExecutionRouteSchema,
    providerCredentials: z.array(ProviderCredentialStatusSchema),
    codingInference: CodingInferenceSettingsSchema,
  }),
);
