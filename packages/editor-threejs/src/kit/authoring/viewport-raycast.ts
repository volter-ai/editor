/**
 * Shared three viewport raycast pick (B4, D12) — the adapter-AGNOSTIC
 * entity-under-the-pointer raycast, extracted verbatim from
 * `editor-viewport.ts`'s former `_raycastEntity` so EVERY threejs-backed
 * authoring adapter whose live objects sit in `store.objectMap` reuses the
 * exact same logic:
 *   - first-party `VgaiSceneAuthoringAdapter` (edit mode's focused world),
 *   - `ThreeAuthoringAdapter` (any live three tree — bare ingest
 *     mode AND the three child of a multi-world PLAY composite).
 *
 * Pre-B4, `_onPointerUp` ran this raycast UNCONDITIONALLY against
 * `store.objectMap` regardless of which adapter was active, so an ingest/
 * multi-world-play canvas click selected the object under the pointer. B4's
 * `pickTopmost` routes through the active adapter's `pickable` instead, so
 * that behavior only survives if each three adapter exposes a `pickable`
 * backed by THIS helper (the raycast depends
 * only on native Object3Ds plus the active adapter's object→id answer. The
 * default still reads `store.objectMap` and entity stamps for first-party
 * callers; foreign adapters inject their projection without mutating it.
 *
 * The camera/canvas live only on `EditorViewport`, reached through the
 * `viewport-pick-context.ts` seam (its ctor/`dispose()` set/clear it). Absent
 * (a headless unit test, or no live viewport mounted) ⇒ `null`, an honest
 * degrade rather than a throw. Uses its OWN `THREE.Raycaster` with
 * `layers.enableAll()` replicated so it hits gizmo-adjacent EDITOR_LAYER-tagged
 * geometry exactly like the original.
 */

import { isInEditorOwnedSubtree } from '@volter/editor-threejs/viewport/editor-layers';
import * as THREE from 'three';
import type { EditorShellStore } from '../editor-shell-store';
import { entityIdOf, nearestEntityObject } from '../entity-object';
import { getViewportPickContext } from './viewport-pick-context';

function isBackdropMaterial(material: THREE.Material): boolean {
  return material.depthWrite === false && material.side === THREE.BackSide;
}

/**
 * Is this object the scene's BACKDROP rather than a thing in it?
 *
 * A sky dome / environment shell is painted behind everything
 * (`depthWrite: false`) and is only visible from INSIDE (`side: BackSide`).
 * Both flags are authored by the game itself, so this is the idiom read as
 * DATA — no name list, no per-project rule.
 *
 * Why picking must skip it: such a mesh ENCLOSES the camera, so every ray
 * eventually reaches it and the pick can never miss. Measured live
 * (2026-08-06, `examples/third-person`): all 64 points of an 8×8 grid over the
 * canvas returned a hit, the top-left "empty sky" among them, which is why
 * clicking empty space never cleared the selection — `_onPointerUp`'s
 * `selection.set([])` branch was simply unreachable in any scene with a sky.
 * A ray that reaches the backdrop has passed through every real thing in the
 * scene; that is a MISS, and the surface's no-selection subject is the honest
 * answer. The backdrop stays selectable from the hierarchy, where it is a row
 * like any other.
 */
export function isBackdropObject(object: THREE.Object3D): boolean {
  const material = (object as Partial<THREE.Mesh>).material;
  if (!material) return false;
  return Array.isArray(material)
    ? material.length > 0 && material.every(isBackdropMaterial)
    : isBackdropMaterial(material);
}

/** Raycast `store.objectMap` and return the entity id under `(clientX,
 *  clientY)`, or `null`. Skips editor-helper geometry, and skips ids `isLocked`
 *  rejects — identical to the pre-B4 viewport raycast.
 *
 *  `isLocked` is INJECTED rather than read off the store because "locked" is a
 *  per-format notion: an adapter with a lock concept supplies its own check
 *  (own flag OR any ancestor's — richer than what a generic
 *  `inspector.get(id,'locked')` reproduces), while every live/foreign adapter
 *  has no lock concept and omits it. */
