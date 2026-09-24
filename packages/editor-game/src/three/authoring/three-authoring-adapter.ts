/**
 * ThreeAuthoringAdapter — THE {@link AuthoringAdapter} for the three.js
 * SUBSTRATE: a `THREE.Object3D` tree, whatever built that tree.
 *
 * The name carries no adjective because the substrate needs none (owner
 * ruling 2026-08-22, ARCHITECTURE-CORE §Roots): every Object3D graph the
 * editor ever edits is in-memory objects — three has no document format here.
 * A world AUTHORED as JSX is the R3F substrate (`R3fSourceAuthoringAdapter`,
 * where the element is the entity and source is truth); the moment it RUNS,
 * its render artifact is an Object3D graph and presents as THIS substrate —
 * which is why play adoption and ingested R3F games both land here, with
 * Edit↔Play id continuity as the bridge between the two substrates.
 *
 * Model: the running Object3D graph IS the document. This adapter walks it,
 * mints {@link EditorNode}s directly, and reflects real three.js fields. It
 * never reads or fabricates a descriptor of its own, and it never decides where
 * an edit goes.
 *
 * ONE ADAPTER, TWO PARAMETERS (docs/ARCHITECTURE-CORE.md §Editor: authoring
 * adapters are keyed on the SUBSTRATE they drive, never on where the graph came
 * from). Everything below is a fact about a three surface — hierarchy,
 * selection, picking, transforms, reflected inspector fields, the per-property
 * editability sentence, the session's ephemeral edit record. What varies is
 * exactly two collaborators:
 *
 *  - an IDENTITY SCHEME (`../projection/three.ts`) — the walk that decides
 *    which objects are nodes and what their ids are: OID/creation-site stamps
 *    for a world whose source the serve-time transform reached, structural
 *    paths held in a pure projection for one it did not. The adapter consumes
 *    either without changing its hierarchy or editing behavior.
 *  - a PERSISTENCE BACKEND (`source-persistence-backend.ts`) — where a closed
 *    gesture's value goes: a creation-site literal writer, an honest
 *    live-only-with-reason, or NOTHING (the host injects
 *    `createEphemeralPersistence`, and play edits stay ephemeral by
 *    architecture).
 *
 * Identity stays in the provider projection. Source-backed OID worlds may
 * already carry their authored stamps; structural ingest worlds remain
 * untouched, with reverse object lookup owned by this adapter.
 *
 * Projection: this adapter walks nothing itself. The shared three projector
 * (`../projection/three.ts`) owns the walk, the identity minting, the index and
 * picking; everything below is a DERIVED VIEW over that one projection — which
 * is also where the layer-31 furniture skip lives (grid, editor lights,
 * BatchedRenderer, gizmo helper, pivot dummy, snap indicators are parked in
 * whatever scene is mounted, and projecting them offers the user the editor's
 * own objects as if they were the world's).
 *
 * Structural authoring (create/delete/reparent) is deliberately ABSENT: a
 * running world owns and rebuilds its own graph from its own source, so a
 * create/delete/reparent is not meaningfully re-expressible against it.
 */

import { getActiveNetworking, getActivePhysics } from '@volter/editor-core/authoring/active-systems';
import {
  authoringOidOf,
  isComponentInstanceRoot,
  ownOidOf,
} from '@volter/editor-core/authoring/component-instance-root';
import { creationSiteRelated } from '../../host/authoring/creation-site-related';
import { createEphemeralPersistence } from '../../host/authoring/ephemeral-persistence';
import { multiChannelRefusal, persistChannelWrite } from '../../host/authoring/gesture-persist';
import { dataRecordAnchor, dataRecordIndexOf } from '../../host/authoring/ingest-data-writer';
import type { IngestSourcePersistence } from '../../host/authoring/ingest-source-persistence';
import {
  createCreationSitePersistence,
  type SourcePersistenceBackend,
  type SourceWriteSubject,
} from '../../host/authoring/source-persistence-backend';
import { readLocalTransform } from '@volter/editor-core/authoring/three-projection-core';
import {
  LIVE_ONLY_ACK,
  LIVE_ONLY_DESTINATION,
  type PipedWrite,
  resolvesLiveOnly,
  runWritePipe,
  type WriteAck,
  type WriteResolution,
} from '@volter/editor-core/authoring/write-pipe';
import { componentStatesProvider } from '@volter/editor-core/component-states-registry';
import {
  type ChannelValue,
  type CreationSiteLiteralReport,
  channelFor,
} from '@volter/editor-core/creation-site-edit';
import {
  creationSiteAnchor,
  instancesAtSite,
  NO_OBJECT_REASON,
} from '@volter/editor-core/creation-site-registry';
import { editorConsole } from '@volter/editor-core/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { type JournalSubject, JsonHistoryResource } from '../../host/history/json-history-resource';
import {
  nativeKindOf,
  oidIdentity,
  structuralIdentity,
  type ThreeIdentity,
  type ThreeNode,
  type ThreeProjectionDelta,
  ThreeProjector,
  type ThreeWalkStats,
} from '@volter/editor-core/projection/three';
import type { SourceWriteBackend } from '@volter/editor-core/ui-source/source-write-backend';
import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  ComponentInstanceApplyResult,
  ComponentInstanceDescription,
  ComponentInstanceOverride,
  ComponentInstancesProvider,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  PersistenceProvider,
  PhysicsAdapter,
  PickProvider,
  PropertyDescriptor,
  RelatedSubjectsProvider,
  SelectionProvider,
  SelectionResolution,
  StoriesProvider,
  Transform,
  TransformChannel,
  TransformEditability,
  TransformProvider,
  TransformSourceCommitProvider,
  TruthProvider,
  WriteAnchorKind,
} from '@volter/editor-project/adapter';
import { emptyWriteAnchorKindCounts } from '@volter/editor-project/adapter';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { bodyOwningNode } from '@volter/threejs-runtime/adapter/body-marks';
import { colorMaterialOf } from '@volter/threejs-runtime/adapter/ingest/structural-ids';
import { object3DAuthoringSubjectOf } from '@volter/threejs-runtime/adapter/object3d-authoring-subject';
import { createRapierBodyEditing } from '@volter/threejs-runtime/adapter/rapier-physics-adapter';
import { getUserData } from '@volter/threejs-runtime/ecs/user-data';
import type * as THREE from 'three';
import {
  createOidSourcePersistence,
  createOidTransformSourceCommitter,
  type OidTransformSourceCommitter,
} from './oid-source-persistence';

/** One node's edits this session, keyed by node id. Never written anywhere. */
interface ThreeEdit {
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  color?: string;
  visible?: boolean;
}

interface ThreeHistoryState {
  edits: Record<string, ThreeEdit>;
  objects: Record<
    string,
    {
      name: string;
      visible: boolean;
      transform: Transform;
      color?: string;
      lightIntensity?: number;
      lightColor?: string;
      lightDistance?: number;
      camera?: { fov: number; near: number; far: number };
      castShadow: boolean;
      receiveShadow: boolean;
    }
  >;
}

/** Loop-gate hooks so a stable edit can pause the world that owns the rAF. */
export interface ThreeLoopControl {
  pause(): void;
  resume(): void;
}

/**
 * The scene this adapter projects: a concrete one (play adopts a specific
 * root's scene) or a resolver, for a host whose live scene can be replaced
 * underneath it (edit mode reads `store.scene`, which a design-time adoption
 * swaps). A resolver returning `null` is an honest "nothing is mounted" —
 * the hierarchy is empty, never fabricated.
 */
export type ThreeSceneRef = THREE.Scene | (() => THREE.Scene | null);

export interface ThreeAuthoringOptions {
  /** How nodes are addressed. See `../projection/three.ts`. */
  readonly identity: ThreeIdentity;
  /**
   * The UNDO axis — whose journal this mount's live edits belong to. Required
   * because the answer differs per lane and there is no safe default:
   * `authoringJournal` for a held world whose subject outlives every remount,
   * `playJournal` for a run that ends on ■. See the ownership block in
   * `history/json-history-resource.ts`.
   */
  readonly journal: JournalSubject;
  /**
   * Where a closed gesture's value goes. ABSENT ⇒ nowhere: the edit lives on
   * the running object, nothing is journaled, and the host injects an ephemeral
   * persistence provider over the adapter.
   */
  readonly persistence?: SourcePersistenceBackend | undefined;
  /** Source provenance can be read even when live edits cannot persist. */
  readonly sourceAnchor?: SourcePersistenceBackend['anchor'];
  /** The explicit Play→source door. It is never consulted by begin/apply/end,
   * so providing it cannot make an ordinary Play gesture persistent. */
  readonly sourceCommit?: OidTransformSourceCommitter | undefined;
  /** Freeze/thaw the world's own loop for the duration of a gesture. */
  readonly loop?: ThreeLoopControl | undefined;
  /**
   * Who can stop the frame an edit lands in.
   *  - `'adapter'` (default) — this surface freezes the frame itself for the
   *    gesture (`loop`), or is not host-ticked at all, so an edit is stable
   *    where it lands.
   *  - `'host'` — the host's play loop owns the tick and this adapter cannot
   *    pause it, so a transform edit made while playing is overwritten before
   *    it can be seen. The honest answer is to say so and refuse.
   *
   * The default (`'adapter'`) is the PERMISSIVE, non-refusing value, so this
   * axis fails OPEN: a host-ticked mount that omits `frameControl: 'host'`
   * silently lets a mid-play edit be overwritten instead of refusing. The two
   * shipped mounts set it correctly by their tick-ownership fact
   * (`structuralThree` holds its own `loop`; `oidThree` sets `'host'`),
   * so a NEW mount shape must set this explicitly from the same fact.
   */
  readonly frameControl?: 'adapter' | 'host';
  /** What the shell reports about where this surface came from. */
  readonly provenance?: AuthoringProvenance;
  /**
   * Whether this world's own SOURCE can declare portable CSF — i.e. whether
   * asking the project's story registry for a component's stories is answering
   * about this world at all.
   *
   * `false` (the default) is the honest answer for a world adopted out of a
   * running game whose source the editor never reached: there is nowhere to
   * declare a story and no registry may stand in for one, so the provider is
   * ABSENT rather than empty (see the absent-column note on the class).
   *
   * `true` is set by exactly the lane whose premise is the opposite — a world
   * whose source the serve-time OID transform DID reach
   * ({@link oidSourceThree}). There the component a node came from is
   * named on the node itself (`typeLabel`), the source it came from is a real
   * file, and a `*.stories.tsx` colocated with it is discovered like any
   * other. Association still runs through portable CSF and nothing else.
   */
  readonly sourceDeclaresStories?: boolean;
}

