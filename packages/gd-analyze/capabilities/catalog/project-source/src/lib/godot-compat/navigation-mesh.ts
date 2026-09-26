/** Godot NavigationMesh retained resource data consumed by the native Recast navigation lane. */
import { BufferGeometry } from 'three';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  godotResourceEmitChanged,
} from './resource-io';

export interface NavigationMeshVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GodotNavigationMeshOptions {
  readonly vertices?: readonly NavigationMeshVector3[];
  readonly polygons?: readonly (readonly number[])[];
  readonly samplePartitionType?: number;
  readonly parsedGeometryType?: number;
  readonly parsedCollisionMask?: number;
  readonly sourceGeometryMode?: number;
  readonly sourceGeometryGroupName?: string;
  readonly cellSize?: number;
  readonly cellHeight?: number;
  readonly agentHeight?: number;
  readonly agentRadius?: number;
  readonly agentMaxClimb?: number;
  readonly agentMaxSlope?: number;
  readonly regionMinSize?: number;
  readonly regionMergeSize?: number;
  readonly edgeMaxLength?: number;
  readonly edgeMaxError?: number;
  readonly verticesPerPolygon?: number;
  readonly detailSampleDistance?: number;
  readonly detailSampleMaxError?: number;
  readonly filterLowHangingObstacles?: boolean;
  readonly filterLedgeSpans?: boolean;
  readonly filterWalkableLowHeightSpans?: boolean;
  readonly filterBakingAabb?: NavigationMeshAabb;
  readonly filterBakingAabbOffset?: NavigationMeshVector3;
}

export interface NavigationMeshAabb {
  readonly position: NavigationMeshVector3;
  readonly size: NavigationMeshVector3;
}

export interface GodotNavigationMesh {
  readonly kind: 'NavigationMesh';
  vertices: readonly NavigationMeshVector3[];
  polygons: readonly (readonly number[])[];
  sample_partition_type: number;
  parsed_geometry_type: number;
  parsed_collision_mask: number;
  source_geometry_mode: number;
  source_geometry_group_name: string;
  cell_size: number;
  cell_height: number;
  agent_height: number;
  agent_radius: number;
  agent_max_climb: number;
  agent_max_slope: number;
  region_min_size: number;
  region_merge_size: number;
  edge_max_length: number;
  edge_max_error: number;
  vertices_per_polygon: number;
  detail_sample_distance: number;
  detail_sample_max_error: number;
  filter_low_hanging_obstacles: boolean;
  filter_ledge_spans: boolean;
  filter_walkable_low_height_spans: boolean;
  filter_baking_aabb: NavigationMeshAabb;
  filter_baking_aabb_offset: NavigationMeshVector3;
  set_vertices(value: readonly NavigationMeshVector3[]): void;
  get_vertices(): readonly NavigationMeshVector3[];
  add_polygon(value: readonly number[]): void;
  get_polygon_count(): number;
  get_polygon(index: number): readonly number[];
  clear_polygons(): void;
  set_polygons(value: readonly (readonly number[])[]): void;
  get_polygons(): readonly (readonly number[])[];
  set_sample_partition_type(value: number): void;
  get_sample_partition_type(): number;
  set_parsed_geometry_type(value: number): void;
  get_parsed_geometry_type(): number;
  set_parsed_collision_mask(value: number): void;
  get_parsed_collision_mask(): number;
  set_parsed_collision_mask_value(layer: number, enabled: boolean): void;
  get_parsed_collision_mask_value(layer: number): boolean;
  set_source_geometry_mode(value: number): void;
  get_source_geometry_mode(): number;
  set_source_geometry_group_name(value: string): void;
  get_source_geometry_group_name(): string;
  set_cell_size(value: number): void;
  get_cell_size(): number;
  set_cell_height(value: number): void;
  get_cell_height(): number;
  set_agent_height(value: number): void;
  get_agent_height(): number;
  set_agent_radius(value: number): void;
  get_agent_radius(): number;
  set_agent_max_climb(value: number): void;
  get_agent_max_climb(): number;
  set_agent_max_slope(value: number): void;
  get_agent_max_slope(): number;
  set_region_min_size(value: number): void;
  get_region_min_size(): number;
  set_region_merge_size(value: number): void;
  get_region_merge_size(): number;
  set_edge_max_length(value: number): void;
  get_edge_max_length(): number;
  set_edge_max_error(value: number): void;
  get_edge_max_error(): number;
  set_vertices_per_polygon(value: number): void;
  get_vertices_per_polygon(): number;
  set_detail_sample_distance(value: number): void;
  get_detail_sample_distance(): number;
  set_detail_sample_max_error(value: number): void;
  get_detail_sample_max_error(): number;
  set_filter_low_hanging_obstacles(value: boolean): void;
  get_filter_low_hanging_obstacles(): boolean;
  set_filter_ledge_spans(value: boolean): void;
  get_filter_ledge_spans(): boolean;
  set_filter_walkable_low_height_spans(value: boolean): void;
  get_filter_walkable_low_height_spans(): boolean;
  set_filter_baking_aabb(value: NavigationMeshAabb): void;
  get_filter_baking_aabb(): NavigationMeshAabb;
  set_filter_baking_aabb_offset(value: NavigationMeshVector3): void;
  get_filter_baking_aabb_offset(): NavigationMeshVector3;
  create_from_mesh(value: BufferGeometry): void;
  clear(): void;
}

