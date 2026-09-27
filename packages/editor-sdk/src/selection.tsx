/**
 * W3.1 — `useSelection()`, the tool-hooks contract member about the
 * currently-selected ENTITY.
 *
 * Scope, v1:
 *  - INSPECTOR-placement tools only (`placement: 'inspector'`,
 *    `define-tool.ts`). `EditorSelectionProvider` is host plumbing —
 *    `InspectorToolSection` wraps every tool render in it; dock tools
 *    (`ToolHost`/`BottomPanel`) have no adapter/selection in scope and never
 *    get a provider. Calling `useSelection()` there throws a teaching error,
 *    contained by the tool's `ToolErrorBoundary` (the editor survives).
 *  - READ-only. Write through `InspectorProvider.set` (the
 *    existing path), never by mutating what this hook returns. Per-entity
 *    WRITE-from-tool is deferred with `useTunable` (§10).
 *
 * Liveness — two existing paths reused, no new mechanism (§4's "reuse that
 * path" rule):
 *  1. Selection changes: `Inspector.tsx`'s own
 *     `useSyncExternalStore(store.subscribe, store.getSnapshot)` re-renders
 *     the panel, each matched `Section` gets the new `nodeId` prop, and
 *     `InspectorToolSection` re-creates this provider's context value.
 *  2. Edits while the SAME node stays selected: `adapter.subscribe` fires —
 *     this hook keeps a local version counter bumped per notification
 *     (exactly `game-state.tsx`'s `useRootObservation` pattern: the adapter
 *     has no snapshot/version of its own, `subscribe` is fire-only) and
 *     recomputes.
 */

import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

interface SelectionContextValue {
  adapter: AuthoringAdapter;
  nodeId: string | null;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/**
 * EDITOR-side host plumbing: `InspectorToolSection` wraps a tool's rendered
 * `<Component/>` in this, passing the adapter + nodeId it already holds.
 * Project tools never render this themselves — it exists so `useSelection()`
 * has something to read.
 */
export function EditorSelectionProvider({
  adapter,
  nodeId,
  children,
}: {
  adapter: AuthoringAdapter;
  nodeId: string | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ adapter, nodeId }), [adapter, nodeId]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export interface EditorSelection {
  nodeId: string | null;
  node: EditorNode | null;
}

/**
 * The selected entity, live (read-only — see module doc).
 *
 * Throws outside an `EditorSelectionProvider` — inspector tools always render
 * inside one; a dock tool or game-code caller does not, and the error names
 * the fix rather than failing silently.
 */
export function useSelection(): EditorSelection {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error(
      'useSelection: no editor selection in context — this hook only works inside an editor-hosted ' +
        "INSPECTOR tool (placement: 'inspector'). Dock tools and " +
        'game code have no selection to read.',
    );
  }
  const { adapter, nodeId } = ctx;

  // Local version counter bumped per adapter notification — the adapter has
  // no snapshot/version of its own, `subscribe` is fire-only (same pattern
  // as `useRootObservation`'s `versionRef`, game-state.tsx).
  const versionRef = useRef(0);
  const version = useSyncExternalStore(
    (onStoreChange) =>
      adapter.subscribe?.(() => {
        versionRef.current++;
        onStoreChange();
      }) ?? (() => {}),
    () => versionRef.current,
  );

  return useMemo(() => {
    const node = nodeId ? adapter.hierarchy.node(nodeId) : null;
    return { nodeId, node };
    // `version` has no value of its own — only its CHANGE matters, as the
    // liveness signal described above.
  }, [adapter, nodeId, version]);
}
