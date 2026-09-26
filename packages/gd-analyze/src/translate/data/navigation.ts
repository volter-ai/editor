/** Raw authored navigation data. Recast conversion belongs to copied godot-compat. */

import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface RawNavigationRegionRequest {
  readonly authoredToken: string;
  readonly dimension: 2 | 3;
  readonly vertices: readonly (readonly number[])[];
  readonly polygons: readonly (readonly number[])[];
  readonly outlines?: readonly (readonly (readonly number[])[])[];
  readonly transform: readonly number[];
  readonly enabled: boolean;
  readonly useEdgeConnections: boolean;
  readonly navigationLayers: number;
  readonly enterCost: number;
  readonly travelCost: number;
  readonly agentRadius?: number;
  readonly agentHeight?: number;
  readonly agentMaxClimb?: number;
  readonly agentMaxSlope?: number;
  readonly cellSize?: number;
  readonly cellHeight?: number;
  readonly borderSize?: number;
  readonly samplePartitionType?: number;
  readonly parsedGeometryType?: number;
  readonly parsedCollisionMask?: number;
  readonly sourceGeometryMode?: number;
  readonly sourceGeometryGroupName?: string;
  readonly bakingRect?: { readonly position: readonly [number, number]; readonly size: readonly [number, number] };
  readonly bakingRectOffset?: readonly [number, number];
}

const list = (value: GodotValue | undefined): readonly GodotValue[] =>
  value?.kind === 'array' ? value.items : value?.kind === 'ctor' ? value.args : [];

const numericList = (value: GodotValue | undefined): number[] =>
  list(value).flatMap((item) => (item.kind === 'number' ? [item.value] : []));

const optionalNumber = (value: GodotValue | undefined): number | undefined =>
  value?.kind === 'number' ? value.value : undefined;

const optionalString = (value: GodotValue | undefined): string | undefined =>
  value?.kind === 'string' ? value.value : undefined;

const optionalVector2 = (value: GodotValue | undefined): readonly [number, number] | undefined => {
  if (value?.kind !== 'ctor' || value.name !== 'Vector2') return undefined;
  const components = numericList(value);
  return components.length === 2 ? [components[0]!, components[1]!] : undefined;
};

const optionalRect2 = (value: GodotValue | undefined): { readonly position: readonly [number, number]; readonly size: readonly [number, number] } | undefined => {
  if (value?.kind !== 'ctor' || value.name !== 'Rect2') return undefined;
  const components = numericList(value);
  if (components.length === 4) return { position: [components[0]!, components[1]!], size: [components[2]!, components[3]!] };
  const position = optionalVector2(value.args[0]);
  const size = optionalVector2(value.args[1]);
  return position !== undefined && size !== undefined ? { position, size } : undefined;
};