const point = (value: NavigationMeshVector3): NavigationMeshVector3 => {
  const result = { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  if (![result.x, result.y, result.z].every(Number.isFinite)) {
    throw new TypeError('NavigationMesh vertices require finite Vector3 components.');
  }
  return result;
};
const polygon = (value: readonly number[]): number[] => value.map((entry) => {
  if (!Number.isSafeInteger(entry) || entry < 0) throw new RangeError('NavigationMesh polygon indices require non-negative integers.');
  return entry;
});
const finite = (value: number, member: string, minimum = 0): number => {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`NavigationMesh.${member} must be finite and at least ${minimum}.`);
  return value;
};
const integer = (value: number, member: string, minimum: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`NavigationMesh.${member} must be an integer in [${minimum}, ${maximum}].`);
  return value;
};
const bool = (value: boolean, member: string): boolean => {
  if (typeof value !== 'boolean') throw new TypeError(`NavigationMesh.${member} requires bool.`);
  return value;
};
const text = (value: string, member: string): string => {
  if (typeof value !== 'string') throw new TypeError(`NavigationMesh.${member} requires String.`);
  return value;
};
const checkedPolygonIndex = (value: number, length: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) throw new RangeError(`NavigationMesh polygon index ${value} is outside [0, ${length - 1}].`);
  return value;
};
const copyAabb = (value: NavigationMeshAabb): NavigationMeshAabb => ({ position: point(value.position), size: point(value.size) });

function navigationGeometry(value: unknown): BufferGeometry {
  if (!(value instanceof BufferGeometry)) {
    throw new TypeError('NavigationMesh.create_from_mesh requires a native THREE.BufferGeometry Mesh resource.');
  }
  return value;
}

function geometryNavigationData(value: BufferGeometry): {
  readonly vertices: readonly NavigationMeshVector3[];
  readonly polygons: readonly (readonly number[])[];
} {
  const position = value.getAttribute('position');
  if (position === undefined || position.itemSize < 3) {
    throw new Error('NavigationMesh.create_from_mesh requires a position BufferAttribute with three components.');
  }
  const vertices: NavigationMeshVector3[] = [];
  for (let index = 0; index < position.count; index += 1) {
    vertices.push(point({ x: position.getX(index), y: position.getY(index), z: position.getZ(index) }));
  }
  const indices = value.getIndex();
  const elementCount = indices?.count ?? position.count;
  if (elementCount % 3 !== 0) {
    throw new Error(`NavigationMesh.create_from_mesh requires triangle geometry; received ${elementCount} element indices.`);
  }
  const polygons: number[][] = [];
  for (let index = 0; index < elementCount; index += 3) {
    const a = indices?.getX(index) ?? index;
    const b = indices?.getX(index + 1) ?? index + 1;
    const c = indices?.getX(index + 2) ?? index + 2;
    polygons.push(polygon([a, b, c]));
  }
  return { vertices, polygons };
}

