/**
 * Attach one authored Godot `CollisionShape` to a Rapier body.
 *
 * The port used to stamp `ColliderDesc.cuboid`/`ball`/`capsule`/`cylinder`/`trimesh` plus
 * translation, rotation, sensor, friction, layer/mask and the `ctx.colliders` registration as
 * statements. Those are the same statements for every shape; this is the one factory they
 * collapse into. Shape NUMBERS arrive in Godot 3 semantics (the emitter's `ColliderSpec`): a
 * capsule/cylinder `height` is the FULL Godot 3 section/height, and this halves it for Rapier.
 *
 * A TRIMESH builds an identity index buffer — Godot stores faces, Rapier needs indices, and
 * welding coincident vertices would merge triangles Godot keeps apart. That is the same rule
 * the emitter used to stamp as `concavePolygonColliderDesc`.
 *
 * World / body / collider are typed structurally (Rapier's own classes satisfy them; see
 * `kinematic-body-3d.ts`), but `ColliderDesc` and `CoefficientCombineRule` are REAL VALUE IMPORTS
 * so the call site can stay `attachCollider(this.ctx, …)` — which is why
 * `@dimforge/rapier3d-compat` IS declared in this capability's `packageJson.dependencies`
 * (`grid-map-instances.ts`'s header carries the whole argument, including the single-copy range).
 *
 * **Owns:** nothing with a lifetime. **Shares:** the world, body, layer registry and collider
 * map the caller handed it. **Teardown:** the scene's `detachNodes` removes the collider with
 * the body; this file holds nothing.
 */

import { CoefficientCombineRule, ColliderDesc } from '@dimforge/rapier3d-compat';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { CollisionLayers, LayeredCollider } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';
import { registerGodotObjectIdentity } from './object';
import {
  isGodotShape3D,
  releaseGodotShape3D,
  retainGodotShape3D,
  type GodotShape3D,
  type GodotShape3DConsumer,
} from './shape-3d';

/** Authored translation of a CollisionShape, in the body's local space. */
export interface ColliderAt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit quaternion for a collider whose own transform (or capsule-axis correction) rotates it. */
export interface ColliderRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Signed axis scale carried by Godot's Basis and baked into native Rapier geometry. */
export interface ColliderScale extends ColliderAt {}

/**
 * One CollisionShape as the emitted spec literal — Godot 3 numbers. Rapier conversion happens
 * inside {@link attachCollider}.
 */
export type ColliderAttachShape =
  | { readonly type: 'box'; readonly halfExtents: ColliderAt; readonly at: ColliderAt }
  | { readonly type: 'sphere'; readonly radius: number; readonly at: ColliderAt }
  | {
      readonly type: 'capsule';
      readonly radius: number;
      readonly height: number;
      readonly colliderHeight?: number;
      readonly godotMajor?: 3 | 4;
      readonly at: ColliderAt;
    }
  | {
      readonly type: 'cylinder';
      readonly radius: number;
      readonly height: number;
      readonly at: ColliderAt;
    }
  | {
      readonly type: 'trimesh';
      readonly vertices: Float32Array;
      readonly triangles: number;
      readonly at: ColliderAt;
    }
  | {
      readonly type: 'convex';
      readonly vertices: Float32Array;
      readonly at: ColliderAt;
    };

