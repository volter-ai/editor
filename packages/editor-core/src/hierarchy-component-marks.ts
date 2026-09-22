/**
 * The panel's half of the hierarchy-presentation convention
 * (`@volter/editor-threejs/adapter/hierarchy-marks`): a game classifies its
 * component-instance roots and its implementation subtrees on the LIVE nodes,
 * and this turns that classification into rows.
 *
 * CLASSIFICATION ONLY — NEVER FABRICATED STRUCTURE. Nothing here invents a
 * parent. Where a node belongs is the TREE's answer, and a world whose tree
 * disagrees with its own ownership is fixed in the world (three's
 * `matrixWorldAutoUpdate = false` keeps a transform-independent object parented
 * where it belongs), not papered over here. What this module decides is
 * narrower and entirely presentational: which rows are the game and which are
 * the implementation underneath it, and — since an implementation node may sit
 * BETWEEN two things that are the game — where a row's nearest visible ancestor
 * is. See {@link componentMarkView} point 5, promotion.
 *
 * WHY THIS IS A DECORATOR AND NOT A SECOND ROW PIPELINE. Exactly the reason
 * `hierarchy-internals.ts` gives for reveal: the panel's cap, collapse, search,
 * selection-reveal and virtualization all layer on ONE flatten of ONE
 * `HierarchyProvider`. A marked tree composes by handing that flattener a
 * richer provider — never by forking the walk. And it composes with reveal
 * specifically by producing an {@link InternalsSource}: built-internals become
 * internals of exactly the kind "Reveal Internals" already shows, so the
 * read-only rule, the search exclusion and the drag refusal that already govern
 * a revealed row govern these with no second policy.
 *
 * THE NO-MARKS FALLBACK IS IDENTITY, BY CONSTRUCTION. Every projection below
 * short-circuits when a node carries no mark and no child carries one, and
 * {@link componentMarkView} returns the source's own `hierarchy` object when the
 * tree cannot carry marks at all (an adapter with no `Object3D` seam — React,
 * Pixi, DOM). A world that adopts nothing renders exactly as it did.
 *
 * PURE ON PURPOSE: the marks arrive through the injected {@link NodeMarkReader},
 * never by importing three or touching `userData` here, so the whole row
 * decision is unit-testable with plain objects.
 */

import type { EditorNode, HierarchyProvider } from '@volter/editor-project/adapter';
import type { InternalsSource } from './hierarchy-internals';
import type { HierarchyNodeRow } from './hierarchy-node-rows';

/** What the marks say about ONE node. Both absent is the ordinary node. */
export interface NodeMarks {
  /** `vgaiComponentRoot` — the component name this node is one instance of. */
  readonly componentRoot?: string | undefined;
  /** A native authoring entity constructor. It stays an ordinary entity row, but like a
   *  component root it is authored content even when a host implementation node wraps it. */
  readonly authoredEntity?: boolean | undefined;
  /** `vgaiBuiltInternal` — this node is the root of an implementation subtree. */
  readonly builtInternal?: boolean | undefined;
}

/** Reads the marks off one node id. `undefined` for an id the source has no
 *  live object for — indistinguishable from an unmarked node, deliberately. */
export type NodeMarkReader = (id: string) => NodeMarks | undefined;

/** The hierarchy half of an adapter, plus whatever internals capability it
 *  already had. Structurally satisfied by `AuthoringAdapter` /
 *  `CompositeAuthoringAdapter` without importing either — the same contract-only
 *  probe shape `hierarchy-internals.ts` and `hierarchy-row-model.ts` use. */
export interface MarkedTreeSource {
  readonly hierarchy: Pick<HierarchyProvider, 'roots' | 'node'>;
  readonly hasInternals?: ((id: string) => boolean) | undefined;
  readonly internalChildren?: ((id: string) => EditorNode[] | undefined) | undefined;
}

export interface MarkedTreeView extends InternalsSource {
  /** True for a node whose live object carries `vgaiComponentRoot`. */
  isComponentRoot(id: string): boolean;
  /** True for a node that is, or descends from, a `vgaiBuiltInternal` root.
   *  Exposed for tests and for {@link componentMarkView}'s own reuse; the panel
   *  reads internal-ness off the reveal projection, which is the union of these
   *  and the adapter's own hidden children. */
  isBuiltInternal(id: string): boolean;
}

/** Depth backstop for a pathological live tree — the same belt-and-braces
 *  constant `hierarchy-internals.ts`/`hierarchy-node-rows.ts` keep. */
const MAX_DEPTH = 500;

