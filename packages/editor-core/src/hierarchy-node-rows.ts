/**
 * Pure row-flattening for `IngestHierarchy` (no React) — D-W4 (F14/F18),
 * extracted the same way `hierarchy-rows.ts` extracts `SceneHierarchy`'s
 * equivalent, so the key/collapse/cycle-guard logic is unit-testable without
 * rendering.
 *
 * §0.5's ground truth: an ingested game's structural ids
 * (`ingest:<path>:<type>:<name>`, `@volter/editor-threejs/adapter/ingest/structural-ids`'s
 * `assignStructuralIds`) are baked ONCE at capture and are the key every
 * editor surface addresses an object by — never touched here. But
 * `IngestHierarchy` re-reads the LIVE `Object3D` tree every render
 * (`adapter.hierarchy.node(id)`), and a live game can reorder or clone
 * subtrees after capture, so the SAME baked id can legitimately show up in
 * more than one place in a single walk — `EditorNode.id` alone is no longer
 * a safe React key, and naively recursing `childIds` with no guard can loop
 * forever if a stale/duplicated id ever points back at one of its own
 * ancestors.
 *
 * Per-parent child cap, copied from `hierarchy-rows.ts`'s
 * `flattenVisibleRows`/ `CHILD_CAP`/`MORE_ID_PREFIX` (same constants, no
 * drift). Unlike first-party (which only caps in play mode), the adapter
 * panel's tree is BY DEFINITION a live game scene graph, so `capEnabled`
 * defaults to `false` here (matching this function's PRE-cap behavior
 * byte-for-byte — every existing caller/test that doesn't pass the new params
 * keeps working unchanged) and `IngestHierarchy` explicitly turns it on for
 * the browse view. Search bypasses the cap by calling with `capEnabled=false`
 * (D-C4) — the exact same "flatten UNCAPPED, filter flat" shape this module
 * already used for search before the cap existed.
 */

import type { EditorNode, HierarchyProvider } from '@volter/editor-project/adapter';
import { CHILD_CAP, MORE_ID_PREFIX } from './hierarchy-rows';

/** One flattened, render-ready row over an ingested game's live hierarchy. */
export interface HierarchyNodeRow {
  readonly node: EditorNode;
  readonly depth: number;
  /**
   * Render key material: the walk path (root index, then child index at
   * each level) — NOT `node.id` alone. Stays unique across a render even
   * when the id scheme collides, because it is derived from POSITION in
   * the walk, not from the adapter's (potentially stale/duplicated) data.
   */
  readonly pathKey: string;
  readonly hasChildren: boolean;
  /** True when an ANCESTOR's `pathKey` is in the caller's collapsed-set —
   *  i.e. this row is inside a collapsed subtree (F18). The row itself is
   *  still included in the returned array (so a search can still find it);
   *  the component filters it out when not searching. */
  readonly hiddenByCollapse: boolean;
  /** Present on a synthetic "… N more" row that reveals capped siblings
   *  (D-C2) — `parentPathKey` is the capped parent's `pathKey`, `hidden` is
   *  how many of its children are not shown. Never present on a real row. */
  readonly more?: { readonly parentPathKey: string; readonly hidden: number };
}

/**
 * Backstop against a childIds list this guard's own dedup somehow doesn't
 * anticipate (e.g. a very deep but genuinely acyclic live tree) — ingested
 * games are not expected to nest anywhere near this deep; this is a second,
 * independent safety net, not the primary guard (see `visited` below).
 */
const MAX_DEPTH = 500;

/** How many of a parent's children to walk (D-C1/D-C3) — split out of `walk`
 *  below purely to keep that function's cognitive-complexity score down. */
function childLimit(
  capEnabled: boolean,
  revealed: ReadonlyMap<string, number>,
  parentPathKey: string,
): number {
  return capEnabled
    ? Math.max(CHILD_CAP, revealed.get(parentPathKey) ?? CHILD_CAP)
    : Number.POSITIVE_INFINITY;
}

/** The synthetic "… N more" row for a capped parent (D-C2) — a render-only
 *  stub, never fed back to the adapter. Split out of `walk` below purely to
 *  keep that function's cognitive-complexity score down. */
