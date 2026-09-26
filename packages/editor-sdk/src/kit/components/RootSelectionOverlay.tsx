/**
 * RootSelectionOverlay — spec 27 §3 A3, MIGRATE target of
 * `ui-editor/overlay.tsx`'s `SelectionOverlay` (§9's consolidation table),
 * generalized off that file's editor-store-and-stage-ref coupling onto the
 * format-neutral authoring contract so it works over ANY DOM-capable world
 * (react `data-oid`, ingested `react-dom`), not just the scene-UI silo.
 *
 * MOUNT SITE / COORDINATES (critical): DOM worlds render this component as a
 * child of their world document's host — the EXACT SAME DOM element
 * `design-time-layers.ts` appends that world's `position:absolute; inset:0`
 * layer into. The native Three scene retains a separate instance inside the
 * STAGE HOST's own container (`StageHost.tsx`, beside its canvas, mounted by
 * `stage-overlay-set.tsx`). This component's own outer wrapper is
 * ALSO `position:absolute; inset:0` inside that SAME parent, so its
 * `getBoundingClientRect()` is IDENTICAL to every world layer's — a
 * HOST-RELATIVE rect from `RectProvider.rect(id)` (host = the owning
 * adapter's own `this.root`, which IS one of those layer divs) lands on this
 * overlay's local coordinate space with ZERO correction. Deliberately NOT
 * wired one level up in `DefaultEditorLayout.tsx` (a sibling of the stage
 * there sits in a DIFFERENT, merely same-SIZED parent — co-location would be
 * incidental, not structural); mounting inside the stage's own container
 * makes the co-location a DOM fact, not a CSS coincidence.
 *
 * `PickProvider.pick` (unlike `RectProvider.rect`) takes CLIENT (viewport) px
 * per its own contract doc comment — pointer handlers below pass
 * `e.clientX`/`e.clientY` straight through, no conversion.
 *
 * Driven ONLY by the authoring contract (`getActiveAuthoring(store)` +
 * `store.selectedEntityIds` + `pickTopmost` + `CompositeAuthoringAdapter
 * .childAdapters()/ownerOf()`) — rule zero (spec §0): this file talks to no
 * concrete document/rendering library and no other editor silo's store or
 * DOM ref directly; hit-testing goes through the contract's own pick
 * provider, never a raw point-under-cursor DOM query.
 *
 * Scope: A3's hover highlight, selection box + `name·kind` label, and marquee
 * are unchanged below. Also in this same file: 8 resize handles + a
 * rotate handle + a dimension label (B2), drag-to-move for
 * absolutely/fixed-positioned nodes (B2), and padding/margin spacing bands
 * (B3) — all gated on EXACTLY one node selected whose OWNER exposes `boxEdit`
 * (see `world-overlay-gestures.ts`'s `boxEditForId`; multi-select keeps only
 * the plain A3 boxes, no handles). The gesture PATCH MATH itself lives in the
 * sibling `world-overlay-gestures.ts` module (pure, unit-tested); this file
 * owns only the impure orchestration — reading the live rect/spacing values,
 * driving the `begin`/`apply`/`end` bracket, and rendering.
 *
 * Phase D2 (§6) adds, also in this file: a drag-ghost (a semi-transparent
 * follow-cursor copy of the dragged element, live during a B2 move gesture OR
 * a D2.b reorder drag) and the reorder clone-preview itself — dragging an
 * already-selected FLOW/LIST child (no `boxEdit` move applies to it; it's
 * neither absolute nor fixed) among ≥3 total siblings live-previews the
 * insertion gap the drop would land in and commits ONE `structure.reorder(id,
 * beforeSiblingId)` call on drop (capability-gated on the owner exposing
 * `structure.reorder` — absent for the ingested react-dom adapter, so no
 * preview/commit there; the drag-ghost is visual-only and may still show).
 * The gap math (`computeReorderGap`) and ghost math (`computeDragGhost`) are
 * pure, in `world-overlay-gestures.ts`, same split as B2/B3.
 */

import { Menu, MenuItem, ThemeRootPortal, themeVars, zIndex } from '@volter/editor-sdk/widgets';
import type {
  AssetDropContext,
  AuthoringAdapter,
  BoxEditProvider,
  BoxEditReferencePoint,
  DOMRectLike,
  FrameCorners,
  SpatialDragHandle,
  SpatialHandlesProvider,
} from '@volter/editor-project/adapter';
import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { collectAllNodeIds, getActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import {
  canvasSceneGuideRevision,
  canvasSceneGuides,
  subscribeCanvasSceneGuides,
} from '@volter/editor-sdk/kit/authoring/canvas-scene-guides';
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import {
  dropAuthoringAsset,
  reorderAuthoringNode,
  setAuthoringSelection,
} from '@volter/editor-sdk/kit/authoring/consumer-actions';
import {
  isEyedropperSessionActive,
  resolveEyedropperSession,
  subscribeEyedropperSession,
} from '@volter/editor-sdk/kit/eyedropper-session';
import { pickCandidates, pickTopmost } from '@volter/editor-sdk/kit/authoring/layered-pick';
import {
  selectReactStoryFrameAtPoint,
  zoomReactStoryFrameAtPoint,
} from '@volter/editor-sdk/kit/authoring/react-story-board';
import { viewportEditorControls } from '@volter/editor-sdk/kit/viewport-editor-controls';
import {
  panTransformValue,
  type RootViewController,
  sharedRootViewController,
} from '@volter/editor-sdk/kit/world-pan-state';
import { isRootHidden } from '@volter/editor-sdk/kit/authoring/world-session-state';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { anyLiveSessionMounted } from '@volter/editor-sdk/kit/live-session-registry';
import { effectiveColorFromChain } from '@volter/editor-sdk/kit/ui-source/inspect';
import { AlignToolbar } from './AlignToolbar';
import { transformDimensionsFor } from '@volter/editor-sdk/kit/components/inspector-transform-subject';
import { RootTextEditor } from './RootTextEditor';
import {
  type AlignEntry,
  boxEditForId,
  colorSampleForId,
  computeDragGhost,
  computeMeasureLines,
  computeMovePatch,
  computeMoveSnapGuides,
  computeNativeMoveSnap,
  computePointSnap,
  computeReorderGap,
  computeResizePatch,
  frameAngle,
  frameForId,
  frameHandlePosition,
  frameIsTurned,
  frameResizePatch,
  proportionalResize,
  computeResizeSnapGuides,
  computeRotatePatch,
  computeSpacingBands,
  computeSpacingPatch,
  contextRectsForId,
  EDGE_SNAP_THRESHOLD_PX,
  emptyContainerHintsFor,
  type HandlePos,
  handlePosition,
  type MeasureLine,
  type PositionBadgeInfo,
  RESIZE_HANDLES,
  type ReorderGap,
  readSpacingValues,
  // D4 — moved here from a local definition in THIS file (was `export
  // function rectForId`): `editor-hotkeys.ts`'s D4.c arrow-nudge action
  // needed it too, and importing it off THIS component file pulled the
  // whole `RootSelectionOverlay`/postprocessing-viewport dependency graph
  // into `editor-hotkeys.ts` (breaks a headless/vitest unit test of the
  // hotkey actions, which has no business mounting a viewport). Re-exported
  // below for the existing import site.
  rectForId,
  resolvePositionBadge,
  type SiblingRectEntry,
  type SnapGuide,
  type SpacingBand,
  type SpacingSide,
  siblingIdsForId,
  spatialHandlesForId,
  structureForId,
  textForId,
} from './world-overlay-gestures';

export { rectForId } from './world-overlay-gestures';

// Canvas selection is an editor action state, so it follows the selected
// palette's semantic accent just like toolbars and drop overlays. Material
// changes never inject a hue of their own.
const ACCENT = themeVars.accent.default;
/** Strictly below `ToolStrip`+`ViewportOverlay`'s z1000 — mirrors
 *  `design-time-layers.ts`'s own `BASE_Z_INDEX` doc comment ("so canvas-local
 *  editing chrome is never occluded") — and strictly
 *  above the design-time layers themselves (`BASE_Z_INDEX + i`, small N),
 *  so this overlay's boxes/marquee always paint over the world content they
 *  describe. V-12 — pure rename onto the canonical z-index scale
 *  (`zIndex.overlayLow`), same numeric value (50), no behavior change. */
const Z_INDEX = zIndex.overlayLow;
const DRAG_THRESHOLD_PX = 5;

type EditorControlCursor = 'pointer' | 'not-allowed' | null;

function activateViewportEditorControl(
  scopedAdapter: AuthoringAdapter | undefined,
  clientX: number,
  clientY: number,
): boolean {
  if (scopedAdapter) return false;
  return viewportEditorControls()?.activate(clientX, clientY) ?? false;
}

function updateViewportEditorControlHover(
  scopedAdapter: AuthoringAdapter | undefined,
  clientX: number,
  clientY: number,
  pickAt: (clientX: number, clientY: number) => string | null,
  setCursor: (cursor: EditorControlCursor) => void,
  setHoverId: (id: string | null) => void,
): void {
  const cursor = scopedAdapter
    ? null
    : (viewportEditorControls()?.hover(clientX, clientY) ?? null);
  setCursor(cursor);
  setHoverId(cursor ? null : pickAt(clientX, clientY));
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `name·kind` label for a node. `hierarchy.node` IS merged/routed on the
 *  composite (unlike `rects`/`pickable`), so no owner lookup is needed here. */
export function labelForId(adapter: AuthoringAdapter, id: string): string {
  const node = adapter.hierarchy.node(id);
  return node ? `${node.label}·${node.kind}` : id;
}

/**
 * True when `adapter` (or, for a composite, ANY of its children) exposes a
 * `RectProvider` — the DOM-overlay capability signal (the contract's own doc
 * comment on `AuthoringAdapter.rects`: "Absent ⇒ this adapter produces no
 * rects (no overlay)"). Gates whether `RootSelectionOverlay` renders
 * anything at all, so a pure-3D session (no react/pixi/DOM world in the
 * active composite) is completely unaffected — matches spec §3 A3's wiring
 * instruction ("gate on the active adapter exposing rects/pickable on any
 * child, so 3D-only sessions are unaffected").
 */
export function hasRectCapableChild(adapter: AuthoringAdapter): boolean {
  if (adapter instanceof CompositeAuthoringAdapter) {
    return adapter.childAdapters().some((c) => !!c.adapter.rects);
  }
  return !!adapter.rects;
}

/**
 * Every (id, rect) pair reachable from `adapter`'s own `rects` provider — or,
 * for a composite, from each VISIBLE child's own `rects` provider — the
 * marquee's candidate pool. Walks each CHILD's OWN hierarchy
 * (`collectAllNodeIds`), never the composite's synthetic `world:<id>`
 * wrapper, so a group/organization id is never a candidate. A session-hidden
 * world (`world-session-state.ts`'s eye toggle, B1) contributes no
 * candidates — consistent with it being invisible/unpickable.
 *
 * D4.R1 — a LOCKED node (`child.inspector.get(id, 'locked') === true`, the
 * same session-local `lockedIds` the layer-tree lock toggle writes) is also
 * excluded: a marquee that merely overlaps a locked node's rect must not
 * sweep it into the selection, matching the click-pick gate each override
 * adapter's own `pickable.pick` now applies (`ReactRootAuthoringAdapter`/
 * `DomAuthoringAdapter`/`UIAuthoringAdapter`). The first-party three
 * adapter has no `rects` provider, so it never reaches this function at all
 * — its own locked-skip lives entirely in `viewport-raycast.ts`.
 */
export function collectMarqueeCandidates(
  adapter: AuthoringAdapter,
): Array<{ id: string; rect: DOMRectLike }> {
  const children: ReadonlyArray<{ worldId: string; adapter: AuthoringAdapter }> =
    adapter instanceof CompositeAuthoringAdapter
      ? adapter.childAdapters()
      : [{ worldId: '', adapter }];
  const out: Array<{ id: string; rect: DOMRectLike }> = [];
  for (const { worldId, adapter: child } of children) {
    if (!child.rects) continue;
    if (worldId && isRootHidden(worldId)) continue;
    for (const id of collectAllNodeIds(child)) {
      if (child.inspector?.get(id, 'locked') === true) continue;
      const r = child.rects.rect(id);
      if (r) out.push({ id, rect: r });
    }
  }
  return out;
}

/** Axis-aligned overlap test (ANY overlap selects — not full containment;
 *  spec §3 A3: "select all nodes whose rect intersects"). */
export function rectsIntersect(a: Rect, b: DOMRectLike): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Pure selection-set math for a click (not drag) on a hit node — a plain
 *  click REPLACES the selection with just `hitId`; shift-click ADDS it if
 *  absent or TOGGLES it off if already selected. Factored out of the
 *  pointer-up handler so it's directly unit-testable (spec §3 A3's own
 *  testing note: "shift-click add/toggle vs replace"). */
export function resolveClickSelection(
  current: ReadonlySet<string>,
  hitId: string,
  shiftKey: boolean,
): string[] {
  if (!shiftKey) return [hitId];
  const next = new Set(current);
  if (next.has(hitId)) next.delete(hitId);
  else next.add(hitId);
  return [...next];
}

/**
 * Pure selection resolution for a gesture that STARTED on empty space (no
 * pick at pointerdown): a real marquee drag (past the drag threshold)
 * selects every candidate whose rect intersects the rubber-band — possibly
 * none, which clears; a plain click (no meaningful drag) clears the
 * selection, UNLESS shift is held, in which case it's a no-op (returns
 * `null` — "leave the selection untouched" — so an accidental shift-click on
 * empty space doesn't wipe out an existing multi-select).
 */
export function resolveEmptySpaceSelection(
  active: AuthoringAdapter,
  moved: boolean,
  marquee: Rect | null,
  shiftKey: boolean,
): string[] | null {
  const isRealDrag =
    moved && !!marquee && (marquee.width > DRAG_THRESHOLD_PX || marquee.height > DRAG_THRESHOLD_PX);
  if (isRealDrag && marquee) {
    const candidates = collectMarqueeCandidates(active);
    return candidates.filter((c) => rectsIntersect(marquee, c.rect)).map((c) => c.id);
  }
  return shiftKey ? null : [];
}

/** D4 (spec27 §8 "space-pan" row) — the `interactionRef` cursor for the
 *  current pan/eyedropper/marquee state, pure (a plain priority chain, no
 *  DOM/store reads) — factored out purely to keep the component's own
 *  cognitive complexity down, same reason `computeSingleSelectionBoxEdit`/
 *  `computeD1Affordances` above are factored out. */
function interactionCursor(
  isPanning: boolean,
  spaceHeld: boolean,
  eyedropperActive: boolean,
  hasMarquee: boolean,
): React.CSSProperties['cursor'] {
  if (isPanning) return 'grabbing';
  if (spaceHeld) return 'grab';
  if (eyedropperActive || hasMarquee) return 'crosshair';
  return 'default';
}

/** Pointer capture is unavailable for synthetic accessibility/test events and
 * can also be rejected when a browser has already cancelled the native
 * pointer. Gesture ownership still works while the pointer stays in bounds,
 * so capture is a best-effort enhancement rather than a reason to abort. */
function capturePointer(e: ReactPointerEvent<Element>): void {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId);
  } catch {
    // Continue without capture; pointerup/cancel still completes in bounds.
  }
}

/** Release an interaction pointer without adding another decision branch to
 * each already-dense gesture completion path. */
