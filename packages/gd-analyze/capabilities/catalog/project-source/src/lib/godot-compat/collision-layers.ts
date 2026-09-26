/**
 * Godot's `collision_layer`/`collision_mask`, as PLAIN DATA the port keeps per collider plus the two
 * predicates Godot's own servers test them with. Every collision decision in a translated game —
 * which pairs touch, which colliders a query can see — comes through here.
 *
 * ## Why the data is here and not in Rapier's `InteractionGroups`
 *
 * Rapier packs a 16-bit MEMBERSHIP half and a 16-bit FILTER half into one u32 and tests a pair with
 * an AND OF TWO DIRECTIONS: `(a.memberships & b.filter) && (b.memberships & a.filter)`. Godot's
 * rule is not that shape and cannot be written into those two halves, whatever is put in them:
 *
 * | Godot 4.4-stable | expression | what it decides |
 * |---|---|---|
 * | `GodotCollisionObject3D::collides_with` (`modules/godot_physics_3d/godot_collision_object_3d.h`:176-178) | `p_other->collision_layer & collision_mask` | ONE-DIRECTIONAL: does *this* object's mask name the other's layer |
 * | `GodotCollisionObject3D::interacts_with` (same file, :180-182) | `collision_layer & p_other->collision_mask \|\| p_other->collision_layer & collision_mask` | the OR of both directions — the broad-phase pairing gate |
 * | `GodotBodyPair3D::setup` (`modules/godot_physics_3d/godot_body_pair_3d.cpp`:261-283) | `interacts_with && !exception`, then `collide_A = (A.mode > BODY_MODE_KINEMATIC) && A->collides_with(B)`, same for B; the pair is dropped when NEITHER holds | whether two bodies actually collide |
 * | `_can_collide_with` (`modules/godot_physics_3d/godot_space_3d.cpp`:43-46) | `p_object->get_collision_layer() & p_collision_mask` | ONE-DIRECTIONAL: every query — `intersect_ray` (:131), `intersect_point` (:75), `intersect_shape` (:231), `cast_motion` (:290), `collide_shape` (:409), `get_rest_info` (:533) |
 * | `GodotSpace3D::_cull_aabb_for_body` (same file, :632) | `p_body->collides_with(other)` | the MOTION TEST a character's `move_and_slide` sweeps with — the mover's own mask, one direction |
 * | `GodotAreaPair3D::setup` (`modules/godot_physics_3d/godot_area_pair_3d.cpp`:34-36) | `area->collides_with(body)` | Area monitoring: the AREA's mask against the BODY's layer, one direction |
 *
 * Godot 3.6-stable shares only the QUERY rule. Its `_can_collide_with` (`servers/physics/
 * space_sw.cpp`:40-43) is the identical one-directional test, but 3.x has no `collides_with` at all
 * — every other mask decision there is `test_collision_mask` (`collision_object_sw.h`:171-173), the
 * symmetric OR of both directions: the pair rule (`body_pair_sw.cpp`:200-214) is that OR plus
 * at-least-one-side-dynamic with NO per-direction gating, and the character sweep
 * (`space_sw.cpp`:550) and Area monitoring (`area_pair_sw.cpp`:36) use the OR where 4.x uses the
 * one-directional mover's/area's mask. This port implements the 4.4 semantics for every source
 * version; a G3 source relying on the asymmetric corner (only the OTHER side's mask names the pair)
 * would collide/detect in Godot 3 and not here. No shipped fixture reaches that corner — the G3
 * fixtures' values all pass through the query rule or hold in the asker's own direction.
 *
 * So the SOLVED-COLLISION rule for two bodies is an OR of two directional tests, each gated on that
 * side being dynamic — {@link godotContactFilter}. `interacts_with`'s own OR adds nothing on top of
 * it (`collide_A` implies its second term), and what it separately enables — a pair that reports
 * contacts without solving them — has no reader in this lane. An AND cannot express that OR: a body
 * whose `collision_layer` is written to 0 (`platformer-3d-godot4` `enemy.gd:47`, on a dying enemy)
 * keeps colliding with the floor in Godot, because the floor's layer is still in the enemy's
 * unchanged mask — while under an InteractionGroups encoding a 0 membership drops the pair in
 * Rapier's own narrow phase, before any hook can see it, and the corpse falls through the world.
 *
 * The QUERY rule is the other one-directional test and is the reason colliders here carry Rapier's
 * DEFAULT groups: filtering a query by membership would filter the contact pair too. Queries pass
 * {@link godotCanCollideWith} as their Rapier `filterPredicate` instead, which is the same test
 * `_can_collide_with` runs and applies to nothing else.
 *
 * ## Resource ownership
 *
 * **Owns:** two things, both per world. (1) The layer/mask record per collider, in a `WeakMap` keyed
 * by the collider itself — so an entry ends exactly when the collider it describes is dropped, and
 * there is no teardown path to get wrong (a `Map` keyed by handle would outlive the collider and
 * then answer for whatever Rapier reused that handle for, which in a game that spawns and frees
 * scenes is every frame). (2) The set of DYNAMIC body handles, rebuilt wholesale by
 * `sampleBodyModes` immediately before each step — a snapshot, never a maintained mirror, so a
 * script that changes a body's mode needs no notification and a reused handle cannot answer for its
 * previous tenant. **Shares:** nothing; it holds no Rapier object between calls. **Teardown:** none
 * — dropped with the world.
 */

