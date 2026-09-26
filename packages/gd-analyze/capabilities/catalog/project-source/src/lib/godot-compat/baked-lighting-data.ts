import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

interface LightmapUser {
  path: string;
  uvScale: unknown;
  sliceIndex: number;
  subInstance: number;
}

export class GodotLightmapGIData {
  private lightTexture: unknown = null;
  private usesSphericalHarmonics = false;
  private readonly users: LightmapUser[] = [];
  constructor() { registerGodotObjectIdentity(this, 'LightmapGIData'); }
  set_light_texture(value: unknown): void { this.lightTexture = value; godotResourceEmitChanged(this); }
  get_light_texture(): unknown { return this.lightTexture; }
  set_uses_spherical_harmonics(value: boolean): void { this.usesSphericalHarmonics = value; godotResourceEmitChanged(this); }
  is_using_spherical_harmonics(): boolean { return this.usesSphericalHarmonics; }
  add_user(path: string, uvScale: unknown, sliceIndex: number, subInstance: number): number {
    this.users.push({ path, uvScale, sliceIndex: Math.trunc(sliceIndex), subInstance: Math.trunc(subInstance) }); godotResourceEmitChanged(this); return this.users.length - 1;
  }
  clear_users(): void { if (this.users.length) { this.users.length = 0; godotResourceEmitChanged(this); } }
  get_user_count(): number { return this.users.length; }
  get_user_path(index: number): string { return this.users[index]?.path ?? ''; }
  get_user_lightmap_uv_scale(index: number): unknown { return this.users[index]?.uvScale ?? null; }
  get_user_lightmap_slice_index(index: number): number { return this.users[index]?.sliceIndex ?? -1; }
  get_user_lightmap_sub_instance(index: number): number { return this.users[index]?.subInstance ?? -1; }
}

export interface GodotVoxelGIAllocation {
  toCellXform: unknown;
  aabb: unknown;
  octreeSize: Readonly<{ x: number; y: number; z: number }>;
  octreeCells: Uint8Array;
  dataCells: Uint8Array;
  distanceField: Uint8Array;
  levelCounts: number[];
}

function emptyAllocation(): GodotVoxelGIAllocation {
  return { toCellXform: null, aabb: null, octreeSize: { x: 0, y: 0, z: 0 }, octreeCells: new Uint8Array(), dataCells: new Uint8Array(), distanceField: new Uint8Array(), levelCounts: [] };
}

export class GodotVoxelGIData {
  private allocation = emptyAllocation();
  private dynamicRange = 2;
  private energy = 1;
  private bias = 1.5;
  private normalBias = 0;
  private propagation = 0.5;
  private useTwoBounces = true;
  private interior = false;
  private version = 0;
  constructor() { registerGodotObjectIdentity(this, 'VoxelGIData'); }

  allocate(toCellXform: unknown, aabb: unknown, octreeSize: Readonly<{ x: number; y: number; z: number }>, octreeCells: Uint8Array | readonly number[], dataCells: Uint8Array | readonly number[], distanceField: Uint8Array | readonly number[], levelCounts: readonly number[]): void {
    this.allocation = {
      toCellXform, aabb, octreeSize: { ...octreeSize }, octreeCells: Uint8Array.from(octreeCells), dataCells: Uint8Array.from(dataCells),
      distanceField: Uint8Array.from(distanceField), levelCounts: levelCounts.map((value) => Math.max(0, Math.trunc(value))),
    };
    this.version += 1; godotResourceEmitChanged(this);
  }
  get_bounds(): unknown { return this.allocation.aabb; }
  get_octree_size(): Readonly<{ x: number; y: number; z: number }> { return { ...this.allocation.octreeSize }; }
  get_to_cell_xform(): unknown { return this.allocation.toCellXform; }
  get_octree_cells(): Uint8Array { return this.allocation.octreeCells.slice(); }
  get_data_cells(): Uint8Array { return this.allocation.dataCells.slice(); }
  get_distance_field(): Uint8Array { return this.allocation.distanceField.slice(); }
  get_level_counts(): number[] { return [...this.allocation.levelCounts]; }
  get_version(): number { return this.version; }
  set_dynamic_range(value: number): void { this.dynamicRange = Math.max(0, value); godotResourceEmitChanged(this); }
  get_dynamic_range(): number { return this.dynamicRange; }
  set_energy(value: number): void { this.energy = Math.max(0, value); godotResourceEmitChanged(this); }
  get_energy(): number { return this.energy; }
  set_bias(value: number): void { this.bias = Math.max(0, value); godotResourceEmitChanged(this); }
  get_bias(): number { return this.bias; }
  set_normal_bias(value: number): void { this.normalBias = Math.max(0, value); godotResourceEmitChanged(this); }
  get_normal_bias(): number { return this.normalBias; }
  set_propagation(value: number): void { this.propagation = Math.max(0, Math.min(1, value)); godotResourceEmitChanged(this); }
  get_propagation(): number { return this.propagation; }
  set_use_two_bounces(value: boolean): void { this.useTwoBounces = value; godotResourceEmitChanged(this); }
  is_using_two_bounces(): boolean { return this.useTwoBounces; }
  set_interior(value: boolean): void { this.interior = value; godotResourceEmitChanged(this); }
  is_interior(): boolean { return this.interior; }
}

export const createGodotLightmapGIData = (): GodotLightmapGIData => new GodotLightmapGIData();
export const createGodotVoxelGIData = (): GodotVoxelGIData => new GodotVoxelGIData();
