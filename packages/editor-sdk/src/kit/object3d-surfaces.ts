/**
 * The Object3D surfaces a contribution is handed (`surfaces.Object3DPreview`,
 * `surfaces.Object3DAuthoring`), as the Three integration provides them. The kit forwards
 * whatever is registered here and imports no viewport: a composition without Three registers
 * none, and a contribution that asks for one shows the kit's placeholder until one is.
 *
 * The surfaces stay on the contribution contract because project-authored contributions mount
 * them (the template's `builder-document.tsx`), and a project's source is never rewritten.
 */
import type { ComponentType } from 'react';
import type { ToolObject3DAuthoringProps, ToolObject3DPreviewProps } from '../contributions';

export interface Object3DSurfaces {
  readonly Preview: ComponentType<ToolObject3DPreviewProps>;
  readonly Authoring: ComponentType<ToolObject3DAuthoringProps>;
}

let registered: Object3DSurfaces | null = null;
const listeners = new Set<() => void>();

/** Install the Three integration's surfaces. Returns the teardown. */
export function registerObject3DSurfaces(surfaces: Object3DSurfaces): () => void {
  registered = surfaces;
  for (const listener of listeners) listener();
  return () => {
    if (registered !== surfaces) return;
    registered = null;
    for (const listener of listeners) listener();
  };
}

/** The registered surfaces, or null when no Three integration has registered. */
export function object3DSurfaces(): Object3DSurfaces | null {
  return registered;
}

export function subscribeObject3DSurfaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