/** A Rapier collider, narrowed to the active-hooks bit a filtered pair needs. Rapier's own
 *  `Collider` (2D and 3D) satisfies it. */
export interface LayeredCollider {
  activeHooks(): number;
  setActiveHooks(activeHooks: number): void;
}

/** `ActiveHooks.FILTER_CONTACT_PAIRS` (`@dimforge/rapier3d-compat/pipeline/physics_hooks`, the same
 *  value in 2D). Rapier consults `PhysicsHooks.filterContactPair` for a pair only when AT LEAST ONE
 *  of its colliders carries this bit; without it the pair takes Rapier's own answer and Godot's rule
 *  never runs. The raw bit is inlined rather than imported because THIS file serves both surfaces:
 *  a Godot game is 2D or 3D, and importing the enum would mean naming one of `rapier3d-compat` /
 *  `rapier2d-compat` in a file the other half also compiles. The 3D-only files
 *  (`kinematic-body-3d.ts`, `grid-map-instances.ts`) import their Rapier enums from the library. */
const FILTER_CONTACT_PAIRS = 1;

/** Arm a collider so the port's `filterContactPair` is consulted for every pair it is in.
 *  Idempotent, and preserves any other active hook already set. */
export function armContactFilter(collider: LayeredCollider): void {
  collider.setActiveHooks(collider.activeHooks() | FILTER_CONTACT_PAIRS);
}

/** Godot's own default for a freshly created `CollisionObject`: layer 1, mask 1. A collider this
 *  registry was never told about reads exactly that — see {@link CollisionLayers.layerOf}. */
const GODOT_DEFAULT_LAYER = 1;
const GODOT_DEFAULT_MASK = 1;

/**
 * The port-owned `collision_layer`/`collision_mask` of every collider in one world.
 *
 * Godot keeps the pair on the `CollisionObject` (the body), not on its shapes; this keeps it per
 * COLLIDER because that is what both predicates are handed — Rapier's query predicate gets a
 * collider and its contact hook gets collider handles. A body-level write
 * (`physics-body-3d.ts`'s `setCollisionLayer`) walks the body's own colliders, which is the same set
 * Godot's one property covers.
 */
export interface CollisionLayers {
  /**
   * Record a collider's owning object's `collision_layer`/`collision_mask`, and — in the SAME call —
   * arm the contact filter for it. The two halves are one call for the reason
   * `addCollisionExceptionWith`'s are: the data is worthless unless Rapier consults the hook that
   * reads it, and splitting them makes a collider that is registered but never filtered possible.
   */
  set(collider: LayeredCollider, layer: number, mask: number): void;
  /**
   * Read every body's MODE off the world, for the step that is about to run. The port calls this
   * immediately before `world.step`, and it is not optional — see {@link godotContactFilter} for
   * why the filter cannot ask Rapier this question itself.
   */
  sampleBodyModes(world: BodyModeWorld): void;
  /** Was this body handle DYNAMIC in the last sample? Godot's `mode > BODY_MODE_KINEMATIC`. */
  isDynamic(body: number): boolean;
  /** `collision_layer = value` for ONE collider — the live write, through the body-level setter. */
  setLayer(collider: LayeredCollider, layer: number): void;
  /** `collision_mask = value` for ONE collider. */
  setMask(collider: LayeredCollider, mask: number): void;
  /** This collider's `collision_layer`, or Godot's own default for one never registered. */
  layerOf(collider: object): number;
  /** This collider's `collision_mask`, or Godot's own default for one never registered. */
  maskOf(collider: object): number;
}

