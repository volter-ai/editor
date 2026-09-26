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
 * through `createRapierBodyEditing` — the same verbs the first-party runtime and the framework's
 * bridge answer. Collider and joint readouts and the debug draw are OMITTED: each needs the
 * library's own component in the tree (debug drawing is only the `debug` prop of `<Physics>`), and
 * absence is how a system adapter says "not supported".
 */

import { _roots as shellRoots } from '@react-three/fiber';
import { R3F_RUNTIME_PATH } from '@volter/editor-sdk/host';
import { isPackagedRuntime } from '@volter/editor-sdk/kit/packaged-runtime';
import type { PhysicsAdapter } from '@volter/editor-project/adapter/system-adapter';
import {
  createRapierBodyEditing,
  type RapierBodyLookup,
  type RapierEditableBody,
} from '@volter/threejs-runtime/adapter/rapier-physics-adapter';
import type * as THREE from 'three';

interface RapierBodyState {
  readonly object: THREE.Object3D;
  readonly rigidBody: RapierEditableBody;
}

/** The part of `@react-three/rapier`'s context value this reads. */
interface RapierContextValue {
  readonly rigidBodyStates: Map<number, RapierBodyState>;
  readonly colliderStates: Map<number, unknown>;
  readonly world: unknown;
  readonly rapier: unknown;
}

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
function owningBody(object: THREE.Object3D, states: Iterable<RapierBodyState>): RapierEditableBody | undefined {
  const byObject = new Map<THREE.Object3D, RapierEditableBody>();
  for (const state of states) byObject.set(state.object, state.rigidBody);
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const body = byObject.get(node);
    if (body) return body;
  }
  return undefined;
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
  return createRapierBodyEditing(lookup);
}
