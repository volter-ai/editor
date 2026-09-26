/**
 * THE EDITOR'S VIEW OF A GAME'S OWN `@react-three/rapier` WORLD — the physics half of what
 * `game-audio.ts` does for Web Audio: a game writes `<Physics>` and `<RigidBody>` with the
 * library's own API and declares nothing, and the editor still reaches the bodies a drag must
 * freeze and commit.
 *
 * WHERE THE WORLD IS. The library keeps its world, its body↔object map and its Rapier module in
 * the value of the `<Physics>` context provider, and exports no value for that context. The editor
 * mounted the game's R3F root, so it walks that root's fiber tree (Fiber's `_roots`, keyed by
 * canvas, matched by the root's scene) to the provider whose value has that shape. The registry
 * is the one in the Fiber instance the game's root was created with: under the packaged runtime
 * that is the project graph's, reached through the R3F doorway (`r3fRoots`); the shell's own
 * bundled Fiber holds no game root. The walk runs per call, at gesture rate, so a `<Physics>`
 * that mounts, remounts or swaps its world is read as it is now.
 *
 * WHAT IT ANSWERS. Body ownership and the freeze → commit → unfreeze a transform edit needs,
 * through `createRapierBodyEditing` — the same verbs the first-party runtime answers — and a
 * body's colliders and joints, read from the same context value (its collider map, its world's
 * impulse joints), with previews that write a dragged size or anchor to the real collider or joint.
 * The debug draw is OMITTED: drawing is only the `debug` prop of the game's own `<Physics>`, and
 * absence is how a system adapter says "not supported".
 */

import { _roots as shellRoots } from '@react-three/fiber';
import { R3F_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';
import type { RapierContext, RapierRigidBody } from '@react-three/rapier';
import type {
  PhysicsAdapter,
  PhysicsColliderShape,
  PhysicsColliderSnapshot,
  PhysicsJointSnapshot,
  PhysicsJointType,
} from '@volter/editor-project/adapter/system-adapter';
import {
  createRapierBodyEditing,
  type RapierBodyLookup,
} from '@volter/threejs-runtime/adapter/rapier-physics-adapter';
import * as THREE from 'three';

type RapierContextValue = RapierContext;
type RapierBodyState = { readonly object: THREE.Object3D; readonly rigidBody: RapierRigidBody };
type RapierCollider = ReturnType<RapierContext['world']['getCollider']>;
type RapierJoint = ReturnType<RapierContext['world']['impulseJoints']['getAll']>[number];

interface FiberNode {
  readonly child: FiberNode | null;
  readonly sibling: FiberNode | null;
  readonly memoizedProps: { readonly value?: unknown } | null;
}

function isRapierContext(value: unknown): value is RapierContextValue {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RapierContextValue>;
  return (
    candidate.rigidBodyStates instanceof Map &&
    candidate.colliderStates instanceof Map &&
    candidate.world !== undefined &&
    candidate.rapier !== undefined
  );
}

type FiberRoots = typeof shellRoots;

let projectRoots: FiberRoots | null = null;
let projectRootsRequest: Promise<void> | null = null;

/** The root registry of the Fiber instance game roots are created with. `null` until the
 *  packaged runtime's doorway has answered; the first call starts that import. */
function gameFiberRoots(): FiberRoots | null {
  if (projectRoots) return projectRoots;
  projectRootsRequest ??= (async () => {
    if (!(await isPackagedRuntime())) {
      projectRoots = shellRoots;
      return;
    }
    const mod = (await import(/* @vite-ignore */ R3F_RUNTIME_PATH)) as { r3fRoots?: unknown };
    if (!(mod.r3fRoots instanceof Map)) {
      throw new Error(
        "The packaged runtime's synthetic R3F module did not export `r3fRoots` — see R3F_DOORWAY " +
          'in vite-plugin-module-doorways.ts.',
      );
    }
    projectRoots = mod.r3fRoots as FiberRoots;
  })();
  return null;
}

/** The `<Physics>` context value inside the R3F root that renders `scene`, if one is mounted. */
export function rapierContextFor(scene: THREE.Object3D): RapierContextValue | null {
  const roots = gameFiberRoots();
  if (!roots) return null;
  for (const root of roots.values()) {
    if (root.store.getState().scene !== scene) continue;
    const start = (root.fiber as unknown as { current: FiberNode | null }).current;
    const pending: FiberNode[] = start ? [start] : [];
    while (pending.length > 0) {
      const fiber = pending.pop()!;
      const value = fiber.memoizedProps?.value;
      if (isRapierContext(value)) return value;
      if (fiber.sibling) pending.push(fiber.sibling);
      if (fiber.child) pending.push(fiber.child);
    }
  }
  return null;
}

/** The object carrying `nodeId` (the editor's `userData.entityId`) inside a body's subtree. */
function entityObject(states: Iterable<RapierBodyState>, nodeId: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  for (const state of states) {
    state.object.traverse((candidate) => {
      if (!found && candidate.userData['entityId'] === nodeId) found = candidate;
    });
    if (found) return found;
  }
  return undefined;
}

/** The body whose `<RigidBody>` owns `object`: the object itself or its nearest owning ancestor. */
function owningBody(object: THREE.Object3D, states: Iterable<RapierBodyState>): RapierRigidBody | undefined {
  const byObject = new Map<THREE.Object3D, RapierRigidBody>();
  for (const state of states) byObject.set(state.object, state.rigidBody);
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const body = byObject.get(node);
    if (body) return body;
  }
  return undefined;
}

