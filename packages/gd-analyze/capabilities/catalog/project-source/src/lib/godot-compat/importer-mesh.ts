import type { BufferGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotImporterMeshSurface {
  primitive: number;
  arrays: unknown[];
  blendShapes: unknown[][];
  lods: Map<number, number[]>;
  material: unknown | null;
  name: string;
  flags: number;
}

export interface GodotImporterMeshSurfaceSnapshot {
  readonly primitive: number;
  readonly arrays: readonly unknown[];
  readonly blendShapes: readonly (readonly unknown[])[];
  readonly lods: ReadonlyMap<number, readonly number[]>;
  readonly material: unknown | null;
  readonly name: string;
  readonly flags: number;
}

export interface GodotImporterMeshSnapshot {
  readonly blendShapes: readonly string[];
  readonly blendShapeMode: number;
  readonly surfaces: readonly GodotImporterMeshSurfaceSnapshot[];
  readonly lightmapSizeHint: { readonly x: number; readonly y: number };
  readonly revision: number;
}

export interface GodotImporterMeshBinding {
  build(snapshot: GodotImporterMeshSnapshot, baseMesh: BufferGeometry | null): BufferGeometry;
  import(mesh: BufferGeometry): GodotImporterMeshSnapshot;
  generateLods?(snapshot: GodotImporterMeshSnapshot, options: { normalMergeAngle: number; normalSplitAngle: number; boneTransforms: readonly unknown[] }): readonly ReadonlyMap<number, readonly number[]>[];
}

let binding: GodotImporterMeshBinding | null = null;

function integer(value: unknown, member: string, minimum = 0, maximum = 0x7fff_ffff): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new RangeError(`godot-compat: ImporterMesh.${member} requires integer in [${minimum}, ${maximum}].`);
  return value as number;
}
function finite(value: unknown, member: string, minimum = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new RangeError(`godot-compat: ImporterMesh.${member} requires finite value >= ${minimum}.`);
  return value;
}
function bool(value: unknown, member: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`godot-compat: ImporterMesh.${member} requires bool.`); return value; }
function surfaceSnapshot(surface: GodotImporterMeshSurface): GodotImporterMeshSurfaceSnapshot { return Object.freeze({ primitive: surface.primitive, arrays: Object.freeze([...surface.arrays]), blendShapes: Object.freeze(surface.blendShapes.map((one) => Object.freeze([...one]))), lods: new Map([...surface.lods].map(([size, indices]) => [size, Object.freeze([...indices])])), material: surface.material, name: surface.name, flags: surface.flags }); }

export function bindGodotImporterMesh(next: GodotImporterMeshBinding | null): () => void { binding = next; return () => { if (binding === next) binding = null; }; }

export class GodotImporterMesh {
  public readonly __godotClass = 'ImporterMesh';
  private blendShapes: string[] = [];
  private blendShapeMode = 0;
  private surfaces: GodotImporterMeshSurface[] = [];
  private lightmapSizeHint: Readonly<{ x: number; y: number }> = Object.freeze({ x: 0, y: 0 });
  private revision = 0;
  private readonly watchers = new Set<(snapshot: GodotImporterMeshSnapshot) => void>();

