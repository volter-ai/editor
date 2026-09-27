/**
 * Authorable body-type parameters for the procedural humanoid generator
 * (`generateHumanoid`). Same posture as the other engine Zod schemas: every
 * field carries `.describe()`, and the object is `.strict()` so a typo'd
 * param fails loudly at parse instead of silently generating the default
 * body.
 *
 * These params are a CODE-API schema (validated by `generateHumanoid` the
 * way `Behavior.schema` params are), not a fetched-file format — they
 * are deliberately NOT wired into `scripts/generate-schema.ts`, whose six
 * outputs are all on-disk file formats. If a scene-authorable humanoid
 * entity lands later, that wiring (plus a consumption-map entry) happens
 * then.
 *
 * All multipliers are relative to the reference rig (the vendored Mixamo
 * soldier's proportions, ~1.83 m). 1 = reference. The generator keeps feet
 * grounded and skin weights correct across the whole documented range.
 */

import { z } from 'zod';
import { describeNumericParams } from '../../lib/bake/params';

export const HumanoidParamsSchema = z
  .object({
    height: z
      .number()
      .min(0.3)
      .max(4)
      .optional()
      .describe(
        'Target standing height in metres, measured to the crown of the head. Omit to keep ' +
          'the natural height implied by the proportion multipliers (the reference rig is ' +
          '~1.83 m). All body dimensions scale uniformly to hit this, so proportions are ' +
          'controlled by the multipliers and overall size by this one number.',
      ),
    legLength: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe(
        'Thigh + shin length multiplier (1 = reference). The pelvis rest height follows ' +
          'automatically so the feet stay grounded — long legs raise the hips, short legs ' +
          'lower them.',
      ),
    armLength: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe('Upper-arm + forearm length multiplier (1 = reference).'),
    torsoLength: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe('Spine + neck length multiplier (1 = reference) — a longer or shorter trunk.'),
    shoulderWidth: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe(
        'Shoulder breadth multiplier (1 = reference): scales the lateral shoulder-root offsets ' +
          'and the clavicles.',
      ),
    hipWidth: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe(
        'Hip/pelvis breadth multiplier (1 = reference): scales the lateral upper-leg root ' +
          'offsets and the pelvis block width.',
      ),
    headSize: z
      .number()
      .min(0.5)
      .max(2)
      .default(1)
      .describe(
        'Head + neck size multiplier (1 = reference). Larger heads read younger/stylized — ' +
          'child-proportioned characters pair headSize ≈ 1.3–1.6 with a small height.',
      ),
    limbThickness: z
      .number()
      .min(0.4)
      .max(2.5)
      .default(1)
      .describe(
        'Arm and leg GIRTH multiplier (1 = reference) — slim (≈0.7) to heavyset (≈1.5). ' +
          'Scales the lofted limb tubes’ ring radii along their whole length. Feet keep ' +
          'their reference size so ground contact never sinks.',
      ),
    torsoGirth: z
      .number()
      .min(0.4)
      .max(2.5)
      .default(1)
      .describe(
        'Torso/pelvis bulk multiplier (1 = reference): scales the lofted trunk’s ring ' +
          'half-extents and the hip block’s depth — the main "build" control (slim vs ' +
          'heavy trunk).',
      ),
  })
  .strict();

/** Authorable input shape — every field optional. */
export type HumanoidParams = z.input<typeof HumanoidParamsSchema>;
/** Post-parse shape — defaults applied (only `height` stays optional). */
export type ResolvedHumanoidParams = z.output<typeof HumanoidParamsSchema>;

// ---------------------------------------------------------------------------
// Derived controls — the schema IS the knob list.
//
// The Builder's Generator controls are read off this declaration rather than
// hand-mirrored beside it; `describeNumericParams` (the shared reader in
// `src/lib/bake/params.ts`) is the whole mechanism, and the
// walking-castle lib binds its own controls to the same one. Add a knob here
// and it appears in the Builder with no UI edit; change a bound here and no
// slider can be left driving a value this schema would reject at parse.
// ---------------------------------------------------------------------------

/** The humanoid's own knobs — what the Builder's Generator controls bind to. */
export const HUMANOID_PARAM_DESCRIPTORS = describeNumericParams(HumanoidParamsSchema);
