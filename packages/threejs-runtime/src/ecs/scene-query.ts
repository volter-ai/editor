import type * as THREE from 'three';
import { getUserData } from './user-data';

/**
 * Runtime queries over a loaded THREE scene graph (P1.6d).
 *
 * These helpers walk a THREE.Object3D graph and read entity metadata off
 * `userData`, so gameplay code can find objects by tag or name without
 * bookkeeping its own indexes.
 *
 * Canonical metadata locations:
 *   - tags:       `userData['tags']` (string[])
 *   - name:       `Object3D.name`
 *
 * These are one-shot walks that notify nobody. For a repeated query, or for a
 * signal when the answer changes, use the LIVE index instead —
 * `ctx.sceneIndex` (`./scene-index.ts`): it reads the same `userData['tags']`
 * storage, answers without traversing, and dispatches `entityadded`/
 * `entityremoved`/`tagadded`/`tagremoved` on an `EventTarget`.
 */

function getTags(obj: THREE.Object3D): string[] {
  const direct = getUserData(obj, 'tags');
  return Array.isArray(direct) ? direct : [];
}

/** All objects in the graph carrying the given tag (depth-first, document order). */
export function queryByTag(root: THREE.Object3D, tag: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (getTags(obj).includes(tag)) matches.push(obj);
  });
  return matches;
}

/** All objects in the graph with the given name (depth-first, document order). */
export function queryByName(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse((obj) => {
    if (obj.name === name) matches.push(obj);
  });
  return matches;
}
