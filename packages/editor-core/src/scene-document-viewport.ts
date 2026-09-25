/**
 * THE SCENE'S VIEWPORT (`@volter/editor-sdk/kit/document-viewports`): the world
 * stage draws the Scene through the session store's own camera, shading and
 * grid, and frames the shell's selection. It keeps no selection of its own, so a
 * view's selection is the shell's.
 */
import type { DocumentViewport } from '@volter/editor-sdk/kit/document-viewports';
import type { EditorShellStore } from './editor-shell-store';
import { setViewGridVisible, viewGridVisible } from '@volter/editor-sdk/kit/viewport-presentation';

type ShadingMode = Parameters<EditorShellStore['setShadingMode']>[0];

const SCENE_MODES = new Set<string>(['solid', 'clay', 'unlit', 'wireframe', 'normals', 'overdraw']);

export function sceneDocumentViewport(store: EditorShellStore, documentId: string): DocumentViewport {
  return {
    read: () => {
      const pose = store.cameraPose;
      if (!pose) return null;
      const { position, target } = pose;
      return {
        camera: {
          position: { x: position.x, y: position.y, z: position.z },
          target: { x: target.x, y: target.y, z: target.z },
          ...(pose.fov ? { fov: pose.fov } : {}),
        },
        diagnostic: store.shadingMode,
        grid: viewGridVisible(documentId),
      };
    },
    setGrid: (on) => setViewGridVisible(documentId, on),
    setDiagnostic: (diagnostic) => {
      if (!SCENE_MODES.has(diagnostic)) return false;
      store.setShadingMode(diagnostic as ShadingMode);
      return true;
    },
    setCamera: (camera) => {
      if (typeof camera !== 'string') {
        store.setCameraPose(camera.position, camera.target, camera.fov);
        return true;
      }
      if (camera === 'isometric') return false;
      store.setViewPreset(camera);
      return true;
    },
    frame: (target) => {
      if (target === 'document') return false;
      store.focusOnSelection();
      return true;
    },
  };
}
