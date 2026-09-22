/**
 * The hierarchy-presentation convention: how a game tells the editor which
 * parts of its LIVE scene graph are one component instance, and which parts are
 * implementation rather than content.
 *
 * ## Why marks and not a second tree
 *
 * The live tree IS the display surface. A hierarchy derived from source would
 * be a mirror layer — a second model of the world that drifts from the one on
 * screen — so the boundaries a reader needs have to live ON the nodes. That is
 * what these marks are, and it is the whole mechanism: a component WRAPS its
 * functionality and MARKS its root; the editor supports the convention
 * generically and never learns which library, importer or lane produced the
 * node.
 *
 * ## STRUCTURE IS THE TREE'S JOB. MARKS ONLY CLASSIFY.
 *
 * There is deliberately no mark that says "show this row somewhere else". A
 * group owns its children by CONTAINING them; a prefab owns its parts by
 * CONTAINING them. If an object reads as belonging under something it is not
 * parented to, the tree is wrong and the tree is what to fix — because the
 * panel is not the only reader. `getWorldPosition`, raycasting, disposal,
 * `traverse`, every physics or gameplay walk and every person reading the
 * source all follow real parenthood, and a presentation-only "logical parent"
 * would be true for exactly one of them.
 *
 * The usual reason a world gets this wrong is that three's parent chain is a
 * TRANSFORM chain: `matrixWorld` is unconditionally `parent × local`, so an
 * object that must not inherit its owner's pose — a physics-driven body writing
 * a world transform every step, a world-space trail or decal, a follow camera
 * that must escape its target's rotation — gets mounted at the scene root, and
 * ownership is lost as a side effect. **That trade is not necessary.** Set
 * `object.matrixWorldAutoUpdate = false` (three r144+) and the parent's
 * propagation skips it: the object stays parented where it belongs and its
 * `matrixWorld` becomes yours to write. Keep it parented, own the matrix, and
 * the hierarchy needs no help.
 *
 * These two marks then have exactly one job left, which is CLASSIFICATION:
 * which of the objects that really are here is the game, and which is the
 * machinery underneath it.
 *
 * ## What the hierarchy is FOR
 *
 * It shows YOUR GAME: the structure you authored, plus the objects your game
 * makes while it runs. Nothing else. Three consequences, and every rule below
 * follows from them:
 *
 *  - **A spawned object is content.** A bullet you fired, a wave of enemies, a
 *    prop pulled out of a pool and parented into the level — these are rows.
 *    They exist, you can select them, and they are usually the exact things you
 *    opened the panel to look at. An object your game frees stops being a row,
 *    because it stopped existing.
 *  - **An implementation artifact is not.** The bones behind a rig, the batched
 *    renderer behind a particle system, the instanced-mesh pools behind a tile
 *    field, the `target` object three needs in order to aim a directional
 *    light: machinery a library or a helper builds so one thing you DID author
 *    can work. It belongs UNDER that thing, folded, not beside it.
 *  - **"Not in the source file" is the wrong test for either.** Half of a
 *    running world is not in the source file — that is what running means.
 *    Folding spawned gameplay because a document does not name it is the same
 *    defect as listing bones, in the more damaging direction: the rows it loses
 *    are the ones you were looking for.
 *
 * ## The two marks
 *
 * - {@link markComponentRoot} — "this subtree is one instance of `<name>`."
 *   The editor renders it as ONE row, closed, expandable on demand. Put it on
 *   the EARLIEST point the node exists: the constructor that makes it, or the
 *   ref callback that receives it. A component whose root is a plain `<mesh>`
 *   marks that mesh.
 * - {@link markBuiltInternal} — "this is IMPLEMENTATION, not content." It is
 *   **subtree-scoped**: marking the root of a built subtree marks everything
 *   under it, so a 60-bone rig costs one call and folding is transitive. The
 *   editor hides these rows and offers them behind the same "Reveal Internals"
 *   action a source-backed instance's internals already use — revealed rows
 *   are read-only, because there is no authored source for a rename or a
 *   reparent to write to.
 *
 * An instance therefore reads as the parent of everything meaningful beneath
 * it: content nested inside an implementation node is listed under the instance
 * rather than lost with it (the editor's `hierarchy-component-marks.ts` calls
 * that promotion), so marking a rig does not hide the mesh skinned to it.
 *
 * ## Mark it where the subtree is ATTACHED, by whoever attaches it
 *
 * A mark belongs at the attach seam: the code that puts an implementation
 * subtree into the world marks it in the same breath, because that code is the
 * only thing that knows the subtree is implementation. Not a later sweep of the
 * tree — "everything present at time T that the source did not name" is the
 * wrong predicate twice over. It arrives too early for anything attached
 * asynchronously (a model clone landing after its bytes resolve, a node gated
 * on an audio decode) and too late in principle for anything attached
 * afterwards (every spawn) — and were it re-run to catch those, it would
 * classify each spawned object as implementation, which is the second bullet
 * above inverted. Attach-seam marking has neither failure: it fires once, at
 * the moment the answer is known, and an unmarked node is content by default.
 *
 * The subtree scope is what keeps this cheap — one call per attached root, not
 * one per node, so a rig or a pool costs one line at the one place that builds
 * it.
 *
 * ## What is NOT built-internal
 *
 * A node your game means as content — even one a class rather than JSX
 * constructs — is content. `vgaiBuiltInternal` is not "the editor cannot write
 * this"; that question is `TransformProvider.editability`'s, answered per
 * channel with a sentence. This mark answers "is this implementation", and
 * getting it wrong hides real content.
 *
 * Both keys live in the structural mark registry (`../ecs/object-marks.ts`),
 * which the full typed `userData` registry includes, so
 * their literal strings are spelled exactly once; this module is the only
 * reader/writer, which is why the helpers below exist at all rather than
 * `setUserData` calls scattered through emitters and prefabs.
 */

import type * as THREE from 'three';
import { getObjectMark, setObjectMark } from '../ecs/object-marks';

/**
 * Declare `node` the root of one component instance, displayed under `name`.
 *
 * `name` is the COMPONENT's name (`'Coin'`, `'HeroBox'`), not the instance's —
 * the instance is already named by `node.name`, and the editor prints both.
 */
export function markComponentRoot(node: THREE.Object3D, name: string): void {
  setObjectMark(node, 'vgaiComponentRoot', name);
}

/** The component name `node` is the root of, or `undefined` for an ordinary node. */
export function componentRootName(node: THREE.Object3D | null | undefined): string | undefined {
  const name = getObjectMark(node, 'vgaiComponentRoot');
  return typeof name === 'string' && name ? name : undefined;
}

/** Whether `node` is a marked component-instance root. */
export function isComponentRoot(node: THREE.Object3D | null | undefined): boolean {
  return componentRootName(node) !== undefined;
}

/**
 * Declare `node` (and everything under it) IMPLEMENTATION of whatever node it
 * sits under, rather than content of its own. Call it on the ROOT of the built
 * subtree only, at the seam that attaches it — see this module's header for why
 * the seam and not a sweep.
 */
export function markBuiltInternal(node: THREE.Object3D): void {
  setObjectMark(node, 'vgaiBuiltInternal', true);
}

/** Whether `node` itself carries the implementation mark. Ancestry is the
 *  CALLER's walk — see this module's header for why the mark is subtree-scoped
 *  but not restamped onto descendants. */
export function isBuiltInternal(node: THREE.Object3D | null | undefined): boolean {
  return getObjectMark(node, 'vgaiBuiltInternal') === true;
}