const LIVE_PROVENANCE: AuthoringProvenance = {
  source: 'live',
  label: 'live',
  detail:
    'Running objects adopted from the live scene. Edits affect this session only ' +
    'and are discarded when play stops.',
};

/**
 * What `editability` says about a node in a world whose frame the adapter
 * cannot stop, when no body claims the pose. The edit lands — it just has no
 * defence against the game's own code writing the same values next frame, and
 * saying so is the whole point of the reason channel.
 */
export const LIVE_FRAME_REASON =
  'Applied to the running world; code that drives this transform each frame may overwrite it.';

const CAPTURED_PROVENANCE: AuthoringProvenance = {
  source: 'foreign',
  label: 'live-only',
  detail:
    'Unmodified ingested game — edits apply to the running game for this session only and are never saved.',
};

/** An ingested game the serve-time OID transform reached: its own JSX is the
 *  destination, so this is NOT the live-only badge above. */
const STAMPED_INGEST_PROVENANCE: AuthoringProvenance = {
  source: 'foreign',
  label: 'game source',
  detail:
    "Ingested game whose own source carries the editor's authoring stamps — a literal JSX prop " +
    'writes back to the game’s own file (expression-bound props stay read-only).',
};

/** The object as a Light (intensity + color), if it is one. */
function lightOf(object: THREE.Object3D): THREE.Light | null {
  return (object as THREE.Object3D & { isLight?: boolean }).isLight
    ? (object as THREE.Light)
    : null;
}

function rangedLightOf(object: THREE.Object3D): THREE.PointLight | THREE.SpotLight | null {
  const light = object as (THREE.PointLight | THREE.SpotLight) & {
    isPointLight?: boolean;
    isSpotLight?: boolean;
  };
  return light.isPointLight || light.isSpotLight ? light : null;
}

function shadowCastingLightOf(object: THREE.Object3D): THREE.Light | null {
  const light = object as THREE.Light & {
    isDirectionalLight?: boolean;
    isPointLight?: boolean;
    isSpotLight?: boolean;
  };
  return light.isDirectionalLight || light.isPointLight || light.isSpotLight ? light : null;
}

/** The object as a PerspectiveCamera (fov/near/far), if it is one. */
function perspectiveCameraOf(object: THREE.Object3D): THREE.PerspectiveCamera | null {
  const camera = object as THREE.PerspectiveCamera & { isPerspectiveCamera?: boolean };
  return camera.isPerspectiveCamera ? camera : null;
}

/** The object's mesh geometry, if it is a mesh. */
function geometryOf(object: THREE.Object3D): THREE.BufferGeometry | null {
  const mesh = object as THREE.Mesh & { isMesh?: boolean };
  return mesh.isMesh && mesh.geometry ? mesh.geometry : null;
}

export class ThreeAuthoringAdapter implements AuthoringAdapter {
  private sceneRef: ThreeSceneRef;
  /** The shared three projector — this adapter's ONE source of nodes, ids,
   *  the object index and picking. It never walks the graph itself. */
  private readonly projector: ThreeProjector;
  /** Objects carrying the live graph's structural event listeners. A running
   * world can commit its authored subtree after this adapter is installed; the
   * hierarchy panel needs a change signal when that happens, not merely a
   * fresh walk the next time some unrelated render occurs. */
  private readonly watchedForStructure = new Set<THREE.Object3D>();
  private readonly changedStructureRoots = new Set<THREE.Object3D>();
  private structureRefreshQueued = false;
  private disposed = false;
  private crossSurfaceStructureRevision = 0;
  private hasCrossSurfaceStructure = false;

  private readonly identity: ThreeIdentity;
  private readonly persist: SourcePersistenceBackend | null;
  private readonly loop: ThreeLoopControl | undefined;
  private readonly frameControl: 'adapter' | 'host';
  private readonly instanceLiterals = new Map<string, Record<string, CreationSiteLiteralReport>>();
  private readonly instanceLiteralRequests = new Map<
    string,
    Promise<Record<string, CreationSiteLiteralReport>>
  >();

  /**
   * The `freeze → commit → unfreeze` protocol over the bodies a world marked on
   * its own nodes (`@volter/threejs-runtime/adapter/body-marks`), for the worlds that register
   * no `SystemAdapters.physics`.
   *
   * The SAME four verbs and the SAME implementation the registered seam uses —
   * `createRapierBodyEditing` is that function, factored out for exactly this
   * reason — differing only in where `bodyFor` looks. Every method is a no-op
   * for an unmarked node, which is why the calls below stand beside
   * `getActivePhysics()`'s unconditionally instead of behind a precedence rule:
   * a node cannot be answered by both, because a world that has a registered
   * adapter has no reason to mark, and a world that marks has no adapter.
   */
  private readonly markedBodies = createRapierBodyEditing((id) => {
    const object = this.objectOf(id);
    if (!object) return { kind: 'unresolved' } as const;
    const body = bodyOwningNode(object);
    return body ? ({ kind: 'body', body } as const) : ({ kind: 'no-body' } as const);
  });

  /**
   * Rigidbody ownership is a property of the mounted native object. Hierarchy
   * rows ask the three transform channels independently, so without this cache
   * one visible row repeats the physics adapter's scene snapshot three times
   * on every structural notification (including every spawned projectile).
   * A Play/Stop remount constructs a new adapter and a newly spawned object is
   * a new WeakMap key. `unresolved` is deliberately never cached: a provider
   * that has not indexed this id yet must get another chance on the next read.
   */
  private readonly bodyOwnershipByObject = new WeakMap<THREE.Object3D, boolean>();

  /**
   * The registered physics adapter, but ONLY when it recognizes this node.
   *
   * Its `freeze`/`commit`/`unfreeze` now REFUSE an id they cannot resolve
   * rather than returning as if the write landed, and `getActivePhysics()` is
   * GAME-scoped while this adapter edits nodes root by root — so a game whose
   * physics lives in one root is routinely asked about nodes in another.
   * Asking first is the caller's job; `pixi-live-write-target.ts` already
   * gates its three calls the same way.
   */
  private physicsFor(id: string): PhysicsAdapter | null {
    const physics = getActivePhysics();
    return physics && physics.ownerOf(id) !== 'unresolved' ? physics : null;
  }

  /** This session's edits, keyed by node id. In-memory only. */
  private edits: Record<string, ThreeEdit> = {};
  private readonly historyResource: JsonHistoryResource<ThreeHistoryState> | null;
  private editStartState: ThreeHistoryState | undefined;
  /** The channel values a gizmo gesture started from — see `transforms.apply`. */
  private editBaseline: Record<string, ChannelValue> | undefined;

  // A running world's structure belongs to its source, not to a document this
  // adapter could write: no `structure` provider, and `persist: false` — a
  // creation-site write goes straight to the world's own file at the moment of
  // the gesture rather than accumulating in a buffer this could flush.
  //
  // THE REST OF THE ABSENT COLUMN, so a reader never has to guess whether a
  // missing provider is a decision or an oversight. These are facts about THIS
  // ADAPTER CLASS — true for every world it is pointed at, never per-game:
  //
  //  - `rects` / `boxEdit` / `text` / `colorSample` — DOM concepts. A rect is a
  //    screen box, a box-edit writes CSS/layout, in-place text writes a DOM text
  //    node, and the eyedropper fallback walks a CSS `background-color` chain. An
  //    `Object3D` has none of the four; its spatial seam is `transforms` above.
  //  - `assetSubject` — `AuthoringAssetSubject` admits exactly one shape today
  //    (`kind: 'image'`, `mediaType: 'image/svg+xml'`: an inline SVG whose bytes
  //    are embedded in a source document). A scene-graph node has no such
  //    representation, so answering here would mean widening the type first.
  //  - `stories` — CONDITIONAL, and the one entry here that is not a fact about
  //    every world this class is pointed at. A story is declared in a PROJECT's
  //    own portable CSF source ("Association is derived from portable CSF
  //    source, never an editor-private label or registry", ARCHITECTURE-CORE
  //    §Roots), so the question is whether THIS world's source can carry one.
  //    A world adopted out of a running game the editor never reached cannot:
  //    absent, and no registry stands in for it. A world whose source the
  //    serve-time OID transform DID reach can, and does — `oidSourceThree`
  //    sets `sourceDeclaresStories`, and `stories` is then the ordinary
  //    project-story provider joined on the component name the stamp already
  //    puts on the node (`toEditorNode`'s `typeLabel`). See `this.stories`.
  //  - `assetDrop` — this adapter has NO live-insert seam, and three separate
  //    pieces would have to exist before one could be honest: (1) ids here are
  //    minted from STRUCTURAL PATHS (`../projection/three.ts`), so inserting a
  //    node re-indexes its siblings and silently re-targets `this.edits`, which is
  //    keyed by those ids; (2) `captureHistoryState`/`restoreHistoryState` below
  //    carry property values for objects the walk already found and have no
  //    add/remove vocabulary, so a drop could not be undone; (3) an inserted node
  //    has no creation site, which `truth` is contracted to answer for
  //    every id. Building it is a HOST work order against those three, not a
  //    per-mount shim.
  readonly capabilities: AuthoringCapabilities = {
    transform: true,
    inspectorFields: true,
    persist: false,
  };

