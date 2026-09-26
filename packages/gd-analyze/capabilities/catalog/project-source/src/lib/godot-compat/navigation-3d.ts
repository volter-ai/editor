/** Retained THREE.Object3D bindings over the project native Recast/Detour navigation state. */
import { Vector3, type Object3D } from 'three';
import {
  createGodotNavigationAgent,
  claimGodotNavigationRegionHandle,
  createGodotNavigationLinkHandle,
  createGodotNavigationObstacleHandle,
  createGodotNavigationRegionHandle,
  navigationLayerValue,
  NavigationServer3D,
  notifyGodotNavigationRegionMeshChanged,
  setNavigationLayerValue,
  type GodotNavigationAgent,
  type GodotNavigationLinkHandle,
  type GodotNavigationMap,
  type GodotNavigationObstacleHandle,
  type GodotNavigationRegionHandle,
} from './navigation';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotConnection, type GodotSignal } from './signal';
import { isGodotNavigationMesh, type GodotNavigationMesh } from './navigation-mesh';
import { bakeGodotNavigationRegion3D, bindGodotNavigationBakeObstacle3D, isGodotNavigationMeshBaking } from './navigation-source-geometry-3d';
import { godotResourceChangedSignal } from './resource-io';

export interface NavigationVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface NavigationAabb { readonly position: NavigationVector3; readonly size: NavigationVector3 }
export interface NavigationColor3D { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
const copy = (value: NavigationVector3): NavigationVector3 => ({ x: value.x, y: value.y, z: value.z });
function positionOf(node: Object3D): NavigationVector3 {
  node.updateWorldMatrix(true, false);
  return copy(node.getWorldPosition(new Vector3()));
}
function layer(mask: number, at: number, value?: boolean): number | boolean {
  return value === undefined ? navigationLayerValue(mask, at) : setNavigationLayerValue(mask, at, value);
}
const sameNumbers = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const samePoint = (left: NavigationVector3, right: NavigationVector3): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z;

export interface NavigationAgent3D {
  targetPosition: NavigationVector3; velocity: NavigationVector3;
  pathDesiredDistance: number; targetDesiredDistance: number; pathHeightOffset: number; pathMaxDistance: number; navigationLayers: number;
  pathfindingAlgorithm: number; pathPostprocessing: number; pathMetadataFlags: number; simplifyPath: boolean; simplifyEpsilon: number;
  pathReturnMaxLength: number; pathReturnMaxRadius: number; pathSearchMaxPolygons: number; pathSearchMaxDistance: number;
  radius: number; height: number; neighborDistance: number; maxNeighbors: number;
  timeHorizonAgents: number; timeHorizonObstacles: number; maxSpeed: number; maxAcceleration: number;
  avoidanceEnabled: boolean; avoidanceLayers: number; avoidanceMask: number; avoidancePriority: number;
  use3dAvoidance: boolean; keepYVelocity: boolean;
  debugEnabled: boolean; debugUseCustom: boolean; debugPathCustomColor: NavigationColor3D; debugPathCustomPointSize: number;
  readonly path_changed: GodotSignal<[]>; readonly target_reached: GodotSignal<[]>; readonly navigation_finished: GodotSignal<[]>; readonly velocity_computed: GodotSignal<[NavigationVector3]>;
  get_rid(): GodotNavigationAgent; set_navigation_map(map: GodotNavigationMap): void; get_navigation_map(): GodotNavigationMap;
  getNextPathPosition(): NavigationVector3; getFinalPosition(): NavigationVector3;
  getCurrentNavigationPath(): readonly NavigationVector3[]; getCurrentNavigationPathIndex(): number;
  getPathLength(): number; distanceToTarget(): number; isTargetReachable(): boolean;
  isNavigationFinished(): boolean; isTargetReached(): boolean;
  get_current_navigation_result(): { path: readonly NavigationVector3[]; path_types: readonly number[]; path_rids: readonly unknown[]; path_owner_ids: readonly number[] };
  set_debug_enabled(value: boolean): void; get_debug_enabled(): boolean; set_debug_use_custom(value: boolean): void; get_debug_use_custom(): boolean;
  set_debug_path_custom_color(value: NavigationColor3D): void; get_debug_path_custom_color(): NavigationColor3D; set_debug_path_custom_point_size(value: number): void; get_debug_path_custom_point_size(): number;
  setVelocityForced(value: NavigationVector3): void; warp(value: NavigationVector3): void; getPosition(): NavigationVector3;
  set_navigation_layer_value(at: number, value: boolean): void; get_navigation_layer_value(at: number): boolean;
  set_avoidance_layer_value(at: number, value: boolean): void; get_avoidance_layer_value(at: number): boolean;
  set_avoidance_mask_value(at: number, value: boolean): void; get_avoidance_mask_value(at: number): boolean;
  release(): void;
}

export interface NavigationAgent3DOptions {
  readonly node: Object3D; readonly map: GodotNavigationMap;
  readonly pathDesiredDistance?: number; readonly targetDesiredDistance?: number;
  readonly pathHeightOffset?: number; readonly pathMaxDistance?: number; readonly pathfindingAlgorithm?: number; readonly pathPostprocessing?: number; readonly pathMetadataFlags?: number;
  readonly simplifyPath?: boolean; readonly simplifyEpsilon?: number; readonly pathReturnMaxLength?: number; readonly pathReturnMaxRadius?: number; readonly pathSearchMaxPolygons?: number; readonly pathSearchMaxDistance?: number;
  readonly navigationLayers?: number; readonly radius?: number; readonly height?: number;
  readonly neighborDistance?: number; readonly maxNeighbors?: number;
  readonly timeHorizonAgents?: number; readonly timeHorizonObstacles?: number;
  readonly maxSpeed?: number; readonly maxAcceleration?: number; readonly avoidanceEnabled?: boolean;
  readonly avoidanceLayers?: number; readonly avoidanceMask?: number; readonly avoidancePriority?: number;
  readonly use3dAvoidance?: boolean; readonly keepYVelocity?: boolean;
}

export function createNavigationAgent3D<TNode extends Object3D>(options: NavigationAgent3DOptions & { readonly node: TNode }): TNode & NavigationAgent3D {
  if ((options.avoidanceLayers ?? 1) !== 1 || (options.avoidanceMask ?? 1) !== 1) throw new Error('NavigationAgent3D avoidance layer filters other than layer 1 are not exposed by native Detour Crowd.');
  const native = createGodotNavigationAgent({
    map: options.map, position: () => positionOf(options.node),
    pathDesiredDistance: options.pathDesiredDistance ?? 1,
    targetDesiredDistance: options.targetDesiredDistance ?? 1,
    radius: options.radius ?? 0.5, height: options.height ?? 1,
    maxSpeed: options.maxSpeed ?? 10, maxAcceleration: options.maxAcceleration ?? 20,
    avoidanceEnabled: options.avoidanceEnabled ?? false,
    navigationLayers: options.navigationLayers ?? 1,
  });
  native.neighborDistance = options.neighborDistance ?? 50;
  let pathHeightOffset = options.pathHeightOffset ?? 0, pathMaxDistance = options.pathMaxDistance ?? 5;
  let pathfindingAlgorithm = options.pathfindingAlgorithm ?? 0, pathPostprocessing = options.pathPostprocessing ?? 0, pathMetadataFlags = options.pathMetadataFlags ?? 15;
  let simplifyPath = options.simplifyPath ?? false, simplifyEpsilon = options.simplifyEpsilon ?? 0, pathReturnMaxLength = options.pathReturnMaxLength ?? 0, pathReturnMaxRadius = options.pathReturnMaxRadius ?? 0;
  let pathSearchMaxPolygons = options.pathSearchMaxPolygons ?? 4096, pathSearchMaxDistance = options.pathSearchMaxDistance ?? 0;
  let height = options.height ?? 1;
  let maxNeighbors = Math.max(0, Math.trunc(options.maxNeighbors ?? 10));
  let timeHorizonAgents = Math.max(0, options.timeHorizonAgents ?? 1);
  let timeHorizonObstacles = Math.max(0, options.timeHorizonObstacles ?? 0);
  let avoidanceLayers = options.avoidanceLayers ?? 1;
  let avoidanceMask = options.avoidanceMask ?? 1;
  let avoidancePriority = options.avoidancePriority ?? 1;
  let use3dAvoidance = options.use3dAvoidance ?? false, keepYVelocity = options.keepYVelocity ?? true;
  let debugEnabled = false, debugUseCustom = false, debugPathCustomColor: NavigationColor3D = { r: 1, g: 1, b: 1, a: 1 }, debugPathCustomPointSize = 4;
  let reached = false, finished = true;
  const pathChanged = createSignal<[]>(), targetReached = createSignal<[]>(), navigationFinished = createSignal<[]>(), velocityComputed = createSignal<[NavigationVector3]>();
  const updateTransitionSignals = (): void => {
    const nowReached = native.isTargetReached(), nowFinished = native.isNavigationFinished();
    if (nowReached && !reached) targetReached.emit();
    if (nowFinished && !finished) navigationFinished.emit();
    reached = nowReached; finished = nowFinished;
  };
  const releasePostSync = native.map.addAgentPostSync(() => {
    updateTransitionSignals();
    if (native.avoidanceEnabled) velocityComputed.emit(copy(native.velocity));
  });
  const unavailable = (member: string): never => { throw new Error(`NavigationAgent3D.${member} is not exposed by the native Detour crowd agent.`); };
  const surface: NavigationAgent3D = {
    path_changed: pathChanged.signal, target_reached: targetReached.signal, navigation_finished: navigationFinished.signal, velocity_computed: velocityComputed.signal,
    get targetPosition() { return copy(native.targetPosition); },
    set targetPosition(value) { native.targetPosition = copy(value); reached = false; finished = false; pathChanged.emit(); },
    get velocity() { return copy(native.velocity); },
    set velocity(value) { native.velocity = copy(value); },
    get pathDesiredDistance() { return native.pathDesiredDistance; },
    set pathDesiredDistance(value) { native.pathDesiredDistance = value; },
    get targetDesiredDistance() { return native.targetDesiredDistance; },
    set targetDesiredDistance(value) { native.targetDesiredDistance = value; },
    get pathHeightOffset() { return pathHeightOffset; }, set pathHeightOffset(value) { pathHeightOffset = value; },
    get pathMaxDistance() { return pathMaxDistance; }, set pathMaxDistance(value) { pathMaxDistance = Math.max(0, value); },
    get navigationLayers() { return native.navigationLayers; },
    set navigationLayers(value) { native.navigationLayers = value; },
    get pathfindingAlgorithm() { return pathfindingAlgorithm; }, set pathfindingAlgorithm(value) { if (value !== 0) unavailable('pathfinding_algorithm'); pathfindingAlgorithm = value; },
    get pathPostprocessing() { return pathPostprocessing; }, set pathPostprocessing(value) { if (value !== 0) unavailable('path_postprocessing'); pathPostprocessing = value; },
    get pathMetadataFlags() { return pathMetadataFlags; }, set pathMetadataFlags(value) { pathMetadataFlags = value >>> 0; },
    get simplifyPath() { return simplifyPath; }, set simplifyPath(value) { simplifyPath = Boolean(value); }, get simplifyEpsilon() { return simplifyEpsilon; }, set simplifyEpsilon(value) { simplifyEpsilon = Math.max(0, value); },
    get pathReturnMaxLength() { return pathReturnMaxLength; }, set pathReturnMaxLength(value) { pathReturnMaxLength = Math.max(0, value); }, get pathReturnMaxRadius() { return pathReturnMaxRadius; }, set pathReturnMaxRadius(value) { pathReturnMaxRadius = Math.max(0, value); },
    get pathSearchMaxPolygons() { return pathSearchMaxPolygons; }, set pathSearchMaxPolygons(value) { pathSearchMaxPolygons = Math.max(0, value | 0); }, get pathSearchMaxDistance() { return pathSearchMaxDistance; }, set pathSearchMaxDistance(value) { pathSearchMaxDistance = Math.max(0, value); },
    get radius() { return native.radius; }, set radius(value) { native.radius = value; },
    get height() { return height; }, set height(value) { height = Math.max(0, value); },
    get neighborDistance() { return native.neighborDistance; }, set neighborDistance(value) { native.neighborDistance = value; },
    get maxNeighbors() { return maxNeighbors; }, set maxNeighbors(value) { maxNeighbors = Math.max(0, Math.trunc(value)); },
    get timeHorizonAgents() { return timeHorizonAgents; }, set timeHorizonAgents(value) { timeHorizonAgents = Math.max(0, value); },
    get timeHorizonObstacles() { return timeHorizonObstacles; }, set timeHorizonObstacles(value) { timeHorizonObstacles = Math.max(0, value); },
    get maxSpeed() { return native.maxSpeed; }, set maxSpeed(value) { native.maxSpeed = value; },
    get maxAcceleration() { return native.maxAcceleration; }, set maxAcceleration(value) { native.maxAcceleration = value; },
    get avoidanceEnabled() { return native.avoidanceEnabled; }, set avoidanceEnabled(value) { native.avoidanceEnabled = value; },
    get avoidanceLayers() { return avoidanceLayers; }, set avoidanceLayers(value) { avoidanceLayers = value >>> 0; },
    get avoidanceMask() { return avoidanceMask; }, set avoidanceMask(value) { avoidanceMask = value >>> 0; },
    get avoidancePriority() { return avoidancePriority; }, set avoidancePriority(value) { avoidancePriority = Math.max(0, Math.min(1, value)); },
    get use3dAvoidance() { return use3dAvoidance; }, set use3dAvoidance(value) { use3dAvoidance = Boolean(value); },
    get keepYVelocity() { return keepYVelocity; }, set keepYVelocity(value) { keepYVelocity = Boolean(value); },
    get debugEnabled() { return debugEnabled; }, set debugEnabled(value) { debugEnabled = Boolean(value); }, get debugUseCustom() { return debugUseCustom; }, set debugUseCustom(value) { debugUseCustom = Boolean(value); },
    get debugPathCustomColor() { return { ...debugPathCustomColor }; }, set debugPathCustomColor(value) { debugPathCustomColor = { ...value }; }, get debugPathCustomPointSize() { return debugPathCustomPointSize; }, set debugPathCustomPointSize(value) { debugPathCustomPointSize = Math.max(0, value); },
    get_rid: () => native,
    set_navigation_map(value) { if (value !== native.map) throw new Error('NavigationAgent3D.set_navigation_map cannot move a live native CrowdAgent between maps.'); },
    get_navigation_map: () => native.map,
    getNextPathPosition: () => { const value = copy(native.getNextPathPosition()); updateTransitionSignals(); return { x: value.x, y: value.y + pathHeightOffset, z: value.z }; },
    getFinalPosition: () => copy(native.getFinalPosition()),
    getCurrentNavigationPath: () => native.getCurrentNavigationPath().map(copy),
    getCurrentNavigationPathIndex: () => native.getCurrentNavigationPathIndex(),
    getPathLength: () => native.getPathLength(), distanceToTarget: () => native.distanceToTarget(),
    isTargetReachable: () => native.isTargetReachable(), isNavigationFinished: () => native.isNavigationFinished(), isTargetReached: () => native.isTargetReached(),
    get_current_navigation_result() {
      const path = native.getCurrentNavigationPath().map(copy);
      return {
        path,
        path_types: (pathMetadataFlags & 1) === 0 ? [] : path.map(() => 0),
        path_rids: (pathMetadataFlags & 2) === 0 ? [] : path.map(() => null),
        path_owner_ids: (pathMetadataFlags & 4) === 0 ? [] : path.map(() => 0),
      };
    },
    set_debug_enabled(value) { surface.debugEnabled = value; }, get_debug_enabled: () => surface.debugEnabled, set_debug_use_custom(value) { surface.debugUseCustom = value; }, get_debug_use_custom: () => surface.debugUseCustom,
    set_debug_path_custom_color(value) { surface.debugPathCustomColor = value; }, get_debug_path_custom_color: () => surface.debugPathCustomColor,
    set_debug_path_custom_point_size(value) { surface.debugPathCustomPointSize = value; }, get_debug_path_custom_point_size: () => surface.debugPathCustomPointSize,
    setVelocityForced(value) { native.nativeAgent.requestMoveVelocity(copy(value)); },
    warp(value) { native.syncPosition(copy(value)); }, getPosition: () => copy(native.nativeAgent.position()),
    set_navigation_layer_value(at, value) { surface.navigationLayers = layer(native.navigationLayers, at, value) as number; }, get_navigation_layer_value: (at) => layer(native.navigationLayers, at) as boolean,
    set_avoidance_layer_value(at, value) { surface.avoidanceLayers = layer(avoidanceLayers, at, value) as number; }, get_avoidance_layer_value: (at) => layer(avoidanceLayers, at) as boolean,
    set_avoidance_mask_value(at, value) { surface.avoidanceMask = layer(avoidanceMask, at, value) as number; }, get_avoidance_mask_value: (at) => layer(avoidanceMask, at) as boolean,
    release: () => { releasePostSync(); native.release(); },
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface));
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors({
    set_target_position: (value: NavigationVector3) => { surface.targetPosition = value; }, get_target_position: () => surface.targetPosition,
    set_velocity: (value: NavigationVector3) => { surface.velocity = value; }, get_velocity: () => surface.velocity,
    set_path_desired_distance: (value: number) => { surface.pathDesiredDistance = value; }, get_path_desired_distance: () => surface.pathDesiredDistance,
    set_target_desired_distance: (value: number) => { surface.targetDesiredDistance = value; }, get_target_desired_distance: () => surface.targetDesiredDistance,
    set_path_height_offset: (value: number) => { surface.pathHeightOffset = value; }, get_path_height_offset: () => surface.pathHeightOffset,
    set_path_max_distance: (value: number) => { surface.pathMaxDistance = value; }, get_path_max_distance: () => surface.pathMaxDistance,
    set_navigation_layers: (value: number) => { surface.navigationLayers = value; }, get_navigation_layers: () => surface.navigationLayers,
    set_pathfinding_algorithm: (value: number) => { surface.pathfindingAlgorithm = value; }, get_pathfinding_algorithm: () => surface.pathfindingAlgorithm,
    set_path_postprocessing: (value: number) => { surface.pathPostprocessing = value; }, get_path_postprocessing: () => surface.pathPostprocessing,
    set_path_metadata_flags: (value: number) => { surface.pathMetadataFlags = value; }, get_path_metadata_flags: () => surface.pathMetadataFlags,
    set_simplify_path: (value: boolean) => { surface.simplifyPath = value; }, get_simplify_path: () => surface.simplifyPath,
    set_simplify_epsilon: (value: number) => { surface.simplifyEpsilon = value; }, get_simplify_epsilon: () => surface.simplifyEpsilon,
    set_path_return_max_length: (value: number) => { surface.pathReturnMaxLength = value; }, get_path_return_max_length: () => surface.pathReturnMaxLength,
    set_path_return_max_radius: (value: number) => { surface.pathReturnMaxRadius = value; }, get_path_return_max_radius: () => surface.pathReturnMaxRadius,
    set_path_search_max_polygons: (value: number) => { surface.pathSearchMaxPolygons = value; }, get_path_search_max_polygons: () => surface.pathSearchMaxPolygons,
    set_path_search_max_distance: (value: number) => { surface.pathSearchMaxDistance = value; }, get_path_search_max_distance: () => surface.pathSearchMaxDistance,
    set_avoidance_enabled: (value: boolean) => { surface.avoidanceEnabled = value; }, get_avoidance_enabled: () => surface.avoidanceEnabled,
    set_radius: (value: number) => { surface.radius = value; }, get_radius: () => surface.radius,
    set_height: (value: number) => { surface.height = value; }, get_height: () => surface.height,
    set_neighbor_distance: (value: number) => { surface.neighborDistance = value; }, get_neighbor_distance: () => surface.neighborDistance,
    set_max_neighbors: (value: number) => { surface.maxNeighbors = value; }, get_max_neighbors: () => surface.maxNeighbors,
    set_time_horizon_agents: (value: number) => { surface.timeHorizonAgents = value; }, get_time_horizon_agents: () => surface.timeHorizonAgents,
    set_time_horizon_obstacles: (value: number) => { surface.timeHorizonObstacles = value; }, get_time_horizon_obstacles: () => surface.timeHorizonObstacles,
    set_max_speed: (value: number) => { surface.maxSpeed = value; }, get_max_speed: () => surface.maxSpeed,
    set_use_3d_avoidance: (value: boolean) => { surface.use3dAvoidance = value; }, get_use_3d_avoidance: () => surface.use3dAvoidance,
    set_keep_y_velocity: (value: boolean) => { surface.keepYVelocity = value; }, get_keep_y_velocity: () => surface.keepYVelocity,
    set_avoidance_layers: (value: number) => { surface.avoidanceLayers = value; }, get_avoidance_layers: () => surface.avoidanceLayers,
    set_avoidance_mask: (value: number) => { surface.avoidanceMask = value; }, get_avoidance_mask: () => surface.avoidanceMask,
    set_avoidance_priority: (value: number) => { surface.avoidancePriority = value; }, get_avoidance_priority: () => surface.avoidancePriority,
    get_path_length: surface.getPathLength, get_next_path_position: surface.getNextPathPosition, set_velocity_forced: surface.setVelocityForced,
    distance_to_target: surface.distanceToTarget, get_current_navigation_result: surface.get_current_navigation_result,
    get_current_navigation_path: surface.getCurrentNavigationPath, get_current_navigation_path_index: surface.getCurrentNavigationPathIndex,
    is_target_reached: surface.isTargetReached, is_target_reachable: surface.isTargetReachable, is_navigation_finished: surface.isNavigationFinished, get_final_position: surface.getFinalPosition,
  }));
  registerGodotObjectIdentity(options.node, 'NavigationAgent3D');
  return options.node as TNode & NavigationAgent3D;
}

