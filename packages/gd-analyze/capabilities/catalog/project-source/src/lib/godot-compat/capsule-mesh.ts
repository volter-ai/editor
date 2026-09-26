/** Godot CapsuleMesh Resource over Three's native CapsuleGeometry. */

import { BufferGeometry, CapsuleGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import {
  createGodotPlaneMesh,
  getGodotPlaneMeshSize,
  setGodotPlaneMeshSize,
  type GodotMeshVector2,
} from './primitive-meshes-3d';

export interface CapsuleMeshOptions {
  readonly radius?: number;
  readonly height?: number;
  readonly radialSegments?: number;
  readonly rings?: number;
}

interface CapsuleMeshState {
  radius: number;
  height: number;
  radialSegments: number;
  rings: number;
}

const STATE = new WeakMap<CapsuleGeometry, CapsuleMeshState>();

export type PlaneMeshSize = GodotMeshVector2;

/** Godot PlaneMesh.new(): a 2×2 XZ plane whose front face points along +Y. */
export function createPlaneMesh(size: PlaneMeshSize = { x: 2, y: 2 }): BufferGeometry {
  return createGodotPlaneMesh({ size });
}

export function getPlaneMeshSize(mesh: BufferGeometry): PlaneMeshSize {
  return getGodotPlaneMeshSize(mesh);
}

export function setPlaneMeshSize(mesh: BufferGeometry, value: PlaneMeshSize): void {
  setGodotPlaneMeshSize(mesh, value);
}

function finitePositive(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`CapsuleMesh.${member} must be finite and greater than zero.`);
  }
  return value;
}

function segmentCount(value: unknown, member: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new RangeError(`CapsuleMesh.${member} must be an integer of at least ${minimum}.`);
  }
  return value as number;
}

function requireState(mesh: CapsuleGeometry, member: string): CapsuleMeshState {
  const state = STATE.get(mesh);
  if (state === undefined) throw new Error(`CapsuleMesh.${member} requires a retained CapsuleMesh Resource.`);
  return state;
}

function validateDimensions(state: CapsuleMeshState): void {
  if (state.height < state.radius * 2) {
    throw new RangeError(
      `CapsuleMesh.height ${state.height} must be at least twice radius ${state.radius}.`,
    );
  }
}

function rebuild(mesh: CapsuleGeometry, state: CapsuleMeshState): void {
  validateDimensions(state);
  const native = new CapsuleGeometry(
    state.radius,
    state.height - state.radius * 2,
    state.rings,
    state.radialSegments,
  );
  mesh.copy(native);
  native.dispose();
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  godotResourceEmitChanged(mesh);
}

export function createCapsuleMesh(options: CapsuleMeshOptions = {}): CapsuleGeometry {
  const state: CapsuleMeshState = {
    radius: finitePositive(options.radius ?? 0.5, 'radius'),
    height: finitePositive(options.height ?? 2, 'height'),
    radialSegments: segmentCount(options.radialSegments ?? 64, 'radial_segments', 4),
    rings: segmentCount(options.rings ?? 8, 'rings', 1),
  };
  validateDimensions(state);
  const mesh = new CapsuleGeometry(
    state.radius,
    state.height - state.radius * 2,
    state.rings,
    state.radialSegments,
  );
  STATE.set(mesh, state);
  registerGodotObjectIdentity(mesh, 'CapsuleMesh');
  bindGodotResourceProtocol(mesh, {
    createDuplicate() {
      return createCapsuleMesh({ ...state });
    },
  });
  return mesh;
}

export function getCapsuleMeshRadius(mesh: CapsuleGeometry): number {
  return requireState(mesh, 'get_radius').radius;
}

export function setCapsuleMeshRadius(mesh: CapsuleGeometry, value: number): void {
  const state = requireState(mesh, 'set_radius');
  const radius = finitePositive(value, 'radius');
  if (radius === state.radius) return;
  if (state.height < radius * 2) {
    throw new RangeError(`CapsuleMesh.radius ${radius} exceeds half of height ${state.height}.`);
  }
  state.radius = radius;
  rebuild(mesh, state);
}

export function getCapsuleMeshHeight(mesh: CapsuleGeometry): number {
  return requireState(mesh, 'get_height').height;
}

export function setCapsuleMeshHeight(mesh: CapsuleGeometry, value: number): void {
  const state = requireState(mesh, 'set_height');
  const height = finitePositive(value, 'height');
  if (height === state.height) return;
  if (height < state.radius * 2) {
    throw new RangeError(`CapsuleMesh.height ${height} must be at least twice radius ${state.radius}.`);
  }
  state.height = height;
  rebuild(mesh, state);
}

export function getCapsuleMeshRadialSegments(mesh: CapsuleGeometry): number {
  return requireState(mesh, 'get_radial_segments').radialSegments;
}

export function setCapsuleMeshRadialSegments(mesh: CapsuleGeometry, value: number): void {
  const state = requireState(mesh, 'set_radial_segments');
  const radialSegments = segmentCount(value, 'radial_segments', 4);
  if (radialSegments === state.radialSegments) return;
  state.radialSegments = radialSegments;
  rebuild(mesh, state);
}

export function getCapsuleMeshRings(mesh: CapsuleGeometry): number {
  return requireState(mesh, 'get_rings').rings;
}

export function setCapsuleMeshRings(mesh: CapsuleGeometry, value: number): void {
  const state = requireState(mesh, 'set_rings');
  const rings = segmentCount(value, 'rings', 1);
  if (rings === state.rings) return;
  state.rings = rings;
  rebuild(mesh, state);
}
