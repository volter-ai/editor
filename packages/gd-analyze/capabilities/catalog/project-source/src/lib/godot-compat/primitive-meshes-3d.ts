import {
  BufferGeometry,
  Float32BufferAttribute,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { retainGodotMeshResource } from './mesh-instance';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export interface GodotMeshVector2 {
  readonly x: number;
  readonly y: number;
}

interface PlaneState {
  kind: 'plane';
  size: GodotMeshVector2;
  subdivideWidth: number;
  subdivideDepth: number;
  centerOffset: { x: number; y: number; z: number };
  orientation: number;
  flipFaces: boolean;
}

export interface GodotPlaneMeshOptions {
  readonly size?: GodotMeshVector2;
  readonly subdivideWidth?: number;
  readonly subdivideDepth?: number;
  readonly centerOffset?: { readonly x: number; readonly y: number; readonly z: number };
  readonly flipFaces?: boolean;
}

interface QuadState {
  kind: 'quad';
  size: GodotMeshVector2;
  subdivideWidth: number;
  subdivideHeight: number;
  centerOffset: { x: number; y: number; z: number };
  orientation: number;
  flipFaces: boolean;
}

interface SphereState {
  kind: 'sphere';
  radius: number;
  height: number;
  radialSegments: number;
  rings: number;
  isHemisphere: boolean;
}

interface TorusState {
  kind: 'torus';
  innerRadius: number;
  outerRadius: number;
  rings: number;
  ringSegments: number;
}

type PrimitiveState = PlaneState | QuadState | SphereState | TorusState;
const STATES = new WeakMap<BufferGeometry, PrimitiveState>();

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`godot-compat: ${member} requires a finite value.`);
  return value;
}

function positive(value: unknown, member: string): number {
  const number = finite(value, member);
  if (number <= 0)
    throw new RangeError(`godot-compat: ${member} requires a value greater than zero.`);
  return number;
}

function subdivision(value: unknown, member: string, minimum = 0): number {
  const number = finite(value, member);
  if (!Number.isSafeInteger(number) || number < minimum || number > 4096) {
    throw new RangeError(`godot-compat: ${member} requires an integer in [${minimum}, 4096].`);
  }
  return number;
}

function vector2(value: unknown, member: string): GodotMeshVector2 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) {
    throw new TypeError(`godot-compat: ${member} requires Vector2.`);
  }
  return Object.freeze({
    x: positive(value.x, `${member}.x`),
    y: positive(value.y, `${member}.y`),
  });
}

function planeVector2(value: unknown, member: string): GodotMeshVector2 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) {
    throw new TypeError(`godot-compat: ${member} requires Vector2.`);
  }
  return Object.freeze({ x: finite(value.x, `${member}.x`), y: finite(value.y, `${member}.y`) });
}

