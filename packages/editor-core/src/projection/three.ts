/**
 * THE PROJECTOR FOR THE THREE SURFACE — one walk, one index, one set of derived
 * views, for every authoring adapter that drives a live `Object3D` graph
 * (ARCHITECTURE-CORE §The editor protocol, projection family).
 *
 * The projection unit is the RUNTIME OBJECT. Nothing here reads source, an AST
 * or a document; a walk answers from the graph that is actually mounted, so an
 * empty projection over a mounted world is a defect rather than a fact.
 *
 * ## What this owns, and what it deliberately does not
 *
 * OWNS — the four things all three three-surface authoring classes used to
 * spell separately:
 *
 *  - the DFS itself ({@link walkThreeGraph}), including the editor-furniture
 *    skip and the fold-into-the-nearest-admitted-ancestor rule,
 *  - IDENTITY MINTING, parameterized by scheme ({@link oidIdentity},
 *    {@link structuralIdentity}, {@link sourceOidIdentity},
 *    {@link documentPathIdentity}) — the id FORMATS are the schemes', the walk
 *    that applies them is one,
 *  - the INDEX both directions ({@link ThreeProjector.objects} /
 *    {@link ThreeProjector.idsByObject}) plus the `userData.entityId` stamp
 *    that makes the viewport's raycast, the gizmo and `store.objectMap` agree
 *    with the walk,
 *  - PICKING as a derived view over that index
 *    ({@link ThreeProjector.pick}).
 *
 * DOES NOT own the LANE-SPECIFIC hierarchy VIEW built on top. The R3F source
 * lane collapses a component instance's interior into one row; the live lane
 * resolves the same question over projected nodes with different top-level
 * semantics. Both read this projection and derive their rows from it; merging
 * the two collapse rules would be inventing a third, not extracting a shared
 * one.
 *
 * BOUNDS are not here either, because they were never in the authoring classes:
 * `@volter/editor-threejs/viewport/content-bounds` (`contentWorldBounds`) is the bounds walk
 * every consumer uses, and it takes the `Object3D` this index resolves.
 */

import type { EditorNode } from '@volter/editor-project/adapter';
import { isEditorOwnedObject } from '@volter/editor-threejs/viewport/editor-layers';
import { constraintsOf } from '@volter/editor-threejs/adapter/constraint';
import {
  CAMERA_ID,
  collectStructuralIds,
} from '@volter/editor-threejs/adapter/ingest/structural-ids';
import { object3DAuthoringSubjectOf } from '@volter/editor-threejs/adapter/object3d-authoring-subject';
import { reflectionProbeOf } from '@volter/editor-threejs/adapter/reflection-probe';
import { getUserData } from '@volter/editor-threejs/ecs/user-data';
import type * as THREE from 'three';
import { authoringOidOf, occurrenceId } from '../authoring/component-instance-root';
import { raycastCandidates, raycastPick } from '../authoring/viewport-raycast';
import type { EditorShellStore } from '../editor-shell-store';
import { entityIdOf, stampEntityId } from '../entity-object';
import type { ProjectedNode, Projection } from './types';

export type { ProjectedNode, Projection } from './types';

/** One projected authoring node over a live three graph. */
export type ThreeNode = ProjectedNode<THREE.Object3D>;

/**
 * Reflection stats for one walk. Surfaced by the adapters' `refresh()` for
 * proof/telemetry (the ingest console line, the `__vgaiIngest.reflected` hook) —
 * deliberately a fresh measurement each walk rather than a mount-time snapshot,
 * because a running world keeps streaming objects in.
 */
export interface ThreeWalkStats {
  readonly count: number;
  readonly meshes: number;
  readonly lights: number;
  /**
   * How many of `meshes` are `InstancedMesh`, and how many units those draw.
   *
   * Every other count here is keyed on OBJECTS, and an `InstancedMesh` is one
   * object drawing N units — so `count`/`meshes` (and the hierarchy rows built
   * from the same nodes) report 1 where a reader sees N, with no error
   * anywhere, because both numbers are individually correct. These two fields
   * are the only place the shortfall is expressible; `vgai doctor`'s
   * instanced-content check reads exactly this pair
   * (`packages/editor/src/doctor/detection-gaps.ts`).
   */
  readonly instancedMeshes: number;
  readonly instances: number;
}

export type ThreeProjection = Projection<THREE.Object3D, ThreeWalkStats>;