export function raycastCandidates(
  store: EditorShellStore,
  clientX: number,
  clientY: number,
  isLocked: (id: string) => boolean = () => false,
  projection?: {
    readonly objects: Iterable<THREE.Object3D>;
    readonly idForObject3D: (object: THREE.Object3D) => string | null;
  },
): string[] {
  const ctx = getViewportPickContext();
  if (!ctx) return []; // no live viewport mounted — honest degrade
  const rect = ctx.canvas.getBoundingClientRect();
  // Chrome and other panes are not part of this viewport. Coverage also asks
  // about (0,0); previously that off-canvas query still skinned/raycast the
  // entire world twice after an interaction.
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    clientX < rect.left ||
    clientY < rect.top ||
    clientX >= rect.left + rect.width ||
    clientY >= rect.top + rect.height
  )
    return [];
  const mouse = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enableAll();
  raycaster.setFromCamera(mouse, ctx.camera);

  const indexed = new Set(projection?.objects ?? store.objectMap.values());
  // intersectObjects(..., true) already visits descendants. Passing both a
  // parent and each indexed child repeatedly intersects the same geometry.
  const entityObjects = [...indexed].filter((object) => {
    for (let parent = object.parent; parent; parent = parent.parent) {
      if (indexed.has(parent)) return false;
    }
    return true;
  });

  // A SkinnedMesh with CACHED mesh-level bounds is a poisoned pick target:
  // `SkinnedMesh.raycast` gates on `this.boundingBox`/`boundingSphere`, and a
  // cache computed through the CPU skinning path carries bone-world
  // contamination on the humanoid rigs — the gate then misses the localized
  // ray forever and every click falls through the character (measured live:
  // 0 triangle hits with the cache present, 8 with it cleared, same ray, same
  // mesh). Clearing here immunizes the pick against every planter; the
  // raycast recomputes what it needs, and the framing walk no longer consumes
  // mesh-level skinned bounds at all (`content-bounds.ts`).
  for (const root of entityObjects) {
    root.traverse((node) => {
      // Structural write: three's own `SkinnedMesh` fields hold `Box3 | null`
      // at runtime (`null` = "compute on demand"), the published type just
      // does not admit the null it initializes with.
      const skinned = node as unknown as {
        isSkinnedMesh?: boolean;
        boundingBox: unknown;
        boundingSphere: unknown;
      };
      if (skinned.isSkinnedMesh) {
        skinned.boundingBox = null;
        skinned.boundingSphere = null;
      }
    });
  }

  const intersects = raycaster.intersectObjects(entityObjects, true);
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const isect of intersects) {
    // Skip every form of editor-owned geometry. TransformControls marks its
    // invisible interaction plane only with EDITOR_LAYER; other helpers use
    // userData flags. Checking the shared predicate prevents either form from
    // becoming the selected "entity" while still allowing the ray to fall
    // through to game content behind it.
    if (isInEditorOwnedSubtree(isect.object)) continue;

    // The scene's backdrop is not a thing under the pointer — see
    // {@link isBackdropObject}. Skipping it is what lets a click on empty sky
    // be a MISS, which is what clears the selection.
    if (isBackdropObject(isect.object)) continue;

    // Walk up to find the projected authoring node. A foreign adapter answers
    // from its own reverse map; the default keeps the established stamp-based
    // first-party behavior.
    let cursor: THREE.Object3D | null = isect.object;
    let eid: string | null = null;
    if (projection) {
      while (cursor && eid === null) {
        eid = projection.idForObject3D(cursor);
        cursor = cursor.parent;
      }
    } else {
      const hit = nearestEntityObject(cursor);
      eid = hit ? (entityIdOf(hit) ?? null) : null;
    }
    // Skip locked entities in viewport selection.
    if (eid !== null && !isLocked(eid) && !seen.has(eid)) {
      seen.add(eid);
      hits.push(eid);
    }
  }
  reportEmptyPick(hits, entityObjects, intersects.length, clientX, clientY);
  return hits;
}

/**
 * A CLICK THAT SELECTS NOTHING SAYS WHY — and only then.
 *
 * Repeated instances of one component are reported unselectable in the
 * viewport while the HIERARCHY addresses every one of them fine (runhuman
 * passes 100/109/110/111: "in order to move the one previous, I need to click
 * it from the hierarchy"). Identity is not the cause — a reproduction over
 * `sourceOidIdentity` mints distinct ids AND distinct stamps for four renders
 * of one definition element — so the failure is somewhere in this walk, and
 * the three numbers below separate its three possible causes:
 *
 *  - `candidates: 0` — the object never reached `store.objectMap`;
 *  - `candidates: N, rayHits: 0` — it is in the map but the ray missed it
 *    (stale transform, detached subtree, wrong scene);
 *  - `rayHits: N, ids: 0` — it was hit but every hit was filtered as editor
 *    furniture/backdrop, or carried no stamp to resolve.
 *
 * Silent on every click that DOES select something, so an ordinary session
 * never sees it.
 */
function reportEmptyPick(
  hits: readonly string[],
  candidates: readonly THREE.Object3D[],
  rayHits: number,
  clientX: number,
  clientY: number,
): void {
  if (hits.length > 0) return;
  // The coverage CONFORMANCE PROBE exercises `editor.pickable.pick(0, 0)` on
  // a timer to audit the seam's shape (`coverage/authoring-seam-evidence`,
  // source: "conformance-probe") — twice every ~5s in a live session,
  // measured by stack capture. (0,0) is over the app chrome, never a real
  // viewport click, so the probe's synthetic misses must not narrate as user
  // clicks that selected nothing.
  if (clientX === 0 && clientY === 0) return;
  // biome-ignore lint/suspicious/noConsole: diagnostic breadcrumb, same channel as the editor's other timing/stall notes
  console.info(
    `[viewport-pick] click selected nothing (candidates ${candidates.length}, ` +
      `rayHits ${rayHits}, resolvedIds 0)`,
  );
}

/** Frontmost authorable subject under the pointer. */
export function raycastPick(
  store: EditorShellStore,
  clientX: number,
  clientY: number,
  isLocked: (id: string) => boolean = () => false,
  projection?: {
    readonly objects: Iterable<THREE.Object3D>;
    readonly idForObject3D: (object: THREE.Object3D) => string | null;
  },
): string | null {
  return raycastCandidates(store, clientX, clientY, isLocked, projection)[0] ?? null;
}
