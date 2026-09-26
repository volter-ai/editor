/** Godot ShapeCast2D retained on its authored Pixi node and backed by native Rapier queries. */
import RAPIER from '@dimforge/rapier2d-compat';
import { Container } from 'pixi.js';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import {
  GODOT_3_DUPLICATE_DEFAULT,
  bindGodotCanvasNode2DApi,
  registerCanvasNodeDuplicateFactory,
  registerCanvasNodeRelease,
} from './node';
import { godotCanvasTransform2D } from './physics-2d';
import {
  physicsBody2DOfRid,
  physicsRid2DOf,
  physicsVelocityAtPoint2D,
  rapierShape2D,
  type GodotShape2D,
} from './physics-query-2d';
import type { GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId, registerGodotObjectIdentity } from './object';
import { vec2, type Vector2 } from './vector2';

export interface ShapeCastBody2DHandle { readonly handle: number }

export type GodotShapeCast2D = Container & {
  enabled: boolean;
  shape: GodotShape2D | null;
  targetPosition: Vector2;
  margin: number;
  maxResults: number;
  collisionMask: number;
  collideWithAreas: boolean;
  collideWithBodies: boolean;
  excludeParent: boolean;
  forceShapecastUpdate(): void;
  isColliding(): boolean;
  getCollisionCount(): number;
  getCollider(index: number): unknown;
  getColliderRid(index: number): GodotRid;
  getColliderShape(index: number): number;
  getCollisionPoint(index: number): Vector2;
  getCollisionNormal(index: number): Vector2;
  getClosestCollisionSafeFraction(): number;
  getClosestCollisionUnsafeFraction(): number;
  setCollisionMaskValue(layerNumber: number, value: boolean): void;
  getCollisionMaskValue(layerNumber: number): boolean;
  addException(body: ShapeCastBody2DHandle): void;
  addExceptionRid(rid: GodotRid): void;
  removeException(body: ShapeCastBody2DHandle): void;
  removeExceptionRid(rid: GodotRid): void;
  clearExceptions(): void;
  setShape(shape: GodotShape2D | null): void;
  getShape(): GodotShape2D | null;
  getCollisionResult(): ReadonlyArray<Readonly<{
    collider: unknown;
    collider_id: bigint;
    rid: GodotRid;
    shape: number;
    point: Vector2;
    normal: Vector2;
    linear_velocity: Vector2;
  }>>;
};

export interface BindShapeCast2DOptions {
  readonly node: Container;
  readonly presentationRoot: Container;
  readonly world: RAPIER.World;
  readonly shape: GodotShape2D | null;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly registry: GodotShapeCast2DRegistry;
  readonly targetPosition?: Readonly<Vector2>;
  readonly enabled?: boolean;
  readonly margin?: number;
  readonly maxResults?: number;
  readonly collisionMask?: number;
  readonly collideWithAreas?: boolean;
  readonly collideWithBodies?: boolean;
  readonly excludeParent?: boolean;
  readonly parentBody?: ShapeCastBody2DHandle;
  readonly exclude?: readonly ShapeCastBody2DHandle[];
}

interface ShapeCastCollision2D {
  readonly collider: RAPIER.Collider;
  readonly colliderObject: unknown;
  readonly point: Vector2;
  readonly normal: Vector2;
  readonly fraction: number;
  readonly shapeIndex: number;
}

interface ShapeCast2DState {
  readonly presentationRoot: Container;
  readonly world: RAPIER.World;
  shape: GodotShape2D | null;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly registry: GodotShapeCast2DRegistry;
  readonly excluded: Set<number>;
  readonly parentBody?: ShapeCastBody2DHandle;
  target: Vector2;
  enabled: boolean;
  margin: number;
  maxResults: number;
  collisionMask: number;
  collideWithAreas: boolean;
  collideWithBodies: boolean;
  excludeParent: boolean;
  collisions: ShapeCastCollision2D[];
  safeFraction: number;
  unsafeFraction: number;
  unregisterDuplicate: () => void;
  unregisterRelease: () => void;
}

const STATES = new WeakMap<Container, ShapeCast2DState>();

function finiteVector(value: Readonly<Vector2>, name: string): Vector2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`ShapeCast2D.${name} must contain finite coordinates`);
  }
  return vec2(value.x, value.y);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`ShapeCast2D.${name} must be >= 1`);
  return value;
}

