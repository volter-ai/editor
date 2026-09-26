/** Vector2 spelling of the native Recast navigation server. Handles remain the native objects. */
import {
  createGodotNavigationServer2DMap,
  NavigationServer,
  type GodotNavigationAgent,
  type GodotNavigationLinkHandle,
  type GodotNavigationMap,
  type GodotNavigationObstacleHandle,
  type GodotNavigationRegionHandle,
} from './navigation';
import {
  bakeGodotNavigationPolygon,
  bakeGodotNavigationPolygonAsync,
  parseGodotNavigationSourceGeometry,
  isGodotNavigationPolygonBaking,
  type GodotNavigationGeometrySupply,
  type GodotNavigationGeometryCallback,
  type GodotNavigationMeshSourceGeometryData2D,
  type GodotNavigationPolygon,
  isGodotNavigationPolygon,
} from './navigation-polygon';
import type { GodotTransform2D } from './transform-2d';

export interface NavigationServerVector2 { readonly x: number; readonly y: number }
interface NativeVector3 { readonly x: number; readonly y: number; readonly z: number }
const native = (value: NavigationServerVector2): NativeVector3 => ({ x: value.x, y: 0, z: value.y });
const vector2 = (value: NativeVector3): NavigationServerVector2 => ({ x: value.x, y: value.z });

function nativeTransform(value: GodotTransform2D): readonly number[] {
  return [
    value.x.x, 0, value.x.y, 0,
    0, 1, 0, 0,
    value.y.x, 0, value.y.y, 0,
    value.origin.x, 0, value.origin.y, 1,
  ];
}

function transform2D(value: readonly number[]): GodotTransform2D {
  if (value.length !== 16) {
    throw new Error('NavigationServer2D.region_get_transform requires a retained Transform2D carrier.');
  }
  return {
    x: { x: value[0] ?? 1, y: value[2] ?? 0 },
    y: { x: value[8] ?? 0, y: value[10] ?? 1 },
    origin: { x: value[12] ?? 0, y: value[14] ?? 0 },
  };
}

function regionPolygon(
  region: GodotNavigationRegionHandle,
  member: string,
): GodotNavigationPolygon {
  if (!isGodotNavigationPolygon(region.navigationPolygon)) {
    throw new Error(`NavigationServer2D.${member} requires a retained NavigationPolygon region.`);
  }
  return region.navigationPolygon;
}

function regionPoint(
  region: GodotNavigationRegionHandle,
  point: NavigationServerVector2,
): NavigationServerVector2 {
  const matrix = region.transform;
  if (matrix.length !== 16) {
    throw new Error('NavigationServer2D region transform must be a column-major Transform3D carrier.');
  }
  return {
    x: (matrix[0] ?? 1) * point.x + (matrix[8] ?? 0) * point.y + (matrix[12] ?? 0),
    y: (matrix[2] ?? 0) * point.x + (matrix[10] ?? 1) * point.y + (matrix[14] ?? 0),
  };
}

function regionPolygons(
  region: GodotNavigationRegionHandle,
  member: string,
): readonly (readonly NavigationServerVector2[])[] {
  const polygon = regionPolygon(region, member);
  const vertices = polygon.get_vertices().map((point) => regionPoint(region, point));
  return polygon.get_polygons().map((indices, polygonIndex) => indices.map((index) => {
    const point = vertices[index];
    if (point === undefined) {
      throw new RangeError(
        `NavigationServer2D.${member} polygon ${polygonIndex} references missing vertex ${index}.`,
      );
    }
    return point;
  }));
}

function closestOnSegment(
  point: NavigationServerVector2,
  start: NavigationServerVector2,
  end: NavigationServerVector2,
): NavigationServerVector2 {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  return { x: start.x + dx * t, y: start.y + dy * t };
}

function pointOnSegment(
  point: NavigationServerVector2,
  start: NavigationServerVector2,
  end: NavigationServerVector2,
): boolean {
  const closest = closestOnSegment(point, start, end);
  const scale = Math.max(1, Math.abs(point.x), Math.abs(point.y), Math.abs(start.x), Math.abs(start.y), Math.abs(end.x), Math.abs(end.y));
  return Math.hypot(point.x - closest.x, point.y - closest.y) <= Number.EPSILON * scale * 16;
}

