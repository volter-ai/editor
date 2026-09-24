/**
 * "reveal internals, read-only". Godot's Editable Children, minus the editing.
 *
 * WHAT THIS IS. `R3fSourceAuthoringAdapter.projectedChildren` surfaces only
 * CROSS-BOUNDARY children: an instance's own host nodes and its unstamped model
 * internals (bones, GLTF meshes) are "traversed but not surfaced", so an
 * `<Enemy>` reads as a leaf even though it rendered a 60-bone rig. Everything
 * needed to show that rig already exists — `indexGraph` mints a path-keyed id
 * for every non-helper object and `hierarchy.node(id)` describes it — so this
 * module adds no identity machinery. It adds a VIEW: a decorator over the
 * adapter's `HierarchyProvider` that appends the hidden children of the ids the
 * author revealed, and answers which ids it minted rows for.
 *
 * WHY A DECORATOR AND NOT A NEW FLATTENER. `flattenHierarchyRows` walks
 * `roots()`/`node(id).childIds`; virtualization, the child cap, collapse,
 * selection-reveal and the search filter are all layered on TOP of that one
 * walk. Injecting internals INTO the provider means every one of those keeps
 * working untouched — a revealed skeleton is windowed, capped and collapsed by
 * the same code as everything else, and no second row pipeline exists to drift.
 *
 * WHY THE STATE IS SESSION-ONLY. Reveal is deliberately NOT written to
 * `hierarchy-expansion-state.ts` (which persists per project in localStorage):
 * a skeleton that reappears on every project open is noise in the panel the
 * author needs most, and unlike a normal fold it is not a statement about the
 * authored tree at all — it is a temporary "let me look inside this". It lives
 * in a module-level Set for the life of the tab, cleared on project switch by
 * nothing at all, because ids are project-scoped (`r3f:<worldId>:<oid>`) and a
 * stale id simply never matches.
 *
 * READ-ONLY IS ENFORCED ELSEWHERE, ON PURPOSE: this module only says WHICH rows
 * are internal; `hierarchy-row-model.ts`'s `rowAffordances` is the single
 * predicate that turns that into "no drag, no rename, no write, no search".
 */

import type { EditorNode, HierarchyProvider } from '@volter/editor-project/adapter';

/** The (optional, structural) adapter capability H6 needs — the same
 *  contract-free probe shape H3's `InstanceSourceLocator` and H5's
 *  `RowDiagnosticsSource` use, so no adapter is forced to implement it and no
 *  editor module imports an R3F type to read it. */
export interface InternalsSource {
  readonly hierarchy: Pick<HierarchyProvider, 'roots' | 'node'>;
  /** Cheap "would revealing this row show anything?" — used to decide whether
   *  the menu item appears at all. */
  readonly hasInternals?: ((id: string) => boolean) | undefined;
  /** The RAW live children of `id` that the adapter's own projection hides,
   *  each described exactly as `hierarchy.node` would describe it, but
   *  re-parented to its RAW parent so a revealed subtree reads as the tree it
   *  actually is. `undefined` for an id the adapter does not own. */
  readonly internalChildren?: ((id: string) => EditorNode[] | undefined) | undefined;
}

export interface InternalsProjection {
  /** The provider to flatten. Identity-equal to the source's own when nothing
   *  is revealed, so the common case costs nothing. */
  readonly hierarchy: Pick<HierarchyProvider, 'roots' | 'node'>;
  /** True for a row that exists ONLY because of a reveal. */
  isInternal(id: string): boolean;
  /** The revealed ids that actually produced rows (a revealed id whose object
   *  is gone after an HMR remount is silently inert, not an error). */
  readonly revealRootIds: ReadonlySet<string>;
  /** Every id this projection minted a row for, transitively. */
  readonly internalIds: ReadonlySet<string>;
}

/** Depth backstop for a pathological live tree — the same belt-and-braces
 *  constant `hierarchy-node-rows.ts` keeps for the same reason. */
const MAX_DEPTH = 500;

const EMPTY: ReadonlySet<string> = new Set();

// ------------------------------------------------------------ session state

/**
 * Ids whose internals are currently revealed. Module-level and NOT persisted —
 * see this file's header for why a revealed skeleton must not survive a reload.
 */
const revealed = new Set<string>();

