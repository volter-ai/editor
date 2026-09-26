import type { CollisionObjectBody } from './collision-exceptions';
import {
  getCollisionLayer,
  getCollisionMask,
  setCollisionLayer,
  setCollisionMask,
} from './physics-body-3d';
import { physicsArea3DOfNode, physicsAreaRid3DOf } from './physics-query-3d';
import {
  physicsServerAreaGetCollisionLayer3D,
  physicsServerAreaGetCollisionMask3D,
  physicsServerAreaSetCollisionLayer3D,
  physicsServerAreaSetCollisionMask3D,
  type PhysicsServerArea3DOptions,
} from './physics-server-area-3d';

/** Layer access shared by retained Rapier bodies and registered Area3D sensor identities. */
export function getCollisionObjectLayer3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
): number {
  if (physicsArea3DOfNode(node) !== undefined) {
    return physicsServerAreaGetCollisionLayer3D(options, physicsAreaRid3DOf(node));
  }
  return getCollisionLayer(retainedCollisionObjectBody3D(identity), options.layers);
}

/** Live layer mutation over the body's colliders or the Area3D PhysicsServer registration. */
export function setCollisionObjectLayer3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
  value: number,
): void {
  if (physicsArea3DOfNode(node) !== undefined) {
    physicsServerAreaSetCollisionLayer3D(options, physicsAreaRid3DOf(node), value);
    return;
  }
  setCollisionLayer(retainedCollisionObjectBody3D(identity), options.layers, value);
}

function collisionBitIndex(value: unknown, oneBased: boolean, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${member} requires an integer layer index.`);
  }
  const index = oneBased ? value - 1 : value;
  if (index < 0 || index > 31) {
    throw new RangeError(`${member} layer index must be ${oneBased ? '1..32' : '0..31'}.`);
  }
  return index;
}

export function getCollisionObjectLayerBit3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
  index: unknown,
  oneBased: boolean,
): boolean {
  const bit = collisionBitIndex(index, oneBased, 'CollisionObject.get_collision_layer');
  return (getCollisionObjectLayer3D(identity, node, options) & (2 ** bit)) !== 0;
}

export function setCollisionObjectLayerBit3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
  index: unknown,
  enabled: unknown,
  oneBased: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject layer setter requires bool.');
  const bit = collisionBitIndex(index, oneBased, 'CollisionObject.set_collision_layer');
  const mask = 2 ** bit;
  const current = getCollisionObjectLayer3D(identity, node, options);
  setCollisionObjectLayer3D(identity, node, options, enabled ? (current | mask) >>> 0 : (current & ~mask) >>> 0);
}

export function getCollisionObjectMaskBit3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
  index: unknown,
  oneBased: boolean,
): boolean {
  const bit = collisionBitIndex(index, oneBased, 'CollisionObject.get_collision_mask');
  return (getCollisionObjectMask3D(identity, node, options) & (2 ** bit)) !== 0;
}

export function setCollisionObjectMaskBit3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
  index: unknown,
  enabled: unknown,
  oneBased: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject mask setter requires bool.');
  const bit = collisionBitIndex(index, oneBased, 'CollisionObject.set_collision_mask');
  const mask = 2 ** bit;
  const current = getCollisionObjectMask3D(identity, node, options);
  setCollisionObjectMask3D(identity, node, options, enabled ? (current | mask) >>> 0 : (current & ~mask) >>> 0);
}

function isNativeBody(value: unknown): value is CollisionObjectBody {
  return typeof value === 'object' && value !== null &&
    'numColliders' in value && typeof value.numColliders === 'function' &&
    'collider' in value && typeof value.collider === 'function';
}

/**
 * Resolve the one retained Rapier body behind a Godot 3 `CollisionObject` identity. Emitted body
 * scenes expose that carrier directly (`body`) or through their direct-state (`state.body`), while
 * Area nodes own it through the PhysicsServer Area registry. No default object is fabricated: an
 * unbound node is a translation/runtime seam error and fails at the member that needed it.
 */
function retainedCollisionObjectBody3D(identity: unknown): CollisionObjectBody {
  if (isNativeBody(identity)) return identity;
  if (typeof identity === 'object' && identity !== null) {
    const direct = Reflect.get(identity, 'body') as unknown;
    if (isNativeBody(direct)) return direct;
    const state = Reflect.get(identity, 'state') as unknown;
    if (typeof state === 'object' && state !== null) {
      const integrated = Reflect.get(state, 'body') as unknown;
      if (isNativeBody(integrated)) return integrated;
    }
  }
  throw new Error(
    'CollisionObject.collision_mask requires a live retained 3D Rapier body or registered Area sensor binding',
  );
}

/** Godot 3 `collision_mask` / `get_collision_mask()` on the actual retained collider set. */
export function getCollisionObjectMask3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
): number {
  if (physicsArea3DOfNode(node) !== undefined) {
    return physicsServerAreaGetCollisionMask3D(options, physicsAreaRid3DOf(node));
  }
  return getCollisionMask(retainedCollisionObjectBody3D(identity), options.layers);
}

/** Godot 3 `collision_mask = value` / `set_collision_mask(value)` on every retained collider. */
export function setCollisionObjectMask3D(
  identity: unknown,
  node: object,
  options: PhysicsServerArea3DOptions,
  value: number,
): void {
  if (physicsArea3DOfNode(node) !== undefined) {
    physicsServerAreaSetCollisionMask3D(options, physicsAreaRid3DOf(node), value);
    return;
  }
  setCollisionMask(retainedCollisionObjectBody3D(identity), options.layers, value);
}
