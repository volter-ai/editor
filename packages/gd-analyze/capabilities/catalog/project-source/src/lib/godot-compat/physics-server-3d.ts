export interface GodotPhysicsServerRID { readonly id: number }
export interface GodotPhysicsServer3DBackend { invoke(method: string, args: readonly unknown[]): unknown }

interface PhysicsResource { kind: string; values: Map<string, unknown>; lists: Map<string, unknown[]> }

export class GodotPhysicsServer3D {
  private nextRid = 1;
  private active = true;
  private readonly resources = new Map<number, PhysicsResource>();

  constructor(private readonly backend: GodotPhysicsServer3DBackend | null = null) {}
  private create(kind: string): GodotPhysicsServerRID { const rid = Object.freeze({ id: this.nextRid++ }); this.resources.set(rid.id, { kind, values: new Map(), lists: new Map() }); this.backend?.invoke(`${kind}_create`, [rid]); return rid; }
  private entry(rid: GodotPhysicsServerRID, kind?: string): PhysicsResource { const value = this.resources.get(rid.id); if (!value) throw new Error(`PhysicsServer3D RID ${rid.id} is invalid.`); if (kind && value.kind !== kind) throw new TypeError(`PhysicsServer3D RID ${rid.id} is ${value.kind}, expected ${kind}.`); return value; }
  private set(rid: GodotPhysicsServerRID, key: string, value: unknown): void { this.entry(rid).values.set(key, value); this.backend?.invoke(key, [rid, value]); }
  private get<T>(rid: GodotPhysicsServerRID, key: string, fallback: T): T { return (this.entry(rid).values.get(key) as T | undefined) ?? fallback; }
  private list(rid: GodotPhysicsServerRID, key: string): unknown[] { const entry = this.entry(rid); let list = entry.lists.get(key); if (!list) { list = []; entry.lists.set(key, list); } return list; }

  shape_create(shapeType: number): GodotPhysicsServerRID { const rid = this.create('shape'); this.set(rid, 'shape_type', shapeType); return rid; }
  world_boundary_shape_create(): GodotPhysicsServerRID { return this.shape_create(0); }
  separation_ray_shape_create(): GodotPhysicsServerRID { return this.shape_create(1); }
  sphere_shape_create(): GodotPhysicsServerRID { return this.shape_create(2); }
  box_shape_create(): GodotPhysicsServerRID { return this.shape_create(3); }
  capsule_shape_create(): GodotPhysicsServerRID { return this.shape_create(4); }
  cylinder_shape_create(): GodotPhysicsServerRID { return this.shape_create(5); }
  convex_polygon_shape_create(): GodotPhysicsServerRID { return this.shape_create(6); }
  concave_polygon_shape_create(): GodotPhysicsServerRID { return this.shape_create(7); }
  heightmap_shape_create(): GodotPhysicsServerRID { return this.shape_create(8); }
  custom_shape_create(): GodotPhysicsServerRID { return this.shape_create(9); }
  shape_set_data(shape: GodotPhysicsServerRID, data: unknown): void { this.entry(shape, 'shape'); this.set(shape, 'data', data); }
  shape_get_data(shape: GodotPhysicsServerRID): unknown { return this.get(shape, 'data', null); }
  shape_get_type(shape: GodotPhysicsServerRID): number { return this.get(shape, 'shape_type', -1); }
  shape_set_custom_solver_bias(shape: GodotPhysicsServerRID, bias: number): void { this.set(shape, 'custom_solver_bias', bias); }
  shape_get_custom_solver_bias(shape: GodotPhysicsServerRID): number { return this.get(shape, 'custom_solver_bias', 0); }
  shape_set_margin(shape: GodotPhysicsServerRID, margin: number): void { this.set(shape, 'margin', margin); }
  shape_get_margin(shape: GodotPhysicsServerRID): number { return this.get(shape, 'margin', 0.04); }

