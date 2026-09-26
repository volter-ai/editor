/** Runtime CharacterBody3D/KinematicBody construction over the existing Three/Rapier character owner. */

import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D, Vector3 as ThreeVector3 } from 'three';
import {
  getCollisionShape3DShape,
  isCollisionShape3DEnabled,
  isGodotCollisionShape3DNode,
} from './collider-3d';
import type { CollisionLayers } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';
import {
  createCharacterController,
  createKinematicBody,
  createKinematicRigidBody,
  seedKinematicBody,
  type KinematicBody,
} from './kinematic-body-3d';
import { registerGodotThreeNodeRelease } from './node-3d';
import { registerGodotObjectIdentity } from './object';
import {
  isGodotShape3D,
  releaseGodotShape3D,
  retainGodotShape3D,
  type GodotShape3D,
} from './shape-3d';
import { setGlobalPosition } from './spatial';
import { VECTOR3_ZERO, type Vector3, vec3 } from './variant-3d';

export interface DynamicCharacterBody3DContext {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly colliders: GodotMutableColliderRegistry<RAPIER.Collider, GodotColliderOwner>;
  readonly exceptions?: { has(a: number, b: number): boolean };
}

export interface AuthoredDynamicCharacterBody3D {
  readonly layer?: number;
  readonly mask?: number;
  readonly floorSnapLength?: number;
  readonly upDirection?: Vector3;
}

interface NativeCharacterBinding {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly character: KinematicBody;
  readonly shapeNode: Object3D;
  readonly shape: GodotShape3D;
  readonly shapeConsumer: { setShape(shape: RAPIER.Shape): void };
}

interface DynamicCharacterState {
  major: 3 | 4;
  context: DynamicCharacterBody3DContext;
  velocity: Vector3;
  upDirection: Vector3;
  native: NativeCharacterBinding | null;
  released: boolean;
  surface: KinematicBody;
  layer: number;
  mask: number;
  floorSnapLength: number | undefined;
}

const DYNAMIC_CHARACTERS = new WeakMap<Object3D, DynamicCharacterState>();

function finiteVector3(value: { readonly x: number; readonly y: number; readonly z: number }, member: string): Vector3 {
  const result = vec3(Number(value.x), Number(value.y), Number(value.z));
  if (![result.x, result.y, result.z].every(Number.isFinite)) {
    throw new TypeError(`godot-compat: ${member} requires a finite Vector3.`);
  }
  return result;
}

function requireState(node: Object3D): DynamicCharacterState {
  const state = DYNAMIC_CHARACTERS.get(node);
  if (state === undefined) {
    throw new TypeError('godot-compat: dynamic CharacterBody3D access requires CharacterBody3D.new()/KinematicBody.new() identity.');
  }
  if (state.released) throw new Error('godot-compat: dynamic character body was used after queue_free released its native state.');
  return state;
}

function directCollisionShape(node: Object3D): Object3D & {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  setShape(shape: RAPIER.Shape): void;
} {
  const candidates = node.children.filter(
    (child) => isGodotCollisionShape3DNode(child) &&
      isCollisionShape3DEnabled(child) &&
      getCollisionShape3DShape(child) !== null,
  );
  if (candidates.length !== 1) {
    throw new Error(
      `godot-compat: a runtime-created character requires exactly one enabled direct ` +
        `CollisionShape3D child before native motion; found ${candidates.length}.`,
    );
  }
  return candidates[0]! as Object3D & {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
    setShape(shape: RAPIER.Shape): void;
  };
}

function releaseNative(state: DynamicCharacterState): void {
  const native = state.native;
  if (native === null) return;
  state.native = null;
  if (isGodotShape3D(native.shape)) releaseGodotShape3D(native.shape, native.shapeConsumer);
  state.context.colliders.delete(native.collider);
  state.context.world.removeCharacterController(native.controller);
  state.context.world.removeRigidBody(native.body);
}

