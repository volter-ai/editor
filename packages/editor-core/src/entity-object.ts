/**
 * One answer to "which live `Object3D` is this entity id?", for every editor
 * surface that needs one.
 *
 * There are TWO places an id can resolve, and neither is a superset of the
 * other. The ACTIVE ADAPTER's `hierarchy.object3D` is authoritative: a
 * source-backed component may select one identity and render its transform on a
 * child, and an ADOPTED live scene (play mode) is walked by the adapter, so its
 * ids exist there and nowhere else. `EditorShellStore.objectMap` is the shell's
 * own map, which the adapter's answer falls back to.
 *
 * Asking only the store is how `editor.frame(id)` came to refuse an entity the
 * same session had just selected and drawn a cage around. Measured live
 * (2026-08-14, the translated platformer in play mode): `editor.status()`
 * listed `r3f:world:o4a7fjmzo`, `editor.select` on it put a bracket cage on the
 * coin — and `editor.frame` on that same id answered
 * `Entity not found: r3f:world:o4a7fjmzo`, because the adopted play scene's
 * nodes live in the adapter's walk and not in `objectMap`. A verb's EXISTENCE
 * CHECK has to be the resolver its ACTION uses, or the refusal is about a
 * different question than the one asked.
 *
 * ## The REVERSE direction lives here too, and that is the point
 *
 * `userData.entityId` is the stamp an adapter's walk writes when it ADMITS an
 * object as an authoring node (`projection/three.ts`,
 * `R3fSourceAuthoringAdapter.indexGraph`). Reading that stamp is the node → id
 * half of the very same question `entityObject3D` answers id → node, so both
 * halves are spelled once, here — and the surfaces that used to reach for
 * `getUserData(object, 'entityId')` themselves (the viewport gizmo and its
 * surface-snap, the raycast climb, the store's adoption index, the LOD walk)
 * ask this module instead.
 *
 * Presence of the stamp is also the ADMISSION answer: an object the walk
 * skipped (an editor helper, a library-built internal folded into its owner)
 * carries none, which is exactly what {@link isEntityObject} and
 * {@link nearestEntityObject} read. Do not re-derive that from a type test, a
 * name convention or a layer — those disagree with the walk, and a surface that
 * disagrees with the walk is the "one id, three answers" defect.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { getUserData, setUserData } from '@volter/editor-threejs/ecs/user-data';
import type * as THREE from 'three';

/** The live object `id` names, or `null` when nothing in this session answers to it. */
export function entityObject3D(
  adapter: AuthoringAdapter,
  objectMap: ReadonlyMap<string, THREE.Object3D>,
  id: string,
): THREE.Object3D | null {
  return adapter.hierarchy.object3D?.(id) ?? objectMap.get(id) ?? null;
}

/**
 * The id `object` answers to, or `undefined` when no adapter walk has admitted
 * it as an authoring node.
 */
export function entityIdOf(object: THREE.Object3D | null | undefined): string | undefined {
  const id = getUserData(object, 'entityId');
  return typeof id === 'string' && id ? id : undefined;
}

/** Whether `object` is an admitted authoring node — see {@link entityIdOf}. */
export function isEntityObject(object: THREE.Object3D | null | undefined): boolean {
  return entityIdOf(object) !== undefined;
}

/**
 * The nearest ancestor-or-self of `object` that is an admitted authoring node,
 * or `null` when the climb reaches the top without finding one.
 *
 * This is what a raycast hit has to do: the ray lands on whatever geometry is
 * in front, which is routinely a library-built part folded INTO a node rather
 * than the node itself.
 */
export function nearestEntityObject(
  object: THREE.Object3D | null | undefined,
): THREE.Object3D | null {
  let cursor: THREE.Object3D | null = object ?? null;
  while (cursor && !isEntityObject(cursor)) cursor = cursor.parent;
  return cursor;
}

/**
 * Record that `object` is the authoring node `id` — called by the adapter walk
 * that MINTED the id, and by nothing else. Every reader above is the other side
 * of this one write.
 */
export function stampEntityId(object: THREE.Object3D, id: string): void {
  setUserData(object, 'entityId', id);
}