export interface NavigationRegion3D {
  navigationMesh: GodotNavigationMesh | null; enabled: boolean; useEdgeConnections: boolean; navigationLayers: number; enterCost: number; travelCost: number;
  get_rid(): GodotNavigationRegionHandle; get_region_rid(): GodotNavigationRegionHandle;
  set_navigation_map(map: GodotNavigationMap | null): void; get_navigation_map(): GodotNavigationMap | null;
  set_navigation_layer_value(at: number, value: boolean): void; get_navigation_layer_value(at: number): boolean;
  readonly navigation_mesh_changed: GodotSignal<[]>; readonly bake_finished: GodotSignal<[]>;
  get_bounds(): NavigationAabb; bake_navigation_mesh(onThread?: boolean): void; is_baking(): boolean; release(): void;
}

function isNavigationRegionNode(
  node: Object3D,
): node is Object3D & { navigationMesh: GodotNavigationMesh | null } {
  return 'navigationMesh' in node;
}
export function bindNavigationRegion3D<TNode extends Object3D>(node: TNode, enabledOrOptions: boolean | { readonly map?: GodotNavigationMap; readonly navigationMesh?: GodotNavigationMesh | null; readonly authoredToken?: string; readonly enabled?: boolean; readonly useEdgeConnections?: boolean; readonly navigationLayers?: number; readonly enterCost?: number; readonly travelCost?: number; readonly bounds?: NavigationAabb }, legacyLayers = 1): TNode & NavigationRegion3D {
  const options = typeof enabledOrOptions === 'boolean' ? { enabled: enabledOrOptions, navigationLayers: legacyLayers } : enabledOrOptions;
  const initialMesh = options.navigationMesh ?? null;
  if (initialMesh !== null && !isGodotNavigationMesh(initialMesh)) throw new TypeError('NavigationRegion3D.navigation_mesh requires NavigationMesh or null.');
  node.updateWorldMatrix(true, false);
  const initialTransform = [...node.matrixWorld.elements];
  const initialEnabled = options.enabled ?? true;
  const initialUseEdgeConnections = options.useEdgeConnections ?? true;
  const initialNavigationLayers = options.navigationLayers ?? 1;
  const initialEnterCost = options.enterCost ?? 0;
  const initialTravelCost = options.travelCost ?? 1;
  const handle = claimGodotNavigationRegionHandle(options.map, initialMesh, initialTransform, {
    ...(options.authoredToken === undefined ? {} : { authoredToken: options.authoredToken }),
    enabled: initialEnabled,
    useEdgeConnections: initialUseEdgeConnections,
    navigationLayers: initialNavigationLayers,
    enterCost: initialEnterCost,
    travelCost: initialTravelCost,
  }) ?? createGodotNavigationRegionHandle({
    ...(options.map === undefined ? {} : { map: options.map }),
    navigationPolygon: initialMesh,
    enabled: initialEnabled,
    useEdgeConnections: initialUseEdgeConnections,
    navigationLayers: initialNavigationLayers,
    enterCost: initialEnterCost,
    travelCost: initialTravelCost,
    transform: initialTransform,
  });
  const fallbackBounds = options.bounds ?? { position: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } };
  const navigationMeshChanged = createSignal<[]>();
  const bakeFinished = createSignal<[]>();
  let meshChangedConnection: GodotConnection | undefined;
  const bindMeshChanged = (mesh: GodotNavigationMesh | null): void => {
    meshChangedConnection?.disconnect();
    meshChangedConnection = mesh === null ? undefined : godotResourceChangedSignal(mesh).connect(() => {
      notifyGodotNavigationRegionMeshChanged(handle);
      navigationMeshChanged.emit();
    });
  };
  bindMeshChanged(initialMesh);
  let releaseTransformSync: (() => void) | undefined;
  const syncWorldTransform = (): void => {
    node.updateWorldMatrix(true, false);
    const transform = node.matrixWorld.elements;
    if (!sameNumbers(handle.transform, transform)) NavigationServer3D.region_set_transform(handle, [...transform]);
  };
  const bindTransformSync = (map: GodotNavigationMap | null): void => {
    releaseTransformSync?.(); releaseTransformSync = map?.addAgentSync(syncWorldTransform);
  };
  const releaseMapChanged = handle.addMapChanged(bindTransformSync);
  bindTransformSync(handle.map);
  const surface: NavigationRegion3D = {
    navigation_mesh_changed: navigationMeshChanged.signal,
    bake_finished: bakeFinished.signal,
    get navigationMesh() { return handle.navigationPolygon as GodotNavigationMesh | null; },
    set navigationMesh(value) {
      if (value !== null && !isGodotNavigationMesh(value)) throw new TypeError('NavigationRegion3D.navigation_mesh requires NavigationMesh or null.');
      NavigationServer3D.region_set_navigation_polygon(handle, value);
      bindMeshChanged(value);
      navigationMeshChanged.emit();
    },
    get enabled() { return handle.enabled; }, set enabled(value) { NavigationServer3D.region_set_enabled(handle, value); },
    get useEdgeConnections() { return handle.useEdgeConnections; }, set useEdgeConnections(value) { NavigationServer3D.region_set_use_edge_connections(handle, value); },
    get navigationLayers() { return handle.navigationLayers; }, set navigationLayers(value) { NavigationServer3D.region_set_navigation_layers(handle, value); },
    get enterCost() { return handle.enterCost; }, set enterCost(value) { NavigationServer3D.region_set_enter_cost(handle, value); },
    get travelCost() { return handle.travelCost; }, set travelCost(value) { NavigationServer3D.region_set_travel_cost(handle, value); },
    get_rid: () => handle, get_region_rid: () => handle, set_navigation_map: (map) => {
      node.updateWorldMatrix(true, false);
      const transform = [...node.matrixWorld.elements];
      if (map === handle.map) NavigationServer3D.region_set_transform(handle, transform);
      else { handle.transform = transform; handle.map = map; }
    }, get_navigation_map: () => handle.map,
    set_navigation_layer_value(at, value) { surface.navigationLayers = layer(handle.navigationLayers, at, value) as number; }, get_navigation_layer_value: (at) => layer(handle.navigationLayers, at) as boolean,
    get_bounds: () => surface.navigationMesh === null
      ? { position: copy(fallbackBounds.position), size: copy(fallbackBounds.size) }
      : NavigationServer3D.region_get_bounds(handle),
    bake_navigation_mesh(onThread = true) {
      if (typeof onThread !== 'boolean') throw new TypeError('NavigationRegion3D.bake_navigation_mesh on_thread requires bool.');
      if (!isNavigationRegionNode(node)) {
        throw new Error('NavigationRegion3D native node lost its retained navigation_mesh seat.');
      }
      bakeGodotNavigationRegion3D(
        node,
        () => bakeFinished.emit(),
        onThread,
      );
    },
    is_baking: () => surface.navigationMesh !== null && isGodotNavigationMeshBaking(surface.navigationMesh),
    release: () => { meshChangedConnection?.disconnect(); meshChangedConnection = undefined; releaseMapChanged(); releaseTransformSync?.(); releaseTransformSync = undefined; handle.release(); },
  };
  Object.defineProperties(node, Object.getOwnPropertyDescriptors(surface));
  Object.defineProperties(node, Object.getOwnPropertyDescriptors({
    set_navigation_mesh: (value: GodotNavigationMesh | null) => { surface.navigationMesh = value; }, get_navigation_mesh: () => surface.navigationMesh,
    set_enabled: (value: boolean) => { surface.enabled = value; }, is_enabled: () => surface.enabled,
    set_use_edge_connections: (value: boolean) => { surface.useEdgeConnections = value; }, get_use_edge_connections: () => surface.useEdgeConnections,
    set_navigation_layers: (value: number) => { surface.navigationLayers = value; }, get_navigation_layers: () => surface.navigationLayers,
    set_enter_cost: (value: number) => { surface.enterCost = value; }, get_enter_cost: () => surface.enterCost,
    set_travel_cost: (value: number) => { surface.travelCost = value; }, get_travel_cost: () => surface.travelCost,
  }));
  registerGodotObjectIdentity(node, 'NavigationRegion3D'); return node as TNode & NavigationRegion3D;
}

