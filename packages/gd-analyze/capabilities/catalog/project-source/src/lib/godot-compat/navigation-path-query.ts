/** Godot 4 navigation path query Resources over the retained native Recast map. */

import type { GodotNavigationMap } from './navigation';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface NavigationPathPoint2D { readonly x: number; readonly y: number }
export interface NavigationPathPoint3D { readonly x: number; readonly y: number; readonly z: number }

export interface GodotNavigationPathQueryParameters<V> {
  map: GodotNavigationMap | null;
  start_position: V;
  target_position: V;
  navigation_layers: number;
  pathfinding_algorithm: number;
  path_postprocessing: number;
  metadata_flags: number;
  simplify_path: boolean;
  simplify_epsilon: number;
  path_return_max_length: number;
  path_return_max_radius: number;
  path_search_max_polygons: number;
  path_search_max_distance: number;
  set_map(value: GodotNavigationMap | null): void;
  get_map(): GodotNavigationMap | null;
  set_start_position(value: V): void;
  get_start_position(): V;
  set_target_position(value: V): void;
  get_target_position(): V;
  set_navigation_layers(value: number): void;
  get_navigation_layers(): number;
  set_pathfinding_algorithm(value: number): void;
  get_pathfinding_algorithm(): number;
  set_path_postprocessing(value: number): void;
  get_path_postprocessing(): number;
  set_metadata_flags(value: number): void;
  get_metadata_flags(): number;
  set_simplify_path(value: boolean): void;
  get_simplify_path(): boolean;
  set_simplify_epsilon(value: number): void;
  get_simplify_epsilon(): number;
  set_path_return_max_length(value: number): void;
  get_path_return_max_length(): number;
  set_path_return_max_radius(value: number): void;
  get_path_return_max_radius(): number;
  set_path_search_max_polygons(value: number): void;
  get_path_search_max_polygons(): number;
  set_path_search_max_distance(value: number): void;
  get_path_search_max_distance(): number;
}

export interface GodotNavigationPathQueryResult<V> {
  path: V[];
  path_types: number[];
  path_rids: unknown[];
  path_owner_ids: number[];
  set_path(value: readonly V[]): void;
  get_path(): readonly V[];
  set_path_types(value: readonly number[]): void;
  get_path_types(): readonly number[];
  set_path_rids(value: readonly unknown[]): void;
  get_path_rids(): readonly unknown[];
  set_path_owner_ids(value: readonly number[]): void;
  get_path_owner_ids(): readonly number[];
}

const copy2 = (value: NavigationPathPoint2D): NavigationPathPoint2D => ({ x: value.x, y: value.y });
const copy3 = (value: NavigationPathPoint3D): NavigationPathPoint3D => ({ x: value.x, y: value.y, z: value.z });

function parameters<V>(zero: V, copy: (value: V) => V, godotClass: string): GodotNavigationPathQueryParameters<V> {
  const value = {
    map: null,
    start_position: copy(zero),
    target_position: copy(zero),
    navigation_layers: 1,
    pathfinding_algorithm: 0,
    path_postprocessing: 0,
    metadata_flags: 7,
    simplify_path: false,
    simplify_epsilon: 0,
    path_return_max_length: 0,
    path_return_max_radius: 0,
    path_search_max_polygons: 4096,
    path_search_max_distance: 0,
  } as unknown as GodotNavigationPathQueryParameters<V>;
  for (const property of [
    'map', 'start_position', 'target_position', 'navigation_layers', 'pathfinding_algorithm',
    'path_postprocessing', 'metadata_flags', 'simplify_path', 'simplify_epsilon',
    'path_return_max_length', 'path_return_max_radius', 'path_search_max_polygons',
    'path_search_max_distance',
  ] as const) {
    Object.defineProperty(value, `set_${property}`, {
      value: (next: unknown) => {
        if (Object.is(Reflect.get(value, property), next)) return;
        Reflect.set(value, property, next);
        godotResourceEmitChanged(value);
      },
      enumerable: false,
    });
    Object.defineProperty(value, `get_${property}`, {
      value: () => Reflect.get(value, property), enumerable: false,
    });
  }
  registerGodotObjectIdentity(value, godotClass);
  bindGodotResourceProtocol(value, {
    createDuplicate(source) {
      const duplicate = parameters(zero, copy, godotClass);
      for (const property of [
        'map', 'start_position', 'target_position', 'navigation_layers', 'pathfinding_algorithm',
        'path_postprocessing', 'metadata_flags', 'simplify_path', 'simplify_epsilon',
        'path_return_max_length', 'path_return_max_radius', 'path_search_max_polygons',
        'path_search_max_distance',
      ] as const) {
        const current = Reflect.get(source, property);
        Reflect.set(duplicate, property,
          property === 'start_position' || property === 'target_position' ? copy(current as V) : current);
      }
      return duplicate;
    },
  });
  return value;
}