  /** Portable CSF states for this world's component nodes — present only when
   *  the world's own source can declare them (`sourceDeclaresStories`; see the
   *  absent-column note above). The same BINDING the R3F source lane uses
   *  (`component-states-registry.ts`, over whichever package registered a
   *  source of component states): this adapter contributes the component
   *  IDENTITY (`typeLabel`, minted from the OID stamp) and nothing else. */
  readonly stories?: StoriesProvider;

  /** Construction-site defaults projected as native component instances.
   * Present only when the backend can read the game's source. */
  readonly instances?: ComponentInstancesProvider;

  readonly provenance: AuthoringProvenance;

  /**
   * Present only when this surface has a persistence backend at all — ABSENT is
   * the honest report for a play adoption, over which the host injects
   * `createEphemeralPersistence` instead.
   *
   * There is no DOCUMENT to save either way: `isDirty()` is always false and
   * `save()` has nothing to flush, because a creation-site write goes straight
   * to the world's own file at the moment of the gesture rather than
   * accumulating in a buffer. `applyExternal` stays absent — there is no
   * persisted artifact of OURS for a file-watcher to hand back.
   *
   * `destination` is a GETTER because the answer moves within a session:
   * holding or releasing the world changes what an edit MEANS, and a string
   * frozen at construction would keep naming the wrong place. It is the one-line
   * answer
   * to "where do edits go"; per-OBJECT honesty is finer-grained than a provider
   * can be and lives on `transforms.editability` instead.
   */
  readonly persistence?: PersistenceProvider;

  constructor(
    private readonly store: EditorShellStore,
    scene: ThreeSceneRef,
    readonly options: ThreeAuthoringOptions,
  ) {
    this.sceneRef = scene;
    this.identity = options.identity;
    // `'projection'`: this surface's objects are not necessarily the shell's —
    // a play adoption and a design session can have different scenes mounted,
    // and a raycast over `store.objectMap` would answer for the wrong one.
    this.projector = new ThreeProjector(this.identity, { pickScope: 'projection' });
    this.persist = options.persistence ?? null;
    this.loop = options.loop;
    this.frameControl = options.frameControl ?? 'adapter';
    this.provenance = options.provenance ?? LIVE_PROVENANCE;
    if (options.sourceCommit) {
      const sourceCommit: TransformSourceCommitProvider = {
        availability: (id) => options.sourceCommit!.availability(authoringOidOf(this.objectOf(id))),
        commit: async (id) => {
          const object = this.objectOf(id);
          const values = this.captureChannelBaseline(id) ?? {};
          const ack = await options.sourceCommit!.commit(authoringOidOf(object), values);
          if (ack.persisted) this.store.notifyIngestEdit();
          return ack;
        },
      };
      Object.assign(this.transforms, { sourceCommit });
    }
    if (options.sourceDeclaresStories) {
      // Only a COMPONENT node has a portable-CSF identity to join on; a plain
      // scene object honestly returns none. `typeLabel` is the component name
      // the OID stamp put there (`toEditorNode`), which is exactly what
      // `meta.component` names.
      this.stories = componentStatesProvider('three', store, (nodeId) => {
        const node = this.hierarchy.node(nodeId);
        if (node?.role !== 'component') return null;
        return { name: node.typeLabel ?? node.label };
      });
    }
    this.refresh();
    this.watchStructure();
    // The session journal exists exactly where a destination does. A surface
    // with no backend has nothing to restore INTO and must not push undo
    // entries; one with a backend needs them, because
    // a running world does not re-derive its scene from source and undoing only
    // a file would leave the world showing the edit it just undid.
    const history = store.projectHistory;
    this.historyResource =
      this.persist && history
        ? new JsonHistoryResource({
            history,
            kind: 'session-state',
            scope: 'session',
            // The SUBJECT's session, not this mount's — see the ownership block
            // in `history/json-history-resource.ts`.
            subject: { ...options.journal, id: `${options.journal.id}/live-three-edits` },
            displayName: 'Live edits',
            capture: () => this.captureHistoryState(),
            // The snapshot carries a mirror of every live Object3D (the restore
            // payload), but this is a RUNNING world that animates its own
            // objects every frame — so the full snapshot stops matching a frame
            // after it is taken. Only the EDIT RECORD is this resource's real
            // content (only editor edits touch it), so it alone decides "did
            // something else change this resource?". Without this, every
            // transaction failed preflight with `content-conflict` and undo
            // silently did nothing (issue #81).
            conflictIdentity: (state) => state.edits,
            restore: async (state) => {
              this.restoreHistoryState(state);
            },
          })
        : null;
    const backend = this.persist;
    if (backend) {
      backend.attach({
        read: (id, property) => this.readChannel(id, property),
        apply: (id, property, value) => this.applyChannel(id, property, value),
      });
      this.persistence = {
        ...createEphemeralPersistence(),
        get destination() {
          return backend.destination();
        },
      };
      if (backend.readSiteLiterals) this.instances = this.creationSiteInstances(backend);
    }
  }

  private get scene(): THREE.Scene | null {
    return typeof this.sceneRef === 'function' ? this.sceneRef() : this.sceneRef;
  }

  /**
   * Re-walk the live graph. Called for adoption/remount/stream-settled triggers;
   * live OID child mutations take the incremental path below. The
   * stats are a fresh measurement, never a mount-time snapshot: a world keeps
   * streaming objects in long after its first frame.
   */
  refresh(): ThreeWalkStats {
    const stats = this.projector.project(this.scene);
    this.refreshCrossSurfacePresence();
    this.crossSurfaceStructureRevision++;
    return stats;
  }

  /** Cheap semantic-join input for `CompositeAuthoringAdapter`.
   * Runtime-only children (for example cloned Unity projectiles) change the
   * ordinary hierarchy but not this revision, so cross-surface joining can
   * reuse its existing edges without walking this whole world. */
  private crossSurfaceStructureSignature(): string | null {
    return this.hasCrossSurfaceStructure ? String(this.crossSurfaceStructureRevision) : null;
  }

  private objectCarriesCrossSurfaceStructure(object: THREE.Object3D): boolean {
    return (
      getUserData(object, 'authoringHierarchyId') !== undefined ||
      getUserData(object, 'authoringHierarchyParentId') !== undefined ||
      getUserData(object, 'authoringHierarchyOrder') !== undefined
    );
  }

  private subtreeCarriesCrossSurfaceStructure(root: THREE.Object3D): boolean {
    let found = false;
    root.traverse((object) => {
      if (this.objectCarriesCrossSurfaceStructure(object)) found = true;
    });
    return found;
  }

  private refreshCrossSurfacePresence(): void {
    this.hasCrossSurfaceStructure = false;
    for (const node of this.projector.nodes.values()) {
      if (!this.objectCarriesCrossSurfaceStructure(node.object)) continue;
      this.hasCrossSurfaceStructure = true;
      return;
    }
  }

  private readonly onStructureChanged = (event: { child: THREE.Object3D }): void => {
    if (isEditorOwnedObject(event.child) || this.disposed) return;
    this.changedStructureRoots.add(event.child);
    if (this.structureRefreshQueued) return;
    this.structureRefreshQueued = true;
    queueMicrotask(() => {
      this.structureRefreshQueued = false;
      if (this.disposed) return;
      const changed = [...this.changedStructureRoots];
      this.changedStructureRoots.clear();
      const crossSurfaceChanged = changed.some((root) =>
        this.subtreeCarriesCrossSurfaceStructure(root),
      );
      for (const root of changed) this.unwatchStructureSubtree(root);
      const delta = this.projector.projectSubtrees(this.scene, changed);
      if (delta === null) {
        this.refresh();
        this.watchStructure();
      } else {
        for (const root of changed) {
          if (this.structureRootIsAttached(root)) this.watchStructureSubtree(root);
        }
      }
      if (crossSurfaceChanged) {
        this.refreshCrossSurfacePresence();
        this.crossSurfaceStructureRevision++;
      }
      this.syncAdoptedObjectMap(delta ?? undefined);
      this.store.notifyIngestObjectMapEdit(
        delta === null
          ? undefined
          : {
              changedParentIds: delta.changedParentIds,
              rootsChanged: delta.rootsChanged,
              addedIds: delta.addedIds,
              removedIds: delta.removedIds,
            },
      );
    });
  };

  /** Watch the whole native graph, including transparent implementation
   * wrappers that are not projection rows: authored children can be mounted
   * beneath either kind of parent. One refresh per synchronous commit burst
   * then reattaches listeners to the newly discovered subtree. */
  private watchStructure(): void {
    for (const object of this.watchedForStructure) {
      object.removeEventListener('childadded', this.onStructureChanged);
      object.removeEventListener('childremoved', this.onStructureChanged);
    }
    this.watchedForStructure.clear();
    const scene = this.scene;
    if (!scene) return;
    this.watchStructureSubtree(scene);
  }

  private watchStructureSubtree(root: THREE.Object3D): void {
    const visit = (object: THREE.Object3D): void => {
      if (isEditorOwnedObject(object) || this.watchedForStructure.has(object)) return;
      object.addEventListener('childadded', this.onStructureChanged);
      object.addEventListener('childremoved', this.onStructureChanged);
      this.watchedForStructure.add(object);
      for (const child of object.children) visit(child);
    };
    visit(root);
  }

  private structureRootIsAttached(root: THREE.Object3D): boolean {
    const scene = this.scene;
    if (scene === null) return false;
    for (let current: THREE.Object3D | null = root; current !== null; current = current.parent) {
      if (current === scene) return true;
    }
    return false;
  }

