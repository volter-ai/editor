/**
 * The ASSET SEED — the procedural-asset family's serializable "what to build".
 *
 * Every parametric asset lib in this family (the humanoid, the walking
 * castle, whatever you add next) exports the same PAIR: a declared params
 * schema and the synchronous function that takes it (see `params.ts`'s
 * `describeNumericParams`, which reads the tuning controls off that
 * declaration). A seed is the JSON-able record of one call to that pair:
 *
 *   { generator, variant?, params?, palette? }
 *
 * That is deliberately the smallest thing that can round-trip through a save
 * file, a network spawn packet, a URL, or a character creator's state.
 * Because generation is synchronous and loads no assets, a seed is enough to
 * REBUILD the asset anywhere — no baked GLB has to travel with it.
 *
 * FAMILY-LEVEL ON PURPOSE, and it lives HERE rather than in any one lib
 * because `lib/bake` is already where the family's cross-member contracts
 * live: `params.ts` (the schema-pair parameterization both Builders derive
 * their controls from) and the bake host itself. `bake` is a `requires` of
 * both `humanoid` and `castle`, so a seed is reachable from either without
 * one lib depending on the other.
 *
 * The shape knows NOTHING about humanoids: a walking castle seed is
 * `{ generator: 'castle', variant: 'keep', params: { towers: 4 },
 * palette: { stone: 0x8a8a92 } }` and fits it exactly. Each lib supplies its
 * own thin instance — the pair of functions that turn a seed into a built
 * asset and a built asset's inputs back into a seed. There is deliberately no registry, no
 * dispatcher and no "seed system": resolving `generator` to a builder is one
 * `switch` in your game, written where your game knows which libs it has.
 *
 * REMOVAL LINE: nothing in any render or bake path reads a seed. Delete this
 * file and each lib's `seed.ts` and every generator still builds from its
 * params exactly as before; you lose serialization, not generation.
 */

import { z } from 'zod';

export const AssetSeedSchema = z
  .object({
    generator: z
      .string()
      .min(1)
      .describe(
        'Which parametric asset lib builds this — the lib id, e.g. "humanoid" or "castle". ' +
          'Your game maps it to a builder; nothing here resolves it.',
      ),
    variant: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The generator’s own named starting point — a key of its character/preset index ' +
          '(the humanoid’s CHARACTERS, the castle’s presets). Omitted = that lib’s default.',
      ),
    params: z
      .record(z.string(), z.number())
      .optional()
      .describe(
        'Numeric tuning params, validated by the generator’s OWN params schema (the same ' +
          'declaration `describeNumericParams` reads its controls from). Merged OVER the ' +
          'variant’s own params — an explicit value always wins.',
      ),
    palette: z
      .record(z.string(), z.number())
      .optional()
      .describe(
        'Material-slot colour overrides: slot name → 0xRRGGBB, merged over the variant’s ' +
          'palette. Slot names are the generator’s own vocabulary; an unknown slot is inert ' +
          'here and is reported by the generator if it validates its spec.',
      ),
  })
  .strict();

/** One serializable "what to build" — see the module header. */
export type AssetSeed = z.infer<typeof AssetSeedSchema>;

/** Thrown by `parseAssetSeed`. */
export class AssetSeedError extends Error {
  constructor(message: string) {
    super(`asset seed: ${message}`);
    this.name = 'AssetSeedError';
  }
}

/**
 * Validate an untrusted seed (save file, network packet, URL fragment) and
 * return it typed. Loud and named on failure — a malformed seed must never
 * quietly become "the default character".
 */
export function parseAssetSeed(value: unknown): AssetSeed {
  const result = AssetSeedSchema.safeParse(value);
  if (!result.success) {
    throw new AssetSeedError(
      result.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    );
  }
  return result.data;
}

/**
 * Build a seed from a generator id plus optional parts, DROPPING empty ones —
 * so a seed is stable to compare and cheap to store: `{ generator: 'humanoid' }`
 * and `{ generator: 'humanoid', params: {}, palette: {} }` serialize the same.
 */
export function assetSeed(
  generator: string,
  parts: {
    variant?: string | undefined;
    params?: Readonly<Record<string, number>> | undefined;
    palette?: Readonly<Record<string, number>> | undefined;
  } = {},
): AssetSeed {
  const params =
    parts.params && Object.keys(parts.params).length > 0 ? { ...parts.params } : undefined;
  const palette =
    parts.palette && Object.keys(parts.palette).length > 0 ? { ...parts.palette } : undefined;
  return {
    generator,
    ...(parts.variant ? { variant: parts.variant } : {}),
    ...(params ? { params } : {}),
    ...(palette ? { palette } : {}),
  };
}