/** What {@link attachCollider} needs beyond the authored shape. */
export type ColliderAttachSpec = ColliderAttachShape & {
  readonly rotation?: ColliderRotation;
  readonly scale?: ColliderScale;
  /** An `Area`'s sensor. Sensors carry no friction (Godot's Area is not a contacting surface). */
  readonly sensor?: boolean;
  /**
   * Godot's body friction, or the constructor's `frictionOverride ?? authored`. Omitted on a
   * sensor. Always written on a contacting collider — Godot's default is `1.0` and Rapier's is
   * `0.5`, and Godot takes a pair's MINIMUM where Rapier averages.
   *
   * Unlike {@link ColliderAttachSpec.restitution}, the DEFAULT rule here is Godot's rule EXACTLY
   * rather than an approximation of it. Godot combines a contact pair's friction as
   * `ABS(MIN(A, B))` (`servers/physics/body_pair_sw.cpp` `combine_friction`, 3.6-stable lines
   * 196-198; identically `servers/physics_3d/godot_body_pair_3d.cpp` 257-259 @ 4.3-stable), and
   * Rapier ships that rule as `CoefficientCombineRule.Min`. Every coefficient reaching this seat
   * is non-negative — Godot's own sign channel is `rough`, which arrives as
   * {@link ColliderAttachSpec.frictionCombine} rather than as a negative number — so the `ABS` is
   * a no-op on the value and the rule is what carries it.
   *
   * Min and Multiply agree only at `0` and `1`, which is why a friction-`0` body reads correct
   * under either and every intermediate pair does not (`0.3` against `0.8` is `0.3` in Godot,
   * and would be `0.24` under Multiply).
   */
  readonly friction?: number;
  /**
   * Godot's `PhysicsMaterial.rough`, as the friction COMBINE RULE it actually is. Absent means
   * `Min` — Godot's plain rule, which is what every surface that does not switch it gets.
   *
   * `rough` sets no coefficient. Godot hands the physics server `computed_friction()`, which is
   * `rough ? -friction : friction` (`scene/resources/physics_material.h`, identically at
   * 3.6-stable and 4.3-stable), and a negative operand is smaller than any ordinary coefficient —
   * so `ABS(MIN(A, B))` always resolves to the rough side's own magnitude. The flag means "THIS
   * surface's friction wins the pair", which is a rule, not a number.
   *
   * Rapier has no "this side wins" rule and resolves a pair whose colliders name different rules
   * by taking the HIGHER-valued one, so `'max'` here against an ordinary collider's `Min` gives
   * `max(A, B)`. That is Godot EXACTLY in two of the three cases — when the rough side's
   * coefficient is the larger (which is what a surface authored to grip is), and when both bodies
   * are rough (Godot's `MIN` of two negatives is `-max(|A|, |B|)`, whose `ABS` is `max`). The
   * remainder is a rough surface meeting a GRIPPIER ordinary one, and the translation records that
   * as a deviation note rather than approximating the rule in the coefficient.
   */
  readonly frictionCombine?: 'min' | 'max';
  /**
   * Godot's `PhysicsMaterial.bounce`, when the body authors a non-zero one. Omitted on a sensor,
   * and omitted when unauthored — Godot's default bounce is `0` and so is Rapier's, the one
   * coefficient where the two engines already agree.
   *
   * Godot combines a contact pair's bounce as `CLAMP(A + B, 0, 1)`
   * (`servers/physics/body_pair_sw.cpp` `combine_bounce`, 3.6-stable lines 192-194; identically
   * `servers/physics_3d/godot_body_pair_3d.cpp` 253-255 @ 4.3-stable), and Rapier's released rule
   * set has no clamped sum. `Max` is named here because Rapier resolves a pair whose colliders
   * disagree by taking the higher-valued rule, so a bouncy collider meeting an unauthored one
   * (bounce `0`) reproduces Godot exactly — a clamped sum with a zero addend IS the max. Two
   * bouncy bodies meeting each other is the remainder, and the translation records it as a
   * deviation note.
   */
  readonly restitution?: number;
  readonly layer: number;
  readonly mask: number;
  /**
   * The GAME's object a query should hand back as `get_collider()`. Absent means "do NOT
   * register this collider in `ctx.colliders`".
   */
  readonly owner?: GodotColliderOwner;
};

/** The half of a Rapier 3D `World` this factory touches. Rapier's own `World` satisfies it. */
export interface ColliderAttachWorld<TCollider = object, TBody = object> {
  createCollider(desc: ColliderDesc, parent?: TBody): TCollider;
}

/** The slice of a scene's `ctx` {@link attachCollider} reads. */
export interface ColliderAttachContext<TCollider extends object = object, TBody = object> {
  readonly world: ColliderAttachWorld<TCollider, TBody>;
  readonly layers: CollisionLayers;
  readonly colliders: GodotMutableColliderRegistry<TCollider, GodotColliderOwner>;
}

