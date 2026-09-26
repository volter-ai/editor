/**
 * Godot 4 ArrayOccluder3D/OccluderInstance3D over native Three depth-only geometry.
 *
 * Three has no Godot-style CPU occlusion server. A depth-only mesh is the browser-native
 * equivalent for the visible result: it writes the authored occluder triangles before ordinary
 * opaque and transparent draws while writing no colour of its own. Geometry and node identities
 * remain retained so later GDScript mutation immediately rebuilds the same native objects.
 */

import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Uint32BufferAttribute,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import {
  packedInt32Array,
  packedVector3Array,
  type PackedInt32Array,
  type PackedVector3Array,
} from './packed-array';
import {
  bindGodotResourceProtocol,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';

export interface GodotOccluder3DResource {
  readonly __godotClass?: string;
  geometryArrays(): {
    readonly vertices: PackedVector3Array;
    readonly indices: PackedInt32Array;
  };
}

export class GodotArrayOccluder3D {
  private vertexData: PackedVector3Array = packedVector3Array();
  private indexData: PackedInt32Array = packedInt32Array();

  constructor() {
    registerGodotObjectIdentity(this, 'ArrayOccluder3D');
    bindGodotResourceProtocol<GodotArrayOccluder3D>(this, {
      createDuplicate: (source) => createArrayOccluder3D(source.vertexData, source.indexData),
    });
  }

  get vertices(): PackedVector3Array {
    return this.getVertices();
  }

  set vertices(value: PackedVector3Array) {
    this.setVertices(value);
  }

  get indices(): PackedInt32Array {
    return this.getIndices();
  }

  set indices(value: PackedInt32Array) {
    this.setIndices(value);
  }

  setArrays(vertices: PackedVector3Array, indices: PackedInt32Array): void {
    const nextVertices = validateVertices(vertices);
    const nextIndices = validateIndices(indices);
    this.vertexData = nextVertices;
    this.indexData = nextIndices;
    godotResourceEmitChanged(this);
  }

  setVertices(vertices: PackedVector3Array): void {
    const next = validateVertices(vertices);
    this.vertexData = next;
    godotResourceEmitChanged(this);
  }

  getVertices(): PackedVector3Array {
    return packedVector3Array(this.vertexData);
  }

  setIndices(indices: PackedInt32Array): void {
    this.indexData = validateIndices(indices);
    godotResourceEmitChanged(this);
  }

  getIndices(): PackedInt32Array {
    return packedInt32Array(this.indexData);
  }

  /** Internal immutable snapshot consumed by the retained Three binding. */
  geometryArrays(): {
    readonly vertices: PackedVector3Array;
    readonly indices: PackedInt32Array;
  } {
    return { vertices: this.vertexData, indices: this.indexData };
  }
}

function vector2(value: unknown, member: string, positive = false): { x: number; y: number } {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError(`Godot ${member} requires Vector2.`);
  const x = Number(value.x), y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (positive && (x <= 0 || y <= 0))) throw new RangeError(`Godot ${member} requires ${positive ? 'positive ' : ''}finite components.`);
  return Object.freeze({ x, y });
}

function vector3(value: unknown, member: string, positive = false): { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError(`Godot ${member} requires Vector3.`);
  const x = Number(value.x), y = Number(value.y), z = Number(value.z);
  if (![x, y, z].every(Number.isFinite) || (positive && (x <= 0 || y <= 0 || z <= 0))) throw new RangeError(`Godot ${member} requires ${positive ? 'positive ' : ''}finite components.`);
  return Object.freeze({ x, y, z });
}

export class GodotQuadOccluder3D implements GodotOccluder3DResource {
  public readonly __godotClass = 'QuadOccluder3D';
  private sizeValue: Readonly<{ x: number; y: number }> = Object.freeze({ x: 1, y: 1 });

  public constructor(size: unknown = { x: 1, y: 1 }) {
    this.sizeValue = vector2(size, 'QuadOccluder3D.size', true);
    registerGodotObjectIdentity(this, 'QuadOccluder3D');
    bindGodotResourceProtocol<GodotQuadOccluder3D>(this, { createDuplicate: (source) => new GodotQuadOccluder3D(source.sizeValue) });
  }
  public get size(): { x: number; y: number } { return this.getSize(); }
  public set size(value: unknown) { this.setSize(value); }
  public setSize(value: unknown): void { this.sizeValue = vector2(value, 'QuadOccluder3D.size', true); godotResourceEmitChanged(this); }
  public getSize(): { x: number; y: number } { return { ...this.sizeValue }; }
  public geometryArrays(): { readonly vertices: PackedVector3Array; readonly indices: PackedInt32Array } {
    const x = this.sizeValue.x * 0.5, y = this.sizeValue.y * 0.5;
    return {
      vertices: packedVector3Array([{ x: -x, y: -y, z: 0 }, { x, y: -y, z: 0 }, { x, y, z: 0 }, { x: -x, y, z: 0 }]),
      indices: packedInt32Array([0, 1, 2, 0, 2, 3]),
    };
  }
  public getVertices(): PackedVector3Array { return this.geometryArrays().vertices; }
  public getIndices(): PackedInt32Array { return this.geometryArrays().indices; }
}

