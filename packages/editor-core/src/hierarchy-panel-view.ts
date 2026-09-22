/**
 * `editor.hierarchy()` — the machine door onto the hierarchy panel's ACTUAL
 * rendered row tree.
 *
 * ## Why this publishes instead of re-deriving
 *
 * `inspection/active-subject.ts` answers "what is the inspector showing?" by
 * calling the same composer the panel calls, with the same inputs, at the
 * moment it is asked. That works because every one of the inspector's inputs is
 * reachable from live state.
 *
 * The hierarchy panel's are not. Its final row list is a fold of the adapter's
 * tree, the mark view, the internals reveal, the search term, the child cap,
 * the selection scope, per-world hide flags, AND two pieces of state that live
 * inside the component instance: the session expansion map (`useRef`) and the
 * measured scroll window. A door that re-walked the adapter to "reconstruct"
 * that list would be a SECOND row pipeline, free to disagree with the panel —
 * and a door whose whole purpose is diagnosing the panel is worthless the
 * moment it can disagree with it. That is not hypothetical: `editor.status()`'s
 * `entities` facet (`authoring/shell-document-ops.ts`) walks the RAW adapter
 * hierarchy with no marks, no internals folding and no document promotion, so
 * it reports a tree the panel has never rendered — which is exactly why it
 * could not surface a panel defect.
 *
 * So the panel PUBLISHES what it computed. The snapshot holds the panel's own
 * `HierarchyNodeRow[]` and the panel's own predicates by reference — not copies, not
 * re-derivations — and serialization happens only when the door is called, so a
 * render that nobody reads costs one object allocation.
 *
 * ## What "mounted" means here
 *
 * The publish happens in an effect, so the snapshot describes a tree that has
 * been COMMITTED to the DOM. With no panel mounted there is no snapshot and the
 * door refuses by name rather than answering with an empty tree — a fabricated
 * "the hierarchy is empty" is the anti-shim rule's failure on the one surface
 * that exists to be believed. Because the commit is what publishes, a caller
 * that MUTATES the panel (Expand/Collapse All) takes
 * {@link nextHierarchyPanelSnapshot} before it acts and awaits it, so its ack
 * means "the rows the next `hierarchy()` serializes are the rows this mutation
 * produced" rather than "the mutation was requested".
 */

import type { HierarchyNodeRow } from './hierarchy-node-rows';

/**
 * What the panel hands over: its final rows plus the predicates it already
 * evaluated them with. Every member is the panel's own — see this module's
 * header for why nothing here is recomputed.
 */
export interface HierarchyPanelSnapshot {
  /** The panel's final row list, in display order, AFTER search / cap /
   *  collapse / scope / world-hide filtering — i.e. the rows a human scrolls. */
  readonly rows: readonly HierarchyNodeRow[];
  /** The slice actually in the DOM right now (virtualization window). */
  readonly window: { readonly start: number; readonly end: number };
  /** The active search term, or `null` when browsing. */
  readonly searchTerm: string | null;
  /** The row the panel is scoped into (double-clicked instance), or `null`. */
  readonly scopeId: string | null;
  /** The panel's own expansion verdict — session state, then the persisted
   *  preference, then the shape/mark defaults. */
  readonly isExpanded: (row: HierarchyNodeRow) => boolean;
  /** True for a row that exists only because internals were revealed. */
  readonly isInternal: (id: string) => boolean;
  /** True for a row carrying `vgaiComponentRoot`. */
  readonly isComponentRoot: (id: string) => boolean;
  /** How many children this row's view FOLDED AWAY as implementation. */
  readonly foldedInternalCount: (id: string) => number;
  /** The panel's own Expand All action. Machine readers use the same mutation
   *  as the toolbar, then read a later committed snapshot; they never bypass
   *  collapse state by walking the adapter behind the panel. */
  readonly expandAll: () => void;
  /** The panel's own Collapse All action — the SAME toolbar button's other
   *  half. It exists because Expand All alone is a one-way door: once a
   *  machine reader expands, nothing through the product restores the tree's
   *  rest state (the fold is written to this project's persisted preference,
   *  and a chevron's own click is not drivable — `editor.document.click`
   *  refuses editor chrome by name). A rest state the product cannot return
   *  to is a rest state the product cannot certify. */
  readonly collapseAll: () => void;
}