function releaseCapturedPointer(e: ReactPointerEvent<HTMLElement>): void {
  if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }
}

/** Resolve the board-level target that exists outside the active adapter's
 * deliberately single-story DOM projection. */
function selectInactiveStoryFrame(
  e: ReactPointerEvent<HTMLElement>,
  hitAtDown: string | null,
): boolean {
  if (hitAtDown !== null) return false;
  const overlayContainer = e.currentTarget.parentElement?.parentElement ?? null;
  return selectReactStoryFrameAtPoint(overlayContainer, e.clientX, e.clientY);
}

/** Whether the armed tool carries `part`'s handles. Without transform-mode
 *  awareness every part is armed; `combined` (Transform, all handles) arms all
 *  three, as it does on the 3D stage. */
function transformArms(
  aware: boolean,
  mode: string,
  part: 'translate' | 'rotate' | 'scale',
): boolean {
  // Godot's 2D Select mode is its handle mode: on a native 2D surface Select arms the box's
  // handles as the combined tool does.
  return !aware || mode === part || mode === 'combined' || mode === 'select';
}

function boxStyle(r: DOMRectLike, solid: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
    // Longhands, never the `border` shorthand: callers override `borderWidth`
    // per zoom, and React drops a shorthand's colour and style when a longhand
    // beside it changes (measured on a canvas Scene: the selection box kept a
    // 0.3 px width with an empty colour and style, so nothing was drawn).
    borderStyle: 'solid',
    borderColor: ACCENT,
    borderWidth: solid ? 2 : 1,
    background: solid ? `color-mix(in srgb, ${ACCENT} 6%, transparent)` : 'transparent',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

/** The rotate handle above the box's top edge, along the box's own up when it is turned. */
function turnedRotateHandlePosition(
  frame: FrameCorners | null,
  rect: DOMRectLike,
  offset: number,
): { left: number; top: number } {
  if (!frame) return { left: rect.x + rect.width / 2 - ROTATE_SIZE / 2, top: rect.y - offset - ROTATE_SIZE / 2 };
  const topX = (frame.tl.x + frame.tr.x) / 2;
  const topY = (frame.tl.y + frame.tr.y) / 2;
  const upX = frame.tl.x - frame.bl.x;
  const upY = frame.tl.y - frame.bl.y;
  const length = Math.hypot(upX, upY) || 1;
  return {
    left: topX + (upX / length) * offset - ROTATE_SIZE / 2,
    top: topY + (upY / length) * offset - ROTATE_SIZE / 2,
  };
}

/** A turned node's box: its own size, turned to its angle about its centre (Godot's 2D frame). */
function turnedBoxStyle(frame: FrameCorners, borderWidth: number): React.CSSProperties {
  const width = Math.hypot(frame.tr.x - frame.tl.x, frame.tr.y - frame.tl.y);
  const height = Math.hypot(frame.bl.x - frame.tl.x, frame.bl.y - frame.tl.y);
  const centerX = (frame.tl.x + frame.br.x) / 2;
  const centerY = (frame.tl.y + frame.br.y) / 2;
  return {
    position: 'absolute',
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    transform: `rotate(${frameAngle(frame)}rad)`,
    transformOrigin: 'center',
    borderStyle: 'solid',
    borderColor: ACCENT,
    borderWidth,
    background: 'transparent',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

function labelStyle(r: DOMRectLike): React.CSSProperties {
  return {
    position: 'absolute',
    left: r.x,
    top: Math.max(0, r.y - 18),
    padding: '2px 6px',
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
    fontWeight: 600,
    color: '#fff',
    background: ACCENT,
    borderRadius: 3,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  };
}

const HANDLE_SIZE = 10;
const NATIVE_GIZMO_LENGTH_PX = 48;

/** One of the 8 B2 resize handles — a small white/themeVars.accent.default square centered on
 *  its position on the selection rect (spec:317/§5 :465). */
function handleStyle(center: { x: number; y: number }, cursor: string): React.CSSProperties {
  return {
    position: 'absolute',
    left: center.x - HANDLE_SIZE / 2,
    top: center.y - HANDLE_SIZE / 2,
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: '#fff',
    border: `1px solid ${ACCENT}`,
    boxSizing: 'border-box',
    cursor,
    pointerEvents: 'auto',
  };
}

const ROTATE_SIZE = 12;
const ROTATE_OFFSET = 24;

/** The rotate handle — a small circle ~24px above top-center (spec:322/§5
 *  :465 "rotate"). */
function rotateHandleStyle(rect: DOMRectLike): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x + rect.width / 2 - ROTATE_SIZE / 2,
    top: rect.y - ROTATE_OFFSET - ROTATE_SIZE / 2,
    width: ROTATE_SIZE,
    height: ROTATE_SIZE,
    borderRadius: '50%',
    background: '#fff',
    border: `1px solid ${ACCENT}`,
    boxSizing: 'border-box',
    cursor: 'grab',
    padding: 0,
    pointerEvents: 'auto',
  };
}

const SPATIAL_HANDLE_SIZE = 12;

/** One adapter-owned spatial handle: a small ring in the COLOR THE ADAPTER
 *  CHOSE, centered on the point it reported. The shell picks none of that —
 *  it draws the contract's own data — and a non-writable handle is drawn
 *  hollow and inert rather than hidden, because "this exists and you cannot
 *  move it" is the honest state (its `reason` is the title). */
function spatialHandleStyle(handle: SpatialDragHandle): React.CSSProperties {
  return {
    position: 'absolute',
    left: handle.position[0],
    top: handle.position[1],
    width: SPATIAL_HANDLE_SIZE,
    height: SPATIAL_HANDLE_SIZE,
    borderRadius: '50%',
    background: handle.writable ? handle.color : 'transparent',
    border: `2px solid ${handle.color}`,
    boxSizing: 'border-box',
    cursor: handle.writable ? 'grab' : 'not-allowed',
    padding: 0,
    pointerEvents: handle.writable ? 'auto' : 'none',
    touchAction: 'none',
  };
}

function referencePointStyle(point: BoxEditReferencePoint): React.CSSProperties {
  return {
    position: 'absolute',
    left: point.x - 8,
    top: point.y - 8,
    width: 16,
    height: 16,
    display: 'grid',
    placeItems: 'center',
    borderRadius: point.kind === 'anchor' ? '50%' : 2,
    background: '#fff',
    border: `1px solid ${ACCENT}`,
    boxSizing: 'border-box',
    color: ACCENT,
    cursor: 'crosshair',
    fontSize: 9,
    fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
    fontWeight: 700,
    lineHeight: 1,
    padding: 0,
    pointerEvents: 'auto',
    touchAction: 'none',
  };
}

/** The B2 dimension label (spec:460 "dimension label") — `W×H`, centered
 *  below the selection box (reuses `labelStyle`'s look, different anchor). */
function dimensionLabelStyle(rect: DOMRectLike): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y + rect.height + 4,
    padding: '2px 6px',
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
    fontWeight: 600,
    color: '#fff',
    background: ACCENT,
    borderRadius: 3,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  };
}

// Deliberate literals (U6 census): the padding/margin band pair, their label
// inks, the measurement pinks (`#ff2d92`/`#ff5fa2`) and the snap-guide red
// (`#f24822`) below are the industry-convention CANVAS-GUIDE language (green
// padding / orange margin / pink measure / red snap — Figma & devtools
// grammar), each deliberately distinct from the semantic selection accent so
// guides never read as selection or chrome.
const PADDING_BAND_COLOR = 'rgba(46, 204, 113, 0.25)';
const MARGIN_BAND_COLOR = 'rgba(230, 126, 34, 0.25)';

/** One B3 padding/margin spacing band (spec:332-335/§5 :460/:465-466). */
function spacingBandStyle(band: SpacingBand): React.CSSProperties {
  return {
    position: 'absolute',
    left: band.x,
    top: band.y,
    width: band.width,
    height: band.height,
    background: band.kind === 'padding' ? PADDING_BAND_COLOR : MARGIN_BAND_COLOR,
    boxSizing: 'border-box',
    cursor: band.cursor,
    pointerEvents: 'auto',
  };
}

/** The B3 numeric label centered in a nonzero band — monospace ~10px,
 *  porting `ui-editor/overlay.tsx`'s dashed gap-measure label styling. */
function spacingLabelStyle(band: SpacingBand): React.CSSProperties {
  return {
    position: 'absolute',
    left: band.labelX,
    top: band.labelY,
    transform: 'translate(-50%, -50%)',
    fontSize: 10,
    fontFamily: 'monospace',
    color: band.kind === 'padding' ? '#1b7a3d' : '#a35a12',
    background: 'rgba(255,255,255,0.85)',
    padding: '0 2px',
    borderRadius: 2,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  };
}

/** D2.a — the drag-ghost: a semi-transparent, INERT copy of the dragged
 *  element at its ghost rect (spec:399). Deliberately dashed + low-opacity
 *  fill so it reads as a "preview copy", never confusable with the live
 *  selection box (`boxStyle`'s solid ACCENT border) it's drawn alongside. */
function dragGhostStyle(rect: Rect): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    border: `2px dashed ${ACCENT}`,
    background: `color-mix(in srgb, ${ACCENT} 15%, transparent)`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
    opacity: 0.7,
  };
}

/** D2.b — the live reorder-preview: a thin marker line at the gap the drop
 *  would land in (spec:398-400). Distinct color from the drag-ghost/ACCENT
 *  selection chrome so the two affordances (which render SIMULTANEOUSLY
 *  during a reorder drag) stay visually distinguishable. */
function reorderMarkerStyle(marker: Rect): React.CSSProperties {
  return {
    position: 'absolute',
    left: marker.x,
    top: marker.y,
    width: marker.width,
    height: marker.height,
    background: '#ff5fa2',
    borderRadius: 2,
    pointerEvents: 'none',
  };
}

// --- D1 — measurement + snap + alignment guides + badges (spec §6 D1)
//     ---------------------------------------------------------------------

const MEASURE_COLOR = '#ff2d92';
const MEASURE_CAP_PX = 6;

/** D1.a — the measure line itself: a 1px pink segment (figma "hold-and-
 *  measure" affordance, spec §6 "pink, end-caps, value labels"). */
function measureLineStyle(line: MeasureLine): React.CSSProperties {
  const horizontal = line.orientation === 'horizontal';
  return {
    position: 'absolute',
    left: Math.min(line.x1, line.x2),
    top: Math.min(line.y1, line.y2),
    width: horizontal ? Math.abs(line.x2 - line.x1) : 1,
    height: horizontal ? 1 : Math.abs(line.y2 - line.y1),
    background: MEASURE_COLOR,
    pointerEvents: 'none',
  };
}

/** D1.a — one of the measure line's two end-caps: a short perpendicular
 *  tick at `(x,y)`. */
function measureCapStyle(x: number, y: number, horizontal: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    left: horizontal ? x : x - MEASURE_CAP_PX / 2,
    top: horizontal ? y - MEASURE_CAP_PX / 2 : y,
    width: horizontal ? 1 : MEASURE_CAP_PX,
    height: horizontal ? MEASURE_CAP_PX : 1,
    background: MEASURE_COLOR,
    pointerEvents: 'none',
  };
}

/** D1.a — the measure line's px value label, centered on the line. */
function measureLabelStyle(line: MeasureLine): React.CSSProperties {
  return {
    position: 'absolute',
    left: line.labelX,
    top: line.labelY,
    transform: 'translate(-50%, -50%)',
    padding: '1px 4px',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: 600,
    color: '#fff',
    background: MEASURE_COLOR,
    borderRadius: 2,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  };
}

const SNAP_GUIDE_COLOR = '#f24822';

/** D1.b — one active alignment/snap guide, live only while the underlying
 *  gesture's own edge-snap is engaged (spec §6 "guides appear only within
 *  the snap threshold; disappear when not snapping"). Dashed so it reads as
 *  a transient alignment aid, distinct from the solid pink measure line. */
function snapGuideStyle(guide: SnapGuide): React.CSSProperties {
  const vertical = guide.orientation === 'vertical';
  return {
    position: 'absolute',
    left: vertical ? guide.at : guide.start,
    top: vertical ? guide.start : guide.at,
    width: vertical ? 1 : guide.end - guide.start,
    height: vertical ? guide.end - guide.start : 1,
    borderLeft: vertical ? `1px dashed ${SNAP_GUIDE_COLOR}` : undefined,
    borderTop: !vertical ? `1px dashed ${SNAP_GUIDE_COLOR}` : undefined,
    pointerEvents: 'none',
  };
}

/** D1.c — the position/parent-layout badge, anchored just above-left of the
 *  selection (mirrors `labelStyle`'s anchor, offset further up so it never
 *  overlaps the `name·kind` label A3 already renders there). */
function positionBadgeStyle(r: DOMRectLike): React.CSSProperties {
  return {
    position: 'absolute',
    left: r.x,
    top: Math.max(0, r.y - 36),
    display: 'flex',
    gap: 4,
    pointerEvents: 'none',
  };
}

const BADGE_SEGMENT_STYLE: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 10,
  fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
  fontWeight: 600,
  color: themeVars.content.onAccent,
  background: `color-mix(in srgb, ${ACCENT} 85%, transparent)`,
  borderRadius: 3,
  whiteSpace: 'nowrap',
};

/** D1.c — the parent-container outline: a subtle dashed stroke around
 *  `rect` (spec §6 "outline the parent container rect ... with a subtle
 *  stroke"). */
