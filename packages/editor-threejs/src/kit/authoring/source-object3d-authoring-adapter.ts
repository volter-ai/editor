/**
 * Read-only authoring projection for a native Three.js document graph.
 *
 * The native Object3D tree is truth. The shared three projector
 * (`../projection/three.ts`) walks it under the document-path identity and owns
 * the index; the shared collapse view (`three-projection-core.ts`) turns that
 * index into rows. This CONFIGURATION supplies the two axes — document-path
 * identity, no write target — plus what only a document has: its own document
 * row, the model classification on it, and the read-only inspector. It never
 * fabricates descriptors or a JSON mirror. Source parameters rebuild the graph
 * outside this adapter.
 */

import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  HierarchyProvider,
  InspectorProvider,
  PropertyDescriptor,
  SelectionProvider,
  Transform,
  TransformProvider,
} from '@volter/editor-project/adapter';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { object3DAuthoringSubjectOf } from '@volter/editor-threejs/adapter/object3d-authoring-subject';
import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import type * as THREE from 'three';
import {
  classifyModelStructure,
  inspectModel,
  inspectModelRig,
} from '../asset-workflow/model-inspection';
import type { EditorShellStore } from '../editor-shell-store';
import { documentPathIdentity, ThreeProjector } from '../projection/three';
import {
  CollapsedHierarchyView,
  readLocalTransform,
  StoreSelectionAdoption,
} from './three-projection-core';

export interface SourceObject3DAuthoringOptions {
  readonly documentId: string;
  readonly title: string;
  readonly sourcePath: string;
  readonly documentKind?: 'source' | 'asset';
  /** The Asset Lab's import audit on this document's inspector — see
   *  `ToolObject3DAuthoringProps.audit`. Default on. */
  readonly audit?: boolean;
  /** Authored content roots when the scene also contains a document-owned
   * presentation container. Omitted preserves the native projection roots. */
  readonly hierarchyRoots?: readonly THREE.Object3D[];
  readonly provenance?: AuthoringProvenance;
  readonly modelSource?:
    | { readonly kind: 'project-file'; readonly path: string }
    | { readonly kind: 'entity'; readonly entityId: string };
}

/** `node()` runs on every hierarchy render; classifying a whole graph there
 *  would walk it each time. Keyed by the root object, so a rebuilt graph is a
 *  fresh entry and a disposed one is collected with it. */
const documentTypeLabelByRoot = new WeakMap<THREE.Object3D, string>();

function classifyDocumentRoot(root: THREE.Object3D): string {
  let splat = false;
  root.traverse((object) => {
    if (getUserData(object, 'gaussianSplat')) splat = true;
  });
  if (splat) return 'Gaussian splat';
  const inspection = inspectModel(root);
  const rig = inspectModelRig(root);
  return {
    static: 'Static model',
    animated: 'Animated model',
    rigged: 'Rigged model',
    skinned: 'Skinned model',
  }[classifyModelStructure(inspection, rig)];
}

function materialOf(object: THREE.Object3D): THREE.Material | null {
  const material = (object as THREE.Mesh).material;
  if (Array.isArray(material)) return material[0] ?? null;
  return material ?? null;
}

function colorOf(material: THREE.Material | null): THREE.Color | null {
  const candidate = material as (THREE.Material & { color?: THREE.Color }) | null;
  return candidate?.color ?? null;
}

export class SourceObject3DAuthoringAdapter implements AuthoringAdapter {
  private readonly documentNodeId: string;
  /** The shared three projector over this document's graph. */
  private readonly projector: ThreeProjector;
  private readonly hierarchyRootIds: readonly string[];
  /** The shared collapse view over {@link projector} — see
   *  `three-projection-core.ts`. */
  private readonly view: CollapsedHierarchyView;
  /** Selection, shared with the store the viewport writes to — see
   *  `three-projection-core.ts`. */
  private readonly selectionState: StoreSelectionAdoption;
  private markedSelection = new Set<THREE.Object3D>();