/** One serialized panel row. Nested, because the shape of the tree IS the
 *  thing under diagnosis. */
export interface SerializedHierarchyRow {
  id: string;
  label: string;
  /** The dim type suffix the row prints (`Coin1 ·Coin`). */
  typeLabel?: string;
  role?: string;
  depth: number;
  /**
   * Children the row's own view has — what opening the caret reveals. This is
   * the PROJECTED count: implementation children folded by the mark view are
   * not in it (they are in {@link internalChildCount}).
   */
  childCount: number;
  /** Children folded away as implementation, reachable through "Reveal
   *  Internals". Non-zero with `childCount: 0` is a row whose whole subtree is
   *  machinery. */
  internalChildCount: number;
  /**
   * Whether the panel renders a disclosure control on this row. THE
   * load-bearing field: a row with children of any kind and
   * `expandable: false` is a subtree the UI offers no way to reach.
   */
  expandable: boolean;
  /** Only meaningful when {@link expandable}. */
  expanded?: boolean;
  /** Read-only, de-emphasized revealed-internal row. */
  internal?: true;
  /** Marked component-instance root. */
  componentRoot?: true;
  /** A synthetic "… N more" cap stub rather than a real node. */
  more?: { hidden: number };
  children?: readonly SerializedHierarchyRow[];
}

/** The whole panel, as data. */
export interface SerializedHierarchyPanel {
  /** Total rows in the panel's list (not just the windowed slice). */
  rowCount: number;
  /** The slice in the DOM; `end - start < rowCount` means scrolling reveals more. */
  window: { start: number; end: number };
  /** Present only while a search is filtering the tree. */
  search?: string;
  /** Present only while the panel is scoped into a subtree. */
  scopeId?: string;
  /** Which surface the rows belong to — a play-mode tree and an edit-mode tree
   *  come from different adapters, and telling them apart is the first question
   *  any hierarchy diagnosis asks. */
  playState: string;
  activeViewportTab: string;
  roots: readonly SerializedHierarchyRow[];
}

// ------------------------------------------------------------ session state

let published: HierarchyPanelSnapshot | null = null;

/** Callers parked in {@link nextHierarchyPanelSnapshot}, settled by the next
 *  publish (resolve) or by the panel going away (reject). */
const waiters: Array<{
  readonly resolve: (snapshot: HierarchyPanelSnapshot) => void;
  readonly reject: (error: Error) => void;
}> = [];

/** Called by `GameHierarchy` after every commit. */
export function publishHierarchyPanelSnapshot(snapshot: HierarchyPanelSnapshot): void {
  published = snapshot;
  if (waiters.length === 0) return;
  for (const waiter of waiters.splice(0, waiters.length)) waiter.resolve(snapshot);
}

/**
 * Resolve on the panel's NEXT published snapshot — i.e. the next React commit.
 *
 * A mutation through the snapshot's own actions (`expandAll`/`collapseAll`)
 * only mutates a ref and schedules a re-render; the rows the door serializes
 * are republished from the panel's effect. Take this promise BEFORE calling the
 * action and await it after, and the mutation's ack lands on the committed
 * tree. No timeout: the actions force a render unconditionally
 * (`useReducer` increment — never a bail-out, even when the expansion map is
 * unchanged), so a publish always follows, and a caller that would otherwise
 * hang is instead rejected by {@link clearHierarchyPanelSnapshot}.
 */
