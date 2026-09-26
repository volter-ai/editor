/**
 * The two decisions the Prefab Instance inspector section makes before it
 * renders anything: does this selection HAVE a prefab-instance description, and
 * does it have a story of its own to open.
 *
 * They live here rather than inside the section because the section is a React
 * component in a repo whose unit tests run headless (`environment: 'node'`) —
 * the same reason `components/inspector-stories-gating.ts` exists. Both are
 * pure functions of (adapter, node).
 */

import type { AuthoringAdapter, EditorNode, StoryRef } from '@volter/editor-project/adapter';
import { resolveNodeScopedStories } from '@volter/editor-sdk/kit/components/inspector-stories-gating';

/**
 * Whether `node` is a component instance this adapter can describe.
 *
 * Both halves are load-bearing. `adapter.instances` is OPTIONAL, so an adapter
 * that has no instances provider at all must not match — the section would then
 * register for every selection in that world and render nothing, an empty
 * registered section. (`undefined !== null` is `true`: the absent provider
 * cannot be tested by comparing its answer.)
 */
export function matchesPrefabInstance(node: EditorNode | null, adapter: AuthoringAdapter): boolean {
  const instances = adapter.instances;
  if (!node || !instances) return false;
  return instances.describe(node.id) !== null;
}

/** The section's "Open Story" affordance, bound to the node's own first story. */
export interface PrefabInstanceStoryAction {
  readonly story: StoryRef;
  /** Put the node's component into that story (opens its story document). */
  readonly open: () => void;
}

/**
 * The story this prefab instance can open, or `null` when it has none.
 *
 * Routed through {@link resolveNodeScopedStories} rather than `adapter.stories`
 * because a world-level provider answers the same rows for EVERY node: on an
 * ingest root those rows are the game's own scenes, and applying one navigates
 * the whole game from inside a per-node section. When only a world-level
 * provider exists this section offers no story action at all — the honest
 * absence, since the node genuinely has no composed story.
 */
export function prefabInstanceStoryAction(
  adapter: AuthoringAdapter,
  nodeId: string,
): PrefabInstanceStoryAction | null {
  const provider = resolveNodeScopedStories(adapter, nodeId);
  const story = provider?.storiesFor(nodeId)[0];
  if (!provider || !story) return null;
  return { story, open: () => provider.apply(nodeId, story.id) };
}
