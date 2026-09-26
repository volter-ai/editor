/**
 * `PhysicsServer.space_get_direct_state(World.get_space())` and the one query it is reached for —
 * `PhysicsDirectSpaceState.intersect_ray` — over the PORT'S own Rapier 3D world.
 *
 * ## Two of the three members are Godot's own indirection, and say so
 *
 * `follow_camera.gd:48` spells the lookup in three hops because Godot separates them: a `Spatial`
 * belongs to a `World`, a `World` names its space by RID (the ground truth records
 * `typeof(get_world().get_space()) == TYPE_RID`), and only the `PhysicsServer` singleton can turn
 * that RID into something you can query. Rapier collapses all three: the `World` IS the space AND
 * the query interface, because `castRayAndGetNormal` is a method on it.
 *
 * So {@link getSpace} is an identity and is written as one rather than being hidden. `Node.get_tree`
 * is the standing precedent for a covered member whose backend is a SHAPE rather than a call —
 * the difference here is that {@link spaceGetDirectState} really does build something: the ray
 * result Godot returns is a Dictionary of six keys and Rapier's is a nullable object with three,
 * and the exclusion list and the sensor default are both real translations.
 *
 * ## What `intersect_ray` had to be measured on, in both engines
 *
 * | Godot 3.6 | Rapier 3D 0.14 | what compat does |
 * |---|---|---|
 * | `intersect_ray(from, to)` takes two POINTS | `castRayAndGetNormal(ray, maxToi, …)` takes an origin and a direction | `dir = to - from` UNNORMALIZED with `maxToi = 1`, so time-of-impact is the fraction along the segment and `position = from + dir * toi` |
 * | misses return an EMPTY DICTIONARY | misses return `null` | a result whose `empty()` is `true` |
 * | `collide_with_areas` defaults FALSE | sensors are hit like anything else | a `!collider.isSensor()` predicate |
 * | `exclude` is a set of body RIDs | one `filterExcludeRigidBody`, or a predicate | the same predicate, comparing `collider.parent()`'s handle |
 * | `collision_mask` selects layers ONE-DIRECTIONALLY (`_can_collide_with`, `modules/godot_physics_3d/godot_space_3d.cpp`:43-46, reached from `intersect_ray` at :131) | `InteractionGroups`, an AND of two directions | the same predicate again, over the world's own layer registry (`collision-layers.ts` `godotCanCollideWith`) |
 *
 * The sensor row is not a detail: the game is full of `Area` coin pickups, and the ground truth's
 * `throughAreaWithDefaultFlags` measures Godot's answer as a MISS while the Rapier probe hits the
 * sensor. Without the predicate a follow camera would slam onto the player every time a coin
 * crossed its sight line.
 *
 * ## A ray whose origin is INSIDE a shape, which neither Rapier mode answers
 *
 * Godot ignores that shape entirely and reports the next one along the segment (ground truth
 * `startingInsideTheShape`: cast from inside the floor, it returns the sphere above it). Rapier
 * offers two answers and neither is that one — `solid: true` returns a hit at `toi = 0` with a ZERO
 * normal, `solid: false` returns the shape's far boundary from the inside.
 *
 * So this casts with `solid: true` and RE-CASTS without each `toi === 0` collider, which is Godot's
 * rule rather than an approximation of it: `solid: true` names the containing shapes exactly, and
 * dropping them and asking again is what "ignore that shape and report the next one" means. The
 * loop runs once per containing shape and stops the moment a real hit comes back.
 *
 * `platformer-3d`'s enemy is why. `enemy.tscn` parents `Armature/RayWall` inside its own
 * `Sphere1` (radius 0.68, 0.107 away), and Godot's `exclude_parent` does NOT help — it excepts the
 * ray's DIRECT parent only, and that parent is a plain `Spatial`. Under `solid: false` that ray
 * reported the inside of the enemy's own body on every single step, `advance` was never true, and
 * all four enemies stood still forever with nothing logged anywhere.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. **Shares:** the Rapier `World`, the collider resolver and the world's layer
 * registry the port handed it. **Teardown:** none.
 */

import type { Vector3Like } from 'three';
import { type CollisionLayers, godotCanCollideWith } from './collision-layers';
import { godotCarrierOfRid, type GodotRid } from './gdscript-builtins';
import {
  physicsShapeQueryMethods3D,
  type PhysicsShapeQueryMethods3D,
} from './physics-query-3d';
import { type Vector3, vec3 } from './variant-3d';

/** The half of a Rapier 3D `Collider` this file touches. Rapier's own satisfies it. */
export interface RayColliderLike {
  isSensor(): boolean;
  parent(): { handle: unknown } | null;
}

