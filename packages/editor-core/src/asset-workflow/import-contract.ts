import { isContainedRelativePath } from '@volter/editor-sdk/session/relative-path-guard';
import { z } from 'zod';

export const assetImportSettingsSchema = z
  .object({
    scale: z.number().positive().default(1),
    sourceUnits: z.enum(['auto', 'mm', 'cm', 'm', 'in', 'ft']).default('auto'),
    upAxis: z.enum(['auto', 'x', 'y', 'z']).default('auto'),
    forwardAxis: z.enum(['auto', 'x', '-x', 'y', '-y', 'z', '-z']).default('auto'),
    normals: z.enum(['preserve', 'generate', 'recalculate']).default('preserve'),
    tangents: z.enum(['preserve', 'generate', 'discard']).default('preserve'),
    materials: z.enum(['import', 'discard']).default('import'),
    textures: z.enum(['copy', 'embed', 'discard']).default('copy'),
    animations: z.array(z.string()).default([]),
    meshOptimization: z.enum(['none', 'safe', 'aggressive']).default('safe'),
    retainSource: z.boolean().default(true),
  })
  .strict();
export type AssetImportSettings = z.infer<typeof assetImportSettingsSchema>;

const safePathSchema = z
  .string()
  .min(1)
  .refine(isContainedRelativePath, 'Path must stay within the source/project root.');

const importFileSchema = z
  .object({
    path: safePathSchema,
    url: z.string().min(1),
    hash: z.string().min(8),
    size: z.number().int().nonnegative(),
    role: z.enum(['primary', 'dependency', 'material', 'texture']),
  })
  .strict();

export const assetImportPlanSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    identity: z
      .object({
        familyId: z.string().min(1),
        variantId: z.string().min(1),
        deliveryId: z.string().min(1),
        source: z.string().min(1).optional(),
        displayName: z.string().min(1).optional(),
      })
      .strict(),
    sourceFiles: z.array(importFileSchema).min(1),
    generatedFiles: z.array(safePathSchema),
    destination: safePathSchema,
    contentKind: z
      .enum(['model', 'animation-only', 'image', 'audio', 'material', 'data'])
      .default('model'),
    targetSkeleton: z.string().optional(),
    settings: assetImportSettingsSchema,
    conflicts: z.array(
      z
        .object({ path: z.string(), resolution: z.enum(['reuse', 'update', 'rename', 'cancel']) })
        .strict(),
    ),
    attribution: z
      .object({
        sourceUrl: z.string(),
        author: z.string(),
        license: z.string(),
        text: z.string(),
      })
      .strict(),
    sourceHash: z.string().min(8),
    runtimeReady: z.boolean(),
    backend: z.enum(['native', 'three', 'blender']),
    createdAt: z.string(),
  })
  .superRefine((plan, context) => {
    if (plan.contentKind === 'animation-only' && plan.runtimeReady && !plan.targetSkeleton) {
      context.addIssue({
        code: 'custom',
        path: ['targetSkeleton'],
        message: 'Runtime-ready animation-only imports require a compatible target skeleton.',
      });
    }
  });
export type AssetImportPlan = z.infer<typeof assetImportPlanSchema>;

export const assetImportResultSchema = z
  .object({
    version: z.literal(1),
    planId: z.string(),
    status: z.enum(['imported', 'skipped', 'failed', 'cancelled']),
    writtenFiles: z.array(
      z
        .object({ path: z.string(), hash: z.string(), size: z.number().int().nonnegative() })
        .strict(),
    ),
    skippedFiles: z.array(z.string()),
    issues: z.array(
      z.object({ code: z.string(), stage: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export type AssetImportResult = z.infer<typeof assetImportResultSchema>;

export type AssetImportStage = 'fetch' | 'convert' | 'validate' | 'commit';
export interface AssetImportProgress {
  stage: AssetImportStage;
  item: string;
  loaded: number;
  total: number;
}

export type AssetConflictKind =
  | 'same-identity-same-hash'
  | 'same-identity-updated'
  | 'different-identity-same-name'
  | 'user-edited-output';
export function safeConflictResolution(
  kind: AssetConflictKind,
): 'reuse' | 'update' | 'rename' | 'cancel' {
  if (kind === 'same-identity-same-hash') return 'reuse';
  if (kind === 'same-identity-updated') return 'update';
  if (kind === 'different-identity-same-name') return 'rename';
  return 'cancel';
}
