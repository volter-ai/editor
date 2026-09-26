/** Godot 2D navigation nodes as thin retained bindings over the project Recast map/crowd. */

import {
  createGodotNavigationAgent,
  createGodotNavigationLinkHandle,
  createGodotNavigationObstacleHandle,
  createGodotNavigationRegionHandle,
  navigationLayerValue,
  notifyGodotNavigationRegionMeshChanged,
  setNavigationLayerValue,
  type GodotNavigationAgent,
  type GodotNavigationLinkHandle,
  type GodotNavigationMap,
  type GodotNavigationObstacleHandle,
  type GodotNavigationRegionHandle,
} from './navigation';
import { NavigationServer2D } from './navigation-server-2d';
import { isGodotNavigationPolygon, isGodotNavigationPolygonBaking, type GodotNavigationPolygon } from './navigation-polygon';
import { registerGodotObjectIdentity } from './object';
import { godotResourceChangedSignal } from './resource-io';
import { createSignal, type GodotConnection, type GodotSignal } from './signal';
import { Container } from 'pixi.js';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

export interface NavigationVector2 { readonly x: number; readonly y: number }
export interface NavigationColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
export interface NavigationRect2 { readonly position: NavigationVector2; readonly size: NavigationVector2 }
export interface NavigationNode2D { x: number; y: number; readonly worldTransform?: { readonly tx: number; readonly ty: number } }

const toNative = (value: NavigationVector2): { x: number; y: number; z: number } => ({ x: value.x, y: 0, z: value.y });
const fromNative = (value: { x: number; y: number; z: number }): NavigationVector2 => ({ x: value.x, y: value.z });
function positionOf(node: NavigationNode2D): { x: number; y: number; z: number } {
  const world = node.worldTransform;
  return world === undefined ? { x: node.x, y: 0, z: node.y } : { x: world.tx, y: 0, z: world.ty };
}
function layer(mask: number, at: number, value?: boolean): boolean | number {
  return value === undefined ? navigationLayerValue(mask, at) : setNavigationLayerValue(mask, at, value);
}

function navigationPolygon(value: unknown, member: string): GodotNavigationPolygon | null {
  if (value === null || isGodotNavigationPolygon(value)) return value;
  throw new TypeError(`NavigationRegion2D.${member} requires NavigationPolygon or null.`);
}

export interface NavigationAgent2D {
  targetPosition: NavigationVector2; velocity: NavigationVector2;
  pathDesiredDistance: number; targetDesiredDistance: number; pathMaxDistance: number;
  navigationLayers: number; pathfindingAlgorithm: number; pathPostprocessing: number; pathMetadataFlags: number;
  simplifyPath: boolean; simplifyEpsilon: number; pathReturnMaxLength: number; pathReturnMaxRadius: number;
  pathSearchMaxPolygons: number; pathSearchMaxDistance: number;
  avoidanceEnabled: boolean; radius: number; neighborDistance: number; maxNeighbors: number;
  timeHorizonAgents: number; timeHorizonObstacles: number; maxSpeed: number;
  avoidanceLayers: number; avoidanceMask: number; avoidancePriority: number;
  debugEnabled: boolean; debugUseCustom: boolean; debugPathCustomColor: NavigationColor;
  debugPathCustomPointSize: number; debugPathCustomLineWidth: number;
  readonly path_changed: GodotSignal<[]>; readonly target_reached: GodotSignal<[]>;
  readonly navigation_finished: GodotSignal<[]>; readonly velocity_computed: GodotSignal<[NavigationVector2]>;
  get_rid(): GodotNavigationAgent; set_navigation_map(map: GodotNavigationMap): void; get_navigation_map(): GodotNavigationMap;
  get_next_path_position(): NavigationVector2; get_final_position(): NavigationVector2;
  get_current_navigation_path(): readonly NavigationVector2[]; get_current_navigation_path_index(): number;
  get_current_navigation_result(): { path: readonly NavigationVector2[]; path_types: readonly number[]; path_rids: readonly unknown[]; path_owner_ids: readonly number[] };
  get_path_length(): number; distance_to_target(): number; is_target_reachable(): boolean;
  is_navigation_finished(): boolean; is_target_reached(): boolean; set_velocity_forced(value: NavigationVector2): void;
  set_navigation_layer_value(at: number, value: boolean): void; get_navigation_layer_value(at: number): boolean;
  set_avoidance_layer_value(at: number, value: boolean): void; get_avoidance_layer_value(at: number): boolean;
  set_avoidance_mask_value(at: number, value: boolean): void; get_avoidance_mask_value(at: number): boolean; release(): void;
}