function result<V>(copy: (value: V) => V, godotClass: string): GodotNavigationPathQueryResult<V> {
  const value: GodotNavigationPathQueryResult<V> = {
    path: [], path_types: [], path_rids: [], path_owner_ids: [],
    set_path(next) { this.path = next.map(copy); godotResourceEmitChanged(this); },
    get_path() { return this.path.map(copy); },
    set_path_types(next) { this.path_types = [...next]; godotResourceEmitChanged(this); },
    get_path_types() { return [...this.path_types]; },
    set_path_rids(next) { this.path_rids = [...next]; godotResourceEmitChanged(this); },
    get_path_rids() { return [...this.path_rids]; },
    set_path_owner_ids(next) { this.path_owner_ids = [...next]; godotResourceEmitChanged(this); },
    get_path_owner_ids() { return [...this.path_owner_ids]; },
  };
  registerGodotObjectIdentity(value, godotClass);
  bindGodotResourceProtocol(value, {
    createDuplicate(source) {
      const duplicate = result(copy, godotClass);
      duplicate.set_path(source.path);
      duplicate.set_path_types(source.path_types);
      duplicate.set_path_rids(source.path_rids);
      duplicate.set_path_owner_ids(source.path_owner_ids);
      return duplicate;
    },
  });
  return value;
}

export const createGodotNavigationPathQueryParameters2D = () =>
  parameters<NavigationPathPoint2D>({ x: 0, y: 0 }, copy2, 'NavigationPathQueryParameters2D');
export const createGodotNavigationPathQueryParameters3D = () =>
  parameters<NavigationPathPoint3D>({ x: 0, y: 0, z: 0 }, copy3, 'NavigationPathQueryParameters3D');
export const createGodotNavigationPathQueryResult2D = () =>
  result<NavigationPathPoint2D>(copy2, 'NavigationPathQueryResult2D');
export const createGodotNavigationPathQueryResult3D = () =>
  result<NavigationPathPoint3D>(copy3, 'NavigationPathQueryResult3D');

function validateQuery<V>(query: GodotNavigationPathQueryParameters<V>): GodotNavigationMap {
  if (query.map === null) throw new Error('Navigation path query requires a map RID.');
  if (query.navigation_layers !== 1) throw new Error('Navigation path query layers other than layer 1 require source-triangle area provenance that the native Recast generator does not expose.');
  if (query.pathfinding_algorithm !== 0 || query.path_postprocessing !== 0) {
    throw new Error('Navigation path query supports only Godot PATHFINDING_ALGORITHM_ASTAR with CORRIDORFUNNEL postprocessing.');
  }
  if ((query.metadata_flags & ~1) !== 0) {
    throw new Error('Navigation path query RID/owner metadata requires native Detour polygon ownership handles. Set metadata_flags to 0 or PATH_METADATA_INCLUDE_TYPES.');
  }
  if (query.simplify_path || query.path_return_max_length !== 0 || query.path_return_max_radius !== 0 || query.path_search_max_distance !== 0 || query.path_search_max_polygons !== 4096) {
    throw new Error('Navigation path query requested bounds/simplification the native Recast query does not expose exactly.');
  }
  return query.map;
}

export function queryGodotNavigationPath3D(
  query: GodotNavigationPathQueryParameters<NavigationPathPoint3D>,
  output: GodotNavigationPathQueryResult<NavigationPathPoint3D>,
): void {
  const map = validateQuery(query);
  output.set_path(map.getPath(query.start_position, query.target_position));
  output.set_path_types(query.metadata_flags === 0 ? [] : output.path.map(() => 0));
  output.set_path_rids([]);
  output.set_path_owner_ids([]);
}

export function queryGodotNavigationPath2D(
  query: GodotNavigationPathQueryParameters<NavigationPathPoint2D>,
  output: GodotNavigationPathQueryResult<NavigationPathPoint2D>,
): void {
  const map = validateQuery(query);
  output.set_path(map.getPath(
    { x: query.start_position.x, y: 0, z: query.start_position.y },
    { x: query.target_position.x, y: 0, z: query.target_position.y },
  ).map((point) => ({ x: point.x, y: point.z })));
  output.set_path_types(query.metadata_flags === 0 ? [] : output.path.map(() => 0));
  output.set_path_rids([]);
  output.set_path_owner_ids([]);
}