/** Nothing walked (no scene mounted, or a scene with nothing in it). */
export const EMPTY_THREE_WALK_STATS: ThreeWalkStats = {
  count: 0,
  meshes: 0,
  lights: 0,
  instancedMeshes: 0,
  instances: 0,
};

/**
 * The IDENTITY seam — how a live `Object3D` tree is addressed: which objects
 * are authoring nodes, what their ids are, and how they nest.
 *
 * An adapter never mints an id itself. It asks a scheme for a
 * {@link ThreeProjection} and drives every provider (hierarchy, selection,
 * transforms, inspector, picking) off that one walk.
 */
export interface ThreeIdentity {
  /** (Re)walk `scene` and project its authoring identity. */
  project(scene: THREE.Scene): ThreeProjection;
  /** Live OID worlds can admit one changed native subtree without rewalking
   * every survivor. Other identity schemes fall back to {@link project}. */
  readonly incremental?: {
    readonly kind: 'live-oid';
    readonly worldId: string;
  };
}

/** Where the walk currently is, for a scheme that mints from position. */
export interface ThreeWalkContext {
  /** Child-index path from the scene, e.g. `[0, 2, 1]`. Skipped objects still
   *  consume their index, so an id minted from it is stable against editor
   *  furniture appearing beside game content. */
  readonly path: readonly number[];
  /** The nearest ADMITTED ancestor's id — `null` ⇒ this subtree hangs under
   *  transparent containers only, so a node admitted here is a projection root. */
  readonly ownerId: string | null;
  /** Whether anything above already claims this subtree as its parts. */
  readonly ownedByAncestor: boolean;
}

/** The per-lane half of a walk: what to skip, what to admit, what to call it. */
export interface ThreeIdentityScheme {
  /** Fresh per-walk state. */
  begin?(scene: THREE.Scene): void;
  /**
   * Objects that never enter the projection, WITH their subtrees. Defaults to
   * {@link isEditorOwnedObject} — the viewport's layer-31 furniture (grid,
   * editor lights, BatchedRenderer, gizmo helper, pivot dummy, snap
   * indicators) is parked in whatever scene is mounted, and projecting it
   * offers the user the editor's own objects as if they were the world's.
   */
  skip?(object: THREE.Object3D): boolean;
  /** This object's id, or `null` when it is not an authoring node — in which
   *  case its children fold into the nearest admitted ancestor. Called for
   *  EVERY visited object, admitted or not, so a scheme counting occurrences
   *  counts the folded ones too. */
  identify(object: THREE.Object3D, context: ThreeWalkContext): string | null;
  /** DFS leave hook, after this object's children — for a scheme holding
   *  path-scoped state. */
  leave?(object: THREE.Object3D, id: string | null): void;
}

/**
 * Session-monotonic counter for minted ids. Module-level ON PURPOSE: the store
 * (adoption) and the adapter both run the walk over the same scene, so a
 * per-instance counter could mint `live:<w>:0` twice for two different objects.
 * Stamped ids are reused on every later walk, so the counter only ever advances
 * for genuinely new objects.
 */
let mintedIdCounter = 0;

/** The instanced half of {@link ThreeWalkStats}, over an already-projected node map. */
function instancedTally(nodes: ReadonlyMap<string, ThreeNode>): {
  instancedMeshes: number;
  instances: number;
} {
  let instancedMeshes = 0;
  let instances = 0;
  for (const node of nodes.values()) {
    const object = node.object as THREE.Object3D & {
      isInstancedMesh?: boolean;
      count?: number;
    };
    if (object.isInstancedMesh) {
      instancedMeshes++;
      instances += typeof object.count === 'number' ? object.count : 0;
    }
  }
  return { instancedMeshes, instances };
}

function tally(nodes: ReadonlyMap<string, ThreeNode>): ThreeWalkStats {
  let meshes = 0;
  let lights = 0;
  for (const node of nodes.values()) {
    const object = node.object as THREE.Object3D & { isMesh?: boolean; isLight?: boolean };
    if (object.isLight) lights++;
    else if (object.isMesh) meshes++;
  }
  return { count: nodes.size, meshes, lights, ...instancedTally(nodes) };
}

/**
 * THE WALK. One DFS over a live scene, projecting it into authoring nodes and
 * stamping `userData.entityId` on each, so the viewport raycast/gizmo and
 * `EditorShellStore.objectMap` key off the same identity the walk minted.
 *
 * Every scheme that goes through here addresses a graph the editor is entitled
 * to stamp. The one scheme that is not ({@link structuralIdentity}, over
 * foreign objects) keeps identity in the projection instead and does not use
 * this walk at all — see #1965.
 *
 * Idempotent for every scheme that reuses an existing stamp: re-walking a scene
 * re-derives the same ids for the same objects.
 */
