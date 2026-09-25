/**
 * What the hierarchy panel is allowed to REUSE between two renders, and the
 * row index that makes a selection change cost `O(selection × depth)` instead
 * of `O(nodes)`.
 *
 * THE DEFECT THIS EXISTS FOR (scale-speed baseline, 2026-08-19, 22 of 43
 * offender rows): `GameHierarchySurface` re-renders on every store notify — it
 * has to, because the highlight moves — and its render body rebuilds the whole
 * row pipeline from `adapter.hierarchy`: one uncapped flatten of every node,
 * the per-node first-open policy, a second capped flatten, and a per-row
 * ancestor climb. On a 20 000-node world that is 100-430ms of main-thread
 * block AFTER a `select` whose reply already went out in 3ms, and it is paid
 * for a change that touched nothing the walk reads.
 *
 * The two slots below split that pipeline where its inputs actually split:
 *
 *   - {@link HierarchyRowCache.structural} holds everything derived from the
 *     TREE alone. Its key carries the store's `contentVersion` and the
 *     adapter's structural notification epoch. The store version stands
 *     still for a selection-only notify and moves for every other mutation
 *     (see `EditorShellStore.contentVersion`) — including the adapter's own
 *     `notifyIngestEdit` on a live structural change, which is what makes a
 *     late-arriving subtree invalidate this on the tick it lands.
 *   - {@link HierarchyRowCache.collapsed} holds the FOLD projected onto the
 *     tree — the set of row paths that are collapsed right now. Deriving it
 *     scans every structural row, so it is `O(nodes)`; its inputs are the tree
 *     and the fold, and SELECTION IS NOT ONE OF THEM. It has its own slot
 *     because the browse view below keys on the reveal a selection opens, and
 *     folding that `O(nodes)` scan into the same slot made every click pay it.
 *   - {@link HierarchyRowCache.browse} holds the capped/collapsed/searched
 *     view. It keys on the structural value BY IDENTITY plus the fold, scope,
 *     search and reveal state — so a selection that reveals nothing new reuses
 *     it, and one that does reveal something rebuilds it.
 *
 * Each slot holds ONE entry. The panel renders one tree at a time, and a
 * one-entry memo cannot leak: the moment the key moves, the old value is
 * dropped. Keys are compared element-wise with `Object.is`, so every entry
 * must be a primitive or a stable reference — never a freshly built object
 * (a `Set`/`Map` built per render would never compare equal and would make
 * the cache a pure cost). Signatures are the way to put a collection in a key.
 */

import type { HierarchyNodeRow } from '@volter/editor-sdk/kit/hierarchy-node-rows';

/** Element-wise `Object.is` over two key tuples. */
function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** One memo slot: the last key it computed for, and the value it produced. */
class Slot<V> {
  #key: readonly unknown[] | null = null;
  #value: V | undefined;
  /** How many times `compute` actually ran. Read by tests; never by product code. */
  computeCount = 0;

  get current(): V | undefined {
    return this.#value;
  }

