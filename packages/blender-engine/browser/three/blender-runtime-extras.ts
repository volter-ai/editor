/**
 * BLENDER'S OVERLAY EXTRAS — how the 3D View draws the objects that have no surface: a camera,
 * a light, an empty. Transcribed from the overlay engine (`draw/engines/overlay/overlay_camera.hh`,
 * `overlay_light.hh`, `overlay_empty.hh`), its shapes (`overlay_shape.cc`) and the extra vertex
 * shaders (`overlay_extra_vert.glsl`, `overlay_extra_groundline_vert.glsl`).
 *
 * THE COLOUR is `object_wire_color`: the selection's orange for a selected object (the lighter
 * active one for the active object), else the type's theme colour — black for a camera, a light
 * and an empty in Blender 5.2's default theme, read back from the installed Blender. Lines are
 * one UI pixel wide.
 *
 * A CAMERA is its frame and the wires from the eye to its corners (`BKE_camera_view_frame_ex`
 * at the camera's display size, fitted to the render's shape), and a triangle over the frame,
 * filled for the scene's camera. Seen from its own eye (a camera view) its wires fall to points
 * and its frame on the view's border, and the triangle is not drawn, as Blender draws only the
 * frame there.
 *
 * A LIGHT is a screen-sized icon at its origin — a diamond and a dashed ring inside a dashed
 * outer ring, sun rays for a sun — a line down to the floor with a mark where it lands, in the
 * theme's light colour, and its shape in the world: a point light's radius as a circle facing
 * the view, a sun's direction line, an area light's square or disk, a spot's radius. A spot's
 * cone is not drawn.
 *
 * AN EMPTY is its display shape at its display size: plain axes, arrows (with their letters,
 * without the markers at their ends), a single arrow, a circle, a cube, a sphere or a cone. An
 * image empty is not drawn.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { z } from 'zod';
import type { CameraData } from './blender-runtime-camera-view';
import type { LightData } from './blender-runtime-lighting';

const scalar = z.number().finite();
/** `session.py`'s `frame["empties"]`. */
export const emptySchema = z.object({
  display: z.enum(['PLAIN_AXES', 'ARROWS', 'SINGLE_ARROW', 'CIRCLE', 'CUBE', 'SPHERE', 'CONE', 'IMAGE']),
  size: scalar,
});
export type EmptyData = z.infer<typeof emptySchema>;

/** Blender 5.2's default theme: `object_selected`, `object_active`, the types' wire colours and
 *  the light's (whose alpha the ground line keeps and the icon does not). */
const THEME = {
  selected: 0xed5700,
  active: 0xffa028,
  camera: 0x000000,
  light: 0x000000,
  lightAlpha: 0x50 / 255,
  empty: 0x000000,
} as const;

/** The icons' size unit: Blender's UI pixel (`theme.sizes.pixel`), one CSS pixel here. */
const LINE_WIDTH = 1;

type Segments = number[];
const seg = (out: Segments, a: readonly number[], b: readonly number[]) => out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);

/** `ring_vertices`: `n` points round a circle of radius `r`, from +X, in the XY plane. */
function ring(r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });
}
/** `append_line_loop`: every edge of the loop, or every other one when `dashed`. */
function loop(out: Segments, points: [number, number][], z = 0, dashed = false): void {
  const step = dashed ? 2 : 1;
  for (let i = 0; i < Math.floor(points.length / step); i++) {
    const a = points[(i * step) % points.length]!;
    const b = points[(i * step + 1) % points.length]!;
    seg(out, [a[0], a[1], z], [b[0], b[1], z]);
  }
}

/** One object's shapes in its own frame, the world, or on the screen. */
interface ObjectInput {
  readonly name: string;
  readonly type: string;
  readonly matrix: readonly (readonly number[])[];
  readonly selected: boolean;
  readonly light?: string | null | undefined;
}

export interface ExtrasInput {
  readonly objects: readonly ObjectInput[];
  readonly active: string | null;
  readonly cameras: Readonly<Record<string, CameraData>>;
  readonly lights: Readonly<Record<string, LightData>>;
  readonly empties: Readonly<Record<string, EmptyData>>;
  readonly sceneCamera: string | null;
  readonly renderAspect: number;
}

