/**
 * The two `platformer-3d` members that reach the Rapier 3D world through a NODE rather than through
 * `_integrate_forces`'s solver state (`rigid-body-3d.ts`) or a one-shot query
 * (`physics-space-3d.ts`): `RayCast.is_colliding()` and `PhysicsBody.add_collision_exception_with()`.
 *
 * ## `RayCast.is_colliding` is the existing segment query, driven from a node's transform
 *
 * `enemy.gd:46-47` reads `get_node("Armature/RayFloor").is_colliding()` and the wall ray beside it
 * every physics frame — the enemy's whole floor/wall navigation. A Godot `RayCast` casts from its
 * OWN global origin along `cast_to` (a direction in the node's LOCAL space) each physics frame while
 * enabled, and `is_colliding()` returns whether that cast hit. This does exactly that and NOT a
 * second ray path: {@link RayCast3D.isColliding} builds the same `intersect_ray` query
 * `physics-space-3d.ts` already answers (`from = node origin`, `to = node origin + node.basis ·
 * cast_to`), so the follow camera's rays and the enemy's rays hit the one Rapier world through one
 * code path. `cast_to` is read from the `.tscn` and handed in by the port; the node's global
 * transform is read live from the `Object3D` every call, which is what makes a ray attached to a
 * walking enemy track it.
 *
 * ## `add_collision_exception_with` is a per-pair exception set the port's PhysicsHooks consults
 *
 * `player.gd:121` fires `bullet.add_collision_exception_with(self)` on the bullet it just spawned,
 * so the bullet does not immediately collide with the player who fired it. Godot keeps a per-body
 * list of ARBITRARY excepted bodies — an unbounded set of pairs, not groups. Rapier's own answer for
 * "these two bodies do not collide but both collide with everything else" is NOT `InteractionGroups`
 * (a 16-bit group mask cannot express an arbitrary pair — both bodies keep interacting through every
 * other bit) but `PhysicsHooks.filterContactPair`
 * (`node_modules/@dimforge/rapier3d-compat/pipeline/physics_hooks.d.ts`), a per-pair contact filter
 * that returns `null` to suppress a pair's contact. So {@link addCollisionExceptionWith} records the
 * unordered body-handle pair in a port-owned {@link CollisionExceptions} set — UNBOUNDED, matching
 * Godot — and, in the SAME call, sets `ActiveHooks.FILTER_CONTACT_PAIRS` on both bodies' colliders
 * so Rapier actually consults the hook for their pairs. The port installs one `PhysicsHooks` at the
 * world's `step` whose `filterContactPair` returns `null` for a pair {@link CollisionExceptions.has}
 * reports. Compat owns the SET and the per-collider opt-in (both established at the exception call,
 * the moment Godot's own list grows); the port owns the hook, the same split `physics-space-3d.ts`
 * uses for its collider resolver.
 *
 * ## `collision_layer`/`collision_mask` are a live write to the world's layer registry
 *
 * `enemy.gd:47` writes `collision_layer = 0` on a dying enemy. Godot keeps the pair on the
 * `CollisionObject`; this port keeps it per collider in the world's {@link CollisionLayers}
 * (`collision-layers.ts`, which also states WHY it is not Rapier's `InteractionGroups`), so
 * {@link setCollisionLayer} walks the body's own colliders — the same set Godot's one property
 * covers — and both collision rules read the new value on the very next step and the very next
 * query. Nothing is rebuilt and no collider is re-created.
 *
 * ## `axis_lock_angular_*` is Godot 4's replacement for `set_mode(MODE_RIGID)`, per axis
 *
 * The 3.x fixture unlocks a dying enemy's rotation with one `set_mode(RigidBody.MODE_RIGID)`
 * (`rigid-body-3d.ts`'s {@link setMode}, Rapier `lockRotations(false)` — all three axes at once).
 * The 4.x fixture writes the three per-axis properties instead (`enemy.gd:44-46`, all three to
 * `false`, over an `enemy.tscn:435-437` that authors all three `true`), and Rapier spells ONE axis
 * `setEnabledRotations(x, y, z)`. So this is NOT an alias of the whole-body unlock: aliasing would
 * answer a different question the moment only one of the three is written, which is exactly what a
 * per-axis property is for. {@link setAxisLockAngular} writes one axis of the triple and pushes the
 * whole triple at Rapier, because that is the only shape Rapier's setter has.
 *
 * ## Resource ownership
 *
 * **Owns:** {@link angularLocks} — one boolean triple per Rapier body, because Rapier has a
 * `setEnabledRotations` and NO getter for it, and Godot's `axis_lock_angular_*` is a readable
 * property. It is the mirror of state Rapier holds and will not report, keyed WEAKLY by the body,
 * so it ends when the body does and there is no teardown path to get wrong. It has exactly one
 * writer ({@link setAxisLockAngular}) and stays truthful only because the port applies an AUTHORED
 * `.tscn` lock through that same setter rather than seeding the Rapier descriptor behind its back —
 * an unseeded body reads Godot's own default (all three unlocked), which is also Rapier's.
 * Otherwise: nothing that outlives a call — a {@link CollisionExceptions} is the PORT's, held for
 * the world's lifetime, and so is the {@link CollisionLayers} registry the layer/mask writers
 * mutate (owned by `collision-layers.ts`, one per world). **Shares:** the space and node (the port's
 * Rapier world and the emitted `Object3D`), that exception set and that registry. **Teardown:**
 * none; both are dropped with the world.
 */

