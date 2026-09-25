/** Viewport rendering for the format-neutral spatial-handle contract. */

import type {
  SpatialDragHandle,
  SpatialHandleGuide,
  SpatialHandleLayer,
} from '@volter/editor-project/adapter';
import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import * as THREE from 'three';

export interface SpatialHandleBinding {
  readonly nodeId: string;
  readonly handle: SpatialDragHandle;
}

export interface SpatialHandleMesh extends THREE.Mesh {
  readonly isSpatialHandleMesh: true;
}

export interface SpatialHandleVisualSet {
  readonly roots: THREE.Object3D[];
  readonly handles: SpatialHandleMesh[];
}

const bindingByMesh = new WeakMap<SpatialHandleMesh, SpatialHandleBinding>();
const HANDLE_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);

function vector(value: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function lineMaterial(guide: SpatialHandleGuide): THREE.LineBasicMaterial {
  const options = {
    color: guide.color,
    transparent: true,
    opacity: guide.opacity ?? 0.68,
    depthTest: false,
  };
  return guide.dashed
    ? new THREE.LineDashedMaterial({ ...options, dashSize: 0.18, gapSize: 0.12 })
    : new THREE.LineBasicMaterial(options);
}

function addLine(
  root: THREE.Group,
  points: readonly THREE.Vector3[],
  material: THREE.LineBasicMaterial,
  closed = false,
): void {
  const linePoints = closed && points.length > 0 ? [...points, points[0]!] : [...points];
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePoints), material);
  line.renderOrder = 997;
  line.layers.set(EDITOR_LAYER);
  if (material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
  root.add(line);
}

function circlePoints(
  center: THREE.Vector3,
  radius: number,
  axisA: THREE.Vector3,
  axisB: THREE.Vector3,
  segments = 64,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(
      center
        .clone()
        .addScaledVector(axisA, Math.cos(angle) * radius)
        .addScaledVector(axisB, Math.sin(angle) * radius),
    );
  }
  return points;
}

function sphereGuide(guide: Extract<SpatialHandleGuide, { kind: 'sphere' }>): THREE.Group {
  const root = new THREE.Group();
  const center = vector(guide.center);
  const material = lineMaterial(guide);
  addLine(
    root,
    circlePoints(center, guide.radius, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)),
    material,
    true,
  );
  addLine(
    root,
    circlePoints(center, guide.radius, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
    material,
    true,
  );
  addLine(
    root,
    circlePoints(center, guide.radius, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)),
    material,
    true,
  );
  return root;
}

function lineGuide(guide: Extract<SpatialHandleGuide, { kind: 'line' }>): THREE.Group {
  const root = new THREE.Group();
  addLine(root, guide.points.map(vector), lineMaterial(guide));
  return root;
}

function coneGuide(guide: Extract<SpatialHandleGuide, { kind: 'cone' }>): THREE.Group {
  const root = new THREE.Group();
  const origin = vector(guide.origin);
  const direction = vector(guide.direction).normalize();
  const seed =
    Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(seed, direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const halfAngle = THREE.MathUtils.degToRad(Math.max(0, Math.min(360, guide.angle)) / 2);
  const material = lineMaterial(guide);
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const around = (i / 64) * Math.PI * 2;
    const radial = right
      .clone()
      .multiplyScalar(Math.cos(around))
      .addScaledVector(up, Math.sin(around));
    rim.push(
      origin
        .clone()
        .addScaledVector(direction, Math.cos(halfAngle) * guide.length)
        .addScaledVector(radial, Math.sin(halfAngle) * guide.length),
    );
  }
  addLine(root, rim, material, true);
  for (const index of [0, 16, 32, 48]) addLine(root, [origin, rim[index]!], material);
  return root;
}

function orientedPoint(
  local: THREE.Vector3,
  center: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
): THREE.Vector3 {
  return local.applyQuaternion(new THREE.Quaternion(...rotation)).add(new THREE.Vector3(...center));
}

function boxGuide(guide: Extract<SpatialHandleGuide, { kind: 'box' }>): THREE.Group {
  const root = new THREE.Group();
  const material = lineMaterial(guide);
  const [x, y, z] = guide.halfExtents;
  const corners = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ].map(([cx, cy, cz]) =>
    orientedPoint(new THREE.Vector3(cx, cy, cz), guide.center, guide.rotation),
  );
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ] as const) {
    addLine(root, [corners[a]!, corners[b]!], material);
  }
  return root;
}

