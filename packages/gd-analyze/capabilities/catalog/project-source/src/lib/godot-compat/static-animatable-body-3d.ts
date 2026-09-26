import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import type { GodotPhysicsMaterial } from './physics-material';

export const GodotBodyDisableMode = {
  REMOVE: 0,
  MAKE_STATIC: 1,
  KEEP_ACTIVE: 2,
} as const;

export interface GodotStaticBody3DRuntimeCarrier {
  configure(owner: GodotStaticBody3D): void;
  setSurfaceVelocity(linear: Vector3, angular: Vector3): void;
  setTransform?(transform: Matrix4, synchronizePhysics: boolean): void;
  getTransform?(): Matrix4 | null;
  wakeOverlappingBodies?(): void;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  }
  return value;
}

function vector(member: string, value: Vector3): Vector3 {
  if (!(value instanceof Vector3) || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    throw new TypeError(`${member} requires a finite Vector3.`);
  }
  return value.clone();
}

function unsignedMask(member: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${member} requires an unsigned 32-bit mask.`);
  }
  return value >>> 0;
}

function setMaskBit(current: number, layer: number, enabled: boolean): number {
  if (!Number.isInteger(layer) || layer < 1 || layer > 32) throw new RangeError('Collision layer number requires [1, 32].');
  const bit = 2 ** (layer - 1);
  return enabled ? (current | bit) >>> 0 : (current & ~bit) >>> 0;
}

function getMaskBit(current: number, layer: number): boolean {
  if (!Number.isInteger(layer) || layer < 1 || layer > 32) throw new RangeError('Collision layer number requires [1, 32].');
  return (current & 2 ** (layer - 1)) !== 0;
}

export class GodotStaticBody3D extends Object3D {
  private collisionLayerValue = 1;
  private collisionMaskValue = 1;
  private collisionPriorityValue = 1;
  private inputRayPickableValue = true;
  private inputCaptureOnDragValue = false;
  private disableModeValue: number = GodotBodyDisableMode.REMOVE;
  private constantLinearVelocityValue = new Vector3();
  private constantAngularVelocityValue = new Vector3();
  private physicsMaterialOverrideValue: GodotPhysicsMaterial | null = null;
  private runtime: GodotStaticBody3DRuntimeCarrier | null = null;

  constructor(godotClass = 'StaticBody3D') {
    super();
    registerGodotObjectIdentity(this, godotClass);
  }

  bind_runtime(value: GodotStaticBody3DRuntimeCarrier | null): void {
    this.runtime = value;
    if (value === null) return;
    value.configure(this);
    value.setSurfaceVelocity(this.constantLinearVelocityValue.clone(), this.constantAngularVelocityValue.clone());
  }
  get_runtime(): GodotStaticBody3DRuntimeCarrier | null { return this.runtime; }

  set_collision_layer(value: number): void { this.collisionLayerValue = unsignedMask('StaticBody3D.collision_layer', value); this.reconfigure(); }
  get_collision_layer(): number { return this.collisionLayerValue; }
  set_collision_layer_value(layer: number, enabled: boolean): void { this.collisionLayerValue = setMaskBit(this.collisionLayerValue, layer, enabled); this.reconfigure(); }
  get_collision_layer_value(layer: number): boolean { return getMaskBit(this.collisionLayerValue, layer); }
  set_collision_mask(value: number): void { this.collisionMaskValue = unsignedMask('StaticBody3D.collision_mask', value); this.reconfigure(); }
  get_collision_mask(): number { return this.collisionMaskValue; }
  set_collision_mask_value(layer: number, enabled: boolean): void { this.collisionMaskValue = setMaskBit(this.collisionMaskValue, layer, enabled); this.reconfigure(); }
  get_collision_mask_value(layer: number): boolean { return getMaskBit(this.collisionMaskValue, layer); }
  set_collision_priority(value: number): void { this.collisionPriorityValue = finite('StaticBody3D.collision_priority', value, 0); this.reconfigure(); }
  get_collision_priority(): number { return this.collisionPriorityValue; }
  set_input_ray_pickable(value: boolean): void { this.inputRayPickableValue = value; this.reconfigure(); }
  is_input_ray_pickable(): boolean { return this.inputRayPickableValue; }
  set_input_capture_on_drag(value: boolean): void { this.inputCaptureOnDragValue = value; this.reconfigure(); }
  get_input_capture_on_drag(): boolean { return this.inputCaptureOnDragValue; }
  set_disable_mode(value: number): void {
    if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('StaticBody3D.disable_mode requires REMOVE, MAKE_STATIC, or KEEP_ACTIVE.');
    this.disableModeValue = value;
    this.reconfigure();
  }
  get_disable_mode(): number { return this.disableModeValue; }

  set_constant_linear_velocity(value: Vector3): void {
    this.constantLinearVelocityValue = vector('StaticBody3D.constant_linear_velocity', value);
    this.pushSurfaceVelocity();
  }
  get_constant_linear_velocity(): Vector3 { return this.constantLinearVelocityValue.clone(); }
  set_constant_angular_velocity(value: Vector3): void {
    this.constantAngularVelocityValue = vector('StaticBody3D.constant_angular_velocity', value);
    this.pushSurfaceVelocity();
  }
  get_constant_angular_velocity(): Vector3 { return this.constantAngularVelocityValue.clone(); }
  set_physics_material_override(value: GodotPhysicsMaterial | null): void { this.physicsMaterialOverrideValue = value; this.reconfigure(); }
  get_physics_material_override(): GodotPhysicsMaterial | null { return this.physicsMaterialOverrideValue; }
  wake_up_overlaps(): void { this.runtime?.wakeOverlappingBodies?.(); }

  protected reconfigure(): void { this.runtime?.configure(this); }
  protected runtimeCarrier(): GodotStaticBody3DRuntimeCarrier | null { return this.runtime; }
  private pushSurfaceVelocity(): void {
    this.runtime?.setSurfaceVelocity(this.constantLinearVelocityValue.clone(), this.constantAngularVelocityValue.clone());
  }
}

export class GodotAnimatableBody3D extends GodotStaticBody3D {
  private syncToPhysicsValue = true;
  private pendingTransform: Matrix4 | null = null;

  constructor() {
    super('AnimatableBody3D');
  }

  set_sync_to_physics(value: boolean): void { this.syncToPhysicsValue = value; this.reconfigure(); }
  is_sync_to_physics_enabled(): boolean { return this.syncToPhysicsValue; }

  move_to_transform(value: Matrix4): void {
    if (!(value instanceof Matrix4)) throw new TypeError('AnimatableBody3D transform requires Transform3D.');
    this.pendingTransform = value.clone();
    this.applyTransform(value);
    this.runtimeCarrier()?.setTransform?.(value.clone(), this.syncToPhysicsValue);
  }

  move_to(position: Vector3, rotation = this.quaternion, scale = this.scale): void {
    const nextPosition = vector('AnimatableBody3D.position', position);
    if (!(rotation instanceof Quaternion)) throw new TypeError('AnimatableBody3D rotation requires Quaternion.');
    const nextScale = vector('AnimatableBody3D.scale', scale);
    this.move_to_transform(new Matrix4().compose(nextPosition, rotation.clone().normalize(), nextScale));
  }

  synchronize_from_physics(): boolean {
    const transform = this.runtimeCarrier()?.getTransform?.();
    if (transform === null || transform === undefined) return false;
    this.pendingTransform = null;
    this.applyTransform(transform);
    return true;
  }

  flush_pending_transform(): Matrix4 | null {
    const pending = this.pendingTransform;
    this.pendingTransform = null;
    return pending?.clone() ?? null;
  }

  has_pending_transform(): boolean { return this.pendingTransform !== null; }

  private applyTransform(value: Matrix4): void {
    value.decompose(this.position, this.quaternion, this.scale);
    this.updateMatrix();
    this.updateMatrixWorld(true);
  }
}

export const createGodotStaticBody3D = (): GodotStaticBody3D => new GodotStaticBody3D();
export const createGodotAnimatableBody3D = (): GodotAnimatableBody3D => new GodotAnimatableBody3D();
