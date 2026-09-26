import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export type GodotWorldRID = unknown;

export interface GodotWorld2DBackend {
  canvas_create(): GodotWorldRID;
  space_create(): GodotWorldRID;
  navigation_map_create(): GodotWorldRID;
  space_get_direct_state(space: GodotWorldRID): unknown;
  free_rid?(rid: GodotWorldRID): void;
}

export interface GodotWorld3DBackend {
  scenario_create(): GodotWorldRID;
  space_create(): GodotWorldRID;
  navigation_map_create(): GodotWorldRID;
  space_get_direct_state(space: GodotWorldRID): unknown;
  scenario_set_environment?(scenario: GodotWorldRID, environment: unknown): void;
  scenario_set_fallback_environment?(scenario: GodotWorldRID, environment: unknown): void;
  scenario_set_camera_attributes?(scenario: GodotWorldRID, attributes: unknown): void;
  free_rid?(rid: GodotWorldRID): void;
}

export class GodotWorld2D {
  private readonly canvas: GodotWorldRID;
  private readonly space: GodotWorldRID;
  private readonly navigationMap: GodotWorldRID;
  private disposed = false;

  constructor(private readonly backend: GodotWorld2DBackend) {
    this.canvas = backend.canvas_create();
    this.space = backend.space_create();
    this.navigationMap = backend.navigation_map_create();
    registerGodotObjectIdentity(this, 'World2D');
  }

  get_canvas(): GodotWorldRID { return this.canvas; }
  get_space(): GodotWorldRID { return this.space; }
  get_navigation_map(): GodotWorldRID { return this.navigationMap; }
  get_direct_space_state(): unknown { return this.backend.space_get_direct_state(this.space); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.backend.free_rid?.(this.canvas);
    this.backend.free_rid?.(this.space);
    this.backend.free_rid?.(this.navigationMap);
  }
}

export class GodotWorld3D {
  private readonly scenario: GodotWorldRID;
  private readonly space: GodotWorldRID;
  private readonly navigationMap: GodotWorldRID;
  private environment: unknown = null;
  private fallbackEnvironment: unknown = null;
  private cameraAttributes: unknown = null;
  private disposed = false;

  constructor(private readonly backend: GodotWorld3DBackend) {
    this.scenario = backend.scenario_create();
    this.space = backend.space_create();
    this.navigationMap = backend.navigation_map_create();
    registerGodotObjectIdentity(this, 'World3D');
  }

  get_scenario(): GodotWorldRID { return this.scenario; }
  get_space(): GodotWorldRID { return this.space; }
  get_navigation_map(): GodotWorldRID { return this.navigationMap; }
  get_direct_space_state(): unknown { return this.backend.space_get_direct_state(this.space); }

  set_environment(environment: unknown): void {
    if (environment === this.environment) return;
    this.environment = environment;
    this.backend.scenario_set_environment?.(this.scenario, environment);
    godotResourceEmitChanged(this);
  }
  get_environment(): unknown { return this.environment; }
  set_fallback_environment(environment: unknown): void {
    if (environment === this.fallbackEnvironment) return;
    this.fallbackEnvironment = environment;
    this.backend.scenario_set_fallback_environment?.(this.scenario, environment);
    godotResourceEmitChanged(this);
  }
  get_fallback_environment(): unknown { return this.fallbackEnvironment; }
  set_camera_attributes(attributes: unknown): void {
    if (attributes === this.cameraAttributes) return;
    this.cameraAttributes = attributes;
    this.backend.scenario_set_camera_attributes?.(this.scenario, attributes);
    godotResourceEmitChanged(this);
  }
  get_camera_attributes(): unknown { return this.cameraAttributes; }

  duplicate(): GodotWorld3D {
    const world = new GodotWorld3D(this.backend);
    world.set_environment(this.environment);
    world.set_fallback_environment(this.fallbackEnvironment);
    world.set_camera_attributes(this.cameraAttributes);
    return world;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.backend.free_rid?.(this.scenario);
    this.backend.free_rid?.(this.space);
    this.backend.free_rid?.(this.navigationMap);
  }
}

export const createGodotWorld2D = (backend: GodotWorld2DBackend): GodotWorld2D => new GodotWorld2D(backend);
export const createGodotWorld3D = (backend: GodotWorld3DBackend): GodotWorld3D => new GodotWorld3D(backend);