function parentOutlineStyle(r: DOMRectLike): React.CSSProperties {
  return {
    position: 'absolute',
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
    border: `1px dashed color-mix(in srgb, ${ACCENT} 45%, transparent)`,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

/**
 * A single active B2/B3 gesture — resize/move/rotate/spacing — bracketed by
 * `ownerBoxEdit.begin/end`. Kept SEPARATE from {@link DragState} (A3's click/
 * marquee tracking): a gesture and a click/marquee-drag are mutually
 * exclusive per pointer session and want independent lifecycles (spec §4 B2
 * step 4's own instruction).
 */
interface GestureState {
  kind: 'resize' | 'move' | 'native-scale' | 'reference' | 'rotate' | 'spacing';
  id: string;
  ownerBoxEdit: BoxEditProvider;
  /** Gesture start point, in the SAME coordinate frame as `origRect`/`center`
   *  (host-local) — see `computeRotatePatch`'s doc comment on frame
   *  consistency. Resize/move only need the DELTA (frame-invariant under a
   *  fixed additive offset), so they tolerate either frame; rotate does not,
   *  so this file always seeds it host-local for every kind, uniformly. */
  startLocal: { x: number; y: number };
  origRect: DOMRectLike;
  pos?: HandlePos;
  /** A turned node's box at the gesture's start, and its origin: a resize then works along the
   *  node's own axes (`frameResizePatch`). */
  frame?: FrameCorners;
  frameOrigin?: { x: number; y: number };
  isPositioned?: boolean;
  center?: { x: number; y: number };
  context?: ReturnType<typeof contextRectsForId>;
  side?: SpacingSide;
  origValue?: number;
  pointerId?: number;
  referencePoint?: BoxEditReferencePoint;
  /** Native 2D move gizmo constraint. Board drags omit it and move freely. */
  moveAxis?: 'x' | 'y' | 'both';
  /** Native display-object position in stage space. Unlike a visual bounds
   * center, this remains the actual rotate/scale origin for anchored sprites
   * and pivoted containers. */
  nativeOrigin?: { x: number; y: number };
  nativeScaleAxis?: 'x' | 'y' | 'both';
  nativeHandleSpan?: number;
  /** Other selected nodes moved by the same direct-manipulation gesture. */
  movePeers?: readonly MovePeer[];
}

interface MovePeer {
  readonly id: string;
  readonly ownerBoxEdit: BoxEditProvider;
  readonly origRect: DOMRectLike;
  readonly nativeOrigin?: { x: number; y: number };
}

function snapNativeTransform(value: number, enabled: boolean, step: number): number {
  return enabled && step > 0 ? Math.round(value / step) * step : value;
}

function nativeScalePatch(
  gesture: GestureState,
  dx: number,
  dy: number,
  snapEnabled: boolean,
  altKey: boolean,
  scaleStep: number,
): Record<string, number> {
  const span = gesture.nativeHandleSpan ?? 1;
  const axis = gesture.nativeScaleAxis ?? 'both';
  let scaleXFactor: number;
  let scaleYFactor: number;
  if (axis === 'x') {
    scaleXFactor = 1 + dx / span;
    scaleYFactor = 1;
  } else if (axis === 'y') {
    scaleXFactor = 1;
    scaleYFactor = 1 + dy / span;
  } else {
    // The uniform handle sits one `span` from the origin on a 45-degree
    // axis. Project the drag onto that axis so moving the handle one
    // handle-length doubles the scale, just like either axis handle.
    const factor = 1 + (dx + dy) / (Math.SQRT2 * span);
    scaleXFactor = factor;
    scaleYFactor = factor;
  }
  return {
    ...(axis !== 'y' ? { scaleXFactor } : {}),
    ...(axis !== 'x' ? { scaleYFactor } : {}),
    ...(snapEnabled && !altKey ? { scaleStep } : {}),
  };
}

function nativeMovePatch(
  gesture: GestureState,
  dx: number,
  dy: number,
  snapEnabled: boolean,
  altKey: boolean,
  translateStep: number,
): Record<string, number> {
  const origin = gesture.nativeOrigin;
  if (!origin) return {};
  const snap = snapEnabled && !altKey;
  return {
    ...(gesture.moveAxis !== 'y'
      ? { originX: snapNativeTransform(origin.x + dx, snap, translateStep) }
      : {}),
    ...(gesture.moveAxis !== 'x'
      ? { originY: snapNativeTransform(origin.y + dy, snap, translateStep) }
      : {}),
  };
}

function nativeScaleHandlePoint(
  axis: 'x' | 'y' | 'both',
  origin: { x: number; y: number },
  span: number,
): { x: number; y: number } {
  if (axis === 'x') return { x: origin.x + span, y: origin.y };
  if (axis === 'y') return { x: origin.x, y: origin.y + span };
  return { x: origin.x + span / Math.SQRT2, y: origin.y + span / Math.SQRT2 };
}

function constrainedMoveDelta(
  axis: GestureState['moveAxis'],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  if (axis === 'x') return { dx, dy: 0 };
  if (axis === 'y') return { dx: 0, dy };
  return { dx, dy };
}

/** D2 — promote a deferred move CANDIDATE (`DragState.moveCandidate`) into a
 *  live `move` gesture once the drag threshold is crossed: begins the
 *  gesture on the owner (one side effect) and constructs the `GestureState`,
 *  seeded from the pointer-DOWN point (`startLocal`) so the move delta stays
 *  continuous. Factored out of `onPointerMove` (module-level, not a nested
 *  closure) purely to keep that handler's own cognitive complexity down. */
function promoteMoveCandidate(
  candidate: NonNullable<DragState['moveCandidate']>,
  startLocal: { x: number; y: number },
): GestureState {
  candidate.ownerBoxEdit.begin(candidate.id);
  for (const peer of candidate.peers) peer.ownerBoxEdit.begin(peer.id);
  return {
    kind: 'move',
    id: candidate.id,
    ownerBoxEdit: candidate.ownerBoxEdit,
    startLocal,
    origRect: candidate.origRect,
    context: candidate.context,
    ...(candidate.nativeOrigin ? { nativeOrigin: candidate.nativeOrigin } : {}),
    movePeers: candidate.peers,
  };
}

interface DragState {
  readonly downClientX: number;
  readonly downClientY: number;
  readonly downLocal: { x: number; y: number };
  /** The pick result AT pointerdown — decides click-select vs. marquee. */
  readonly hitAtDown: string | null;
  moved: boolean;
  /**
   * D2 — a DEFERRED move-gesture candidate, recorded at pointerdown when the
   * press landed on an already-selected, absolutely/fixed-positioned,
   * boxEdit-capable node, but NOT promoted to a live gesture until the pointer
   * crosses the drag threshold (`onPointerMove`). A pointerup BEFORE the
   * threshold falls through to the ordinary click-select path — so a plain
   * click still narrows a multi-selection to the clicked node and a shift-click
   * still toggles it (the regression Fable found: the old code began the move
   * gesture at pointerdown unconditionally, and `endGesture()` on pointerup
   * skipped `resolveClickSelection`, swallowing every click on a positioned
   * node). `null` when the press was not a move candidate. */
  readonly moveCandidate: {
    id: string;
    ownerBoxEdit: BoxEditProvider;
    origRect: DOMRectLike;
    context?: ReturnType<typeof contextRectsForId>;
    nativeOrigin?: { x: number; y: number };
    peers: readonly MovePeer[];
  } | null;
  /**
   * D2.b (spec:397-401) — a DEFERRED reorder-preview candidate, recorded at
   * pointerdown under the SAME "already selected" gate {@link moveCandidate}
   * uses, but for the opposite geometry: a FLOW/LIST child (no `boxEdit`
   * move applies — {@link resolveMoveCandidate} already returned `null` for
   * it, since it's neither absolute nor fixed) whose owner exposes
   * `structure.reorder` and has ≥3 total siblings (itself + ≥2 others —
   * spec:398 "drag a child among ≥3 siblings"). Only ONE of
   * `moveCandidate`/`reorderCandidate` is ever non-null for a given press —
   * see `onPointerDown`'s own ordering (move is checked first; a positioned
   * node's owner may ALSO have `structure`, but this spec's move/reorder
   * split is by POSITIONING, not by capability overlap). `null` when the
   * press was not a reorder candidate. */
  readonly reorderCandidate: {
    id: string;
    adapter: AuthoringAdapter;
    origRect: DOMRectLike;
    siblingRects: SiblingRectEntry[];
  } | null;
}

/**
 * D2 (spec:322) — resolve a pointerdown hit into a deferred move-gesture
 * CANDIDATE (see `DragState.moveCandidate`'s doc comment for the full
 * rationale): only when `hitId` is already selected, its owner exposes
 * `boxEdit`, and it is absolutely/fixed-positioned or a native 2D transform
 * subject. Factored out of
 * `onPointerDown` (a module-level function, not a nested closure) purely to
 * keep that handler's own cognitive complexity down — pulls no state, reads
 * only its arguments.
 */
/**
 * Figma semantics for a press INSIDE a selection: the deepest pick still wins
 * for click-select (a release before the drag threshold descends as today),
 * but a DRAG grabs the SELECTED node whose subtree the press landed in. The
 * DOM board made this the common case — `pickable.pick` is
 * smallest-area-wins, so a second press on an already-selected panel resolves
 * to one of its static children and `selectedEntityIds.has(hitAtDown)` never
 * held: no move (or reorder) candidate could form on any node with children
 * (measured on the parity re-walk, 2026-08-30 — six drag variants on an
 * absolutely-positioned HUD panel all fell through to click-select).
 */
function nearestSelectedAncestor(
  adapter: AuthoringAdapter,
  hitId: string,
  selectedIds: ReadonlySet<string>,
): string | null {
  let cur: string | null = hitId;
  for (let hops = 0; cur !== null && hops < 256; hops++) {
    if (selectedIds.has(cur)) return cur;
    cur = adapter.hierarchy.node(cur)?.parentId ?? null;
  }
  return null;
}

function resolveMoveCandidate(
  active: AuthoringAdapter,
  hitId: string,
  selectedIds: ReadonlySet<string>,
): DragState['moveCandidate'] {
  const owner = boxEditForId(active, hitId);
  if (!owner) return null;
  const posValue = active.inspector?.get(hitId, 'style.position');
  const native2D = transformDimensionsFor(active, hitId) === '2d';
  if (posValue !== 'absolute' && posValue !== 'fixed' && !native2D) return null;
  const rect = rectForId(active, hitId);
  if (!rect) return null;
  const nativeOrigin = native2D ? (owner.gizmoOrigin?.(hitId) ?? undefined) : undefined;
  const peers: MovePeer[] = [];
  for (const id of selectedIds) {
    if (id === hitId) continue;
    const peerOwner = boxEditForId(active, id);
    const peerRect = rectForId(active, id);
    if (!peerOwner || !peerRect) continue;
    const peerPosition = active.inspector?.get(id, 'style.position');
    const peerNative = transformDimensionsFor(active, id) === '2d';
    if (peerPosition !== 'absolute' && peerPosition !== 'fixed' && !peerNative) continue;
    const peerOrigin = peerNative ? (peerOwner.gizmoOrigin?.(id) ?? undefined) : undefined;
    peers.push({
      id,
      ownerBoxEdit: peerOwner,
      origRect: peerRect,
      ...(peerOrigin ? { nativeOrigin: peerOrigin } : {}),
    });
  }
  return {
    id: hitId,
    ownerBoxEdit: owner,
    origRect: rect,
    context: contextRectsForId(active, hitId),
    ...(nativeOrigin ? { nativeOrigin } : {}),
    peers,
  };
}

/**
 * D2.b (spec:397-401) — resolve a pointerdown hit into a deferred
 * reorder-preview CANDIDATE (see `DragState.reorderCandidate`'s doc comment):
 * only when `hitId`'s OWNING adapter exposes `structure.reorder` (capability
 * gate — the ingested react-dom adapter has no `structure` at all, so this
 * always returns `null` there, per this task's own capability-gating
 * precedent) AND it has ≥3 total siblings (itself + ≥2 others). Sibling ids
 * come from {@link siblingIdsForId} (the owner's OWN `hierarchy`, ordered);
 * each sibling's CURRENT rect is read via {@link rectForId} (same
 * owner-routing `resolveMoveCandidate` uses) — a sibling with no rect
 * (unmounted/offscreen) is simply excluded from the gap math, never a throw.
 * Factored out of `onPointerDown` for the same cognitive-complexity reason
 * `resolveMoveCandidate` is.
 */
function resolveReorderCandidate(
  active: AuthoringAdapter,
  hitId: string,
): DragState['reorderCandidate'] {
  const structure = structureForId(active, hitId);
  if (!structure?.reorder) return null;
  const siblingIds = siblingIdsForId(active, hitId);
  if (!siblingIds || siblingIds.length < 3) return null;
  const origRect = rectForId(active, hitId);
  if (!origRect) return null;
  const siblingRects: SiblingRectEntry[] = [];
  for (const sid of siblingIds) {
    if (sid === hitId) continue;
    const r = rectForId(active, sid);
    if (r) siblingRects.push({ id: sid, rect: r });
  }
  if (siblingRects.length === 0) return null;
  return { id: hitId, adapter: active, origRect, siblingRects };
}

/** True while a REAL game (Play, an ingested unmodified game, or an
 *  auto-mounted `{ module }` adapter world) owns the canvas and needs its own
 *  pointer events — the overlay must be fully inert then (see the call
 *  site's doc comment for the regression this guards). Factored into its own
 *  function purely to keep the caller's cognitive complexity down. */
function isCanvasOwnedByARunningGame(): boolean {
  return anyLiveSessionMounted();
}

/**
 * B2/B3 — the single-selection box-edit bundle (handles/rotate/dimension-
 * label/spacing-bands), or `null` when it doesn't apply: these render ONLY
 * for EXACTLY one selected node whose OWNER exposes `boxEdit` (spec:317).
 * Factored out of the component purely to keep ITS cognitive complexity
 * down — pure, reads only its arguments.
 */
function computeSingleSelectionBoxEdit(
  adapter: AuthoringAdapter,
  selectedIds: ReadonlySet<string>,
): {
  id: string;
  rect: DOMRectLike;
  ownerBoxEdit: BoxEditProvider;
  spacingBands: SpacingBand[];
} | null {
  if (selectedIds.size !== 1) return null;
  const id = [...selectedIds][0]!;
  const ownerBoxEdit = boxEditForId(adapter, id);
  if (!ownerBoxEdit) return null;
  const rect = rectForId(adapter, id);
  if (!rect) return null;
  const spacingBands = computeSpacingBands(rect, readSpacingValues(adapter, id));
  return { id, rect, ownerBoxEdit, spacingBands };
}

/**
 * D4.b (spec §6 D4 "a multi-select align/distribute toolbar ... shown when
 * ≥2 nodes are selected") — the `AlignToolbar`'s entries, or `null` when it
 * shouldn't render: fewer than 2 selected, OR any selected id fails to
 * resolve BOTH a rect and an owning `boxEdit` (spec:305's own "capability-
 * gated: only when adapter.boxEdit is present" — an all-or-nothing gate, so
 * a mixed selection spanning a boxEdit-less world never offers a partially-
 * broken toolbar). Factored out purely to keep the component's own
 * cognitive complexity down, same reason `computeSingleSelectionBoxEdit`
 * above is.
 */
function computeMultiSelectionAlign(
  adapter: AuthoringAdapter,
  selectedIds: ReadonlySet<string>,
): AlignEntry[] | null {
  if (selectedIds.size < 2) return null;
  const entries: AlignEntry[] = [];
  for (const id of selectedIds) {
    const rect = rectForId(adapter, id);
    if (!rect) return null;
    if (!boxEditForId(adapter, id)) return null;
    entries.push({ id, rect });
  }
  return entries;
}

/**
 * D1 (spec §6) — measure lines, position/parent-layout badge, and
 * parent-container outline, all READ-only (rects + `inspector.get`) so —
 * unlike {@link computeSingleSelectionBoxEdit}'s handles/bands — available
 * for ANY adapter exposing `rects`, not gated on the owner also exposing
 * `boxEdit`. Only for EXACTLY one selected node (spec §6's own framing:
 * "between selection and hover" / "a small badge near the selection" both
 * presume a single selection). Factored out of the component purely to keep
 * ITS cognitive complexity down — pure given its arguments.
 */
function computeD1Affordances(
  adapter: AuthoringAdapter,
  selectedIds: ReadonlySet<string>,
  hoverRect: DOMRectLike | null,
): {
  selectedSingleRect: DOMRectLike | null;
  measureLines: MeasureLine[];
  positionBadge: PositionBadgeInfo | null;
  showPositionBadge: boolean;
  parentRect: DOMRectLike | null;
} {
  const selectedSingleId = selectedIds.size === 1 ? [...selectedIds][0]! : null;
  const selectedSingleRect = selectedSingleId ? rectForId(adapter, selectedSingleId) : null;
  // D1.a — sibling-distance measure lines between the selection and the
  // CURRENTLY HOVERED sibling (spec §6 "between selection and hover"). `[]`
  // whenever either rect is missing or the two rects don't leave a gap on
  // either axis (`computeMeasureLines`'s own honest-empty-result doc
  // comment) — never a fabricated line.
  const measureLines =
    selectedSingleRect && hoverRect ? computeMeasureLines(selectedSingleRect, hoverRect) : [];
  // D1.c — each segment resolves independently; `null`/`null` renders no
  // badge at all (never a fabricated default — spec's own honesty rule).
  const positionBadge: PositionBadgeInfo | null = selectedSingleId
    ? resolvePositionBadge(adapter, selectedSingleId)
    : null;
  const showPositionBadge = !!(
    positionBadge &&
    (positionBadge.position || positionBadge.parentLayout)
  );
  // D1.c — the parent container's own rect (`rects.contextRects(id).parent`,
  // routed through the SAME owner-child helper the B2 move/resize gestures
  // already use for this exact field) — `null` when the selection has no
  // resolvable parent rect (a top-level node, or the owner has no
  // `contextRects`), in which case no outline renders at all.
  const parentRect = selectedSingleId
    ? (contextRectsForId(adapter, selectedSingleId)?.parent ?? null)
    : null;
  return { selectedSingleRect, measureLines, positionBadge, showPositionBadge, parentRect };
}

function ViewportPickMenu({
  state,
  adapter,
  onClose,
}: {
  state: { x: number; y: number; ids: readonly string[] };
  adapter: AuthoringAdapter;
  onClose: () => void;
}): React.ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <ThemeRootPortal>
      <Menu
        ref={ref}
        aria-label="Pick object under pointer"
        data-testid="viewport-pick-menu"
        style={{
          position: 'fixed',
          left: state.x,
          top: state.y,
          minWidth: 190,
          maxWidth: 320,
          zIndex: zIndex.dropdown,
        }}
      >
        {state.ids.map((id) => {
          const node = adapter.hierarchy.node(id);
          return (
            <MenuItem
              key={id}
              data-testid="viewport-pick-menu-item"
              onSelect={() => {
                setAuthoringSelection(adapter, [id]);
                onClose();
              }}
              style={{ justifyContent: 'space-between', gap: 20 }}
            >
              <span>{node?.label ?? id}</span>
              <span style={{ color: themeVars.content.muted, fontSize: 11 }}>
                {node?.kind ?? ''}
              </span>
            </MenuItem>
          );
        })}
      </Menu>
    </ThemeRootPortal>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one cohesive overlay owns the shared pointer-state machine and its adapter-routed affordances
export function RootSelectionOverlay({
  adapter: scopedAdapter,
  view: suppliedView,
  transformModeAware = false,
}: {
  adapter?: AuthoringAdapter;
  /** Presentation camera for this document. Native Canvas scenes pass their
   * own controller; DOM component boards use the shared board camera. */
  view?: RootViewController;
  /** Native scene toolbars use explicit Move/Rotate/Scale modes. Component
   * boards retain their Figma-style all-handles-at-once interaction. */
  transformModeAware?: boolean;
} = {}): React.ReactNode {
  const store = useEditorStore();
  const storeVersion = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const adapter = scopedAdapter ?? getActiveAuthoring(store);
  const pickAt = useCallback(
    (clientX: number, clientY: number): string | null =>
      scopedAdapter
        ? (scopedAdapter.pickable?.pick(clientX, clientY) ?? null)
        : pickTopmost(store, clientX, clientY),
    [scopedAdapter, store],
  );

  const interactionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const marqueeRef = useRef<Rect | null>(null);
  const [marquee, setMarqueeState] = useState<Rect | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [editorControlCursor, setEditorControlCursor] = useState<EditorControlCursor>(null);
  const [pickMenu, setPickMenu] = useState<{
    x: number;
    y: number;
    ids: readonly string[];
  } | null>(null);
  // Right-button navigation belongs to the spatial viewport underneath this
  // overlay (Three OrbitControls or the native Canvas camera). Track only the
  // click-vs-drag distinction here so the shared overlap menu never opens at
  // the end of an orbit/pan. PointerEvent button ids and movement are the same
  // on macOS and Windows; no platform modifier belongs in this decision.
  const secondaryPressRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const openPickMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const ids = pickCandidates(store, clientX, clientY, {
        ...(scopedAdapter ? { adapter: scopedAdapter } : {}),
      });
      if (ids.length === 0) {
        setPickMenu(null);
        return;
      }
      setPickMenu({ x: clientX, y: clientY, ids });
    },
    [scopedAdapter, store],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const press = secondaryPressRef.current;
      if (!press || press.pointerId !== event.pointerId || press.moved) return;
      if (
        Math.hypot(event.clientX - press.startClientX, event.clientY - press.startClientY) >
        DRAG_THRESHOLD_PX
      ) {
        press.moved = true;
      }
    };
    const finish = (event: PointerEvent): void => {
      const press = secondaryPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      secondaryPressRef.current = null;
      // Chromium does not order `contextmenu` consistently across desktop
      // platforms: macOS can emit it as soon as the secondary button goes
      // down, before this press has had a chance to become a drag. Opening the
      // editor menu from that event therefore makes right-drag panning
      // impossible on macOS. The native event is suppressed below; release is
      // the one cross-platform decision point. A cancelled press opens
      // nothing, a moved press was navigation, and only a stationary release
      // is the overlap menu gesture.
      if (event.type === 'pointerup' && !press.moved) {
        openPickMenuAt(event.clientX, event.clientY);
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [openPickMenuAt]);

  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    // This event is prevention-only. Stationary-click versus pan is decided
    // on pointer release above, after the movement threshold has an honest
    // answer on both macOS and Windows.
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // D4 (spec27 §8 "space-pan" row) — the shared pan + zoom, applied to the
  // visual-chrome wrapper below (`world-pan-state.ts` applies the identical
  // value to every design-time world-layer host — see that module's doc
  // comment for the lockstep-transform soundness argument). The interaction
  // surface deliberately stays OUTSIDE that transformed wrapper: input must
  // cover the complete viewport at every zoom level, like a design canvas.
  // `useSyncExternalStore` so a pan change (from THIS component's own
  // space-drag below, or a reset) re-renders immediately.
  const view = suppliedView ?? sharedRootViewController;
  const pan = useSyncExternalStore(view.subscribe, view.get, view.get);
  useSyncExternalStore(
    useCallback((listener) => subscribeCanvasSceneGuides(view, listener), [view]),
    useCallback(() => canvasSceneGuideRevision(view), [view]),
  );
  const nativeGuides = transformModeAware ? canvasSceneGuides(view) : [];
  // Native scene chrome is measured in SCREEN pixels even though its anchors
  // live in world space: zooming should enlarge the subject, not its labels or
  // grab targets. DOM boards keep their historical canvas-scaled chrome.
  const chromeScale = transformModeAware ? 1 / pan.zoom : 1;
  // A dedicated Move/Rotate/Scale tool draws its axis gizmo at the node's
  // origin; the combined tool draws handles on the selection's bounds, the way
  // Godot's Select tool and Figma's selection do.
  const axisGizmos =
    transformModeAware && store.transformMode !== 'combined' && store.transformMode !== 'select';
  // True while the Space key is physically held (and not typing — see the
  // keydown/keyup effect below), the hold-to-pan gesture's arm switch.
  // `spaceHeldRef` mirrors the state for a synchronous read in the pointer
  // handlers (same "ref mirrors state" convention `marqueeRef`/`textEditRef`
  // already use in this file).
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // The active space-drag pan gesture, or `null` between drags — kept
  // SEPARATE from `dragRef`/`gestureRef` (mutually exclusive per pointer
  // session, same reasoning `GestureState`'s own doc comment gives for being
  // separate from `DragState`): a pan-drag never picks/selects/resizes, it
  // only ever writes `world-pan-state.ts`.
  const panDragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startPan: { x: number; y: number };
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // B2/B3 — the currently-active resize/move/rotate/spacing gesture, or
  // `null` between gestures (see `GestureState`'s doc comment for why this is
  // a SEPARATE ref from `dragRef`/A3's click-marquee tracking).
  const gestureRef = useRef<GestureState | null>(null);
  // Adapter replacement/unmount must close the old provider's edit bracket,
  // even when no pointer-up arrives. Transient interaction state then dies
  // with this overlay rather than leaking into the replacement document.
  useEffect(
    () => () => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture) return;
      gesture.ownerBoxEdit.end(gesture.id);
      for (const peer of gesture.movePeers ?? []) peer.ownerBoxEdit.end(peer.id);
    },
    [],
  );

  // Bumped on every `apply` so the box/handles/bands re-render against the
  // LIVE rect `boxEdit.apply`'s preview mutation just produced (step 5).
  const [, setGestureTick] = useState(0);

  // D2.a — the drag-ghost rect (a semi-transparent follow-cursor copy of the
  // dragged element, spec:399), live during EITHER a B2 move gesture or a
  // D2.b reorder-preview drag — "dragging a selected element on the canvas"
  // per the spec's own D2 framing. Purely visual: it never feeds a commit
  // path itself (`computeDragGhost` is pure geometry — see its doc comment).
  const [dragGhost, setDragGhost] = useState<Rect | null>(null);

  // D1.b — the currently-engaged alignment/snap guide(s), live during EITHER
  // a B2 move or resize gesture (spec §6 "guides appear only within the
  // snap threshold; disappear when not snapping"). `[]` between gestures and
  // whenever the live gesture's own edge-snap isn't currently engaged —
  // never a stale guide left over from a moment ago.
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // D2.b — the live reorder-preview: which gap the pointer currently resolves
  // to among the dragged node's siblings, or `null` between reorder drags.
  // `reorderPreviewRef` mirrors the state for a synchronous read in
  // `onPointerUp` (same "ref mirrors state" convention `textEditRef`/
  // `marqueeRef` already use) — NOT tracked via `gestureRef`/`GestureState`:
  // a reorder-preview has no `BoxEditProvider` begin/apply/end bracket, it is
  // a single `structure.reorder` commit at drop, so it needs its own
  // independent lifecycle (mirrors `GestureState`'s own doc comment on why
  // IT is separate from `DragState`).
  const reorderPreviewRef = useRef<{
    id: string;
    adapter: AuthoringAdapter;
    gap: ReorderGap;
  } | null>(null);
  const [reorderPreview, setReorderPreviewState] = useState<{
    id: string;
    adapter: AuthoringAdapter;
    gap: ReorderGap;
  } | null>(null);
  const setReorderPreview = useCallback(
    (v: { id: string; adapter: AuthoringAdapter; gap: ReorderGap } | null) => {
      reorderPreviewRef.current = v;
      setReorderPreviewState(v);
    },
    [],
  );

  // D3.b — the currently-open inline text editor (double-clicked node), or
  // `null`. `textEditRef` mirrors the state for synchronous reads from
  // callbacks (same "ref mirrors state" convention `marqueeRef`/`setMarquee`
  // already use above).
  const textEditRef = useRef<{ id: string; rect: DOMRectLike; initialText: string } | null>(null);
  const [textEdit, setTextEditState] = useState<{
    id: string;
    rect: DOMRectLike;
    initialText: string;
  } | null>(null);
  // D3.b — a double-click that was REFUSED (dynamic body/has children): no
  // textarea, just a loud, honest "not editable" indicator at the rect,
  // mirroring the store's existing dynamic-refusal pattern (console.warn +
  // a visible degraded state, never a silent no-op).
  const [textEditRefused, setTextEditRefused] = useState<{ id: string; rect: DOMRectLike } | null>(
    null,
  );
  const setTextEdit = useCallback(
    (v: { id: string; rect: DOMRectLike; initialText: string } | null) => {
      textEditRef.current = v;
      setTextEditState(v);
    },
    [],
  );
  // D3.R1 (reopen fix) — `TextProvider.set` is fire-and-forget (the write is an
  // async round trip to the dev server); the textarea closes immediately on
  // commit, so whether it landed or was refused can only be learned from a
  // LATER re-render. Stash the committed id+rect here the instant `commitTextEdit`
  // fires; the effect below consumes it on the next store notify (`editText`
  // calls `store.notifyIngestEdit()` unconditionally on both the themeVars.semantic.success and the
  // refusal path) and checks `text.get` — which reports `null` for a refused id
  // (via the adapter's own `dynamicPaths` mark) — to decide whether to surface
  // the refused indicator instead of letting the edit silently vanish.
  const pendingTextCommitRef = useRef<{ id: string; rect: DOMRectLike } | null>(null);

  // Perf debt note (reviewer, D3 reopen review) — `emptyContainerHintsFor`
  // walks every node in the active adapter's tree calling
  // `getBoundingClientRect()` on each; it was previously recomputed on EVERY
  // render, including the plain hover `pointermove` path (`setHoverId` is
  // component-LOCAL state, so it re-renders this component without touching
  // `store` at all). Cached here keyed on `[adapter, storeVersion]` — `store`
  // only bumps `storeVersion` on an actual structural/selection/edit notify
  // (`notifyIngestEdit`/`setSelection` etc.), never on a bare hover move — so
  // a mousemove-only re-render now reuses the prior render's hints instead of
  // re-walking the whole tree.
  const emptyHintsCacheRef = useRef<{
    adapter: AuthoringAdapter;
    version: number;
    hints: ReturnType<typeof emptyContainerHintsFor>;
  } | null>(null);

  // D3.R1 — consume a pending commit on the next store tick (see
  // `pendingTextCommitRef` doc comment). Runs at most once per commit: it always
  // clears the pending ref, whether or not the write was refused.
  useEffect(() => {
    const pending = pendingTextCommitRef.current;
    if (!pending) return;
    pendingTextCommitRef.current = null;
    const provider = textForId(adapter, pending.id);
    if (provider && provider.get(pending.id) === null) {
      setTextEditRefused({ id: pending.id, rect: pending.rect });
    }
    // `storeVersion` is the only intentional trigger — `store` is stable and
    // `pending` is read off the ref fresh each tick, per `useExhaustiveDependencies: off` (biome.json).
  }, [storeVersion]);

  // D3.R1 — the refused indicator is a TRANSIENT affordance, not a permanent
  // mark: it must clear on a selection change (the user moved on to something
  // else) or after a reasonable timeout (they didn't), so it never sticks
  // forever the way it did pre-fix (only another double-click cleared it).
  const textEditRefusedSelectionRef = useRef<string>('');
  useEffect(() => {
    const signature = [...store.selectedEntityIds].sort().join(',');
    if (signature !== textEditRefusedSelectionRef.current) {
      textEditRefusedSelectionRef.current = signature;
      if (textEditRefused) setTextEditRefused(null);
    }
  });
  useEffect(() => {
    if (!textEditRefused) return;
    const timer = window.setTimeout(() => setTextEditRefused(null), 4000);
    return () => window.clearTimeout(timer);
  }, [textEditRefused]);

  // D3.d — the fallback eyedropper session (native EyeDropper needs none of
  // this — it samples real rendered pixels itself). Re-renders whenever a
  // session begins/ends so the cursor swatch appears/disappears immediately.
  const eyedropperActive = useSyncExternalStore(
    subscribeEyedropperSession,
    isEyedropperSessionActive,
  );
  const [eyedropperPreview, setEyedropperPreview] = useState<{
    x: number;
    y: number;
    color: string | null;
  } | null>(null);

  const setMarquee = useCallback((r: Rect | null) => {
    marqueeRef.current = r;
    setMarqueeState(r);
  }, []);

  const toHostLocal = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const host = interactionRef.current?.getBoundingClientRect();
      return {
        x: (clientX - (host?.left ?? 0) - pan.x) / pan.zoom,
        y: (clientY - (host?.top ?? 0) - pan.y) / pan.zoom,
      };
    },
    [pan.x, pan.y, pan.zoom],
  );

  const onAssetDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (
        !suppliedView ||
        !transformModeAware ||
        !adapter.assetDrop ||
        !event.dataTransfer.types.includes('application/x-editor-asset')
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [adapter.assetDrop, suppliedView, transformModeAware],
  );

  const onAssetDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!suppliedView || !transformModeAware || !adapter.assetDrop) return;
      const raw = event.dataTransfer.getData('application/x-editor-asset');
      if (!raw) return;
      let data: {
        path: string;
        name?: string;
        component?: AssetDropContext['item'];
      };
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      const point = toHostLocal(event.clientX, event.clientY);
      const context: AssetDropContext = {
        position: [point.x, point.y, 0],
        item: data.component ?? {
          kind: 'file',
          name: data.name ?? data.path.split('/').pop() ?? data.path,
        },
      };
      if (!adapter.assetDrop.accepts('', data.path, context)) return;
      event.preventDefault();
      event.stopPropagation();
      void dropAuthoringAsset(adapter, '', data.path, context);
    },
    [adapter.assetDrop, suppliedView, toHostLocal, transformModeAware],
  );

  const bumpGesture = useCallback(() => setGestureTick((t) => t + 1), []);

  /** Common gesture-end path for `onPointerUp`/`onPointerCancel` (step 6):
   *  `ownerBoxEdit.end(id)`, clear the ref, force one more re-render so the
   *  handles snap to the FINAL committed rect. */
  const endGesture = useCallback((): boolean => {
    const gesture = gestureRef.current;
    if (!gesture) return false;
    gestureRef.current = null;
    gesture.ownerBoxEdit.end(gesture.id);
    for (const peer of gesture.movePeers ?? []) peer.ownerBoxEdit.end(peer.id);
    // D2.a — the drag-ghost (if any) belonged to this gesture; clear it now
    // that the FINAL committed rect is what the box/handles snap back to.
    setDragGhost(null);
    // D1.b — likewise, any live alignment guide belonged to this gesture.
    setSnapGuides([]);
    bumpGesture();
    return true;
  }, [bumpGesture]);

  const startResizeGesture = useCallback(
    (pos: HandlePos, e: ReactPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const selected = store.selectedEntityIds;
      if (selected.size !== 1) return;
      const id = [...selected][0]!;
      const owner = boxEditForId(adapter, id);
      const rect = rectForId(adapter, id);
      if (!owner || !rect) return;
      const posValue = adapter.inspector?.get(id, 'style.position');
      const native2D = transformDimensionsFor(adapter, id) === '2d';
      const frame = native2D ? frameForId(adapter, id) : null;
      const frameOrigin = frame && frameIsTurned(frame) ? (owner.gizmoOrigin?.(id) ?? null) : null;
      capturePointer(e);
      owner.begin(id);
      gestureRef.current = {
        kind: 'resize',
        id,
        ownerBoxEdit: owner,
        startLocal: toHostLocal(e.clientX, e.clientY),
        origRect: rect,
        pos,
        ...(frame && frameOrigin ? { frame, frameOrigin } : {}),
        isPositioned: posValue === 'absolute' || posValue === 'fixed' || native2D,
        // D1.b — same `contextRectsForId` call the move gesture already
        // seeds `context` from (`resolveMoveCandidate`), so a resize handle
        // drag gets edge-snapping + guides too (spec §6's own instruction:
        // "wire the resize handle drag to computeSnapTargets too").
        context: contextRectsForId(adapter, id),
      };
    },
    [adapter, store, toHostLocal],
  );

  const startRotateGesture = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const selected = store.selectedEntityIds;
      if (selected.size !== 1) return;
      const id = [...selected][0]!;
      const owner = boxEditForId(adapter, id);
      const rect = rectForId(adapter, id);
      if (!owner || !rect) return;
      const nativeOrigin = transformModeAware ? owner.gizmoOrigin?.(id) : null;
      capturePointer(e);
      owner.begin(id);
      gestureRef.current = {
        kind: 'rotate',
        id,
        ownerBoxEdit: owner,
        startLocal: toHostLocal(e.clientX, e.clientY),
        origRect: rect,
        center: nativeOrigin ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        ...(nativeOrigin ? { nativeOrigin } : {}),
      };
    },
    [adapter, store, toHostLocal, transformModeAware],
  );

  const startMoveGizmoGesture = useCallback(
    (axis: 'x' | 'y' | 'both', e: ReactPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const selected = store.selectedEntityIds;
      if (selected.size !== 1) return;
      const id = [...selected][0]!;
      const owner = boxEditForId(adapter, id);
      const rect = rectForId(adapter, id);
      if (!owner || !rect) return;
      const nativeOrigin = owner.gizmoOrigin?.(id) ?? {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      capturePointer(e);
      owner.begin(id);
      gestureRef.current = {
        kind: 'move',
        id,
        ownerBoxEdit: owner,
        startLocal: toHostLocal(e.clientX, e.clientY),
        origRect: rect,
        context: contextRectsForId(adapter, id),
        moveAxis: axis,
        nativeOrigin,
      };
    },
    [adapter, store, toHostLocal],
  );

  const startNativeScaleGesture = useCallback(
    (axis: 'x' | 'y' | 'both', e: ReactPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const selected = store.selectedEntityIds;
      if (selected.size !== 1) return;
      const id = [...selected][0]!;
      const owner = boxEditForId(adapter, id);
      const rect = rectForId(adapter, id);
      if (!owner || !rect) return;
      const nativeOrigin = owner.gizmoOrigin?.(id) ?? {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      capturePointer(e);
      owner.begin(id);
      gestureRef.current = {
        kind: 'native-scale',
        id,
        ownerBoxEdit: owner,
        startLocal: toHostLocal(e.clientX, e.clientY),
        origRect: rect,
        nativeOrigin,
        nativeScaleAxis: axis,
        nativeHandleSpan: NATIVE_GIZMO_LENGTH_PX / pan.zoom,
      };
    },
    [adapter, pan.zoom, store, toHostLocal],
  );

  const startReferenceGesture = useCallback(
    (point: BoxEditReferencePoint, e: ReactPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const selected = store.selectedEntityIds;
      if (selected.size !== 1) return;
      const id = [...selected][0]!;
      const owner = boxEditForId(adapter, id);
      const rect = rectForId(adapter, id);
      if (!owner || !rect || owner.referencePoint?.(id)?.id !== point.id) return;
      capturePointer(e);
      owner.begin(id);
      gestureRef.current = {
        kind: 'reference',
        id,
        ownerBoxEdit: owner,
        startLocal: toHostLocal(e.clientX, e.clientY),
        origRect: rect,
        context: contextRectsForId(adapter, id),
        pointerId: e.pointerId,
        referencePoint: point,
      };
    },
    [adapter, store, toHostLocal],
  );

  /**
   * An adapter-owned spatial handle's own drag, deliberately OUTSIDE the
   * `GestureState` machine: it has no `BoxEditProvider` begin/apply/end bracket
   * (the provider owns its own preview/commit pair), so it needs an independent
   * lifecycle — the same reasoning `reorderPreviewRef` records for being
   * separate. The pointer is captured on the handle itself, so the move/up pair
   * arrives there and never touches the marquee/selection machine.
   */
  const spatialDragRef = useRef<{
    id: string;
    handleId: string;
    provider: SpatialHandlesProvider;
  } | null>(null);

  const onSpatialHandleDown = useCallback(
    (
      id: string,
      provider: SpatialHandlesProvider,
      handle: SpatialDragHandle,
      e: ReactPointerEvent<HTMLElement>,
    ) => {
      e.stopPropagation();
      if (e.button !== 0 || !handle.writable) return;
      capturePointer(e);
      spatialDragRef.current = { id, handleId: handle.id, provider };
    },
    [],
  );

  const onSpatialHandleMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = spatialDragRef.current;
      if (!drag) return;
      const local = toHostLocal(e.clientX, e.clientY);
      drag.provider.preview(drag.id, drag.handleId, [local.x, local.y, 0]);
      bumpGesture();
    },
    [bumpGesture, toHostLocal],
  );

  const onSpatialHandleUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const drag = spatialDragRef.current;
      spatialDragRef.current = null;
      if (!drag) return;
      releaseCapturedPointer(e);
      const local = toHostLocal(e.clientX, e.clientY);
      void drag.provider.commit(drag.id, drag.handleId, [local.x, local.y, 0]);
      bumpGesture();
    },
    [bumpGesture, toHostLocal],
  );

  const startSpacingGesture = useCallback(
    (band: SpacingBand, e: ReactPointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const selected = store.selectedEntityIds;
      if (selected.size !== 1) return;
      const id = [...selected][0]!;
      const owner = boxEditForId(adapter, id);
      const rect = rectForId(adapter, id);
      if (!owner || !rect) return;
      capturePointer(e);
      owner.begin(id);
      gestureRef.current = {
        kind: 'spacing',
        id,
        ownerBoxEdit: owner,
        startLocal: toHostLocal(e.clientX, e.clientY),
        origRect: rect,
        side: band.side,
        origValue: band.value,
      };
    },
    [adapter, store, toHostLocal],
  );

  /** Compute this gesture's patch from the current pointer position and apply
   *  it live, bumping the re-render counter so box/handles/bands track the
   *  preview. Shared by the active-gesture branch of `onPointerMove` and the
   *  D2 threshold-promotion of a deferred move candidate. */
  const applyGesturePatch = useCallback(
    (gesture: GestureState, e: ReactPointerEvent<HTMLElement>) => {
      if (gesture.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
      const local = toHostLocal(e.clientX, e.clientY);
      const dx = local.x - gesture.startLocal.x;
      const dy = local.y - gesture.startLocal.y;
      let patch: Record<string, number>;
      if (gesture.kind === 'resize' && gesture.frame && gesture.frameOrigin) {
        // A turned node resizes along its own axes, its opposite corner held.
        patch = frameResizePatch(gesture.frame, gesture.pos!, dx, dy, gesture.frameOrigin, e.shiftKey);
        setSnapGuides([]);
      } else if (gesture.kind === 'resize') {
        patch = computeResizePatch(
          gesture.pos!,
          dx,
          dy,
          gesture.origRect,
          !!gesture.isPositioned,
          e.altKey,
          gesture.context,
        );
        // Shift keeps a corner resize's proportions (Godot's Scale mode, Figma's frame), where the
        // box writes its position; a laid-out element's size alone is not anchored this way.
        if (e.shiftKey && gesture.isPositioned) patch = proportionalResize(patch, gesture.origRect, gesture.pos!);
        // D1.b — the same edge-snap decision `computeResizePatch` just
        // applied to the patch, rendered as a guide (spec §6).
        setSnapGuides(
          computeResizeSnapGuides(
            gesture.pos!,
            dx,
            dy,
            gesture.origRect,
            e.altKey,
            gesture.context,
          ),
        );
      } else if (gesture.kind === 'native-scale') {
        patch = nativeScalePatch(
          gesture,
          dx,
          dy,
          // A 2D scale steps under its own switch (Godot's Use Scale Snap), not the grid magnet.
          store.scaleSnap,
          e.altKey,
          store.snapValues.scale,
        );
        setSnapGuides([]);
      } else if (gesture.kind === 'move') {
        const { dx: moveDx, dy: moveDy } = constrainedMoveDelta(gesture.moveAxis, dx, dy);
        if (gesture.nativeOrigin) {
          patch = nativeMovePatch(
            gesture,
            moveDx,
            moveDy,
            store.snapEnabled,
            e.altKey,
            store.snapValues.translate,
          );
          const snapped = computeNativeMoveSnap(
            {
              x: patch['originX'] ?? gesture.nativeOrigin.x,
              y: patch['originY'] ?? gesture.nativeOrigin.y,
            },
            gesture.nativeOrigin,
            gesture.origRect,
            gesture.context,
            gesture.moveAxis,
            // Alignment is smart snapping's, beside the grid's step (Godot's two toggles).
            !store.smartSnap.enabled || e.altKey,
            EDGE_SNAP_THRESHOLD_PX / Math.max(pan.zoom, 0.01),
            {
              x: nativeGuides.filter((guide) => guide.axis === 'x').map((guide) => guide.value),
              y: nativeGuides.filter((guide) => guide.axis === 'y').map((guide) => guide.value),
            },
            store.smartSnap,
          );
          if (patch['originX'] !== undefined) patch['originX'] = snapped.position.x;
          if (patch['originY'] !== undefined) patch['originY'] = snapped.position.y;
          setSnapGuides(snapped.guides);
        } else {
          patch = computeMovePatch(moveDx, moveDy, gesture.origRect, e.altKey, gesture.context);
        }
        // D2.a — the move gesture is "dragging a selected element on the
        // canvas" (spec:399); track the drag-ghost alongside the live
        // boxEdit preview. Resize/rotate/spacing gestures don't get a ghost
        // — the spec's D2 framing is specifically about MOVING an element.
        setDragGhost(computeDragGhost(gesture.origRect, moveDx, moveDy));
        // D1.b — same relationship as the resize branch above.
        if (!gesture.nativeOrigin) {
          setSnapGuides(
            computeMoveSnapGuides(moveDx, moveDy, gesture.origRect, e.altKey, gesture.context),
          );
        }
      } else if (gesture.kind === 'reference') {
        const snapped = computePointSnap(local, gesture.origRect, e.altKey, gesture.context, {
          bounded: gesture.referencePoint?.bounded,
          snapPoints: gesture.referencePoint?.snapPoints,
        });
        patch = { referenceX: snapped.position.x, referenceY: snapped.position.y };
        setSnapGuides(snapped.guides);
      } else if (gesture.kind === 'rotate') {
        patch = computeRotatePatch(
          gesture.center!,
          gesture.startLocal,
          local,
          // A 2D rotation steps under its own switch (Godot's Use Rotation Snap).
          gesture.nativeOrigin ? !store.rotationSnap || e.altKey : e.altKey,
          gesture.nativeOrigin ? store.snapValues.rotate : 15,
        );
      } else {
        patch = computeSpacingPatch(gesture.side!, dx, dy, gesture.origValue ?? 0);
      }
      gesture.ownerBoxEdit.apply(gesture.id, patch);
      if (gesture.kind === 'move' && gesture.movePeers) {
        const primaryDx = gesture.nativeOrigin
          ? (patch['originX'] ?? gesture.nativeOrigin.x) - gesture.nativeOrigin.x
          : (patch['x'] ?? gesture.origRect.x) - gesture.origRect.x;
        const primaryDy = gesture.nativeOrigin
          ? (patch['originY'] ?? gesture.nativeOrigin.y) - gesture.nativeOrigin.y
          : (patch['y'] ?? gesture.origRect.y) - gesture.origRect.y;
        for (const peer of gesture.movePeers) {
          peer.ownerBoxEdit.apply(
            peer.id,
            peer.nativeOrigin
              ? {
                  originX: peer.nativeOrigin.x + primaryDx,
                  originY: peer.nativeOrigin.y + primaryDy,
                }
              : { x: peer.origRect.x + primaryDx, y: peer.origRect.y + primaryDy },
          );
        }
      }
      bumpGesture();
    },
    [toHostLocal, bumpGesture, store, nativeGuides, pan.zoom],
  );

  // D3.d — sample the effective background color at a client point: pick the
  // topmost node (the SAME `pickTopmost` A3 already uses), route to ITS
  // owner's `colorSample` (owner-routed, not merged on the composite — see
  // `colorSampleForId`'s doc comment), then reduce the raw ancestor chain
  // through the pure `effectiveColorFromChain`. `null` when nothing is hit or
  // the owner has no `colorSample` — the caller renders the honest "unknown"
  // swatch state for that, never a fabricated color.
  const sampleColorAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const hitId = pickAt(clientX, clientY);
      if (!hitId) return null;
      const chain = colorSampleForId(adapter, hitId)?.backgroundChainAt(clientX, clientY) ?? null;
      return chain ? effectiveColorFromChain(chain) : null;
    },
    [adapter, pickAt],
  );

  // D3.d — Escape cancels an in-flight fallback eyedropper session (never a
  // fabricated color — `resolveEyedropperSession(null)` is the honest
  // "cancelled" outcome the widget's `apply` callback already understands).
  useEffect(() => {
    if (!eyedropperActive) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') resolveEyedropperSession(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [eyedropperActive]);

  // D4 (spec27 §8 "space-pan" row) — the Space-held ARM SWITCH for the pan
  // gesture below (`onPointerDown`'s own early branch). A raw `window`
  // keydown/keyup pair, mounted once — NOT routed through `registerHotkeys`/
  // `editor-hotkeys.ts` (that registry fires once per keydown and has no
  // "held" concept; this mirrors the existing vertex-snap V-key pattern in
  // `viewport-hotkeys.ts` instead, which is the established precedent for a
  // literal key-HOLD state in this codebase). Matches `hotkeys.ts`'s own
  // not-typing guard exactly (input/textarea/select/contentEditable) so Space
  // still types a literal space character in any of those, never arming pan.
  // A focused `<Button>` is ALSO excluded so Space keeps its native
  // accessible "activate the focused control" behavior instead of arming pan
  // out from under it. `e.repeat` is ignored so an OS key-repeat storm is a
  // single no-op transition, not thousands of redundant `preventDefault`s.
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean =>
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement ||
      (t instanceof HTMLElement && t.isContentEditable);
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isTypingTarget(e.target) || e.target instanceof HTMLButtonElement) return;
      // Space's native action is page-scroll (or activating a focused
      // button, excluded above) — the hold-to-pan gesture replaces it, so
      // suppress the default here rather than fighting a scrolled page mid-drag.
      e.preventDefault();
      spaceHeldRef.current = true;
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      // Releasing Space mid-drag ends the pan exactly like a pointerup would
      // (see `onPointerUp`'s own early branch) — the pointer may still be
      // down, but with the arm switch off a further move must fall through
      // to ordinary hover/drag handling, never keep panning.
      if (panDragRef.current) {
        panDragRef.current = null;
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const onPrimaryPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Camera navigation is bound to the viewport container so right/middle
      // drags can pass through this DOM overlay. Keep left-button authoring
      // gestures owned here: OrbitControls captures every pointer it sees,
      // including left clicks, which would otherwise retarget pointerup to
      // the container before this overlay can finish selection/marquee/edit.
      e.stopPropagation();
      // Keep the complete interaction session on this full-viewport surface,
      // even when the pointer leaves the viewport or crosses transformed
      // story/frame content. Without capture, a fast Figma-style marquee or
      // Space-drag can strand the overlay in a half-finished gesture.
      capturePointer(e);
      // D4 (spec27 §8 "space-pan" row) — a press while Space is held ARMS a
      // pan-drag instead of the ordinary pick/select/marquee/eyedropper flow
      // below, which it skips entirely (never fights another gesture for the
      // same pointer session — same precedent `endGesture`/`reorderPreview`'s
      // early returns in `onPointerUp` already set). Seeds from the CURRENT
      // document view so the drag delta composes onto whatever pan was
      // already in effect.
      if (spaceHeldRef.current) {
        panDragRef.current = {
          startClientX: e.clientX,
          startClientY: e.clientY,
          startPan: view.get(),
        };
        setIsPanning(true);
        return;
      }
      // D3.d — a click while an eyedropper session is open SAMPLES AND ENDS
      // the session instead of the ordinary click-select flow below (which it
      // deliberately skips entirely — picking a color is not a selection
      // gesture).
      if (eyedropperActive) {
        resolveEyedropperSession(sampleColorAt(e.clientX, e.clientY));
        setEyedropperPreview(null);
        return;
      }
      // The project viewport's Three canvas sits below this full-cover
      // interaction layer. Give editor-owned effectors first refusal through
      // the viewport's own raycaster; activation selects their REAL authored
      // target/pole with exact intent and leaves ordinary world picking alone.
      if (activateViewportEditorControl(scopedAdapter, e.clientX, e.clientY)) {
        dragRef.current = null;
        setHoverId(null);
        setMarquee(null);
        return;
      }
      const hitAtDown = pickAt(e.clientX, e.clientY);
      // A board shows every story, while the authoring adapter intentionally
      // exposes only the active story's DOM. A press inside an inactive frame
      // therefore has no adapter hit. Treat the frame itself as the first
      // selection target: activate/focus that story, consume this pointer
      // session, and let a subsequent press edit its DOM. This makes the whole
      // frame behave like a Figma frame instead of requiring the tiny label.
      if (selectInactiveStoryFrame(e, hitAtDown)) {
        dragRef.current = null;
        setHoverId(null);
        setMarquee(null);
        return;
      }

      // D2 (spec:322): a press on an ALREADY-SELECTED, boxEdit-capable,
      // absolutely/fixed-positioned node RECORDS a move CANDIDATE — it does NOT
      // begin the gesture here. Promotion waits for the drag threshold
      // (`onPointerMove`), so a plain click (or shift-click) still falls
      // through to `resolveClickSelection` on pointerup (multi-select narrow /
      // shift-toggle preserved). A non-positioned node, or a hit that isn't yet
      // selected, records no candidate and keeps today's click-select behavior.
      // The drag SUBJECT is the nearest selected ancestor of the deep pick
      // (usually the pick itself) — see `nearestSelectedAncestor`'s doc
      // comment. `hitAtDown` keeps the deep pick for click-select on release.
      const moveSubject =
        hitAtDown !== null
          ? nearestSelectedAncestor(adapter, hitAtDown, store.selectedEntityIds)
          : null;
      const moveCandidate: DragState['moveCandidate'] =
        transformArms(transformModeAware, store.transformMode, 'translate') && moveSubject !== null
          ? resolveMoveCandidate(adapter, moveSubject, store.selectedEntityIds)
          : null;

      // D2.b: the SAME "already selected" gate, checked ONLY when there's no
      // move candidate — a positioned node moves (writes x/y); a flow/list
      // child (never absolute/fixed, so `moveCandidate` above is always
      // `null` for it) reorders instead (writes source order via
      // `structure.reorder`). The two are mutually exclusive per press.
      const reorderCandidate: DragState['reorderCandidate'] =
        !moveCandidate && moveSubject !== null
          ? resolveReorderCandidate(adapter, moveSubject)
          : null;

      dragRef.current = {
        downClientX: e.clientX,
        downClientY: e.clientY,
        downLocal: toHostLocal(e.clientX, e.clientY),
        hitAtDown,
        moved: false,
        moveCandidate,
        reorderCandidate,
      };
      setHoverId(null);
      setMarquee(null);
    },
    [
      adapter,
      store,
      view,
      transformModeAware,
      toHostLocal,
      setMarquee,
      eyedropperActive,
      sampleColorAt,
      pickAt,
      scopedAdapter,
    ],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button === 2) {
        secondaryPressRef.current = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          moved: false,
        };
        // Do not capture, prevent, or stop this event: the spatial viewport
        // underneath owns right-drag orbit/pan. This overlay owns only the
        // stationary-click menu handled above.
        return;
      }
      if (e.button === 0) onPrimaryPointerDown(e);
    },
    [onPrimaryPointerDown],
  );

  /** The active-drag half of `onPointerMove` (drag-threshold promotion +
   *  move-gesture promotion + marquee update) — factored into its OWN
   *  `useCallback` purely to keep `onPointerMove` itself under the
   *  cognitive-complexity ceiling; behavior is unchanged. */
  const handleActiveDrag = useCallback(
    (drag: DragState, e: ReactPointerEvent<HTMLElement>) => {
      const dx = e.clientX - drag.downClientX;
      const dy = e.clientY - drag.downClientY;
      if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.moved = true;
      if (!drag.moved) return;

      // D2: threshold crossed with a deferred move candidate — promote it to a
      // live move gesture NOW (not at pointerdown).
      if (drag.moveCandidate) {
        const g = promoteMoveCandidate(drag.moveCandidate, drag.downLocal);
        gestureRef.current = g;
        applyGesturePatch(g, e);
        return;
      }
      // D2.b: threshold crossed with a deferred reorder candidate — compute
      // the live insertion gap for the CURRENT pointer position and update
      // the preview (+ its drag-ghost). This is NOT a `GestureState` (no
      // `boxEdit` bracket — see `reorderPreviewRef`'s doc comment) so it has
      // no `promote*` step; every move while it's live just recomputes the
      // gap. `gap` can be `null` only when `siblingRects` is somehow empty
      // (the capability gate above should make this unreachable) — in that
      // case this deliberately falls through to NEITHER a preview NOR the
      // marquee branch below (guarded by the `return`), matching "does not
      // trigger marquee" for a reorder-candidate drag regardless.
      if (drag.reorderCandidate) {
        const local = toHostLocal(e.clientX, e.clientY);
        const gap = computeReorderGap(drag.reorderCandidate.siblingRects, local);
        if (gap) {
          setReorderPreview({
            id: drag.reorderCandidate.id,
            adapter: drag.reorderCandidate.adapter,
            gap,
          });
          setDragGhost(
            computeDragGhost(
              drag.reorderCandidate.origRect,
              local.x - drag.downLocal.x,
              local.y - drag.downLocal.y,
            ),
          );
        }
        return;
      }
      // Marquee only starts when the drag began over EMPTY space (no pick at
      // pointerdown) — a drag on a NON-candidate hit (unselected, or a
      // non-positioned node) is today's plain click-select, no marquee.
      if (drag.hitAtDown === null) {
        const local = toHostLocal(e.clientX, e.clientY);
        setMarquee({
          x: Math.min(drag.downLocal.x, local.x),
          y: Math.min(drag.downLocal.y, local.y),
          width: Math.abs(local.x - drag.downLocal.x),
          height: Math.abs(local.y - drag.downLocal.y),
        });
      }
    },
    [toHostLocal, setMarquee, applyGesturePatch, setReorderPreview],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // D4 — an armed pan-drag just writes the shared pan translate from the
      // client-space delta since pointerdown (client px, NOT `toHostLocal` —
      // the pan target IS the frame `toHostLocal` reads through, so this must
      // stay in the frame-independent client space); nothing else runs
      // underneath it.
      const panDrag = panDragRef.current;
      if (panDrag) {
        view.setPan(
          panDrag.startPan.x + (e.clientX - panDrag.startClientX),
          panDrag.startPan.y + (e.clientY - panDrag.startClientY),
        );
        return;
      }
      // D3.d — while an eyedropper session is open, every move just updates
      // the cursor-following preview swatch; no hover/drag/gesture logic runs
      // underneath it (a real color-at-point pick, not a selection gesture).
      if (eyedropperActive) {
        const local = toHostLocal(e.clientX, e.clientY);
        setEyedropperPreview({ ...local, color: sampleColorAt(e.clientX, e.clientY) });
        return;
      }
      const gesture = gestureRef.current;
      if (gesture) {
        applyGesturePatch(gesture, e);
        return;
      }
      // No button held — plain hover: pick under the cursor, draw a highlight.
      if ((e.buttons & 1) === 0) {
        updateViewportEditorControlHover(
          scopedAdapter,
          e.clientX,
          e.clientY,
          pickAt,
          setEditorControlCursor,
          setHoverId,
        );
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      handleActiveDrag(drag, e);
    },
    [
      store,
      view,
      toHostLocal,
      applyGesturePatch,
      eyedropperActive,
      sampleColorAt,
      handleActiveDrag,
      pickAt,
      scopedAdapter,
    ],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      releaseCapturedPointer(e);
      // D4 — releasing the pointer ends an armed pan-drag here, same early-
      // return precedent as `endGesture()`/the reorder-preview branch below:
      // a pan-drag never falls through to click-select.
      if (panDragRef.current) {
        panDragRef.current = null;
        setIsPanning(false);
        return;
      }
      // A gesture in progress commits+ends here and skips the ordinary
      // click-select logic below entirely (step 6).
      const gesture = gestureRef.current;
      if (gesture?.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
      if (endGesture()) return;
      // D2.b — a live reorder-preview commits here: ONE `structure.reorder`
      // call (on-contract since T0/D-1, so this lands on the existing
      // checksum-guarded whole-file undo/redo timeline — the same "one undo
      // step" property every other structural op in this file already has),
      // then clears the preview + ghost + drag state, skipping click-select
      // entirely (mirrors `endGesture`'s own early return above).
      const reorderPreviewNow = reorderPreviewRef.current;
      if (reorderPreviewNow) {
        setReorderPreview(null);
        setDragGhost(null);
        dragRef.current = null;
        reorderAuthoringNode(
          reorderPreviewNow.adapter,
          reorderPreviewNow.id,
          reorderPreviewNow.gap.beforeSiblingId,
        );
        return;
      }
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      const nextSelection =
        drag.hitAtDown !== null
          ? resolveClickSelection(store.selectedEntityIds, drag.hitAtDown, e.shiftKey)
          : resolveEmptySpaceSelection(adapter, drag.moved, marqueeRef.current, e.shiftKey);
      if (nextSelection !== null) setAuthoringSelection(adapter, nextSelection);
      setMarquee(null);
    },
    [adapter, store, setMarquee, endGesture, setReorderPreview],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      releaseCapturedPointer(e);
      // D4 — a cancelled pan-drag (e.g. pointer capture lost) just disarms;
      // there is nothing to commit (the pan writes were already live, same as
      // every other gesture's `apply` — cancelling a pan simply stops moving it
      // further, it does not revert, matching resize/move's own no-revert
      // cancel semantics below).
      if (panDragRef.current) {
        panDragRef.current = null;
        setIsPanning(false);
        return;
      }
      const gesture = gestureRef.current;
      if (gesture?.pointerId !== undefined && e.pointerId !== gesture.pointerId) return;
      if (endGesture()) return;
      // D2.b — a CANCELLED reorder drag (e.g. pointer capture lost) clears the
      // preview/ghost WITHOUT committing — unlike `onPointerUp` above, this is
      // never a "drop", so no `structure.reorder` call here.
      if (reorderPreviewRef.current) {
        setReorderPreview(null);
        setDragGhost(null);
      }
      dragRef.current = null;
      setMarquee(null);
    },
    [endGesture, setMarquee, setReorderPreview],
  );

  const onPointerLeave = useCallback(() => {
    if (!scopedAdapter) viewportEditorControls()?.clearHover();
    setEditorControlCursor(null);
    setHoverId(null);
  }, [scopedAdapter]);

  // D3.b — double-click picks the node and opens the inline text editor
  // through `adapter.text` (owner-routed — `textForId`), rule zero: no DOM
  // read of the node's own text happens here, only the contract's own
  // `TextProvider.get`. Absent `text` (the ingested react-dom adapter has
  // none) ⇒ silently nothing, matching D3.a's identical capability-gating
  // stance for structural items. A `null` get (dynamic body / has child
  // elements) is a LOUD, honest refusal — no textarea, a visible indicator +
  // a console.warn, mirroring the store's existing dynamic-write-refusal
  // pattern (`ReactRootAuthoringAdapter`'s own `console.warn` + re-render).
  const onDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      // The React design board owns frame-level double-click before DOM text
      // editing: single click selects in place; double-click is the explicit
      // Figma-style zoom/recenter gesture, including for the active frame.
      const overlayContainer = interactionRef.current?.parentElement ?? null;
      if (zoomReactStoryFrameAtPoint(overlayContainer, e.clientX, e.clientY)) return;
      const hitId = pickAt(e.clientX, e.clientY);
      if (!hitId) return;
      const provider = textForId(adapter, hitId);
      if (!provider) return;
      const rect = rectForId(adapter, hitId);
      if (!rect) return;
      const text = provider.get(hitId);
      if (text === null) {
        // biome-ignore lint/suspicious/noConsole: deliberate, greppable refusal report — mirrors ReactRootAuthoringAdapter's own console.warn refusal pattern
        console.warn(
          `[RootSelectionOverlay] text edit refused for "${hitId}": dynamic body or has ` +
            'child elements — not inline-editable.',
        );
        setTextEdit(null);
        setTextEditRefused({ id: hitId, rect });
        return;
      }
      setTextEditRefused(null);
      setTextEdit({ id: hitId, rect, initialText: text });
    },
    [adapter, pickAt, setTextEdit],
  );

  const commitTextEdit = useCallback(
    (text: string) => {
      const edit = textEditRef.current;
      if (!edit) return;
      const provider = textForId(adapter, edit.id);
      if (provider) {
        // D3.R1 (reopen fix) — `set` is fire-and-forget; stash id+rect so the
        // pending-commit effect above can surface the refused indicator once
        // the async write's own refusal-notify lands, instead of the edit
        // silently vanishing (the pre-fix bug: this closed the textarea
        // unconditionally and never checked the result at all).
        pendingTextCommitRef.current = { id: edit.id, rect: edit.rect };
        provider.set(edit.id, text);
      }
      setTextEdit(null);
    },
    [adapter, setTextEdit],
  );

  const cancelTextEdit = useCallback(() => setTextEdit(null), [setTextEdit]);

  if (!hasRectCapableChild(adapter)) return null;
  // The overlay is a DESIGN-TIME affordance and must be INERT whenever a real
  // game owns its own DOM/canvas and needs pointer events — Play, an ingested
  // unmodified game, or an auto-mounted `{ module }` adapter world — so this
  // component's full-cover `pointerEvents:'auto'` interaction layer never
  // swallows that game's own clicks (that regressed 20-ingest-react-rpg: the
  // menu→dungeon flow never advanced, the sprite never moved).
  //
  // Gate on the SAME "is a session like that actually active" predicates
  // `isPlayModeActive`/`isIngestActive`/`isModuleModeActive` already expose
  // (play-mode.ts / ingest/mount-ingest-root.ts / module-mode.ts) — NOT the coarser
  // `store.playState !== 'stopped'` flag a prior fix used here. That flag is
  // shared, multi-purpose editor state (it also drives tab-switching,
  // autosave suppression, etc.) and is `'playing'` for the ENTIRE lifetime of
  // those sessions, exactly like these predicates — so swapping in the
  // narrower, purpose-built signal changes nothing for the cases the prior
  // fix targeted. What it fixes: `mountDesignTimeLayers` (B1) mounts a LIVE,
  // editable `ReactRootAuthoringAdapter` for every non-focused react/pixi
  // world while the editor sits in ordinary stopped design-time editing
  // (27a's own scenario: select a react element, edit it, watch HMR settle)
  // — a session `playState` alone cannot distinguish from "a game is
  // running" the moment anything else in this growing multi-purpose flag's
  // surface touches it. Routing through the actual session predicates keeps
  // this component's own inertness tied to the ONE thing it actually cares
  // about (a foreign/first-party game owning the canvas), decoupled from
  // every other reason `playState` might change.
  if (isCanvasOwnedByARunningGame()) return null;

  // Play→Stop replaces the live Pixi tree and its adapter in separate React
  // commits. Selection intentionally survives that transition, but an id from
  // the previous tree must not be sent through owner-routed providers while
  // the replacement hierarchy is still mounting. `hierarchy.node` is the
  // merged, non-owner-routed membership check, so filtering here keeps the
  // overlay quiet for that one frame and lets stable ids resume naturally.
  const selectedIds = new Set(
    [...store.selectedEntityIds].filter((id) => adapter.hierarchy.node(id) !== undefined),
  );
  const hoverRect =
    hoverId !== null && !selectedIds.has(hoverId) ? rectForId(adapter, hoverId) : null;

  // B2/B3 — handles/rotate/dimension-label/spacing-bands render ONLY for
  // EXACTLY one selected node whose OWNER exposes `boxEdit` (spec:317 "render
  // ONLY when EXACTLY one node is selected AND its owner has boxEdit" —
  // multi-select keeps just the plain A3 boxes above). Computed by a
  // module-level helper purely to keep THIS function's own cognitive
  // complexity down.
  const single = computeSingleSelectionBoxEdit(adapter, selectedIds);
  const singleRect = single?.rect ?? null;
  const singleOwnerBoxEdit = single?.ownerBoxEdit ?? null;
  // A turned 2D node frames, handles and labels on its own box (Godot's 2D frame).
  const singleFrame = transformModeAware && single ? frameForId(adapter, single.id) : null;
  const singleTurned = singleFrame && frameIsTurned(singleFrame) ? singleFrame : null;
  const nativeGizmoOrigin =
    transformModeAware && single
      ? (single.ownerBoxEdit.gizmoOrigin?.(single.id) ?? {
          x: single.rect.x + single.rect.width / 2,
          y: single.rect.y + single.rect.height / 2,
        })
      : null;
  const nativeGizmoSpan = NATIVE_GIZMO_LENGTH_PX / pan.zoom;
  const referencePoint = single ? single.ownerBoxEdit.referencePoint?.(single.id) : null;
  const spacingBands = single?.spacingBands ?? [];

  // Adapter-owned component handles for the selection, in the SAME authored
  // frame as `rects` (an owner that answers in another frame is declined by
  // `spatialHandlesForId`). Exactly one selected node, mirroring every other
  // single-selection affordance above; `[]` for an owner with no handles, which
  // draws nothing at all.
  const spatialSelection = selectedIds.size === 1 ? [...selectedIds][0]! : null;
  const spatialHandles = spatialSelection ? spatialHandlesForId(adapter, spatialSelection) : null;
  const spatialLayers =
    spatialSelection && spatialHandles && store.showHelpers
      ? spatialHandles.layers(spatialSelection).filter((layer) => {
          const visibility = store.helperVisibility as Record<string, boolean | undefined>;
          // A category the shell does not name obeys the master Helpers toggle,
          // per the `SpatialHandleLayer` contract — never rejected for being
          // unknown.
          return visibility[layer.category] ?? true;
        })
      : [];

  // D1 — measure lines, position/parent-layout badge, parent-container
  // outline (all READ-only — spec §6). Computed by a module-level helper,
  // same "keep THIS function's own cognitive complexity down" reason
  // `computeSingleSelectionBoxEdit` above is factored out.
  const d1 = transformModeAware
    ? {
        selectedSingleRect: null,
        measureLines: [],
        positionBadge: null,
        showPositionBadge: false,
        parentRect: null,
      }
    : computeD1Affordances(adapter, selectedIds, hoverRect);

  // D4.b — the multi-select align/distribute toolbar's entries, or `null`
  // when it shouldn't render (see `computeMultiSelectionAlign`'s doc
  // comment for the capability gate).
  const alignEntries = transformModeAware ? null : computeMultiSelectionAlign(adapter, selectedIds);

  // D3.c — every currently-empty container hint reachable from the active
  // adapter (owner-routed per child, session-hidden roots excluded — see
  // `emptyContainerHintsFor`'s doc comment). Cached (see `emptyHintsCacheRef`
  // above) so a hover-only re-render reuses the last computed hints instead
  // of re-walking + re-measuring the whole tree.
  const emptyHintsCache = emptyHintsCacheRef.current;
  const emptyHints = transformModeAware
    ? []
    : emptyHintsCache &&
        emptyHintsCache.adapter === adapter &&
        emptyHintsCache.version === storeVersion
      ? emptyHintsCache.hints
      : (() => {
          const hints = emptyContainerHintsFor(adapter);
          emptyHintsCacheRef.current = { adapter, version: storeVersion, hints };
          return hints;
        })();

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: Z_INDEX,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={interactionRef}
        data-testid="world-selection-overlay-interaction"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
          touchAction: 'none',
          userSelect: 'none',
          cursor:
            editorControlCursor ??
            interactionCursor(isPanning, spaceHeld, eyedropperActive, !!marquee),
        }}
        onPointerDownCapture={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragOver={onAssetDragOver}
        onDrop={onAssetDrop}
      />
      {pickMenu ? (
        <ViewportPickMenu state={pickMenu} adapter={adapter} onClose={() => setPickMenu(null)} />
      ) : null}
      <div
        data-testid="world-selection-overlay-chrome"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          // Only visual chrome follows the authored world. The input sibling
          // above remains an untransformed, full-viewport hit surface.
          transform: panTransformValue(pan),
          transformOrigin: '0 0',
        }}
      >
        {/* D3.c — dashed empty-container placeholders, visual hints only. */}
        {!transformModeAware &&
          emptyHints.map((hint) => (
            <div
              key={hint.id}
              data-testid="world-empty-container-hint"
              data-entity-id={hint.id}
              title={hint.displayName}
              style={{
                position: 'absolute',
                left: hint.rect.x,
                top: hint.rect.y,
                width: hint.rect.width,
                height: hint.rect.height,
                // text-2 at 0.7 alpha — a quiet non-interactive hint outline.
                borderStyle: 'dashed',
                borderColor: 'rgba(154, 160, 166, 0.7)',
                borderWidth: transformModeAware ? 1 / pan.zoom : 1,
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          ))}
        {hoverRect && (
          <div
            data-testid="world-selection-hover"
            style={{
              ...boxStyle(hoverRect, false),
              ...(transformModeAware ? { borderWidth: 1 / pan.zoom } : {}),
            }}
          />
        )}
        {[...selectedIds].map((id) => {
          const r = rectForId(adapter, id);
          if (!r) return null;
          const frame = transformModeAware ? frameForId(adapter, id) : null;
          const turned = frame && frameIsTurned(frame) ? frame : null;
          return (
            <div key={id}>
              <div
                data-testid="world-selection-box"
                data-entity-id={id}
                data-turned={turned ? 'true' : undefined}
                style={{
                  ...(turned ? turnedBoxStyle(turned, 1 / pan.zoom) : boxStyle(r, true)),
                  ...(transformModeAware && !turned
                    ? {
                        // Pixi's alpha outline now owns selection emphasis.
                        // This remains the thin, distinct transform frame.
                        borderWidth: 1 / pan.zoom,
                        background: 'transparent',
                      }
                    : {}),
                }}
              />
              {!transformModeAware && (
                <div data-testid="world-selection-label" style={labelStyle(r)}>
                  {labelForId(adapter, id)}
                </div>
              )}
            </div>
          );
        })}
        {marquee && (
          <div
            data-testid="world-selection-marquee"
            style={{
              position: 'absolute',
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
              border: `1px solid ${ACCENT}`,
              background: `color-mix(in srgb, ${ACCENT} 10%, transparent)`,
              pointerEvents: 'none',
            }}
          />
        )}
        {!transformModeAware && (
          <D1Affordances
            measureLines={d1.measureLines}
            snapGuides={snapGuides}
            positionBadge={d1.positionBadge}
            showPositionBadge={d1.showPositionBadge}
            badgeAnchorRect={d1.selectedSingleRect}
            parentRect={d1.parentRect}
            screenScale={chromeScale}
            screenZoom={1}
          />
        )}
        {!transformModeAware && (
          <D2Affordances dragGhost={dragGhost} reorderPreview={reorderPreview} />
        )}
        {!transformModeAware && alignEntries && (
          <AlignToolbar adapter={adapter} entries={alignEntries} />
        )}
        {singleRect && singleOwnerBoxEdit && (
          <>
            {/* B-fix (D1-visual + D4 review): the B3 spacing bands render
             *  BEFORE the resize handles below — deliberately, so the handles
             *  paint ON TOP wherever their small hit box overlaps a band. A
             *  zero-value side still renders a `ZERO_STRIP_PX` grab-strip
             *  (spec B3) flush against the rect edge, and a mid-edge handle's
             *  clickable CENTER point sits exactly on that same edge — pre-fix,
             *  the bands rendered AFTER the handles (reverse of this order) and
             *  so sat on top in DOM/paint order, silently eating the
             *  pointerdown meant for the handle (n/s/e/w all affected; the
             *  corner handles were not — a corner's point always lands on the
             *  EXCLUSIVE far edge of its two adjacent bands). This is a pure
             *  DOM-order swap: the band geometry/hit area is UNCHANGED, so
             *  every band remains fully draggable everywhere it isn't directly
             *  shadowed by a handle's own small box. */}
            {!transformModeAware &&
              spacingBands.map((band) => (
                <div key={band.side}>
                  <div
                    data-testid={`world-spacing-${band.kind}-${spacingDirection(band.side)}`}
                    style={spacingBandStyle(band)}
                    onPointerDown={(e) => startSpacingGesture(band, e)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                  />
                  {!band.isZero && (
                    <div
                      style={{
                        ...spacingLabelStyle(band),
                        ...(transformModeAware
                          ? {
                              transform: `translate(-50%, -50%) scale(${chromeScale})`,
                              transformOrigin: 'center',
                            }
                          : {}),
                      }}
                    >
                      {Math.round(band.value)}
                    </div>
                  )}
                </div>
              ))}
            {referencePoint && (
              <div
                aria-label={`Edit ${referencePoint.label}`}
                data-reference-kind={referencePoint.kind}
                data-testid="world-reference-point-handle"
                title={`${referencePoint.label} (${referencePoint.bounded ? 'native corner/edge/center snap' : '8px/alignment snap'}, Alt for free movement)`}
                style={{
                  ...referencePointStyle(referencePoint),
                  ...(transformModeAware
                    ? {
                        transform: `scale(${chromeScale})`,
                        transformOrigin: 'center',
                      }
                    : {}),
                }}
                onPointerDown={(event) => startReferenceGesture(referencePoint, event)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onLostPointerCapture={onPointerCancel}
                role="button"
                tabIndex={0}
              >
                {referencePoint.kind === 'anchor' ? 'A' : 'P'}
              </div>
            )}
            {/* Adapter-owned component handles — the ONE draggable point per
                entry, drawn where the provider says it is. The 3D viewport
                draws the same contract's layers by raycast; this is the same
                data in the surface where a 2D world is actually painted. */}
            {spatialSelection &&
              spatialHandles &&
              spatialLayers.flatMap((layer) =>
                layer.handles.map((handle) => (
                  <div
                    aria-label={handle.label}
                    data-testid="world-spatial-handle"
                    data-handle-id={handle.id}
                    data-writable={handle.writable}
                    key={`${layer.id}:${handle.id}`}
                    role="button"
                    tabIndex={0}
                    title={handle.writable ? handle.label : `${handle.label} — ${handle.reason}`}
                    style={{
                      ...spatialHandleStyle(handle),
                      transform: `translate(-50%, -50%) scale(${chromeScale})`,
                    }}
                    onPointerDown={(event) =>
                      onSpatialHandleDown(spatialSelection, spatialHandles, handle, event)
                    }
                    onPointerMove={onSpatialHandleMove}
                    onPointerUp={onSpatialHandleUp}
                    onPointerCancel={onSpatialHandleUp}
                    onLostPointerCapture={onSpatialHandleUp}
                  />
                )),
              )}
            {transformModeAware && store.transformMode === 'translate' && (
              <>
                <div
                  data-testid="world-2d-move-axis-x"
                  title="Move on X axis"
                  style={{
                    position: 'absolute',
                    left: nativeGizmoOrigin!.x,
                    top: nativeGizmoOrigin!.y - 5 / pan.zoom,
                    width: nativeGizmoSpan,
                    height: 10 / pan.zoom,
                    borderTop: `${2 / pan.zoom}px solid #ef5350`,
                    boxSizing: 'border-box',
                    cursor: 'ew-resize',
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={(event) => startMoveGizmoGesture('x', event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
                <div
                  data-testid="world-2d-move-axis-y"
                  title="Move on Y axis"
                  style={{
                    position: 'absolute',
                    left: nativeGizmoOrigin!.x - 5 / pan.zoom,
                    top: nativeGizmoOrigin!.y,
                    width: 10 / pan.zoom,
                    height: nativeGizmoSpan,
                    borderLeft: `${2 / pan.zoom}px solid #66bb6a`,
                    boxSizing: 'border-box',
                    cursor: 'ns-resize',
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={(event) => startMoveGizmoGesture('y', event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
                <div
                  data-testid="world-2d-move-center"
                  title="Move freely"
                  style={{
                    position: 'absolute',
                    left: nativeGizmoOrigin!.x - 5 / pan.zoom,
                    top: nativeGizmoOrigin!.y - 5 / pan.zoom,
                    width: 10 / pan.zoom,
                    height: 10 / pan.zoom,
                    border: '1px solid rgba(255,255,255,.9)',
                    background: '#4aa3ff',
                    boxSizing: 'border-box',
                    cursor: 'move',
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={(event) => startMoveGizmoGesture('both', event)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
              </>
            )}
            {transformArms(transformModeAware, store.transformMode, 'scale') &&
              (axisGizmos ? (
                <>
                  <div
                    data-testid="world-2d-scale-axis-x"
                    style={{
                      position: 'absolute',
                      left: nativeGizmoOrigin!.x,
                      top: nativeGizmoOrigin!.y,
                      width: nativeGizmoSpan,
                      borderTop: `${2 / pan.zoom}px solid #ef5350`,
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    data-testid="world-2d-scale-axis-y"
                    style={{
                      position: 'absolute',
                      left: nativeGizmoOrigin!.x,
                      top: nativeGizmoOrigin!.y,
                      height: nativeGizmoSpan,
                      borderLeft: `${2 / pan.zoom}px solid #66bb6a`,
                      pointerEvents: 'none',
                    }}
                  />
                  {(
                    [
                      ['x', 'ew-resize'],
                      ['y', 'ns-resize'],
                      ['both', 'nwse-resize'],
                    ] as const
                  ).map(([axis, cursor]) => {
                    const point = nativeScaleHandlePoint(axis, nativeGizmoOrigin!, nativeGizmoSpan);
                    const testId = axis === 'x' ? 'e' : axis === 'y' ? 's' : 'se';
                    return (
                      <div
                        key={axis}
                        data-testid={`world-resize-handle-${testId}`}
                        style={{
                          ...handleStyle(point, cursor),
                          transform: `scale(${chromeScale})`,
                          transformOrigin: 'center',
                          background: axis === 'x' ? '#ef5350' : axis === 'y' ? '#66bb6a' : '#fff',
                        }}
                        onPointerDown={(event) => startNativeScaleGesture(axis, event)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                      />
                    );
                  })}
                </>
              ) : (
                <>
                  {RESIZE_HANDLES.map(({ pos, cursor }) => (
                    <div
                      key={pos}
                      data-testid={`world-resize-handle-${pos}`}
                      style={{
                        ...handleStyle(
                          singleTurned ? frameHandlePosition(singleTurned, pos) : handlePosition(singleRect, pos),
                          cursor,
                        ),
                        ...(transformModeAware
                          ? {
                              transform: singleTurned
                                ? `rotate(${frameAngle(singleTurned)}rad) scale(${chromeScale})`
                                : `scale(${chromeScale})`,
                              transformOrigin: 'center',
                            }
                          : {}),
                      }}
                      onPointerDown={(event) => startResizeGesture(pos, event)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerCancel}
                    />
                  ))}
                  <div
                    data-testid="world-resize-dimension-label"
                    style={{
                      ...dimensionLabelStyle(singleRect),
                      ...(transformModeAware
                        ? {
                            top: singleRect.y + singleRect.height + 4 * chromeScale,
                            transform: `scale(${chromeScale})`,
                            transformOrigin: 'top left',
                          }
                        : {}),
                    }}
                  >
                    {singleTurned
                      ? `${Math.round(Math.hypot(singleTurned.tr.x - singleTurned.tl.x, singleTurned.tr.y - singleTurned.tl.y))}×${Math.round(
                          Math.hypot(singleTurned.bl.x - singleTurned.tl.x, singleTurned.bl.y - singleTurned.tl.y),
                        )}`
                      : `${Math.round(singleRect.width)}×${Math.round(singleRect.height)}`}
                  </div>
                </>
              ))}
            {transformArms(transformModeAware, store.transformMode, 'rotate') && (
              <>
                {axisGizmos && (
                  <div
                    data-testid="world-2d-rotate-ring"
                    style={{
                      position: 'absolute',
                      left: nativeGizmoOrigin!.x - 40 / pan.zoom,
                      top: nativeGizmoOrigin!.y - 40 / pan.zoom,
                      width: 80 / pan.zoom,
                      height: 80 / pan.zoom,
                      border: `${1 / pan.zoom}px solid #4aa3ff`,
                      borderRadius: '50%',
                      boxSizing: 'border-box',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                <div
                  data-testid="world-rotate-handle"
                  aria-label="Rotate selection"
                  title="Rotate selection (15° snap, Alt for free rotation)"
                  style={{
                    ...rotateHandleStyle(singleRect),
                    ...(transformModeAware && !axisGizmos
                      ? {
                          ...turnedRotateHandlePosition(singleTurned, singleRect, ROTATE_OFFSET * chromeScale),
                          transform: `scale(${chromeScale})`,
                          transformOrigin: 'center',
                        }
                      : {}),
                    ...(axisGizmos
                      ? {
                          left: nativeGizmoOrigin!.x - ROTATE_SIZE / 2,
                          top: nativeGizmoOrigin!.y - 40 / pan.zoom - ROTATE_SIZE / 2,
                          transform: `scale(${chromeScale})`,
                          transformOrigin: 'center',
                          background: '#4aa3ff',
                        }
                      : {}),
                  }}
                  onPointerDown={startRotateGesture}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  role="button"
                  tabIndex={0}
                />
              </>
            )}
          </>
        )}
        {!transformModeAware && (
          <D3Affordances
            textEdit={textEdit}
            onCommitTextEdit={commitTextEdit}
            onCancelTextEdit={cancelTextEdit}
            textEditRefused={textEditRefused}
            eyedropperActive={eyedropperActive}
            eyedropperPreview={eyedropperPreview}
          />
        )}
      </div>
    </div>
  );
}

/**
 * D2Affordances — the D2.a drag-ghost + D2.b reorder-preview marker,
 * factored into its OWN component for the SAME reason `D3Affordances` below
 * is: keeps `RootSelectionOverlay`'s own cognitive complexity down (two
 * independent conditional renders, bundled here at zero cost to the parent
 * beyond one element reference). No behavior change from having them inline.
 */
/**
 * D1Affordances — the D1 measurement + snap-guide + badge + parent-outline
 * overlay bits, factored into its OWN component for the SAME reason
 * `D2Affordances`/`D3Affordances` are (keeps `RootSelectionOverlay`'s own
 * cognitive complexity down; no behavior change from having them inline).
 * All four are READ-only visual affordances (spec §6 D1) — none of them
 * drives a commit path.
 */
function D1Affordances(props: {
  measureLines: MeasureLine[];
  snapGuides: SnapGuide[];
  positionBadge: PositionBadgeInfo | null;
  showPositionBadge: boolean;
  badgeAnchorRect: DOMRectLike | null;
  parentRect: DOMRectLike | null;
  screenScale: number;
  screenZoom: number;
}): React.ReactNode {
  const {
    measureLines,
    snapGuides,
    positionBadge,
    showPositionBadge,
    badgeAnchorRect,
    parentRect,
    screenScale,
    screenZoom,
  } = props;
  return (
    <>
      {/* D1.c — the parent-container outline, drawn BEHIND the selection/
          hover boxes (DOM order) so it never visually competes with them. */}
      {parentRect && (
        <div data-testid="world-parent-outline" style={parentOutlineStyle(parentRect)} />
      )}
      {/* D1.a — sibling-distance measure line(s) between the selection and
          the hovered sibling, each with two end-caps + a px value label. */}
      {measureLines.map((line) => (
        <div key={line.orientation} data-testid="world-measure-line">
          <div style={measureLineStyle(line)} />
          <div style={measureCapStyle(line.x1, line.y1, line.orientation === 'horizontal')} />
          <div style={measureCapStyle(line.x2, line.y2, line.orientation === 'horizontal')} />
          <div
            data-testid="world-measure-line-label"
            style={{
              ...measureLabelStyle(line),
              ...(screenScale !== 1
                ? {
                    transform: `translate(-50%, -50%) scale(${screenScale})`,
                    transformOrigin: 'center',
                  }
                : {}),
            }}
          >
            {line.distance}
          </div>
        </div>
      ))}
      {/* D1.b — the currently-engaged alignment/snap guide(s), live only
          while a B2 move/resize gesture's own edge-snap is engaged. */}
      {snapGuides.map((guide) => (
        // At most ONE guide per orientation (`computeMoveSnapGuides`/
        // `computeResizeSnapGuides` each push ≤1 vertical + ≤1 horizontal),
        // so `orientation` alone is a stable, unique key — no array index.
        <div key={guide.orientation} data-testid="world-snap-guide" style={snapGuideStyle(guide)} />
      ))}
      {/* D1.c — the position/parent-layout badge; each segment renders only
          when its own value resolved (never a fabricated default). */}
      {showPositionBadge && badgeAnchorRect && positionBadge && (
        <div
          data-testid="world-position-badge"
          style={{
            ...positionBadgeStyle(badgeAnchorRect),
            ...(screenScale !== 1
              ? {
                  top: badgeAnchorRect.y - 36 / screenZoom,
                  transform: `scale(${screenScale})`,
                  transformOrigin: 'top left',
                }
              : {}),
          }}
        >
          {positionBadge.position && (
            <span data-testid="world-position-badge-mode" style={BADGE_SEGMENT_STYLE}>
              {positionBadge.position}
            </span>
          )}
          {positionBadge.parentLayout && (
            <span data-testid="world-position-badge-layout" style={BADGE_SEGMENT_STYLE}>
              {positionBadge.parentLayout}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function D2Affordances(props: {
  dragGhost: Rect | null;
  reorderPreview: { gap: ReorderGap } | null;
}): React.ReactNode {
  const { dragGhost, reorderPreview } = props;
  return (
    <>
      {/* D2.a — the drag-ghost, live during a B2 move gesture OR a D2.b
          reorder-preview drag. Pure visual, never a commit path. */}
      {dragGhost && <div data-testid="world-drag-ghost" style={dragGhostStyle(dragGhost)} />}
      {/* D2.b — the live reorder-preview marker at the gap the drop would
          land in. */}
      {reorderPreview && (
        <div
          data-testid="world-reorder-preview"
          style={reorderMarkerStyle(reorderPreview.gap.marker)}
        />
      )}
    </>
  );
}

/**
 * D3Affordances — the D3.b/d overlay bits (inline text editor + its refusal
 * indicator, eyedropper swatch), factored into its OWN
 * component purely to keep `RootSelectionOverlay`'s own cognitive
 * complexity down (each is an independent, mutually-exclusive-in-practice
 * conditional render — bundling them here costs the PARENT nothing beyond
 * one element reference). No behavior change from having them inline.
 */
function D3Affordances(props: {
  textEdit: { id: string; rect: DOMRectLike; initialText: string } | null;
  onCommitTextEdit: (text: string) => void;
  onCancelTextEdit: () => void;
  textEditRefused: { id: string; rect: DOMRectLike } | null;
  eyedropperActive: boolean;
  eyedropperPreview: { x: number; y: number; color: string | null } | null;
}): React.ReactNode {
  const {
    textEdit,
    onCommitTextEdit,
    onCancelTextEdit,
    textEditRefused,
    eyedropperActive,
    eyedropperPreview,
  } = props;
  return (
    <>
      {/* D3.b — the inline text editor (double-click), or the loud "not
          editable" refusal indicator for a dynamic/child-bearing body. */}
      {textEdit && (
        <div style={{ pointerEvents: 'auto' }}>
          <RootTextEditor
            rect={textEdit.rect}
            initialText={textEdit.initialText}
            onCommit={onCommitTextEdit}
            onCancel={onCancelTextEdit}
          />
        </div>
      )}
      {textEditRefused && (
        <div
          data-testid="world-text-edit-refused"
          title="dynamic body — not inline-editable"
          style={{
            position: 'absolute',
            left: textEditRefused.rect.x,
            top: textEditRefused.rect.y,
            width: Math.max(textEditRefused.rect.width, 40),
            height: Math.max(textEditRefused.rect.height, 20),
            border: `2px dashed ${themeVars.semantic.danger}`,
            boxSizing: 'border-box',
            background: themeVars.semantic.dangerMuted,
            pointerEvents: 'none',
          }}
        />
      )}
      {/* D3.d — the fallback eyedropper cursor swatch: a resolved color, or an
          explicit "unknown" state — NEVER a fabricated color. */}
      {eyedropperActive && eyedropperPreview && (
        <div
          data-testid="world-eyedropper-swatch"
          data-color-state={eyedropperPreview.color ? 'resolved' : 'unknown'}
          style={{
            position: 'absolute',
            left: eyedropperPreview.x + 12,
            top: eyedropperPreview.y + 12,
            width: 24,
            height: 24,
            borderRadius: 4,
            border: '2px solid #fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
            background:
              eyedropperPreview.color ??
              'repeating-linear-gradient(45deg, #999, #999 4px, #ccc 4px, #ccc 8px)',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}

/** `paddingTop`/`marginTop` → `'top'`, etc. — the direction suffix in each
 *  spacing band's `data-testid` (spec's own `world-spacing-{padding|margin}-
 *  {top|right|bottom|left}` naming). */
function spacingDirection(side: SpacingSide): 'top' | 'right' | 'bottom' | 'left' {
  if (side.endsWith('Top')) return 'top';
  if (side.endsWith('Right')) return 'right';
  if (side.endsWith('Bottom')) return 'bottom';
  return 'left';
}