/** Rapier's own `CoefficientCombineRule.Min`, read off the library this file already imports. */
const FRICTION_COMBINE_MIN = CoefficientCombineRule.Min;

/** Rapier's own `CoefficientCombineRule.Max`. See
 *  {@link ColliderAttachSpec.restitution} for why bounce takes Max and friction takes Min, and
 *  {@link ColliderAttachSpec.frictionCombine} for the ONE surface whose friction takes it too. */
const RESTITUTION_COMBINE_MAX = CoefficientCombineRule.Max;

/** The same rule, on the friction axis — Rapier resolves a pair by the higher-valued rule, so this
 *  is how Godot's `rough` wins its pair here. See {@link ColliderAttachSpec.frictionCombine}. */
const FRICTION_COMBINE_MAX = 3;

/**
 * Build one Rapier collider from an authored spec and hang it on `body`.
 *
 * Sets layer/mask on the world's registry and, when `spec.owner` is present, registers the
 * collider so a query can resolve it back to the game object.
 */
export function attachCollider<TCollider extends object, TBody extends object>(
  ctx: ColliderAttachContext<TCollider, TBody>,
  body: TBody,
  spec: ColliderAttachSpec,
): TCollider {
  const desc = descFromSpec(spec, spec.scale).setTranslation(spec.at.x, spec.at.y, spec.at.z);
  if (spec.rotation !== undefined) desc.setRotation(spec.rotation);
  if (spec.sensor === true) {
    desc.setSensor(true);
  } else {
    if (spec.friction !== undefined) {
      desc.setFriction(spec.friction);
      desc.setFrictionCombineRule(
        spec.frictionCombine === 'max' ? FRICTION_COMBINE_MAX : FRICTION_COMBINE_MIN,
      );
    }
    if (spec.restitution !== undefined) {
      desc.setRestitution(spec.restitution);
      desc.setRestitutionCombineRule(RESTITUTION_COMBINE_MAX);
    }
  }
  const collider = ctx.world.createCollider(desc, body);
  if (spec.scale !== undefined) COLLIDER_SHAPE_SCALES.set(collider, spec.scale);
  ctx.layers.set(collider as LayeredCollider, spec.layer, spec.mask);
  if (spec.owner !== undefined) ctx.colliders.set(collider, spec.owner);
  return collider;
}

/** Attach from the retained CollisionShape carrier's actual transform relative to its authored
 * CollisionObject parent. The carrier is the hierarchy node descendants inherit from, so render
 * children and native collision consume one transform rather than two copied offsets. */
export function attachColliderAtNode<TCollider extends object, TBody extends object>(
  ctx: ColliderAttachContext<TCollider, TBody>,
  body: TBody,
  carrier: Object3D,
  bodyNode: Object3D,
  spec: ColliderAttachSpec,
  major: 3 | 4,
): TCollider {
  bodyNode.updateWorldMatrix(true, false);
  carrier.updateWorldMatrix(true, false);
  const bodyPosition = new Vector3();
  const bodyRotation = new Quaternion();
  const bodyScale = new Vector3();
  bodyNode.matrixWorld.decompose(bodyPosition, bodyRotation, bodyScale);
  const bodyPose = new Matrix4().compose(bodyPosition, bodyRotation, new Vector3(1, 1, 1));
  const relative = bodyPose.invert().multiply(carrier.matrixWorld);
  const at = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  relative.decompose(at, rotation, scale);
  const rebuilt = new Matrix4().compose(at, rotation, scale);
  const error = Math.max(...relative.elements.map((value, index) => Math.abs(value - rebuilt.elements[index]!)));
  if (error > 1e-4) {
    throw new Error('CollisionShape transform relative to its CollisionObject is sheared; native Rapier pose plus scaled geometry cannot reproduce it exactly.');
  }
  if (spec.type === 'capsule' && major === 3) {
    rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
  }
  const identity = Math.abs(rotation.x) < 1e-8 && Math.abs(rotation.y) < 1e-8 &&
    Math.abs(rotation.z) < 1e-8 && Math.abs(rotation.w - 1) < 1e-8;
  return attachCollider(ctx, body, {
    ...spec,
    at: { x: at.x, y: at.y, z: at.z },
    ...(identity ? {} : {
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    }),
    scale: { x: scale.x, y: scale.y, z: scale.z },
  });
}