  private unwatchStructureSubtree(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!this.watchedForStructure.delete(object)) return;
      object.removeEventListener('childadded', this.onStructureChanged);
      object.removeEventListener('childremoved', this.onStructureChanged);
    });
  }

  /** Keep the store's adopted scene index in step with the projector so a
   * late row is selectable immediately, not only visible in hierarchy. */
  private syncAdoptedObjectMap(delta?: ThreeProjectionDelta): void {
    const scene = this.scene;
    if (!scene || this.store.scene !== scene) return;
    const map = this.store.objectMap;
    if (delta === undefined) {
      map.clear();
      for (const [id, object] of this.projector.objectMapSnapshot()) map.set(id, object);
    } else {
      for (const id of delta.removedIds) map.delete(id);
      for (const id of delta.addedIds) {
        const object = this.projector.objectOf(id);
        if (object !== null) map.set(id, object);
      }
    }
    const retainedSelection = [...this.store.selectedEntityIds].filter((id) => map.has(id));
    if (retainedSelection.length !== this.store.selectedEntityIds.size) {
      this.store.selectMultiple(retainedSelection);
    }
  }

  /** Re-walk without reading the stats (host remount/adoption triggers). */
  invalidate(): void {
    this.refresh();
  }

  /** Rebind to a freshly mounted scene (HMR remount / re-adoption). */
  adoptScene(scene: ThreeSceneRef): void {
    this.sceneRef = scene;
    this.refresh();
    this.watchStructure();
    this.syncAdoptedObjectMap();
  }

  private objectOf(id: string): THREE.Object3D | null {
    return this.projector.objectOf(id);
  }

  /** Current projection for the shell viewport's native-object index. */
  objectMapSnapshot(): Map<string, THREE.Object3D> {
    return this.projector.objectMapSnapshot();
  }

  private record(id: string, patch: ThreeEdit): void {
    this.edits[id] = { ...this.edits[id], ...patch };
  }

  private toEditorNode(node: ThreeNode): EditorNode {
    const object = node.object;
    const crossSurfaceId = getUserData(object, 'authoringHierarchyId');
    const crossSurfaceParentId = getUserData(object, 'authoringHierarchyParentId');
    const crossSurfaceOrder = getUserData(object, 'authoringHierarchyOrder');
    // The component's own label/role/type belong to the instance's ROOT ONLY.
    // Every host element inside a component definition carries that instance's
    // stamp (see `component-instance-root.ts`), so reading the stamp alone
    // printed `Stage` on `Stage`'s `WorldEnvironment`, `GridMap` and `Coins`
    // and typed all three `component`. An interior node is named by the thing
    // it IS.
    // A custom JSX tag is not necessarily a reusable component boundary. Importer runtimes use a
    // project-local component as the native ENTITY constructor (for example `<UnityNode>` creates
    // one Unity GameObject) and declare that with the existing `authoringRoot` mark. Keep it an
    // ordinary entity here. A real prefab root can carry the same mark plus `vgaiComponentRoot`;
    // the hierarchy mark projection applies that explicit component identity afterwards.
    const instanceRoot =
      isComponentInstanceRoot(object) && getUserData(object, 'authoringRoot') !== true;
    const componentName = getUserData(object, 'authoringComponent');
    const label =
      (instanceRoot ? (getUserData(object, 'authoringLabel') as string | undefined) : undefined) ||
      object.name ||
      object.type;
    return {
      id: node.id,
      label,
      role: instanceRoot ? 'component' : 'entity',
      kind: nativeKindOf(object),
      // The transformed R3F callsite carries the exact component identity
      // separately from its human label; portable CSF joins on the former.
      // Plain Three objects retain their native Object3D type.
      typeLabel: instanceRoot ? componentName || label : object.type,
      parentId: node.parentId,
      childIds: [...node.childIds],
      ...(crossSurfaceId === undefined ? {} : { crossSurfaceId }),
      ...(crossSurfaceParentId === undefined ? {} : { crossSurfaceParentId }),
      ...(crossSurfaceOrder === undefined ? {} : { crossSurfaceOrder }),
    };
  }

  readonly hierarchy: HierarchyProvider = {
    crossSurfaceStructureSignature: () => this.crossSurfaceStructureSignature(),
    roots: () => {
      // Structural childadded/childremoved events refresh the live projection
      // at the mutation boundary. A read must remain a pure indexed lookup:
      // panels and protocol consumers can read several times per render, and
      // re-walking a large imported graph here turns every gameplay frame into
      // repeated O(world-size) authoring work even when its structure is stable.
      return this.projector.rootNodes().map((node) => this.toEditorNode(node));
    },
    node: (id) => {
      const node = this.projector.node(id);
      return node ? this.toEditorNode(node) : null;
    },
    object3D: (id) => this.objectOf(id),
    idForObject3D: (object) => this.projector.idOf(object),
  };

  readonly selection: SelectionProvider = {
    get: () => [...this.store.selectedEntityIds],
    set: (ids) => this.store.selectMultiple(ids),
    // Component boundaries are closed by default: a normal pick resolves to the
    // outermost component owner, a scoped pick to the next nested one, and a
    // deep pick advances one further. Deliberately the same contract the source
    // R3F adapter states, applied to the live projection. A graph with no
    // component instances (every structural-path walk) has no chain, so this
    // resolves to the raw id and is a no-op.
    resolve: (rawId, options): SelectionResolution | null => {
      const raw = this.hierarchy.node(rawId);
      if (!raw) return null;
      const innerToOuter: EditorNode[] = [];
      let cursor: EditorNode | null = raw;
      let guard = 0;
      while (cursor && guard++ < 1000) {
        if (cursor.role === 'component' || cursor.role === 'instance') innerToOuter.push(cursor);
        cursor = cursor.parentId ? this.hierarchy.node(cursor.parentId) : null;
      }
      const chain = innerToOuter.reverse();
      if (chain.length === 0) return { id: rawId };
      const scopeIndex = options?.scopeId
        ? chain.findIndex((candidate) => candidate.id === options.scopeId)
        : -1;
      const normalIndex = scopeIndex >= 0 ? Math.min(scopeIndex + 1, chain.length - 1) : 0;
      const resolvedIndex =
        options?.intent === 'deep' ? Math.min(normalIndex + 1, chain.length - 1) : normalIndex;
      return { id: chain[resolvedIndex]!.id };
    },
  };

  /** The projector's raycast over this adapter's own projection. */
  readonly pickable: PickProvider = {
    pick: (clientX, clientY) => {
      this.refresh();
      return this.projector.pick(this.store, clientX, clientY);
    },
    candidates: (clientX, clientY) => {
      this.refresh();
      return this.projector.candidates(this.store, clientX, clientY);
    },
  };

  /**
   * The creation-site read surface. The index itself is a host-side
   * `WeakMap` keyed by the live object (`creation-site-registry.ts`); this
   * provider is only the id→object hop, so a running world is never asked
   * anything and never observes that it was indexed.
   */
  readonly truth: TruthProvider = {
    // The READ surface answers with the same anchor the write path would use,
    // so the inspector never shows a source line for an object whose truth is a
    // level-data record. `position` is the property whose owner is the object
    // itself, which is the hop this provider's id→object read already makes.
    resolve: (id, property) => {
      const subject = this.anchorFor(id, property);
      return { site: subject.anchor, writeAnchorKind: subject.anchorKind };
    },
  };

  /** Derived from the SAME anchor index {@link truth} answers from — the
   *  shared kit piece (`creation-site-related.ts`); this adapter contributes
   *  only its id→site hop. */
  readonly related: RelatedSubjectsProvider = creationSiteRelated(
    (id) => this.truth.resolve(id, 'position').site,
  );

  readonly transforms: TransformProvider = {
    get: (id): Transform => readLocalTransform(this.objectOf(id)),
    /**
     * Every branch names a reason; none is silent. The refusals are surface
     * facts in order of severity — there is no node, someone else holds
     * authority — and the accepting branch cites what will actually happen to
     * the gesture: persisted, routed to the owning body, or live-only.
     *
     * WHY A RUNNING FRAME IS NOT A REFUSAL. This used to answer
     * `writable: false, 'Pause Play mode before editing live transforms.'` for
     * EVERY node whenever `frameControl === 'host'` and the game was playing —
     * which is every node of every adopted play mount (`oidThree` sets
     * exactly that). Because `editor-viewport.ts` gates the gizmo's `attach` on
     * this answer, the consequence was that play mode had no transform gizmo at
     * all: selecting the player in a running game offered no way to move it,
     * which is the opposite of what adopting the live scene is for.
     *
     * The refusal was reaching for the wrong invariant. What must be true is
     * not "the frame is stopped" — it is "the edit lands on whatever WRITES
     * this pose", and for a body-driven node that is now true while the frame
     * runs (`markedBodies` / `SystemAdapters.physics` below teleport the body,
     * and the next step puts the result back on the node). For a node nothing
     * else writes, setting the node was always the whole edit. What remains is
     * the third case — a pose the game's own per-frame code rewrites — and
     * there the honest answer is the one this seam exists to give: writable,
     * with a reason that says the running game may write it again. A refusal
     * that also blanked the two cases that DO work bought that honesty far too
     * dearly.
     */
    editability: (id: string, channel: TransformChannel): TransformEditability => {
      if (!this.objectOf(id)) return { writable: false, reason: NO_OBJECT_REASON };
      const networking = getActiveNetworking();
      if (networking?.networkId(id) && !networking.editable(id)) {
        return {
          writable: false,
          reason: 'This transform is controlled by remote or server network authority.',
        };
      }
      if (this.bodyOwns(id)) {
        return {
          writable: true,
          reason: 'Moves the physics body that owns this node.',
          ...this.removableFlag(id, channel),
        };
      }
      if (this.frameControl === 'host' && this.store.playState === 'playing') {
        return { writable: true, reason: LIVE_FRAME_REASON, ...this.removableFlag(id, channel) };
      }
      if (!this.persist) return { writable: true };
      return {
        writable: true,
        reason: this.persist.describe(this.anchorFor(id, channel)),
        ...this.removableFlag(id, channel),
      };
    },
    // The world owns this object's transform; freeze whatever drives it so the
    // gizmo edit isn't overwritten next frame, then thaw on release.
    beginEdit: (id) => {
      this.historyResource?.assertCanMutate();
      if (!this.objectOf(id) || !this.editableByNetwork(id)) return;
      this.loop?.pause();
      this.physicsFor(id)?.freeze(id);
      this.markedBodies.freeze(id);
      this.editStartState = this.persist ? this.captureHistoryState() : undefined;
      this.editBaseline = undefined;
    },
    apply: (id, transform) => {
      const object = this.objectOf(id);
      if (!object || !this.editableByNetwork(id)) return;
      // The gesture's baseline is captured on its FIRST frame, not in
      // `beginEdit` — that hook is not told which object is being dragged, and
      // the baseline has to be the value the user started from for the
      // creation-site planner's equality check to mean anything.
      if (this.persist && !this.editBaseline) this.editBaseline = this.captureChannelBaseline(id);
      this.writeTransform(id, transform);
      // Commit the pose to the owning body so the running simulation tracks it
      // instead of overwriting the edit on the next step.
      //
      // WHY EVERY FRAME OF THE DRAG, rather than suspending the world's
      // body→node sync for the dragged node and teleporting once on release.
      // Both stop the fight; only this one keeps the picture honest. A
      // suspended sync shows the node where the pointer is while the simulation
      // still has it somewhere else, so the drop is where the two RECONCILE
      // rather than where the object was drawn — and a body that never moved
      // during the drag arrives at release with a step of accumulated
      // divergence (velocity, contacts, a character controller's own motion)
      // that resolves as a visible jump. Teleporting continuously means the
      // pose on screen is the pose the simulation has, at every frame of the
      // gesture and at the moment of release; it also needs no suspend/restore
      // state to leak if a drag is interrupted, and it works for a frame the
      // adapter cannot pause, which is the whole play-mode case.
      this.physicsFor(id)?.commit(id, transform);
      this.markedBodies.commit(id, transform);
      this.store.notifyIngestEdit();
    },
    endEdit: (id) => {
      this.loop?.resume();
      const object = this.objectOf(id);
      const label = `Transform ${object?.name || 'Object'}`;
      const before = this.editStartState;
      const baseline = this.editBaseline;
      this.editStartState = undefined;
      this.editBaseline = undefined;
      if (object) {
        this.physicsFor(id)?.unfreeze(id);
        this.markedBodies.unfreeze(id);
        this.store.notifyIngestEdit();
      }
      // The gesture's own ack — awaited by whoever closed it, so a caller that
      // has the ack has the byte. `undefined` when this surface has no backend
      // at all, which is the honest "this adapter performed no write".
      return this.persist ? this.persistOrJournal(id, label, before, baseline) : undefined;
    },
    /**
     * DROP THE CHANNEL'S AUTHORED ATTRIBUTE — the same door the first-party R3F
     * lane grew in #2218, on the lane that has the same appended-attribute
     * shape: `pipedWrite` sends `addIfMissing`, so placing an ingested game's
     * object whose callsite carried no `position` ADDS one, and writing the old
     * numbers back leaves it standing. The file is then a byte away from where
     * it started forever, and an edit/revert round trip over a lane whose
     * writes are entirely healthy grades UNVERIFIABLE.
     *
     * Through the SAME pipe every other edit here takes, resolving on the
     * REMOVAL verb rather than the write: a backend with no removal door
     * (`SourceRemovalDoor`, `source-persistence-backend.ts`) reaches the
     * live-only floor by name instead of acking a destination no byte left.
     * Both shipped backends now carry one — the OID lane's `removeProp` and
     * the creation-site lane's own-line-assignment delete
     * (`planCreationSiteRemoval`) — so the floor remains only for subjects
     * whose door is shut. Absent backend ⇒ no ack at all,
     * which is this adapter's honest "performed no write" (the play-mode
     * adoption's case, where `createEphemeralPersistence` is injected over it).
     */
    remove: (id, channel) => {
      if (!this.persist?.removal) return;
      return runWritePipe(this.pipedRemove(id, channel));
    },
  };

  /**
   * `TransformEditability.removable` for one channel — present only when this
   * surface's backend declares a removal door AND that door is open for THIS
   * subject. Both are read from the backend rather than inferred here: the
   * adapter knows the subject, the backend knows the dialect.
   *
   * Spread into the answer (`...`) rather than assigned, so a channel with no
   * door OMITS the key — `compose.ts` reads `removable === true`, and an
   * explicit `false` would be a third state nothing distinguishes.
   */
  private removableFlag(id: string, channel: TransformChannel): { removable?: true } {
    const removal = this.persist?.removal;
    if (!removal) return {};
    return removal.available(this.anchorFor(id, channel)) ? { removable: true } : {};
  }

  /**
   * THIS ADAPTER'S REMOVAL PLUG INTO THE PIPE — `resolve → remove → record`.
   *
   * The resolution asks the door, not the write gate: a subject whose write is
   * fine can still have nowhere to express absence, and the two answers are
   * produced by different code (`SourceRemovalDoor.available` vs `gate`). The
   * `live-only` lane check stays for the same structural reason `pipedWrite`
   * keeps it — a subject the adapter classified `live-only` must not reach a
   * dialect writer even if a gate waved it through.
   *
   * NOTHING IS RECORDED IN THE SESSION JOURNAL, and nothing re-poses the live
   * object. There is no live half to journal: a removal changes the FILE, and
   * the value in force once the attribute is gone is whatever the component's
   * own signature declares — which only the world's re-derive can report, and
   * a fiber world does re-derive. The undo is the backend's own project-source
   * transaction (`withProjectSourceHistory` wraps `removeProp`), so a journal
   * entry here would make one removal two undos, one of which restores
   * nothing.
   */
  private pipedRemove(id: string, channel: TransformChannel): PipedWrite {
    const backend = this.persist!;
    const removal = backend.removal!;
    const label = `Remove ${this.objectOf(id)?.name || 'Object'} ${channel}`;
    return {
      resolve: (): WriteResolution => {
        const subject = this.anchorFor(id, channel);
        if (!removal.available(subject)) return resolvesLiveOnly(backend.describe(subject));
        if (subject.anchorKind === 'live-only') return resolvesLiveOnly(backend.describe(subject));
        return {
          reaches: 'writer',
          anchorKind: subject.anchorKind,
          destination: backend.destination(),
          write: () => removal.perform({ ...subject, label }),
        };
      },
      record: () => {},
      report: (reason) => {
        if (backend.armed()) backend.report(label, reason);
      },
    };
  }

  /** True when a rigid body writes this node's pose — either the game's
   *  registered `SystemAdapters.physics` says so, or the node carries the
   *  body mark. Both are the same question asked of the two places a world can
   *  have answered it. */
  private bodyOwns(id: string): boolean {
    const object = this.objectOf(id);
    if (!object) return false;
    const cached = this.bodyOwnershipByObject.get(object);
    if (cached !== undefined) return cached;

    const owner = getActivePhysics()?.ownerOf(id);
    if (owner === 'physics') {
      this.bodyOwnershipByObject.set(object, true);
      return true;
    }
    const marked = bodyOwningNode(object) !== undefined;
    if (marked || owner === 'editor') this.bodyOwnershipByObject.set(object, marked);
    return marked;
  }

  /** False when the active networking adapter marks the node inspect-only.
   *  Keyed by node id since P-4 — the seam no longer speaks `Object3D`. */
  private editableByNetwork(id: string): boolean {
    const networking = getActiveNetworking();
    return networking ? networking.editable(id) : true;
  }

  readonly inspector: InspectorProvider = {
    // Reflected from the live object — no schema, no fabricated properties.
    // `name`/`visible` are the seam's reserved paths (the hierarchy rename
    // field and eye toggle render against them for any adapter reporting them).
    // Physics/Animation are absent because a live object carries no engine
    // body/anim-graph to reflect — that is honest absence, not a gap.
    properties: (id): PropertyDescriptor[] => {
      const object = this.objectOf(id);
      if (!object) return [];
      const properties: PropertyDescriptor[] = [
        { path: 'name', label: 'Name', type: 'string' },
        { path: 'visible', label: 'Visible', type: 'boolean' },
        { path: 'object.type', label: 'Native type', type: 'string', readonly: true },
      ];
      const authoringSubject = object3DAuthoringSubjectOf(object);
      if (authoringSubject?.fields) {
        properties.push(
          ...authoringSubject
            .fields()
            .filter((field) => !['name', 'visible'].includes(field.path))
            .map(({ value: _value, ...descriptor }) => descriptor),
        );
      }
      if (colorMaterialOf(object)) {
        properties.push({
          path: 'material.color',
          label: 'Color',
          type: 'color',
          group: 'Material',
        });
      }
      const light = lightOf(object);
      if (light) {
        properties.push({ path: 'light.intensity', label: 'Intensity', type: 'number' });
        properties.push({ path: 'light.color', label: 'Light Color', type: 'color' });
        if (rangedLightOf(object)) {
          properties.push({ path: 'light.distance', label: 'Distance', type: 'number' });
        }
        if (shadowCastingLightOf(object)) {
          properties.push({ path: 'shadow.cast', label: 'Cast Shadow', type: 'boolean' });
        }
      }
      if (perspectiveCameraOf(object)) {
        properties.push({ path: 'camera.fov', label: 'FOV', type: 'number' });
        properties.push({ path: 'camera.near', label: 'Near', type: 'number' });
        properties.push({ path: 'camera.far', label: 'Far', type: 'number' });
      }
      if (geometryOf(object)) {
        properties.push({
          path: 'mesh.vertices',
          label: 'Vertices',
          type: 'number',
          readonly: true,
        });
        properties.push({ path: 'shadow.cast', label: 'Cast Shadow', type: 'boolean' });
        properties.push({ path: 'shadow.receive', label: 'Receive Shadow', type: 'boolean' });
      }
      return properties;
    },
    get: (id, path) => {
      const object = this.objectOf(id);
      if (!object) return undefined;
      if (path === 'name') return object.name;
      if (path === 'visible') return object.visible;
      if (path === 'object.type') return object.type;
      const subjectField = object3DAuthoringSubjectOf(object)
        ?.fields?.()
        .find((field) => field.path === path);
      if (subjectField) return subjectField.value();
      if (path === 'material.color') {
        const material = colorMaterialOf(object);
        return material ? `#${material.color.getHexString()}` : undefined;
      }
      if (path === 'light.intensity') return lightOf(object)?.intensity;
      if (path === 'light.distance') return rangedLightOf(object)?.distance;
      if (path === 'light.color') {
        const light = lightOf(object);
        return light ? `#${light.color.getHexString()}` : undefined;
      }
      if (path === 'camera.fov') return perspectiveCameraOf(object)?.fov;
      if (path === 'camera.near') return perspectiveCameraOf(object)?.near;
      if (path === 'camera.far') return perspectiveCameraOf(object)?.far;
      if (path === 'mesh.vertices') {
        const geometry = geometryOf(object);
        return geometry ? (geometry.getAttribute('position')?.count ?? 0) : undefined;
      }
      if (path === 'shadow.cast') return object.castShadow;
      if (path === 'shadow.receive') return object.receiveShadow;
      return undefined;
    },
    set: (id, path, value) => {
      this.historyResource?.assertCanMutate();
      if (!this.persist) {
        this.writeProp(id, path, value);
        return;
      }
      const before = this.captureHistoryState();
      // Read the baseline BEFORE the write: the creation-site planner may only
      // rewrite a literal it can prove is the value currently in force, and
      // "currently" means before this gesture touched anything.
      const baseline = this.readChannel(id, path);
      this.writeProp(id, path, value);
      const label = `Set ${this.objectOf(id)?.name || 'Object'} ${path}`;
      const next = this.readChannel(id, path);
      const moved =
        baseline !== undefined &&
        next !== undefined &&
        JSON.stringify(baseline) !== JSON.stringify(next);
      // A value that did not actually move has nothing to write ANYWHERE, so it
      // never enters the pipe and this provider performed no write to answer
      // for — it still journals, because `writeProp` may have touched the live
      // object in a way the channel read cannot see.
      if (!moved) {
        this.recordHistory(label, before);
        return;
      }
      return persistChannelWrite({
        backend: this.persist!,
        subject: () => this.anchorFor(id, path),
        baseline: baseline!,
        next: next!,
        label,
        journal: () => this.recordHistory(label, before),
      });
    },
  };

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  dispose(): void {
    this.disposed = true;
    for (const object of this.watchedForStructure) {
      object.removeEventListener('childadded', this.onStructureChanged);
      object.removeEventListener('childremoved', this.onStructureChanged);
    }
    this.watchedForStructure.clear();
    this.changedStructureRoots.clear();
    this.historyResource?.dispose();
    this.persist?.dispose();
  }

  // ─────────────────────────────────────────── live channel read/write

  /** One property's value in force, in the shape the creation-site planner and
   *  its history snapshots speak. */
  private readChannel(id: string, property: string): ChannelValue | undefined {
    const object = this.objectOf(id);
    if (!object) return undefined;
    if (property === 'position') return object.position.toArray() as [number, number, number];
    if (property === 'rotation') return [object.rotation.x, object.rotation.y, object.rotation.z];
    if (property === 'scale') return object.scale.toArray() as [number, number, number];
    return this.inspector.get(id, property) as ChannelValue | undefined;
  }

  /** Put one property back on the live object — the undo/redo half of a
   *  persisted edit. Deliberately routed through the SAME writers an ordinary
   *  edit uses, so a restored value is indistinguishable from an authored one. */
  private applyChannel(id: string, property: string, value: ChannelValue): void {
    const object = this.objectOf(id);
    if (!object) return;
    if (property === 'position' && Array.isArray(value)) {
      object.position.fromArray(value as number[]);
    } else if (property === 'rotation' && Array.isArray(value)) {
      const [x, y, z] = value as number[];
      object.rotation.set(x ?? 0, y ?? 0, z ?? 0);
    } else if (property === 'scale' && Array.isArray(value)) {
      object.scale.fromArray(value as number[]);
    } else {
      this.writeProp(id, property, value);
      return;
    }
    this.store.notifyIngestEdit();
  }

  /** Write a transform to the live object + record it in the session edit map
   *  (no undo push). */
  private writeTransform(id: string, t: Transform): void {
    this.historyResource?.assertCanMutate();
    const object = this.objectOf(id);
    if (!object) return;
    object.position.set(t.position[0], t.position[1], t.position[2]);
    object.quaternion.set(t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3]);
    object.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    this.record(id, { position: t.position, rotation: t.rotation, scale: t.scale });
  }

  /** Mutate one reflectable field on the live object + record persistable ones
   *  (no undo push). */
  private writeProp(id: string, path: string, value: unknown): void {
    const object = this.objectOf(id);
    if (!object) return;
    if (path === 'name') object.name = String(value);
    else if (path === 'visible') {
      object.visible = Boolean(value);
      this.record(id, { visible: object.visible });
    } else if (path === 'material.color') {
      const material = colorMaterialOf(object);
      if (material) {
        material.color.set(String(value));
        this.record(id, { color: `#${material.color.getHexString()}` });
      }
    } else if (path === 'light.intensity') {
      const light = lightOf(object);
      if (light) light.intensity = Number(value);
    } else if (path === 'light.distance') {
      const light = rangedLightOf(object);
      if (light) light.distance = Number(value);
    } else if (path === 'light.color') {
      lightOf(object)?.color.set(String(value));
    } else if (path === 'camera.fov' || path === 'camera.near' || path === 'camera.far') {
      const camera = perspectiveCameraOf(object);
      if (camera) {
        (camera as unknown as Record<string, number>)[path.split('.')[1]!] = Number(value);
        camera.updateProjectionMatrix();
      }
    } else if (path === 'shadow.cast') object.castShadow = Boolean(value);
    else if (path === 'shadow.receive') object.receiveShadow = Boolean(value);
    this.store.notifyIngestEdit();
  }

  // ───────────────────────────────────────────── creation-site anchoring

  /**
   * The creation site an edit to `property` would have to be written at, plus
   * how many objects that site built.
   *
   * The OWNER hop is the point: a material colour lives on the material, which
   * has its own `new THREE.MeshBasicMaterial({ color: … })` somewhere else
   * entirely, so anchoring it to the MESH's line would look for a `color` that
   * line never mentions. `creation-site-edit.ts`'s channel table is what says
   * which live object owns which property.
   */
  private anchorFor(id: string, property: string): SourceWriteSubject {
    const object = this.objectOf(id);
    const channel = channelFor(property);
    const target = object && channel?.owner === 'material' ? colorMaterialOf(object) : object;
    // THE SERVE-TIME SOURCE STAMP FIRST, when the world carries one. A fiber
    // world constructs every object inside `node_modules`, so the creation-site
    // registry below answers "constructed outside project source" for all of
    // them — while the game's own JSX says exactly where each one is written,
    // and `@volter/editor-react`'s `serving/ui-oid-plugin.ts` stamped that callsite onto the object. The
    // stamped answer is the SAME KIND of fact as a `new` site (a source
    // file:line an edit can be written at), so it belongs in the same slot
    // rather than beside it.
    //
    // `instances` is 1 by construction here: the address is ONE JSX element.
    // A repeated callsite renders many objects and a literal written on it
    // moves all of them — which is what the source says, and is the same rule
    // the first-party R3F lane applies (`r3f-source-authoring-adapter.ts`'s
    // `#n` authority rule), not the `new`-expression multiplicity question the
    // creation-site backend refuses on.
    const sourceOid =
      channel?.owner === 'material'
        ? ownOidOf(target as { readonly userData?: Record<string, unknown> } | null | undefined)
        : authoringOidOf(target as THREE.Object3D | null | undefined);
    const stamped = sourceOid ? this.persist?.anchor?.(sourceOid) : null;
    if (stamped) {
      // TWO KINDS SHARE THIS BRANCH, and the difference is not visible in the
      // anchor: an ordinary JSX prop keeps the value the author wrote, while a
      // body-placed spawn is re-read by a simulation that then owns the node's
      // matrix — so only the second has to survive the re-settle. The backend
      // holds the source index that knows which, and answers here.
      const placed = sourceOid ? this.persist?.physicsPlaced?.(sourceOid, property) : false;
      return {
        entityId: id,
        property,
        anchor: stamped,
        anchorKind: placed ? 'physics-binding' : 'source-prop',
        instances: 1,
        sourceOid,
      };
    }
    // DATA NEXT, and no fallback. An object the game itself anchored to a
    // record in its own level data has NO honest source anchor: no `new`
    // expression in the game's code mentions its position, so anchoring it to
    // the line that happened to build its mesh would report a `file:line` the
    // edit could never be written at. `dataRecordAnchor` therefore answers for
    // every record-carrying object — with the write when a writer is reachable,
    // and with the reason there is none when it is not.
    const record = dataRecordIndexOf(target);
    if (record !== null) {
      return {
        entityId: id,
        property,
        anchor: dataRecordAnchor(record),
        anchorKind: 'data-record',
        instances: 1,
        ...(sourceOid ? { sourceOid } : {}),
      };
    }
    const anchor = sourceOid
      ? (this.options.sourceAnchor?.(sourceOid) ?? {
          anchored: false as const,
          reason: 'The source index has not resolved this object’s OID.',
        })
      : creationSiteAnchor(target ?? null);
    return {
      entityId: id,
      property,
      anchor,
      // THE LANE IS NOT THE ADDRESS, and this branch is where the two come
      // apart. A stamped object whose oid the client-side index has not
      // resolved has NO anchor to show — but its write still travels the
      // source-prop lane, because `writeProp` sends the OID and the SERVER
      // resolves it. That is this backend's own stated behaviour, not an
      // inference: `oid-source-persistence.ts`'s `refreshIndex` says "without
      // the index this backend still WRITES (the server resolves the oid
      // itself); it just cannot name the file:line". Classifying it `live-only`
      // would therefore grade it against the wrong contract — live-only's bar
      // is that NO byte moves, and this lane's write moves one.
      anchorKind: sourceOid
        ? this.persist?.anchor
          ? 'source-prop'
          : 'live-only'
        : anchor.anchored
          ? 'construction-literal'
          : 'live-only',
      instances:
        anchor.anchored && anchor.kind === 'source' ? (sourceOid ? 1 : instancesAtSite(anchor)) : 0,
      ...(sourceOid ? { sourceOid } : {}),
    };
  }

  /**
   * How much of THIS mount's world an edit can actually be written back to —
   * the measurement the ingest coverage report's `persistence` row needs so it
   * can stop reporting `ok` over a world where no object reaches a write path.
   *
   * A folder being writable (the server's ownership answer) says nothing about
   * whether any OBJECT in the mounted world has a source address; a fiber world
   * in a writable folder had every object unanchored, and the row said `ok`.
   * `addressable` counts the nodes whose planned anchor for a transform edit is
   * a real source/data address, which is exactly the precondition every write
   * path here starts from.
   */
  measureWriteReach(): {
    addressable: number;
    total: number;
    destination: string;
    byKind: Record<WriteAnchorKind, number>;
  } {
    this.refresh();
    let addressable = 0;
    // PER KIND, because `addressable` alone cannot say WHICH lane carries a
    // world — and "some objects reach source" is exactly the answer that let a
    // world's physics-placed cargo go unexercised while the row read healthy.
    // Derived from the same planning call, so the two can never disagree.
    const byKind = emptyWriteAnchorKindCounts();
    for (const id of this.projector.nodes.keys()) {
      const subject = this.anchorFor(id, 'position');
      byKind[subject.anchorKind]++;
      if (subject.anchor.anchored) addressable++;
    }
    return {
      addressable,
      total: this.projector.nodes.size,
      destination: this.persist?.destination() ?? LIVE_ONLY_DESTINATION,
      byKind,
    };
  }

  // ───────────────────────────────────────────── gesture close-out

  /**
   * The transform channels' values as the creation-site planner reads them.
   *
   * `rotation` is an EULER here, not the quaternion `TransformProvider` speaks:
   * source says `object.rotation.set(x, y, z)` / `object.rotation.y =`, so an
   * Euler is what a literal at a creation site actually holds. The live object
   * keeps both in sync, so reading `object.rotation` after a quaternion write is
   * reading three's own conversion rather than reimplementing it.
   */
  private captureChannelBaseline(id: string): Record<string, ChannelValue> | undefined {
    const object = this.objectOf(id);
    if (!object) return undefined;
    return {
      position: object.position.toArray() as [number, number, number],
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray() as [number, number, number],
    };
  }

  /**
   * Close out one gizmo gesture: write it into the world's own source if every
   * gate is open, and otherwise journal it live-only.
   *
   * ONE gesture becomes ONE history entry either way — the persisted path's
   * transaction carries both the file and the live value, so the live-only
   * journal is SKIPPED when it succeeds rather than added to it.
   *
   * A gesture that moved more than one channel is refused for persistence as a
   * whole rather than written channel-by-channel: a partial write would leave
   * one channel in the file and one only in the session, and one Ctrl+Z would
   * then undo half a drag. The transform gizmo's modes are exclusive, so this
   * is a soundness rule that costs nothing in practice.
   */
  private persistOrJournal(
    id: string,
    label: string,
    before: ThreeHistoryState | undefined,
    baseline: Record<string, ChannelValue> | undefined,
  ): Promise<WriteAck> | undefined {
    const backend = this.persist;
    if (!backend) return undefined;
    const after = baseline ? this.captureChannelBaseline(id) : undefined;
    const changed =
      baseline && after
        ? Object.keys(baseline).filter(
            (channel) => JSON.stringify(baseline[channel]) !== JSON.stringify(after[channel]),
          )
        : [];
    if (changed.length > 1) backend.report(label, multiChannelRefusal(changed));
    const property = changed.length === 1 ? changed[0]! : null;
    if (property === null) {
      // Nothing single-channel to write, so there is no edit for the pipe to
      // carry — but the live values still have to be undoable.
      this.recordHistory(label, before);
      return undefined;
    }
    return persistChannelWrite({
      backend,
      subject: () => this.anchorFor(id, property),
      baseline: baseline![property]!,
      next: after![property]!,
      label,
      journal: () => this.recordHistory(label, before),
    });
  }

  // ───────────────────────────── construction-site component instances

  private creationSiteKey(subject: SourceWriteSubject): string | null {
    const anchor = subject.anchor;
    return anchor.anchored && anchor.kind === 'source'
      ? `${anchor.file}:${anchor.line}:${anchor.col}`
      : null;
  }

  private instancePropertyPaths(id: string, siteKey: string): string[] {
    const candidates = [
      'position',
      'rotation',
      'scale',
      ...this.inspector
        .properties(id)
        .filter((field) => !field.readonly)
        .map((field) => field.path),
    ];
    return [...new Set(candidates)].filter(
      (property) => this.creationSiteKey(this.anchorFor(id, property)) === siteKey,
    );
  }

  private loadInstanceLiterals(
    backend: SourcePersistenceBackend,
    id: string,
    subject: SourceWriteSubject,
    key: string,
  ): Promise<Record<string, CreationSiteLiteralReport>> {
    const existing = this.instanceLiteralRequests.get(key);
    if (existing) return existing;
    const properties = this.instancePropertyPaths(id, key)
      .map((property) => ({ property, live: this.readChannel(id, property) }))
      .filter(
        (entry): entry is { property: string; live: ChannelValue } => entry.live !== undefined,
      );
    const request = backend.readSiteLiterals!({
      anchor: subject.anchor,
      instances: subject.instances,
      writeScope: 'creation-site',
      properties,
    }).then((answer) => {
      this.instanceLiterals.set(key, answer);
      this.store.notifyIngestEdit();
      return answer;
    });
    this.instanceLiteralRequests.set(key, request);
    return request;
  }

  private sameInstanceValue(a: ChannelValue, b: ChannelValue): boolean {
    if (Array.isArray(a) && Array.isArray(b)) {
      return (
        a.length === b.length &&
        a.every((value, index) => this.sameInstanceValue(value, b[index] as ChannelValue))
      );
    }
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6;
    return a === b;
  }

  private instanceComponentName(object: THREE.Object3D): string {
    return object.constructor.name || object.type;
  }

  private instanceCountLabel(count: number): string {
    return `${count} ${count === 1 ? 'instance' : 'instances'}`;
  }

  private instanceOverride(
    backend: SourcePersistenceBackend,
    id: string,
    path: string,
    literals: Record<string, CreationSiteLiteralReport>,
    subject: SourceWriteSubject,
  ): ComponentInstanceOverride | null {
    const report = literals[path];
    const live = this.readChannel(id, path);
    if (!report || report.literal === null || live === undefined) return null;
    if (this.sameInstanceValue(report.literal, live)) return null;
    const gate = backend.gate({
      ...this.anchorFor(id, path),
      writeScope: 'creation-site',
    });
    const unavailable = !report.writable ? report.reason : gate.ok ? undefined : gate.reason;
    const label = this.inspector.properties(id).find((field) => field.path === path)?.label ?? path;
    return {
      path,
      label,
      value: live,
      ...(report.text ? { defaultText: report.text } : {}),
      canApplyToComponent: unavailable === undefined,
      ...(unavailable ? { applyUnavailableReason: unavailable } : {}),
      affectedInstanceCount: subject.instances,
    };
  }

  private async applyInstanceDefault(
    backend: SourcePersistenceBackend,
    literalsNow: (
      id: string,
      subject: SourceWriteSubject,
      key: string,
    ) => Promise<Record<string, CreationSiteLiteralReport>>,
    id: string,
    path: string,
  ): Promise<ComponentInstanceApplyResult> {
    const subject = { ...this.anchorFor(id, path), writeScope: 'creation-site' as const };
    const key = this.creationSiteKey(subject);
    if (!key) return { changed: false, message: 'This object has no source site.' };
    const object = this.objectOf(id);
    if (!object) return { changed: false, message: 'This object is no longer in the live world.' };
    const report = (await literalsNow(id, subject, key))[path];
    if (!report) return { changed: false, message: `The construction site names no ${path}.` };
    if (report.literal === null) {
      return { changed: false, message: `The construction site names no ${path} default.` };
    }
    const live = this.readChannel(id, path);
    if (live === undefined) return { changed: false, message: `${path} has no live value.` };
    if (!report.writable) {
      return { changed: false, message: report.reason ?? `${path} cannot be rewritten.` };
    }
    const gate = backend.gate(subject);
    if (!gate.ok) return { changed: false, message: gate.reason };
    const count = subject.instances;
    const label =
      `Apply ${path} to ${this.instanceComponentName(object)} default ` +
      `(${this.instanceCountLabel(count)})`;
    const persisted = await backend.write({
      ...subject,
      baseline: report.literal,
      next: live,
      label,
    });
    if (!persisted) {
      return { changed: false, message: `${label} did not land; the console names why.` };
    }
    this.instanceLiterals.delete(key);
    this.instanceLiteralRequests.delete(key);
    this.store.notifyIngestEdit();
    const destination = subject.anchor.anchored ? subject.anchor.display : 'this source site';
    return {
      changed: true,
      message: `${path} now applies to all ${this.instanceCountLabel(count)} from ${destination}.`,
      write: { destination, persisted: true },
    };
  }

  private creationSiteInstances(backend: SourcePersistenceBackend): ComponentInstancesProvider {
    const literalsNow = async (
      id: string,
      subject: SourceWriteSubject,
      key: string,
    ): Promise<Record<string, CreationSiteLiteralReport>> =>
      this.instanceLiterals.get(key) ?? this.loadInstanceLiterals(backend, id, subject, key);

    return {
      describe: (id): ComponentInstanceDescription | null => {
        const subject = this.anchorFor(id, 'position');
        const key = this.creationSiteKey(subject);
        const object = this.objectOf(id);
        if (!key || !object) return null;
        const literals = this.instanceLiterals.get(key);
        if (!literals) {
          void this.loadInstanceLiterals(backend, id, subject, key);
          return null;
        }
        if (Object.keys(literals).length === 0) return null;
        const overrides = this.instancePropertyPaths(id, key)
          .map((path) => this.instanceOverride(backend, id, path, literals, subject))
          .filter((override): override is ComponentInstanceOverride => override !== null);
        return {
          componentName: this.instanceComponentName(object),
          ...(subject.anchor.anchored ? { sourcePath: subject.anchor.display } : {}),
          overrides,
        };
      },
      revert: async (id, paths) => {
        const subject = this.anchorFor(id, 'position');
        const key = this.creationSiteKey(subject);
        if (!key) return;
        const literals = await literalsNow(id, subject, key);
        const before = this.captureHistoryState();
        let changed = 0;
        for (const path of paths) {
          const literal = literals[path]?.literal;
          if (literal === null || literal === undefined) continue;
          this.applyChannel(id, path, literal);
          changed++;
        }
        if (changed > 0) this.recordHistory(`Revert ${changed} instance override(s)`, before);
        return changed > 0 ? LIVE_ONLY_ACK : undefined;
      },
      applyToComponent: (id, path) => this.applyInstanceDefault(backend, literalsNow, id, path),
    };
  }

  // ─────────────────────────────────────────────── session undo/redo

  /**
   * Journal a before→after snapshot pair into project history, LOUDLY.
   *
   * A rejected `record(...)` means the edit IS applied to the live scene but has
   * no history entry: it cannot be undone. Swallowing that turned a journaling
   * failure into a silently un-undoable edit — the user sees their edit and
   * Ctrl+Z does nothing, with no indication anything went wrong.
   */
  private recordHistory(label: string, before: ThreeHistoryState | undefined): void {
    if (!this.historyResource || !before) return;
    void this.historyResource
      .record(label, before, this.captureHistoryState())
      .catch((err: unknown) => {
        editorConsole.error(
          `[ingest] failed to journal "${label}" into project history — the edit is applied ` +
            `but has no history entry (it cannot be undone): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private captureHistoryState(): ThreeHistoryState {
    const objects: ThreeHistoryState['objects'] = {};
    for (const [id, node] of this.projector.nodes) {
      const object = node.object;
      const material = colorMaterialOf(object);
      const light = lightOf(object);
      const camera = perspectiveCameraOf(object);
      objects[id] = {
        name: object.name,
        visible: object.visible,
        transform: this.transforms.get(id),
        ...(material ? { color: `#${material.color.getHexString()}` } : {}),
        ...(light
          ? {
              lightIntensity: light.intensity,
              lightColor: `#${light.color.getHexString()}`,
              ...(rangedLightOf(object) ? { lightDistance: rangedLightOf(object)!.distance } : {}),
            }
          : {}),
        ...(camera ? { camera: { fov: camera.fov, near: camera.near, far: camera.far } } : {}),
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow,
      };
    }
    return { edits: structuredClone(this.edits), objects };
  }

  private restoreHistoryState(state: ThreeHistoryState): void {
    for (const [id, value] of Object.entries(state.objects)) {
      const object = this.objectOf(id);
      if (!object) continue;
      object.name = value.name;
      object.visible = value.visible;
      object.position.fromArray(value.transform.position);
      object.quaternion.fromArray(value.transform.rotation);
      object.scale.fromArray(value.transform.scale);
      // Same reason the drag itself teleports (see `transforms.apply`): on a
      // body-driven node the node write is a value the next step overwrites, so
      // an undo that only restored the node would visibly un-undo itself. The
      // undo of a body teleport is a body teleport.
      this.physicsFor(id)?.commit(id, value.transform);
      this.markedBodies.commit(id, value.transform);
      if (value.color) colorMaterialOf(object)?.color.set(value.color);
      const light = lightOf(object);
      if (light) {
        if (value.lightIntensity !== undefined) light.intensity = value.lightIntensity;
        if (value.lightColor) light.color.set(value.lightColor);
        if (value.lightDistance !== undefined) {
          const ranged = rangedLightOf(object);
          if (ranged) ranged.distance = value.lightDistance;
        }
      }
      const camera = perspectiveCameraOf(object);
      if (camera && value.camera) {
        camera.fov = value.camera.fov;
        camera.near = value.camera.near;
        camera.far = value.camera.far;
        camera.updateProjectionMatrix();
      }
      object.castShadow = value.castShadow;
      object.receiveShadow = value.receiveShadow;
    }
    this.edits = structuredClone(state.edits);
    this.store.notifyIngestEdit();
  }
}