export class ExtrasOverlay {
  /** In Blender's frame; the view gives it the Blender → stage permutation. */
  readonly cameras = new THREE.Group();
  readonly lights = new THREE.Group();
  readonly empties = new THREE.Group();
  private readonly lineMaterials = new Map<string, LineMaterial>();
  /** Each object's drawing and what it was drawn from, so an unchanged object keeps its. */
  private readonly drawn = new Map<string, { key: string; parts: THREE.Object3D[] }>();
  private readonly fillMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly scratch = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private readonly parentQuat = new THREE.Quaternion();

  constructor() {
    this.cameras.name = 'BlenderCameras';
    this.lights.name = 'BlenderLights';
    this.empties.name = 'BlenderEmpties';
  }

  apply(input: ExtrasInput): void {
    const seen = new Set<string>();
    for (const object of input.objects) {
      const color = object.selected
        ? object.name === input.active
          ? THEME.active
          : THEME.selected
        : object.type === 'CAMERA'
          ? THEME.camera
          : object.type === 'LIGHT'
            ? THEME.light
            : THEME.empty;
      const camera = object.type === 'CAMERA' ? input.cameras[object.name] : undefined;
      const light = object.type === 'LIGHT' && object.light ? input.lights[object.light] : undefined;
      const empty = object.type === 'EMPTY' ? input.empties[object.name] : undefined;
      if (!camera && !light && !empty) continue;
      seen.add(object.name);
      const key = JSON.stringify([
        object.matrix,
        color,
        camera,
        light,
        empty,
        camera ? [object.name === input.sceneCamera, input.renderAspect] : null,
      ]);
      const previous = this.drawn.get(object.name);
      if (previous?.key === key) continue;
      if (previous) this.remove(previous.parts);
      const matrix = new THREE.Matrix4().set(...(object.matrix.flat() as Parameters<THREE.Matrix4['set']>));
      const group = camera ? this.cameras : light ? this.lights : this.empties;
      const before = new Set(group.children);
      if (camera) this.camera(camera, matrix, color, object.name === input.sceneCamera, input.renderAspect);
      else if (light) this.light(light, matrix, color);
      else if (empty) this.empty(empty, matrix, color);
      this.drawn.set(object.name, { key, parts: group.children.filter((child) => !before.has(child)) });
    }
    for (const [name, entry] of this.drawn)
      if (!seen.has(name)) {
        this.remove(entry.parts);
        this.drawn.delete(name);
      }
  }

  private remove(parts: readonly THREE.Object3D[]): void {
    for (const part of parts) {
      part.removeFromParent();
      (part as THREE.Mesh).geometry?.dispose();
    }
  }

