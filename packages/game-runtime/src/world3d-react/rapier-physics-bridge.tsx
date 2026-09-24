/**
 * `<RapierPhysicsBridge>` — the one line that makes an R3F world's
 * `@react-three/rapier` physics VISIBLE to the engine's editor/dev seams.
 *
 * WHY IT EXISTS. `SystemAdapters.physics` is what the editor's transform
 * coordination (`freeze → apply → unfreeze`) and the universal
 * "Colliders drawn" instrument (`@volter/game-runtime/dev/instruments`) read. An R3F world
 * builds no first-party Rapier runtime at all — it does physics with
 * `@react-three/rapier` INSIDE the fiber tree, where nothing engine-side
 * can see it. Result, before this: the colliders instrument read `null` (an
 * em-dash) and its toggle threw "no physics adapter" in every shipped example
 * and every scaffolded game.
 *
 * NOT A WRAPPER. This registers an adapter and gets out of the way: the world
 * still writes `<Physics>` itself, with the library's own props, and every
 * `<RigidBody>`/collider call stays `@react-three/rapier`'s own API. The one
 * thing it cannot do for you is flip the library's debug rendering, because
 * `@react-three/rapier@2` exposes that ONLY as the `debug` boolean PROP on
 * `<Physics>` (its `<Debug>` component is internal and unexported). A prop is
 * the parent's to own, so the world holds the state and this bridge hands the
 * setter to the instrument — which is why `onDebugChange` is required:
 *
 * ```tsx
 * const [physicsDebug, setPhysicsDebug] = useState(false);
 * // …
 * <Physics debug={physicsDebug}>
 *   <RapierPhysicsBridge onDebugChange={setPhysicsDebug} />
 *   …
 * </Physics>
 * ```
 *
 * Nothing draws colliders here: the wireframes are the library's own
 * `world.debugRender()` output, rendered by its own component.
 *
 * ANTI-SHIM. `debugDraw()` and `contactPoints()` are OMITTED, not stubbed —
 * the library owns its debug line segments inside the tree and hands out no
 * handle to them, so claiming the capability would be a fabrication. Absence
 * is how a `SystemAdapters` member says "not supported".
 *
 * ── RESOURCE OWNERSHIP, STATED ONCE ─────────────────────────────────────────
 * OWNER: each Fiber scene owns its slot; this component owns the live adapter
 * attached to it. The mounted-root boundary binds the static declaration to
 * that scene. Concurrent authoring and Play evaluations never share a target.
 * TEARDOWN: the effect detaches only its own adapter. Native Rapier objects
 * remain owned by <Physics>. An unscoped legacy caller refuses ambiguity.
 *
 * PHASE ORDERING: none to respect — this component registers pull-only
 * callbacks and runs no per-frame work. Every method it exposes is invoked
 * BETWEEN frames, by an editor gesture or an instrument command, never from a
 * phase.
 */

import { useThree } from '@react-three/fiber';
import { type RapierRigidBody, useRapier } from '@react-three/rapier';
import type {
  PhysicsAdapter,
  PhysicsColliderShape,
  PhysicsColliderSnapshot,
  PhysicsJointSnapshot,
  PhysicsJointType,
} from '@volter/editor-project/adapter/system-adapter';
import {
  createSystemSlot,
  declareScopedSystem,
  type SystemSlot,
} from '@volter/editor-project/adapter/system-slot';
import {
  createRapierBodyEditing,
  type RapierBodyLookup,
  type RapierEditableBody,
} from '@volter/threejs-runtime/adapter/rapier-physics-adapter';
import { useEffect } from 'react';
import * as THREE from 'three';

export interface RapierPhysicsBridgeProps {
  /**
   * Set the `debug` prop of the SAME `<Physics>` this bridge is mounted in.
   * The "Colliders drawn" instrument calls it; the world's own state is
   * what `<Physics debug={…}>` reads, so the library's debug rendering is the
   * only thing that ever draws a collider.
   */
  readonly onDebugChange: (debug: boolean) => void;
}

interface RapierBodyStateLike {
  readonly object: THREE.Object3D;
  readonly rigidBody: RapierRigidBody;
}

