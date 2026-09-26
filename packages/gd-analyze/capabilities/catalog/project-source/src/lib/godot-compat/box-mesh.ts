/** Mutable Godot BoxMesh/CubeMesh Resources over retained native Three BufferGeometry. */
import { BoxGeometry, BufferGeometry } from 'three';
import { retainGodotMeshResource } from './mesh-instance';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export interface GodotBoxMeshSize { readonly x: number; readonly y: number; readonly z: number }

interface BoxMeshState { size: GodotBoxMeshSize }
const STATES = new WeakMap<BufferGeometry, BoxMeshState>();

function size(value: GodotBoxMeshSize, member: string): GodotBoxMeshSize {
  if (![value.x, value.y, value.z].every((one) => Number.isFinite(one) && one > 0)) {
    throw new RangeError(`${member} requires positive finite Vector3 components`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

function rebuild(geometry: BufferGeometry, state: BoxMeshState): void {
  const replacement = new BoxGeometry(state.size.x, state.size.y, state.size.z);
  geometry.copy(replacement);
  replacement.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  godotResourceEmitChanged(geometry);
}

function create(className: 'BoxMesh' | 'CubeMesh', initial: GodotBoxMeshSize): BufferGeometry {
  const geometry = new BufferGeometry();
  const state = { size: size(initial, `${className}.size`) };
  registerGodotObjectIdentity(geometry, className);
  STATES.set(geometry, state);
  rebuild(geometry, state);
  return retainGodotMeshResource(geometry);
}

export function createGodotBoxMesh(): BufferGeometry {
  return create('BoxMesh', { x: 1, y: 1, z: 1 });
}

export function createGodotCubeMesh(): BufferGeometry {
  return create('CubeMesh', { x: 2, y: 2, z: 2 });
}

function stateOf(value: unknown, member: string): { geometry: BufferGeometry; state: BoxMeshState } {
  if (!(value instanceof BufferGeometry)) throw new TypeError(`${member} requires native THREE.BufferGeometry`);
  const state = STATES.get(value);
  if (state === undefined) throw new TypeError(`${member} requires a retained BoxMesh or CubeMesh Resource`);
  return { geometry: value, state };
}

export function getGodotBoxMeshSize(value: unknown): GodotBoxMeshSize {
  return { ...stateOf(value, 'PrimitiveMesh.size').state.size };
}

export function setGodotBoxMeshSize(value: unknown, valueSize: GodotBoxMeshSize): void {
  const { geometry, state } = stateOf(value, 'PrimitiveMesh.size');
  const next = size(valueSize, 'PrimitiveMesh.size');
  if (next.x === state.size.x && next.y === state.size.y && next.z === state.size.z) return;
  state.size = next;
  rebuild(geometry, state);
}
