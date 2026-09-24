import { z } from 'zod';

/**
 * E1 — Zod/TypeScript metadata attached to XState state `meta.animation`
 * (spec §11 E1, §5.6, §3.3).
 *
 * This module defines ONLY animation data: which clip(s) a state plays, how
 * they loop/blend/crossfade, and (for locomotion-style states) how a 1D/2D/
 * direct blend tree distributes weight across several clips from a live
 * parameter. It intentionally contains **no transition vocabulary** — no
 * `on`/`target`/`guard`/`always`/`after`/`entry`/`exit`. XState alone owns
 * states, transitions, events, and guards (§3.3); this metadata is read-only
 * data a binding (`xstate-animation-binding.ts`, E2) consumes to drive a
 * `THREE.AnimationMixer` when XState enters/exits a state. Every schema below
 * is `.strict()` specifically so that smuggling a transition-shaped key into
 * `meta.animation` is a loud Zod "unrecognized key" error, not a silently
 * ignored field (E1 AC: "Metadata contains no transition language").
 *
 * ## Native layered composition
 *
 * Parallel XState regions may drive independent named layers. Each layer can
 * filter a clip to selected bone subtrees, scale its weight, and use normal
 * override or Three's native additive blend mode. XState still owns all
 * state/transition semantics; these fields only describe how the active
 * state's native `AnimationAction`s are composed by the binding.
 *
 * ## Blend tree shape
 *
 * Deliberately structurally IDENTICAL to {@link BlendTreeDef} below (same
 * `type`/`parameter`/`parameterY`/`children[].clip`/`.threshold`/
 * `.thresholdY`/`.weight` fields) so the binding can hand a parsed
 * `AnimationBlendTree` straight to `evaluateBlendTree`
 * (`xstate-animation-binding.ts`) with zero conversion.
 */

/**
 * The blend-tree shape the binding's blend math reads. It lived in
 * `anim-graph-types.ts` while a second, removed AnimGraph runtime shared it;
 * that runtime is gone and the file was folded in here on 2026-09-20, so the
 * AnimGraph name no longer exists in the estate.
 *
 * The optional fields spell `| undefined` explicitly because the repo compiles
 * with `exactOptionalPropertyTypes`, and the one producer of these values is
 * the Zod schema below, whose `.optional()` infers `?: T | undefined`. Without
 * the explicit union the parsed value is not assignable here and the call site
 * needs a cast — which is exactly what used to hide field drift between the
 * two declarations (see `asBlendTreeDef`).
 */
export interface BlendTreeDef {
  type: '1D' | '2D' | 'direct';
  parameter: string;
  parameterY?: string | undefined; // for 2D
  children: BlendChild[];
}

export interface BlendChild {
  clip: string;
  threshold: number;
  thresholdY?: number | undefined; // for 2D
  weight?: number | undefined; // for direct
}

// ---------------------------------------------------------------------------
// Blend tree children
// ---------------------------------------------------------------------------

const AnimationBlendChildSchema = z
  .object({
    clip: z.string().min(1).describe('Animation clip name this child plays'),
    threshold: z.number().describe('1D/2D blend position on the primary parameter axis'),
    thresholdY: z
      .number()
      .optional()
      .describe('2D blend position on the secondary parameter axis (2D blend trees only)'),
    weight: z
      .number()
      .min(0)
      .optional()
      .describe('Explicit weight for "direct" blend trees (ignored by 1D/2D)'),
  })
  .strict();

export type AnimationBlendChild = z.infer<typeof AnimationBlendChildSchema>;

const AnimationBlendTree1DSchema = z
  .object({
    type: z.literal('1D').describe('Interpolates linearly between sorted children by threshold'),
    parameter: z.string().min(1).describe('Context/selector value driving the blend'),
    children: z
      .array(AnimationBlendChildSchema)
      .min(2, '1D blend tree needs at least 2 children to interpolate between'),
  })
  .strict();

const AnimationBlendTree2DSchema = z
  .object({
    type: z
      .literal('2D')
      .describe('Inverse-distance-weights children by (parameter, parameterY) position'),
    parameter: z.string().min(1).describe('Primary axis context/selector value'),
    parameterY: z.string().min(1).describe('Secondary axis context/selector value'),
    children: z
      .array(AnimationBlendChildSchema.extend({ thresholdY: z.number() }))
      .min(1, '2D blend tree needs at least 1 child'),
  })
  .strict();

