/**
 * The PROJECTION family's surface-neutral shapes (ARCHITECTURE-CORE §The editor
 * protocol).
 *
 * A projection answers "what nodes are in this world, what are their stable
 * ids, and how do they nest" over the RUNTIME objects a mounted world is made
 * of — the live `Object3D`/`Container`/DOM element, never an AST node. A walk
 * always answers: an empty projection over a mounted world is a defect, never a
 * fact.
 *
 * Only the shapes live here. The projectors themselves are per surface
 * (`./three.ts`, `./pixi.ts`, `./dom.ts`), because what an
 * object IS, how identity is minted and what an editor-owned object looks like
 * are all surface facts.
 */

/**
 * One projected authoring node.
 *
 * `parentId` is the nearest ADMITTED ancestor — not the runtime parent — so a
 * projection that folds a library's internals into their owner reports the
 * owner. `null` means this node is a root of the projection.
 */
export interface ProjectedNode<TObject> {
  readonly object: TObject;
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: string[];
}

/**
 * One walk's product: every node by id, the roots in walk order, and whatever
 * the surface counts about itself.
 *
 * `nodes` is keyed by the id the rest of the editor addresses the node by, so
 * the id the gizmo binds to, the id the hierarchy row shows and the id
 * `EditorShellStore.objectMap` indexes can never disagree — they are all this
 * one map.
 */
export interface Projection<TObject, TStats> {
  readonly nodes: Map<string, ProjectedNode<TObject>>;
  readonly rootIds: string[];
  readonly stats: TStats;
}
