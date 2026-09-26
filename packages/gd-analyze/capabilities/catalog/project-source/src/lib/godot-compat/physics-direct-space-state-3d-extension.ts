/** Godot PhysicsDirectSpaceState3DExtension raw query protocol. */

import { Matrix4, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import type { GodotPhysicsRID } from './physics-direct-body-state-2d-extension';

export interface GodotPhysicsRayResult3DOutput { [key: string]: unknown }
export interface GodotPhysicsShapeResult3DOutput { [key: string]: unknown }
export interface GodotPhysicsShapeRestInfo3DOutput { [key: string]: unknown }
export interface GodotPhysicsMotionResult3DOutput { closestSafe: number; closestUnsafe: number; restInfo?: GodotPhysicsShapeRestInfo3DOutput }

export interface GodotPhysicsDirectSpaceState3DExtensionHooks {
  _intersect_ray(from: Vector3, to: Vector3, collisionMask: number, bodies: boolean, areas: boolean, hitInside: boolean, hitBackFaces: boolean, pickRay: boolean, result: GodotPhysicsRayResult3DOutput): boolean;
  _intersect_point(position: Vector3, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult3DOutput[], maxResults: number): number;
  _intersect_shape(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult3DOutput[], maxResults: number): number;
  _cast_motion(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsMotionResult3DOutput): boolean;
  _collide_shape(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: unknown[], maxResults: number): boolean;
  _rest_info(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsShapeRestInfo3DOutput): boolean;
  _get_closest_point_to_object_volume(object: GodotPhysicsRID, point: Vector3): Vector3;
  is_body_excluded_from_query(body: GodotPhysicsRID): boolean;
}

export class GodotPhysicsDirectSpaceState3DExtension {
  constructor(private readonly hooks: GodotPhysicsDirectSpaceState3DExtensionHooks) {
    registerGodotObjectIdentity(this, 'PhysicsDirectSpaceState3DExtension');
  }
  _intersect_ray(from: Vector3, to: Vector3, collisionMask: number, bodies: boolean, areas: boolean, hitInside: boolean, hitBackFaces: boolean, pickRay: boolean, result: GodotPhysicsRayResult3DOutput): boolean {
    return Boolean(this.hooks._intersect_ray(from.clone(), to.clone(), this.mask(collisionMask), bodies, areas, hitInside, hitBackFaces, pickRay, result));
  }
  _intersect_point(position: Vector3, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult3DOutput[], maxResults: number): number {
    return this.count(this.hooks._intersect_point(position.clone(), this.mask(collisionMask), bodies, areas, results, this.maximum(maxResults)), maxResults);
  }
  _intersect_shape(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult3DOutput[], maxResults: number): number {
    return this.count(this.hooks._intersect_shape(shape, transform.clone(), motion.clone(), this.margin(margin), this.mask(collisionMask), bodies, areas, results, this.maximum(maxResults)), maxResults);
  }
  _cast_motion(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsMotionResult3DOutput): boolean {
    return Boolean(this.hooks._cast_motion(shape, transform.clone(), motion.clone(), this.margin(margin), this.mask(collisionMask), bodies, areas, result));
  }
  _collide_shape(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: unknown[], maxResults: number): boolean {
    return Boolean(this.hooks._collide_shape(shape, transform.clone(), motion.clone(), this.margin(margin), this.mask(collisionMask), bodies, areas, results, this.maximum(maxResults)));
  }
  _rest_info(shape: GodotPhysicsRID, transform: Matrix4, motion: Vector3, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsShapeRestInfo3DOutput): boolean {
    return Boolean(this.hooks._rest_info(shape, transform.clone(), motion.clone(), this.margin(margin), this.mask(collisionMask), bodies, areas, result));
  }
  _get_closest_point_to_object_volume(object: GodotPhysicsRID, point: Vector3): Vector3 {
    const value = this.hooks._get_closest_point_to_object_volume(object, point.clone());
    if (!(value instanceof Vector3)) throw new TypeError('Physics closest point requires Vector3.');
    return value.clone();
  }
  is_body_excluded_from_query(body: GodotPhysicsRID): boolean { return Boolean(this.hooks.is_body_excluded_from_query(body)); }
  private mask(value: number): number { if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('Physics query mask requires unsigned 32-bit int.'); return value; }
  private margin(value: number): number { if (!Number.isFinite(value) || value < 0) throw new RangeError('Physics query margin requires non-negative float.'); return value; }
  private maximum(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Physics query max_results requires non-negative int.'); return value; }
  private count(value: number, maximum: number): number { const count = Math.trunc(value); if (count < 0 || count > maximum) throw new RangeError('Physics query result count exceeds max_results.'); return count; }
}

export function createGodotPhysicsDirectSpaceState3DExtension(hooks: GodotPhysicsDirectSpaceState3DExtensionHooks): GodotPhysicsDirectSpaceState3DExtension { return new GodotPhysicsDirectSpaceState3DExtension(hooks); }
