/**
 * CompositeAuthoringAdapter — merges N per-world {@link AuthoringAdapter}s into ONE authoring
 * tree so the editor's hierarchy lists EVERY mounted world's entities and selection/inspection
 * routes to the right backend. This is the editor-multi-root-selection seam, generalized to N-ary
 * (T6.1 slice 3): one top-level GROUP NODE per world
 * (`world:<id> (<kind>)`), the child adapter's own roots nested beneath it. The project/game
 * identity already lives in the editor chrome, so the authoring projection starts at those real
 * world roots — it does not add a redundant synthetic Game row. Routing is by GROUP-NODE
 * OWNERSHIP: the child adapter whose tree contains a given node id.
 *
 * The editor still talks to a single {@link AuthoringAdapter}; selection +
 * inspection work in every world; the 3D transform gizmo stays threejs-only (a
 * viewport concern, outside this adapter); play/pause stays game-level (T7.6).
 */

import type {
  AssetDropProvider,
  AssetSubjectProvider,
  AuthoringAdapter,
  AuthoringCapabilities,
  ComponentInstancesProvider,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  NodeCreationSite,
  PersistenceProvider,
  PropertyDescriptor,
  RelatedSubjectsProvider,
  SelectionProvider,
  SpatialHandlesProvider,
  StoriesProvider,
  StoryRef,
  StructureProvider,
  Transform,
  TransformProvider,
  TruthProvider,
  WriteAck,
} from '@volter/editor-project/adapter';
import { recordAuthoringConsumerUse } from '@volter/editor-sdk/kit/authoring-seam-evidence';
import { NO_OBJECT_REASON } from '@volter/editor-sdk/kit/creation-site-registry';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { HierarchyProjection, HierarchyProjectionGroup } from '@volter/editor-sdk/kit/hierarchy-projection';
import { forEachHierarchyNode } from '../hierarchy-walk';
import {
  applyAuthoringInstanceToComponent,
  applyAuthoringTransform,
  beginAuthoringTransformEdit,
  commitAuthoringTransformSource,
  copyAuthoringNodes,
  createAuthoringNode,
  cutAuthoringNodes,
  dropAuthoringAsset,
  duplicateAuthoringNode,
  endAuthoringTransformEdit,
  groupAuthoringNodes,
  pasteAuthoringNodes,
  removeAuthoringNode,
  removeAuthoringTransform,
  removeManyAuthoringNodes,
  reorderAuthoringNode,
  reparentAuthoringNode,
  revertAuthoringInstance,
  saveAuthoringDocument,
  setAuthoringSelection,
  ungroupAuthoringNode,
  unwrapAuthoringNode,
  wrapAuthoringNode,
} from './consumer-actions';
import { WORLD_SCOPE_NODE_ID } from '@volter/editor-sdk/kit/stories-scope';
import { LIVE_ONLY_ACK, NO_PERSISTABLE_CHILD_DESTINATION } from '@volter/editor-sdk/kit/write-pipe';

/** One child world's authoring adapter, ordered as given to the constructor. */
export interface CompositeChild {
  /** Manifest world id (T3.1) — becomes the group node id `world:<worldId>`. */
  readonly worldId: string;
  /** World render substrate kind — shown in the group node's label. */
  readonly kind: string;
  /** Runtime manifest roots are the default. A nested authoring surface is
   * adapter-owned content of its parent world, not another runtime world. */
  readonly role?: 'world' | 'surface';
  /** Optional user-facing label for a nested authoring surface. */
  readonly label?: string;
  readonly adapter: AuthoringAdapter;
  /**
   * D12 (B4) — the world's INSTALL-TIME manifest zOrder (`world.zOrder ?? 0`),
   * independent of this child's position in the constructor's array. Absent
   * (every pre-B4 call site) ⇒ `childAdapters()` falls back to the array
   * index, today's behavior unchanged. See `childAdapters()`'s own doc
   * comment for why this stopped being "array order doubles as z-order" and
   * what "install-time" means here.
   */
  readonly zOrder?: number;
  /** Manifest pausing policy, retained for read-only play-mode inspection. */
  readonly pausable?: boolean;
  /** Adapter-owned content declaration, retained for play-mode inspection. */
  readonly content?: string;
  /**
   * Nest this child's group node UNDER another child's group node instead
   * of directly in the hierarchy root list. Used by the scene-UI child
   * (`edit-mode-authoring.ts`'s UI child, `kind: 'scene-ui'`) to appear
   * "under its owning world" in the ONE hierarchy, per the C3 spec text.
   * Absent ⇒ today's flat top-level shape, unchanged.
   */
  readonly parentRootId?: string;
}

function childAssetEntries(adapter: AuthoringAdapter) {
  const provider = adapter.assetSubject;
  if (!provider) return [];
  const declared = provider.entries?.();
  if (declared) return declared;
  const entries: Array<{
    id: string;
    subject: NonNullable<ReturnType<AssetSubjectProvider['get']>>;
  }> = [];
  forEachHierarchyNode(adapter.hierarchy, (node) => {
    const subject = provider.get(node.id);
    if (subject) entries.push({ id: node.id, subject });
  });
  return entries;
}

const GROUP_PREFIX = 'world:';
const KIND_PREFIX = 'kind:';
const PROJECTION_PREFIX = 'projection:';

/**
 * Display label per root KIND — what the host hands the root, never which
 * library the root chose.
 *
 * This used to read `pixijs: 'PixiJS'` / `react: 'React'`, which the kind
 * vocabulary makes a lie: a `canvas` root may be Pixi, Phaser, Babylon, raw
 * WebGL/WebGPU or a 2D context, and a `dom` root may be React, Vue, Svelte or
 * plain HTML. The host cannot know, and labelling it "PixiJS" would tell a
 * Phaser author something false about their own game.
 *
 * `three` is the exception on purpose — that kind is DEFINED by the shared
 * `three` instance the host provides, so naming it is honest.
 *
 * An adapter that wants to say "Pixi" here can: it knows what it is, and the
 * label belongs to it rather than to this table.
 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  three: 'Three.js',
  canvas: 'Canvas',
  dom: 'DOM',
};

function groupNodeId(worldId: string): string {
  return `${GROUP_PREFIX}${worldId}`;
}

/**
 * The refusal sentence for an id no child owns — named here (not inlined at
 * each call site) so the console message, the thrown `transforms.get` error and
 * the `editor.select` door all say the SAME thing: which resolver rejected it,
 * which id, and which worlds actually exist.
 */
export function unownedIdRefusal(
  operation: string,
  id: string,
  children: ReadonlyArray<{ readonly worldId: string }>,
): string {
  return (
    `[CompositeAuthoringAdapter] ${operation}: no root owns entity id "${id}". ` +
    `Roots in this composition: ${children.map((c) => c.worldId).join(', ')}. ` +
    `Refusing rather than answering from the first root — an id nothing owns has no subject.`
  );
}

/**
 * The refusal sentence for an id a child DOES own but has no transform truth
 * for — the other half of {@link unownedIdRefusal}. Ownership answers "which
 * root", not "does that root pose this node": a child adapter may expose no
 * `TransformProvider` at all (the interface makes it optional), and answering
 * an identity pose there is a fabricated subject, not a degrade. `dimensions`
 * already returns `null` for this case so the Transform section never renders;
 * this is what the non-nullable `get` says when a caller reaches it anyway.
 */
export function untransformedIdRefusal(operation: string, id: string, worldId: string): string {
  return (
    `[CompositeAuthoringAdapter] ${operation}: root "${worldId}" owns entity id "${id}" but ` +
    'exposes no transform provider for it. Refusing rather than answering an identity pose — ' +
    'a node with no transform truth has no pose to report.'
  );
}

/** True for a synthetic group-node id this Composite itself manufactures (never
 *  produced by a child adapter — the `world:` prefix is reserved for this use). */
function isGroupNodeId(id: string): boolean {
  return id.startsWith(GROUP_PREFIX);
}

function kindNodeId(kind: string): string {
  return `${KIND_PREFIX}${kind}`;
}

function projectionNodeId(id: string): string {
  return `${PROJECTION_PREFIX}${id}`;
}

function isOrganizationNodeId(id: string): boolean {
  return id.startsWith(KIND_PREFIX) || id.startsWith(PROJECTION_PREFIX);
}

function humanizeId(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words.replace(/\b\w/g, (letter) => letter.toUpperCase()) : id;
}

/**
 * Manifest-backed properties on each authored root, implemented by
 * `edit-mode-authoring.ts`'s `ManifestAuthoring` over the RAW `vgai.project.json`
 * (read-modify-write, never round-tripped through Zod). Defined here (not
 * imported from `edit-mode-authoring.ts`) to avoid a circular import — that
 * module already imports `CompositeAuthoringAdapter`.
 */
export interface RootManifestProvider {
  /** Adapter-owned content declaration shown on the world boundary (for
   * example `Entry · src/world.tsx` or `Entry · src/ui/App.tsx`). */
  getRootContentSource?(worldId: string): string | undefined;
  getRootZOrder(worldId: string): number;
  setRootZOrder(worldId: string, value: number): void;
  getRootPausable(worldId: string): boolean;
  setRootPausable(worldId: string, value: boolean): void;
}

/** OR every child's capabilities together — a feature is offered if ANY
 *  child supports it (the editor gates per-node via the routed adapter
 *  anyway). Factored out of the constructor (B1) so {@link
 *  CompositeAuthoringAdapter.replaceChild} can recompute it after an
 *  in-place child swap without duplicating the reduce. */
function computeCapabilities(children: ReadonlyArray<CompositeChild>): AuthoringCapabilities {
  return children.reduce<AuthoringCapabilities>(
    (acc, c) => ({
      transform: acc.transform || c.adapter.capabilities.transform,
      inspectorFields: acc.inspectorFields || c.adapter.capabilities.inspectorFields,
      persist: acc.persist || c.adapter.capabilities.persist,
    }),
    {
      transform: false,
      inspectorFields: false,
      persist: false,
    },
  );
}