export interface NavigationAgent2DOptions {
  readonly node: NavigationNode2D; readonly map: GodotNavigationMap;
  readonly pathDesiredDistance?: number; readonly targetDesiredDistance?: number; readonly pathMaxDistance?: number;
  readonly navigationLayers?: number; readonly pathfindingAlgorithm?: number; readonly pathPostprocessing?: number; readonly pathMetadataFlags?: number;
  readonly simplifyPath?: boolean; readonly simplifyEpsilon?: number; readonly pathReturnMaxLength?: number; readonly pathReturnMaxRadius?: number;
  readonly pathSearchMaxPolygons?: number; readonly pathSearchMaxDistance?: number;
  readonly radius?: number; readonly maxSpeed?: number; readonly maxAcceleration?: number; readonly avoidanceEnabled?: boolean;
  readonly height?: number;
  readonly neighborDistance?: number; readonly maxNeighbors?: number; readonly timeHorizonAgents?: number; readonly timeHorizonObstacles?: number;
  readonly avoidanceLayers?: number; readonly avoidanceMask?: number; readonly avoidancePriority?: number;
}

export function createNavigationAgent2D<TNode extends NavigationNode2D>(options: NavigationAgent2DOptions & { readonly node: TNode }): TNode & NavigationAgent2D {
  const native = createGodotNavigationAgent({ map: options.map, position: () => positionOf(options.node), pathDesiredDistance: options.pathDesiredDistance ?? 20, targetDesiredDistance: options.targetDesiredDistance ?? 10, radius: options.radius ?? 10, height: options.height ?? 1, maxSpeed: options.maxSpeed ?? 100, maxAcceleration: options.maxAcceleration ?? 200, avoidanceEnabled: options.avoidanceEnabled ?? false });
  native.neighborDistance = options.neighborDistance ?? 500;
  const map = options.map;
  let navigationLayers = options.navigationLayers ?? 1, pathMaxDistance = options.pathMaxDistance ?? 100;
  let pathfindingAlgorithm = options.pathfindingAlgorithm ?? 0, pathPostprocessing = options.pathPostprocessing ?? 0, pathMetadataFlags = options.pathMetadataFlags ?? 15;
  let simplifyPath = options.simplifyPath ?? false, simplifyEpsilon = options.simplifyEpsilon ?? 0, pathReturnMaxLength = options.pathReturnMaxLength ?? 0, pathReturnMaxRadius = options.pathReturnMaxRadius ?? 0;
  let pathSearchMaxPolygons = options.pathSearchMaxPolygons ?? 4096, pathSearchMaxDistance = options.pathSearchMaxDistance ?? 0;
  const maxNeighbors = options.maxNeighbors ?? 10, timeHorizonAgents = options.timeHorizonAgents ?? 1, timeHorizonObstacles = options.timeHorizonObstacles ?? 0;
  let avoidanceLayers = options.avoidanceLayers ?? 1, avoidanceMask = options.avoidanceMask ?? 1, avoidancePriority = options.avoidancePriority ?? 1;
  let debugEnabled = false, debugUseCustom = false, debugPathCustomColor = { r: 1, g: 1, b: 1, a: 1 }, debugPathCustomPointSize = 4, debugPathCustomLineWidth = -1;
  let reached = false, finished = true;
  const pathChanged = createSignal<[]>(), targetReached = createSignal<[]>(), navigationFinished = createSignal<[]>(), velocityComputed = createSignal<[NavigationVector2]>();
  const unavailable = (member: string): never => { throw new Error(`NavigationAgent2D.${member} is not exposed by the native Detour crowd binding.`); };
  const surface: NavigationAgent2D = {
    path_changed: pathChanged.signal, target_reached: targetReached.signal, navigation_finished: navigationFinished.signal, velocity_computed: velocityComputed.signal,
    get targetPosition() { return fromNative(native.targetPosition); }, set targetPosition(value) { native.targetPosition = toNative(value); reached = false; finished = false; pathChanged.emit(); },
    get velocity() { return fromNative(native.velocity); }, set velocity(value) { native.velocity = toNative(value); velocityComputed.emit(fromNative(native.velocity)); },
    get pathDesiredDistance() { return native.pathDesiredDistance; }, set pathDesiredDistance(value) { native.pathDesiredDistance = value; },
    get targetDesiredDistance() { return native.targetDesiredDistance; }, set targetDesiredDistance(value) { native.targetDesiredDistance = value; },
    get pathMaxDistance() { return pathMaxDistance; }, set pathMaxDistance(value) { pathMaxDistance = Math.max(0, value); },
    get navigationLayers() { return navigationLayers; }, set navigationLayers(value) { if ((value >>> 0) !== 1) throw new Error('NavigationAgent2D navigation_layers other than layer 1 require native Recast query filters.'); navigationLayers = 1; },
    get pathfindingAlgorithm() { return pathfindingAlgorithm; }, set pathfindingAlgorithm(value) { if (value !== 0) throw new Error('NavigationAgent2D only supports native Recast A* pathfinding.'); pathfindingAlgorithm = value; },
    get pathPostprocessing() { return pathPostprocessing; }, set pathPostprocessing(value) { if (value !== 0) throw new Error('NavigationAgent2D only supports the native Detour corridor funnel.'); pathPostprocessing = value; },
    get pathMetadataFlags() { return pathMetadataFlags; }, set pathMetadataFlags(value) { pathMetadataFlags = value >>> 0; },
    get simplifyPath() { return simplifyPath; }, set simplifyPath(value) { simplifyPath = Boolean(value); },
    get simplifyEpsilon() { return simplifyEpsilon; }, set simplifyEpsilon(value) { simplifyEpsilon = Math.max(0, value); },
    get pathReturnMaxLength() { return pathReturnMaxLength; }, set pathReturnMaxLength(value) { pathReturnMaxLength = Math.max(0, value); },
    get pathReturnMaxRadius() { return pathReturnMaxRadius; }, set pathReturnMaxRadius(value) { pathReturnMaxRadius = Math.max(0, value); },
    get pathSearchMaxPolygons() { return pathSearchMaxPolygons; }, set pathSearchMaxPolygons(value) { pathSearchMaxPolygons = Math.max(0, value | 0); },
    get pathSearchMaxDistance() { return pathSearchMaxDistance; }, set pathSearchMaxDistance(value) { pathSearchMaxDistance = Math.max(0, value); },
    get avoidanceEnabled() { return native.avoidanceEnabled; }, set avoidanceEnabled(value) { native.avoidanceEnabled = value; },
    get radius() { return native.radius; }, set radius(value) { native.radius = value; }, get neighborDistance() { return native.neighborDistance; }, set neighborDistance(value) { native.neighborDistance = value; },
    get maxNeighbors() { return maxNeighbors; }, set maxNeighbors(value) { if (value !== maxNeighbors) unavailable('max_neighbors'); },
    get timeHorizonAgents() { return timeHorizonAgents; }, set timeHorizonAgents(value) { if (value !== timeHorizonAgents) unavailable('time_horizon_agents'); },
    get timeHorizonObstacles() { return timeHorizonObstacles; }, set timeHorizonObstacles(value) { if (value !== timeHorizonObstacles) unavailable('time_horizon_obstacles'); },
    get maxSpeed() { return native.maxSpeed; }, set maxSpeed(value) { native.maxSpeed = value; },
    get avoidanceLayers() { return avoidanceLayers; }, set avoidanceLayers(value) { avoidanceLayers = value >>> 0; }, get avoidanceMask() { return avoidanceMask; }, set avoidanceMask(value) { avoidanceMask = value >>> 0; },
    get avoidancePriority() { return avoidancePriority; }, set avoidancePriority(value) { avoidancePriority = Math.max(0, Math.min(1, value)); },
    get debugEnabled() { return debugEnabled; }, set debugEnabled(value) { debugEnabled = Boolean(value); }, get debugUseCustom() { return debugUseCustom; }, set debugUseCustom(value) { debugUseCustom = Boolean(value); },
    get debugPathCustomColor() { return { ...debugPathCustomColor }; }, set debugPathCustomColor(value) { debugPathCustomColor = { ...value }; }, get debugPathCustomPointSize() { return debugPathCustomPointSize; }, set debugPathCustomPointSize(value) { debugPathCustomPointSize = Math.max(0, value); }, get debugPathCustomLineWidth() { return debugPathCustomLineWidth; }, set debugPathCustomLineWidth(value) { debugPathCustomLineWidth = value; },
    get_rid: () => native, set_navigation_map(value) { if (value !== map) throw new Error('NavigationAgent2D.set_navigation_map cannot move a live native Detour crowd agent between maps.'); }, get_navigation_map: () => map,
    get_next_path_position() { const value = fromNative(native.getNextPathPosition()), nowReached = native.isTargetReached(), nowFinished = native.isNavigationFinished(); if (nowReached && !reached) targetReached.emit(); if (nowFinished && !finished) navigationFinished.emit(); reached = nowReached; finished = nowFinished; return value; },
    get_final_position: () => fromNative(native.getFinalPosition()), get_current_navigation_path: () => native.getCurrentNavigationPath().map(fromNative), get_current_navigation_path_index: () => native.getCurrentNavigationPathIndex(),
    get_current_navigation_result: () => { if (pathMetadataFlags !== 0) throw new Error('NavigationAgent2D.get_current_navigation_result requested path metadata that the native Detour query does not expose. Set path_metadata_flags to 0 or use get_current_navigation_path().'); const path = native.getCurrentNavigationPath().map(fromNative); return { path, path_types: [], path_rids: [], path_owner_ids: [] }; },
    get_path_length: () => native.getPathLength(), distance_to_target: () => native.distanceToTarget(), is_target_reachable: () => native.isTargetReachable(), is_navigation_finished: () => native.isNavigationFinished(), is_target_reached: () => native.isTargetReached(),
    set_velocity_forced(value) { native.nativeAgent.requestMoveVelocity(toNative(value)); velocityComputed.emit(value); },
    set_navigation_layer_value(at, value) { surface.navigationLayers = layer(navigationLayers, at, value) as number; }, get_navigation_layer_value: (at) => layer(navigationLayers, at) as boolean,
    set_avoidance_layer_value(at, value) { avoidanceLayers = layer(avoidanceLayers, at, value) as number; }, get_avoidance_layer_value: (at) => layer(avoidanceLayers, at) as boolean,
    set_avoidance_mask_value(at, value) { avoidanceMask = layer(avoidanceMask, at, value) as number; }, get_avoidance_mask_value: (at) => layer(avoidanceMask, at) as boolean, release: () => native.release(),
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface));
  bindNavigationAgent2DGodotApi(options.node, surface);
  registerGodotObjectIdentity(options.node, 'NavigationAgent2D');
  return options.node as TNode & NavigationAgent2D;
}