const COLLISION_OBJECT_2D_LAYERS = new WeakMap<object, { layer: number; references: number }>();

/** Bind one emitted CollisionObject2D identity to its authored body-level layer. */
export function bindCollisionObject2DLayer(object: object, layer: number): void {
  if (!Number.isSafeInteger(layer) || layer < 0 || layer > 0xffff_ffff) {
    throw new RangeError(`CollisionObject2D.collision_layer requires an unsigned 32-bit integer; received ${String(layer)}.`);
  }
  const existing = COLLISION_OBJECT_2D_LAYERS.get(object);
  if (existing !== undefined) {
    if (existing.layer !== layer) throw new Error('CollisionObject2D native shapes disagree on their owner collision layer.');
    existing.references += 1;
    return;
  }
  COLLISION_OBJECT_2D_LAYERS.set(object, { layer, references: 1 });
}

export function releaseCollisionObject2DLayer(object: object): void {
  const existing = COLLISION_OBJECT_2D_LAYERS.get(object);
  if (existing === undefined) throw new Error('CollisionObject2D layer binding underflow.');
  existing.references -= 1;
  if (existing.references === 0) COLLISION_OBJECT_2D_LAYERS.delete(object);
}

export function getCollisionLayerBit2D(object: object, bit: number): boolean {
  if (!Number.isSafeInteger(bit) || bit < 0 || bit > 31) {
    throw new RangeError(`CollisionObject2D.get_collision_layer_bit requires a bit from 0 through 31; received ${String(bit)}.`);
  }
  const state = COLLISION_OBJECT_2D_LAYERS.get(object);
  if (state === undefined) throw new Error('CollisionObject2D.get_collision_layer_bit requires an emitted collision-layer binding.');
  return (state.layer & (1 << bit)) !== 0;
}

/** A Rapier world, narrowed to the body walk {@link CollisionLayers.sampleBodyModes} makes. Rapier's
 *  own `World` (2D and 3D) satisfies it. */
export interface BodyModeWorld {
  forEachRigidBody(
    callback: (body: { readonly handle: number; isDynamic(): boolean }) => void,
  ): void;
}

/** Build the registry. ONE per world; the port threads it to every scene and to its `PhysicsHooks`. */
export function createCollisionLayers(): CollisionLayers {
  const records = new WeakMap<object, { layer: number; mask: number }>();
  // Body handle -> was it dynamic at the last sample. REBUILT each sample rather than maintained,
  // so a body whose mode a script changed (`set_mode(MODE_RIGID)` on a dying enemy) is right on the
  // next step with nothing to keep in sync, and a freed handle Rapier reuses cannot answer for its
  // previous tenant.
  let dynamicBodies = new Set<number>();
  const recordFor = (collider: object): { layer: number; mask: number } => {
    let record = records.get(collider);
    if (record === undefined) {
      record = { layer: GODOT_DEFAULT_LAYER, mask: GODOT_DEFAULT_MASK };
      records.set(collider, record);
    }
    return record;
  };
  return {
    set(collider, layer, mask): void {
      records.set(collider, { layer, mask });
      armContactFilter(collider);
    },
    sampleBodyModes(world): void {
      const sampled = new Set<number>();
      world.forEachRigidBody((body) => {
        if (body.isDynamic()) sampled.add(body.handle);
      });
      dynamicBodies = sampled;
    },
    isDynamic(body): boolean {
      return dynamicBodies.has(body);
    },
    setLayer(collider, layer): void {
      recordFor(collider).layer = layer;
      armContactFilter(collider);
    },
    setMask(collider, mask): void {
      recordFor(collider).mask = mask;
      armContactFilter(collider);
    },
    layerOf(collider): number {
      return records.get(collider)?.layer ?? GODOT_DEFAULT_LAYER;
    },
    maskOf(collider): number {
      return records.get(collider)?.mask ?? GODOT_DEFAULT_MASK;
    },
  };
}

/**
 * Godot's `_can_collide_with` (`godot_space_3d.cpp`:43-46) — the QUERY rule, and the only one.
 *
 * A ray, a shape cast or a motion test sees an object exactly when the ASKER's `collision_mask`
 * names the object's `collision_layer`; the object's own mask has no say. So this is what every
 * query in this capability passes as its Rapier `filterPredicate`, and it is why a collider with
 * `collision_layer = 0` is invisible to every query while still colliding — the two rules are
 * genuinely different tests, not one test read twice.
 */