export class CompositeAuthoringAdapter implements AuthoringAdapter {
  /** NOT `readonly` (interface-level `readonly` is a consumer contract, not a
   *  ban on internal reassignment) — B1's {@link replaceChild} recomputes
   *  this after an in-place child swap (e.g. a world's design-time layer
   *  mounting successfully upgrades its Boundary adapter to a live one). */
  capabilities: AuthoringCapabilities;
  /**
   * NOT `ReadonlyArray` (B1): {@link replaceChild} mutates ONE element of
   * this array in place, preserving both the array's own identity-adjacent
   * invariants (length, index/z-order) and — critically — THIS composite's
   * OWN object identity, which `world-root-stage.ts`'s teardown-identity
   * capture, `exitEditModeAuthoring`'s installed-instance check, and the
   * `markEditModeOverride` brand all key off. A REBUILT composite (a new
   * `CompositeAuthoringAdapter` instance) would silently break all three —
   * see this class's own doc comment and `edit-mode-authoring.ts`'s. Copied
   * (`[...children]`) out of the constructor's `ReadonlyArray` parameter so
   * mutating it here never aliases a caller's own array.
   */
  private readonly children: CompositeChild[];
  /** Optional writable manifest surface for world composition properties.
   * Runtime still has one semantic Game root; the authoring hierarchy does not
   * mirror that project-level wrapper because the editor chrome already owns it. */
  private readonly manifest: RootManifestProvider | null;
  /** Optional editor-only organization; never consulted by runtime mounting. */
  private readonly projection: HierarchyProjection | null;
  private readonly resolvedProjectionGroups: Array<HierarchyProjectionGroup & { roots: string[] }>;
  /** Which child owns the session's last successful structural copy/cut. The
   * payload itself stays inside that adapter; the composite remembers only the
   * routing fact needed after selection moves. */
  private structureClipboardWorldId: string | null = null;
  /** Cross-root authored edges rebuilt once at the start of each hierarchy read. */
  private crossSurfaceParents = new Map<string, string>();
  private crossSurfaceChildren = new Map<string, string[]>();
  private crossSurfaceOrders = new Map<string, number>();
  private crossSurfaceRootParents = new Map<string, string>();
  private crossSurfaceRootChildren = new Map<string, string[]>();
  private crossSurfaceGroupLabels = new Map<string, string>();
  /** A DOM semantic host may render OID-stamped implementation elements
   * between source-owned semantic rows. These maps make those wrappers
   * transparent only inside an explicitly identified cross-surface subtree. */
  private crossSurfaceDomParents = new Map<string, string>();
  private crossSurfaceDomChildren = new Map<string, string[]>();
  private crossSurfaceInputSignatures: ReadonlyArray<string | null> | null = null;
  /** Stable panel views for a native root that belongs to one explicit
   * cross-surface semantic document. The proxy changes only `hierarchy`; every
   * provider and capability remains this composite's live routed seam. */
  private readonly projectedDocumentAdapters = new Map<string, AuthoringAdapter>();

  /** Stable routing object. A composite can gain/lose a capable child through
   * `replaceChild`, so its provider remains present and honestly returns no
   * layers while none of the current children implements the seam. */
  readonly spatialHandles: SpatialHandlesProvider = {
    layers: (id) => this.routeOwned(id, 'spatialHandles.layers')?.spatialHandles?.layers(id) ?? [],
    preview: (id, handleId, worldPosition) => {
      this.routeOwned(id, 'spatialHandles.preview')?.spatialHandles?.preview(
        id,
        handleId,
        worldPosition,
      );
    },
    commit: (id, handleId, worldPosition) =>
      this.routeOwned(id, 'spatialHandles.commit')?.spatialHandles?.commit(
        id,
        handleId,
        worldPosition,
      ),
  };

  /**
   * N-ary (T6.1 slice 3): an ordered `{ worldId, kind, adapter }[]` — one group
   * node per entry, in array order.
   *
   * `manifest` is an optional writable provider. Omitting it leaves root
   * composition properties read-only.
   */
  constructor(
    children: ReadonlyArray<CompositeChild>,
    manifest?: RootManifestProvider,
    projection?: HierarchyProjection,
  ) {
    this.children = [...children];
    this.manifest = manifest ?? null;
    this.projection = projection ?? null;
    // Zero children is a real state (ARCHITECTURE-CORE §Roots: a project may
    // declare no roots); every answer below degrades to its honest empty one.
    this.resolvedProjectionGroups = this.resolveProjectionGroups();
    this.capabilities = computeCapabilities(this.children);
    this.refreshTruth();
    this.refreshRelated();
  }

  /**
   * B1 — swap `worldId`'s child adapter IN PLACE (the design-time layer
   * mount's "adapter upgrade": a world's read-only `BoundaryAuthoringAdapter`
   * is replaced by a live one — react: `ReactRootAuthoringAdapter` — once its
   * layer mounts successfully; a layer that fails/throws rebuilds the
   * Boundary with the caught reason, also through this method). Mutates the
   * existing children array (preserving array order — z-order/`childAdapters()`
   * index is unaffected) and recomputes `capabilities`, rather than
   * constructing a new `CompositeAuthoringAdapter` — a rebuild would break
   * `world-root-stage.ts`'s captured teardown identity, `exitEditModeAuthoring`'s
   * installed-instance check, and the `markEditModeOverride` brand, all of
   * which key off THIS instance's identity (see the class doc comment).
   *
   * No-op (loud warn, #18 discipline) when `worldId` doesn't name an existing
   * child — never silently routes to the wrong world or grows the array.
   * Callers are responsible for their own side effects around the swap
   * (`store.notifyIngestEdit()` so panels re-render against the new child) —
   * this method only owns the swap + capability recompute.
   */
  replaceChild(worldId: string, adapter: AuthoringAdapter): void {
    const index = this.children.findIndex((c) => c.worldId === worldId);
    if (index === -1) {
      editorConsole.warn(
        `[CompositeAuthoringAdapter] replaceChild: no child with worldId "${worldId}" — ignoring.`,
        'authoring',
      );
      return;
    }
    // D12 (B4) — carry the outgoing child's `zOrder` forward too (not just
    // `kind`): a swap must not silently reset a world's install-time zOrder
    // back to "no override" (array-index fallback). Built conditionally (not
    // `{ ..., zOrder }`) because `zOrder` is an OPTIONAL property under this
    // repo's `exactOptionalPropertyTypes` — an explicit `zOrder: undefined`
    // is not the same as an absent property to the type checker.
    const previous = this.children[index]!;
    this.children[index] = { ...previous, worldId, adapter };
    this.crossSurfaceInputSignatures = null;
    this.capabilities = computeCapabilities(this.children);
    // The swap can bring a truth resolver in (a Boundary upgrading to a
    // live adapter) or take the last one away — same recompute, same reason.
    this.refreshTruth();
    this.refreshRelated();
    // An id the outgoing child did not own may be owned by the incoming one.
    this.refusedIds.clear();
    // Re-point every live subscription at the NEW child set, then tell the
    // subscribers — the swap is itself the "this world finished mounting"
    // structure change (see the change fan-out section below).
    this.syncChildFanOut();
    this.fanOutStructure();
  }

  /** The group node id for a given child (exposed for callers building
   *  post-construction selection/expansion state — e.g. tests, e2e hooks). */
  groupNodeId(worldId: string): string {
    return groupNodeId(worldId);
  }

  /** True for a read-only shell node manufactured only for hierarchy layout. */
  isOrganizationNode(nodeId: string): boolean {
    return isOrganizationNodeId(nodeId);
  }

  /** The child that owns `id` — by ACTUAL ownership (its hierarchy resolves the
   *  id), not by any prefix convention. `null` for a group-node id or an id no
   *  child recognizes. O(children) per call; fine at editor-UI scale, and avoids
   *  a cache that could go stale as a live tree adds/removes nodes. */
  private findOwnerChild(id: string): CompositeChild | null {
    if (isGroupNodeId(id) || isOrganizationNodeId(id)) return null;
    for (const child of this.children) {
      if (child.adapter.hierarchy.node(id)) return child;
    }
    return null;
  }

  /** Ids already refused, so a bogus selection that survives across renders logs
   *  its refusal ONCE instead of once per row per notify. Cleared whenever the
   *  child set changes ({@link replaceChild}) — the same id can become real. */
  private readonly refusedIds = new Set<string>();

  /**
   * Every real id this composite has ever OBSERVED or ROUTED successfully — the memory that
   * separates "a row from a previous mount epoch" from "a subject that never
   * existed", so only the second one is an error.
   *
   * The refusal below exists for a subject that does not exist
   * (`editor.select('Player')`). An id that a PREVIOUS mount epoch really did
   * own is a different fact: the row existed, the caller read it from this
   * composite's own hierarchy, and then Play (or a design-time layer upgrade)
   * swapped the child underneath it. That is the ordinary shape of a remount,
   * and ARCHITECTURE-CORE says so directly — "receipts from an old adapter
   * object/mount epoch never grade the replacement".
   *
   * It is unavoidable for an ingest root specifically, and that is what made it
   * visible: an ingested world has no source oids, so `projection/three.ts`
   * mints `live:<worldId>:<n>` from a session counter against the Object3D
   * IDENTITIES it walked. A remount builds new Object3Ds, so every id is new by
   * construction — nothing can carry them across, the way `r3f:<worldId>:<oid>`
   * carries across for a source-stamped world.
   *
   * MEASURED on the vendored `racing-game` ingest: six
   * `[CompositeAuthoringAdapter] inspector.get: no root owns entity id
   * "live:racing-game:N"` errors in three of four `vgai doctor` runs, every one
   * of them within two seconds of ▶ — `GameHierarchy` re-rendering rows it read
   * before the swap against the children that came after it, one render before
   * its own row rebuild lands. (Flaky precisely because it is a race.)
   *
   * Recorded when this hierarchy resolves a row and when a provider routes it,
   * rather than snapshotted from the outgoing child at {@link replaceChild},
   * and that is not a shortcut: both swap paths dispose
   * the old mount BEFORE they replace it (`design-time-layers.ts`'s
   * `suspendForPlay` calls `disposeEverything()` first; `r3f-design-session.ts`
   * calls `disposeMounted()` first), so walking the outgoing adapter's
   * hierarchy at swap time would read a disposed stage. Hierarchy-time capture
   * is essential: a consumer can resolve/render a row and lose the race to the
   * swap before its FIRST provider request (`hierarchy.object3D` exposed this
   * exact ordering in Doctor). Provider-time capture remains for callers that
   * route a real id without first resolving its row. Both cost one `Set.add`.
   *
   * Never cleared: an id this composite has SEEN is a real id forever, and the
   * set is bounded by the rows one session actually mounted.
   */
  private readonly supersededIds = new Set<string>();

  /**
   * ONE resolver for "which child owns this id?", and the ONLY door into a
   * child adapter for a caller holding a raw id.
   *
   * There used to be a floor here: an id no child owned fell through to
   * `children[0]`, "so callers that pass a bogus id get inert/default responses
   * rather than a throw". They did not. The first child answered AS IF it owned
   * the id, and the composite's own `transforms.get` `??`-default then handed
   * back `{position:[0,0,0], rotation:[0,0,0,1], scale:[1,1,1]}` — so
   * `editor.select('Player')`, a string no world has ever heard of, produced a
   * fully-populated inspector reading all zeros. That is the anti-shim rule's
   * exact failure: the adapter fabricated first-party data for a subject that
   * does not exist. An id nothing owns is now REFUSED, loudly and by name, and
   * every caller below degrades to its honest empty answer.
   */
  private routeOwned(id: string, operation: string): AuthoringAdapter | null {
    const owner = this.findOwnerChild(id);
    if (owner) {
      // This id is real, now. Remembering that is what lets a later miss on it
      // be read as a superseded row rather than a bogus subject — see
      // {@link supersededIds}.
      this.supersededIds.add(id);
      return owner.adapter;
    }
    // A row THIS COMPOSITE MANUFACTURED is not a bogus id. A group node has no
    // live object by construction — that is what makes it a group node — so
    // "no child owns it" is the expected answer here, and the caller's own
    // empty degrade is the right one. The refusal above exists for a subject
    // that does not exist (`editor.select('Player')`); shouting it for the
    // composite's own root row says something false about the editor to the
    // person who merely clicked that row. Every provider with a real answer
    // for these rows already intercepts them ahead of this call
    // (`rootProperties`, `inspector.get`/`set`/`editability`); the rest —
    // `spatialHandles`, `transforms`, `instances`, `assetDrop`, `stories` —
    // have nothing to hand back, which is exactly `null`.
    //
    // MEASURED as two console errors in one session on a packaged build over
    // a canvas ingest root with a DOM UI beside it — `inspector.editability`
    // and then, once that one answered for itself, `spatialHandles.layers` —
    // on the same id, `world:probe-canvas:canvas`. Fixing the providers one at
    // a time was fixing instances of this.
    //
    // A synthetic id naming a row this composition does NOT have still
    // refuses: a stale selection outliving a root removal, or a projection
    // group deleted from the manifest, is a subject nothing owns — exactly
    // what the refusal is for. So the quiet answer is gated on the row
    // EXISTING, not on the id's prefix: `world:` against the current children,
    // `kind:`/`projection:` against `hierarchy.node`, which is this class's own
    // answer to "is this a row of mine?" (a `kind:` node exists only where a
    // kind has >1 unprojected root; a `projection:` node only for a group the
    // manifest still declares). Asking the hierarchy rather than restating its
    // rules is what keeps the two from drifting; both branches are O(children)
    // and walk no child scene.
    if (this.groupChild(id) || (isOrganizationNodeId(id) && this.hierarchy.node(id))) return null;
    // An id a replaced child really did own is a superseded row, not a subject
    // that never existed — quiet, and the caller's own empty degrade is right.
    if (this.supersededIds.has(id)) return null;
    if (!this.refusedIds.has(id)) {
      this.refusedIds.add(id);
      editorConsole.error(unownedIdRefusal(operation, id, this.children), 'authoring');
    }
    return null;
  }