const tuple3 = (value: { x: number; y: number; z: number }): [number, number, number] => [
  value.x,
  value.y,
  value.z,
];
const tuple4 = (value: {
  x: number;
  y: number;
  z: number;
  w: number;
}): [number, number, number, number] => [value.x, value.y, value.z, value.w];

/** A collider's shape as plain data. Rapier has more shapes than the seam projects (TriMesh,
 *  HeightField, ConvexPolyhedron, …); those report themselves by Rapier's own name rather than
 *  dropping out, so a body whose only collider is a trimesh does not read as having none. */
function colliderShape(context: RapierContext, collider: RapierCollider): PhysicsColliderShape {
  const { ShapeType } = context.rapier;
  switch (collider.shapeType()) {
    case ShapeType.Cuboid:
      return { type: 'cuboid', halfExtents: tuple3(collider.halfExtents()) };
    case ShapeType.Ball:
      return { type: 'ball', radius: collider.radius() };
    case ShapeType.Capsule:
      return { type: 'capsule', halfHeight: collider.halfHeight(), radius: collider.radius() };
    default:
      return {
        type: 'unsupported',
        kind:
          (ShapeType as unknown as Record<number, string | undefined>)[collider.shapeType()] ??
          `shapeType ${collider.shapeType()}`,
      };
  }
}

function jointType(context: RapierContext, type: number): PhysicsJointType {
  const { JointType } = context.rapier;
  switch (type) {
    case JointType.Revolute:
      return 'revolute';
    case JointType.Fixed:
      return 'fixed';
    case JointType.Prismatic:
      return 'prismatic';
    case JointType.Rope:
      return 'rope';
    case JointType.Spring:
      return 'spring';
    case JointType.Spherical:
      return 'spherical';
    default:
      return 'generic';
  }
}

function worldAnchor(body: RapierRigidBody, anchor: { x: number; y: number; z: number }) {
  return tuple3(
    new THREE.Vector3(anchor.x, anchor.y, anchor.z)
      .applyQuaternion(new THREE.Quaternion(...tuple4(body.rotation())))
      .add(new THREE.Vector3(...tuple3(body.translation()))),
  );
}

function jointSnapshot(context: RapierContext, joint: RapierJoint): PhysicsJointSnapshot {
  const body1 = joint.body1();
  const body2 = joint.body2();
  const anchor1 = joint.anchor1();
  const anchor2 = joint.anchor2();
  const type = jointType(context, joint.type());
  const axial = type === 'revolute' || type === 'prismatic';
  const frame = axial ? joint.frameX1() : null;
  const axis = frame
    ? new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(frame.x, frame.y, frame.z, frame.w))
    : null;
  const unit = joint as unknown as { limitsEnabled(): boolean; limitsMin(): number; limitsMax(): number };
  return {
    id: String(joint.handle),
    type,
    body1: String(body1.handle),
    body2: String(body2.handle),
    anchor1: tuple3(anchor1),
    anchor2: tuple3(anchor2),
    worldAnchor1: worldAnchor(body1, anchor1),
    worldAnchor2: worldAnchor(body2, anchor2),
    body1Position: tuple3(body1.translation()),
    body2Position: tuple3(body2.translation()),
    body1Rotation: tuple4(body1.rotation()),
    body2Rotation: tuple4(body2.rotation()),
    ...(axis
      ? {
          axis: tuple3(axis),
          worldAxis: tuple3(axis.clone().applyQuaternion(new THREE.Quaternion(...tuple4(body1.rotation())))),
        }
      : {}),
    ...(axial && unit.limitsEnabled() ? { limits: { min: unit.limitsMin(), max: unit.limitsMax() } } : {}),
    contactsEnabled: joint.contactsEnabled(),
  };
}

