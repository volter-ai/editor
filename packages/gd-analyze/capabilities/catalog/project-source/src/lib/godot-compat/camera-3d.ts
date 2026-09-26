/**
 * @godot-class Camera3D
 * @role PROTOCOL
 *
 * Godot 4.7's perspective `Camera3D` members, transcribed from `scene/3d/camera_3d.cpp` and
 * `core/math/projection.{h,cpp}` at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`, with
 * `real_t` 32-bit.
 *
 * The receiver is the `THREE.PerspectiveCamera` the generated scene mounted, a Node3D whose
 * transform `node-3d.ts` owns. The camera holds `near` and `far` natively. Godot's `fov` is the
 * vertical angle under `KEEP_HEIGHT` and the horizontal one under `KEEP_WIDTH`, while three's `fov`
 * is always vertical, so Godot's `fov` and `keep_aspect` live in `CAMERA`, keyed by the camera,
 * and three's `fov`/`aspect` are written from them for the renderer. A camera compat has not seen
 * starts from its native `fov` (as `KEEP_HEIGHT`), `near` and `far`; the scene mounts a Camera3D
 * with Godot's values (defaults 75, 0.05, 4000, `scene/3d/camera_3d.h:68`).
 *
 * The camera's viewport is its topmost three ancestor, whose size `sub-viewport.ts` holds.
 * Orthogonal and frustum projections are not transcribed.
 */

import type { Object3D, PerspectiveCamera } from 'three';
import { get_global_transform } from './node-3d';
import { get_size } from './sub-viewport';
import {
  construct as vector3,
  dot,
  normalized,
  op_add,
  op_multiply,
  op_subtract,
  type Vector3,
} from './vector3';
import type { Vector2 } from './vector2';

const f32 = Math.fround;
const PI = 3.1415926535897932384626433833;
/** `Camera3D::KeepAspect` (`scene/3d/camera_3d.h:50`). */
const KEEP_WIDTH = 0;
const KEEP_HEIGHT = 1;

interface CameraState {
  fov: number;
  keepAspect: number;
}

const CAMERA = new WeakMap<PerspectiveCamera, CameraState>();

function stateOf(camera: PerspectiveCamera): CameraState {
  let state = CAMERA.get(camera);
  if (state === undefined) {
    state = { fov: f32(camera.fov), keepAspect: KEEP_HEIGHT };
    camera.near = f32(camera.near);
    camera.far = f32(camera.far);
    CAMERA.set(camera, state);
  }
  return state;
}

function viewportOf(camera: Object3D): Object3D {
  let node = camera;
  while (node.parent !== null) node = node.parent;
  return node;
}

/** `get_camera_rect_size()`: the viewport's `Size2i` as a `Vector2` (`scene/main/viewport.cpp:3711`). */
function viewportSize(camera: PerspectiveCamera): readonly [number, number] {
  const size = get_size(viewportOf(camera));
  return [f32(size.x), f32(size.y)];
}

/**
 * `Projection::get_fovy` (`core/math/projection.h:103`): `deg_to_rad(float)` is float, the rest
 * double (`* 0.5`), the result `real_t`.
 */
function getFovy(fovx: number, aspect: number): number {
  const radians = f32(fovx * f32(f32(PI) / 180));
  return f32(Math.atan(aspect * Math.tan(radians * 0.5)) * 2.0 * (180.0 / PI));
}

interface Perspective {
  readonly c00: number;
  readonly c11: number;
  readonly c22: number;
  readonly c23: number;
  readonly c32: number;
  readonly c33: number;
}

/** `Projection::set_perspective` (`core/math/projection.cpp:252`) on an identity projection. */
function perspective(fovyDegrees: number, aspect: number, near: number, far: number, flipFov: boolean): Perspective {
  let fovy = fovyDegrees;
  if (flipFov) fovy = getFovy(fovy, f32(1.0 / aspect));
  const radians = f32((fovy / 2.0) * (PI / 180.0));
  const deltaZ = f32(far - near);
  const sine = f32(Math.sin(radians));
  if (deltaZ === 0 || sine === 0 || aspect === 0) return { c00: 1, c11: 1, c22: 1, c23: 0, c32: 0, c33: 1 };
  const cotangent = f32(f32(Math.cos(radians)) / sine);
  return {
    c00: f32(cotangent / aspect),
    c11: cotangent,
    c22: f32(-f32(far + near) / deltaZ),
    c23: -1,
    c32: f32(f32(f32(-2 * near) * far) / deltaZ),
    c33: 0,
  };
}

/** `Camera3D::_get_camera_projection` (`scene/3d/camera_3d.cpp:281`), perspective mode. */
function cameraProjection(camera: PerspectiveCamera, state: CameraState): Perspective {
  const [width, height] = viewportSize(camera);
  return perspective(state.fov, f32(width / height), camera.near, camera.far, state.keepAspect === KEEP_WIDTH);
}

/** Write three's vertical `fov` and `aspect` for the renderer. */
function writeProjection(camera: PerspectiveCamera, state: CameraState): void {
  const [width, height] = viewportSize(camera);
  const aspect = f32(width / height);
  camera.aspect = aspect;
  camera.fov = state.keepAspect === KEEP_WIDTH ? getFovy(state.fov, f32(1.0 / aspect)) : state.fov;
  camera.updateProjectionMatrix();
}