export function nextHierarchyPanelSnapshot(): Promise<HierarchyPanelSnapshot> {
  return new Promise<HierarchyPanelSnapshot>((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
}

/** Called on unmount. Guarded so a remount's publish is never clobbered by the
 *  outgoing instance's cleanup (effect cleanup runs after the next mount's
 *  effect in a React remount). */
export function clearHierarchyPanelSnapshot(snapshot: HierarchyPanelSnapshot): void {
  if (published !== snapshot) return;
  published = null;
  if (waiters.length === 0) return;
  // This cleanup is NOT unmount-only: the panel's publish effect depends on the
  // snapshot object, which is fresh every render, so an ordinary update runs
  // this clear and then the new publish back-to-back inside one commit. Only a
  // real unmount leaves `published` null once that commit has drained, so the
  // rejection is deferred one microtask and skipped if a publish arrived.
  queueMicrotask(() => {
    if (published !== null || waiters.length === 0) return;
    for (const waiter of waiters.splice(0, waiters.length)) {
      waiter.reject(
        new Error(
          'the hierarchy panel (GameHierarchy) unmounted before it published the mutated row tree, so the mutation cannot be acknowledged against a rendered tree. Open the Hierarchy panel in the workspace dock and retry.',
        ),
      );
    }
  });
}

/** `null` when no hierarchy panel is mounted. */
export function hierarchyPanelSnapshot(): HierarchyPanelSnapshot | null {
  return published;
}

/** Test-only reset for the module-level singleton. */
export function __resetHierarchyPanelSnapshotForTest(): void {
  published = null;
  waiters.length = 0;
}

// -------------------------------------------------------------- serialization

/**
 * Turn the panel's flat, depth-tagged rows back into the nesting a reader sees.
 *
 * The flattener emits rows in display order with a `depth`, so a depth stack
 * rebuilds the parenting exactly — including a search result set, whose depths
 * jump (an ancestor may be filtered out), which the stack handles by popping to
 * the nearest shallower row rather than inventing a parent.
 */
export function serializeHierarchyPanel(
  snapshot: HierarchyPanelSnapshot,
  mode: { readonly playState: string; readonly activeViewportTab: string },
): SerializedHierarchyPanel {
  const roots: SerializedHierarchyRow[] = [];
  /** The open ancestor chain: `stack[i]` is the last row emitted at depth `i`. */
  const stack: SerializedHierarchyRow[] = [];

  for (const row of snapshot.rows) {
    const serialized = serializeRow(row, snapshot);
    while (stack.length > row.depth) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;
    if (parent === undefined) {
      roots.push(serialized);
    } else {
      const children = parent.children as SerializedHierarchyRow[] | undefined;
      if (children === undefined) parent.children = [serialized];
      else children.push(serialized);
    }
    stack.push(serialized);
  }

  return {
    rowCount: snapshot.rows.length,
    window: { start: snapshot.window.start, end: snapshot.window.end },
    ...(snapshot.searchTerm ? { search: snapshot.searchTerm } : {}),
    ...(snapshot.scopeId ? { scopeId: snapshot.scopeId } : {}),
    playState: mode.playState,
    activeViewportTab: mode.activeViewportTab,
    roots,
  };
}

function serializeRow(
  row: HierarchyNodeRow,
  snapshot: HierarchyPanelSnapshot,
): SerializedHierarchyRow {
  const { node } = row;
  if (row.more) {
    return {
      id: node.id,
      label: `… ${row.more.hidden} more`,
      depth: row.depth,
      childCount: 0,
      internalChildCount: 0,
      expandable: false,
      more: { hidden: row.more.hidden },
    };
  }
  return {
    id: node.id,
    label: node.label,
    ...(node.typeLabel === undefined ? {} : { typeLabel: node.typeLabel }),
    ...(node.role === undefined ? {} : { role: node.role }),
    depth: row.depth,
    childCount: node.childIds.length,
    internalChildCount: snapshot.foldedInternalCount(node.id),
    expandable: row.hasChildren,
    ...(row.hasChildren ? { expanded: snapshot.isExpanded(row) } : {}),
    ...(snapshot.isInternal(node.id) ? { internal: true as const } : {}),
    ...(snapshot.isComponentRoot(node.id) ? { componentRoot: true as const } : {}),
  };
}