const AnimationBlendTreeDirectSchema = z
  .object({
    type: z.literal('direct').describe('Each child has an explicit weight, normalized to sum to 1'),
    // `parameter` is unused by direct blending (evaluateBlendTree never reads
    // it for `type: 'direct'`) but kept required+defaulted so the parsed
    // value stays structurally assignable to `BlendTreeDef` above, which
    // declares `parameter: string` for every
    // blend mode — the same convention that type already uses.
    parameter: z.string().default(''),
    children: z
      .array(AnimationBlendChildSchema.extend({ weight: z.number().min(0) }))
      .min(1, 'direct blend tree needs at least 1 child'),
  })
  .strict();

export const AnimationBlendTreeSchema = z.discriminatedUnion('type', [
  AnimationBlendTree1DSchema,
  AnimationBlendTree2DSchema,
  AnimationBlendTreeDirectSchema,
]);

export type AnimationBlendTree = z.infer<typeof AnimationBlendTreeSchema>;

/**
 * The structural-identity claim in this file's header, made COMPILER-CHECKED.
 *
 * `evaluateBlendTree` takes {@link BlendTreeDef} above, and the
 * whole reason this schema mirrors that shape field-for-field is so a parsed
 * value can be handed over with zero conversion. The binding used to spell that
 * hand-over `as unknown as BlendTreeDef` — a double cast that would have gone on
 * compiling if either declaration drifted, silently feeding the blend math a
 * shape it does not describe. This identity function is the assignability
 * assertion instead: drift here is a type error at the seam that claims it.
 */
export function asBlendTreeDef(tree: AnimationBlendTree): BlendTreeDef {
  return tree;
}

// ---------------------------------------------------------------------------
// Crossfade / blend-in-out metadata (shared by clip and blend-tree states)
// ---------------------------------------------------------------------------

const AnimationCrossfadeMetaSchema = z
  .object({
    duration: z
      .number()
      .min(0)
      .default(0)
      .describe(
        'Seconds to blend from the previously active clip into this state on entry, applied via ' +
          'native `AnimationAction.crossFadeTo`/`fadeIn` (E2). 0 = instant activation, no fade.',
      ),
    warp: z
      .boolean()
      .default(false)
      .describe(
        "Passed through to AnimationAction.crossFadeTo's `warp` param — linearly warps timeScale " +
          'across the two clips during the blend so differing clip lengths line up. Default false.',
      ),
  })
  .strict()
  .describe('Blend-in/out/crossfade timing for entering this state');

export type AnimationCrossfadeMeta = z.infer<typeof AnimationCrossfadeMetaSchema>;

const AnimationBoneMaskSchema = z
  .object({
    include: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Bone/object names whose complete descendant subtrees are retained'),
    exclude: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Bone/object names whose complete descendant subtrees are removed'),
  })
  .strict()
  .refine((mask) => Boolean(mask.include?.length || mask.exclude?.length), {
    message: 'boneMask needs at least one include or exclude bone name',
  })
  .describe('Filters animation tracks by named Object3D/Bone subtrees');

export type AnimationBoneMask = z.infer<typeof AnimationBoneMaskSchema>;

const AnimationLayerFields = {
  layer: z
    .string()
    .min(1)
    .optional()
    .describe('Composition layer name; omitted means the single base layer'),
  weight: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Layer weight multiplier from 0 to 1; defaults to 1'),
  blendMode: z
    .enum(['override', 'additive'])
    .optional()
    .describe('Native Three normal/override or additive action blending; defaults to override'),
  boneMask: AnimationBoneMaskSchema.optional().describe(
    'Optional include/exclude filter applied to every clip track in this state',
  ),
};

// ---------------------------------------------------------------------------
// Per-state animation metadata: single clip OR blend tree, plus crossfade
// ---------------------------------------------------------------------------

const ClipAnimationMetaSchema = z
  .object({
    clip: z.string().min(1).describe('Single clip to play while this XState state is active'),
    loop: z
      .boolean()
      .default(true)
      .describe(
        'Loop the clip (THREE.LoopRepeat) vs play once (THREE.LoopOnce, clamped on last frame)',
      ),
    speed: z
      .number()
      .positive()
      .default(1)
      .describe('Playback speed multiplier (AnimationAction.timeScale)'),
    crossfade: AnimationCrossfadeMetaSchema.optional(),
    ...AnimationLayerFields,
  })
  .strict();

