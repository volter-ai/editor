import RAPIER from '@dimforge/rapier2d-compat';
import type { GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId, registerGodotObjectIdentity } from './object';
import { createPhysicsDirectSpaceState2D, physicsBody2DOfRid, physicsRid2DOf, type PhysicsDirectSpaceState2D } from './physics-query-2d';
import {
  physicsServerBodyAddConstantCentralForce2D,
  physicsServerBodyAddConstantForce2D,
  physicsServerBodyAddConstantTorque2D,
  physicsServerBodyApplyCentralForce2D,
  physicsServerBodyApplyCentralImpulse2D,
  physicsServerBodyApplyForce2D,
  physicsServerBodyApplyImpulse2D,
  physicsServerBodyApplyTorque2D,
  physicsServerBodyApplyTorqueImpulse2D,
  physicsServerBodyGetCollisionLayer2D,
  physicsServerBodyGetCollisionMask2D,
  physicsServerBodyGetConstantForce2D,
  physicsServerBodyGetConstantTorque2D,
  physicsServerBodyGetMaxContactsReported2D,
  physicsServerBodyGetShapeMetadata2D,
  physicsServerBodyGetParam2D,
  physicsServerBodyGetState2D,
  physicsServerBodySetCollisionLayer2D,
  physicsServerBodySetCollisionMask2D,
  physicsServerBodySetConstantForce2D,
  physicsServerBodySetConstantTorque2D,
  physicsServerBodySetState2D,
  type PhysicsServerBody2DOptions,
} from './physics-server-2d';
import type { GodotTransform2D } from './transform-2d';
import { vec2, type Vector2 } from './vector2';

interface BodyContact2D {
  readonly mine: RAPIER.Collider;
  readonly other: RAPIER.Collider;
  readonly mineIndex: number;
  readonly otherIndex: number;
  readonly point: Vector2;
  readonly otherPoint: Vector2;
  readonly normal: Vector2;
  readonly impulse: number;
  readonly depth: number;
}

function worldPoint(collider: RAPIER.Collider, point: Readonly<Vector2>): Vector2 {
  const angle = collider.rotation();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const origin = collider.translation();
  return vec2(origin.x + point.x * c - point.y * s, origin.y + point.x * s + point.y * c);
}

function velocityAt(body: RAPIER.RigidBody | null, point: Readonly<Vector2>): Vector2 {
  if (body === null) return vec2(0, 0);
  const velocity = body.linvel();
  const center = body.worldCom();
  const angular = body.angvel();
  return vec2(velocity.x - angular * (point.y - center.y), velocity.y + angular * (point.x - center.x));
}

function contacts(options: PhysicsServerBody2DOptions, body: RAPIER.RigidBody, limit: number): BodyContact2D[] {
  if (limit === 0) return [];
  const result: BodyContact2D[] = [];
  for (let mineIndex = 0; mineIndex < body.numColliders(); mineIndex += 1) {
    const mine = body.collider(mineIndex);
    options.world.contactPairsWith(mine, (other) => {
      options.world.contactPair(mine, other, (manifold, flipped) => {
        const manifoldNormal = manifold.normal();
        const normal = flipped ? vec2(manifoldNormal.x, manifoldNormal.y) : vec2(-manifoldNormal.x, -manifoldNormal.y);
        const otherBody = other.parent();
        let otherIndex = -1;
        if (otherBody !== null) {
          for (let index = 0; index < otherBody.numColliders(); index += 1) if (otherBody.collider(index).handle === other.handle) otherIndex = index;
        }
        for (let index = 0; index < manifold.numContacts(); index += 1) {
          const localMine = (flipped ? manifold.localContactPoint2(index) : manifold.localContactPoint1(index));
          const localOther = (flipped ? manifold.localContactPoint1(index) : manifold.localContactPoint2(index));
          if (localMine === null || localOther === null) continue;
          result.push({
            mine,
            other,
            mineIndex,
            otherIndex,
            point: worldPoint(mine, localMine),
            otherPoint: worldPoint(other, localOther),
            normal,
            impulse: manifold.contactImpulse(index),
            depth: -manifold.contactDist(index),
          });
        }
      });
    });
  }
  result.sort((a, b) => b.depth - a.depth);
  return result.slice(0, limit);
}

