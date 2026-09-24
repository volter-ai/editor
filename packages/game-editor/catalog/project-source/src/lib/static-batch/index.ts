/**
 * STATIC BATCHING, in one wrapper.
 *
 * A TSX world draws one mesh per JSX element. Past a few hundred elements the
 * frame stops being about pixels and starts being about SUBMISSION: ~2.75 µs
 * of CPU per draw call, so a four-thousand-mesh scene burns ~11 ms telling the
 * GPU what to draw before it draws anything. `<Frozen>` collapses a
 * mount-static subtree into a handful of draws, with no change to how the
 * scenery is authored:
 *
 * ```tsx
 * import { Frozen } from './lib/static-batch';
 *
 * <Frozen name="Terminal">{panels}</Frozen>
 * ```
 *
 * Read `Frozen.tsx` for the contract (children must be mount-static) and
 * `freeze.ts` for what gets collapsed, what is refused, and why the grouping
 * key is structural rather than `material.uuid` — that last one is the trap
 * this capability exists to keep a game out of.
 *
 * Nothing here runs at import: the wrapper does its work when it mounts.
 */

export { Frozen, type FrozenProps } from './Frozen';
export {
  activateFrozenBatch,
  activeFrozenBatches,
  describeFrozenSkips,
  FROZEN_PRODUCT_KEY,
  type FrozenBatch,
  type FrozenSource,
  freezeSubtree,
  restoreFrozen,
} from './freeze';
export {
  type FrozenMutationWatch,
  MUTATION_SAMPLE_MS,
  watchFrozenMutations,
} from './mutation-watch';
export {
  createFrozenDirectionalShadowController,
  type FrozenDirectionalShadowController,
} from './shadow-cache';