function agentProperty<T>(node: object, name: string, get: () => T, set: (value: T) => void): void {
  Object.defineProperty(node, name, { configurable: true, enumerable: true, get, set });
}

function bindNavigationAgent2DGodotApi(node: object, agent: NavigationAgent2D): void {
  agentProperty(node, 'target_position', () => agent.targetPosition, (value) => { agent.targetPosition = value; });
  agentProperty(node, 'path_desired_distance', () => agent.pathDesiredDistance, (value) => { agent.pathDesiredDistance = value; });
  agentProperty(node, 'target_desired_distance', () => agent.targetDesiredDistance, (value) => { agent.targetDesiredDistance = value; });
  agentProperty(node, 'path_max_distance', () => agent.pathMaxDistance, (value) => { agent.pathMaxDistance = value; });
  agentProperty(node, 'navigation_layers', () => agent.navigationLayers, (value) => { agent.navigationLayers = value; });
  agentProperty(node, 'pathfinding_algorithm', () => agent.pathfindingAlgorithm, (value) => { agent.pathfindingAlgorithm = value; });
  agentProperty(node, 'path_postprocessing', () => agent.pathPostprocessing, (value) => { agent.pathPostprocessing = value; });
  agentProperty(node, 'path_metadata_flags', () => agent.pathMetadataFlags, (value) => { agent.pathMetadataFlags = value; });
  agentProperty(node, 'simplify_path', () => agent.simplifyPath, (value) => { agent.simplifyPath = value; });
  agentProperty(node, 'simplify_epsilon', () => agent.simplifyEpsilon, (value) => { agent.simplifyEpsilon = value; });
  agentProperty(node, 'path_return_max_length', () => agent.pathReturnMaxLength, (value) => { agent.pathReturnMaxLength = value; });
  agentProperty(node, 'path_return_max_radius', () => agent.pathReturnMaxRadius, (value) => { agent.pathReturnMaxRadius = value; });
  agentProperty(node, 'path_search_max_polygons', () => agent.pathSearchMaxPolygons, (value) => { agent.pathSearchMaxPolygons = value; });
  agentProperty(node, 'path_search_max_distance', () => agent.pathSearchMaxDistance, (value) => { agent.pathSearchMaxDistance = value; });
  agentProperty(node, 'avoidance_enabled', () => agent.avoidanceEnabled, (value) => { agent.avoidanceEnabled = value; });
  agentProperty(node, 'neighbor_distance', () => agent.neighborDistance, (value) => { agent.neighborDistance = value; });
  agentProperty(node, 'max_neighbors', () => agent.maxNeighbors, (value) => { agent.maxNeighbors = value; });
  agentProperty(node, 'time_horizon_agents', () => agent.timeHorizonAgents, (value) => { agent.timeHorizonAgents = value; });
  agentProperty(node, 'time_horizon_obstacles', () => agent.timeHorizonObstacles, (value) => { agent.timeHorizonObstacles = value; });
  agentProperty(node, 'max_speed', () => agent.maxSpeed, (value) => { agent.maxSpeed = value; });
  agentProperty(node, 'avoidance_layers', () => agent.avoidanceLayers, (value) => { agent.avoidanceLayers = value; });
  agentProperty(node, 'avoidance_mask', () => agent.avoidanceMask, (value) => { agent.avoidanceMask = value; });
  agentProperty(node, 'avoidance_priority', () => agent.avoidancePriority, (value) => { agent.avoidancePriority = value; });
  agentProperty(node, 'debug_enabled', () => agent.debugEnabled, (value) => { agent.debugEnabled = value; });
  agentProperty(node, 'debug_use_custom', () => agent.debugUseCustom, (value) => { agent.debugUseCustom = value; });
  agentProperty(node, 'debug_path_custom_color', () => agent.debugPathCustomColor, (value) => { agent.debugPathCustomColor = value; });
  agentProperty(node, 'debug_path_custom_point_size', () => agent.debugPathCustomPointSize, (value) => { agent.debugPathCustomPointSize = value; });
  agentProperty(node, 'debug_path_custom_line_width', () => agent.debugPathCustomLineWidth, (value) => { agent.debugPathCustomLineWidth = value; });
  Object.assign(node, {
    set_target_position: (value: NavigationVector2): void => { agent.targetPosition = value; },
    get_target_position: (): NavigationVector2 => agent.targetPosition,
    set_velocity: (value: NavigationVector2): void => { agent.velocity = value; },
    get_velocity: (): NavigationVector2 => agent.velocity,
    set_path_desired_distance: (value: number): void => { agent.pathDesiredDistance = value; },
    get_path_desired_distance: (): number => agent.pathDesiredDistance,
    set_target_desired_distance: (value: number): void => { agent.targetDesiredDistance = value; },
    get_target_desired_distance: (): number => agent.targetDesiredDistance,
    set_path_max_distance: (value: number): void => { agent.pathMaxDistance = value; },
    get_path_max_distance: (): number => agent.pathMaxDistance,
    set_navigation_layers: (value: number): void => { agent.navigationLayers = value; },
    get_navigation_layers: (): number => agent.navigationLayers,
    set_avoidance_enabled: (value: boolean): void => { agent.avoidanceEnabled = value; },
    get_avoidance_enabled: (): boolean => agent.avoidanceEnabled,
    set_radius: (value: number): void => { agent.radius = value; },
    get_radius: (): number => agent.radius,
    set_neighbor_distance: (value: number): void => { agent.neighborDistance = value; },
    get_neighbor_distance: (): number => agent.neighborDistance,
    set_max_speed: (value: number): void => { agent.maxSpeed = value; },
    get_max_speed: (): number => agent.maxSpeed,
    set_avoidance_layers: (value: number): void => { agent.avoidanceLayers = value; },
    get_avoidance_layers: (): number => agent.avoidanceLayers,
    set_avoidance_mask: (value: number): void => { agent.avoidanceMask = value; },
    get_avoidance_mask: (): number => agent.avoidanceMask,
    set_avoidance_priority: (value: number): void => { agent.avoidancePriority = value; },
    get_avoidance_priority: (): number => agent.avoidancePriority,
  });
}