export interface NavigationLink3D {
  enabled: boolean; bidirectional: boolean; navigationLayers: number; startPosition: NavigationVector3; endPosition: NavigationVector3; enterCost: number; travelCost: number;
  get_rid(): GodotNavigationLinkHandle; set_navigation_map(map: GodotNavigationMap | null): void; get_navigation_map(): GodotNavigationMap | null;
  set_navigation_layer_value(at: number, value: boolean): void; get_navigation_layer_value(at: number): boolean;
  set_global_start_position(value: NavigationVector3): void; get_global_start_position(): NavigationVector3; set_global_end_position(value: NavigationVector3): void; get_global_end_position(): NavigationVector3; release(): void;
}
export function bindNavigationLink3D<TNode extends Object3D>(options: { readonly node: TNode; readonly map?: GodotNavigationMap; readonly enabled?: boolean; readonly bidirectional?: boolean; readonly navigationLayers?: number; readonly startPosition?: NavigationVector3; readonly endPosition?: NavigationVector3; readonly enterCost?: number; readonly travelCost?: number }): TNode & NavigationLink3D {
  let localStart = copy(options.startPosition ?? { x: 0, y: 0, z: 0 });
  let localEnd = copy(options.endPosition ?? { x: 0, y: 0, z: 0 });
  const worldPoint = (value: NavigationVector3): NavigationVector3 => { options.node.updateWorldMatrix(true, false); return copy(options.node.localToWorld(new Vector3(value.x, value.y, value.z))); };
  const localPoint = (value: NavigationVector3): NavigationVector3 => { options.node.updateWorldMatrix(true, false); return copy(options.node.worldToLocal(new Vector3(value.x, value.y, value.z))); };
  options.node.updateWorldMatrix(true, false);
  const handle = createGodotNavigationLinkHandle({
    ...(options.map === undefined ? {} : { map: options.map }),
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.bidirectional === undefined ? {} : { bidirectional: options.bidirectional }),
    ...(options.navigationLayers === undefined ? {} : { navigationLayers: options.navigationLayers }),
    startPosition: worldPoint(localStart),
    endPosition: worldPoint(localEnd),
    ...(options.enterCost === undefined ? {} : { enterCost: options.enterCost }),
    ...(options.travelCost === undefined ? {} : { travelCost: options.travelCost }),
  });
  let releaseTransformSync: (() => void) | undefined;
  const syncWorldPoints = (): void => {
    const start = worldPoint(localStart), end = worldPoint(localEnd);
    if (!samePoint(handle.startPosition, start)) NavigationServer3D.link_set_start_position(handle, start);
    if (!samePoint(handle.endPosition, end)) NavigationServer3D.link_set_end_position(handle, end);
  };
  const bindTransformSync = (map: GodotNavigationMap | null): void => {
    releaseTransformSync?.(); releaseTransformSync = map?.addAgentSync(syncWorldPoints);
  };
  const releaseMapChanged = handle.addMapChanged(bindTransformSync);
  bindTransformSync(handle.map);
  const surface: NavigationLink3D = {
    get enabled() { return handle.enabled; }, set enabled(value) { NavigationServer3D.link_set_enabled(handle, value); }, get bidirectional() { return handle.bidirectional; }, set bidirectional(value) { NavigationServer3D.link_set_bidirectional(handle, value); },
    get navigationLayers() { return handle.navigationLayers; }, set navigationLayers(value) { NavigationServer3D.link_set_navigation_layers(handle, value); },
    get startPosition() { return copy(localStart); }, set startPosition(value) { localStart = copy(value); NavigationServer3D.link_set_start_position(handle, worldPoint(localStart)); }, get endPosition() { return copy(localEnd); }, set endPosition(value) { localEnd = copy(value); NavigationServer3D.link_set_end_position(handle, worldPoint(localEnd)); },
    get enterCost() { return handle.enterCost; }, set enterCost(value) { NavigationServer3D.link_set_enter_cost(handle, value); }, get travelCost() { return handle.travelCost; }, set travelCost(value) { NavigationServer3D.link_set_travel_cost(handle, value); },
    get_rid: () => handle, set_navigation_map: (map) => {
      const start = worldPoint(localStart), end = worldPoint(localEnd);
      if (map === handle.map) {
        NavigationServer3D.link_set_start_position(handle, start); NavigationServer3D.link_set_end_position(handle, end);
      } else { handle.startPosition = start; handle.endPosition = end; handle.map = map; }
    }, get_navigation_map: () => handle.map,
    set_navigation_layer_value(at, value) { surface.navigationLayers = layer(handle.navigationLayers, at, value) as number; }, get_navigation_layer_value: (at) => layer(handle.navigationLayers, at) as boolean,
    set_global_start_position(value) { localStart = localPoint(value); NavigationServer3D.link_set_start_position(handle, copy(value)); },
    get_global_start_position: () => copy(handle.startPosition),
    set_global_end_position(value) { localEnd = localPoint(value); NavigationServer3D.link_set_end_position(handle, copy(value)); },
    get_global_end_position: () => copy(handle.endPosition),
    release: () => { releaseMapChanged(); releaseTransformSync?.(); releaseTransformSync = undefined; handle.release(); },
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface));
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors({
    set_enabled: (value: boolean) => { surface.enabled = value; }, is_enabled: () => surface.enabled,
    set_bidirectional: (value: boolean) => { surface.bidirectional = value; }, is_bidirectional: () => surface.bidirectional,
    set_navigation_layers: (value: number) => { surface.navigationLayers = value; }, get_navigation_layers: () => surface.navigationLayers,
    set_start_position: (value: NavigationVector3) => { surface.startPosition = value; }, get_start_position: () => surface.startPosition,
    set_end_position: (value: NavigationVector3) => { surface.endPosition = value; }, get_end_position: () => surface.endPosition,
    set_enter_cost: (value: number) => { surface.enterCost = value; }, get_enter_cost: () => surface.enterCost,
    set_travel_cost: (value: number) => { surface.travelCost = value; }, get_travel_cost: () => surface.travelCost,
  }));
  registerGodotObjectIdentity(options.node, 'NavigationLink3D'); return options.node as TNode & NavigationLink3D;
}

