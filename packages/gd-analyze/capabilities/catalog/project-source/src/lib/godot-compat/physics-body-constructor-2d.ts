/** Runtime PhysicsBody2D constructors that retain one Pixi identity and its native Rapier owner. */
import RAPIER from '@dimforge/rapier2d-compat';
import { Container } from 'pixi.js';
import type { CollisionLayers } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';
import { registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';
import { registerShapeCastBody2D, unregisterShapeCastBody2D } from './physics-query-2d';

export interface PhysicsBody2DConstructorOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly colliders: GodotMutableColliderRegistry<RAPIER.Collider, GodotColliderOwner>;
}

function createBody(
  options: PhysicsBody2DConstructorOptions,
  godotClass: 'RigidBody2D' | 'StaticBody2D',
): Container {
  const node = new Container();
  registerGodotObjectIdentity(node, godotClass);
  const descriptor = godotClass === 'RigidBody2D'
    ? RAPIER.RigidBodyDesc.dynamic()
    : RAPIER.RigidBodyDesc.fixed();
  const body = options.world.createRigidBody(descriptor);
  Object.defineProperty(node, 'body', { configurable: false, enumerable: false, value: body });
  // An empty Godot body has no shape. The disabled carrier preserves body identity without
  // participating in queries or contacts until a runtime CollisionShape2D replaces it.
  const collider = options.world.createCollider(RAPIER.ColliderDesc.ball(Number.EPSILON), body);
  collider.setEnabled(false);
  options.layers.set(collider, 1, 1);
  options.colliders.set(collider, node);
  registerShapeCastBody2D(node, body);
  registerCanvasNodeRelease(node, () => {
    unregisterShapeCastBody2D(node, body);
    options.colliders.delete(collider);
    options.world.removeRigidBody(body);
  });
  return node;
}

export function createGodotRigidBody2D(options: PhysicsBody2DConstructorOptions): Container {
  return createBody(options, 'RigidBody2D');
}

export function createGodotStaticBody2D(options: PhysicsBody2DConstructorOptions): Container {
  return createBody(options, 'StaticBody2D');
}