  public constructor() {
    registerGodotObjectIdentity(this, 'ImporterMesh');
    bindGodotResourceProtocol<GodotImporterMesh>(this, { createDuplicate: (source) => GodotImporterMesh.fromSnapshot(source.snapshot()) });
  }
  public static fromSnapshot(snapshot: GodotImporterMeshSnapshot): GodotImporterMesh {
    const value = new GodotImporterMesh(); value.blendShapes = [...snapshot.blendShapes]; value.blendShapeMode = snapshot.blendShapeMode;
    value.surfaces = snapshot.surfaces.map((surface) => ({ primitive: surface.primitive, arrays: [...surface.arrays], blendShapes: surface.blendShapes.map((one) => [...one]), lods: new Map([...surface.lods].map(([size, indices]) => [size, [...indices]])), material: surface.material, name: surface.name, flags: surface.flags }));
    value.lightmapSizeHint = Object.freeze({ ...snapshot.lightmapSizeHint }); value.revision = snapshot.revision; return value;
  }
  private changed(): void { this.revision += 1; const snapshot = this.snapshot(); for (const watcher of this.watchers) watcher(snapshot); godotResourceEmitChanged(this); }
  private surface(index: unknown, member: string): GodotImporterMeshSurface { const surface = this.surfaces[integer(index, member, 0, this.surfaces.length - 1)]; if (surface === undefined) throw new RangeError(`godot-compat: ImporterMesh.${member} surface is out of bounds.`); return surface; }
  public snapshot(): GodotImporterMeshSnapshot { return Object.freeze({ blendShapes: Object.freeze([...this.blendShapes]), blendShapeMode: this.blendShapeMode, surfaces: Object.freeze(this.surfaces.map(surfaceSnapshot)), lightmapSizeHint: Object.freeze({ ...this.lightmapSizeHint }), revision: this.revision }); }
  public watch(watcher: (snapshot: GodotImporterMeshSnapshot) => void): () => void { this.watchers.add(watcher); watcher(this.snapshot()); return () => this.watchers.delete(watcher); }
  public addBlendShape(name: unknown): void { const value = String(name); if (value.length === 0 || this.blendShapes.includes(value)) throw new Error('godot-compat: ImporterMesh blend shape name must be nonempty and unique.'); this.blendShapes.push(value); this.changed(); }
  public getBlendShapeCount(): number { return this.blendShapes.length; }
  public getBlendShapeName(index: unknown): string { return this.blendShapes[integer(index, 'get_blend_shape_name', 0, this.blendShapes.length - 1)]!; }
  public setBlendShapeMode(mode: unknown): void { this.blendShapeMode = integer(mode, 'set_blend_shape_mode', 0, 1); this.changed(); }
  public getBlendShapeMode(): number { return this.blendShapeMode; }
  public addSurface(primitive: unknown, arrays: unknown, blendShapes: unknown = [], lods: unknown = {}, material: unknown = null, name: unknown = '', flags: unknown = 0): void {
    if (!Array.isArray(arrays) || !Array.isArray(blendShapes)) throw new TypeError('godot-compat: ImporterMesh.add_surface requires array data.');
    const lodMap = new Map<number, number[]>();
    const entries = lods instanceof Map ? lods.entries() : typeof lods === 'object' && lods !== null ? Object.entries(lods) : [];
    for (const [size, indices] of entries) { if (!Array.isArray(indices)) throw new TypeError('godot-compat: ImporterMesh LOD indices require PackedInt32Array.'); lodMap.set(finite(Number(size), 'add_surface.lod_size', 0), indices.map((one) => integer(one, 'add_surface.lod_index'))); }
    this.surfaces.push({ primitive: integer(primitive, 'add_surface.primitive', 0, 6), arrays: [...arrays], blendShapes: blendShapes.map((one) => { if (!Array.isArray(one)) throw new TypeError('godot-compat: ImporterMesh blend shape requires Array.'); return [...one]; }), lods: lodMap, material, name: String(name), flags: integer(flags, 'add_surface.flags', 0, 0xffff_ffff) }); this.changed();
  }
  public getSurfaceCount(): number { return this.surfaces.length; }
  public getSurfacePrimitiveType(index: unknown): number { return this.surface(index, 'get_surface_primitive_type').primitive; }
  public getSurfaceName(index: unknown): string { return this.surface(index, 'get_surface_name').name; }
  public getSurfaceArrays(index: unknown): unknown[] { return [...this.surface(index, 'get_surface_arrays').arrays]; }
  public getSurfaceBlendShapeArrays(surfaceIndex: unknown, blendShapeIndex: unknown): unknown[] { const surface = this.surface(surfaceIndex, 'get_surface_blend_shape_arrays'); return [...(surface.blendShapes[integer(blendShapeIndex, 'get_surface_blend_shape_arrays.blend_shape', 0, surface.blendShapes.length - 1)] ?? [])]; }
  public getSurfaceLodCount(index: unknown): number { return this.surface(index, 'get_surface_lod_count').lods.size; }
  public getSurfaceLodSize(index: unknown, lodIndex: unknown): number { const keys = [...this.surface(index, 'get_surface_lod_size').lods.keys()]; return keys[integer(lodIndex, 'get_surface_lod_size.lod', 0, keys.length - 1)]!; }
  public getSurfaceLodIndices(index: unknown, lodIndex: unknown): number[] { const surface = this.surface(index, 'get_surface_lod_indices'), keys = [...surface.lods.keys()], size = keys[integer(lodIndex, 'get_surface_lod_indices.lod', 0, keys.length - 1)]!; return [...surface.lods.get(size)!]; }
  public getSurfaceMaterial(index: unknown): unknown | null { return this.surface(index, 'get_surface_material').material; }
  public getSurfaceFormat(index: unknown): number { const arrays = this.surface(index, 'get_surface_format').arrays; return arrays.reduce<number>((bits, value, slot) => value === null || value === undefined ? bits : bits | 2 ** slot, 0); }
  public setSurfaceName(index: unknown, name: unknown): void { this.surface(index, 'set_surface_name').name = String(name); this.changed(); }
  public setSurfaceMaterial(index: unknown, material: unknown): void { this.surface(index, 'set_surface_material').material = material; this.changed(); }
  public generateLods(normalMergeAngle: unknown, normalSplitAngle: unknown, boneTransforms: unknown): void {
    if (!Array.isArray(boneTransforms)) throw new TypeError('godot-compat: ImporterMesh.generate_lods bone transforms require Array.');
    const generated = binding?.generateLods?.(this.snapshot(), { normalMergeAngle: finite(normalMergeAngle, 'generate_lods.normal_merge_angle'), normalSplitAngle: finite(normalSplitAngle, 'generate_lods.normal_split_angle'), boneTransforms });
    if (generated === undefined) throw new Error('godot-compat: ImporterMesh.generate_lods requires native simplifier binding.');
    generated.forEach((lods, index) => { const surface = this.surfaces[index]; if (surface !== undefined) surface.lods = new Map([...lods].map(([size, indices]) => [size, [...indices]])); }); this.changed();
  }
  public getMesh(baseMesh: BufferGeometry | null = null): BufferGeometry { if (binding === null) throw new Error('godot-compat: ImporterMesh.get_mesh requires bindGodotImporterMesh().'); return binding.build(this.snapshot(), baseMesh); }
  public clear(): void { this.blendShapes.length = 0; this.blendShapeMode = 0; this.surfaces.length = 0; this.lightmapSizeHint = Object.freeze({ x: 0, y: 0 }); this.changed(); }
  public setLightmapSizeHint(value: unknown): void { if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new TypeError('godot-compat: ImporterMesh.lightmap_size_hint requires Vector2i.'); this.lightmapSizeHint = Object.freeze({ x: integer(value.x, 'lightmap_size_hint.x'), y: integer(value.y, 'lightmap_size_hint.y') }); this.changed(); }
  public getLightmapSizeHint(): { x: number; y: number } { return { ...this.lightmapSizeHint }; }
}