import type { Object3D, Vector3Like } from 'three';
import type {
  CollisionExceptions,
  CollisionObjectBody,
  FilterableCollider,
} from './collision-exceptions';
export type {
  CollisionExceptions,
  CollisionObjectBody,
  FilterableCollider,
} from './collision-exceptions';
export {
  addCollisionExceptionWith,
  createCollisionExceptions,
  removeCollisionExceptionWith,
} from './collision-exceptions';
import type { CollisionLayers } from './collision-layers';
import type { ExcludableBody, PhysicsDirectSpaceState, RayResult } from './physics-space-3d';
import { VECTOR3_ZERO, type Vector3 } from './variant-3d';

/**
 * A `RayCast` node's live query. The node's own transform is read every call, so a ray parented to
 * a moving body follows it — which is exactly `enemy.gd`'s `Armature/RayFloor`.
 */
export interface RayCast3D {
  /** The actual world node this query samples; Spatial members target this identity. */
  readonly node: Object3D;
  /** Whether physics-frame sampling is active. Disabling clears the cached collision exactly as
   * RayCast/RayCast3D does; `force_raycast_update()` remains available while disabled. */
  enabled: boolean;
  setEnabled(value: boolean): void;
  isEnabled(): boolean;
  /** The live one-directional layer selection used by the next native ray query. */
  collisionMask: number;
  setCollisionMask(value: number): void;
  getCollisionMask(): number;
  setCollisionMaskValue(layerNumber: number, value: boolean): void;
  getCollisionMaskValue(layerNumber: number): boolean;
  setCollisionMaskBit(bit: number, value: boolean): void;
  getCollisionMaskBit(bit: number): boolean;
  addException(body: ExcludableBody): void;
  /**
   * `raycast.is_colliding()` — `enemy.gd:46`, `:47`.
   *
   * Casts from the node's current global origin along `target_position` transformed into world
   * space, and returns whether the segment hit. Uses the SAME `intersect_ray`
   * `physics-space-3d.ts` answers, so the sensor default (an `Area` is not hit), the layer mask
   * and the exclusion list are the ones measured there. Caches the result so
   * {@link RayCast3D.getCollider} / {@link RayCast3D.getCollisionNormal} /
   * {@link RayCast3D.getCollisionPoint} read the SAME hit.
   */
  isColliding(): boolean;
  /**
   * `raycast.force_raycast_update()` — Godot 4.7 dump: updates the cached hit immediately
   * instead of waiting for the next physics frame. This port already casts on every
   * {@link RayCast3D.isColliding}; the method is the same cast, named separately because
   * `starter-kit-fps` `player.gd:196` / `enemy.gd:49` write `target_position` and then force
   * the update in the same frame.
   */
  forceRaycastUpdate(): void;
  /**
   * `raycast.get_collider()` — the port's resolved object for the last hit, or `null`.
   * Godot returns `null` when the last update missed.
   */
  getCollider(): unknown;
  /**
   * `raycast.get_collision_normal()` — the last hit's outward normal, or
   * {@link VECTOR3_ZERO} when the last update missed (Godot's own miss answer).
   */
  getCollisionNormal(): Vector3;
  /**
   * `raycast.get_collision_point()` — the last hit's world position, or
   * {@link VECTOR3_ZERO} when the last update missed.
   */
  getCollisionPoint(): Vector3;
  /**
   * `raycast.target_position` — Godot 4's name for 3.x `cast_to`, the ray's end
   * in the node's LOCAL space. Writable: `starter-kit-fps` `player.gd:193-194`
   * writes `.x`/`.y` for spread and `:272` assigns a whole `Vector3`.
   */
  targetPosition: Vector3Like;
}