/** The reader for a surface that has no node to read marks off. Identity-checked
 *  by {@link componentMarkView}, which is why it is a shared constant rather
 *  than a fresh closure per call. */
export const NO_MARKS: NodeMarkReader = () => undefined;

/**
 * Decorate `source` so the marks become rows.
 *
 * Five things change, and nothing else:
 *
 * 1. A marked component root reports `role: 'component'` and
 *    `typeLabel: <mark name>`. That is all the panel needs — `rowIdentity`
 *    already prints `Coin1 ·Coin` for exactly this pair, and `ROLE_ICON`
 *    already has the component glyph. NO new presentation vocabulary: a second
 *    way to render "this is an instance" is how two of them drift.
 *    The mark REPLACES any `typeLabel` the adapter had, because a three
 *    projection reports the native class there (`Object3D`), and
 *    `Coin1 ·Object3D` is worse than no suffix at all.
 * 2. Built-internal children disappear from every `childIds`, so what a
 *    collapsed tree shows is the game and not its implementation.
 * 3. A built-internal ROOT disappears from `roots()` for the same reason, but
 *    meaningful content beneath it is promoted to roots in place. A root has
 *    no parent row to reveal it under, so the implementation wrapper itself
 *    stays unreachable while spawned content remains visible.
 * 4. Both come back through `internalChildren`/`hasInternals` — unioned with
 *    whatever the adapter already hid — so "Reveal Internals" shows them,
 *    read-only, under their real parent, in the true chain.
 * 5. PROMOTION. A component instance does not lose its row because
 *    implementation nodes sit between it and its owner. A weapon prefab
 *    attached to a hand bone, a nameplate on a head bone: content the author
 *    placed, inside a subtree a rig builder marked. `vgaiComponentRoot` beats
 *    `vgaiBuiltInternal` (see `isBuiltInternal`'s climb), and this lists such a
 *    row under its nearest VISIBLE ancestor — so a prefab reads as the parent
 *    of everything meaningful beneath it, however many bones the rig hangs in
 *    between. A subtree with no instance inside it still folds away whole,
 *    because there is nothing in it to promote. This is the elision half of the
 *    same classification: (2) removes an implementation row, (5) keeps what was
 *    under it from going with it.
 *
 * Built-internal is SUBTREE-scoped (see the engine module's header): a node
 * whose ANCESTOR is marked is internal too, which is what lets a rig cost one
 * mark. {@link MarkedTreeView.isBuiltInternal} memoizes that climb, so a
 * repeated walk over the same tree pays once per node.
 */