export class GodotBoxOccluder3D implements GodotOccluder3DResource {
  public readonly __godotClass = 'BoxOccluder3D';
  private sizeValue: Readonly<{ x: number; y: number; z: number }> = Object.freeze({ x: 1, y: 1, z: 1 });

  public constructor(size: unknown = { x: 1, y: 1, z: 1 }) {
    this.sizeValue = vector3(size, 'BoxOccluder3D.size', true);
    registerGodotObjectIdentity(this, 'BoxOccluder3D');
    bindGodotResourceProtocol<GodotBoxOccluder3D>(this, { createDuplicate: (source) => new GodotBoxOccluder3D(source.sizeValue) });
  }
  public get size(): { x: number; y: number; z: number } { return this.getSize(); }
  public set size(value: unknown) { this.setSize(value); }
  public setSize(value: unknown): void { this.sizeValue = vector3(value, 'BoxOccluder3D.size', true); godotResourceEmitChanged(this); }
  public getSize(): { x: number; y: number; z: number } { return { ...this.sizeValue }; }
  public geometryArrays(): { readonly vertices: PackedVector3Array; readonly indices: PackedInt32Array } {
    const x = this.sizeValue.x * 0.5, y = this.sizeValue.y * 0.5, z = this.sizeValue.z * 0.5;
    return {
      vertices: packedVector3Array([
        { x: -x, y: -y, z: -z }, { x, y: -y, z: -z }, { x, y, z: -z }, { x: -x, y, z: -z },
        { x: -x, y: -y, z }, { x, y: -y, z }, { x, y, z }, { x: -x, y, z },
      ]),
      indices: packedInt32Array([
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
        0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
      ]),
    };
  }
  public getVertices(): PackedVector3Array { return this.geometryArrays().vertices; }
  public getIndices(): PackedInt32Array { return this.geometryArrays().indices; }
}

export class GodotSphereOccluder3D implements GodotOccluder3DResource {
  public readonly __godotClass = 'SphereOccluder3D';
  private radiusValue = 1;
  private subdivisionValue = 3;

  public constructor(radius = 1, subdivision = 3) {
    this.radiusValue = positive(radius, 'SphereOccluder3D.radius');
    this.subdivisionValue = subdivisionLevel(subdivision);
    registerGodotObjectIdentity(this, 'SphereOccluder3D');
    bindGodotResourceProtocol<GodotSphereOccluder3D>(this, { createDuplicate: (source) => new GodotSphereOccluder3D(source.radiusValue, source.subdivisionValue) });
  }
  public get radius(): number { return this.getRadius(); }
  public set radius(value: number) { this.setRadius(value); }
  public get subdivision(): number { return this.getSubdivision(); }
  public set subdivision(value: number) { this.setSubdivision(value); }
  public setRadius(value: number): void { this.radiusValue = positive(value, 'SphereOccluder3D.radius'); godotResourceEmitChanged(this); }
  public getRadius(): number { return this.radiusValue; }
  public setSubdivision(value: number): void { this.subdivisionValue = subdivisionLevel(value); godotResourceEmitChanged(this); }
  public getSubdivision(): number { return this.subdivisionValue; }
  public geometryArrays(): { readonly vertices: PackedVector3Array; readonly indices: PackedInt32Array } {
    const longitudeSegments = 8 * 2 ** this.subdivisionValue;
    const latitudeSegments = 4 * 2 ** this.subdivisionValue;
    const vertices: Array<{ x: number; y: number; z: number }> = [];
    const indices: number[] = [];
    for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
      const theta = Math.PI * latitude / latitudeSegments;
      const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
      for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
        const phi = Math.PI * 2 * longitude / longitudeSegments;
        vertices.push({ x: this.radiusValue * Math.cos(phi) * sinTheta, y: this.radiusValue * cosTheta, z: this.radiusValue * Math.sin(phi) * sinTheta });
      }
    }
    const row = longitudeSegments + 1;
    for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
      for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
        const a = latitude * row + longitude, b = a + row;
        if (latitude !== 0) indices.push(a, b, a + 1);
        if (latitude !== latitudeSegments - 1) indices.push(b, b + 1, a + 1);
      }
    }
    return { vertices: packedVector3Array(vertices), indices: packedInt32Array(indices) };
  }
  public getVertices(): PackedVector3Array { return this.geometryArrays().vertices; }
  public getIndices(): PackedInt32Array { return this.geometryArrays().indices; }
}

