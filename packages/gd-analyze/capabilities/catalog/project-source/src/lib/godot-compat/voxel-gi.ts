import { registerGodotObjectIdentity } from './object';

export const GODOT_VOXEL_GI_SUBDIV = {
  SUBDIV_64: 0,
  SUBDIV_128: 1,
  SUBDIV_256: 2,
  SUBDIV_512: 3,
  MAX: 4,
  SUBDIV_MAX: 4,
} as const;

export const GODOT_VOXEL_GI_QUALITY = {
  LOW: 0,
  HIGH: 1,
  QUALITY_LOW: 0,
  QUALITY_HIGH: 1,
} as const;

export interface GodotVoxelGiVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface GodotVoxelGiAabb { readonly position: GodotVoxelGiVector3; readonly size: GodotVoxelGiVector3 }

export interface GodotVoxelGIData {
  readonly __godotClass: 'VoxelGIData';
  version: number;
  bounds: GodotVoxelGiAabb;
  octreeSize: GodotVoxelGiVector3;
  octreeCells: Uint8Array;
  dataCells: Uint8Array;
  distanceField: Uint8Array;
  levelCounts: number[];
  toCellXform: unknown;
  dynamicRange: number;
  energy: number;
  bias: number;
  normalBias: number;
  propagation: number;
  interior: boolean;
  useTwoBounces: boolean;
}

export interface GodotVoxelGI {
  readonly __godotClass: 'VoxelGI';
  subdiv: number;
  size: GodotVoxelGiVector3;
  data: GodotVoxelGIData | null;
  camera_attributes: unknown | null;
  quality: number;
}

export interface GodotVoxelGIApplyBinding {
  apply(node: GodotVoxelGI, data: GodotVoxelGIData | null): void;
}

