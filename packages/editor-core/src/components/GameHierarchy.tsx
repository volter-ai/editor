import {
  Button,
  chromeSize,
  IconButton,
  Menu,
  MenuItem,
  space,
  TextInput,
  ThemeRootPortal,
  themeVars,
  zIndex,
} from '@volter/editor-sdk/widgets';
import { authoringAdapterKey } from '../authoring/adapter-key';

/**
 * GameHierarchy — the ONE hierarchy panel (A2). Replaces the former pair of
 * per-format hierarchy panels (first-party single-document, ingested-game) — a
 * single contract-only shell driven ENTIRELY through the active {@link
 * AuthoringAdapter}: `hierarchy`/`selection`/`inspector`/ `structure`/`assetDrop`.
 * Every row affordance is gated on the PRESENCE of a provider or a reserved
 * inspector path, never on which concrete adapter is active.
 *
 * Rule zero (spec §0): this file imports ONLY from `@volter/editor-project/adapter` types
 * and editor-shell modules — no private first-party entity type, no direct
 * 3D-library value import, no first-party document-format string literal.
 * First-party-only affordances not yet contract-expressible live behind
 * `hierarchy-menu-registry.ts`'s escape hatch, registered elsewhere by the
 * owning adapter module (formerly prefab unpack/open/save-as; currently
 * unregistered).
 *
 * Shape handling: project authoring is a `CompositeAuthoringAdapter` for every
 * N >= 1 composition. The Game document projects that whole composite; an
 * authored root document projects only its owning child. In the composite,
 * each runtime world is a synthetic `world:<id>` group; adapter-owned surfaces
 * such as scene UI may be nested beneath their owning world without pretending
 * to be runtime roots. The same generic row engine also handles bare adapters
 * used by root documents, bounded ingest and compatibility sessions. Both
 * shapes are walked by the SAME generic row engine
 * (`flattenHierarchyRows` — the format-neutral `EditorNode`-typed row
 * flattener, not the legacy first-party-typed sibling module); a group node
 * only ever gets a small set of cosmetic extras (kind/zOrder badge, a
 * session-local eye) layered on TOP of the same row component.
 *
 * Testids: every row carries BOTH the
 * `data-entity-name`/`data-testid="scene-name"` family (what
 * `EditorPage.getEntityNames` reads) and the full `ingest-*` family
 * (`ingest-row`, `ingest-row-caret`, `ingest-row-visibility`,
 * `ingest-search`, `ingest-hierarchy`, `data-ingest-name`,
 * `ingest-context-menu`), so a probe can address any row by either
 * vocabulary regardless of which adapter produced it.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faCaretDown,
  faCaretRight,
  faChevronDown,
  faCircleDot,
  faCirclePlay,
  faCrosshairs,
  faEye,
  faEyeSlash,
  faFileCode,
  faFolder,
  faHandPointer,
  faLayerGroup,
  faLock,
  faLockOpen,
  faMagnifyingGlass,
  faObjectGroup,
  faPlus,
  faPuzzlePiece,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { CollaborationSnapshot } from '@volter/editor-sdk/session/collaboration-types';
import {
  clampRectToViewport,
  DisclosureIcon,
  DropIndicator,
  EditorIcon,
  EditorToolbar,
  lineHeightVar,
  Panel,
  spaceVar,
} from '@volter/editor-sdk/widgets';
import type {
  AuthoringAdapter,
  AuthoringProvenance,
  EditorNode,
  EditorNodeRole,
  HierarchyProvider,
} from '@volter/editor-project/adapter';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
  activeAuthoringVersion,
  hasAuthoringOverride,
  subscribeActiveAuthoring,
} from '@volter/editor-sdk/kit/authoring/active-adapter';
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import {
  copyAuthoringNodes,
  createAuthoringNode,
  cutAuthoringNodes,
  dropAuthoringAsset,
  duplicateAuthoringNode,
  groupAuthoringNodes,
  pasteAuthoringNodes,
  reorderAuthoringNode,
  reparentAuthoringNode,
  setAuthoringSelection,
  ungroupAuthoringNode,
  unwrapAuthoringNode,
  wrapAuthoringNode,
} from '@volter/editor-sdk/kit/authoring/consumer-actions';
import { enterInstanceRow } from '@volter/editor-sdk/kit/authoring/instance-source-menu';
import { resolvePanelAuthoring } from '@volter/editor-sdk/kit/authoring/panel-authoring';
import {
  authoringDestination,
  provenanceForNode,
  unavailableReason,
} from '@volter/editor-sdk/kit/authoring/provenance';
import {
  selectionScopeStack,
  selectionScopeVersion,
  setSelectionScope,
  subscribeSelectionScope,
} from '@volter/editor-sdk/kit/authoring/selection-scope';
import { resolveThreeViewportRootId } from '@volter/editor-sdk/kit/authoring/three-root';
import {
  isRootHidden,
  isRootInteractive,
  isRootPickLocked,
  toggleRootHidden,
  toggleRootInteractive,
  toggleRootPickLock,
} from '@volter/editor-sdk/kit/authoring/world-session-state';
import { collaborationSnapshot, connectCollaboration } from '@volter/editor-sdk/kit/collaboration-client';
import { openRegisteredDocument } from '@volter/editor-sdk/kit/document-open-registry';
import { deleteSelection, duplicateSelection } from '../editor-hotkeys';
import { EDITOR_PARTICIPANT_ID } from '@volter/editor-sdk/kit/editor-presence';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import {
  applyComponentRootExpansionDefaults,
  componentMarkView,
  type MarkedTreeSource,
  NO_MARKS,
} from '@volter/editor-sdk/kit/hierarchy-component-marks';
import { hierarchyDropRefusal, isSameRootDrop } from '../hierarchy-drop';
import {
  clearHierarchyExpansionPreferences,
  hierarchyExpansionPreference,
  setHierarchyExpansionPreferences,
} from '../hierarchy-expansion-state';
import { hierarchyHeaderSlot, subscribeHierarchyHeaderSlot } from '../hierarchy-header-slot';
import { applyRevealExpansionDefaults, internalsProjection } from '@volter/editor-sdk/kit/hierarchy-internals';
import {
  hierarchyKindIcon,
  isDatablockKind,
  OUTLINER_EXCLUDE_OFF,
  OUTLINER_EXCLUDE_ON,
  OUTLINER_RENDER_OFF,
  OUTLINER_RENDER_ON,
} from '@volter/editor-sdk/kit/hierarchy-kind-icon';
import { getHierarchyMenuItems } from '@volter/editor-sdk/kit/hierarchy-menu-registry';
import {
  flattenHierarchyRows,
  type HierarchyNodeRow,
  hierarchyRowKey,
  hierarchyRowWindow,
  patchUniqueHierarchyRows,
} from '@volter/editor-sdk/kit/hierarchy-node-rows';
import {
  clearHierarchyPanelSnapshot,
  type HierarchyPanelSnapshot,
  publishHierarchyPanelSnapshot,
} from '../hierarchy-panel-view';
import {
  ancestorPathKeys,
  HierarchyRowCache,
  indexRowPaths,
  type RowPathIndex,
  revealSignature,
  selectedAncestorNodeIds,
  selectedRevealCounts,
} from '../hierarchy-row-cache';
import {
  type RowDiagnosticsSource,
  RowWarningCache,
  rowAffordances,
  rowIdentity,
  TransformLockCache,
  UNLOCKED,
} from '@volter/editor-sdk/kit/hierarchy-row-model';
import { CHILD_CAP } from '@volter/editor-sdk/kit/hierarchy-rows';
import { setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';
import { focusedStageStore } from '@volter/editor-sdk/kit/stage-context';
import { editorPaintedRegions, subscribeEditorTheme } from '../theme-preference';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  activeChromeRegions,
  type ChromeRegions,
  chromeRegionsKey,
  subscribeChromeRegions,
} from '@volter/editor-sdk/kit/workspace-regions';
import { activateRootDocument } from '../world-document-routing';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import { hierarchyRowMedia, subscribeHierarchyRowMedia } from '@volter/editor-sdk/kit/hierarchy-row-media';

const ASSET_MIME = 'application/x-editor-asset';
const REORDER_MIME = 'application/x-hierarchy-reorder';
/**
 * The row's height as the ACTIVE material declares it.
 *
 * `chromeSize.treeRow` is the editor's OWN default (24). A material may
 * retune it — Blender's does, to the 20px its Outliner rows measure — and a
 * constant read at module load never learns that: the row was painted at the
 * inline 24 while `--vgai-tree-row-height` said 20, so the density
 * contribution reached nothing. The spacer math, hit-testing and reveal
 * scrolling must all use the number the row is actually painted at.
 *
 * Measured from a live row FIRST (the paint is the truth), then the declared
 * var, then the default — the shape the workspace host's `bottomTabStripHeight`
 * uses for the dock's own tab strip.
 *
 * THE ROW HEIGHT IS NOT WHY THE MODEL OUTLINER LOOKS SHORT — do not come here
 * to fix that. Measured 2026-09-21 through the chrome door on a live model
 * session (`editor.document.query('.vgai-tree-row', { scope: 'outliner',
 * styles: [...] })`): computed `height: 20px`, rendered rect 20, row pitch
 * exactly 20, `--vgai-tree-row-height: "20px"` — and Blender's own Outliner in
 * `blender-reference/modeling-object-none.png` steps 40 device px at native 2x,
 * i.e. the same 20. The two agree exactly, and `blender.style.ts`'s
 * `treeRow: 20` is what puts them there.
 *
 * What is short is the PANEL. On a first boot in a 953-CSS-tall window the
 * Outliner view's pane is 155 px of an 860 px sidebar column — 18.0 %, which is
 * the `weight: 18` that `packages/model-editor/workbench/src/
 * product.contribution.ts` declares from Blender's own area measurement
 * (189/1028). Of those 155, 22 go to the workbench's pane title bar (Blender's
 * area has none) and ~22 to this panel's header, leaving 109 px = 5.45 rows
 * where Blender at the same column height shows ~6.6. The missing row is that
 * title bar, and the one line that could buy it back is the product's weight —
 * which is compiled into the Code-OSS release, so it cannot be changed and
 * verified from this repo alone.
 */
function treeRowHeight(container: HTMLElement | null): number {
  const row = container?.querySelector<HTMLElement>('.vgai-tree-row');
  const measured = row?.getBoundingClientRect().height ?? 0;
  if (measured > 0) return Math.round(measured);
  const declared = container
    ? Number.parseFloat(getComputedStyle(container).getPropertyValue('--vgai-tree-row-height'))
    : Number.NaN;
  return Number.isFinite(declared) && declared > 0 ? declared : chromeSize.treeRow;
}
/**
 * ONE LEVEL OF TREE INDENT, as the ACTIVE material declares it
 * (`chromeSize.treeIndent`, default 14 — the number this constant always
 * held). A material may retune it, and Blender's does: its Outliner steps by
 * its ROW HEIGHT, a square grid, measured at 20 on `outliner.png`. Spelled as
 * the CSS variable rather than read once at module load, for the reason
 * `treeRowHeight` above records — a constant read at load never learns what a
 * density contribution declares.
 */
const INDENT = 'var(--vgai-tree-indent)';
/** `left`/`padding-left` for a row at `depth`, in the material's own step. */
function indentPx(depth: number): string {
  return `calc(${INDENT} * ${depth})`;
}
/**
 * How far the INDENT GUIDE is held back from the first and last row of the
 * block it spans. Measured on `modeling-object-none.png` (Blender 5.2, native
 * 2x, object mode): the rule runs y 143..242 over child rows 133..172,
 * 173..212 and 213..252 — 10 device px in at the top, 10 short at the bottom,
 * and unbroken in between. See `.vgai-tree-indent-guide` in `theme.css` for
 * the ink, the column and where the frame stops answering.
 */
const GUIDE_BLOCK_INSET = 5;
/** One ancestor column's rule, as this row draws its slice of it. */
interface IndentGuide {
  /** The ancestor's depth — the caret column the rule sits on. */
  readonly column: number;
  /** This row is the first of that ancestor's block, so the rule starts here. */
  readonly starts: boolean;
  /** This row is the last of that ancestor's block, so the rule ends here. */
  readonly ends: boolean;
}
/**
 * The guide slices a row at `depth` draws, given its neighbours' depths in the
 * flattened list (`-1` where there is no neighbour). A visible row's every
 * ancestor is open by construction, so it crosses one rule per level above it;
 * the ends are local facts — the row starts a block when the row above it IS
 * that ancestor, and ends every block the row below it has left.
 */
function indentGuidesFor(depth: number, prevDepth: number, nextDepth: number): IndentGuide[] {
  const guides: IndentGuide[] = [];
  for (let column = 0; column < depth; column++) {
    guides.push({
      column,
      starts: prevDepth === column,
      ends: nextDepth <= column,
    });
  }
  return guides;
}
const EMPTY_REMOTE_SELECTION_COLORS: readonly string[] = [];
/**
 * How many of a collapsed row's children the datablock summary looks at. An
 * object carries a handful of datablocks and a scene group carries thousands
 * of children; this is what keeps the second case from costing thousands of
 * adapter reads per painted row. No reference frame shows more than one
 * datablock on a row, so what a row with several draws is OUR reading — they
 * sit side by side at the same cell pitch, in child order, and a row that
 * somehow carries more than this many shows the first few.
 */
const DATABLOCK_SUMMARY_SCAN = 6;

// Scroll-window sizing:
// `treeRowHeight()` above is THIS panel's row height. Every rendered row
// (Row/MoreRow) is painted by `.vgai-tree-row`'s own `height:
// var(--vgai-tree-row-height)`, so the spacer-div trick only keeps the
// scrollbar honest as long as that resolved number is what the math uses —
// which is why it is measured rather than restated. OVERSCAN keeps a small buffer
// of already-rendered rows on each side of the visible band so a fast scroll/keyboard-nav
// doesn't flash empty space before the next paint catches up. DEFAULT_VIEWPORT_PX is used
// whenever the container hasn't reported a real (nonzero) `clientHeight` yet — jsdom never
// performs real layout, so unit tests never measure anything unless they explicitly mock it;
// this generous fallback also keeps every pre-existing small-tree render byte-identical
// without any test needing to.
const OVERSCAN = 8;
const DEFAULT_VIEWPORT_PX = 2400;

/**
 * The active document is already named by the viewport tab/panel. Adapters
 * still need their document node as the stable source/persistence boundary,
 * but repeating that boundary as the first hierarchy row makes the authored
 * tree read `Three.js > src/world.tsx > Stage` instead of `Three.js > Stage`.
 *
 * Keep the node addressable through `node()` (selection, inspection and
 * structure routing continue to use its real id/parentage) while promoting
 * its children in the display walk. A bare adapter's sole document root is
 * likewise promoted because the panel header already names it. In a
 * composite, `secondaryLabel` is the adapter-owned source path that
 * distinguishes this redundant boundary from meaningful document-like
 * surface rows such as a scene UI canvas.
 *
 * WHY THE PROMOTION IS MEMOIZED, and what the memo is allowed to hold.
 * Deciding a node's promoted child list READS EVERY CHILD of that node — one
 * `hierarchy.node()` per child, and on the canvas lane each of those is a
 * projection lookup plus a native-node read. The row walk asks this provider
 * for every row it emits AND for every child it descends into, so an
 * unmemoized provider makes one walk cost `O(rows × fan-out)` rather than
 * `O(rows)`. Measured on the scale harness's canvas N=20000 world: the row
 * walk that a click re-runs emitted 1124 rows and its top self frames were
 * `promoteSourceDocumentChildren`/`projectNode` and the `toNode` reads under
 * them.
 *
 * The memo holds the PROMOTION ONLY — the child-id list, keyed by node id —
 * never the node record. Node DATA (label, role, parentage) is re-read from
 * the underlying provider on every call, so a live label or visibility change
 * is never served stale from here. What is frozen is whether each child is a
 * source-document boundary, which is a STRUCTURAL fact: it can only change
 * through a structural edit, and a structural edit advances
 * `contentVersion`, which rebuilds this provider along with the structural
 * snapshot it was built for (see the row pipeline's two memoized halves).
 */
function authoredContentHierarchy(hierarchy: HierarchyProvider): HierarchyProvider {
  /** node id → promoted child ids, or `null` for "unchanged, use the node's own". */
  const promoted = new Map<string, string[] | null>();

  const computePromotion = (node: EditorNode): string[] | null => {
    const childIds = node.childIds.flatMap((childId) => {
      const child = hierarchy.node(childId);
      return child?.role === 'document' && child.secondaryLabel ? child.childIds : [childId];
    });
    return childIds.length === node.childIds.length &&
      childIds.every((childId, index) => childId === node.childIds[index])
      ? null
      : childIds;
  };

  const projectNode = (node: EditorNode): EditorNode => {
    let childIds = promoted.get(node.id);
    if (childIds === undefined) {
      childIds = computePromotion(node);
      promoted.set(node.id, childIds);
    }
    return childIds === null ? node : { ...node, childIds };
  };

  return {
    ...hierarchy,
    roots: () => {
      const roots = hierarchy.roots();
      if (roots.length === 1 && roots[0]?.role === 'document') {
        return roots[0].childIds
          .map((childId) => hierarchy.node(childId))
          .filter((node): node is EditorNode => node !== null)
          .map(projectNode);
      }
      return roots.map(projectNode);
    },
    node: (id) => {
      const node = hierarchy.node(id);
      return node ? projectNode(node) : null;
    },
  };
}
// Only scroll-window ABOVE this row count. Small/medium trees (every real
// multi-world browse tree — world-group rows + CHILD_CAP-bounded children)
// render in full, immune to a transient/small `clientHeight` measurement
// windowing out later world-group rows (which broke 19-multi-world/22-tri-world
// when virtualization first landed). Windowing only kicks in for pathologically
// large lists (e.g. an ingested game's uncapped SEARCH result — react-rpg's
// dungeon is ~1900 rows), which is exactly the case this targets.
const VIRTUALIZE_MIN_ROWS = 300;

/** Shared empty reveal map — a fresh `Map` per render would defeat nothing,
 *  but there is no reason to allocate one for the uncapped path. */
const EMPTY_REVEAL_COUNTS: ReadonlyMap<string, number> = new Map();

const ROLE_ICON: Partial<Record<EditorNodeRole, IconDefinition>> = {
  folder: faFolder,
  document: faFileCode,
  story: faCirclePlay,
  component: faPuzzlePiece,
  instance: faObjectGroup,
  boundary: faTriangleExclamation,
};

function iconForNode(node: EditorNode): IconDefinition {
  if (node.role === 'root') return hierarchyKindIcon(node.kind, faLayerGroup);
  if (node.role === 'entity' || node.role === 'element') return hierarchyKindIcon(node.kind);
  return (node.role ? ROLE_ICON[node.role] : undefined) ?? hierarchyKindIcon(node.kind);
}

const STRUCTURAL_ROLES = new Set<EditorNodeRole>([
  'folder',
  'root',
  'document',
  'story',
  'boundary',
]);

type DropZone = 'before' | 'child' | 'after';
interface DropTarget {
  nodeId: string;
  zone: DropZone;
}

/** Walk UP from `targetId` via `parentId` — true if any ancestor (or itself)
 *  is in `dragIds` (prevents dropping a subtree into its own descendant). */
