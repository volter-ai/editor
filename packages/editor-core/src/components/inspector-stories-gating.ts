/**
 * Whether the composed subject gets a STORIES section, and with what.
 *
 * This is an adapter-TOPOLOGY question — which child adapter owns this row —
 * answered through the composite's public T0 queries, never by decoding an
 * adapter-minted id. That is why it stays out of `inspection/compose.ts`: the
 * composer takes the answer (`ComposeStoriesInput`) and composes it; working
 * the answer out means knowing the shape of the live adapter tree.
 *
 * It lives in its own module because BOTH projections of the subject need the
 * same answer: `components/Inspector.tsx` (the column and the card) and
 * `inspection/active-subject.ts` (the serialized one, W4). Two copies of this
 * gating would be two different Stories sections.
 */

import type { AuthoringAdapter, EditorNode, StoriesProvider } from '@volter/editor-project/adapter';
import { CompositeAuthoringAdapter } from '../authoring/composite-authoring-adapter';
import { governingAdapterForNode } from '../authoring/provenance';
import { WORLD_SCOPE_NODE_ID } from '@volter/editor-sdk/kit/stories-scope';
import { recordAuthoringConsumerUse } from '../coverage/authoring-seam-evidence';
import type { ComposeStoriesInput } from '../inspection/compose';

/**
 * D4 (B2) — the CHILD adapter owning `nodeId`'s synthetic world-group row
 * (`world:<id>`, `CompositeAuthoringAdapter`'s own manufactured node), or
 * `null` when `adapter` isn't a composite or `nodeId` isn't one of its group
 * nodes. Mirrors `GameHierarchy.tsx`'s (unexported) `compositeGroupBadge` —
 * same "ask the public T0 query (`childAdapters()`/`groupNodeId()`), never
 * decode the reserved id yourself" discipline.
 *
 * Used ONLY to gate the Stories section: a world-group row whose owning child
 * adapter itself advertises `stories` (a live react world) gets the section
 * (dropdown or "no stories" disclosure); any other row (an ordinary entity,
 * or a world-group row for a kind that never sets `stories` — three/pixi/an
 * un-upgraded Boundary placeholder) gets none.
 */
export function worldGroupChildAdapter(
  adapter: AuthoringAdapter,
  nodeId: string,
): AuthoringAdapter | null {
  if (!(adapter instanceof CompositeAuthoringAdapter)) return null;
  for (const child of adapter.childAdapters()) {
    if (adapter.groupNodeId(child.worldId) === nodeId) return child.adapter;
  }
  return null;
}

/**
 * The composer's Stories input for this selection, or `null` when the
 * selection has no stories concept at all.
 *
 * WITHIN a gated section the dropdown is fed by `storiesFor(id)` — NEVER by
 * `adapter.stories` truthiness alone, since the composite's OWN `stories`
 * pass-through is always present regardless of what (if anything) the routed
 * child actually offers.
 *
 * Any node whose governing adapter publishes `stories` gets the section. This
 * includes React world/component rows and source-backed Three component nodes;
 * the shell does not infer a renderer from the node kind.
 */
/**
 * The WORLD-LEVEL stories input with NOTHING selected, or `null` when the
 * active adapter has no world-level stories to offer.
 *
 * A world-level provider (`storiesFor`/`active` ignore the node id — the react
 * adapter's B2 scope, and every contract-scenes projection) answers for the
 * whole world, so it is presentable on a world-scoped subject like the ingest
 * coverage card. Gated on `storiesFor(WORLD_SCOPE_NODE_ID)` returning rows — never on
 * `adapter.stories` truthiness (a composite's pass-through is always present)
 * — so a per-node provider, which answers nothing for the empty id, shows
 * nothing here.
 */