type NodeListener = (node: GodotVoxelGI, member: string) => void;
const NODE_LISTENERS = new WeakMap<GodotVoxelGI, Set<NodeListener>>();
const DATA_LISTENERS = new WeakMap<GodotVoxelGIData, Set<() => void>>();
const BINDINGS = new WeakMap<GodotVoxelGI, GodotVoxelGIApplyBinding>();

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: VoxelGI.${member} requires a finite value in [${minimum}, ${maximum}].`);
  return value;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: VoxelGI.${member} requires an integer.`);
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: VoxelGI.${member} requires bool.`);
  return value;
}

function vector(value: unknown, member: string, minimum = -Infinity): GodotVoxelGiVector3 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError(`godot-compat: VoxelGI.${member} requires Vector3.`);
  return Object.freeze({ x: finite(value.x, `${member}.x`, minimum), y: finite(value.y, `${member}.y`, minimum), z: finite(value.z, `${member}.z`, minimum) });
}

function aabb(value: unknown): GodotVoxelGiAabb {
  if (typeof value !== 'object' || value === null || !('position' in value) || !('size' in value)) throw new TypeError('godot-compat: VoxelGIData.bounds requires AABB.');
  return Object.freeze({ position: vector(value.position, 'bounds.position'), size: vector(value.size, 'bounds.size', 0) });
}

function bytes(value: unknown, member: string): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value) && value.every((one) => Number.isSafeInteger(one) && one >= 0 && one <= 255)) return Uint8Array.from(value);
  throw new TypeError(`godot-compat: VoxelGIData.${member} requires PackedByteArray.`);
}

function data(value: unknown): GodotVoxelGIData | null {
  if (value === null) return null;
  if (typeof value !== 'object' || (value as { __godotClass?: unknown }).__godotClass !== 'VoxelGIData') throw new TypeError('godot-compat: VoxelGI.data requires VoxelGIData or null.');
  return value as GodotVoxelGIData;
}

function emitData(value: GodotVoxelGIData): void { for (const listener of DATA_LISTENERS.get(value) ?? []) listener(); }
function emitNode(node: GodotVoxelGI, member: string): void {
  for (const listener of NODE_LISTENERS.get(node) ?? []) listener(node, member);
  BINDINGS.get(node)?.apply(node, node.data);
}

function dataProperty(dataValue: GodotVoxelGIData, member: string, initial: unknown, normalize: (value: unknown) => unknown): void {
  let retained = normalize(initial);
  Object.defineProperty(dataValue, member, { enumerable: true, configurable: true, get: () => retained, set: (value: unknown) => { retained = normalize(value); emitData(dataValue); } });
}

function nodeProperty(node: GodotVoxelGI, member: string, initial: unknown, normalize: (value: unknown) => unknown): void {
  let retained = normalize(initial);
  Object.defineProperty(node, member, { enumerable: true, configurable: true, get: () => retained, set: (value: unknown) => { retained = normalize(value); emitNode(node, member); } });
}

export function createGodotVoxelGIData(): GodotVoxelGIData {
  const value = { __godotClass: 'VoxelGIData' as const } as GodotVoxelGIData;
  DATA_LISTENERS.set(value, new Set());
  dataProperty(value, 'version', 1, (next) => integer(next, 'VoxelGIData.version', 0, 65535));
  dataProperty(value, 'bounds', { position: { x: -10, y: -10, z: -10 }, size: { x: 20, y: 20, z: 20 } }, aabb);
  dataProperty(value, 'octreeSize', { x: 0, y: 0, z: 0 }, (next) => vector(next, 'VoxelGIData.octree_size', 0));
  dataProperty(value, 'octreeCells', new Uint8Array(), (next) => bytes(next, 'octree_cells'));
  dataProperty(value, 'dataCells', new Uint8Array(), (next) => bytes(next, 'data_cells'));
  dataProperty(value, 'distanceField', new Uint8Array(), (next) => bytes(next, 'distance_field'));
  dataProperty(value, 'levelCounts', [], (next) => {
    if (!Array.isArray(next)) throw new TypeError('VoxelGIData.level_counts requires PackedInt32Array.');
    return next.map((one) => integer(one, 'VoxelGIData.level_counts', 0, 0x7fff_ffff));
  });
  dataProperty(value, 'toCellXform', null, (next) => next);
  dataProperty(value, 'dynamicRange', 2, (next) => finite(next, 'dynamic_range', 0));
  dataProperty(value, 'energy', 1, (next) => finite(next, 'energy', 0));
  dataProperty(value, 'bias', 1.5, (next) => finite(next, 'bias', 0));
  dataProperty(value, 'normalBias', 0, (next) => finite(next, 'normal_bias', 0));
  dataProperty(value, 'propagation', 0.5, (next) => finite(next, 'propagation', 0, 1));
  dataProperty(value, 'interior', false, (next) => bool(next, 'interior'));
  dataProperty(value, 'useTwoBounces', true, (next) => bool(next, 'use_two_bounces'));
  registerGodotObjectIdentity(value, 'VoxelGIData');
  return value;
}

export function allocateGodotVoxelGIData(
  value: GodotVoxelGIData,
  transform: unknown,
  boundsValue: unknown,
  octreeSizeValue: unknown,
  octreeCellsValue: unknown,
  dataCellsValue: unknown,
  distanceFieldValue: unknown,
  levelCountsValue: unknown,
): void {
  value.toCellXform = transform;
  value.bounds = aabb(boundsValue);
  value.octreeSize = vector(octreeSizeValue, 'VoxelGIData.octree_size', 0);
  value.octreeCells = bytes(octreeCellsValue, 'octree_cells');
  value.dataCells = bytes(dataCellsValue, 'data_cells');
  value.distanceField = bytes(distanceFieldValue, 'distance_field');
  value.levelCounts = Array.isArray(levelCountsValue) ? levelCountsValue.map((one) => integer(one, 'level_counts', 0, 0x7fff_ffff)) : [];
  emitData(value);
}

export function getGodotVoxelGIDataOctreeCells(value: GodotVoxelGIData): Uint8Array { return value.octreeCells.slice(); }
export function getGodotVoxelGIDataCells(value: GodotVoxelGIData): Uint8Array { return value.dataCells.slice(); }
export function getGodotVoxelGIDataDistanceField(value: GodotVoxelGIData): Uint8Array { return value.distanceField.slice(); }
export function getGodotVoxelGIDataLevelCounts(value: GodotVoxelGIData): number[] { return [...value.levelCounts]; }
export function getGodotVoxelGIDataBounds(value: GodotVoxelGIData): GodotVoxelGiAabb { return aabb(value.bounds); }
export function getGodotVoxelGIDataOctreeSize(value: GodotVoxelGIData): GodotVoxelGiVector3 { return { ...value.octreeSize }; }
export function getGodotVoxelGIDataToCellXform(value: GodotVoxelGIData): unknown { return value.toCellXform; }

export function createGodotVoxelGI(): GodotVoxelGI {
  const node = { __godotClass: 'VoxelGI' as const } as GodotVoxelGI;
  NODE_LISTENERS.set(node, new Set());
  nodeProperty(node, 'subdiv', 1, (value) => integer(value, 'subdiv', 0, 3));
  nodeProperty(node, 'size', { x: 20, y: 20, z: 20 }, (value) => vector(value, 'size', Number.MIN_VALUE));
  nodeProperty(node, 'data', null, data);
  nodeProperty(node, 'camera_attributes', null, (value) => value ?? null);
  nodeProperty(node, 'quality', 0, (value) => integer(value, 'quality', 0, 1));
  registerGodotObjectIdentity(node, 'VoxelGI');
  return node;
}

export function bindGodotVoxelGI(node: GodotVoxelGI, binding: GodotVoxelGIApplyBinding): () => void {
  BINDINGS.set(node, binding); binding.apply(node, node.data);
  let releaseData: (() => void) | undefined;
  const connect = () => {
    releaseData?.(); releaseData = undefined;
    if (node.data !== null) { const listeners = DATA_LISTENERS.get(node.data)!; const update = () => binding.apply(node, node.data); listeners.add(update); releaseData = () => listeners.delete(update); }
    binding.apply(node, node.data);
  };
  const releaseNode = watchGodotVoxelGI(node, (_node, member) => { if (member === 'data') connect(); });
  connect();
  return () => { releaseNode(); releaseData?.(); if (BINDINGS.get(node) === binding) BINDINGS.delete(node); };
}

export function watchGodotVoxelGI(node: GodotVoxelGI, listener: NodeListener): () => void {
  const listeners = NODE_LISTENERS.get(node) ?? new Set<NodeListener>(); NODE_LISTENERS.set(node, listeners);
  listeners.add(listener); return () => listeners.delete(listener);
}

export function setGodotVoxelGIDataDynamicRange(value: GodotVoxelGIData, next: unknown): void { value.dynamicRange = finite(next, 'dynamic_range', 0); }
export function getGodotVoxelGIDataDynamicRange(value: GodotVoxelGIData): number { return value.dynamicRange; }
export function setGodotVoxelGIDataEnergy(value: GodotVoxelGIData, next: unknown): void { value.energy = finite(next, 'energy', 0); }
export function getGodotVoxelGIDataEnergy(value: GodotVoxelGIData): number { return value.energy; }
export function setGodotVoxelGIDataBias(value: GodotVoxelGIData, next: unknown): void { value.bias = finite(next, 'bias', 0); }
export function getGodotVoxelGIDataBias(value: GodotVoxelGIData): number { return value.bias; }
export function setGodotVoxelGIDataNormalBias(value: GodotVoxelGIData, next: unknown): void { value.normalBias = finite(next, 'normal_bias', 0); }
export function getGodotVoxelGIDataNormalBias(value: GodotVoxelGIData): number { return value.normalBias; }
export function setGodotVoxelGIDataPropagation(value: GodotVoxelGIData, next: unknown): void { value.propagation = finite(next, 'propagation', 0, 1); }
export function getGodotVoxelGIDataPropagation(value: GodotVoxelGIData): number { return value.propagation; }
export function setGodotVoxelGIDataInterior(value: GodotVoxelGIData, next: unknown): void { value.interior = bool(next, 'interior'); }
export function isGodotVoxelGIDataInterior(value: GodotVoxelGIData): boolean { return value.interior; }
export function setGodotVoxelGIDataUseTwoBounces(value: GodotVoxelGIData, next: unknown): void { value.useTwoBounces = bool(next, 'use_two_bounces'); }
export function isGodotVoxelGIDataUsingTwoBounces(value: GodotVoxelGIData): boolean { return value.useTwoBounces; }
