import type { Container, PointData } from 'pixi.js';
import { getNode2DTransform, setNode2DTransform } from './node';
import { registerGodotObjectIdentity } from './object';
import type { GodotPhysicsMaterial } from './physics-material';
import { godotTransform2DNew, type GodotTransform2D } from './transform-2d';

export interface GodotStaticBody2DRuntimeCarrier {
  configure(owner: GodotStaticBody2DSurface): void;
  setSurfaceVelocity(linear: PointData, angular: number): void;
  setTransform?(transform: GodotTransform2D, synchronizePhysics: boolean): void;
  getTransform?(): GodotTransform2D | null;
  wakeOverlappingBodies?(): void;
}

interface StaticBody2DState {
  collisionLayer: number;
  collisionMask: number;
  collisionPriority: number;
  inputRayPickable: boolean;
  inputCaptureOnDrag: boolean;
  disableMode: number;
  linearVelocity: PointData;
  angularVelocity: number;
  material: GodotPhysicsMaterial | null;
  syncToPhysics: boolean;
  pendingTransform: GodotTransform2D | null;
  runtime: GodotStaticBody2DRuntimeCarrier | null;
}

export interface GodotStaticBody2DSurface extends Container {
  bind_runtime(value: GodotStaticBody2DRuntimeCarrier | null): void;
  get_runtime(): GodotStaticBody2DRuntimeCarrier | null;
  set_collision_layer(value: number): void;
  get_collision_layer(): number;
  set_collision_layer_value(layer: number, enabled: boolean): void;
  get_collision_layer_value(layer: number): boolean;
  set_collision_mask(value: number): void;
  get_collision_mask(): number;
  set_collision_mask_value(layer: number, enabled: boolean): void;
  get_collision_mask_value(layer: number): boolean;
  set_collision_priority(value: number): void;
  get_collision_priority(): number;
  set_input_ray_pickable(value: boolean): void;
  is_input_ray_pickable(): boolean;
  set_input_capture_on_drag(value: boolean): void;
  get_input_capture_on_drag(): boolean;
  set_disable_mode(value: number): void;
  get_disable_mode(): number;
  set_constant_linear_velocity(value: PointData): void;
  get_constant_linear_velocity(): PointData;
  set_constant_angular_velocity(value: number): void;
  get_constant_angular_velocity(): number;
  set_physics_material_override(value: GodotPhysicsMaterial | null): void;
  get_physics_material_override(): GodotPhysicsMaterial | null;
  wake_up_overlaps(): void;
}

export interface GodotAnimatableBody2DSurface extends GodotStaticBody2DSurface {
  set_sync_to_physics(value: boolean): void;
  is_sync_to_physics_enabled(): boolean;
  move_to_transform(value: GodotTransform2D): void;
  move_to(position: PointData, rotation?: number, scale?: PointData): void;
  synchronize_from_physics(): boolean;
  flush_pending_transform(): GodotTransform2D | null;
  has_pending_transform(): boolean;
}

const STATES = new WeakMap<Container, StaticBody2DState>();

function state(node: Container): StaticBody2DState {
  const value = STATES.get(node);
  if (value === undefined) throw new TypeError('StaticBody2D access requires a bound body node.');
  return value;
}

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) throw new RangeError(`${member} requires a finite value >= ${minimum}.`);
  return value;
}

