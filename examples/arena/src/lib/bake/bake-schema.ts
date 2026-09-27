/**
 * The schema fragments every parametric-asset bake tool repeats.
 *
 * A bake tool's genuinely own facts are its name, its prose, its build closure,
 * and its validation thresholds — not the shape of an output file record or the
 * dozen counters `bakeObject3DSource` returns. Those were copied verbatim into
 * each tool, so a new field meant editing every lib. Libs `.extend()` these with
 * whatever they additionally report.
 *
 * Plain data with explicit inputs and outputs; no registry and no tool factory.
 * `defineTool` stays in each lib's own file, where its summary, permission, and
 * impl belong.
 */

import { z } from 'zod';

/** One file written by a bake. */
export const BakeOutputFileSchema = z.object({
  bytes: z.number(),
  mediaType: z.string().optional(),
  path: z.string(),
  role: z.enum(['asset', 'provenance', 'other']).optional(),
});

/** What every Object3D bake reports. Extend for lib-specific counters. */
export const BakeResultSchema = z.object({
  animatedNodeCount: z.number(),
  boneCount: z.number(),
  clips: z.array(z.string()),
  dryRun: z.boolean(),
  files: z.array(BakeOutputFileSchema),
  meshCount: z.number(),
  model: z.string(),
  provenanceOperationId: z.string().optional(),
  skinnedMeshCount: z.number(),
  totalBytes: z.number(),
});

/** Stable lowercase asset name for the generated GLB. */
export const BakeAssetNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-_]{0,63}$/)
  .describe('Stable lowercase asset name used for the generated GLB file.');

export const BakeDryRunSchema = z
  .boolean()
  .default(false)
  .describe('Generate and validate the complete batch without writing project files.');

/**
 * The `{ dryRun, name, params }` base every bake tool accepts. Pass the lib's
 * own params schema already made partial and defaulted — that stays at the call
 * site so `input.params` keeps the lib's exact type, which the build closure
 * needs. This helper owns only the two fields that are identical everywhere.
 */
export function bakeInputSchema<P extends z.ZodTypeAny>(
  params: P,
  options: { defaultName: string },
) {
  return z.object({
    dryRun: BakeDryRunSchema,
    name: BakeAssetNameSchema.default(options.defaultName),
    params,
  });
}