export function componentMarkView(
  source: MarkedTreeSource,
  marksOf: NodeMarkReader,
): MarkedTreeView {
  if (marksOf === NO_MARKS) {
    // A surface with no `Object3D` seam (React, Pixi, DOM) cannot carry these
    // marks at all. Hand back the source itself so the panel's provider is
    // IDENTICAL, not merely equivalent.
    return {
      hierarchy: source.hierarchy,
      isComponentRoot: () => false,
      isBuiltInternal: () => false,
      ...(source.hasInternals ? { hasInternals: (id: string) => source.hasInternals!(id) } : {}),
      ...(source.internalChildren
        ? { internalChildren: (id: string) => source.internalChildren!(id) }
        : {}),
    };
  }

  /** id -> "this node is inside a built subtree", memoized across the walk. */
  const internalCache = new Map<string, boolean>();

  const isBuiltInternal = (id: string): boolean => {
    const cached = internalCache.get(id);
    if (cached !== undefined) return cached;
    // Climb to the first answer we already have (or to a root), then fill the
    // whole chain in one pass — an ancestor walk per node would be O(depth²).
    const chain: string[] = [];
    let cursor: string | null = id;
    let inherited = false;
    let guard = 0;
    while (cursor !== null && guard++ < MAX_DEPTH) {
      const known = internalCache.get(cursor);
      if (known !== undefined) {
        inherited = known;
        break;
      }
      chain.push(cursor);
      // PRECEDENCE: an explicit component root is content even inside an
      // implementation subtree. Otherwise an explicit implementation mark on
      // THIS node wins over the automatic authored-entity stamp: generated
      // native machinery is still source-addressable JSX, but its attach seam
      // knows that it is implementation. An authored entity with no such mark
      // remains content inside an implementation ancestor — a weapon attached
      // to a rig bone, for example — which is what makes promotion (see
      // `visibleChildIds`) reachable at all.
      const marks = marksOf(cursor);
      if (marks?.componentRoot !== undefined) break;
      if (marks?.builtInternal === true) {
        inherited = true;
        break;
      }
      if (marks?.authoredEntity === true) break;
      cursor = source.hierarchy.node(cursor)?.parentId ?? null;
    }
    // `chain` is innermost-first and every entry shares the verdict of the node
    // that stopped the climb — either an already-known ancestor, or the marked
    // node itself (which is the last entry pushed).
    for (const entry of chain) internalCache.set(entry, inherited);
    return inherited;
  };

  const isComponentRoot = (id: string): boolean => marksOf(id)?.componentRoot !== undefined;

  /**
   * The rows that belong directly under `node` — its own visible children,
   * plus (point 5) the visible descendants that implementation children stand
   * between. Recursive: an implementation node contributes ITS promoted rows in
   * its own place, so a two-deep chain of them elides just as one does, and a
   * subtree with nothing visible in it contributes nothing at all.
   */
  const visibleChildIds = (node: EditorNode, depth = 0): string[] => {
    if (depth > MAX_DEPTH) return [];
    const out: string[] = [];
    for (const childId of node.childIds) {
      if (!isBuiltInternal(childId)) {
        out.push(childId);
        continue;
      }
      const child = source.hierarchy.node(childId);
      if (child) out.push(...visibleChildIds(child, depth + 1));
    }
    return out;
  };

  /** The children of `id` this view hides — its DIRECT implementation children,
   *  which is what "Reveal Internals" puts back and where the true chain lives. */
  const hiddenChildIds = (node: EditorNode): string[] =>
    node.childIds.filter((childId) => isBuiltInternal(childId));

  const project = (node: EditorNode | null): EditorNode | null => {
    if (!node) return null;
    const componentRoot = marksOf(node.id)?.componentRoot;
    const childIds = visibleChildIds(node);
    const sameChildren =
      childIds.length === node.childIds.length &&
      childIds.every((childId, index) => childId === node.childIds[index]);
    if (componentRoot === undefined && sameChildren) return node;
    return {
      ...node,
      ...(componentRoot === undefined
        ? {}
        : { role: 'component' as const, typeLabel: componentRoot }),
      ...(sameChildren ? {} : { childIds }),
    };
  };

  const hierarchy: Pick<HierarchyProvider, 'roots' | 'node'> = {
    roots: () =>
      source.hierarchy.roots().flatMap((root) => {
        if (!isBuiltInternal(root.id)) return [project(root)!];
        return visibleChildIds(root).flatMap((childId) => {
          const child = project(source.hierarchy.node(childId));
          return child ? [{ ...child, parentId: root.parentId }] : [];
        });
      }),
    node: (id) => project(source.hierarchy.node(id)),
  };

  return {
    hierarchy,
    isComponentRoot,
    isBuiltInternal,
    hasInternals: (id) => {
      if (source.hasInternals?.(id) === true) return true;
      const node = source.hierarchy.node(id);
      return node ? hiddenChildIds(node).length > 0 : false;
    },
    internalChildren: (id) => {
      const own = source.internalChildren?.(id);
      const node = source.hierarchy.node(id);
      const hidden = node
        ? hiddenChildIds(node).flatMap((childId) => {
            // PROJECTED, not raw: this node's own implementation children are
            // hidden from its `childIds` here too, and the reveal walk appends
            // them back itself. Handing back the raw node would list every
            // sub-bone twice. Reveal therefore shows the TRUE chain of
            // implementation nodes — each under its real parent, one level per
            // walk step — which is what the action is for.
            const child = project(source.hierarchy.node(childId));
            // Re-parented to `id` — a revealed subtree is displayed as the tree
            // it literally is, the same rule `internalChildren` states on the
            // source adapter.
            return child ? [{ ...child, parentId: id }] : [];
          })
        : [];
      if (own === undefined) return hidden.length > 0 ? hidden : undefined;
      return [...own, ...hidden];
    },
  };
}

/**
 * A marked component instance opens CLOSED. This is a default, applied on top
 * of `defaultExpansionByNode`'s shape rule and under the author's own session /
 * persisted preference — so "expandable on demand" is the panel's existing
 * expansion state doing its existing job, and an instance the author opened
 * stays open across renders.
 *
 * Takes the already-flattened structural rows rather than walking the tree
 * again: the panel has them, and a second walk over a live graph is the cost
 * this whole cycle exists to remove.
 */
export function applyComponentRootExpansionDefaults(
  defaults: Map<string, boolean>,
  rows: readonly HierarchyNodeRow[],
  isComponentRoot: (id: string) => boolean,
): Map<string, boolean> {
  for (const row of rows) {
    if (row.more) continue;
    if (isComponentRoot(row.node.id)) defaults.set(row.node.id, false);
  }
  return defaults;
}