export interface NavigationObstacle3D {
  radius: number; height: number; velocity: NavigationVector3; vertices: readonly NavigationVector3[]; avoidanceLayers: number; avoidanceEnabled: boolean;
  use3dAvoidance: boolean; affectNavigationMesh: boolean; carveNavigationMesh: boolean;
  get_rid(): GodotNavigationObstacleHandle; set_navigation_map(map: GodotNavigationMap | null): void; get_navigation_map(): GodotNavigationMap | null;
  set_avoidance_enabled(value: boolean): void; get_avoidance_enabled(): boolean; set_radius(value: number): void; get_radius(): number; set_height(value: number): void; get_height(): number;
  set_velocity(value: NavigationVector3): void; get_velocity(): NavigationVector3; set_vertices(value: readonly NavigationVector3[]): void; get_vertices(): readonly NavigationVector3[];
  set_avoidance_layers(value: number): void; get_avoidance_layers(): number; set_use_3d_avoidance(value: boolean): void; get_use_3d_avoidance(): boolean;
  set_affect_navigation_mesh(value: boolean): void; get_affect_navigation_mesh(): boolean; set_carve_navigation_mesh(value: boolean): void; get_carve_navigation_mesh(): boolean;
  set_avoidance_layer_value(at: number, value: boolean): void; get_avoidance_layer_value(at: number): boolean; release(): void;
}
export function bindNavigationObstacle3D<TNode extends Object3D>(options: { readonly node: TNode; readonly map?: GodotNavigationMap; readonly radius?: number; readonly height?: number; readonly velocity?: NavigationVector3; readonly vertices?: readonly NavigationVector3[]; readonly avoidanceLayers?: number; readonly avoidanceEnabled?: boolean; readonly use3dAvoidance?: boolean; readonly affectNavigationMesh?: boolean; readonly carveNavigationMesh?: boolean }): TNode & NavigationObstacle3D {
  const handle = createGodotNavigationObstacleHandle({
    ...(options.map === undefined ? {} : { map: options.map }),
    position: positionOf(options.node),
    ...(options.radius === undefined ? {} : { radius: options.radius }),
    ...(options.height === undefined ? {} : { height: options.height }),
    ...(options.velocity === undefined ? {} : { velocity: options.velocity }),
    ...(options.vertices === undefined ? {} : { vertices: options.vertices }),
    ...(options.avoidanceLayers === undefined ? {} : { avoidanceLayers: options.avoidanceLayers }),
    ...(options.avoidanceEnabled === undefined ? {} : { avoidanceEnabled: options.avoidanceEnabled }),
  });
  let affect = options.affectNavigationMesh ?? false, carve = options.carveNavigationMesh ?? false;
  let stopSync: (() => void) | undefined;
  let released = false;
  const releaseBakeObstacle = bindGodotNavigationBakeObstacle3D(options.node, () => ({
    vertices: handle.vertices,
    height: handle.height,
    affectNavigationMesh: affect,
    carveNavigationMesh: carve,
  }));
  const bindSync = (map: GodotNavigationMap | null): void => { stopSync?.(); stopSync = map?.addAgentSync(() => handle.syncPosition(positionOf(options.node))); };
  bindSync(handle.map);
  const surface: NavigationObstacle3D = {
    get radius() { return handle.radius; }, set radius(value) { handle.radius = value; }, get height() { return handle.height; }, set height(value) { handle.height = value; },
    get velocity() { return copy(handle.velocity); }, set velocity(value) { handle.velocity = copy(value); }, get vertices() { return handle.vertices.map(copy); }, set vertices(value) { handle.vertices = value.map(copy); },
    get avoidanceLayers() { return handle.avoidanceLayers; }, set avoidanceLayers(value) { handle.avoidanceLayers = value >>> 0; }, get avoidanceEnabled() { return handle.avoidanceEnabled; }, set avoidanceEnabled(value) { handle.avoidanceEnabled = value; },
    get use3dAvoidance() { return handle.use3dAvoidance; }, set use3dAvoidance(value) { handle.use3dAvoidance = Boolean(value); },
    get affectNavigationMesh() { return affect; }, set affectNavigationMesh(value) { affect = Boolean(value); },
    get carveNavigationMesh() { return carve; }, set carveNavigationMesh(value) { carve = Boolean(value); },
    get_rid: () => handle, set_navigation_map(map) { if (map === handle.map) return; handle.map = map; bindSync(map); }, get_navigation_map: () => handle.map,
    set_avoidance_enabled(value) { surface.avoidanceEnabled = value; }, get_avoidance_enabled: () => surface.avoidanceEnabled,
    set_radius(value) { surface.radius = value; }, get_radius: () => surface.radius, set_height(value) { surface.height = value; }, get_height: () => surface.height,
    set_velocity(value) { surface.velocity = value; }, get_velocity: () => surface.velocity, set_vertices(value) { surface.vertices = value; }, get_vertices: () => surface.vertices,
    set_avoidance_layers(value) { surface.avoidanceLayers = value; }, get_avoidance_layers: () => surface.avoidanceLayers,
    set_use_3d_avoidance(value) { surface.use3dAvoidance = value; }, get_use_3d_avoidance: () => surface.use3dAvoidance,
    set_affect_navigation_mesh(value) { surface.affectNavigationMesh = value; }, get_affect_navigation_mesh: () => surface.affectNavigationMesh,
    set_carve_navigation_mesh(value) { surface.carveNavigationMesh = value; }, get_carve_navigation_mesh: () => surface.carveNavigationMesh,
    set_avoidance_layer_value(at, value) { surface.avoidanceLayers = layer(handle.avoidanceLayers, at, value) as number; }, get_avoidance_layer_value: (at) => layer(handle.avoidanceLayers, at) as boolean,
    release() { if (released) return; released = true; stopSync?.(); stopSync = undefined; releaseBakeObstacle(); handle.release(); },
  };
  Object.defineProperties(options.node, Object.getOwnPropertyDescriptors(surface)); registerGodotObjectIdentity(options.node, 'NavigationObstacle3D'); return options.node as TNode & NavigationObstacle3D;
}