function isDescendantOfAny(
  targetId: string,
  dragIds: string[],
  adapter: AuthoringAdapter,
): boolean {
  let current: string | null = targetId;
  let guard = 0;
  while (current && guard++ < 1000) {
    if (dragIds.includes(current)) return true;
    current = adapter.hierarchy.node(current)?.parentId ?? null;
  }
  return false;
}

/** The ids of `parentId`'s children, in order — `null` parentId means "the
 *  adapter's own roots" (NOT necessarily the document root of a composite —
 *  callers pass the group-node id for "this world's roots"). */
function siblingIdsOf(adapter: AuthoringAdapter, parentId: string | null): string[] {
  if (parentId === null) return adapter.hierarchy.roots().map((n) => n.id);
  return adapter.hierarchy.node(parentId)?.childIds ?? [];
}

/**
 * `CompositeAuthoringAdapter`'s zOrder badge for a `world:<id>` group row —
 * `null` when the active adapter isn't a composite (bare shape) or the id
 * isn't one of its synthetic group nodes.
 *
 * IMPORTANT: "is a group node" is answered by ASKING THE COMPOSITE, never by
 * any per-node marker. Only the composite manufactures the synthetic
 * `world:<id>` group rows this panel treats specially (session-local eye per
 * D9, kind/zOrder badge, non-draggable); an ingested game's own rows are
 * ordinary rows whose eye/lock/rename route through the contract like any
 * other. Keying this off a per-node flag is the hazard: adapters set node
 * flags to mean "not an authored first-party entity", so every ingest/react
 * row reads as a world wrapper and the ingest eye toggle regresses to a
 * session-local shell hide instead of the adapter's
 * `inspector.set(id,'visible',…)`.
 */
function compositeGroupBadge(
  adapter: AuthoringAdapter,
  nodeId: string,
): {
  zOrder: number;
  worldId: string;
  role: 'world' | 'surface';
  kind: string;
  provenance: AuthoringProvenance | null;
} | null {
  if (!(adapter instanceof CompositeAuthoringAdapter)) return null;
  for (const child of adapter.childAdapters()) {
    if (adapter.groupNodeId(child.worldId) === nodeId) {
      // A4 (D8) — prefer the LIVE manifest zOrder (editable on the root row,
      // `composite.inspector.get(groupId, 'zOrder')`) over the array-index
      // fallback `child.zOrder`, so editing zOrder through the generic
      // inspector is reflected on this badge immediately (the write path
      // calls `store.notifyIngestEdit()`, which re-renders this panel).
      // Falls back to the array index when there's no manifest surface
      // (play-mode composites, or any adapter that doesn't report a
      // `zOrder` inspector property for its own group-node id) — unchanged
      // from before A4.
      const manifestZOrder = adapter.inspector?.get(nodeId, 'zOrder');
      return {
        zOrder: typeof manifestZOrder === 'number' ? manifestZOrder : child.zOrder,
        // B1 — the RAW manifest world id (`CompositeChild.worldId`), so
        // callers can key session-local world state (`world-session-state.ts`
        // — eye/interactive/pick-lock) consistently with `design-time-layers.ts`,
        // which reads the SAME id off `composite.childAdapters()` directly.
        worldId: child.worldId,
        role: child.role,
        kind: child.kind,
        // Spec 29 §5 — the world's own seam-level provenance declaration
        // (null when the child adapter declared none; the row shows no chip).
        provenance: child.adapter.provenance ?? null,
      };
    }
  }
  return null;
}

/** True only for a composite's synthetic `world:<id>` group row (see
 *  {@link compositeGroupBadge}) — never for an ordinary (even runtime-only)
 *  ingest/react/canvas node. */
function isCompositeGroupNode(adapter: AuthoringAdapter, nodeId: string): boolean {
  return compositeGroupBadge(adapter, nodeId) !== null;
}

/** Editor-only kind/semantic projection rows have no native entity owner. */
function isCompositeOrganizationNode(adapter: AuthoringAdapter, nodeId: string): boolean {
  return adapter instanceof CompositeAuthoringAdapter && adapter.isOrganizationNode(nodeId);
}

/**
 * The composite child adapter that OWNS `nodeId` — the adapter whose
 * PROVIDERS answer for it — or the active adapter itself when bare. Affordance
 * GATES must ask the owner (the composite's own `structure`/`inspector` are
 * never-undefined routers, so probing them says "yes" for a row whose owning
 * child would refuse — the false-claim pattern spec 29 §3 forbids); ACTIONS
 * still go through the ACTIVE adapter, which routes by ownership.
 */
function ownerAdapterOf(adapter: AuthoringAdapter, nodeId: string): AuthoringAdapter {
  if (!(adapter instanceof CompositeAuthoringAdapter)) return adapter;
  const worldId = adapter.ownerOf(nodeId);
  return adapter.childAdapters().find((c) => c.worldId === worldId)?.adapter ?? adapter;
}

/**
 * Whether the adapter that OWNS this row can reparent at all.
 *
 * Asked of the owner, not the composite: the composite's `structure` is a
 * never-undefined router, so probing it says "yes" for a row whose owning child
 * has no structure provider — the false-claim pattern spec 29 §3 forbids, and
 * exactly the shape of the dead drag this cycle fixes (a three world
 * deliberately ships NO `structure`: "a running world's structure belongs to
 * its source, not to a document this adapter could write").
 */
function hasStructureWritePathFor(adapter: AuthoringAdapter, nodeId: string | undefined): boolean {
  if (nodeId === undefined) return adapter.structure !== undefined;
  return ownerAdapterOf(adapter, nodeId).structure !== undefined;
}

function isStructuralHierarchyNode(
  adapter: AuthoringAdapter,
  nodeId: string,
  role: EditorNodeRole | undefined,
): boolean {
  return (
    isCompositeGroupNode(adapter, nodeId) ||
    isCompositeOrganizationNode(adapter, nodeId) ||
    (role !== undefined && STRUCTURAL_ROLES.has(role))
  );
}

/**
 * First-open policy: organizational rows stay open, as does the first real
 * authored node below them. Single-child wrapper chains continue open until
 * the first meaningful branch; branches beneath that point start folded.
 * This is shape-based — never label- or kind-based — so the same rule covers
 * Three.js, React, PixiJS, and arbitrary projections.
 *
 * THE ONE KIND-BASED CLAUSE, and why it is not an exception to that sentence.
 * A row whose children are ALL DATABLOCKS starts CLOSED. A datablock is not a
 * branch of the tree — it is the thing the row already IS, hung off it the way
 * Blender's Outliner hangs a mesh off its object — so opening it by default
 * shows one row twice. Measured on `outliner.png`: at rest every object row in
 * the frame is collapsed behind a `>` and carries its datablock as an inline
 * glyph after the label (`Row`'s summary below is the other half of this). The
 * shape rule alone cannot see it: our object row is at authored depth 1 with a
 * single child, so it matched TWO of the clauses above and opened.
 *
 * Nothing else in the estate can reach this clause: `isDatablockKind` names
 * exactly the kinds `hierarchy-kind-icon.ts` gives the DATA glyph, and no
 * first-party three/React/Pixi/ingest adapter sends one — only `@volter/editor-blender`'s
 * hierarchy decorator does.
 */
function defaultExpansionByNode(
  rows: readonly HierarchyNodeRow[],
  adapter: AuthoringAdapter,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const authoredDepthAtTreeDepth: number[] = [];
  const nodeAtTreeDepth: HierarchyNodeRow['node'][] = [];
  const kindById = new Map<string, string>();
  for (const row of rows) if (!row.more) kindById.set(row.node.id, row.node.kind);
  for (const row of rows) {
    if (row.more) continue;
    const parentAuthoredDepth =
      row.depth === 0 ? 0 : (authoredDepthAtTreeDepth[row.depth - 1] ?? 0);
    const parentNode = row.depth === 0 ? null : nodeAtTreeDepth[row.depth - 1];
    const structural = isStructuralHierarchyNode(adapter, row.node.id, row.node.role);
    const authoredDepth = parentAuthoredDepth + (structural ? 0 : 1);
    authoredDepthAtTreeDepth[row.depth] = authoredDepth;
    authoredDepthAtTreeDepth.length = row.depth + 1;
    nodeAtTreeDepth[row.depth] = row.node;
    nodeAtTreeDepth.length = row.depth + 1;
    const onlyDatablockChildren =
      row.node.childIds.length > 0 &&
      row.node.childIds.every((id) => isDatablockKind(kindById.get(id)));
    result.set(
      row.node.id,
      // AN ADAPTER THAT KNOWS ITS OWN DEFAULT WINS. `EditorNode.defaultExpanded`
      // is stated only where the tree carries a real per-element flag rather
      // than a shape a heuristic could read — Blender's Outliner is the case
      // it was added for (see the field's own docblock). Everything else falls
      // through to the shape rule below exactly as before.
      row.node.defaultExpanded ??
        (!onlyDatablockChildren &&
          (structural || authoredDepth <= 1 || parentNode?.childIds.length === 1)),
    );
  }
  return result;
}

/**
 * H6 — THE ONE PLACE search exclusion is enforced. A revealed internal is in
 * `rows` like any other row (that is the point of injecting internals into the
 * hierarchy provider rather than forking the flattener), so it would otherwise
 * be searchable: one `mixamorig` query across four revealed enemies would bury
 * every real row under 240 bones. `rowAffordances(...).searchable` is the
 * predicate, the same one that refuses the row's writes.
 *
 * Ancestors still get revealed for the matches that DO count, and no non-internal
 * row can hide underneath an internal one: a nested instance is always surfaced
 * as a projected child of its owner FIRST (projected children are listed before
 * appended internals, and the flattener keeps the first occurrence), so a
 * revealed subtree is made only of internal rows.
 */
function searchPathKeys(
  rows: readonly HierarchyNodeRow[],
  term: string,
  isInternal: (id: string) => boolean,
): Set<string> {
  const visible = new Set<string>();
  for (const row of rows) {
    if (
      row.more ||
      !rowAffordances({ structural: false, internal: isInternal(row.node.id) }).searchable
    )
      continue;
    if (!row.node.label.toLowerCase().includes(term)) continue;
    visible.add(row.pathKey);
    for (const ancestor of ancestorPathKeys(row.pathKey)) visible.add(ancestor);
  }
  return visible;
}

/** Fold the selection-driven reveal counts (see `selectedRevealCounts`) into the
 *  author's own persisted "show more" counts, taking the larger of each. */
function mergeRevealCounts(
  persisted: ReadonlyMap<string, number>,
  temporary: ReadonlyMap<string, number>,
): Map<string, number> {
  const merged = new Map(persisted);
  for (const [pathKey, count] of temporary) {
    merged.set(pathKey, Math.max(merged.get(pathKey) ?? 0, count));
  }
  return merged;
}

/**
 * The Outliner's search — a PERSISTENT field, on a header row it has to SHARE.
 *
 * WHAT THIS CONTROL IS: a live incremental filter over the tree. The term is
 * this panel's own state (`GameHierarchy`'s `search`) and filters on every
 * keystroke through `searchPathKeys`; nothing about that changed when the
 * field stopped hiding. ESCAPE clears the term; a second Escape on an empty
 * field blurs, handing focus back to the tree. There is no "close" any more,
 * which is the point: a collapsed field cannot be photographed, so it cannot
 * be proved through any door the product has (no sanctioned door clicks
 * editor chrome — `command-listener.ts`'s `collapse-hierarchy-all` note),
 * and a control that cannot be seen is a control that cannot be judged
 * against the frame.
 *
 * MEASURED, native 2x `outliner.png`, CSS = half. Blender's header, x from the
 * area's left edge: editor-type well 8.5..40.5 (32x20), display-mode well
 * 45.5..77.5 (32x20), SEARCH FIELD 93.5..208.5 (115x20), then 43 px of flexible
 * gap, filter chevron well 251.5..271.5 (20x20), New Collection button
 * 276.5..296.5 (20x20), 8 px right pad. Every widget is 20 px tall, top at 2.5.
 * The ORDER is the finding: the field sits with the LEFT cluster, right after
 * the two selectors, and only the chevron and the button are pinned right.
 *
 * THE FIELD'S PAINT, re-verified against the frame this unit: 115x20 border
 * box; fill 28/28/28 = `#1c1c1c` = the palette's `widget.field` = our
 * `--vgai-bg-inset`; one-pixel 60/60/60 = `#3c3c3c` = `boundary.default` =
 * `--vgai-border-1`; corner arc ~3 CSS px; magnifier 14x14 of 229/229/229 ink,
 * its left edge 5.0 CSS px inside the border box; placeholder "Search" (no
 * ellipsis — read off the frame) at 94/94/94 = `#5e5e5e`, its left edge 26.5
 * CSS px inside the border box. `.vgai-input` already paints all of that from
 * the palette, so this control adds GEOMETRY only: the leading glyph and the
 * inset that clears it.
 *
 * ITS WIDTH IS STRIP-AWARE: Blender's 115 where the dock hides the tab strip,
 * 64 where it does not. A field that fits its header is not an inconsistency —
 * Blender's own is 115 because Blender's header spends 32 px on an editor-type
 * WELL where ours spends 203 on a tab STRIP, so the two numbers are the same
 * answer to two different headers. The 64 below is the constant's home and the
 * fallback; the raise is the HOST's, made where the header band is rendered —
 * under the frame that is `frame/bridge.tsx`'s header slot, whose pane has no
 * strip beside the row, so it gives the field the whole band — and it arrives
 * here through {@link SEARCH_FIELD_BASIS_VAR}.
 *
 * WHY 64 IS THE BEHIND-A-STRIP NUMBER, and the arithmetic. MEASURED
 * live on the 308 px Model-workspace Outliner under this look: 5 px of area
 * groove at x 1420..1424, then a tab strip that needs 203 px (three labels of
 * 41/54/36 px of ink inside `--vgai-space-5` padding), then the strip's drag
 * void, then the actions. The four verbs this replaced occupied exactly 90 px
 * of that row (x 1638..1728: four 20 px buttons, three 2 px gaps, 4 px of
 * right padding) with 10 px of void beside them — so 90 is the footprint that
 * is KNOWN to leave the strip whole, and the field takes what is left of it
 * after the chevron's 20, its 2 px gap and the row's 4 px right padding: 64.
 *
 * 74 WAS TRIED AND MEASURED WRONG. It fits arithmetically (the row would be
 * 100 px against 303 of header) but it leaves the tab container at exactly its
 * own content width, and the strip declares overflow at that boundary: it
 * shifted 8 px right, "Library" collapsed to "l" and its own `⌄ 1`
 * overflow dropdown appeared. The 10 px of void is the headroom that keeps
 * that from happening — and it is also the group's drag handle, so spending
 * it costs twice.
 *
 * Our editor-type selector spends 203 px where Blender's spends 32, which is
 * the whole of the remaining distance. The one lever that would buy more is
 * `.dv-tab`'s `--vgai-space-5` padding: at Blender's own ~5.5 px a side it
 * would return ~24 px and put the field at 88. Declined — the rule would
 * either repaint every dock tab in the editor, or (scoped to the Outliner's
 * region) leave two tab strips in one window at two different paddings, for a
 * field still 27 px short of Blender's.
 *
 * AND IT DOES NOT FLEX UP. Tried first and MEASURED as wrong: `flex: 1 1 auto`
 * capped at 115 inside the actions container (`display:flex` with
 * `min-width: auto`) did not shrink to fit — the row overflowed the group's
 * right edge, the chevron went off screen entirely and the tab strip
 * collapsed to "L" behind its own overflow dropdown. So
 * the field carries its OWN basis and only shrinks, down to
 * {@link SEARCH_FIELD_MIN}, for a genuinely narrower column. That is still
 * true — the strip-hidden case raises the BASIS, it does not make the field
 * flexible.
 */
function HierarchySearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        // Its own basis, shrinkable but never growing: the actions container
        // is content-sized, so a growing field overflows the group instead of
        // taking width from the tab strip (measured). The basis is a
        // variable so the HOST — the only thing that knows whether a tab strip
        // is beside this row — can raise it to Blender's 115; the constant
        // below is its home and the value every other header gets.
        flex: `0 1 var(${SEARCH_FIELD_BASIS_VAR}, ${SEARCH_FIELD_WIDTH}px)`,
        minWidth: SEARCH_FIELD_MIN,
      }}
    >
      {/* The leading magnifier, 5 px inside the border box per the frame. It is
          decoration over the field, not a button: clicking it must land in the
          input, so it takes no pointer events. */}
      <EditorIcon
        icon={faMagnifyingGlass}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: SEARCH_GLYPH_INSET,
          pointerEvents: 'none',
          color: 'var(--vgai-text-1)',
          // MEASURED, not chosen: at the chrome's `sm` rung (14 under Blender)
          // this glyph inked 12x12 against the frame's 14x14, because these
          // faces ink at ~0.85 of their box. `lg` is the rung that lands on 14.
          fontSize: 'var(--vgai-icon-lg)',
        }}
      />
      {/* L-6 — `.vgai-input` supplies a real `:focus-visible` border/outline
          (this box previously did `outline:'none'` with no replacement). */}
      <TextInput
        ref={inputRef}
        type="text"
        data-testid="ingest-search"
        placeholder="Search"
        className="vgai-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // A persistent field has nothing to close, so Escape means CLEAR —
          // and on an already-empty field it means "give me the tree back",
          // which is a blur. Stopped here either way so the editor's own
          // Escape (deselect) does not also fire from inside the field.
          e.stopPropagation();
          if (value !== '') onChange('');
          else inputRef.current?.blur();
        }}
        style={{
          flex: 1,
          minWidth: 0,
          paddingLeft: `var(${SEARCH_TEXT_INSET_VAR}, ${SEARCH_TEXT_INSET}px)`,
          paddingRight: SEARCH_FIELD_END_GUTTER,
        }}
      />
    </div>
  );
}

/** The 90 px footprint the four view buttons used to occupy, less the
 *  chevron's 20, its 2 px gap and the row's 4 px right padding. Blender's own
 *  field is 115 (`outliner.png`, x 93.5..208.5 at matched scale) in a header
 *  whose editor-type selector spends 32 px where our tab strip spends 203.
 *  This is the value behind a STRIP; the host raises it through
 *  {@link SEARCH_FIELD_BASIS_VAR} where there is none. */
const SEARCH_FIELD_WIDTH = 64;

/**
 * The dock's handle on the two numbers above and below — the field's basis and
 * its text inset — because whether a tab strip sits beside this row is a fact
 * only the host has (under the frame, the header slot `frame/bridge.tsx`
 * renders). Declared here, where the constants live, so the fallback and the
 * raise are read together; nothing but that slot sets either.
 */
const SEARCH_FIELD_BASIS_VAR = '--vgai-hierarchy-search-basis';

/** Below this a field stops reading as a field — there is no room for the
 *  glyph plus a syllable of the term. Our 308 px Outliner lands just above it. */
const SEARCH_FIELD_MIN = 56;

/** The glyph BOX's left offset, tuned so its INK lands where Blender's does —
 *  5.0 CSS px inside the border box (`outliner.png`, bright ink at x 98.5 of a
 *  field whose border box starts at 93.5). The box is wider than the ink, so
 *  this is 2, not 5. */
const SEARCH_GLYPH_INSET = 2;

/** Where the text starts, same origin — the value for a field behind a TAB
 *  STRIP, where 64 px is all there is. Blender's own is 26.5, and at 64 px
 *  that leaves 35 px for a word that sets 37 at the 11 px UI face, so "Search"
 *  rendered as "Searc". What is preserved there is the glyph and the text
 *  INSET ORDER; what is spent is the gap between them (3.5 px here against
 *  Blender's 7.5). Where the strip is hidden the field IS Blender's 115 and
 *  nothing is short, so the host may return the inset to the one that
 *  lands our first INK on Blender's 26.5, through {@link SEARCH_TEXT_INSET_VAR}
 *  — that number lives THERE, in the declaration that also raises the width,
 *  because the two are one decision and a copy here would drift. */