  readonly capabilities: AuthoringCapabilities = {
    transform: false,
    inspectorFields: true,
    persist: false,
  };

  readonly provenance: AuthoringProvenance;

  constructor(
    private readonly store: EditorShellStore,
    private readonly scene: THREE.Scene,
    readonly options: SourceObject3DAuthoringOptions,
  ) {
    this.provenance =
      options.provenance ??
      (options.documentKind === 'asset'
        ? {
            source: 'document',
            label: 'derived asset',
            detail: 'Loaded from an ordinary project asset. Edit its source or import recipe.',
          }
        : {
            source: 'source-code',
            label: 'source',
            detail:
              'Instantiated from project TypeScript. Edit source or exposed parameters, then rebuild.',
          });
    this.documentNodeId = `object3d-document:${options.documentId}`;
    // The projector stamps `userData.entityId` as it walks, so EditorViewport
    // and its gizmo/pick code consume the same native id.
    this.projector = new ThreeProjector(documentPathIdentity(options.documentId));
    this.indexGraph();
    if (
      options.hierarchyRoots &&
      new Set(options.hierarchyRoots).size !== options.hierarchyRoots.length
    ) {
      throw new Error(
        `Object3D document "${options.title}" declared the same hierarchy root twice.`,
      );
    }
    const declaredRootSet = new Set(options.hierarchyRoots ?? []);
    for (const root of declaredRootSet) {
      let parent = root.parent;
      while (parent && parent !== scene) {
        if (declaredRootSet.has(parent)) {
          throw new Error(
            `Object3D document "${options.title}" declared nested hierarchy roots; roots must be non-overlapping.`,
          );
        }
        parent = parent.parent;
      }
    }
    this.hierarchyRootIds = options.hierarchyRoots
      ? options.hierarchyRoots.map((object) => {
          const id = this.idByObject.get(object);
          if (!id) {
            throw new Error(
              `Object3D document "${options.title}" declared a hierarchy root outside its native graph.`,
            );
          }
          return id;
        })
      : [...this.projector.rootIds];
    this.view = new CollapsedHierarchyView({
      projector: this.projector,
      scene,
      documentNodeId: this.documentNodeId,
      rootIds: this.hierarchyRootIds,
    });
    this.selectionState = new StoreSelectionAdoption({
      store: store.shell,
      owns: (id) => this.byId.has(id),
      initial: [this.documentNodeId],
      onChange: (ids) => this.syncMarkedSelection(ids),
    });
  }

  // ------------------------------------------------ graph mutated after mount
  //
  // The constructor's walk is a snapshot of the graph AT MOUNT, and one class
  // of document mutates its graph afterwards: the live module document
  // (`components/asset-viewers/LiveModuleDocument.tsx`) keeps a stable
  // container root and SWAPS ITS CHILD on every save, precisely so the
  // viewport's camera survives a rebuild. Measured 2026-08-29: the viewport
  // showed the rebuilt model while the hierarchy kept the mount-time walk, so
  // the document row lost its child and the picker addressed a disposed
  // object.
  //
  // The fix is `r3f-source-authoring-adapter.ts`'s, transcribed: re-index on
  // the GRAPH'S OWN structural events. `parent.add(child)` dispatches
  // `childadded` on the parent, so watching the scene plus every indexed
  // object covers every path a subtree can enter through, and no document has
  // to remember to tell this adapter anything. Editor furniture (gizmo and
  // helper attachments) is filtered so selection churn does not re-index.