  /** PUBLIC ownership query (T0 — A3's inspector dispatch and B4's pick routing
   *  both need it): the `worldId` of the child that owns `id`, or `null` for a
   *  group-node id or an id no child recognizes. */
  ownerOf(id: string): string | null {
    return this.findOwnerChild(id)?.worldId ?? null;
  }

  /**
   * PUBLIC read-only view of the wrapped children (T0), ordered as constructed.
   *
   * `zOrder` is EACH CHILD'S OWN `CompositeChild.zOrder` (the world's
   * install-time manifest zOrder) when supplied, falling back to the array
   * index otherwise. Array order is NOT z-order (D12/B4 correction of this
   * doc comment's former claim): children are built in MANIFEST DECLARATION
   * order (`edit-mode-authoring.ts`), not stacking order — paint/pick order is
   * `stackOrder` over each child's manifest zOrder (mirroring
   * `create-runtime.ts`'s real stacking pass and `design-time-layers.ts`'s
   * layer z-index assignment), which is exactly why this field exists.
   * "Install-time" — the zOrder captured when this composite/child was built,
   * not a live subscription: a world's zOrder edited afterward (the generic
   * inspector's `zOrder` property, `A4`/D8) does NOT retroactively reorder an
   * already-mounted design-time layer stack or an already-computed pick walk
   * order this call returns; both settle to the new order the next time the
   * composite/layers are rebuilt. Callers that need the LIVE manifest value
   * (e.g. `GameHierarchy.tsx`'s zOrder badge) read it from the manifest
   * surface directly instead of trusting this field alone — see
   * `compositeGroupBadge`'s own comment.
   */
  childAdapters(): ReadonlyArray<{
    worldId: string;
    adapter: AuthoringAdapter;
    kind: string;
    zOrder: number;
    role: 'world' | 'surface';
    label?: string;
    parentRootId?: string;
  }> {
    return this.children.map((c, index) => ({
      worldId: c.worldId,
      adapter: c.adapter,
      kind: c.kind,
      zOrder: c.zOrder ?? index,
      role: c.role ?? 'world',
      ...(c.label !== undefined ? { label: c.label } : {}),
      ...(c.parentRootId !== undefined ? { parentRootId: c.parentRootId } : {}),
    }));
  }

  /**
   * The semantic document containing `worldId`, when the manifest explicitly
   * groups that native root with at least one other surface.
   *
   * A Scene panel ordinarily scopes to its native Three child. That loses an
   * authored DOM/canvas child whose semantic parent is in Three, even though
   * this composite already owns the exact cross-surface edge. This view keeps
   * all provider routing on the composite and narrows only the hierarchy roots
   * to the declared group, so unrelated scenes remain outside the document.
   */
  projectedDocumentAdapter(worldId: string): AuthoringAdapter | null {
    const group = this.resolvedProjectionGroups.find(
      (candidate) => candidate.roots.length > 1 && candidate.roots.includes(worldId),
    );
    if (!group) return null;
    const cached = this.projectedDocumentAdapters.get(group.id);
    if (cached) return cached;

    const hierarchy: HierarchyProvider = {
      ...this.hierarchy,
      roots: () => {
        this.ensureCrossSurfaceEdges();
        return [this.projectionGroupNode(group)];
      },
    };
    const projected = new Proxy(this, {
      get: (target, property) =>
        property === 'hierarchy' ? hierarchy : Reflect.get(target, property, target),
    });
    this.projectedDocumentAdapters.set(group.id, projected);
    return projected;
  }

  /**
   * C3 — a child declared with `parentRootId` nests its group node UNDER
   * that parent's group node instead of at the top level: the parent's
   * `parentId` resolution below picks up the nested group id automatically
   * (`this.children.find(...).parentRootId`), and this method also appends
   * every child NESTED under `worldId` (in declaration order) to the END of
   * `childIds`, after `worldId`'s own adapter roots — so e.g. a `scene-ui`
   * child appears as a trailing "ui (scene-ui)" row under its owning world.
   */
  private groupNode(worldId: string, kind: string, childRoots: EditorNode[]): EditorNode {
    const self = this.children.find((c) => c.worldId === worldId);
    const parentId = self?.parentRootId
      ? groupNodeId(self.parentRootId)
      : this.parentForTopLevelRoot(worldId, kind);
    const nestedGroupIds = this.children
      .filter((c) => c.parentRootId === worldId)
      .map((c) => groupNodeId(c.worldId));
    return {
      id: groupNodeId(worldId),
      label:
        self?.role === 'surface'
          ? (self.label ?? `${worldId} (${kind})`)
          : this.labelForRoot(worldId, kind),
      role: self?.role === 'surface' ? 'document' : 'root',
      kind,
      parentId,
      childIds: [...childRoots.map((r) => r.id), ...nestedGroupIds],
    };
  }

  /** C3 — every child NOT nested under another (`parentRootId` unset): the
   *  top-level group set. A nested child is reached only via its
   *  parent's `childIds` (`groupNode` above), never listed here too — a node
   *  in two parents' `childIds` would render twice / cycle the row walk. */
  private topLevelChildren(): CompositeChild[] {
    return this.children.filter((c) => !c.parentRootId);
  }

  private runtimeRootChildren(): CompositeChild[] {
    return this.topLevelChildren().filter((c) => (c.role ?? 'world') === 'world');
  }

  private resolveProjectionGroups(): Array<HierarchyProjectionGroup & { roots: string[] }> {
    const known = new Set(this.runtimeRootChildren().map((child) => child.worldId));
    const placed = new Set<string>();
    return (this.projection?.groups ?? []).flatMap((group) => {
      const roots = group.roots.filter((rootId) => {
        if (!known.has(rootId)) {
          editorConsole.warn(
            `[CompositeAuthoringAdapter] hierarchy group "${group.label}" references unknown root "${rootId}" — ignoring.`,
            'authoring',
          );
          return false;
        }
        if (placed.has(rootId)) {
          editorConsole.warn(
            `[CompositeAuthoringAdapter] hierarchy root "${rootId}" is referenced by more than one group; the tree projection uses its first placement.`,
            'authoring',
          );
          return false;
        }
        placed.add(rootId);
        return true;
      });
      return roots.length > 0 ? [{ ...group, roots }] : [];
    });
  }

  private projectionGroups(): Array<HierarchyProjectionGroup & { roots: string[] }> {
    return this.resolvedProjectionGroups;
  }

  private projectionGroupFor(worldId: string): HierarchyProjectionGroup | undefined {
    return this.projectionGroups().find((group) => group.roots.includes(worldId));
  }

  private unprojectedRoots(): CompositeChild[] {
    const projected = new Set(this.projectionGroups().flatMap((group) => group.roots));
    return this.runtimeRootChildren().filter((child) => !projected.has(child.worldId));
  }

  private rootsOfKind(kind: string): CompositeChild[] {
    return this.unprojectedRoots().filter((child) => child.kind === kind);
  }

  private parentForTopLevelRoot(worldId: string, kind: string): string | null {
    const group = this.projectionGroupFor(worldId);
    if (group) return projectionNodeId(group.id);
    return this.rootsOfKind(kind).length > 1 ? kindNodeId(kind) : null;
  }

  private labelForRoot(worldId: string, kind: string): string {
    const configured = this.projection?.rootLabels?.[worldId]?.trim();
    if (configured) return configured;
    return this.rootsOfKind(kind).length === 1 && !this.projectionGroupFor(worldId)
      ? (KIND_LABELS[kind] ?? humanizeId(kind))
      : humanizeId(worldId);
  }

  private kindNode(kind: string): EditorNode {
    return {
      id: kindNodeId(kind),
      label: KIND_LABELS[kind] ?? humanizeId(kind),
      role: 'folder',
      kind: 'group',
      parentId: null,
      childIds: this.rootsOfKind(kind).map((child) => groupNodeId(child.worldId)),
    };
  }

  private projectionGroupNode(group: HierarchyProjectionGroup & { roots: string[] }): EditorNode {
    return {
      id: projectionNodeId(group.id),
      label: this.crossSurfaceGroupLabels.get(group.id) ?? group.label,
      role: 'folder',
      kind: 'group',
      parentId: null,
      childIds: this.crossSurfaceRootChildren.get(group.id) ?? group.roots.map(groupNodeId),
    };
  }

  private orderJoinedSiblings(childIds: readonly string[]): string[] {
    return childIds
      .map((id, index) => ({ id, index, order: this.crossSurfaceOrders.get(id) }))
      .sort((left, right) => {
        if (left.order === undefined && right.order === undefined) return left.index - right.index;
        if (left.order === undefined) return 1;
        if (right.order === undefined) return -1;
        return left.order - right.order || left.index - right.index;
      })
      .map(({ id }) => id);
  }

