/**
 * `RigidBody3D.angular_velocity` reaches a REAL Rapier body, in Godot's own unit and Godot's own
 * frame, from the NODE the script names.
 *
 * `starter-kit-racing`'s whole steering is this one property: `vehicle.gd:119` is
 * `sphere.angular_velocity += vehicle_model.get_global_transform().basis.x * (linear_speed * 100)
 * * delta`, and `:92` reads its length back to decide the car's acceleration. The receiver is a
 * `Sphere` RigidBody3D hanging BELOW a Node3D scene root, so the emitted call gets an `Object3D`
 * and has to find the body — through the `markBodyOwnedNode` link the emitted scene writes where
 * it builds the pair.
 *
 * Kept as a permanent guard under the verification doctrine's two-condition exception:
 *
 *  1. **Extremely easy to regress by an ordinary edit.** Three separate one-token changes are
 *     silent: reading `linvel()` where `angvel()` was meant (same shape, same type, a car that
 *     accelerates instead of turning), converting a unit that must not be converted (`* DEG2RAD`
 *     is what "velocity in degrees" instinct writes, and it is wrong by 57x), and rotating the
 *     vector into the body's own basis on the way in (the compat DOES own a basis seam, one import
 *     away, and using it here would break only on a car that is already turning). None of the
 *     three moves a type.
 *  2. **Extremely complicated / invisible to a short check.** The claim is about the frame and the
 *     unit a physics solver integrates a written vector in. Reading the value back proves nothing
 *     about either — only stepping a real world and measuring where the body ended up does.
 *
 * The anchor for the unit is not a memory of the docs, it is this lane's own measurement:
 * `test/ground-truth/godot36-physics-state.json`'s `modeSwitchToRigid` phase writes `(0, 0, 3)` on
 * a `1/120` step and records the body's own up axis landing on
 * `(-0.02499739639461040, 0.99968749284744260, 0)`. That is exactly `(-sin θ, cos θ, 0)` for
 * `θ = 3 * 1/120 = 0.025` — Godot 3.6, measured, on the same call the emitter now writes. Rapier
 * must land on the same number.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { markBodyOwnedNode } from '@vgai/engine/adapter/body-marks';
import { Object3D, Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getAngularVelocity3D,
  setAngularVelocity3D,
} from '../../editor/catalog/project-source/src/lib/godot-compat/rigid-body-3d';
import { setGlobalTransform3D } from '../../editor/catalog/project-source/src/lib/godot-compat/spatial';

/** Godot's own physics tick in the ground truth this file's numbers come from. */
const STEP = 1 / 120;
/** The angular velocity `modeSwitchToRigid` writes, in rad/s about +Z. */
const SPIN = { x: 0, y: 0, z: 3 };
/** `godot36-physics-state.json` `modeSwitchToRigid[3].upAxisImage` — one step after that write. */
const GODOT_UP_AFTER_ONE_STEP = { x: -0.0249973963946104, y: 0.9996874928474426, z: 0 };

beforeAll(async () => {
  await RAPIER.init();
});

interface Pair {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly node: Object3D;
}

/** A marked node/body pair, the way an emitted scene builds one. */
function markedBody(rotation?: Quaternion): Pair {
  const world = new RAPIER.World({ x: 0, y: -14, z: 0 });
  world.timestep = STEP;
  const desc = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false);
  if (rotation !== undefined) {
    desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
  }
  const body = world.createRigidBody(desc);
  world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
  const node = new Object3D();
  node.name = 'Sphere';
  markBodyOwnedNode(node, body);
  return { world, body, node };
}

/** Step, then run the port's own write-back: Rapier's world pose onto the node. */
function stepAndSync(pair: Pair): void {
  pair.world.step();
  setGlobalTransform3D(pair.node, pair.body.translation(), pair.body.rotation());
}

describe('RigidBody3D.angular_velocity over the node`s own marked Rapier body', () => {
  it('writes and reads back the same rad/s vector, through the mark alone', () => {
    const pair = markedBody();
    setAngularVelocity3D(pair.node, SPIN);
    expect(getAngularVelocity3D(pair.node)).toEqual(SPIN);
    // The write really reached the body, not a cache beside it.
    expect(pair.body.angvel().z).toBeCloseTo(3, 9);
  });

  it('lands on Godot 3.6`s own measured number after one 1/120 step — so the unit is rad/s', () => {
    const pair = markedBody();
    setAngularVelocity3D(pair.node, SPIN);
    stepAndSync(pair);

    const up = new Vector3(0, 1, 0).applyQuaternion(pair.node.quaternion);
    expect(up.x).toBeCloseTo(GODOT_UP_AFTER_ONE_STEP.x, 6);
    expect(up.y).toBeCloseTo(GODOT_UP_AFTER_ONE_STEP.y, 6);
    expect(up.z).toBeCloseTo(GODOT_UP_AFTER_ONE_STEP.z, 6);
  });

  it('spins about the GLOBAL axis it was written in, not the body`s own', () => {
    // Pre-rotate 90° about +X, so the body's own +Z now points along world -Y. A global-frame
    // (0, 0, 3) turns the body's +X toward +Y; a body-frame one would turn it toward +Z.
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const pair = markedBody(rotation);
    setAngularVelocity3D(pair.node, SPIN);
    stepAndSync(pair);

    const theta = 3 * STEP;
    const ownX = new Vector3(1, 0, 0).applyQuaternion(pair.node.quaternion);
    expect(ownX.x).toBeCloseTo(Math.cos(theta), 6);
    expect(ownX.y).toBeCloseTo(Math.sin(theta), 6);
    expect(ownX.z).toBeCloseTo(0, 6);
  });

  it('refuses a node no body owns rather than answering zero', () => {
    const unmarked = new Object3D();
    unmarked.name = 'Sphere';
    expect(() => getAngularVelocity3D(unmarked)).toThrow(/markBodyOwnedNode/);
  });
});