  private disposed = false;
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of this.watchedForStructure) {
      object.removeEventListener('childadded', this.onStructureChanged);
      object.removeEventListener('childremoved', this.onStructureChanged);
    }
    this.watchedForStructure = [];
  }

  private watchedForStructure: THREE.Object3D[] = [];
  private structureReindexQueued = false;

  private readonly onStructureChanged = (event: { child: THREE.Object3D }): void => {
    if (isEditorOwnedObject(event.child)) return;
    this.scheduleStructureReindex();
  };

  private indexGraph(): void {
    this.projector.project(this.scene);
    this.watchStructure();
  }

  /** (Re)attach `childadded`/`childremoved` across the indexed graph, so a
   *  freshly-swapped subtree is watched from the re-index that found it. */
  private watchStructure(): void {
    const structural = (object: THREE.Object3D) =>
      object as unknown as {
        addEventListener(
          type: 'childadded' | 'childremoved',
          listener: (event: { child: THREE.Object3D }) => void,
        ): void;
        removeEventListener(
          type: 'childadded' | 'childremoved',
          listener: (event: { child: THREE.Object3D }) => void,
        ): void;
      };
    for (const object of this.watchedForStructure) {
      structural(object).removeEventListener('childadded', this.onStructureChanged);
      structural(object).removeEventListener('childremoved', this.onStructureChanged);
    }
    this.watchedForStructure = [];
    const watch = (object: THREE.Object3D): void => {
      structural(object).addEventListener('childadded', this.onStructureChanged);
      structural(object).addEventListener('childremoved', this.onStructureChanged);
      this.watchedForStructure.push(object);
    };
    watch(this.scene);
    for (const [, object] of this.byId) watch(object);
  }

  /** One re-index per mutation burst: a swap is remove-then-add, and a
   *  microtask runs after the whole subtree is in the graph. */
  private scheduleStructureReindex(): void {
    if (this.disposed || this.structureReindexQueued) return;
    this.structureReindexQueued = true;
    queueMicrotask(() => {
      this.structureReindexQueued = false;
      if (this.disposed) return;
      this.indexGraph();
      if (this.store.scene !== this.scene) return;
      const map = this.store.objectMap;
      map.clear();
      for (const [id, object] of this.byId) map.set(id, object);
      // Selection can name an object the swap removed; keep it inside the
      // index the hierarchy, picker and gizmo now consume.
      const retained = [...this.store.shell.selectedEntityIds].filter(
        (id) => id === this.documentNodeId || this.byId.has(id),
      );
      if (retained.length !== this.store.shell.selectedEntityIds.size) {
        this.store.shell.selectMultiple(retained);
      }
      // `subscribe` on this adapter IS the store's subscribe, so notifying the
      // store is this adapter's own change signal.
      this.store.notifyIngestObjectMapEdit();
    });
  }

  private get byId(): ReadonlyMap<string, THREE.Object3D> {
    return this.projector.objects;
  }

  private get idByObject(): ReadonlyMap<THREE.Object3D, string> {
    return this.projector.idsByObject;
  }

  /** The document root's structural type, cached per root graph. `undefined`
   *  for a SOURCE document, whose root is whatever the project built and not
   *  a model with a structure to classify. */
  private documentTypeLabel(): string | undefined {
    if (this.options.documentKind !== 'asset') return undefined;
    // NOT `documentRootObject` — that reads the document node's `childIds`,
    // and this is called while building that node.
    const root = this.scene.children.find((child) => this.idByObject.has(child)) ?? null;
    if (!root) return undefined;
    const cached = documentTypeLabelByRoot.get(root);
    if (cached !== undefined) return cached;
    const label = classifyDocumentRoot(root);
    documentTypeLabelByRoot.set(root, label);
    return label;
  }

  readonly hierarchy: HierarchyProvider = {
    roots: () => [this.hierarchy.node(this.documentNodeId)!],
    node: (id) => {
      if (id === this.documentNodeId) {
        const typeLabel = this.documentTypeLabel();
        return {
          id,
          label: this.options.title,
          secondaryLabel: this.options.sourcePath,
          role: 'document',
          kind: this.options.documentKind === 'asset' ? 'model-asset' : 'three-source',
          // What to CALL this document's root, on the inspector's identity
          // row — "Rigged model", "Gaussian splat". It is the structure of
          // the graph this adapter is projecting, so the adapter is the only
          // thing that can answer it; the classification is cached per root
          // because `node()` is called on every hierarchy render.
          ...(typeLabel ? { typeLabel } : {}),
          parentId: null,
          childIds: this.view.rootIds(),
        };
      }
      const object = this.byId.get(id);
      return object ? this.view.node(object) : null;
    },
    object3D: (id) => this.byId.get(id) ?? null,
    idForObject3D: (object: THREE.Object3D) => this.idByObject.get(object) ?? null,
  };

  readonly selection: SelectionProvider = {
    get: () => this.selectionState.current(),
    // The document row is selectable and is NOT one of this projection's
    // objects, which is why it survives this filter and never reaches the store.
    set: (ids) =>
      this.selectionState.publish(
        ids.filter((id) => id === this.documentNodeId || this.byId.has(id)),
      ),
  };

  /**
   * THE REASON THIS PROJECTION REFUSES, spelled once because it is PRINTED:
   * it lands in the tooltip of every generic shell control that asks this
   * adapter whether it may write.
   */
  private static readonly READ_ONLY_REASON =
    'This document shows what the module builds; its properties are read-only here. Edit the module.';

  /**
   * READ-ONLY, AND IT SAYS SO NOW. Every write door on this adapter is a
   * no-op and always was — `transforms.beginEdit`/`apply`/`endEdit` below and
   * `inspector.set` further down all return `undefined` — but it declared no
   * `editability`, which is the seam the shell asks BEFORE drawing a control
   * (`InspectorProvider.editability`'s own contract names "hierarchy eye/lock
   * controls"). Its default is `{ writable: true }`, so the shell believed
   * this projection and drew a live control over a surface that discards it.
   *
   * MEASURED 2026-09-19 in a cold models scaffold, which is what bought this:
   * the Outliner's EYE on a Model document lit, kept its `Hide` tooltip and
   * its `aria-pressed="false"`, and left the frame hash byte-identical —
   * `GameHierarchy.tsx` gates it on `visibleKnown && (editability?.writable ??
   * true)`, and `visible` is knowable here (it reads `object.visible`) even
   * though it is `readonly: true` in the very descriptor list below.
   *
   * `transforms` DELIBERATELY DOES NOT GET ONE, and that is a measurement
   * rather than an oversight. Its write doors are no-ops too, so the honest
   * answer is the same — but declaring it bought nothing and cost a mark:
   * `transform-mode-request.ts`, the one place that would have NAMED the
   * refusal, reads `store.selectedEntityIds` off the SHELL store while a
   * document stage keeps its selection in its own, so it returns before it
   * can speak and the host's Move/Rotate/Scale stayed silent either way —
   * while `GameHierarchy`'s `hierarchy-transform-lock` span immediately
   * appeared on every row, a glyph Blender's Outliner does not draw. Answer
   * it when something acts on the answer.
   */
  private readonly readOnly = (): { writable: boolean; reason: string } => ({
    writable: false,
    reason: SourceObject3DAuthoringAdapter.READ_ONLY_REASON,
  });

  readonly transforms: TransformProvider = {
    get: (id): Transform => readLocalTransform(this.byId.get(id) ?? null),
    beginEdit: () => undefined,
    apply: () => undefined,
    endEdit: () => undefined,
  };

  readonly inspector: InspectorProvider = {
    properties: (id): PropertyDescriptor[] => {
      if (id === this.documentNodeId) {
        // A document that declined the import audit carries its own sections;
        // the name is the identity row's and the path is the hierarchy
        // header's, so the loose "Properties" grid would only repeat them.
        if (this.options.audit === false) return [];
        return [
          { path: 'name', label: 'Name', type: 'string', readonly: true },
          { path: 'source.path', label: 'Source', type: 'string', readonly: true },
        ];
      }
      const object = this.byId.get(id);
      if (!object) return [];
      const subject = object3DAuthoringSubjectOf(object);
      if (subject?.fields) {
        return subject.fields().map(({ value: _value, ...descriptor }) => descriptor);
      }
      const properties: PropertyDescriptor[] = [
        { path: 'name', label: 'Name', type: 'string', readonly: true },
        { path: 'visible', label: 'Visible', type: 'boolean', readonly: true },
        { path: 'object.type', label: 'Native type', type: 'string', readonly: true },
      ];
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        const position = mesh.geometry.getAttribute('position');
        properties.push({
          path: 'mesh.vertices',
          label: 'Vertices',
          type: 'number',
          readonly: true,
          group: 'Mesh',
        });
        if (position) {
          properties.push({
            path: 'mesh.triangles',
            label: 'Triangles',
            type: 'number',
            readonly: true,
            group: 'Mesh',
          });
        }
      }
      const material = materialOf(object);
      if (material) {
        properties.push({
          path: 'material.type',
          label: 'Material',
          type: 'string',
          readonly: true,
          group: 'Material',
        });
        if (colorOf(material)) {
          properties.push({
            path: 'material.color',
            label: 'Color',
            type: 'color',
            readonly: true,
            group: 'Material',
          });
        }
      }
      const skinned = object as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && skinned.skeleton) {
        properties.push({
          path: 'skin.bones',
          label: 'Bones',
          type: 'number',
          readonly: true,
          group: 'Skin',
        });
      }
      return properties;
    },
    get: (id, path) => {
      if (id === this.documentNodeId) {
        if (path === 'name') return this.options.title;
        if (path === 'source.path') return this.options.sourcePath;
        return undefined;
      }
      const object = this.byId.get(id);
      if (!object) return undefined;
      const subject = object3DAuthoringSubjectOf(object);
      const subjectField = subject?.fields?.().find((field) => field.path === path);
      if (subjectField) return subjectField.value();
      if (path === 'name') return object.name || object.type;
      if (path === 'visible') return object.visible;
      if (path === 'object.type') return object.type;
      const mesh = object as THREE.Mesh;
      if (path === 'mesh.vertices') return mesh.geometry?.getAttribute('position')?.count ?? 0;
      if (path === 'mesh.triangles') {
        const geometry = mesh.geometry;
        return (geometry?.index?.count ?? geometry?.getAttribute('position')?.count ?? 0) / 3;
      }
      const material = materialOf(object);
      if (path === 'material.type') return material?.type;
      if (path === 'material.color') {
        const color = colorOf(material);
        return color ? `#${color.getHexString()}` : undefined;
      }
      if (path === 'skin.bones') return (object as THREE.SkinnedMesh).skeleton?.bones.length ?? 0;
      return undefined;
    },
    set: () => undefined,
    // See {@link readOnly}: `set` above writes nothing, so no generic surface
    // may draw a live control over one of these values.
    editability: () => this.readOnly(),
  };

  subscribe(listener: () => void): () => void {
    return this.store.shell.subscribe(listener);
  }

  get documentId(): string {
    return this.documentNodeId;
  }

  get documentRootObject(): THREE.Object3D | null {
    const rootId = this.hierarchy.node(this.documentNodeId)?.childIds[0];
    return rootId ? (this.byId.get(rootId) ?? null) : null;
  }

  private syncMarkedSelection(ids: readonly string[]): void {
    const next = new Set(
      ids
        .map((id) => this.byId.get(id) ?? null)
        .filter((object): object is THREE.Object3D => object !== null)
        .filter((object) => object3DAuthoringSubjectOf(object)?.selectionChanged !== undefined),
    );
    for (const object of this.markedSelection) {
      if (!next.has(object)) object3DAuthoringSubjectOf(object)?.selectionChanged?.(false);
    }
    for (const object of next) {
      if (!this.markedSelection.has(object)) {
        object3DAuthoringSubjectOf(object)?.selectionChanged?.(true);
      }
    }
    this.markedSelection = next;
  }
}
