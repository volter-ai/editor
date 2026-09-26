/**
 * test/physics-material-friction.test.ts — the friction a Godot surface reaches a Rapier contact
 * with is the PAIR MINIMUM, which is Godot's own `combine_friction` exactly.
 *
 * Godot combines a contact pair's friction as `ABS(MIN(A, B))`
 * (`servers/physics/body_pair_sw.cpp` `combine_friction`, 3.6-stable lines 196-198; identically
 * `servers/physics_3d/godot_body_pair_3d.cpp` 257-259 @ 4.3-stable), and Rapier ships that rule as
 * `CoefficientCombineRule.Min`. The compat seats (`godot-compat/collider-3d.ts`,
 * `godot-compat/grid-map-instances.ts`) name it on every contacting collider they build.
 *
 * Kept as a permanent guard on both of the verification doctrine's conditions:
 *
 *  1. **Easy to regress by an ordinary edit.** The rule is ONE inlined integer per seat (`1`), sat
 *     next to a second inlined integer for restitution (`3`). Every value in
 *     `CoefficientCombineRule` is a valid `number`, so a wrong one keeps every type and every
 *     other test green — and it stayed wrong (`Multiply`, `2`) through a full lane's fixtures
 *     because Min and Multiply AGREE at `0` and `1`, which is the only pair every committed
 *     fixture authored.
 *  2. **Invisible to the type system and to a short manual check.** The claim is about a
 *     coefficient the solver derives inside the physics step from two colliders' rules — not a
 *     value either collider stores. Reading the constants back proves nothing about which rule the
 *     solver applied; only stepping a real world and asking it does.
 *
 * So this steps REAL Rapier and reads the solver's own contact friction. `0.3` against `0.8` is
 * `0.3` under Min, `0.24` under Multiply, `0.55` under Average — three distinguishable numbers,
 * which is why those two coefficients and not a pair of extremes.
 *
 * The third case is Godot's `rough`, which is the same claim with the SIGN channel switched on:
 * `computed_friction()` hands the server `-friction`, so `ABS(MIN(A, B))` resolves to the rough
 * side's own magnitude and the flag means "this surface WINS the pair". It reaches Rapier as
 * `CoefficientCombineRule.Max` on that one collider, and Rapier resolves a disagreeing pair by the
 * higher-valued rule — so the seat's own default (`Min`) on the other side must not win. `5.0`
 * against `0.8` is `5.0` under Max and `0.8` under Min: one number decides it.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ColliderAttachSpec,
  attachCollider,
} from '../../editor/catalog/project-source/src/lib/godot-compat/collider-3d';
import { createCollisionLayers } from '../../editor/catalog/project-source/src/lib/godot-compat/collision-layers';
import { buildGridMapTrimeshColliders } from '../../editor/catalog/project-source/src/lib/godot-compat/grid-map-instances';

const FLOOR_FRICTION = 0.8;
const BOX_FRICTION = 0.3;
/** `starter-kit-racing`'s `vehicle.tscn` PhysicsMaterial: `friction = 5.0` with `rough = true`. */
const ROUGH_FRICTION = 5;

beforeAll(async () => {
  await RAPIER.init();
});