function capsuleGuide(guide: Extract<SpatialHandleGuide, { kind: 'capsule' }>): THREE.Group {
  const root = new THREE.Group();
  const material = lineMaterial(guide);
  const rotate = new THREE.Quaternion(...guide.rotation);
  const center = vector(guide.center);
  const transform = (point: THREE.Vector3): THREE.Vector3 =>
    point.applyQuaternion(rotate).add(center);
  const circle = (y: number, axisA: THREE.Vector3, axisB: THREE.Vector3): THREE.Vector3[] =>
    circlePoints(new THREE.Vector3(0, y, 0), guide.radius, axisA, axisB).map(transform);
  addLine(
    root,
    circle(guide.halfHeight, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
    material,
    true,
  );
  addLine(
    root,
    circle(-guide.halfHeight, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
    material,
    true,
  );
  for (const [x, z] of [
    [guide.radius, 0],
    [-guide.radius, 0],
    [0, guide.radius],
    [0, -guide.radius],
  ]) {
    addLine(
      root,
      [
        transform(new THREE.Vector3(x, -guide.halfHeight, z)),
        transform(new THREE.Vector3(x, guide.halfHeight, z)),
      ],
      material,
    );
  }
  for (const axis of ['x', 'z'] as const) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * Math.PI;
      const point = new THREE.Vector3(0, guide.halfHeight + Math.sin(angle) * guide.radius, 0);
      point[axis] = Math.cos(angle) * guide.radius;
      points.push(transform(point));
    }
    for (let i = 0; i <= 32; i++) {
      const angle = Math.PI + (i / 32) * Math.PI;
      const point = new THREE.Vector3(0, -guide.halfHeight + Math.sin(angle) * guide.radius, 0);
      point[axis] = Math.cos(angle) * guide.radius;
      points.push(transform(point));
    }
    addLine(root, points, material);
  }
  return root;
}

function guideObject(guide: SpatialHandleGuide): THREE.Object3D {
  const root =
    guide.kind === 'line'
      ? lineGuide(guide)
      : guide.kind === 'sphere'
        ? sphereGuide(guide)
        : guide.kind === 'cone'
          ? coneGuide(guide)
          : guide.kind === 'box'
            ? boxGuide(guide)
            : capsuleGuide(guide);
  root.layers.set(EDITOR_LAYER);
  root.traverse((child) => child.layers.set(EDITOR_LAYER));
  return root;
}

function handleMesh(nodeId: string, handle: SpatialDragHandle): SpatialHandleMesh {
  const material = new THREE.MeshBasicMaterial({
    color: handle.color,
    depthTest: false,
    transparent: true,
    opacity: handle.writable ? 0.92 : 0.35,
  });
  const mesh = new THREE.Mesh(HANDLE_GEOMETRY, material) as unknown as SpatialHandleMesh;
  Object.defineProperty(mesh, 'isSpatialHandleMesh', { value: true });
  mesh.position.copy(vector(handle.position));
  mesh.renderOrder = 998;
  mesh.layers.set(EDITOR_LAYER);
  bindingByMesh.set(mesh, { nodeId, handle });
  return mesh;
}

export function createSpatialHandleVisuals(
  nodeId: string,
  layers: readonly SpatialHandleLayer[],
): SpatialHandleVisualSet {
  const roots: THREE.Object3D[] = [];
  const handles: SpatialHandleMesh[] = [];
  for (const layer of layers) {
    for (const guide of layer.guides) roots.push(guideObject(guide));
    for (const handle of layer.handles) {
      const mesh = handleMesh(nodeId, handle);
      roots.push(mesh);
      handles.push(mesh);
    }
  }
  return { roots, handles };
}

export function spatialHandleBinding(mesh: SpatialHandleMesh): SpatialHandleBinding | null {
  return bindingByMesh.get(mesh) ?? null;
}

export function setSpatialHandleHovered(mesh: SpatialHandleMesh, hovered: boolean): void {
  const binding = bindingByMesh.get(mesh);
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.color.set(
    hovered && binding?.handle.writable ? '#ffffff' : (binding?.handle.color ?? '#ffffff'),
  );
}

export function scaleSpatialHandle(mesh: SpatialHandleMesh, camera: THREE.Camera): void {
  const distance = mesh.position.distanceTo(camera.position);
  mesh.scale.setScalar(Math.max(0.025, distance * 0.012));
}

function disposeRenderable(
  child: THREE.Object3D,
  disposedGeometries: Set<THREE.BufferGeometry>,
  disposedMaterials: Set<THREE.Material>,
): void {
  const renderable = child as THREE.Line | THREE.Mesh;
  const geometry = renderable.geometry;
  if (geometry && geometry !== HANDLE_GEOMETRY && !disposedGeometries.has(geometry)) {
    geometry.dispose();
    disposedGeometries.add(geometry);
  }
  const materials = Array.isArray(renderable.material)
    ? renderable.material
    : renderable.material
      ? [renderable.material]
      : [];
  for (const material of materials) {
    if (disposedMaterials.has(material)) continue;
    material.dispose();
    disposedMaterials.add(material);
  }
}

export function disposeSpatialHandleVisuals(roots: readonly THREE.Object3D[]): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  for (const root of roots) {
    root.removeFromParent();
    root.traverse((child) => disposeRenderable(child, disposedGeometries, disposedMaterials));
  }
}
