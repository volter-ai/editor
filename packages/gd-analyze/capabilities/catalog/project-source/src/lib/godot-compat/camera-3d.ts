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
 * The cull mask is three's `camera.layers.mask`: three draws an object whose `layers` share a bit
 * with the camera's, as `RendererSceneCull` draws an instance whose layer mask shares one with the
 * camera's cull mask (Godot's 20 render layers are three's layers 0 to 19). A new Camera3D culls
 * with all 20 (`0xfffff`, `camera_3d.h:83`); a scene's camera states its mask.
 *
 * The camera's viewport is its topmost three ancestor: the root window (whose size `window.ts`
 * holds) or a SubViewport (`sub-viewport.ts`).
 *
 * The projection is Godot's (`_get_camera_projection`) in all three modes. A perspective camera
 * without `h_offset`/`v_offset` draws through three's own `fov` and `aspect`; an orthogonal or
 * frustum camera, or one with offsets, draws through Godot's projection written into three's
 * `projectionMatrix`, times the offsets' translation (the renderer's view of the offset camera
 * transform, `_get_adjusted_camera_transform`). three's shaders then still take the camera as a
 * perspective one (`isOrthographic` false), which only changes the specular view direction of an
 * orthogonal camera.
 *
 * Which camera a viewport draws with is Godot's: a mounted camera registers with its viewport (the
 * nearest three `Scene` above it) when it enters the tree and becomes the viewport's camera when it
 * is `current` or the viewport's first (`NOTIFICATION_ENTER_WORLD`, `camera_3d.cpp:195`), and hands
 * over on leaving; the viewport's set of cameras keeps Godot's `HashSet` order, an erased camera's
 * slot taken by the last one (`core/templates/hash_set.h:263`).
 */

import { Matrix4, type Object3D, PerspectiveCamera } from 'three';
import type { Environment } from './environment';
import { godot_node_entity, godot_node_observe_tree, is_inside_tree } from './node';
import { get_global_transform } from './node-3d';
import { construct as plane, type Plane } from './plane';
import { construct as basisOf } from './basis';
import { get_size as subViewportSize } from './sub-viewport';
import { construct as transform3d, type Transform3D } from './transform-3d';
import { get_size as windowSize, godot_window_camera_coords, godot_window_has_size } from './window';
import {
  construct as vector3,
  dot,
  normalized,
  op_add,
  op_multiply,
  op_subtract,
  type Vector3,
} from './vector3';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;
const PI = 3.1415926535897932384626433833;
/** `Camera3D::KeepAspect` (`scene/3d/camera_3d.h:50`). */
const KEEP_WIDTH = 0;
const KEEP_HEIGHT = 1;
/** `Camera3D::ProjectionType` (`scene/3d/camera_3d.h:44`). */
const PROJECTION_PERSPECTIVE = 0;
const PROJECTION_ORTHOGONAL = 1;
const PROJECTION_FRUSTUM = 2;
/** `CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

interface CameraState {
  fov: number;
  keepAspect: number;
  current: boolean;
  /** The viewport the camera registered with on entering the tree. */
  viewport: Object3D | null;
  /** `mode`, `size`, `frustum_offset`, `h_offset`, `v_offset` (`scene/3d/camera_3d.h:66`). */
  mode: number;
  size: number;
  frustumOffset: readonly [number, number];
  hOffset: number;
  vOffset: number;
  /** `doppler_tracking`, `attributes` and `compositor`, stored and read back. */
  doppler: number;
  attributes: object | null;
  compositor: object | null;
}

interface ViewportCameras {
  readonly set: PerspectiveCamera[];
  camera: PerspectiveCamera | null;
}

const VIEWPORTS = new WeakMap<Object3D, ViewportCameras>();

function camerasOf(viewport: Object3D): ViewportCameras {
  let cameras = VIEWPORTS.get(viewport);
  if (cameras === undefined) {
    cameras = { set: [], camera: null };
    VIEWPORTS.set(viewport, cameras);
  }
  return cameras;
}

/** The nearest three `Scene` above the camera: its viewport (`Node::get_viewport`). */
function nearestViewport(camera: Object3D): Object3D | null {
  for (let node = camera.parent; node !== null; node = node.parent) {
    if ((node as { readonly isScene?: boolean }).isScene === true) return node;
  }
  return null;
}

const CAMERA = new WeakMap<PerspectiveCamera, CameraState>();