export function walkThreeGraph(scene: THREE.Scene, scheme: ThreeIdentityScheme): ThreeProjection {
  const nodes = new Map<string, ThreeNode>();
  const rootIds: string[] = [];
  const skip = scheme.skip ?? isEditorOwnedObject;
  scheme.begin?.(scene);

  const visit = (
    object: THREE.Object3D,
    path: readonly number[],
    ownerId: string | null,
    ownedByAncestor: boolean,
  ): void => {
    if (skip(object)) return;
    const id = scheme.identify(object, { path, ownerId, ownedByAncestor });
    if (id !== null) {
      stampEntityId(object, id);
      nodes.set(id, { object, id, parentId: ownerId, childIds: [] });
      if (ownerId === null) rootIds.push(id);
      else nodes.get(ownerId)?.childIds.push(id);
    }
    // `ownsParts` is the separate question of whether anything above (or this
    // node itself) claims the subtree below as its implementation.
    const ownsParts = ownedByAncestor || id !== null;
    object.children.forEach((child, index) => {
      visit(child, [...path, index], id ?? ownerId, ownsParts);
    });
    scheme.leave?.(object, id);
  };

  scene.children.forEach((child, index) => {
    visit(child, [index], null, false);
  });
  return { nodes, rootIds, stats: tally(nodes) };
}

/**
 * The scheme half of every three-lane entity id (`r3f:<worldId>:<oid>`).
 *
 * Spelled ONCE because it is read as well as written: the editor shell tests a
 * focused id with `startsWith` to decide whether the three lane owns it
 * (`components/DefaultEditorLayout.tsx`), so a literal changed at one of the
 * mint sites and not at the reader is a silent loss of that decision rather
 * than a compile error.
 */
export const THREE_ENTITY_ID_SCHEME = 'r3f:';

/** `r3f:<worldId>:<oid>` — the one place the three lane's id shape is built. */
export function threeEntityId(worldId: string, oid: string): string {
  return `${THREE_ENTITY_ID_SCHEME}${worldId}:${oid}`;
}

/**
 * The LIVE OID scheme. A node stamped by the served TSX's `__vgaiOid` transform
 * keeps `r3f:<worldId>:<oid>`, so selection survives Edit→Play; anything a
 * source location cannot claim gets a session-stable `live:<worldId>:<n>`.
 */