function bindNative(node: Object3D, state: DynamicCharacterState): NativeCharacterBinding {
  let collisionNode: ReturnType<typeof directCollisionShape>;
  try {
    collisionNode = directCollisionShape(node);
  } catch (error) {
    // A removed, disabled, or cleared CollisionShape must not leave its former native collider
    // participating in the world after the source node has stopped owning a usable shape.
    releaseNative(state);
    throw error;
  }
  const shape = getCollisionShape3DShape(collisionNode);
  if (shape === null || !isGodotShape3D(shape)) {
    releaseNative(state);
    throw new Error('godot-compat: runtime CharacterBody3D motion requires a retained native Shape3D resource.');
  }
  const worldScale = new ThreeVector3();
  const worldRotation = node.quaternion.clone();
  const worldPosition = new ThreeVector3();
  node.updateWorldMatrix(true, false);
  node.getWorldScale(worldScale);
  node.getWorldQuaternion(worldRotation);
  node.getWorldPosition(worldPosition);
  if (worldScale.x !== 1 || worldScale.y !== 1 || worldScale.z !== 1 ||
      worldRotation.x !== 0 || worldRotation.y !== 0 || worldRotation.z !== 0 || worldRotation.w !== 1) {
    releaseNative(state);
    throw new Error('godot-compat: runtime CharacterBody3D native motion requires an unscaled, upright body transform.');
  }
  if (collisionNode.scale.x !== 1 || collisionNode.scale.y !== 1 || collisionNode.scale.z !== 1) {
    releaseNative(state);
    throw new Error('godot-compat: runtime CharacterBody3D CollisionShape3D scale must remain (1, 1, 1).');
  }
  if (collisionNode.quaternion.x !== 0 || collisionNode.quaternion.y !== 0 ||
      collisionNode.quaternion.z !== 0 || collisionNode.quaternion.w !== 1) {
    releaseNative(state);
    throw new Error('godot-compat: runtime CharacterBody3D CollisionShape3D rotation is not carried by the seed overlap query.');
  }
  if (state.native !== null) {
    if (state.native.shapeNode === collisionNode && state.native.shape === shape) {
      state.native.collider.setTranslationWrtParent(collisionNode.position);
      state.native.collider.setRotationWrtParent(collisionNode.quaternion);
      const at = state.native.body.translation();
      if (at.x !== worldPosition.x || at.y !== worldPosition.y || at.z !== worldPosition.z) {
        state.native.body.setTranslation(worldPosition, true);
        state.native.body.setNextKinematicTranslation(worldPosition);
        state.context.world.propagateModifiedBodyPositionsToColliders();
        state.context.world.updateSceneQueries();
      }
      return state.native;
    }
    releaseNative(state);
  }
  const body = createKinematicRigidBody(state.context.world);
  const controller = createCharacterController(state.context.world);
  const descriptor = new RAPIER.ColliderDesc(shape.nativeShape)
    .setTranslation(collisionNode.position.x, collisionNode.position.y, collisionNode.position.z)
    .setRotation(collisionNode.quaternion);
  const collider = state.context.world.createCollider(descriptor, body);
  state.context.layers.set(collider, state.layer, state.mask);
  state.context.colliders.set(collider, node);
  const shapeConsumer = { setShape(next: RAPIER.Shape): void { collider.setShape(next); } };
  retainGodotShape3D(shape, shapeConsumer);
  const character = createKinematicBody({
    controller,
    body,
    collider,
    resolveCollider: (hit) => state.context.colliders.get(hit) ?? null,
    mask: state.mask,
    layers: state.context.layers,
    world: state.context.world,
    sweepFilter: {
      selfHandle: body.handle,
      ...(state.context.exceptions === undefined ? {} : { exceptions: state.context.exceptions }),
    },
    ...(state.floorSnapLength === undefined ? {} : { floorSnapLength: state.floorSnapLength }),
    upDirection: state.upDirection,
    onMoved: (moved) => setGlobalPosition(node, moved),
  });
  seedKinematicBody({
    world: state.context.world,
    body,
    shape: collider.shape,
    excludeBody: body,
    at: collisionNode.position,
    mask: state.mask,
    layers: state.context.layers,
    position: worldPosition,
  });
  character.velocity = state.velocity;
  character.upDirection = state.upDirection;
  state.native = { body, collider, controller, character, shapeNode: collisionNode, shape, shapeConsumer };
  return state.native;
}

/** Construct the native Three node now and defer Rapier allocation until its CollisionShape child exists. */
export function createDynamicCharacterBody3D(
  major: 3 | 4,
  context: DynamicCharacterBody3DContext,
): Object3D {
  const node = new Object3D();
  return bindDynamicCharacterBody3D(node, major, context);
}