function positive(value: number, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new RangeError(`Godot ${member} requires a positive finite number.`);
  return value;
}
function subdivisionLevel(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4) throw new RangeError('Godot SphereOccluder3D.subdivision requires integer in [0, 4].');
  return value;
}

export function createQuadOccluder3D(): GodotQuadOccluder3D { return new GodotQuadOccluder3D(); }
export function createBoxOccluder3D(): GodotBoxOccluder3D { return new GodotBoxOccluder3D(); }
export function createSphereOccluder3D(): GodotSphereOccluder3D { return new GodotSphereOccluder3D(); }

function validateVertices(value: unknown): PackedVector3Array {
  if (!Array.isArray(value)) {
    throw new TypeError('Godot ArrayOccluder3D.vertices requires PackedVector3Array.');
  }
  const vertices = packedVector3Array(value);
  for (const point of vertices) {
    if (![point.x, point.y, point.z].every((part) => Number.isFinite(part))) {
      throw new TypeError('Godot ArrayOccluder3D.vertices requires finite Vector3 values.');
    }
  }
  return vertices;
}

function validateIndices(value: unknown): PackedInt32Array {
  if (!Array.isArray(value)) {
    throw new TypeError('Godot ArrayOccluder3D.indices requires PackedInt32Array.');
  }
  const indices = packedInt32Array(value);
  for (const index of indices) {
    if (!Number.isSafeInteger(index) || index < -0x8000_0000 || index > 0x7fff_ffff) {
      throw new RangeError('Godot ArrayOccluder3D.indices requires signed 32-bit integers.');
    }
  }
  return indices;
}

export function createArrayOccluder3D(
  vertices: PackedVector3Array = packedVector3Array(),
  indices: PackedInt32Array = packedInt32Array(),
): GodotArrayOccluder3D {
  const resource = new GodotArrayOccluder3D();
  if (vertices.length > 0 || indices.length > 0) resource.setArrays(vertices, indices);
  return resource;
}

export interface GodotOccluderInstance3D extends Object3D {
  occluder: GodotOccluder3DResource | null;
  bake_mask: number;
  bake_simplification_distance: number;
  set_occluder(value: GodotOccluder3DResource | null): void;
  get_occluder(): GodotOccluder3DResource | null;
  set_bake_mask(value: number): void;
  get_bake_mask(): number;
  set_bake_mask_value(layer: number, enabled: boolean): void;
  get_bake_mask_value(layer: number): boolean;
  set_bake_simplification_distance(value: number): void;
  get_bake_simplification_distance(): number;
}

interface OccluderInstanceState {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  occluder: GodotOccluder3DResource | null;
  resourceChanged: GodotConnection | null;
  bakeMask: number;
  simplificationDistance: number;
}

const OCCLUDER_INSTANCES = new WeakMap<Object3D, OccluderInstanceState>();

function replaceGeometry(state: OccluderInstanceState): void {
  const old = state.mesh.geometry;
  const geometry = new BufferGeometry();
  if (state.occluder !== null) {
    const arrays = state.occluder.geometryArrays();
    const invalid =
      arrays.indices.length % 3 !== 0 ||
      arrays.indices.some((index) => index < 0 || index >= arrays.vertices.length);
    if (invalid) {
      console.error(
        'godot-compat: ArrayOccluder3D has incomplete or out-of-range triangle indices; ' +
          'the retained occluder participates with empty geometry until corrected.',
      );
      state.mesh.geometry = geometry;
      old.dispose();
      return;
    }
    const positions = new Float32Array(arrays.vertices.length * 3);
    arrays.vertices.forEach((vertex, index) => {
      positions[index * 3] = vertex.x;
      positions[index * 3 + 1] = vertex.y;
      positions[index * 3 + 2] = vertex.z;
    });
    // Scene transform conversion changes handedness, so reverse Godot's triangle winding.
    const indices = new Uint32Array(arrays.indices.length);
    for (let index = 0; index < arrays.indices.length; index += 3) {
      indices[index] = arrays.indices[index] as number;
      indices[index + 1] = arrays.indices[index + 2] as number;
      indices[index + 2] = arrays.indices[index + 1] as number;
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(new Uint32BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  state.mesh.geometry = geometry;
  old.dispose();
}

function uint32(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`Godot ${member} requires an unsigned 32-bit integer.`);
  }
  return value;
}

function layer(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) {
    throw new RangeError('Godot OccluderInstance3D bake-mask layer must be in [1, 20].');
  }
  return value;
}