  space_create(): GodotPhysicsServerRID { return this.create('space'); }
  space_set_active(space: GodotPhysicsServerRID, active: boolean): void { this.set(space, 'active', active); }
  space_is_active(space: GodotPhysicsServerRID): boolean { return this.get(space, 'active', false); }
  space_set_param(space: GodotPhysicsServerRID, parameter: number, value: number): void { this.set(space, `param:${parameter}`, value); }
  space_get_param(space: GodotPhysicsServerRID, parameter: number): number { return this.get(space, `param:${parameter}`, 0); }
  space_get_direct_state(space: GodotPhysicsServerRID): unknown { return this.backend?.invoke('space_get_direct_state', [space]) ?? null; }
  space_set_debug_contacts(space: GodotPhysicsServerRID, maxContacts: number): void { this.set(space, 'debug_contacts', Math.max(0, Math.trunc(maxContacts))); }
  space_get_contacts(space: GodotPhysicsServerRID): unknown[] { return this.get(space, 'contacts', []); }
  space_get_contact_count(space: GodotPhysicsServerRID): number { return this.space_get_contacts(space).length; }

  area_create(): GodotPhysicsServerRID { return this.create('area'); }
  area_set_space(area: GodotPhysicsServerRID, space: GodotPhysicsServerRID): void { this.entry(space, 'space'); this.set(area, 'space', space); }
  area_get_space(area: GodotPhysicsServerRID): GodotPhysicsServerRID | null { return this.get(area, 'space', null); }
  area_add_shape(area: GodotPhysicsServerRID, shape: GodotPhysicsServerRID, transform: unknown, disabled = false): void { this.entry(shape, 'shape'); this.list(area, 'shapes').push({ shape, transform, disabled }); }
  area_set_shape(area: GodotPhysicsServerRID, index: number, shape: GodotPhysicsServerRID): void { const value = this.list(area, 'shapes')[index] as { shape: GodotPhysicsServerRID } | undefined; if (value) value.shape = shape; }
  area_set_shape_transform(area: GodotPhysicsServerRID, index: number, transform: unknown): void { const value = this.list(area, 'shapes')[index] as { transform: unknown } | undefined; if (value) value.transform = transform; }
  area_set_shape_disabled(area: GodotPhysicsServerRID, index: number, disabled: boolean): void { const value = this.list(area, 'shapes')[index] as { disabled: boolean } | undefined; if (value) value.disabled = disabled; }
  area_get_shape_count(area: GodotPhysicsServerRID): number { return this.list(area, 'shapes').length; }
  area_get_shape(area: GodotPhysicsServerRID, index: number): unknown { return this.list(area, 'shapes')[index] ?? null; }
  area_remove_shape(area: GodotPhysicsServerRID, index: number): void { this.list(area, 'shapes').splice(index, 1); }
  area_clear_shapes(area: GodotPhysicsServerRID): void { this.list(area, 'shapes').length = 0; }
  area_attach_object_instance_id(area: GodotPhysicsServerRID, id: number): void { this.set(area, 'object_instance_id', id); }
  area_get_object_instance_id(area: GodotPhysicsServerRID): number { return this.get(area, 'object_instance_id', 0); }
  area_set_param(area: GodotPhysicsServerRID, parameter: number, value: unknown): void { this.set(area, `param:${parameter}`, value); }
  area_get_param(area: GodotPhysicsServerRID, parameter: number): unknown { return this.get(area, `param:${parameter}`, null); }
  area_set_transform(area: GodotPhysicsServerRID, transform: unknown): void { this.set(area, 'transform', transform); }
  area_get_transform(area: GodotPhysicsServerRID): unknown { return this.get(area, 'transform', null); }
  area_set_collision_layer(area: GodotPhysicsServerRID, layer: number): void { this.set(area, 'collision_layer', layer >>> 0); }
  area_get_collision_layer(area: GodotPhysicsServerRID): number { return this.get(area, 'collision_layer', 1); }
  area_set_collision_mask(area: GodotPhysicsServerRID, mask: number): void { this.set(area, 'collision_mask', mask >>> 0); }
  area_get_collision_mask(area: GodotPhysicsServerRID): number { return this.get(area, 'collision_mask', 1); }
  area_set_monitorable(area: GodotPhysicsServerRID, monitorable: boolean): void { this.set(area, 'monitorable', monitorable); }
  area_set_monitor_callback(area: GodotPhysicsServerRID, callback: unknown): void { this.set(area, 'monitor_callback', callback); }
  area_set_area_monitor_callback(area: GodotPhysicsServerRID, callback: unknown): void { this.set(area, 'area_monitor_callback', callback); }

