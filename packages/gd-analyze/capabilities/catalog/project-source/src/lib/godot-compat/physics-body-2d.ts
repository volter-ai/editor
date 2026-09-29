/**
 * @godot-class PhysicsBody2D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsBody2D` (`scene/2d/physics/physics_body_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a body's motion against the others it collides with
 * (`collision-object-2d.ts` tests their shapes). `move_and_collide` moves the body and, where it
 * ends inside another, pushes it back out along the contact's normal, reporting the collision.
 */

import type { Object3D } from 'three';
import { godot_physics_2d_contacts } from './collision-object-2d';
import { godot_kinematic_collision_2d_new, type KinematicCollision2D } from './kinematic-collision-2d';
import { get_global_position, set_global_position } from './node-2d';
import { godot_node_entity, godot_node_object } from './node';
import { get_setting } from './project-settings';
import { construct as vector2, type Vector2 } from './vector2';

/**
 * Moves a body by `motion` and resolves its deepest contact (`_move`, `physics_body_2d.cpp:79`,
 * over `GodotSpace2D::test_body_motion`): the collision, or null with the whole motion made. With
 * `test_only`, the body is put back.
 *
 * @godot PhysicsBody2D (protocol)
 * @source scene/2d/physics/physics_body_2d.cpp:79
 */
export function godot_physics_body_2d_move(entity: Object3D, motion: Vector2, test_only = false, safe_margin = 0.08): KinematicCollision2D | null {
  const start = get_global_position(entity);
  set_global_position(entity, vector2(start.x + motion.x, start.y + motion.y));
  let deepest: ReturnType<typeof godot_physics_2d_contacts>[number] | undefined;
  for (const contact of godot_physics_2d_contacts(entity)) if (deepest === undefined || contact.depth > deepest.depth) deepest = contact;
  if (deepest === undefined || deepest.depth <= safe_margin * 0.01) {
    if (test_only) set_global_position(entity, start);
    return null;
  }
  const [nx, ny] = deepest.normal;
  const moved = get_global_position(entity);
  const back = vector2(moved.x + nx * deepest.depth, moved.y + ny * deepest.depth);
  const travel = vector2(back.x - start.x, back.y - start.y);
  const collision = godot_kinematic_collision_2d_new({
    collider: godot_node_object(deepest.other),
    normal: vector2(nx, ny),
    position: vector2(back.x - nx * deepest.depth, back.y - ny * deepest.depth),
    travel,
    remainder: vector2(motion.x - travel.x, motion.y - travel.y),
    colliderVelocity: vector2(),
    depth: deepest.depth,
  });
  set_global_position(entity, test_only ? start : back);
  return collision;
}

/**
 * @godot PhysicsBody2D.move_and_collide
 * @source scene/2d/physics/physics_body_2d.cpp:53
 */
export function move_and_collide(self: object, motion: Vector2, test_only = false, safe_margin = 0.08, recovery_as_collision = false): KinematicCollision2D | null {
  void recovery_as_collision;
  return godot_physics_body_2d_move(godot_node_entity(self) as Object3D, motion, test_only, safe_margin);
}

/**
 * @godot PhysicsBody2D.test_move
 * @source scene/2d/physics/physics_body_2d.cpp:116
 */
export function test_move(self: object, from: unknown, motion: Vector2): boolean {
  void from;
  return godot_physics_body_2d_move(godot_node_entity(self) as Object3D, motion, true) !== null;
}

/**
 * @godot PhysicsBody2D.get_gravity
 * @source scene/2d/physics/physics_body_2d.cpp:150
 */
export function get_gravity(self: object): Vector2 {
  void self;
  return godot_physics_2d_gravity();
}

/**
 * The default gravity (`physics/2d/default_gravity` along `default_gravity_vector`).
 *
 * @godot PhysicsBody2D (protocol)
 * @source servers/physics_2d/godot_space_2d.cpp:1260
 */
export function godot_physics_2d_gravity(): Vector2 {
  const strength = get_setting('physics/2d/default_gravity', 980) as number;
  const direction = get_setting('physics/2d/default_gravity_vector', vector2(0, 1)) as Vector2;
  return vector2(direction.x * strength, direction.y * strength);
}
