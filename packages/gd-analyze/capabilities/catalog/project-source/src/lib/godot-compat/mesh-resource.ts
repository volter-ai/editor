/** Remaining pinned Mesh resource protocol over native Three BufferGeometry. */
import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Vector3,
} from 'three';
import { aabb, type GodotAabb } from './aabb';
import { getGodotMeshAabb } from './array-mesh';
import { registerGodotObjectIdentity } from './object';
import { packedVector3Array, type PackedArrayValue } from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import type { Vector3 as GodotVector3 } from './variant-3d';
import type { Vector2 } from './vector2';

const LIGHTMAP_SIZE_HINTS = new WeakMap<BufferGeometry, Vector2>();

function geometry(value: unknown, member: string): BufferGeometry {
  if (!(value instanceof BufferGeometry)) {
    throw new TypeError(`Mesh.${member} requires a native Three BufferGeometry.`);
  }
  return value;
}

function index(value: BufferGeometry): Uint32Array {
  const position = value.getAttribute('position');
  if (position === undefined) return new Uint32Array();
  const source = value.getIndex();
  if (source === null) return Uint32Array.from({ length: position.count }, (_, item) => item);
  return Uint32Array.from({ length: source.count }, (_, item) => source.getX(item));
}

function positions(value: BufferGeometry): Float32Array {
  const source = value.getAttribute('position');
  if (source === undefined || source.itemSize < 3) return new Float32Array();
  const out = new Float32Array(source.count * 3);
  for (let item = 0; item < source.count; item += 1) {
    out[item * 3] = source.getX(item);
    out[item * 3 + 1] = source.getY(item);
    out[item * 3 + 2] = source.getZ(item);
  }
  return out;
}

export function setGodotMeshLightmapSizeHint(value: unknown, hint: Vector2): void {
  const mesh = geometry(value, 'lightmap_size_hint');
  if (
    typeof hint !== 'object' || hint === null ||
    !Number.isSafeInteger(hint.x) || !Number.isSafeInteger(hint.y) ||
    hint.x < 0 || hint.y < 0
  ) {
    throw new RangeError('Mesh.lightmap_size_hint requires a nonnegative Vector2i.');
  }
  const previous = LIGHTMAP_SIZE_HINTS.get(mesh);
  if (previous?.x === hint.x && previous.y === hint.y) return;
  LIGHTMAP_SIZE_HINTS.set(mesh, { x: hint.x, y: hint.y });
  godotResourceEmitChanged(mesh);
}

export function getGodotMeshLightmapSizeHint(value: unknown): Vector2 {
  const hint = LIGHTMAP_SIZE_HINTS.get(geometry(value, 'lightmap_size_hint')) ?? { x: 0, y: 0 };
  return { x: hint.x, y: hint.y };
}

/** Triangle-list faces in the same packed vertex order returned by Godot Mesh.get_faces(). */
export function getGodotMeshFaces(value: unknown): PackedArrayValue<GodotVector3> {
  const mesh = geometry(value, 'get_faces');
  const source = mesh.getAttribute('position');
  const indices = index(mesh);
  if (source === undefined || indices.length === 0) return packedVector3Array();
  if (indices.length % 3 !== 0) {
    throw new Error('Mesh.get_faces requires triangle-list native geometry.');
  }
  const faces: GodotVector3[] = [];
  for (const vertex of indices) {
    faces.push({ x: source.getX(vertex), y: source.getY(vertex), z: source.getZ(vertex) });
  }
  return packedVector3Array(faces);
}

/**
 * Godot Mesh.create_outline: duplicate vertices along averaged normals, reverse winding, and keep
 * the source's indexed topology. The returned identity is another native BufferGeometry Resource.
 */
