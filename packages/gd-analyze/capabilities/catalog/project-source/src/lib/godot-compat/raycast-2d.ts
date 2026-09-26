/** Godot `RayCast2D` over the project's one native Rapier 2D world. */

import RAPIER from '@dimforge/rapier2d-compat';
import { Container } from 'pixi.js';
import { type CollisionLayers, godotCanCollideWith } from './collision-layers';
import {
  GODOT_3_DUPLICATE_DEFAULT,
  bindGodotCanvasNode2DApi,
  registerCanvasNodeDuplicateFactory,
  registerCanvasNodeRelease,
} from './node';
import {
  getCanvasGlobalPosition2D,
  godotCanvasTransform2D,
  setCanvasGlobalPosition2D,
} from './physics-2d';
import { distanceTo, vec2, type Vector2 } from './vector2';
import { physicsRid2DOfNode } from './physics-query-2d';
import type { GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';

export interface RayCast2DOptions {
  readonly node: Container;
  readonly presentationRoot: Container;
  readonly world: RAPIER.World;
  readonly castTo: { readonly x: number; readonly y: number };
  readonly enabled?: boolean;
  readonly collisionMask?: number;
  readonly collideWithBodies?: boolean;
  readonly collideWithAreas?: boolean;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly registry: GodotRayCast2DRegistry;
}

export type GodotRayCast2D = Container & {
  enabled: boolean;
  cast_to: Vector2;
  target_position: Vector2;
  collision_mask: number;
  collide_with_bodies: boolean;
  collide_with_areas: boolean;
  global_position: Vector2 & { distance_to(other: Readonly<Vector2>): number };
  forceRaycastUpdate(): void;
  isColliding(): boolean;
  getCollisionPoint(): Vector2;
  getCollisionNormal(): Vector2;
  getCollider(): unknown;
  getColliderRid(): GodotRid | null;
  getColliderShape(): number;
  setCollisionMaskValue(layerNumber: number, value: boolean): void;
  getCollisionMaskValue(layerNumber: number): boolean;
  setCollisionMaskBit(bit: number, value: boolean): void;
  getCollisionMaskBit(bit: number): boolean;
  addException(owner: object): void;
  removeException(owner: object): void;
  clearExceptions(): void;
  force_raycast_update(): void;
  is_colliding(): boolean;
  get_collision_point(): Vector2 & { distance_to(other: Readonly<Vector2>): number };
  get_collision_normal(): Vector2;
  get_collider(): unknown;
};

interface RayCast2DState {
  readonly presentationRoot: Container;
  readonly world: RAPIER.World;
  castTo: Vector2;
  enabled: boolean;
  collisionMask: number;
  collideWithBodies: boolean;
  collideWithAreas: boolean;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly registry: GodotRayCast2DRegistry;
  readonly exceptions: Set<object>;
  point: Vector2;
  normal: Vector2;
  collider: RAPIER.Collider | null;
  collided: boolean;
  unregisterDuplicate: () => void;
  unregisterRelease: () => void;
}

const STATES = new WeakMap<Container, RayCast2DState>();

function finiteVector(name: string, value: { readonly x: number; readonly y: number }): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`RayCast2D.${name} must be a Vector2 value`);
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`RayCast2D.${name} must contain finite coordinates`);
  }
  return vec2(value.x, value.y);
}

function booleanProperty(name: string, value: boolean): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`RayCast2D.${name} must be boolean`);
  }
  return value;
}

function collisionMask(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`RayCast2D.collision_mask must be an unsigned 32-bit integer; received ${value}`);
  }
  return value;
}

function stateOf(node: Container): RayCast2DState {
  const state = STATES.get(node);
  if (state === undefined) throw new Error('RayCast2D state was read before bind or after release');
  return state;
}

/**
 * A source-shaped Vector2 for the narrow dynamically typed RayCast child path.
 *
 * Godot 3's `Node.get_child()` is declared to return Node, so Rota's local `r` loses its
 * RayCast2D/Vector2 static types even though the authored child is exact. Keep that source protocol
 * on the branded RayCast object itself instead of weakening the generic Node or Vector2 surfaces.
 */
