/** Godot PhysicsDirectSpaceState2DExtension raw query protocol. */

import { registerGodotObjectIdentity } from './object';
import type { GodotPhysicsRID } from './physics-direct-body-state-2d-extension';
import type { GodotTransform2D } from './transform-2d';
import type { Vector2 } from './vector2';

export interface GodotPhysicsRayResult2DOutput { [key: string]: unknown }
export interface GodotPhysicsShapeResult2DOutput { [key: string]: unknown }
export interface GodotPhysicsShapeRestInfo2DOutput { [key: string]: unknown }
export interface GodotPhysicsMotionResult2DOutput { closestSafe: number; closestUnsafe: number }

export interface GodotPhysicsDirectSpaceState2DExtensionHooks {
  _intersect_ray(from: Vector2, to: Vector2, collisionMask: number, bodies: boolean, areas: boolean, hitInside: boolean, result: GodotPhysicsRayResult2DOutput): boolean;
  _intersect_point(position: Vector2, canvasInstanceId: number, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult2DOutput[], maxResults: number): number;
  _intersect_shape(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult2DOutput[], maxResults: number): number;
  _cast_motion(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsMotionResult2DOutput): boolean;
  _collide_shape(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: unknown[], maxResults: number): boolean;
  _rest_info(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsShapeRestInfo2DOutput): boolean;
  is_body_excluded_from_query(body: GodotPhysicsRID): boolean;
}

export class GodotPhysicsDirectSpaceState2DExtension {
  constructor(private readonly hooks: GodotPhysicsDirectSpaceState2DExtensionHooks) {
    registerGodotObjectIdentity(this, 'PhysicsDirectSpaceState2DExtension');
  }
  _intersect_ray(from: Vector2, to: Vector2, collisionMask: number, bodies: boolean, areas: boolean, hitInside: boolean, result: GodotPhysicsRayResult2DOutput): boolean {
    return Boolean(this.hooks._intersect_ray(from, to, this.mask(collisionMask), bodies, areas, hitInside, result));
  }
  _intersect_point(position: Vector2, canvasInstanceId: number, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult2DOutput[], maxResults: number): number {
    return this.count(this.hooks._intersect_point(position, canvasInstanceId, this.mask(collisionMask), bodies, areas, results, this.maximum(maxResults)), maxResults);
  }
  _intersect_shape(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: GodotPhysicsShapeResult2DOutput[], maxResults: number): number {
    return this.count(this.hooks._intersect_shape(shape, transform, motion, this.margin(margin), this.mask(collisionMask), bodies, areas, results, this.maximum(maxResults)), maxResults);
  }
  _cast_motion(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsMotionResult2DOutput): boolean {
    return Boolean(this.hooks._cast_motion(shape, transform, motion, this.margin(margin), this.mask(collisionMask), bodies, areas, result));
  }
  _collide_shape(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, results: unknown[], maxResults: number): boolean {
    return Boolean(this.hooks._collide_shape(shape, transform, motion, this.margin(margin), this.mask(collisionMask), bodies, areas, results, this.maximum(maxResults)));
  }
  _rest_info(shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, margin: number, collisionMask: number, bodies: boolean, areas: boolean, result: GodotPhysicsShapeRestInfo2DOutput): boolean {
    return Boolean(this.hooks._rest_info(shape, transform, motion, this.margin(margin), this.mask(collisionMask), bodies, areas, result));
  }
  is_body_excluded_from_query(body: GodotPhysicsRID): boolean { return Boolean(this.hooks.is_body_excluded_from_query(body)); }
  private mask(value: number): number { if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('Physics query mask requires unsigned 32-bit int.'); return value; }
  private margin(value: number): number { if (!Number.isFinite(value) || value < 0) throw new RangeError('Physics query margin requires non-negative float.'); return value; }
  private maximum(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Physics query max_results requires non-negative int.'); return value; }
  private count(value: number, maximum: number): number { const count = Math.trunc(value); if (count < 0 || count > maximum) throw new RangeError('Physics query result count exceeds max_results.'); return count; }
}

export function createGodotPhysicsDirectSpaceState2DExtension(hooks: GodotPhysicsDirectSpaceState2DExtensionHooks): GodotPhysicsDirectSpaceState2DExtension { return new GodotPhysicsDirectSpaceState2DExtension(hooks); }