function lateEntityObject(
  states: Iterable<RapierBodyStateLike>,
  nodeId: string,
): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  for (const state of states) {
    state.object.traverse((candidate) => {
      if (!found && candidate.userData['entityId'] === nodeId) found = candidate;
    });
    if (found) return found;
  }
  return undefined;
}

function owningBody(
  object: THREE.Object3D,
  states: Iterable<RapierBodyStateLike>,
): RapierRigidBody | undefined {
  const byObject = new Map<THREE.Object3D, RapierRigidBody>();
  for (const state of states) byObject.set(state.object, state.rigidBody);
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const body = byObject.get(node);
    if (body) return body;
  }
  return undefined;
}

/**
 * Register this R3F world's `@react-three/rapier` physics as the game's
 * `SystemAdapters.physics`. Mount it once, INSIDE `<Physics>` (it reads
 * `useRapier()`). Renders nothing.
 */
export function RapierPhysicsBridge({ onDebugChange }: RapierPhysicsBridgeProps): null {
  const scene = useThree((state) => state.scene);
  const { colliderStates, rapier, rigidBodyStates, world } = useRapier();

  useEffect(() => {
    /**
     * node id → the Rapier body driving it, entirely through the library's
     * OWN body↔object map (`rigidBodyStates`, carried on the `RapierContext`
     * `useRapier()` returns): resolve `userData.entityId` — this stack's
     * identity convention, stamped by the editor's R3F authoring adapter —
     * inside the body-owned subtrees, then walk ANCESTORS to the owning body
     * (`<RigidBody>` owns a subtree, so the selected mesh is usually a
     * descendant of the object the state names).
     *
     * The map is live, so this is computed per call rather than cached —
     * calls arrive at gesture rate (a gizmo drag start/end, a dev command),
     * never per frame, and only objects under a `<RigidBody>` can have a body
     * at all, so the body subtrees are the complete search space.
     */
    const bodyFor = (nodeId: string): RapierEditableBody | undefined => {
      const object = lateEntityObject(rigidBodyStates.values(), nodeId);
      if (!object) return undefined;
      return owningBody(object, rigidBodyStates.values());
    };

    /**
     * The same question, with the two negative answers KEPT APART for the
     * editing protocol — see {@link RapierBodyLookup}. This world's search
     * space is the `<RigidBody>` subtrees, so "no object here" really is "not a
     * node of mine", not "a node of mine without physics".
     */
    const bodyLookup = (nodeId: string): RapierBodyLookup => {
      const object = lateEntityObject(rigidBodyStates.values(), nodeId);
      if (!object) return { kind: 'unresolved' };
      const body = owningBody(object, rigidBodyStates.values());
      return body ? { kind: 'body', body } : { kind: 'no-body' };
    };

    /** Rapier's own name for a shape type, via the enum's reverse mapping —
     *  so an unprojected collider reports WHICH shape it is (`TriMesh`,
     *  `HeightField`, …) instead of a bare number, and a shape added by a
     *  future rapier still names itself. */
    const rapierShapeName = (shapeType: number): string =>
      (rapier.ShapeType as unknown as Record<number, string | undefined>)[shapeType] ??
      `shapeType ${shapeType}`;

    const colliderShape = (collider: {
      shapeType(): number;
      halfExtents(): { x: number; y: number; z: number };
      radius(): number;
      halfHeight(): number;
    }): PhysicsColliderShape => {
      switch (collider.shapeType()) {
        case rapier.ShapeType.Cuboid: {
          const halfExtents = collider.halfExtents();
          return { type: 'cuboid', halfExtents: [halfExtents.x, halfExtents.y, halfExtents.z] };
        }
        case rapier.ShapeType.Ball:
          return { type: 'ball', radius: collider.radius() };
        case rapier.ShapeType.Capsule:
          return {
            type: 'capsule',
            halfHeight: collider.halfHeight(),
            radius: collider.radius(),
          };
        // Rapier has many more shapes than this seam projects (TriMesh,
        // HeightField, ConvexPolyhedron, Cylinder, Cone, …). The collider is
        // REAL; only our plain-data projection of it is missing, so it is
        // reported as itself rather than dropped — a body whose only collider
        // is a trimesh used to inspect as a body with no colliders at all.
        default:
          return { type: 'unsupported', kind: rapierShapeName(collider.shapeType()) };
      }
    };

    const colliders = (nodeId: string): PhysicsColliderSnapshot[] => {
      const body = bodyFor(nodeId) as RapierRigidBody | undefined;
      if (!body) return [];
      const result: PhysicsColliderSnapshot[] = [];
      for (const state of colliderStates.values()) {
        if (state.collider.parent()?.handle !== body.handle) continue;
        const shape = colliderShape(state.collider);
        state.object.updateWorldMatrix(true, false);
        const position = state.collider.translation();
        const rotation = state.collider.rotation();
        const scale = state.object.getWorldScale(new THREE.Vector3());
        result.push({
          id: String(state.collider.handle),
          shape,
          position: [position.x, position.y, position.z],
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
          scale: [Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)],
          sensor: state.collider.isSensor(),
        });
      }
      return result.sort((a, b) => Number(a.id) - Number(b.id));
    };

    const previewCollider = (colliderId: string, shape: PhysicsColliderShape): void => {
      const collider = [...colliderStates.values()].find(
        (state) => String(state.collider.handle) === colliderId,
      )?.collider;
      if (!collider || colliderShape(collider)?.type !== shape.type) return;
      switch (shape.type) {
        case 'cuboid':
          collider.setHalfExtents({
            x: shape.halfExtents[0],
            y: shape.halfExtents[1],
            z: shape.halfExtents[2],
          });
          break;
        case 'ball':
          collider.setRadius(shape.radius);
          break;
        case 'capsule':
          collider.setHalfHeight(shape.halfHeight);
          collider.setRadius(shape.radius);
          break;
        // A shape this seam does not project has no dimensions to write back.
        // `colliders()` reports it so the body's physics is not invisible; that
        // is a READ, and it does not make the shape editable.
        case 'unsupported':
          break;
      }
    };

    const jointType = (type: number): PhysicsJointType => {
      switch (type) {
        case rapier.JointType.Revolute:
          return 'revolute';
        case rapier.JointType.Fixed:
          return 'fixed';
        case rapier.JointType.Prismatic:
          return 'prismatic';
        case rapier.JointType.Rope:
          return 'rope';
        case rapier.JointType.Spring:
          return 'spring';
        case rapier.JointType.Spherical:
          return 'spherical';
        default:
          return 'generic';
      }
    };

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
    const worldAnchor = (
      body: RapierRigidBody,
      anchor: { x: number; y: number; z: number },
    ): [number, number, number] => {
      const point = new THREE.Vector3(anchor.x, anchor.y, anchor.z)
        .applyQuaternion(new THREE.Quaternion(...tuple4(body.rotation())))
        .add(new THREE.Vector3(...tuple3(body.translation())));
      return tuple3(point);
    };

    type NativeImpulseJoint = ReturnType<typeof world.impulseJoints.getAll>[number];
    const jointLimits = (
      joint: NativeImpulseJoint,
      type: PhysicsJointType,
    ): Pick<PhysicsJointSnapshot, 'limits'> => {
      if (type !== 'revolute' && type !== 'prismatic') return {};
      const unit = joint as unknown as {
        limitsEnabled(): boolean;
        limitsMin(): number;
        limitsMax(): number;
      };
      return unit.limitsEnabled()
        ? { limits: { min: unit.limitsMin(), max: unit.limitsMax() } }
        : {};
    };

    const jointAxis = (
      joint: NativeImpulseJoint,
      type: PhysicsJointType,
      body: RapierRigidBody,
    ): Pick<PhysicsJointSnapshot, 'axis' | 'worldAxis'> => {
      if (type !== 'revolute' && type !== 'prismatic') return {};
      const frame = joint.frameX1();
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(
        new THREE.Quaternion(frame.x, frame.y, frame.z, frame.w),
      );
      const worldAxis = axis
        .clone()
        .applyQuaternion(new THREE.Quaternion(...tuple4(body.rotation())));
      return { axis: tuple3(axis), worldAxis: tuple3(worldAxis) };
    };

    const jointSnapshot = (joint: NativeImpulseJoint): PhysicsJointSnapshot => {
      const body1 = joint.body1();
      const body2 = joint.body2();
      const anchor1 = joint.anchor1();
      const anchor2 = joint.anchor2();
      const type = jointType(joint.type());
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
        ...jointAxis(joint, type, body1),
        ...jointLimits(joint, type),
        contactsEnabled: joint.contactsEnabled(),
      };
    };

    const joints = (nodeId: string): PhysicsJointSnapshot[] => {
      const body = bodyFor(nodeId) as RapierRigidBody | undefined;
      if (!body) return [];
      const result: PhysicsJointSnapshot[] = [];
      world.impulseJoints.forEachJointHandleAttachedToRigidBody(body.handle, (handle) => {
        const joint = world.impulseJoints.get(handle);
        if (joint) result.push(jointSnapshot(joint));
      });
      return result.sort((a, b) => Number(a.id) - Number(b.id));
    };

    const previewJointAnchor = (
      jointId: string,
      endpoint: 0 | 1,
      anchor: readonly [number, number, number],
    ): void => {
      const joint = world.impulseJoints.get(Number(jointId));
      if (!joint) return;
      const value = { x: anchor[0], y: anchor[1], z: anchor[2] };
      if (endpoint === 0) joint.setAnchor1(value);
      else joint.setAnchor2(value);
    };

    const adapter: PhysicsAdapter = {
      ...createRapierBodyEditing(bodyLookup),
      setDebugDrawEnabled: (enabled) => onDebugChange(enabled),
      colliders,
      previewCollider,
      joints,
      previewJointAnchor,
    };
    const slot = physicsSlotFor(scene);
    if (liveScopes.has(scene)) {
      throw new Error('rapierPhysicsSystem: multiple bridges mounted in the same Fiber scene.');
    }
    const detach = slot.attach(adapter);
    liveScopes.set(scene, adapter);
    return () => {
      if (liveScopes.get(scene) === adapter) liveScopes.delete(scene);
      detach();
    };
  }, [colliderStates, onDebugChange, rapier, rigidBodyStates, scene, world]);

  return null;
}