function planeSubdivision(value: unknown, member: string): number {
  const number = finite(value, member);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`godot-compat: ${member} requires an integer.`);
  }
  return Math.max(0, number);
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ${member} requires bool.`);
  return value;
}

function vector3(value: unknown, member: string): { x: number; y: number; z: number } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('x' in value) ||
    !('y' in value) ||
    !('z' in value)
  ) {
    throw new TypeError(`godot-compat: ${member} requires Vector3.`);
  }
  return Object.freeze({
    x: finite(value.x, `${member}.x`),
    y: finite(value.y, `${member}.y`),
    z: finite(value.z, `${member}.z`),
  });
}

function stateOf<TKind extends PrimitiveState['kind']>(
  geometry: unknown,
  kind: TKind,
): Extract<PrimitiveState, { kind: TKind }> {
  if (!(geometry instanceof BufferGeometry))
    throw new TypeError(`godot-compat: ${kind} mesh requires native BufferGeometry.`);
  const state = STATES.get(geometry);
  if (state?.kind !== kind)
    throw new TypeError(`godot-compat: member requires a retained ${kind} mesh Resource.`);
  return state as Extract<PrimitiveState, { kind: TKind }>;
}

function replace(
  geometry: BufferGeometry,
  replacement: BufferGeometry,
  offset: { x: number; y: number; z: number },
): void {
  replacement.translate(offset.x, offset.y, offset.z);
  geometry.copy(replacement);
  replacement.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  godotResourceEmitChanged(geometry);
}

function rebuildPlane(geometry: BufferGeometry, state: PlaneState): void {
  let native: BufferGeometry;
  if (state.orientation === 0) {
    const columns = state.subdivideWidth + 2;
    const rows = state.subdivideDepth + 2;
    const positions: number[] = [];
    const normals: number[] = [];
    const tangents: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const normalY = state.flipFaces ? -1 : 1;
    for (let j = 0; j < rows; j += 1) {
      const v = j / (state.subdivideDepth + 1);
      const z = -state.size.y / 2 + v * state.size.y;
      for (let i = 0; i < columns; i += 1) {
        const u = i / (state.subdivideWidth + 1);
        const x = -state.size.x / 2 + u * state.size.x;
        positions.push(-x, 0, -z);
        normals.push(0, normalY, 0);
        tangents.push(1, 0, 0, 1);
        uvs.push(1 - u, 1 - v);
        if (i > 0 && j > 0) {
          const previousRow = (j - 1) * columns;
          const thisRow = j * columns;
          const triangles = [
            previousRow + i - 1,
            previousRow + i,
            thisRow + i - 1,
            previousRow + i,
            thisRow + i,
            thisRow + i - 1,
          ];
          for (let triangle = 0; triangle < triangles.length; triangle += 3) {
            let a = triangles[triangle]!;
            let b = triangles[triangle + 1]!;
            const c = triangles[triangle + 2]!;
            if (state.flipFaces) [a, b] = [b, a];
            // VisualServer consumes Godot's clockwise list. Three consumes counter-clockwise.
            indices.push(a, c, b);
          }
        }
      }
    }
    native = new BufferGeometry();
    native.setIndex(indices);
    native.setAttribute('position', new Float32BufferAttribute(positions, 3));
    native.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    native.setAttribute('tangent', new Float32BufferAttribute(tangents, 4));
    native.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  } else {
    // Non-default orientation is the Godot 4-only PlaneMesh surface retained by this module.
    native = new PlaneGeometry(
      state.size.x,
      state.size.y,
      state.subdivideWidth + 1,
      state.subdivideDepth + 1,
    );
    if (state.orientation === 2) native.rotateY(Math.PI / 2);
    if (state.flipFaces) native.scale(-1, 1, 1);
  }
  replace(geometry, native, state.centerOffset);
}

function rebuildQuad(geometry: BufferGeometry, state: QuadState): void {
  const native = new PlaneGeometry(
    state.size.x,
    state.size.y,
    state.subdivideWidth + 1,
    state.subdivideHeight + 1,
  );
  if (state.orientation === 1) native.rotateX(-Math.PI / 2);
  if (state.flipFaces) native.scale(-1, 1, 1);
  replace(geometry, native, state.centerOffset);
}

function rebuildSphere(geometry: BufferGeometry, state: SphereState): void {
  const phiLength = Math.PI * 2;
  const thetaStart = state.isHemisphere ? 0 : 0;
  const thetaLength = state.isHemisphere ? Math.PI / 2 : Math.PI;
  const native = new SphereGeometry(
    state.radius,
    state.radialSegments,
    state.rings,
    0,
    phiLength,
    thetaStart,
    thetaLength,
  );
  const yScale = state.height / (state.radius * 2);
  native.scale(1, yScale, 1);
  if (state.isHemisphere) native.translate(0, -state.height / 2, 0);
  replace(geometry, native, { x: 0, y: 0, z: 0 });
}

function rebuildTorus(geometry: BufferGeometry, state: TorusState): void {
  const tube = Math.max(0.0001, (state.outerRadius - state.innerRadius) / 2);
  const radius = state.innerRadius + tube;
  const native = new TorusGeometry(radius, tube, state.rings, state.ringSegments);
  native.rotateX(Math.PI / 2);
  replace(geometry, native, { x: 0, y: 0, z: 0 });
}

export function createGodotPlaneMesh(options: GodotPlaneMeshOptions = {}): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: PlaneState = {
    kind: 'plane',
    size: planeVector2(options.size ?? { x: 2, y: 2 }, 'PlaneMesh.size'),
    subdivideWidth: planeSubdivision(options.subdivideWidth ?? 0, 'PlaneMesh.subdivide_width'),
    subdivideDepth: planeSubdivision(options.subdivideDepth ?? 0, 'PlaneMesh.subdivide_depth'),
    centerOffset: vector3(options.centerOffset ?? { x: 0, y: 0, z: 0 }, 'PlaneMesh.center_offset'),
    orientation: 0,
    flipFaces: bool(options.flipFaces ?? false, 'PlaneMesh.flip_faces'),
  };
  STATES.set(geometry, state);
  rebuildPlane(geometry, state);
  retainGodotMeshResource(geometry);
  registerGodotObjectIdentity(geometry, 'PlaneMesh');
  return geometry;
}

export function createGodotQuadMesh(
  options: { readonly size?: GodotMeshVector2; readonly flipFaces?: boolean } = {},
): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: QuadState = {
    kind: 'quad',
    size: planeVector2(options.size ?? { x: 1, y: 1 }, 'QuadMesh.size'),
    subdivideWidth: 0,
    subdivideHeight: 0,
    centerOffset: { x: 0, y: 0, z: 0 },
    orientation: 0,
    flipFaces: bool(options.flipFaces ?? false, 'QuadMesh.flip_faces'),
  };
  STATES.set(geometry, state);
  registerGodotObjectIdentity(geometry, 'QuadMesh');
  rebuildQuad(geometry, state);
  return retainGodotMeshResource(geometry);
}

export function createGodotSphereMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: SphereState = {
    kind: 'sphere',
    radius: 0.5,
    height: 1,
    radialSegments: 64,
    rings: 32,
    isHemisphere: false,
  };
  STATES.set(geometry, state);
  registerGodotObjectIdentity(geometry, 'SphereMesh');
  rebuildSphere(geometry, state);
  return retainGodotMeshResource(geometry);
}

export function createGodotTorusMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const state: TorusState = {
    kind: 'torus',
    innerRadius: 0.5,
    outerRadius: 1,
    rings: 64,
    ringSegments: 32,
  };
  STATES.set(geometry, state);
  registerGodotObjectIdentity(geometry, 'TorusMesh');
  rebuildTorus(geometry, state);
  return retainGodotMeshResource(geometry);
}

export function getGodotPlaneMeshSize(geometry: unknown): GodotMeshVector2 {
  return { ...stateOf(geometry, 'plane').size };
}
export function setGodotPlaneMeshSize(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'plane');
  state.size = planeVector2(value, 'PlaneMesh.size');
  rebuildPlane(geometry, state);
}
export function getGodotPlaneMeshSubdivideWidth(geometry: unknown): number {
  return stateOf(geometry, 'plane').subdivideWidth;
}
export function setGodotPlaneMeshSubdivideWidth(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'plane');
  state.subdivideWidth = planeSubdivision(value, 'PlaneMesh.subdivide_width');
  rebuildPlane(geometry, state);
}
export function getGodotPlaneMeshSubdivideDepth(geometry: unknown): number {
  return stateOf(geometry, 'plane').subdivideDepth;
}
export function setGodotPlaneMeshSubdivideDepth(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'plane');
  state.subdivideDepth = planeSubdivision(value, 'PlaneMesh.subdivide_depth');
  rebuildPlane(geometry, state);
}
export function getGodotPlaneMeshCenterOffset(geometry: unknown): {
  x: number;
  y: number;
  z: number;
} {
  return { ...stateOf(geometry, 'plane').centerOffset };
}
export function setGodotPlaneMeshCenterOffset(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'plane');
  state.centerOffset = vector3(value, 'PlaneMesh.center_offset');
  rebuildPlane(geometry, state);
}
export function getGodotPlaneMeshOrientation(geometry: unknown): number {
  return stateOf(geometry, 'plane').orientation;
}
export function setGodotPlaneMeshOrientation(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'plane');
  state.orientation = subdivision(value, 'PlaneMesh.orientation');
  if (state.orientation > 2) throw new RangeError('PlaneMesh.orientation requires [0, 2].');
  rebuildPlane(geometry, state);
}
export function isGodotPlaneMeshFlipFaces(geometry: unknown): boolean {
  return stateOf(geometry, 'plane').flipFaces;
}
export function setGodotPlaneMeshFlipFaces(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'plane');
  state.flipFaces = bool(value, 'PlaneMesh.flip_faces');
  rebuildPlane(geometry, state);
}

export function getGodotQuadMeshSize(geometry: unknown): GodotMeshVector2 {
  return { ...stateOf(geometry, 'quad').size };
}
export function setGodotQuadMeshSize(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'quad');
  state.size = vector2(value, 'QuadMesh.size');
  rebuildQuad(geometry, state);
}
export function getGodotQuadMeshSubdivideWidth(geometry: unknown): number {
  return stateOf(geometry, 'quad').subdivideWidth;
}
export function setGodotQuadMeshSubdivideWidth(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'quad');
  state.subdivideWidth = subdivision(value, 'QuadMesh.subdivide_width');
  rebuildQuad(geometry, state);
}
export function getGodotQuadMeshSubdivideHeight(geometry: unknown): number {
  return stateOf(geometry, 'quad').subdivideHeight;
}
export function setGodotQuadMeshSubdivideHeight(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'quad');
  state.subdivideHeight = subdivision(value, 'QuadMesh.subdivide_height');
  rebuildQuad(geometry, state);
}
export function getGodotQuadMeshCenterOffset(geometry: unknown): {
  x: number;
  y: number;
  z: number;
} {
  return { ...stateOf(geometry, 'quad').centerOffset };
}
export function setGodotQuadMeshCenterOffset(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'quad');
  state.centerOffset = vector3(value, 'QuadMesh.center_offset');
  rebuildQuad(geometry, state);
}
export function isGodotQuadMeshFlipFaces(geometry: unknown): boolean {
  return stateOf(geometry, 'quad').flipFaces;
}
export function setGodotQuadMeshFlipFaces(geometry: BufferGeometry, value: unknown): void {
  if (typeof value !== 'boolean') throw new TypeError('QuadMesh.flip_faces requires bool.');
  const state = stateOf(geometry, 'quad');
  state.flipFaces = value;
  rebuildQuad(geometry, state);
}

export function getGodotSphereMeshRadius(geometry: unknown): number {
  return stateOf(geometry, 'sphere').radius;
}
export function setGodotSphereMeshRadius(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'sphere');
  state.radius = positive(value, 'SphereMesh.radius');
  rebuildSphere(geometry, state);
}
export function getGodotSphereMeshHeight(geometry: unknown): number {
  return stateOf(geometry, 'sphere').height;
}
export function setGodotSphereMeshHeight(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'sphere');
  state.height = positive(value, 'SphereMesh.height');
  rebuildSphere(geometry, state);
}
export function getGodotSphereMeshRadialSegments(geometry: unknown): number {
  return stateOf(geometry, 'sphere').radialSegments;
}
export function setGodotSphereMeshRadialSegments(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'sphere');
  state.radialSegments = subdivision(value, 'SphereMesh.radial_segments', 3);
  rebuildSphere(geometry, state);
}
export function getGodotSphereMeshRings(geometry: unknown): number {
  return stateOf(geometry, 'sphere').rings;
}
export function setGodotSphereMeshRings(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'sphere');
  state.rings = subdivision(value, 'SphereMesh.rings', 2);
  rebuildSphere(geometry, state);
}
export function isGodotSphereMeshHemisphere(geometry: unknown): boolean {
  return stateOf(geometry, 'sphere').isHemisphere;
}
export function setGodotSphereMeshHemisphere(geometry: BufferGeometry, value: unknown): void {
  if (typeof value !== 'boolean') throw new TypeError('SphereMesh.is_hemisphere requires bool.');
  const state = stateOf(geometry, 'sphere');
  state.isHemisphere = value;
  rebuildSphere(geometry, state);
}

export function getGodotTorusMeshInnerRadius(geometry: unknown): number {
  return stateOf(geometry, 'torus').innerRadius;
}
export function setGodotTorusMeshInnerRadius(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'torus');
  const next = positive(value, 'TorusMesh.inner_radius');
  if (next >= state.outerRadius)
    throw new RangeError('TorusMesh.inner_radius must be below outer_radius.');
  state.innerRadius = next;
  rebuildTorus(geometry, state);
}
export function getGodotTorusMeshOuterRadius(geometry: unknown): number {
  return stateOf(geometry, 'torus').outerRadius;
}
export function setGodotTorusMeshOuterRadius(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'torus');
  const next = positive(value, 'TorusMesh.outer_radius');
  if (next <= state.innerRadius)
    throw new RangeError('TorusMesh.outer_radius must exceed inner_radius.');
  state.outerRadius = next;
  rebuildTorus(geometry, state);
}
export function getGodotTorusMeshRings(geometry: unknown): number {
  return stateOf(geometry, 'torus').rings;
}
export function setGodotTorusMeshRings(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'torus');
  state.rings = subdivision(value, 'TorusMesh.rings', 3);
  rebuildTorus(geometry, state);
}
export function getGodotTorusMeshRingSegments(geometry: unknown): number {
  return stateOf(geometry, 'torus').ringSegments;
}
export function setGodotTorusMeshRingSegments(geometry: BufferGeometry, value: unknown): void {
  const state = stateOf(geometry, 'torus');
  state.ringSegments = subdivision(value, 'TorusMesh.ring_segments', 3);
  rebuildTorus(geometry, state);
}