/** The half of a Rapier 3D `RayColliderIntersection` this file reads. */
export interface RayHitLike {
  readonly collider: RayColliderLike;
  /** In units of the ray's `dir`, which is why `dir` is left unnormalized. */
  readonly timeOfImpact: number;
  /** Outward surface normal at the hit point, on the collider that was hit. */
  readonly normal: Vector3Like;
}

/**
 * The half of a Rapier 3D `World` this file drives. Rapier's own `World` satisfies it, and its
 * `ray` parameter is satisfied by a plain `{ origin, dir }` record — verified against the real
 * library in `test/physics-state-3d.test.ts`, which is why THIS file imports no Rapier at all.
 * (The capability as a whole does depend on `@dimforge/rapier3d-compat`: `collider-3d.ts`,
 * `grid-map-instances.ts`, `kinematic-body-3d.ts` and `rigid-body-3d.ts` call its static
 * factories. A structural type here is still worth having — it is what lets this module's tests
 * drive a hand-built world.)
 */
export interface RayCastWorldLike {
  castRayAndGetNormal(
    ray: { origin: Vector3Like; dir: Vector3Like },
    maxToi: number,
    solid: boolean,
    filterFlags?: undefined,
    filterGroups?: undefined,
    filterExcludeCollider?: undefined,
    filterExcludeRigidBody?: undefined,
    filterPredicate?: (collider: RayColliderLike) => boolean,
  ): RayHitLike | null;
}

/** Anything the port can hand to `intersect_ray`'s exclusion list. Rapier's `RigidBody` satisfies
 *  it; Godot's own RIDs do not exist here — see {@link PhysicsDirectSpaceState.intersectRay}. */
export interface ExcludableBody {
  readonly handle: unknown;
}
export type PhysicsRayExclude3D = ExcludableBody | GodotRid;

/**
 * A ray that hit nothing — Godot's EMPTY result Dictionary.
 *
 * The three absent keys are declared as `?: undefined` rather than left out, and that is the whole
 * mechanism: TypeScript narrows a union by DISCARDING the members assignable to the guard's type,
 * and an interface that merely omits a property still accepts an object that has one. Without these
 * three, {@link RayHit} would be assignable to this and `if (!col.empty())` would narrow to `never`
 * instead of to the hit.
 */
export interface RayMiss {
  /** `col.empty()` — `follow_camera.gd:54`, `:57`, `:60`. Godot returns an EMPTY dictionary on a
   *  miss and the script tests exactly this. It is a `this is` predicate so the SAME test the
   *  Godot source writes is what tells TypeScript which half of {@link RayResult} it is holding —
   *  the type carries the narrowing, so the translated line stays the line Godot wrote. */
  empty(): this is RayMiss;
  readonly position?: undefined;
  readonly normal?: undefined;
  readonly collider?: undefined;
}

/**
 * A ray that hit something — Godot's populated result Dictionary.
 *
 * Godot's carries six keys (`collider`, `collider_id`, `normal`, `position`, `rid`, `shape`,
 * measured in the ground truth's `rays` block). Three are here. `collider_id` and `rid` are Godot
 * SERVER identities — an `ObjectID` and an RID — and this engine has neither; `shape` is a shape
 * index within a body, which Rapier answers with a collider rather than an index. None is touched
 * by any measured script (`follow_camera.gd` reads `.empty()` and `.position`), so inventing a
 * value for them would be inventing first-party data.
 *
 * The three that ARE here are REQUIRED, not optional: on a hit Godot always fills them, and making
 * them optional would hand every caller past the guard a value it still had to re-check.
 */
export interface RayHit {
  /** The same predicate {@link RayMiss.empty} declares — both halves must spell it, or a call on
   *  the union is an ordinary `boolean` and narrows nothing. It answers `false` here. */
  empty(): this is RayMiss;
  /** `col.position` — `follow_camera.gd:56`. */
  readonly position: Vector3;
  /** The hit surface's outward normal. */
  readonly normal: Vector3;
  /** The GAME's object for what was hit, as the port's resolver named it. */
  readonly collider: unknown;
}

/**
 * What `intersect_ray` returns — a hit or a miss, as a frozen record.
 *
 * Godot's result is one Dictionary whose keys are simply absent on a miss, and GDScript is happy to
 * read `col.position` on either because a missing key is `null` at runtime. A translated project is
 * TypeScript, so the same `if not col.empty():` the source writes has to MEAN something to the
 * compiler — hence the union: `empty()` is a `this is RayMiss` predicate on both halves, and the
 * false branch of it is a {@link RayHit} whose `position` needs no second check.
 */
