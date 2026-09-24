/**
 * The transform-AUTHORITY convention: how a game tells the host which of its
 * nodes have their pose written by a rigid body rather than by the node itself.
 *
 * Sibling of `hierarchy-marks.ts`, and the same shape of idea. That module's
 * marks answer "what IS this node" for the panel; this one answers "who WRITES
 * this node's pose" for an edit. Both are written by GAME code at the seam that
 * knows the answer, read generically by the host, and namespaced `vgai*` because
 * they are the host's namespace on a node the game owns.
 *
 * ## Why it exists
 *
 * A world that simulates writes `node.position/quaternion` FROM its bodies every
 * step. Setting the node is therefore not an edit — it is a value that survives
 * until the next step and then vanishes, which is what "the gizmo does nothing"
 * looks like from the outside. The edit has to reach the body.
 *
 * The host cannot find the body on its own. Three.js has no body concept, the
 * body is usually not in the scene graph at all, and the mapping from node to
 * body is private to whichever code built the pair. So the code that ATTACHES a
 * body to a node draws the link in the same breath — one call, at the one place
 * the answer is known — exactly as `markBuiltInternal` is called at the attach
 * seam and never by a later sweep of the tree.
 *
 * ## Prefer the system adapter when you have one
 *
 * A game that already registers `SystemAdapters.physics` needs none of this: the
 * adapter's `ownerOf`/`freeze`/`commit`/`unfreeze` is the richer answer, and the
 * editor asks it first. This mark is for the case that seam cannot cover — a
 * world whose bodies are built by ordinary per-scene code with no central
 * registry to hand a `bodyFor(nodeId)` resolver (every translated import lane),
 * where the only place node and body meet is the constructor that made both.
 * Marked nodes reach the SAME four verbs through
 * {@link createRapierBodyEditing}; this is a second SOURCE for one mechanism,
 * not a second mechanism.
 *
 * ## What to mark
 *
 * The node whose pose the body writes — normally the body's own root node. Not
 * subtree-scoped (unlike `vgaiBuiltInternal`): a child of a body-driven node
 * inherits its parent's motion through the transform chain, and its own local
 * pose is still the node's to keep. Mark exactly the node the sync writes.
 */

import type * as THREE from 'three';
import { getUserData, setUserData } from '../ecs/user-data';
import type { RapierEditableBody } from './rapier-physics-adapter';

/**
 * Declare that `body` owns `node`'s pose: a transform edit on `node` is applied
 * to `body`, and the next step is what puts the result back on the node.
 *
 * Call it where the pair is created. `body` is the game's OWN Rapier body,
 * passed through unchanged — the parameter type names five of Rapier's own
 * methods structurally (see {@link RapierEditableBody}) because this repo
 * legitimately resolves two copies of `@dimforge/rapier3d-compat` whose
 * `RigidBody` classes are unrelated nominal types.
 */
export function markBodyOwnedNode(node: THREE.Object3D, body: RapierEditableBody): void {
  setUserData(node, 'vgaiBodyOwner', body);
}

/** The body that owns `node`'s pose, or `undefined` for a node that owns its own. */
export function bodyOwningNode(
  node: THREE.Object3D | null | undefined,
): RapierEditableBody | undefined {
  const body = getUserData(node, 'vgaiBodyOwner');
  return body ?? undefined;
}