function stateOf(camera: PerspectiveCamera): CameraState {
  let state = CAMERA.get(camera);
  if (state === undefined) {
    state = {
      fov: f32(camera.fov),
      keepAspect: KEEP_HEIGHT,
      current: false,
      viewport: null,
      mode: PROJECTION_PERSPECTIVE,
      size: 1,
      frustumOffset: [0, 0],
      hOffset: 0,
      vOffset: 0,
      doppler: 0,
      attributes: null,
      compositor: null,
    };
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
  const viewport = viewportOf(camera);
  const size = godot_window_has_size(viewport) ? windowSize(viewport) : subViewportSize(viewport);
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

/** A `Projection`'s sixteen `real_t`, column-major: `columns[i][j]` is `m[4 * i + j]` (three's order). */
type Columns = readonly number[];

const IDENTITY_COLUMNS: Columns = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** `Projection::set_perspective` (`core/math/projection.cpp:252`) on an identity projection. */
function perspective(fovyDegrees: number, aspect: number, near: number, far: number, flipFov: boolean): Columns {
  let fovy = fovyDegrees;
  if (flipFov) fovy = getFovy(fovy, f32(1.0 / aspect));
  const radians = f32((fovy / 2.0) * (PI / 180.0));
  const deltaZ = f32(far - near);
  const sine = f32(Math.sin(radians));
  if (deltaZ === 0 || sine === 0 || aspect === 0) return IDENTITY_COLUMNS;
  const cotangent = f32(f32(Math.cos(radians)) / sine);
  const out = [...IDENTITY_COLUMNS];
  out[0] = f32(cotangent / aspect);
  out[5] = cotangent;
  out[10] = f32(-f32(far + near) / deltaZ);
  out[11] = -1;
  out[14] = f32(f32(f32(-2 * near) * far) / deltaZ);
  out[15] = 0;
  return out;
}

/** `Projection::set_orthogonal(size, aspect, near, far, flip_fov)` (`core/math/projection.cpp:356`). */
function orthogonal(sizeIn: number, aspect: number, near: number, far: number, flipFov: boolean): Columns {
  const size = flipFov ? sizeIn : f32(sizeIn * aspect);
  const left = f32(-size / 2);
  const right = f32(size / 2);
  const bottom = f32(f32(-size / aspect) / 2);
  const top = f32(f32(size / aspect) / 2);
  const out = [...IDENTITY_COLUMNS];
  out[0] = f32(2.0 / f32(right - left));
  out[12] = f32(-(f32(right + left) / f32(right - left)));
  out[5] = f32(2.0 / f32(top - bottom));
  out[13] = f32(-(f32(top + bottom) / f32(top - bottom)));
  out[10] = f32(-2.0 / f32(far - near));
  out[14] = f32(-(f32(far + near) / f32(far - near)));
  out[15] = 1;
  return out;
}

/**
 * `Projection::set_frustum(size, aspect, offset, near, far)` (`core/math/projection.cpp:396`)
 * through the six-plane form (`:364`), which fails and leaves the identity on an empty frustum.
 */
function frustum(sizeIn: number, aspect: number, offset: readonly [number, number], near: number, far: number): Columns {
  const size = f32(sizeIn * aspect);
  const left = f32(f32(-size / 2) + offset[0]);
  const right = f32(f32(size / 2) + offset[0]);
  const bottom = f32(f32(f32(-size / aspect) / 2) + offset[1]);
  const top = f32(f32(f32(size / aspect) / 2) + offset[1]);
  if (right <= left || top <= bottom || far <= near) return IDENTITY_COLUMNS;
  return [
    f32(f32(2 * near) / f32(right - left)), 0, 0, 0,
    0, f32(f32(2 * near) / f32(top - bottom)), 0, 0,
    f32(f32(right + left) / f32(right - left)), f32(f32(top + bottom) / f32(top - bottom)), f32(-f32(far + near) / f32(far - near)), -1,
    0, 0, f32(f32(f32(-2 * far) * near) / f32(far - near)), 0,
  ];
}

/** `Camera3D::_get_camera_projection` (`scene/3d/camera_3d.cpp:281`). */
function cameraProjection(camera: PerspectiveCamera, state: CameraState): Columns {
  const [width, height] = viewportSize(camera);
  const aspect = f32(width / height);
  if (state.mode === PROJECTION_ORTHOGONAL) return orthogonal(state.size, aspect, camera.near, camera.far, state.keepAspect === KEEP_WIDTH);
  if (state.mode === PROJECTION_FRUSTUM) return frustum(state.size, aspect, state.frustumOffset, camera.near, camera.far);
  return perspective(state.fov, aspect, camera.near, camera.far, state.keepAspect === KEEP_WIDTH);
}

const OFFSET_MATRIX = new Matrix4();

/** Write three's vertical `fov` and `aspect` for the renderer. */
function writeProjection(camera: PerspectiveCamera, state: CameraState): void {
  const [width, height] = viewportSize(camera);
  const aspect = f32(width / height);
  camera.aspect = aspect;
  camera.fov = state.keepAspect === KEEP_WIDTH ? getFovy(state.fov, f32(1.0 / aspect)) : state.fov;
  camera.updateProjectionMatrix();
  if (state.mode === PROJECTION_PERSPECTIVE && state.hOffset === 0 && state.vOffset === 0) return;
  // Godot's projection, drawn from the offset camera transform: moving the eye by (h, v) along its
  // own axes is the view translated by (-h, -v) before the projection.
  camera.projectionMatrix.fromArray(cameraProjection(camera, state) as number[]);
  camera.projectionMatrix.multiply(OFFSET_MATRIX.makeTranslation(-state.hOffset, -state.vOffset, 0));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/**
 * `Camera3D::_get_adjusted_camera_transform` (`scene/3d/camera_3d.cpp:266`): the orthonormalized
 * global transform, its origin offset by `v_offset` and `h_offset`.
 */
function cameraTransform(camera: PerspectiveCamera): { readonly basis: readonly [Vector3, Vector3, Vector3]; readonly origin: Vector3 } {
  const global = get_global_transform(camera);
  const x = normalized(global.basis.x);
  const y = normalized(op_subtract(global.basis.y, op_multiply(x, dot(x, global.basis.y))));
  const z = normalized(
    op_subtract(op_subtract(global.basis.z, op_multiply(x, dot(x, global.basis.z))), op_multiply(y, dot(y, global.basis.z))),
  );
  const state = stateOf(camera);
  let origin = op_add(global.origin, op_multiply(y, state.vOffset));
  origin = op_add(origin, op_multiply(x, state.hOffset));
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

/** The viewport's camera coordinates of a position (`Viewport::get_camera_coords`). */
function cameraCoords(camera: PerspectiveCamera, p_pos: Vector2): readonly [number, number] {
  const viewport = viewportOf(camera);
  const coords = godot_window_has_size(viewport) ? godot_window_camera_coords(viewport, p_pos) : p_pos;
  return [f32(coords.x) + 0, f32(coords.y) + 0];
}

/** `Basis::xform` of the camera transform's basis (a dot per row of the column record). */
function xformCameraBasis(basis: readonly [Vector3, Vector3, Vector3], v: Vector3): Vector3 {
  const rowX = vector3(basis[0].x, basis[1].x, basis[2].x);
  const rowY = vector3(basis[0].y, basis[1].y, basis[2].y);
  const rowZ = vector3(basis[0].z, basis[1].z, basis[2].z);
  return vector3(dot(rowX, v), dot(rowY, v), dot(rowZ, v));
}

/** `Transform3D::xform` of the camera transform. */
function xformCamera(camera: PerspectiveCamera, v: Vector3): Vector3 {
  const t = cameraTransform(camera);
  return op_add(xformCameraBasis(t.basis, v), t.origin);
}

/**
 * The ray through a viewport position in the camera's own space: straight ahead for an orthogonal
 * camera, else through the projection's near-plane half extents
 * (`Projection::get_viewport_half_extents`, `core/math/projection.cpp:418`). The viewport's camera
 * coordinates are the position through the root window's stretch, and the position itself in a
 * SubViewport (identity stretch and canvas transforms, `scene/main/viewport.cpp:3705`). Outside the
 * tree it fails with `Vector3()`.
 *
 * @godot Camera3D.project_local_ray_normal
 * @source scene/3d/camera_3d.cpp:411
 */
export function project_local_ray_normal(self: PerspectiveCamera, p_pos: Vector2): Vector3 {
  const state = stateOf(self);
  if (state.mode === PROJECTION_ORTHOGONAL) return vector3(0, 0, -1);
  const [width, height] = viewportSize(self);
  const [cx, cy] = cameraCoords(self, p_pos);
  const cm = cameraProjection(self, state);
  const zNear = f32(f32((cm[15] as number) + (cm[14] as number)) / f32((cm[11] as number) + (cm[10] as number)));
  const w = f32(f32(-zNear * (cm[11] as number)) + (cm[15] as number));
  const heX = f32(w / (cm[0] as number));
  const heY = f32(w / (cm[5] as number));
  return normalized(
    vector3(
      (f32(cx / width) * 2.0 - 1.0) * heX,
      ((1.0 - f32(cy / height)) * 2.0 - 1.0) * heY,
      -self.near,
    ),
  );
}

/**
 * `project_local_ray_normal` rotated by the camera transform's basis and normalized.
 *
 * @godot Camera3D.project_ray_normal
 * @source scene/3d/camera_3d.cpp:406
 */
export function project_ray_normal(self: PerspectiveCamera, p_pos: Vector2): Vector3 {
  const ray = project_local_ray_normal(self, p_pos);
  return normalized(xformCameraBasis(cameraTransform(self).basis, ray));
}

/**
 * For a perspective or frustum camera, the camera transform's origin; for an orthogonal one, the
 * point on the near plane under the position. A zero-height viewport fails with `Vector3()`.
 *
 * @godot Camera3D.project_ray_origin
 * @source scene/3d/camera_3d.cpp:429
 */
export function project_ray_origin(self: PerspectiveCamera, p_pos: Vector2): Vector3 {
  const state = stateOf(self);
  const [width, height] = viewportSize(self);
  if (height === 0) return vector3();
  if (state.mode !== PROJECTION_ORTHOGONAL) return cameraTransform(self).origin;
  const [cx, cy] = cameraCoords(self, p_pos);
  const px = f32(cx / width);
  const py = f32(cy / height);
  const aspect = f32(width / height);
  const hsize = state.keepAspect === KEEP_WIDTH ? state.size : f32(state.size * aspect);
  const vsize = state.keepAspect === KEEP_WIDTH ? f32(state.size / aspect) : state.size;
  const ray = vector3(f32(px * hsize) - hsize / 2, f32((1.0 - py) * vsize) - vsize / 2, -self.near);
  return xformCamera(self, ray);
}

/**
 * Whether the position lies behind the near plane: its distance along the global transform's
 * view direction (`-Z`) is under `near`.
 *
 * @godot Camera3D.is_position_behind
 * @source scene/3d/camera_3d.cpp:458
 */
export function is_position_behind(self: PerspectiveCamera, p_pos: Vector3): boolean {
  stateOf(self);
  const t = get_global_transform(self);
  const eyedir = op_multiply(normalized(t.basis.z), -1);
  return dot(eyedir, op_subtract(p_pos, t.origin)) < self.near;
}

/**
 * The screen position of a world point: the camera-space point (`xform_inv` of the camera
 * transform) through the projection (`Projection::xform4`), divided by `w` and mapped onto the
 * viewport's visible size. Outside the tree, or with `w` zero, it fails with `Vector2()`.
 *
 * @godot Camera3D.unproject_position
 * @source scene/3d/camera_3d.cpp:482
 */
export function unproject_position(self: PerspectiveCamera, p_pos: Vector3): Vector2 {
  const state = stateOf(self);
  if (!is_inside_tree(self)) return vector2();
  const [width, height] = viewportSize(self);
  const cm = cameraProjection(self, state);
  const t = cameraTransform(self);
  // `Transform3D::xform_inv`: the basis transposed over the offset from the origin.
  const v = op_subtract(p_pos, t.origin);
  const local = [dot(t.basis[0], v), dot(t.basis[1], v), dot(t.basis[2], v), 1] as const;
  const c = (i: number, j: number): number => cm[4 * i + j] as number;
  const out = [0, 1, 2, 3].map((j) => f32(f32(f32(f32(c(0, j) * local[0]) + f32(c(1, j) * local[1])) + f32(c(2, j) * local[2])) + f32(c(3, j) * local[3])));
  const d = out[3] as number;
  if (d === 0) return vector2();
  const nx = f32((out[0] as number) / d);
  const ny = f32((out[1] as number) / d);
  return vector2(f32(f32(nx * 0.5 + 0.5) * width), f32(f32(-ny * 0.5 + 0.5) * height));
}

type PlaneTuple = readonly [number, number, number, number];

/**
 * `Projection::get_projection_planes(Transform3D())` (`core/math/projection.cpp:462`): near, far,
 * left, top, right, bottom, each `-(normal)` normalized (`Plane::normalize`).
 */
function projectionPlanes(cm: Columns): PlaneTuple[] {
  const m = (index: number): number => cm[index] as number;
  const make = (a: number, b: number, c: number, d: number): PlaneTuple => {
    const nx = -a;
    const ny = -b;
    const nz = -c;
    const l = f32(Math.sqrt(f32(f32(f32(nx * nx) + f32(ny * ny)) + f32(nz * nz))));
    if (l === 0) return [0, 0, 0, 0];
    return [f32(nx / l), f32(ny / l), f32(nz / l), f32(d / l)];
  };
  return [
    make(m(3) + m(2), m(7) + m(6), m(11) + m(10), m(15) + m(14)),
    make(m(3) - m(2), m(7) - m(6), m(11) - m(10), m(15) - m(14)),
    make(m(3) + m(0), m(7) + m(4), m(11) + m(8), m(15) + m(12)),
    make(m(3) - m(1), m(7) - m(5), m(11) - m(9), m(15) - m(13)),
    make(m(3) - m(0), m(7) - m(4), m(11) - m(8), m(15) - m(12)),
    make(m(3) + m(1), m(7) + m(5), m(11) + m(9), m(15) + m(13)),
  ].map((p) => p.map((value) => f32(value)) as unknown as PlaneTuple);
}

/** `Plane::intersect_3` (`core/math/plane.cpp:81`); null where the planes do not meet in a point. */
function intersect3(p0: PlaneTuple, p1: PlaneTuple, p2: PlaneTuple): readonly [number, number, number] | null {
  const cross = (a: PlaneTuple, b: PlaneTuple): readonly [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const c01 = cross(p0, p1);
  const denom = f32(c01[0] * p2[0] + c01[1] * p2[1] + c01[2] * p2[2]);
  if (Math.abs(denom) < CMP_EPSILON) return null;
  const c12 = cross(p1, p2);
  const c20 = cross(p2, p0);
  return [0, 1, 2].map((i) => f32(((c12[i] as number) * p0[3] + (c20[i] as number) * p1[3] + (c01[i] as number) * p2[3]) / denom)) as unknown as readonly [number, number, number];
}

/**
 * The world point at `z_depth` in front of the camera under a viewport position: the position
 * scaled by the projection's half extents at that depth (the right and top planes cut by the
 * `z = -depth` slice) and moved by the camera transform. A zero depth on a perspective camera is the
 * global origin; outside the tree it fails with `Vector3()`.
 *
 * @godot Camera3D.project_position
 * @source scene/3d/camera_3d.cpp:506
 */
export function project_position(self: PerspectiveCamera, p_point: Vector2, p_z_depth: number): Vector3 {
  const state = stateOf(self);
  if (!is_inside_tree(self)) return vector3();
  if (p_z_depth === 0 && state.mode !== PROJECTION_ORTHOGONAL) return get_global_transform(self).origin;
  const [width, height] = viewportSize(self);
  const planes = projectionPlanes(cameraProjection(self, state));
  const res = intersect3([0, 0, 1, f32(-p_z_depth)], planes[4] as PlaneTuple, planes[3] as PlaneTuple) ?? [0, 0, 0];
  const px = f32(f32(f32(p_point.x / width) * 2.0 - 1.0) * res[0]);
  const py = f32(f32(f32(1.0 - f32(p_point.y / height)) * 2.0 - 1.0) * res[1]);
  return xformCamera(self, vector3(px, py, -p_z_depth));
}

/**
 * The six frustum planes in world space (near, far, left, top, right, bottom): the projection's
 * planes moved by the camera transform (`Transform3D::xform(Plane)`; the camera transform is
 * orthonormal, so its basis is its own inverse transpose). Outside the world it fails with an
 * empty array.
 *
 * @godot Camera3D.get_frustum
 * @source scene/3d/camera_3d.cpp:792
 */
export function get_frustum(self: PerspectiveCamera): Plane[] {
  const state = stateOf(self);
  if (!is_inside_tree(self)) return [];
  const t = cameraTransform(self);
  return projectionPlanes(cameraProjection(self, state)).map((p) => {
    const point = xformCamera(self, vector3(f32(p[0] * p[3]), f32(p[1] * p[3]), f32(p[2] * p[3])));
    const normal = normalized(xformCameraBasis(t.basis, vector3(p[0], p[1], p[2])));
    return plane(normal, dot(normal, point));
  });
}

/**
 * Inside when the point is over none of the frustum planes (`Plane::is_point_over`).
 *
 * @godot Camera3D.is_position_in_frustum
 * @source scene/3d/camera_3d.cpp:805
 */
export function is_position_in_frustum(self: PerspectiveCamera, p_position: Vector3): boolean {
  for (const p of get_frustum(self)) {
    if (dot(p.normal, p_position) > p.d) return false;
  }
  return true;
}

/**
 * The global transform, orthonormalized and moved by `h_offset` and `v_offset`.
 *
 * @godot Camera3D.get_camera_transform
 * @source scene/3d/camera_3d.cpp:272
 */
export function get_camera_transform(self: PerspectiveCamera): Transform3D {
  const t = cameraTransform(self);
  return transform3d(basisOf(t.basis[0], t.basis[1], t.basis[2]), t.origin);
}

/**
 * The lens and projection together: `fov`, `near`, `far` and `PROJECTION_PERSPECTIVE`.
 * Unchanged, it does nothing.
 *
 * @godot Camera3D.set_perspective
 * @source scene/3d/camera_3d.cpp:305
 */
export function set_perspective(self: PerspectiveCamera, p_fov: number, p_z_near: number, p_z_far: number): void {
  const state = stateOf(self);
  state.fov = f32(p_fov);
  self.near = f32(p_z_near);
  self.far = f32(p_z_far);
  state.mode = PROJECTION_PERSPECTIVE;
  writeProjection(self, state);
}

/**
 * `size`, `near`, `far` and `PROJECTION_ORTHOGONAL`. Unchanged, it does nothing.
 *
 * @godot Camera3D.set_orthogonal
 * @source scene/3d/camera_3d.cpp:320
 */
export function set_orthogonal(self: PerspectiveCamera, p_size: number, p_z_near: number, p_z_far: number): void {
  const state = stateOf(self);
  state.size = f32(p_size);
  self.near = f32(p_z_near);
  self.far = f32(p_z_far);
  state.mode = PROJECTION_ORTHOGONAL;
  writeProjection(self, state);
}

/**
 * `size`, `frustum_offset`, `near`, `far` and `PROJECTION_FRUSTUM`. Unchanged, it does nothing.
 *
 * @godot Camera3D.set_frustum
 * @source scene/3d/camera_3d.cpp:336
 */
export function set_frustum(self: PerspectiveCamera, p_size: number, p_offset: Vector2, p_z_near: number, p_z_far: number): void {
  const state = stateOf(self);
  state.size = f32(p_size);
  state.frustumOffset = [f32(p_offset.x), f32(p_offset.y)];
  self.near = f32(p_z_near);
  self.far = f32(p_z_far);
  state.mode = PROJECTION_FRUSTUM;
  writeProjection(self, state);
}

/**
 * A mode outside the three projection types is ignored.
 *
 * @godot Camera3D.set_projection
 * @source scene/3d/camera_3d.cpp:353
 */
export function set_projection(self: PerspectiveCamera, p_mode: number): void {
  if (p_mode !== PROJECTION_PERSPECTIVE && p_mode !== PROJECTION_ORTHOGONAL && p_mode !== PROJECTION_FRUSTUM) return;
  const state = stateOf(self);
  state.mode = p_mode;
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_projection
 * @source scene/3d/camera_3d.cpp:733
 */
export function get_projection(self: PerspectiveCamera): number {
  return stateOf(self).mode;
}

/**
 * `ERR_FAIL_COND(p_size <= CMP_EPSILON)`, then the orthogonal or frustum size.
 *
 * @godot Camera3D.set_size
 * @source scene/3d/camera_3d.cpp:743
 */
export function set_size(self: PerspectiveCamera, p_size: number): void {
  const state = stateOf(self);
  const size = f32(p_size);
  if (size <= CMP_EPSILON) return;
  state.size = size;
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_size
 * @source scene/3d/camera_3d.cpp:717
 */
export function get_size(self: PerspectiveCamera): number {
  return stateOf(self).size;
}

/**
 * @godot Camera3D.set_frustum_offset
 * @source scene/3d/camera_3d.cpp:754
 */
export function set_frustum_offset(self: PerspectiveCamera, p_offset: Vector2): void {
  const state = stateOf(self);
  state.frustumOffset = [f32(p_offset.x), f32(p_offset.y)];
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_frustum_offset
 * @source scene/3d/camera_3d.cpp:725
 */
export function get_frustum_offset(self: PerspectiveCamera): Vector2 {
  const offset = stateOf(self).frustumOffset;
  return vector2(offset[0], offset[1]);
}

/**
 * The camera moves by `h_offset` along its own X axis as it draws and projects.
 *
 * @godot Camera3D.set_h_offset
 * @source scene/3d/camera_3d.cpp:824
 */
export function set_h_offset(self: PerspectiveCamera, p_offset: number): void {
  const state = stateOf(self);
  state.hOffset = f32(p_offset);
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_h_offset
 * @source scene/3d/camera_3d.cpp:829
 */
export function get_h_offset(self: PerspectiveCamera): number {
  return stateOf(self).hOffset;
}

/**
 * The camera moves by `v_offset` along its own Y axis as it draws and projects.
 *
 * @godot Camera3D.set_v_offset
 * @source scene/3d/camera_3d.cpp:815
 */
export function set_v_offset(self: PerspectiveCamera, p_offset: number): void {
  const state = stateOf(self);
  state.vOffset = f32(p_offset);
  writeProjection(self, state);
}

/**
 * @godot Camera3D.get_v_offset
 * @source scene/3d/camera_3d.cpp:820
 */
export function get_v_offset(self: PerspectiveCamera): number {
  return stateOf(self).vOffset;
}

/**
 * Stored and read back. Exposure and depth of field from camera attributes are post effects the
 * web's Compatibility renderer draws through the environment, which compat's post pass takes from
 * the WorldEnvironment (`world-environment.ts`); the camera's own attributes draw nothing.
 *
 * @godot Camera3D.set_attributes
 * @source scene/3d/camera_3d.cpp:545
 */
export function set_attributes(self: PerspectiveCamera, p_attributes: object | null): void {
  stateOf(self).attributes = p_attributes;
}

/**
 * @godot Camera3D.get_attributes
 * @source scene/3d/camera_3d.cpp:570
 */
export function get_attributes(self: PerspectiveCamera): object | null {
  return stateOf(self).attributes;
}

/**
 * Stored and read back. Compositor effects run on the RenderingDevice renderers only; the web's
 * Compatibility renderer never runs them (`rendering_method.web` is `gl_compatibility`), so a
 * compositor draws nothing, as in Godot's own web export.
 *
 * @godot Camera3D.set_compositor
 * @source scene/3d/camera_3d.cpp:585
 */
export function set_compositor(self: PerspectiveCamera, p_compositor: object | null): void {
  stateOf(self).compositor = p_compositor;
}

/**
 * @godot Camera3D.get_compositor
 * @source scene/3d/camera_3d.cpp:595
 */
export function get_compositor(self: PerspectiveCamera): object | null {
  return stateOf(self).compositor;
}

/**
 * Stored and read back: `DOPPLER_TRACKING_DISABLED` (0), `IDLE_STEP` (1) or `PHYSICS_STEP` (2).
 * The 3D audio players compat binds play through the page's audio without a Doppler shift.
 *
 * @godot Camera3D.set_doppler_tracking
 * @source scene/3d/camera_3d.cpp:610
 */
export function set_doppler_tracking(self: PerspectiveCamera, p_tracking: number): void {
  stateOf(self).doppler = p_tracking;
}

/**
 * @godot Camera3D.get_doppler_tracking
 * @source scene/3d/camera_3d.cpp:623
 */
export function get_doppler_tracking(self: PerspectiveCamera): number {
  return stateOf(self).doppler;
}

/** `Viewport::_camera_3d_set` (`scene/main/viewport.cpp:4750`). */
function cameraSet(viewport: Object3D, camera: PerspectiveCamera | null): void {
  camerasOf(viewport).camera = camera;
  if (camera === null) return;
  writeProjection(camera, stateOf(camera));
  RENDERERS.get(viewport)?.(camera);
}

/** What draws each viewport, told the camera it now draws with (`godot_camera_3d_attach_renderer`). */
const RENDERERS = new Map<Object3D, (camera: PerspectiveCamera) => void>();

/** `Viewport::_camera_3d_make_next_current` (`scene/main/viewport.cpp:4794`). */
function makeNextCurrent(viewport: Object3D, exclude: PerspectiveCamera): void {
  const cameras = camerasOf(viewport);
  for (const camera of [...cameras.set]) {
    if (camera === exclude || !is_inside_tree(camera)) continue;
    if (cameras.camera !== null) return;
    make_current(camera);
  }
}

/** `NOTIFICATION_ENTER_WORLD` (`scene/3d/camera_3d.cpp:195`) with `Viewport::_camera_3d_add` (`:4782`). */
function enterWorld(camera: PerspectiveCamera): void {
  const state = stateOf(camera);
  const viewport = nearestViewport(camera);
  state.viewport = viewport;
  if (viewport === null) return;
  const cameras = camerasOf(viewport);
  if (!cameras.set.includes(camera)) cameras.set.push(camera);
  if (state.current || cameras.set.length === 1) cameraSet(viewport, camera);
}

const ENVIRONMENTS = new WeakMap<object, Environment | null>();

/**
 * The camera's own environment, which the renderer draws in place of the world's while it draws
 * with this camera (`RendererSceneCull::_render_get_environment`, renderer_scene_cull.cpp:3722).
 * The scene's WorldEnvironment draws it, reading it from R3F's camera in its own processing
 * (`world-environment.ts`).
 *
 * @godot Camera3D.set_environment
 * @source scene/3d/camera_3d.cpp:531
 */
export function set_environment(self: PerspectiveCamera, p_environment: Environment | null): void {
  ENVIRONMENTS.set(self, p_environment);
}

/**
 * @godot Camera3D.get_environment
 * @source scene/3d/camera_3d.cpp:541
 */
export function get_environment(self: PerspectiveCamera): Environment | null {
  return ENVIRONMENTS.get(self) ?? null;
}

/**
 * A scene's Camera3D element states what the drei camera has no prop for through R3F's
 * `onUpdate`: its own environment, and an orthogonal or frustum projection and its size
 * (`onUpdate={godot_camera_3d_lens_prop({ projection: 1, size: 19 })}`).
 *
 * @godot Camera3D (protocol)
 * @source scene/3d/camera_3d.cpp:687
 */
export function godot_camera_3d_lens_prop(lens: { readonly environment?: Environment | null; readonly projection?: number; readonly size?: number }): (self: PerspectiveCamera) => void {
  return (self) => {
    if (lens.environment !== undefined && ENVIRONMENTS.get(self) !== lens.environment) set_environment(self, lens.environment);
    if (lens.size !== undefined && get_size(self) !== f32(lens.size)) set_size(self, lens.size);
    if (lens.projection !== undefined && get_projection(self) !== lens.projection) set_projection(self, lens.projection);
  };
}

/** `NOTIFICATION_EXIT_WORLD` (`scene/3d/camera_3d.cpp:228`) with `Viewport::_camera_3d_remove` (`:4787`). */
function exitWorld(camera: PerspectiveCamera): void {
  const state = stateOf(camera);
  if (is_current(camera)) {
    clear_current(camera);
    state.current = true;
  } else {
    state.current = false;
  }
  const viewport = state.viewport;
  if (viewport === null) return;
  const cameras = camerasOf(viewport);
  const index = cameras.set.indexOf(camera);
  if (index >= 0) {
    const last = cameras.set.pop() as PerspectiveCamera;
    if (index < cameras.set.length) cameras.set[index] = last;
  }
  if (cameras.camera === camera) cameraSet(viewport, null);
  state.viewport = null;
}

// A three camera is a Camera3D (the scene's drei `<PerspectiveCamera>`, or `Camera3D.new()`): it
// joins its viewport's cameras as it enters the tree and leaves them as it exits
// (`NOTIFICATION_ENTER_WORLD`/`EXIT_WORLD`, `camera_3d.cpp:195`).
godot_node_observe_tree((entity) => {
  if (!(entity instanceof PerspectiveCamera)) return;
  if (is_inside_tree(entity)) {
    if (stateOf(entity).viewport === null) enterWorld(entity);
  } else exitWorld(entity);
});

/** `layers` of a new Camera3D: every one of the 20 render layers (`camera_3d.h:83`). */
const DEFAULT_CULL_MASK = 0xfffff;

/**
 * A new Camera3D (`Camera3D.new()`): Godot's lens (75, 0.05, 4000) and cull mask.
 *
 * @godot Camera3D (protocol)
 * @source scene/3d/camera_3d.cpp:871
 */
export function construct(): PerspectiveCamera {
  const camera = new PerspectiveCamera(75, 1, 0.05, 4000);
  camera.layers.mask = DEFAULT_CULL_MASK;
  return camera;
}

/**
 * @godot Camera3D.set_cull_mask
 * @source scene/3d/camera_3d.cpp:764
 */
export function set_cull_mask(self: PerspectiveCamera, p_layers: number): void {
  self.layers.mask = p_layers >>> 0;
}

/**
 * @godot Camera3D.get_cull_mask
 * @source scene/3d/camera_3d.cpp:770
 */
export function get_cull_mask(self: PerspectiveCamera): number {
  return self.layers.mask >>> 0;
}

/**
 * A layer outside `1..20` fails and changes nothing.
 *
 * @godot Camera3D.set_cull_mask_value
 * @source scene/3d/camera_3d.cpp:774
 */
export function set_cull_mask_value(self: PerspectiveCamera, p_layer_number: number, p_value: boolean): void {
  if (p_layer_number < 1 || p_layer_number > 20) return;
  const bit = 1 << (p_layer_number - 1);
  set_cull_mask(self, p_value ? get_cull_mask(self) | bit : get_cull_mask(self) & ~bit);
}

/**
 * A layer outside `1..20` fails and reads false.
 *
 * @godot Camera3D.get_cull_mask_value
 * @source scene/3d/camera_3d.cpp:786
 */
export function get_cull_mask_value(self: PerspectiveCamera, p_layer_number: number): boolean {
  if (p_layer_number < 1 || p_layer_number > 20) return false;
  return (get_cull_mask(self) & (1 << (p_layer_number - 1))) !== 0;
}

/**
 * @godot Camera3D.make_current
 * @source scene/3d/camera_3d.cpp:365
 */
export function make_current(self: PerspectiveCamera): void {
  const state = stateOf(self);
  state.current = true;
  if (!is_inside_tree(self) || state.viewport === null) return;
  cameraSet(state.viewport, self);
}

/**
 * @godot Camera3D.clear_current
 * @source scene/3d/camera_3d.cpp:375
 */
export function clear_current(self: PerspectiveCamera, p_enable_next = true): void {
  const state = stateOf(self);
  state.current = false;
  if (!is_inside_tree(self) || state.viewport === null) return;
  if (camerasOf(state.viewport).camera === self) {
    cameraSet(state.viewport, null);
    if (p_enable_next) makeNextCurrent(state.viewport, self);
  }
}

/**
 * @godot Camera3D.set_current
 * @source scene/3d/camera_3d.cpp:390
 */
export function set_current(self: PerspectiveCamera, p_enabled: boolean): void {
  if (p_enabled) make_current(self);
  else clear_current(self);
}

/**
 * Inside the tree, whether the viewport draws with this camera; outside it, the stored flag.
 *
 * @godot Camera3D.is_current
 * @source scene/3d/camera_3d.cpp:398
 */
export function is_current(self: PerspectiveCamera): boolean {
  const state = stateOf(self);
  if (is_inside_tree(self) && state.viewport !== null) return camerasOf(state.viewport).camera === self;
  return state.current;
}

/**
 * The camera `viewport` draws with, or null (`Viewport::get_camera_3d`, `viewport.cpp:4742`).
 *
 * @godot Camera3D (protocol)
 * @source scene/main/viewport.cpp:4742
 */
export function godot_camera_3d_of_viewport(viewport: Object3D): PerspectiveCamera | null {
  return VIEWPORTS.get(viewport)?.camera ?? null;
}

/**
 * Hands `viewport`'s current camera to its renderer, now and whenever another becomes current
 * (`Viewport::_camera_3d_set`, `viewport.cpp:4766`, gives the renderer the camera it draws with);
 * the returned call ends it.
 *
 * @godot Camera3D (protocol)
 * @source scene/main/viewport.cpp:4766
 */
export function godot_camera_3d_attach_renderer(viewport: Object3D, draw: (camera: PerspectiveCamera) => void): () => void {
  RENDERERS.set(viewport, draw);
  const current = godot_camera_3d_of_viewport(viewport);
  if (current !== null) cameraSet(viewport, current);
  return () => {
    if (RENDERERS.get(viewport) === draw) RENDERERS.delete(viewport);
  };
}

/**
 * The viewport's size changed: its current camera's projection follows (the renderer computes the
 * projection from the viewport's size, `servers/rendering/renderer_viewport.cpp`).
 *
 * @godot Camera3D (protocol)
 * @source scene/3d/camera_3d.cpp:281
 */
export function godot_camera_3d_viewport_resized(viewport: Object3D): void {
  const camera = godot_camera_3d_of_viewport(viewport);
  if (camera !== null) writeProjection(camera, stateOf(camera));
}

/**
 * The camera the viewport draws with, else null.
 *
 * @godot Viewport.get_camera_3d
 * @source scene/main/viewport.cpp:4557
 */
export function get_camera_3d(self: object): PerspectiveCamera | null {
  return camerasOf(godot_node_entity(self) as Object3D).camera;
}