export type RayResult = RayHit | RayMiss;

/**
 * Godot 4's `PhysicsRayQueryParameters3D` — the RefCounted bundle 4.x passes where 3.x passed
 * three positional arguments.
 *
 * A retained VALUE carrying exactly the fields the
 * measured surface builds one from. It is the ONE piece of Godot 4 reshape that is a real object
 * rather than a call: `intersect_ray` did not change what it asks the space, only how the question
 * is packaged, so the bundle is modelled here and {@link PhysicsDirectSpaceState.intersectRayQuery}
 * consumes it.
 *
 * The four fields the pinned dump (`godot-4.7-extension_api.json`) declares on `create` are
 * `from`, `to`, `collision_mask` (default `4294967295`) and `exclude` (default `[]`). A query made
 * with `new()` starts with the same zero vectors, all-layer mask and empty exclusion array as
 * Godot. `collide_with_areas` defaults FALSE and `collide_with_bodies` defaults TRUE; both remain
 * live inputs to the native collider predicate rather than detached compatibility state.
 */
export interface RayQueryParameters3D {
  from: Vector3;
  to: Vector3;
  exclude: readonly PhysicsRayExclude3D[];
  /** `collision_mask` — the layers this ray can see, Godot's one-directional query rule. */
  readonly mask: number;
  collisionMask: number;
  collideWithAreas: boolean;
  collideWithBodies: boolean;
}

/** Godot's all-layers `collision_mask` — the dump's own default for `PhysicsRayQueryParameters3D
 *  .create`'s third argument (`4294967295`, the value `follow_camera.gd:55`/`:61`/`:67` passes) and
 *  the same selection Godot 3.6's `intersect_ray` default (`2147483647`) makes. Both name every
 *  layer, so one default covers both dialects. */
const ALL_COLLISION_LAYERS = 0xffff_ffff;

/**
 * `PhysicsRayQueryParameters3D.create(from, to, collision_mask, exclude)` — a STATIC factory in
 * Godot 4, and `platformer-3d-godot4` `follow_camera.gd:52`/`:58`/`:64` build all three of the
 * camera's autoturn rays with it.
 *
 * `collision_mask` is carried, not dropped: {@link PhysicsDirectSpaceState.intersectRay} runs
 * Godot's own one-directional query rule over the world's layer registry, so a mask that selects a
 * subset selects that subset here too.
 */
export function rayQueryParameters(
  from: Vector3Like,
  to: Vector3Like,
  collisionMask: number = ALL_COLLISION_LAYERS,
  exclude: readonly PhysicsRayExclude3D[] = [],
): RayQueryParameters3D {
  const parameters = createRayQueryParameters3D();
  parameters.from = from;
  parameters.to = to;
  parameters.collisionMask = collisionMask;
  parameters.exclude = exclude;
  return parameters;
}

/**
 * `PhysicsRayQueryParameters3D.new()` — one retained mutable query value. Vector and Array
 * properties are copied at the property boundary, just as Godot's Variant-backed setters/getters
 * copy them; the direct-space-state consumes this same object without a translated shadow.
 */
export function createRayQueryParameters3D(): RayQueryParameters3D {
  let from = vec3(0, 0, 0);
  let to = vec3(0, 0, 0);
  let mask = ALL_COLLISION_LAYERS;
  let exclude: readonly PhysicsRayExclude3D[] = [];
  let collideWithAreas = false;
  let collideWithBodies = true;
  const parameters = {} as RayQueryParameters3D;
  Object.defineProperties(parameters, {
    from: {
      enumerable: true,
      get: () => vec3(from.x, from.y, from.z),
      set: (value: Vector3Like) => { from = vec3(value.x, value.y, value.z); },
    },
    to: {
      enumerable: true,
      get: () => vec3(to.x, to.y, to.z),
      set: (value: Vector3Like) => { to = vec3(value.x, value.y, value.z); },
    },
    exclude: {
      enumerable: true,
      get: () => [...exclude],
      set: (value: readonly PhysicsRayExclude3D[]) => {
        if (!Array.isArray(value)) {
          throw new TypeError('PhysicsRayQueryParameters3D.exclude requires an Array of RIDs or physics bodies.');
        }
        exclude = [...value];
      },
    },
    mask: { enumerable: true, get: () => mask },
    collisionMask: {
      enumerable: true,
      get: () => mask,
      set: (value: number) => {
        if (!Number.isSafeInteger(value) || value < 0 || value > ALL_COLLISION_LAYERS) {
          throw new RangeError('PhysicsRayQueryParameters3D.collision_mask requires an unsigned 32-bit integer.');
        }
        mask = value >>> 0;
      },
    },
    collideWithAreas: {
      enumerable: true,
      get: () => collideWithAreas,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') {
          throw new TypeError('PhysicsRayQueryParameters3D.collide_with_areas requires bool.');
        }
        collideWithAreas = value;
      },
    },
    collideWithBodies: {
      enumerable: true,
      get: () => collideWithBodies,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') {
          throw new TypeError('PhysicsRayQueryParameters3D.collide_with_bodies requires bool.');
        }
        collideWithBodies = value;
      },
    },
  });
  return parameters;
}