/** The native Rapier shape behind the same authored dimensions attachCollider consumes. */
export function rapierShape3D(spec: ColliderAttachShape): ColliderDesc['shape'] {
  if (isGodotShape3D(spec)) return spec.nativeShape;
  return descFromSpec(spec).shape;
}

const COLLIDER_SHAPE_SCALES = new WeakMap<object, ColliderScale>();

function retainedNativeShape(collider: object, shape: ColliderAttachShape): ColliderDesc['shape'] {
  return descFromSpec(shape, COLLIDER_SHAPE_SCALES.get(collider)).shape;
}

export interface MutableCollisionShape3D {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  setShape(shape: ColliderDesc['shape']): void;
}

interface CollisionShape3DState {
  shape: ColliderAttachShape | null;
  enabledBeforeClear: boolean;
  consumer?: GodotShape3DConsumer;
  native?: RAPIER.Collider;
  lifecycle?: {
    readonly create: (shape: ColliderAttachShape, enabled: boolean) => RAPIER.Collider;
    readonly remove: (collider: RAPIER.Collider) => void;
  };
}

const COLLISION_SHAPE_RESOURCES = new WeakMap<object, CollisionShape3DState>();

function shapeConsumer(
  collider: MutableCollisionShape3D,
  state: CollisionShape3DState,
): GodotShape3DConsumer {
  state.consumer ??= {
    setShape: () => {
      if (state.shape === null) return;
      if (state.native !== undefined) state.native.setShape(retainedNativeShape(state.native, state.shape));
      else collider.setShape(retainedNativeShape(collider, state.shape));
    },
  };
  return state.consumer;
}

export function isGodotCollisionShape3DNode(value: unknown): value is Object3D & MutableCollisionShape3D {
  return typeof value === 'object' && value !== null && COLLISION_SHAPE_RESOURCES.has(value);
}

export function isCollisionShape3DEnabled(collider: MutableCollisionShape3D): boolean {
  return collider.isEnabled();
}

/** Runtime-created CollisionShape node retaining its Shape3D until a native body seats it. */
export function createGodotCollisionShape3D(): Object3D & MutableCollisionShape3D {
  let enabled = true;
  let nativeShape: ColliderDesc['shape'] | null = null;
  const node = Object.assign(new Object3D(), {
    isEnabled: () => enabled,
    setEnabled: (next: boolean) => { enabled = next; },
    setShape: (shape: ColliderDesc['shape']) => { nativeShape = shape; },
  });
  void nativeShape;
  registerGodotObjectIdentity(node, 'CollisionShape');
  COLLISION_SHAPE_RESOURCES.set(node, { shape: null, enabledBeforeClear: true });
  return node;
}

/** Install CollisionShape3D resource identity on the exact authored hierarchy node. */
export function bindAuthoredCollisionShape3D(
  node: Object3D,
  shape: ColliderAttachShape | null,
): Object3D & MutableCollisionShape3D {
  if (COLLISION_SHAPE_RESOURCES.has(node)) {
    throw new Error('godot-compat: CollisionShape3D resource state is already bound to this node.');
  }
  let enabled = true;
  let nativeShape: ColliderDesc['shape'] | null = null;
  const mutable = Object.assign(node, {
    isEnabled: () => enabled,
    setEnabled: (next: boolean) => { enabled = next; },
    setShape: (next: ColliderDesc['shape']) => { nativeShape = next; },
  });
  void nativeShape;
  registerGodotObjectIdentity(node, 'CollisionShape');
  COLLISION_SHAPE_RESOURCES.set(mutable, { shape: null, enabledBeforeClear: true });
  if (shape !== null) bindCollisionShape3DResource(mutable, shape);
  return mutable;
}