  read(key: readonly unknown[], compute: (previous: V | undefined) => V): V {
    if (this.#key !== null && sameKey(this.#key, key)) return this.#value as V;
    const value = compute(this.#value);
    this.#key = key;
    this.#value = value;
    this.computeCount += 1;
    return value;
  }
}

/**
 * The panel's two memo slots. Held in a `useRef` (never module state, so it
 * cannot leak between editor sessions — the same stance `TransformLockCache`
 * takes).
 */
export class HierarchyRowCache<Structural, Browse, Collapsed = unknown> {
  readonly #structural = new Slot<Structural>();
  readonly #collapsed = new Slot<Collapsed>();
  readonly #browse = new Slot<Browse>();
  /**
   * `useDeferredValue` can render 11, then speculatively render 10, then catch
   * up to 12. A render-time one-slot memo must not let that backward key
   * replace 11 as the predecessor for 12's exact structural delta.
   */
  #structuralAdapter: unknown;
  #structuralVersion = Number.NEGATIVE_INFINITY;

  /**
   * The tree-only half. `key` must name the adapter identity, the store's
   * `contentVersion`, and any adapter-owned structural notification epoch;
   * nothing in it may move for a selection change.
   */
  structural(
    key: readonly unknown[],
    compute: (previous: Structural | undefined) => Structural,
  ): Structural {
    const [adapter, version] = key;
    if (
      adapter === this.#structuralAdapter &&
      typeof version === 'number' &&
      version < this.#structuralVersion &&
      this.#structural.current !== undefined
    ) {
      return this.#structural.current;
    }
    const value = this.#structural.read(key, compute);
    if (adapter !== this.#structuralAdapter) {
      this.#structuralAdapter = adapter;
      this.#structuralVersion = Number.NEGATIVE_INFINITY;
    }
    if (typeof version === 'number') {
      this.#structuralVersion = Math.max(this.#structuralVersion, version);
    }
    return value;
  }

  /**
   * The fold-only half. `key` must START with the structural value itself and
   * carry the fold generation/scope — and, like {@link structural}, nothing a
   * selection moves.
   */
  collapsed(
    key: readonly unknown[],
    compute: (previous: Collapsed | undefined) => Collapsed,
  ): Collapsed {
    return this.#collapsed.read(key, compute);
  }

  /**
   * The capped/collapsed/searched half. `key` must START with the structural
   * value itself, so a rebuilt tree can never be viewed through a stale
   * browse result.
   */
  browse(key: readonly unknown[], compute: (previous: Browse | undefined) => Browse): Browse {
    return this.#browse.read(key, compute);
  }

  /** How many times each slot re-derived. Test/instrumentation only. */
  get counts(): { structural: number; collapsed: number; browse: number } {
    return {
      structural: this.#structural.computeCount,
      collapsed: this.#collapsed.computeCount,
      browse: this.#browse.computeCount,
    };
  }
}

// --------------------------------------------------------------- row index

/**
 * Where every row sits, indexed both ways.
 *
 * Built once per structural walk and cached with it. Both selection-driven
 * derivations below used to SCAN every row (and `selectedAncestorNodeIds`
 * additionally built an N-entry `Map` of its own) on every render, which is
 * `O(nodes)` work whose answer is about a handful of selected ids.
 */
export interface RowPathIndex {
  /** `pathKey` → node id, for every real (non-`more`) row. */
  readonly nodeIdByPathKey: ReadonlyMap<string, string>;
  /** node id → every `pathKey` that node is rendered at. A live tree can reach
   *  one id from more than one place; the flattener keeps the first, but the
   *  index keeps them all so nothing depends on which walk order found it. */
  readonly pathKeysByNodeId: ReadonlyMap<string, readonly string[]>;
}

export function indexRowPaths(rows: readonly HierarchyNodeRow[]): RowPathIndex {
  const nodeIdByPathKey = new Map<string, string>();
  const pathKeysByNodeId = new Map<string, string[]>();
  for (const row of rows) {
    if (row.more) continue;
    nodeIdByPathKey.set(row.pathKey, row.node.id);
    const existing = pathKeysByNodeId.get(row.node.id);
    if (existing) existing.push(row.pathKey);
    else pathKeysByNodeId.set(row.node.id, [row.pathKey]);
  }
  return { nodeIdByPathKey, pathKeysByNodeId };
}

/** Every strict-ancestor path of `pathKey`, outermost first. */
export function ancestorPathKeys(pathKey: string): string[] {
  const parts = pathKey.split('.');
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join('.'));
  return ancestors;
}

/** The node ids of every ancestor of every selected row — the branch selection
 *  reveal opens. `O(selection × depth)`. */
export function selectedAncestorNodeIds(
  index: RowPathIndex,
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const selected of selectedIds) {
    for (const pathKey of index.pathKeysByNodeId.get(selected) ?? []) {
      for (const ancestor of ancestorPathKeys(pathKey)) {
        const id = index.nodeIdByPathKey.get(ancestor);
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

/** How many children each ancestor of a selected row must show for that row to
 *  survive the browse-view child cap. `O(selection × depth)`. */
export function selectedRevealCounts(
  index: RowPathIndex,
  selectedIds: ReadonlySet<string>,
): Map<string, number> {
  const revealed = new Map<string, number>();
  for (const selected of selectedIds) {
    for (const pathKey of index.pathKeysByNodeId.get(selected) ?? []) {
      const parts = pathKey.split('.');
      let parent = parts[0]!;
      for (let i = 1; i < parts.length; i++) {
        const childIndex = Number(parts[i]);
        if (Number.isFinite(childIndex)) {
          revealed.set(parent, Math.max(revealed.get(parent) ?? 0, childIndex + 1));
        }
        parent = `${parent}.${parts[i]}`;
      }
    }
  }
  return revealed;
}

/**
 * A stable, order-independent string for a reveal map, so it can sit in a memo
 * key that is compared with `Object.is`. Reveal maps are small (one entry per
 * ancestor of a selected/expanded row), which is what makes a signature the
 * right shape here rather than a version counter.
 */
export function revealSignature(revealed: ReadonlyMap<string, number>): string {
  if (revealed.size === 0) return '';
  return [...revealed]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([pathKey, count]) => `${pathKey}=${String(count)}`)
    .join(',');
}
