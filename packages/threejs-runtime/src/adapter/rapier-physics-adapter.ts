/**
 * RapierPhysicsAdapter — the first-party `PhysicsAdapter` over the existing
 * `PhysicsRegistry` (Object3D ↔ Rapier body/collider). This is the generalized,
 * behind-the-interface form of the old `setEcsSyncTransform` teleport: it lets
 * the editor freeze a body, apply a gizmo edit, and resume — without the editor
 * knowing Rapier exists.
 *
 * The seam is keyed by NODE ID (P-4), so THIS is where the three-specific
 * `id → Object3D` step happens: once, at the implementer's own boundary,
 * through the `resolve` function its constructor is handed. Nothing above this
 * line — not the editor, not the seam — needs to know an `Object3D` exists.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsAdapter } from '@volter/editor-project/adapter/system-adapter';
import type { Transform, TransformOwner } from '@volter/editor-project/adapter/transform';
import type * as THREE from 'three';
import type { PhysicsRegistry } from '../physics/physics-registry';
import type { PhysicsContext } from '../setup/setup-physics';

/**
 * Exactly what {@link createRapierBodyEditing} touches on a Rapier rigid body,
 * declared STRUCTURALLY rather than as `RAPIER.RigidBody`.
 *
 * Not a wrapper and not an abstraction — it names five of Rapier's own methods
 * with Rapier's own semantics, and every caller keeps passing Rapier's own
 * objects. It exists because this repo legitimately resolves TWO copies of
 * `@dimforge/rapier3d-compat`: the engine's own (0.14) and the one
 * `@react-three/rapier` pins for R3F worlds (0.19). Their `RigidBody` classes
 * are unrelated NOMINAL types, so a shared helper that named either one could
 * not serve both callers.
 *
 * FLIP CONDITION: `@react-three/rapier` pins its rapier EXACTLY (`0.19.2` as
 * of its 2.2.0 — check `npm view @react-three/rapier dependencies`), so an
 * override or engine bump to any OTHER rapier version forks the wasm instance
 * that library initializes against and is refused. This structural split
 * collapses only when the engine's own `@dimforge/rapier3d-compat` and
 * `@react-three/rapier`'s exact pin agree on one version — at that point the
 * two `RigidBody` types are one nominal type again and this interface can
 * name it directly.
 */
export interface RapierEditableBody {
  isFixed(): boolean;
  bodyType(): number;
  setBodyType(type: number, wakeUp: boolean): void;
  setTranslation(translation: { x: number; y: number; z: number }, wakeUp: boolean): void;
  setRotation(rotation: { x: number; y: number; z: number; w: number }, wakeUp: boolean): void;
}

/**
 * The four REQUIRED `PhysicsAdapter` members, over nothing but "which Rapier
 * body drives this node" — the `freeze → apply → unfreeze` protocol itself,
 * with no opinion about where the body came from.
 *
 * Split out of {@link createRapierPhysicsAdapter} (it is that function's own
 * `ownerOf`/`freeze`/`commit`/`unfreeze`, unchanged) because the FIRST-PARTY
 * mount is no longer the only Rapier in this engine: an R3F world does its
 * physics with `@react-three/rapier` inside the fiber tree, which owns its own
 * bodies and its own `Object3D` mapping, and reaches these same four verbs
 * through the editor's observer of that world (`editor-game/src/services/game-physics.ts`). The optional members
 * (`debugDraw`, `setDebugDrawEnabled`, `contactPoints`) are NOT here: each is
 * answered differently by each Rapier owner, and a caller that cannot answer
 * one honestly omits it.
 */
/**
 * What asking this Rapier owner about a node id actually yields.
 *
 * THE TWO NEGATIVE ANSWERS ARE DIFFERENT FACTS, and collapsing them into one
 * `undefined` is what let `ownerOf` answer `'editor'` — "the editor drives this
 * node's transform" — for an id this world has never heard of. `'no-body'` is a
 * real measurement about a real node; `'unresolved'` is this implementer saying
 * it cannot answer at all.
 */
export type RapierBodyLookup =
  | { readonly kind: 'body'; readonly body: RapierEditableBody }
  /** The node exists here and simply has no physics body. */
  | { readonly kind: 'no-body' }
  /** This world does not know this node id. */
  | { readonly kind: 'unresolved' };

/** The refusal sentence for a protocol verb aimed at a node this world has
 *  never heard of — named once so every verb says the same thing. */
function unresolvedNodeRefusal(operation: string, nodeId: string): string {
  return (
    `[RapierPhysicsAdapter] ${operation}: this world does not know node id "${nodeId}", so ` +
    'there is no body to drive. Refusing rather than reporting a completed write — gate on ' +
    "ownerOf(id) !== 'unresolved' before driving physics from a game-scoped adapter."
  );
}

