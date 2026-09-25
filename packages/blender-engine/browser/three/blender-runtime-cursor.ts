/**
 * THE 3D CURSOR — `Scene.cursor`, drawn the way Blender's overlay engine draws
 * it (`draw/engines/overlay/overlay_cursor.hh`, shapes in `overlay_shape.cc`
 * "cursor circle" / "cursor lines", read at the engine's pin).
 *
 * TWO SHAPES, both one `U.widget_unit` (20 CSS px) across whatever the zoom:
 *
 * - THE RING is screen space: a 12-segment circle of radius 0.5, segments
 *   alternating red `(1, 0, 0)` and white, one pixel wide.
 * - THE AXIS LINES are drawn IN 3D along the cursor's own rotation, scaled by
 *   the pixel size at the cursor (`ED_view3d_pixel_size_no_ui_scale`): per
 *   axis, black (`TH_VIEW_OVERLAY`) from 0.25 to 0.85 and the theme's axis
 *   colour from 0.85 to 1; the negative half's colour is the axis blended a
 *   quarter to white and shaded −60 (`get_color_blend_shade_3fv`).
 *
 * Here the ring faces the camera at the cursor's depth rather than being
 * drawn in pixel space; at a 20 px size the two are the same picture.
 *
 * PLACEMENT is `view3d.cursor3d` as Shift+Right-click runs it
 * (`space_view3d/view3d_edit.cc`): `use_depth` projects onto the surface under
 * the pointer and, with nothing there, onto the view plane through the current
 * cursor; `orientation` VIEW turns the cursor to the view (`rv3d->viewquat`
 * with its w negated — the view's own rotation). Blender pushes no undo step
 * for it (the operator's `OPTYPE_UNDO` is commented out), and neither does
 * the caller.
 */
import * as THREE from 'three';
import { z } from 'zod';

const scalar = z.number().finite();
/** `session.py`'s `frame["cursor"]`: `Scene.cursor.matrix`, row-major. */
export const cursorSchema = z.array(z.tuple([scalar, scalar, scalar, scalar])).length(4);
export type BlenderCursor = z.infer<typeof cursorSchema>;

/** `U.widget_unit` at a UI scale of 1, in CSS px. */
const WIDGET_UNIT = 20;

/** The default theme's axis colours (`userdef_default_theme.c` `xaxis`/`yaxis`/`zaxis`). */
const AXES = [0xff3352, 0x8bdc00, 0x2890ff] as const;

function negativeShade(hex: number): THREE.Color {
  const channel = (value: number) => Math.min(255, Math.max(0, Math.floor(0.75 * value + 0.25 * 255) - 60)) / 255;
  return new THREE.Color().setRGB(channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255), THREE.SRGBColorSpace);
}

function lineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
}

