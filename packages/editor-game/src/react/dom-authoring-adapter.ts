/**
 * DomAuthoringAdapter — the editor's {@link AuthoringAdapter} for an
 * INGESTED (unmodified) native-React world.
 *
 * Unlike {@link ReactRootAuthoringAdapter} (the first-party react-WORLD
 * adapter, T6.2 slice 2), an ingested react game's JSX is NEVER `data-oid`-
 * stamped (three independent guards — see the design doc's §0) and is never
 * written back to (the never-modify-game-source rule, `CLAUDE.md`). So this
 * adapter cannot reuse `walkOidTree` (it would see an EMPTY tree — nothing
 * is stamped) and cannot reuse the JSX write-back seam at all. It is
 * structurally independent:
 *
 *  - Hierarchy: a derived view over the shared DOM projector
 *    (`../projection/dom.ts`) under the structural-path identity. The
 *    projector walks every ELEMENT under a live DOM root (snapshot per
 *    call — the DOM is live and may re-render, exactly like the OID
 *    scheme's "no cached/mirrored state" contract). Identity is
 *    `'rdom:' + '/'-joined <tag>[k]` segments — the DOM analog of the
 *    Object3D structural-path scheme. The root itself is not a node —
 *    its element children are the hierarchy roots.
 *  - Labels derive from real DOM only — tag, plus `#id` or the first CSS
 *    class when present — never a fabricated/authored name (anti-shim).
 *  - Persistence is LIVE-ONLY: edits write the live element's inline `style`
 *    DIRECTLY and record the same write into an in-memory
 *    {@link DomStyleEdits} document that is never saved anywhere. (Until
 *    2026-08-02 that document was flushed to a per-world JSON sidecar under
 *    the project's `.vgai/`; the owner deleted that system outright — no
 *    compat read, no replacement.) There is NO `SourceWriteBackend` import
 *    anywhere in this file and NO `/__ui-source` traffic of any kind, ever —
 *    this is the one hard invariant the design doc's §4 NOTs pin (AC-K7).
 *  - `object3D()`/`idForObject3D()` are ABSENT — these entities are DOM, not
 *    `Object3D` (no 3D gizmo binding, mirroring `ReactRootAuthoringAdapter`).
 *
 * Inspector reads/writes reuse `ReactRootAuthoringAdapter`'s pure style
 * helpers (`styleProp`/`numericStyleValue`/`cssColorToHex` — exported for
 * this purpose, D-K5) but declare their OWN `STYLE_PROPERTIES` list: this
 * adapter's writes are not routed through the JSX writer's supported-property
 * ceiling, so its list is free to diverge (kept identical today for
 * predictability — nothing stops a later slice from growing it).
 *
 * The edit document is one session-scoped JSON history resource. Exact
 * before/after documents are journaled by HistoryService and expire when this
 * mount ends — which is also when the edits themselves expire.
 */

import { numericStyleValue } from '@volter/editor-sdk/css-numeric-style';
import { createEphemeralPersistence } from '../host/authoring/ephemeral-persistence';
import { LIVE_ONLY_DESTINATION } from '@volter/editor-sdk/kit/write-pipe';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { type JournalSubject, JsonHistoryResource } from '../host/history/json-history-resource';
import { DomProjector, structuralDomIdentity } from '../host/projection/dom';
import { browserOrInlineResolver, getComputedStyleValue } from '@volter/editor-sdk/kit/ui-source/inspect';
import type {
  AssetSubjectProvider,
  AuthoringAdapter,
  AuthoringAssetSubject,
  AuthoringCapabilities,
  AuthoringProvenance,
  BoxEditProvider,
  ColorSampleProvider,
  DOMRectLike,
  EditorNode,
  HierarchyProvider,
  InspectorProvider,
  PersistenceProvider,
  PickProvider,
  PropertyDescriptor,
  RectProvider,
  SelectionProvider,
} from '@volter/editor-project/adapter';
import { cssColorToHex, mapBoxEditPatchKey, styleProp } from './react-world-authoring-adapter';