export function createRapierBodyEditing(
  lookup: (nodeId: string) => RapierBodyLookup,
): Pick<PhysicsAdapter, 'ownerOf' | 'freeze' | 'commit' | 'unfreeze'> {
  /** Saved body types while frozen, so unfreeze can restore them. */
  const frozen = new Map<RapierEditableBody, number>();

  /** The body for a verb that must actually reach one, or `null` when this node
   *  genuinely has no physics. THROWS for an unknown id: the three verbs below
   *  return `void`, so a silent return is indistinguishable from a completed
   *  write, and `commit` in particular is a WRITE the caller believes landed. */
  const bodyForWrite = (operation: string, nodeId: string): RapierEditableBody | null => {
    const answer = lookup(nodeId);
    if (answer.kind === 'unresolved') throw new Error(unresolvedNodeRefusal(operation, nodeId));
    return answer.kind === 'body' ? answer.body : null;
  };

  return {
    ownerOf(nodeId: string): TransformOwner {
      const answer = lookup(nodeId);
      if (answer.kind === 'unresolved') return 'unresolved';
      // A node with no body, and a FIXED body (which never moves on its own),
      // are both transforms the editor drives.
      if (answer.kind === 'no-body') return 'editor';
      return answer.body.isFixed() ? 'editor' : 'physics';
    },
    freeze(nodeId: string): void {
      const body = bodyForWrite('freeze', nodeId);
      if (!body || frozen.has(body)) return;
      frozen.set(body, body.bodyType());
      // Kinematic-position: the body stops simulating but tracks the pose we set.
      body.setBodyType(2 /* KinematicPositionBased */, true);
    },
    commit(nodeId: string, t: Transform): void {
      const body = bodyForWrite('commit', nodeId);
      if (!body) return;
      body.setTranslation({ x: t.position[0], y: t.position[1], z: t.position[2] }, true);
      body.setRotation(
        { x: t.rotation[0], y: t.rotation[1], z: t.rotation[2], w: t.rotation[3] },
        true,
      );
    },
    unfreeze(nodeId: string): void {
      const body = bodyForWrite('unfreeze', nodeId);
      if (!body) return;
      const prev = frozen.get(body);
      if (prev !== undefined) {
        body.setBodyType(prev, true);
        frozen.delete(body);
      }
    },
  };
}

export function createRapierPhysicsAdapter(
  registry: PhysicsRegistry,
  physics: PhysicsContext | null | undefined,
  /**
   * The world's own `id → Object3D` map. Injected rather than derived here so
   * this file never hard-codes an identity convention (e.g. reading the
   * first-party `userData.entityId` key off foreign objects, which is the
   * ingest-stamping leak the retirement playbook deliberately parked).
   */
  resolve: (nodeId: string) => THREE.Object3D | null,
): PhysicsAdapter {
  /**
   * Reused backing store for `contactPoints` (grown ×2 on demand, never
   * shrunk) — the seam contract says the returned view is only valid until
   * the next call, exactly so this never allocates per frame once warm.
   */
  let contactBuf = new Float32Array(64 * 3);
  let contactCount = 0;

  const pushContact = (x: number, y: number, z: number): void => {
    if ((contactCount + 1) * 3 > contactBuf.length) {
      const grown = new Float32Array(contactBuf.length * 2);
      grown.set(contactBuf);
      contactBuf = grown;
    }
    contactBuf[contactCount * 3] = x;
    contactBuf[contactCount * 3 + 1] = y;
    contactBuf[contactCount * 3 + 2] = z;
    contactCount++;
  };

  const appendManifoldContacts = (manifold: RAPIER.TempContactManifold): void => {
    const count = manifold.numSolverContacts();
    for (let i = 0; i < count; i++) {
      // Solver contacts are WORLD-space (unlike localContactPoint1/2).
      const p = manifold.solverContactPoint(i);
      if (p) pushContact(p.x, p.y, p.z);
    }
  };

  const collectContactPoints = (): Float32Array => {
    if (!physics) return contactBuf.subarray(0, 0);
    const world = physics.rapierWorld;
    contactCount = 0;
    for (const [, refs] of registry.entries()) {
      world.contactPairsWith(refs.collider, (other) => {
        // Each touching pair is enumerated from BOTH sides — process it only
        // from the lower-handle side (also skips self).
        if (other.handle <= refs.collider.handle) return;
        world.contactPair(refs.collider, other, appendManifoldContacts);
      });
    }
    return contactBuf.subarray(0, contactCount * 3);
  };

  /** The one place this adapter crosses from node id into Three's vocabulary —
   *  and the one place that can tell an UNKNOWN node from one with no body. */
  const lookup = (nodeId: string): RapierBodyLookup => {
    const object = resolve(nodeId);
    if (!object) return { kind: 'unresolved' };
    const body = registry.get(object)?.body;
    return body ? { kind: 'body', body } : { kind: 'no-body' };
  };

  const adapter: PhysicsAdapter = { ...createRapierBodyEditing(lookup) };
  // The debug-draw and contact capabilities exist only where a physics CONTEXT
  // does. They used to be attached unconditionally and then no-op internally:
  // `setDebugDrawEnabled(true)` returned as if it had enabled something, and
  // `contactPoints()` returned an empty view — "we looked and there are no
  // contacts" — for a world with no simulation at all. Presence mirrors the
  // capability, so `physics-debug.ts`'s existing `?.()` calls now see absence.
  if (physics) {
    adapter.debugDraw = () => physics.debugMesh;
    adapter.setDebugDrawEnabled = (enabled: boolean): void => {
      // Same two fields the in-game KeyP toggle flips — the adapter's render
      // system reads `debugEnabled` and feeds `debugRender()` into the mesh.
      physics.debugEnabled = enabled;
      physics.debugMesh.visible = enabled;
    };
    adapter.contactPoints = collectContactPoints;
  }
  return adapter;
}