function uint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`ShapeCast2D.${name} must be a uint32`);
  }
  return value;
}

function layerBit(layerNumber: number): number {
  if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 32) {
    throw new RangeError('ShapeCast2D collision layer number must be in [1, 32]');
  }
  return 2 ** (layerNumber - 1);
}

function stateOf(node: Container): ShapeCast2DState {
  const state = STATES.get(node);
  if (state === undefined) throw new Error('ShapeCast2D state was read before bind or after release');
  return state;
}

function shapeIndex(collider: RAPIER.Collider): number {
  const body = collider.parent();
  if (body === null) return 0;
  for (let index = 0; index < body.numColliders(); index += 1) {
    if (body.collider(index).handle === collider.handle) return index;
  }
  throw new Error('ShapeCast2D collider is absent from its parent body collider registry');
}

function worldPoint(collider: RAPIER.Collider, local: Readonly<Vector2>): Vector2 {
  const position = collider.translation();
  const angle = collider.rotation();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vec2(position.x + local.x * c - local.y * s, position.y + local.x * s + local.y * c);
}

function worldNormal(collider: RAPIER.Collider, local: Readonly<Vector2>): Vector2 {
  const angle = collider.rotation();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = local.x * c - local.y * s;
  const y = local.x * s + local.y * c;
  const length = Math.hypot(x, y);
  return length === 0 ? vec2(0, 0) : vec2(x / length, y / length);
}

function copyDisplayState(source: Container, target: Container): void {
  target.label = source.label;
  target.position.copyFrom(source.position);
  target.scale.copyFrom(source.scale);
  target.pivot.copyFrom(source.pivot);
  target.skew.copyFrom(source.skew);
  target.rotation = source.rotation;
  target.alpha = source.alpha;
  target.visible = source.visible;
  target.zIndex = source.zIndex;
}

function update(node: GodotShapeCast2D): void {
  const state = stateOf(node);
  state.collisions = [];
  state.safeFraction = 1;
  state.unsafeFraction = 1;
  // force_shapecast_update ignores enabled, but an out-of-tree node has no World2D to query.
  if (!node.parent) return;
  const transform = godotCanvasTransform2D(node, state.presentationRoot);
  const xLength = Math.hypot(transform.a, transform.b);
  const yLength = Math.hypot(transform.c, transform.d);
  const dot = transform.a * transform.c + transform.b * transform.d;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (Math.abs(xLength - 1) > 1e-6 || Math.abs(yLength - 1) > 1e-6 || Math.abs(dot) > 1e-6 || Math.abs(determinant - 1) > 1e-6) {
    throw new Error('ShapeCast2D refuses scale, skew, or reflection because Rapier shapes are unscaled');
  }
  const rotation = Math.atan2(transform.b, transform.a);
  const position = vec2(transform.tx, transform.ty);
  const target = transform.apply(state.target);
  const velocity = vec2(target.x - position.x, target.y - position.y);
  const accepts = (collider: RAPIER.Collider): boolean => {
    const body = collider.parent();
    if (body !== null && state.excluded.has(body.handle)) return false;
    if (state.excludeParent && state.parentBody !== undefined && body?.handle === state.parentBody.handle) return false;
    if (collider.isSensor() ? !state.collideWithAreas : !state.collideWithBodies) return false;
    return godotCanCollideWith(state.layers, collider, state.collisionMask);
  };
  if (state.shape === null) return;
  const shape = rapierShape2D(state.shape);
  const castAtMargin = state.world.castShape(
    position,
    rotation,
    velocity,
    shape,
    state.margin,
    1,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    accepts,
  );
  if (castAtMargin === null) return;
  state.unsafeFraction = Math.max(0, Math.min(1, castAtMargin.time_of_impact));
  state.safeFraction = 0;
  const collidesAt = (fraction: number): boolean => {
    const at = vec2(position.x + velocity.x * fraction, position.y + velocity.y * fraction);
    let collided = false;
    state.world.forEachCollider((collider) => {
      if (collided || !accepts(collider)) return;
      const contact = collider.contactShape(shape, at, rotation, state.margin);
      collided = contact !== null && contact.distance <= state.margin;
    });
    return collided;
  };
  if (state.unsafeFraction > 0) {
    for (let step = 0; step < 8; step += 1) {
      const middle = (state.safeFraction + state.unsafeFraction) / 2;
      if (collidesAt(middle)) state.unsafeFraction = middle;
      else state.safeFraction = middle;
    }
  }
  const fraction = state.unsafeFraction;
  const impact = vec2(position.x + velocity.x * fraction, position.y + velocity.y * fraction);
  state.world.forEachCollider((collider) => {
    if (!accepts(collider) || state.collisions.length >= state.maxResults) return;
    const contact = collider.contactShape(shape, impact, rotation, state.margin);
    if (contact === null || contact.distance > state.margin) return;
    state.collisions.push({
      collider,
      colliderObject: state.resolveCollider(collider),
      point: worldPoint(collider, contact.point1),
      normal: worldNormal(collider, contact.normal1),
      fraction,
      shapeIndex: shapeIndex(collider),
    });
  });
  if (!state.collisions.some((one) => one.collider.handle === castAtMargin.collider.handle)) {
    state.collisions.push({
      collider: castAtMargin.collider,
      colliderObject: state.resolveCollider(castAtMargin.collider),
      point: worldPoint(castAtMargin.collider, castAtMargin.witness2),
      normal: worldNormal(castAtMargin.collider, castAtMargin.normal2),
      fraction,
      shapeIndex: shapeIndex(castAtMargin.collider),
    });
  }
  state.collisions.sort((a, b) => a.collider.handle - b.collider.handle);
  if (state.collisions.length > state.maxResults) state.collisions.length = state.maxResults;
}

