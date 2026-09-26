/** One project-owned Godot navigation map backed directly by Recast/Detour. */

import {
  Crowd,
  type CrowdAgent,
  init,
  type NavMesh,
  NavMeshQuery,
  setRandomSeed,
  type Vector3,
} from 'recast-navigation';
import { generateSoloNavMesh, type SoloNavMeshGeneratorConfig } from 'recast-navigation/generators';
import {
  createGodotNavigationMesh,
  type GodotNavigationMesh,
  isGodotNavigationMesh,
} from './navigation-mesh';
import { isGodotNavigationPolygon } from './navigation-polygon';
import {
  getGodotNavigationRegionBounds,
  getGodotNavigationRegionClosestPoint,
  getGodotNavigationRegionClosestPointToSegment,
} from './navigation-region-geometry-3d';
import {
  bakeGodotNavigationMeshFromRoot3D,
  bakeGodotNavigationMeshFromSourceGeometryData3D,
  bakeGodotNavigationMeshFromSourceGeometryData3DAsync,
  isGodotNavigationMeshBaking,
  parseGodotNavigationSourceGeometryData3D,
} from './navigation-source-geometry-3d';

const navigationMaps = new Set<GodotNavigationMap>();

function layerBit(layer: number): number {
  if (!Number.isSafeInteger(layer) || layer < 1 || layer > 32)
    throw new RangeError('Navigation layer number must be in [1, 32].');
  return 2 ** (layer - 1);
}

function withLayer(mask: number, layer: number, value: boolean): number {
  const bit = layerBit(layer);
  return value ? (mask | bit) >>> 0 : (mask & ~bit) >>> 0;
}

export interface GodotNavigationRegionSource {
  /** Stable emitted scene-resource path plus node path; never interpreted by Recast. */
  readonly authoredToken?: string;
  readonly dimension: 2 | 3;
  readonly vertices: readonly (readonly number[])[];
  readonly polygons: readonly (readonly number[])[];
  /** Column-major 4x4 authored world transform. */
  readonly transform: readonly number[];
  readonly enabled: boolean;
  /** Region-local edge stitching gate retained by NavigationServer3D. */
  readonly useEdgeConnections?: boolean;
  readonly navigationLayers: number;
  readonly enterCost?: number;
  readonly travelCost?: number;
  readonly agentRadius?: number;
  readonly agentHeight?: number;
  readonly agentMaxClimb?: number;
  readonly agentMaxSlope?: number;
  readonly cellSize?: number;
  readonly cellHeight?: number;
  readonly samplePartitionType?: number;
  readonly parsedGeometryType?: number;
  readonly parsedCollisionMask?: number;
  readonly sourceGeometryMode?: number;
  readonly sourceGeometryGroupName?: string;
}

export interface GodotNavigationLinkSource {
  readonly enabled: boolean;
  readonly bidirectional: boolean;
  readonly navigationLayers: number;
  readonly startPosition: Vector3;
  readonly endPosition: Vector3;
  readonly enterCost: number;
  readonly travelCost: number;
  readonly connectionRadius?: number;
}

export interface GodotNavigationMap {
  readonly navMesh: NavMesh;
  readonly query: NavMeshQuery;
  readonly crowd: Crowd;
  active: boolean;
  cellSize: number;
  cellHeight: number;
  useEdgeConnections: boolean;
  edgeConnectionMargin: number;
  linkConnectionRadius: number;
  readonly regions: Set<GodotNavigationRegionHandle>;
  readonly links: Set<GodotNavigationLinkHandle>;
  readonly agents: Set<GodotNavigationAgent>;
  readonly obstacles: Set<GodotNavigationObstacleHandle>;
  readonly iterationId: number;
  getPath(origin: Vector3, destination: Vector3): readonly Vector3[];
  getClosestPoint(position: Vector3): Vector3;
  getRandomPoint(): Vector3;
  update(delta: number): void;
  addAgentSync(sync: () => void): () => void;
  addAgentPostSync(sync: () => void): () => void;
  destroy(): void;
}

export interface GodotNavigationRegionHandle {
  map: GodotNavigationMap | null;
  enabled: boolean;
  useEdgeConnections: boolean;
  navigationLayers: number;
  enterCost: number;
  travelCost: number;
  ownerId: number;
  iterationId: number;
  transform: readonly number[];
  navigationPolygon: unknown;
  readonly source?: GodotNavigationRegionSource;
  addMapChanged(listener: (map: GodotNavigationMap | null) => void): () => void;
  release(): void;
}

export interface GodotNavigationLinkHandle {
  map: GodotNavigationMap | null;
  enabled: boolean;
  bidirectional: boolean;
  navigationLayers: number;
  startPosition: Vector3;
  endPosition: Vector3;
  enterCost: number;
  travelCost: number;
  ownerId: number;
  iterationId: number;
  addMapChanged(listener: (map: GodotNavigationMap | null) => void): () => void;
  release(): void;
}

export interface GodotNavigationObstacleHandle {
  map: GodotNavigationMap | null;
  avoidanceEnabled: boolean;
  paused: boolean;
  radius: number;
  height: number;
  use3dAvoidance: boolean;
  velocity: Vector3;
  position: Vector3;
  vertices: readonly Vector3[];
  avoidanceLayers: number;
  readonly nativeAgent: CrowdAgent | null;
  syncPosition(position: Vector3): void;
  release(): void;
}