// ---------------------------------------------------------------------------
// The entry-declaration half
// ---------------------------------------------------------------------------

// Weak ownership keeps a retired evaluation collectible. The live table exists
// only for legacy direct callers; mounted roots always hold their bound slot.
const scopedSlots = new WeakMap<object, SystemSlot<PhysicsAdapter>>();
const liveScopes = new Map<object, PhysicsAdapter>();

function createPhysicsSlot(): SystemSlot<PhysicsAdapter> {
  return createSystemSlot<PhysicsAdapter>({
    name: 'rapierPhysicsSystem',
    unattachedMessage:
      'no <RapierPhysicsBridge> is mounted inside a live <Physics> right now — the world is not ' +
      'playing, or the scene never mounted the bridge.',
    members: {
      ownerOf: { kind: 'action' },
      freeze: { kind: 'action' },
      commit: { kind: 'action' },
      unfreeze: { kind: 'action' },
      setDebugDrawEnabled: { kind: 'action' },
      colliders: { kind: 'action' },
      previewCollider: { kind: 'action' },
      joints: { kind: 'action' },
      previewJointAnchor: { kind: 'action' },
    },
  });
}

function physicsSlotFor(scope: object): SystemSlot<PhysicsAdapter> {
  let slot = scopedSlots.get(scope);
  if (!slot) {
    slot = createPhysicsSlot();
    scopedSlots.set(scope, slot);
  }
  return slot;
}

const unattached = createPhysicsSlot().slot;
const declaration = declareScopedSystem(
  new Proxy(unattached, {
    get(target, property) {
      const member = Reflect.get(target, property);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]) => {
        if (liveScopes.size > 1) {
          throw new Error(
            'rapierPhysicsSystem: unscoped access is ambiguous across multiple live worlds; ' +
              'use the mounted root’s bound systems.physics adapter.',
          );
        }
        const adapter = liveScopes.values().next().value ?? unattached;
        return Reflect.apply(Reflect.get(adapter, property), adapter, args);
      };
    },
  }),
  (scope) => physicsSlotFor(scope).slot,
);

/** Static declaration, resolved to the owning Fiber scene by the mount boundary.
 * Direct legacy calls work with one live world and refuse an ambiguous target. */
export function rapierPhysicsSystem(): PhysicsAdapter {
  return declaration;
}
