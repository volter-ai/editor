/**
 * The navmesh tool's OWN state: whether a session navmesh is baked and
 * whether a bake is in flight.
 *
 * This is one tool's workflow state, and it lived in `EditorShellStore`
 * alongside selection, the adoption stack and play state — where every one of
 * its writes notified every subscriber in the editor, and the format-neutral
 * store named a navmesh probe. The store holds what the whole shell shares; a
 * tool holds its own, beside itself (`navmesh-handler.ts` is the tool).
 *
 * Module state, `useSyncExternalStore` shape (`subscribeNavWorkflow` +
 * `navWorkflowVersion`) — the same shape `authoring/active-adapter.ts` uses.
 */

let _baked = false;
/** Bake busy state (the Debug-menu items' honest progress gate: recast's solo
 *  bake is synchronous WASM). */
let _busy = false;
const _listeners = new Set<() => void>();
let _version = 0;

function notify(): void {
  _version++;
  for (const listener of [..._listeners]) listener();
}

/** Subscribe to navmesh-workflow changes (`useSyncExternalStore` shape). */
export function subscribeNavWorkflow(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Monotonic version (`useSyncExternalStore` snapshot). */
export function navWorkflowVersion(): number {
  return _version;
}

/** `true` once a session navmesh has been baked (reset by Clear) — read by the
 *  Debug menu's NavMesh items to reflect baked / not-baked. */
export function navMeshBaked(): boolean {
  return _baked;
}

export function markNavMeshBaked(): void {
  if (_baked) return;
  _baked = true;
  notify();
}

/** Clear the baked flag — the Clear action removed the session mesh, so the
 *  menu items must stop reading as "Baked". */
export function resetNavMeshBaked(): void {
  if (!_baked) return;
  _baked = false;
  notify();
}

export function navBakeBusy(): boolean {
  return _busy;
}

/** Enter the baking busy state (the Debug-menu items disable on it). */
export function beginNavBake(): void {
  _busy = true;
  notify();
}

/** Leave the busy state; `error === null` marks the bake successful. The error
 *  TEXT is not stored — surfacing it loudly is the caller's job
 *  (`navmesh-handler.ts` emits every failure to the editor console), and a
 *  stored copy with no reader is what the schema-reader policy forbids. */
export function endNavBake(error: string | null): void {
  _busy = false;
  if (error === null) _baked = true;
  notify();
}