function buildMoreRow(
  parentPathKey: string,
  depth: number,
  parentId: string,
  hiddenByCollapse: boolean,
  hidden: number,
): HierarchyNodeRow {
  return {
    node: {
      id: `${MORE_ID_PREFIX}${parentPathKey}`,
      label: '',
      kind: 'object',
      parentId,
      childIds: [],
    },
    depth,
    pathKey: `${parentPathKey}/__more__`,
    hasChildren: false,
    hiddenByCollapse,
    more: { parentPathKey, hidden },
  };
}

/**
 * Flatten an ingest adapter's hierarchy into display rows.
 *
 * F14 cycle/dup guard: `visited` tracks every `node.id` already emitted in
 * THIS walk. A live game reordering/cloning objects can make the same baked
 * id reachable from more than one place (a real duplicate) or, in principle,
 * from one of its own descendants (a cycle) — either way the id is stale
 * data describing the CURRENT live scene, not a second logical node. The
 * chosen semantics: render the first occurrence encountered (root-first,
 * then depth-first child order) and silently skip every later one — no
 * second row, and a cycle can never recurse forever. `collapsedKeys` is
 * keyed by `pathKey`, not `node.id` (F18) — a walk-path is stable for "this
 * position in the tree shape", which is what "collapsed" means to a user
 * looking at the panel; keying by id would let a stale/reused id apply a
 * collapse to the WRONG node after a live reorder, or fail to distinguish
 * two positions that happen to share a duplicated id.
 *
 * D-C1/D-C3 cap: when `capEnabled`, each parent's children are limited to
 * `max(CHILD_CAP, revealed.get(parentPathKey) ?? CHILD_CAP)` and a synthetic
 * more-row is appended when some are hidden (D-C2). D-C5: children beyond
 * the limit are never walked, so never added to `visited` — a duplicate id
 * whose first structural occurrence was capped away still renders at its
 * next reachable occurrence (the dedup guard's "once, not zero times"
 * guarantee holds). D-C6: a COLLAPSED parent (its own `pathKey` is in
 * `collapsedKeys`) contributes no child rows and no more-row at all when
 * capped — the walk stops at the parent itself rather than descending and
 * relying on `hiddenByCollapse` filtering, since a more-row would otherwise
 * still need suppressing. Uncapped calls (search, D-C4) are unaffected:
 * collapse only ever gates recursion when `capEnabled`, so a collapsed
 * subtree's matches stay reachable when searching, exactly as before.
 */
export function flattenHierarchyRows(
  hierarchy: Pick<HierarchyProvider, 'roots' | 'node'>,
  collapsedKeys: ReadonlySet<string>,
  revealed: ReadonlyMap<string, number> = new Map(),
  capEnabled = false,
): HierarchyNodeRow[] {
  const rows: HierarchyNodeRow[] = [];
  const visited = new Set<string>();

  const walk = (node: EditorNode, depth: number, pathKey: string, parentHidden: boolean): void => {
    if (visited.has(node.id) || depth > MAX_DEPTH) return;
    visited.add(node.id);

    const hasChildren = node.childIds.length > 0;
    rows.push({ node, depth, pathKey, hasChildren, hiddenByCollapse: parentHidden });

    const isCollapsed = collapsedKeys.has(pathKey);
    if (capEnabled && isCollapsed) return; // D-C6: nothing of a collapsed subtree renders.

    const childHidden = parentHidden || isCollapsed;
    const shown = Math.min(node.childIds.length, childLimit(capEnabled, revealed, pathKey));

    for (let i = 0; i < shown; i++) {
      const child = hierarchy.node(node.childIds[i]!);
      if (child) walk(child, depth + 1, `${pathKey}.${i}`, childHidden);
    }

    if (capEnabled && node.childIds.length > shown) {
      rows.push(
        buildMoreRow(pathKey, depth + 1, node.id, childHidden, node.childIds.length - shown),
      );
    }
  };

  hierarchy.roots().forEach((root, i) => {
    walk(root, 0, `r${i}`, false);
  });
  return rows;
}

/**
 * Patch an uncapped structural snapshot after an identity-unique projection
 * reports the parents whose direct child lists changed.
 *
 * Each changed parent's complete visible subtree is replaced in place. This
 * preserves every unaffected row object and avoids asking the provider about
 * the rest of a large world. Rebuilding the parent (not only its new child)
 * is what preserves exact sibling order and walk-path keys after insert,
 * remove, or reparent. `null` is the conservative answer whenever the delta
 * cannot be related to the previous snapshot; the caller then takes the full
 * {@link flattenHierarchyRows} path.
 *
 * This helper requires provider-unique ids. The live Three projector supplies
 * that invariant when it supplies the parent delta; arbitrary hierarchy
 * providers continue to use the full flattener and its duplicate-id guard.
 */