function finiteNonNegative(value: number, member: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Godot ${member} requires a finite number.`);
  }
  return Math.max(value, 0);
}

export function bindOccluderInstance3D(
  node: Object3D,
  initial: {
    readonly occluder?: GodotOccluder3DResource | null;
    readonly bakeMask?: number;
    readonly bakeSimplificationDistance?: number;
  } = {},
): GodotOccluderInstance3D {
  releaseOccluderInstance3D(node);
  const material = new MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: DoubleSide,
  });
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = '__godot_occluder_depth_prepass';
  mesh.renderOrder = -1_000_000;
  mesh.frustumCulled = true;
  node.add(mesh);
  const state: OccluderInstanceState = {
    mesh,
    occluder: null,
    resourceChanged: null,
    bakeMask: uint32(initial.bakeMask ?? 0xffff_ffff, 'OccluderInstance3D.bake_mask'),
    simplificationDistance: finiteNonNegative(
      initial.bakeSimplificationDistance ?? 0.1,
      'OccluderInstance3D.bake_simplification_distance',
    ),
  };
  OCCLUDER_INSTANCES.set(node, state);
  const api = node as GodotOccluderInstance3D;
  const assignOccluder = (value: GodotOccluder3DResource | null): void => {
    if (value !== null && (typeof value !== 'object' || typeof value.geometryArrays !== 'function')) {
      throw new TypeError(
        'Godot OccluderInstance3D.occluder requires an Occluder3D Resource.',
      );
    }
    if (state.occluder === value) return;
    state.resourceChanged?.disconnect();
    state.resourceChanged = null;
    state.occluder = value;
    if (value !== null) {
      state.resourceChanged = godotResourceChangedSignal(value).connect(() => replaceGeometry(state));
    }
    replaceGeometry(state);
  };
  Object.defineProperties(api, {
    occluder: { enumerable: true, configurable: true, get: () => state.occluder, set: assignOccluder },
    bake_mask: {
      enumerable: true,
      configurable: true,
      get: () => state.bakeMask,
      set: (value: number) => { state.bakeMask = uint32(value, 'OccluderInstance3D.bake_mask'); },
    },
    bake_simplification_distance: {
      enumerable: true,
      configurable: true,
      get: () => state.simplificationDistance,
      set: (value: number) => {
        state.simplificationDistance = finiteNonNegative(
          value,
          'OccluderInstance3D.bake_simplification_distance',
        );
      },
    },
    set_occluder: { configurable: true, value: assignOccluder },
    get_occluder: { configurable: true, value: () => state.occluder },
    set_bake_mask: { configurable: true, value: (value: number) => { api.bake_mask = value; } },
    get_bake_mask: { configurable: true, value: () => state.bakeMask },
    set_bake_mask_value: {
      configurable: true,
      value: (layerNumber: number, enabled: boolean) => {
        if (typeof enabled !== 'boolean') {
          throw new TypeError('Godot OccluderInstance3D.set_bake_mask_value requires bool.');
        }
        const bit = 2 ** (layer(layerNumber) - 1);
        api.bake_mask = enabled ? (state.bakeMask | bit) >>> 0 : (state.bakeMask & ~bit) >>> 0;
      },
    },
    get_bake_mask_value: {
      configurable: true,
      value: (layerNumber: number) => (state.bakeMask & 2 ** (layer(layerNumber) - 1)) !== 0,
    },
    set_bake_simplification_distance: {
      configurable: true,
      value: (value: number) => { api.bake_simplification_distance = value; },
    },
    get_bake_simplification_distance: {
      configurable: true,
      value: () => state.simplificationDistance,
    },
  });
  registerGodotObjectIdentity(api, 'OccluderInstance3D');
  assignOccluder(initial.occluder ?? null);
  return api;
}

export function createOccluderInstance3D(): GodotOccluderInstance3D {
  return bindOccluderInstance3D(new Object3D());
}

export function releaseOccluderInstance3D(node: Object3D): void {
  const state = OCCLUDER_INSTANCES.get(node);
  if (state === undefined) return;
  state.resourceChanged?.disconnect();
  node.remove(state.mesh);
  state.mesh.geometry.dispose();
  state.mesh.material.dispose();
  OCCLUDER_INSTANCES.delete(node);
}