export function resolveWorldStoriesInput(adapter: AuthoringAdapter): ComposeStoriesInput | null {
  const provider = adapter.stories;
  if (!provider) return null;
  const stories = provider.storiesFor(WORLD_SCOPE_NODE_ID);
  if (stories.length === 0) return null;
  return {
    stories,
    activeStoryId: provider.active(WORLD_SCOPE_NODE_ID) ?? '',
    onApplyStory: (storyId) =>
      recordAuthoringConsumerUse({
        adapter,
        seam: 'editor.stories.apply',
        stage: 'effect',
        detail: `the Inspector applied world story ${storyId}`,
        run: () => provider.apply(WORLD_SCOPE_NODE_ID, storyId),
      }),
    isolation: null,
    ...(provider.title === undefined ? {} : { title: provider.title }),
  };
}

/**
 * The stories provider scoped to `nodeId` ITSELF, or `null` when the adapter
 * governing that node publishes a WORLD-LEVEL provider (or none at all).
 *
 * The exact complement of {@link resolveWorldStoriesInput}, on the same
 * {@link WORLD_SCOPE_NODE_ID} probe: a component-scoped provider (the binding
 * `component-states-registry.ts` hands an adapter) has no component for the
 * empty id and answers `[]`; contract scenes and the react adapter's B2 provider answer
 * their whole list.
 *
 * The GOVERNING adapter is probed, never the active one: a composite's
 * `stories` pass-through routes by node ownership, so it answers `[]` for the
 * empty id whatever the owning child's scope is — probing the pass-through
 * would read every ingested game's scenes as node-scoped.
 *
 * A node-scoped affordance must route through here rather than reading
 * `adapter.stories` directly. On an ingest root that provider IS the game's own
 * scenes, so `apply` navigates the WHOLE GAME — a per-node button wired to it
 * is not the node's story, it is a screen change wearing the node's label.
 */
export function resolveNodeScopedStories(
  adapter: AuthoringAdapter,
  nodeId: string,
): StoriesProvider | null {
  const provider = governingAdapterForNode(adapter, nodeId)?.stories;
  if (!provider) return null;
  return provider.storiesFor(WORLD_SCOPE_NODE_ID).length > 0 ? null : provider;
}

export function resolveComposeStoriesInput(
  adapter: AuthoringAdapter,
  node: EditorNode | null,
  nodeId: string | null,
): ComposeStoriesInput | null {
  if (!nodeId) return null;
  const isCatalogNode = node?.kind === 'component';
  const storiesOwner = governingAdapterForNode(adapter, nodeId);
  if (!storiesOwner?.stories) return null;
  const isWorldGroup = worldGroupChildAdapter(adapter, nodeId) !== null;
  // A world-level provider (ingest screens, a react world's CSF states)
  // answers for the whole world. Putting it on an ordinary node makes
  // `apply` navigate the game / swap the world while wearing the node's
  // label. World-group and catalog rows are the only subjects that own
  // that scope.
  if (
    !isWorldGroup &&
    !isCatalogNode &&
    storiesOwner.stories.storiesFor(WORLD_SCOPE_NODE_ID).length > 0
  ) {
    return null;
  }
  const stories = adapter.stories?.storiesFor(nodeId) ?? [];
  // `StoriesProvider.storiesFor` owns per-node applicability. Preserve the
  // established world/catalog disclosure even when empty, but do not put an
  // empty Stories section on every native child merely because its adapter
  // can answer for component nodes elsewhere in the same world.
  if (stories.length === 0 && !isWorldGroup && !isCatalogNode) return null;
  return {
    stories,
    activeStoryId: adapter.stories?.active(nodeId) ?? '',
    onApplyStory: (storyId) => {
      const provider = adapter.stories;
      if (!provider) return;
      recordAuthoringConsumerUse({
        adapter: storiesOwner,
        seam: 'editor.stories.apply',
        stage: 'effect',
        detail: `the Inspector applied story ${storyId} to ${nodeId}`,
        run: () => provider.apply(nodeId, storyId),
      });
    },
    isolation: null,
    // Asked of the OWNING adapter, not the composite: the composite routes by
    // node and has no node-free answer, and the reason belongs to whichever
    // provider would have produced the list.
    unavailableReason: storiesOwner.stories.unavailable?.() ?? null,
  };
}
