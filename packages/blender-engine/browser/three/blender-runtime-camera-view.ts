/**
 * BLENDER'S CAMERA VIEW — `view3d.view_camera`, the view through a scene camera — as a window
 * and a frame for a region, transcribed from `BKE_camera_params_from_view3d` (the `RV3D_CAMOB`
 * branch), `BKE_camera_params_compute_viewplane` and `ED_view3d_calc_camera_border`.
 *
 * THE REGION sees the camera's sensor, fitted to the REGION's shape (`AUTO` fits its larger
 * side), at a zoom of `1 / fac`, where `fac` is the view's `BKE_screen_view3d_zoom_to_fac(
 * camzoom)`: 0.5 at the factory `camzoom` of 0, so the region spans twice the sensor. THE
 * FRAME is the same camera fitted to the RENDER's shape at zoom 1, so at `fac` 0.5 it spans
 * half the region along the fitted side. The lens shift moves both alike (`shift × zoom` then
 * divided back out). THE PAN is Blender's own `camdx`/`camdy` (`view_move`: `camdx += -dx /
 * (winx * 2 * fac)`, held to ±1), which moves the region's window by `2 · camdx · fac` of its
 * width — so a zoom scales a panned frame's distance from the centre, as Blender's does.
 *
 * A panoramic camera is drawn as a perspective one.
 */
import * as THREE from 'three';
import { z } from 'zod';

const scalar = z.number().finite();
/** `session.py`'s `draw_camera`. */
export const cameraDataSchema = z.object({
  name: z.string(),
  type: z.string(),
  lens: scalar,
  sensor_width: scalar,
  sensor_height: scalar,
  sensor_fit: z.enum(['AUTO', 'HORIZONTAL', 'VERTICAL']),
  ortho_scale: scalar,
  clip_start: scalar,
  clip_end: scalar,
  shift_x: scalar,
  shift_y: scalar,
  matrix: z.array(z.tuple([scalar, scalar, scalar, scalar])).length(4),
  passepartout: scalar.default(0),
  display_size: scalar.default(1),
});
export type CameraData = z.infer<typeof cameraDataSchema>;

/** `RV3D_CAMZOOM_MIN_FACTOR` .. `RV3D_CAMZOOM_MAX_FACTOR`, and `camzoom` 0's factor. */
export const CAMERA_ZOOM = { opening: 0.5, min: 0.1657359312880714853, max: 44.9852813742385702928 } as const;

/** Blender 5.2's default theme, read back from the installed Blender: the passepartout
 *  (`camera_passepartout`), the solid edge (the 3D View's `back`), the dashed one
 *  (`view_overlay`) and a locked view's outer box (`TH_REDALERT`, the error state). */
const THEME = { passepartout: '#000000', back: '#3d3d3d', overlay: '#000000', redalert: '#991616' } as const;

/** `view_move` in a camera view: the pan after the pointer moves `dx`, `dy` (fractions of the
 *  region, down and right positive) at zoom factor `zoom`. */
export function panCameraView(
  offset: readonly [number, number],
  zoom: number,
  dx: number,
  dy: number,
): readonly [number, number] {
  const clamp = (value: number) => Math.min(1, Math.max(-1, value));
  return [clamp(offset[0] - dx / (2 * zoom)), clamp(offset[1] + dy / (2 * zoom))];
}

/** Half the window along each side, for a camera fitted to a `width` × `height` shape. */
function halfExtents(camera: CameraData, width: number, height: number, zoom: number): [number, number] {
  const orthographic = camera.type === 'ORTHO';
  const sensor = camera.sensor_fit === 'VERTICAL' ? camera.sensor_height : camera.sensor_width;
  const horizontal = camera.sensor_fit === 'AUTO' ? width >= height : camera.sensor_fit === 'HORIZONTAL';
  const half = ((orthographic ? camera.ortho_scale : sensor / camera.lens) / 2) * zoom;
  return horizontal ? [half, (half * height) / width] : [(half * width) / height, half];
}

export interface BlenderCameraView {
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly projection: 'perspective' | 'orthographic';
  readonly window: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly near: number;
  readonly far: number;
  readonly frame: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  readonly passepartout: { readonly color: string; readonly opacity: number };
  readonly border: { readonly solid: string; readonly dashed: string; readonly locked: string };
}

/**
 * `camera`'s view on a region, with `toStage` the Blender → stage matrix. `zoom` is the view's
 * `fac`; `offset` its `[camdx, camdy]`; `renderAspect` the render's width over its height,
 * pixel aspect included.
 */
export function blenderCameraView(
  camera: CameraData,
  toStage: THREE.Matrix4,
  region: { readonly width: number; readonly height: number },
  zoom: number,
  offset: readonly [number, number],
  renderAspect: number,
): BlenderCameraView {
  const width = Math.max(region.width, 1);
  const height = Math.max(region.height, 1);
  const [regionHalfWidth, regionHalfHeight] = halfExtents(camera, width, height, 1 / zoom);
  const [frameHalfWidth, frameHalfHeight] = halfExtents(camera, renderAspect, 1, 1);
  // The shift is a share of the frame's fitted side, on both axes (`dx = shiftx * viewfac`).
  const fitted = camera.sensor_fit === 'AUTO' ? renderAspect >= 1 : camera.sensor_fit === 'HORIZONTAL';
  const fittedSide = 2 * (fitted ? frameHalfWidth : frameHalfHeight);
  const frameWidth = frameHalfWidth / regionHalfWidth;
  const frameHeight = frameHalfHeight / regionHalfHeight;
  // The frame's movement on the region, in fractions of it (down and right positive).
  const shiftRight = -2 * offset[0] * zoom;
  const shiftDown = 2 * offset[1] * zoom;
  const centerX = camera.shift_x * fittedSide - shiftRight * 2 * regionHalfWidth;
  const centerY = camera.shift_y * fittedSide + shiftDown * 2 * regionHalfHeight;
  const matrix = new THREE.Matrix4()
    .set(...(camera.matrix.flat() as Parameters<THREE.Matrix4['set']>))
    .premultiply(toStage);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());
  return {
    name: camera.name,
    position: position.toArray(),
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    projection: camera.type === 'ORTHO' ? 'orthographic' : 'perspective',
    window: {
      left: centerX - regionHalfWidth,
      right: centerX + regionHalfWidth,
      top: centerY + regionHalfHeight,
      bottom: centerY - regionHalfHeight,
    },
    near: camera.clip_start,
    far: camera.clip_end,
    frame: {
      left: 0.5 - frameWidth / 2 + shiftRight,
      top: 0.5 - frameHeight / 2 + shiftDown,
      width: frameWidth,
      height: frameHeight,
    },
    passepartout: { color: THEME.passepartout, opacity: camera.passepartout },
    border: { solid: THEME.back, dashed: THEME.overlay, locked: THEME.redalert },
  };
}
