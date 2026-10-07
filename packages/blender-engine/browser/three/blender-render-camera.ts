import * as THREE from 'three';
import type {RenderRequest} from '../protocol';

/** Render through the authored camera, including its deliberate clipping.
 * Navigation's automatically fitted clipping does not describe a render. */
export function blenderRenderCamera(render: RenderRequest, documentScale = 1): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const aspect = render.width / render.height;
  const near = (render.clipStart ?? .1) * documentScale;
  const far = (render.clipEnd ?? 2000) * documentScale;
  const camera = render.orthographic
    ? new THREE.OrthographicCamera(-render.fov * documentScale * aspect / 2,
      render.fov * documentScale * aspect / 2, render.fov * documentScale / 2,
      -render.fov * documentScale / 2, near, far)
    : new THREE.PerspectiveCamera(render.fov, aspect, near, far);
  // Blender's shift uses the fitted sensor dimension for BOTH axes.
  // View offset survives projection updates and capture camera cloning.
  const fitted = (render.horizontalFit ?? aspect >= 1) ? render.width : render.height;
  camera.setViewOffset(render.width, render.height,
    (render.shiftX ?? 0) * fitted, -(render.shiftY ?? 0) * fitted,
    render.width, render.height);
  return camera;
}