  body_create(): GodotPhysicsServerRID { return this.create('body'); }
  body_set_space(body: GodotPhysicsServerRID, space: GodotPhysicsServerRID): void { this.entry(space, 'space'); this.set(body, 'space', space); }
  body_get_space(body: GodotPhysicsServerRID): GodotPhysicsServerRID | null { return this.get(body, 'space', null); }
  body_set_mode(body: GodotPhysicsServerRID, mode: number): void { this.set(body, 'mode', mode); }
  body_get_mode(body: GodotPhysicsServerRID): number { return this.get(body, 'mode', 0); }
  body_add_shape(body: GodotPhysicsServerRID, shape: GodotPhysicsServerRID, transform: unknown, disabled = false): void { this.entry(shape, 'shape'); this.list(body, 'shapes').push({ shape, transform, disabled }); }
  body_set_shape(body: GodotPhysicsServerRID, index: number, shape: GodotPhysicsServerRID): void { const value = this.list(body, 'shapes')[index] as { shape: GodotPhysicsServerRID } | undefined; if (value) value.shape = shape; }
  body_set_shape_transform(body: GodotPhysicsServerRID, index: number, transform: unknown): void { const value = this.list(body, 'shapes')[index] as { transform: unknown } | undefined; if (value) value.transform = transform; }
  body_set_shape_disabled(body: GodotPhysicsServerRID, index: number, disabled: boolean): void { const value = this.list(body, 'shapes')[index] as { disabled: boolean } | undefined; if (value) value.disabled = disabled; }
  body_get_shape_count(body: GodotPhysicsServerRID): number { return this.list(body, 'shapes').length; }
  body_get_shape(body: GodotPhysicsServerRID, index: number): unknown { return this.list(body, 'shapes')[index] ?? null; }
  body_remove_shape(body: GodotPhysicsServerRID, index: number): void { this.list(body, 'shapes').splice(index, 1); }
  body_clear_shapes(body: GodotPhysicsServerRID): void { this.list(body, 'shapes').length = 0; }
  body_attach_object_instance_id(body: GodotPhysicsServerRID, id: number): void { this.set(body, 'object_instance_id', id); }
  body_get_object_instance_id(body: GodotPhysicsServerRID): number { return this.get(body, 'object_instance_id', 0); }
  body_set_enable_continuous_collision_detection(body: GodotPhysicsServerRID, enable: boolean): void { this.set(body, 'ccd', enable); }
  body_is_continuous_collision_detection_enabled(body: GodotPhysicsServerRID): boolean { return this.get(body, 'ccd', false); }
  body_set_collision_layer(body: GodotPhysicsServerRID, layer: number): void { this.set(body, 'collision_layer', layer >>> 0); }
  body_get_collision_layer(body: GodotPhysicsServerRID): number { return this.get(body, 'collision_layer', 1); }
  body_set_collision_mask(body: GodotPhysicsServerRID, mask: number): void { this.set(body, 'collision_mask', mask >>> 0); }
  body_get_collision_mask(body: GodotPhysicsServerRID): number { return this.get(body, 'collision_mask', 1); }
  body_set_collision_priority(body: GodotPhysicsServerRID, priority: number): void { this.set(body, 'collision_priority', priority); }
  body_set_param(body: GodotPhysicsServerRID, parameter: number, value: unknown): void { this.set(body, `param:${parameter}`, value); }
  body_get_param(body: GodotPhysicsServerRID, parameter: number): unknown { return this.get(body, `param:${parameter}`, null); }
  body_set_state(body: GodotPhysicsServerRID, state: number, value: unknown): void { this.set(body, `state:${state}`, value); }
  body_get_state(body: GodotPhysicsServerRID, state: number): unknown { return this.get(body, `state:${state}`, null); }
  body_reset_mass_properties(body: GodotPhysicsServerRID): void { this.set(body, 'mass_reset', true); }
  body_apply_central_impulse(body: GodotPhysicsServerRID, impulse: unknown): void { this.backend?.invoke('body_apply_central_impulse', [body, impulse]); }
  body_apply_impulse(body: GodotPhysicsServerRID, impulse: unknown, position: unknown): void { this.backend?.invoke('body_apply_impulse', [body, impulse, position]); }
  body_apply_torque_impulse(body: GodotPhysicsServerRID, impulse: unknown): void { this.backend?.invoke('body_apply_torque_impulse', [body, impulse]); }
  body_apply_central_force(body: GodotPhysicsServerRID, force: unknown): void { this.backend?.invoke('body_apply_central_force', [body, force]); }
  body_apply_force(body: GodotPhysicsServerRID, force: unknown, position: unknown): void { this.backend?.invoke('body_apply_force', [body, force, position]); }
  body_apply_torque(body: GodotPhysicsServerRID, torque: unknown): void { this.backend?.invoke('body_apply_torque', [body, torque]); }
  body_add_constant_central_force(body: GodotPhysicsServerRID, force: unknown): void { this.set(body, 'constant_force', force); }
  body_add_constant_force(body: GodotPhysicsServerRID, force: unknown, position: unknown): void { this.set(body, 'constant_force', { force, position }); }
  body_add_constant_torque(body: GodotPhysicsServerRID, torque: unknown): void { this.set(body, 'constant_torque', torque); }
  body_set_axis_velocity(body: GodotPhysicsServerRID, velocity: unknown): void { this.set(body, 'axis_velocity', velocity); }
  body_add_collision_exception(body: GodotPhysicsServerRID, exceptedBody: GodotPhysicsServerRID): void { this.list(body, 'exceptions').push(exceptedBody); }
  body_remove_collision_exception(body: GodotPhysicsServerRID, exceptedBody: GodotPhysicsServerRID): void { const list = this.list(body, 'exceptions'); const index = list.indexOf(exceptedBody); if (index >= 0) list.splice(index, 1); }
  body_get_collision_exceptions(body: GodotPhysicsServerRID): unknown[] { return [...this.list(body, 'exceptions')]; }
  body_set_max_contacts_reported(body: GodotPhysicsServerRID, amount: number): void { this.set(body, 'max_contacts', Math.max(0, Math.trunc(amount))); }
  body_set_omit_force_integration(body: GodotPhysicsServerRID, enable: boolean): void { this.set(body, 'omit_force_integration', enable); }
  body_set_force_integration_callback(body: GodotPhysicsServerRID, callback: unknown, userdata: unknown = null): void { this.set(body, 'force_integration_callback', { callback, userdata }); }
  body_get_direct_state(body: GodotPhysicsServerRID): unknown { return this.backend?.invoke('body_get_direct_state', [body]) ?? null; }