export function patchUniqueHierarchyRows(
  hierarchy: Pick<HierarchyProvider, 'node'>,
  previous: readonly HierarchyNodeRow[],
  changedParentIds: ReadonlySet<string>,
): HierarchyNodeRow[] | null {
  if (changedParentIds.size === 0) return previous as HierarchyNodeRow[];

  const rowIndexById = new Map<string, number>();
  for (let index = 0; index < previous.length; index += 1) {
    const row = previous[index]!;
    if (!row.more) rowIndexById.set(row.node.id, index);
  }

  interface Replacement {
    readonly start: number;
    readonly end: number;
    readonly row: HierarchyNodeRow;
    readonly node: EditorNode;
  }
  const candidates: Replacement[] = [];
  for (const id of changedParentIds) {
    const start = rowIndexById.get(id);
    const node = hierarchy.node(id);
    // A removed internal parent is covered by its changed surviving ancestor.
    // Validate that relationship below after all surviving candidates are known.
    if (start === undefined || node === null) continue;
    const row = previous[start]!;
    let end = start + 1;
    while (end < previous.length && previous[end]!.depth > row.depth) end += 1;
    candidates.push({ start, end, row, node });
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.start - b.start);
  const replacements: Replacement[] = [];
  for (const candidate of candidates) {
    const ancestor = replacements.at(-1);
    if (ancestor && candidate.start < ancestor.end) continue;
    replacements.push(candidate);
  }

  // Every changed parent that existed in the previous snapshot must either be
  // rebuilt itself or lie inside a rebuilt ancestor. Otherwise the delta is
  // incomplete for this view (for example a decorator hid the raw parent).
  for (const id of changedParentIds) {
    const oldIndex = rowIndexById.get(id);
    if (oldIndex === undefined) continue;
    if (!replacements.some(({ start, end }) => oldIndex >= start && oldIndex < end)) return null;
  }

  const flattenSubtree = (replacement: Replacement): HierarchyNodeRow[] | null => {
    const rows: HierarchyNodeRow[] = [];
    const visited = new Set<string>();
    let valid = true;
    const walk = (node: EditorNode, depth: number, pathKey: string): void => {
      if (!valid) return;
      if (visited.has(node.id) || depth > MAX_DEPTH) {
        valid = false;
        return;
      }
      visited.add(node.id);
      rows.push({
        node,
        depth,
        pathKey,
        hasChildren: node.childIds.length > 0,
        hiddenByCollapse: false,
      });
      for (let childIndex = 0; childIndex < node.childIds.length; childIndex += 1) {
        const child = hierarchy.node(node.childIds[childIndex]!);
        if (child) walk(child, depth + 1, `${pathKey}.${String(childIndex)}`);
      }
    };
    walk(replacement.node, replacement.row.depth, replacement.row.pathKey);
    return valid ? rows : null;
  };

  const next = [...previous];
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index]!;
    const rows = flattenSubtree(replacement);
    if (rows === null) return null;
    next.splice(replacement.start, replacement.end - replacement.start, ...rows);
  }
  return next;
}

/** Stable React key for a row — walk path + id, so it never collides even
 *  when the underlying id scheme does (F14). */
export function hierarchyRowKey(row: Pick<HierarchyNodeRow, 'pathKey' | 'node'>): string {
  return `${row.pathKey}:${row.node.id}`;
}

/**
 * The pure start/end row-index math for the hierarchy panel's
 * scroll-windowed rendering. Kept here (not inlined in the component) for two
 * reasons: it is unit-testable standalone with no React/jsdom involved, and a
 * tamper test can `vi.mock` this ONE function to neutralize windowing (return
 * the full range) and prove the render-bounding behavior actually depends on
 * it, not on some other accidental cap.
 *
 * `overscan` extra rows are kept rendered on each side of the visible band
 * so a fast scroll or keyboard nav doesn't flash empty space before the next
 * paint catches up. `end` is clamped to `totalRows`; `start` is clamped to 0
 * (never negative near the top of the list).
 */
export function hierarchyRowWindow(
  totalRows: number,
  scrollTop: number,
  viewportPx: number,
  rowH: number,
  overscan: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const visibleCount = Math.ceil(viewportPx / rowH) + overscan * 2;
  const end = Math.min(totalRows, start + visibleCount);
  return { start, end };
}