export function createGodotImporterMesh(): GodotImporterMesh { return new GodotImporterMesh(); }
export function godotImporterMeshFromMesh(mesh: BufferGeometry): GodotImporterMesh { if (binding === null) throw new Error('godot-compat: ImporterMesh.from_mesh requires bindGodotImporterMesh().'); return GodotImporterMesh.fromSnapshot(binding.import(mesh)); }
export function mergeGodotImporterMeshes(meshes: unknown, relativeTransforms: unknown, deduplicateSurfaces = false): GodotImporterMesh {
  if (!Array.isArray(meshes) || meshes.some((mesh) => !(mesh instanceof GodotImporterMesh)) || !Array.isArray(relativeTransforms) || relativeTransforms.length !== meshes.length) throw new TypeError('godot-compat: ImporterMesh.merge_importer_meshes requires equally sized ImporterMesh and Transform3D arrays.');
  bool(deduplicateSurfaces, 'merge_importer_meshes.deduplicate_surfaces'); const merged = new GodotImporterMesh();
  for (let index = 0; index < meshes.length; index += 1) {
    const source = meshes[index] as GodotImporterMesh, transform = relativeTransforms[index], snapshot = source.snapshot();
    for (const name of snapshot.blendShapes) if (!merged.snapshot().blendShapes.includes(name)) merged.addBlendShape(name);
    for (const surface of snapshot.surfaces) {
      const arrays = [...surface.arrays]; arrays.push({ __godotRelativeTransform: transform });
      if (deduplicateSurfaces && merged.snapshot().surfaces.some((one) => one.name === surface.name && one.primitive === surface.primitive)) continue;
      merged.addSurface(surface.primitive, arrays, surface.blendShapes, surface.lods, surface.material, surface.name, surface.flags);
    }
  }
  return merged;
}