function liveOidScheme(worldId: string): ThreeIdentityScheme {
  const oidOccurrences = new Map<string, number>();
  const reservedOccurrenceOwners = new Map<string, THREE.Object3D>();
  const occurrenceBelongsTo = (id: string, base: string): boolean =>
    id === base || (id.startsWith(`${base}#`) && /^\d+$/u.test(id.slice(base.length + 1)));

  const reserveExistingOccurrences = (scene: THREE.Scene): void => {
    reservedOccurrenceOwners.clear();
    const visit = (object: THREE.Object3D): void => {
      if (isEditorOwnedObject(object)) return;
      const sourceOid = authoringOidOf(object);
      const stamped = entityIdOf(object);
      if (sourceOid !== undefined && stamped !== undefined) {
        const base = threeEntityId(worldId, sourceOid);
        if (occurrenceBelongsTo(stamped, base) && !reservedOccurrenceOwners.has(stamped)) {
          reservedOccurrenceOwners.set(stamped, object);
        }
      }
      for (const child of object.children) visit(child);
    };
    for (const child of scene.children) visit(child);
  };

  const reusableStampedIdentity = (
    object: THREE.Object3D,
    sourceOid: string | undefined,
  ): string | undefined => {
    const stamped = entityIdOf(object);
    if (stamped === undefined || sourceOid === undefined) return stamped;
    const base = threeEntityId(worldId, sourceOid);
    if (!occurrenceBelongsTo(stamped, base)) return stamped;
    return reservedOccurrenceOwners.get(stamped) === object ? stamped : undefined;
  };

  const claimSourceIdentity = (object: THREE.Object3D, sourceOid: string): string => {
    const base = threeEntityId(worldId, sourceOid);
    let occurrence = oidOccurrences.get(sourceOid) ?? 0;
    let identity = occurrenceId(base, occurrence);
    while (reservedOccurrenceOwners.has(identity)) {
      occurrence += 1;
      identity = occurrenceId(base, occurrence);
    }
    oidOccurrences.set(sourceOid, occurrence + 1);
    reservedOccurrenceOwners.set(identity, object);
    return identity;
  };

  return {
    begin: (scene) => {
      oidOccurrences.clear();
      reserveExistingOccurrences(scene);
    },
    identify: (object, context) => {
      // Count every source-stamped runtime node in native traversal order,
      // including projected-away wrappers/parts, so surviving authoring roots
      // keep the same id across Edit and Play (mirrors the R3F design adapter's
      // duplicate-OID suffixing exactly).
      const sourceOid = authoringOidOf(object);
      const stamped = reusableStampedIdentity(object, sourceOid);
      if (stamped !== undefined) return stamped;
      // Two live objects carrying one old occurrence stamp is the precise
      // collision the reservation pass repairs. The first object in the
      // current graph keeps the address; this later one receives the first
      // free occurrence and is restamped by walkThreeGraph.
      const sourceIdentity =
        sourceOid === undefined ? undefined : claimSourceIdentity(object, sourceOid);
      // ADMISSION. Three independent grounds, and the FIRST is what makes a
      // play mount project the world the author wrote:
      //
      //  - A SOURCE IDENTITY. The served TSX stamped this element, so it is a
      //    node the author authored — `<object3D name='Coins'>` as much as the
      //    `<Coin/>` instances inside it. Ownership by an ancestor is beside the
      //    point: an authored node is not its owner's implementation detail.
      //    Without this, a fresh play mount (where nothing is pre-stamped with
      //    an `entityId` yet) admitted only the nodes whose `authoringInstance`
      //    differed from their parent's — so `Stage`'s whole interior collapsed
      //    and its 49 component instances rendered FLAT, with the `Coins` and
      //    `Enemies` groups that really parent them gone from the panel.
      //  - NO OWNER ABOVE. An unstamped world (an ingest, an adopted graph) has
      //    no source identities at all; its outermost objects are the rows, and
      //    everything under them stays folded in as parts.
      //  - AN EXPLICIT OPT-IN. `userData.authoringRoot` is how a runtime
      //    descendant of such a world asks to be a row of its own.
      //
      // What stays folded is exactly what has none of the three: the parts a
      // library builds under an authored node (GLTF meshes, bones, a light's
      // `target`), which the mark convention folds by classification instead.
      if (
        sourceIdentity !== undefined ||
        !context.ownedByAncestor ||
        getUserData(object, 'authoringRoot') === true
      ) {
        return sourceIdentity ?? `live:${worldId}:${mintedIdCounter++}`;
      }
      return null;
    },
  };
}

/**
 * Walk a live scene under the OID scheme. Exported because scene ADOPTION runs
 * the same walk the adapter does (`viewport-root-presentation.ts`), and the two must
 * agree about every id.
 */
export function projectThreeScene(scene: THREE.Scene, worldId: string): ThreeProjection {
  return walkThreeGraph(scene, liveOidScheme(worldId));
}

/**
 * Stamp identities on a live scene and return the id → Object3D map the store
 * adopts as its `objectMap`. The adapter's own index is built by the same walk,
 * so the two can never disagree about an id.
 */
export function stampThreeIdentities(
  scene: THREE.Scene,
  worldId: string,
): Map<string, THREE.Object3D> {
  const { nodes } = projectThreeScene(scene, worldId);
  const map = new Map<string, THREE.Object3D>();
  for (const [id, node] of nodes) map.set(id, node.object);
  return map;
}

/**
 * The OID identity (see {@link liveOidScheme}), for a LIVE world.
 *
 * `camera` is the SAME allowance {@link structuralIdentity} makes and for the
 * same reason: a captured world's render camera often is not a child of the
 * scene it renders, and a camera that is not a node is not selectable,
 * inspectable, or reachable by the viewport's framing. It joins as an extra
 * root under the fixed {@link CAMERA_ID} only when the walk did not already
 * meet it as a scene child — an R3F world usually authors its camera inside the
 * tree, and admitting it twice would put the same object on two rows.
 */
export function oidIdentity(
  worldId: string,
  options: { readonly camera?: THREE.Camera | undefined } = {},
): ThreeIdentity {
  const camera = options.camera;
  return {
    incremental: { kind: 'live-oid', worldId },
    project: (scene) => {
      const projection = projectThreeScene(scene, worldId);
      if (!camera || [...projection.nodes.values()].some((node) => node.object === camera)) {
        return projection;
      }
      stampEntityId(camera, CAMERA_ID);
      projection.nodes.set(CAMERA_ID, {
        object: camera,
        id: CAMERA_ID,
        parentId: null,
        childIds: [],
      });
      projection.rootIds.push(CAMERA_ID);
      return { ...projection, stats: { ...projection.stats, count: projection.nodes.size } };
    },
  };
}