/** `PhysicsDirectSpaceState`, narrowed to the one member `follow_camera.gd` measures — in both of
 *  the argument shapes Godot has given it. */
export interface PhysicsDirectSpaceState extends PhysicsShapeQueryMethods3D {
  /**
   * `ds.intersect_ray(from, to, exclude)` — `follow_camera.gd:50`, `:51`, `:52`.
   *
   * `exclude` holds the port's own Rapier BODIES. Godot's holds RIDs, and `Object.get_rid` has no
   * backend in this capability (it is one of the fixture's own unresolved rows), so a port that
   * needs exclusion passes the body it already created rather than an identity compat would have
   * to mint. The measured fixture always passes an EMPTY list — see this module's header.
   *
   * `mask` is Godot's `collision_mask` for the cast (3.x's fourth argument, a `RayCast` node's own
   * property, or the 4.x parameters bundle's field). Omitted means every layer, which is what both
   * dialects default it to.
   */
  intersectRay(
    from: Vector3Like,
    to: Vector3Like,
    exclude?: readonly PhysicsRayExclude3D[],
    mask?: number,
    collideWithBodies?: boolean,
    collideWithAreas?: boolean,
  ): RayResult;
  /**
   * `ds.intersect_ray(parameters)` — Godot 4's one-argument shape
   * (`platformer-3d-godot4` `follow_camera.gd:52`/`:58`/`:64`).
   *
   * The SAME query as {@link intersectRay}, unpacked from the bundle {@link rayQueryParameters}
   * built: 4.x changed the argument packaging and nothing about what the space is asked, so there
   * is one cast here and not two.
   */
  intersectRayQuery(parameters: RayQueryParameters3D): RayResult;
}

/** What {@link spaceGetDirectState} needs from the port. */
export interface SpaceDirectStateOptions {
  /** A Rapier collider -> the game object a script expects on the result's `collider`. The same
   *  refusal `kinematic-body-3d.ts` records, for the same reason. */
  readonly resolveCollider: (collider: RayColliderLike) => unknown;
  /** The world's `collision_layer`/`collision_mask` registry — what a cast's own mask is tested
   *  against (`collision-layers.ts`). */
  readonly layers: CollisionLayers;
  readonly godotMajor: 3 | 4;
}

/**
 * `world.get_space()` — `follow_camera.gd:48`.
 *
 * The IDENTITY, deliberately. Godot hands back an RID it can do nothing with until the
 * `PhysicsServer` turns it into a query object; Rapier's `World` already is both. Writing the hop
 * out keeps the emitted line readable as the Godot line it came from, and keeps this file the one
 * place that says why there is nothing in it.
 */
export function getSpace<T extends RayCastWorldLike>(world: T): T {
  return world;
}

/**
 * `spatial.get_world()` — `follow_camera.gd:48`, only ever `get_world().get_space()`.
 *
 * Godot's `Spatial.get_world()` returns the `World` resource the node's viewport
 * holds — a game-global, shared by every node in the world. This engine has no
 * per-node link to the physics world (`kinematic-body-3d.ts` records the same:
 * the `Object3D` in the scene and the Rapier body are two objects with no link
 * between them), so the port threads its ONE Rapier `World` in and this hands it
 * straight back — the same IDENTITY {@link getSpace} is, for the same reason.
 * The three-hop `get_world().get_space()` is therefore two collapses written out
 * rather than hidden, so an emitted line stays readable as the Godot line it came
 * from. The node argument Godot's method carries is dropped deliberately: all
 * nodes share one world, so the result does not depend on which node asked, and
 * fabricating a per-node association would be inventing first-party data.
 */
export function getWorld<T extends RayCastWorldLike>(world: T): T {
  return world;
}

