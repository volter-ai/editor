import { BufferAttribute, BufferGeometry, PlaneGeometry, SphereGeometry } from 'three';
import { retainGodotMeshResource } from './mesh-instance';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export const GODOT_PLANE_ORIENTATION_FACE_X = 0;
export const GODOT_PLANE_ORIENTATION_FACE_Y = 1;
export const GODOT_PLANE_ORIENTATION_FACE_Z = 2;

interface SphereMeshState {
  radius: number;
  height: number;
  radialSegments: number;
  rings: number;
  hemisphere: boolean;
  flipFaces: boolean;
}

interface PlaneMeshState {
  size: { x: number; y: number };
  subdivideWidth: number;
  subdivideDepth: number;
  orientation: number;
  centerOffset: { x: number; y: number; z: number };
}

interface QuadMeshState {
  size: { x: number; y: number };
  orientation: number;
  centerOffset: { x: number; y: number; z: number };
  flipFaces: boolean;
}

const SPHERES = new WeakMap<BufferGeometry, SphereMeshState>();
const PLANES = new WeakMap<BufferGeometry, PlaneMeshState>();
const QUADS = new WeakMap<BufferGeometry, QuadMeshState>();
const POINTS = new WeakSet<BufferGeometry>();

function positive(value: number, member: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${member} requires a positive finite value.`);
  return value;
}

function segments(value: number, minimum: number, member: string): number {
  return Math.max(minimum, Math.trunc(positive(value, member)));
}

function finish(geometry: BufferGeometry, replacement: BufferGeometry): void {
  geometry.copy(replacement);
  replacement.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  godotResourceEmitChanged(geometry);
}

function orientPlane(geometry: BufferGeometry, orientation: number): void {
  if (orientation === GODOT_PLANE_ORIENTATION_FACE_Y) geometry.rotateX(-Math.PI / 2);
  else if (orientation === GODOT_PLANE_ORIENTATION_FACE_X) geometry.rotateY(Math.PI / 2);
}

function offsetGeometry(geometry: BufferGeometry, offset: Readonly<{ x: number; y: number; z: number }>): void {
  geometry.translate(offset.x, offset.y, offset.z);
}

function reverseFaces(geometry: BufferGeometry): void {
  const index = geometry.index;
  if (index) {
    for (let cursor = 0; cursor + 2 < index.count; cursor += 3) {
      const second = index.getX(cursor + 1);
      index.setX(cursor + 1, index.getX(cursor + 2));
      index.setX(cursor + 2, second);
    }
    index.needsUpdate = true;
  }
  const normal = geometry.getAttribute('normal');
  if (normal) {
    for (let index = 0; index < normal.count; index += 1) normal.setXYZ(index, -normal.getX(index), -normal.getY(index), -normal.getZ(index));
    normal.needsUpdate = true;
  }
}

function rebuildSphere(geometry: BufferGeometry, state: SphereMeshState): void {
  const thetaLength = state.hemisphere ? Math.PI / 2 : Math.PI;
  const replacement = new SphereGeometry(state.radius, state.radialSegments, state.rings, 0, Math.PI * 2, 0, thetaLength);
  replacement.scale(1, state.height / (state.radius * 2), 1);
  if (state.hemisphere) replacement.translate(0, -state.height * 0.5, 0);
  if (state.flipFaces) reverseFaces(replacement);
  finish(geometry, replacement);
}

export function createGodotSphereMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: SphereMeshState = { radius: 0.5, height: 1, radialSegments: 64, rings: 32, hemisphere: false, flipFaces: false };
  registerGodotObjectIdentity(geometry, 'SphereMesh'); SPHERES.set(geometry, state); rebuildSphere(geometry, state);
  return retainGodotMeshResource(geometry);
}

function sphere(value: unknown): { geometry: BufferGeometry; state: SphereMeshState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError('SphereMesh requires native THREE.BufferGeometry.');
  const state = SPHERES.get(value); if (!state) throw new TypeError('SphereMesh member requires a retained SphereMesh Resource.');
  return { geometry: value, state };
}

export function getGodotSphereMeshRadius(value: unknown): number { return sphere(value).state.radius; }
export function setGodotSphereMeshRadius(value: unknown, radius: number): void { const { geometry, state } = sphere(value); state.radius = positive(radius, 'SphereMesh.radius'); rebuildSphere(geometry, state); }
export function getGodotSphereMeshHeight(value: unknown): number { return sphere(value).state.height; }
export function setGodotSphereMeshHeight(value: unknown, height: number): void { const { geometry, state } = sphere(value); state.height = positive(height, 'SphereMesh.height'); rebuildSphere(geometry, state); }
export function getGodotSphereMeshRadialSegments(value: unknown): number { return sphere(value).state.radialSegments; }
export function setGodotSphereMeshRadialSegments(value: unknown, radialSegments: number): void { const { geometry, state } = sphere(value); state.radialSegments = segments(radialSegments, 3, 'SphereMesh.radial_segments'); rebuildSphere(geometry, state); }
export function getGodotSphereMeshRings(value: unknown): number { return sphere(value).state.rings; }
export function setGodotSphereMeshRings(value: unknown, rings: number): void { const { geometry, state } = sphere(value); state.rings = segments(rings, 2, 'SphereMesh.rings'); rebuildSphere(geometry, state); }
export function getGodotSphereMeshIsHemisphere(value: unknown): boolean { return sphere(value).state.hemisphere; }
export function setGodotSphereMeshIsHemisphere(value: unknown, hemisphere: boolean): void { const { geometry, state } = sphere(value); state.hemisphere = hemisphere; rebuildSphere(geometry, state); }
export function getGodotSphereMeshFlipFaces(value: unknown): boolean { return sphere(value).state.flipFaces; }
export function setGodotSphereMeshFlipFaces(value: unknown, flipFaces: boolean): void { const { geometry, state } = sphere(value); state.flipFaces = flipFaces; rebuildSphere(geometry, state); }

function rebuildPlane(geometry: BufferGeometry, state: PlaneMeshState): void {
  const replacement = new PlaneGeometry(state.size.x, state.size.y, state.subdivideWidth + 1, state.subdivideDepth + 1);
  orientPlane(replacement, state.orientation); offsetGeometry(replacement, state.centerOffset); finish(geometry, replacement);
}

export function createGodotPlaneMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: PlaneMeshState = { size: { x: 2, y: 2 }, subdivideWidth: 0, subdivideDepth: 0, orientation: GODOT_PLANE_ORIENTATION_FACE_Y, centerOffset: { x: 0, y: 0, z: 0 } };
  registerGodotObjectIdentity(geometry, 'PlaneMesh'); PLANES.set(geometry, state); rebuildPlane(geometry, state);
  return retainGodotMeshResource(geometry);
}

function plane(value: unknown): { geometry: BufferGeometry; state: PlaneMeshState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError('PlaneMesh requires native THREE.BufferGeometry.');
  const state = PLANES.get(value); if (!state) throw new TypeError('PlaneMesh member requires a retained PlaneMesh Resource.');
  return { geometry: value, state };
}

export function getGodotPlaneMeshSize(value: unknown): Readonly<{ x: number; y: number }> { return { ...plane(value).state.size }; }
export function setGodotPlaneMeshSize(value: unknown, size: Readonly<{ x: number; y: number }>): void { const { geometry, state } = plane(value); state.size = { x: positive(size.x, 'PlaneMesh.size.x'), y: positive(size.y, 'PlaneMesh.size.y') }; rebuildPlane(geometry, state); }
export function getGodotPlaneMeshSubdivideWidth(value: unknown): number { return plane(value).state.subdivideWidth; }
export function setGodotPlaneMeshSubdivideWidth(value: unknown, subdivisions: number): void { const { geometry, state } = plane(value); state.subdivideWidth = Math.max(0, Math.trunc(subdivisions)); rebuildPlane(geometry, state); }
export function getGodotPlaneMeshSubdivideDepth(value: unknown): number { return plane(value).state.subdivideDepth; }
export function setGodotPlaneMeshSubdivideDepth(value: unknown, subdivisions: number): void { const { geometry, state } = plane(value); state.subdivideDepth = Math.max(0, Math.trunc(subdivisions)); rebuildPlane(geometry, state); }
export function getGodotPlaneMeshOrientation(value: unknown): number { return plane(value).state.orientation; }
export function setGodotPlaneMeshOrientation(value: unknown, orientation: number): void { const { geometry, state } = plane(value); state.orientation = orientation; rebuildPlane(geometry, state); }
export function getGodotPlaneMeshCenterOffset(value: unknown): Readonly<{ x: number; y: number; z: number }> { return { ...plane(value).state.centerOffset }; }
export function setGodotPlaneMeshCenterOffset(value: unknown, offset: Readonly<{ x: number; y: number; z: number }>): void { const { geometry, state } = plane(value); state.centerOffset = { ...offset }; rebuildPlane(geometry, state); }

function rebuildQuad(geometry: BufferGeometry, state: QuadMeshState): void {
  const replacement = new PlaneGeometry(state.size.x, state.size.y, 1, 1);
  orientPlane(replacement, state.orientation); offsetGeometry(replacement, state.centerOffset); if (state.flipFaces) reverseFaces(replacement); finish(geometry, replacement);
}

export function createGodotQuadMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: QuadMeshState = { size: { x: 1, y: 1 }, orientation: GODOT_PLANE_ORIENTATION_FACE_Z, centerOffset: { x: 0, y: 0, z: 0 }, flipFaces: false };
  registerGodotObjectIdentity(geometry, 'QuadMesh'); QUADS.set(geometry, state); rebuildQuad(geometry, state);
  return retainGodotMeshResource(geometry);
}

function quad(value: unknown): { geometry: BufferGeometry; state: QuadMeshState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError('QuadMesh requires native THREE.BufferGeometry.');
  const state = QUADS.get(value); if (!state) throw new TypeError('QuadMesh member requires a retained QuadMesh Resource.');
  return { geometry: value, state };
}

export function getGodotQuadMeshSize(value: unknown): Readonly<{ x: number; y: number }> { return { ...quad(value).state.size }; }
export function setGodotQuadMeshSize(value: unknown, size: Readonly<{ x: number; y: number }>): void { const { geometry, state } = quad(value); state.size = { x: positive(size.x, 'QuadMesh.size.x'), y: positive(size.y, 'QuadMesh.size.y') }; rebuildQuad(geometry, state); }
export function getGodotQuadMeshOrientation(value: unknown): number { return quad(value).state.orientation; }
export function setGodotQuadMeshOrientation(value: unknown, orientation: number): void { const { geometry, state } = quad(value); state.orientation = orientation; rebuildQuad(geometry, state); }
export function getGodotQuadMeshCenterOffset(value: unknown): Readonly<{ x: number; y: number; z: number }> { return { ...quad(value).state.centerOffset }; }
export function setGodotQuadMeshCenterOffset(value: unknown, offset: Readonly<{ x: number; y: number; z: number }>): void { const { geometry, state } = quad(value); state.centerOffset = { ...offset }; rebuildQuad(geometry, state); }
export function getGodotQuadMeshFlipFaces(value: unknown): boolean { return quad(value).state.flipFaces; }
export function setGodotQuadMeshFlipFaces(value: unknown, flipFaces: boolean): void { const { geometry, state } = quad(value); state.flipFaces = flipFaces; rebuildQuad(geometry, state); }

export function createGodotPointMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0]), 2));
  registerGodotObjectIdentity(geometry, 'PointMesh'); POINTS.add(geometry);
  return retainGodotMeshResource(geometry);
}

export function isGodotPointMesh(value: unknown): value is BufferGeometry { return value instanceof BufferGeometry && POINTS.has(value); }