function axisLines(): THREE.LineSegments {
  const positions: number[] = [];
  const colors: number[] = [];
  const black = new THREE.Color(0, 0, 0);
  const push = (from: number, to: number, axis: number, sign: number, color: THREE.Color) => {
    for (const at of [from, to]) {
      const point = [0, 0, 0];
      point[axis] = at * sign;
      positions.push(...point);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let axis = 0; axis < 3; axis++) {
    const positive = new THREE.Color().setHex(AXES[axis]!, THREE.SRGBColorSpace);
    push(1, 0.85, axis, 1, positive);
    push(0.85, 0.25, axis, 1, black);
    push(1, 0.85, axis, -1, negativeShade(AXES[axis]!));
    push(0.85, 0.25, axis, -1, black);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.LineSegments(geometry, lineMaterial());
}

function ring(): THREE.LineSegments {
  const segments = 12;
  const positions: number[] = [];
  const colors: number[] = [];
  const red = new THREE.Color(1, 0, 0);
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < segments; i++) {
    // Blender's strip is flat-coloured, so each segment wears one vertex's colour.
    const color = i % 2 === 0 ? white : red;
    for (const k of [i, i + 1]) {
      const angle = (2 * Math.PI * k) / segments;
      positions.push(0.5 * Math.cos(angle), 0.5 * Math.sin(angle), 0);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.LineSegments(geometry, lineMaterial());
}

/** The cursor placed by a click, in Blender's own frame. */
export interface CursorPlacement {
  readonly location: readonly [number, number, number];
  /** `(w, x, y, z)`. */
  readonly rotation: readonly [number, number, number, number];
}

export class CursorOverlay {
  /** Carries the Blender → document permutation from its parent; see the view.
   *  Its `visible` is the view's (a render stands it down); whether there is a
   *  cursor to draw is the shapes' own. */
  readonly group = new THREE.Group();
  private readonly anchor = new THREE.Group();
  private readonly lines = axisLines();
  private readonly circle = ring();
  /** What the cursor was last drawn with: placement reads the view the person sees. */
  private seen: { camera: THREE.Camera; canvas: HTMLCanvasElement } | null = null;
  private readonly size = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly parentQuat = new THREE.Quaternion();

  constructor() {
    this.group.name = 'BlenderCursor';
    this.present(false);
    this.anchor.matrixAutoUpdate = false;
    this.group.add(this.anchor, this.circle);
    this.anchor.add(this.lines);
    for (const shape of [this.lines, this.circle]) {
      shape.renderOrder = 1001;
      shape.frustumCulled = false;
    }
    this.lines.onBeforeRender = (renderer, _scene, camera) => this.fit(renderer, camera);
    this.circle.onBeforeRender = (renderer, _scene, camera) => this.fit(renderer, camera);
  }

  /** Show the frame's cursor; an engine that sends none draws none. */
  apply(cursor: BlenderCursor | undefined): void {
    if (cursor === undefined) {
      this.present(false);
      return;
    }
    this.anchor.matrix.set(...(cursor.flat() as Parameters<THREE.Matrix4['set']>));
    this.anchor.updateMatrixWorld(true);
    this.present(true);
  }

  private present(shown: boolean): void {
    this.anchor.visible = shown;
    this.circle.visible = shown;
  }

  /** Move the drawn cursor ahead of the engine's frame, which then confirms it. */
  show(placement: CursorPlacement): void {
    const [w, x, y, z] = placement.rotation;
    this.anchor.matrix.compose(
      new THREE.Vector3(...placement.location),
      new THREE.Quaternion(x, y, z, w),
      new THREE.Vector3(1, 1, 1),
    );
    this.anchor.updateMatrixWorld(true);
    this.present(true);
  }

  /** One widget unit at the cursor's depth, for the camera drawing it now. */
  private fit(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.seen = { camera, canvas: renderer.domElement };
    renderer.getSize(this.size);
    const height = Math.max(this.size.y, 1);
    const at = this.scratch.setFromMatrixPosition(this.anchor.matrixWorld);
    let perPixel: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      perPixel = (ortho.top - ortho.bottom) / ortho.zoom / height;
    } else {
      const perspective = camera as THREE.PerspectiveCamera;
      const depth = Math.max(-at.applyMatrix4(camera.matrixWorldInverse).z, 1e-6);
      perPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2)) / perspective.zoom / height;
    }
    const scale = perPixel * WIDGET_UNIT;
    this.lines.scale.setScalar(scale);
    this.lines.updateMatrixWorld(true);
    // The ring faces the camera: its world rotation is the camera's.
    this.circle.position.setFromMatrixPosition(this.anchor.matrix);
    this.group.getWorldQuaternion(this.parentQuat).invert();
    camera.getWorldQuaternion(this.circle.quaternion).premultiply(this.parentQuat);
    this.circle.scale.setScalar(scale);
    this.circle.updateMatrixWorld(true);
  }

  /**
   * Where Shift+Right-click at `clientX/clientY` puts the cursor, or null when
   * the point is not on the view the cursor was last drawn in. `model` is the
   * presented model root, whose local frame is Blender's.
   */
  placementAt(clientX: number, clientY: number, target: EventTarget | null, model: THREE.Object3D): CursorPlacement | null {
    const seen = this.seen;
    if (seen === null || target !== seen.canvas) return null;
    const rect = seen.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, seen.camera);
    const shown = (object: THREE.Object3D | null): boolean => {
      for (let at = object; at !== null; at = at.parent) if (!at.visible) return false;
      return true;
    };
    const hit = raycaster
      .intersectObject(model, true)
      .find((one) => (one.object as THREE.Mesh).isMesh && shown(one.object));
    let world: THREE.Vector3 | null = hit ? hit.point.clone() : null;
    if (world === null) {
      // No surface: the view plane through the current cursor.
      const through = new THREE.Vector3().setFromMatrixPosition(this.anchor.matrixWorld);
      const normal = seen.camera.getWorldDirection(new THREE.Vector3());
      world = raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through), new THREE.Vector3());
    }
    if (world === null) return null;
    model.updateWorldMatrix(true, false);
    const local = model.worldToLocal(world);
    const rotation = model
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(seen.camera.getWorldQuaternion(new THREE.Quaternion()));
    return { location: [local.x, local.y, local.z], rotation: [rotation.w, rotation.x, rotation.y, rotation.z] };
  }

  dispose(): void {
    for (const shape of [this.lines, this.circle]) {
      shape.geometry.dispose();
      (shape.material as THREE.Material).dispose();
    }
    this.seen = null;
  }
}