export interface BindNullableCollisionShape3DOptions {
  readonly node: Object3D;
  readonly ctx: ColliderAttachContext<RAPIER.Collider, RAPIER.RigidBody> & {
    readonly world: ColliderAttachWorld<RAPIER.Collider, RAPIER.RigidBody> & {
      removeCollider(collider: RAPIER.Collider, wakeUp: boolean): void;
    };
  };
  readonly body: RAPIER.RigidBody;
  readonly bodyNode: Object3D;
  readonly major: 3 | 4;
  readonly spec: Omit<ColliderAttachSpec, 'type' | 'at'>;
}

/** Retain an authored null CollisionShape owner and allocate native physics only once a live
 * Shape Resource is assigned. The carrier is also the shape consumer, so Resource mutations
 * update the current collider while replacement/null clears that owner and its native collider. */
export function bindNullableCollisionShape3D(options: BindNullableCollisionShape3DOptions): void {
  if (COLLISION_SHAPE_RESOURCES.has(options.node)) {
    throw new Error('CollisionShape nullable resource lifecycle is already bound.');
  }
  const state: CollisionShape3DState = {
    shape: null,
    enabledBeforeClear: true,
    lifecycle: {
      create: (shape, enabled) => {
        const collider = attachColliderAtNode(
          options.ctx,
          options.body,
          options.node,
          options.bodyNode,
          { ...shape, ...options.spec },
          options.major,
        );
        collider.setEnabled(enabled);
        return collider;
      },
      remove: (collider) => {
        options.ctx.colliders.delete(collider);
        options.ctx.world.removeCollider(collider, true);
      },
    },
  };
  const mutable = options.node as Object3D & MutableCollisionShape3D;
  Object.assign(mutable, {
    isEnabled: () => state.native?.isEnabled() ?? state.enabledBeforeClear,
    setEnabled: (enabled: boolean) => {
      state.enabledBeforeClear = enabled;
      state.native?.setEnabled(enabled);
    },
    setShape: (_shape: ColliderDesc['shape']) => {
      if (state.native !== undefined && state.shape !== null) {
        state.native.setShape(retainedNativeShape(state.native, state.shape));
      }
    },
  });
  COLLISION_SHAPE_RESOURCES.set(mutable, state);
}

function isColliderAttachShape(value: unknown): value is ColliderAttachShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['box', 'sphere', 'capsule', 'cylinder', 'convex', 'trimesh'].includes(String(Reflect.get(value, 'type')))
  );
}

/** Retain the exact authored Shape3D resource on the native Rapier collider identity. */
export function bindCollisionShape3DResource(
  collider: MutableCollisionShape3D,
  shape: ColliderAttachShape,
): void {
  if (!isColliderAttachShape(shape)) throw new TypeError('CollisionShape.shape requires a Shape3D Resource.');
  if (isGodotShape3D(shape)) void shape.nativeShape;
  const priorState = COLLISION_SHAPE_RESOURCES.get(collider);
  const previous = priorState?.shape;
  if (previous !== undefined && previous !== null && isGodotShape3D(previous) && priorState !== undefined) {
    releaseGodotShape3D(previous, shapeConsumer(collider, priorState));
  }
  const state: CollisionShape3DState = { shape, enabledBeforeClear: collider.isEnabled() };
  COLLISION_SHAPE_RESOURCES.set(collider, state);
  if (isGodotShape3D(shape)) retainGodotShape3D(shape, shapeConsumer(collider, state));
}

export function getCollisionShape3DShape(collider: MutableCollisionShape3D): ColliderAttachShape | null {
  const state = COLLISION_SHAPE_RESOURCES.get(collider);
  if (state === undefined) throw new Error('CollisionShape.shape was read before its native collider binding.');
  return state.shape;
}