export interface StructuralIdentityOptions {
  /**
   * A render camera that is NOT a scene child — surfaced as an extra root node
   * under the fixed {@link CAMERA_ID} so it is selectable and inspectable. A
   * captured world's camera usually lives outside the tree it renders.
   */
  readonly camera?: THREE.Camera | undefined;
}

/**
 * The STRUCTURAL-PATH scheme. Deterministic from the scene's shape (position in
 * the tree + three.js type + name), so the same id re-binds to the same object
 * after the world rebuilds part of its graph within a session. This is the
 * scheme for a graph whose source was never stamped, and it pairs with the
 * creation-site anchors the persistence backend writes through.
 *
 * The walk itself lives in `@volter/editor-threejs/adapter/ingest/structural-ids` — it is
 * the engine's own ingest walk and stays there; this provider is the projection
 * hop, turning its pure flat id→object map into the parent/child node graph
 * every authoring provider reads, WITHOUT stamping the foreign objects.
 */
export function structuralIdentity(options: StructuralIdentityOptions = {}): ThreeIdentity {
  const camera = options.camera;
  return {
    project: (scene) => {
      const walk = collectStructuralIds(scene, camera);
      // Reverse the walk's own map rather than storing identity on the foreign
      // objects. A re-walk after a rebuild therefore has no stale stamps to
      // collide with live ids or parent under the wrong object.
      const idByObject = new Map<THREE.Object3D, string>();
      for (const [id, object] of walk.byId) idByObject.set(object, id);
      const nodes = new Map<string, ThreeNode>();
      const rootIds: string[] = [];
      for (const [id, object] of walk.byId) {
        const parent = object.parent;
        const parentId = (parent && parent !== scene ? idByObject.get(parent) : undefined) ?? null;
        // `childIds` is filtered to the walk's own membership: editor furniture
        // parked in the world's scene is skipped by `assignStructuralIds`, and
        // it must not reappear as a hierarchy row through a parent's children.
        const childIds = object.children
          .map((child) => idByObject.get(child))
          .filter((childId): childId is string => childId !== undefined);
        nodes.set(id, { object, id, parentId, childIds });
        if (parentId === null) rootIds.push(id);
      }
      return {
        nodes,
        rootIds,
        stats: {
          count: walk.count,
          meshes: walk.meshes,
          lights: walk.lights,
          ...instancedTally(nodes),
        },
      };
    },
  };
}

/**
 * The SOURCE OID identity, for a first-party R3F world whose TSX the editor
 * serves: every object is a node (the lane's hierarchy view does its own
 * collapsing on top), addressed by its authored callsite where it has one and
 * by its structural path where it does not.
 *
 * It also reports the two OID-lane facts the walk is the only place able to
 * measure, refreshed on every `project`:
 *
 *  - `instanceRoots` — how many times each authored element RENDERS, counted at
 *    instance ROOTS only (an object with no ancestor carrying the same
 *    identity). Every host element inside a component definition carries that
 *    instance's stamp, so counting stamped objects would report a component as
 *    rendering ~50 times instead of once.
 *  - `representatives` — the FIRST live object that resolved to each oid: the
 *    occurrence that keeps the bare address, and the one every `…#n`
 *    occurrence's write authority is decided against.
 */
export interface SourceOidIdentity extends ThreeIdentity {
  readonly instanceRoots: ReadonlyMap<string, number>;
  readonly representatives: ReadonlyMap<string, THREE.Object3D>;
}

