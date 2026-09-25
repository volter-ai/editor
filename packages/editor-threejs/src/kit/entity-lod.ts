import type * as THREE from 'three';
import { isEntityObject } from './entity-object';

/**
 * The selected object when it is itself a live THREE.LOD (the native R3F
 * shape), otherwise the entity's live THREE.LOD preview object, or null while
 * an async asset is still loading. A subtree search skips child authoring
 * nodes so a nested LOD entity can never shadow this one's.
 *
 * Format-neutral: reads the caller's native-node membership answer and
 * Three's own `isLOD` marker, never a scene descriptor. The default retains
 * stamp-based compatibility for first-party callers. `editor-viewport.ts`'s
 * per-frame forced-LOD-level enforcement is the only caller.
 */
export function findEntityLod(
  obj: THREE.Object3D,
  isNestedAuthoringNode: (object: THREE.Object3D) => boolean = isEntityObject,
): THREE.LOD | null {
  // Adapter-backed worlds can expose the native LOD itself as the selected
  // authored row (for example Drei Detailed), rather than wrapping it in the
  // old entity preview object this helper was originally extracted for.
  if ((obj as THREE.LOD).isLOD) return obj as THREE.LOD;
  const stack = [...obj.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isNestedAuthoringNode(node)) continue; // nested entity subtree
    if ((node as THREE.LOD).isLOD) return node as THREE.LOD;
    stack.push(...node.children);
  }
  return null;
}
