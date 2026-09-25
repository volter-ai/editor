/**
 * World-hidden eye (D9, `world-session-state.ts`) applied to the EDIT-mode
 * three viewport.
 *
 * Bug this fixes: the eye on a hierarchy world-group row (`world:<id>
 * (<kind>)`, shown for 2+ world manifests) toggles `isRootHidden(worldId)`
 * and culls the hierarchy subtree, but for a react/pixi world that's ALSO the
 * only thing that mattered — `design-time-layers.ts`'s `applySessionStyle`
 * sets `display:none` on that world's DOM layer. A three world has no DOM
 * layer; nothing else consumes `isRootHidden` for its actual
 * `THREE.Object3D`s, so without this module the eye is a viewport no-op.
 *
 * Session-local only — it writes no file and pushes no undo entry, matching
 * the DOM roots' own `display:none` semantics. Every call RECOMPUTES
 * `obj.visible` rather than remembering a previous value, which is what makes
 * it rebuild-proof: an adapter that re-renders its tree re-stamps
 * `obj.visible` from its own truth and would silently drop a one-shot
 * override, but the very next call here puts the world-hidden override back.
 * Callers must re-invoke this after every rebuild
 * AND after the toggle itself; `editor-viewport.ts`'s `syncFromStore()` is
 * exactly that seam — it already re-runs on every `store.subscribe` notify,
 * which covers both an adapter rebuild (which notifies) and
 * `GameHierarchy.tsx`'s toggle handler (`toggleRootHidden` +
 * `store.notifyIngestEdit()`).
 *
 * A composite's `store.objectMap`/live THREE.Scene holds the manifest's sole
 * three content root. `GameManifestSchema` rejects a second content root of
 * the same medium, so `resolveThreeViewportRootId` below only needs to name
 * that one world id rather than arbitrate per-object ownership.
 */

import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import * as THREE from 'three';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { getActiveAuthoring } from './active-adapter';
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import { isRootHidden } from '@volter/editor-sdk/kit/authoring/world-session-state';

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
 * Apply the eye toggle to every object in `objectMap` (see module doc
 * comment for the full rebuild-proofing rationale). `threeRootId` is
 * accepted as a parameter (rather than re-resolved internally) so a caller
 * that already computed it once per call (e.g. for a cheap re-apply
 * signature) doesn't pay for `resolveThreeViewportRootId`'s composite walk
 * twice.
 */
export function applyRootHiddenVisibility(
  objectMap: ReadonlyMap<string, THREE.Object3D>,
  threeRootId: string | null,
): void {
  const hidden = threeRootId !== null && isRootHidden(threeRootId);
  if (!hidden) return;
  // The live `Object3D.visible` IS the authored truth, so the SHOW edge has
  // nothing to restore FROM — the adapter re-renders its own tree there.
  // Hiding wins over everything: nothing in a hidden world renders.
  for (const obj of objectMap.values()) obj.visible = false;
}

/**
 * The background an editor viewport with NO authored environment shows. A
 * single shared instance so the per-notify re-apply below never allocates.
 */
const HIDDEN_WORLD_BACKGROUND = new THREE.Color('#aaaaaa');

/**
 * The scene-level half of the eye: `applyRootHiddenVisibility` above only
 * covers entity `Object3D`s (the `objectMap`), but a three world also
 * renders things that live directly on the `THREE.Scene` — the authored
 * `background` color/skybox, `fog`, IBL `environment`, and the
 * `envObject`-tagged ambient light `applyEnvironment` adds. None of those are
 * entities, so without this function hiding the world leaves the viewport
 * painted in the world's background color — looking exactly like "the eye
 * didn't work".
 *
 * Same recompute-don't-remember contract as above: this only ever writes the
 * SUPPRESSED state, idempotently, and callers invoke it on every notify while
 * the world is hidden (an inspector environment edit mid-hide re-paints the
 * authored values via `_applyEnvironment` — the very next notify re-suppresses
 * them here). The restore path is `ShellStore.reapplyEnvironment()`, whose
 * truth is `_sceneMeta.environment` — never a snapshot taken here.
 *
 * Post-processing (bloom/vignette) is the composer's half: `the world root's stage`'s
 * `rebuildComposer` passes `undefined` instead of `store.environment` while
 * the world is hidden; `editor-viewport.ts` bumps `composerVersion` (via
 * `reapplyEnvironment`) on both hide/show edges so that rebuild actually runs.
 */
export function suppressRootEnvironment(scene: THREE.Scene): void {
  scene.background = HIDDEN_WORLD_BACKGROUND;
  scene.fog = null;
  scene.environment = null;
  scene.traverse((obj) => {
    if (getUserData(obj, 'envObject')) obj.visible = false;
  });
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