function dynamicVector2(value: Readonly<Vector2>): Vector2 & {
  distance_to(other: Readonly<Vector2>): number;
} {
  const result = vec2(value.x, value.y) as Vector2 & {
    distance_to(other: Readonly<Vector2>): number;
  };
  Object.defineProperty(result, 'distance_to', {
    enumerable: false,
    value: (other: Readonly<Vector2>) => distanceTo(result, other),
  });
  return result;
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

function update(node: GodotRayCast2D): void {
  const state = stateOf(node);
  // Godot 3.6 ray_cast_2d.cpp:165-189: force_raycast_update ignores `enabled`, while an
  // out-of-tree ray has no World2D/direct state and leaves its previous cache untouched.
  if (!node.parent) return;
  const transform = godotCanvasTransform2D(node, state.presentationRoot);
  const origin = transform.apply({ x: 0, y: 0 });
  // Godot 3.6 ray_cast_2d.cpp:173-176 substitutes (0, 0.01) for a zero cast_to.
  const localTarget =
    state.castTo.x === 0 && state.castTo.y === 0 ? vec2(0, 0.01) : state.castTo;
  const endpoint = transform.apply(localTarget);
  const direction = { x: endpoint.x - origin.x, y: endpoint.y - origin.y };
  const ray = new RAPIER.Ray(origin, direction);
  const hit = state.world.castRayAndGetNormal(
    ray,
    1,
    true,
    state.collideWithBodies && state.collideWithAreas
      ? undefined
      : state.collideWithBodies
        ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
        : state.collideWithAreas
          ? RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS
          : undefined,
    undefined,
    undefined,
    undefined,
    (collider) =>
      (state.collideWithBodies || state.collideWithAreas) &&
      godotCanCollideWith(state.layers, collider, state.collisionMask) &&
      !state.exceptions.has(state.resolveCollider(collider) as object),
  );
  if (hit === null) {
    // Godot 3.6 ray_cast_2d.cpp:185-189 clears collided/collider/shape but deliberately leaves
    // collision_point at the last hit. Scripts may read that cached point after a miss.
    state.collided = false;
    state.collider = null;
    return;
  }
  state.collided = true;
  state.collider = hit.collider;
  state.point = vec2(origin.x + direction.x * hit.timeOfImpact, origin.y + direction.y * hit.timeOfImpact);
  state.normal = vec2(hit.normal.x, hit.normal.y);
}

/** Bind one authored RayCast2D to its retained Pixi node and direct native world. */
export function bindRayCast2D(options: RayCast2DOptions): GodotRayCast2D {
  if (STATES.has(options.node)) throw new Error('RayCast2D node is already bound');
  const node = bindGodotCanvasNode2DApi(options.node) as unknown as GodotRayCast2D;
  registerGodotObjectIdentity(node, 'RayCast2D');
  const state: RayCast2DState = {
    presentationRoot: options.presentationRoot,
    world: options.world,
    castTo: finiteVector('cast_to', options.castTo),
    enabled: booleanProperty('enabled', options.enabled ?? false),
    collisionMask: collisionMask(options.collisionMask ?? 1),
    collideWithBodies: booleanProperty('collide_with_bodies', options.collideWithBodies ?? true),
    collideWithAreas: booleanProperty('collide_with_areas', options.collideWithAreas ?? false),
    layers: options.layers,
    resolveCollider: options.resolveCollider,
    registry: options.registry,
    exceptions: new Set(),
    point: vec2(0, 0),
    normal: vec2(0, 0),
    collider: null,
    collided: false,
    unregisterDuplicate: () => {},
    unregisterRelease: () => {},
  };
  STATES.set(node, state);
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseRayCast2D(node));
  Object.defineProperties(node, {
    enabled: {
      configurable: true,
      get: () => state.enabled,
      set: (value: boolean) => {
        state.enabled = booleanProperty('enabled', value);
        if (!state.enabled) {
          // Godot 3.6 RayCast2D::set_enabled clears only `collided`; the last collider/point cache
          // remains until the next enabled or forced query.
          state.collided = false;
        }
      },
    },
    cast_to: {
      configurable: true,
      get: () => vec2(state.castTo.x, state.castTo.y),
      set: (value: Vector2) => {
        state.castTo = finiteVector('cast_to', value);
      },
    },
    target_position: {
      configurable: true,
      get: () => vec2(state.castTo.x, state.castTo.y),
      set: (value: Vector2) => {
        state.castTo = finiteVector('target_position', value);
      },
    },
    collision_mask: {
      configurable: true,
      get: () => state.collisionMask,
      set: (value: number) => {
        state.collisionMask = collisionMask(value);
      },
    },
    collide_with_bodies: {
      configurable: true,
      get: () => state.collideWithBodies,
      set: (value: boolean) => {
        state.collideWithBodies = booleanProperty('collide_with_bodies', value);
      },
    },
    collide_with_areas: {
      configurable: true,
      get: () => state.collideWithAreas,
      set: (value: boolean) => {
        state.collideWithAreas = booleanProperty('collide_with_areas', value);
      },
    },
    global_position: {
      configurable: true,
      get: () => dynamicVector2(getCanvasGlobalPosition2D(node, state.presentationRoot)),
      set: (value: Vector2) => {
        setCanvasGlobalPosition2D(
          node,
          state.presentationRoot,
          finiteVector('global_position', value),
        );
      },
    },
  });
  node.forceRaycastUpdate = () => update(node);
  node.isColliding = () => state.collided;
  node.getCollisionPoint = () => dynamicVector2(state.point);
  node.getCollisionNormal = () => vec2(state.normal.x, state.normal.y);
  node.getCollider = () =>
    state.collider === null ? null : state.resolveCollider(state.collider);
  node.getColliderRid = () => {
    const owner = node.getCollider();
    return owner === null || owner === undefined ? null : physicsRid2DOfNode(owner as object);
  };
  node.getColliderShape = () => {
    const collider = state.collider;
    if (collider === null) return 0;
    const body = collider.parent();
    if (body === null) return 0;
    for (let index = 0; index < body.numColliders(); index += 1) {
      if (body.collider(index) === collider) return index;
    }
    throw new Error('RayCast2D hit collider is no longer attached to its native Rapier body.');
  };
  node.setCollisionMaskValue = (layerNumber, value) => {
    if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 32) {
      throw new RangeError('RayCast2D collision layer number must be an integer from 1 through 32.');
    }
    if (typeof value !== 'boolean') throw new TypeError('RayCast2D collision mask value must be bool.');
    const bit = 1 << (layerNumber - 1);
    state.collisionMask = value ? (state.collisionMask | bit) >>> 0 : (state.collisionMask & ~bit) >>> 0;
  };
  node.getCollisionMaskValue = (layerNumber) => {
    if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 32) {
      throw new RangeError('RayCast2D collision layer number must be an integer from 1 through 32.');
    }
    return (state.collisionMask & (1 << (layerNumber - 1))) !== 0;
  };
  node.setCollisionMaskBit = (bit, value) => node.setCollisionMaskValue(bit + 1, value);
  node.getCollisionMaskBit = (bit) => node.getCollisionMaskValue(bit + 1);
  node.addException = (owner) => {
    if ((typeof owner !== 'object' && typeof owner !== 'function') || owner === null) {
      throw new TypeError('RayCast2D.add_exception requires a CollisionObject2D owner.');
    }
    state.exceptions.add(owner);
  };
  node.removeException = (owner) => {
    if ((typeof owner !== 'object' && typeof owner !== 'function') || owner === null) {
      throw new TypeError('RayCast2D.remove_exception requires a CollisionObject2D owner.');
    }
    state.exceptions.delete(owner);
  };
  node.clearExceptions = () => state.exceptions.clear();
  // Source spellings remain on this exact branded receiver because Node.get_child erases the
  // static RayCast2D type in Godot 3; generic Node dispatch remains unchanged and fail-closed.
  node.force_raycast_update = node.forceRaycastUpdate;
  node.is_colliding = node.isColliding;
  node.get_collision_point = () => dynamicVector2(node.getCollisionPoint());
  node.get_collision_normal = node.getCollisionNormal;
  node.get_collider = node.getCollider;
  Object.assign(node, {
    set_enabled: (value: boolean): void => { node.enabled = value; },
    is_enabled: (): boolean => node.enabled,
    set_cast_to: (value: Vector2): void => { node.cast_to = value; },
    get_cast_to: (): Vector2 => node.cast_to,
    set_target_position: (value: Vector2): void => { node.target_position = value; },
    get_target_position: (): Vector2 => node.target_position,
    set_collision_mask: (value: number): void => { node.collision_mask = value; },
    get_collision_mask: (): number => node.collision_mask,
    set_collision_mask_value: (layer: number, value: boolean): void => node.setCollisionMaskValue(layer, value),
    get_collision_mask_value: (layer: number): boolean => node.getCollisionMaskValue(layer),
    set_collision_mask_bit: (bit: number, value: boolean): void => node.setCollisionMaskBit(bit, value),
    get_collision_mask_bit: (bit: number): boolean => node.getCollisionMaskBit(bit),
    set_collide_with_bodies: (value: boolean): void => { node.collide_with_bodies = value; },
    is_collide_with_bodies_enabled: (): boolean => node.collide_with_bodies,
    set_collide_with_areas: (value: boolean): void => { node.collide_with_areas = value; },
    is_collide_with_areas_enabled: (): boolean => node.collide_with_areas,
    get_collider_rid: (): GodotRid | null => node.getColliderRid(),
    get_collider_shape: (): number => node.getColliderShape(),
    add_exception: (owner: object): void => node.addException(owner),
    remove_exception: (owner: object): void => node.removeException(owner),
    clear_exceptions: (): void => node.clearExceptions(),
  });
  state.unregisterDuplicate = registerCanvasNodeDuplicateFactory(node, (flags) => {
    if (flags !== GODOT_3_DUPLICATE_DEFAULT) {
      throw new Error(`RayCast2D.duplicate(${flags}) supports only default Godot 3 flags`);
    }
    const clone = new Container();
    copyDisplayState(node, clone);
    return bindRayCast2D({
      node: clone,
      presentationRoot: state.presentationRoot,
      world: state.world,
      castTo: state.castTo,
      enabled: state.enabled,
      collisionMask: state.collisionMask,
      collideWithBodies: state.collideWithBodies,
      collideWithAreas: state.collideWithAreas,
      layers: state.layers,
      resolveCollider: state.resolveCollider,
      registry: state.registry,
    });
  });
  options.registry.add(node);
  return node;
}