export type ClipAnimationMeta = z.infer<typeof ClipAnimationMetaSchema>;

const BlendTreeAnimationMetaSchema = z
  .object({
    blendTree: AnimationBlendTreeSchema.describe(
      'Multiple clips blended by a live context/selector-driven parameter',
    ),
    crossfade: AnimationCrossfadeMetaSchema.optional(),
    ...AnimationLayerFields,
  })
  .strict();

export type BlendTreeAnimationMeta = z.infer<typeof BlendTreeAnimationMetaSchema>;

/**
 * The full shape of `state.meta.animation` for one XState state (spec §5.6):
 * exactly one of a single clip or a blend tree, plus optional crossfade
 * timing. `.strict()` on both branches is what makes authoring a transition
 * keyword (`on`, `target`, `guard`, …) inside `meta.animation` a validation
 * error instead of a silently-accepted second transition dialect.
 */
export const StateAnimationMetaSchema = z.union([
  ClipAnimationMetaSchema,
  BlendTreeAnimationMetaSchema,
]);

export type StateAnimationMeta = z.infer<typeof StateAnimationMetaSchema>;

/** True iff a validated meta declares a single clip rather than a blend tree. */
export function isClipAnimationMeta(meta: StateAnimationMeta): meta is ClipAnimationMeta {
  return 'clip' in meta;
}

/** True iff a validated meta declares a blend tree rather than a single clip. */
export function isBlendTreeAnimationMeta(meta: StateAnimationMeta): meta is BlendTreeAnimationMeta {
  return 'blendTree' in meta;
}

// ---------------------------------------------------------------------------
// Validation entry point
// ---------------------------------------------------------------------------

/** Thrown by `parseStateAnimationMeta` — always names the offending state id. */
export class AnimationMetaValidationError extends Error {
  constructor(
    message: string,
    readonly stateId: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'AnimationMetaValidationError';
  }
}

/**
 * Validate one state's `meta.animation` value. Called by the E2 binding for
 * every state a machine declares (both at bind time, up front, and — for
 * belt-and-suspenders — again whenever a state is entered).
 *
 * @throws {AnimationMetaValidationError} naming the state id and every Zod
 *   issue (path + message) — e.g. an unrecognized `on`/`target` key, a
 *   missing `clip`, or a 1D blend tree with only one child.
 */
export function parseStateAnimationMeta(stateId: string, raw: unknown): StateAnimationMeta {
  const result = StateAnimationMetaSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    throw new AnimationMetaValidationError(
      `[xstate-animation] invalid meta.animation for state "${stateId}": ${detail}`,
      stateId,
      result.error.issues,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Machine-wide collection (used by E2 to validate + resolve clips up front)
// ---------------------------------------------------------------------------

/** The minimal shape of an XState `StateNode` this module needs to walk. */
export interface AnimationMetaStateNodeLike {
  id: string;
  meta?: { animation?: unknown } & Record<string, unknown>;
  states?: Record<string, AnimationMetaStateNodeLike>;
}

export interface MachineAnimationMetaEntry {
  stateId: string;
  meta: StateAnimationMeta;
}

/**
 * Walk every state node in a machine (from its root `StateNode`, e.g.
 * `actor.logic.root`) and validate every `meta.animation` value found.
 * States with no `meta.animation` are skipped (not every XState state needs
 * to drive animation). Returns one entry per animated state, in document
 * order.
 *
 * @throws {AnimationMetaValidationError} on the FIRST invalid meta found —
 *   naming the specific state id, so an agent authoring a machine gets an
 *   actionable pointer straight to the bad state instead of a generic error.
 */
export function collectMachineAnimationMeta(
  root: AnimationMetaStateNodeLike,
): MachineAnimationMetaEntry[] {
  const out: MachineAnimationMetaEntry[] = [];
  const visit = (node: AnimationMetaStateNodeLike): void => {
    if (node.meta && 'animation' in node.meta && node.meta.animation !== undefined) {
      out.push({ stateId: node.id, meta: parseStateAnimationMeta(node.id, node.meta.animation) });
    }
    for (const child of Object.values(node.states ?? {})) visit(child);
  };
  visit(root);
  return out;
}

/** Every clip name referenced anywhere in a validated meta (1 for clip states, N for blend trees). */
export function clipNamesOf(meta: StateAnimationMeta): string[] {
  return isClipAnimationMeta(meta) ? [meta.clip] : meta.blendTree.children.map((c) => c.clip);
}