/**
 * The minimal structural shape this adapter needs from a live DOM element —
 * deliberately NOT `HTMLElement` (same testability reasoning as
 * `OidElementLike` in `react-world-authoring-adapter.ts`: this repo's vitest
 * environment for THIS adapter's own unit test is `node`, no real DOM). A
 * real `Element`/`HTMLElement` satisfies this structurally (`style` is
 * optional here for the same reason it is on `OidElementLike` — a plain
 * `Element` has no `style` getter, only `HTMLElement`/`SVGElement` do, but
 * TS treats an optional field as satisfied by its absence).
 */
export interface DomElementLike {
  readonly tagName: string;
  readonly children: ArrayLike<DomElementLike>;
  readonly id: string;
  /** HTML exposes a string; SVG exposes SVGAnimatedString. */
  readonly className: string | { readonly baseVal: string };
  readonly style?: unknown;
  readonly outerHTML?: string;
  /**
   * T0 (spec 27 §2) — the element's live viewport rect, for `rects.rect`'s
   * host-relative geometry below (see `OidElementLike.getBoundingClientRect`'s
   * identical doc comment in `react-world-authoring-adapter.ts`). Optional so
   * existing plain-object test fixtures keep type-checking unchanged — a node
   * with no `getBoundingClientRect` simply has no rect (never a fabricated 0×0).
   */
  getBoundingClientRect?(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

/** One structural-path node resolved from a live-DOM walk. */
interface DomNode {
  /** `'rdom:' + '/'-joined <tag>[k] segments` — see the class doc comment. */
  id: string;
  tag: string;
  el: DomElementLike;
  parentId: string | null;
  childIds: string[];
}

interface DomTree {
  nodes: Map<string, DomNode>;
  rootIds: string[];
}

/** First whitespace-separated CSS class across HTML and SVG DOM elements. */
function firstClassName(
  className: DomElementLike['className'] | null | undefined,
): string | undefined {
  const value = typeof className === 'string' ? className : className?.baseVal;
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

/** Real-DOM-only label (anti-shim): tag, `#id` when present, else `.firstClass` when present. */
function labelFor(el: DomElementLike, tag: string): string {
  if (el.id) return `${tag}#${el.id}`;
  const cls = firstClassName(el.className ?? '');
  if (cls) return `${tag}.${cls}`;
  return tag;
}

function viewFromProjection(projector: DomProjector<DomElementLike>): DomTree {
  const nodes = new Map<string, DomNode>();
  for (const [id, node] of projector.nodes) {
    nodes.set(id, {
      id,
      tag: node.object.tagName.toLowerCase(),
      el: node.object,
      parentId: node.parentId,
      childIds: [...node.childIds],
    });
  }
  return { nodes, rootIds: [...projector.rootIds] };
}

/** A reasonably useful, curated inline-style property list — this adapter's
 *  OWN list (D-K2: not shared with `ReactRootAuthoringAdapter`'s, though
 *  kept identical in shape today — this one is not bounded by a JSX writer's
 *  supported-property ceiling). */
const STYLE_PROPERTIES: ReadonlyArray<{
  prop: string;
  label: string;
  type: PropertyDescriptor['type'];
  options?: string[];
}> = [
  { prop: 'color', label: 'Color', type: 'color' },
  { prop: 'backgroundColor', label: 'Background', type: 'color' },
  { prop: 'borderColor', label: 'Border Color', type: 'color' },
  { prop: 'fontSize', label: 'Font Size', type: 'number' },
  { prop: 'width', label: 'Width', type: 'number' },
  { prop: 'height', label: 'Height', type: 'number' },
  { prop: 'padding', label: 'Padding', type: 'number' },
  { prop: 'margin', label: 'Margin', type: 'number' },
  { prop: 'borderRadius', label: 'Border Radius', type: 'number' },
  { prop: 'gap', label: 'Gap', type: 'number' },
  { prop: 'display', label: 'Display', type: 'enum', options: ['flex', 'block', 'none', 'grid'] },
  { prop: 'textAlign', label: 'Text Align', type: 'enum', options: ['left', 'center', 'right'] },
  { prop: 'flexDirection', label: 'Flex Direction', type: 'enum', options: ['row', 'column'] },
];
const STYLE_PATH_PREFIX = 'style.';

/** `prop -> declared type` — see `ReactRootAuthoringAdapter`'s identical map
 *  for why `inspector.get` needs this (a real CSSOM value is always a
 *  unit-suffixed string / an `rgb(...)` string, never a bare number/hex). */
const STYLE_PROPERTY_TYPE: ReadonlyMap<string, PropertyDescriptor['type']> = new Map(
  STYLE_PROPERTIES.map(({ prop, type }) => [prop, type]),
);

/** structural id -> cssProp -> value (D-K3). Values are always strings — the
 *  same literal an inline style write uses. In-memory for this session only. */
export type DomStyleEdits = Record<string, Record<string, string>>;

export interface DomAuthoringOptions {
  /**
   * The UNDO axis — whose journal this mount's live edits belong to. See the
   * ownership block in `history/json-history-resource.ts`: a held DOM surface's
   * subject is its world, which outlives the mount.
   */
  readonly journal: JournalSubject;
}

interface DomHistoryState {
  edits: DomStyleEdits;
  styles: Record<string, Record<string, string>>;
}

export class DomAuthoringAdapter implements AuthoringAdapter {
  // THE ABSENT COLUMN, stated so a reader never has to guess whether a missing
  // provider is a decision or an oversight. Facts about THIS ADAPTER CLASS —
  // true for every live DOM it is pointed at, never per-game:
  //
  //  - `transforms` — a DOM node has no 3D
  //    pose for the gizmo to drive; its spatial seam is `boxEdit`/`rects` below.
  //  - `structure` / `text` / `assetDrop` — this adapter's edit document is
  //    `DomStyleEdits`: structural id -> cssProp -> value, and nothing else.
  //    It has no vocabulary for creating, removing or re-texting an element, so
  //    every one of these would write into a live document it cannot record, undo
  //    or reconcile — and its ids are structural paths, so an insert or a removal
  //    re-indexes the siblings every existing edit is keyed by. A live-insert /
  //    live-write seam for a foreign DOM is a HOST work order, not a per-mount
  //    shim; until it exists, absence is the honest report.
  //  - `stories` — a story is declared in a PROJECT's own portable CSF source
  //    ("Association is derived from portable CSF source, never an editor-private
  //    label or registry", ARCHITECTURE-CORE §Roots). This adapter projects a
  //    game's live DOM, which is not owned source.
  //  - `creationSite` — no index is built here. Unlike the four above this is not
  //    an impossibility: a same-realm game's elements ARE appended by readable
  //    source, so an index is buildable and its absence is a standing host gap.
  readonly capabilities: AuthoringCapabilities = {
    transform: false, // no 3D gizmo — DOM has no Object3D pose
    inspectorFields: true,
    persist: false, // live-only: this game has no source path the editor may write
  };

  readonly provenance: AuthoringProvenance = {
    source: 'foreign',
    label: 'live-only',
    detail:
      'Unmodified ingested React game — style edits apply for this session only and are never saved.',
  };

  private readonly doc: DomStyleEdits = {};
  private readonly historyResource: JsonHistoryResource<DomHistoryState> | null;
  /** The shared DOM projector under the structural-path identity. */
  private readonly projector = new DomProjector(structuralDomIdentity<DomElementLike>());
  /** Synchronous-burst cache for `snapshot()` — see that method's doc. */
  private snapCache: DomTree | null = null;
  private snapInvalidationScheduled = false;
  /**
   * T0 (spec 27 §4, B1) — the currently-open `boxEdit` begin/apply×N/end gesture, or
   * `null` between gestures. Mirrors `ReactRootAuthoringAdapter.boxEditSession` (see
   * its doc comment for why `priorInline` exists) — `touched` here maps prop → the
   * FINAL CSS-STRING value to write (this adapter always stores CSS strings,
   * never bare numbers, unlike the react-world source-write route).
   */
  private boxEditSession: {
    id: string;
    touched: Map<string, string>;
    priorInline: Map<string, string>;
  } | null = null;
  /** D4 (spec27 §6 D4, layer-tree "lock" toggle) — kept out of the edit
   *  document entirely: an ingested game's DOM has no "locked" concept (the
   *  document only ever records style overrides). See
   *  `ReactRootAuthoringAdapter.lockedIds`'s doc comment for the same
   *  reasoning, INCLUDING D4.R1 (now read by `pickable.pick` below and by
   *  the selection overlay's marquee candidate pool; NOT by `hierarchy`/`selection` —
   *  a locked node stays selectable/unlockable from the layer tree). */
  private readonly lockedIds = new Set<string>();

  constructor(
    private readonly root: DomElementLike,
    private readonly store: EditorShellStore,
    opts: DomAuthoringOptions,
  ) {
    const history = store.shell.projectHistory;
    this.historyResource = history
      ? new JsonHistoryResource({
          history,
          kind: 'session-state',
          scope: 'session',
          // The SUBJECT's session, not this mount's — see the ownership block
          // in `history/json-history-resource.ts`.
          subject: { ...opts.journal, id: `${opts.journal.id}/react-dom-edits` },
          displayName: 'React DOM edits',
          capture: () => this.captureHistoryState(),
          restore: async (state) => {
            this.restoreHistoryState(state);
          },
        })
      : null;
  }

  /**
   * A live-DOM walk, memoized for the current SYNCHRONOUS burst only.
   *
   * `hierarchy.node(id)` is called once per node by the shell's row flattener
   * (`flattenHierarchyRows`), and a large live react game (react-rpg's dungeon
   * is ~1900 walked rows over a several-thousand-element DOM) turned that into
   * an O(N²) re-walk-per-node — a ~9s synchronous block that hung the editor
   * on selection (the hierarchy re-renders synchronously inside the click's
   * discrete-event flush). JS is single-threaded, so the DOM cannot change
   * mid-render: caching the walk for the current synchronous stack and
   * invalidating it on the next microtask keeps the "the DOM is live, never
   * stale across renders" contract (a subsequent render, after the game may
   * have re-rendered, re-walks) while collapsing one render's N node() calls
   * to ONE walk. Style READS stay live regardless — `inspector.get` reads
   * `n.el.style` off the cached element ref, not a cached value. Structural
   * mutations (none in v1 — this adapter has no `structure` provider) would
   * land between ticks (the game's own re-render), which the microtask
   * invalidation already covers.
   */
  private snapshot(): DomTree {
    if (this.snapCache) return this.snapCache;
    this.projector.project(this.root);
    const tree = viewFromProjection(this.projector);
    this.snapCache = tree;
    if (!this.snapInvalidationScheduled) {
      this.snapInvalidationScheduled = true;
      queueMicrotask(() => {
        this.snapCache = null;
        this.snapInvalidationScheduled = false;
      });
    }
    return tree;
  }

  /**
   * D-L1 — total ELEMENT nodes currently walked under the
   * root: a fresh snapshot every call (same "the DOM is live and may
   * re-render, never cached" discipline as
   * `hierarchy.roots()`/`hierarchy.node()` above), not a count taken once at
   * construction. Backs `__vgaiIngestReact.domEvidence().hierarchyNodeCount`
   * — one of the four legs `vgai doctor`'s react-ingest MOUNTED bar requires
   * (`clearsReactIngestMountedBar`, `packages/editor/src/doctor/report.ts`).
   */
  nodeCount(): number {
    return this.snapshot().nodes.size;
  }

  private toEditorNode(n: DomNode): EditorNode {
    return {
      id: n.id,
      label: labelFor(n.el, n.tag),
      role: 'element',
      kind: n.tag,
      parentId: n.parentId,
      childIds: n.childIds,
    };
  }

  private applyStyleToElement(el: DomElementLike, prop: string, value: string): void {
    if (!el.style) return;
    (el.style as Record<string, unknown>)[prop] = value;
  }

  private recordStyleEdit(id: string, prop: string, value: string): void {
    const entry = this.doc[id] ?? {};
    entry[prop] = value;
    this.doc[id] = entry;
  }

  readonly hierarchy: HierarchyProvider = {
    roots: () => {
      const { nodes, rootIds } = this.snapshot();
      return rootIds.map((id) => this.toEditorNode(nodes.get(id)!));
    },
    node: (id) => {
      const n = this.snapshot().nodes.get(id);
      return n ? this.toEditorNode(n) : null;
    },
    // No `object3D`/`idForObject3D`: DOM, not Object3D — the concept does not
    // apply here (no 3D gizmo binding).
  };

  readonly selection: SelectionProvider = {
    get: () => [...this.store.shell.selectedEntityIds],
    set: (ids) => this.store.shell.selectMultiple(ids),
  };

  /**
   * A2 gap close-out (spec 27 §2, spec:237-254/spec:251-254) — GEOMETRIC rect
   * hit-test over the live DOM tree, symmetric with
   * `ReactRootAuthoringAdapter.pickable` (see that provider's doc comment
   * for the full rationale, identical here): NOT `document.elementFromPoint`
   * (which skips a `pointer-events:none` design-time wrapper), smallest-area
   * element containing the point wins (the deepest/most-specific node), ties
   * broken by later tree-walk order (the topmost). Without this, an ingested
   * react world's `rdom:`-id nodes are never `pickable`, so the shell's
   * `pickTopmost` (`layered-pick.ts`) always falls through to `null` for this
   * adapter — click-to-select through the viewport never resolves any node,
   * even though `hierarchy`/`selection` already work from the panel.
   *
   * The winning id is the SAME structural `rdom:<tag>[k]` id
   * `hierarchy`/`selection` already use — a hit routes straight into
   * `composite.selection.set([id])` with no translation.
   */
  readonly pickable: PickProvider = {
    pick: (clientX, clientY) => {
      const { nodes } = this.snapshot();
      let bestId: string | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      let bestOrder = -1;
      let order = -1;
      for (const node of nodes.values()) {
        order++;
        // D4.R1 — a locked node is SKIPPED, not returned (falls through to
        // whatever unlocked node is behind/around it) — mirrors
        // `ReactRootAuthoringAdapter.pickable`'s identical fix and the
        // first-party `viewport-raycast.ts` locked-skip.
        if (this.lockedIds.has(node.id)) continue;
        // The host layer is pointer-events:none at rest, so computed style
        // would make every descendant appear non-interactive. Honor only the
        // node's own explicit declaration: a transparent full-size wrapper
        // must not swallow picks intended for a world below it.
        if ((node.el.style as { pointerEvents?: unknown } | undefined)?.pointerEvents === 'none') {
          continue;
        }
        const rect = node.el.getBoundingClientRect?.();
        if (!rect) continue; // no live rect (test fixture, or unmounted) — never a candidate
        if (
          clientX < rect.left ||
          clientX > rect.right ||
          clientY < rect.top ||
          clientY > rect.bottom
        ) {
          continue;
        }
        const area = rect.width * rect.height;
        // smallest-area (deepest) wins; ties broken by later tree-order (topmost)
        if (area < bestArea || (area === bestArea && order > bestOrder)) {
          bestId = node.id;
          bestArea = area;
          bestOrder = order;
        }
      }
      return bestId;
    },
  };

  /** Host rect to subtract for {@link rects}' HOST-RELATIVE geometry — same
   *  reasoning as `ReactRootAuthoringAdapter.hostRect` (this adapter's own
   *  `this.root` is symmetrically the ingested world's mounted DOM layer). */
  private hostRect(): { left: number; top: number } {
    const r = this.root.getBoundingClientRect?.();
    return { left: r?.left ?? 0, top: r?.top ?? 0 };
  }

  private toHostRelative(r: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): DOMRectLike {
    const host = this.hostRect();
    return { x: r.left - host.left, y: r.top - host.top, width: r.width, height: r.height };
  }

  /**
   * T0 (spec 27 §2) — per-node screen geometry, HOST-RELATIVE (see
   * {@link hostRect}'s doc comment), symmetric with
   * `ReactRootAuthoringAdapter.rects` so the overlay this feeds (Phase A3)
   * treats both react adapters identically.
   */
  readonly rects: RectProvider = {
    rect: (id) => {
      const n = this.snapshot().nodes.get(id);
      const r = n?.el.getBoundingClientRect?.();
      return r ? this.toHostRelative(r) : null;
    },
    contextRects: (id) => {
      const { nodes } = this.snapshot();
      const n = nodes.get(id);
      if (!n) return {};
      const parentNode = n.parentId ? nodes.get(n.parentId) : undefined;
      const parentRect = parentNode?.el.getBoundingClientRect?.();
      const siblingIds = (parentNode ? parentNode.childIds : this.snapshot().rootIds).filter(
        (sid) => sid !== id,
      );
      const siblings = siblingIds
        .map((sid) => nodes.get(sid)?.el.getBoundingClientRect?.())
        .filter((r): r is NonNullable<typeof r> => r != null)
        .map((r) => this.toHostRelative(r));
      const el = n.el;
      const rect = el.getBoundingClientRect?.();
      let paddingBox: DOMRectLike | undefined;
      if (rect) {
        const bt =
          numericStyleValue(getComputedStyleValue(el, 'borderTopWidth', browserOrInlineResolver)) ??
          0;
        const br =
          numericStyleValue(
            getComputedStyleValue(el, 'borderRightWidth', browserOrInlineResolver),
          ) ?? 0;
        const bb =
          numericStyleValue(
            getComputedStyleValue(el, 'borderBottomWidth', browserOrInlineResolver),
          ) ?? 0;
        const bl =
          numericStyleValue(
            getComputedStyleValue(el, 'borderLeftWidth', browserOrInlineResolver),
          ) ?? 0;
        paddingBox = this.toHostRelative({
          left: rect.left + bl,
          top: rect.top + bt,
          width: Math.max(0, rect.width - bl - br),
          height: Math.max(0, rect.height - bt - bb),
        });
      }
      return {
        ...(parentRect ? { parent: this.toHostRelative(parentRect) } : {}),
        ...(siblings.length ? { siblings } : {}),
        ...(paddingBox ? { paddingBox } : {}),
      };
    },
  };

  /**
   * D3.d (spec 27 §6) — eyedropper FALLBACK color-sample path, symmetric with
   * `ReactRootAuthoringAdapter.colorSample` (see that provider's doc comment
   * for the full rationale — raw/un-normalized values, hit-element first).
   */
  readonly colorSample: ColorSampleProvider = {
    backgroundChainAt: (clientX, clientY) => {
      const hitId = this.pickable.pick(clientX, clientY);
      if (!hitId) return null;
      const { nodes } = this.snapshot();
      const chain: string[] = [];
      let cur: DomNode | undefined = nodes.get(hitId);
      while (cur) {
        chain.push(getComputedStyleValue(cur.el, 'backgroundColor', browserOrInlineResolver));
        cur = cur.parentId ? nodes.get(cur.parentId) : undefined;
      }
      return chain;
    },
  };

  /**
   * T0 (spec 27 §4, B1) — same interface as `ReactRootAuthoringAdapter.boxEdit`,
   * routed to the live element + this session's in-memory edit document instead of
   * source (spec:305 — "Ingested adapter routes ... instead of source, same
   * interface"). `apply` is LIVE PREVIEW ONLY — it mutates the live element's inline
   * style via `applyStyleToElement` WITHOUT touching `this.doc`. `end` commits
   * every touched prop ONCE through {@link writeStyleEntry} (preserving the
   * restore-BOTH-halves undo invariant, D-K2), composed into exactly ONE undo entry
   * for the whole gesture (acceptance:310) even across multiple touched props.
   */
  readonly boxEdit: BoxEditProvider = {
    begin: (id) => {
      this.historyResource?.assertCanMutate();
      this.boxEditSession = { id, touched: new Map(), priorInline: new Map() };
    },
    apply: (id, patch) => {
      this.historyResource?.assertCanMutate();
      const session = this.boxEditSession;
      if (!session || session.id !== id) return; // no open gesture for this id
      const n = this.snapshot().nodes.get(id);
      if (!n) return; // unresolved id — no-op (per contract)
      const pos = getComputedStyleValue(n.el, 'position', browserOrInlineResolver);
      const isPositioned = pos === 'absolute' || pos === 'fixed';
      for (const [key, v] of Object.entries(patch)) {
        const mapped = mapBoxEditPatchKey(key, isPositioned);
        if (!mapped) {
          // biome-ignore lint/suspicious/noConsole: a dropped edit must not be silent
          console.warn(
            `[DomAuthoringAdapter] boxEdit: dropping patch key "${key}" for "${id}" — ` +
              (key === 'x' || key === 'y'
                ? `node is not absolutely/fixed positioned (computed position: "${pos}"), ` +
                  'no left/top to move'
                : 'unrecognized box-edit patch key'),
          );
          continue;
        }
        // Lazily snapshot the TRUE pre-gesture inline value the first time THIS
        // prop is touched in this gesture — before mutating it (see
        // `boxEditSession`'s doc comment, mirroring the react-world adapter).
        if (!session.priorInline.has(mapped.prop)) {
          const prevRaw = styleProp(n.el.style, mapped.prop);
          session.priorInline.set(mapped.prop, prevRaw == null ? '' : String(prevRaw));
        }
        const cssValue = mapped.cssValue(v);
        this.applyStyleToElement(n.el, mapped.prop, cssValue);
        session.touched.set(mapped.prop, cssValue); // this route always commits CSS strings
      }
    },
    end: (id) => {
      const session = this.boxEditSession;
      this.boxEditSession = null;
      if (!session || session.id !== id || session.touched.size === 0) return;
      this.commitBoxEdit(id, session.touched, session.priorInline);
    },
  };

  /**
   * T0 (spec 27 §4, B1) — commit every prop touched by one `boxEdit` gesture, each
   * through {@link writeStyleEntry} (preserving the restore-BOTH-halves undo
   * invariant per prop), composed into exactly ONE undo entry (acceptance:310) whose
   * inverse runs in REVERSE order and whose redo runs in gesture order.
   */
  private commitBoxEdit(
    id: string,
    touched: Map<string, string>,
    priorInline: Map<string, string>,
  ): void {
    this.historyResource?.assertCanMutate();
    const before = this.captureHistoryState();
    const beforeStyles = before.styles[id] ?? {};
    before.styles[id] = beforeStyles;
    for (const [prop, value] of priorInline) beforeStyles[prop] = value;
    let changed = false;
    for (const [prop, value] of touched) {
      changed = this.writeStyleEntry(id, prop, value) || changed;
    }
    if (!changed) return;
    if (this.historyResource) {
      void this.historyResource
        .record(`Edit ${touched.size} Styles`, before, this.captureHistoryState())
        .catch(() => {});
    }
  }

  readonly inspector: InspectorProvider = {
    properties: (): PropertyDescriptor[] =>
      STYLE_PROPERTIES.map(({ prop, label, type, options }) => ({
        path: `${STYLE_PATH_PREFIX}${prop}`,
        label,
        type,
        ...(options ? { options } : {}),
      })),
    get: (id, path) => {
      // D4 (spec27 §6 D4, layer-tree visibility/lock) — see
      // `ReactRootAuthoringAdapter`'s matching branch for the reasoning
      // (`locked` session-local; `visible` sugar for the `visibility` inline
      // style — this adapter writes synchronously, so no echo is needed).
      if (path === 'locked') return this.lockedIds.has(id);
      if (path === 'visible') {
        const n = this.snapshot().nodes.get(id);
        if (!n) return undefined;
        return styleProp(n.el.style, 'visibility') !== 'hidden';
      }
      if (!path.startsWith(STYLE_PATH_PREFIX)) return undefined;
      const prop = path.slice(STYLE_PATH_PREFIX.length);
      const n = this.snapshot().nodes.get(id);
      if (!n) return undefined;
      const raw = styleProp(n.el.style, prop);
      const declaredType = STYLE_PROPERTY_TYPE.get(prop);
      if (declaredType === 'number') return numericStyleValue(raw);
      if (declaredType === 'color') return cssColorToHex(raw);
      return raw;
    },
    set: (id, path, value) => {
      if (path === 'locked') {
        if (value) this.lockedIds.add(id);
        else this.lockedIds.delete(id);
        this.store.shell.notifyIngestEdit();
        return;
      }
      if (path === 'visible') {
        this.writeStyle(id, 'visibility', value ? 'visible' : 'hidden');
        return;
      }
      if (!path.startsWith(STYLE_PATH_PREFIX)) return;
      const prop = path.slice(STYLE_PATH_PREFIX.length);
      this.writeStyle(id, prop, String(value));
    },
  };

  readonly assetSubject: AssetSubjectProvider = {
    get: (id) => this.assetSubjectForNode(this.snapshot(), id),
    entries: () => {
      const tree = this.snapshot();
      return [...tree.nodes.keys()].flatMap((id) => {
        const subject = this.assetSubjectForNode(tree, id);
        return subject ? [{ id, subject }] : [];
      });
    },
  };

  private assetSubjectForNode(tree: DomTree, id: string): AuthoringAssetSubject | null {
    const node = tree.nodes.get(id);
    if (!node || node.tag !== 'svg' || !node.el.outerHTML) return null;
    return {
      kind: 'image',
      name: labelFor(node.el, node.tag),
      mediaType: 'image/svg+xml',
      text: node.el.outerHTML,
    };
  }

  /**
   * T0 (spec 27 §4, B1) — the write body extracted from {@link writeStyle}, returning
   * whether the edit document changed so a multi-property box gesture can record once.
   * `priorInlineOverride`, when given, is used as the captured PRE-gesture inline value
   * instead of re-reading `n.el.style` — needed because `boxEdit.apply` already mutated
   * the live inline style for preview before `end` gets here (see `boxEditSession`'s
   * doc comment). D-K2's restore-BOTH-halves invariant (inline AND document) is
   * unchanged — only WHERE `prevInline` comes from differs when an override is given.
   */
  private writeStyleEntry(id: string, prop: string, value: string): boolean {
    const n = this.snapshot().nodes.get(id);
    if (!n) return false;

    this.applyStyleToElement(n.el, prop, value);
    this.recordStyleEdit(id, prop, value);
    this.store.shell.notifyIngestEdit();

    return true;
  }

  /**
   * D-K2: mutate the live element's inline style AND the in-memory edit
   * document, then journal the complete state as one session transaction.
   */
  private writeStyle(id: string, prop: string, value: string): void {
    this.historyResource?.assertCanMutate();
    const before = this.captureHistoryState();
    if (!this.writeStyleEntry(id, prop, value)) return;
    if (this.historyResource) {
      void this.historyResource
        .record(`Set ${prop}`, before, this.captureHistoryState())
        .catch(() => {});
    }
  }

  dispose(): void {
    this.historyResource?.dispose();
  }

  private captureHistoryState(): DomHistoryState {
    const styles: DomHistoryState['styles'] = {};
    for (const [id, node] of this.snapshot().nodes) {
      const values: Record<string, string> = {};
      for (const { prop } of STYLE_PROPERTIES) {
        const value = styleProp(node.el.style, prop);
        if (value !== '') values[prop] = String(value);
      }
      styles[id] = values;
    }
    return { edits: structuredClone(this.doc), styles };
  }

  private restoreHistoryState(state: DomHistoryState): void {
    for (const key of Object.keys(this.doc)) delete this.doc[key];
    Object.assign(this.doc, structuredClone(state.edits));
    const { nodes } = this.snapshot();
    for (const [id, node] of nodes) {
      const values = state.styles[id] ?? {};
      for (const { prop } of STYLE_PROPERTIES) {
        this.applyStyleToElement(node.el, prop, values[prop] ?? '');
      }
    }
    this.store.shell.notifyIngestEdit();
  }

  subscribe(listener: () => void): () => void {
    return this.store.shell.subscribe(listener);
  }

  /**
   * Live-only: an unmodified React game has no source path this editor may
   * write, so this reports the ephemeral provider honestly rather than a file.
   */
  get persistence(): PersistenceProvider {
    return { ...createEphemeralPersistence(), destination: LIVE_ONLY_DESTINATION };
  }
}