/** Runtime RayCast2D constructor over the caller's existing native Rapier/Pixi scene carriers. */
export function createGodotRayCast2D(
  options: Omit<RayCast2DOptions, 'node' | 'castTo' | 'registry'>,
): GodotRayCast2D {
  const node = new Container();
  return bindRayCast2D({
    ...options,
    node,
    castTo: { x: 0, y: 50 },
    registry: new GodotRayCast2DRegistry(),
  });
}

/** Idempotent scene teardown; the native world is borrowed and remains project-owned. */
export function releaseRayCast2D(node: GodotRayCast2D): void {
  const state = STATES.get(node);
  if (state === undefined) return;
  state.unregisterDuplicate();
  state.unregisterRelease();
  state.registry.delete(node);
  STATES.delete(node);
}

/** Scene-owned lifecycle registry; dynamically cloned child rays join the same teardown. */
export class GodotRayCast2DRegistry {
  private readonly nodes = new Set<GodotRayCast2D>();
  private destroyed = false;

  add(node: GodotRayCast2D): void {
    if (this.destroyed) throw new Error('RayCast2D registry is already destroyed');
    this.nodes.add(node);
  }

  delete(node: GodotRayCast2D): void {
    this.nodes.delete(node);
  }

  /** Cache every enabled in-tree ray once per project physics frame, as Godot does. */
  step(): void {
    if (this.destroyed) throw new Error('RayCast2D registry is already destroyed');
    for (const node of this.nodes) {
      const state = stateOf(node);
      if (state.enabled && node.parent) update(node);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const node of [...this.nodes]) releaseRayCast2D(node);
    this.nodes.clear();
  }
}