export interface CapturedThreeOptions {
  /** A render camera outside the scene tree, surfaced as an extra root node. */
  readonly camera?: THREE.Camera | undefined;
  /** Freeze/thaw the world's own loop for the duration of a gesture. */
  readonly loop?: ThreeLoopControl | undefined;
  /**
   * Who can stop the frame an edit lands in — see
   * {@link ThreeAuthoringOptions.frameControl}, whose fail-open warning
   * applies verbatim here. A mount that hands this factory NEITHER a `loop`
   * NOR `frameControl: 'host'` is claiming it can freeze the frame itself,
   * and a mid-play gizmo edit on such a mount is silently overwritten instead
   * of honestly refused. Defaults (via that option) to `'adapter'`.
   */
  readonly frameControl?: 'adapter' | 'host';
  /** Injectable creation-site writer, so a unit test can drive the write path
   *  without a dev server. */
  readonly sourceWriter?: IngestSourcePersistence | undefined;
  /** Whose undo journal this mount shares — see
   *  {@link ThreeAuthoringOptions.journal}. */
  readonly journal: JournalSubject;
}

/**
 * The provider combination for a live three tree the editor did not author the
 * source shape of: STRUCTURAL-PATH identity (its source was never stamped with
 * OIDs) plus CREATION-SITE persistence (its literals are the only place an edit
 * can honestly be written, and only when this session is authoring rather than
 * playing).
 *
 * Spelled once here rather than at each mount so the six mounts that want it
 * cannot drift apart — it is a named argument list, not a second adapter.
 */