/** What {@link createRayCast3D} needs from the port. */
export interface CreateRayCast3DOptions {
  /** The node whose transform the ray starts from — the emitted `Object3D` for the `RayCast`. */
  readonly node: Object3D;
  /** Godot 3 defaults false and Godot 4 defaults true; scene translation supplies the dialect
   * default explicitly so the runtime never guesses from a renamed class. */
  readonly enabled: boolean;
  /** `cast_to`, the ray's end point in the node's LOCAL space, read from the `.tscn`. */
  readonly castTo: Vector3Like;
  /** The space to query — the port's one Rapier world, through `spaceGetDirectState`. */
  readonly space: PhysicsDirectSpaceState;
  /** Bodies the ray ignores — Godot's own `add_exception`/parent body. Empty when the node excepts
   *  nothing, which is the measured enemy's case. */
  readonly exclude?: readonly ExcludableBody[];
  /** The `RayCast`'s own `collision_mask`, read from the `.tscn` (Godot's default is `1`). The
   *  one-directional query rule `physics-space-3d.ts` applies: the ray sees a collider exactly when
   *  this names its `collision_layer`. */
  readonly mask?: number;
  /**
   * `collide_with_areas` — Godot 4 default false. `starter-kit-fps` `player.tscn` authors
   * `true` so the shot ray hits `Area3D` enemies. Default false matches Godot and the
   * existing sensor predicate.
   */
  readonly collideWithAreas?: boolean;
}

/** Godot's own default for a `RayCast`'s `collision_mask`: layer 1. It is NOT the space query's
 *  default (every layer) — Godot gives the node and the raw query different defaults, and each is
 *  spelled where it belongs. */
const RAYCAST_DEFAULT_MASK = 1;