/** Bind CharacterBody3D/KinematicBody native state to the exact authored Object3D. */
export function bindDynamicCharacterBody3D(
  node: Object3D,
  major: 3 | 4,
  context: DynamicCharacterBody3DContext,
  authored: AuthoredDynamicCharacterBody3D = {},
): Object3D {
  if (DYNAMIC_CHARACTERS.has(node)) {
    throw new Error('godot-compat: CharacterBody3D native state is already bound to this node.');
  }
  registerGodotObjectIdentity(node, major === 3 ? 'KinematicBody' : 'CharacterBody3D');
  const state = {} as DynamicCharacterState;
  state.major = major;
  state.context = context;
  state.velocity = VECTOR3_ZERO;
  state.upDirection = authored.upDirection === undefined
    ? major === 4 ? vec3(0, 1, 0) : VECTOR3_ZERO
    : finiteVector3(authored.upDirection, 'CharacterBody3D.up_direction');
  state.layer = authored.layer ?? 1;
  state.mask = authored.mask ?? 1;
  state.floorSnapLength = major === 4 ? authored.floorSnapLength ?? 0.1 : undefined;
  state.native = null;
  state.released = false;
  state.surface = {
    get velocity(): Vector3 { return state.velocity; },
    set velocity(value) {
      state.velocity = finiteVector3(value, 'CharacterBody3D.velocity');
      if (state.native !== null) state.native.character.velocity = state.velocity;
    },
    get upDirection(): Vector3 { return state.upDirection; },
    set upDirection(value) {
      state.upDirection = finiteVector3(value, 'CharacterBody3D.up_direction');
      if (state.native !== null) state.native.character.upDirection = state.upDirection;
    },
    applyFloorSnap(): void { bindNative(node, state).character.applyFloorSnap(); },
    moveAndSlide(velocity, up, dt, options): Vector3 {
      const native = bindNative(node, state).character;
      const result = native.moveAndSlide(velocity, up, dt, options);
      state.velocity = result;
      native.velocity = result;
      return result;
    },
    moveAndSlideWithSnap(velocity, snap, up, dt, options): Vector3 {
      const native = bindNative(node, state).character;
      const result = native.moveAndSlideWithSnap(velocity, snap, up, dt, options);
      state.velocity = result;
      native.velocity = result;
      return result;
    },
    moveAndCollide(motion, infiniteInertia, excludeRaycastShapes, testOnly) {
      return bindNative(node, state).character.moveAndCollide(
        motion,
        infiniteInertia,
        excludeRaycastShapes,
        testOnly,
      );
    },
    isOnFloor(): boolean { return state.native?.character.isOnFloor() ?? false; },
    isOnCeiling(): boolean { return state.native?.character.isOnCeiling() ?? false; },
    getFloorNormal(): Vector3 { return state.native?.character.getFloorNormal() ?? VECTOR3_ZERO; },
    getSlideCount(): number { return state.native?.character.getSlideCount() ?? 0; },
    getSlideCollision(index): ReturnType<KinematicBody['getSlideCollision']> {
      return bindNative(node, state).character.getSlideCollision(index);
    },
  };
  DYNAMIC_CHARACTERS.set(node, state);
  registerGodotThreeNodeRelease(node, () => {
    if (state.released) return;
    releaseNative(state);
    state.released = true;
    DYNAMIC_CHARACTERS.delete(node);
  });
  return node;
}

export function dynamicCharacterBody3DOf(node: Object3D, authored?: KinematicBody): KinematicBody {
  const state = DYNAMIC_CHARACTERS.get(node);
  if (state === undefined) {
    if (authored !== undefined) return authored;
    return requireState(node).surface;
  }
  if (state.released) throw new Error('godot-compat: dynamic character body was used after queue_free released its native state.');
  return state.surface;
}

/** Godot 4's zero-argument reshape, including its bool collision result. */
export function moveDynamicCharacterBody3D4(
  node: Object3D,
  delta: number,
  authored?: KinematicBody,
): boolean {
  const character = dynamicCharacterBody3DOf(node, authored);
  character.velocity = character.moveAndSlide(character.velocity, character.upDirection, delta);
  return character.getSlideCount() > 0;
}
