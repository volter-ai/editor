/**
 * ONE breadth-first walk of an authoring hierarchy, and the reason it is not
 * written inline four more times.
 *
 * WHAT THIS REPLACES, AND WHY IT IS A BUG AND NOT A STYLE PREFERENCE. Four
 * modules carried the same hand-rolled BFS — `activeHierarchyRows`,
 * `authoringDocumentSourcePath`, the Content panel's `hierarchyNodes`, the
 * composite adapter's `childAssetEntries`, the Light Explorer's `lightNodes` —
 * and every one of them drained its queue with `Array.prototype.shift()`.
 * `shift` is not O(1) on a large array: V8 moves the remaining elements down,
 * so a queue that grows to thousands makes the walk QUADRATIC in node count.
 *
 * Measured with the page's own `Profiler` on the scale harness's 20 000-node
 * canvas world (2026-08-20), profiling the 1.4s window around one relayed
 * `select`: **1471 of 1606 samples were inside `activeHierarchyRows`** — one
 * deferred `collectState` refresh spending 1.4 seconds walking a tree whose
 * every other reader answers in single-digit milliseconds. The study's
 * superlinear growth ratios (canvas ×22-×55, three ×12-×42 from N=1000 to
 * N=5000, where linear is ×5) are what a quadratic walk read through a
 * linear-looking API produces.
 *
 * The cursor below is the whole fix. Nothing about the traversal ORDER,
 * de-duplication, or the set of nodes visited changes — a caller gets exactly
 * the sequence its own loop produced, and the dedup guard (first occurrence
 * wins, a cycle terminates) is the one every copy already had.
 */

import type { EditorNode, HierarchyProvider } from '@volter/editor-project/adapter';

/** The two members every walker here needs; deliberately not the whole provider. */
export type WalkableHierarchy = Pick<HierarchyProvider, 'roots' | 'node'>;

export interface HierarchyWalkOptions {
  /**
   * Extra children to enqueue behind `id`'s own — the Light Explorer's revealed
   * internals, which are reachable through the adapter but not through
   * `childIds`. Already-visited ids are dropped by the same guard as any other
   * child, so an internal that is also a projected child is visited once.
   */
  readonly extraChildren?: (id: string) => Iterable<EditorNode> | undefined;
}

/**
 * Visit every reachable node breadth-first, each id exactly once.
 *
 * Return `false` from `visit` to STOP the walk — the early-exit searches
 * (`authoringDocumentSourcePath`) are why this takes a callback rather than
 * only returning an array: a search that answers on the first row must not pay
 * for a full walk of a 20 000-node tree first.
 */
export function forEachHierarchyNode(
  hierarchy: WalkableHierarchy,
  visit: (node: EditorNode) => boolean | void,
  options: HierarchyWalkOptions = {},
): void {
  const queue: EditorNode[] = [...hierarchy.roots()];
  const seen = new Set<string>();
  // A CURSOR, never `shift()`. See this file's header for the measurement.
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    if (visit(node) === false) return;
    for (const childId of node.childIds) {
      const child = hierarchy.node(childId);
      if (child) queue.push(child);
    }
    for (const extra of options.extraChildren?.(node.id) ?? []) queue.push(extra);
  }
}

/** Every reachable node, breadth-first, de-duplicated by id. */
export function hierarchyNodesBreadthFirst(
  hierarchy: WalkableHierarchy,
  options: HierarchyWalkOptions = {},
): EditorNode[] {
  const nodes: EditorNode[] = [];
  forEachHierarchyNode(
    hierarchy,
    (node) => {
      nodes.push(node);
    },
    options,
  );
  return nodes;
}
