/**
 * H3 wiring — the instance row's two source actions, registered through the
 * hierarchy contribution seam.
 *
 * This is the "adapter-module registration" half of the split
 * `hierarchy-menu-registry.ts` describes: `GameHierarchy` stays contract-only
 * and never learns that an R3F world has a callsite; THIS module is the one
 * allowed to resolve the owning child adapter and probe it for source
 * accessors. The sentences and the applicability rule are pure and live in
 * `../instance-source-actions.ts`.
 *
 * ISOLATE IS DELIBERATELY ABSENT — see {@link enterInstanceRow}. The design
 * record's "double-click = Isolate, reusing the catalog nodes' existing Isolate
 * mount" is not reachable from a scene instance row, and faking it was
 * explicitly out of scope.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { EditorShellStore } from '../editor-shell-store';
import { registerHierarchyMenuItems } from '../hierarchy-menu-registry';
import {
  INSTANCE_SOURCE_LABELS,
  type InstanceSourceLocator,
  type InstanceSourceTarget,
  instanceSourceTargets,
  runInstanceSourceAction,
} from '../instance-source-actions';
import { showTransientHint } from '../transient-hint';
import { getActiveAuthoring } from './active-adapter';
import { CompositeAuthoringAdapter } from './composite-authoring-adapter';
import { enterSelectionScope } from './selection-scope';

/**
 * The adapter whose source accessors answer for `nodeId`. Ownership is asked
 * of the composite (`ownerOf`/`childAdapters`, the same public T0 query
 * `GameHierarchy`'s own gates use) rather than decoded from the id — a
 * composite's routers would otherwise answer for a row their owning child
 * knows nothing about.
 */
export function instanceSourceLocatorFor(
  adapter: AuthoringAdapter,
  nodeId: string,
): InstanceSourceLocator | null {
  const owner =
    adapter instanceof CompositeAuthoringAdapter
      ? (adapter.childAdapters().find((c) => c.worldId === adapter.ownerOf(nodeId))?.adapter ??
        adapter)
      : adapter;
  const locator = owner as unknown as InstanceSourceLocator;
  return typeof locator.sourceLocation === 'function' ||
    typeof locator.definitionLocation === 'function'
    ? locator
    : null;
}

/** Run one target and SAY what happened — every path returns a sentence
 *  (copied / not in the index / clipboard refused), so no click is silent. */
function runAndReport(
  locator: InstanceSourceLocator | null,
  nodeId: string,
  target: InstanceSourceTarget,
): void {
  void runInstanceSourceAction(locator, nodeId, target).then(showTransientHint);
}

/**
 * Double-click on an instance row.
 *
 * An instance row is already the native authoring subject; portable CSF
 * selects complete design-time states and does not provide a second subtree
 * isolation protocol. Double-click therefore ENTERS the instance's scope and
 * falls back to its callsite when the row cannot be entered.
 *
 * That fallback is the COMMON case, not the corner one: `projectedChildren`
 * collapses everything an instance rendered itself (same `authoringInstance`),
 * so an instance row has children only when it contains a NESTED instance.
 * Every other instance row is a hierarchy leaf, `enterSelectionScope` refuses
 * it for having no children, and until now that double-click did nothing at
 * all — the silent no-op this whole decision exists to kill.
 *
 * Rename is NOT in conflict: `Row`'s `onDoubleClick` already routes every
 * `component`/`instance`/`boundary` row here BEFORE its rename branch, so an
 * instance row has never started a rename on double-click; rename stays
 * reachable on the context menu, where it is always offered for a non-group row.
 */
export function enterInstanceRow(adapter: AuthoringAdapter, nodeId: string): void {
  if (enterSelectionScope(adapter, nodeId)) return;
  runCallsite(adapter, nodeId);
}

function runCallsite(adapter: AuthoringAdapter, nodeId: string): void {
  const node = adapter.hierarchy.node(nodeId);
  const locator = instanceSourceLocatorFor(adapter, nodeId);
  // Only a row that ADVERTISES a callsite falls through to the source action —
  // a boundary/placeholder row with nothing to open keeps double-clicking to
  // nothing, exactly as before, rather than raising a hint the user did not ask
  // for by picking a source verb.
  if (!instanceSourceTargets(node, locator, nodeId).includes('callsite')) return;
  runAndReport(locator, nodeId, 'callsite');
}

let unregister: (() => void) | null = null;

/** Idempotent install of the two H3 items (see the register module). */
export function ensureInstanceSourceMenuRegistered(): void {
  if (unregister) return;
  unregister = registerHierarchyMenuItems(
    ({ nodeId, store }) => targetsFor(store, nodeId).length > 0,
    ({ nodeId, store }) => {
      const adapter = getActiveAuthoring(store);
      const locator = instanceSourceLocatorFor(adapter, nodeId);
      return targetsFor(store, nodeId).map((target) => ({
        label: INSTANCE_SOURCE_LABELS[target],
        action: () => {
          runAndReport(locator, nodeId, target);
        },
      }));
    },
  );
}

function targetsFor(store: EditorShellStore, nodeId: string): InstanceSourceTarget[] {
  const adapter = getActiveAuthoring(store);
  return instanceSourceTargets(
    adapter.hierarchy.node(nodeId),
    instanceSourceLocatorFor(adapter, nodeId),
    nodeId,
  );
}

/** Test-only: drop the registration so a suite can reset the shared registry. */
export function __unregisterInstanceSourceMenuForTest(): void {
  unregister?.();
  unregister = null;
}