export function readRawNavigationRegion(
  properties: Readonly<Record<string, GodotValue>>,
  dimension: 2 | 3,
  transform: readonly number[],
  at: string,
): RawNavigationRegionRequest {
  const vertices = list(properties['vertices']).flatMap((value) => {
    if (value.kind !== 'ctor' || value.name !== `Vector${dimension}`) return [];
    const components = numericList(value);
    return components.length === dimension ? [components] : [];
  });
  const polygons = list(properties['polygons'])
    .map((value) => numericList(value).map((index) => index | 0))
    .filter((polygon) => polygon.length >= 3);
  const outlines = list(properties['outlines']).map((outline) => list(outline).flatMap((value) => {
    if (value.kind !== 'ctor' || value.name !== 'Vector2') return [];
    const components = numericList(value); return components.length === 2 ? [components] : [];
  })).filter((outline) => outline.length > 0);
  // NavigationMesh is also the mutable bake target in Godot 3D. A freshly authored
  // NavigationMesh therefore legitimately has no surface until
  // NavigationRegion3D.bake_navigation_mesh() (or NavigationServer3D's source-data
  // bake) fills it. NavigationPolygon does not use that 3D bake lifecycle here.
  if (dimension === 2 && (vertices.length < 3 || polygons.length === 0)) {
    throw new TranslateError(at, `a Navigation${dimension === 2 ? 'Polygon' : 'Mesh'} with no polygon surface`);
  }
  const enabled = properties['enabled'];
  const useEdgeConnections = properties['use_edge_connections'];
  const layers = properties['navigation_layers'];
  const sourceGeometryGroupName = optionalString(
    properties['geometry_source_group_name'] ?? properties['source_geometry_group_name'],
  );
  const agentRadius = optionalNumber(properties['agent_radius']);
  const agentHeight = optionalNumber(properties['agent_height']);
  const agentMaxClimb = optionalNumber(properties['agent_max_climb']);
  const agentMaxSlope = optionalNumber(properties['agent_max_slope']);
  const cellSize = optionalNumber(properties['cell_size']);
  const cellHeight = optionalNumber(properties['cell_height']);
  const borderSize = optionalNumber(properties['border_size']);
  const samplePartitionType = optionalNumber(properties['sample_partition_type']);
  const parsedGeometryType = optionalNumber(
    properties['geometry_parsed_geometry_type'] ?? properties['parsed_geometry_type'],
  );
  const parsedCollisionMask = optionalNumber(
    properties['geometry_collision_mask'] ?? properties['parsed_collision_mask'],
  );
  const sourceGeometryMode = optionalNumber(
    properties['geometry_source_geometry_mode'] ?? properties['source_geometry_mode'],
  );
  const bakingRect = optionalRect2(properties['baking_rect']);
  const bakingRectOffset = optionalVector2(properties['baking_rect_offset']);
  return {
    authoredToken: at,
    dimension,
    vertices,
    polygons,
    outlines,
    transform,
    enabled: enabled?.kind === 'bool' ? enabled.value : true,
    useEdgeConnections: useEdgeConnections?.kind === 'bool' ? useEdgeConnections.value : true,
    navigationLayers: layers?.kind === 'number' ? layers.value | 0 : 1,
    enterCost: optionalNumber(properties['enter_cost']) ?? 0,
    travelCost: optionalNumber(properties['travel_cost']) ?? 1,
    ...(agentRadius === undefined ? {} : { agentRadius }),
    ...(agentHeight === undefined ? {} : { agentHeight }),
    ...(agentMaxClimb === undefined ? {} : { agentMaxClimb }),
    ...(agentMaxSlope === undefined ? {} : { agentMaxSlope }),
    ...(cellSize === undefined ? {} : { cellSize }),
    ...(cellHeight === undefined ? {} : { cellHeight }),
    ...(borderSize === undefined ? {} : { borderSize }),
    ...(samplePartitionType === undefined ? {} : { samplePartitionType }),
    ...(parsedGeometryType === undefined ? {} : { parsedGeometryType }),
    ...(parsedCollisionMask === undefined ? {} : { parsedCollisionMask }),
    ...(sourceGeometryMode === undefined ? {} : { sourceGeometryMode }),
    ...(sourceGeometryGroupName === undefined ? {} : { sourceGeometryGroupName }),
    ...(bakingRect === undefined ? {} : { bakingRect }),
    ...(bakingRectOffset === undefined ? {} : { bakingRectOffset }),
  };
}

export function refuseUnsupportedNavigationRegionProperties(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
): void {
  const layers = properties['navigation_layers'];
  if (layers?.kind === 'number' && layers.value !== 1) {
    throw new TranslateError(at, 'navigation_layers other than layer 1 need native Recast filter flags');
  }
  for (const [name, defaultValue] of [['enter_cost', 0], ['travel_cost', 1]] as const) {
    const value = properties[name];
    if (value?.kind === 'number' && value.value !== defaultValue) {
      throw new TranslateError(at, `${name}=${value.value} needs a native Recast QueryFilter area cost`);
    }
  }
}

export interface NavigationAgentEmissionSpec {
  readonly pathDesiredDistance: number;
  readonly targetDesiredDistance: number;
  readonly pathHeightOffset: number;
  readonly radius: number;
  readonly height: number;
  readonly maxSpeed: number;
  readonly maxAcceleration: number;
  readonly avoidanceEnabled: boolean;
  readonly navigationLayers: number;
  readonly pathMaxDistance: number;
  readonly pathfindingAlgorithm: number;
  readonly pathPostprocessing: number;
  readonly pathMetadataFlags: number;
  readonly simplifyPath: boolean;
  readonly simplifyEpsilon: number;
  readonly pathReturnMaxLength: number;
  readonly pathReturnMaxRadius: number;
  readonly pathSearchMaxPolygons: number;
  readonly pathSearchMaxDistance: number;
  readonly neighborDistance: number;
  readonly maxNeighbors: number;
  readonly timeHorizonAgents: number;
  readonly timeHorizonObstacles: number;
  readonly avoidanceLayers: number;
  readonly avoidanceMask: number;
  readonly avoidancePriority: number;
  readonly use3dAvoidance: boolean;
  readonly keepYVelocity: boolean;
}