export function sourceOidIdentity(worldId: string): SourceOidIdentity {
  let instanceRoots: ReadonlyMap<string, number> = new Map();
  let representatives: ReadonlyMap<string, THREE.Object3D> = new Map();
  return {
    get instanceRoots() {
      return instanceRoots;
    },
    get representatives() {
      return representatives;
    },
    project: (scene) => {
      const oidOccurrence = new Map<string, number>();
      const roots = new Map<string, number>();
      const reps = new Map<string, THREE.Object3D>();
      /** Authoring identities of the objects ON the current DFS path. */
      const ancestorIdentities = new Set<string>();
      const openedBy = new Map<THREE.Object3D, string>();
      const projection = walkThreeGraph(scene, {
        identify: (object, context) => {
          const oid = authoringOidOf(object);
          if (oid === undefined) return threeEntityId(worldId, `@${context.path.join('.')}`);
          const n = oidOccurrence.get(oid) ?? 0;
          oidOccurrence.set(oid, n + 1);
          if (n === 0) reps.set(oid, object);
          if (!ancestorIdentities.has(oid)) {
            roots.set(oid, (roots.get(oid) ?? 0) + 1);
            ancestorIdentities.add(oid);
            openedBy.set(object, oid);
          }
          return occurrenceId(threeEntityId(worldId, oid), n);
        },
        leave: (object) => {
          const opened = openedBy.get(object);
          if (opened === undefined) return;
          ancestorIdentities.delete(opened);
          openedBy.delete(object);
        },
      });
      instanceRoots = roots;
      representatives = reps;
      return projection;
    },
  };
}

/**
 * The DOCUMENT-PATH identity, for a native Object3D graph opened as a document
 * (a loaded model, a project source graph): document-scoped structural ids over
 * every object the document owns.
 *
 * Its skip is the DOCUMENT's, not the viewport's: a document graph is built by
 * its own session rather than parked in the editor's scene, and the one piece
 * of furniture it does add is a `SkeletonHelper`, which carries no editor mark
 * of its own.
 */
export function documentPathIdentity(documentId: string): ThreeIdentity {
  return {
    project: (scene) =>
      walkThreeGraph(scene, {
        skip: (object) =>
          Boolean(getUserData(object, 'editorHelper')) ||
          (object as THREE.SkeletonHelper).isSkeletonHelper === true,
        identify: (_object, context) => `source-object:${documentId}:${context.path.join('.')}`,
      }),
  };
}

/**
 * What KIND of thing a projected node is, for the hierarchy row's icon and the
 * inspector's header. Reflected from the live object plus the marks a world
 * puts on its own nodes — no schema, no name convention.
 */
export function nativeKindOf(object: THREE.Object3D): EditorNode['kind'] {
  const authoringSubject = object3DAuthoringSubjectOf(object);
  if (authoringSubject) return authoringSubject.kind;
  if (constraintsOf(object).length > 0) return 'constraint-owner';
  if (reflectionProbeOf(object)) return 'reflection-probe';
  if ((object as THREE.SkinnedMesh).isSkinnedMesh) return 'skinned-mesh';
  if ((object as THREE.Bone).isBone) return 'bone';
  if ((object as THREE.Light).isLight) return 'light';
  if ((object as THREE.Camera).isCamera) return 'camera';
  // Three tags its audio nodes only through `type` — there is no `isAudio`
  // flag to read like the lines above, and an `Audio`/`AudioListener` carries
  // no geometry, so without this it fell through to the generic `object`
  // circle and a world's sound was the one thing the hierarchy could not name.
  if (
    object.type === 'Audio' ||
    object.type === 'PositionalAudio' ||
    object.type === 'AudioListener'
  )
    return 'audio';
  if ((object as THREE.Mesh).isMesh) return 'mesh';
  if (object.children.length > 0) return 'group';
  return 'object';
}

/** Where {@link ThreeProjector.pick} raycasts. */
export type ThreePickScope =
  /** This projector's own objects, resolved through its own reverse index — the
   *  answer for a surface whose objects are not (or not only) the shell's. */
  | 'projection'
  /** `EditorShellStore.objectMap` and the `entityId` stamps, the shell's own
   *  index — the answer for a surface that owns that map. */
  | 'store-object-map';

export interface ThreeProjectorOptions {
  /** Default `'projection'`. */
  readonly pickScope?: ThreePickScope;
}