function transformPoint(matrix: readonly number[], x: number, y: number, z: number): Vector3 {
  if (matrix.length !== 16) return { x, y, z };
  return {
    x: (matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    y: (matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    z: (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z + (matrix[14] ?? 0),
  };
}

function recastInput(regions: readonly GodotNavigationRegionSource[]): {
  readonly positions: number[];
  readonly indices: number[];
} {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const region of regions) {
    if (!region.enabled) continue;
    const offset = positions.length / 3;
    for (const vertex of region.vertices) {
      const x = vertex[0] ?? 0;
      const authoredY = vertex[1] ?? 0;
      const value =
        region.dimension === 2
          ? transformPoint(region.transform, x, 0, authoredY)
          : transformPoint(region.transform, x, authoredY, vertex[2] ?? 0);
      positions.push(value.x, value.y, value.z);
    }
    for (const polygon of region.polygons) {
      const first = polygon[0];
      if (first === undefined) continue;
      for (let index = 1; index + 1 < polygon.length; index += 1) {
        const b = polygon[index];
        const c = polygon[index + 1];
        if (b !== undefined && c !== undefined)
          indices.push(offset + first, offset + c, offset + b);
      }
    }
  }
  return { positions, indices };
}

function navigationLayerMask(value: number, member: string): number {
  if (!Number.isSafeInteger(value))
    throw new TypeError(`${member} navigation_layers requires an integer bitmask.`);
  if (value < -0x8000_0000 || value > 0xffff_ffff)
    throw new RangeError(`${member} navigation_layers must fit Godot's uint32 mask.`);
  return value >>> 0;
}

function singleNavigationLayer(value: number, member: string): number {
  const mask = navigationLayerMask(value, member);
  if (mask !== 1)
    throw new Error(
      `${member} navigation layers other than layer 1 require source-triangle area provenance that the native Recast generator does not expose.`,
    );
  return mask;
}

function navigationRegionCost(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${member} must be a finite non-negative number.`);
  return value;
}

function navigationCostEqual(left: number, right: number): boolean {
  if (left === right) return true;
  const tolerance = Math.max(0.00001 * Math.abs(left), 0.00001);
  return Math.abs(left - right) < tolerance;
}

function assertNativeRegionConfiguration(
  configuration: {
    readonly navigationLayers: number;
    readonly useEdgeConnections: boolean;
    readonly enterCost: number;
    readonly travelCost: number;
  },
  member: string,
): void {
  singleNavigationLayer(configuration.navigationLayers, member);
  if (!configuration.useEdgeConnections) {
    throw new Error(
      `${member} use_edge_connections=false requires per-region Recast edge ownership that the native generator does not expose.`,
    );
  }
  if (
    !navigationCostEqual(configuration.enterCost, 0) ||
    !navigationCostEqual(configuration.travelCost, 1)
  ) {
    throw new Error(
      `${member} non-default enter_cost/travel_cost requires per-region Detour polygon provenance and query costs.`,
    );
  }
}

interface GodotRecastConfig {
  readonly generator: Partial<SoloNavMeshGeneratorConfig>;
  readonly cellSize: number;
  readonly cellHeight: number;
  readonly agentRadius: number;
}

function godotRecastConfig(regions: readonly GodotNavigationRegionSource[]): GodotRecastConfig {
  const enabled = regions.filter((region) => region.enabled);
  const cellSize = Math.min(...enabled.map((region) => region.cellSize ?? 0.25));
  const cellHeight = Math.min(...enabled.map((region) => region.cellHeight ?? 0.25));
  const agentRadius = Math.max(...enabled.map((region) => region.agentRadius ?? 0.5));
  const agentHeight = Math.max(...enabled.map((region) => region.agentHeight ?? 1.5));
  const agentMaxClimb = Math.min(...enabled.map((region) => region.agentMaxClimb ?? 0.25));
  return {
    cellSize,
    cellHeight,
    agentRadius,
    generator: {
      cs: cellSize,
      ch: cellHeight,
      walkableRadius: Math.ceil(agentRadius / cellSize),
      walkableHeight: Math.ceil(agentHeight / cellHeight),
      walkableClimb: Math.floor(agentMaxClimb / cellHeight),
      walkableSlopeAngle: Math.min(...enabled.map((region) => region.agentMaxSlope ?? 45)),
    },
  };
}

async function createNativeGodotNavigationMap(options: {
  readonly regions: readonly GodotNavigationRegionSource[];
  readonly links?: readonly GodotNavigationLinkSource[];
  readonly maxAgents?: number;
  readonly random?: () => number;
}): Promise<GodotNavigationMap> {
  await init();
  const enabled = options.regions.filter((region) => region.enabled);
  if (enabled.length === 0) throw new Error('Godot navigation map has no enabled NavigationRegion');
  const input = recastInput(enabled);
  const config = godotRecastConfig(enabled);
  const authoredLinks = (options.links ?? []).filter((link) => link.enabled);
  for (const region of enabled) {
    const member = region.dimension === 2 ? 'NavigationRegion2D' : 'NavigationRegion3D';
    assertNativeRegionConfiguration(
      {
        navigationLayers: navigationLayerMask(region.navigationLayers, member),
        useEdgeConnections: region.useEdgeConnections ?? true,
        enterCost: navigationRegionCost(region.enterCost ?? 0, `${member}.enter_cost`),
        travelCost: navigationRegionCost(region.travelCost ?? 1, `${member}.travel_cost`),
      },
      member,
    );
  }
  for (const link of authoredLinks) singleNavigationLayer(link.navigationLayers, 'NavigationLink');
  const generated = generateSoloNavMesh(input.positions, input.indices, {
    ...config.generator,
    offMeshConnections: authoredLinks.map((link, index) => ({
      startPosition: link.startPosition,
      endPosition: link.endPosition,
      radius: Math.max(0.001, link.connectionRadius ?? 4),
      bidirectional: link.bidirectional,
      flags: 1,
      userId: index + 1,
    })),
  });
  if (!generated.success) throw new Error(`Recast NavMesh generation failed: ${generated.error}`);
  const navMesh = generated.navMesh;
  const query = new NavMeshQuery(navMesh);
  const crowd = new Crowd(navMesh, {
    maxAgents: options.maxAgents ?? 256,
    maxAgentRadius: config.agentRadius ?? 0.5,
  });
  const agentSyncs = new Set<() => void>();
  const agentPostSyncs = new Set<() => void>();
  const regions = new Set<GodotNavigationRegionHandle>();
  const links = new Set<GodotNavigationLinkHandle>();
  const agents = new Set<GodotNavigationAgent>();
  const obstacles = new Set<GodotNavigationObstacleHandle>();
  let iterationId = 1;
  const map: GodotNavigationMap = {
    navMesh,
    query,
    crowd,
    active: true,
    cellSize: config.cellSize ?? 0.25,
    cellHeight: config.cellHeight ?? 0.25,
    useEdgeConnections: true,
    edgeConnectionMargin: 1,
    linkConnectionRadius: 4,
    regions,
    links,
    agents,
    obstacles,
    get iterationId() {
      return iterationId;
    },
    getPath(origin, destination) {
      const result = query.computePath(origin, destination);
      return result.success ? result.path : [];
    },
    getClosestPoint(position) {
      const result = query.findNearestPoly(position);
      if (!result.success)
        throw new Error(
          `NavigationServer2D.map_get_closest_point failed with native Detour status ${result.status}.`,
        );
      return result.nearestPoint;
    },
    getRandomPoint() {
      if (options.random === undefined)
        throw new Error(
          'NavigationServer2D.map_get_random_point requires the project seeded random callback.',
        );
      setRandomSeed(Math.floor(options.random() * 0x1_0000_0000) >>> 0);
      const result = query.findRandomPoint();
      if (!result.success)
        throw new Error(
          `NavigationServer2D.map_get_random_point failed with native Detour status ${result.status}.`,
        );
      return result.randomPoint;
    },
    update(delta): void {
      if (!map.active) return;
      for (const sync of agentSyncs) sync();
      crowd.update(delta);
      for (const sync of agentPostSyncs) sync();
      iterationId += 1;
    },
    addAgentSync(sync): () => void {
      agentSyncs.add(sync);
      return () => agentSyncs.delete(sync);
    },
    addAgentPostSync(sync): () => void {
      agentPostSyncs.add(sync);
      return () => agentPostSyncs.delete(sync);
    },
    destroy(): void {
      for (const agent of [...agents]) agent.release();
      for (const obstacle of [...obstacles]) obstacle.release();
      for (const link of [...links]) link.release();
      for (const region of [...regions]) region.release();
      crowd.destroy();
      query.destroy();
      navMesh.destroy();
      navigationMaps.delete(map);
    },
  };
  for (const source of enabled)
    createGodotNavigationRegionHandle({
      map,
      source,
      enabled: source.enabled,
      navigationLayers: source.navigationLayers,
      ...(source.useEdgeConnections === undefined
        ? {}
        : { useEdgeConnections: source.useEdgeConnections }),
      ...(source.enterCost === undefined ? {} : { enterCost: source.enterCost }),
      ...(source.travelCost === undefined ? {} : { travelCost: source.travelCost }),
    });
  for (const source of authoredLinks) createGodotNavigationLinkHandle({ map, ...source });
  navigationMaps.add(map);
  return map;
}

interface EmptyNavigationMapState {
  native: GodotNavigationMap | null;
  rebuilding: Promise<void> | null;
  dirty: boolean;
  suspendRebuild: boolean;
  destroyed: boolean;
  error: unknown;
  readonly syncs: Set<() => void>;
  readonly postSyncs: Set<() => void>;
  readonly unclaimedRegions: GodotNavigationRegionHandle[];
  maxAgents: number | undefined;
  random: (() => number) | undefined;
}

const EMPTY_NAVIGATION_MAPS = new WeakMap<GodotNavigationMap, EmptyNavigationMapState>();

function emptyMapState(map: GodotNavigationMap): EmptyNavigationMapState | undefined {
  return EMPTY_NAVIGATION_MAPS.get(map);
}

function requireBakedMap(map: GodotNavigationMap, member: string): GodotNavigationMap {
  const state = emptyMapState(map);
  if (state === undefined) return map;
  if (state.error !== null) {
    throw new Error(`NavigationServer3D.${member} cannot use a map whose Recast bake failed.`, {
      cause: state.error,
    });
  }
  if (state.native === null) {
    throw new Error(`NavigationServer3D.${member} requires at least one baked NavigationRegion3D.`);
  }
  return state.native;
}

function sourceForRegion(region: GodotNavigationRegionHandle): GodotNavigationRegionSource | null {
  const mesh = region.navigationPolygon;
  if (isGodotNavigationPolygon(mesh)) {
    if (mesh.get_polygon_count() === 0) return null;
    return {
      dimension: 2,
      vertices: mesh.get_vertices().map((point) => [point.x, point.y]),
      polygons: mesh.get_polygons(),
      transform: region.transform,
      enabled: region.enabled,
      useEdgeConnections: region.useEdgeConnections,
      navigationLayers: region.navigationLayers,
      enterCost: region.enterCost,
      travelCost: region.travelCost,
      agentRadius: mesh.get_agent_radius(),
      cellSize: mesh.get_cell_size(),
    };
  }
  if (!isGodotNavigationMesh(mesh) || mesh.get_polygon_count() === 0) return null;
  return {
    dimension: 3,
    vertices: mesh.get_vertices().map((point) => [point.x, point.y, point.z]),
    polygons: mesh.get_polygons(),
    transform: region.transform,
    enabled: region.enabled,
    useEdgeConnections: region.useEdgeConnections,
    navigationLayers: region.navigationLayers,
    enterCost: region.enterCost,
    travelCost: region.travelCost,
    agentRadius: mesh.agent_radius,
    agentHeight: mesh.agent_height,
    agentMaxClimb: mesh.agent_max_climb,
    agentMaxSlope: mesh.agent_max_slope,
    cellSize: mesh.cell_size,
    cellHeight: mesh.cell_height,
  };
}

function assertEmptyMapRebuildable(map: GodotNavigationMap): void {
  if (map.agents.size !== 0) {
    throw new Error(
      'NavigationServer3D cannot rebuild a native Recast map while CrowdAgent RIDs are live. Release or remap the agents first.',
    );
  }
}

function requestEmptyMapRebuild(map: GodotNavigationMap): void {
  const state = emptyMapState(map);
  if (state === undefined) return;
  if (state.destroyed) return;
  if (state.suspendRebuild) return;
  assertEmptyMapRebuildable(map);
  if (state.rebuilding !== null) {
    state.dirty = true;
    return;
  }
  const regions = [...map.regions]
    .map(sourceForRegion)
    .filter((source): source is GodotNavigationRegionSource => source !== null)
    .map((source) => ({ ...source, cellSize: map.cellSize, cellHeight: map.cellHeight }));
  if (regions.length === 0) {
    const obstacles = [...map.obstacles];
    for (const obstacle of obstacles) obstacle.map = null;
    state.native?.destroy();
    state.native = null;
    state.error = null;
    for (const obstacle of obstacles) obstacle.map = map;
    return;
  }
  state.dirty = false;
  state.error = null;
  state.rebuilding = createNativeGodotNavigationMap({
    regions,
    links: [...map.links].map((link) => ({
      enabled: link.enabled,
      bidirectional: link.bidirectional,
      navigationLayers: link.navigationLayers,
      startPosition: link.startPosition,
      endPosition: link.endPosition,
      enterCost: link.enterCost,
      travelCost: link.travelCost,
      connectionRadius: map.linkConnectionRadius,
    })),
    ...(state.maxAgents === undefined ? {} : { maxAgents: state.maxAgents }),
    ...(state.random === undefined ? {} : { random: state.random }),
  })
    .then((native) => {
      navigationMaps.delete(native);
      if (state.destroyed) {
        native.destroy();
        return;
      }
      if (map.agents.size !== 0) {
        native.destroy();
        throw new Error(
          'NavigationServer3D map gained a live CrowdAgent during its Recast rebuild. Release or remap the agent before baking.',
        );
      }
      const obstacles = [...map.obstacles];
      for (const obstacle of obstacles) obstacle.map = null;
      state.native?.destroy();
      state.native = native;
      native.active = map.active;
      native.useEdgeConnections = map.useEdgeConnections;
      native.edgeConnectionMargin = map.edgeConnectionMargin;
      native.linkConnectionRadius = map.linkConnectionRadius;
      for (const obstacle of obstacles) obstacle.map = map;
    })
    .catch((error: unknown) => {
      state.error = error;
    })
    .finally(() => {
      state.rebuilding = null;
      if (state.dirty && !state.destroyed) requestEmptyMapRebuild(map);
    });
}

/** Synchronous Godot RID whose native Recast payload is seated after its first region bake. */
export function createGodotNavigationServer3DMap(): GodotNavigationMap {
  const regions = new Set<GodotNavigationRegionHandle>();
  const links = new Set<GodotNavigationLinkHandle>();
  const agents = new Set<GodotNavigationAgent>();
  const obstacles = new Set<GodotNavigationObstacleHandle>();
  let iterationId = 0;
  let map!: GodotNavigationMap;
  const state: EmptyNavigationMapState = {
    native: null,
    rebuilding: null,
    dirty: false,
    suspendRebuild: false,
    destroyed: false,
    error: null,
    syncs: new Set(),
    postSyncs: new Set(),
    unclaimedRegions: [],
    maxAgents: undefined,
    random: undefined,
  };
  map = {
    get navMesh() {
      return requireBakedMap(map, 'navMesh').navMesh;
    },
    get query() {
      return requireBakedMap(map, 'query').query;
    },
    get crowd() {
      return requireBakedMap(map, 'crowd').crowd;
    },
    active: true,
    cellSize: 0.25,
    cellHeight: 0.25,
    useEdgeConnections: true,
    edgeConnectionMargin: 1,
    linkConnectionRadius: 4,
    regions,
    links,
    agents,
    obstacles,
    get iterationId() {
      return state.native?.iterationId ?? iterationId;
    },
    getPath(origin, destination) {
      return requireBakedMap(map, 'map_get_path').getPath(origin, destination);
    },
    getClosestPoint(position) {
      return requireBakedMap(map, 'map_get_closest_point').getClosestPoint(position);
    },
    getRandomPoint() {
      return requireBakedMap(map, 'map_get_random_point').getRandomPoint();
    },
    update(delta) {
      if (!map.active) return;
      for (const sync of state.syncs) sync();
      state.native?.update(delta);
      for (const sync of state.postSyncs) sync();
      iterationId += 1;
    },
    addAgentSync(sync) {
      state.syncs.add(sync);
      return () => state.syncs.delete(sync);
    },
    addAgentPostSync(sync) {
      state.postSyncs.add(sync);
      return () => state.postSyncs.delete(sync);
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      state.suspendRebuild = true;
      for (const obstacle of [...obstacles]) obstacle.release();
      for (const link of [...links]) link.release();
      for (const region of [...regions]) region.release();
      state.native?.destroy();
      state.native = null;
      navigationMaps.delete(map);
    },
  };
  EMPTY_NAVIGATION_MAPS.set(map, state);
  navigationMaps.add(map);
  return map;
}

/** Synchronous Godot 4 NavigationServer2D map RID; NavigationPolygon assignment seats Recast. */
export function createGodotNavigationServer2DMap(): GodotNavigationMap {
  const map = createGodotNavigationServer3DMap();
  map.cellSize = 1;
  return map;
}

/**
 * Build the initial native map, then retain it behind the same rebuildable RID used by
 * NavigationServer3D.map_create(). Scene-bound NavigationRegion3D nodes can consequently update
 * their transform, mesh, and enabled state without being stranded on an immutable one-shot
 * Recast map. Unsupported per-region filtering/cost configuration remains guarded separately.
 */
export async function createGodotNavigationMap(options: {
  readonly regions: readonly GodotNavigationRegionSource[];
  readonly links?: readonly GodotNavigationLinkSource[];
  readonly maxAgents?: number;
  readonly random?: () => number;
}): Promise<GodotNavigationMap> {
  const bakedRegions = options.regions.filter(
    (region) => region.enabled && region.vertices.length >= 3 && region.polygons.length !== 0,
  );
  const native =
    bakedRegions.length === 0
      ? null
      : await createNativeGodotNavigationMap({
          ...options,
          regions: bakedRegions,
        });
  const map = createGodotNavigationServer3DMap();
  const state = emptyMapState(map)!;
  if (native !== null) navigationMaps.delete(native);
  state.native = native;
  state.maxAgents = options.maxAgents;
  state.random = options.random;
  if (native !== null) {
    map.active = native.active;
    map.cellSize = native.cellSize;
    map.cellHeight = native.cellHeight;
    map.useEdgeConnections = native.useEdgeConnections;
    map.edgeConnectionMargin = native.edgeConnectionMargin;
    map.linkConnectionRadius = native.linkConnectionRadius;
  }
  // Preserve one retained server RID per authored 3D region before the Object3D tree mounts. The
  // scene binding claims these handles by exact source geometry + transform, so mounting does not
  // duplicate geometry or trigger a transient partial-map rebuild before NavigationAgent3D binds.
  state.suspendRebuild = true;
  for (const source of options.regions) {
    if (source.dimension !== 3) continue;
    const navigationMesh = createGodotNavigationMesh({
      vertices: source.vertices.map((point) => ({
        x: point[0] ?? 0,
        y: point[1] ?? 0,
        z: point[2] ?? 0,
      })),
      polygons: source.polygons,
      ...(source.agentRadius === undefined ? {} : { agentRadius: source.agentRadius }),
      ...(source.agentHeight === undefined ? {} : { agentHeight: source.agentHeight }),
      ...(source.agentMaxClimb === undefined ? {} : { agentMaxClimb: source.agentMaxClimb }),
      ...(source.agentMaxSlope === undefined ? {} : { agentMaxSlope: source.agentMaxSlope }),
      ...(source.cellSize === undefined ? {} : { cellSize: source.cellSize }),
      ...(source.cellHeight === undefined ? {} : { cellHeight: source.cellHeight }),
      ...(source.samplePartitionType === undefined
        ? {}
        : { samplePartitionType: source.samplePartitionType }),
      ...(source.parsedGeometryType === undefined
        ? {}
        : { parsedGeometryType: source.parsedGeometryType }),
      ...(source.parsedCollisionMask === undefined
        ? {}
        : { parsedCollisionMask: source.parsedCollisionMask }),
      ...(source.sourceGeometryMode === undefined
        ? {}
        : { sourceGeometryMode: source.sourceGeometryMode }),
      ...(source.sourceGeometryGroupName === undefined
        ? {}
        : { sourceGeometryGroupName: source.sourceGeometryGroupName }),
    });
    const region = createGodotNavigationRegionHandle({
      map,
      source,
      navigationPolygon: navigationMesh,
      enabled: source.enabled,
      navigationLayers: source.navigationLayers,
      transform: source.transform,
      ...(source.useEdgeConnections === undefined
        ? {}
        : { useEdgeConnections: source.useEdgeConnections }),
      ...(source.enterCost === undefined ? {} : { enterCost: source.enterCost }),
      ...(source.travelCost === undefined ? {} : { travelCost: source.travelCost }),
    });
    state.unclaimedRegions.push(region);
  }
  state.suspendRebuild = false;
  return map;
}

function sameRegionNumberList(first: readonly number[], second: readonly number[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameRegionMesh(first: GodotNavigationMesh, second: GodotNavigationMesh): boolean {
  const firstVertices = first.get_vertices();
  const secondVertices = second.get_vertices();
  if (
    firstVertices.length !== secondVertices.length ||
    first.get_polygon_count() !== second.get_polygon_count()
  )
    return false;
  for (let index = 0; index < firstVertices.length; index += 1) {
    const left = firstVertices[index]!;
    const right = secondVertices[index]!;
    if (left.x !== right.x || left.y !== right.y || left.z !== right.z) return false;
  }
  for (let index = 0; index < first.get_polygon_count(); index += 1) {
    if (!sameRegionNumberList(first.get_polygon(index), second.get_polygon(index))) return false;
  }
  return true;
}

/** Claim the prebuilt region RID corresponding to one retained Object3D scene node. */
export function claimGodotNavigationRegionHandle(
  map: GodotNavigationMap | undefined,
  navigationMesh: GodotNavigationMesh | null,
  transform: readonly number[],
  configuration: {
    readonly authoredToken?: string;
    readonly enabled: boolean;
    readonly useEdgeConnections: boolean;
    readonly navigationLayers: number;
    readonly enterCost: number;
    readonly travelCost: number;
  },
): GodotNavigationRegionHandle | undefined {
  if (map === undefined || navigationMesh === null) return undefined;
  const state = emptyMapState(map);
  if (state === undefined) return undefined;
  const navigationLayers = navigationLayerMask(
    configuration.navigationLayers,
    'NavigationRegion3D',
  );
  const enterCost = navigationRegionCost(configuration.enterCost, 'NavigationRegion3D.enter_cost');
  const travelCost = navigationRegionCost(
    configuration.travelCost,
    'NavigationRegion3D.travel_cost',
  );
  const index = state.unclaimedRegions.findIndex((candidate) => {
    if (
      configuration.authoredToken !== undefined &&
      candidate.source?.authoredToken !== configuration.authoredToken
    )
      return false;
    if (
      candidate.enabled !== configuration.enabled ||
      candidate.useEdgeConnections !== configuration.useEdgeConnections ||
      candidate.navigationLayers !== navigationLayers ||
      !navigationCostEqual(candidate.enterCost, enterCost) ||
      !navigationCostEqual(candidate.travelCost, travelCost)
    )
      return false;
    if (!sameRegionNumberList(candidate.transform, transform)) return false;
    return (
      isGodotNavigationMesh(candidate.navigationPolygon) &&
      sameRegionMesh(candidate.navigationPolygon, navigationMesh)
    );
  });
  if (index < 0) return undefined;
  const region = state.unclaimedRegions.splice(index, 1)[0]!;
  // Geometry is byte-for-byte equal; exchange only the authored Resource identity without asking
  // Recast to rebuild the already identical initial map.
  region.navigationPolygon = navigationMesh;
  return region;
}

export function setGodotNavigationServer3DMapCellHeight(
  map: GodotNavigationMap,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError('NavigationServer3D map cell height must be positive.');
  const state = emptyMapState(map);
  if (state === undefined && map.cellHeight !== value) {
    throw new Error(
      'NavigationServer3D.map_set_cell_height requires rebuilding the native Recast navmesh.',
    );
  }
  if (state !== undefined) assertEmptyMapRebuildable(map);
  map.cellHeight = value;
  requestEmptyMapRebuild(map);
}

export interface GodotNavigationAgent {
  readonly nativeAgent: CrowdAgent;
  readonly map: GodotNavigationMap;
  targetPosition: Vector3;
  pathDesiredDistance: number;
  targetDesiredDistance: number;
  maxSpeed: number;
  radius: number;
  maxAcceleration: number;
  avoidanceEnabled: boolean;
  navigationLayers: number;
  neighborDistance: number;
  velocity: Vector3;
  getNextPathPosition(): Vector3;
  getFinalPosition(): Vector3;
  getCurrentNavigationPath(): readonly Vector3[];
  getCurrentNavigationPathIndex(): number;
  getPathLength(): number;
  distanceToTarget(): number;
  isTargetReachable(): boolean;
  isNavigationFinished(): boolean;
  isTargetReached(): boolean;
  syncPosition(position: Vector3): void;
  release(): void;
}

export function createGodotNavigationAgent(options: {
  readonly map: GodotNavigationMap;
  readonly position: Vector3 | (() => Vector3);
  readonly pathDesiredDistance?: number;
  readonly targetDesiredDistance?: number;
  readonly radius?: number;
  readonly height?: number;
  readonly maxSpeed?: number;
  readonly maxAcceleration?: number;
  readonly avoidanceEnabled?: boolean;
  readonly navigationLayers?: number;
}): GodotNavigationAgent {
  if (emptyMapState(options.map)?.rebuilding !== null && emptyMapState(options.map) !== undefined) {
    throw new Error(
      'NavigationServer3D cannot create a CrowdAgent while the retained map is rebuilding.',
    );
  }
  const currentPosition = (): Vector3 =>
    typeof options.position === 'function' ? options.position() : options.position;
  const nativeAgent = options.map.crowd.addAgent(currentPosition(), {
    radius: options.radius ?? 0.5,
    height: options.height ?? 1,
    maxSpeed: options.maxSpeed ?? 10,
    maxAcceleration: options.maxAcceleration ?? 20,
    updateFlags: options.avoidanceEnabled ? 7 : 0,
  });
  let navigationLayers = navigationLayerMask(options.navigationLayers ?? 1, 'NavigationAgent3D');
  let target = currentPosition();
  let path: readonly Vector3[] = [];
  let cursor = 0;
  let pathDistance = options.pathDesiredDistance ?? 1;
  let targetDistance = options.targetDesiredDistance ?? 1;
  let released = false;
  const distance = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const syncPosition = (position: Vector3): void => {
    nativeAgent.teleport(position);
    while (cursor < path.length && distance(position, path[cursor] ?? position) <= pathDistance)
      cursor += 1;
  };
  const releaseSync = options.map.addAgentSync(() => syncPosition(currentPosition()));
  const rebuild = (): void => {
    path = (navigationLayers & 1) === 0 ? [] : options.map.getPath(nativeAgent.position(), target);
    cursor = path.length > 1 ? 1 : 0;
    if (path.length > 0) nativeAgent.requestMoveTarget(target);
    else nativeAgent.requestMoveVelocity({ x: 0, y: 0, z: 0 });
  };
  const agent: GodotNavigationAgent = {
    nativeAgent,
    map: options.map,
    get targetPosition() {
      return { ...target };
    },
    set targetPosition(value) {
      target = { ...value };
      rebuild();
    },
    get pathDesiredDistance() {
      return pathDistance;
    },
    set pathDesiredDistance(value) {
      pathDistance = Math.max(0, value);
    },
    get targetDesiredDistance() {
      return targetDistance;
    },
    set targetDesiredDistance(value) {
      targetDistance = Math.max(0, value);
    },
    get maxSpeed() {
      return nativeAgent.maxSpeed;
    },
    set maxSpeed(value) {
      nativeAgent.maxSpeed = Math.max(0, value);
    },
    get radius() {
      return nativeAgent.radius;
    },
    set radius(value) {
      nativeAgent.radius = Math.max(0, value);
    },
    get maxAcceleration() {
      return nativeAgent.maxAcceleration;
    },
    set maxAcceleration(value) {
      nativeAgent.maxAcceleration = Math.max(0, value);
    },
    get avoidanceEnabled() {
      return nativeAgent.updateFlags !== 0;
    },
    set avoidanceEnabled(value) {
      nativeAgent.updateFlags = value ? 7 : 0;
    },
    get navigationLayers() {
      return navigationLayers;
    },
    set navigationLayers(value) {
      navigationLayers = navigationLayerMask(value, 'NavigationAgent3D');
      rebuild();
    },
    get neighborDistance() {
      return nativeAgent.collisionQueryRange;
    },
    set neighborDistance(value) {
      nativeAgent.collisionQueryRange = Math.max(0, value);
    },
    get velocity() {
      return nativeAgent.velocity();
    },
    set velocity(value) {
      nativeAgent.requestMoveVelocity(value);
    },
    getNextPathPosition: () => path[cursor] ?? nativeAgent.position(),
    getFinalPosition: () => path[path.length - 1] ?? nativeAgent.position(),
    getCurrentNavigationPath: () => path,
    getCurrentNavigationPathIndex: () => cursor,
    getPathLength: () =>
      path
        .slice(1)
        .reduce((total, point, index) => total + distance(path[index] ?? point, point), 0),
    distanceToTarget: () => distance(nativeAgent.position(), target),
    isTargetReachable: () =>
      path.length > 0 && distance(path[path.length - 1] ?? target, target) <= targetDistance,
    isNavigationFinished: () => cursor >= path.length,
    isTargetReached: () => distance(nativeAgent.position(), target) <= targetDistance,
    syncPosition,
    release(): void {
      if (released) return;
      released = true;
      releaseSync();
      options.map.agents.delete(agent);
      options.map.crowd.removeAgent(nativeAgent);
    },
  };
  options.map.agents.add(agent);
  return agent;
}

export function createGodotNavigationRegionHandle(
  options: {
    readonly map?: GodotNavigationMap | null;
    readonly source?: GodotNavigationRegionSource;
    readonly enabled?: boolean;
    readonly useEdgeConnections?: boolean;
    readonly navigationLayers?: number;
    readonly enterCost?: number;
    readonly travelCost?: number;
    readonly navigationPolygon?: unknown;
    readonly transform?: readonly number[];
  } = {},
): GodotNavigationRegionHandle {
  let map = options.map ?? null;
  if (map !== null && emptyMapState(map) !== undefined) assertEmptyMapRebuildable(map);
  const initialNavigationLayers = navigationLayerMask(
    options.navigationLayers ?? options.source?.navigationLayers ?? 1,
    'NavigationRegion3D',
  );
  const initialUseEdgeConnections =
    options.useEdgeConnections ?? options.source?.useEdgeConnections ?? true;
  const initialEnterCost = navigationRegionCost(
    options.enterCost ?? options.source?.enterCost ?? 0,
    'NavigationRegion3D.enter_cost',
  );
  const initialTravelCost = navigationRegionCost(
    options.travelCost ?? options.source?.travelCost ?? 1,
    'NavigationRegion3D.travel_cost',
  );
  if (map !== null)
    assertNativeRegionConfiguration(
      {
        navigationLayers: initialNavigationLayers,
        useEdgeConnections: initialUseEdgeConnections,
        enterCost: initialEnterCost,
        travelCost: initialTravelCost,
      },
      'NavigationRegion3D',
    );
  const mapListeners = new Set<(map: GodotNavigationMap | null) => void>();
  const region: GodotNavigationRegionHandle = {
    get map() {
      return map;
    },
    set map(value) {
      if (value === map) return;
      if (value !== null)
        assertNativeRegionConfiguration(region, 'NavigationRegion3D.set_navigation_map');
      if (
        (map !== null && emptyMapState(map) === undefined) ||
        (value !== null && emptyMapState(value) === undefined)
      ) {
        throw new Error(
          'NavigationRegion map changes require rebuilding the native Recast navmesh.',
        );
      }
      if (map !== null && emptyMapState(map) !== undefined) assertEmptyMapRebuildable(map);
      if (value !== null && emptyMapState(value) !== undefined) assertEmptyMapRebuildable(value);
      map?.regions.delete(region);
      map = value;
      map?.regions.add(region);
      region.iterationId += 1;
      if (map !== null) requestEmptyMapRebuild(map);
      for (const listener of mapListeners) listener(map);
    },
    enabled: options.enabled ?? options.source?.enabled ?? true,
    useEdgeConnections: initialUseEdgeConnections,
    navigationLayers: initialNavigationLayers,
    enterCost: initialEnterCost,
    travelCost: initialTravelCost,
    ownerId: 0,
    iterationId: 0,
    transform: options.transform ??
      options.source?.transform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    navigationPolygon: options.navigationPolygon ?? null,
    ...(options.source === undefined ? {} : { source: options.source }),
    addMapChanged(listener) {
      mapListeners.add(listener);
      return () => mapListeners.delete(listener);
    },
    release() {
      const previous = map;
      if (previous !== null && emptyMapState(previous) !== undefined)
        assertEmptyMapRebuildable(previous);
      previous?.regions.delete(region);
      map = null;
      if (previous !== null) requestEmptyMapRebuild(previous);
      for (const listener of mapListeners) listener(null);
      mapListeners.clear();
    },
  };
  map?.regions.add(region);
  if (map !== null) requestEmptyMapRebuild(map);
  return region;
}

export function createGodotNavigationLinkHandle(
  options: {
    readonly map?: GodotNavigationMap | null;
    readonly enabled?: boolean;
    readonly bidirectional?: boolean;
    readonly navigationLayers?: number;
    readonly startPosition?: Vector3;
    readonly endPosition?: Vector3;
    readonly enterCost?: number;
    readonly travelCost?: number;
  } = {},
): GodotNavigationLinkHandle {
  let map = options.map ?? null;
  if (map !== null && emptyMapState(map) !== undefined) assertEmptyMapRebuildable(map);
  const mapListeners = new Set<(map: GodotNavigationMap | null) => void>();
  const link: GodotNavigationLinkHandle = {
    get map() {
      return map;
    },
    set map(value) {
      if (value === map) return;
      if (
        (map !== null && emptyMapState(map) === undefined) ||
        (value !== null && emptyMapState(value) === undefined)
      ) {
        throw new Error(
          'NavigationLink map changes require rebuilding the native Recast off-mesh connections.',
        );
      }
      if (map !== null && emptyMapState(map) !== undefined) assertEmptyMapRebuildable(map);
      if (value !== null && emptyMapState(value) !== undefined) assertEmptyMapRebuildable(value);
      const previous = map;
      previous?.links.delete(link);
      map = value;
      map?.links.add(link);
      link.iterationId += 1;
      if (previous !== null) requestEmptyMapRebuild(previous);
      if (map !== null) requestEmptyMapRebuild(map);
      for (const listener of mapListeners) listener(map);
    },
    enabled: options.enabled ?? true,
    bidirectional: options.bidirectional ?? true,
    navigationLayers: singleNavigationLayer(options.navigationLayers ?? 1, 'NavigationLink3D'),
    startPosition: { ...(options.startPosition ?? { x: 0, y: 0, z: 0 }) },
    endPosition: { ...(options.endPosition ?? { x: 0, y: 0, z: 0 }) },
    enterCost: Math.max(0, options.enterCost ?? 0),
    travelCost: Math.max(0, options.travelCost ?? 1),
    ownerId: 0,
    iterationId: 0,
    addMapChanged(listener) {
      mapListeners.add(listener);
      return () => mapListeners.delete(listener);
    },
    release() {
      const previous = map;
      if (previous !== null && emptyMapState(previous) !== undefined)
        assertEmptyMapRebuildable(previous);
      previous?.links.delete(link);
      map = null;
      if (previous !== null) requestEmptyMapRebuild(previous);
      for (const listener of mapListeners) listener(null);
      mapListeners.clear();
    },
  };
  map?.links.add(link);
  if (map !== null) requestEmptyMapRebuild(map);
  return link;
}

export function createGodotNavigationObstacleHandle(
  options: {
    readonly map?: GodotNavigationMap | null;
    readonly position?: Vector3;
    readonly radius?: number;
    readonly height?: number;
    readonly velocity?: Vector3;
    readonly vertices?: readonly Vector3[];
    readonly avoidanceEnabled?: boolean;
    readonly avoidanceLayers?: number;
  } = {},
): GodotNavigationObstacleHandle {
  let map = options.map ?? null,
    native: CrowdAgent | null = null,
    paused = false;
  let position = { ...(options.position ?? { x: 0, y: 0, z: 0 }) };
  let radius = Math.max(0, options.radius ?? 0),
    height = Math.max(0, options.height ?? 1);
  let velocity = { ...(options.velocity ?? { x: 0, y: 0, z: 0 }) };
  let avoidanceEnabled = options.avoidanceEnabled ?? true;
  const attachNative = (): void => {
    if (map === null || native !== null || !avoidanceEnabled || paused) return;
    const lazy = emptyMapState(map);
    if (lazy !== undefined && lazy.native === null) return;
    native = map.crowd.addAgent(position, {
      radius: Math.max(radius, 0.001),
      height: Math.max(height, 0.001),
      maxSpeed: 0,
      maxAcceleration: 0,
      updateFlags: 7,
    });
    native.requestMoveVelocity(velocity);
  };
  const detachNative = (): void => {
    if (map !== null && native !== null) map.crowd.removeAgent(native);
    native = null;
  };
  const obstacle: GodotNavigationObstacleHandle = {
    get map() {
      return map;
    },
    set map(value) {
      if (value === map) return;
      detachNative();
      map?.obstacles.delete(obstacle);
      map = value;
      map?.obstacles.add(obstacle);
      attachNative();
    },
    get avoidanceEnabled() {
      return avoidanceEnabled;
    },
    set avoidanceEnabled(value) {
      avoidanceEnabled = Boolean(value);
      if (avoidanceEnabled) attachNative();
      else detachNative();
    },
    get paused() {
      return paused;
    },
    set paused(value) {
      paused = Boolean(value);
      if (paused) detachNative();
      else attachNative();
    },
    get radius() {
      return radius;
    },
    set radius(value) {
      radius = Math.max(0, value);
      if (native !== null) native.radius = Math.max(radius, 0.001);
    },
    get height() {
      return height;
    },
    set height(value) {
      const next = Math.max(0, value);
      if (next === height) return;
      detachNative();
      height = next;
      attachNative();
    },
    get use3dAvoidance() {
      return false;
    },
    set use3dAvoidance(value) {
      if (value)
        throw new Error(
          'NavigationObstacle3D.use_3d_avoidance requires a native three-dimensional avoidance solver; Detour Crowd is planar.',
        );
    },
    get velocity() {
      return { ...velocity };
    },
    set velocity(value) {
      velocity = { ...value };
      native?.requestMoveVelocity(velocity);
    },
    get position() {
      return { ...position };
    },
    set position(value) {
      position = { ...value };
      native?.teleport(position);
    },
    vertices: (options.vertices ?? []).map((vertex) => ({ ...vertex })),
    avoidanceLayers: options.avoidanceLayers ?? 1,
    get nativeAgent() {
      return native;
    },
    syncPosition(value) {
      position = { ...value };
      native?.teleport(position);
    },
    release() {
      detachNative();
      map?.obstacles.delete(obstacle);
      map = null;
    },
  };
  map?.obstacles.add(obstacle);
  attachNative();
  return obstacle;
}

function simplifyPath(path: readonly Vector3[], epsilon: number): readonly Vector3[] {
  if (path.length <= 2 || epsilon <= 0) return path.map((point) => ({ ...point }));
  const first = path[0]!,
    last = path[path.length - 1]!;
  const dx = last.x - first.x,
    dy = last.y - first.y,
    dz = last.z - first.z;
  const denominator = dx * dx + dy * dy + dz * dz;
  let furthest = -1,
    furthestDistance = 0;
  for (let at = 1; at + 1 < path.length; at += 1) {
    const point = path[at]!;
    const t =
      denominator === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - first.x) * dx + (point.y - first.y) * dy + (point.z - first.z) * dz) /
                denominator,
            ),
          );
    const distance = Math.hypot(
      point.x - (first.x + dx * t),
      point.y - (first.y + dy * t),
      point.z - (first.z + dz * t),
    );
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthest = at;
    }
  }
  if (furthestDistance <= epsilon || furthest < 0) return [{ ...first }, { ...last }];
  return [
    ...simplifyPath(path.slice(0, furthest + 1), epsilon).slice(0, -1),
    ...simplifyPath(path.slice(furthest), epsilon),
  ];
}

function requireDetached(
  kind: 'region' | 'link',
  handle: { readonly map: GodotNavigationMap | null },
  member: string,
): void {
  if (handle.map !== null && emptyMapState(handle.map) !== undefined) {
    assertEmptyMapRebuildable(handle.map);
    return;
  }
  if (handle.map !== null)
    throw new Error(
      `NavigationServer2D.${kind}_${member} requires rebuilding the attached native Recast navmesh.`,
    );
}

function rebuildAttached(handle: { readonly map: GodotNavigationMap | null }): void {
  if (handle.map !== null) requestEmptyMapRebuild(handle.map);
}

function regionNavigationMesh(region: GodotNavigationRegionHandle, member: string) {
  if (!isGodotNavigationMesh(region.navigationPolygon)) {
    throw new Error(
      `NavigationServer3D.${member} requires a NavigationMesh assigned to the region.`,
    );
  }
  return region.navigationPolygon;
}

function touchRegion(region: GodotNavigationRegionHandle): void {
  region.iterationId += 1;
  rebuildAttached(region);
}

function touchLink(link: GodotNavigationLinkHandle): void {
  link.iterationId += 1;
  rebuildAttached(link);
}

export function notifyGodotNavigationRegionMeshChanged(region: GodotNavigationRegionHandle): void {
  requireDetached('region', region, 'navigation_mesh_changed');
  touchRegion(region);
}

export const NavigationServer = {
  get_maps: () => [...navigationMaps],
  map_set_active: (map: GodotNavigationMap, active: boolean) => {
    map.active = Boolean(active);
  },
  map_is_active: (map: GodotNavigationMap) => map.active,
  map_set_cell_size: (map: GodotNavigationMap, value: number) => {
    const next = Math.max(0.001, value);
    if (emptyMapState(map) !== undefined) {
      assertEmptyMapRebuildable(map);
      map.cellSize = next;
      requestEmptyMapRebuild(map);
      return;
    }
    if (map.cellSize !== next)
      throw new Error(
        'NavigationServer2D.map_set_cell_size requires rebuilding the native Recast navmesh.',
      );
  },
  map_get_cell_size: (map: GodotNavigationMap) => map.cellSize,
  map_set_use_edge_connections: (map: GodotNavigationMap, value: boolean) => {
    if (emptyMapState(map) !== undefined) {
      assertEmptyMapRebuildable(map);
      map.useEdgeConnections = Boolean(value);
      requestEmptyMapRebuild(map);
      return;
    }
    if (map.useEdgeConnections !== Boolean(value))
      throw new Error(
        'NavigationServer2D.map_set_use_edge_connections requires rebuilding the native Recast navmesh.',
      );
  },
  map_get_use_edge_connections: (map: GodotNavigationMap) => map.useEdgeConnections,
  map_set_edge_connection_margin: (map: GodotNavigationMap, value: number) => {
    const next = Math.max(0, value);
    if (emptyMapState(map) !== undefined) {
      assertEmptyMapRebuildable(map);
      map.edgeConnectionMargin = next;
      requestEmptyMapRebuild(map);
      return;
    }
    if (map.edgeConnectionMargin !== next)
      throw new Error(
        'NavigationServer2D.map_set_edge_connection_margin requires rebuilding the native Recast navmesh.',
      );
  },
  map_get_edge_connection_margin: (map: GodotNavigationMap) => map.edgeConnectionMargin,
  map_set_link_connection_radius: (map: GodotNavigationMap, value: number) => {
    const next = Math.max(0, value);
    if (emptyMapState(map) !== undefined) {
      assertEmptyMapRebuildable(map);
      map.linkConnectionRadius = next;
      requestEmptyMapRebuild(map);
      return;
    }
    if (map.linkConnectionRadius !== next)
      throw new Error(
        'NavigationServer2D.map_set_link_connection_radius requires rebuilding native Detour off-mesh connections.',
      );
  },
  map_get_link_connection_radius: (map: GodotNavigationMap) => map.linkConnectionRadius,
  map_get_path: (
    map: GodotNavigationMap,
    from: Vector3,
    to: Vector3,
    optimize = true,
    navigationLayers = 1,
  ) => {
    if (!optimize)
      throw new Error(
        'NavigationServer.map_get_path optimize=false requires the unsmoothed native Detour corridor.',
      );
    singleNavigationLayer(navigationLayers, 'NavigationServer.map_get_path');
    return map.getPath(from, to);
  },
  map_get_closest_point: (map: GodotNavigationMap, point: Vector3) => map.getClosestPoint(point),
  map_get_regions: (map: GodotNavigationMap) => [...map.regions],
  map_get_links: (map: GodotNavigationMap) => [...map.links],
  map_get_agents: (map: GodotNavigationMap) => [...map.agents],
  map_get_obstacles: (map: GodotNavigationMap) => [...map.obstacles],
  map_force_update: (map: GodotNavigationMap) => map.update(0),
  map_get_iteration_id: (map: GodotNavigationMap) => map.iterationId,
  map_get_random_point: (map: GodotNavigationMap, navigationLayers = 1, uniformly = false) => {
    singleNavigationLayer(navigationLayers, 'NavigationServer.map_get_random_point');
    if (uniformly)
      throw new Error(
        'NavigationServer.map_get_random_point uniformly=true requires polygon-area sampling the native binding does not expose.',
      );
    return map.getRandomPoint();
  },
  region_create: () => createGodotNavigationRegionHandle(),
  region_get_iteration_id: (region: GodotNavigationRegionHandle) => region.iterationId,
  region_set_enabled: (region: GodotNavigationRegionHandle, value: boolean) => {
    if (region.enabled === Boolean(value)) return;
    requireDetached('region', region, 'set_enabled');
    region.enabled = Boolean(value);
    touchRegion(region);
  },
  region_get_enabled: (region: GodotNavigationRegionHandle) => region.enabled,
  region_set_use_edge_connections: (region: GodotNavigationRegionHandle, value: boolean) => {
    if (typeof value !== 'boolean')
      throw new TypeError('NavigationRegion3D.use_edge_connections requires bool.');
    if (region.useEdgeConnections === value) return;
    if (region.map !== null && !value)
      throw new Error(
        'NavigationRegion3D.use_edge_connections=false requires per-region Recast edge ownership.',
      );
    requireDetached('region', region, 'set_use_edge_connections');
    region.useEdgeConnections = value;
    touchRegion(region);
  },
  region_get_use_edge_connections: (region: GodotNavigationRegionHandle) =>
    region.useEdgeConnections,
  region_set_enter_cost: (region: GodotNavigationRegionHandle, value: number) => {
    const next = navigationRegionCost(value, 'NavigationRegion3D.enter_cost');
    if (navigationCostEqual(region.enterCost, next)) return;
    if (region.map !== null && !navigationCostEqual(next, 0))
      throw new Error(
        'NavigationRegion3D.enter_cost requires per-region Detour polygon provenance.',
      );
    requireDetached('region', region, 'set_enter_cost');
    region.enterCost = next;
    touchRegion(region);
  },
  region_get_enter_cost: (region: GodotNavigationRegionHandle) => region.enterCost,
  region_set_travel_cost: (region: GodotNavigationRegionHandle, value: number) => {
    const next = navigationRegionCost(value, 'NavigationRegion3D.travel_cost');
    if (navigationCostEqual(region.travelCost, next)) return;
    if (region.map !== null && !navigationCostEqual(next, 1))
      throw new Error(
        'NavigationRegion3D.travel_cost requires per-region Detour polygon provenance.',
      );
    requireDetached('region', region, 'set_travel_cost');
    region.travelCost = next;
    touchRegion(region);
  },
  region_get_travel_cost: (region: GodotNavigationRegionHandle) => region.travelCost,
  region_set_owner_id: (region: GodotNavigationRegionHandle, value: number) => {
    if (region.ownerId === value) return;
    region.ownerId = value;
    region.iterationId += 1;
  },
  region_get_owner_id: (region: GodotNavigationRegionHandle) => region.ownerId,
  region_set_map: (region: GodotNavigationRegionHandle, map: GodotNavigationMap | null) => {
    region.map = map;
  },
  region_get_map: (region: GodotNavigationRegionHandle) => region.map,
  region_set_navigation_layers: (region: GodotNavigationRegionHandle, value: number) => {
    const next = navigationLayerMask(value, 'NavigationRegion3D');
    if (region.navigationLayers === next) return;
    if (region.map !== null) singleNavigationLayer(next, 'NavigationRegion3D');
    requireDetached('region', region, 'set_navigation_layers');
    region.navigationLayers = next;
    touchRegion(region);
  },
  region_get_navigation_layers: (region: GodotNavigationRegionHandle) => region.navigationLayers,
  region_set_transform: (region: GodotNavigationRegionHandle, value: readonly number[]) => {
    requireDetached('region', region, 'set_transform');
    region.transform = [...value];
    touchRegion(region);
  },
  region_get_transform: (region: GodotNavigationRegionHandle) => region.transform,
  region_set_navigation_polygon: (region: GodotNavigationRegionHandle, value: unknown) => {
    if (region.navigationPolygon === value) return;
    requireDetached('region', region, 'set_navigation_polygon');
    region.navigationPolygon = value;
    touchRegion(region);
  },
  region_get_bounds: (region: GodotNavigationRegionHandle) =>
    getGodotNavigationRegionBounds(
      regionNavigationMesh(region, 'region_get_bounds'),
      region.transform,
    ),
  region_get_closest_point: (region: GodotNavigationRegionHandle, point: Vector3): Vector3 =>
    getGodotNavigationRegionClosestPoint(
      regionNavigationMesh(region, 'region_get_closest_point'),
      region.transform,
      point,
    ).point,
  region_get_closest_point_normal: (region: GodotNavigationRegionHandle, point: Vector3): Vector3 =>
    getGodotNavigationRegionClosestPoint(
      regionNavigationMesh(region, 'region_get_closest_point_normal'),
      region.transform,
      point,
    ).normal,
  region_get_closest_point_to_segment: (
    region: GodotNavigationRegionHandle,
    start: Vector3,
    end: Vector3,
    useCollision = false,
  ): Vector3 =>
    getGodotNavigationRegionClosestPointToSegment(
      regionNavigationMesh(region, 'region_get_closest_point_to_segment'),
      region.transform,
      start,
      end,
      useCollision,
    ),
  link_create: () => createGodotNavigationLinkHandle(),
  link_get_iteration_id: (link: GodotNavigationLinkHandle) => link.iterationId,
  link_set_map: (link: GodotNavigationLinkHandle, map: GodotNavigationMap | null) => {
    link.map = map;
  },
  link_get_map: (link: GodotNavigationLinkHandle) => link.map,
  link_set_enabled: (link: GodotNavigationLinkHandle, value: boolean) => {
    if (link.enabled === Boolean(value)) return;
    requireDetached('link', link, 'set_enabled');
    link.enabled = Boolean(value);
    touchLink(link);
  },
  link_get_enabled: (link: GodotNavigationLinkHandle) => link.enabled,
  link_set_bidirectional: (link: GodotNavigationLinkHandle, value: boolean) => {
    if (link.bidirectional === Boolean(value)) return;
    requireDetached('link', link, 'set_bidirectional');
    link.bidirectional = Boolean(value);
    touchLink(link);
  },
  link_is_bidirectional: (link: GodotNavigationLinkHandle) => link.bidirectional,
  link_set_navigation_layers: (link: GodotNavigationLinkHandle, value: number) => {
    const next = singleNavigationLayer(value, 'NavigationLink3D');
    if (link.navigationLayers === next) return;
    requireDetached('link', link, 'set_navigation_layers');
    link.navigationLayers = next;
    touchLink(link);
  },
  link_get_navigation_layers: (link: GodotNavigationLinkHandle) => link.navigationLayers,
  link_set_start_position: (link: GodotNavigationLinkHandle, value: Vector3) => {
    requireDetached('link', link, 'set_start_position');
    link.startPosition = { ...value };
    touchLink(link);
  },
  link_get_start_position: (link: GodotNavigationLinkHandle) => ({ ...link.startPosition }),
  link_set_end_position: (link: GodotNavigationLinkHandle, value: Vector3) => {
    requireDetached('link', link, 'set_end_position');
    link.endPosition = { ...value };
    touchLink(link);
  },
  link_get_end_position: (link: GodotNavigationLinkHandle) => ({ ...link.endPosition }),
  link_set_enter_cost: (link: GodotNavigationLinkHandle, value: number) => {
    const next = Math.max(0, value);
    if (link.enterCost === next) return;
    requireDetached('link', link, 'set_enter_cost');
    link.enterCost = next;
    touchLink(link);
  },
  link_get_enter_cost: (link: GodotNavigationLinkHandle) => link.enterCost,
  link_set_travel_cost: (link: GodotNavigationLinkHandle, value: number) => {
    const next = Math.max(0, value);
    if (link.travelCost === next) return;
    requireDetached('link', link, 'set_travel_cost');
    link.travelCost = next;
    touchLink(link);
  },
  link_get_travel_cost: (link: GodotNavigationLinkHandle) => link.travelCost,
  link_set_owner_id: (link: GodotNavigationLinkHandle, value: number) => {
    if (link.ownerId === value) return;
    link.ownerId = value;
    link.iterationId += 1;
  },
  link_get_owner_id: (link: GodotNavigationLinkHandle) => link.ownerId,
  agent_get_map: (agent: GodotNavigationAgent) => agent.map,
  agent_set_avoidance_enabled: (agent: GodotNavigationAgent, value: boolean) => {
    agent.avoidanceEnabled = value;
  },
  agent_get_avoidance_enabled: (agent: GodotNavigationAgent) => agent.avoidanceEnabled,
  agent_set_neighbor_distance: (agent: GodotNavigationAgent, value: number) => {
    agent.neighborDistance = value;
  },
  agent_get_neighbor_distance: (agent: GodotNavigationAgent) => agent.neighborDistance,
  agent_set_radius: (agent: GodotNavigationAgent, value: number) => {
    agent.radius = value;
  },
  agent_get_radius: (agent: GodotNavigationAgent) => agent.radius,
  agent_set_max_speed: (agent: GodotNavigationAgent, value: number) => {
    agent.maxSpeed = value;
  },
  agent_get_max_speed: (agent: GodotNavigationAgent) => agent.maxSpeed,
  agent_set_velocity_forced: (agent: GodotNavigationAgent, value: Vector3) => {
    agent.nativeAgent.requestMoveVelocity(value);
  },
  agent_set_velocity: (agent: GodotNavigationAgent, value: Vector3) => {
    agent.velocity = value;
  },
  agent_get_velocity: (agent: GodotNavigationAgent) => agent.velocity,
  agent_set_position: (agent: GodotNavigationAgent, value: Vector3) => agent.syncPosition(value),
  agent_get_position: (agent: GodotNavigationAgent) => agent.nativeAgent.position(),
  obstacle_create: () => createGodotNavigationObstacleHandle(),
  obstacle_set_map: (obstacle: GodotNavigationObstacleHandle, map: GodotNavigationMap | null) => {
    obstacle.map = map;
  },
  obstacle_get_map: (obstacle: GodotNavigationObstacleHandle) => obstacle.map,
  obstacle_set_avoidance_enabled: (obstacle: GodotNavigationObstacleHandle, value: boolean) => {
    obstacle.avoidanceEnabled = value;
  },
  obstacle_get_avoidance_enabled: (obstacle: GodotNavigationObstacleHandle) =>
    obstacle.avoidanceEnabled,
  obstacle_set_paused: (obstacle: GodotNavigationObstacleHandle, value: boolean) => {
    obstacle.paused = value;
  },
  obstacle_get_paused: (obstacle: GodotNavigationObstacleHandle) => obstacle.paused,
  obstacle_set_radius: (obstacle: GodotNavigationObstacleHandle, value: number) => {
    obstacle.radius = value;
  },
  obstacle_get_radius: (obstacle: GodotNavigationObstacleHandle) => obstacle.radius,
  obstacle_set_height: (obstacle: GodotNavigationObstacleHandle, value: number) => {
    obstacle.height = value;
  },
  obstacle_get_height: (obstacle: GodotNavigationObstacleHandle) => obstacle.height,
  obstacle_set_use_3d_avoidance: (obstacle: GodotNavigationObstacleHandle, value: boolean) => {
    obstacle.use3dAvoidance = value;
  },
  obstacle_get_use_3d_avoidance: (obstacle: GodotNavigationObstacleHandle) =>
    obstacle.use3dAvoidance,
  obstacle_set_velocity: (obstacle: GodotNavigationObstacleHandle, value: Vector3) => {
    obstacle.velocity = value;
  },
  obstacle_get_velocity: (obstacle: GodotNavigationObstacleHandle) => obstacle.velocity,
  obstacle_set_position: (obstacle: GodotNavigationObstacleHandle, value: Vector3) => {
    obstacle.position = value;
  },
  obstacle_get_position: (obstacle: GodotNavigationObstacleHandle) => obstacle.position,
  obstacle_set_vertices: (obstacle: GodotNavigationObstacleHandle, value: readonly Vector3[]) => {
    obstacle.vertices = value.map((point) => ({ ...point }));
  },
  obstacle_get_vertices: (obstacle: GodotNavigationObstacleHandle) => obstacle.vertices,
  obstacle_set_avoidance_layers: (obstacle: GodotNavigationObstacleHandle, value: number) => {
    obstacle.avoidanceLayers = value >>> 0;
  },
  obstacle_get_avoidance_layers: (obstacle: GodotNavigationObstacleHandle) =>
    obstacle.avoidanceLayers,
  simplify_path: simplifyPath,
  free_rid: (rid: { release?: () => void; destroy?: () => void }) => {
    if (typeof rid.release === 'function') {
      rid.release();
      return;
    }
    if (typeof rid.destroy === 'function') {
      rid.destroy();
      return;
    }
    throw new TypeError('NavigationServer.free_rid requires a retained navigation RID.');
  },
  mapGetPath: (map: GodotNavigationMap, from: Vector3, to: Vector3) => map.getPath(from, to),
  mapGetClosestPoint: (map: GodotNavigationMap, point: Vector3) => map.getClosestPoint(point),
};
export const NavigationServer3D = {
  ...NavigationServer,
  region_set_navigation_mesh: NavigationServer.region_set_navigation_polygon,
  map_create: createGodotNavigationServer3DMap,
  map_set_cell_height: setGodotNavigationServer3DMapCellHeight,
  map_get_cell_height: (map: GodotNavigationMap) => map.cellHeight,
  parse_source_geometry_data: parseGodotNavigationSourceGeometryData3D,
  bake_from_source_geometry_data: bakeGodotNavigationMeshFromSourceGeometryData3D,
  bake_from_source_geometry_data_async: bakeGodotNavigationMeshFromSourceGeometryData3DAsync,
  is_baking_navigation_mesh: isGodotNavigationMeshBaking,
  region_bake_navigation_mesh: bakeGodotNavigationMeshFromRoot3D,
};

export const navigationLayerValue = (mask: number, layer: number): boolean =>
  (mask & layerBit(layer)) !== 0;
export const setNavigationLayerValue = withLayer;