export function structuralThree(
  store: EditorShellStore,
  scene: ThreeSceneRef,
  options: CapturedThreeOptions,
): ThreeAuthoringAdapter {
  return new ThreeAuthoringAdapter(store, scene, {
    identity: structuralIdentity({ camera: options.camera }),
    journal: options.journal,
    persistence: createCreationSitePersistence({
      history: store.projectHistory,
      writer: options.sourceWriter,
    }),
    loop: options.loop,
    ...(options.frameControl ? { frameControl: options.frameControl } : {}),
    provenance: CAPTURED_PROVENANCE,
  });
}

/**
 * The provider combination for an INGESTED world whose own source the
 * serve-time OID transform DID reach — a vendored R3F game is the case, and
 * the only thing that decides it is a measurement of the mounted graph (do its
 * objects carry `userData.oid`?), never the game's id.
 *
 * OID identity, because the stamp is a better address than a structural path
 * (it survives the world rebuilding part of its graph, and it is the same id
 * Edit↔Play continuity keys on); OID-source persistence, because the JSX
 * callsite the stamp names is the only place in that game's source an edit can
 * honestly be written — fiber constructs every object inside `node_modules`,
 * so the creation-site registry `structuralThree` writes through is
 * structurally empty for this world.
 *
 * `loop` rather than `frameControl: 'host'`: an ingest mount holds the game's
 * own animation loop and freezes it for the gesture, exactly as
 * `structuralThree` does at the same mount.
 */