function isDescendant(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let current = object.parent; current !== null; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function isAttachedTo(object: THREE.Object3D, scene: THREE.Scene): boolean {
  if (object === scene) return true;
  for (let current = object.parent; current !== null; current = current.parent) {
    if (current === scene) return true;
  }
  return false;
}

export interface ThreeProjectionDelta {
  readonly removedIds: ReadonlySet<string>;
  readonly addedIds: ReadonlySet<string>;
  /** Projected parents whose direct child order/membership changed. */
  readonly changedParentIds: ReadonlySet<string>;
  /** True when the projection forest's own root order/membership changed. */
  readonly rootsChanged: boolean;
}

/**
 * The projector: one identity scheme, the index its walk produces, and the
 * derived views every three authoring adapter reads instead of re-walking.
 */
export class ThreeProjector {
  private nodesById = new Map<string, ThreeNode>();
  private objectsById = new Map<string, THREE.Object3D>();
  private idsByObjectIndex = new Map<THREE.Object3D, string>();
  private roots: string[] = [];
  private walkStats: ThreeWalkStats = EMPTY_THREE_WALK_STATS;

  constructor(
    private readonly identity: ThreeIdentity,
    private readonly options: ThreeProjectorOptions = {},
  ) {}

  /**
   * (Re)walk. `null` is an honest "nothing is mounted" — the projection empties
   * rather than keeping a stale index, because a hierarchy over a torn-down
   * world is worse than no hierarchy.
   */
  project(scene: THREE.Scene | null): ThreeWalkStats {
    if (!scene) {
      this.nodesById = new Map();
      this.objectsById = new Map();
      this.idsByObjectIndex = new Map();
      this.roots = [];
      this.walkStats = EMPTY_THREE_WALK_STATS;
      return this.walkStats;
    }
    const { nodes, rootIds, stats } = this.identity.project(scene);
    this.nodesById = nodes;
    this.objectsById = new Map([...nodes].map(([id, node]) => [id, node.object] as const));
    this.idsByObjectIndex = new Map([...nodes].map(([id, node]) => [node.object, id] as const));
    this.roots = rootIds;
    this.walkStats = stats;
    return stats;
  }

  /** Apply final-state childadded/childremoved roots to a live OID projection.
   * Survivors retain their ids; only the changed subtrees are withdrawn and
   * re-admitted. `null` asks the caller to use the identity's full rebuild. */
  projectSubtrees(
    scene: THREE.Scene | null,
    changedRoots: readonly THREE.Object3D[],
  ): ThreeProjectionDelta | null {
    const incremental = this.identity.incremental;
    if (scene === null || incremental?.kind !== 'live-oid') return null;

    // A reparent emits remove+add in one task, and a parent/child pair can both
    // appear in the burst. Process only the outermost changed roots.
    const changed = changedRoots.filter(
      (candidate, index) =>
        changedRoots.indexOf(candidate) === index &&
        !changedRoots.some((other) => other !== candidate && isDescendant(candidate, other)),
    );
    const previousRoots = this.roots;
    const removedIds = new Set<string>();
    const addedIds = new Set<string>();
    const affectedParents = new Set<string>();

    for (const root of changed) {
      root.traverse((object) => {
        const id = this.idsByObjectIndex.get(object);
        if (id === undefined) return;
        const node = this.nodesById.get(id);
        if (node?.parentId !== null && node?.parentId !== undefined) {
          affectedParents.add(node.parentId);
        }
        removedIds.add(id);
        this.nodesById.delete(id);
        this.objectsById.delete(id);
        this.idsByObjectIndex.delete(object);
      });
    }

    const skip = isEditorOwnedObject;
    const idAvailable = (id: string, object: THREE.Object3D): boolean => {
      const owner = this.objectsById.get(id);
      return owner === undefined || owner === object;
    };
    const identify = (object: THREE.Object3D, ownedByAncestor: boolean): string | null => {
      const stamped = entityIdOf(object);
      if (stamped !== undefined && idAvailable(stamped, object)) return stamped;
      const sourceOid = authoringOidOf(object);
      if (sourceOid !== undefined) {
        const base = threeEntityId(incremental.worldId, sourceOid);
        let occurrence = 0;
        let id = occurrenceId(base, occurrence);
        while (!idAvailable(id, object)) id = occurrenceId(base, ++occurrence);
        return id;
      }
      if (!ownedByAncestor || getUserData(object, 'authoringRoot') === true) {
        let id = `live:${incremental.worldId}:${mintedIdCounter++}`;
        while (!idAvailable(id, object)) id = `live:${incremental.worldId}:${mintedIdCounter++}`;
        return id;
      }
      return null;
    };
    const visit = (
      object: THREE.Object3D,
      ownerId: string | null,
      ownedByAncestor: boolean,
    ): void => {
      if (skip(object)) return;
      const id = identify(object, ownedByAncestor);
      if (id !== null) {
        stampEntityId(object, id);
        this.nodesById.set(id, { object, id, parentId: ownerId, childIds: [] });
        this.objectsById.set(id, object);
        this.idsByObjectIndex.set(object, id);
        addedIds.add(id);
        if (ownerId !== null) affectedParents.add(ownerId);
      }
      const nextOwner = id ?? ownerId;
      const ownsParts = ownedByAncestor || id !== null;
      for (const child of object.children) visit(child, nextOwner, ownsParts);
    };

    for (const root of changed) {
      if (!isAttachedTo(root, scene)) continue;
      let parent = root.parent;
      let ownerId: string | null = null;
      while (parent !== null && parent !== scene) {
        const candidate = this.idsByObjectIndex.get(parent);
        if (candidate !== undefined) {
          ownerId = candidate;
          break;
        }
        parent = parent.parent;
      }
      visit(root, ownerId, ownerId !== null);
    }

    const projectedChildren = (container: THREE.Object3D): string[] => {
      const ids: string[] = [];
      const collect = (object: THREE.Object3D): void => {
        if (skip(object)) return;
        const id = this.idsByObjectIndex.get(object);
        if (id !== undefined) {
          ids.push(id);
          return;
        }
        for (const child of object.children) collect(child);
      };
      for (const child of container.children) collect(child);
      return ids;
    };
    for (const id of affectedParents) {
      const parent = this.nodesById.get(id);
      if (parent !== undefined) {
        parent.childIds.splice(0, parent.childIds.length, ...projectedChildren(parent.object));
      }
    }
    for (const id of addedIds) {
      const node = this.nodesById.get(id);
      if (node !== undefined) {
        node.childIds.splice(0, node.childIds.length, ...projectedChildren(node.object));
      }
    }
    const sceneRoots = projectedChildren(scene);
    const detachedRoots = this.roots.filter((id) => {
      const object = this.objectsById.get(id);
      return object !== undefined && !isAttachedTo(object, scene) && !removedIds.has(id);
    });
    this.roots = [...sceneRoots, ...detachedRoots];
    this.walkStats = tally(this.nodesById);
    const rootsChanged =
      previousRoots.length !== this.roots.length ||
      previousRoots.some((id, index) => id !== this.roots[index]);
    return { removedIds, addedIds, changedParentIds: affectedParents, rootsChanged };
  }

  get nodes(): ReadonlyMap<string, ThreeNode> {
    return this.nodesById;
  }

  /** id → live object. */
  get objects(): ReadonlyMap<string, THREE.Object3D> {
    return this.objectsById;
  }

  /** live object → id. */
  get idsByObject(): ReadonlyMap<THREE.Object3D, string> {
    return this.idsByObjectIndex;
  }

  get rootIds(): readonly string[] {
    return this.roots;
  }

  get stats(): ThreeWalkStats {
    return this.walkStats;
  }

  node(id: string): ThreeNode | null {
    return this.nodesById.get(id) ?? null;
  }

  rootNodes(): ThreeNode[] {
    return this.roots
      .map((id) => this.nodesById.get(id))
      .filter((node): node is ThreeNode => node !== undefined);
  }

  objectOf(id: string): THREE.Object3D | null {
    return this.objectsById.get(id) ?? null;
  }

  idOf(object: THREE.Object3D): string | null {
    return this.idsByObjectIndex.get(object) ?? null;
  }

  /** The ids of whichever objects are in this projection — the one place the
   *  "map through the reverse index and drop what the walk skipped" step is
   *  written. */
  childIdsOf(objects: Iterable<THREE.Object3D>): string[] {
    const ids: string[] = [];
    for (const object of objects) {
      const id = this.idsByObjectIndex.get(object);
      if (id !== undefined) ids.push(id);
    }
    return ids;
  }

  /** A copy for the shell viewport's native-object index. */
  objectMapSnapshot(): Map<string, THREE.Object3D> {
    return new Map(this.objectsById);
  }

  /** Frontmost authorable subject under the pointer. */
  pick(
    store: EditorShellStore,
    clientX: number,
    clientY: number,
    isLocked?: (id: string) => boolean,
  ): string | null {
    return raycastPick(store, clientX, clientY, isLocked, this.pickProjection());
  }

  /** Every authorable subject under the pointer, front to back. */
  candidates(
    store: EditorShellStore,
    clientX: number,
    clientY: number,
    isLocked?: (id: string) => boolean,
  ): string[] {
    return raycastCandidates(store, clientX, clientY, isLocked, this.pickProjection());
  }

  private pickProjection():
    | {
        objects: Iterable<THREE.Object3D>;
        idForObject3D: (object: THREE.Object3D) => string | null;
      }
    | undefined {
    if (this.options.pickScope === 'store-object-map') return undefined;
    return {
      objects: this.objectsById.values(),
      idForObject3D: (object) => this.idOf(object),
    };
  }
}
