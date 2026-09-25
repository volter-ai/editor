/**
 * Which declared world is the Three root this viewport paints, read from the composite's
 * manifest kinds and capabilities only (no scene, no renderer), so kit panels can ask without
 * importing the viewport.
 */
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import { isRootHidden } from '@volter/editor-sdk/kit/authoring/world-session-state';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { getActiveAuthoring } from './active-adapter';

/**
 * The worldId of the ONE three world actually rendered in this viewport
 * (`store.objectMap`'s contents), or `null` when the active adapter isn't a
 * composite (single-world project — no world-group row/eye exists for it at
 * all, so there is nothing to resolve) or declares no three world.
 *
 * Identifies the LIVE Three child by `capabilities.transform` — a transient
 * Boundary adapter reports no transform capability until the R3F design
 * session attaches. This reuses an existing, already-load-bearing signal
 * instead of adding an `instanceof` check or parallel bookkeeping slot.
 */
export function resolveThreeViewportRootId(store: ShellStore): string | null {
  const active = getActiveAuthoring(store);
  if (!(active instanceof CompositeAuthoringAdapter)) return null;
  const focused = active
    .childAdapters()
    .find((c) => c.kind === 'three' && c.adapter.capabilities.transform);
  return focused?.worldId ?? null;
}

/**
 * Is a three surface currently SHOWING in the viewport? This is the single
 * derived truth the 3D viewport chrome gates on (spec 28): the grid,
 * orientation gizmo, transform toolstrip, camera readout, shading modes, and
 * the transform gizmo itself are claims about what the user can do RIGHT NOW
 * — showing them over a viewport with no visible 3D content is a false claim
 * (same spirit as the adapter-reach rule: report what isn't there, never
 * advertise it). The DOM half of the chrome (`RootSelectionOverlay`)
 * already self-gates this way; this selector brings the pre-contract 3D
 * chrome under the same rule.
 *
 * Truth table (deliberately conservative — every non-composite mode keeps
 * today's behavior exactly):
 *  - active adapter is not a composite (single-world project, ingest):
 *    `true` — no world-group eyes exist there, so there is nothing to derive
 *    from.
 *  - composite with NO threejs-kind child at all (e.g. react-only
 *    multi-world manifest): `false` — no 3D content can EVER show.
 *  - composite whose three child is still a read-only Boundary
 *    (`resolveThreeViewportRootId` → null): `true` — this is reachable
 *    transiently while the R3F design session attaches; keep the chrome rather
 *    than flickering it around adapter-install timing.
 *  - composite with a live three world: `!isRootHidden(worldId)`
 *    — the eye is the "what we're showing" signal.
 *
 * Recompute-per-call like everything else in this module: callers read it on
 * every store notify (`syncFromStore` / `the world root's stage` render), never cache
 * it across notifies.
 */
export function isThreejsSurfaceVisible(store: ShellStore): boolean {
  const active = getActiveAuthoring(store);
  if (!(active instanceof CompositeAuthoringAdapter)) return true;
  const children = active.childAdapters();
  if (!children.some((c) => c.kind === 'three')) return false;
  const threeRootId = resolveThreeViewportRootId(store);
  return threeRootId === null ? true : !isRootHidden(threeRootId);
}
