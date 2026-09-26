/** Detached NavigationServer3D agent RIDs and server-global runtime state. */
import { Vector3 } from 'three';
import { GodotCallable } from './callable';
import {
  NavigationServer,
  createGodotNavigationAgent,
  type GodotNavigationAgent,
  type GodotNavigationMap,
} from './navigation';

export const NAVIGATION_PROCESS_INFO_ACTIVE_MAPS = 0;
export const NAVIGATION_PROCESS_INFO_REGION_COUNT = 1;
export const NAVIGATION_PROCESS_INFO_AGENT_COUNT = 2;
export const NAVIGATION_PROCESS_INFO_LINK_COUNT = 3;
export const NAVIGATION_PROCESS_INFO_POLYGON_COUNT = 4;
export const NAVIGATION_PROCESS_INFO_EDGE_COUNT = 5;
export const NAVIGATION_PROCESS_INFO_EDGE_MERGE_COUNT = 6;
export const NAVIGATION_PROCESS_INFO_EDGE_CONNECTION_COUNT = 7;
export const NAVIGATION_PROCESS_INFO_EDGE_FREE_COUNT = 8;
export const NAVIGATION_PROCESS_INFO_OBSTACLE_COUNT = 9;

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

function positive(value: number, owner: string, allowZero = true): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${owner} requires a ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
  return value;
}

function count(value: number, owner: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${owner} requires a non-negative integer.`);
  return value;
}

function mask(value: number, owner: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${owner} requires a 32-bit layer mask.`);
  }
  return value >>> 0;
}

function priority(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('NavigationServer3D agent priority must be finite.');
  return Math.max(0, Math.min(1, value));
}