export function bindShapeCast2D(options: BindShapeCast2DOptions): GodotShapeCast2D {
  if (STATES.has(options.node)) throw new Error('ShapeCast2D node is already bound');
  const margin = options.margin ?? 0;
  if (!Number.isFinite(margin) || margin < 0) throw new Error('ShapeCast2D.margin must be >= 0');
  const node = bindGodotCanvasNode2DApi(options.node) as unknown as GodotShapeCast2D;
  registerGodotObjectIdentity(node, 'ShapeCast2D');
  const state: ShapeCast2DState = {
    presentationRoot: options.presentationRoot,
    world: options.world,
    shape: options.shape,
    layers: options.layers,
    resolveCollider: options.resolveCollider,
    registry: options.registry,
    excluded: new Set((options.exclude ?? []).map((one) => one.handle)),
    ...(options.parentBody === undefined ? {} : { parentBody: options.parentBody }),
    target: finiteVector(options.targetPosition ?? vec2(0, 50), 'target_position'),
    enabled: options.enabled ?? true,
    margin,
    maxResults: positiveInteger(options.maxResults ?? 32, 'max_results'),
    collisionMask: uint32(options.collisionMask ?? 1, 'collision_mask'),
    collideWithAreas: options.collideWithAreas ?? false,
    collideWithBodies: options.collideWithBodies ?? true,
    excludeParent: options.excludeParent ?? true,
    collisions: [],
    safeFraction: 1,
    unsafeFraction: 1,
    unregisterDuplicate: () => {},
    unregisterRelease: () => {},
  };
  STATES.set(node, state);
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseShapeCast2D(node));
  Object.defineProperties(node, {
    enabled: { configurable: true, get: () => state.enabled, set: (value: boolean) => {
      state.enabled = value;
      if (!value) {
        state.collisions = [];
        state.safeFraction = 1;
        state.unsafeFraction = 1;
      }
    } },
    shape: { configurable: true, get: () => state.shape, set: (value: GodotShape2D | null) => { state.shape = value; } },
    targetPosition: { configurable: true, get: () => vec2(state.target.x, state.target.y), set: (value: Vector2) => { state.target = finiteVector(value, 'target_position'); } },
    margin: { configurable: true, get: () => state.margin, set: (value: number) => { if (!Number.isFinite(value) || value < 0) throw new Error('ShapeCast2D.margin must be >= 0'); state.margin = value; } },
    maxResults: { configurable: true, get: () => state.maxResults, set: (value: number) => { state.maxResults = positiveInteger(value, 'max_results'); } },
    collisionMask: { configurable: true, get: () => state.collisionMask, set: (value: number) => { state.collisionMask = uint32(value, 'collision_mask'); } },
    collideWithAreas: { configurable: true, get: () => state.collideWithAreas, set: (value: boolean) => { state.collideWithAreas = value; } },
    collideWithBodies: { configurable: true, get: () => state.collideWithBodies, set: (value: boolean) => { state.collideWithBodies = value; } },
    excludeParent: { configurable: true, get: () => state.excludeParent, set: (value: boolean) => { state.excludeParent = value; } },
  });
  const collision = (index: number): ShapeCastCollision2D => {
    if (!Number.isInteger(index) || index < 0 || index >= state.collisions.length) {
      throw new RangeError(`ShapeCast2D collision index ${String(index)} is outside the result set`);
    }
    return state.collisions[index] as ShapeCastCollision2D;
  };
  node.forceShapecastUpdate = () => update(node);
  node.isColliding = () => state.collisions.length > 0;
  node.getCollisionCount = () => state.collisions.length;
  node.getCollider = (index) => collision(index).colliderObject;
  node.getColliderRid = (index) => physicsRid2DOf(collision(index).collider);
  node.getColliderShape = (index) => collision(index).shapeIndex;
  node.getCollisionPoint = (index) => collision(index).point;
  node.getCollisionNormal = (index) => collision(index).normal;
  node.getClosestCollisionSafeFraction = () => state.safeFraction;
  node.getClosestCollisionUnsafeFraction = () => state.unsafeFraction;
  node.setCollisionMaskValue = (layerNumber, value) => {
    const bit = layerBit(layerNumber);
    state.collisionMask = value ? (state.collisionMask | bit) >>> 0 : (state.collisionMask & ~bit) >>> 0;
  };
  node.getCollisionMaskValue = (layerNumber) => (state.collisionMask & layerBit(layerNumber)) !== 0;
  node.addException = (body) => state.excluded.add(body.handle);
  node.addExceptionRid = (rid) => state.excluded.add(physicsBody2DOfRid(rid).handle);
  node.removeException = (body) => { state.excluded.delete(body.handle); };
  node.removeExceptionRid = (rid) => { state.excluded.delete(physicsBody2DOfRid(rid).handle); };
  node.clearExceptions = () => state.excluded.clear();
  node.setShape = (shape) => { state.shape = shape; };
  node.getShape = () => state.shape;
  node.getCollisionResult = () => state.collisions.map((one) => {
    if ((typeof one.colliderObject !== 'object' || one.colliderObject === null) && typeof one.colliderObject !== 'function') {
      throw new Error('ShapeCast2D collider resolver returned no registered Godot Object');
    }
    return Object.freeze({
      collider: one.colliderObject,
      collider_id: godotObjectInstanceId(one.colliderObject),
      rid: physicsRid2DOf(one.collider),
      shape: one.shapeIndex,
      point: one.point,
      normal: one.normal,
      linear_velocity: physicsVelocityAtPoint2D(one.collider, one.point),
    });
  });
  Object.defineProperties(node, {
    target_position: { configurable: true, enumerable: true, get: () => node.targetPosition, set: (value: Vector2) => { node.targetPosition = value; } },
    max_results: { configurable: true, enumerable: true, get: () => node.maxResults, set: (value: number) => { node.maxResults = value; } },
    collision_mask: { configurable: true, enumerable: true, get: () => node.collisionMask, set: (value: number) => { node.collisionMask = value; } },
    collide_with_areas: { configurable: true, enumerable: true, get: () => node.collideWithAreas, set: (value: boolean) => { node.collideWithAreas = value; } },
    collide_with_bodies: { configurable: true, enumerable: true, get: () => node.collideWithBodies, set: (value: boolean) => { node.collideWithBodies = value; } },
    exclude_parent: { configurable: true, enumerable: true, get: () => node.excludeParent, set: (value: boolean) => { node.excludeParent = value; } },
  });
  Object.assign(node, {
    set_enabled: (value: boolean): void => { node.enabled = value; },
    is_enabled: (): boolean => node.enabled,
    set_shape: (value: GodotShape2D | null): void => node.setShape(value),
    get_shape: (): GodotShape2D | null => node.getShape(),
    set_target_position: (value: Vector2): void => { node.targetPosition = value; },
    get_target_position: (): Vector2 => node.targetPosition,
    set_margin: (value: number): void => { node.margin = value; },
    get_margin: (): number => node.margin,
    set_max_results: (value: number): void => { node.maxResults = value; },
    get_max_results: (): number => node.maxResults,
    set_collision_mask: (value: number): void => { node.collisionMask = value; },
    get_collision_mask: (): number => node.collisionMask,
    set_collision_mask_value: (layer: number, value: boolean): void => node.setCollisionMaskValue(layer, value),
    get_collision_mask_value: (layer: number): boolean => node.getCollisionMaskValue(layer),
    set_collide_with_areas: (value: boolean): void => { node.collideWithAreas = value; },
    is_collide_with_areas_enabled: (): boolean => node.collideWithAreas,
    set_collide_with_bodies: (value: boolean): void => { node.collideWithBodies = value; },
    is_collide_with_bodies_enabled: (): boolean => node.collideWithBodies,
    set_exclude_parent_body: (value: boolean): void => { node.excludeParent = value; },
    get_exclude_parent_body: (): boolean => node.excludeParent,
    force_shapecast_update: (): void => node.forceShapecastUpdate(),
    is_colliding: (): boolean => node.isColliding(),
    get_collision_count: (): number => node.getCollisionCount(),
    get_collider: (index: number): unknown => node.getCollider(index),
    get_collider_rid: (index: number): GodotRid => node.getColliderRid(index),
    get_collider_shape: (index: number): number => node.getColliderShape(index),
    get_collision_point: (index: number): Vector2 => node.getCollisionPoint(index),
    get_collision_normal: (index: number): Vector2 => node.getCollisionNormal(index),
    get_closest_collision_safe_fraction: (): number => node.getClosestCollisionSafeFraction(),
    get_closest_collision_unsafe_fraction: (): number => node.getClosestCollisionUnsafeFraction(),
    add_exception: (body: ShapeCastBody2DHandle): void => node.addException(body),
    add_exception_rid: (rid: GodotRid): void => node.addExceptionRid(rid),
    remove_exception: (body: ShapeCastBody2DHandle): void => node.removeException(body),
    remove_exception_rid: (rid: GodotRid): void => node.removeExceptionRid(rid),
    clear_exceptions: (): void => node.clearExceptions(),
    get_collision_result: () => node.getCollisionResult(),
  });
  state.unregisterDuplicate = registerCanvasNodeDuplicateFactory(node, (flags) => {
    if (flags !== GODOT_3_DUPLICATE_DEFAULT) throw new Error(`ShapeCast2D.duplicate(${flags}) supports only default Godot 3 flags`);
    const clone = new Container();
    copyDisplayState(node, clone);
    return bindShapeCast2D({ ...options, node: clone, shape: state.shape, targetPosition: state.target, enabled: state.enabled, margin: state.margin, maxResults: state.maxResults, collisionMask: state.collisionMask, collideWithAreas: state.collideWithAreas, collideWithBodies: state.collideWithBodies, excludeParent: state.excludeParent, exclude: [...state.excluded].map((handle) => ({ handle })) });
  });
  state.registry.add(node);
  return node;
}