  soft_body_create(): GodotPhysicsServerRID { return this.create('soft_body'); }
  soft_body_update_rendering_server(softBody: GodotPhysicsServerRID, handler: unknown): void { this.backend?.invoke('soft_body_update_rendering_server', [softBody, handler]); }
  soft_body_set_space(softBody: GodotPhysicsServerRID, space: GodotPhysicsServerRID): void { this.set(softBody, 'space', space); }
  soft_body_set_mesh(softBody: GodotPhysicsServerRID, mesh: unknown): void { this.set(softBody, 'mesh', mesh); }
  soft_body_set_collision_layer(softBody: GodotPhysicsServerRID, layer: number): void { this.set(softBody, 'collision_layer', layer >>> 0); }
  soft_body_set_collision_mask(softBody: GodotPhysicsServerRID, mask: number): void { this.set(softBody, 'collision_mask', mask >>> 0); }
  soft_body_set_simulation_precision(softBody: GodotPhysicsServerRID, precision: number): void { this.set(softBody, 'precision', Math.max(1, Math.trunc(precision))); }
  soft_body_set_total_mass(softBody: GodotPhysicsServerRID, mass: number): void { this.set(softBody, 'mass', mass); }
  soft_body_set_linear_stiffness(softBody: GodotPhysicsServerRID, stiffness: number): void { this.set(softBody, 'linear_stiffness', stiffness); }
  soft_body_set_pressure_coefficient(softBody: GodotPhysicsServerRID, pressure: number): void { this.set(softBody, 'pressure', pressure); }
  soft_body_set_damping_coefficient(softBody: GodotPhysicsServerRID, damping: number): void { this.set(softBody, 'damping', damping); }
  soft_body_set_drag_coefficient(softBody: GodotPhysicsServerRID, drag: number): void { this.set(softBody, 'drag', drag); }
  soft_body_move_point(softBody: GodotPhysicsServerRID, pointIndex: number, globalPosition: unknown): void { this.set(softBody, `point:${pointIndex}`, globalPosition); }
  soft_body_pin_point(softBody: GodotPhysicsServerRID, pointIndex: number, pin: boolean): void { this.set(softBody, `pin:${pointIndex}`, pin); }

