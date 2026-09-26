/**
 * THE VIEW'S NAME as a target's own chrome words it (the look's `stage.chrome.viewName`; the
 * forms are read from the reference frames, `docs/VIEWPORT-STAGE.md`):
 *
 * - `long`: Godot's "⋮ Perspective" pill and Unreal's "Perspective" pill. An orthographic view
 *   down an axis is named by the axis ("Top"), any other by its projection.
 * - `short`: Unity's label under the scene gizmo, "Persp" or "Iso", and the axis in an
 *   orthographic view down one (`SceneViewOrthoTopAndSide.png`: "Top", "Right").
 *
 * Blender's view text ("User Perspective", "Front Orthographic") is `ViewportFurniture`'s own.
 */
import * as THREE from 'three';
import { axisViewName } from '../asset-workflow/model-inspection';
import type { EditorViewport } from '../editor-viewport';

export function stageViewName(
  viewport: EditorViewport,
  projection: 'perspective' | 'orthographic',
  form: 'long' | 'short',
): string {
  if (projection === 'orthographic') {
    const axis = axisViewName(
      viewport.camera.position.clone().sub(viewport.orbitControls.target),
      new THREE.Vector3(0, 1, 0).applyQuaternion(viewport.camera.quaternion),
    );
    if (axis !== null) return axis;
    return form === 'short' ? 'Iso' : 'Orthographic';
  }
  return form === 'short' ? 'Persp' : 'Perspective';
}