export function createGodotNavigationAgent2D(
  map: GodotNavigationMap,
  options: Omit<NavigationAgent2DOptions, 'node' | 'map'> = {},
): Container & NavigationAgent2D {
  const node = createNavigationAgent2D({
    ...options,
    map,
    node: bindGodotCanvasNode2DApi(new Container()),
  });
  registerCanvasNodeRelease(node, () => node.release());
  return node;
}

export interface NavigationRegion2D {
  navigationPolygon: GodotNavigationPolygon | null; enabled: boolean; useEdgeConnections: boolean; navigationLayers: number; enterCost: number; travelCost: number;
  get_rid(): GodotNavigationRegionHandle; get_region_rid(): GodotNavigationRegionHandle; set_navigation_map(map: GodotNavigationMap | null): void; get_navigation_map(): GodotNavigationMap | null;
  set_navigation_layer_value(at: number, value: boolean): void; get_navigation_layer_value(at: number): boolean; get_bounds(): NavigationRect2; is_baking(): boolean; bake_navigation_polygon(onDone?: () => void): void; release(): void;
}
export interface NavigationRegion2DOptions {
  readonly map?: GodotNavigationMap;
  readonly navigationPolygon?: GodotNavigationPolygon | null;
  readonly enabled?: boolean;
  readonly useEdgeConnections?: boolean;
  readonly navigationLayers?: number;
  readonly enterCost?: number;
  readonly travelCost?: number;
  readonly bounds?: NavigationRect2;
  readonly transform?: readonly number[];
}
export function bindNavigationRegion2D<TNode extends NavigationNode2D>(node: TNode, enabledOrOptions: boolean | NavigationRegion2DOptions, legacyLayers = 1): TNode & NavigationRegion2D {
  const options = typeof enabledOrOptions === 'boolean' ? { enabled: enabledOrOptions, navigationLayers: legacyLayers } : enabledOrOptions;
  const handle = createGodotNavigationRegionHandle({
    ...(options.map === undefined ? {} : { map: options.map }),
    ...(options.navigationPolygon === undefined ? {} : { navigationPolygon: options.navigationPolygon }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.useEdgeConnections === undefined ? {} : { useEdgeConnections: options.useEdgeConnections }),
    ...(options.navigationLayers === undefined ? {} : { navigationLayers: options.navigationLayers }),
    ...(options.enterCost === undefined ? {} : { enterCost: options.enterCost }),
    ...(options.travelCost === undefined ? {} : { travelCost: options.travelCost }),
    ...(options.transform === undefined ? {} : { transform: options.transform }),
  });
  const bounds = options.bounds ?? { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
  let polygonChangedConnection: GodotConnection | undefined;
  const bindPolygonChanged = (polygon: unknown): void => {
    polygonChangedConnection?.disconnect();
    polygonChangedConnection = isGodotNavigationPolygon(polygon)
      ? godotResourceChangedSignal(polygon).connect(() => notifyGodotNavigationRegionMeshChanged(handle))
      : undefined;
  };
  bindPolygonChanged(options.navigationPolygon ?? null);
  const surface: NavigationRegion2D = {
    get navigationPolygon(): GodotNavigationPolygon | null {
      return navigationPolygon(handle.navigationPolygon, 'navigation_polygon');
    },
    set navigationPolygon(value: GodotNavigationPolygon | null) {
      const retained = navigationPolygon(value, 'navigation_polygon');
      NavigationServer2D.region_set_navigation_polygon(handle, retained);
      bindPolygonChanged(retained);
    },
    get enabled() { return handle.enabled; }, set enabled(value) { NavigationServer2D.region_set_enabled(handle, value); },
    get useEdgeConnections() { return handle.useEdgeConnections; }, set useEdgeConnections(value) { NavigationServer2D.region_set_use_edge_connections(handle, value); }, get navigationLayers() { return handle.navigationLayers; }, set navigationLayers(value) { NavigationServer2D.region_set_navigation_layers(handle, value); },
    get enterCost() { return handle.enterCost; }, set enterCost(value) { NavigationServer2D.region_set_enter_cost(handle, value); }, get travelCost() { return handle.travelCost; }, set travelCost(value) { NavigationServer2D.region_set_travel_cost(handle, value); },
    get_rid: () => handle, get_region_rid: () => handle, set_navigation_map: (map) => { handle.map = map; }, get_navigation_map: () => handle.map,
    set_navigation_layer_value(at, value) { surface.navigationLayers = layer(handle.navigationLayers, at, value) as number; }, get_navigation_layer_value: (at) => layer(handle.navigationLayers, at) as boolean,
    get_bounds: () => ({ position: { ...bounds.position }, size: { ...bounds.size } }),
    is_baking: () => {
      const polygon = handle.navigationPolygon;
      return isGodotNavigationPolygon(polygon) ? isGodotNavigationPolygonBaking(polygon) : false;
    },
    bake_navigation_polygon(_onDone) { throw new Error('NavigationRegion2D.bake_navigation_polygon requires explicit scene-tree parse and native Recast bake supply through NavigationServer2D.'); },
    release() { polygonChangedConnection?.disconnect(); polygonChangedConnection = undefined; handle.release(); },
  };
  Object.defineProperties(node, Object.getOwnPropertyDescriptors(surface));
  Object.defineProperties(node, {
    navigation_polygon: { configurable: true, enumerable: true, get: () => surface.navigationPolygon, set: (value: unknown) => { surface.navigationPolygon = navigationPolygon(value, 'navigation_polygon'); } },
    use_edge_connections: { configurable: true, enumerable: true, get: () => surface.useEdgeConnections, set: (value: boolean) => { surface.useEdgeConnections = value; } },
    navigation_layers: { configurable: true, enumerable: true, get: () => surface.navigationLayers, set: (value: number) => { surface.navigationLayers = value; } },
    enter_cost: { configurable: true, enumerable: true, get: () => surface.enterCost, set: (value: number) => { surface.enterCost = value; } },
    travel_cost: { configurable: true, enumerable: true, get: () => surface.travelCost, set: (value: number) => { surface.travelCost = value; } },
  });
  Object.assign(node, {
    set_navigation_polygon: (value: unknown): void => { surface.navigationPolygon = navigationPolygon(value, 'set_navigation_polygon'); },
    get_navigation_polygon: (): GodotNavigationPolygon | null => surface.navigationPolygon,
    set_enabled: (value: boolean): void => { surface.enabled = value; },
    is_enabled: (): boolean => surface.enabled,
    set_use_edge_connections: (value: boolean): void => { surface.useEdgeConnections = value; },
    get_use_edge_connections: (): boolean => surface.useEdgeConnections,
    set_navigation_layers: (value: number): void => { surface.navigationLayers = value; },
    get_navigation_layers: (): number => surface.navigationLayers,
    set_enter_cost: (value: number): void => { surface.enterCost = value; },
    get_enter_cost: (): number => surface.enterCost,
    set_travel_cost: (value: number): void => { surface.travelCost = value; },
    get_travel_cost: (): number => surface.travelCost,
  });
  registerGodotObjectIdentity(node, 'NavigationRegion2D'); return node as TNode & NavigationRegion2D;
}

export function createGodotNavigationRegion2D(options: NavigationRegion2DOptions = {}): Container & NavigationRegion2D {
  const node = bindNavigationRegion2D(bindGodotCanvasNode2DApi(new Container()), options);
  registerCanvasNodeRelease(node, () => node.release());
  return node;
}

export interface NavigationLink2D {
  enabled: boolean; bidirectional: boolean; navigationLayers: number; startPosition: NavigationVector2; endPosition: NavigationVector2; enterCost: number; travelCost: number;
  get_rid(): GodotNavigationLinkHandle; set_navigation_map(map: GodotNavigationMap | null): void; get_navigation_map(): GodotNavigationMap | null; set_navigation_layer_value(at: number, value: boolean): void; get_navigation_layer_value(at: number): boolean;
  set_global_start_position(value: NavigationVector2): void; get_global_start_position(): NavigationVector2; set_global_end_position(value: NavigationVector2): void; get_global_end_position(): NavigationVector2; release(): void;
}
export interface NavigationLink2DOptions {
  readonly map?: GodotNavigationMap;
  readonly enabled?: boolean;
  readonly bidirectional?: boolean;
  readonly navigationLayers?: number;
  readonly startPosition?: NavigationVector2;
  readonly endPosition?: NavigationVector2;
  readonly enterCost?: number;
  readonly travelCost?: number;
}
export function bindNavigationLink2D<TNode extends NavigationNode2D>(options: NavigationLink2DOptions & { readonly node: TNode }): TNode & NavigationLink2D {
  const handle = createGodotNavigationLinkHandle({
    ...(options.map === undefined ? {} : { map: options.map }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.bidirectional === undefined ? {} : { bidirectional: options.bidirectional }),
    ...(options.navigationLayers === undefined ? {} : { navigationLayers: options.navigationLayers }),
    startPosition: toNative(options.startPosition ?? { x: 0, y: 0 }),
    endPosition: toNative(options.endPosition ?? { x: 0, y: 0 }),
    ...(options.enterCost === undefined ? {} : { enterCost: options.enterCost }),
    ...(options.travelCost === undefined ? {} : { travelCost: options.travelCost }),
  });
  const origin = (): NavigationVector2 => fromNative(positionOf(options.node));
  const surface: NavigationLink2D = {
    get enabled() { return handle.enabled; }, set enabled(value) { NavigationServer2D.link_set_enabled(handle, value); }, get bidirectional() { return handle.bidirectional; }, set bidirectional(value) { NavigationServer2D.link_set_bidirectional(handle, value); },
    get navigationLayers() { return handle.navigationLayers; }, set navigationLayers(value) { NavigationServer2D.link_set_navigation_layers(handle, value); }, get startPosition() { return fromNative(handle.startPosition); }, set startPosition(value) { NavigationServer2D.link_set_start_position(handle, toNative(value)); }, get endPosition() { return fromNative(handle.endPosition); }, set endPosition(value) { NavigationServer2D.link_set_end_position(handle, toNative(value)); },
    get enterCost() { return handle.enterCost; }, set enterCost(value) { NavigationServer2D.link_set_enter_cost(handle, value); }, get travelCost() { return handle.travelCost; }, set travelCost(value) { NavigationServer2D.link_set_travel_cost(handle, value); },
    get_rid: () => handle, set_navigation_map: (map) => { handle.map = map; }, get_navigation_map: () => handle.map, set_navigation_layer_value(at, value) { surface.navigationLayers = layer(handle.navigationLayers, at, value) as number; }, get_navigation_layer_value: (at) => layer(handle.navigationLayers, at) as boolean,
    set_global_start_position(value) { const at = origin(); surface.startPosition = { x: value.x - at.x, y: value.y - at.y }; }, get_global_start_position() { const at = origin(), value = surface.startPosition; return { x: at.x + value.x, y: at.y + value.y }; },
    set_global_end_position(value) { const at = origin(); surface.endPosition = { x: value.x - at.x, y: value.y - at.y }; }, get_global_end_position() { const at = origin(), value = surface.endPosition; return { x: at.x + value.x, y: at.y + value.y }; }, release: () => handle.release(),
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface));
  Object.defineProperties(options.node, {
    navigation_layers: { configurable: true, enumerable: true, get: () => surface.navigationLayers, set: (value: number) => { surface.navigationLayers = value; } },
    start_position: { configurable: true, enumerable: true, get: () => surface.startPosition, set: (value: NavigationVector2) => { surface.startPosition = value; } },
    end_position: { configurable: true, enumerable: true, get: () => surface.endPosition, set: (value: NavigationVector2) => { surface.endPosition = value; } },
    enter_cost: { configurable: true, enumerable: true, get: () => surface.enterCost, set: (value: number) => { surface.enterCost = value; } },
    travel_cost: { configurable: true, enumerable: true, get: () => surface.travelCost, set: (value: number) => { surface.travelCost = value; } },
  });
  Object.assign(options.node, {
    set_enabled: (value: boolean): void => { surface.enabled = value; },
    is_enabled: (): boolean => surface.enabled,
    set_bidirectional: (value: boolean): void => { surface.bidirectional = value; },
    is_bidirectional: (): boolean => surface.bidirectional,
    set_navigation_layers: (value: number): void => { surface.navigationLayers = value; },
    get_navigation_layers: (): number => surface.navigationLayers,
    set_start_position: (value: NavigationVector2): void => { surface.startPosition = value; },
    get_start_position: (): NavigationVector2 => surface.startPosition,
    set_end_position: (value: NavigationVector2): void => { surface.endPosition = value; },
    get_end_position: (): NavigationVector2 => surface.endPosition,
    set_enter_cost: (value: number): void => { surface.enterCost = value; },
    get_enter_cost: (): number => surface.enterCost,
    set_travel_cost: (value: number): void => { surface.travelCost = value; },
    get_travel_cost: (): number => surface.travelCost,
  });
  registerGodotObjectIdentity(options.node, 'NavigationLink2D'); return options.node as TNode & NavigationLink2D;
}