function vector(member: string, value: Readonly<PointData>): PointData {
  if (value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError(`${member} requires a finite Vector2.`);
  return { x: value.x, y: value.y };
}

function unsignedMask(member: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${member} requires an unsigned 32-bit mask.`);
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

function configure(node: Container): void { state(node).runtime?.configure(node as GodotStaticBody2DSurface); }
function pushVelocity(node: Container): void {
  const value = state(node);
  value.runtime?.setSurfaceVelocity({ ...value.linearVelocity }, value.angularVelocity);
}

const METHODS: Omit<GodotAnimatableBody2DSurface, keyof Container> = {
  bind_runtime(this: Container, runtime: GodotStaticBody2DRuntimeCarrier | null): void {
    const value = state(this);
    value.runtime = runtime;
    if (runtime !== null) {
      runtime.configure(this as GodotStaticBody2DSurface);
      runtime.setSurfaceVelocity({ ...value.linearVelocity }, value.angularVelocity);
    }
  },
  get_runtime(this: Container): GodotStaticBody2DRuntimeCarrier | null { return state(this).runtime; },
  set_collision_layer(this: Container, value: number): void { state(this).collisionLayer = unsignedMask('StaticBody2D.collision_layer', value); configure(this); },
  get_collision_layer(this: Container): number { return state(this).collisionLayer; },
  set_collision_layer_value(this: Container, layer: number, enabled: boolean): void { const value = state(this); value.collisionLayer = setMaskBit(value.collisionLayer, layer, enabled); configure(this); },
  get_collision_layer_value(this: Container, layer: number): boolean { return getMaskBit(state(this).collisionLayer, layer); },
  set_collision_mask(this: Container, value: number): void { state(this).collisionMask = unsignedMask('StaticBody2D.collision_mask', value); configure(this); },
  get_collision_mask(this: Container): number { return state(this).collisionMask; },
  set_collision_mask_value(this: Container, layer: number, enabled: boolean): void { const value = state(this); value.collisionMask = setMaskBit(value.collisionMask, layer, enabled); configure(this); },
  get_collision_mask_value(this: Container, layer: number): boolean { return getMaskBit(state(this).collisionMask, layer); },
  set_collision_priority(this: Container, value: number): void { state(this).collisionPriority = finite('StaticBody2D.collision_priority', value, 0); configure(this); },
  get_collision_priority(this: Container): number { return state(this).collisionPriority; },
  set_input_ray_pickable(this: Container, value: boolean): void { state(this).inputRayPickable = value; configure(this); },
  is_input_ray_pickable(this: Container): boolean { return state(this).inputRayPickable; },
  set_input_capture_on_drag(this: Container, value: boolean): void { state(this).inputCaptureOnDrag = value; configure(this); },
  get_input_capture_on_drag(this: Container): boolean { return state(this).inputCaptureOnDrag; },
  set_disable_mode(this: Container, mode: number): void {
    if (mode !== 0 && mode !== 1 && mode !== 2) throw new RangeError('StaticBody2D.disable_mode requires REMOVE, MAKE_STATIC, or KEEP_ACTIVE.');
    state(this).disableMode = mode; configure(this);
  },
  get_disable_mode(this: Container): number { return state(this).disableMode; },
  set_constant_linear_velocity(this: Container, value: PointData): void { state(this).linearVelocity = vector('StaticBody2D.constant_linear_velocity', value); pushVelocity(this); },
  get_constant_linear_velocity(this: Container): PointData { return { ...state(this).linearVelocity }; },
  set_constant_angular_velocity(this: Container, value: number): void { state(this).angularVelocity = finite('StaticBody2D.constant_angular_velocity', value); pushVelocity(this); },
  get_constant_angular_velocity(this: Container): number { return state(this).angularVelocity; },
  set_physics_material_override(this: Container, value: GodotPhysicsMaterial | null): void { state(this).material = value; configure(this); },
  get_physics_material_override(this: Container): GodotPhysicsMaterial | null { return state(this).material; },
  wake_up_overlaps(this: Container): void { state(this).runtime?.wakeOverlappingBodies?.(); },
  set_sync_to_physics(this: Container, value: boolean): void { state(this).syncToPhysics = value; configure(this); },
  is_sync_to_physics_enabled(this: Container): boolean { return state(this).syncToPhysics; },
  move_to_transform(this: Container, transform: GodotTransform2D): void {
    const copy = godotTransform2DNew(transform);
    const value = state(this);
    value.pendingTransform = copy;
    setNode2DTransform(this, copy);
    value.runtime?.setTransform?.(godotTransform2DNew(copy), value.syncToPhysics);
  },
  move_to(this: Container, position: PointData, rotation = this.rotation, scale = this.scale): void {
    const nextPosition = vector('AnimatableBody2D.position', position);
    const nextScale = vector('AnimatableBody2D.scale', scale);
    thisAsAnimatable(this).move_to_transform(godotTransform2DNew(finite('AnimatableBody2D.rotation', rotation), nextScale, 0, nextPosition));
  },
  synchronize_from_physics(this: Container): boolean {
    const transform = state(this).runtime?.getTransform?.();
    if (transform === null || transform === undefined) return false;
    state(this).pendingTransform = null;
    setNode2DTransform(this, transform);
    return true;
  },
  flush_pending_transform(this: Container): GodotTransform2D | null {
    const value = state(this);
    const pending = value.pendingTransform;
    value.pendingTransform = null;
    return pending === null ? null : godotTransform2DNew(pending);
  },
  has_pending_transform(this: Container): boolean { return state(this).pendingTransform !== null; },
};

function thisAsAnimatable(node: Container): GodotAnimatableBody2DSurface { return node as GodotAnimatableBody2DSurface; }

function install<TNode extends Container>(node: TNode, godotClass: 'StaticBody2D' | 'AnimatableBody2D'): TNode & GodotAnimatableBody2DSurface {
  STATES.set(node, {
    collisionLayer: 1,
    collisionMask: 1,
    collisionPriority: 1,
    inputRayPickable: true,
    inputCaptureOnDrag: false,
    disableMode: 0,
    linearVelocity: { x: 0, y: 0 },
    angularVelocity: 0,
    material: null,
    syncToPhysics: true,
    pendingTransform: null,
    runtime: null,
  });
  for (const [name, method] of Object.entries(METHODS)) {
    Object.defineProperty(node, name, { configurable: true, enumerable: false, writable: true, value: method });
  }
  registerGodotObjectIdentity(node, godotClass);
  return node as TNode & GodotAnimatableBody2DSurface;
}

export function bindGodotStaticBody2D<TNode extends Container>(node: TNode): TNode & GodotStaticBody2DSurface {
  return install(node, 'StaticBody2D');
}

export function bindGodotAnimatableBody2D<TNode extends Container>(node: TNode): TNode & GodotAnimatableBody2DSurface {
  return install(node, 'AnimatableBody2D');
}

export function getGodotStaticBody2DTransform(node: GodotStaticBody2DSurface): GodotTransform2D {
  return getNode2DTransform(node);
}