export function setCollisionShape3DShape(
  collider: MutableCollisionShape3D,
  shape: ColliderAttachShape | null,
): void {
  if (shape !== null && !isColliderAttachShape(shape)) {
    throw new TypeError('CollisionShape.shape requires a Shape3D Resource or null.');
  }
  const state = COLLISION_SHAPE_RESOURCES.get(collider);
  if (state === undefined) throw new Error('CollisionShape.shape was written before its native collider binding.');
  if (state.shape === shape) return;
  if (state.shape !== null && isGodotShape3D(state.shape)) {
    releaseGodotShape3D(state.shape, shapeConsumer(collider, state));
  }
  if (state.native !== undefined && state.lifecycle !== undefined) {
    state.lifecycle.remove(state.native);
    delete state.native;
  }
  if (shape === null) {
    if (state.shape !== null) state.enabledBeforeClear = collider.isEnabled();
    state.shape = null;
    return;
  }
  const wasCleared = state.shape === null;
  state.shape = shape;
  if (state.lifecycle !== undefined) {
    state.native = state.lifecycle.create(shape, state.enabledBeforeClear);
  } else {
    collider.setShape(retainedNativeShape(collider, shape));
  }
  if (isGodotShape3D(shape)) retainGodotShape3D(shape, shapeConsumer(collider, state));
  if (wasCleared) collider.setEnabled(state.enabledBeforeClear);
}

export function releaseCollisionShape3DResource(collider: object): void {
  const state = COLLISION_SHAPE_RESOURCES.get(collider);
  const shape = state?.shape;
  if (shape !== undefined && shape !== null && isGodotShape3D(shape)) {
    releaseGodotShape3D(
      shape,
      shapeConsumer(collider as MutableCollisionShape3D, state as CollisionShape3DState),
    );
  }
  if (state?.native !== undefined && state.lifecycle !== undefined) {
    state.lifecycle.remove(state.native);
  }
  COLLISION_SHAPE_RESOURCES.delete(collider);
}

function descFromSpec(spec: ColliderAttachShape, scale?: ColliderScale): ColliderDesc {
  const sx = scale?.x ?? 1;
  const sy = scale?.y ?? 1;
  const sz = scale?.z ?? 1;
  const ax = Math.abs(sx);
  const ay = Math.abs(sy);
  const az = Math.abs(sz);
  const unit = ax === 1 && ay === 1 && az === 1;
  const conformal = Math.abs(ax - ay) < 1e-4 && Math.abs(ay - az) < 1e-4;
  const scaledVertices = (vertices: Float32Array): Float32Array => {
    if (unit) return vertices;
    const result = vertices.slice();
    for (let index = 0; index < result.length; index += 3) {
      result[index] = result[index]! * sx;
      result[index + 1] = result[index + 1]! * sy;
      result[index + 2] = result[index + 2]! * sz;
    }
    return result;
  };
  switch (spec.type) {
    case 'box':
      return ColliderDesc.cuboid(spec.halfExtents.x * ax, spec.halfExtents.y * ay, spec.halfExtents.z * az);
    case 'sphere':
      if (!conformal) throw new Error('A non-uniformly scaled SphereShape3D is not exactly representable by Rapier Ball geometry.');
      return ColliderDesc.ball(spec.radius * ax);
    case 'capsule':
      if (!conformal) throw new Error('A non-uniformly scaled CapsuleShape3D is not exactly representable by Rapier Capsule geometry.');
      // Godot 4 exposes total capsule height; retained resources provide the normalized cylinder
      // section while authored Godot 3 literals continue to carry that section directly.
      return ColliderDesc.capsule(((spec.colliderHeight ?? spec.height) * ax) / 2, spec.radius * ax);
    case 'cylinder':
      if (!conformal) throw new Error('A non-uniformly scaled CylinderShape3D is not exactly representable by Rapier Cylinder geometry.');
      // Godot's CylinderShape.height is the FULL height; Rapier's cylinder takes the HALF.
      return ColliderDesc.cylinder((spec.height * ax) / 2, spec.radius * ax);
    case 'trimesh': {
      const faces = scaledVertices(spec.vertices);
      const indices = new Uint32Array(faces.length / 3);
      for (let i = 0; i < indices.length; i += 1) indices[i] = i;
      return ColliderDesc.trimesh(faces, indices);
    }
    case 'convex': {
      const desc = ColliderDesc.convexHull(scaledVertices(spec.vertices));
      if (desc === null) throw new Error('ConvexPolygonShape3D points do not form a native Rapier convex hull.');
      return desc;
    }
  }
}
