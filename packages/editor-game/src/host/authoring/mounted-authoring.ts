import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type * as THREE from 'three';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { stampEntityId } from '@volter/editor-threejs/kit/entity-object';

/**
 * Selection is editor-global UI state. A mounted adapter may deliberately own
 * selection; when it does not, connect its semantic ids to the shared editor
 * selection rather than requiring project code to know about EditorShellStore.
 */
export function withStoreSelection(
  authoring: AuthoringAdapter,
  store: EditorShellStore,
): AuthoringAdapter {
  if (authoring.selection) return authoring;
  const selection = {
    get: () => [...store.shell.selectedEntityIds],
    set: (ids: string[]) => store.shell.selectMultiple(ids),
  };
  return new Proxy(authoring, {
    get(target, property) {
      if (property === 'selection') return selection;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Make the adopted Three scene use the mounted adapter's own semantic ids.
 * The store, viewport raycast, gizmo and adapter hierarchy must all address an
 * object by the same id; a later generic live-scene walk preserves these tags.
 */
export function stampMountedAuthoringIds(scene: THREE.Scene, authoring: AuthoringAdapter): void {
  const idForObject3D = authoring.hierarchy.idForObject3D;
  if (!idForObject3D) return;
  scene.traverse((object) => {
    const id = idForObject3D(object);
    if (id) stampEntityId(object, id);
  });
}
