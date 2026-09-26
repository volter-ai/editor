/** NavigationServer2D detached agent RIDs projected onto the native Recast X/Z plane. */
import { GodotCallable } from './callable';
import type { GodotNavigationMap } from './navigation';
import {
  GodotNavigationServerAgent3D,
  NavigationServer3DRuntime,
} from './navigation-server-runtime-3d';

export interface GodotNavigationServerVector2 {
  readonly x: number;
  readonly y: number;
}

const native = (value: GodotNavigationServerVector2): { x: number; y: number; z: number } => ({
  x: value.x,
  y: 0,
  z: value.y,
});
const vector2 = (value: { readonly x: number; readonly y: number; readonly z: number }): GodotNavigationServerVector2 => ({
  x: value.x,
  y: value.z,
});

export class GodotNavigationServerAgent2D {
  private readonly agent = new GodotNavigationServerAgent3D();
  private callback: GodotCallable | null = null;
  private callbackBridge: GodotCallable | null = null;

  set_map(map: GodotNavigationMap | null): void { this.agent.set_map(map); }
  get_map(): GodotNavigationMap | null { return this.agent.get_map(); }
  set_paused(value: boolean): void { this.agent.set_paused(value); }
  get_paused(): boolean { return this.agent.get_paused(); }
  set_avoidance_enabled(value: boolean): void { this.agent.set_avoidance_enabled(value); }
  get_avoidance_enabled(): boolean { return this.agent.get_avoidance_enabled(); }
  set_neighbor_distance(value: number): void { this.agent.set_neighbor_distance(value); }
  get_neighbor_distance(): number { return this.agent.get_neighbor_distance(); }
  set_max_neighbors(value: number): void { this.agent.set_max_neighbors(value); }
  get_max_neighbors(): number { return this.agent.get_max_neighbors(); }
  set_time_horizon_agents(value: number): void { this.agent.set_time_horizon_agents(value); }
  get_time_horizon_agents(): number { return this.agent.get_time_horizon_agents(); }
  set_time_horizon_obstacles(value: number): void { this.agent.set_time_horizon_obstacles(value); }
  get_time_horizon_obstacles(): number { return this.agent.get_time_horizon_obstacles(); }
  set_radius(value: number): void { this.agent.set_radius(value); }
  get_radius(): number { return this.agent.get_radius(); }
  set_max_speed(value: number): void { this.agent.set_max_speed(value); }
  get_max_speed(): number { return this.agent.get_max_speed(); }
  set_velocity_forced(value: GodotNavigationServerVector2): void { this.agent.set_velocity_forced(native(value)); }
  set_velocity(value: GodotNavigationServerVector2): void { this.agent.set_velocity(native(value)); }
  get_velocity(): GodotNavigationServerVector2 { return vector2(this.agent.get_velocity()); }
  set_position(value: GodotNavigationServerVector2): void { this.agent.set_position(native(value)); }
  get_position(): GodotNavigationServerVector2 { return vector2(this.agent.get_position()); }
  is_map_changed(): boolean { return this.agent.is_map_changed(); }
  set_avoidance_callback(value: GodotCallable | null): void {
    if (value !== null && !(value instanceof GodotCallable)) {
      throw new TypeError('NavigationServer2D.agent_set_avoidance_callback requires Callable or null.');
    }
    this.callback = value;
    this.callbackBridge = value === null ? null : GodotCallable.custom((velocity) => {
      if (typeof velocity !== 'object' || velocity === null ||
          !('x' in velocity) || !('z' in velocity)) return null;
      return value.call(vector2(velocity as { x: number; y: number; z: number }));
    });
    this.agent.set_avoidance_callback(this.callbackBridge);
  }
  has_avoidance_callback(): boolean { return this.callback?.isValid() ?? false; }
  set_avoidance_layers(value: number): void { this.agent.set_avoidance_layers(value); }
  get_avoidance_layers(): number { return this.agent.get_avoidance_layers(); }
  set_avoidance_mask(value: number): void { this.agent.set_avoidance_mask(value); }
  get_avoidance_mask(): number { return this.agent.get_avoidance_mask(); }
  set_avoidance_priority(value: number): void { this.agent.set_avoidance_priority(value); }
  get_avoidance_priority(): number { return this.agent.get_avoidance_priority(); }
  release(): void {
    this.callback = null;
    this.callbackBridge = null;
    this.agent.release();
    navigationServerAgents2D.delete(this);
  }
}