/** Build a `RayCast`'s query. One per `RayCast` node in the translated tree. */
export function createRayCast3D(options: CreateRayCast3DOptions): RayCast3D {
  const { node, space } = options;
  const excluded = [...(options.exclude ?? [])];
  let enabled = options.enabled;
  let collisionMask = uint32RayCastMask(options.mask ?? RAYCAST_DEFAULT_MASK);
  let target = {
    x: options.castTo.x,
    y: options.castTo.y,
    z: options.castTo.z,
  };
  let last: RayResult | undefined;

  const cast = (): RayResult => {
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    // The ray's world origin is the node's world translation; its end point is `target_position`
    // (a LOCAL offset) carried through the node's full world matrix.
    const from: Vector3Like = { x: e[12] as number, y: e[13] as number, z: e[14] as number };
    const to: Vector3Like = {
      x:
        (e[0] as number) * target.x +
        (e[4] as number) * target.y +
        (e[8] as number) * target.z +
        (e[12] as number),
      y:
        (e[1] as number) * target.x +
        (e[5] as number) * target.y +
        (e[9] as number) * target.z +
        (e[13] as number),
      z:
        (e[2] as number) * target.x +
        (e[6] as number) * target.y +
        (e[10] as number) * target.z +
        (e[14] as number),
    };
    last = space.intersectRay(
      from,
      to,
      excluded,
      collisionMask,
      true,
      options.collideWithAreas === true,
    );
    return last;
  };

  return {
    node,
    get enabled(): boolean {
      return enabled;
    },
    set enabled(value: boolean) {
      this.setEnabled(value);
    },
    setEnabled(value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('RayCast.enabled requires bool.');
      if (enabled === value) return;
      enabled = value;
      if (!enabled) last = undefined;
    },
    isEnabled(): boolean {
      return enabled;
    },
    get collisionMask(): number {
      return collisionMask;
    },
    set collisionMask(value: number) {
      this.setCollisionMask(value);
    },
    setCollisionMask(value: number): void {
      collisionMask = uint32RayCastMask(value);
    },
    getCollisionMask(): number {
      return collisionMask;
    },
    setCollisionMaskValue(layerNumber: number, value: boolean): void {
      const bit = rayCastLayerBit(layerNumber, 1, 32, 'RayCast3D.set_collision_mask_value');
      if (typeof value !== 'boolean') {
        throw new TypeError('RayCast3D.set_collision_mask_value requires bool.');
      }
      collisionMask = value ? (collisionMask | bit) >>> 0 : (collisionMask & ~bit) >>> 0;
    },
    getCollisionMaskValue(layerNumber: number): boolean {
      const bit = rayCastLayerBit(layerNumber, 1, 32, 'RayCast3D.get_collision_mask_value');
      return (collisionMask & bit) !== 0;
    },
    setCollisionMaskBit(bitNumber: number, value: boolean): void {
      const bit = rayCastLayerBit(bitNumber, 0, 31, 'RayCast.set_collision_mask_bit');
      if (typeof value !== 'boolean') {
        throw new TypeError('RayCast.set_collision_mask_bit requires bool.');
      }
      collisionMask = value ? (collisionMask | bit) >>> 0 : (collisionMask & ~bit) >>> 0;
    },
    getCollisionMaskBit(bitNumber: number): boolean {
      const bit = rayCastLayerBit(bitNumber, 0, 31, 'RayCast.get_collision_mask_bit');
      return (collisionMask & bit) !== 0;
    },
    addException(body: ExcludableBody): void {
      if (!excluded.includes(body)) excluded.push(body);
    },
    isColliding(): boolean {
      // An enabled node receives its normal physics-frame refresh. A disabled node does not cast
      // implicitly, but `force_raycast_update()` is explicitly allowed while disabled and the
      // result it placed in the cache remains observable through `is_colliding()`.
      if (!enabled) return last !== undefined && !last.empty();
      return !cast().empty();
    },
    forceRaycastUpdate(): void {
      cast();
    },
    getCollider(): unknown {
      return last !== undefined && !last.empty() ? last.collider : null;
    },
    getCollisionNormal(): Vector3 {
      return last !== undefined && !last.empty() ? last.normal : VECTOR3_ZERO;
    },
    getCollisionPoint(): Vector3 {
      return last !== undefined && !last.empty() ? last.position : VECTOR3_ZERO;
    },
    get targetPosition(): Vector3Like {
      return target;
    },
    set targetPosition(value: Vector3Like) {
      target = { x: value.x, y: value.y, z: value.z };
    },
  };
}

function uint32RayCastMask(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('RayCast.collision_mask requires an unsigned 32-bit integer.');
  }
  return value >>> 0;
}