const numberOr = (value: GodotValue | undefined, fallback: number): number =>
  value?.kind === 'number' ? value.value : fallback;

export function readNavigationAgentEmissionSpec(
  properties: Readonly<Record<string, GodotValue>>,
  at: string,
  dimension: 2 | 3 = 2,
): NavigationAgentEmissionSpec {
  const layers = properties['navigation_layers'];
  if (layers?.kind === 'number' && layers.value !== 1) {
    throw new TranslateError(at, 'NavigationAgent navigation_layers other than layer 1 need native Recast filter flags');
  }
  return {
    pathDesiredDistance: numberOr(properties['path_desired_distance'], dimension === 2 ? 20 : 1),
    targetDesiredDistance: numberOr(properties['target_desired_distance'], dimension === 2 ? 10 : 1),
    pathHeightOffset: numberOr(properties['path_height_offset'], 0),
    radius: numberOr(properties['radius'], dimension === 2 ? 10 : 0.5),
    height: numberOr(properties['height'], 1),
    maxSpeed: numberOr(properties['max_speed'], dimension === 2 ? 100 : 10),
    maxAcceleration: numberOr(properties['max_acceleration'], dimension === 2 ? 200 : 20),
    avoidanceEnabled: properties['avoidance_enabled']?.kind === 'bool'
      ? properties['avoidance_enabled'].value
      : false,
    navigationLayers: numberOr(properties['navigation_layers'], 1) | 0,
    pathMaxDistance: numberOr(properties['path_max_distance'], dimension === 2 ? 100 : 5),
    pathfindingAlgorithm: numberOr(properties['pathfinding_algorithm'], 0) | 0,
    pathPostprocessing: numberOr(properties['path_postprocessing'], 0) | 0,
    pathMetadataFlags: numberOr(properties['path_metadata_flags'], 15) | 0,
    simplifyPath: properties['simplify_path']?.kind === 'bool' ? properties['simplify_path'].value : false,
    simplifyEpsilon: numberOr(properties['simplify_epsilon'], 0),
    pathReturnMaxLength: numberOr(properties['path_return_max_length'], 0),
    pathReturnMaxRadius: numberOr(properties['path_return_max_radius'], 0),
    pathSearchMaxPolygons: numberOr(properties['path_search_max_polygons'], 4096) | 0,
    pathSearchMaxDistance: numberOr(properties['path_search_max_distance'], 0),
    neighborDistance: numberOr(properties['neighbor_distance'], dimension === 2 ? 500 : 50),
    maxNeighbors: numberOr(properties['max_neighbors'], 10) | 0,
    timeHorizonAgents: numberOr(properties['time_horizon_agents'], 1),
    timeHorizonObstacles: numberOr(properties['time_horizon_obstacles'], 0),
    avoidanceLayers: numberOr(properties['avoidance_layers'], 1) | 0,
    avoidanceMask: numberOr(properties['avoidance_mask'], 1) | 0,
    avoidancePriority: numberOr(properties['avoidance_priority'], 1),
    use3dAvoidance: properties['use_3d_avoidance']?.kind === 'bool' ? properties['use_3d_avoidance'].value : false,
    keepYVelocity: properties['keep_y_velocity']?.kind === 'bool' ? properties['keep_y_velocity'].value : true,
  };
}

