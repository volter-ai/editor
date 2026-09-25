/**
 * World session state (B1) — a module-level subscribable singleton (same shape as
 * `./mount-failure-report.ts`: a bare get/set slot, no subscribe of its own — every
 * caller that mutates it follows up with `store.notifyIngestEdit()`, which every
 * panel already re-renders off via `useSyncExternalStore(store.subscribe, …)`)
 * holding THREE session-local, per-worldId toggles that are NEVER
 * serialized/persisted (D9: "eye = session-local viewport visibility, never
 * serialized" — generalized here to all three, none of which is an authored
 * property):
 *
 *  - `hidden` — the eye (A2/D9). LIFTED out of `GameHierarchy.tsx`'s former
 *    local `useState<Set<string>> hiddenRootIds` (module-private React state
 *    the design-time layer stack could never see) so `design-time-layers.ts`
 *    can hide/show a world's actual DOM layer, not just dim its hierarchy row.
 *  - `interactive` — forwards real pointer events to the layer (for testing
 *    hover/press states at design time); off by default (`pointer-events:none`
 *    is the layer's resting state — see `design-time-layers.ts`).
 *  - `pickLock` — stored here for B4 to consume (layered viewport picking,
 *    D12): a pick-locked layer is skipped by the topmost-first pick walk.
 *    B1 only stores/exposes the toggle; nothing reads it yet.
 *
 * Keyed by the RAW manifest world id (`CompositeChild.worldId` /
 * `ResolvedAdapterRoot.id`) — the SAME id `design-time-layers.ts` gets from
 * `composite.childAdapters()`, NOT the composite's synthetic `world:<id>`
 * group-node id. `GameHierarchy.tsx` (whose rows ARE keyed by the group-node
 * id) resolves the raw worldId via `compositeGroupBadge`'s `worldId` field
 * before calling into this module — see that file's row component.
 *
 * A process-lifetime singleton (not project-scoped): switching projects
 * within the same tab does not reset these toggles. That's a deliberate
 * relaxation of the former per-mount-React-state behavior (which reset on
 * every `GameHierarchy` remount) — "session-local" here means "this browser
 * tab's session", matching D9's own framing; nothing depends on a
 * project-switch reset.
 */

export interface RootSessionState {
  readonly hidden: boolean;
  readonly interactive: boolean;
  readonly pickLock: boolean;
}

const DEFAULT_STATE: RootSessionState = { hidden: false, interactive: false, pickLock: false };

const _states = new Map<string, RootSessionState>();

function get(worldId: string): RootSessionState {
  return _states.get(worldId) ?? DEFAULT_STATE;
}

function patch(worldId: string, partial: Partial<RootSessionState>): void {
  _states.set(worldId, { ...get(worldId), ...partial });
}

/** The eye (A2/D9): true while `worldId`'s design-time layer is hidden. */
export function isRootHidden(worldId: string): boolean {
  return get(worldId).hidden;
}

export function setRootHidden(worldId: string, hidden: boolean): void {
  patch(worldId, { hidden });
}

export function toggleRootHidden(worldId: string): void {
  setRootHidden(worldId, !isRootHidden(worldId));
}

/** True while `worldId`'s layer forwards real pointer events (design-time
 *  hover/press testing) instead of its resting `pointer-events:none`. */
export function isRootInteractive(worldId: string): boolean {
  return get(worldId).interactive;
}

export function setRootInteractive(worldId: string, interactive: boolean): void {
  patch(worldId, { interactive });
}

export function toggleRootInteractive(worldId: string): void {
  setRootInteractive(worldId, !isRootInteractive(worldId));
}

/** B4 will read this to skip a layer in the topmost-first pick walk; B1 only
 *  stores/exposes the toggle. */
export function isRootPickLocked(worldId: string): boolean {
  return get(worldId).pickLock;
}

export function setRootPickLock(worldId: string, pickLock: boolean): void {
  patch(worldId, { pickLock });
}

export function toggleRootPickLock(worldId: string): void {
  setRootPickLock(worldId, !isRootPickLocked(worldId));
}

/** Test-only: drop every world's session state back to defaults so unit
 *  tests don't leak toggles across cases (this module is a process-lifetime
 *  singleton — see the header comment). */
export function _resetRootSessionStateForTest(): void {
  _states.clear();
}