export interface PhysicsDirectBodyState2D {
  getStep(): number; getTotalGravity(): Vector2; getTotalLinearDamp(): number; getTotalAngularDamp(): number;
  getCenterOfMass(): Vector2; getCenterOfMassLocal(): Vector2; getInverseMass(): number; getInverseInertia(): number;
  getLinearVelocity(): Vector2; setLinearVelocity(value: Vector2): void; getAngularVelocity(): number; setAngularVelocity(value: number): void;
  getTransform(): GodotTransform2D; setTransform(value: GodotTransform2D): void; getVelocityAtLocalPosition(value: Vector2): Vector2;
  applyCentralImpulse(value: Vector2): void; applyTorqueImpulse(value: number): void; applyImpulse(value: Vector2, position?: Vector2): void;
  applyCentralForce(value: Vector2): void; applyForce(value: Vector2, position?: Vector2): void; applyTorque(value: number): void;
  addConstantCentralForce(value: Vector2): void; addConstantForce(value: Vector2, position?: Vector2): void; addConstantTorque(value: number): void;
  setConstantForce(value: Vector2): void; getConstantForce(): Vector2; setConstantTorque(value: number): void; getConstantTorque(): number;
  setSleepState(value: boolean): void; isSleeping(): boolean; setCollisionLayer(value: number): void; getCollisionLayer(): number;
  setCollisionMask(value: number): void; getCollisionMask(): number; getContactCount(): number; getContactLocalPosition(index: number): Vector2;
  getContactLocalNormal(index: number): Vector2; getContactLocalShape(index: number): number; getContactLocalVelocityAtPosition(index: number): Vector2;
  getContactCollider(index: number): GodotRid; getContactColliderPosition(index: number): Vector2; getContactColliderId(index: number): bigint;
  getContactColliderObject(index: number): unknown; getContactColliderShape(index: number): number;
  getContactColliderVelocityAtPosition(index: number): Vector2; getContactImpulse(index: number): Vector2; integrateForces(): void;
  getContactColliderShapeMetadata(index: number): unknown; getSpaceState(): PhysicsDirectSpaceState2D;
}