  /**
   * A projected group may span several native adapters while its source owns
   * one sibling list. Lift only rows that explicitly carry a semantic identity
   * and ordinal, and only after every contributing adapter has mounted one;
   * until then the ordinary adapter group rows remain intact.
   */
  private refreshCrossSurfaceRoots(
    nodes: ReadonlyArray<{ child: CompositeChild; node: EditorNode }>,
    semanticIds: ReadonlyMap<string, { child: CompositeChild; nodeId: string } | null>,
  ): void {
    this.crossSurfaceRootParents.clear();
    this.crossSurfaceRootChildren.clear();
    this.crossSurfaceGroupLabels.clear();
    const nodesByChild = new Map<CompositeChild, Map<string, EditorNode>>();
    for (const { child, node } of nodes) {
      const owned = nodesByChild.get(child) ?? new Map<string, EditorNode>();
      owned.set(node.id, node);
      nodesByChild.set(child, owned);
    }

    for (const group of this.projectionGroups()) {
      const participatingWorlds = new Set(group.roots);
      const liveLabels = new Set(
        nodes.flatMap(({ child, node }) => {
          const label = node.crossSurfaceGroupLabel?.trim();
          return participatingWorlds.has(child.worldId) && label ? [label] : [];
        }),
      );
      if (liveLabels.size === 1) this.crossSurfaceGroupLabels.set(group.id, [...liveLabels][0]!);
      if (group.roots.length < 2) continue;
      const candidates = nodes.filter(({ child, node }) => {
        if (
          !participatingWorlds.has(child.worldId) ||
          node.crossSurfaceId === undefined ||
          node.crossSurfaceOrder === undefined ||
          node.crossSurfaceParentId !== undefined ||
          semanticIds.get(node.crossSurfaceId)?.nodeId !== node.id
        ) {
          return false;
        }
        let parentId = node.parentId;
        const owned = nodesByChild.get(child);
        while (parentId !== null) {
          const parent = owned?.get(parentId);
          if (parent === undefined) break;
          if (parent.crossSurfaceId !== undefined) return false;
          parentId = parent.parentId;
        }
        return true;
      });
      // A surface may contribute only descendants whose authored parents live on another
      // surface. Requiring a top-level candidate from every adapter leaves those already-joined
      // rows hidden behind synthetic native-root folders. Participation is therefore proven by
      // any unique semantic row; only the union-level roots themselves become group children.
      const mountedWorlds = new Set(
        nodes.flatMap(({ child, node }) =>
          participatingWorlds.has(child.worldId) &&
          node.crossSurfaceId !== undefined &&
          semanticIds.get(node.crossSurfaceId)?.nodeId === node.id
            ? [child.worldId]
            : [],
        ),
      );
      if (group.roots.some((worldId) => !mountedWorlds.has(worldId))) continue;
      if (candidates.length === 0) continue;
      const childIds = this.orderJoinedSiblings(candidates.map(({ node }) => node.id));
      this.crossSurfaceRootChildren.set(group.id, childIds);
      const parentId = projectionNodeId(group.id);
      for (const childId of childIds) this.crossSurfaceRootParents.set(childId, parentId);
    }
  }

