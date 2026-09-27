import { z } from 'zod';

/**
 * The render-feature registry — single source of truth for every togglable render
 * setting. The render-env schema (`asset-formats/render-env.ts`) and the cascade
 * resolver (`resolveRenderSettings`) are both derived from this list, so
 * "everything togglable" stays consistent by construction (same posture as the
 * component/material/instancer registries).
 *
 * EVERY ENTRY HERE MUST HAVE A RUNTIME READER of its resolved value, and that is
 * now enforced: `schema-reader-coverage.test.ts` derives its walk from this
 * array, so adding a feature adds a described schema path that fails coverage
 * until `schema-consumption-map.ts` names the file that reads it.
 *
 * Three entries were deleted when that enforcement first ran, having reached it
 * with no reader at all: `autoBatch`, `lod`, and `backend` (which offered a `webgpu` option while
 * `setup-renderer.ts` unconditionally constructs a `THREE.WebGLRenderer`). A
 * toggle that changes nothing is worse than a missing one — it tells an author
 * the engine has a dial it does not have.
 */

export type RenderFeatureValue = boolean | number | string;

export interface RenderFeature {
  /** Stable key used in schema, cascade, and UI. */
  key: string;
  /** Editor display label. */
  label: string;
  /** Schema `.describe()` text (powers JSON Schema / inspector docs). */
  description: string;
  /** Control shape. */
  kind: 'toggle' | 'number' | 'enum';
  /** Engine default — the "fast by default" baseline. */
  default: RenderFeatureValue;
  /**
   * `live` re-applies on change; `reload` needs a renderer re-init (e.g. backend,
   * antialias). The editor badges `reload` features and re-inits the viewport.
   */
  apply: 'live' | 'reload';
  /** Whether this feature may be overridden per-entity (the entity cascade layer). */
  perEntity: boolean;
  /** Allowed values for `enum` kind. */
  options?: readonly string[];
  /** [min, max] for `number` kind. */
  range?: readonly [number, number];
}

export const RENDER_FEATURES: readonly RenderFeature[] = [
  {
    key: 'frustumCulling',
    label: 'Frustum culling',
    description: 'Per-instance frustum culling for batched content.',
    kind: 'toggle',
    default: true,
    apply: 'live',
    perEntity: true,
  },
  {
    key: 'shadows',
    label: 'Shadows',
    description: 'Enable the shadow map. Per-entity cast/receive still applies.',
    kind: 'toggle',
    default: true,
    apply: 'live',
    perEntity: true,
  },
  {
    key: 'postProcessing',
    label: 'Post-processing',
    description:
      'Master switch for the post-processing stack (individual effects nest beneath it).',
    kind: 'toggle',
    default: true,
    apply: 'live',
    perEntity: false,
  },
  {
    key: 'resolutionScale',
    label: 'Resolution scale',
    description: 'Device-pixel-ratio multiplier (1.0 = native). The cheapest perf dial.',
    kind: 'number',
    default: 1,
    apply: 'live',
    perEntity: false,
    range: [0.25, 2],
  },
  {
    key: 'antialias',
    label: 'Antialiasing',
    description: 'MSAA via renderer construction. Applies on reload (renderer re-init).',
    kind: 'toggle',
    default: true,
    apply: 'reload',
    perEntity: false,
  },
];

/** Map for O(1) lookup by key. */
export const RENDER_FEATURE_BY_KEY: ReadonlyMap<string, RenderFeature> = new Map(
  RENDER_FEATURES.map((f) => [f.key, f]),
);

/**
 * Build a Zod object for the render settings, derived from the registry so the
 * schema can never drift from the feature list. All fields optional — absence
 * means "inherit" in the cascade. `perEntityOnly` builds the per-entity override
 * schema (only features whose `perEntity` is true).
 */
export function buildRenderingZod(opts: { perEntityOnly?: boolean } = {}): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of RENDER_FEATURES) {
    if (opts.perEntityOnly && !f.perEntity) continue;
    let base: z.ZodTypeAny;
    if (f.kind === 'toggle') base = z.boolean();
    else if (f.kind === 'number') base = z.number();
    else base = z.enum(f.options as [string, ...string[]]);
    shape[f.key] = base.optional().describe(f.description);
  }
  return z
    .object(shape)
    .describe(
      opts.perEntityOnly
        ? 'Per-entity render overrides (omit a field to inherit from the scene/engine default)'
        : 'Scene render settings (omit a field to inherit the engine default)',
    );
}