  /** `object_sync_extras` in `overlay_camera.hh`, with `BKE_camera_view_frame_ex`. */
  private camera(camera: CameraData, matrix: THREE.Matrix4, color: number, active: boolean, renderAspect: number): void {
    const drawsize = camera.display_size;
    const horizontal = camera.sensor_fit === 'AUTO' ? renderAspect >= 1 : camera.sensor_fit === 'HORIZONTAL';
    const aspect = horizontal ? [1, 1 / renderAspect] : [renderAspect, 1];
    let half: number;
    let depth: number;
    let fac: [number, number];
    let shift: [number, number];
    if (camera.type === 'ORTHO') {
      fac = [0.5 * camera.ortho_scale * aspect[0]!, 0.5 * camera.ortho_scale * aspect[1]!];
      shift = [camera.shift_x * camera.ortho_scale, camera.shift_y * camera.ortho_scale];
      depth = -drawsize;
      half = 0.5 * camera.ortho_scale;
    } else {
      const halfSensor = 0.5 * (camera.sensor_fit === 'VERTICAL' ? camera.sensor_height : camera.sensor_width);
      // A scaled camera draws larger: the overlay hands the frame function `1 / scale` and scales
      // its corners back, which leaves the size divided by the mean of `1 / scale`.
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      if (scale.x === 0 || scale.y === 0 || scale.z === 0) return;
      half = drawsize / 2 / ((1 / scale.x + 1 / scale.y + 1 / scale.z) / 3);
      depth = (half * camera.lens) / -halfSensor;
      fac = [half * aspect[0]!, half * aspect[1]!];
      shift = [camera.shift_x * half * 2, camera.shift_y * half * 2];
    }
    const corners = [
      [shift[0] + fac[0], shift[1] + fac[1], depth],
      [shift[0] + fac[0], shift[1] - fac[1], depth],
      [shift[0] - fac[0], shift[1] - fac[1], depth],
      [shift[0] - fac[0], shift[1] + fac[1], depth],
    ];
    const lines: Segments = [];
    for (let i = 0; i < 4; i++) {
      seg(lines, corners[i]!, corners[(i + 1) % 4]!);
      seg(lines, corners[i]!, [0, 0, 0]);
    }
    // The triangle over the frame: `0.7` and `0.1` of the drawn size, in the frame's plane.
    const size = 0.7 * half;
    const margin = 0.1 * half;
    const base = shift[1] + fac[1] + margin;
    const tri = [
      [shift[0] - size, base, depth],
      [shift[0] + size, base, depth],
      [shift[0], base + size, depth],
    ];
    const pose = unscaled(matrix);
    this.cameras.add(this.lines(lines, color, 1, pose));
    let triangle: THREE.Object3D;
    if (active) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat(), 3));
      triangle = new THREE.Mesh(geometry, this.fill(color));
      triangle.matrixAutoUpdate = false;
      triangle.matrix.copy(pose);
    } else {
      const wire: Segments = [];
      for (let i = 0; i < 3; i++) seg(wire, tri[i]!, tri[(i + 1) % 3]!);
      triangle = this.lines(wire, color, 1, pose);
    }
    // Hidden from the camera's own eye: the triangle is the one part a camera view would show.
    const eye = new THREE.Vector3();
    const own = triangle.onBeforeRender.bind(triangle);
    triangle.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      eye.setFromMatrixPosition(pose).applyMatrix4(this.cameras.matrixWorld);
      const seen = camera.getWorldPosition(this.scratch).distanceToSquared(eye) > 1e-8;
      triangle.matrix.copy(pose);
      if (!seen) triangle.matrix.scale(new THREE.Vector3(0, 0, 0));
      triangle.updateMatrixWorld(true);
      own(renderer, scene, camera, geometry, material, group);
    };
    this.cameras.add(triangle);
  }

  /** `overlay_light.hh` with its icon, ground line and type shapes. */
  private light(light: LightData, matrix: THREE.Matrix4, color: number): void {
    const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
    // The ground line, from the light straight down to the floor, and its mark there.
    const ground: Segments = [];
    seg(ground, [origin.x, origin.y, origin.z], [origin.x, origin.y, 0]);
    this.lights.add(this.lines(ground, THEME.light, THEME.lightAlpha, new THREE.Matrix4()));
    const mark: Segments = [];
    loop(mark, ring(1.35, 4));
    this.lights.add(this.screen(mark, THEME.light, THEME.lightAlpha, new THREE.Vector3(origin.x, origin.y, 0)));
    // The icon: the diamond and dashed ring (inner), the dashed outer ring, a sun's rays.
    const icon: Segments = [];
    const r = 9;
    loop(icon, ring(r * 0.3, 4));
    loop(icon, ring(r, 16), 0, true);
    loop(icon, ring(r * 1.33, 20), 0, true);
    if (light.type === 'SUN')
      for (const [x, y] of ring(r, 8)) {
        seg(icon, [x * 1.6, y * 1.6, 0], [x * 1.9, y * 1.9, 0]);
        seg(icon, [x * 2.2, y * 2.2, 0], [x * 2.5, y * 2.5, 0]);
      }
    this.lights.add(this.screen(icon, color, 1, origin));
    // The shape the light has in the world.
    const pose = unscaled(matrix);
    const world: Segments = [];
    if (light.type === 'SUN') seg(world, [0, 0, 0], [0, 0, -20]);
    else if (light.type === 'AREA') {
      const sx = (light.size ?? 1) / 2;
      const sy = (light.shape === 'RECTANGLE' || light.shape === 'ELLIPSE' ? (light.size_y ?? light.size ?? 1) : (light.size ?? 1)) / 2;
      if (light.shape === 'DISK' || light.shape === 'ELLIPSE')
        loop(world, ring(1, 32).map(([x, y]) => [x * sx, y * sy]));
      else loop(world, [[sx, sy], [-sx, sy], [-sx, -sy], [sx, -sy]]);
    }
    if (world.length > 0) this.lights.add(this.lines(world, color, 1, matrix.clone()));
    if ((light.type === 'POINT' || light.type === 'SPOT') && (light.radius ?? 0) > 0) {
      const circle: Segments = [];
      loop(circle, ring(light.radius!, 32));
      this.lights.add(this.facing(circle, color, new THREE.Vector3().setFromMatrixPosition(pose)));
    }
  }

  /** `overlay_empty.hh`'s shapes, at the empty's display size in its own frame. */
  private empty(empty: EmptyData, matrix: THREE.Matrix4, color: number): void {
    const s = empty.size;
    const lines: Segments = [];
    const circle = (plane: 'xy' | 'xz' | 'yz', n: number) => {
      const points = ring(1, n);
      for (let i = 0; i < n; i++) {
        const [ax, ay] = points[i]!;
        const [bx, by] = points[(i + 1) % n]!;
        const at = (x: number, y: number) => (plane === 'xy' ? [x, y, 0] : plane === 'xz' ? [x, 0, y] : [0, x, y]);
        seg(lines, at(ax, ay), at(bx, by));
      }
    };
    switch (empty.display) {
      case 'PLAIN_AXES':
        seg(lines, [0, -1, 0], [0, 1, 0]);
        seg(lines, [-1, 0, 0], [1, 0, 0]);
        seg(lines, [0, 0, -1], [0, 0, 1]);
        break;
      case 'SINGLE_ARROW': {
        seg(lines, [0, 0, 0], [0, 0, 0.75]);
        for (const [x, y] of [[0.035, 0.035], [-0.035, 0.035], [-0.035, -0.035], [0.035, -0.035]] as const) {
          seg(lines, [0, 0, 1], [x, y, 0.75]);
        }
        loop(lines, [[0.035, 0.035], [-0.035, 0.035], [-0.035, -0.035], [0.035, -0.035]], 0.75);
        break;
      }
      case 'CUBE':
        for (const [a, b] of CUBE_EDGES) seg(lines, CUBE[a]!, CUBE[b]!);
        break;
      case 'CIRCLE':
        circle('xz', 64);
        break;
      case 'SPHERE':
        circle('xy', 32);
        circle('xz', 32);
        circle('yz', 32);
        break;
      case 'CONE': {
        const points = ring(1, 8);
        for (let i = 0; i < 8; i++) {
          const [x, y] = points[i]!;
          const [nx, ny] = points[(i + 1) % 8]!;
          seg(lines, [x, 0, y], [0, 2, 0]);
          seg(lines, [x, 0, y], [nx, 0, ny]);
        }
        break;
      }
      case 'ARROWS':
        for (let axis = 0; axis < 3; axis++) {
          const end = [0, 0, 0];
          end[axis] = 1;
          seg(lines, [0, 0, 0], end);
        }
        break;
      case 'IMAGE':
        return;
    }
    const pose = matrix.clone().multiply(new THREE.Matrix4().makeScale(s, s, s));
    this.empties.add(this.lines(lines, color, 1, pose));
    if (empty.display === 'ARROWS') this.axisNames(matrix, s, color);
  }

  /** The arrows' X, Y and Z, drawn as lines facing the view at 1.25 of each axis. */
  private axisNames(matrix: THREE.Matrix4, size: number, color: number): void {
    const axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    matrix.extractBasis(axes[0]!, axes[1]!, axes[2]!);
    for (let axis = 0; axis < 3; axis++) {
      const length = axes[axis]!.length() * size;
      const at = new THREE.Vector3(0, 0, 0);
      at.setComponent(axis, 1.25 * size);
      at.applyMatrix4(matrix);
      const name = AXIS_NAMES[axis]!;
      const out: Segments = [];
      for (let i = 0; i + 1 < name.length; i += 2) {
        const [ax, ay] = name[i]!;
        const [bx, by] = name[i + 1]!;
        seg(out, [ax * 4 * length, ay * 4 * length, 0], [bx * 4 * length, by * 4 * length, 0]);
      }
      this.empties.add(this.facing(out, color, at));
    }
  }

  private material(color: number, opacity: number): LineMaterial {
    const key = `${color}:${opacity}`;
    let material = this.lineMaterials.get(key);
    if (!material) {
      material = new LineMaterial({
        color,
        linewidth: LINE_WIDTH,
        transparent: opacity < 1,
        opacity,
        depthTest: true,
        depthWrite: opacity >= 1,
        toneMapped: false,
      });
      this.lineMaterials.set(key, material);
    }
    return material;
  }

  private fill(color: number): THREE.MeshBasicMaterial {
    let material = this.fillMaterials.get(color);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
      this.fillMaterials.set(color, material);
    }
    return material;
  }

  /** World lines under `pose`. */
  private lines(segments: Segments, color: number, opacity: number, pose: THREE.Matrix4): LineSegments2 {
    const geometry = new LineSegmentsGeometry().setPositions(segments);
    const lines = new LineSegments2(geometry, this.material(color, opacity));
    lines.matrixAutoUpdate = false;
    lines.matrix.copy(pose);
    lines.computeLineDistances();
    return lines;
  }

  /** Lines in UI pixels on a plane facing the view, at `at` (`VCLASS_SCREENSPACE`). */
  private screen(segments: Segments, color: number, opacity: number, at: THREE.Vector3): LineSegments2 {
    const lines = this.lines(segments, color, opacity, new THREE.Matrix4());
    lines.matrixAutoUpdate = true;
    lines.position.copy(at);
    this.onDraw(lines, (renderer, camera) => this.face(lines, renderer, camera, true));
    return lines;
  }

  /** Lines in world units on a plane facing the view, at `at` (`VCLASS_SCREENALIGNED`). */
  private facing(segments: Segments, color: number, at: THREE.Vector3): LineSegments2 {
    const lines = this.lines(segments, color, 1, new THREE.Matrix4());
    lines.matrixAutoUpdate = true;
    lines.position.copy(at);
    this.onDraw(lines, (renderer, camera) => this.face(lines, renderer, camera, false));
    return lines;
  }

  /** Run `fit` before each draw, after `LineSegments2`'s own (which gives the material the
   *  viewport's resolution). */
  private onDraw(lines: LineSegments2, fit: (renderer: THREE.WebGLRenderer, camera: THREE.Camera) => void): void {
    // `LineSegments2`'s typings declare its draw hook with the renderer alone; it is Object3D's.
    const target: THREE.Object3D = lines;
    const own = target.onBeforeRender.bind(target);
    target.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      fit(renderer, camera);
      own(renderer, scene, camera, geometry, material, group);
    };
  }

  /** Turn `lines` to the view and, for a screen-space shape, size one unit to one UI pixel. */
  private face(lines: THREE.Object3D, renderer: THREE.WebGLRenderer, camera: THREE.Camera, pixels: boolean): void {
    lines.parent?.getWorldQuaternion(this.parentQuat).invert();
    camera.getWorldQuaternion(lines.quaternion).premultiply(this.parentQuat);
    let scale = 1;
    if (pixels) {
      renderer.getSize(this.size);
      const height = Math.max(this.size.y, 1);
      const at = this.scratch.setFromMatrixPosition(lines.matrixWorld);
      if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
        const ortho = camera as THREE.OrthographicCamera;
        scale = (ortho.top - ortho.bottom) / ortho.zoom / height;
      } else {
        const perspective = camera as THREE.PerspectiveCamera;
        const depth = Math.max(-at.applyMatrix4(camera.matrixWorldInverse).z, 1e-6);
        scale = (2 * depth * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2)) / perspective.zoom / height;
      }
      // The parent carries the permutation, a rotation: its scale is 1.
    }
    lines.scale.setScalar(scale);
    lines.updateMatrixWorld(true);
  }

  dispose(): void {
    for (const entry of this.drawn.values()) this.remove(entry.parts);
    this.drawn.clear();
    for (const material of this.lineMaterials.values()) material.dispose();
    for (const material of this.fillMaterials.values()) material.dispose();
    this.lineMaterials.clear();
    this.fillMaterials.clear();
  }
}

/** The object's rotation and position, its scale taken out (`overlay_camera.hh` normalises). */
function unscaled(matrix: THREE.Matrix4): THREE.Matrix4 {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
}

const CUBE: readonly (readonly number[])[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
];

/** The arrows' letters (`overlay_shape.cc`, `x/y/z_axis_name`), as line pairs. */
const AXIS_NAMES: readonly (readonly (readonly [number, number])[])[] = [
  [[0.9, 1], [-1, -1], [-0.9, 1], [1, -1]].map(([x, y]) => [x! * 0.0215, y! * 0.025] as const),
  [[-1, 1], [0, -0.1], [1, 1], [0, -0.1], [0, -0.1], [0, -1]].map(([x, y]) => [x! * 0.0175, y! * 0.025] as const),
  [
    [-0.95, 1], [0.95, 1], [0.95, 1], [0.95, 0.9], [0.95, 0.9], [-1, -0.9], [-1, -0.9], [-1, -1], [-1, -1], [1, -1],
  ].map(([x, y]) => [x! * 0.02, y! * 0.025] as const),
];
