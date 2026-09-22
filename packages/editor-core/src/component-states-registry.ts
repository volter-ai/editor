/**
 * A COMPONENT'S NAMED STATES ARE SOURCED, NOT CONSTRUCTED — the seventh
 * registry in the family, and the direct sibling of the member unit 11 minted
 * next door: `content-entry-source-registry.ts:166-176`'s
 * `contentEntryForComponent(ref)` answers "what does this component LOOK
 * like?" by registration; this answers "what named STATES does it have, and
 * what does applying one do?".
 *
 * WHY IT EXISTS. `StoriesProvider` (`@volter/editor-project/adapter` authoring.ts:706) is the
 * ENGINE's contract and does not change — an adapter says which named states a
 * node has, in its own vocabulary. What changed is who FILLS it. Three
 * keep-bucket host adapters CONSTRUCTED the CSF implementation inside their own
 * constructors:
 *
 *   authoring/r3f-source-authoring-adapter.ts:637   unconditional
 *   authoring/three-authoring-adapter.ts:506        gated on `sourceDeclaresStories`
 *   authoring/pixi-authoring-adapter.ts:773         gated on the target's identity
 *
 * and no registry reaches into a constructor, so no existing point carried it
 * — which is why `authoring/project-three-stories.ts` (and through it
 * `stories/story-registry.ts`, and through THAT `storybook/internal/preview-api`)
 * could not leave the host however many boards moved (WORK.md §The open-source
 * launch item 18b).
 *
 * WHAT THE MEASUREMENT SAID THE THREE CONSTRUCTIONS DIFFER BY, and therefore
 * what a source must be handed rather than hold:
 *
 *  - THE COMPONENT-IDENTITY CLOSURE. All three produce the same SHAPE
 *    ({@link ComponentStatesRef}) by three different routes: the R3F source
 *    adapter resolves a definition/callsite and can name the defining FILE;
 *    the three adapter reads its hierarchy node's `typeLabel` and has no file;
 *    the pixi adapter delegates to its write target's `componentIdentity`.
 *    That closure stays with the adapter — it is the adapter's own semantic
 *    knowledge of what a node IS — and travels per call.
 *  - THE SURFACE. The three-flavoured construction applied a state by opening
 *    the Object3D turntable; the canvas one opened the ordinary isolated story
 *    document. That was the ONLY difference between the two factory functions.
 *    A source is handed the asking adapter's surface and dispatches on it, the
 *    way the story opener's own readiness does.
 *
 * WHAT THE HOST KEEPS, and why it is not a leak: the per-node ACTIVE map and
 * the change notification — identical in all three constructions, about the
 * editor session rather than about states — and the refusal when an `apply`
 * names a state that does not belong to the node. {@link componentStatesProvider}
 * is that bookkeeping and nothing else.
 *
 * NOTHING REGISTERED IS A REAL ANSWER, and here it is a SPOKEN one: the
 * provider's `unavailable()` says that no package registered a source, which
 * is precisely the distinction that member exists to draw ("an empty
 * `storiesFor` and an UNREAD one look identical from the section that draws
 * them, and only the provider knows which").
 *
 * DELIBERATELY ABSENT: `isolate` and `title`. `StoriesProvider` publishes
 * both, no CSF construction ever supplied either (`resolveComposeStoriesInput`
 * passes `isolation: null` unconditionally), and a member on a registry gets
 * built whether or not anything wants it. They belong here the day a source
 * has one.
 */

import type { AdapterSurface, StoriesProvider, StoryRef } from '@volter/editor-project/adapter';
import { editorConsole } from './editor-console';
import type { EditorShellStore } from './editor-shell-store';

/**
 * A component as a STATES source sees it — the exact shape all three adapter
 * closures already produced. `sourcePath` is absent for an adapter that knows
 * the component's NAME but not the module it is defined in.
 */
export interface ComponentStatesRef {
  readonly name: string;
  readonly sourcePath?: string;
}

/** What a source is asked the question IN. */
export interface ComponentStatesContext {
  /** The authoring surface the asking adapter mounts on. A source that means
   *  different things on different surfaces (opening a state in the Object3D
   *  turntable versus the isolated story document) dispatches on it; the host
   *  never reads it. */
  readonly surface: AdapterSurface;
  /** The ONE format-neutral shell store, for a state whose application opens a
   *  document or moves the session. */
  readonly store: EditorShellStore;
}