export function createGodotNavigationLink2D(options: NavigationLink2DOptions = {}): Container & NavigationLink2D {
  const node = bindNavigationLink2D({ ...options, node: bindGodotCanvasNode2DApi(new Container()) });
  registerCanvasNodeRelease(node, () => node.release());
  return node;
}

export interface NavigationObstacle2D {
  radius: number; velocity: NavigationVector2; vertices: readonly NavigationVector2[]; avoidanceLayers: number; avoidanceEnabled: boolean; affectNavigationMesh: boolean; carveNavigationMesh: boolean;
  get_rid(): GodotNavigationObstacleHandle; set_navigation_map(map: GodotNavigationMap | null): void; get_navigation_map(): GodotNavigationMap | null; set_avoidance_layer_value(at: number, value: boolean): void; get_avoidance_layer_value(at: number): boolean; release(): void;
}
export interface NavigationObstacle2DOptions {
  readonly map?: GodotNavigationMap;
  readonly radius?: number;
  readonly velocity?: NavigationVector2;
  readonly vertices?: readonly NavigationVector2[];
  readonly avoidanceLayers?: number;
  readonly avoidanceEnabled?: boolean;
  readonly affectNavigationMesh?: boolean;
  readonly carveNavigationMesh?: boolean;
}
export function bindNavigationObstacle2D<TNode extends NavigationNode2D>(options: NavigationObstacle2DOptions & { readonly node: TNode }): TNode & NavigationObstacle2D {
  const handle = createGodotNavigationObstacleHandle({
    ...(options.map === undefined ? {} : { map: options.map }),
    position: positionOf(options.node),
    ...(options.radius === undefined ? {} : { radius: options.radius }),
    velocity: toNative(options.velocity ?? { x: 0, y: 0 }),
    vertices: (options.vertices ?? []).map(toNative),
    ...(options.avoidanceLayers === undefined ? {} : { avoidanceLayers: options.avoidanceLayers }),
    ...(options.avoidanceEnabled === undefined ? {} : { avoidanceEnabled: options.avoidanceEnabled }),
  });
  const affectNavigationMesh = options.affectNavigationMesh ?? false, carveNavigationMesh = options.carveNavigationMesh ?? false;
  const surface: NavigationObstacle2D = {
    get radius() { return handle.radius; }, set radius(value) { handle.radius = value; }, get velocity() { return fromNative(handle.velocity); }, set velocity(value) { handle.velocity = toNative(value); }, get vertices() { return handle.vertices.map(fromNative); }, set vertices(value) { handle.vertices = value.map(toNative); },
    get avoidanceLayers() { return handle.avoidanceLayers; }, set avoidanceLayers(value) { handle.avoidanceLayers = value >>> 0; }, get avoidanceEnabled() { return handle.avoidanceEnabled; }, set avoidanceEnabled(value) { handle.avoidanceEnabled = value; },
    get affectNavigationMesh() { return affectNavigationMesh; }, set affectNavigationMesh(value) { if (value !== affectNavigationMesh) throw new Error('NavigationObstacle2D.affect_navigation_mesh requires a mutable Recast tile-cache navmesh.'); }, get carveNavigationMesh() { return carveNavigationMesh; }, set carveNavigationMesh(value) { if (value !== carveNavigationMesh) throw new Error('NavigationObstacle2D.carve_navigation_mesh requires a mutable Recast tile-cache navmesh.'); },
    get_rid: () => handle, set_navigation_map: (map) => { handle.map = map; }, get_navigation_map: () => handle.map, set_avoidance_layer_value(at, value) { surface.avoidanceLayers = layer(handle.avoidanceLayers, at, value) as number; }, get_avoidance_layer_value: (at) => layer(handle.avoidanceLayers, at) as boolean, release: () => handle.release(),
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface));
  Object.defineProperties(options.node, {
    avoidance_layers: { configurable: true, enumerable: true, get: () => surface.avoidanceLayers, set: (value: number) => { surface.avoidanceLayers = value; } },
    avoidance_enabled: { configurable: true, enumerable: true, get: () => surface.avoidanceEnabled, set: (value: boolean) => { surface.avoidanceEnabled = value; } },
    affect_navigation_mesh: { configurable: true, enumerable: true, get: () => surface.affectNavigationMesh, set: (value: boolean) => { surface.affectNavigationMesh = value; } },
    carve_navigation_mesh: { configurable: true, enumerable: true, get: () => surface.carveNavigationMesh, set: (value: boolean) => { surface.carveNavigationMesh = value; } },
  });
  Object.assign(options.node, {
    set_radius: (value: number): void => { surface.radius = value; },
    get_radius: (): number => surface.radius,
    set_velocity: (value: NavigationVector2): void => { surface.velocity = value; },
    get_velocity: (): NavigationVector2 => surface.velocity,
    set_vertices: (value: readonly NavigationVector2[]): void => { surface.vertices = value; },
    get_vertices: (): readonly NavigationVector2[] => surface.vertices,
    set_avoidance_layers: (value: number): void => { surface.avoidanceLayers = value; },
    get_avoidance_layers: (): number => surface.avoidanceLayers,
    set_avoidance_enabled: (value: boolean): void => { surface.avoidanceEnabled = value; },
    get_avoidance_enabled: (): boolean => surface.avoidanceEnabled,
    set_affect_navigation_mesh: (value: boolean): void => { surface.affectNavigationMesh = value; },
    get_affect_navigation_mesh: (): boolean => surface.affectNavigationMesh,
    set_carve_navigation_mesh: (value: boolean): void => { surface.carveNavigationMesh = value; },
    get_carve_navigation_mesh: (): boolean => surface.carveNavigationMesh,
  });
  registerGodotObjectIdentity(options.node, 'NavigationObstacle2D'); return options.node as TNode & NavigationObstacle2D;
}

export function createGodotNavigationObstacle2D(options: NavigationObstacle2DOptions = {}): Container & NavigationObstacle2D {
  const node = bindNavigationObstacle2D({ ...options, node: bindGodotCanvasNode2DApi(new Container()) });
  registerCanvasNodeRelease(node, () => node.release());
  return node;
}
