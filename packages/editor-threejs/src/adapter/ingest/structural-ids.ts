/**
 * Structural identity — the deterministic id scheme (and the small material
 * reflection helper that rides along with it) the editor's three authoring
 * adapter uses to address the objects of a world whose source carries no
 * serve-time identity stamps
 * (`packages/editor/src/projection/three.ts`, `structuralIdentity`).
 *
 * Identity: each object gets a **structural-path id** — deterministic from the
 * scene's shape (position in the tree + three.js type + name), so the SAME id
 * re-binds to the SAME object after the game rebuilds its scene within a
 * session. The pure walk returns that identity beside the native objects; the
 * editor keeps the reverse lookup in its authoring adapter rather than writing
 * editor currency into a foreign graph.
 *
 * This module used to be the shared core of a per-game JSON sidecar
 * persistence system, which was deleted outright (2026-08-02) — ingest edits
 * are LIVE-ONLY now. The id scheme survives because it is what makes the live
 * hierarchy/selection/inspector work at all; nothing here reads or writes a
 * file.
 */

import type * as THREE from 'three';
import { setUserData } from '../../ecs/user-data';

/** Fixed id for the captured render camera (not a scene child, so no structural path). */
export const CAMERA_ID = 'ingest:camera';

/**
 * The editor parks its OWN objects — grid, its two lights, the particle
 * BatchedRenderer, every TransformControls/gizmo helper — on layer 31
 * (`@vgai/threejs/viewport/editor-layers`'s `EDITOR_LAYER`) so the game camera
 * never sees them. On an ingest root those objects are added to the GAME'S OWN
 * scene, which is the same tree this walk indexes.
 */
const EDITOR_ONLY_LAYER_MASK = 1 << 31;

/**
 * Editor furniture, not game content. Excluded from the walk entirely — see
 * {@link collectStructuralIds} for why that exclusion is what makes the id
 * scheme's central promise true.
 */
function isEditorOnly(o: THREE.Object3D): boolean {
  return (o.layers.mask & EDITOR_ONLY_LAYER_MASK) !== 0;
}

/**
 * The material whose colour a mesh's swatch reflects, if it has one.
 *
 * A multi-material mesh reflects its FIRST slot — that is what a single swatch
 * can honestly stand for, and it is also the slot a creation-site anchor for
 * `material.color` resolves against. Returns `null` for anything with no
 * `color` at all rather than fabricating one.
 */
export function colorMaterialOf(o: THREE.Object3D): THREE.MeshStandardMaterial | null {
  const mat = (o as THREE.Mesh).material;
  if (!mat) return null;
  const m = (Array.isArray(mat) ? mat[0] : mat) as THREE.MeshStandardMaterial | undefined;
  return m?.color ? m : null;
}

/** Result of a structural-path walk: the id→object map plus a few reflection stats. */
export interface StructuralIdWalk {
  byId: Map<string, THREE.Object3D>;
  count: number;
  meshes: number;
  lights: number;
}

/**
 * (Re)collect structural-path ids for every object under `scene` (and, if
 * given, the separately-captured render `camera`, under the fixed
 * {@link CAMERA_ID}). Idempotent and deterministic from scene structure
 * (position + type + name) — so a re-walk after the game rebuilds part of its
 * tree re-binds the same ids to the same objects.
 *
 * EDITOR FURNITURE IS EXCLUDED, and that exclusion is load-bearing rather than
 * cosmetic. On an ingest root the editor adds its grid, lights, particle
 * BatchedRenderer and TransformControls gizmo to the GAME'S OWN scene, and
 * they arrive asynchronously — some before the walk, some after. Indexing them
 * made a game object's path depend on how much editor furniture happened to be
 * attached at walk time, so the same mesh changed id across a re-walk (observed
 * in the games-fps ingest: an object addressed as `ingest:106/0/0/0:…` came
 * back as `ingest:102/0:Mesh:Cube004` — four root slots earlier, exactly the
 * grid + two editor lights + BatchedRenderer).
 *
 * Skipping the furniture entirely — not merely declining to give it an id —
 * is what fixes that: the game's own children occupy 0..N-1 whatever else is
 * parented alongside them. It also keeps gizmo handles and the grid out of the
 * hierarchy/inspector projections built on this walk, where they were
 * selectable and colorable as if they were game content.
 */
export function collectStructuralIds(
  scene: THREE.Object3D,
  camera?: THREE.Object3D | undefined,
): StructuralIdWalk {
  const byId = new Map<string, THREE.Object3D>();
  let count = 0;
  let meshes = 0;
  let lights = 0;
  const visit = (
    o: THREE.Object3D & { isMesh?: boolean; isLight?: boolean },
    path: string,
  ): void => {
    const id = `ingest:${path}:${o.type}:${o.name || ''}`;
    byId.set(id, o);
    count++;
    if (o.isLight) lights++;
    else if (o.isMesh) meshes++;
    visitChildren(o, path);
  };
  const visitChildren = (o: THREE.Object3D, path: string): void => {
    let i = 0;
    for (const c of o.children) {
      if (isEditorOnly(c)) continue;
      visit(c, path ? `${path}/${i}` : `${i}`);
      i++;
    }
  };
  visitChildren(scene, '');
  if (camera) {
    byId.set(CAMERA_ID, camera);
    count++;
  }
  return { byId, count, meshes, lights };
}

/**
 * Compatibility entry point for first-party callers that explicitly want
 * structural ids stamped into their own graph. Foreign ingest authoring uses
 * {@link collectStructuralIds} and never calls this mutating form.
 */
export function assignStructuralIds(
  scene: THREE.Object3D,
  camera?: THREE.Object3D | undefined,
): StructuralIdWalk {
  const walk = collectStructuralIds(scene, camera);
  for (const [id, object] of walk.byId) setUserData(object, 'entityId', id);
  return walk;
}
