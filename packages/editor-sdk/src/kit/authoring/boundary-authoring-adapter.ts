/**
 * BoundaryAuthoringAdapter — A1's read-only {@link AuthoringAdapter} for a
 * manifest-declared world that is NOT currently mounted (edit mode only runs
 * the manifest's sole Three world live — every other declared world is disclosed,
 * not simulated; see `edit-mode-authoring.ts`'s doc comment for the seam this
 * plugs into, and B1 for the "mount it live" upgrade path).
 *
 * A single node, one per world: label = the declared entry/scene document (or
 * the world id when it has none), with error/read-only state carried as
 * metadata rather than punctuation embedded in the name. `kind` = the
 * manifest world kind, inspector exposes kind/adapter/entry-or-scene
 * path/zOrder/pausable (+ `reason` when unresolvable) as READ-ONLY
 * properties. No children, no live object, no structural/transform ops — this
 * adapter's entire job is "say the world exists and why it isn't live yet".
 *
 * Resolvability is a CALLER decision (`edit-mode-authoring.ts` computes the
 * reason from the manifest world entry) — this adapter just renders whatever
 * reason string it's given; it never itself decides a world is broken.
 */

import type {
  AuthoringAdapter,
  AuthoringCapabilities,
  AuthoringProvenance,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  PickProvider,
  PropertyDescriptor,
  SelectionProvider,
} from '@volter/editor-project/adapter';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';

/** The display-relevant slice of a manifest world entry — deliberately loose
 *  (plain strings, not the engine's validated `AdapterRoot['kind']` union) so
 *  an UNRESOLVABLE world (unknown kind, e.g.) can still be described. */
export interface BoundaryRootInfo {
  readonly id: string;
  readonly kind: string;
  /** Display string for the manifest's `adapter` field (e.g. `'default'`,
   *  `'module:<path>'`) — omitted when not meaningfully derivable. */
  readonly adapter?: string | undefined;
  /** Whichever of `scene`/`entry` the world declares (display-only — this
   *  adapter never reads the file). */
  readonly entryOrScenePath?: string | undefined;
  readonly zOrder: number;
  readonly pausable: boolean;
}

const NO_CAPABILITIES: AuthoringCapabilities = {
  transform: false,
  inspectorFields: false,
  persist: false,
};

export class BoundaryAuthoringAdapter implements AuthoringAdapter {
  readonly capabilities: AuthoringCapabilities = NO_CAPABILITIES;

  readonly provenance: AuthoringProvenance = {
    source: 'boundary',
    label: 'read-only',
    detail:
      'Declared world without a live editing surface in this viewport — disclosed, not simulated; rows are read-only.',
  };
  private readonly world: BoundaryRootInfo;
  /** Non-null ⇒ error-node mode (#18) — set by the caller, never computed here. */
  private readonly reason: string | null;
  private readonly store: ShellStore;
  /**
   * D12 (B4) — a design-time layer's own stage hit-test, wired in by
   * `design-time-layers.ts`'s layer-mount success handler: when a mount
   * returns a `pick` but NO authoring adapter (an opaque/foreign root that can
   * report where a click landed without offering a source-authoring surface),
   * that handler re-wraps the world's Boundary through this constructor
   * parameter, so the pick rides on THIS adapter rather than a second
   * substrate-specific one. Absent for every other Boundary (an unresolved or
   * error world, and every world whose mount reported no `pick`) ⇒ this
   * adapter reports no `pickable` at all. A plain
   * conditionally-assigned field (not a getter always returning `{ pick:
   * undefined }`) — this repo's `exactOptionalPropertyTypes` requires the key
   * to be genuinely ABSENT, not present with an `undefined` value, to satisfy
   * `AuthoringAdapter.pickable?: PickProvider`.
   */
  readonly pickable?: PickProvider;

  constructor(
    store: ShellStore,
    world: BoundaryRootInfo,
    reason?: string,
    pick?: PickProvider['pick'],
  ) {
    this.store = store;
    this.world = world;
    this.reason = reason ?? null;
    if (pick) this.pickable = { pick };
  }

  /** Why this world has no live editing surface, when the caller said so. */
  get disclosure(): string | null {
    return this.reason;
  }

  private get label(): string {
    return this.world.entryOrScenePath?.split('/').pop() ?? this.world.id;
  }

  private get node(): EditorNode {
    return {
      id: this.world.id,
      label: this.label,
      secondaryLabel: this.reason ? 'Unavailable' : 'Read-only',
      role: 'boundary',
      kind: this.world.kind,
      parentId: null,
      childIds: [],
    };
  }

  readonly hierarchy: HierarchyProvider = {
    roots: (): EditorNode[] => [this.node],
    node: (id) => (id === this.world.id ? this.node : null),
    // No `object3D`/`idForObject3D`: a boundary node has no live object at all.
  };

  /**
   * Selection delegates to the editor-global {@link ShellStore} selection set
   * — the SAME seam `ThreeAuthoringAdapter`/`ReactRootAuthoringAdapter` use
   * (selection is editor UI state, not a per-adapter document concern). Without
   * this, clicking a Boundary/error node in `IngestHierarchy` (the panel the
   * composite drives) would be a silent no-op, so the node — and its `reason`
   * (#18) — could never be selected or inspected (defect 3). It also makes the
   * composite's empty-clear (`selection.set([])` routed to `children[0]`) work
   * when a Boundary sorts first (defect 4).
   */
  readonly selection: SelectionProvider = {
    get: () => [...this.store.selectedEntityIds],
    set: (ids) => this.store.selectMultiple(ids),
  };

  readonly inspector: InspectorProvider = {
    properties: (id): PropertyDescriptor[] => {
      if (id !== this.world.id) return [];
      const props: PropertyDescriptor[] = [
        { path: 'kind', label: 'Kind', type: 'string', readonly: true },
      ];
      if (this.world.adapter !== undefined) {
        props.push({ path: 'adapter', label: 'Adapter', type: 'string', readonly: true });
      }
      if (this.world.entryOrScenePath !== undefined) {
        props.push({ path: 'path', label: 'Entry / Scene', type: 'string', readonly: true });
      }
      props.push(
        { path: 'zOrder', label: 'Z Order', type: 'number', readonly: true },
        { path: 'pausable', label: 'Pausable', type: 'boolean', readonly: true },
      );
      if (this.reason) {
        props.push({ path: 'reason', label: 'Reason', type: 'string', readonly: true });
      }
      return props;
    },
    get: (id, path) => {
      if (id !== this.world.id) return undefined;
      switch (path) {
        case 'kind':
          return this.world.kind;
        case 'adapter':
          return this.world.adapter;
        case 'path':
          return this.world.entryOrScenePath;
        case 'zOrder':
          return this.world.zOrder;
        case 'pausable':
          return this.world.pausable;
        case 'reason':
          return this.reason ?? undefined;
        default:
          return undefined;
      }
    },
    // Read-only — every property above is display-derived from the manifest;
    // there is nowhere to persist a write to (matches how a not-yet-mounted
    // world has no live document). No-op rather than throw, matching the
    // reserved-paths convention's "adapters that don't support a path simply
    // don't offer it" floor.
    set: (_id, _path, _value) => {
      // Intentionally inert.
    },
  };
}