/**
 * `Camera3D::_get_adjusted_camera_transform` (`scene/3d/camera_3d.cpp:266`): the orthonormalized
 * global transform, its origin offset by `v_offset` and `h_offset` (both 0).
 */
function cameraTransform(camera: PerspectiveCamera): { readonly basis: readonly [Vector3, Vector3, Vector3]; readonly origin: Vector3 } {
  const global = get_global_transform(camera);
  const x = normalized(global.basis.x);
  const y = normalized(op_subtract(global.basis.y, op_multiply(x, dot(x, global.basis.y))));
  const z = normalized(
    op_subtract(op_subtract(global.basis.z, op_multiply(x, dot(x, global.basis.z))), op_multiply(y, dot(y, global.basis.z))),
  );
  let origin = op_add(global.origin, op_multiply(y, 0));
  origin = op_add(origin, op_multiply(x, 0));
  return { basis: [x, y, z], origin };
}

/**
 * `ERR_FAIL_COND(p_fov < 1 || p_fov > 179)`, then the stored angle.
 *
 * @godot Camera3D.set_fov
 * @source scene/3d/camera_3d.cpp:737
 */
export function set_fov(self: PerspectiveCamera, p_fov: number): void {
  const state = stateOf(self);
  const fov = f32(p_fov);
  if (fov < 1 || fov > 179) return;
  state.fov = fov;
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_fov
 * @source scene/3d/camera_3d.cpp:713
 */
export function get_fov(self: PerspectiveCamera): number {
  return stateOf(self).fov;
}

/**
 * @godot Camera3D.set_near
 * @source scene/3d/camera_3d.cpp:749
 */
export function set_near(self: PerspectiveCamera, p_near: number): void {
  const state = stateOf(self);
  self.near = f32(p_near);
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_near
 * @source scene/3d/camera_3d.cpp:721
 */
export function get_near(self: PerspectiveCamera): number {
  stateOf(self);
  return self.near;
}

/**
 * @godot Camera3D.set_far
 * @source scene/3d/camera_3d.cpp:759
 */
export function set_far(self: PerspectiveCamera, p_far: number): void {
  const state = stateOf(self);
  self.far = f32(p_far);
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_far
 * @source scene/3d/camera_3d.cpp:729
 */
export function get_far(self: PerspectiveCamera): number {
  stateOf(self);
  return self.far;
}

/**
 * @godot Camera3D.set_keep_aspect_mode
 * @source scene/3d/camera_3d.cpp:599
 */
export function set_keep_aspect_mode(self: PerspectiveCamera, p_aspect: number): void {
  const state = stateOf(self);
  state.keepAspect = p_aspect;
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_keep_aspect_mode
 * @source scene/3d/camera_3d.cpp:606
 */
export function get_keep_aspect_mode(self: PerspectiveCamera): number {
  return stateOf(self).keepAspect;
}

/**
 * `project_local_ray_normal` (`scene/3d/camera_3d.cpp:411`) rotated by the camera transform's
 * basis and normalized. The viewport's camera coordinates are the position itself (a SubViewport
 * has identity stretch and canvas transforms, `scene/main/viewport.cpp:3705`).
 *
 * @godot Camera3D.project_ray_normal
 * @source scene/3d/camera_3d.cpp:406
 */
export function project_ray_normal(self: PerspectiveCamera, p_pos: Vector2): Vector3 {
  const state = stateOf(self);
  const [width, height] = viewportSize(self);
  const cx = f32(p_pos.x) + 0;
  const cy = f32(p_pos.y) + 0;
  const cm = cameraProjection(self, state);
  const zNear = f32(f32(cm.c33 + cm.c32) / f32(cm.c23 + cm.c22));
  const w = f32(f32(-zNear * cm.c23) + cm.c33);
  const heX = f32(w / cm.c00);
  const heY = f32(w / cm.c11);
  const ray = normalized(
    vector3(
      (f32(cx / width) * 2.0 - 1.0) * heX,
      ((1.0 - f32(cy / height)) * 2.0 - 1.0) * heY,
      -self.near,
    ),
  );
  const { basis } = cameraTransform(self);
  // `Basis::xform` is a dot per row; the rows of the column record are its transposed reads.
  const rowX = vector3(basis[0].x, basis[1].x, basis[2].x);
  const rowY = vector3(basis[0].y, basis[1].y, basis[2].y);
  const rowZ = vector3(basis[0].z, basis[1].z, basis[2].z);
  return normalized(vector3(dot(rowX, ray), dot(rowY, ray), dot(rowZ, ray)));
}

/**
 * For a perspective camera, the camera transform's origin; a zero-height viewport fails with
 * `Vector3()`.
 *
 * @godot Camera3D.project_ray_origin
 * @source scene/3d/camera_3d.cpp:429
 */
export function project_ray_origin(self: PerspectiveCamera, p_pos: Vector2): Vector3 {
  stateOf(self);
  void p_pos;
  const [, height] = viewportSize(self);
  if (height === 0) return vector3();
  return cameraTransform(self).origin;
}
