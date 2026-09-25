import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import type { ViewportShadingRenderer } from '@volter/editor-threejs/render/viewport-shading';
import type * as THREE from 'three';

/**
 * Scene diagnostic shading targets authored/runtime meshes only. Editor
 * infrastructure shares the native scene for authoring, but its custom
 * gizmo materials are part of the editor implementation and must stay native.
 */
export const isEditorViewportShadingTarget: Parameters<ViewportShadingRenderer['render']>[3] = (
  mesh: THREE.Mesh,
) => !isEditorOwnedObject(mesh);