  joint_create(): GodotPhysicsServerRID { return this.create('joint'); }
  joint_clear(joint: GodotPhysicsServerRID): void { const entry = this.entry(joint, 'joint'); entry.values.clear(); entry.lists.clear(); }
  joint_make_pin(joint: GodotPhysicsServerRID, bodyA: GodotPhysicsServerRID, localA: unknown, bodyB: GodotPhysicsServerRID, localB: unknown): void { this.set(joint, 'definition', { type: 'pin', bodyA, localA, bodyB, localB }); }
  joint_make_hinge(joint: GodotPhysicsServerRID, bodyA: GodotPhysicsServerRID, hingeA: unknown, bodyB: GodotPhysicsServerRID, hingeB: unknown): void { this.set(joint, 'definition', { type: 'hinge', bodyA, hingeA, bodyB, hingeB }); }
  joint_make_slider(joint: GodotPhysicsServerRID, bodyA: GodotPhysicsServerRID, localA: unknown, bodyB: GodotPhysicsServerRID, localB: unknown): void { this.set(joint, 'definition', { type: 'slider', bodyA, localA, bodyB, localB }); }
  joint_make_cone_twist(joint: GodotPhysicsServerRID, bodyA: GodotPhysicsServerRID, localA: unknown, bodyB: GodotPhysicsServerRID, localB: unknown): void { this.set(joint, 'definition', { type: 'cone_twist', bodyA, localA, bodyB, localB }); }
  joint_make_generic_6dof(joint: GodotPhysicsServerRID, bodyA: GodotPhysicsServerRID, localA: unknown, bodyB: GodotPhysicsServerRID, localB: unknown): void { this.set(joint, 'definition', { type: 'generic_6dof', bodyA, localA, bodyB, localB }); }
  joint_set_solver_priority(joint: GodotPhysicsServerRID, priority: number): void { this.set(joint, 'solver_priority', priority); }
  joint_set_disable_collisions_between_bodies(joint: GodotPhysicsServerRID, disable: boolean): void { this.set(joint, 'disable_collisions', disable); }
  joint_get_type(joint: GodotPhysicsServerRID): string { return (this.get<{ type?: string } | null>(joint, 'definition', null))?.type ?? ''; }
  pin_joint_set_param(joint: GodotPhysicsServerRID, parameter: number, value: number): void { this.set(joint, `pin_param:${parameter}`, value); }
  hinge_joint_set_param(joint: GodotPhysicsServerRID, parameter: number, value: number): void { this.set(joint, `hinge_param:${parameter}`, value); }
  slider_joint_set_param(joint: GodotPhysicsServerRID, parameter: number, value: number): void { this.set(joint, `slider_param:${parameter}`, value); }
  cone_twist_joint_set_param(joint: GodotPhysicsServerRID, parameter: number, value: number): void { this.set(joint, `cone_param:${parameter}`, value); }
  generic_6dof_joint_set_param(joint: GodotPhysicsServerRID, axis: number, parameter: number, value: number): void { this.set(joint, `6dof_param:${axis}:${parameter}`, value); }
  generic_6dof_joint_set_flag(joint: GodotPhysicsServerRID, axis: number, flag: number, value: boolean): void { this.set(joint, `6dof_flag:${axis}:${flag}`, value); }

  free_rid(rid: GodotPhysicsServerRID): void { this.resources.delete(rid.id); this.backend?.invoke('free_rid', [rid]); }
  set_active(active: boolean): void { this.active = active; }
  is_active(): boolean { return this.active; }
  init(): void { this.backend?.invoke('init', []); }
  step(delta: number): void { if (this.active) this.backend?.invoke('step', [delta]); }
  sync(): void { this.backend?.invoke('sync', []); }
  flush_queries(): void { this.backend?.invoke('flush_queries', []); }
  end_sync(): void { this.backend?.invoke('end_sync', []); }
  finish(): void { this.backend?.invoke('finish', []); }
}

export function createGodotPhysicsServer3D(backend: GodotPhysicsServer3DBackend | null = null): GodotPhysicsServer3D { return new GodotPhysicsServer3D(backend); }
