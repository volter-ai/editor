import { z } from 'zod';

/**
 * First-party generation JOB vocabulary.
 *
 * Providers keep their native request and result schemas. This deliberately
 * normalizes only the lifecycle that is genuinely shared by Fal, Tripo,
 * World Labs, and future generators: durable identity, state, resumption,
 * acceptance, and the charge shown to the user.
 */

export const GenerationJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const GenerationBillingSchema = z.discriminatedUnion('route', [
  z.object({ route: z.literal('mock') }).strict(),
  z
    .object({
      route: z.literal('managed'),
      estimatedCredits: z.number().nonnegative().optional(),
      settledCredits: z.number().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      route: z.literal('byok'),
      currency: z.literal('USD'),
      estimatedAmount: z.number().nonnegative().optional(),
      settledAmount: z.number().nonnegative().optional(),
    })
    .strict(),
]);

const GenerationOperationReferenceSchema = z
  .object({
    tool: z.string().min(1),
    input: z.unknown(),
  })
  .strict();

export const GenerationJobSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    externalId: z.string().min(1),
    label: z.string().min(1),
    operation: z.string().min(1),
    mode: z.enum(['mock', 'direct', 'managed']),
    status: GenerationJobStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    progress: z.number().min(0).max(1).optional(),
    providerStatus: z.string().optional(),
    queuePosition: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
    lastPolledAt: z.string().datetime().optional(),
    lastProviderChangeAt: z.string().datetime().optional(),
    pollError: z.string().optional(),
    pollErrorAt: z.string().datetime().optional(),
    pollFailureCount: z.number().int().nonnegative().optional(),
    nextPollAt: z.string().datetime().optional(),
    billing: GenerationBillingSchema,
    poll: GenerationOperationReferenceSchema,
    cancel: GenerationOperationReferenceSchema.optional(),
    accept: GenerationOperationReferenceSchema.optional(),
    acceptedAt: z.string().datetime().optional(),
    /** Last time a human/agent opened the native result. A later provider
     * update makes the terminal result unread again without changing status. */
    readAt: z.string().datetime().optional(),
    provenanceOperationId: z.string().optional(),
    outputPaths: z.array(z.string()).optional(),
  })
  .strict();

export const GenerationJobsDocumentSchema = z
  .object({
    version: z.literal(1),
    jobs: z.array(GenerationJobSchema),
  })
  .strict();

export type GenerationJobStatus = z.infer<typeof GenerationJobStatusSchema>;
export type GenerationBilling = z.infer<typeof GenerationBillingSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type GenerationJobsDocument = z.infer<typeof GenerationJobsDocumentSchema>;

/** The MANAGED arm of {@link GenerationBilling} — vgai credits, not currency. */
export type ManagedGenerationBilling = Extract<GenerationBilling, { route: 'managed' }>;

/**
 * The managed-route billing leg of a provider tool's `toUpdate`, spread-ready.
 *
 * Every provider poll tool needs the same three-part decision — is this run on
 * the managed route at all, did the provider report either credit figure, and
 * which of the two are present — and Fal, Tripo, World Labs and OpenRouter had
 * each spelled it out identically, fourteen lines apiece. The conditions are
 * not obvious enough to retype safely: reporting `route: 'managed'` with both
 * figures absent claims a charge nobody measured, and writing
 * `estimatedCredits: undefined` is NOT the same as omitting it under
 * `exactOptionalPropertyTypes` — it fails the schema rather than leaving the
 * field unset.
 *
 * Call it with the parsed result itself; only the two credit fields are read.
 *
 *     ...managedBilling(input.mode, result),
 */
export function managedBilling(
  mode: string,
  credits: {
    readonly estimatedCredits?: number | undefined;
    readonly settledCredits?: number | undefined;
  },
): { billing?: ManagedGenerationBilling } {
  if (mode !== 'managed') return {};
  const { estimatedCredits, settledCredits } = credits;
  if (estimatedCredits === undefined && settledCredits === undefined) return {};
  return {
    billing: {
      route: 'managed',
      ...(estimatedCredits === undefined ? {} : { estimatedCredits }),
      ...(settledCredits === undefined ? {} : { settledCredits }),
    },
  };
}

export interface GenerationJobDraft {
  provider: string;
  externalId: string;
  label: string;
  operation: string;
  mode: 'mock' | 'direct' | 'managed';
  status: GenerationJobStatus;
  progress?: number;
  providerStatus?: string;
  queuePosition?: number;
  message?: string;
  billing: GenerationBilling;
  poll: { tool: string; input: unknown };
  cancel?: { tool: string; input: unknown };
  accept?: { tool: string; input: unknown };
}

export interface GenerationJobUpdate {
  provider: string;
  externalId: string;
  status?: GenerationJobStatus;
  progress?: number;
  providerStatus?: string;
  queuePosition?: number;
  message?: string;
  billing?: GenerationBilling;
  cancel?: { tool: string; input: unknown };
  /** `null` withdraws an acceptance action after polling proves that a
   * successful operation produced no downloadable project output. */
  accept?: { tool: string; input: unknown } | null;
  accepted?: {
    provenanceOperationId: string;
    outputPaths: string[];
  };
}

/** Provider-owned mapping attached to a registered native operation module. */
export type GenerationToolContribution =
  | {
      role: 'submit';
      provider: string;
      toJob(input: unknown, result: unknown): GenerationJobDraft;
    }
  | {
      role: 'poll' | 'cancel' | 'accept';
      provider: string;
      toUpdate(input: unknown, result: unknown): GenerationJobUpdate;
    };