function rayCastLayerBit(value: number, minimum: number, maximum: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} layer must be in [${minimum}, ${maximum}].`);
  }
  return 1 << (value - minimum);
}

/**
 * `body.collision_layer = value` — `platformer-3d-godot4` `enemy.gd:47` writes `0` on a dying enemy.
 *
 * Godot keeps the property on the `CollisionObject`; this port keeps it per collider, so the write
 * walks the body's own colliders — the same set Godot's one property covers. It takes effect on the
 * LIVE world with no rebuild, because both rules read the registry every time they run: the next
 * `world.step` filters this body's pairs by the new layer (`godotContactFilter`) and the next query
 * stops seeing it (`godotCanCollideWith`). Writing `0` therefore does in this port what it does in
 * Godot — the body disappears from every scanner while still colliding with everything its own
 * unchanged `collision_mask` names.
 */
export function setCollisionLayer(
  body: CollisionObjectBody,
  layers: CollisionLayers,
  value: number,
): void {
  for (let i = 0; i < body.numColliders(); i += 1) layers.setLayer(body.collider(i), value);
}

/** `body.collision_mask = value` — the other half of the same property pair, written the same way. */
export function setCollisionMask(
  body: CollisionObjectBody,
  layers: CollisionLayers,
  value: number,
): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`CollisionObject.collision_mask requires an unsigned 32-bit integer; received ${String(value)}.`);
  }
  const count = body.numColliders();
  if (count === 0) {
    throw new Error('CollisionObject.collision_mask write requires a live retained Rapier collider binding.');
  }
  for (let i = 0; i < count; i += 1) layers.setMask(body.collider(i), value);
}

/**
 * `body.collision_layer` — the readable half, off the registry.
 *
 * @throws on a body with no colliders. Godot answers from the object itself, which always has the
 * property; here the value lives on the colliders, so a body with none has no answer to give and
 * inventing Godot's default would report a layer this body does not have.
 */
export function getCollisionLayer(body: CollisionObjectBody, layers: CollisionLayers): number {
  return layers.layerOf(firstCollider(body, 'collision_layer'));
}

/** `body.collision_mask` — the readable half of the mask. */
export function getCollisionMask(body: CollisionObjectBody, layers: CollisionLayers): number {
  return layers.maskOf(firstCollider(body, 'collision_mask'));
}

function collisionBit(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 31) {
    throw new RangeError(`${member} requires a bit from 0 through 31; received ${String(value)}.`);
  }
  return value;
}

export function getCollisionLayerBit(
  body: CollisionObjectBody,
  layers: CollisionLayers,
  bit: number,
): boolean {
  const index = collisionBit(bit, 'CollisionObject.get_collision_layer_bit');
  return ((getCollisionLayer(body, layers) >>> 0) & ((1 << index) >>> 0)) !== 0;
}

export function getCollisionMaskBit(
  body: CollisionObjectBody,
  layers: CollisionLayers,
  bit: number,
): boolean {
  const index = collisionBit(bit, 'CollisionObject.get_collision_mask_bit');
  return ((getCollisionMask(body, layers) >>> 0) & ((1 << index) >>> 0)) !== 0;
}

/** Godot 3's bit-level layer mutation over the same retained mask as `collision_layer`. */
export function setCollisionLayerBit(
  body: CollisionObjectBody,
  layers: CollisionLayers,
  bit: number,
  enabled: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject.set_collision_layer_bit requires a bool value.');
  const index = collisionBit(bit, 'CollisionObject.set_collision_layer_bit');
  const flag = (1 << index) >>> 0;
  const current = getCollisionLayer(body, layers) >>> 0;
  setCollisionLayer(body, layers, enabled ? (current | flag) >>> 0 : (current & ~flag) >>> 0);
}

/** Godot 3's bit-level mask mutation over the same retained mask as `collision_mask`. */
export function setCollisionMaskBit(
  body: CollisionObjectBody,
  layers: CollisionLayers,
  bit: number,
  enabled: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject.set_collision_mask_bit requires a bool value.');
  const index = collisionBit(bit, 'CollisionObject.set_collision_mask_bit');
  const flag = (1 << index) >>> 0;
  const current = getCollisionMask(body, layers) >>> 0;
  setCollisionMask(body, layers, enabled ? (current | flag) >>> 0 : (current & ~flag) >>> 0);
}

function collisionLayerNumber(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new RangeError(`${member} requires a layer number from 1 through 32; received ${String(value)}.`);
  }
  return value - 1;
}

export function getCollisionLayerValue(body: CollisionObjectBody, layers: CollisionLayers, layerNumber: number): boolean {
  return getCollisionLayerBit(body, layers, collisionLayerNumber(layerNumber, 'CollisionObject3D.get_collision_layer_value'));
}

export function setCollisionLayerValue(body: CollisionObjectBody, layers: CollisionLayers, layerNumber: number, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject3D.set_collision_layer_value enabled must be bool.');
  setCollisionLayerBit(body, layers, collisionLayerNumber(layerNumber, 'CollisionObject3D.set_collision_layer_value'), enabled);
}

export function getCollisionMaskValue(body: CollisionObjectBody, layers: CollisionLayers, layerNumber: number): boolean {
  return getCollisionMaskBit(body, layers, collisionLayerNumber(layerNumber, 'CollisionObject3D.get_collision_mask_value'));
}

export function setCollisionMaskValue(body: CollisionObjectBody, layers: CollisionLayers, layerNumber: number, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject3D.set_collision_mask_value enabled must be bool.');
  setCollisionMaskBit(body, layers, collisionLayerNumber(layerNumber, 'CollisionObject3D.set_collision_mask_value'), enabled);
}

function firstCollider(body: CollisionObjectBody, property: string): FilterableCollider {
  if (body.numColliders() === 0) {
    throw new Error(
      `godot-compat: read \`${property}\` from a body with no colliders. Godot keeps the property ` +
        'on the CollisionObject and this port keeps it on that object`s colliders, so a body that ' +
        'built none has no value to report.',
    );
  }
  return body.collider(0);
}