function point(value: Point3, owner: string): Point3 {
  if (typeof value !== 'object' || value === null ||
      !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    throw new TypeError(`${owner} requires Vector3.`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

export class GodotNavigationServerAgent3D {
  private map: GodotNavigationMap | null = null;
  private native: GodotNavigationAgent | null = null;
  private position: Point3 = { x: 0, y: 0, z: 0 };
  private velocity: Point3 = { x: 0, y: 0, z: 0 };
  private forcedVelocity: Point3 | null = null;
  private paused = false;
  private avoidance = false;
  private use3d = false;
  private neighborDistance = 50;
  private maxNeighbors = 10;
  private timeHorizonAgents = 1;
  private timeHorizonObstacles = 0;
  private radius = 0.5;
  private height = 1;
  private maxSpeed = 10;
  private layers = 1;
  private avoidanceMask = 1;
  private avoidancePriority = 1;
  private callback: GodotCallable | null = null;
  private releasePostSync: (() => void) | null = null;
  private mapIterationId = 0;
  private freed = false;

  set_map(value: GodotNavigationMap | null): void {
    this.assertLive('agent_set_map');
    if (value === this.map) return;
    this.detach();
    this.map = value;
    if (value !== null) this.attach();
  }
  get_map(): GodotNavigationMap | null { return this.map; }
  set_paused(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('NavigationServer3D.agent_set_paused requires bool.');
    if (this.paused === value) return;
    this.paused = value;
    if (value) this.native?.nativeAgent.requestMoveVelocity({ x: 0, y: 0, z: 0 });
    else if (this.forcedVelocity !== null) this.native?.nativeAgent.requestMoveVelocity(this.forcedVelocity);
  }
  get_paused(): boolean { return this.paused; }
  set_avoidance_enabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('NavigationServer3D.agent_set_avoidance_enabled requires bool.');
    this.avoidance = value;
    if (this.native !== null) this.native.avoidanceEnabled = value;
  }
  get_avoidance_enabled(): boolean { return this.avoidance; }
  set_use_3d_avoidance(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('NavigationServer3D.agent_set_use_3d_avoidance requires bool.');
    if (value) throw new Error('NavigationServer3D.agent_set_use_3d_avoidance requires a three-dimensional avoidance solver; native Detour Crowd is planar.');
    this.use3d = false;
  }
  get_use_3d_avoidance(): boolean { return this.use3d; }
  set_neighbor_distance(value: number): void {
    this.neighborDistance = positive(value, 'NavigationServer3D.agent_set_neighbor_distance');
    if (this.native !== null) this.native.neighborDistance = this.neighborDistance;
  }
  get_neighbor_distance(): number { return this.neighborDistance; }
  set_max_neighbors(value: number): void { this.maxNeighbors = count(value, 'NavigationServer3D.agent_set_max_neighbors'); }
  get_max_neighbors(): number { return this.maxNeighbors; }
  set_time_horizon_agents(value: number): void {
    this.timeHorizonAgents = positive(value, 'NavigationServer3D.agent_set_time_horizon_agents');
  }
  get_time_horizon_agents(): number { return this.timeHorizonAgents; }
  set_time_horizon_obstacles(value: number): void {
    this.timeHorizonObstacles = positive(value, 'NavigationServer3D.agent_set_time_horizon_obstacles');
  }
  get_time_horizon_obstacles(): number { return this.timeHorizonObstacles; }
  set_radius(value: number): void {
    this.radius = positive(value, 'NavigationServer3D.agent_set_radius');
    if (this.native !== null) this.native.radius = this.radius;
  }
  get_radius(): number { return this.radius; }
  set_height(value: number): void {
    const next = positive(value, 'NavigationServer3D.agent_set_height');
    if (next === this.height) return;
    this.height = next;
    this.recreate();
  }
  get_height(): number { return this.height; }
  set_max_speed(value: number): void {
    this.maxSpeed = positive(value, 'NavigationServer3D.agent_set_max_speed');
    if (this.native !== null) this.native.maxSpeed = this.maxSpeed;
  }
  get_max_speed(): number { return this.maxSpeed; }
  set_velocity_forced(value: Point3): void {
    this.forcedVelocity = point(value, 'NavigationServer3D.agent_set_velocity_forced');
    this.velocity = this.forcedVelocity;
    if (!this.paused) this.native?.nativeAgent.requestMoveVelocity(this.forcedVelocity);
  }
  set_velocity(value: Point3): void {
    this.velocity = point(value, 'NavigationServer3D.agent_set_velocity');
    this.forcedVelocity = null;
    if (!this.paused && this.native !== null) this.native.velocity = this.velocity;
  }
  get_velocity(): Point3 { return { ...this.velocity }; }
  set_position(value: Point3): void {
    this.position = point(value, 'NavigationServer3D.agent_set_position');
    this.native?.syncPosition(this.position);
  }
  get_position(): Point3 {
    if (this.native !== null) this.position = point(this.native.nativeAgent.position(), 'native CrowdAgent.position');
    return { ...this.position };
  }
  is_map_changed(): boolean {
    const changed = this.map !== null && this.map.iterationId !== this.mapIterationId;
    if (this.map !== null) this.mapIterationId = this.map.iterationId;
    return changed;
  }
  set_avoidance_callback(value: GodotCallable | null): void {
    if (value !== null && !(value instanceof GodotCallable)) {
      throw new TypeError('NavigationServer3D.agent_set_avoidance_callback requires Callable or null.');
    }
    this.callback = value;
  }
  has_avoidance_callback(): boolean { return this.callback?.isValid() ?? false; }
  set_avoidance_layers(value: number): void { this.layers = mask(value, 'NavigationServer3D.agent_set_avoidance_layers'); }
  get_avoidance_layers(): number { return this.layers; }
  set_avoidance_mask(value: number): void { this.avoidanceMask = mask(value, 'NavigationServer3D.agent_set_avoidance_mask'); }
  get_avoidance_mask(): number { return this.avoidanceMask; }
  set_avoidance_priority(value: number): void { this.avoidancePriority = priority(value); }
  get_avoidance_priority(): number { return this.avoidancePriority; }

  release(): void {
    if (this.freed) return;
    this.freed = true;
    this.detach();
    navigationServerAgents.delete(this);
  }

  private attach(): void {
    if (this.map === null || this.paused || this.freed) return;
    this.native = createGodotNavigationAgent({
      map: this.map,
      position: this.position,
      radius: this.radius,
      height: this.height,
      maxSpeed: this.maxSpeed,
      avoidanceEnabled: this.avoidance,
      navigationLayers: 1,
    });
    this.native.neighborDistance = this.neighborDistance;
    this.native.velocity = this.velocity;
    this.mapIterationId = this.map.iterationId;
    this.releasePostSync = this.map.addAgentPostSync(() => {
      if (this.native === null) return;
      this.position = point(this.native.nativeAgent.position(), 'native CrowdAgent.position');
      this.velocity = point(this.native.nativeAgent.velocity(), 'native CrowdAgent.velocity');
      if (this.avoidance && this.callback?.isValid() === true) {
        this.callback.call(new Vector3(this.velocity.x, this.velocity.y, this.velocity.z));
      }
    });
  }
  private detach(): void {
    this.releasePostSync?.();
    this.releasePostSync = null;
    if (this.native !== null) {
      this.position = point(this.native.nativeAgent.position(), 'native CrowdAgent.position');
      this.native.release();
      this.native = null;
    }
  }
  private recreate(): void {
    if (this.native === null) return;
    this.detach();
    this.attach();
  }
  private assertLive(member: string): void {
    if (this.freed) throw new Error(`NavigationServer3D.${member} received a freed agent RID.`);
  }
}

const navigationServerAgents = new Set<GodotNavigationServerAgent3D>();
let serverActive = true;
let debugEnabled = false;

export function createGodotNavigationServerAgent3D(): GodotNavigationServerAgent3D {
  const agent = new GodotNavigationServerAgent3D();
  navigationServerAgents.add(agent);
  return agent;
}

export const NavigationServer3DRuntime = {
  agent_create: createGodotNavigationServerAgent3D,
  agent_set_map: (agent: GodotNavigationServerAgent3D, value: GodotNavigationMap | null) => agent.set_map(value),
  agent_get_map: (agent: GodotNavigationServerAgent3D) => agent.get_map(),
  agent_set_paused: (agent: GodotNavigationServerAgent3D, value: boolean) => agent.set_paused(value),
  agent_get_paused: (agent: GodotNavigationServerAgent3D) => agent.get_paused(),
  agent_set_avoidance_enabled: (agent: GodotNavigationServerAgent3D, value: boolean) => agent.set_avoidance_enabled(value),
  agent_get_avoidance_enabled: (agent: GodotNavigationServerAgent3D) => agent.get_avoidance_enabled(),
  agent_set_use_3d_avoidance: (agent: GodotNavigationServerAgent3D, value: boolean) => agent.set_use_3d_avoidance(value),
  agent_get_use_3d_avoidance: (agent: GodotNavigationServerAgent3D) => agent.get_use_3d_avoidance(),
  agent_set_neighbor_distance: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_neighbor_distance(value),
  agent_get_neighbor_distance: (agent: GodotNavigationServerAgent3D) => agent.get_neighbor_distance(),
  agent_set_max_neighbors: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_max_neighbors(value),
  agent_get_max_neighbors: (agent: GodotNavigationServerAgent3D) => agent.get_max_neighbors(),
  agent_set_time_horizon_agents: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_time_horizon_agents(value),
  agent_get_time_horizon_agents: (agent: GodotNavigationServerAgent3D) => agent.get_time_horizon_agents(),
  agent_set_time_horizon_obstacles: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_time_horizon_obstacles(value),
  agent_get_time_horizon_obstacles: (agent: GodotNavigationServerAgent3D) => agent.get_time_horizon_obstacles(),
  agent_set_radius: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_radius(value),
  agent_get_radius: (agent: GodotNavigationServerAgent3D) => agent.get_radius(),
  agent_set_height: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_height(value),
  agent_get_height: (agent: GodotNavigationServerAgent3D) => agent.get_height(),
  agent_set_max_speed: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_max_speed(value),
  agent_get_max_speed: (agent: GodotNavigationServerAgent3D) => agent.get_max_speed(),
  agent_set_velocity_forced: (agent: GodotNavigationServerAgent3D, value: Point3) => agent.set_velocity_forced(value),
  agent_set_velocity: (agent: GodotNavigationServerAgent3D, value: Point3) => agent.set_velocity(value),
  agent_get_velocity: (agent: GodotNavigationServerAgent3D) => agent.get_velocity(),
  agent_set_position: (agent: GodotNavigationServerAgent3D, value: Point3) => agent.set_position(value),
  agent_get_position: (agent: GodotNavigationServerAgent3D) => agent.get_position(),
  agent_is_map_changed: (agent: GodotNavigationServerAgent3D) => agent.is_map_changed(),
  agent_set_avoidance_callback: (agent: GodotNavigationServerAgent3D, value: GodotCallable | null) => agent.set_avoidance_callback(value),
  agent_has_avoidance_callback: (agent: GodotNavigationServerAgent3D) => agent.has_avoidance_callback(),
  agent_set_avoidance_layers: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_avoidance_layers(value),
  agent_get_avoidance_layers: (agent: GodotNavigationServerAgent3D) => agent.get_avoidance_layers(),
  agent_set_avoidance_mask: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_avoidance_mask(value),
  agent_get_avoidance_mask: (agent: GodotNavigationServerAgent3D) => agent.get_avoidance_mask(),
  agent_set_avoidance_priority: (agent: GodotNavigationServerAgent3D, value: number) => agent.set_avoidance_priority(value),
  agent_get_avoidance_priority: (agent: GodotNavigationServerAgent3D) => agent.get_avoidance_priority(),
  set_active(active: boolean): void {
    if (typeof active !== 'boolean') throw new TypeError('NavigationServer3D.set_active requires bool.');
    serverActive = active;
    for (const map of NavigationServer.get_maps()) NavigationServer.map_set_active(map, active);
  },
  is_active: (): boolean => serverActive,
  set_debug_enabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('NavigationServer3D.set_debug_enabled requires bool.');
    debugEnabled = enabled;
  },
  get_debug_enabled: (): boolean => debugEnabled,
  get_process_info(info: number): number {
    const maps = NavigationServer.get_maps();
    switch (info) {
      case NAVIGATION_PROCESS_INFO_ACTIVE_MAPS: return maps.filter((map) => map.active).length;
      case NAVIGATION_PROCESS_INFO_REGION_COUNT: return maps.reduce((sum, map) => sum + map.regions.size, 0);
      case NAVIGATION_PROCESS_INFO_AGENT_COUNT: return navigationServerAgents.size + maps.reduce((sum, map) => sum + map.agents.size, 0);
      case NAVIGATION_PROCESS_INFO_LINK_COUNT: return maps.reduce((sum, map) => sum + map.links.size, 0);
      case NAVIGATION_PROCESS_INFO_POLYGON_COUNT:
        return maps.reduce((sum, map) => sum + [...map.regions].reduce((regionSum, region) => {
          const resource = region.navigationPolygon as { get_polygon_count?: () => number } | null;
          return regionSum + (resource?.get_polygon_count?.() ?? 0);
        }, 0), 0);
      case NAVIGATION_PROCESS_INFO_EDGE_COUNT:
        return maps.reduce((sum, map) => sum + [...map.regions].reduce((regionSum, region) => {
          const resource = region.navigationPolygon as {
            get_polygon_count?: () => number;
            get_polygon?: (index: number) => readonly number[];
          } | null;
          const count = resource?.get_polygon_count?.() ?? 0;
          let edges = 0;
          for (let index = 0; index < count; index += 1) edges += resource?.get_polygon?.(index)?.length ?? 0;
          return regionSum + edges;
        }, 0), 0);
      case NAVIGATION_PROCESS_INFO_EDGE_MERGE_COUNT: return 0;
      case NAVIGATION_PROCESS_INFO_EDGE_CONNECTION_COUNT: return maps.reduce((sum, map) => sum + map.links.size, 0);
      case NAVIGATION_PROCESS_INFO_EDGE_FREE_COUNT: return 0;
      case NAVIGATION_PROCESS_INFO_OBSTACLE_COUNT: return maps.reduce((sum, map) => sum + map.obstacles.size, 0);
      default: throw new RangeError(`NavigationServer3D.get_process_info received invalid ProcessInfo ${String(info)}.`);
    }
  },
};