export function createGodotMeshOutline(value: unknown, margin: number): BufferGeometry {
  const source = geometry(value, 'create_outline');
  if (!Number.isFinite(margin)) throw new TypeError('Mesh.create_outline requires a finite margin.');
  const output = source.clone();
  if (output.getAttribute('normal') === undefined) output.computeVertexNormals();
  const position = output.getAttribute('position');
  const normal = output.getAttribute('normal');
  if (position !== undefined && normal !== undefined) {
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      position.setXYZ(
        vertex,
        position.getX(vertex) + normal.getX(vertex) * margin,
        position.getY(vertex) + normal.getY(vertex) * margin,
        position.getZ(vertex) + normal.getZ(vertex) * margin,
      );
    }
    position.needsUpdate = true;
  }
  const indices = index(output);
  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const swap = indices[triangle + 1]!;
    indices[triangle + 1] = indices[triangle + 2]!;
    indices[triangle + 2] = swap;
  }
  output.setIndex(new BufferAttribute(indices, 1));
  output.computeBoundingBox();
  output.computeBoundingSphere();
  registerGodotObjectIdentity(output, 'ArrayMesh');
  bindGodotResourceProtocol(output, { createDuplicate: (mesh) => createGodotMeshOutline(mesh, 0) });
  return output;
}

export class GodotPlaceholderMesh extends BufferGeometry {
  private aabbValue: GodotAabb;

  public constructor(bounds: GodotAabb = aabb()) {
    super();
    this.aabbValue = aabb(bounds.position, bounds.size);
    this.rebuild();
    registerGodotObjectIdentity(this, 'PlaceholderMesh');
    bindGodotResourceProtocol<GodotPlaceholderMesh>(this, {
      createDuplicate: (source) => new GodotPlaceholderMesh(source.getAabb()),
    });
  }

  public setAabb(bounds: GodotAabb): void {
    this.aabbValue = aabb(bounds.position, bounds.size);
    this.rebuild();
    godotResourceEmitChanged(this);
  }

  public getAabb(): GodotAabb {
    return aabb(this.aabbValue.position, this.aabbValue.size);
  }

  private rebuild(): void {
    const size = this.aabbValue.size;
    const temporary = new BoxGeometry(size.x, size.y, size.z);
    temporary.translate(
      this.aabbValue.position.x + size.x * 0.5,
      this.aabbValue.position.y + size.y * 0.5,
      this.aabbValue.position.z + size.z * 0.5,
    );
    this.copy(temporary);
    temporary.dispose();
  }
}

export function createGodotMeshPlaceholder(value: unknown): GodotPlaceholderMesh {
  return new GodotPlaceholderMesh(getGodotMeshAabb(geometry(value, 'create_placeholder')));
}

export interface GodotTriangleHit {
  readonly position: GodotVector3;
  readonly normal: GodotVector3;
}

export class GodotTriangleMesh {
  private readonly vertexData: Float32Array;
  private readonly indexData: Uint32Array;

  public constructor(source: BufferGeometry) {
    this.vertexData = positions(source);
    this.indexData = index(source);
    registerGodotObjectIdentity(this, 'TriangleMesh');
    bindGodotResourceProtocol<GodotTriangleMesh>(this, {
      createDuplicate: (owner) => owner.duplicate(),
    });
  }

  public get_faces(): PackedArrayValue<GodotVector3> {
    const faces: GodotVector3[] = [];
    for (const vertex of this.indexData) {
      const offset = vertex * 3;
      faces.push({
        x: this.vertexData[offset] ?? 0,
        y: this.vertexData[offset + 1] ?? 0,
        z: this.vertexData[offset + 2] ?? 0,
      });
    }
    return packedVector3Array(faces);
  }

  public get_aabb(): GodotAabb {
    if (this.vertexData.length === 0) return aabb();
    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (let offset = 0; offset < this.vertexData.length; offset += 3) {
      min.min(new Vector3(this.vertexData[offset], this.vertexData[offset + 1], this.vertexData[offset + 2]));
      max.max(new Vector3(this.vertexData[offset], this.vertexData[offset + 1], this.vertexData[offset + 2]));
    }
    return aabb(min, max.sub(min));
  }

  public duplicate(): GodotTriangleMesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.vertexData.slice(), 3));
    geometry.setIndex(new BufferAttribute(this.indexData.slice(), 1));
    return new GodotTriangleMesh(geometry);
  }
}

export function generateGodotTriangleMesh(value: unknown): GodotTriangleMesh | null {
  const source = geometry(value, 'generate_triangle_mesh');
  const vertices = source.getAttribute('position');
  if (vertices === undefined || vertices.count < 3) return null;
  return new GodotTriangleMesh(source);
}