/** Which of Godot 4's three angular locks — `axis_lock_angular_x` and its two siblings. */
export type AngularAxis = 'x' | 'y' | 'z';

/** A Rapier 3D rigid body, narrowed to the per-axis rotation switch. Rapier's `RigidBody`
 *  satisfies it. `wakeUp` is Rapier's own fourth argument and is always `true` here, for the reason
 *  `rigid-body-3d.ts`'s `setMode` passes it: a sleeping body handed a new lock must re-enter the
 *  simulation, or the write appears to do nothing until something else nudges it. */
export interface RotationLockableBody {
  setEnabledRotations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean): void;
}

/** Rapier exposes translation locks as the same all-axis setter shape as rotations. */
export interface TranslationLockableBody {
  setEnabledTranslations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean): void;
}

/** The mirror of the triple Rapier will not report — see this module's Resource ownership. */
const angularLocks = new WeakMap<RotationLockableBody, Record<AngularAxis, boolean>>();
const linearLocks = new WeakMap<TranslationLockableBody, Record<AngularAxis, boolean>>();

/** Godot's own default: nothing is locked, which is Rapier's default too. */
function locksOf(body: RotationLockableBody): Record<AngularAxis, boolean> {
  return angularLocks.get(body) ?? { x: false, y: false, z: false };
}

/**
 * `body.axis_lock_angular_x = locked` (and `_y`, `_z`) — `enemy.gd:44-46`.
 *
 * Godot LOCKS when the property is `true`; Rapier ENABLES when its argument is `true`, so the
 * triple is inverted on the way through. Rapier has no per-axis setter, so the other two axes are
 * re-asserted from the mirror on every write — which is why the mirror has to exist and why the
 * port must apply an authored `.tscn` lock through this same function.
 */
export function setAxisLockAngular(
  body: RotationLockableBody,
  axis: AngularAxis,
  locked: boolean,
): void {
  const next = { ...locksOf(body), [axis]: locked };
  angularLocks.set(body, next);
  body.setEnabledRotations(!next.x, !next.y, !next.z, true);
}

/** `body.axis_lock_angular_x` — the readable half of the property, off the mirror. */
export function getAxisLockAngular(body: RotationLockableBody, axis: AngularAxis): boolean {
  return locksOf(body)[axis];
}

function linearLocksOf(body: TranslationLockableBody): Record<AngularAxis, boolean> {
  return linearLocks.get(body) ?? { x: false, y: false, z: false };
}

/** One live Godot linear-axis lock over Rapier's native enabled-translation triple. */
export function setAxisLockLinear(
  body: TranslationLockableBody,
  axis: AngularAxis,
  locked: boolean,
): void {
  if (typeof locked !== 'boolean') throw new TypeError('axis_lock_linear requires bool.');
  const next = { ...linearLocksOf(body), [axis]: locked };
  linearLocks.set(body, next);
  body.setEnabledTranslations(!next.x, !next.y, !next.z, true);
}

/** Read the exact retained triple supplied to Rapier's write-only translation-lock setter. */
export function getAxisLockLinear(body: TranslationLockableBody, axis: AngularAxis): boolean {
  return linearLocksOf(body)[axis];
}
