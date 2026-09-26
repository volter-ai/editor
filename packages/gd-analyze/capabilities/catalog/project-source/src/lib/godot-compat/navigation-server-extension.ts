import { registerGodotObjectIdentity } from './object';

export type GodotNavigationRID = object;
export interface GodotNavigationVector2 { readonly x: number; readonly y: number }
export interface GodotNavigationVector3 { readonly x: number; readonly y: number; readonly z: number }
export type GodotNavigationServerExtensionHooks = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

class GodotNavigationServerExtensionBase {
  constructor(protected readonly hooks: GodotNavigationServerExtensionHooks, godotClass: string) {
    registerGodotObjectIdentity(this, godotClass);
  }
  protected call(name: string, ...args: readonly unknown[]): unknown {
    const hook = this.hooks[name];
    if (hook === undefined) throw new Error(`${name} is not implemented by this navigation server extension.`);
    return hook(...args);
  }
  protected rid(name: string, ...args: readonly unknown[]): GodotNavigationRID {
    const value = this.call(name, ...args);
    if (value === null || typeof value !== 'object') throw new TypeError(`${name} must return RID.`);
    return value;
  }
  protected number(name: string, ...args: readonly unknown[]): number {
    const value = this.call(name, ...args);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must return finite number.`);
    return value;
  }
  protected boolean(name: string, ...args: readonly unknown[]): boolean { return Boolean(this.call(name, ...args)); }
  protected array<T>(name: string, ...args: readonly unknown[]): T[] {
    const value = this.call(name, ...args);
    if (!Array.isArray(value)) throw new TypeError(`${name} must return Array.`);
    return value as T[];
  }
}

export class GodotNavigationServer3DExtension extends GodotNavigationServerExtensionBase {
  constructor(hooks: GodotNavigationServerExtensionHooks) { super(hooks, 'NavigationServer3DExtension'); }
  _map_create(): GodotNavigationRID { return this.rid('_map_create'); }
  _map_set_active(map: GodotNavigationRID, active: boolean): void { this.call('_map_set_active', map, active); }
  _map_is_active(map: GodotNavigationRID): boolean { return this.boolean('_map_is_active', map); }
  _map_set_up(map: GodotNavigationRID, up: GodotNavigationVector3): void { this.call('_map_set_up', map, up); }
  _map_get_up(map: GodotNavigationRID): GodotNavigationVector3 { return this.call('_map_get_up', map) as GodotNavigationVector3; }
  _map_set_cell_size(map: GodotNavigationRID, value: number): void { this.call('_map_set_cell_size', map, value); }
  _map_get_cell_size(map: GodotNavigationRID): number { return this.number('_map_get_cell_size', map); }
  _map_set_cell_height(map: GodotNavigationRID, value: number): void { this.call('_map_set_cell_height', map, value); }
  _map_get_cell_height(map: GodotNavigationRID): number { return this.number('_map_get_cell_height', map); }
  _map_set_merge_rasterizer_cell_scale(map: GodotNavigationRID, value: number): void { this.call('_map_set_merge_rasterizer_cell_scale', map, value); }
  _map_get_merge_rasterizer_cell_scale(map: GodotNavigationRID): number { return this.number('_map_get_merge_rasterizer_cell_scale', map); }
  _map_set_use_edge_connections(map: GodotNavigationRID, enabled: boolean): void { this.call('_map_set_use_edge_connections', map, enabled); }
  _map_get_use_edge_connections(map: GodotNavigationRID): boolean { return this.boolean('_map_get_use_edge_connections', map); }
  _map_set_edge_connection_margin(map: GodotNavigationRID, value: number): void { this.call('_map_set_edge_connection_margin', map, value); }
  _map_get_edge_connection_margin(map: GodotNavigationRID): number { return this.number('_map_get_edge_connection_margin', map); }
  _map_set_link_connection_radius(map: GodotNavigationRID, value: number): void { this.call('_map_set_link_connection_radius', map, value); }
  _map_get_link_connection_radius(map: GodotNavigationRID): number { return this.number('_map_get_link_connection_radius', map); }
  _map_get_path(map: GodotNavigationRID, origin: GodotNavigationVector3, destination: GodotNavigationVector3, optimize: boolean, layers = 1): GodotNavigationVector3[] { return this.array('_map_get_path', map, origin, destination, optimize, layers); }
  _map_get_closest_point_to_segment(map: GodotNavigationRID, start: GodotNavigationVector3, end: GodotNavigationVector3, useCollision = false): GodotNavigationVector3 { return this.call('_map_get_closest_point_to_segment', map, start, end, useCollision) as GodotNavigationVector3; }
  _map_get_closest_point(map: GodotNavigationRID, point: GodotNavigationVector3): GodotNavigationVector3 { return this.call('_map_get_closest_point', map, point) as GodotNavigationVector3; }
  _map_get_closest_point_normal(map: GodotNavigationRID, point: GodotNavigationVector3): GodotNavigationVector3 { return this.call('_map_get_closest_point_normal', map, point) as GodotNavigationVector3; }
  _map_get_closest_point_owner(map: GodotNavigationRID, point: GodotNavigationVector3): GodotNavigationRID { return this.rid('_map_get_closest_point_owner', map, point); }
  _map_get_links(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_links', map); }
  _map_get_regions(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_regions', map); }
  _map_get_agents(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_agents', map); }
  _map_get_obstacles(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_obstacles', map); }
  _map_force_update(map: GodotNavigationRID): void { this.call('_map_force_update', map); }
  _map_get_iteration_id(map: GodotNavigationRID): number { return this.number('_map_get_iteration_id', map); }
  _map_set_use_async_iterations(map: GodotNavigationRID, enabled: boolean): void { this.call('_map_set_use_async_iterations', map, enabled); }
  _map_get_use_async_iterations(map: GodotNavigationRID): boolean { return this.boolean('_map_get_use_async_iterations', map); }

  _region_create(): GodotNavigationRID { return this.rid('_region_create'); }
  _region_set_enabled(region: GodotNavigationRID, enabled: boolean): void { this.call('_region_set_enabled', region, enabled); }
  _region_get_enabled(region: GodotNavigationRID): boolean { return this.boolean('_region_get_enabled', region); }
  _region_set_use_edge_connections(region: GodotNavigationRID, enabled: boolean): void { this.call('_region_set_use_edge_connections', region, enabled); }
  _region_get_use_edge_connections(region: GodotNavigationRID): boolean { return this.boolean('_region_get_use_edge_connections', region); }
  _region_set_enter_cost(region: GodotNavigationRID, value: number): void { this.call('_region_set_enter_cost', region, value); }
  _region_get_enter_cost(region: GodotNavigationRID): number { return this.number('_region_get_enter_cost', region); }
  _region_set_travel_cost(region: GodotNavigationRID, value: number): void { this.call('_region_set_travel_cost', region, value); }
  _region_get_travel_cost(region: GodotNavigationRID): number { return this.number('_region_get_travel_cost', region); }
  _region_set_owner_id(region: GodotNavigationRID, ownerId: number): void { this.call('_region_set_owner_id', region, ownerId); }
  _region_get_owner_id(region: GodotNavigationRID): number { return this.number('_region_get_owner_id', region); }
  _region_owns_point(region: GodotNavigationRID, point: GodotNavigationVector3): boolean { return this.boolean('_region_owns_point', region, point); }
  _region_set_map(region: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_region_set_map', region, map); }
  _region_get_map(region: GodotNavigationRID): GodotNavigationRID { return this.rid('_region_get_map', region); }
  _region_set_navigation_layers(region: GodotNavigationRID, layers: number): void { this.call('_region_set_navigation_layers', region, layers); }
  _region_get_navigation_layers(region: GodotNavigationRID): number { return this.number('_region_get_navigation_layers', region); }
  _region_set_transform(region: GodotNavigationRID, transform: unknown): void { this.call('_region_set_transform', region, transform); }
  _region_set_navigation_mesh(region: GodotNavigationRID, mesh: unknown): void { this.call('_region_set_navigation_mesh', region, mesh); }
  _region_bake_navigation_mesh(mesh: unknown, rootNode: unknown): void { this.call('_region_bake_navigation_mesh', mesh, rootNode); }
  _region_get_connections_count(region: GodotNavigationRID): number { return this.number('_region_get_connections_count', region); }
  _region_get_connection_pathway_start(region: GodotNavigationRID, connection: number): GodotNavigationVector3 { return this.call('_region_get_connection_pathway_start', region, connection) as GodotNavigationVector3; }
  _region_get_connection_pathway_end(region: GodotNavigationRID, connection: number): GodotNavigationVector3 { return this.call('_region_get_connection_pathway_end', region, connection) as GodotNavigationVector3; }
  _region_get_closest_point(region: GodotNavigationRID, point: GodotNavigationVector3): GodotNavigationVector3 { return this.call('_region_get_closest_point', region, point) as GodotNavigationVector3; }
  _region_get_random_point(region: GodotNavigationRID, layers: number, uniformly: boolean): GodotNavigationVector3 { return this.call('_region_get_random_point', region, layers, uniformly) as GodotNavigationVector3; }

  _link_create(): GodotNavigationRID { return this.rid('_link_create'); }
  _link_set_map(link: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_link_set_map', link, map); }
  _link_get_map(link: GodotNavigationRID): GodotNavigationRID { return this.rid('_link_get_map', link); }
  _link_set_enabled(link: GodotNavigationRID, enabled: boolean): void { this.call('_link_set_enabled', link, enabled); }
  _link_get_enabled(link: GodotNavigationRID): boolean { return this.boolean('_link_get_enabled', link); }
  _link_set_bidirectional(link: GodotNavigationRID, enabled: boolean): void { this.call('_link_set_bidirectional', link, enabled); }
  _link_is_bidirectional(link: GodotNavigationRID): boolean { return this.boolean('_link_is_bidirectional', link); }
  _link_set_navigation_layers(link: GodotNavigationRID, layers: number): void { this.call('_link_set_navigation_layers', link, layers); }
  _link_get_navigation_layers(link: GodotNavigationRID): number { return this.number('_link_get_navigation_layers', link); }
  _link_set_start_position(link: GodotNavigationRID, position: GodotNavigationVector3): void { this.call('_link_set_start_position', link, position); }
  _link_get_start_position(link: GodotNavigationRID): GodotNavigationVector3 { return this.call('_link_get_start_position', link) as GodotNavigationVector3; }
  _link_set_end_position(link: GodotNavigationRID, position: GodotNavigationVector3): void { this.call('_link_set_end_position', link, position); }
  _link_get_end_position(link: GodotNavigationRID): GodotNavigationVector3 { return this.call('_link_get_end_position', link) as GodotNavigationVector3; }
  _link_set_enter_cost(link: GodotNavigationRID, value: number): void { this.call('_link_set_enter_cost', link, value); }
  _link_get_enter_cost(link: GodotNavigationRID): number { return this.number('_link_get_enter_cost', link); }
  _link_set_travel_cost(link: GodotNavigationRID, value: number): void { this.call('_link_set_travel_cost', link, value); }
  _link_get_travel_cost(link: GodotNavigationRID): number { return this.number('_link_get_travel_cost', link); }
  _link_set_owner_id(link: GodotNavigationRID, ownerId: number): void { this.call('_link_set_owner_id', link, ownerId); }
  _link_get_owner_id(link: GodotNavigationRID): number { return this.number('_link_get_owner_id', link); }

  _agent_create(): GodotNavigationRID { return this.rid('_agent_create'); }
  _agent_set_map(agent: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_agent_set_map', agent, map); }
  _agent_get_map(agent: GodotNavigationRID): GodotNavigationRID { return this.rid('_agent_get_map', agent); }
  _agent_set_paused(agent: GodotNavigationRID, paused: boolean): void { this.call('_agent_set_paused', agent, paused); }
  _agent_get_paused(agent: GodotNavigationRID): boolean { return this.boolean('_agent_get_paused', agent); }
  _agent_set_avoidance_enabled(agent: GodotNavigationRID, enabled: boolean): void { this.call('_agent_set_avoidance_enabled', agent, enabled); }
  _agent_get_avoidance_enabled(agent: GodotNavigationRID): boolean { return this.boolean('_agent_get_avoidance_enabled', agent); }
  _agent_set_neighbor_distance(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_neighbor_distance', agent, value); }
  _agent_get_neighbor_distance(agent: GodotNavigationRID): number { return this.number('_agent_get_neighbor_distance', agent); }
  _agent_set_max_neighbors(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_max_neighbors', agent, value); }
  _agent_get_max_neighbors(agent: GodotNavigationRID): number { return this.number('_agent_get_max_neighbors', agent); }
  _agent_set_time_horizon_agents(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_time_horizon_agents', agent, value); }
  _agent_get_time_horizon_agents(agent: GodotNavigationRID): number { return this.number('_agent_get_time_horizon_agents', agent); }
  _agent_set_time_horizon_obstacles(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_time_horizon_obstacles', agent, value); }
  _agent_get_time_horizon_obstacles(agent: GodotNavigationRID): number { return this.number('_agent_get_time_horizon_obstacles', agent); }
  _agent_set_radius(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_radius', agent, value); }
  _agent_get_radius(agent: GodotNavigationRID): number { return this.number('_agent_get_radius', agent); }
  _agent_set_height(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_height', agent, value); }
  _agent_get_height(agent: GodotNavigationRID): number { return this.number('_agent_get_height', agent); }
  _agent_set_max_speed(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_max_speed', agent, value); }
  _agent_get_max_speed(agent: GodotNavigationRID): number { return this.number('_agent_get_max_speed', agent); }
  _agent_set_velocity(agent: GodotNavigationRID, velocity: GodotNavigationVector3): void { this.call('_agent_set_velocity', agent, velocity); }
  _agent_set_velocity_forced(agent: GodotNavigationRID, velocity: GodotNavigationVector3): void { this.call('_agent_set_velocity_forced', agent, velocity); }
  _agent_get_velocity(agent: GodotNavigationRID): GodotNavigationVector3 { return this.call('_agent_get_velocity', agent) as GodotNavigationVector3; }
  _agent_set_position(agent: GodotNavigationRID, position: GodotNavigationVector3): void { this.call('_agent_set_position', agent, position); }
  _agent_get_position(agent: GodotNavigationRID): GodotNavigationVector3 { return this.call('_agent_get_position', agent) as GodotNavigationVector3; }
  _agent_is_map_changed(agent: GodotNavigationRID): boolean { return this.boolean('_agent_is_map_changed', agent); }
  _agent_set_avoidance_callback(agent: GodotNavigationRID, callback: ((velocity: GodotNavigationVector3) => void) | null): void { this.call('_agent_set_avoidance_callback', agent, callback); }
  _agent_set_avoidance_layers(agent: GodotNavigationRID, layers: number): void { this.call('_agent_set_avoidance_layers', agent, layers); }
  _agent_get_avoidance_layers(agent: GodotNavigationRID): number { return this.number('_agent_get_avoidance_layers', agent); }
  _agent_set_avoidance_mask(agent: GodotNavigationRID, mask: number): void { this.call('_agent_set_avoidance_mask', agent, mask); }
  _agent_get_avoidance_mask(agent: GodotNavigationRID): number { return this.number('_agent_get_avoidance_mask', agent); }
  _agent_set_avoidance_priority(agent: GodotNavigationRID, priority: number): void { this.call('_agent_set_avoidance_priority', agent, priority); }
  _agent_get_avoidance_priority(agent: GodotNavigationRID): number { return this.number('_agent_get_avoidance_priority', agent); }
  _agent_set_use_3d_avoidance(agent: GodotNavigationRID, enabled: boolean): void { this.call('_agent_set_use_3d_avoidance', agent, enabled); }
  _agent_get_use_3d_avoidance(agent: GodotNavigationRID): boolean { return this.boolean('_agent_get_use_3d_avoidance', agent); }

  _obstacle_create(): GodotNavigationRID { return this.rid('_obstacle_create'); }
  _obstacle_set_map(obstacle: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_obstacle_set_map', obstacle, map); }
  _obstacle_get_map(obstacle: GodotNavigationRID): GodotNavigationRID { return this.rid('_obstacle_get_map', obstacle); }
  _obstacle_set_paused(obstacle: GodotNavigationRID, paused: boolean): void { this.call('_obstacle_set_paused', obstacle, paused); }
  _obstacle_get_paused(obstacle: GodotNavigationRID): boolean { return this.boolean('_obstacle_get_paused', obstacle); }
  _obstacle_set_avoidance_enabled(obstacle: GodotNavigationRID, enabled: boolean): void { this.call('_obstacle_set_avoidance_enabled', obstacle, enabled); }
  _obstacle_get_avoidance_enabled(obstacle: GodotNavigationRID): boolean { return this.boolean('_obstacle_get_avoidance_enabled', obstacle); }
  _obstacle_set_radius(obstacle: GodotNavigationRID, radius: number): void { this.call('_obstacle_set_radius', obstacle, radius); }
  _obstacle_get_radius(obstacle: GodotNavigationRID): number { return this.number('_obstacle_get_radius', obstacle); }
  _obstacle_set_height(obstacle: GodotNavigationRID, height: number): void { this.call('_obstacle_set_height', obstacle, height); }
  _obstacle_get_height(obstacle: GodotNavigationRID): number { return this.number('_obstacle_get_height', obstacle); }
  _obstacle_set_velocity(obstacle: GodotNavigationRID, velocity: GodotNavigationVector3): void { this.call('_obstacle_set_velocity', obstacle, velocity); }
  _obstacle_get_velocity(obstacle: GodotNavigationRID): GodotNavigationVector3 { return this.call('_obstacle_get_velocity', obstacle) as GodotNavigationVector3; }
  _obstacle_set_position(obstacle: GodotNavigationRID, position: GodotNavigationVector3): void { this.call('_obstacle_set_position', obstacle, position); }
  _obstacle_get_position(obstacle: GodotNavigationRID): GodotNavigationVector3 { return this.call('_obstacle_get_position', obstacle) as GodotNavigationVector3; }
  _obstacle_set_vertices(obstacle: GodotNavigationRID, vertices: readonly GodotNavigationVector3[]): void { this.call('_obstacle_set_vertices', obstacle, vertices); }
  _obstacle_get_vertices(obstacle: GodotNavigationRID): GodotNavigationVector3[] { return this.array('_obstacle_get_vertices', obstacle); }
  _obstacle_set_avoidance_layers(obstacle: GodotNavigationRID, layers: number): void { this.call('_obstacle_set_avoidance_layers', obstacle, layers); }
  _obstacle_get_avoidance_layers(obstacle: GodotNavigationRID): number { return this.number('_obstacle_get_avoidance_layers', obstacle); }
  _obstacle_set_use_3d_avoidance(obstacle: GodotNavigationRID, enabled: boolean): void { this.call('_obstacle_set_use_3d_avoidance', obstacle, enabled); }
  _obstacle_get_use_3d_avoidance(obstacle: GodotNavigationRID): boolean { return this.boolean('_obstacle_get_use_3d_avoidance', obstacle); }

  _query_path(parameters: unknown, result: unknown, callback?: () => void): void { this.call('_query_path', parameters, result, callback); }
  _parse_source_geometry_data(mesh: unknown, source: unknown, root: unknown, callback?: () => void): void { this.call('_parse_source_geometry_data', mesh, source, root, callback); }
  _bake_from_source_geometry_data(mesh: unknown, source: unknown, callback?: () => void): void { this.call('_bake_from_source_geometry_data', mesh, source, callback); }
  _bake_from_source_geometry_data_async(mesh: unknown, source: unknown, callback?: () => void): void { this.call('_bake_from_source_geometry_data_async', mesh, source, callback); }
  _is_baking_navigation_mesh(mesh: unknown): boolean { return this.boolean('_is_baking_navigation_mesh', mesh); }
  _simplify_path(path: readonly GodotNavigationVector3[], epsilon: number): GodotNavigationVector3[] { return this.array('_simplify_path', path, epsilon); }
  _source_geometry_parser_create(): GodotNavigationRID { return this.rid('_source_geometry_parser_create'); }
  _source_geometry_parser_set_callback(parser: GodotNavigationRID, callback: ((mesh: unknown, source: unknown, node: unknown) => void) | null): void { this.call('_source_geometry_parser_set_callback', parser, callback); }
  _free_rid(rid: GodotNavigationRID): void { this.call('_free_rid', rid); }
  _set_active(active: boolean): void { this.call('_set_active', active); }
  _process(delta: number): void { this.call('_process', delta); }
  _sync(): void { this.call('_sync'); }
  _get_process_info(processInfo: number): number { return this.number('_get_process_info', processInfo); }
}

export class GodotNavigationServer2DExtension extends GodotNavigationServerExtensionBase {
  constructor(hooks: GodotNavigationServerExtensionHooks) { super(hooks, 'NavigationServer2DExtension'); }
  _map_create(): GodotNavigationRID { return this.rid('_map_create'); }
  _map_set_active(map: GodotNavigationRID, active: boolean): void { this.call('_map_set_active', map, active); }
  _map_is_active(map: GodotNavigationRID): boolean { return this.boolean('_map_is_active', map); }
  _map_set_cell_size(map: GodotNavigationRID, value: number): void { this.call('_map_set_cell_size', map, value); }
  _map_get_cell_size(map: GodotNavigationRID): number { return this.number('_map_get_cell_size', map); }
  _map_set_use_edge_connections(map: GodotNavigationRID, enabled: boolean): void { this.call('_map_set_use_edge_connections', map, enabled); }
  _map_get_use_edge_connections(map: GodotNavigationRID): boolean { return this.boolean('_map_get_use_edge_connections', map); }
  _map_set_edge_connection_margin(map: GodotNavigationRID, value: number): void { this.call('_map_set_edge_connection_margin', map, value); }
  _map_get_edge_connection_margin(map: GodotNavigationRID): number { return this.number('_map_get_edge_connection_margin', map); }
  _map_set_link_connection_radius(map: GodotNavigationRID, value: number): void { this.call('_map_set_link_connection_radius', map, value); }
  _map_get_link_connection_radius(map: GodotNavigationRID): number { return this.number('_map_get_link_connection_radius', map); }
  _map_get_path(map: GodotNavigationRID, origin: GodotNavigationVector2, destination: GodotNavigationVector2, optimize: boolean, layers = 1): GodotNavigationVector2[] { return this.array('_map_get_path', map, origin, destination, optimize, layers); }
  _map_get_closest_point(map: GodotNavigationRID, point: GodotNavigationVector2): GodotNavigationVector2 { return this.call('_map_get_closest_point', map, point) as GodotNavigationVector2; }
  _map_get_closest_point_owner(map: GodotNavigationRID, point: GodotNavigationVector2): GodotNavigationRID { return this.rid('_map_get_closest_point_owner', map, point); }
  _map_get_links(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_links', map); }
  _map_get_regions(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_regions', map); }
  _map_get_agents(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_agents', map); }
  _map_get_obstacles(map: GodotNavigationRID): GodotNavigationRID[] { return this.array('_map_get_obstacles', map); }
  _map_force_update(map: GodotNavigationRID): void { this.call('_map_force_update', map); }
  _map_get_iteration_id(map: GodotNavigationRID): number { return this.number('_map_get_iteration_id', map); }
  _map_set_use_async_iterations(map: GodotNavigationRID, enabled: boolean): void { this.call('_map_set_use_async_iterations', map, enabled); }
  _map_get_use_async_iterations(map: GodotNavigationRID): boolean { return this.boolean('_map_get_use_async_iterations', map); }
  _region_create(): GodotNavigationRID { return this.rid('_region_create'); }
  _region_set_enabled(region: GodotNavigationRID, enabled: boolean): void { this.call('_region_set_enabled', region, enabled); }
  _region_get_enabled(region: GodotNavigationRID): boolean { return this.boolean('_region_get_enabled', region); }
  _region_set_use_edge_connections(region: GodotNavigationRID, enabled: boolean): void { this.call('_region_set_use_edge_connections', region, enabled); }
  _region_get_use_edge_connections(region: GodotNavigationRID): boolean { return this.boolean('_region_get_use_edge_connections', region); }
  _region_set_enter_cost(region: GodotNavigationRID, value: number): void { this.call('_region_set_enter_cost', region, value); }
  _region_get_enter_cost(region: GodotNavigationRID): number { return this.number('_region_get_enter_cost', region); }
  _region_set_travel_cost(region: GodotNavigationRID, value: number): void { this.call('_region_set_travel_cost', region, value); }
  _region_get_travel_cost(region: GodotNavigationRID): number { return this.number('_region_get_travel_cost', region); }
  _region_set_owner_id(region: GodotNavigationRID, ownerId: number): void { this.call('_region_set_owner_id', region, ownerId); }
  _region_get_owner_id(region: GodotNavigationRID): number { return this.number('_region_get_owner_id', region); }
  _region_set_map(region: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_region_set_map', region, map); }
  _region_get_map(region: GodotNavigationRID): GodotNavigationRID { return this.rid('_region_get_map', region); }
  _region_set_navigation_layers(region: GodotNavigationRID, layers: number): void { this.call('_region_set_navigation_layers', region, layers); }
  _region_get_navigation_layers(region: GodotNavigationRID): number { return this.number('_region_get_navigation_layers', region); }
  _region_set_transform(region: GodotNavigationRID, transform: unknown): void { this.call('_region_set_transform', region, transform); }
  _region_set_navigation_polygon(region: GodotNavigationRID, polygon: unknown): void { this.call('_region_set_navigation_polygon', region, polygon); }
  _region_owns_point(region: GodotNavigationRID, point: GodotNavigationVector2): boolean { return this.boolean('_region_owns_point', region, point); }
  _region_get_connections_count(region: GodotNavigationRID): number { return this.number('_region_get_connections_count', region); }
  _region_get_connection_pathway_start(region: GodotNavigationRID, connection: number): GodotNavigationVector2 { return this.call('_region_get_connection_pathway_start', region, connection) as GodotNavigationVector2; }
  _region_get_connection_pathway_end(region: GodotNavigationRID, connection: number): GodotNavigationVector2 { return this.call('_region_get_connection_pathway_end', region, connection) as GodotNavigationVector2; }
  _region_get_closest_point(region: GodotNavigationRID, point: GodotNavigationVector2): GodotNavigationVector2 { return this.call('_region_get_closest_point', region, point) as GodotNavigationVector2; }
  _region_get_random_point(region: GodotNavigationRID, layers: number, uniformly: boolean): GodotNavigationVector2 { return this.call('_region_get_random_point', region, layers, uniformly) as GodotNavigationVector2; }
  _link_create(): GodotNavigationRID { return this.rid('_link_create'); }
  _link_set_map(link: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_link_set_map', link, map); }
  _link_get_map(link: GodotNavigationRID): GodotNavigationRID { return this.rid('_link_get_map', link); }
  _link_set_enabled(link: GodotNavigationRID, enabled: boolean): void { this.call('_link_set_enabled', link, enabled); }
  _link_get_enabled(link: GodotNavigationRID): boolean { return this.boolean('_link_get_enabled', link); }
  _link_set_bidirectional(link: GodotNavigationRID, enabled: boolean): void { this.call('_link_set_bidirectional', link, enabled); }
  _link_is_bidirectional(link: GodotNavigationRID): boolean { return this.boolean('_link_is_bidirectional', link); }
  _link_set_navigation_layers(link: GodotNavigationRID, layers: number): void { this.call('_link_set_navigation_layers', link, layers); }
  _link_get_navigation_layers(link: GodotNavigationRID): number { return this.number('_link_get_navigation_layers', link); }
  _link_set_start_position(link: GodotNavigationRID, position: GodotNavigationVector2): void { this.call('_link_set_start_position', link, position); }
  _link_get_start_position(link: GodotNavigationRID): GodotNavigationVector2 { return this.call('_link_get_start_position', link) as GodotNavigationVector2; }
  _link_set_end_position(link: GodotNavigationRID, position: GodotNavigationVector2): void { this.call('_link_set_end_position', link, position); }
  _link_get_end_position(link: GodotNavigationRID): GodotNavigationVector2 { return this.call('_link_get_end_position', link) as GodotNavigationVector2; }
  _link_set_enter_cost(link: GodotNavigationRID, value: number): void { this.call('_link_set_enter_cost', link, value); }
  _link_get_enter_cost(link: GodotNavigationRID): number { return this.number('_link_get_enter_cost', link); }
  _link_set_travel_cost(link: GodotNavigationRID, value: number): void { this.call('_link_set_travel_cost', link, value); }
  _link_get_travel_cost(link: GodotNavigationRID): number { return this.number('_link_get_travel_cost', link); }
  _link_set_owner_id(link: GodotNavigationRID, ownerId: number): void { this.call('_link_set_owner_id', link, ownerId); }
  _link_get_owner_id(link: GodotNavigationRID): number { return this.number('_link_get_owner_id', link); }
  _agent_create(): GodotNavigationRID { return this.rid('_agent_create'); }
  _agent_set_map(agent: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_agent_set_map', agent, map); }
  _agent_get_map(agent: GodotNavigationRID): GodotNavigationRID { return this.rid('_agent_get_map', agent); }
  _agent_set_paused(agent: GodotNavigationRID, paused: boolean): void { this.call('_agent_set_paused', agent, paused); }
  _agent_get_paused(agent: GodotNavigationRID): boolean { return this.boolean('_agent_get_paused', agent); }
  _agent_set_avoidance_enabled(agent: GodotNavigationRID, enabled: boolean): void { this.call('_agent_set_avoidance_enabled', agent, enabled); }
  _agent_get_avoidance_enabled(agent: GodotNavigationRID): boolean { return this.boolean('_agent_get_avoidance_enabled', agent); }
  _agent_set_neighbor_distance(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_neighbor_distance', agent, value); }
  _agent_get_neighbor_distance(agent: GodotNavigationRID): number { return this.number('_agent_get_neighbor_distance', agent); }
  _agent_set_max_neighbors(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_max_neighbors', agent, value); }
  _agent_get_max_neighbors(agent: GodotNavigationRID): number { return this.number('_agent_get_max_neighbors', agent); }
  _agent_set_time_horizon_agents(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_time_horizon_agents', agent, value); }
  _agent_get_time_horizon_agents(agent: GodotNavigationRID): number { return this.number('_agent_get_time_horizon_agents', agent); }
  _agent_set_time_horizon_obstacles(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_time_horizon_obstacles', agent, value); }
  _agent_get_time_horizon_obstacles(agent: GodotNavigationRID): number { return this.number('_agent_get_time_horizon_obstacles', agent); }
  _agent_set_radius(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_radius', agent, value); }
  _agent_get_radius(agent: GodotNavigationRID): number { return this.number('_agent_get_radius', agent); }
  _agent_set_max_speed(agent: GodotNavigationRID, value: number): void { this.call('_agent_set_max_speed', agent, value); }
  _agent_get_max_speed(agent: GodotNavigationRID): number { return this.number('_agent_get_max_speed', agent); }
  _agent_set_velocity(agent: GodotNavigationRID, velocity: GodotNavigationVector2): void { this.call('_agent_set_velocity', agent, velocity); }
  _agent_set_velocity_forced(agent: GodotNavigationRID, velocity: GodotNavigationVector2): void { this.call('_agent_set_velocity_forced', agent, velocity); }
  _agent_get_velocity(agent: GodotNavigationRID): GodotNavigationVector2 { return this.call('_agent_get_velocity', agent) as GodotNavigationVector2; }
  _agent_set_position(agent: GodotNavigationRID, position: GodotNavigationVector2): void { this.call('_agent_set_position', agent, position); }
  _agent_get_position(agent: GodotNavigationRID): GodotNavigationVector2 { return this.call('_agent_get_position', agent) as GodotNavigationVector2; }
  _agent_is_map_changed(agent: GodotNavigationRID): boolean { return this.boolean('_agent_is_map_changed', agent); }
  _agent_set_avoidance_callback(agent: GodotNavigationRID, callback: ((velocity: GodotNavigationVector2) => void) | null): void { this.call('_agent_set_avoidance_callback', agent, callback); }
  _agent_set_avoidance_layers(agent: GodotNavigationRID, layers: number): void { this.call('_agent_set_avoidance_layers', agent, layers); }
  _agent_get_avoidance_layers(agent: GodotNavigationRID): number { return this.number('_agent_get_avoidance_layers', agent); }
  _agent_set_avoidance_mask(agent: GodotNavigationRID, mask: number): void { this.call('_agent_set_avoidance_mask', agent, mask); }
  _agent_get_avoidance_mask(agent: GodotNavigationRID): number { return this.number('_agent_get_avoidance_mask', agent); }
  _agent_set_avoidance_priority(agent: GodotNavigationRID, priority: number): void { this.call('_agent_set_avoidance_priority', agent, priority); }
  _agent_get_avoidance_priority(agent: GodotNavigationRID): number { return this.number('_agent_get_avoidance_priority', agent); }
  _obstacle_create(): GodotNavigationRID { return this.rid('_obstacle_create'); }
  _obstacle_set_map(obstacle: GodotNavigationRID, map: GodotNavigationRID | null): void { this.call('_obstacle_set_map', obstacle, map); }
  _obstacle_get_map(obstacle: GodotNavigationRID): GodotNavigationRID { return this.rid('_obstacle_get_map', obstacle); }
  _obstacle_set_paused(obstacle: GodotNavigationRID, paused: boolean): void { this.call('_obstacle_set_paused', obstacle, paused); }
  _obstacle_get_paused(obstacle: GodotNavigationRID): boolean { return this.boolean('_obstacle_get_paused', obstacle); }
  _obstacle_set_avoidance_enabled(obstacle: GodotNavigationRID, enabled: boolean): void { this.call('_obstacle_set_avoidance_enabled', obstacle, enabled); }
  _obstacle_get_avoidance_enabled(obstacle: GodotNavigationRID): boolean { return this.boolean('_obstacle_get_avoidance_enabled', obstacle); }
  _obstacle_set_radius(obstacle: GodotNavigationRID, radius: number): void { this.call('_obstacle_set_radius', obstacle, radius); }
  _obstacle_get_radius(obstacle: GodotNavigationRID): number { return this.number('_obstacle_get_radius', obstacle); }
  _obstacle_set_velocity(obstacle: GodotNavigationRID, velocity: GodotNavigationVector2): void { this.call('_obstacle_set_velocity', obstacle, velocity); }
  _obstacle_get_velocity(obstacle: GodotNavigationRID): GodotNavigationVector2 { return this.call('_obstacle_get_velocity', obstacle) as GodotNavigationVector2; }
  _obstacle_set_position(obstacle: GodotNavigationRID, position: GodotNavigationVector2): void { this.call('_obstacle_set_position', obstacle, position); }
  _obstacle_get_position(obstacle: GodotNavigationRID): GodotNavigationVector2 { return this.call('_obstacle_get_position', obstacle) as GodotNavigationVector2; }
  _obstacle_set_vertices(obstacle: GodotNavigationRID, vertices: readonly GodotNavigationVector2[]): void { this.call('_obstacle_set_vertices', obstacle, vertices); }
  _obstacle_get_vertices(obstacle: GodotNavigationRID): GodotNavigationVector2[] { return this.array('_obstacle_get_vertices', obstacle); }
  _obstacle_set_avoidance_layers(obstacle: GodotNavigationRID, layers: number): void { this.call('_obstacle_set_avoidance_layers', obstacle, layers); }
  _obstacle_get_avoidance_layers(obstacle: GodotNavigationRID): number { return this.number('_obstacle_get_avoidance_layers', obstacle); }
  _query_path(parameters: unknown, result: unknown, callback?: () => void): void { this.call('_query_path', parameters, result, callback); }
  _parse_source_geometry_data(polygon: unknown, source: unknown, root: unknown, callback?: () => void): void { this.call('_parse_source_geometry_data', polygon, source, root, callback); }
  _bake_from_source_geometry_data(polygon: unknown, source: unknown, callback?: () => void): void { this.call('_bake_from_source_geometry_data', polygon, source, callback); }
  _bake_from_source_geometry_data_async(polygon: unknown, source: unknown, callback?: () => void): void { this.call('_bake_from_source_geometry_data_async', polygon, source, callback); }
  _is_baking_navigation_polygon(polygon: unknown): boolean { return this.boolean('_is_baking_navigation_polygon', polygon); }
  _simplify_path(path: readonly GodotNavigationVector2[], epsilon: number): GodotNavigationVector2[] { return this.array('_simplify_path', path, epsilon); }
  _source_geometry_parser_create(): GodotNavigationRID { return this.rid('_source_geometry_parser_create'); }
  _source_geometry_parser_set_callback(parser: GodotNavigationRID, callback: ((polygon: unknown, source: unknown, node: unknown) => void) | null): void { this.call('_source_geometry_parser_set_callback', parser, callback); }
  _free_rid(rid: GodotNavigationRID): void { this.call('_free_rid', rid); }
  _set_active(active: boolean): void { this.call('_set_active', active); }
  _process(delta: number): void { this.call('_process', delta); }
  _sync(): void { this.call('_sync'); }
  _get_process_info(processInfo: number): number { return this.number('_get_process_info', processInfo); }
}

export const createGodotNavigationServer3DExtension = (hooks: GodotNavigationServerExtensionHooks): GodotNavigationServer3DExtension => new GodotNavigationServer3DExtension(hooks);
export const createGodotNavigationServer2DExtension = (hooks: GodotNavigationServerExtensionHooks): GodotNavigationServer2DExtension => new GodotNavigationServer2DExtension(hooks);