describe("a contact pair's friction is Godot's own MIN, not a product or an average", () => {
  it('the solver combines 0.3 against 0.8 as 0.3', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const ctx = { world, layers: createCollisionLayers(), colliders: new Map<object, unknown>() };

    const floor = attach(ctx, RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0), {
      type: 'box',
      halfExtents: { x: 10, y: 0.5, z: 10 },
      at: { x: 0, y: 0, z: 0 },
      friction: FLOOR_FRICTION,
      layer: 1,
      mask: 1,
    });
    const box = attach(ctx, RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.4, 0), {
      type: 'box',
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      at: { x: 0, y: 0, z: 0 },
      friction: BOX_FRICTION,
      layer: 1,
      mask: 1,
    });

    // Both coefficients really did reach their own collider — without this the pair number below
    // could be a min over two DEFAULTS rather than over the authored surfaces.
    expect(floor.friction()).toBeCloseTo(FLOOR_FRICTION, 6);
    expect(box.friction()).toBeCloseTo(BOX_FRICTION, 6);

    // Let the box settle onto the floor so the narrow phase has a solved contact to report.
    for (let step = 0; step < 60; step += 1) world.step();

    expect(solverFriction(world, floor, box)).toBeCloseTo(BOX_FRICTION, 6);
  });

  it("the GridMap seat's baked cell colliders combine the same way", () => {
    // The second seat carries its own copy of the constant, because it types Rapier structurally
    // and imports it nowhere. A real `RAPIER.World` satisfies that structural type.
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const gridBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const [cell] = buildGridMapTrimeshColliders(
      world,
      gridBody,
      { trimeshes: { 0: QUAD }, placements: [{ item: 0, matrix: new Matrix4() }] },
      createCollisionLayers(),
      { layer: 1, mask: 1, friction: FLOOR_FRICTION, scale: { x: 1, y: 1, z: 1 } },
      new Map<object, unknown>(),
      { node: { name: 'GridMap' } as never },
    );
    if (cell === undefined) throw new Error('the GridMap seat built no collider');

    const box = attach(
      { world, layers: createCollisionLayers(), colliders: new Map<object, unknown>() },
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.9, 0),
      {
        type: 'box',
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        at: { x: 0, y: 0, z: 0 },
        friction: BOX_FRICTION,
        layer: 1,
        mask: 1,
      },
    );
    expect(cell.friction()).toBeCloseTo(FLOOR_FRICTION, 6);

    for (let step = 0; step < 60; step += 1) world.step();

    expect(solverFriction(world, cell, box)).toBeCloseTo(BOX_FRICTION, 6);
  });

  it("a `rough` surface WINS the pair, which is what Godot's negated coefficient does", () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const ctx = { world, layers: createCollisionLayers(), colliders: new Map<object, unknown>() };

    const floor = attach(ctx, RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0), {
      type: 'box',
      halfExtents: { x: 10, y: 0.5, z: 10 },
      at: { x: 0, y: 0, z: 0 },
      friction: FLOOR_FRICTION,
      layer: 1,
      mask: 1,
    });
    // `starter-kit-racing`'s own vehicle surface: `friction = 5.0`, `rough = true`.
    const wheel = attach(ctx, RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1.4, 0), {
      type: 'box',
      halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      at: { x: 0, y: 0, z: 0 },
      friction: ROUGH_FRICTION,
      frictionCombine: 'max',
      layer: 1,
      mask: 1,
    });

    for (let step = 0; step < 60; step += 1) world.step();

    // Godot: `ABS(MIN(-5.0, 0.8))` = 5.0. Under the seat's ordinary Min it would be 0.8 — the
    // floor's own — so this number is the RULE and not the coefficient.
    expect(solverFriction(world, floor, wheel)).toBeCloseTo(ROUGH_FRICTION, 6);
  });
});

/** One flat 20×20 quad in the XZ plane at y = 0 — the face soup a GridMap cell bakes, as the two
 *  triangles `(-x,-z) (x,-z) (x,z)` and `(-x,-z) (x,z) (-x,z)`. */
const QUAD = new Float32Array(
  [
    [-10, 0, -10],
    [10, 0, -10],
    [10, 0, 10],
    [-10, 0, -10],
    [10, 0, 10],
    [-10, 0, 10],
  ].flat(),
);

function attach(
  ctx: {
    world: RAPIER.World;
    layers: ReturnType<typeof createCollisionLayers>;
    colliders: Map<object, unknown>;
  },
  body: RAPIER.RigidBodyDesc,
  spec: ColliderAttachSpec,
): RAPIER.Collider {
  return attachCollider(ctx, ctx.world.createRigidBody(body), spec);
}

/** The friction the SOLVER used for this pair's first contact — the number under test. */
function solverFriction(
  world: RAPIER.World,
  a: RAPIER.Collider,
  b: RAPIER.Collider,
): number | undefined {
  let friction: number | undefined;
  world.narrowPhase.contactPair(a.handle, b.handle, (manifold) => {
    if (friction === undefined && manifold.numSolverContacts() > 0) {
      friction = manifold.solverContactFriction(0);
    }
  });
  return friction;
}