function polygonContains(
  polygon: readonly NavigationServerVector2[],
  point: NavigationServerVector2,
): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (pointOnSegment(point, start, end)) return true;
    if ((start.y > point.y) !== (end.y > point.y) &&
        point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x) {
      inside = !inside;
    }
  }
  return inside;
}

function regionOwnsPoint(
  region: GodotNavigationRegionHandle,
  point: NavigationServerVector2,
): boolean {
  return regionPolygons(region, 'region_owns_point').some((polygon) => polygonContains(polygon, point));
}

function regionClosestPoint(
  region: GodotNavigationRegionHandle,
  point: NavigationServerVector2,
): NavigationServerVector2 {
  const polygons = regionPolygons(region, 'region_get_closest_point');
  if (polygons.some((polygon) => polygonContains(polygon, point))) return { ...point };
  let closest: NavigationServerVector2 | undefined;
  let distanceSquared = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const candidate = closestOnSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!);
      const dx = candidate.x - point.x;
      const dy = candidate.y - point.y;
      const nextDistance = dx * dx + dy * dy;
      if (nextDistance < distanceSquared) {
        closest = candidate;
        distanceSquared = nextDistance;
      }
    }
  }
  if (closest === undefined) {
    throw new Error('NavigationServer2D.region_get_closest_point requires at least one polygon edge.');
  }
  return closest;
}

function regionBounds(region: GodotNavigationRegionHandle): {
  readonly position: NavigationServerVector2;
  readonly size: NavigationServerVector2;
} {
  const vertices = regionPolygon(region, 'region_get_bounds').get_vertices()
    .map((point) => regionPoint(region, point));
  if (vertices.length === 0) return { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } };
  let minX = vertices[0]!.x;
  let maxX = minX;
  let minY = vertices[0]!.y;
  let maxY = minY;
  for (const point of vertices.slice(1)) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { position: { x: minX, y: minY }, size: { x: maxX - minX, y: maxY - minY } };
}

export interface GodotNavigationSourceGeometryParserRid {
  readonly kind: 'NavigationSourceGeometryParser2D';
  release(): void;
}
const geometryParsers = new Map<GodotNavigationSourceGeometryParserRid, GodotNavigationGeometryCallback>();
function invokeGeometryParser(callback: GodotNavigationGeometryCallback, polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D, node: unknown): void {
  if (typeof callback === 'function') callback(polygon, source, node);
  else callback.call(polygon, source, node);
}
function createSourceGeometryParser(): GodotNavigationSourceGeometryParserRid {
  const parser: GodotNavigationSourceGeometryParserRid = {
    kind: 'NavigationSourceGeometryParser2D',
    release: () => { geometryParsers.delete(parser); },
  };
  geometryParsers.set(parser, { call: () => undefined });
  return parser;
}
function setSourceGeometryParserCallback(parser: GodotNavigationSourceGeometryParserRid, callback: GodotNavigationGeometryCallback): void {
  if (!geometryParsers.has(parser)) throw new Error('NavigationServer2D.source_geometry_parser_set_callback received a freed or foreign parser RID.');
  geometryParsers.set(parser, callback);
}

