import { BoxGeometry, BufferGeometry } from 'three';
import { retainGodotMeshResource } from './mesh-instance';
import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export interface GodotPlaceholderMeshAabb {
  position: Readonly<{ x: number; y: number; z: number }>;
  size: Readonly<{ x: number; y: number; z: number }>;
}

const PLACEHOLDERS = new WeakMap<BufferGeometry, GodotPlaceholderMeshAabb>();

function copyAabb(value: GodotPlaceholderMeshAabb): GodotPlaceholderMeshAabb {
  return { position: { ...value.position }, size: { ...value.size } };
}

function rebuild(geometry: BufferGeometry, bounds: GodotPlaceholderMeshAabb): void {
  if (bounds.size.x <= 0 || bounds.size.y <= 0 || bounds.size.z <= 0) {
    geometry.deleteAttribute('position'); geometry.setIndex(null); godotResourceEmitChanged(geometry); return;
  }
  const replacement = new BoxGeometry(bounds.size.x, bounds.size.y, bounds.size.z);
  replacement.translate(bounds.position.x + bounds.size.x * 0.5, bounds.position.y + bounds.size.y * 0.5, bounds.position.z + bounds.size.z * 0.5);
  geometry.copy(replacement); replacement.dispose(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); godotResourceEmitChanged(geometry);
}

export function createGodotPlaceholderMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  const bounds: GodotPlaceholderMeshAabb = { position: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } };
  registerGodotObjectIdentity(geometry, 'PlaceholderMesh'); PLACEHOLDERS.set(geometry, bounds); rebuild(geometry, bounds);
  return retainGodotMeshResource(geometry);
}

export function setGodotPlaceholderMeshAabb(value: unknown, bounds: GodotPlaceholderMeshAabb): void {
  if (!(value instanceof BufferGeometry) || !PLACEHOLDERS.has(value)) throw new TypeError('PlaceholderMesh.aabb requires a retained PlaceholderMesh Resource.');
  const copy = copyAabb(bounds); PLACEHOLDERS.set(value, copy); rebuild(value, copy);
}

export function getGodotPlaceholderMeshAabb(value: unknown): GodotPlaceholderMeshAabb {
  if (!(value instanceof BufferGeometry)) throw new TypeError('PlaceholderMesh.aabb requires native THREE.BufferGeometry.');
  const bounds = PLACEHOLDERS.get(value); if (!bounds) throw new TypeError('PlaceholderMesh.aabb requires a retained PlaceholderMesh Resource.');
  return copyAabb(bounds);
}
