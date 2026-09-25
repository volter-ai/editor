/**
 * THE SHARED LIVE-`Object3D` AUTHORING PROJECTION — the derived views every
 * three-surface configuration reads instead of spelling for itself.
 *
 * The layer below is `../projection/three.ts`: it owns the walk, identity
 * minting, the two-way index and picking. This module owns what sits ON that
 * index and used to be duplicated across the configurations — the
 * transparent-wrapper collapse view (`CollapsedHierarchyView`), the transform
 * READ ({@link readLocalTransform}) and the store-selection adoption
 * ({@link StoreSelectionAdoption}).
 *
 * PICKING and BOUNDS are not here because they were never duplicated:
 * `ThreeProjector.pick`/`candidates` is already the one raycast, and
 * `@volter/editor-threejs/viewport/content-bounds` is the bounds walk. Duplicating either would
 * be a hop, not an extraction.
 *
 * The configurations are `three-authoring-adapter.ts` (play adoption and
 * every ingest mount), `r3f-source-authoring-adapter.ts` (edit write-back) and
 * `source-object3d-authoring-adapter.ts` (a native graph opened as a document).
 * They differ by IDENTITY PROVIDER and WRITE TARGET, never by where their graph
 * came from; `three-projection-inventory.test.ts` is the census that keeps it
 * that way.
 *
 * What is deliberately NOT here: the R3F lane's COMPONENT-INSTANCE collapse
 * (`isComponentBoundary` and the owner chain). That rule answers a different
 * question — which callsite rendered this — and merging it with the rule below
 * would be inventing a third, not extracting a shared one.
 */

import type { EditorNode, Transform } from '@volter/editor-project/adapter';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { object3DAuthoringSubjectOf } from '@volter/editor-threejs/adapter/object3d-authoring-subject';
import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import type * as THREE from 'three';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { nativeKindOf, type ThreeProjector } from '../projection/three';
import { localTransformOf } from './live-object-transform';

export interface StoreSelectionAdoptionOptions {
  readonly store: ShellStore;
  /** Which ids this projection owns. The store is shared, so it can hold
   *  another surface's ids and a synthetic row this projection invented. */
  readonly owns: (id: string) => boolean;
  /** The selection before anything is picked — usually the document row. */
  readonly initial: readonly string[];
  /** Runs with the OWNED ids whenever the adopted set changes, in either
   *  direction. The Object3D-document configuration drives its nodes'
   *  `selectionChanged` marks from here. */
  readonly onChange?: (ids: readonly string[]) => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * SELECTION, shared between the store and a configuration's own answer.
 *
 * `EditorViewport`'s additive/toggle paths mutate `ShellStore` directly
 * rather than going through the adapter, so a `SelectionProvider` that only
 * remembered what it was last told drifted from what the viewport had drawn.
 * Reading the store on every `get` is what keeps the hierarchy, the Inspector
 * and the viewport agreeing; comparing against the last adopted ids is what
 * stops that read from re-notifying on every render.
 */
export class StoreSelectionAdoption {
  /** The store ids last adopted or published — the comparison basis. */
  private adopted: readonly string[] = [];
  private selected: string[];

  constructor(private readonly options: StoreSelectionAdoptionOptions) {
    this.selected = [...options.initial];
  }

  /** This projection's selection, having adopted whatever the viewport wrote. */
  current(): string[] {
    const storeIds = [...this.options.store.selectedEntityIds].filter(this.options.owns);
    if (!sameIds(storeIds, this.adopted)) {
      this.adopted = storeIds;
      this.selected = storeIds;
      this.options.onChange?.(storeIds);
    }
    return [...this.selected];
  }