const SEARCH_TEXT_INSET = 21;

/** The dock's handle on the inset — same ownership story as
 *  {@link SEARCH_FIELD_BASIS_VAR}, and set in the same declaration. */
const SEARCH_TEXT_INSET_VAR = '--vgai-hierarchy-search-text-inset';

/** The field's own right gutter. `.vgai-input`'s shared 6 px is a third of the
 *  word's room in a field this narrow. */
const SEARCH_FIELD_END_GUTTER = 2;

/**
 * The three view verbs, folded into ONE chevron — Blender's own arrangement.
 *
 * Blender's Outliner header spends this slot on a filter chevron and keeps
 * Collapse/Reset/Expand behind its View menu. Ours now does the same: nothing
 * is removed, the three verbs are one click away, and the 66 px four buttons
 * were spending goes to the search field that had no room before.
 *
 * THE WELL IS THE HEADER'S OWN, measured on the native 2x `outliner.png`: the
 * chevron sits in a 20x20 box at x 251.5..271.5 whose INTERIOR is 39/39/39 —
 * the header band's own fill, `widget.menu` — inside a one-pixel 60/60/60
 * `boundary.default`, with a ~3 px corner. That is a different widget class
 * from the button beside it (New Collection draws the lighter 83/83/83
 * `widget.regular`), and it needs no rule of its own: `theme.css` already
 * paints a `secondary` button that carries `aria-haspopup="menu"` as a menu
 * well, because a dropdown TRIGGER is what the class is for. The mark itself
 * is small — 6.5 x 4.0 CSS px of 216-ink — which is why the glyph takes the
 * icon scale's SMALLEST rung (`--vgai-icon-xs`, 12 under Blender) rather than
 * the 14 px rung the rest of the chrome's glyphs use.
 */
function HierarchyViewMenu({
  onCollapseAll,
  onResetExpansion,
  onExpandAll,
}: {
  onCollapseAll: () => void;
  onResetExpansion: () => void;
  onExpandAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={triggerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <IconButton
        title="View"
        aria-label="View"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="hierarchy-view-menu"
        onClick={() => setOpen((was) => !was)}
        variant="secondary"
        size="compact"
      >
        <EditorIcon
          icon={faChevronDown}
          aria-hidden="true"
          // Blender's own filter chevron is a SMALL mark — 6.5 x 4.0 CSS px of
          // ink in its 20 px well, measured on `outliner.png` — so this takes
          // the icon scale's smallest rung (12 under Blender) rather than the
          // 14 the rest of the chrome's glyphs use; at the type scale's `xs`
          // it inked 5 x 3.
          style={{ fontSize: 'var(--vgai-icon-xs)' }}
        />
      </IconButton>
      {open && (
        <Menu
          autoFocusFirst
          dismissBoundaryRef={triggerRef}
          onDismiss={() => setOpen(false)}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: space[2],
            minWidth: 170,
          }}
        >
          <MenuItem
            data-testid="hierarchy-collapse-all"
            onSelect={() => {
              onCollapseAll();
              setOpen(false);
            }}
          >
            Collapse All
          </MenuItem>
          <MenuItem
            data-testid="hierarchy-reset-expansion"
            onSelect={() => {
              onResetExpansion();
              setOpen(false);
            }}
          >
            Reset Openness
          </MenuItem>
          <MenuItem
            data-testid="hierarchy-expand-all"
            onSelect={() => {
              onExpandAll();
              setOpen(false);
            }}
          >
            Expand All
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}

/**
 * The Outliner's controls — the search field, the View menu, Create.
 *
 * They render into the dock group's header-actions slot when one is published
 * (`hierarchy-header-slot.ts`), which is what makes the tab strip the panel's
 * ONE header row. With no slot — the design-system stories, any bounded host
 * that renders this panel without a dock — they fall back to the panel's own
 * toolbar row, which is why this is a portal and not a second copy of the
 * controls living in the dock.
 *
 * THE INVENTORY IS BLENDER'S, as of 2026-09-18: a persistent search field, one
 * chevron well opening the View popover that holds Collapse All / Reset
 * Openness / Expand All, and Create. Four icon buttons in a row read louder
 * than Blender's one and spent 86 px of a 308 px header on verbs Blender keeps
 * in a menu; the fold returns 66 of those to the field, which is the only
 * thing that lets the field be on screen at all.
 *
 * WHAT DID NOT CHANGE, and must not be "fixed": Create keeps the lighter
 * 83/83/83 `widget.regular` fill inside its one-pixel 60/60/60 outline,
 * because that is exactly what Blender's own header BUTTON draws (New
 * Collection, `outliner.png` x 553..592, y 5..44: border 60, fill 83). The
 * chevron beside it is a different widget class and draws the darker
 * `widget.menu` well — see `HierarchyViewMenu`.
 *
 * WHERE THIS ROW LIVES, and who owns its INSETS. It is portalled into the dock
 * group's header, so the row's leading/trailing padding depends on something
 * only the dock knows — whether the tab strip is beside it. Under a look whose
 * `regions.tabs` is `hidden` (Blender) a lone panel loses the strip and this
 * row takes the whole band, in Blender's own two groups: the search field left
 * at 8 px, the chevron and Create pushed to the trailing edge. Behind a strip
 * it is content-sized with a 4 px trailing gutter. The band and its insets are
 * the host's: under the frame, the header slot `frame/bridge.tsx` renders;
 * nothing here sets a padding.
 *
 * (Until 2026-09-18 that same rule hid the whole header, band and controls
 * together, so the Blender Game workspace's Outliner had NO header at all.
 * Fixed in `syncCenterTabHeaderVisibility`, which now takes the strip and
 * leaves the band whenever the lone panel owns controls in it.)
 *
 * WHAT THIS COSTS IN PROOF: the popover's own opening is not drivable — no
 * sanctioned door clicks editor chrome — so Collapse All and Expand All are
 * verified through their existing commands (`collapse-hierarchy-all`,
 * `expand-hierarchy-all`, which call the panel's own actions and never the
 * buttons), and Reset Openness is verified by reading the same handler both
 * paths share. Reset had no command before this move and still has none; the
 * fold made it one click further away, not less proved.
 */
function HierarchyControls({
  slot,
  search,
  setSearch,
  adapter,
  createTargetId,
  onCollapseAll,
  onResetExpansion,
  onExpandAll,
}: {
  slot: HTMLElement | null;
  search: string;
  setSearch: (next: string) => void;
  adapter: AuthoringAdapter;
  createTargetId: string | null;
  onCollapseAll: () => void;
  onResetExpansion: () => void;
  onExpandAll: () => void;
}) {
  const controls = (
    <>
      <HierarchySearch value={search} onChange={setSearch} />
      <HierarchyViewMenu
        onCollapseAll={onCollapseAll}
        onResetExpansion={onResetExpansion}
        onExpandAll={onExpandAll}
      />
      <CreateMenu adapter={adapter} parentId={createTargetId} />
    </>
  );
  if (slot) {
    return createPortal(
      <div
        data-testid="hierarchy-header-controls"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spaceVar[1],
          height: '100%',
          minWidth: 0,
        }}
      >
        {controls}
      </div>,
      slot,
    );
  }
  return (
    <EditorToolbar label="Hierarchy controls" compact style={{ gap: spaceVar[2] }}>
      {controls}
    </EditorToolbar>
  );
}

// --- Context menu ---

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
}