export interface NavigationLinkEmissionSpec {
  readonly enabled: boolean; readonly bidirectional: boolean; readonly navigationLayers: number;
  readonly startPosition: readonly [number, number]; readonly endPosition: readonly [number, number];
  readonly enterCost: number; readonly travelCost: number;
}
export interface RawNavigationLinkRequest {
  readonly enabled: boolean; readonly bidirectional: boolean; readonly navigationLayers: number;
  readonly startPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly endPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly enterCost: number; readonly travelCost: number;
}
export interface NavigationObstacleEmissionSpec {
  readonly radius: number; readonly velocity: readonly [number, number]; readonly vertices: readonly (readonly [number, number])[];
  readonly avoidanceLayers: number; readonly avoidanceEnabled: boolean; readonly affectNavigationMesh: boolean; readonly carveNavigationMesh: boolean;
}
const vector2 = (value: GodotValue | undefined, fallback: readonly [number, number]): readonly [number, number] => {
  const values = numericList(value); return values.length >= 2 ? [values[0]!, values[1]!] : fallback;
};
export function readNavigationLinkEmissionSpec(properties: Readonly<Record<string, GodotValue>>): NavigationLinkEmissionSpec {
  return {
    enabled: properties['enabled']?.kind === 'bool' ? properties['enabled'].value : true,
    bidirectional: properties['bidirectional']?.kind === 'bool' ? properties['bidirectional'].value : true,
    navigationLayers: numberOr(properties['navigation_layers'], 1) | 0,
    startPosition: vector2(properties['start_position'], [0, 0]), endPosition: vector2(properties['end_position'], [0, 0]),
    enterCost: numberOr(properties['enter_cost'], 0), travelCost: numberOr(properties['travel_cost'], 1),
  };
}
export function readRawNavigationLink(properties: Readonly<Record<string, GodotValue>>, transform: readonly number[]): RawNavigationLinkRequest {
  const spec = readNavigationLinkEmissionSpec(properties);
  const point = (value: readonly [number, number]) => ({
    x: (transform[0] ?? 1) * value[0] + (transform[8] ?? 0) * value[1] + (transform[12] ?? 0),
    y: 0,
    z: (transform[2] ?? 0) * value[0] + (transform[10] ?? 1) * value[1] + (transform[14] ?? 0),
  });
  return { enabled: spec.enabled, bidirectional: spec.bidirectional, navigationLayers: spec.navigationLayers, startPosition: point(spec.startPosition), endPosition: point(spec.endPosition), enterCost: spec.enterCost, travelCost: spec.travelCost };
}
export function readNavigationObstacleEmissionSpec(properties: Readonly<Record<string, GodotValue>>): NavigationObstacleEmissionSpec {
  return {
    radius: numberOr(properties['radius'], 0), velocity: vector2(properties['velocity'], [0, 0]),
    vertices: list(properties['vertices']).flatMap((value) => { const point = vector2(value, [Number.NaN, Number.NaN]); return Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [point] : []; }),
    avoidanceLayers: numberOr(properties['avoidance_layers'], 1) | 0,
    avoidanceEnabled: properties['avoidance_enabled']?.kind === 'bool' ? properties['avoidance_enabled'].value : true,
    affectNavigationMesh: properties['affect_navigation_mesh']?.kind === 'bool' ? properties['affect_navigation_mesh'].value : false,
    carveNavigationMesh: properties['carve_navigation_mesh']?.kind === 'bool' ? properties['carve_navigation_mesh'].value : false,
  };
}

export const NAVIGATION_AGENT_PROPERTIES: ReadonlySet<string> = new Set([
  'path_desired_distance', 'target_desired_distance', 'radius', 'height', 'max_speed',
  'max_acceleration', 'avoidance_enabled', 'navigation_layers',
  'path_max_distance', 'pathfinding_algorithm', 'path_postprocessing', 'path_metadata_flags',
  'simplify_path', 'simplify_epsilon', 'path_return_max_length', 'path_return_max_radius',
  'path_search_max_polygons', 'path_search_max_distance', 'neighbor_distance', 'max_neighbors',
  'time_horizon_agents', 'time_horizon_obstacles', 'avoidance_layers', 'avoidance_mask', 'avoidance_priority',
  'path_height_offset', 'use_3d_avoidance', 'keep_y_velocity', 'debug_enabled', 'debug_use_custom',
  'debug_path_custom_color', 'debug_path_custom_point_size',
]);
export const NAVIGATION_REGION_PROPERTIES: ReadonlySet<string> = new Set([
  'navigation_polygon', 'navigation_mesh', 'navpoly', 'enabled', 'navigation_layers',
  'enter_cost', 'travel_cost', 'use_edge_connections',
]);
export const NAVIGATION_LINK_PROPERTIES: ReadonlySet<string> = new Set([
  'enabled', 'bidirectional', 'navigation_layers', 'start_position', 'end_position', 'enter_cost', 'travel_cost',
]);
export const NAVIGATION_OBSTACLE_PROPERTIES: ReadonlySet<string> = new Set([
  'radius', 'height', 'velocity', 'vertices', 'avoidance_layers', 'avoidance_enabled', 'use_3d_avoidance', 'affect_navigation_mesh', 'carve_navigation_mesh',
]);