  /**
   * Publish a selection the configuration has already resolved — rows it owns
   * plus, possibly, a synthetic row of its own. Only the owned ids reach the
   * store, because that is the index the viewport draws from.
   */
  publish(selected: readonly string[]): void {
    this.selected = [...selected];
    const storeIds = this.selected.filter(this.options.owns);
    this.adopted = storeIds;
    this.options.onChange?.(storeIds);
    this.options.store.selectMultiple(storeIds);
  }
}

/**
 * A `TransformProvider.get` over a live `Object3D` — the read every three
 * configuration answers with.
 *
 * `null` is the honest identity for an id this projection does not own (the
 * document row, a synthetic row, a node the last walk dropped): the provider's
 * contract has no absent answer, and the caller has already been told through
 * `editability`/`dimensions` that there is nothing there.
 *
 * The read itself is `live-object-transform.ts`'s rule — a node whose driver
 * owns its matrix keeps stale `.position`/`.quaternion`/`.scale` forever, so
 * the matrix is the transform exactly when the node maintains it. That answer
 * feeds the Inspector, the selection overlay's anchor and the origin marker,
 * which is why all three must give it.
 */
export function readLocalTransform(object: THREE.Object3D | null): Transform {
  if (!object) return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
  const live = localTransformOf(object);
  return { position: live.position, rotation: live.quaternion, scale: live.scale };
}

/**
 * THE COLLAPSE RULE. A live graph contains connective nodes a library inserted
 * rather than the project authoring them — Rapier's `<RigidBody>` puts an
 * anonymous generic `Object3D` between the prefab and its named mesh. Showing
 * it starts the hierarchy with an uneditable "Object3D" row and asks the author
 * to understand library implementation structure.
 *
 * This is an OWNERSHIP rule, not a package/name exception: a source-stamped
 * node, component root, explicit authoring root or native authoring proxy is
 * semantic and stays visible. Only an unnamed, unclaimed generic container is
 * transparent, and its meaningful descendants are promoted in place.
 */
export function isTransparentWrapper(object: THREE.Object3D): boolean {
  return (
    object.type === 'Object3D' &&
    object.name === '' &&
    object3DAuthoringSubjectOf(object) === null &&
    object.userData['oid'] === undefined &&
    getUserData(object, 'authoringInstance') === undefined &&
    getUserData(object, 'authoringRoot') !== true &&
    getUserData(object, 'vgaiComponentRoot') === undefined
  );
}

export interface CollapsedHierarchyOptions {
  /** The index this view derives from — never a second walk. */
  readonly projector: ThreeProjector;
  /** Climbing stops here: a graph's own scene is not a row. */
  readonly scene: THREE.Scene;
  /** The row a projection root (and any climb that escapes the graph) answers
   *  to. It exists in the VIEW only, so the projector answers `null` for it. */
  readonly documentNodeId: string;
  /** This view's declared roots, as ids of {@link projector}'s index. */
  readonly rootIds: readonly string[];
}

/**
 * The hierarchy view a configuration hands its `HierarchyProvider`: the
 * projection's own parent/child structure with {@link isTransparentWrapper}
 * nodes folded out of it.
 *
 * Every method answers from the projector's live index, so a configuration that
 * re-walks (a running world spawns objects) sees the new graph without this
 * view holding anything stale.
 */
export class CollapsedHierarchyView {
  private readonly rootIdSet: ReadonlySet<string>;

  constructor(private readonly options: CollapsedHierarchyOptions) {
    this.rootIdSet = new Set(options.rootIds);
  }

  /** `object`'s visible children — the live objects themselves, so a caller
   *  that needs the object (not its row) does not go back through the index. */
  childObjects(object: THREE.Object3D): THREE.Object3D[] {
    return object.children.flatMap((child) => {
      if (isEditorOwnedObject(child)) return [];
      return isTransparentWrapper(child) ? this.childObjects(child) : [child];
    });
  }

  childIds(object: THREE.Object3D): string[] {
    return this.options.projector.childIdsOf(this.childObjects(object));
  }

  /** The declared roots with transparent ones replaced by what they contain. */
  rootObjects(): THREE.Object3D[] {
    return this.options.rootIds.flatMap((id) => {
      const object = this.options.projector.objectOf(id);
      if (!object) return [];
      return isTransparentWrapper(object) ? this.childObjects(object) : [object];
    });
  }

  rootIds(): string[] {
    return this.options.projector.childIdsOf(this.rootObjects());
  }

  /** The row that owns `object`: the nearest ancestor this view shows, or the
   *  document row when the climb reaches a declared root or the scene. */
  parentId(object: THREE.Object3D): string {
    const { projector, scene, documentNodeId } = this.options;
    const id = projector.idOf(object);
    if (id !== null && this.rootIdSet.has(id)) return documentNodeId;
    let parent = object.parent;
    while (parent && parent !== scene && isTransparentWrapper(parent)) {
      parent = parent.parent;
    }
    return parent && parent !== scene ? (projector.idOf(parent) ?? documentNodeId) : documentNodeId;
  }

  /** `object`'s row. An object is named and typed by what it IS — its own
   *  authoring subject, name, or native type — never by an owner above it. */
  node(object: THREE.Object3D): EditorNode {
    const subject = object3DAuthoringSubjectOf(object);
    return {
      id: this.options.projector.idOf(object)!,
      label: subject?.label || object.name || object.type || 'Object3D',
      role: 'entity',
      kind: nativeKindOf(object),
      ...(subject?.typeLabel ? { typeLabel: subject.typeLabel } : {}),
      parentId: this.parentId(object),
      childIds: this.childIds(object),
    };
  }
}
