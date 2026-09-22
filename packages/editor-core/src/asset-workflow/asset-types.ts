import { z } from 'zod';

export type AssetHealthCode =
  | 'healthy'
  | 'source-only'
  | 'missing-file'
  | 'missing-dependency'
  | 'missing-thumbnail'
  | 'unsupported-format'
  | 'invalid-metadata'
  | 'conversion-failed'
  | 'missing-attribution'
  | 'broken-asset-reference';

export interface AssetHealth {
  readonly status: 'healthy' | 'warning' | 'error';
  readonly codes: readonly AssetHealthCode[];
}

export const AssetFileSchema = z
  .object({
    label: z.string().min(1),
    path: z.string().min(1),
    format: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    dependencies: z.array(z.string().min(1)).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export const AssetDeliverySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['local-ssd', 'cloud', 'remote']),
    available: z.boolean(),
    fileIndexes: z.array(z.number().int().nonnegative()).min(1),
  })
  .strict();

export const AssetThumbnailSchema = z
  .object({
    path: z.string().min(1),
    state: z.enum(['generated', 'upstream', 'fallback', 'unsupported', 'failed']),
    profileVersion: z.string().min(1),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    resultHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    issueCode: z.string().min(1).optional(),
  })
  .strict();

export const AssetVariantSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{24}$/),
    label: z.string().min(1),
    type: z.enum(['model', 'animation', 'source']),
    files: z.array(AssetFileSchema).min(1),
    deliveries: z.array(AssetDeliverySchema).min(1),
    thumbnail: AssetThumbnailSchema,
    animationCount: z.number().int().nonnegative().optional(),
    clipNames: z.array(z.string()).optional(),
  })
  .strict();

export const AssetFamilySchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{24}$/),
    source: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['model', 'animation', 'source']),
    categories: z.array(z.string()),
    tags: z.array(z.string()),
    license: z.string().min(1),
    author: z.string().min(1),
    sourceUrl: z.string().url(),
    variants: z.array(AssetVariantSchema).min(1),
  })
  .strict();

export const AssetCatalogEnvelopeSchema = z
  .object({
    version: z.literal(2),
    generatedAt: z.string().datetime(),
    families: z.array(z.unknown()),
  })
  .strict();

export type AssetFile = z.infer<typeof AssetFileSchema>;
export type AssetDelivery = z.infer<typeof AssetDeliverySchema>;
export type AssetVariant = z.infer<typeof AssetVariantSchema>;
export type AssetFamily = z.infer<typeof AssetFamilySchema>;

export interface AssetCatalogIssue {
  readonly familyIndex: number | null;
  readonly familyId?: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export interface AssetCatalog {
  readonly version: 2;
  readonly generatedAt: string;
  readonly families: readonly AssetFamily[];
  readonly issues: readonly AssetCatalogIssue[];
}

export function parseAssetCatalog(input: unknown): AssetCatalog {
  const envelope = AssetCatalogEnvelopeSchema.parse(input);
  const families: AssetFamily[] = [];
  const issues: AssetCatalogIssue[] = [];
  for (const [familyIndex, candidate] of envelope.families.entries()) {
    const result = AssetFamilySchema.safeParse(candidate);
    if (result.success) {
      families.push(result.data);
      continue;
    }
    const familyId =
      candidate &&
      typeof candidate === 'object' &&
      'id' in candidate &&
      typeof candidate.id === 'string'
        ? candidate.id
        : undefined;
    for (const issue of result.error.issues) {
      issues.push({
        familyIndex,
        ...(familyId ? { familyId } : {}),
        path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
        message: issue.message,
      });
    }
  }
  return { version: 2, generatedAt: envelope.generatedAt, families, issues };
}