/**
 * Everything `intersect_ray` filters a collider by, as one Rapier `filterPredicate`. Four rejections,
 * each measured or cited in this module's header: an `Area` (Godot's `collide_with_areas` default),
 * a collider the CAST's own mask does not name (`_can_collide_with`, `godot_space_3d.cpp`:43-46 —
 * one direction, so a body written to `collision_layer = 0` is invisible to every ray), a shape the
 * ray's origin sits inside and has already reported, and a body in the caller's `exclude` list.
 */
function rayFilter(filter: {
  readonly layers: CollisionLayers;
  readonly mask: number;
  readonly excluded: readonly PhysicsRayExclude3D[];
  readonly containingOrigin: readonly RayColliderLike[];
  readonly collideWithAreas: boolean;
  readonly collideWithBodies: boolean;
}): (collider: RayColliderLike) => boolean {
  return (collider) => {
    if (collider.isSensor() ? !filter.collideWithAreas : !filter.collideWithBodies) return false;
    if (!godotCanCollideWith(filter.layers, collider, filter.mask)) return false;
    if (filter.containingOrigin.includes(collider)) return false;
    const owner = collider.parent();
    if (owner === null) return true;
    return !filter.excluded.some((body) => {
      if ('handle' in body) return body.handle === owner.handle;
      return godotCarrierOfRid(body) === owner;
    });
  };
}

/** `PhysicsServer.space_get_direct_state(space)` — `follow_camera.gd:48`. */
export function spaceGetDirectState(
  space: RayCastWorldLike,
  options: SpaceDirectStateOptions,
): PhysicsDirectSpaceState {
  const { resolveCollider, layers, godotMajor } = options;

  return {
    ...physicsShapeQueryMethods3D(space, { resolveCollider, layers, godotMajor }),
    intersectRay(from, to, exclude, mask, collideWithBodies, collideWithAreas): RayResult {
      const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
      const excluded = exclude ?? [];
      const collisionMask = mask ?? ALL_COLLISION_LAYERS;
      // Shapes the ray's ORIGIN sits inside, discovered as `toi === 0` answers and then dropped —
      // see this module's header. Godot reports what is BEHIND them, so each one is taken out of
      // the query and the cast repeated.
      const containingOrigin: RayColliderLike[] = [];
      let hit: RayHitLike | null = null;
      for (;;) {
        hit = space.castRayAndGetNormal(
          { origin: { x: from.x, y: from.y, z: from.z }, dir },
          // Time-of-impact is measured in `dir` lengths, so 1 IS the segment [from, to] — which is
          // what Godot's two-point form means. The ground truth's `tooShortToReach` is the case
          // this bounds.
          1,
          // `solid: true` is what NAMES a shape the origin is inside: it answers `toi === 0` for
          // exactly those and is identical to `solid: false` for every other shape.
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          rayFilter({
            layers,
            mask: collisionMask,
            excluded,
            containingOrigin,
            collideWithAreas: collideWithAreas === true,
            collideWithBodies: collideWithBodies !== false,
          }),
        );
        if (hit === null || hit.timeOfImpact > 0) break;
        // A collider the predicate above must now reject. If the same one comes back the identity
        // this loop turns on has failed, and spinning would hang the frame with nothing logged —
        // so say so instead.
        if (containingOrigin.includes(hit.collider)) {
          throw new Error(
            'godot-compat: intersect_ray kept being answered by the same collider at ' +
              'time-of-impact 0 after excluding it. Godot ignores a shape the ray starts inside ' +
              'and reports the next one along the segment; reproducing that needs the world to ' +
              'hand back the SAME collider object for one collider, and this one did not.',
          );
        }
        containingOrigin.push(hit.collider);
      }

      // `empty` is spelled as a METHOD with its predicate written out on both halves: an arrow
      // returning a plain boolean is not assignable to a `this is` signature, so the shorthand
      // would not type-check even though it behaves identically.
      if (hit === null) {
        const miss: RayMiss = {
          empty(): this is RayMiss {
            return true;
          },
        };
        return Object.freeze(miss);
      }
      const at = hit.timeOfImpact;
      const found: RayHit = {
        empty(): this is RayMiss {
          return false;
        },
        position: vec3(from.x + dir.x * at, from.y + dir.y * at, from.z + dir.z * at),
        normal: vec3(hit.normal.x, hit.normal.y, hit.normal.z),
        collider: resolveCollider(hit.collider),
      };
      return Object.freeze(found);
    },

    intersectRayQuery(parameters): RayResult {
      return this.intersectRay(
        parameters.from,
        parameters.to,
        parameters.exclude,
        parameters.mask,
        parameters.collideWithBodies,
        parameters.collideWithAreas,
      );
    },
  };
}
