import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
/**
 * Hierarchy context-menu contribution registry — the escape hatch for
 * first-party-only row actions that are NOT contract-expressible through
 * `StructureProvider`/`InspectorProvider`. `GameHierarchy` (the contract-only
 * shell) calls {@link getHierarchyMenuItems} and appends whatever comes back
 * to its own Rename/Duplicate/Show-Hide/Lock/Delete items — it never branches
 * on WHICH registration fired, keeping Rule Zero intact: the shell still
 * speaks only the `AuthoringAdapter` contract, and only a REGISTRATION module
 * is allowed to reach into store internals.
 *
 * PERMANENT adapter-module contribution seam, the same status as
 * `inspector-section-registry.ts`: first-party affordances that aren't
 * (yet, or ever) contract-expressible register through here instead of the
 * contract-only shell branching on adapter identity. If a given affordance later
 * becomes contract-expressible, its OWN registration is removed at that point —
 * the registry mechanism itself is not temporary. Nothing registers today, and
 * an empty registry is a legitimate state.
 */


export interface HierarchyMenuContext {
  /** The row's node id (an `EditorNode.id` — format-neutral). */
  readonly nodeId: string;
  readonly store: ShellStore;
}

export interface HierarchyMenuItem {
  readonly label: string;
  readonly action: () => void;
  readonly color?: string;
}

type Matcher = (ctx: HierarchyMenuContext) => boolean;
type ItemsFactory = (ctx: HierarchyMenuContext) => HierarchyMenuItem[];

interface Registration {
  readonly match: Matcher;
  readonly items: ItemsFactory;
}

const registrations: Registration[] = [];

/**
 * Register a set of first-party (or other non-contract) hierarchy context-menu
 * items. `match` decides whether this registration applies to a given row;
 * `items` builds the actual entries when it does (called only when `match`
 * returns true). Returns an unregister function.
 */
export function registerHierarchyMenuItems(match: Matcher, items: ItemsFactory): () => void {
  const reg: Registration = { match, items };
  registrations.push(reg);
  return () => {
    const idx = registrations.indexOf(reg);
    if (idx >= 0) registrations.splice(idx, 1);
  };
}

/** Every registered item that applies to `ctx`, in registration order. */
export function getHierarchyMenuItems(ctx: HierarchyMenuContext): HierarchyMenuItem[] {
  return registrations.filter((r) => r.match(ctx)).flatMap((r) => r.items(ctx));
}

/** Test-only reset for module-level menu registrations. */
export function __resetHierarchyMenuRegistryForTest(): void {
  registrations.length = 0;
}