function ContextMenu({
  state,
  adapter,
  store,
  isGroupNode,
  isInternal,
  onRename,
  onClose,
}: {
  state: ContextMenuState;
  adapter: AuthoringAdapter;
  store: ShellStore;
  isGroupNode: boolean;
  /** H6 — a revealed internal row: every WRITE item is withheld (not disabled),
   *  and the adapter's own refusal sentence is shown in their place. */
  isInternal: boolean;
  onRename: (id: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // KEEP THE WHOLE MENU ON SCREEN. It is `position: fixed` at the pointer, so
  // a right-click on a row near the bottom of the panel ran the menu off the
  // viewport and took its LAST items with it — Delete is last, and a tester
  // reported exactly that ("the delete gets hidden over here on the last
  // line", runhuman pass 105). The shared clamp already solves this; this
  // menu just did not use it.
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number }>({
    left: state.x,
    top: state.y,
  });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPosition(
      clampRectToViewport({
        top: state.y,
        left: state.x,
        width: rect.width,
        height: rect.height,
      }),
    );
  }, [state.x, state.y]);
  const [createOpen, setCreateOpen] = useState(false);
  // Same at-most-once-per-open guard as CreateMenu: `onClose()` on select is
  // async, so a double-dispatched click/Enter on a create item could otherwise
  // double-invoke `create` before the menu unmounts. Reset on each open.
  const createGuardRef = useRef(false);

  useEffect(() => {
    if (createOpen) createGuardRef.current = false;
  }, [createOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const node = adapter.hierarchy.node(state.nodeId);
  if (!node) return null;

  const creatableKinds = adapter.structure?.creatableKinds?.(state.nodeId) ?? [];
  // Gates ask the OWNING child (see ownerAdapterOf) — the composite's own
  // structure/inspector are never-undefined routers, so probing THEM would
  // advertise operations the owner refuses (live-caught on a Boundary row:
  // Duplicate/Hide/Delete rendered enabled and no-op'd). `visible` is a
  // VALUE probe like `name`/`locked`: every live adapter answers it, a
  // Boundary answers undefined.
  const owner = ownerAdapterOf(adapter, state.nodeId);
  const ownerStructure = owner.structure;
  const hasStructure = !!ownerStructure;
  const nameKnown = adapter.inspector?.get(state.nodeId, 'name') !== undefined;
  const lockedKnown = adapter.inspector?.get(state.nodeId, 'locked') !== undefined;
  const locked = adapter.inspector?.get(state.nodeId, 'locked') === true;
  const visibleKnown = adapter.inspector?.get(state.nodeId, 'visible') !== undefined;
  const visible = adapter.inspector?.get(state.nodeId, 'visible') !== false;
  const lockedEditability = adapter.inspector?.editability?.(state.nodeId, 'locked');
  const visibleEditability = adapter.inspector?.editability?.(state.nodeId, 'visible');
  const lockedWritable = lockedKnown && (lockedEditability?.writable ?? true);
  const visibleWritable = visibleKnown && (visibleEditability?.writable ?? true);
  // The FOCUSED stage's selection (ARCHITECTURE-CORE §One stage unit 4): a
  // context menu opened over a model document's row must copy that stage's
  // selection, not the world's.
  const selectedIds = [...focusedStageStore(store).selectedEntityIds];
  const clipboardIds = selectedIds.includes(state.nodeId) ? selectedIds : [state.nodeId];

  // Spec 29 §5 disabled-with-reason: when the SUBJECT of an operation is
  // present (the row exists) but the adapter can't perform it, the item
  // renders DISABLED with the world's own provenance explanation as its
  // tooltip — the complement of spec 28's rule (chrome whose subject is
  // absent is hidden, not disabled).
  const reason = unavailableReason(provenanceForNode(adapter, state.nodeId));
  const copyDisabledReason = ownerStructure?.copy
    ? 'Copy needs source-addressable entities from one world.'
    : reason;
  const pasteDisabledReason = ownerStructure?.paste
    ? 'Copy or cut a source-addressable entity in this world first.'
    : reason;
  const items: {
    label: string;
    testId?: string;
    action: () => void;
    color?: string;
    disabledReason?: string;
  }[] = [];

  const affordances = rowAffordances({ structural: isGroupNode, internal: isInternal });
  // H6 — the only verb a revealed internal keeps is one that writes nothing:
  // walking UP to the thing that actually is authored. Everything else in the
  // block below is a write.
  if (isInternal && node.parentId !== null) {
    items.push({
      label: 'Select Parent',
      testId: 'hierarchy-context-menu-select-parent',
      action: () => {
        setAuthoringSelection(adapter, [node.parentId!]);
        onClose();
      },
    });
  }

  if (!isGroupNode && affordances.writable) {
    items.push({
      label: 'Rename',
      testId: 'hierarchy-context-menu-rename',
      ...(nameKnown ? {} : { disabledReason: reason }),
      action: () => {
        onRename(state.nodeId);
        onClose();
      },
    });
    items.push({
      label: 'Cut',
      testId: 'hierarchy-context-menu-cut',
      ...(ownerStructure?.cut && (adapter.structure?.canCopy?.(clipboardIds) ?? true)
        ? {}
        : { disabledReason: copyDisabledReason }),
      action: () => {
        void cutAuthoringNodes(adapter, clipboardIds);
        onClose();
      },
    });
    items.push({
      label: 'Copy',
      testId: 'hierarchy-context-menu-copy',
      ...(ownerStructure?.copy && (adapter.structure?.canCopy?.(clipboardIds) ?? true)
        ? {}
        : { disabledReason: copyDisabledReason }),
      action: () => {
        void copyAuthoringNodes(adapter, clipboardIds);
        onClose();
      },
    });
    items.push({
      label: 'Paste',
      testId: 'hierarchy-context-menu-paste',
      ...(ownerStructure?.paste && (adapter.structure?.canPaste?.(node.parentId) ?? true)
        ? {}
        : { disabledReason: pasteDisabledReason }),
      action: () => {
        void pasteAuthoringNodes(adapter, node.parentId);
        onClose();
      },
    });
    items.push({
      label: 'Duplicate',
      testId: 'hierarchy-context-menu-duplicate',
      ...(hasStructure ? {} : { disabledReason: reason }),
      action: () => {
        // ON THE WHOLE SELECTION when the clicked row is part of one — the
        // menu acts on what is selected, exactly as the hotkey does. Acting on
        // the clicked row alone silently dropped the other members (runhuman
        // pass 68: "select all this, click Delete — just one gets deleted").
        if (selectedIds.length > 1 && selectedIds.includes(state.nodeId)) {
          void duplicateSelection(store);
        } else {
          void duplicateAuthoringNode(adapter, state.nodeId).ack;
        }
        onClose();
      },
    });
    if (ownerStructure?.group && selectedIds.length > 1 && selectedIds.includes(state.nodeId)) {
      items.push({
        label: 'Group Selection',
        testId: 'hierarchy-context-menu-group',
        action: () => {
          void groupAuthoringNodes(adapter, selectedIds).ack;
          onClose();
        },
      });
    }
    if (ownerStructure?.ungroup && ownerStructure.canUngroup?.(state.nodeId)) {
      items.push({
        label: 'Ungroup',
        testId: 'hierarchy-context-menu-ungroup',
        action: () => {
          void ungroupAuthoringNode(adapter, state.nodeId).ack;
          onClose();
        },
      });
    }
    if (ownerStructure?.wrap) {
      items.push({
        label: 'Wrap',
        testId: 'hierarchy-context-menu-wrap',
        action: () => {
          void wrapAuthoringNode(adapter, state.nodeId);
          onClose();
        },
      });
    }
    if (ownerStructure?.unwrap) {
      items.push({
        label: 'Unwrap',
        testId: 'hierarchy-context-menu-unwrap',
        action: () => {
          void unwrapAuthoringNode(adapter, state.nodeId);
          onClose();
        },
      });
    }
    if (node.parentId !== null) {
      items.push({
        label: 'Select Parent',
        testId: 'hierarchy-context-menu-select-parent',
        action: () => {
          setAuthoringSelection(adapter, [node.parentId!]);
          onClose();
        },
      });
    }
    items.push({
      label: visibleKnown && !visible ? 'Show' : 'Hide',
      ...(visibleWritable ? {} : { disabledReason: visibleEditability?.reason ?? reason }),
      action: () => {
        adapter.inspector!.set(state.nodeId, 'visible', !visible);
        store.notifyIngestEdit();
        onClose();
      },
    });
    items.push({
      label: locked ? 'Unlock' : 'Lock',
      ...(lockedWritable ? {} : { disabledReason: lockedEditability?.reason ?? reason }),
      action: () => {
        adapter.inspector!.set(state.nodeId, 'locked', !locked);
        store.notifyIngestEdit();
        onClose();
      },
    });
    // First-party escape-hatch extras (formerly prefab unpack/open/save-as,
    // currently unregistered) — permanent adapter-module contribution seam
    // (see hierarchy-menu-registry.ts).
    for (const extra of getHierarchyMenuItems({ nodeId: state.nodeId, store: store })) {
      items.push({
        label: extra.label,
        ...(extra.color !== undefined ? { color: extra.color } : {}),
        action: () => {
          extra.action();
          onClose();
        },
      });
    }
    items.push({
      label: 'Delete',
      testId: 'hierarchy-context-menu-delete',
      color: themeVars.semantic.danger,
      ...(hasStructure ? {} : { disabledReason: reason }),
      action: () => {
        // Same selection rule as Duplicate above — and the selection path also
        // carries the ordering/serialization a multi-delete needs (see
        // `deleteSelection`'s source-corruption note).
        if (selectedIds.length > 1 && selectedIds.includes(state.nodeId)) {
          void deleteSelection(store);
        } else {
          adapter.structure!.remove(state.nodeId);
        }
        onClose();
      },
    });
  }

  return (
    // Portaled to the theme root (W6): `position: fixed` inside a
    // backdrop-filtered floating card would resolve against the card and be
    // clipped by its overflow — see `ThemeRootPortal`'s rationale.
    <ThemeRootPortal>
      <Menu
        ref={menuRef}
        data-testid="ingest-context-menu"
        style={{
          // U6a (P6 glass-native chrome): chrome paint (fill/border/radius/
          // shadow/frost/ink) comes from the shared `.vgai-menu` overlay
          // material — the same Regular-glass vocabulary every other menu
          // consumes — so only geometry stays inline.
          position: 'fixed',
          left: menuPosition.left,
          top: menuPosition.top,
          minWidth: 150,
          maxWidth: 260,
          fontSize: 'var(--vgai-font-base)',
        }}
      >
        {/* A4 (D8): also suppressed for a root-group MEMBER row, same as an
          existing composite group row — `isGroupNode` covers both (see the
          caller's computation below). The Create submenu on a member id would silently
          land at the scene root instead of doing anything meaningful. */}
        {!isGroupNode && affordances.writable && creatableKinds.length > 0 && (
          <div>
            <MenuItem
              data-testid="hierarchy-context-menu-create"
              onSelect={() => setCreateOpen((v) => !v)}
              style={{
                justifyContent: 'space-between',
                gap: space[4],
              }}
            >
              <span>Create</span>
              <DisclosureIcon direction="right" tone="dim" />
            </MenuItem>
            {createOpen &&
              creatableKinds.map((k) => (
                <MenuItem
                  key={k.kind}
                  data-testid={`hierarchy-context-menu-create-${k.kind}`}
                  onSelect={() => {
                    if (createGuardRef.current) return;
                    createGuardRef.current = true;
                    void createAuthoringNode(adapter, k.kind, state.nodeId).ack;
                    onClose();
                  }}
                  style={{
                    paddingLeft: spaceVar[12],
                  }}
                >
                  {k.label}
                </MenuItem>
              ))}
          </div>
        )}
        {items.map((item) =>
          item.disabledReason !== undefined ? (
            // Same shape as before the Menu-primitive rebuild (U6a): an
            // aria-disabled row (NOT a :disabled button — the reason tooltip
            // must keep showing, spec 29 §5) whose click is a no-op.
            <MenuItem
              key={item.label}
              data-testid={item.testId}
              aria-disabled="true"
              title={item.disabledReason}
              style={{
                // L-21 — disabled rows get a dedicated muted color (not just
                // opacity-faded active text) plus a not-allowed cursor.
                cursor: 'not-allowed',
                color: themeVars.content.dim,
                opacity: 0.7,
              }}
            >
              {item.label}
            </MenuItem>
          ) : (
            <MenuItem
              key={item.label}
              data-testid={item.testId}
              onSelect={item.action}
              style={item.color !== undefined ? { color: item.color } : undefined}
            >
              {item.label}
            </MenuItem>
          ),
        )}
        {/* H6 — refusal is VISIBLE and NAMED (doctrine rule 2). The sentence is
          the ADAPTER's own `editability` reason, the identical string the row's
          lock glyph, the inspector field and the gizmo-denial hint show; this
          menu never writes one of its own. */}
        {isInternal && (
          <div
            data-testid="hierarchy-context-menu-internal-note"
            style={{
              padding: `${space[4]}px ${space[6]}px`,
              color: themeVars.content.dim,
              maxWidth: 240,
              lineHeight: lineHeightVar.normal,
            }}
          >
            {adapter.transforms?.editability?.(state.nodeId, 'position')?.reason ??
              'This rendered part has no authored source identity.'}
          </div>
        )}
        {/* Bounded-authoring honest degrade (landmine f): the ACTIVE adapter has
          no `structure` provider at all (an ingested/foreign game owns its
          own scene graph) — Rename/Show-Hide/Lock above still work (they're
          gated independently, on `inspector`), but Create/Duplicate/Delete/
          Reparent are not, so say so plainly instead of hiding the menu. */}
        {!hasStructure && !isInternal && (
          <div
            style={{
              padding: `${space[4]}px ${space[6]}px`,
              color: themeVars.semantic.warning,
              maxWidth: 240,
              lineHeight: lineHeightVar.normal,
            }}
          >
            <strong>Create / Delete / Reparent — not available.</strong> This game owns its own
            scene graph, so structural authoring isn't reapplicable. You can edit transform /
            material / visibility, or capture a subtree into the first-party editable format.
          </div>
        )}
      </Menu>
    </ThemeRootPortal>
  );
}

// --- Add / Create menu (shared by the toolbar "+" and reused create list) ---

function CreateMenu({ adapter, parentId }: { adapter: AuthoringAdapter; parentId: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // At-most-once-per-open guard. `setOpen(false)` on select is async — the menu
  // item stays mounted until the next render, so under CI input jank a single
  // menu-open can receive two `click` dispatches on the same item before it
  // unmounts, double-invoking `create` (the "expected 3, saw 8" overshoot in
  // 29-game-hierarchy). React state can't gate this because both clicks land in
  // the same commit; a ref reset on each open bounds it to one create per open.
  const creatingRef = useRef(false);
  const kinds = adapter.structure?.creatableKinds?.(parentId) ?? [];
  const targetLabel = parentId ? adapter.hierarchy.node(parentId)?.label : null;

  useEffect(() => {
    if (!open) return;
    creatingRef.current = false; // fresh open → allow exactly one create
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  if (kinds.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* L-11 — same fixed 20×20 boxed treatment as its `ViewButton` siblings
          in the toolbar row (collapse/expand/reset), instead of an unboxed
          inline span with mismatched padding. */}
      <Button
        title={targetLabel ? `Add to ${targetLabel}` : 'Add'}
        aria-label={targetLabel ? `Add to ${targetLabel}` : 'Add'}
        aria-expanded={open}
        data-testid="hierarchy-add-menu"
        onClick={() => setOpen(!open)}
        variant={open ? 'primary' : 'secondary'}
        size="compact"
      >
        <EditorIcon icon={faPlus} style={{ fontSize: 'var(--vgai-font-sm)' }} />{' '}
        <EditorIcon icon={faCaretDown} style={{ fontSize: 'var(--vgai-font-xs)' }} />
      </Button>
      {open && (
        <Menu
          style={{
            // U6a: same Menu-primitive rebuild as the ingest context menu
            // above — chrome paint arrives through `.vgai-menu`'s shared
            // overlay material; geometry stays inline.
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: space[2],
            minWidth: 130,
            maxHeight: 'min(480px, 70vh)',
            overflowY: 'auto',
          }}
        >
          {kinds.map((k) => (
            <MenuItem
              key={k.kind}
              data-testid={`hierarchy-add-${k.kind}`}
              onSelect={() => {
                if (creatingRef.current) return; // ignore a double-dispatched click
                creatingRef.current = true;
                void createAuthoringNode(adapter, k.kind, parentId ?? undefined).ack;
                setOpen(false);
              }}
            >
              {k.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </div>
  );
}

// --- Row ---

function MoreRow({
  row,
  onReveal,
}: {
  row: HierarchyNodeRow;
  onReveal: (parentPathKey: string) => void;
}) {
  const hidden = row.more!.hidden;
  return (
    <Button
      type="button"
      variant="ghost"
      className="vgai-hierarchy-more"
      data-testid="ingest-row-more"
      onClick={() => onReveal(row.more!.parentPathKey)}
      style={{
        paddingLeft: indentPx(row.depth + 1),
      }}
    >
      … {hidden} more
    </Button>
  );
}

/**
 * D4 (spec27 §6 D4, layer-tree "search filters + HIGHLIGHTS") — split
 * `label` into `<mark>`-wrapped/plain segments around every case-insensitive
 * occurrence of `term`, or the plain label unchanged when `term` is empty
 * (the pre-D4 render, byte-identical). Pure text math — no adapter/DOM
 * access — factored out purely so `Row` itself stays simple.
 */
function highlightSegments(label: string, term: string): React.ReactNode {
  if (!term) return label;
  const lower = label.toLowerCase();
  const needle = term.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(needle, cursor);
  if (idx < 0) return label;
  let key = 0;
  while (idx >= 0) {
    if (idx > cursor) parts.push(label.slice(cursor, idx));
    parts.push(
      <mark
        key={key++}
        data-testid="ingest-row-search-highlight"
        style={{
          background: themeVars.semantic.warning,
          color: themeVars.surface.shell,
          borderRadius: themeVars.shape.small,
        }}
      >
        {label.slice(idx, idx + needle.length)}
      </mark>,
    );
    cursor = idx + needle.length;
    idx = lower.indexOf(needle, cursor);
  }
  if (cursor < label.length) parts.push(label.slice(cursor));
  return parts;
}

interface RowProps {
  row: HierarchyNodeRow;
  adapter: AuthoringAdapter;
  store: ShellStore;
  isSelected: boolean;
  /** Is this the selection's ACTIVE row — Blender's active object, and here
   *  `EditorShellStore.selectedEntityId`: the last id the selection took, which
   *  is already the gizmo's binding and the inspector's subject. Never true
   *  without {@link isSelected}. Within a single selection it is simply the one
   *  row; within a multi-selection it is the only thing on screen that says
   *  which row those two panels are answering about. */
  isSelectionActive: boolean;
  isEditing: boolean;
  isCollapsed: boolean;
  dropZone: DropZone | null;
  isDragged: boolean;
  /** The row's ABSOLUTE index in the flattened tree — the alternating stripe's
   *  phase. Not its DOM position: this list is virtualized behind a spacer
   *  div, so `nth-child` counts the wrong thing (see the call site). */
  rowIndex: number;
  /** The depths of the rows immediately above and below this one in the
   *  FLATTENED list, `-1` where there is none — the only two facts the indent
   *  guides need beyond the row's own depth ({@link indentGuidesFor}). Passed
   *  rather than derived here because a virtualized row cannot see its
   *  neighbours; the caller holds the whole list. */
  prevDepth: number;
  nextDepth: number;
  /** H6 — this row exists only because its owner's internals were revealed:
   *  a rendered part with no authored source identity. Read-only, dim, and
   *  invisible to search; see `rowAffordances`. */
  isInternal: boolean;
  /** The manifest's sole live Three viewport world, recomputed by the panel
   *  per notify (`resolveThreeViewportRootId`); its group row renders a
   *  live-content marker. */
  threeRootId: string | null;
  /** D4 — the trimmed, lowercased-by-the-caller search term (empty string
   *  when the search box is empty), for {@link highlightSegments}. */
  searchTerm: string;
  /** H2 — the panel-owned memo of "are all three transform channels refused".
   *  `editability` is NOT free per render (the R3F adapter re-parses JSX
   *  attributes), so no row is allowed to call it directly. */
  lockCache: TransformLockCache;
  /** H5 — the panel-owned memo of "does this row carry authorability
   *  warnings". Same key as {@link lockCache}; see `RowWarningCache`. */
  warningCache: RowWarningCache;
  /** H2 + H5 — the caches' shared invalidation key; see `TransformLockCache`. */
  editabilityVersion: number;
  /** The ACTIVE ADAPTER's own change epoch — see the `adapter.subscribe` effect.
   *  A row reads eye/lock/name/warning state straight off the adapter, so a
   *  change the adapter reports with no change to this row's NODE fields is
   *  invisible without it. */
  adapterVersion: number;
  onToggleOpen: (row: HierarchyNodeRow, recursive: boolean) => void;
  onStartEditing: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onClick: (e: React.MouseEvent, id: string) => void;
  onEnterScope: (id: string) => void;
  remoteSelectionColors: readonly string[];
  /** The `hierarchyTypeSuffix` chrome region, resolved ONCE by the panel
   *  (`workspace-regions.ts`): does a component-instance row print `·Type`
   *  after its name. A look that says `hidden` — Blender's, whose rows carry
   *  the name alone — drops the text only; see the label span for where the
   *  two facts it carried go instead. */
  typeSuffixShown: boolean;
  /** The `hierarchyInstanceRule` chrome region, resolved ONCE by the panel
   *  (`workspace-regions.ts`): does a component-instance row draw the dotted
   *  rule under its name. A look that says `hidden` — Blender's, whose Outliner
   *  marks an instance nowhere — drops the rule on every row, selected or not. */
  instanceRuleShown: boolean;
  /** The `hierarchyRestrictions` chrome region, resolved ONCE by the panel
   *  (`workspace-regions.ts`): which toggle columns the row's right edge
   *  carries. `viewport+render` drops the selection lock and reserves the
   *  outer column so the eye sits in Blender's own eye slot. */
  restrictionColumns: NonNullable<ChromeRegions['hierarchyRestrictions']>;
  /**
   * THE EXCLUDE CHECKBOX COLUMN, present when ANY row of this tree answers the
   * reserved `exclude` path — never a chrome knob (owner ruling, 2026-09-19:
   * restriction columns follow what the adapter ANSWERS; the render column
   * already worked this way). Blender draws it for `LayerCollection` rows and
   * it is the LEFTMOST of the restriction columns — `restrict_offsets` is built
   * right-to-left and `enable` is taken last (`outliner_draw.cc:1218-1245`),
   * with `SO_RESTRICT_ENABLE` in the default set (`space_outliner.cc:399`). A
   * row that answers nothing gets the reserved blank cell, so the eye and the
   * camera stay in one column down the whole tree.
   */
  excludeColumnShown: boolean;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameIngestRow(left: HierarchyNodeRow, right: HierarchyNodeRow): boolean {
  const leftNode = left.node;
  const rightNode = right.node;
  return (
    left.depth === right.depth &&
    left.pathKey === right.pathKey &&
    left.hasChildren === right.hasChildren &&
    left.hiddenByCollapse === right.hiddenByCollapse &&
    left.more?.parentPathKey === right.more?.parentPathKey &&
    left.more?.hidden === right.more?.hidden &&
    leftNode.id === rightNode.id &&
    leftNode.label === rightNode.label &&
    leftNode.role === rightNode.role &&
    leftNode.secondaryLabel === rightNode.secondaryLabel &&
    leftNode.kind === rightNode.kind &&
    leftNode.typeLabel === rightNode.typeLabel &&
    leftNode.parentId === rightNode.parentId &&
    sameStrings(leftNode.childIds, rightNode.childIds) &&
    leftNode.crossSurfaceId === rightNode.crossSurfaceId &&
    leftNode.crossSurfaceParentId === rightNode.crossSurfaceParentId &&
    leftNode.crossSurfaceOrder === rightNode.crossSurfaceOrder &&
    leftNode.crossSurfaceGroupLabel === rightNode.crossSurfaceGroupLabel
  );
}

function sameRowProps(left: RowProps, right: RowProps): boolean {
  return (
    sameIngestRow(left.row, right.row) &&
    left.adapter === right.adapter &&
    left.store === right.store &&
    left.isSelected === right.isSelected &&
    left.isSelectionActive === right.isSelectionActive &&
    left.isEditing === right.isEditing &&
    left.isCollapsed === right.isCollapsed &&
    left.dropZone === right.dropZone &&
    left.isDragged === right.isDragged &&
    left.rowIndex === right.rowIndex &&
    left.prevDepth === right.prevDepth &&
    left.nextDepth === right.nextDepth &&
    left.isInternal === right.isInternal &&
    left.searchTerm === right.searchTerm &&
    left.lockCache === right.lockCache &&
    left.warningCache === right.warningCache &&
    left.editabilityVersion === right.editabilityVersion &&
    left.adapterVersion === right.adapterVersion &&
    left.threeRootId === right.threeRootId &&
    left.onToggleOpen === right.onToggleOpen &&
    left.onStartEditing === right.onStartEditing &&
    left.onContextMenu === right.onContextMenu &&
    left.onDragStart === right.onDragStart &&
    left.onClick === right.onClick &&
    left.onEnterScope === right.onEnterScope &&
    left.typeSuffixShown === right.typeSuffixShown &&
    left.instanceRuleShown === right.instanceRuleShown &&
    left.restrictionColumns === right.restrictionColumns &&
    left.excludeColumnShown === right.excludeColumnShown &&
    sameStrings(left.remoteSelectionColors, right.remoteSelectionColors)
  );
}

const Row = memo(function Row({
  row,
  adapter,
  store,
  isSelected,
  isSelectionActive,
  isEditing,
  isCollapsed,
  dropZone,
  isDragged,
  rowIndex,
  prevDepth,
  nextDepth,
  isInternal,
  searchTerm,
  lockCache,
  warningCache,
  editabilityVersion,
  adapterVersion: _adapterVersion,
  onToggleOpen,
  onStartEditing,
  threeRootId,
  onContextMenu,
  onDragStart,
  onClick,
  onEnterScope,
  remoteSelectionColors,
  typeSuffixShown,
  instanceRuleShown,
  restrictionColumns,
  excludeColumnShown,
}: RowProps) {
  const { node, depth, hasChildren } = row;
  // A composite `world:<id>` group row (session-local eye per D9, zOrder badge,
  // non-draggable) — NOT merely a runtime-only node (see `isCompositeGroupNode`).
  const badge = compositeGroupBadge(adapter, node.id);
  const isGroupNode = badge !== null;
  const isOrganizationRow = isCompositeOrganizationNode(adapter, node.id);
  const isStructural =
    isGroupNode ||
    isOrganizationRow ||
    (node.role !== undefined && STRUCTURAL_ROLES.has(node.role));
  // H6 — the ONE gate every affordance below consults. A revealed internal is
  // non-writable BY CONSTRUCTION (no authored source identity to write to), so
  // it refuses drag, rename and every write control; selection stays open, and
  // the H2 lock glyph below carries the adapter's own reason for the refusal.
  const affordances = rowAffordances({ structural: isStructural, internal: isInternal });
  // Reserved-path reads, resolved ONCE per row and only for non-structural
  // rows: an adapter that doesn't support a reserved path returns
  // `undefined` (its affordance simply doesn't render). Cheap for every
  // stock adapter — the ingest/react adapters early-return `undefined` for a
  // non-style path before touching their tree; the first-party adapter
  // reads a plain descriptor.
  const lockedValue = isStructural ? undefined : adapter.inspector?.get(node.id, 'locked');
  const nameValue = isStructural ? undefined : adapter.inspector?.get(node.id, 'name');
  // VALUE probe like `locked`/`name` above (not provider presence — the
  // composite's inspector is a never-undefined router, which put a no-op eye
  // on Boundary rows): every live adapter answers `visible`; a Boundary
  // answers undefined and gets no eye.
  const visibleKnown = !isStructural && adapter.inspector?.get(node.id, 'visible') !== undefined;
  const lockedEditability = isStructural
    ? undefined
    : adapter.inspector?.editability?.(node.id, 'locked');
  const visibleEditability = isStructural
    ? undefined
    : adapter.inspector?.editability?.(node.id, 'visible');
  // THE RENDER COLUMN's own reserved path, probed the same way `visible` is.
  // Almost every adapter answers `undefined` — three.js has ONE
  // `Object3D.visible` governing viewport and render alike — and the column
  // then stays the reserved blank cell it has been. An adapter whose truth
  // really does separate the two fills it in, which is what the region's own
  // note (`workspace-regions.ts`, `hierarchyRestrictions`) said would happen:
  // Blender's Outliner draws `hide_viewport` and `hide_render` as two columns
  // (`outliner_draw.cc:1291-1384`), and `@volter/editor-blender`'s tree answers both.
  const renderValue = isStructural ? undefined : adapter.inspector?.get(node.id, 'renderVisible');
  const renderKnown = renderValue !== undefined;
  const renderVisible = renderValue !== false;
  const renderEditability = isStructural
    ? undefined
    : adapter.inspector?.editability?.(node.id, 'renderVisible');
  const renderWritable = renderKnown && (renderEditability?.writable ?? true);
  // THE EXCLUDE COLUMN's own reserved path, probed exactly as `renderVisible`
  // is. `true` means EXCLUDED, the sense Blender's own property carries
  // (`LayerCollection.exclude`), so the checkbox is CHECKED when the value is
  // false — which is also how Blender draws it: the button is an icon toggle
  // over a `hide_`-sense property and `outliner_draw.cc:561` inverts it.
  const excludeValue = isStructural ? undefined : adapter.inspector?.get(node.id, 'exclude');
  const excludeKnown = excludeValue !== undefined;
  const excluded = excludeValue === true;
  const excludeEditability = isStructural
    ? undefined
    : adapter.inspector?.editability?.(node.id, 'exclude');
  const excludeWritable = excludeKnown && (excludeEditability?.writable ?? true);
  // B1 (D9) — a group row's eye/interactive/pick-lock read the LIFTED,
  // module-level session store (`world-session-state.ts`), keyed by the
  // RAW manifest world id `badge.worldId` — not the group-node id itself.
  const worldHidden = badge ? isRootHidden(badge.worldId) : false;
  const worldInteractive = badge ? isRootInteractive(badge.worldId) : false;
  const worldPickLocked = badge ? isRootPickLocked(badge.worldId) : false;
  const visible = isGroupNode ? !worldHidden : adapter.inspector?.get(node.id, 'visible') !== false;
  const lockedKnown = lockedValue !== undefined;
  const locked = lockedValue === true;
  const lockedWritable = lockedKnown && (lockedEditability?.writable ?? true);
  const visibleWritable = visibleKnown && (visibleEditability?.writable ?? true);
  const nameKnown = nameValue !== undefined;
  // H1 — a component-instance row prints its type as a dim suffix
  // (`EnemyBravo ·Enemy`) and tints its own label. Detached `#n` pockets carry
  // no `typeLabel` by construction (#635), so they stay plain.
  const identity = rowIdentity(node);
  // Gated like its H2/H5 siblings below: a structural row (a world group, a
  // member root, a document/folder/story) is not an instance of anything by
  // construction, so asking is a question with no possible answer.
  const prefabOverrideCount = isStructural
    ? 0
    : (adapter.instances?.describe(node.id)?.overrides.length ?? 0);
  // H2 — one memoized verdict per row; structural rows (world groups, member
  // roots, documents/folders/stories) own no transform and are never probed.
  const transformLock = isStructural
    ? UNLOCKED
    : lockCache.summaryFor(adapter, editabilityVersion, node.id);
  // H5 — authorability warnings badge the row they are about. Structural rows
  // (world groups, member roots, documents/folders/stories) address no source
  // element, so they are never probed.
  // The cast is the STRUCTURAL probe, and the same one `instance-source-menu.ts`
  // uses for H3: `diagnosticsFor` is an optional adapter capability that
  // deliberately isn't in the `AuthoringAdapter` contract, so an adapter without
  // it simply produces no badges (the cache reads `undefined` and stops).
  const warning = isStructural
    ? null
    : warningCache.badgeFor(adapter as RowDiagnosticsSource, editabilityVersion, node.id);
  // An `InstancedMesh` is ONE object drawing N units, so this row — and every
  // count derived from the same walk — reports 1 where the reader sees N, with
  // no error anywhere. The detail is the only place the shortfall is
  // expressible. Cheap by construction (a type check and a number read, see
  // `instancedRowDetail`), so it costs a structural row nothing to ask.
  const instancedDetail = isStructural
    ? null
    : (hierarchyRowMedia()?.detail(adapter, node.id, store) ?? null);
  // THE COLLAPSED ROW'S DATABLOCK SUMMARY — Blender's rest state, the first
  // difference the eye catches in the column. Measured on `outliner.png`:
  // every object row in the frame sits behind a `>` with its datablock drawn
  // as an inline glyph one cell past the label's end. Expanding is what
  // produces the child row; the two never show at once.
  //
  // BOUNDED BY CONSTRUCTION. Only a collapsed row with children asks, and it
  // reads at most the first few child ids — a collapsed group with twenty
  // thousand scene children must not turn one row into twenty thousand
  // adapter reads, and it cannot: none of the first ids is a datablock, so
  // the summary is empty and nothing more is looked up.
  const datablockSummary =
    isCollapsed && hasChildren
      ? node.childIds
          .slice(0, DATABLOCK_SUMMARY_SCAN)
          .map((id) => adapter.hierarchy.node(id))
          .filter((child): child is EditorNode => child !== null && isDatablockKind(child.kind))
      : [];

  return (
    <div
      className="vgai-tree-row"
      // R5 (P6-U7): gate on the STABLE `isStructural` (which includes the
      // `role: 'root'`/`document`/`folder`/`story`/`boundary` STRUCTURAL_ROLES),
      // not just member/organization rows. A world-root navigator row
      // (role 'root') must never pollute `getEntityNames()` — and unlike the
      // async-settling `isOrganizationRow`, the role check doesn't flicker, so
      // search results stay entity-only deterministically.
      data-entity-name={isStructural ? undefined : node.label}
      data-testid="ingest-row"
      data-ingest-name={node.label}
      data-node-role={node.role}
      // THE ROW'S OWN DEPTH, as a fact and not as a padding. It is drawn as
      // `padding-left: calc(var(--vgai-tree-indent) * depth)`, so until this
      // attribute existed a reader (the product's chrome door,
      // `editor-document-probe.ts` scope `'outliner'`) could only recover the
      // tree's SHAPE by dividing one measured pixel number by another — which
      // is a reading of the paint, not of the tree. NOT `aria-level`: that
      // attribute is only valid under a `treeitem`/`row`/`listitem` role, and
      // this row declares none (it is a `div` the panel hit-tests itself), so
      // writing it would be invalid ARIA for the sake of a reader that has
      // `data-depth`.
      data-depth={depth}
      data-selected={isSelected ? 'true' : undefined}
      // The selection's ACTIVE row (see `isSelectionActive`). Its own attribute
      // rather than a second value on `data-selected`, because that value is
      // queried by name elsewhere in this file and by the e2e estate.
      data-selection-active={isSelectionActive ? 'true' : undefined}
      data-remotely-selected={remoteSelectionColors.length > 0 ? 'true' : undefined}
      data-dragging={isDragged ? 'true' : undefined}
      // The alternating stripe — see `rowIndex`'s own comment.
      data-row-alt={rowIndex % 2 === 1 ? 'true' : undefined}
      // H6 — de-emphasized through the SAME muted token the panel already uses
      // for a hidden/inactive row (`.vgai-tree-row[data-muted]` →
      // `--vgai-content-dim`), rather than a second dimming vocabulary. The
      // separate `data-internal` marker is what identifies the row's KIND.
      data-internal={isInternal ? 'true' : undefined}
      // AN EXCLUDED SUBTREE IS FADED, which is Blender's own answer:
      // `element_should_draw_faded` returns true for a `TSE_LAYER_COLLECTION`
      // whose `LAYER_COLLECTION_EXCLUDE` is set (`outliner_draw.cc:3331-3334`)
      // and the row's icon and text are then drawn at `alpha_fac` 0.5
      // (`:3376`, `:3525`). It rides the SAME muted token every other
      // de-emphasized row uses rather than a second dimming vocabulary — see
      // H6 above — and the whole SUBTREE follows because Blender's own
      // recursive write sets the flag on every descendant collection
      // (`view_layer__layer_collection_set_flag_recursive_fn`, `:1648-1651`),
      // so each descendant row answers `exclude` for itself.
      data-muted={isInternal || excluded || (!isStructural && !visible) ? 'true' : undefined}
      draggable={affordances.draggable}
      onDragStart={(e) => onDragStart(e, node.id)}
      onClick={(e) => {
        if (badge?.role === 'world') {
          // Runtime composition belongs to Game. In edit mode a manifest
          // world row is a document navigator: one click reveals that
          // world's isolated authoring surface, matching scene/file trees in
          // established editors. Nothing is swapped underneath: an
          // entry-based three root has no separate document to load.
          activateRootDocument(badge.worldId);
        }
        if (node.role === 'story') {
          // React edit mode is a Figma-style board, not a single selected
          // story pretending to be the runtime root. A story click activates
          // its owning world document and focuses that already-mounted frame.
          // Always apply—even when already active—so a second click recenters
          // a panned board. Double-click remains the explicit route to the
          // standalone Storybook document and its addon utilities.
          const storyRootId =
            adapter instanceof CompositeAuthoringAdapter ? adapter.ownerOf(node.id) : null;
          if (storyRootId) activateRootDocument(storyRootId);
          adapter.stories?.apply(node.id, node.id);
        }
        onClick(e, node.id);
      }}
      onDoubleClick={() => {
        if (node.role === 'story') {
          // A story row's node id IS the composed story id, which is the
          // whole address (`document-open-registry.ts`): resolving it, and
          // choosing the medium's document, is the story kind's own job.
          openRegisteredDocument('story', store, { storyId: node.id });
        } else if (
          node.role === 'component' ||
          node.role === 'instance' ||
          node.role === 'boundary'
        ) {
          onEnterScope(node.id);
        } else if (affordances.renamable && nameKnown) {
          onStartEditing(node.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, node.id);
      }}
      style={{
        // No `height` here: `.vgai-tree-row` already paints
        // `var(--vgai-tree-row-height)`, and an inline copy silently outranked
        // the active material's density.
        position: 'relative',
        paddingLeft: indentPx(depth),
        paddingRight: spaceVar[2],
        gap: spaceVar[2],
        cursor: 'pointer',
        outline: dropZone === 'child' ? `1px dashed ${themeVars.accent.default}` : 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        // The tree is body text at the material's own face size (Blender's
        // Outliner is 11px); `font-lg` made every row a size larger than the
        // material asked for.
        fontSize: 'var(--vgai-font-base)',
      }}
    >
      {dropZone === 'before' && (
        <DropIndicator position="before" style={{ left: indentPx(depth) }} />
      )}
      {dropZone === 'after' && <DropIndicator position="after" style={{ left: indentPx(depth) }} />}

      {/* One rule per ancestor column, on the caret centre of each. Always
       *  rendered: `--vgai-tree-indent-guide` is `transparent` for every
       *  palette that names no `color.boundary.indent`, so a skin without the
       *  member paints nothing and the spans cost it no pixels. */}
      {indentGuidesFor(depth, prevDepth, nextDepth).map((guide) => (
        <span
          key={guide.column}
          className="vgai-tree-indent-guide"
          aria-hidden="true"
          style={{
            left: `calc(${INDENT} * ${guide.column + 0.5} - 0.5px)`,
            top: guide.starts ? GUIDE_BLOCK_INSET : 0,
            bottom: guide.ends ? GUIDE_BLOCK_INSET : 0,
          }}
        />
      ))}

      {hasChildren ? (
        <IconButton
          type="button"
          variant="ghost"
          size="compact"
          aria-label={isCollapsed ? `Expand ${node.label}` : `Collapse ${node.label}`}
          // The state, not only the next gesture's name: a reader asking "is
          // this branch open" had to parse the English of the label above.
          aria-expanded={!isCollapsed}
          data-testid="ingest-row-caret"
          onClick={(e) => {
            e.stopPropagation();
            onToggleOpen(row, e.altKey);
          }}
          title="Expand/collapse (Option/Alt-click applies to the branch)"
          className="vgai-tree-caret"
        >
          <EditorIcon icon={isCollapsed ? faCaretRight : faCaretDown} aria-hidden="true" />
        </IconButton>
      ) : (
        <span
          data-testid="ingest-row-caret"
          aria-hidden="true"
          // The same cell the caret button occupies, so a leaf's type glyph
          // lands in the SAME column as an expandable sibling's. One indent
          // cell, as Blender's is — see `.vgai-tree-caret` in `theme.css`.
          style={{ width: INDENT, flexShrink: 0 }}
        />
      )}

      {remoteSelectionColors.length > 0 && (
        <span
          className="vgai-tree-remote-selection"
          role="img"
          title={`Selected by ${remoteSelectionColors.length} collaborator${remoteSelectionColors.length === 1 ? '' : 's'}`}
          aria-label="Selected by a collaborator"
        >
          {remoteSelectionColors.slice(0, 3).map((color) => (
            <span key={color} style={{ background: color }} aria-hidden="true" />
          ))}
        </span>
      )}

      {/* The live-content marker appears only on the manifest's sole Three
       *  root. Other media open their own authored documents when selected. */}
      {badge?.role === 'world' && badge.worldId === threeRootId && (
        <span
          data-testid="world-focus-radio"
          data-world-focused="true"
          title="Live Three world — shown in the viewport"
          style={{ fontSize: 'var(--vgai-font-xs)', opacity: 0.8, flexShrink: 0 }}
        >
          <EditorIcon icon={faCircleDot} aria-hidden="true" />
        </span>
      )}

      {/* THE TYPE GLYPH, and why its opacity is a measurement. This is where
          a glyph's own category ink lands (`EditorIcon` paints a toned glyph
          in `var(--vgai-category-…)`, and every category token is INK — see
          `theme.ts`'s category docblock), and the opacity is the SITE's half
          of Blender's model: the Outliner composites its glyphs at 0.80 over
          whatever the row paints. At 0.65 the Blender palette's `object`
          #e09557 composites to #a27149 over the panel, a washed tan against
          the #bb7f4d Blender actually draws; at 0.80 it composites to exactly
          #bb7f4d on the row's #272727 and exactly #c48856 on the plated
          #525252 — every channel of both, which is what proves the alpha.
          (It read 0.79 until 2026-09-18, from the two-background form
          (196−187)/(82−39) whose numerator carried one rounding step; 0.80
          is the direct fit against the ink photographed at full in
          `properties-object.png`.) It is a glyph's weight against its row,
          not a de-emphasis: do not round it away. */}
      <span
        // The class is what `theme.css`'s ACTIVE-ROW PLATE hangs its rule on;
        // the plate is drawn as this span's own `::before` so the glyph's box
        // — and with it every row measurement already fitted to the frame —
        // does not move.
        className="vgai-tree-type-glyph"
        title={node.role ? `${node.role}: ${node.kind}` : node.kind}
        style={{
          // ICONS HAVE THEIR OWN SIZE AXIS (`theme.ts`'s `iconSize`), and this
          // call site was still on the TYPE axis, so a skin that tightened its
          // text shrank the Outliner's type glyphs with it. The icon rungs
          // default to the type scale's values, so nothing moves for a skin
          // that declares no `density.icon`.
          //
          // Blender's own is larger still: on the native 2x `outliner.png` the
          // Camera row's glyph inks 30x30 device px — 15 CSS — where our set
          // draws ink at ~0.85 of its box (`blender-icons.source.mjs`'s `S`),
          // so 15 of ink is an 18px box and `icon.sm` (14) leaves ~3 px on the
          // table. That is a rung this site cannot spend without moving every
          // other skin's tree; it is a measurement, recorded, not a paint-over.
          width: 'var(--vgai-icon-md)',
          fontSize: 'var(--vgai-icon-sm)',
          // THE 0.80 MOVED TO THE GLYPH (`theme.css`'s
          // `.vgai-tree-type-glyph > *`), for the reason its datablock sibling
          // already carries: the active row's plate is this span's own
          // `::before`, so a group opacity here multiplied the plate's
          // measured alphas by 0.8 as well — measured 0.203 against the
          // declared 0.26 before the move. The glyph's own weight is
          // unchanged, and so is every row that draws no plate. */
          flexShrink: 0,
          textAlign: 'center',
        }}
      >
        <EditorIcon icon={iconForNode(node)} aria-hidden="true" />
      </span>

      {isEditing ? (
        <TextInput
          autoFocus
          defaultValue={node.label}
          onBlur={(e) => {
            adapter.inspector!.set(node.id, 'name', e.currentTarget.value);
            store.notifyIngestEdit();
            onStartEditing('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              adapter.inspector!.set(node.id, 'name', e.currentTarget.value);
              store.notifyIngestEdit();
              onStartEditing('');
            }
            if (e.key === 'Escape') onStartEditing('');
          }}
          onClick={(e) => e.stopPropagation()}
          data-variant="tree-edit"
          style={{
            flex: 1,
            minWidth: 0,
          }}
        />
      ) : (
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {/* H1 — instance identity AT THE ROW, carried by an UNDERLINE rather
              than by recolored text (owner, 2026-07-31). Unity tints the label
              blue; a rule under the name says the same thing without spending
              the row's one text color, and it survives what color could not:
              it reads identically in every palette, needs no contrast budget
              against the row background, and does not compete with the
              warning badge and lock glyph that sit on this same row. It also
              says the right thing — an instance REFERENCES a definition
              elsewhere, which is what an underline has always meant, and what
              this row's Go to Callsite / Open Component Source actions do.
              `semantic.instance` survives as the rule's own color, so the hue
              is a hint rather than the whole signal.

              The suffix rides INSIDE this ellipsizing span, so a long name
              still truncates with the row instead of pushing the eye/lock
              glyphs off it, and is deliberately NOT underlined: the underline
              marks the instance's NAME, and drawing it under `·Enemy` too
              would read as one hyperlink over both. Search is unaffected:
              `searchPathKeys`/`highlightSegments` both read `node.label` only,
              so the suffix can neither create nor highlight a match.

              A LOOK MAY DROP THE SUFFIX (`typeSuffixShown`, the
              `hierarchyTypeSuffix` chrome region). Blender's does: measured on
              `outliner.png`, not one row in that frame carries type text after
              its name, because the type is the GLYPH there.

              A LOOK MAY ALSO DROP THE RULE (`instanceRuleShown`, the
              `hierarchyInstanceRule` region), and Blender's does — measured
              across all three Outliner frames, it marks an instance nowhere in
              that panel, in any selection state. That is a separate decision
              from the suffix and it took its own region key: the earlier note
              here reasoned that a row with no suffix is the row that most needs
              the rule, which is true of THIS editor's row and says nothing
              about a look whose reference draws neither.

              THE SELECTED NAME takes the palette's active ink where it declares
              one (`content.active`; Blender's `#ffae28`, an 82-pixel plateau on
              the Cube in `outliner.png` and again in
              `modeling-object-selected.png`). Under a palette that names none
              the token is empty, the declaration is invalid at computed-value
              time, and the name inherits the row's ink exactly as before.

              A SELECTED-BUT-NOT-ACTIVE name takes `content.selected` instead —
              Blender's `#e86900` (232,105,0, a solid plateau on Camera and
              Light in `modeling-object-selected.png`), against `#ffae28` on the
              active Cube. The emitter falls `content.selected` back to
              `content.active`, so a palette naming only the one inks every
              selected row as before.

              The instance rule yields on a selected row — see
              `--vgai-tree-active-name-underline` in `theme.ts` for why and for
              what a palette without an active ink gets; a look may also drop
              the rule outright, above. */}
          {identity.typeSuffix ? (
            <span
              data-testid="hierarchy-instance-label"
              // WHEN THE SUFFIX IS HIDDEN the name carries both facts the
              // suffix used to: the sentence moves onto this `title`, and the
              // override `*` rides the name rather than leaving with the span
              // it used to sit in. Nothing the row could say is lost — only
              // the type TEXT, which is what the region asked to drop.
              {...(typeSuffixShown
                ? {}
                : { title: `Component instance of <${identity.typeSuffix}>` })}
              style={{
                // The LOOK decides first (`instanceRuleShown`); only where the
                // rule is drawn at all does the palette's active-ink rule get
                // to make the selected row yield.
                textDecorationLine: !instanceRuleShown
                  ? 'none'
                  : isSelected
                    ? 'var(--vgai-tree-active-name-underline)'
                    : 'underline',
                textDecorationStyle: 'dotted',
                textDecorationColor: themeVars.semantic.instance,
                textUnderlineOffset: '3px',
                ...(isSelected
                  ? {
                      color: isSelectionActive
                        ? themeVars.content.active
                        : themeVars.content.selected,
                    }
                  : {}),
              }}
            >
              {highlightSegments(node.label, searchTerm)}
              {!typeSuffixShown && prefabOverrideCount > 0 ? '*' : ''}
            </span>
          ) : (
            <span
              data-testid="hierarchy-plain-label"
              style={
                isSelected
                  ? {
                      color: isSelectionActive
                        ? themeVars.content.active
                        : themeVars.content.selected,
                    }
                  : undefined
              }
            >
              {highlightSegments(node.label, searchTerm)}
            </span>
          )}
          {/* THE DATABLOCK SUMMARY, and why it rides INSIDE the label span.
              The span is `flex: 1`, so anything placed after it lands against
              the row's right edge where the eye and lock columns are —
              Blender draws the glyph one cell past the NAME, not at the
              margin. The suffixes above solve the same problem the same way.

              Measured on `outliner.png` (native 2x, halve for points): the
              plate is 40x36 device px — one 20-point cell wide, two points
              shorter than the 20-point row — with a ~10 device-px corner (the
              left edge is full at y=184 on a box that starts at y=175). Our
              radius is the material's own `shape.small`; Blender's widgets
              round at 4 where this plate rounds at 5, and we carry no token
              for the second number. The cell starts 40-41 device px past the
              label's last ink on all three of the frame's rows, which is one
              cell, so the gap is the indent step. */}
          {datablockSummary.map((child) => (
            <span
              key={child.id}
              className="vgai-tree-datablock"
              // THE PLATE FOLLOWS THE ACTIVE ROW, NOT THE SELECTION, and the
              // frames are unambiguous: in `modeling-object-selected.png` all
              // three rows are selected and NOT ONE carries a mesh-data plate,
              // while in `outliner.png` (edit mode) only the ACTIVE row's does.
              // Under `isSelected` a multi-selection plated every selected
              // row's datablock — a mark Blender never draws.
              data-active={isSelectionActive ? 'true' : undefined}
              title={`${child.kind}: ${child.label}`}
            >
              <EditorIcon icon={hierarchyKindIcon(child.kind)} aria-hidden="true" />
            </span>
          ))}
          {identity.typeSuffix && typeSuffixShown && (
            <span
              data-testid="hierarchy-instance-type"
              data-type-label={identity.typeSuffix}
              title={`Component instance of <${identity.typeSuffix}>`}
              style={{
                marginLeft: spaceVar[2],
                fontSize: 'var(--vgai-font-sm)',
                color: themeVars.content.dim,
              }}
            >
              ·{identity.typeSuffix}
              {prefabOverrideCount > 0 ? '*' : ''}
            </span>
          )}
          {node.secondaryLabel && (
            <span
              style={{ marginLeft: spaceVar[3], fontSize: 'var(--vgai-font-sm)', opacity: 0.5 }}
            >
              {node.secondaryLabel}
            </span>
          )}
          {instancedDetail && (
            <span
              data-testid="hierarchy-instanced-units"
              style={{ marginLeft: spaceVar[3], fontSize: 'var(--vgai-font-sm)', opacity: 0.5 }}
            >
              {instancedDetail}
            </span>
          )}
          {badge?.role === 'world' && badge.zOrder !== 0 && (
            <span
              title={`Z order: ${badge.zOrder}`}
              style={{ marginLeft: spaceVar[3], fontSize: 'var(--vgai-font-sm)', opacity: 0.6 }}
            >
              Z {badge.zOrder}
            </span>
          )}
          {badge?.provenance && (
            <span
              data-testid="world-provenance"
              data-provenance={badge.provenance.source}
              title={badge.provenance.detail}
              style={{
                marginLeft: spaceVar[3],
                fontSize: 'var(--vgai-font-xs)',
                padding: `0 ${space[2]}px`,
                borderRadius: themeVars.shape.small,
                border: `1px solid ${themeVars.boundary.strong}`,
                color: themeVars.content.muted,
                verticalAlign: 'middle',
              }}
            >
              {badge.provenance.label}
            </span>
          )}
        </span>
      )}

      {/* H5 — "warnings live on the row" (Godot's yellow `!`). Placed BEFORE
          the H2 lock glyph deliberately: the two are read together far more
          often than either is read alone (an unmovable enemy is usually
          unmovable BECAUSE of an R3F002), and this order puts the cause
          immediately left of the effect, with both sitting between the label
          and the interactive action strip (lock/eye buttons) rather than
          inside it. Like the lock it is NOT a button — a warning is a
          statement about the source, and the fix is a source edit.

          The tooltip is the analyzer's own sentence(s), verbatim and
          newline-joined by `rowWarningBadge`; nothing here rewords, ranks or
          truncates them. */}
      {warning && (
        <span
          data-testid="hierarchy-row-warning"
          data-warning-codes={warning.codes.join(',')}
          data-warning-count={warning.count}
          role="img"
          title={warning.tooltip}
          aria-label={`${node.label}: ${warning.tooltip}`}
          style={{
            fontSize: 'var(--vgai-font-sm)',
            color: themeVars.semantic.warning,
            flexShrink: 0,
          }}
        >
          <EditorIcon icon={faTriangleExclamation} aria-hidden="true" />
        </span>
      )}

      {/* H2 — movability at a glance. NOT a button: this is a read-only
          statement about the source, not a toggle (the toggle is the
          `ingest-row-lock` control below, which writes the adapter's `locked`
          property). The tooltip is the adapter's own reason string, verbatim
          — the same sentence the inspector field and the gizmo-denial hint
          show. Never paraphrase it here. */}
      {transformLock.locked && transformLock.reason && (
        <span
          data-testid="hierarchy-transform-lock"
          role="img"
          title={transformLock.reason}
          aria-label={`${node.label}: ${transformLock.reason}`}
          style={{
            fontSize: 'var(--vgai-font-sm)',
            color: themeVars.content.dim,
            flexShrink: 0,
          }}
        >
          <EditorIcon icon={faLock} aria-hidden="true" />
        </span>
      )}

      {/* THE SELECTION LOCK is a restriction COLUMN, and a look decides which
          columns a row carries (`restrictionColumns`, the
          `hierarchyRestrictions` chrome region — Blender calls the same
          decision its Outliner filter). Under `viewport+render` this column is
          not in the set: measured on `outliner.png`, no row in the frame draws
          a lock, Blender's Disable Selection column being off by default. The
          `locked` property itself is untouched — the inspector's own field
          still writes it, so nothing becomes unreachable. */}
      {restrictionColumns === 'select+viewport' && lockedKnown && affordances.writable && (
        <IconButton
          type="button"
          variant="ghost"
          size="compact"
          data-testid="ingest-row-lock"
          disabled={!lockedWritable}
          title={
            lockedWritable ? (locked ? 'Unlock' : 'Lock') : lockedEditability?.reason || 'Locked'
          }
          aria-label={locked ? `Unlock ${node.label}` : `Lock ${node.label}`}
          aria-pressed={locked}
          onClick={(e) => {
            e.stopPropagation();
            adapter.inspector!.set(node.id, 'locked', !locked);
            store.notifyIngestEdit();
          }}
        >
          <EditorIcon icon={locked ? faLock : faLockOpen} aria-hidden="true" />
        </IconButton>
      )}

      {/* THE EXCLUDE COLUMN — Blender's leftmost restriction column, drawn for
          `LayerCollection` rows (`outliner_draw.cc:1634-1653`) and present in
          its default `show_restrict_flags` (`space_outliner.cc:399`).

          IT FOLLOWS WHAT THE ADAPTER ANSWERS and nothing else (owner ruling,
          2026-09-19; the render column already worked this way). The column
          exists on every row of a tree in which ANY row answers `exclude`
          (`excludeColumnShown`, resolved once by the panel), and a row that
          answers nothing gets the reserved blank cell — so the eye and the
          camera stay in one column down the whole tree, which is the same
          reason the render cell is reserved.

          The value's sense is Blender's: `true` is EXCLUDED, so the box is
          CHECKED when the collection is IN the view layer. Blender draws it the
          same way round — an icon toggle over a `hide_`-sense property, which
          `outliner_draw.cc:561` inverts. */}
      {excludeColumnShown &&
        (excludeKnown && affordances.writable ? (
          <IconButton
            type="button"
            variant="ghost"
            size="compact"
            data-testid="ingest-row-exclude"
            disabled={!excludeWritable}
            title={
              excludeWritable
                ? excluded
                  ? 'Include in view layer'
                  : 'Exclude from view layer'
                : excludeEditability?.reason || 'Exclusion is read-only'
            }
            aria-label={
              excluded
                ? `Include ${node.label} in the view layer`
                : `Exclude ${node.label} from the view layer`
            }
            aria-checked={!excluded}
            role="checkbox"
            onClick={(e) => {
              e.stopPropagation();
              adapter.inspector!.set(node.id, 'exclude', !excluded);
              store.notifyIngestEdit();
            }}
          >
            <EditorIcon
              icon={excluded ? OUTLINER_EXCLUDE_OFF : OUTLINER_EXCLUDE_ON}
              aria-hidden="true"
            />
          </IconButton>
        ) : (
          <span aria-hidden="true" style={{ width: INDENT, flexShrink: 0 }} />
        ))}

      {/* H6 — the eye is SUPPRESSED on a revealed internal. This gate is
          contract-level: an adapter may implement `internalChildren` over
          source-backed or foreign content, and H6's promise is that revealing
          internals adds NO write surface at all. A row that refuses rename,
          drag, duplicate and delete but offers one working toggle reads as an
          accident, not a rule. */}
      {(visibleKnown || isGroupNode) && affordances.writable && (
        <IconButton
          type="button"
          variant="ghost"
          size="compact"
          data-testid="ingest-row-visibility"
          disabled={!isGroupNode && !visibleWritable}
          title={
            isGroupNode || visibleWritable
              ? visible
                ? 'Hide'
                : 'Show'
              : visibleEditability?.reason || 'Visibility is read-only'
          }
          aria-label={visible ? `Hide ${node.label}` : `Show ${node.label}`}
          aria-pressed={!visible}
          onClick={(e) => {
            e.stopPropagation();
            if (badge) {
              toggleRootHidden(badge.worldId);
              store.notifyIngestEdit();
            } else {
              adapter.inspector!.set(node.id, 'visible', !visible);
              store.notifyIngestEdit();
            }
          }}
        >
          <EditorIcon icon={visible ? faEye : faEyeSlash} aria-hidden="true" />
        </IconButton>
      )}

      {/* THE RENDER COLUMN. Under `viewport+render` the row's column set is
          Blender's, whose outer slot is Disable in Renders
          (`outliner_draw.cc:1363-1384`, `Object.hide_render`).

          BLANK UNLESS THE ADAPTER SEPARATES THE TWO, which almost none do:
          three.js has ONE `Object3D.visible` governing viewport and render
          alike, so a toggle over it would write nothing and fail "a control is
          accepted through its own click". It is then the POSITION that is
          load-bearing — Blender's columns are slots, its eye 32 CSS px in from
          the area's right edge and its camera 12, so an eye drawn last lands
          in the camera's slot and aligns with neither. One reserved cell (the
          tree's own indent step, which is Blender's 20 px column pitch) puts
          the eye where Blender's eye is.

          An adapter that DOES separate them answers the reserved
          `renderVisible` path and gets the real toggle: `@volter/editor-blender`'s
          Outliner, whose rows carry `hide_viewport` and `hide_render` as two
          different facts. Not rendered at all under the editor's own column
          pair, so no other look gains a gutter. */}
      {restrictionColumns === 'viewport+render' &&
        (renderKnown && affordances.writable ? (
          <IconButton
            type="button"
            variant="ghost"
            size="compact"
            data-testid="ingest-row-render-visibility"
            disabled={!renderWritable}
            title={
              renderWritable
                ? renderVisible
                  ? 'Disable in renders'
                  : 'Enable in renders'
                : renderEditability?.reason || 'Render visibility is read-only'
            }
            aria-label={
              renderVisible ? `Disable ${node.label} in renders` : `Enable ${node.label} in renders`
            }
            aria-pressed={!renderVisible}
            onClick={(e) => {
              e.stopPropagation();
              adapter.inspector!.set(node.id, 'renderVisible', !renderVisible);
              store.notifyIngestEdit();
            }}
          >
            <EditorIcon
              icon={renderVisible ? OUTLINER_RENDER_ON : OUTLINER_RENDER_OFF}
              aria-hidden="true"
            />
          </IconButton>
        ) : (
          <span aria-hidden="true" style={{ width: INDENT, flexShrink: 0 }} />
        ))}

      {/* B1 (D9) — session-local, per-world design-time toggles: `interactive`
       *  forwards real pointer events to the world's layer (design-time
       *  hover/press testing, `design-time-layers.ts`); `pickLock` is stored
       *  for B4's layered viewport picking to consume. Group rows only —
       *  neither concept applies to an ordinary entity row. */}
      {badge && (
        <IconButton
          type="button"
          variant="ghost"
          size="compact"
          data-testid="world-interactive-toggle"
          title={
            worldInteractive
              ? 'Interactive (layer forwards pointer events)'
              : 'Not interactive (layer is pointer-events:none)'
          }
          aria-label={`Forward pointer events to ${node.label}`}
          aria-pressed={worldInteractive}
          onClick={(e) => {
            e.stopPropagation();
            toggleRootInteractive(badge.worldId);
            store.notifyIngestEdit();
          }}
        >
          <EditorIcon icon={faHandPointer} aria-hidden="true" />
        </IconButton>
      )}
      {badge && (
        <IconButton
          type="button"
          variant="ghost"
          size="compact"
          data-testid="world-picklock-toggle"
          title={
            worldPickLocked ? 'Pick-locked (skipped by topmost-layer picking)' : 'Not pick-locked'
          }
          aria-label={`Exclude ${node.label} from viewport picking`}
          aria-pressed={worldPickLocked}
          onClick={(e) => {
            e.stopPropagation();
            toggleRootPickLock(badge.worldId);
            store.notifyIngestEdit();
          }}
        >
          <EditorIcon icon={faCrosshairs} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}, sameRowProps);

// --- Main panel ---

export interface GameHierarchySurfaceProps {
  readonly store: ShellStore;
  readonly adapter: AuthoringAdapter;
}

/** The half of the row pipeline derived from the TREE alone — memoized on
 *  `[adapter, store.contentVersion, adapterVersion]`. See the block that
 *  builds it. */
interface StructuralRowView {
  readonly adapter: AuthoringAdapter;
  readonly contentVersion: number;
  readonly objectMapEpoch: number;
  readonly marked: ReturnType<typeof componentMarkView>;
  readonly internals: ReturnType<typeof internalsProjection>;
  readonly hierarchyView: ReturnType<typeof authoredContentHierarchy>;
  readonly structuralRows: HierarchyNodeRow[];
  readonly defaultExpansion: Map<string, boolean>;
  readonly index: RowPathIndex;
}

/** The FOLD projected onto a {@link StructuralRowView} — the collapsed set
 *  every row is drawn with, plus the scope row it is relative to. Memoized on
 *  the structure, the fold generation and the scope; NOT on the selection. */
interface FoldRowView {
  readonly scopeRow: HierarchyNodeRow | null;
  readonly effectiveCollapsedPaths: ReadonlySet<string>;
}

/** The capped/searched/scoped view built on top of a {@link StructuralRowView}
 *  and a {@link FoldRowView}. */
interface BrowseRowView {
  readonly rows: HierarchyNodeRow[];
}

/** Production hierarchy surface with its runtime dependencies made explicit.
 * The editor shell supplies the active store/adapter below; bounded hosts such
 * as Storybook can supply the same public authoring contract without booting a
 * project session or maintaining a second hierarchy implementation. */
export function GameHierarchySurface({ store, adapter }: GameHierarchySurfaceProps) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const deferredContentVersion = useDeferredValue(store.contentVersion);
  useSyncExternalStore(subscribeSelectionScope, selectionScopeVersion);
  // THE ROW MARKS THE ACTIVE LOOK ASKS FOR, read ONCE per panel render and
  // handed down as ordinary props — never per row. Same shape as
  // `HeaderTelemetry.tsx`'s read of the same store; the key is a stable string
  // so `useSyncExternalStore` can compare snapshots by identity.
  useSyncExternalStore(subscribeChromeRegions, chromeRegionsKey, chromeRegionsKey);
  const typeSuffixShown = activeChromeRegions().hierarchyTypeSuffix !== 'hidden';
  const instanceRuleShown = activeChromeRegions().hierarchyInstanceRule !== 'hidden';
  const restrictionColumns =
    activeChromeRegions().hierarchyRestrictions ?? ('select+viewport' as const);
  const [adapterVersion, forceAdapterUpdate] = useReducer((value: number) => value + 1, 0);
  const observedStoreVersion = useRef(store.getSnapshot());
  observedStoreVersion.current = store.getSnapshot();
  const [collaboration, setCollaboration] = useState<CollaborationSnapshot | null>(
    collaborationSnapshot(),
  );
  // AN ADAPTER'S NOTIFICATION ALWAYS BUMPS `adapterVersion`, and that version is
  // a ROW PROP (see {@link sameRowProps}). It used to bump only when the store
  // had not moved, which was enough while every adapter mutated its truth
  // SYNCHRONOUSLY inside the click that changed it: the store's own re-render
  // then already carried the new value. An adapter whose truth is somewhere
  // else answers LATER — `@volter/editor-blender`'s Outliner writes a restriction column
  // into the engine and re-reads the tree a round trip afterwards — and by then
  // the store's version has long since moved, so the notification was dropped
  // and the row kept drawing the state it had before the click (measured
  // 2026-09-19: the eye wrote `hide_viewport` in Blender, the tree re-read, the
  // store published, and the row's eye never moved). One render per
  // notification is what a notification means.
  useEffect(
    () =>
      adapter.subscribe?.(() => {
        observedStoreVersion.current = store.getSnapshot();
        forceAdapterUpdate();
      }),
    [adapter, store],
  );
  useEffect(() => connectCollaboration(setCollaboration), []);
  const remoteSelectionColors = useMemo(() => {
    const byNode = new Map<string, string[]>();
    for (const participant of collaboration?.participants ?? []) {
      if (participant.participantId === EDITOR_PARTICIPANT_ID) continue;
      for (const selectedId of participant.presence.selection) {
        const colors = byNode.get(selectedId) ?? [];
        if (!colors.includes(participant.color)) colors.push(participant.color);
        byNode.set(selectedId, colors);
      }
    }
    return byNode;
  }, [collaboration]);
  // H2 — one memo of the per-row transform-lock verdict for the WHOLE panel,
  // so `editability` (which the R3F adapter answers by re-parsing JSX
  // attributes out of cached source text) is called at most once per row per
  // change, not three times per row per render. The invalidation key is the
  // sum of the two structural counters: the shell store's deferred content
  // version and this component's own adapter-subscription counter. Both are
  // monotone, so the sum strictly
  // increases whenever either does — a stale entry cannot outlive a source
  // edit. The cache is a `useRef` (never module state, so it can't leak
  // between editor sessions) and additionally clears itself whenever the
  // adapter identity changes; see `TransformLockCache`.
  const lockCacheRef = useRef(new TransformLockCache());
  // H5 — the same memo shape and the SAME key for the row's authorability
  // warnings. Sharing the key is not a shortcut: diagnostics ride the OID index,
  // and the R3F adapter's `refreshSourceState()` ends by calling
  // `store.notifyIngestEdit()`, so a newly-fetched index bumps the content version
  // and clears this cache on the same tick it clears the lock cache.
  const warningCacheRef = useRef(new RowWarningCache());
  // Selection/play-state notifications still re-render synchronously through
  // useSyncExternalStore above, but cannot change transform editability. Keep
  // the expensive per-row lock/body queries on the store's explicit facet
  // epoch. An exact object-map delta admits/removes rows but cannot change the
  // reflected properties of survivors; new ids miss both caches naturally.
  const editabilityVersion = store.hierarchyRowFacetVersion;
  // A4 — recomputed per notify (never cached across notifies): drives the
  // world-group rows' ●/○ focus radio.
  const threeViewportRootId = resolveThreeViewportRootId(store);

  const [search, setSearch] = useState('');
  // The dock group's header-actions element, when the shell published one —
  // the Outliner's controls ride the tab strip rather than a row of their own
  // (`hierarchy-header-slot.ts`).
  const headerSlot = useSyncExternalStore(
    subscribeHierarchyHeaderSlot,
    hierarchyHeaderSlot,
    () => null,
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [tailDrop, setTailDrop] = useState(false);
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null);
  /** The sentence explaining why the CURRENT hover would do nothing, or `null`.
   *  A ref, not state: it must not re-render the panel on every dragover frame,
   *  and it is only ever read once, at drop. */
  const dropRefusalRef = useRef<string | null>(null);
  // D9 — world-group visibility (eye) is SESSION-LOCAL shell state, never
  // routed through `inspector`/serialized. B1 LIFTED this out of a local
  // `useState` (which the design-time layer stack could never see) into the
  // module-level `world-session-state.ts` singleton, so `design-time-layers.ts`
  // can actually hide/show a world's DOM layer, not just dim its hierarchy
  // row — see that module's header comment.
  // Scroll-window state — the live `scrollTop`, updated by
  // `onScroll` below; `clientHeight` is read fresh from `containerRef` every
  // render rather than cached in state (see the constants' doc comment).
  const [scrollTop, setScrollTop] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  // THE OUTLINER, ONLY WHEN A LOOK PAINTS ONE. `data-vgai-region` is the
  // host's capability attribute for "this is that editor AREA", and it is
  // published here too because a panel's body can live in a render container
  // of the host's own, where the region's copy is not an ancestor of anything
  // inside the panel.
  //
  // The condition is the PALETTE's claim, never a look's name: a palette that
  // names `color.region.outliner` paints editor areas as areas, and the
  // frame-justified chrome that only reads as chrome inside one (the empty-row
  // zebra below, `theme.css`) is that look's. A host with none declared —
  // Classic's reference frame — gets no attribute and no zebra.
  const outlinerRegion = useSyncExternalStore(
    subscribeEditorTheme,
    editorPaintedRegions,
    editorPaintedRegions,
  ).includes('outliner')
    ? 'outliner'
    : undefined;
  const revealedRef = useRef(new Map<string, number>());
  const sessionExpansionRef = useRef(new Map<string, boolean>());
  // The row pipeline's two memo slots — see the block that reads them below.
  // A `useRef`, never module state, so nothing survives an editor session.
  const rowCacheRef = useRef(
    new HierarchyRowCache<StructuralRowView, BrowseRowView, FoldRowView>(),
  );
  /**
   * Bumped by every REAL write to the two fold stores this panel owns — the
   * session map above, the per-project persisted preferences, and the
   * "show more children" counts. It is the browse memo's invalidation key,
   * because neither store is a value the memo could compare: both are mutable
   * maps this component writes in place, and one of them (`localStorage`-backed
   * expansion preferences) is not even held here.
   */
  const expansionGenerationRef = useRef(0);
  const sessionExpansionProjectRef = useRef<string | null>(null);
  const lastSelectionExpansionRef = useRef<{
    adapter: AuthoringAdapter;
    selection: string;
  } | null>(null);
  const lastClickedRef = useRef<string | null>(null);
  const lastAutoRevealRef = useRef<{ adapter: AuthoringAdapter; selection: string } | null>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const term = search.trim().toLowerCase();
  const projectIdentity = getCurrentProject()?.rootPath ?? '__unscoped__';
  const selected = adapter.selection?.get() ?? [];
  // The toolbar's generic Add menu targets the selected hierarchy node. The
  // composite adapter then routes the request to that node's owning world
  // adapter, whose `creatableKinds` is the sole source of menu contents.
  // Multi-selection has no unambiguous parent, so it intentionally falls
  // back to the active adapter's root-level insertion behavior.
  const createTargetId = selected.length === 1 ? selected[0]! : null;
  const selectionSignature = [...selected].sort().join('\0');
  const selectedIds = useMemo(
    () => new Set(selectionSignature === '' ? [] : selectionSignature.split('\0')),
    [selectionSignature],
  );
  // THE SELECTION'S ANCHOR, read from the UNSORTED array — the signature above
  // sorts, which is right for a memo key ("is it the same SET?") and destroys
  // the one thing this needs. `selection.get()` reports the adapter's own order
  // and every stock adapter hands back its insertion-ordered set, so the last
  // id is the one the selection took last. That id is already what the gizmo
  // binds to (`EditorShellStore.selectedEntityId`) and what the inspector
  // inspects (`resolveInspectionSubjectId`); the Outliner's active row is those
  // two panels saying which row they are answering about, not a new fact.
  const selectionAnchorId = selected.at(-1) ?? null;
  const scopeStack = selectionScopeStack(adapter);
  const scopeId = scopeStack.at(-1) ?? null;

  // THE SELECTED ROW IS ON SCREEN. Reveal opened the ancestors, but the list
  // never scrolled: a dropped tower was selected at row 24 while the list
  // clipped at row ~15, so the author still had to hunt for what they had
  // just dropped (build-47 gate, 2026-09-02). Scroll once per selection
  // change — and retry across structure updates until the row exists, since
  // a drop selects its element before the hierarchy has absorbed the remount
  // — never on later edits, so an author who scrolled away is not dragged
  // back.
  const lastScrolledSelectionRef = useRef('');
  useEffect(() => {
    if (selectionSignature === '' || lastScrolledSelectionRef.current === selectionSignature) {
      return;
    }
    const container = containerRef.current;
    const row = container?.querySelector<HTMLElement>('[data-selected="true"]');
    if (!container || !row) return;
    const box = container.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) row.scrollIntoView({ block: 'nearest' });
    lastScrolledSelectionRef.current = selectionSignature;
  });

  if (sessionExpansionProjectRef.current !== projectIdentity) {
    sessionExpansionRef.current.clear();
    sessionExpansionProjectRef.current = projectIdentity;
    lastSelectionExpansionRef.current = null;
  }

  // H6 — the hierarchy the panel walks is the adapter's own, plus the internals
  // of whatever rows the author revealed. Everything downstream (cap, collapse,
  // search, selection reveal, virtualization) is unchanged and unaware: reveal
  // composes by feeding the SAME flattener a richer provider, never by forking
  // the row pipeline. Identity-equal to `adapter.hierarchy` when nothing is
  // revealed, which is the overwhelmingly common case.
  //
  // HIER-COMPONENT-TREE composes IN FRONT of that: the game's own
  // `vgaiComponentRoot`/`vgaiBuiltInternal` marks turn an instance into one
  // closed row and fold its runtime-built parts (bones, particle renderers)
  // into exactly the internals reveal already knows how to show. Feeding the
  // marked view to `internalsProjection` instead of the bare adapter is the
  // WHOLE integration — read-only, search exclusion, drag refusal and the
  // Reveal Internals menu item are the same code for both sources of internals.
  // ---------------------------------------------------------------------
  // THE ROW PIPELINE, IN TWO MEMOIZED HALVES.
  //
  // Everything from here to `rows` used to run on every render — and this
  // panel re-renders on every store notify, selection included. On a
  // 20 000-node world that is two uncapped flattens, a per-node first-open
  // policy and a per-row ancestor climb, paid for a click that moved a
  // highlight: 100-430ms of main-thread block AFTER a `select` whose reply
  // had already gone out in 3ms (scale-speed baseline, 22 of 43 offenders).
  //
  // The split is by what each half actually READS. `structure` reads the tree
  // and nothing else, so it keys on the adapter plus `store.contentVersion`
  // and the adapter's own structural notification counter —
  // the counter that stands still for a selection-only notify and moves for
  // every other mutation, the adapter's own `notifyIngestEdit` on a live
  // structural change included. `browse` reads the fold/scope/search/reveal
  // state on top of it. Selection reaches `browse` only through the reveal it
  // opens, which is why the two helpers below are now indexed rather than
  // scanned: a click that reveals nothing new leaves both halves untouched.
  // ---------------------------------------------------------------------
  const rowCache = rowCacheRef.current;
  const structuralKey = [adapter, deferredContentVersion, adapterVersion] as const;
  const structure = rowCache.structural(structuralKey, (previous) => {
    const marked = componentMarkView(
      adapter as unknown as MarkedTreeSource,
      hierarchyRowMedia()?.marks(adapter.hierarchy) ?? NO_MARKS,
    );
    const internals = internalsProjection(marked);
    const hierarchyView = authoredContentHierarchy(internals.hierarchy);
    // Always take one uncapped, uncollapsed structural snapshot first. It is
    // the source for stable defaults, search ancestry, selection reveal, and
    // branch operations. The final browse tree below is still capped and
    // virtualized, so this does not inflate rendered DOM for large ingests.
    const structureLog = hierarchyRowMedia()?.structureLog(store) ?? null;
    const objectMapEpoch = structureLog?.epoch() ?? 0;
    const contentDelta = previous ? deferredContentVersion - previous.contentVersion : 0;
    const objectMapDelta = previous ? objectMapEpoch - previous.objectMapEpoch : 0;
    const incrementalChanges =
      previous?.adapter === adapter &&
      deferredContentVersion === store.contentVersion &&
      contentDelta > 0 &&
      contentDelta === objectMapDelta
        ? (structureLog?.parentChangesSince(previous.objectMapEpoch) ?? null)
        : null;
    const patchedRows =
      previous && incrementalChanges
        ? patchUniqueHierarchyRows(
            hierarchyView,
            previous.structuralRows,
            incrementalChanges.changedParentIds,
          )
        : null;
    const structuralRows = patchedRows ?? flattenHierarchyRows(hierarchyView, new Set());
    // H6 first-open policy: the revealed row opens, its internals start folded —
    // the reveal root's DIRECT children are what "reveal" means; a 60-bone rig
    // dumped whole is not. See `applyRevealExpansionDefaults`.
    // Order is the policy: shape rule first, then "an instance opens closed",
    // then reveal (which must win — revealing an instance's internals that left
    // the instance itself folded would look like the action did nothing). All
    // three are DEFAULTS; the author's session/persisted fold still wins over
    // every one of them.
    const defaultExpansion = applyRevealExpansionDefaults(
      applyComponentRootExpansionDefaults(
        defaultExpansionByNode(structuralRows, adapter),
        structuralRows,
        (id) => marked.isComponentRoot(id),
      ),
      internals,
    );
    return {
      adapter,
      contentVersion: deferredContentVersion,
      objectMapEpoch,
      marked,
      internals,
      hierarchyView,
      structuralRows,
      defaultExpansion,
      index: indexRowPaths(structuralRows),
    };
  });
  const { marked, internals, hierarchyView, structuralRows, defaultExpansion } = structure;

  // The fold state a row is ACTUALLY rendered with: the session's own choice
  // first, then this project's persisted preference, then the structural
  // default, then open. Every consumer below asks this question by node id —
  // including the selection-reveal guard, which is why it is not a
  // row-shaped helper.
  const expandedById = (id: string): boolean =>
    sessionExpansionRef.current.get(id) ??
    hierarchyExpansionPreference(projectIdentity, id) ??
    defaultExpansion.get(id) ??
    true;

  // Selection reveal behaves like an ordinary tree expansion for the rest of
  // this editor session. It is applied only when selection changes, so a user
  // can explicitly collapse the revealed branch without the current
  // selection immediately forcing it open again.
  const lastExpansion = lastSelectionExpansionRef.current;
  if (lastExpansion?.adapter !== adapter || lastExpansion.selection !== selectionSignature) {
    for (const id of selectedAncestorNodeIds(structure.index, selectedIds)) {
      // Only a REAL change counts. Re-asserting a fold that is already open is
      // what selecting an already-visible node does, and letting that bump the
      // generation would make the browse memo miss on every single click.
      //
      // "Already open" is the EFFECTIVE state, not just the session map's own
      // entry. Reading only the session map made every first selection of a
      // branch bump the generation — a node open by default or by the stored
      // preference has no session entry at all — so the memo below missed on
      // essentially every click and re-derived the whole browse view for a
      // fold that never moved.
      if (expandedById(id)) continue;
      sessionExpansionRef.current.set(id, true);
      expansionGenerationRef.current += 1;
    }
    // A selection the index cannot place yet has no ancestors to open — a
    // drop selects the element it made BEFORE the hierarchy's structure has
    // absorbed the remount, so the reveal above found nothing and, with the
    // signature recorded here, never tried again: the new tower sat selected
    // under a collapsed scene root (measured on the build-44 gate,
    // 2026-09-02). Record the reveal as done only once every selected id is
    // in the index; until then the next structure retries it.
    const everySelectedPlaced = [...selectedIds].every((id) =>
      structure.index.pathKeysByNodeId.has(id),
    );
    if (everySelectedPlaced) {
      lastSelectionExpansionRef.current = { adapter, selection: selectionSignature };
    }
  }

  const isExpanded = (row: HierarchyNodeRow): boolean => expandedById(row.node.id);

  // Cap browse-view children (D-C1) whenever a non-first-party/composite
  // session is active (an ingested/multi-world tree may be huge), OR while
  // playing (a live scene graph can also balloon) — matches the exact
  // capping policy the former SceneHierarchy (play-only) / IngestHierarchy
  // (always, unless searching) components each had on their own.
  const capEnabled = term.length === 0 && (hasAuthoringOverride() || store.playState !== 'stopped');
  const temporaryRevealed = mergeRevealCounts(
    revealedRef.current,
    capEnabled ? selectedRevealCounts(structure.index, selectedIds) : EMPTY_REVEAL_COUNTS,
  );
  // THE FOLD, PROJECTED ONTO THE TREE — its own slot, because deriving it
  // scans every structural row and a selection is not one of its inputs. It
  // used to sit inside the browse compute below, whose key carries the reveal
  // a selection opens, so a click that revealed a branch re-scanned all
  // 20 000 rows to rebuild a set that had not changed.
  const fold = rowCacheRef.current.collapsed(
    [structure, expansionGenerationRef.current, projectIdentity, scopeId],
    () => {
      const row = scopeId
        ? (structuralRows.find((r) => !r.more && r.node.id === scopeId) ?? null)
        : null;
      const paths = new Set(
        structuralRows
          .filter((r) => !r.more && r.hasChildren && !isExpanded(r))
          .map((r) => r.pathKey),
      );
      if (row) {
        paths.delete(row.pathKey);
        for (const path of ancestorPathKeys(row.pathKey)) paths.delete(path);
      }
      return { scopeRow: row, effectiveCollapsedPaths: paths };
    },
  );
  const { scopeRow, effectiveCollapsedPaths } = fold;
  const browse = rowCacheRef.current.browse(
    [
      structure,
      fold,
      term,
      capEnabled,
      // ONLY when capping is on. `flattenHierarchyRows` ignores `revealed`
      // entirely otherwise, and the selected row's child INDEX is in this
      // signature — so carrying it uncapped would move the key on every single
      // click for a value the walk never reads, which is the cache paying its
      // cost and buying nothing.
      capEnabled ? revealSignature(temporaryRevealed) : '',
    ],
    () => {
      const browseRows = flattenHierarchyRows(
        hierarchyView,
        effectiveCollapsedPaths,
        temporaryRevealed,
        capEnabled,
      );
      const matchingPaths = term
        ? searchPathKeys(structuralRows, term, internals.isInternal)
        : null;
      const sourceRows = matchingPaths
        ? structuralRows.filter((row) => matchingPaths.has(row.pathKey))
        : browseRows;
      // Session-local world-hide (D9): drop every row belonging to a hidden world
      // group (the group row itself stays, dimmed by its own `visible` flag above).
      const scopedRows = scopeRow
        ? sourceRows
            .filter((row) => row.pathKey.startsWith(`${scopeRow.pathKey}.`))
            .map((row) => ({ ...row, depth: Math.max(0, row.depth - scopeRow.depth - 1) }))
        : sourceRows;
      const worldFiltered = scopedRows.filter((row) => {
        // the group row itself always shows
        if (isCompositeGroupNode(adapter, row.node.id)) return true;
        let current: string | null = row.node.parentId;
        while (current) {
          const badge = compositeGroupBadge(adapter, current);
          if (badge && isRootHidden(badge.worldId)) return false;
          current = hierarchyView.node(current)?.parentId ?? null;
        }
        return true;
      });
      return { rows: term ? worldFiltered : worldFiltered.filter((r) => !r.hiddenByCollapse) };
    },
  );
  const { rows } = browse;
  // THE EXCLUDE COLUMN IS PRESENT WHEN ANY ROW ANSWERS IT (owner ruling,
  // 2026-09-19: a restriction column follows what the adapter ANSWERS, never a
  // chrome knob). Resolved ONCE per panel render and handed down as an ordinary
  // prop, the way the chrome-region marks above are: asking per row would make
  // the column appear and disappear down the tree, which is the opposite of
  // what a column is. Almost every adapter answers `undefined` for every row
  // and the whole pass is one `undefined` per visible row; `@volter/editor-blender`'s
  // Outliner answers it for its layer-collection rows.
  const excludeColumnShown = useMemo(
    () => rows.some((row) => !row.more && adapter.inspector?.get(row.node.id, 'exclude') !== undefined),
    [rows, adapter, adapterVersion, deferredContentVersion],
  );

  // A filtered-down result set shouldn't leave the viewport
  // parked at a stale deep scroll offset from a previous (larger) list.
  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [term]);

  // Render only the windowed slice of `rows` — everything
  // above (cap/collapse/search/world-hide filtering) is unchanged; only the
  // final `.map()` further down is restricted. The drag/reorder + tailDrop
  // math below index/position against the FULL `rows` array (and read
  // `containerRef.current.scrollTop` directly), so windowing this slice
  // alone doesn't disturb them.
  const viewportPx = containerRef.current?.clientHeight || DEFAULT_VIEWPORT_PX;
  const rowHeight = treeRowHeight(containerRef.current);
  // Below the threshold, render every row (no window) — see VIRTUALIZE_MIN_ROWS.
  const { start, end } =
    rows.length > VIRTUALIZE_MIN_ROWS
      ? hierarchyRowWindow(rows.length, scrollTop, viewportPx, rowHeight, OVERSCAN)
      : { start: 0, end: rows.length };
  const windowRows = rows.slice(start, end);
  const topSpacerPx = start * rowHeight;
  const bottomSpacerPx = (rows.length - end) * rowHeight;

  const setAllExpanded = useCallback(
    (expanded: boolean) => {
      const updates = structuralRows
        .filter((row) => row.hasChildren)
        .map((row) => [row.node.id, expanded] as const);
      for (const [id, value] of updates) sessionExpansionRef.current.set(id, value);
      setHierarchyExpansionPreferences(projectIdentity, updates);
      expansionGenerationRef.current += 1;
      forceUpdate();
    },
    [projectIdentity, structuralRows],
  );

  // `editor.hierarchy()`'s door (`hierarchy-panel-view.ts`). This hands over the
  // rows and predicates computed ABOVE, by reference — the door serializes the
  // panel's own output rather than re-walking the adapter, because a second row
  // pipeline is free to disagree with this one and a door that can disagree with
  // the panel cannot diagnose it (see that module's header). Published from an
  // effect, so what the door reports has been committed to the DOM.
  const panelSnapshot: HierarchyPanelSnapshot = {
    rows,
    window: { start, end },
    searchTerm: term ? term : null,
    scopeId,
    isExpanded,
    isInternal: (id) => internals.isInternal(id),
    isComponentRoot: (id) => marked.isComponentRoot(id),
    foldedInternalCount: (id) => marked.internalChildren?.(id)?.length ?? 0,
    expandAll: () => setAllExpanded(true),
    collapseAll: () => setAllExpanded(false),
  };
  useEffect(() => {
    publishHierarchyPanelSnapshot(panelSnapshot);
    return () => clearHierarchyPanelSnapshot(panelSnapshot);
  }, [panelSnapshot]);

  // Row event functions must stay stable across a live structural delta or
  // React.memo has to revisit every visible survivor merely to receive a new
  // closure. The callbacks read the latest committed panel inputs through the
  // same render-ref pattern used by the editor's other long-lived handlers.
  const rowInteractionRef = useRef({
    adapter,
    rows,
    selectedIds,
    structuralRows,
    isExpanded,
    projectIdentity,
  });
  rowInteractionRef.current = {
    adapter,
    rows,
    selectedIds,
    structuralRows,
    isExpanded,
    projectIdentity,
  };

  const toggleOpen = useCallback((row: HierarchyNodeRow, recursive: boolean) => {
    const current = rowInteractionRef.current;
    const expanded = !current.isExpanded(row);
    const updates: Array<readonly [string, boolean]> = [[row.node.id, expanded]];
    if (recursive) {
      const prefix = `${row.pathKey}.`;
      for (const descendant of current.structuralRows) {
        if (descendant.hasChildren && descendant.pathKey.startsWith(prefix)) {
          updates.push([descendant.node.id, expanded]);
        }
      }
    }
    for (const [id, value] of updates) sessionExpansionRef.current.set(id, value);
    setHierarchyExpansionPreferences(current.projectIdentity, updates);
    expansionGenerationRef.current += 1;
    forceUpdate();
  }, []);

  const resetExpansion = useCallback(() => {
    sessionExpansionRef.current.clear();
    for (const id of selectedAncestorNodeIds(structure.index, selectedIds)) {
      sessionExpansionRef.current.set(id, true);
    }
    clearHierarchyExpansionPreferences(projectIdentity);
    expansionGenerationRef.current += 1;
    forceUpdate();
  }, [projectIdentity, selectionSignature, structure]);

  const revealMore = useCallback((parentPathKey: string) => {
    const m = revealedRef.current;
    m.set(parentPathKey, (m.get(parentPathKey) ?? CHILD_CAP) + CHILD_CAP);
    expansionGenerationRef.current += 1;
    forceUpdate();
  }, []);

  // H3 — double-click ENTERS the instance: its scope when it has one, its
  // callsite when it does not (see `enterInstanceRow` for why Isolate, the
  // design record's stated target, is not reachable from a scene instance row).
  const handleEnterScope = useCallback(
    (id: string) => {
      enterInstanceRow(adapter, id);
    },
    [adapter, store],
  );

  // Viewport picks and external editor-control selection reveal the selected
  // row, including through a previously collapsed path and a virtualized
  // list. Do this only when the selection or adapter changes; ordinary store
  // notifications must not fight a user's manual scroll position.
  useEffect(() => {
    if (!selectionSignature) {
      lastAutoRevealRef.current = null;
      return;
    }
    const last = lastAutoRevealRef.current;
    if (last?.adapter === adapter && last.selection === selectionSignature) return;
    lastAutoRevealRef.current = { adapter, selection: selectionSignature };
    const index = rows.findIndex((row) => selectedIds.has(row.node.id));
    const container = containerRef.current;
    if (index < 0 || !container) return;
    const height = treeRowHeight(container);
    const top = index * height;
    const bottom = top + height;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = Math.max(0, bottom - container.clientHeight);
    }
    setScrollTop(container.scrollTop);
  }, [adapter, rows, selectedIds, selectionSignature]);

  const handleRowClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    const current = rowInteractionRef.current;
    if (!current.adapter.selection) return;
    if (e.metaKey || e.ctrlKey) {
      const ids = new Set(current.selectedIds);
      if (ids.has(nodeId)) ids.delete(nodeId);
      else ids.add(nodeId);
      setAuthoringSelection(current.adapter, [...ids]);
    } else if (e.shiftKey && lastClickedRef.current) {
      const lastIdx = current.rows.findIndex((r) => r.node.id === lastClickedRef.current);
      const curIdx = current.rows.findIndex((r) => r.node.id === nodeId);
      if (lastIdx >= 0 && curIdx >= 0) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        const rangeIds = current.rows
          .slice(start, end + 1)
          .filter((r) => !r.more)
          .map((r) => r.node.id);
        setAuthoringSelection(current.adapter, rangeIds);
      }
    } else {
      setAuthoringSelection(current.adapter, [nodeId]);
    }
    lastClickedRef.current = nodeId;
  }, []);

  const handleRowDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    const selectedIds = rowInteractionRef.current.selectedIds;
    const ids = selectedIds.has(nodeId) ? [...selectedIds] : [nodeId];
    setDraggedIds(ids);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(REORDER_MIME, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', nodeId);
  }, []);
  const handleRowContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: id });
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      const isInternal = e.dataTransfer.types.includes(REORDER_MIME);
      const isAsset = e.dataTransfer.types.includes(ASSET_MIME);
      if (!isInternal && !isAsset) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';

      // A refusal computed here is REPORTED at drop time (see `handleDrop`), not
      // on every dragover frame: a hint that re-fires 60×/s is noise, and the
      // question the author is asking ("why did nothing happen?") is asked by
      // letting go. Cleared first so a drag that moves off a refusing row keeps
      // no stale sentence.
      dropRefusalRef.current = null;

      const rect = containerRef.current!.getBoundingClientRect();
      const scrollTop = containerRef.current!.scrollTop;
      const y = e.clientY - rect.top + scrollTop;
      const rowHeight = treeRowHeight(containerRef.current);
      const rowIndex = Math.floor(y / rowHeight);

      if (rowIndex >= rows.length) {
        setDropTarget(null);
        setTailDrop(true);
        if (isInternal && draggedIds) {
          dropRefusalRef.current = hierarchyDropRefusal({
            hasStructureWritePath: hasStructureWritePathFor(adapter, draggedIds[0]),
            targetIsInternal: false,
          });
        }
        return;
      }
      setTailDrop(false);

      // ABOVE the first row is not a row. `y` is pointer-minus-container-top
      // plus scroll, so it goes NEGATIVE whenever a drag drifts over the
      // panel's own chrome — dragging a prefab up out of the asset browser
      // does it — and `Math.floor` of a negative is a negative index that the
      // tail guard above cannot catch. `rows[-1]` is undefined, and the read
      // below threw "Cannot read properties of undefined (reading 'more')"
      // straight out of a dragover handler (runhuman pass 105). Not a row
      // means no drop target, the same answer a `more` row gets.
      const row = rowIndex >= 0 ? rows[rowIndex] : undefined;
      if (!row || row.more) {
        setDropTarget(null);
        return;
      }
      // H6 — a revealed internal is not a drop TARGET either. It cannot be
      // dragged (`rowAffordances.draggable`), and reparenting/asset-dropping
      // INTO it would ask the adapter to write source for an object that has
      // none. HIER-COMPONENT-TREE adds the other half: the refusal now carries
      // the sentence that says so, because a drag that silently does nothing is
      // indistinguishable from a broken editor.
      const refusal = hierarchyDropRefusal({
        // A REORDER drag needs the owning adapter's `structure` provider; an
        // ASSET drop goes through `assetDrop` instead, so a missing structure
        // provider is not what stands in ITS way and must not be named as if it
        // were. Both are refused by an internal target, for the same reason.
        hasStructureWritePath: isInternal ? hasStructureWritePathFor(adapter, row.node.id) : true,
        targetIsInternal: internals.isInternal(row.node.id),
      });
      if (refusal !== null) {
        dropRefusalRef.current = refusal;
        setDropTarget(null);
        return;
      }
      const rowY = y - rowIndex * rowHeight;
      let zone: DropZone;
      if (rowY < rowHeight * 0.25) zone = 'before';
      else if (rowY > rowHeight * 0.75) zone = 'after';
      else zone = 'child';

      if (isInternal && draggedIds) {
        const targetId = row.node.id;
        if (draggedIds.includes(targetId)) return;
        if (isDescendantOfAny(targetId, draggedIds, adapter)) return;
        if (!isSameRootDrop(adapter, draggedIds, targetId)) {
          setDropTarget(null);
          return;
        }
      }
      if (isCompositeGroupNode(adapter, row.node.id) && zone !== 'child') {
        // A composite world-group row has no siblings of its own kind to
        // reorder against — only "drop into this world" makes sense.
        zone = 'child';
      }
      if (row.node.role === 'document' || row.node.role === 'story') zone = 'child';
      if (row.node.role === 'folder' || row.node.role === 'boundary') {
        setDropTarget(null);
        return;
      }

      setDropTarget({ nodeId: row.node.id, zone });
    },
    [rows, draggedIds, adapter, internals],
  );

  const handleDragEnd = useCallback(() => {
    setDropTarget(null);
    setTailDrop(false);
    setDraggedIds(null);
    dropRefusalRef.current = null;
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const currentDropTarget = dropTarget;
      const isTail = tailDrop;
      const refusal = dropRefusalRef.current;
      setDropTarget(null);
      setTailDrop(false);
      setDraggedIds(null);
      dropRefusalRef.current = null;

      // NO DEAD DRAGS. Where the hover already decided this drop cannot land,
      // say so through the editor's own inline notice rather than returning in
      // silence (which is what made reparenting look broken on a translated
      // port). Never a blocking dialog — repo rule.
      if (refusal !== null) {
        showTransientHint(refusal);
        return;
      }

      const structure = adapter.structure;

      // Internal reorder/reparent.
      const reorderData = e.dataTransfer.getData(REORDER_MIME);
      if (reorderData && structure) {
        const ids = JSON.parse(reorderData) as string[];
        if (isTail) {
          for (const id of ids) reparentAuthoringNode(adapter, id, null);
          return;
        }
        if (!currentDropTarget) return;
        const targetRow = rows.find((r) => r.node.id === currentDropTarget.nodeId);
        if (!targetRow) return;
        const targetId = targetRow.node.id;
        if (currentDropTarget.zone === 'child') {
          for (const id of ids) reparentAuthoringNode(adapter, id, targetId);
          return;
        }
        const targetParentId = targetRow.node.parentId;
        const siblings = siblingIdsOf(adapter, targetParentId).filter((id) => !ids.includes(id));
        const idx = siblings.indexOf(targetId);
        const beforeSiblingId =
          currentDropTarget.zone === 'before'
            ? targetId
            : idx >= 0
              ? (siblings[idx + 1] ?? null)
              : null;
        for (const id of ids) {
          const currentParentId = adapter.hierarchy.node(id)?.parentId ?? null;
          if (currentParentId !== targetParentId)
            reparentAuthoringNode(adapter, id, targetParentId ?? null);
          reorderAuthoringNode(adapter, id, beforeSiblingId);
        }
        return;
      }

      // External asset drop.
      const assetData = e.dataTransfer.getData(ASSET_MIME);
      if (assetData && adapter.assetDrop) {
        try {
          const data = JSON.parse(assetData) as {
            path: string;
            kind: string;
            name?: string;
            component?: import('@volter/editor-project/adapter').AssetDropContext['item'];
          };
          if (data.kind === 'scene') return; // scene-file drop: A4/deferred, not this shell's job
          const context = {
            item: data.component ?? {
              kind: 'file' as const,
              name: data.name ?? data.path.split('/').pop() ?? data.path,
            },
          };
          if (isTail) {
            if (adapter.assetDrop.accepts('', data.path, context))
              void dropAuthoringAsset(adapter, '', data.path, context);
            return;
          }
          if (!currentDropTarget) return;
          const targetRow = rows.find((r) => r.node.id === currentDropTarget.nodeId);
          if (!targetRow) return;
          const targetId = targetRow.node.id;
          if (adapter.assetDrop.accepts(targetId, data.path, context))
            void dropAuthoringAsset(adapter, targetId, data.path, context);
        } catch {
          /* ignore malformed drag payload */
        }
      }
    },
    [dropTarget, tailDrop, rows, adapter],
  );

  const panelName = authoringDestination(adapter) ?? 'Untitled';

  return (
    <Panel
      // THE OUTLINER HEADER IS ONE ROW, and that row is the dock group's tab
      // strip (Content · Hierarchy · Library — structurally Blender's
      // editor-type selector). The breadcrumb this panel used to head itself
      // with — the destination path and the seam badge — is a fact about the
      // datablock, not about the tree, and now rides the Inspector's identity
      // row (`inspection/model.ts`'s `InspectionDocumentLine`), which is
      // exactly where Blender's Properties editor carries it.
      name={null}
      hideHeader
      onPointerDown={() => setActiveScope('hierarchy')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(ASSET_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      // The host owns the view's resizable/collapsible persisted width; this
      // panel fills whatever its current one gives it.
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        borderRight: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      {/* The panel no longer PRINTS its destination (it is the Inspector's
          datablock line now), but the name stays readable as data: the dock
          tab says "Hierarchy", and which document that tree is of is the one
          fact a control command still has to be able to ask for. */}
      <span data-testid="scene-name" data-scene={panelName} style={{ display: 'none' }}>
        {panelName}
      </span>
      <HierarchyControls
        slot={headerSlot}
        search={search}
        setSearch={setSearch}
        adapter={adapter}
        createTargetId={createTargetId}
        onCollapseAll={() => setAllExpanded(false)}
        onResetExpansion={resetExpansion}
        onExpandAll={() => setAllExpanded(true)}
      />

      {scopeId && (
        <nav
          data-testid="selection-scope-breadcrumb"
          aria-label="Selection scope"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            minHeight: 26,
            padding: `0 ${space[2]}px`,
            borderBottom: `1px solid ${themeVars.boundary.default}`,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <Button
            variant="ghost"
            size="compact"
            data-testid="selection-scope-root"
            onClick={() => setSelectionScope(adapter, null)}
          >
            Game
          </Button>
          {scopeStack.map((id, index) => {
            const node = adapter.hierarchy.node(id);
            if (!node) return null;
            const current = index === scopeStack.length - 1;
            return (
              <span key={id} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <span aria-hidden="true" style={{ color: themeVars.content.muted }}>
                  /
                </span>
                <Button
                  variant="ghost"
                  size="compact"
                  data-testid="selection-scope-crumb"
                  data-scope-current={current ? 'true' : undefined}
                  aria-current={current ? 'location' : undefined}
                  onClick={() => setSelectionScope(adapter, id)}
                  style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {node.label}
                </Button>
              </span>
            );
          })}
        </nav>
      )}

      <div
        ref={containerRef}
        data-testid="ingest-hierarchy"
        // §2.31 P2 amendment: the tree is a text-dense zone — local frost
        // layer keeps rows legible over open glass (inert elsewhere).
        // `vgai-tree-body` carries the ZEBRA — Blender stripes the whole body
        // including the empty rows past the last item, and the rule lives on
        // the scrolling element so its phase is the content's (see theme.css).
        // It paints only under `data-vgai-region="outliner"` (see
        // `outlinerRegion` above), so a look that paints no editor areas gets
        // an inert element rather than another look's stripe.
        className="vgai-content-frost vgai-tree-body"
        data-vgai-region={outlinerRegion}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          position: 'relative',
          pointerEvents: 'auto',
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onDragLeave={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setDropTarget(null);
            setTailDrop(false);
          }
        }}
      >
        <div data-testid="game-hierarchy-spacer-top" style={{ height: topSpacerPx }} />
        {windowRows.map((row, windowIndex) =>
          row.more ? (
            <MoreRow key={hierarchyRowKey(row)} row={row} onReveal={revealMore} />
          ) : (
            <Row
              key={hierarchyRowKey(row)}
              row={row}
              // THE STRIPE'S PHASE IS THE ROW'S ABSOLUTE INDEX, never its DOM
              // position. `.vgai-tree-row:nth-child(even)` counted siblings,
              // and this list's first sibling is the virtualization SPACER —
              // so row 0 always painted the alternate fill (Blender's row 0 is
              // the base one, `outliner.png`: Scene Collection #272727, then
              // Collection #2a2a2a), and the whole stripe flipped whenever the
              // scroll window started on an odd row.
              rowIndex={start + windowIndex}
              // The indent guides' only non-local inputs. Read off the FULL
              // list, not the window, so the rule crosses the window's own
              // edges exactly as it crosses any other row boundary.
              prevDepth={rows[start + windowIndex - 1]?.depth ?? -1}
              nextDepth={rows[start + windowIndex + 1]?.depth ?? -1}
              adapter={adapter}
              store={store}
              isSelected={selectedIds.has(row.node.id)}
              isSelectionActive={selectionAnchorId === row.node.id}
              isEditing={editingId === row.node.id}
              isCollapsed={term ? false : effectiveCollapsedPaths.has(row.pathKey)}
              dropZone={dropTarget && dropTarget.nodeId === row.node.id ? dropTarget.zone : null}
              isDragged={draggedIds?.includes(row.node.id) ?? false}
              isInternal={internals.isInternal(row.node.id)}
              threeRootId={threeViewportRootId}
              searchTerm={term}
              lockCache={lockCacheRef.current}
              warningCache={warningCacheRef.current}
              editabilityVersion={editabilityVersion}
              adapterVersion={adapterVersion}
              onToggleOpen={toggleOpen}
              onStartEditing={setEditingId}
              onContextMenu={handleRowContextMenu}
              onDragStart={handleRowDragStart}
              onClick={handleRowClick}
              onEnterScope={handleEnterScope}
              typeSuffixShown={typeSuffixShown}
              instanceRuleShown={instanceRuleShown}
              restrictionColumns={restrictionColumns}
              excludeColumnShown={excludeColumnShown}
              remoteSelectionColors={
                remoteSelectionColors.get(row.node.id) ?? EMPTY_REMOTE_SELECTION_COLORS
              }
            />
          ),
        )}
        <div data-testid="game-hierarchy-spacer-bottom" style={{ height: bottomSpacerPx }} />
        <div style={{ minHeight: 40 }} />
        {tailDrop && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: rows.length * rowHeight,
              height: 2,
              background: themeVars.accent.default,
              pointerEvents: 'none',
              zIndex: zIndex.overlayLow,
            }}
          />
        )}
      </div>

      {contextMenu &&
        (() => {
          const menuNode = hierarchyView.node(contextMenu.nodeId);
          // A composite group row owns no name/visible/locked path and no
          // meaningful Create/Duplicate/Delete target.
          const isGroupNode = menuNode
            ? isCompositeGroupNode(adapter, menuNode.id) ||
              isCompositeOrganizationNode(adapter, menuNode.id)
            : false;
          return (
            <ContextMenu
              state={contextMenu}
              adapter={adapter}
              store={store}
              isGroupNode={isGroupNode}
              isInternal={internals.isInternal(contextMenu.nodeId)}
              onRename={setEditingId}
              onClose={() => setContextMenu(null)}
            />
          );
        })()}
    </Panel>
  );
}