/**
 * The editor's physics adapter for the game world rendering `scene`. `<Physics>` suspends until
 * Rapier's WASM has loaded, so at mount its provider is usually not there yet: the adapter
 * resolves the world on every call, and until one is mounted every node reads as unresolved.
 * Whether a world gets one at all is the caller's question (`adapter-runtime-bindings.ts`).
 */
export function observedRapierPhysics(scene: THREE.Object3D): PhysicsAdapter {
  const lookup = (nodeId: string): RapierBodyLookup => {
    const context = rapierContextFor(scene);
    if (!context) return { kind: 'unresolved' };
    const states = [...context.rigidBodyStates.values()];
    const object = entityObject(states, nodeId);
    if (!object) return { kind: 'unresolved' };
    const body = owningBody(object, states);
    return body ? { kind: 'body', body } : { kind: 'no-body' };
  };
  /** The live world and the body driving `nodeId`, when both exist now. */
  const bodyOf = (nodeId: string): { context: RapierContext; body: RapierRigidBody } | null => {
    const context = rapierContextFor(scene);
    if (!context) return null;
    const states = [...context.rigidBodyStates.values()];
    const object = entityObject(states, nodeId);
    const body = object ? owningBody(object, states) : undefined;
    return body ? { context, body } : null;
  };
  return {
    ...createRapierBodyEditing(lookup),
    colliders(nodeId: string): PhysicsColliderSnapshot[] {
      const found = bodyOf(nodeId);
      if (!found) return [];
      const result: PhysicsColliderSnapshot[] = [];
      for (const state of found.context.colliderStates.values()) {
        if (state.collider.parent()?.handle !== found.body.handle) continue;
        state.object.updateWorldMatrix(true, false);
        const scale = state.object.getWorldScale(new THREE.Vector3());
        result.push({
          id: String(state.collider.handle),
          shape: colliderShape(found.context, state.collider),
          position: tuple3(state.collider.translation()),
          rotation: tuple4(state.collider.rotation()),
          scale: [Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)],
          sensor: state.collider.isSensor(),
        });
      }
      return result.sort((a, b) => Number(a.id) - Number(b.id));
    },
    previewCollider(colliderId: string, shape: PhysicsColliderShape): void {
      const context = rapierContextFor(scene);
      const collider = context
        ? [...context.colliderStates.values()].find((state) => String(state.collider.handle) === colliderId)
            ?.collider
        : undefined;
      if (!context || !collider || colliderShape(context, collider).type !== shape.type) return;
      switch (shape.type) {
        case 'cuboid':
          collider.setHalfExtents({ x: shape.halfExtents[0], y: shape.halfExtents[1], z: shape.halfExtents[2] });
          break;
        case 'ball':
          collider.setRadius(shape.radius);
          break;
        case 'capsule':
          collider.setHalfHeight(shape.halfHeight);
          collider.setRadius(shape.radius);
          break;
        // A shape the seam does not project has no dimensions to write back.
        case 'unsupported':
          break;
      }
    },
    joints(nodeId: string): PhysicsJointSnapshot[] {
      const found = bodyOf(nodeId);
      if (!found) return [];
      const result: PhysicsJointSnapshot[] = [];
      const joints = found.context.world.impulseJoints;
      joints.forEachJointHandleAttachedToRigidBody(found.body.handle, (handle) => {
        const joint = joints.get(handle);
        if (joint) result.push(jointSnapshot(found.context, joint));
      });
      return result.sort((a, b) => Number(a.id) - Number(b.id));
    },
    previewJointAnchor(jointId: string, endpoint: 0 | 1, anchor: readonly [number, number, number]): void {
      const joint = rapierContextFor(scene)?.world.impulseJoints.get(Number(jointId));
      if (!joint) return;
      const value = { x: anchor[0], y: anchor[1], z: anchor[2] };
      if (endpoint === 0) joint.setAnchor1(value);
      else joint.setAnchor2(value);
    },
  };
}