export function godotCanCollideWith(
  layers: CollisionLayers,
  collider: object,
  mask: number,
): boolean {
  return (layers.layerOf(collider) & mask) !== 0;
}

/** A Rapier world, narrowed to the ONE lookup the contact filter may make while a step is running.
 *  Rapier's own `World` (2D and 3D) satisfies it.
 *
 *  `getCollider` is a JS map lookup and is safe here; `getRigidBody(...).isDynamic()` is NOT, and
 *  that is not a style point — Rapier holds the rigid-body set MUTABLY BORROWED for the duration of
 *  `step`, so any body query from inside `filterContactPair` throws "recursive use of an object
 *  detected which would lead to unsafe aliasing in rust" out of the WASM boundary. Rapier swallows
 *  the throw and drops the pair, so the symptom is not an error anyone sees: it is every filtered
 *  body falling through the world. Body modes therefore come from
 *  {@link CollisionLayers.sampleBodyModes}, taken just before the step. */
export interface CollisionFilterWorld {
  getCollider(handle: number): object | undefined;
}

/** What {@link godotContactFilter} needs from the port. */
export interface ContactFilterOptions {
  /** The port's ONE Rapier world — the handles the hook is called with are resolved against it. */
  readonly world: CollisionFilterWorld;
  /** The world's layer/mask registry. */
  readonly layers: CollisionLayers;
  /** The world's `add_collision_exception_with` set, when the project has one — a project where no
   *  script excepts a pair builds none (`physics-body-3d.ts`). */
  readonly exceptions?: { has(a: number, b: number): boolean };
}

/**
 * Godot's `GodotBodyPair3D::setup` gate (`godot_body_pair_3d.cpp`:261-275), as a Rapier
 * `PhysicsHooks.filterContactPair` predicate: TRUE keeps the pair, FALSE suppresses its contacts.
 *
 * ```cpp
 * if (!A->interacts_with(B) || A->has_exception(B->get_self()) || B->has_exception(A->get_self())) { … }
 * collide_A = (A->get_mode() > PhysicsServer3D::BODY_MODE_KINEMATIC) && A->collides_with(B);
 * collide_B = (B->get_mode() > PhysicsServer3D::BODY_MODE_KINEMATIC) && B->collides_with(A);
 * if (!collide_A && !collide_B) { … no contacts … }
 * ```
 *
 * Written out: the pair collides when EITHER side is dynamic AND that side's `collision_mask` names
 * the other's `collision_layer`. Three consequences worth stating, each of which a plainer reading
 * of the docs gets wrong:
 *
 *  - it is an OR, so `collision_layer = 0` does NOT stop a dying enemy from landing on the floor —
 *    its own mask still names the floor (`enemy.gd:47`, the case this whole encoding exists for);
 *  - the dynamic gate is real: a kinematic character and a static floor whose masks name each other
 *    still produce no contacts in Godot (a character moves by the motion test, not by the solver),
 *    and a dynamic body whose mask is empty passes THROUGH a static body that names it;
 *  - `interacts_with`'s OR is not tested separately here because `collide_A` implies it. What it
 *    alone enables in Godot is a pair that REPORTS contacts without solving them
 *    (`max_contacts_reported`), which nothing in this lane reads.
 *
 * Rapier calls the hook with HANDLES, so the colliders are resolved through the world — which is
 * also what keeps the registry keyed by the collider itself (see this module's header) — and the
 * body modes come from the sample the port took just before the step, because asking Rapier for
 * them here throws (see {@link CollisionFilterWorld}). A collider the world does not know, or a
 * body absent from the sample, is treated as Godot treats a static object: present, never dynamic.
 */
export function godotContactFilter(
  options: ContactFilterOptions,
): (collider1: number, collider2: number, body1: number, body2: number) => boolean {
  const { world, layers, exceptions } = options;
  return (collider1, collider2, body1, body2): boolean => {
    if (exceptions?.has(body1, body2) === true) return false;
    const first = world.getCollider(collider1);
    const second = world.getCollider(collider2);
    if (first === undefined || second === undefined) return true;
    if (layers.isDynamic(body1) && (layers.layerOf(second) & layers.maskOf(first)) !== 0) {
      return true;
    }
    return layers.isDynamic(body2) && (layers.layerOf(first) & layers.maskOf(second)) !== 0;
  };
}
