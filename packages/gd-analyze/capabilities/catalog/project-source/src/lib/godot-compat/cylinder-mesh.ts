/** Mutable Godot CylinderMesh Resource over one retained native Three BufferGeometry identity. */
import { BufferGeometry, CylinderGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';
import { retainGodotMeshResource } from './mesh-instance';

interface CylinderMeshState {
  height: number;
  topRadius: number;
  bottomRadius: number;
  readonly radialSegments: number;
  readonly heightSegments: number;
}

const STATES = new WeakMap<BufferGeometry, CylinderMeshState>();

export interface GodotCylinderMeshOptions {
  readonly height?: number;
  readonly topRadius?: number;
  readonly bottomRadius?: number;
  readonly radialSegments?: number;
  readonly heightSegments?: number;
}

function positive(value: number, member: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${member} requires a finite value greater than zero`);
  return value;
}

function rebuild(geometry: BufferGeometry, state: CylinderMeshState): void {
  const replacement = new CylinderGeometry(
    state.topRadius,
    state.bottomRadius,
    state.height,
    state.radialSegments,
    state.heightSegments,
  );
  geometry.copy(replacement);
  replacement.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  godotResourceEmitChanged(geometry);
}

export function createGodotCylinderMesh(options: GodotCylinderMeshOptions = {}): BufferGeometry {
  const state: CylinderMeshState = {
    height: positive(options.height ?? 2, 'CylinderMesh.height'),
    topRadius: positive(options.topRadius ?? 1, 'CylinderMesh.top_radius'),
    bottomRadius: positive(options.bottomRadius ?? 1, 'CylinderMesh.bottom_radius'),
    radialSegments: Math.max(3, Math.trunc(positive(options.radialSegments ?? 64, 'CylinderMesh.radial_segments'))),
    heightSegments: Math.max(1, Math.trunc(positive(options.heightSegments ?? 5, 'CylinderMesh.rings'))),
  };
  const geometry = new BufferGeometry();
  registerGodotObjectIdentity(geometry, 'CylinderMesh');
  STATES.set(geometry, state);
  rebuild(geometry, state);
  return retainGodotMeshResource(geometry);
}

function stateOf(value: unknown): { geometry: BufferGeometry; state: CylinderMeshState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError('CylinderMesh requires native THREE.BufferGeometry');
  const state = STATES.get(value);
  if (state === undefined) throw new TypeError('CylinderMesh member requires a retained CylinderMesh Resource');
  return { geometry: value, state };
}

export function getGodotCylinderMeshHeight(value: unknown): number {
  return stateOf(value).state.height;
}

export function setGodotCylinderMeshHeight(value: unknown, height: number): void {
  const { geometry, state } = stateOf(value);
  const next = positive(height, 'CylinderMesh.height');
  if (next === state.height) return;
  state.height = next;
  rebuild(geometry, state);
}

export function getGodotCylinderMeshTopRadius(value: unknown): number {
  return stateOf(value).state.topRadius;
}

export function setGodotCylinderMeshTopRadius(value: unknown, radius: number): void {
  const { geometry, state } = stateOf(value);
  const next = positive(radius, 'CylinderMesh.top_radius');
  if (next === state.topRadius) return;
  state.topRadius = next;
  rebuild(geometry, state);
}

export function getGodotCylinderMeshBottomRadius(value: unknown): number {
  return stateOf(value).state.bottomRadius;
}

export function setGodotCylinderMeshBottomRadius(value: unknown, radius: number): void {
  const { geometry, state } = stateOf(value);
  const next = positive(radius, 'CylinderMesh.bottom_radius');
  if (next === state.bottomRadius) return;
  state.bottomRadius = next;
  rebuild(geometry, state);
}