export function createPhysicsDirectBodyState2D(options: PhysicsServerBody2DOptions, major: 3 | 4, rid: GodotRid): PhysicsDirectBodyState2D {
  const body = physicsBody2DOfRid(rid);
  if (options.world.getRigidBody(body.handle) !== body) throw new Error('PhysicsServer2D body RID belongs to a different registered native space');
  const contact = (index: number): BodyContact2D => {
    const value = contacts(options, body, physicsServerBodyGetMaxContactsReported2D(options, rid))[index];
    if (value === undefined) throw new RangeError(`PhysicsDirectBodyState2D contact index ${String(index)} is outside the reported contacts`);
    return value;
  };
  const getTransform = (): GodotTransform2D => physicsServerBodyGetState2D(options, rid, 0) as GodotTransform2D;
  const getColliderObject = (index: number): unknown => {
    if (options.resolveCollider === undefined) throw new Error('PhysicsDirectBodyState2D collider object requires the native collider registry');
    return options.resolveCollider(contact(index).other);
  };
  const api: PhysicsDirectBodyState2D = {
    getStep: () => options.world.timestep,
    getTotalGravity: () => { const scale = physicsServerBodyGetParam2D(options, 4, rid, 5) as number; return vec2(options.world.gravity.x * scale, options.world.gravity.y * scale); },
    getTotalLinearDamp: () => physicsServerBodyGetParam2D(options, 4, rid, 8) as number,
    getTotalAngularDamp: () => physicsServerBodyGetParam2D(options, 4, rid, 9) as number,
    getCenterOfMass: () => { const value = body.worldCom(); return vec2(value.x, value.y); },
    getCenterOfMassLocal: () => { const value = body.localCom(); return vec2(value.x, value.y); },
    getInverseMass: () => body.mass() === 0 ? 0 : 1 / body.mass(),
    getInverseInertia: () => body.principalInertia() === 0 ? 0 : 1 / body.principalInertia(),
    getLinearVelocity: () => physicsServerBodyGetState2D(options, rid, 1) as Vector2,
    setLinearVelocity: (value) => physicsServerBodySetState2D(options, rid, 1, value),
    getAngularVelocity: () => physicsServerBodyGetState2D(options, rid, 2) as number,
    setAngularVelocity: (value) => physicsServerBodySetState2D(options, rid, 2, value),
    getTransform, setTransform: (value) => physicsServerBodySetState2D(options, rid, 0, value),
    getVelocityAtLocalPosition: (value) => { const transform = getTransform(); return velocityAt(body, vec2(transform.origin.x + value.x * transform.x.x - value.y * transform.x.y, transform.origin.y + value.x * transform.x.y + value.y * transform.x.x)); },
    applyCentralImpulse: (value) => physicsServerBodyApplyCentralImpulse2D(options, rid, value),
    applyTorqueImpulse: (value) => physicsServerBodyApplyTorqueImpulse2D(options, rid, value),
    applyImpulse: (value, position = vec2(0, 0)) => physicsServerBodyApplyImpulse2D(options, rid, value, position),
    applyCentralForce: (value) => physicsServerBodyApplyCentralForce2D(options, rid, value),
    applyForce: (value, position = vec2(0, 0)) => physicsServerBodyApplyForce2D(options, rid, value, position),
    applyTorque: (value) => physicsServerBodyApplyTorque2D(options, rid, value),
    addConstantCentralForce: (value) => physicsServerBodyAddConstantCentralForce2D(options, rid, value),
    addConstantForce: (value, position = vec2(0, 0)) => physicsServerBodyAddConstantForce2D(options, rid, value, position),
    addConstantTorque: (value) => physicsServerBodyAddConstantTorque2D(options, rid, value),
    setConstantForce: (value) => physicsServerBodySetConstantForce2D(options, rid, value), getConstantForce: () => physicsServerBodyGetConstantForce2D(options, rid),
    setConstantTorque: (value) => physicsServerBodySetConstantTorque2D(options, rid, value), getConstantTorque: () => physicsServerBodyGetConstantTorque2D(options, rid),
    setSleepState: (value) => physicsServerBodySetState2D(options, rid, 3, value), isSleeping: () => physicsServerBodyGetState2D(options, rid, 3) as boolean,
    setCollisionLayer: (value) => physicsServerBodySetCollisionLayer2D(options, rid, value), getCollisionLayer: () => physicsServerBodyGetCollisionLayer2D(options, rid),
    setCollisionMask: (value) => physicsServerBodySetCollisionMask2D(options, rid, value), getCollisionMask: () => physicsServerBodyGetCollisionMask2D(options, rid),
    getContactCount: () => contacts(options, body, physicsServerBodyGetMaxContactsReported2D(options, rid)).length,
    getContactLocalPosition: (index) => contact(index).point, getContactLocalNormal: (index) => contact(index).normal,
    getContactLocalShape: (index) => contact(index).mineIndex, getContactLocalVelocityAtPosition: (index) => velocityAt(body, contact(index).point),
    getContactCollider: (index) => physicsRid2DOf(contact(index).other), getContactColliderPosition: (index) => contact(index).otherPoint,
    getContactColliderId: (index) => godotObjectInstanceId(getColliderObject(index) as object), getContactColliderObject: getColliderObject,
    getContactColliderShape: (index) => contact(index).otherIndex,
    getContactColliderShapeMetadata: (index) => { const value = contact(index); return physicsServerBodyGetShapeMetadata2D(options, physicsRid2DOf(value.other), value.otherIndex); },
    getContactColliderVelocityAtPosition: (index) => { const value = contact(index); return velocityAt(value.other.parent(), value.otherPoint); },
    getContactImpulse: (index) => { const value = contact(index); return vec2(value.normal.x * value.impulse, value.normal.y * value.impulse); },
    integrateForces: () => {
      const gravityScale = physicsServerBodyGetParam2D(options, 4, rid, 5) as number;
      const linearDamp = physicsServerBodyGetParam2D(options, 4, rid, 8) as number;
      const angularDamp = physicsServerBodyGetParam2D(options, 4, rid, 9) as number;
      const dt = options.world.timestep;
      const velocity = body.linvel();
      const linearFactor = Math.max(1 - linearDamp * dt, 0);
      body.setLinvel(vec2((velocity.x + options.world.gravity.x * gravityScale * dt) * linearFactor, (velocity.y + options.world.gravity.y * gravityScale * dt) * linearFactor), true);
      body.setAngvel(body.angvel() * Math.max(1 - angularDamp * dt, 0), true);
    },
    getSpaceState: () => createPhysicsDirectSpaceState2D(options.world, { layers: options.layers, resolveCollider: options.resolveCollider ?? (() => null) }),
  };
  registerGodotObjectIdentity(api, major === 3 ? 'Physics2DDirectBodyState' : 'PhysicsDirectBodyState2D');
  return api;
}

export function physicsServerBodyGetDirectState2D(options: PhysicsServerBody2DOptions, major: 3 | 4, rid: GodotRid): PhysicsDirectBodyState2D {
  return createPhysicsDirectBodyState2D(options, major, rid);
}