export interface ComponentStatesSource {
  /** The source's id, in its own vocabulary. */
  readonly id: string;
  /** Which module registered it. Re-registering the same owner+id REPLACES,
   *  so an HMR re-evaluation leaves one source, not two. */
  readonly owner: string;
  /** Ascending; ties keep registration order. */
  readonly order?: number;
  /** This component's named states, or `[]` — "none of mine", which lets the
   *  next source answer. */
  readonly statesFor: (
    component: ComponentStatesRef,
    context: ComponentStatesContext,
  ) => readonly StoryRef[];
  /** Apply one of the states this source just named. Whether that opens a
   *  document, swaps a world or writes source is the source's business. */
  readonly apply: (
    component: ComponentStatesRef,
    stateId: string,
    context: ComponentStatesContext,
  ) => void;
}

const _sources: ComponentStatesSource[] = [];

/** Install a source. Returns the teardown. */
export function registerComponentStatesSource(source: ComponentStatesSource): () => void {
  const stale = _sources.findIndex((item) => item.owner === source.owner && item.id === source.id);
  if (stale >= 0) _sources.splice(stale, 1);
  _sources.push(source);
  _sources.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return () => {
    const at = _sources.indexOf(source);
    if (at >= 0) _sources.splice(at, 1);
  };
}

const EMPTY: readonly ComponentStatesSource[] = [];

/** Everything registered, in order. */
export function componentStatesSources(): readonly ComponentStatesSource[] {
  return _sources.length === 0 ? EMPTY : _sources;
}

/**
 * THE ADAPTER'S `stories` MEMBER, bound over the registry — a thin binding an
 * adapter constructs instead of constructing an implementation.
 *
 * `componentForNode` is the adapter's own semantic knowledge of what a node
 * IS; everything past it is a registered source's. The FIRST source that names
 * a state for a component owns that component, the way
 * `contentEntryForComponent` takes the first source that admits one.
 */
export function componentStatesProvider(
  surface: AdapterSurface,
  store: EditorShellStore,
  componentForNode: (nodeId: string) => ComponentStatesRef | null,
): StoriesProvider {
  const activeByNode = new Map<string, string>();
  const context: ComponentStatesContext = { surface, store };

  /** The source that answers for this node, and what it answered. */
  const resolve = (
    nodeId: string,
  ): { source: ComponentStatesSource; states: readonly StoryRef[] } | null => {
    const component = componentForNode(nodeId);
    if (!component) return null;
    for (const source of _sources) {
      const states = source.statesFor(component, context);
      if (states.length > 0) return { source, states };
    }
    return null;
  };

  return {
    storiesFor: (nodeId) => [...(resolve(nodeId)?.states ?? [])],
    active: (nodeId) => activeByNode.get(nodeId) ?? null,
    apply: (nodeId, stateId) => {
      if (stateId === null) {
        activeByNode.delete(nodeId);
        store.notifyIngestEdit();
        return;
      }
      const answer = resolve(nodeId);
      if (!answer?.states.some((state) => state.id === stateId)) {
        editorConsole.warn(
          `[component-states] stories.apply: state "${stateId}" does not belong to node ` +
            `"${nodeId}" on the ${surface} surface — ignoring.`,
          'authoring',
        );
        return;
      }
      const component = componentForNode(nodeId);
      if (!component) return;
      activeByNode.set(nodeId, stateId);
      answer.source.apply(component, stateId, context);
      store.notifyIngestEdit();
    },
    // The distinction this member exists to draw: an empty list because this
    // component has no states, and an empty list because nothing in this
    // editor can read them, are different answers.
    unavailable: () =>
      _sources.length > 0
        ? null
        : 'No package in this editor registered a source of component states, so this ' +
          "component's named states could not be read. A build ships the packages its own " +
          'entry in `builds/` lists.',
  };
}

/** Test-only reset (mirrors the restore, open, chrome-slot, content-source,
 *  design-time-mount and component-board registries'). */
export function __resetComponentStatesSourcesForTest(): void {
  _sources.length = 0;
}