export function isInternalsRevealed(id: string): boolean {
  return revealed.has(id);
}

/** Returns the new state, so a caller can report what it did. */
export function toggleInternalsRevealed(id: string): boolean {
  if (revealed.delete(id)) return false;
  revealed.add(id);
  return true;
}

export function revealedInternalsIds(): ReadonlySet<string> {
  return revealed;
}

/** Test-only reset for the module-level session set. */
export function __resetRevealedInternalsForTest(): void {
  revealed.clear();
}

// -------------------------------------------------------------- projection

/**
 * Build the revealing view of `source.hierarchy`.
 *
 * The walk is EAGER (every revealed subtree is expanded to its leaves up
 * front) rather than lazy inside `node()`, because "is this row internal?" must
 * be answerable in any order — the panel asks it while rendering a row, long
 * after the flatten that produced it, and a lazily-populated set would make the
 * answer depend on call order. It costs one `internalChildren` call per
 * revealed node, which the R3F adapter answers in O(children × depth) with no
 * subtree walk.
 *
 * A revealed node's internals are appended AFTER its projected children, which
 * is what keeps a nested instance's row in its authored place: the flattener
 * dedupes by id on first occurrence, so the instance is emitted as the real
 * child it is, and the internal path that also reaches it is skipped.
 */
export function internalsProjection(
  source: InternalsSource,
  revealedIds: ReadonlySet<string> = revealed,
): InternalsProjection {
  // Called THROUGH `source` below, never as a detached reference: every real
  // implementer is a class method that needs its own `this`.
  if (typeof source.internalChildren !== 'function' || revealedIds.size === 0) {
    return {
      hierarchy: source.hierarchy,
      isInternal: () => false,
      revealRootIds: EMPTY,
      internalIds: EMPTY,
    };
  }

  /** id -> the internal child ids appended to it. */
  const appended = new Map<string, string[]>();
  /** id -> the node an internal row renders (never re-asked of the adapter,
   *  whose own `node()` would answer with the PROJECTED parent). */
  const internalNodes = new Map<string, EditorNode>();
  const revealRootIds = new Set<string>();

  const walk = (id: string, depth: number): void => {
    if (depth > MAX_DEPTH || appended.has(id)) return;
    const children = source.internalChildren!(id) ?? [];
    if (children.length === 0) return;
    appended.set(
      id,
      children.map((child) => child.id),
    );
    for (const child of children) {
      if (internalNodes.has(child.id)) continue;
      internalNodes.set(child.id, child);
      walk(child.id, depth + 1);
    }
  };

  for (const id of revealedIds) {
    walk(id, 0);
    if (appended.has(id)) revealRootIds.add(id);
  }

  const decorate = (node: EditorNode | null): EditorNode | null => {
    if (!node) return null;
    const extra = appended.get(node.id);
    return extra ? { ...node, childIds: [...node.childIds, ...extra] } : node;
  };

  return {
    hierarchy: {
      roots: () => source.hierarchy.roots().map((root) => decorate(root)!),
      node: (id) => decorate(internalNodes.get(id) ?? source.hierarchy.node(id)),
    },
    isInternal: (id) => internalNodes.has(id),
    revealRootIds,
    internalIds: new Set(internalNodes.keys()),
  };
}

/**
 * H6's first-open policy, applied ON TOP of the panel's own
 * `defaultExpansionByNode` result: **the reveal root's direct children are
 * visible, everything deeper starts folded.**
 *
 * Two overrides express exactly that. The revealed row itself opens (otherwise
 * "Reveal Internals" would appear to do nothing on an instance that happened to
 * be folded), and every internal row starts closed — a rig is 60 rows deep and
 * dumping all of it into the panel is the opposite of the "look inside this one
 * thing" the action is for. Both are DEFAULTS: an explicit fold the author
 * performs afterwards still wins, because the panel consults session and
 * persisted preferences before this map.
 */
export function applyRevealExpansionDefaults(
  defaults: Map<string, boolean>,
  projection: Pick<InternalsProjection, 'revealRootIds' | 'internalIds'>,
): Map<string, boolean> {
  for (const id of projection.internalIds) defaults.set(id, false);
  for (const id of projection.revealRootIds) defaults.set(id, true);
  return defaults;
}
