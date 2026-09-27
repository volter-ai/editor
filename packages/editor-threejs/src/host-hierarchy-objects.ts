/**
 * The live objects behind the hierarchy's node ids, as a media
 * integration provides them: the Three integration answers from the session store's Three half,
 * and a lane that reads a scene's objects (the navmesh bake, Play's camera flight) asks here.
 * With none registered there are no objects.
 */
import type * as THREE from 'three';

/**
 * The world node IS the entity, so a contribution inspecting a live behavior resolves the
 * hierarchy's node id to the object itself. The map is the authored viewport's in Edit and the
 * adopted live scene's in Play; a reader must not hold an object across the hierarchy's
 * `subscribe` firings.
 */
export interface HostHierarchyObjects {
  object(id: string): THREE.Object3D | null;
  objects(): ReadonlyMap<string, THREE.Object3D>;
}

let registered: HostHierarchyObjects | null = null;

export function registerHostHierarchyObjects(provider: HostHierarchyObjects): () => void {
  registered = provider;
  return () => {
    if (registered === provider) registered = null;
  };
}

export function hostHierarchyObjects(): HostHierarchyObjects | null {
  return registered;
}