const navigationServerAgents2D = new Set<GodotNavigationServerAgent2D>();

export function createGodotNavigationServerAgent2D(): GodotNavigationServerAgent2D {
  const agent = new GodotNavigationServerAgent2D();
  navigationServerAgents2D.add(agent);
  return agent;
}

export const NavigationServer2DRuntime = {
  agent_create: createGodotNavigationServerAgent2D,
  agent_set_map: (agent: GodotNavigationServerAgent2D, value: GodotNavigationMap | null) => agent.set_map(value),
  agent_get_map: (agent: GodotNavigationServerAgent2D) => agent.get_map(),
  agent_set_paused: (agent: GodotNavigationServerAgent2D, value: boolean) => agent.set_paused(value),
  agent_get_paused: (agent: GodotNavigationServerAgent2D) => agent.get_paused(),
  agent_set_avoidance_enabled: (agent: GodotNavigationServerAgent2D, value: boolean) => agent.set_avoidance_enabled(value),
  agent_get_avoidance_enabled: (agent: GodotNavigationServerAgent2D) => agent.get_avoidance_enabled(),
  agent_set_neighbor_distance: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_neighbor_distance(value),
  agent_get_neighbor_distance: (agent: GodotNavigationServerAgent2D) => agent.get_neighbor_distance(),
  agent_set_max_neighbors: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_max_neighbors(value),
  agent_get_max_neighbors: (agent: GodotNavigationServerAgent2D) => agent.get_max_neighbors(),
  agent_set_time_horizon_agents: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_time_horizon_agents(value),
  agent_get_time_horizon_agents: (agent: GodotNavigationServerAgent2D) => agent.get_time_horizon_agents(),
  agent_set_time_horizon_obstacles: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_time_horizon_obstacles(value),
  agent_get_time_horizon_obstacles: (agent: GodotNavigationServerAgent2D) => agent.get_time_horizon_obstacles(),
  agent_set_radius: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_radius(value),
  agent_get_radius: (agent: GodotNavigationServerAgent2D) => agent.get_radius(),
  agent_set_max_speed: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_max_speed(value),
  agent_get_max_speed: (agent: GodotNavigationServerAgent2D) => agent.get_max_speed(),
  agent_set_velocity_forced: (agent: GodotNavigationServerAgent2D, value: GodotNavigationServerVector2) => agent.set_velocity_forced(value),
  agent_set_velocity: (agent: GodotNavigationServerAgent2D, value: GodotNavigationServerVector2) => agent.set_velocity(value),
  agent_get_velocity: (agent: GodotNavigationServerAgent2D) => agent.get_velocity(),
  agent_set_position: (agent: GodotNavigationServerAgent2D, value: GodotNavigationServerVector2) => agent.set_position(value),
  agent_get_position: (agent: GodotNavigationServerAgent2D) => agent.get_position(),
  agent_is_map_changed: (agent: GodotNavigationServerAgent2D) => agent.is_map_changed(),
  agent_set_avoidance_callback: (agent: GodotNavigationServerAgent2D, value: GodotCallable | null) => agent.set_avoidance_callback(value),
  agent_has_avoidance_callback: (agent: GodotNavigationServerAgent2D) => agent.has_avoidance_callback(),
  agent_set_avoidance_layers: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_avoidance_layers(value),
  agent_get_avoidance_layers: (agent: GodotNavigationServerAgent2D) => agent.get_avoidance_layers(),
  agent_set_avoidance_mask: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_avoidance_mask(value),
  agent_get_avoidance_mask: (agent: GodotNavigationServerAgent2D) => agent.get_avoidance_mask(),
  agent_set_avoidance_priority: (agent: GodotNavigationServerAgent2D, value: number) => agent.set_avoidance_priority(value),
  agent_get_avoidance_priority: (agent: GodotNavigationServerAgent2D) => agent.get_avoidance_priority(),
  set_active: NavigationServer3DRuntime.set_active,
  set_debug_enabled: NavigationServer3DRuntime.set_debug_enabled,
  get_debug_enabled: NavigationServer3DRuntime.get_debug_enabled,
  get_process_info: NavigationServer3DRuntime.get_process_info,
};