/** Every authorable center document uses the same adapter-backed hierarchy. */
export function GameHierarchy() {
  const store = useEditorStore();
  const [, refreshBinding] = useReducer((value: number) => value + 1, 0);
  useSyncExternalStore(subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion);
  // A1: the override slot is module state — subscribe to it, or this panel
  // keeps rendering the adapter it resolved BEFORE an ingest session installed
  // its own (`authoring/active-adapter.ts`'s notification comment).
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion);
  // A medium's row answers (detail, marks, change log) arrive when its integration installs.
  useSyncExternalStore(subscribeHierarchyRowMedia, hierarchyRowMedia);
  // Shares ONE resolver with the Inspector — the two panels disagreeing about
  // the active adapter is the bug (`authoring/panel-authoring.ts`).
  const { adapter } = resolvePanelAuthoring(store);
  // A composite can replace its focused Boundary child with a live R3F child
  // in place while retaining both the composite and active-override identity.
  // The surface's subscription can invalidate rows, but it cannot replace its
  // own adapter prop. Re-resolve the document binding at this outer boundary
  // whenever the resolved adapter reports structural change.
  useEffect(() => adapter.subscribe?.(refreshBinding), [adapter]);
  return (
    <GameHierarchySurface key={authoringAdapterKey(adapter)} store={store} adapter={adapter} />
  );
}