export const NavigationServer2D = {
  ...NavigationServer,
  map_create: createGodotNavigationServer2DMap,
  map_get_path: (
    map: GodotNavigationMap,
    from: NavigationServerVector2,
    to: NavigationServerVector2,
    optimize = true,
    navigationLayers = 1,
  ) => NavigationServer.map_get_path(map, native(from), native(to), optimize, navigationLayers).map(vector2),
  map_get_closest_point: (map: GodotNavigationMap, point: NavigationServerVector2) => vector2(map.getClosestPoint(native(point))),
  map_get_random_point: (map: GodotNavigationMap, navigationLayers = 1, uniformly = false) =>
    vector2(NavigationServer.map_get_random_point(map, navigationLayers, uniformly)),
  region_get_iteration_id: (region: GodotNavigationRegionHandle) => NavigationServer.region_get_iteration_id(region),
  region_owns_point: regionOwnsPoint,
  region_set_transform: (region: GodotNavigationRegionHandle, value: GodotTransform2D) =>
    NavigationServer.region_set_transform(region, nativeTransform(value)),
  region_get_transform: (region: GodotNavigationRegionHandle) => transform2D(NavigationServer.region_get_transform(region)),
  region_set_navigation_polygon: (region: GodotNavigationRegionHandle, value: GodotNavigationPolygon | null) => {
    if (value !== null && !isGodotNavigationPolygon(value)) {
      throw new TypeError('NavigationServer2D.region_set_navigation_polygon requires NavigationPolygon or null.');
    }
    NavigationServer.region_set_navigation_polygon(region, value);
  },
  region_get_closest_point: regionClosestPoint,
  region_get_bounds: regionBounds,
  link_get_iteration_id: (link: GodotNavigationLinkHandle) => NavigationServer.link_get_iteration_id(link),
  link_set_start_position: (link: GodotNavigationLinkHandle, value: NavigationServerVector2) => NavigationServer.link_set_start_position(link, native(value)),
  link_get_start_position: (link: GodotNavigationLinkHandle) => vector2(NavigationServer.link_get_start_position(link)),
  link_set_end_position: (link: GodotNavigationLinkHandle, value: NavigationServerVector2) => NavigationServer.link_set_end_position(link, native(value)),
  link_get_end_position: (link: GodotNavigationLinkHandle) => vector2(NavigationServer.link_get_end_position(link)),
  agent_set_velocity_forced: (agent: GodotNavigationAgent, value: NavigationServerVector2) => NavigationServer.agent_set_velocity_forced(agent, native(value)),
  agent_set_velocity: (agent: GodotNavigationAgent, value: NavigationServerVector2) => NavigationServer.agent_set_velocity(agent, native(value)),
  agent_get_velocity: (agent: GodotNavigationAgent) => vector2(NavigationServer.agent_get_velocity(agent)),
  agent_set_position: (agent: GodotNavigationAgent, value: NavigationServerVector2) => NavigationServer.agent_set_position(agent, native(value)),
  agent_get_position: (agent: GodotNavigationAgent) => vector2(NavigationServer.agent_get_position(agent)),
  obstacle_set_velocity: (obstacle: GodotNavigationObstacleHandle, value: NavigationServerVector2) => NavigationServer.obstacle_set_velocity(obstacle, native(value)),
  obstacle_get_velocity: (obstacle: GodotNavigationObstacleHandle) => vector2(NavigationServer.obstacle_get_velocity(obstacle)),
  obstacle_set_position: (obstacle: GodotNavigationObstacleHandle, value: NavigationServerVector2) => NavigationServer.obstacle_set_position(obstacle, native(value)),
  obstacle_get_position: (obstacle: GodotNavigationObstacleHandle) => vector2(NavigationServer.obstacle_get_position(obstacle)),
  obstacle_set_vertices: (obstacle: GodotNavigationObstacleHandle, value: readonly NavigationServerVector2[]) => NavigationServer.obstacle_set_vertices(obstacle, value.map(native)),
  obstacle_get_vertices: (obstacle: GodotNavigationObstacleHandle) => NavigationServer.obstacle_get_vertices(obstacle).map(vector2),
  simplify_path: (path: readonly NavigationServerVector2[], epsilon: number) => NavigationServer.simplify_path(path.map(native), epsilon).map(vector2),
  parse_source_geometry_data: (polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D, rootNode: unknown, callback?: GodotNavigationGeometryCallback, supply?: GodotNavigationGeometrySupply) => parseGodotNavigationSourceGeometry(polygon, source, rootNode, callback, supply, (node) => { for (const parserCallback of [...geometryParsers.values()]) invokeGeometryParser(parserCallback, polygon, source, node); }),
  bake_from_source_geometry_data: (polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D, callback?: GodotNavigationGeometryCallback, supply?: GodotNavigationGeometrySupply) => bakeGodotNavigationPolygon(polygon, source, callback, supply),
  bake_from_source_geometry_data_async: (polygon: GodotNavigationPolygon, source: GodotNavigationMeshSourceGeometryData2D, callback?: GodotNavigationGeometryCallback, supply?: GodotNavigationGeometrySupply) => bakeGodotNavigationPolygonAsync(polygon, source, callback, supply),
  is_baking_navigation_polygon: (polygon: GodotNavigationPolygon) => isGodotNavigationPolygonBaking(polygon),
  source_geometry_parser_create: createSourceGeometryParser,
  source_geometry_parser_set_callback: setSourceGeometryParserCallback,
};