export function oidSourceThree(
  store: EditorShellStore,
  scene: ThreeSceneRef,
  options: CapturedThreeOptions & {
    readonly worldId: string;
    /** Injectable source transport, so a unit test can drive the whole gesture
     *  without a dev server (the peer of `sourceWriter` on the other lane). */
    readonly backend?: SourceWriteBackend | undefined;
  },
): ThreeAuthoringAdapter {
  return new ThreeAuthoringAdapter(store, scene, {
    identity: oidIdentity(options.worldId, { camera: options.camera }),
    journal: options.journal,
    persistence: createOidSourcePersistence({
      history: store.projectHistory,
      backend: options.backend,
    }),
    loop: options.loop,
    ...(options.frameControl ? { frameControl: options.frameControl } : {}),
    provenance: STAMPED_INGEST_PROVENANCE,
    // The stamp is what makes this lane different, and it decides this too: a
    // stamped node names its own component and its own source file, so a
    // `*.stories.tsx` colocated with that component is an ordinary discovered
    // story about THIS world. The unstamped lane (`structuralThree`)
    // deliberately omits it — see the absent-column note on the class.
    sourceDeclaresStories: true,
  });
}

/**
 * The provider combination for a world whose source the serve-time OID
 * transform reached: OID identity (so selection survives Edit→Play) and NO
 * persistence backend — play edits are ephemeral by architecture, and the host
 * injects `createEphemeralPersistence` over this adapter. The lawful
 * play→source write-back is an explicit per-node gesture on an OID-anchored
 * literal (`SourceWriteBackend.runGesture`), supplied only when the Play mount
 * opts into `explicitSourceCommit`; there is deliberately no silent
 * persistence path here, in any form.
 */
export function oidThree(
  store: EditorShellStore,
  scene: ThreeSceneRef,
  worldId: string,
  /** Whose undo journal this mount shares. Both callers name a DIFFERENT
   *  subject through the same parameter, which is the whole point: edit mode
   *  passes the world (its stack outlives every remount), play passes its run
   *  (its stack ends on ■). */
  journal: JournalSubject,
  options: {
    readonly explicitSourceCommit?: boolean;
    readonly backend?: SourceWriteBackend | undefined;
    readonly sourceAnchor?: SourcePersistenceBackend['anchor'];
  } = {},
): ThreeAuthoringAdapter {
  return new ThreeAuthoringAdapter(store, scene, {
    identity: oidIdentity(worldId),
    journal,
    frameControl: 'host',
    sourceAnchor: options.sourceAnchor,
    ...(options.explicitSourceCommit
      ? {
          sourceCommit: createOidTransformSourceCommitter({
            history: store.projectHistory,
            ...(options.backend ? { backend: options.backend } : {}),
          }),
        }
      : {}),
  });
}