  /**
   * Project the source-owned DOM semantic tree rather than the implementation
   * DOM a semantic host component happens to render.
   *
   * Ordinary React/HTML authoring is unchanged: folding starts only below a
   * DOM row carrying an explicit `crossSurfaceId`. Within that subtree, the
   * nearest descendant rows carrying their own identities become its authored
   * children and intervening OID rows are transparent. This is the DOM half of
   * the same cross-surface contract the edge join already consumes; it does
   * not infer a framework or library from tag names.
   */
  private refreshCrossSurfaceDomTrees(
    nodes: ReadonlyArray<{ child: CompositeChild; node: EditorNode }>,
  ): void {
    this.crossSurfaceDomParents.clear();
    this.crossSurfaceDomChildren.clear();

    for (const child of this.children) {
      if (child.kind !== 'dom') continue;
      const owned = new Map(
        nodes
          .filter((candidate) => candidate.child === child)
          .map(({ node }) => [node.id, node] as const),
      );
      const roots = [...owned.values()].filter((node) => node.parentId === null);
      const visited = new Set<string>();
      const visit = (node: EditorNode, semanticParentId: string | null): void => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        let nextSemanticParentId = semanticParentId;
        if (node.crossSurfaceId !== undefined) {
          this.crossSurfaceDomChildren.set(node.id, []);
          if (semanticParentId !== null) {
            this.crossSurfaceDomParents.set(node.id, semanticParentId);
            this.crossSurfaceDomChildren.get(semanticParentId)?.push(node.id);
          }
          nextSemanticParentId = node.id;
        }
        for (const childId of node.childIds) {
          const descendant = owned.get(childId);
          if (descendant) visit(descendant, nextSemanticParentId);
        }
      };
      for (const root of roots) visit(root, null);
    }
  }

  /**
   * Join only explicit project-owned semantic edges. Native parentage stays
   * adapter-owned; this adds the one relationship a substrate cannot express:
   * a DOM/canvas row authored beneath a Three row (or any other pair of roots).
   */
  private refreshCrossSurfaceEdges(): void {
    const nodes: Array<{ child: CompositeChild; node: EditorNode }> = [];
    const ids = new Map<string, { child: CompositeChild; nodeId: string } | null>();
    for (const child of this.children) {
      forEachHierarchyNode(child.adapter.hierarchy, (node) => {
        nodes.push({ child, node });
        if (node.crossSurfaceId === undefined) return;
        const previous = ids.get(node.crossSurfaceId);
        ids.set(node.crossSurfaceId, previous === undefined ? { child, nodeId: node.id } : null);
      });
    }
    this.crossSurfaceParents.clear();
    this.crossSurfaceChildren.clear();
    this.crossSurfaceOrders.clear();
    for (const { node } of nodes) {
      if (node.crossSurfaceOrder !== undefined) {
        this.crossSurfaceOrders.set(node.id, node.crossSurfaceOrder);
      }
    }
    this.refreshCrossSurfaceDomTrees(nodes);
    for (const { child, node } of nodes) {
      if (node.crossSurfaceParentId === undefined) continue;
      const parent = ids.get(node.crossSurfaceParentId);
      if (parent === undefined || parent === null || parent.child === child) continue;
      this.crossSurfaceParents.set(node.id, parent.nodeId);
      const children = this.crossSurfaceChildren.get(parent.nodeId) ?? [];
      children.push(node.id);
      this.crossSurfaceChildren.set(parent.nodeId, children);
    }
    this.refreshCrossSurfaceRoots(nodes, ids);
  }

  private clearCrossSurfaceEdges(): void {
    this.crossSurfaceParents.clear();
    this.crossSurfaceChildren.clear();
    this.crossSurfaceOrders.clear();
    this.crossSurfaceRootParents.clear();
    this.crossSurfaceRootChildren.clear();
    this.crossSurfaceGroupLabels.clear();
    this.crossSurfaceDomParents.clear();
    this.crossSurfaceDomChildren.clear();
  }

  /** Refresh semantic joins only when a child reports that the fields which
   * define those joins changed. Ordinary native hierarchy churn still flows
   * through each child's own provider; it simply cannot affect these maps. */
  private ensureCrossSurfaceEdges(): void {
    const signatures: Array<string | null> = [];
    for (const child of this.children) {
      const signature = child.adapter.hierarchy.crossSurfaceStructureSignature;
      if (!signature) {
        this.crossSurfaceInputSignatures = null;
        this.refreshCrossSurfaceEdges();
        return;
      }
      signatures.push(signature.call(child.adapter.hierarchy));
    }
    if (
      this.crossSurfaceInputSignatures !== null &&
      signatures.length === this.crossSurfaceInputSignatures.length &&
      signatures.every((value, index) => value === this.crossSurfaceInputSignatures?.[index])
    ) {
      return;
    }
    this.crossSurfaceInputSignatures = signatures;
    if (signatures.every((signature) => signature === null)) {
      this.clearCrossSurfaceEdges();
      return;
    }
    this.refreshCrossSurfaceEdges();
  }

  private projectCrossSurfaceNode(node: EditorNode, defaultParentId: string | null): EditorNode {
    const parentId =
      this.crossSurfaceParents.get(node.id) ??
      this.crossSurfaceDomParents.get(node.id) ??
      this.crossSurfaceRootParents.get(node.id) ??
      defaultParentId;
    const nativeChildIds = this.crossSurfaceDomChildren.get(node.id) ?? node.childIds;
    const childIds = this.orderJoinedSiblings(
      nativeChildIds
        .filter(
          (childId) =>
            !this.crossSurfaceParents.has(childId) && !this.crossSurfaceRootParents.has(childId),
        )
        .concat(this.crossSurfaceChildren.get(node.id) ?? []),
    );
    return parentId === node.parentId &&
      childIds.length === node.childIds.length &&
      childIds.every((childId, index) => childId === node.childIds[index])
      ? node
      : { ...node, parentId, childIds };
  }

  private defaultProjectionNodeIds(): string[] {
    const ids: string[] = [];
    const seenKinds = new Set<string>();
    for (const child of this.unprojectedRoots()) {
      if (seenKinds.has(child.kind)) continue;
      seenKinds.add(child.kind);
      const peers = this.rootsOfKind(child.kind);
      ids.push(peers.length > 1 ? kindNodeId(child.kind) : groupNodeId(child.worldId));
    }
    return ids;
  }

  readonly hierarchy: HierarchyProvider = {
    roots: (): EditorNode[] => {
      this.ensureCrossSurfaceEdges();
      return [
        ...this.projectionGroups().map((group) => this.projectionGroupNode(group)),
        ...this.defaultProjectionNodeIds()
          .map((id) => this.hierarchy.node(id))
          .filter((node): node is EditorNode => node !== null),
      ];
    },
    node: (id) => {
      if (id.startsWith(KIND_PREFIX)) {
        const kind = id.slice(KIND_PREFIX.length);
        return this.rootsOfKind(kind).length > 1 ? this.kindNode(kind) : null;
      }
      if (id.startsWith(PROJECTION_PREFIX)) {
        const groupId = id.slice(PROJECTION_PREFIX.length);
        const group = this.projectionGroups().find((candidate) => candidate.id === groupId);
        return group ? this.projectionGroupNode(group) : null;
      }
      if (isGroupNodeId(id)) {
        const worldId = id.slice(GROUP_PREFIX.length);
        const child = this.children.find((c) => c.worldId === worldId);
        if (!child) return null;
        return this.groupNode(child.worldId, child.kind, child.adapter.hierarchy.roots());
      }
      const owner = this.findOwnerChild(id);
      if (!owner) return null;
      const node = owner.adapter.hierarchy.node(id);
      if (!node) return null;
      // Resolving the row is already proof that this mount epoch genuinely
      // owned the id. Remember it before any provider lookup: Play/remount can
      // replace the child between this read and that lookup, and the stale row
      // must then degrade quietly rather than be mislabeled as fabricated.
      this.supersededIds.add(id);
      // A child's OWN root has `parentId: null` in its adapter's tree — rewrite
      // it to point at this world's group node so the merged tree is one
      // connected forest instead of the child roots looking parentless again.
      return this.projectCrossSurfaceNode(
        node,
        node.parentId === null ? groupNodeId(owner.worldId) : node.parentId,
      );
    },
    // The composite spans mixed substrates, so it always answers these — but
    // only three-backed children implement them; the rest are absent (P-5).
    object3D: (id) =>
      isGroupNodeId(id) || isOrganizationNodeId(id)
        ? null
        : (this.routeOwned(id, 'hierarchy.object3D')?.hierarchy.object3D?.(id) ?? null),
    idForObject3D: (o) => {
      for (const child of this.children) {
        const id = child.adapter.hierarchy.idForObject3D?.(o);
        if (id) return id;
      }
      return null;
    },
  };

  readonly selection: SelectionProvider = {
    // Union of every child's own selection.
    get: () => {
      const seen = new Set<string>();
      for (const child of this.children) {
        for (const id of child.adapter.selection?.get() ?? []) seen.add(id);
      }
      return [...seen];
    },
    set: (ids, options) => {
      // A group-node id is not a real entity in any
      // child's tree — route it specially rather than forwarding a bogus id
      // nobody owns. Route each REAL id to its owning child.
      //
      // Every existing adapter (first-party/ingest/canvas) delegates
      // selection to the SAME editor-global `EditorShellStore` — `selectMultiple`
      // REPLACES the store's whole selected-id set, it does not merge. So
      // calling `.set([])` on every non-owning child (the naive "clear the
      // rest" approach) would call `selectMultiple` a second time on the
      // SAME shared store and immediately clear out whatever the owning
      // child's `.set()` call just wrote — a single click could never
      // actually select anything. Only forward to children that own at
      // least one of `ids`.
      //
      // A4 (D8): when NONE do (an empty selection, OR a selection that is
      // PURELY a synthetic id), forward to exactly ONE child (any child
      // sharing the backing store reaches every other child too) — but
      // forward the SYNTHETIC ID ITSELF (not an empty clear) when one was
      // given. This is why `RightPanel.tsx`'s `[...store.selectedEntityIds][0]`
      // (and `Inspector.tsx`'s identical read) can show a world group's own
      // properties: every stock adapter shares the SAME `EditorShellStore`, so
      // writing `'world:<id>'` into any one
      // child's selection lands in that one shared `selectedEntityIds` set,
      // which both those raw-store reads AND this composite's OWN `get()`
      // (via the owning-adapter's `selection.get()`) then see identically —
      // no separate synthetic-id bookkeeping needed on this class at all.
      const byChild = new Map<AuthoringAdapter, string[]>();
      let synthetic: string | null = null;
      for (const id of ids) {
        if (isGroupNodeId(id) || isOrganizationNodeId(id)) {
          synthetic = id; // last one wins — only used when NOTHING else claims byChild
          continue;
        }
        const owner = this.findOwnerChild(id);
        if (!owner) continue;
        const arr = byChild.get(owner.adapter);
        if (arr) arr.push(id);
        else byChild.set(owner.adapter, [id]);
      }
      const setChildSelection = (adapter: AuthoringAdapter, childIds: string[]): void => {
        setAuthoringSelection(adapter, childIds, options);
      };
      if (byChild.size === 0) {
        const first = this.children[0];
        if (first) setChildSelection(first.adapter, synthetic ? [synthetic] : []);
        return;
      }
      for (const [adapter, childIds] of byChild) setChildSelection(adapter, childIds);
    },
  };

  readonly transforms: TransformProvider = {
    // `null` for an unowned id is what keeps the fabricated all-zero Transform
    // section off the inspector: `inspection/compose.ts` renders that section
    // only when `dimensions` answers, so the refusal below is the gate every
    // shell path already respects. `get` can only THROW (its contract returns a
    // non-nullable `Transform`), which is correct for a caller that reaches it
    // anyway — for an id nothing owns, and equally for an id whose OWNING root
    // exposes no transform provider. A named error beats a pose in both cases;
    // `the world root's stage`'s camera-authoring gestures catch and report it.
    dimensions: (id) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return null;
      const transforms = this.routeOwned(id, 'transforms.dimensions')?.transforms;
      if (!transforms) return null;
      const dimensions = transforms.dimensions?.(id);
      return dimensions === undefined ? '3d' : dimensions;
    },
    get: (id): Transform => {
      const owner = this.routeOwned(id, 'transforms.get');
      if (!owner) throw new Error(unownedIdRefusal('transforms.get', id, this.children));
      const transforms = owner.transforms;
      if (!transforms) {
        throw new Error(
          untransformedIdRefusal('transforms.get', id, this.ownerOf(id) ?? 'unknown'),
        );
      }
      return transforms.get(id);
    },
    editability: (id, channel) => {
      const owner = this.routeOwned(id, 'transforms.editability');
      if (!owner) return { writable: false, reason: `No root owns entity id "${id}".` };
      return owner.transforms?.editability?.(id, channel) ?? { writable: true };
    },
    beginEdit: (id) => {
      const owner = this.routeOwned(id, 'transforms.beginEdit');
      if (owner) beginAuthoringTransformEdit(owner, id);
    },
    apply: (id, transform) => {
      const owner = this.routeOwned(id, 'transforms.apply');
      if (owner) applyAuthoringTransform(owner, id, transform);
    },
    endEdit: (id) => {
      const owner = this.routeOwned(id, 'transforms.endEdit');
      return owner ? endAuthoringTransformEdit(owner, id) : undefined;
    },
    // The OWNING child's ack, passed straight through — same reason `endEdit`
    // above must never synthesize one. Whether the channel HAS an override to
    // drop is `editability`'s answer (`removable`), routed per id the same way,
    // so a composite over a child with no removal door still refuses by name.
    remove: (id, channel) => {
      const owner = this.routeOwned(id, 'transforms.remove');
      return owner ? removeAuthoringTransform(owner, id, channel) : undefined;
    },
    sourceCommit: {
      availability: (id) => {
        const owner = this.routeOwned(id, 'transforms.sourceCommit');
        return (
          owner?.transforms?.sourceCommit?.availability(id) ?? {
            available: false,
            reason: 'The owning root exposes no explicit live-transform source commit.',
          }
        );
      },
      commit: async (id) => {
        const owner = this.routeOwned(id, 'transforms.sourceCommit');
        const outcome = owner ? commitAuthoringTransformSource(owner, id) : undefined;
        const ack = await outcome;
        return ack ?? { destination: 'no owning source-commit provider', persisted: false };
      },
    },
  };

  /**
   * H5 — route a row's authorability warnings to the child that owns it.
   *
   * NOT part of `AuthoringAdapter`: like H3's source accessors this is an
   * OPTIONAL capability a child either has or does not, probed structurally by
   * `hierarchy-row-model.ts`'s `RowDiagnosticsSource`. Forwarding it here (as
   * opposed to letting the hierarchy walk `childAdapters()` itself, the way the
   * H3 context menu does) is what keeps the per-row cost identical to the
   * neighbouring `transforms.editability` probe — one `route(id)` per row, and
   * `RowWarningCache` pays even that at most once per row per version.
   */
  diagnosticsFor(id: string): readonly { code: string; message: string }[] | undefined {
    if (isGroupNodeId(id) || isOrganizationNodeId(id)) return undefined;
    const owner = (this.routeOwned(id, 'diagnosticsFor') ?? {}) as {
      diagnosticsFor?: (nodeId: string) => unknown;
    };
    return typeof owner.diagnosticsFor === 'function'
      ? (owner.diagnosticsFor(id) as readonly { code: string; message: string }[] | undefined)
      : undefined;
  }

  /**
   * H6 — route "what does this row's projection hide?" to the child that owns
   * the row, exactly as {@link diagnosticsFor} routes its warnings and for the
   * same reason: it is an OPTIONAL capability probed structurally
   * (`hierarchy-internals.ts`'s `InternalsSource`), not part of
   * `AuthoringAdapter`, so a child without it simply reveals nothing.
   *
   * The synthetic group/organization ids are answered here rather than routed:
   * they are shell rows with no live object at all, so "reveal its internals"
   * has no referent — and `route()`'s unknown-id floor would otherwise ask the
   * FIRST child about an id it has never heard of.
   */
  internalChildren(id: string): EditorNode[] | undefined {
    if (isGroupNodeId(id) || isOrganizationNodeId(id)) return undefined;
    // Reveal state is session-only and deliberately survives a child remount. During that remount
    // an id which belonged to the old live graph may temporarily (or permanently) have no owner;
    // hierarchy-internals.ts's contract says that stale reveal is silently inert. This is an
    // optional read-only projection probe, not an authoring operation, so it must not go through
    // routeOwned's loud anti-shim refusal.
    const owner = (this.findOwnerChild(id)?.adapter ?? {}) as {
      internalChildren?: (nodeId: string) => EditorNode[] | undefined;
    };
    return typeof owner.internalChildren === 'function' ? owner.internalChildren(id) : undefined;
  }

  /** H6 — the companion cheap probe; same routing rules as
   *  {@link internalChildren}. */
  hasInternals(id: string): boolean {
    if (isGroupNodeId(id) || isOrganizationNodeId(id)) return false;
    // Same stale-reveal rule as internalChildren above.
    const owner = (this.findOwnerChild(id)?.adapter ?? {}) as {
      hasInternals?: (nodeId: string) => boolean;
    };
    return typeof owner.hasInternals === 'function' ? owner.hasInternals(id) : false;
  }

  /**
   * A4 (D8) — each adapter root's stable `id`, `zOrder`/`pausable`/`kind` are
   * a MANIFEST concept, not something any child
   * adapter's own inspector knows about — intercepted here, BEFORE `route()`,
   * so a real per-world adapter is never asked about an id it doesn't own.
   * Without a writable provider, these synthetic nodes still expose read-only
   * composition facts instead of being routed into a child that cannot own them.
   */
  private rootProperties(id: string): PropertyDescriptor[] | null {
    if (isOrganizationNodeId(id)) {
      return [{ path: 'organization', label: 'Authoring Group', type: 'string', readonly: true }];
    }
    const child = this.groupChild(id);
    if (!child) return null;
    const surfaceRow = (child.role ?? 'world') === 'surface';
    return [
      { path: 'id', label: 'Root ID', type: 'string', readonly: true },
      { path: 'kind', label: 'Kind', type: 'string', readonly: true },
      ...(this.manifest?.getRootContentSource || child.content
        ? ([{ path: 'content', label: 'Content', type: 'string', readonly: true }] as const)
        : []),
      // A `surface` row is a seam this composite manufactured INSIDE a root
      // (an ingested game's DOM UI beside its canvas), not a manifest root of
      // its own. `zOrder`/`pausable` are manifest-root facts keyed by root id,
      // and there is no manifest root under this worldId to read or write — so
      // the row answers what it honestly knows (`id`, `kind`, `content`) and
      // does not manufacture the two it does not.
      ...(surfaceRow
        ? []
        : ([
            {
              path: 'zOrder',
              label: 'Z Order',
              type: 'number',
              ...(this.manifest ? {} : { readonly: true }),
            },
            {
              path: 'pausable',
              label: 'Pausable',
              type: 'boolean',
              ...(this.manifest ? {} : { readonly: true }),
            },
          ] as PropertyDescriptor[])),
    ];
  }

  /**
   * The child a GROUP-node id names, whatever its `role`.
   *
   * The role gates used to live here, so a `role: 'surface'` child's group row
   * answered nothing: `rootProperties` returned `null`, the inspector then
   * routed the `world:`-prefixed id into {@link findOwnerChild}, which refuses
   * every group id by construction (a group node has NO live object — that is
   * what makes it a group node), and the row logged an unowned-id refusal
   * instead of its own facts. Measured on an ingested game's `…:dom-ui` seam
   * row while `…:canvas` beside it answered normally.
   *
   * Widening the gate is the right half to move, not `findOwnerChild`: entity
   * ownership genuinely is "some child's hierarchy resolves this id", and a
   * group id resolves in nobody's. `role` distinguishes how a row is PROJECTED
   * ({@link groupNode}'s `document` vs `root`, {@link runtimeRootChildren}'s
   * top-level set) — it was never meant to decide whether a row exists to be
   * inspected. `hierarchy.node()` already treats both roles alike.
   */
  private groupChild(id: string): CompositeChild | null {
    if (!isGroupNodeId(id)) return null;
    return this.children.find((c) => groupNodeId(c.worldId) === id) ?? null;
  }

  readonly inspector: InspectorProvider = {
    properties: (id): PropertyDescriptor[] =>
      this.rootProperties(id) ??
      this.routeOwned(id, 'inspector.properties')?.inspector?.properties(id) ??
      [],
    get: (id, path) => {
      if (isOrganizationNodeId(id)) {
        return path === 'organization' ? 'Editor-only hierarchy projection' : undefined;
      }
      const child = this.groupChild(id);
      if (child) {
        const worldId = child.worldId;
        if (path === 'id') return worldId;
        if (path === 'kind') return child.kind;
        if (path === 'content') {
          return this.manifest?.getRootContentSource?.(worldId) ?? child.content;
        }
        // Surface rows declare neither (see `rootProperties`) — answering
        // `undefined` keeps read and describe agreeing.
        if ((child.role ?? 'world') === 'surface') return undefined;
        if (path === 'zOrder') {
          return this.manifest?.getRootZOrder(worldId) ?? child.zOrder ?? 0;
        }
        if (path === 'pausable') {
          return this.manifest?.getRootPausable(worldId) ?? child.pausable ?? true;
        }
        return undefined;
      }
      return this.routeOwned(id, 'inspector.get')?.inspector?.get(id, path);
    },
    // A synthetic row answers for ITSELF here, exactly as `properties`/`get`/
    // `set` above already do. Routing a `world:`-prefixed id into
    // `routeOwned` refuses every group id by construction (a group node has NO
    // live object — that is what makes it a group node), so the inspector
    // logged an unowned-id refusal for a row it had just described. MEASURED
    // on a packaged build against a canvas ingest root with a DOM UI beside
    // it: `inspector.editability: no root owns entity id
    // "world:probe-canvas:canvas"` on every selection of that root's own row.
    //
    // The descriptor is the ONE source of truth for whether a synthetic row's
    // field is writable (`rootProperties` decides `readonly` per path — the
    // manifest provider gates `zOrder`/`pausable`, `id`/`kind`/`content` are
    // always read-only, and a `surface` row declares neither of the first
    // two), so this reads the answer back off it instead of restating the
    // rules and drifting from them. An unknown path on a synthetic row is not
    // writable: nothing would receive the write.
    editability: (id, path) => {
      const synthetic = this.rootProperties(id);
      if (synthetic) {
        const descriptor = synthetic.find((property) => property.path === path);
        if (!descriptor) {
          return {
            writable: false,
            reason: `this root row has no "${path}" field`,
          };
        }
        return descriptor.readonly
          ? {
              writable: false,
              reason: 'a composition fact, read from the manifest — not an authored value',
            }
          : { writable: true };
      }
      return (
        this.routeOwned(id, 'inspector.editability')?.inspector?.editability?.(id, path) ?? {
          writable: true,
        }
      );
    },
    set: (id, path, value) => {
      const child = this.groupChild(id);
      if (child) {
        if (this.manifest && (child.role ?? 'world') === 'world') {
          if (path === 'zOrder') this.manifest.setRootZOrder(child.worldId, Number(value));
          else if (path === 'pausable')
            this.manifest.setRootPausable(child.worldId, Boolean(value));
        }
        return;
      }
      // The OWNING child's ack, passed straight through. The composite has no
      // ack of its own to give and must never synthesize one: joining every
      // child's persistence is how a three-root edit came to report the DOM
      // root's destination with `persisted: true`.
      return this.routeOwned(id, 'inspector.set')?.inspector?.set(id, path, value);
    },
    remove: (id, path) => {
      // Root-group synthetic props have no removable override; everything else
      // routes to the owning child (which optional-omits `remove` when its
      // dialect has no way to express absence).
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return;
      // The OWNING child's ack, passed straight through — same reason `set`
      // above must never synthesize one.
      return this.routeOwned(id, 'inspector.remove')?.inspector?.remove?.(id, path);
    },
  };

  /** Source-derived component instances, routed by the same ownership answer
   * as the generic Inspector. Synthetic root/group rows have no instance. */
  readonly instances: ComponentInstancesProvider = {
    describe: (id) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return null;
      return this.routeOwned(id, 'instances.describe')?.instances?.describe(id) ?? null;
    },
    revert: async (id, paths) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return;
      const adapter = this.routeOwned(id, 'instances.revert');
      if (!adapter?.instances) return;
      return revertAuthoringInstance(adapter, id, paths);
    },
    applyToComponent: async (id, path) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) {
        return { changed: false, message: 'A composition row is not a component instance.' };
      }
      const adapter = this.routeOwned(id, 'instances.applyToComponent');
      const provider = adapter?.instances;
      if (!provider) {
        return { changed: false, message: 'This subject has no writable component source.' };
      }
      return applyAuthoringInstanceToComponent(adapter, id, path);
    },
  };

  /**
   * Resolve a `create`/`creatableKinds` target: a group-node id
   * (`world:<w>`) targets that world's OWN root (forwarded parentId
   * `undefined`); a real id targets its owning child (forwarded as-is);
   * `null`/`undefined` (no parent — the toolbar's root-level "Add") targets
   * the FIRST child that actually has a structure provider — in edit mode
   * that is the one focused, live world adapter; every other
   * child is a read-only `BoundaryAuthoringAdapter` with no `structure` at
   * all. `null` when nothing can serve the request, so a create is never
   * silently routed to the wrong world.
   */
  private resolveStructureTarget(
    parentId: string | null | undefined,
  ): { child: CompositeChild; forwardParentId: string | undefined } | null {
    if (parentId != null && isOrganizationNodeId(parentId)) return null;
    if (parentId != null && isGroupNodeId(parentId)) {
      const worldId = parentId.slice(GROUP_PREFIX.length);
      const child = this.children.find((c) => c.worldId === worldId);
      return child ? { child, forwardParentId: undefined } : null;
    }
    if (parentId != null) {
      const child = this.findOwnerChild(parentId);
      if (!child) return null;
      const parent = child.adapter.hierarchy.node(parentId);
      return {
        child,
        // Documents and design states organize an adapter's native roots;
        // they are not native parent ids. The structure contract's root
        // spelling is `undefined`/`null`, so forward that explicitly.
        forwardParentId:
          parent?.role === 'document' || parent?.role === 'story' ? undefined : parentId,
      };
    }
    const child = this.children.find((c) => c.adapter.structure);
    return child ? { child, forwardParentId: undefined } : null;
  }

  /**
   * A2 (map §5) — structural pass-through, routed by ownership. Never a
   * silent no-op when a request can't be served: `create`/`remove`/
   * `duplicate` log loudly via `editorConsole.warn` and return an honest
   * empty/unchanged result (#18) rather than pretending to route to the
   * wrong world. `reorder` is the one exception — it mirrors the base
   * contract's OWN "absent means no reorder UI" convention, so a missing
   * `reorder` on the owning child is a silent no-op, not a warning.
   */
  readonly structure: StructureProvider = {
    // The owning child's WHOLE answer is forwarded — id and ack together. A
    // route that found no owner attempted no write, so its ack is `undefined`
    // (the honest `void` of `StructuralWriteOutcome`), never a fabricated one.
    create: (kind, parentId) => {
      const target = this.resolveStructureTarget(parentId ?? null);
      if (!target?.child.adapter.structure) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] create: no owning child with a structure ` +
            `provider for parent "${parentId ?? '(root)'}"`,
          'authoring',
        );
        return { id: '', ack: undefined };
      }
      return createAuthoringNode(target.child.adapter, kind, target.forwardParentId);
    },
    remove: (id) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return;
      const owner = this.findOwnerChild(id);
      if (!owner?.adapter.structure) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] remove: no owner/structure for id "${id}"`,
          'authoring',
        );
        return;
      }
      // Propagate the owning child's return value (a react-world child
      // returns an awaitable) so `deleteSelection` can still serialize a
      // multi-delete THROUGH the composite the same way it does for a
      // directly-active override adapter (see that adapter's own `remove`
      // doc comment).
      return removeAuthoringNode(owner.adapter, id);
    },
    removeMany: async (ids) => {
      const groups = new Map<CompositeChild, string[]>();
      for (const id of ids) {
        if (isGroupNodeId(id) || isOrganizationNodeId(id)) continue;
        const owner = this.findOwnerChild(id);
        if (!owner?.adapter.structure) {
          editorConsole.warn(
            `[CompositeAuthoringAdapter] removeMany: no owner/structure for id "${id}"`,
            'authoring',
          );
          continue;
        }
        const ownedIds = groups.get(owner);
        if (ownedIds) ownedIds.push(id);
        else groups.set(owner, [id]);
      }

      // Preserve each child's strongest atomicity guarantee. In the common case
      // (one world's multi-selection), this is one child batch and therefore one
      // history transaction. Cross-world selections remain one ordered batch per
      // owner because no child can soundly mutate another world's document.
      // One gesture, one answer. A cross-world batch cannot honestly name TWO
      // destinations, so the composite reports the last owner's ack only when
      // EVERY owner persisted; the moment one did not, the whole batch degrades
      // to the live-only floor. Naming a file that carried only part of the
      // selection is the blanket ack the persistence pipe exists to kill.
      let ack: WriteAck = LIVE_ONLY_ACK;
      let allPersisted = true;
      for (const [owner, ownedIds] of groups) {
        const structure = owner.adapter.structure!;
        // biome-ignore lint/complexity/noUselessUndefinedInitialization: not useless — `void | WriteAck` is not definitely assigned by either branch below, and tsc reads the two reads that follow as use-before-assignment without it.
        let last: void | WriteAck = undefined;
        if (structure.removeMany) last = await removeManyAuthoringNodes(owner.adapter, ownedIds);
        else for (const id of ownedIds) last = await removeAuthoringNode(owner.adapter, id);
        if (last) ack = last;
        if (!last?.persisted) allPersisted = false;
      }
      return allPersisted ? ack : LIVE_ONLY_ACK;
    },
    canCopy: (ids) => {
      const owners = ids.map((id) => this.findOwnerChild(id));
      const owner = owners[0];
      return !!(
        owner?.adapter.structure?.copy &&
        !owners.some((candidate) => candidate?.worldId !== owner.worldId) &&
        (owner.adapter.structure.canCopy?.(ids) ?? true)
      );
    },
    copy: async (ids) => {
      const owners = ids.map((id) => this.findOwnerChild(id));
      const owner = owners[0];
      if (!this.structure.canCopy?.(ids) || !owner?.adapter.structure?.copy) {
        editorConsole.warn(
          '[CompositeAuthoringAdapter] copy requires source-addressable entities from one world.',
          'authoring',
        );
        return false;
      }
      if (!(await copyAuthoringNodes(owner.adapter, ids))) return false;
      this.structureClipboardWorldId = owner.worldId;
      return true;
    },
    cut: async (ids) => {
      const owners = ids.map((id) => this.findOwnerChild(id));
      const owner = owners[0];
      if (!this.structure.canCopy?.(ids) || !owner?.adapter.structure?.cut) {
        editorConsole.warn(
          '[CompositeAuthoringAdapter] cut requires source-addressable entities from one world.',
          'authoring',
        );
        return false;
      }
      const ack = await cutAuthoringNodes(owner.adapter, ids);
      if (ack === false) return false;
      this.structureClipboardWorldId = owner.worldId;
      return ack;
    },
    canPaste: (parentId) => {
      const clipboardOwner = this.children.find(
        (child) => child.worldId === this.structureClipboardWorldId,
      );
      if (!clipboardOwner?.adapter.structure?.paste) return false;
      const target =
        parentId === null
          ? { child: clipboardOwner, forwardParentId: null }
          : this.resolveStructureTarget(parentId);
      return !!(
        target &&
        target.child.worldId === clipboardOwner.worldId &&
        (clipboardOwner.adapter.structure.canPaste?.(target.forwardParentId ?? null) ?? true)
      );
    },
    paste: async (parentId) => {
      const clipboardOwner = this.children.find(
        (child) => child.worldId === this.structureClipboardWorldId,
      );
      if (!clipboardOwner?.adapter.structure?.paste) {
        editorConsole.warn(
          '[CompositeAuthoringAdapter] paste has no copied entity payload to route.',
          'authoring',
        );
        return false;
      }
      const target =
        parentId === null
          ? { child: clipboardOwner, forwardParentId: undefined }
          : this.resolveStructureTarget(parentId);
      if (!target || target.child.worldId !== clipboardOwner.worldId) {
        editorConsole.warn(
          '[CompositeAuthoringAdapter] refusing to paste an entity across world roots.',
          'authoring',
        );
        return false;
      }
      return await pasteAuthoringNodes(clipboardOwner.adapter, target.forwardParentId ?? null);
    },
    duplicate: (id) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return { id, ack: undefined };
      const owner = this.findOwnerChild(id);
      if (!owner?.adapter.structure) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] duplicate: no owner/structure for id "${id}"`,
          'authoring',
        );
        return { id, ack: undefined };
      }
      return duplicateAuthoringNode(owner.adapter, id);
    },
    reparent: (id, newParentId) => {
      const owner = this.findOwnerChild(id);
      if (!owner?.adapter.structure) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] reparent: no owner/structure for id "${id}"`,
          'authoring',
        );
        return;
      }
      if (newParentId === null || newParentId === groupNodeId(owner.worldId)) {
        return reparentAuthoringNode(owner.adapter, id, null); // -> a root of its own world
      }
      const newOwner = this.findOwnerChild(newParentId);
      if (!newOwner || newOwner.worldId !== owner.worldId) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] reparent: refusing to move "${id}" across roots ` +
            `(target parent "${newParentId}" is not in world "${owner.worldId}")`,
          'authoring',
        );
        return;
      }
      const newParent = newOwner.adapter.hierarchy.node(newParentId);
      if (newParent?.role === 'document' || newParent?.role === 'story') {
        return reparentAuthoringNode(owner.adapter, id, null);
      }
      return reparentAuthoringNode(owner.adapter, id, newParentId);
    },
    reorder: (id, beforeSiblingId) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return;
      const owner = this.findOwnerChild(id);
      if (!owner) return;
      // Cross-world guard: a non-null sibling anchor MUST belong to the same
      // child as `id`. Otherwise (e.g. a drag onto another world's row whose
      // reparent was already refused) the child maps the foreign sibling id to
      // "append to end" and silently moves the entity within its own list on an
      // operation the composite just rejected. A null anchor (move to end) is
      // always valid.
      if (beforeSiblingId !== null && this.findOwnerChild(beforeSiblingId) !== owner) return;
      return reorderAuthoringNode(owner.adapter, id, beforeSiblingId);
    },
    creatableKinds: (parentId) => {
      const target = this.resolveStructureTarget(parentId);
      return (
        target?.child.adapter.structure?.creatableKinds?.(target.forwardParentId ?? null) ?? []
      );
    },
    // D3.a (spec 27 §6) — forward wrap/unwrap to the owning child, same
    // owner-lookup + loud-warn-on-miss shape as `duplicate`/`remove` above
    // (unlike `reorder`, which mirrors the base contract's OWN "absent means
    // no UI" silent-no-op convention — wrap/unwrap follow the LOUD group
    // instead since they're triggered from an explicit, always-visible menu
    // item, same as duplicate/delete).
    wrap: (id, wrapperTag) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return;
      const owner = this.findOwnerChild(id);
      if (!owner?.adapter.structure?.wrap) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] wrap: no owner/structure.wrap for id "${id}"`,
          'authoring',
        );
        return;
      }
      return wrapAuthoringNode(owner.adapter, id, wrapperTag);
    },
    unwrap: (id) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return;
      const owner = this.findOwnerChild(id);
      if (!owner?.adapter.structure?.unwrap) {
        editorConsole.warn(
          `[CompositeAuthoringAdapter] unwrap: no owner/structure.unwrap for id "${id}"`,
          'authoring',
        );
        return;
      }
      return unwrapAuthoringNode(owner.adapter, id);
    },
    // A cross-world selection is REFUSED whole rather than grouped in whichever
    // world came first — the same degrade `removeMany` makes for a batch whose
    // owners disagree. Nothing was written, so there is nothing to ack.
    group: (ids) => {
      if (ids.length === 0) return { id: null, ack: undefined };
      const owners = ids.map((id) => this.findOwnerChild(id));
      const owner = owners[0];
      if (
        !owner?.adapter.structure?.group ||
        owners.some((candidate) => candidate?.adapter !== owner.adapter)
      ) {
        return { id: null, ack: undefined };
      }
      return groupAuthoringNodes(owner.adapter, ids);
    },
    ungroup: (id) => {
      const owner = this.findOwnerChild(id);
      return owner ? ungroupAuthoringNode(owner.adapter, id) : { ids: [], ack: undefined };
    },
    canUngroup: (id) => {
      const owner = this.findOwnerChild(id);
      return owner?.adapter.structure?.canUngroup?.(id) ?? false;
    },
  };

  /**
   * Asset-drop pass-through. A group-node id (`world:<w>`) must NOT fall
   * through `route()`'s "unknown id -> first child" floor: that would target
   * whatever child happened to be FIRST in the array regardless of which
   * world's row was actually under the cursor. Translate
   * the group-node id to that world's child directly, forwarding `''` (the
   * root-drop sentinel) as the node id, since the synthetic `world:<w>`
   * string means nothing to the child's own hierarchy.
   */
  private resolveAssetDropTarget(
    nodeId: string,
  ): { adapter: AuthoringAdapter; forwardId: string } | null {
    // A VIEWPORT drop names no node (`''`): it means "into the spatial world
    // under the pointer". Route it to the one three-surface child that accepts
    // drops — every design session is a composite (world + UI), and the
    // unknown-id refusal below made a drag from Content onto the 3D view die
    // silently on all of them (runhuman pass 45). Two spatial worlds would be
    // ambiguous, and the refusal stands for that case.
    if (nodeId === '') {
      const spatial = this.children.filter(
        (c) => c.kind === 'three' && c.role !== 'surface' && c.adapter.assetDrop !== undefined,
      );
      return spatial.length === 1 && spatial[0]
        ? { adapter: spatial[0].adapter, forwardId: '' }
        : null;
    }
    if (isGroupNodeId(nodeId)) {
      const worldId = nodeId.slice(GROUP_PREFIX.length);
      const child = this.children.find((c) => c.worldId === worldId);
      return child ? { adapter: child.adapter, forwardId: '' } : null;
    }
    const owner = this.findOwnerChild(nodeId);
    // Unknown real id: REFUSED (`routeOwned`), not floored onto the first child —
    // dropping an asset onto a row nothing owns must not land it in whatever
    // world happens to be first.
    if (!owner) {
      this.routeOwned(nodeId, 'assetDrop');
      return null;
    }
    const node = owner.adapter.hierarchy.node(nodeId);
    return {
      adapter: owner.adapter,
      forwardId: node?.role === 'document' || node?.role === 'story' ? '' : nodeId,
    };
  }

  /**
   * D4 (B2) — resolves a `stories` call THE SAME WAY `resolveAssetDropTarget`
   * (above) resolves an asset drop: a group-node id (`world:<w>`) used to
   * fall through `route()`'s "unknown id -> first child" floor, so
   * `storiesFor('world:hud')` silently asked whatever child happened to be
   * FIRST in the array (never the actual owner), meaning the story picker
   * could NEVER appear on the world's own group row — the one place B2's
   * shell (`Inspector.tsx`) actually calls it. Translated to `<w>`'s own
   * child adapter. Unlike the asset-drop translation, the node id is
   * forwarded UNCHANGED (not blanked to `''`) — B2's `ReactRootAuthoringAdapter.stories`
   * is world-level and ignores `nodeId` entirely (see that class's doc
   * comment), but a future per-node catalog (B3) will want the real id, so
   * there is no sentinel to invent here.
   */
  private resolveStoriesTarget(
    nodeId: string,
  ): { adapter: AuthoringAdapter; forwardId: string } | null {
    if (isGroupNodeId(nodeId)) {
      const worldId = nodeId.slice(GROUP_PREFIX.length);
      const child = this.children.find((c) => c.worldId === worldId);
      return child ? { adapter: child.adapter, forwardId: nodeId } : null;
    }
    const adapter = this.routeOwned(nodeId, 'stories');
    return adapter ? { adapter, forwardId: nodeId } : null;
  }

  /** D4 — storybook stories, routed by node ownership (group-node ids
   *  translated — see `resolveStoriesTarget` above, the same fix
   *  `resolveAssetDropTarget` applied for asset drops). A node whose owning
   *  adapter has no `stories` provider reports/does nothing (empty list, null
   *  active, no-op apply/isolate) rather than throwing. */
  readonly stories: StoriesProvider = {
    storiesFor: (nodeId): StoryRef[] => {
      // THE SCOPE PROBE IS NOT AN UNOWNED ID. `storiesFor(WORLD_SCOPE_NODE_ID)`
      // is the protocol's world-level question ("list YOUR stories", asked with
      // no node in hand — `authoring/stories-scope.ts`), and this provider is
      // node-scoped BY CONSTRUCTION: it routes every call by node ownership, so
      // its honest answer with no node is the empty list. Routing the probe
      // through `routeOwned` produced that same empty list plus a loud
      // unowned-id error on every probe — noise for the one answer the protocol
      // asks for. Only this verb short-circuits: `active`/`apply`/`isolate` are
      // reached with the sentinel only after `storiesFor` answered rows, which
      // this provider never does, so an empty id arriving there IS a caller
      // error and keeps its error.
      if (nodeId === WORLD_SCOPE_NODE_ID) return [];
      const target = this.resolveStoriesTarget(nodeId);
      return target?.adapter.stories?.storiesFor(target.forwardId) ?? [];
    },
    active: (nodeId) => {
      const target = this.resolveStoriesTarget(nodeId);
      return target?.adapter.stories?.active(target.forwardId) ?? null;
    },
    apply: (nodeId, storyId) => {
      const target = this.resolveStoriesTarget(nodeId);
      const provider = target?.adapter.stories;
      if (!target || !provider) return;
      recordAuthoringConsumerUse({
        adapter: target.adapter,
        seam: 'editor.stories.apply',
        stage: 'effect',
        detail: `the composite applied story ${storyId ?? 'default'} through its owning adapter`,
        run: () => provider.apply(target.forwardId, storyId),
      });
    },
    isolate: (nodeId, storyId) => {
      // A null nodeId (exit isolation) has no owner to route by — forward the
      // exit to every child that implements `isolate` so nothing is left stuck
      // in an isolated state.
      if (nodeId === null) {
        for (const child of this.children) child.adapter.stories?.isolate?.(null, storyId);
        return;
      }
      const target = this.resolveStoriesTarget(nodeId);
      target?.adapter.stories?.isolate?.(target.forwardId, storyId);
    },
  };

  /** Atomic authored assets, routed by the same node ownership as Inspector. */
  readonly assetSubject: AssetSubjectProvider = {
    get: (id) => this.findOwnerChild(id)?.adapter.assetSubject?.get(id) ?? null,
    entries: () =>
      this.children.flatMap((child) =>
        childAssetEntries(child.adapter).map(({ id, subject }) => ({
          id: `${child.worldId}:${id}`,
          subject,
        })),
      ),
  };

  /** Asset drop, routed by node ownership (group-node ids translated — see
   *  `resolveAssetDropTarget` above). */
  readonly assetDrop: AssetDropProvider = {
    accepts: (nodeId, assetPath, context) => {
      const target = this.resolveAssetDropTarget(nodeId);
      const provider = target?.adapter.assetDrop;
      if (!target || !provider) return false;
      return context === undefined
        ? provider.accepts(target.forwardId, assetPath)
        : provider.accepts(target.forwardId, assetPath, context);
    },
    drop: (nodeId, assetPath, context) => {
      const target = this.resolveAssetDropTarget(nodeId);
      const provider = target?.adapter.assetDrop;
      if (!target || !provider) {
        // A human gesture never dies mutely: name what the composition holds
        // so the refusal is a fact, not a mystery (runhuman pass 45).
        const worlds = this.children
          .map((c) => `${c.worldId}:${c.kind}${c.adapter.assetDrop ? '' : ' (no drop target)'}`)
          .join(', ');
        editorConsole.warn(
          `Dropped ${assetPath} was not placed: ${
            nodeId === ''
              ? 'no single spatial world accepts a viewport drop'
              : `“${nodeId}” has no owning world`
          } — worlds here: ${worlds}.`,
          'editor',
        );
        return;
      }
      return dropAuthoringAsset(target.adapter, target.forwardId, assetPath, context);
    },
  };

  // NOTE: `pickable` is deliberately NOT implemented here — layered viewport
  // picking (D12) across children is shell policy (B4), not something this
  // composite merges. Callers needing per-layer pick should go through
  // `childAdapters()` and pick each child's own `pickable` themselves.
  //
  // NOTE: `provenance` is deliberately NOT implemented here either, for the
  // complementary reason: provenance is a PER-WORLD declaration, and a
  // composite spans worlds whose declarations differ (a stamped ingest canvas
  // beside a live DOM HUD) — one adapter-level value would assert one world's
  // truth over another's rows, which is the fabrication the anti-shim rule
  // forbids. The shell resolves it per node through
  // `authoring/provenance.ts`'s governing-adapter hop, and the hierarchy's
  // world group rows read each child's own declaration off `childAdapters()`.
  //
  // Both absences are DELIVERED capabilities measured at a different door;
  // `adapter-reach.ts`'s `measureAdapter` states this so the coverage report
  // does not read them as gaps.

  /**
   * Truth resolution, routed by SUBJECT OWNERSHIP exactly as
   * {@link inspector} routes: the child that actually owns the node answers
   * for it.
   *
   * PRESENT ONLY when at least one child actually indexes, because ABSENCE is
   * itself read as a fact by the shell and a composite must not answer for a
   * composition whose children index nothing: `shell-document-ops.ts`'s
   * `activeSelectionCreationSite` treats absence as "nothing to ask" (never a
   * fabricated unanchored verdict). It reads the ACTIVE adapter, which is this
   * composite for every promoted session (ingest with a detected DOM UI,
   * ingest+siblings, and ALL first-party play) — so without this, those
   * sessions lost creation-site reveal entirely even when the child holding
   * the running objects had a full index.
   *
   * A plain conditionally-assigned field rather than a getter, for the same
   * reason `BoundaryAuthoringAdapter.pickable` is one: under
   * `exactOptionalPropertyTypes` the key must be genuinely ABSENT, and a
   * getter's declared type would have to include `undefined`, which no longer
   * satisfies `AuthoringAdapter.truth?: TruthProvider`. NOT
   * `readonly` for the same reason `capabilities` is not — {@link
   * replaceChild} recomputes it after an in-place child swap (a design-time
   * layer mount upgrading a Boundary to a live adapter is exactly a swap that
   * can bring an index in, or take one away).
   */
  truth?: TruthProvider;

  /** The routing provider itself never changes — only whether this adapter
   *  offers it at all does. Unlike `route()`, an unowned id is NOT floored
   *  onto the first child: a synthetic group/organization row has no live
   *  object, and an id no child recognizes must not be answered by a world
   *  that never saw it (#18). Both get the same honest `NO_OBJECT_REASON` the
   *  per-world adapters give for an id with nothing behind it. */
  private readonly truthProvider: TruthProvider = {
    resolve: (id, property) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) {
        return {
          site: { anchored: false, reason: NO_OBJECT_REASON } as NodeCreationSite,
          writeAnchorKind: undefined,
        };
      }
      return (
        this.findOwnerChild(id)?.adapter.truth?.resolve(id, property) ?? {
          site: { anchored: false, reason: NO_OBJECT_REASON },
          writeAnchorKind: undefined,
        }
      );
    },
  };

  private refreshTruth(): void {
    if (this.children.some((c) => c.adapter.truth)) {
      this.truth = this.truthProvider;
    } else {
      // `delete`, not `= undefined`: an explicit `undefined` is not an absent
      // property under `exactOptionalPropertyTypes`, and absence is the fact
      // both shell readers are checking for.
      delete this.truth;
    }
  }

  /**
   * Related-subject links, routed by SUBJECT OWNERSHIP exactly as
   * {@link truth} routes — the inspector reads `adapter.related` off the
   * ACTIVE adapter (`inspection/compose.ts`), which is this composite for
   * every promoted session, so without this route every subject in a
   * composite session lost its jump links even when the owning child could
   * answer. Same conditionally-assigned shape as {@link truth}, recomputed by
   * {@link replaceChild} (a Boundary upgrading to a live adapter is exactly a
   * swap that can bring a provider in, or take one away). A synthetic
   * group/organization row has no defining document and honestly reports no
   * links.
   */
  related?: RelatedSubjectsProvider;

  private readonly relatedProvider: RelatedSubjectsProvider = {
    links: (id) => {
      if (isGroupNodeId(id) || isOrganizationNodeId(id)) return [];
      return this.findOwnerChild(id)?.adapter.related?.links(id) ?? [];
    },
  };

  private refreshRelated(): void {
    if (this.children.some((c) => c.adapter.related)) {
      this.related = this.relatedProvider;
    } else {
      delete this.related;
    }
  }

  // ------------------------------------------------------- change fan-out
  //
  // A consumer subscribes to THIS composite, not to a child — and the child set
  // is not fixed. `replaceChild` swaps a world's adapter mid-session (a
  // suspended R3F world finishing its async mount replaces its read-only
  // Boundary with the live source adapter; play suspend/Stop swap it back), and
  // the previous implementation bound each subscriber directly to the children
  // that existed AT SUBSCRIBE TIME. Those bindings survived the swap pointing at
  // the OUTGOING adapter, so every consumer that subscribed before a world
  // finished mounting was permanently deaf to the world that actually mounted —
  // the hierarchy panel among them, whose only adapter-side signal is
  // `adapter.subscribe`. Callers papered over it by pushing a store
  // notification alongside every swap (`store.notifyIngestEdit()`), which is a
  // side channel around a broken seam, not the seam working.
  //
  // Now the composite keeps the LISTENERS and re-derives its child bindings
  // whenever the child set changes, and the swap itself notifies: replacing a
  // world's adapter IS a structure change, so a subscriber hears about the
  // mounted world from the composite rather than from a store call the caller
  // has to remember.
  private readonly structureListeners = new Set<() => void>();
  /** Live child bindings, or `null` when nothing is listening. */
  private childFanOutUnsubs: Array<() => void> | null = null;

  private readonly fanOutStructure = (): void => {
    for (const listener of [...this.structureListeners]) listener();
  };

  /** (Re)bind child subscriptions to match the CURRENT children and the current
   *  listener demand. Idempotent; the only mutator of `childFanOutUnsubs`. */
  private syncChildFanOut(): void {
    if (this.childFanOutUnsubs) {
      for (const unsub of this.childFanOutUnsubs) unsub();
      this.childFanOutUnsubs = null;
    }
    if (this.structureListeners.size === 0) return;
    const unsubs: Array<() => void> = [];
    for (const child of this.children) {
      if (this.structureListeners.size > 0) {
        const subscribe = child.adapter.subscribe;
        const unsub = subscribe
          ? recordAuthoringConsumerUse({
              adapter: child.adapter,
              seam: 'editor.subscribe',
              stage: 'effect',
              detail: 'the composite subscribed to child authoring changes',
              run: () => subscribe.call(child.adapter, this.fanOutStructure),
            })
          : undefined;
        if (unsub) unsubs.push(unsub);
      }
    }
    this.childFanOutUnsubs = unsubs;
  }

  subscribe(listener: () => void): () => void {
    this.structureListeners.add(listener);
    this.syncChildFanOut();
    return () => {
      this.structureListeners.delete(listener);
      this.syncChildFanOut();
    };
  }

  /**
   * Persistence (T3.2 slice 3, generalized 2→N unchanged in semantics): `isDirty`
   * = OR of children that actually have a provider (a child without one, e.g. an
   * no-authoring adapter, is simply skipped — it has nothing to be dirty about);
   * `save()` saves the dirty children SEQUENTIALLY, logging loudly per-child on
   * failure without aborting the rest; `destination` joins child destinations
   * with `' + '`.
   *
   * History is resource-driven, so the composite needs no ordering or inverse
   * logic of its own; its children journal into the open project's service.
   */
  get persistence(): PersistenceProvider {
    // Always a REAL (never `undefined`) provider — see composite-authoring-adapter's
    // 2-child precedent / `ephemeral-persistence.ts` for the same pattern.
    const persistable = this.children.filter(
      (
        c,
      ): c is CompositeChild & {
        adapter: AuthoringAdapter & { persistence: PersistenceProvider };
      } => c.adapter.capabilities.persist && !!c.adapter.persistence,
    );
    return {
      isDirty: () => persistable.some((c) => c.adapter.persistence.isDirty()),
      lastError: () => {
        const errors = new Set<string>();
        for (const child of persistable) {
          const error = child.adapter.persistence.lastError?.();
          if (error) errors.add(error);
        }
        return errors.size > 0 ? [...errors].join(' · ') : null;
      },
      save: async () => {
        for (const c of persistable) {
          const p = c.adapter.persistence;
          if (!p.isDirty()) continue;
          try {
            await saveAuthoringDocument(c.adapter, `the composite saved dirty child ${c.worldId}`);
          } catch (err) {
            console.error(
              `[CompositeAuthoringAdapter] save failed for world "${c.worldId}" ` +
                `(destination: ${p.destination}) — continuing with remaining roots:`,
              err,
            );
          }
        }
      },
      destination:
        persistable.length > 0
          ? persistable.map((c) => c.adapter.persistence.destination).join(' + ')
          : NO_PERSISTABLE_CHILD_DESTINATION,
    };
  }
}