/** Runtime ShapeCast2D constructor over the caller's project-owned Rapier world and layer map. */
export function createGodotShapeCast2D(
  options: Omit<BindShapeCast2DOptions, 'node' | 'shape' | 'registry'> & {
    readonly shape?: GodotShape2D | null;
  },
): GodotShapeCast2D {
  return bindShapeCast2D({
    ...options,
    node: new Container(),
    shape: options.shape ?? null,
    registry: new GodotShapeCast2DRegistry(),
  });
}

export function releaseShapeCast2D(node: GodotShapeCast2D): void {
  const state = STATES.get(node);
  if (state === undefined) return;
  state.unregisterDuplicate();
  state.unregisterRelease();
  state.registry.delete(node);
  STATES.delete(node);
}

export class GodotShapeCast2DRegistry {
  private readonly nodes = new Set<GodotShapeCast2D>();
  private destroyed = false;

  add(node: GodotShapeCast2D): void {
    if (this.destroyed) throw new Error('ShapeCast2D registry is already destroyed');
    this.nodes.add(node);
  }
  delete(node: GodotShapeCast2D): void { this.nodes.delete(node); }
  step(): void {
    if (this.destroyed) throw new Error('ShapeCast2D registry is already destroyed');
    for (const node of this.nodes) if (node.enabled && node.parent) update(node);
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const node of [...this.nodes]) releaseShapeCast2D(node);
    this.nodes.clear();
  }
}
