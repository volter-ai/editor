import { registerGodotObjectIdentity } from './object';

export interface GodotPhysicsRenderingVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface GodotPhysicsRenderingAabb { readonly position: GodotPhysicsRenderingVector3; readonly size: GodotPhysicsRenderingVector3 }

export interface GodotPhysicsServer3DRenderingServerHandlerHooks {
  readonly setVertex?: (vertexId: number, vertex: GodotPhysicsRenderingVector3) => void;
  readonly setNormal?: (vertexId: number, normal: GodotPhysicsRenderingVector3) => void;
  readonly setAabb?: (aabb: GodotPhysicsRenderingAabb) => void;
  readonly commit?: () => void;
}

function finiteVector(value: GodotPhysicsRenderingVector3, owner: string): GodotPhysicsRenderingVector3 {
  if (value === null || typeof value !== 'object') throw new TypeError(`${owner} requires Vector3.`);
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (![x, y, z].every(Number.isFinite)) throw new TypeError(`${owner} requires a finite Vector3.`);
  return Object.freeze({ x, y, z });
}

function vertexIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('PhysicsServer3DRenderingServerHandler vertex index must be non-negative.');
  return value;
}

export class GodotPhysicsServer3DRenderingServerHandler {
  private readonly vertices = new Map<number, GodotPhysicsRenderingVector3>();
  private readonly normals = new Map<number, GodotPhysicsRenderingVector3>();
  private bounds: GodotPhysicsRenderingAabb | null = null;
  private revision = 0;
  private committedRevision = 0;

  constructor(private readonly hooks: GodotPhysicsServer3DRenderingServerHandlerHooks = {}) {
    registerGodotObjectIdentity(this, 'PhysicsServer3DRenderingServerHandler');
  }

  _set_vertex(vertexId: number, vertex: GodotPhysicsRenderingVector3): void {
    const id = vertexIndex(vertexId);
    const next = finiteVector(vertex, 'PhysicsServer3DRenderingServerHandler._set_vertex');
    this.vertices.set(id, next);
    this.revision++;
    this.hooks.setVertex?.(id, next);
  }

  _set_normal(vertexId: number, normal: GodotPhysicsRenderingVector3): void {
    const id = vertexIndex(vertexId);
    const next = finiteVector(normal, 'PhysicsServer3DRenderingServerHandler._set_normal');
    this.normals.set(id, next);
    this.revision++;
    this.hooks.setNormal?.(id, next);
  }

  _set_aabb(aabb: GodotPhysicsRenderingAabb): void {
    if (aabb === null || typeof aabb !== 'object') throw new TypeError('PhysicsServer3DRenderingServerHandler._set_aabb requires AABB.');
    const size = finiteVector(aabb.size, 'PhysicsServer3DRenderingServerHandler._set_aabb.size');
    if (size.x < 0 || size.y < 0 || size.z < 0) throw new RangeError('PhysicsServer3DRenderingServerHandler AABB size cannot be negative.');
    const next = Object.freeze({
      position: finiteVector(aabb.position, 'PhysicsServer3DRenderingServerHandler._set_aabb.position'),
      size,
    });
    this.bounds = next;
    this.revision++;
    this.hooks.setAabb?.(next);
  }

  set_vertex(vertexId: number, vertex: GodotPhysicsRenderingVector3): void { this._set_vertex(vertexId, vertex); }
  set_normal(vertexId: number, normal: GodotPhysicsRenderingVector3): void { this._set_normal(vertexId, normal); }
  set_aabb(aabb: GodotPhysicsRenderingAabb): void { this._set_aabb(aabb); }

  set_vertex_count(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('PhysicsServer3DRenderingServerHandler vertex count must be non-negative.');
    for (const id of this.vertices.keys()) if (id >= count) this.vertices.delete(id);
    for (const id of this.normals.keys()) if (id >= count) this.normals.delete(id);
    this.revision++;
  }

  set_vertices(values: Iterable<GodotPhysicsRenderingVector3>): void {
    this.vertices.clear();
    let index = 0;
    for (const value of values) this._set_vertex(index++, value);
  }

  set_normals(values: Iterable<GodotPhysicsRenderingVector3>): void {
    this.normals.clear();
    let index = 0;
    for (const value of values) this._set_normal(index++, value);
  }

  get_vertex(vertexId: number): GodotPhysicsRenderingVector3 | null {
    return this.vertices.get(vertexIndex(vertexId)) ?? null;
  }

  get_normal(vertexId: number): GodotPhysicsRenderingVector3 | null {
    return this.normals.get(vertexIndex(vertexId)) ?? null;
  }

  get_aabb(): GodotPhysicsRenderingAabb | null { return this.bounds; }
  get_vertex_count(): number { return this.vertices.size; }
  get_normal_count(): number { return this.normals.size; }
  get_revision(): number { return this.revision; }
  has_pending_changes(): boolean { return this.revision !== this.committedRevision; }

  commit(): void {
    if (!this.has_pending_changes()) return;
    this.hooks.commit?.();
    this.committedRevision = this.revision;
  }

  clear(): void {
    if (this.vertices.size === 0 && this.normals.size === 0 && this.bounds === null) return;
    this.vertices.clear();
    this.normals.clear();
    this.bounds = null;
    this.revision++;
  }
}

export function createGodotPhysicsServer3DRenderingServerHandler(
  hooks: GodotPhysicsServer3DRenderingServerHandlerHooks = {},
): GodotPhysicsServer3DRenderingServerHandler {
  return new GodotPhysicsServer3DRenderingServerHandler(hooks);
}