export function isGodotNavigationMesh(value: unknown): value is GodotNavigationMesh {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'NavigationMesh';
}

export function createGodotNavigationMesh(options: GodotNavigationMeshOptions = {}): GodotNavigationMesh {
  let vertices = (options.vertices ?? []).map(point);
  let polygons = (options.polygons ?? []).map(polygon);
  let samplePartitionType = 0, parsedGeometryType = 2, parsedCollisionMask = 0xffff_ffff;
  let sourceGeometryMode = 0, sourceGeometryGroupName = 'navigation_mesh_source_geometry_group';
  let cellSize = 0.25, cellHeight = 0.25, agentHeight = 1.5, agentRadius = 0.5, agentMaxClimb = 0.25, agentMaxSlope = 45;
  let regionMinSize = 2, regionMergeSize = 20, edgeMaxLength = 0, edgeMaxError = 1.3, verticesPerPolygon = 6;
  let detailSampleDistance = 6, detailSampleMaxError = 1;
  let filterLowHangingObstacles = false, filterLedgeSpans = false, filterWalkableLowHeightSpans = false;
  let filterBakingAabb: NavigationMeshAabb = { position: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } };
  let filterBakingAabbOffset: NavigationMeshVector3 = { x: 0, y: 0, z: 0 };
  let mesh!: GodotNavigationMesh;
  const changed = (): void => godotResourceEmitChanged(mesh);
  mesh = {
    kind: 'NavigationMesh',
    get vertices() { return mesh.get_vertices(); }, set vertices(value) { mesh.set_vertices(value); },
    get polygons() { return mesh.get_polygons(); }, set polygons(value) { mesh.set_polygons(value); },
    get sample_partition_type() { return samplePartitionType; }, set sample_partition_type(value) { mesh.set_sample_partition_type(value); },
    get parsed_geometry_type() { return parsedGeometryType; }, set parsed_geometry_type(value) { mesh.set_parsed_geometry_type(value); },
    get parsed_collision_mask() { return parsedCollisionMask; }, set parsed_collision_mask(value) { mesh.set_parsed_collision_mask(value); },
    get source_geometry_mode() { return sourceGeometryMode; }, set source_geometry_mode(value) { mesh.set_source_geometry_mode(value); },
    get source_geometry_group_name() { return sourceGeometryGroupName; }, set source_geometry_group_name(value) { mesh.set_source_geometry_group_name(value); },
    get cell_size() { return cellSize; }, set cell_size(value) { mesh.set_cell_size(value); },
    get cell_height() { return cellHeight; }, set cell_height(value) { mesh.set_cell_height(value); },
    get agent_height() { return agentHeight; }, set agent_height(value) { mesh.set_agent_height(value); },
    get agent_radius() { return agentRadius; }, set agent_radius(value) { mesh.set_agent_radius(value); },
    get agent_max_climb() { return agentMaxClimb; }, set agent_max_climb(value) { mesh.set_agent_max_climb(value); },
    get agent_max_slope() { return agentMaxSlope; }, set agent_max_slope(value) { mesh.set_agent_max_slope(value); },
    get region_min_size() { return regionMinSize; }, set region_min_size(value) { mesh.set_region_min_size(value); },
    get region_merge_size() { return regionMergeSize; }, set region_merge_size(value) { mesh.set_region_merge_size(value); },
    get edge_max_length() { return edgeMaxLength; }, set edge_max_length(value) { mesh.set_edge_max_length(value); },
    get edge_max_error() { return edgeMaxError; }, set edge_max_error(value) { mesh.set_edge_max_error(value); },
    get vertices_per_polygon() { return verticesPerPolygon; }, set vertices_per_polygon(value) { mesh.set_vertices_per_polygon(value); },
    get detail_sample_distance() { return detailSampleDistance; }, set detail_sample_distance(value) { mesh.set_detail_sample_distance(value); },
    get detail_sample_max_error() { return detailSampleMaxError; }, set detail_sample_max_error(value) { mesh.set_detail_sample_max_error(value); },
    get filter_low_hanging_obstacles() { return filterLowHangingObstacles; }, set filter_low_hanging_obstacles(value) { mesh.set_filter_low_hanging_obstacles(value); },
    get filter_ledge_spans() { return filterLedgeSpans; }, set filter_ledge_spans(value) { mesh.set_filter_ledge_spans(value); },
    get filter_walkable_low_height_spans() { return filterWalkableLowHeightSpans; }, set filter_walkable_low_height_spans(value) { mesh.set_filter_walkable_low_height_spans(value); },
    get filter_baking_aabb() { return mesh.get_filter_baking_aabb(); }, set filter_baking_aabb(value) { mesh.set_filter_baking_aabb(value); },
    get filter_baking_aabb_offset() { return mesh.get_filter_baking_aabb_offset(); }, set filter_baking_aabb_offset(value) { mesh.set_filter_baking_aabb_offset(value); },
    set_vertices(value) { vertices = value.map(point); changed(); }, get_vertices: () => vertices.map(point),
    add_polygon(value) { polygons.push(polygon(value)); changed(); }, get_polygon_count: () => polygons.length,
    get_polygon(index) { return [...polygons[checkedPolygonIndex(index, polygons.length)]!]; },
    clear_polygons() { if (polygons.length === 0) return; polygons = []; changed(); },
    set_polygons(value) { polygons = value.map(polygon); changed(); }, get_polygons: () => polygons.map((value) => [...value]),
    set_sample_partition_type(value) { samplePartitionType = integer(value, 'sample_partition_type', 0, 2); changed(); }, get_sample_partition_type: () => samplePartitionType,
    set_parsed_geometry_type(value) { parsedGeometryType = integer(value, 'parsed_geometry_type', 0, 2); changed(); }, get_parsed_geometry_type: () => parsedGeometryType,
    set_parsed_collision_mask(value) { parsedCollisionMask = value >>> 0; changed(); }, get_parsed_collision_mask: () => parsedCollisionMask,
    set_parsed_collision_mask_value(layer, enabled) { const bit = 2 ** (integer(layer, 'parsed_collision_mask layer', 1, 32) - 1); parsedCollisionMask = enabled ? (parsedCollisionMask | bit) >>> 0 : (parsedCollisionMask & ~bit) >>> 0; changed(); },
    get_parsed_collision_mask_value(layer) { return (parsedCollisionMask & 2 ** (integer(layer, 'parsed_collision_mask layer', 1, 32) - 1)) !== 0; },
    set_source_geometry_mode(value) { sourceGeometryMode = integer(value, 'source_geometry_mode', 0, 2); changed(); }, get_source_geometry_mode: () => sourceGeometryMode,
    set_source_geometry_group_name(value) { sourceGeometryGroupName = text(value, 'source_geometry_group_name'); changed(); }, get_source_geometry_group_name: () => sourceGeometryGroupName,
    set_cell_size(value) { cellSize = finite(value, 'cell_size', Number.EPSILON); changed(); }, get_cell_size: () => cellSize,
    set_cell_height(value) { cellHeight = finite(value, 'cell_height', Number.EPSILON); changed(); }, get_cell_height: () => cellHeight,
    set_agent_height(value) { agentHeight = finite(value, 'agent_height'); changed(); }, get_agent_height: () => agentHeight,
    set_agent_radius(value) { agentRadius = finite(value, 'agent_radius'); changed(); }, get_agent_radius: () => agentRadius,
    set_agent_max_climb(value) { agentMaxClimb = finite(value, 'agent_max_climb'); changed(); }, get_agent_max_climb: () => agentMaxClimb,
    set_agent_max_slope(value) { agentMaxSlope = finite(value, 'agent_max_slope'); changed(); }, get_agent_max_slope: () => agentMaxSlope,
    set_region_min_size(value) { regionMinSize = finite(value, 'region_min_size'); changed(); }, get_region_min_size: () => regionMinSize,
    set_region_merge_size(value) { regionMergeSize = finite(value, 'region_merge_size'); changed(); }, get_region_merge_size: () => regionMergeSize,
    set_edge_max_length(value) { edgeMaxLength = finite(value, 'edge_max_length'); changed(); }, get_edge_max_length: () => edgeMaxLength,
    set_edge_max_error(value) { edgeMaxError = finite(value, 'edge_max_error'); changed(); }, get_edge_max_error: () => edgeMaxError,
    set_vertices_per_polygon(value) { verticesPerPolygon = integer(value, 'vertices_per_polygon', 3, 12); changed(); }, get_vertices_per_polygon: () => verticesPerPolygon,
    set_detail_sample_distance(value) { detailSampleDistance = finite(value, 'detail_sample_distance'); changed(); }, get_detail_sample_distance: () => detailSampleDistance,
    set_detail_sample_max_error(value) { detailSampleMaxError = finite(value, 'detail_sample_max_error'); changed(); }, get_detail_sample_max_error: () => detailSampleMaxError,
    set_filter_low_hanging_obstacles(value) { filterLowHangingObstacles = bool(value, 'filter_low_hanging_obstacles'); changed(); }, get_filter_low_hanging_obstacles: () => filterLowHangingObstacles,
    set_filter_ledge_spans(value) { filterLedgeSpans = bool(value, 'filter_ledge_spans'); changed(); }, get_filter_ledge_spans: () => filterLedgeSpans,
    set_filter_walkable_low_height_spans(value) { filterWalkableLowHeightSpans = bool(value, 'filter_walkable_low_height_spans'); changed(); }, get_filter_walkable_low_height_spans: () => filterWalkableLowHeightSpans,
    set_filter_baking_aabb(value) { filterBakingAabb = copyAabb(value); changed(); }, get_filter_baking_aabb: () => copyAabb(filterBakingAabb),
    set_filter_baking_aabb_offset(value) { filterBakingAabbOffset = point(value); changed(); }, get_filter_baking_aabb_offset: () => point(filterBakingAabbOffset),
    create_from_mesh(value) {
      const data = geometryNavigationData(navigationGeometry(value));
      vertices = data.vertices.map(point);
      polygons = data.polygons.map(polygon);
      changed();
    },
    clear() { if (vertices.length === 0 && polygons.length === 0) return; vertices = []; polygons = []; changed(); },
  };
  registerGodotObjectIdentity(mesh, 'NavigationMesh');
  bindGodotResourceProtocol(mesh, {
    createDuplicate: (source) => createGodotNavigationMesh({
      vertices: source.get_vertices(), polygons: source.get_polygons(), samplePartitionType: source.sample_partition_type,
      parsedGeometryType: source.parsed_geometry_type, parsedCollisionMask: source.parsed_collision_mask,
      sourceGeometryMode: source.source_geometry_mode, sourceGeometryGroupName: source.source_geometry_group_name,
      cellSize: source.cell_size, cellHeight: source.cell_height, agentHeight: source.agent_height,
      agentRadius: source.agent_radius, agentMaxClimb: source.agent_max_climb, agentMaxSlope: source.agent_max_slope,
      regionMinSize: source.region_min_size, regionMergeSize: source.region_merge_size,
      edgeMaxLength: source.edge_max_length, edgeMaxError: source.edge_max_error,
      verticesPerPolygon: source.vertices_per_polygon, detailSampleDistance: source.detail_sample_distance,
      detailSampleMaxError: source.detail_sample_max_error, filterLowHangingObstacles: source.filter_low_hanging_obstacles,
      filterLedgeSpans: source.filter_ledge_spans, filterWalkableLowHeightSpans: source.filter_walkable_low_height_spans,
      filterBakingAabb: source.filter_baking_aabb, filterBakingAabbOffset: source.filter_baking_aabb_offset,
    }),
  });
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || key === 'vertices' || key === 'polygons') continue;
    const property = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
    Reflect.set(mesh, property, value);
  }
  return mesh;
}
