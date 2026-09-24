/**
 * world-overlay-gestures — spec 27 §4 B2/B3 pure gesture math, factored out of
 * `RootSelectionOverlay.tsx` so the handle/spacing-band geometry and the
 * per-gesture patch math are directly unit-testable without mounting React
 * (same "exported pure fn" convention `RootSelectionOverlay.tsx` already uses
 * for `resolveClickSelection`/`resolveEmptySpaceSelection`).
 *
 * DRIFT FLAG (per this task's executor brief): the spec cites an external
 * `visual-edit/overlay.tsx` (`RESIZE_HANDLES`, rotate cursors, `spacingZone`)
 * that does not exist in this repo. The handle table and the padding/margin
 * band geometry below are derived FRESH from the spec text (§4 B2/B3, §5's
 * "lose nothing" rows :459-467) plus the in-repo SE-handle precedent
 * `ui-editor/overlay.tsx` (`GRID = 8` snap, `Handle` ~10×10 white/accent box,
 * `startResize`, the dashed gap-measure label pattern) — noted again in this
 * repo's PR message per the brief's instruction.
 *
 * Rule zero (spec §0): pure geometry/math only — no store reach-in, no
 * `THREE.`, no `elementFromPoint`. The two adapter-routing helpers
 * (`boxEditForId`/`structureCapableForId`) talk ONLY to the `AuthoringAdapter`
 * contract, cloning `RootSelectionOverlay.tsx`'s own `rectForId` composite→
 * owner-child routing pattern (`rects`/`boxEdit`/`structure` are deliberately
 * NOT merged onto `CompositeAuthoringAdapter` — only `inspector`/`hierarchy`
 * are).
 */
import type {
  AuthoringAdapter,
  BoxEditProvider,
  ColorSampleProvider,
  DOMRectLike,
  SpatialHandlesProvider,
  StructureProvider,
  TextProvider,
} from '@volter/editor-project/adapter';
import { CompositeAuthoringAdapter } from '../authoring/composite-authoring-adapter';
import { spatialHandlesForAdapter } from '../authoring/consumer-actions';
import { numericStyleValue } from '@volter/editor-sdk/css-numeric-style';
import { isRootHidden } from '../authoring/world-session-state';
import { recordAuthoringConsumerUse } from '../coverage/authoring-seam-evidence';

/** 8px snap grid — same constant `ui-editor/overlay.tsx`'s `GRID` uses (K3). */
export const GRID = 8;

/** Minimum resized dimension (px) — mirrors `ui-editor/overlay.tsx`'s own
 *  `Math.max(8, snap(...))` resize clamp. */
export const MIN_SIZE = 8;

export type HandlePos = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/** The 8 resize handles (spec:317, §5 :465 "8 resize handles"), each with the
 *  cursor a figma-grade editor uses for that axis: corner handles get the
 *  diagonal (nwse/nesw) cursor, edge handles the straight (ns/ew) cursor. */
export const RESIZE_HANDLES: ReadonlyArray<{ pos: HandlePos; cursor: string }> = [
  { pos: 'nw', cursor: 'nwse-resize' },
  { pos: 'n', cursor: 'ns-resize' },
  { pos: 'ne', cursor: 'nesw-resize' },
  { pos: 'w', cursor: 'ew-resize' },
  { pos: 'e', cursor: 'ew-resize' },
  { pos: 'sw', cursor: 'nesw-resize' },
  { pos: 's', cursor: 'ns-resize' },
  { pos: 'se', cursor: 'nwse-resize' },
];

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a handle sits on `rect` — the handle's CENTER point (the caller
 *  offsets by half the handle's rendered size to place its box). */
export function handlePosition(rect: RectLike, pos: HandlePos): { x: number; y: number } {
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  switch (pos) {
    case 'nw':
      return { x: rect.x, y: rect.y };
    case 'n':
      return { x: midX, y: rect.y };
    case 'ne':
      return { x: rect.x + rect.width, y: rect.y };
    case 'w':
      return { x: rect.x, y: midY };
    case 'e':
      return { x: rect.x + rect.width, y: midY };
    case 'sw':
      return { x: rect.x, y: rect.y + rect.height };
    case 's':
      return { x: midX, y: rect.y + rect.height };
    case 'se':
      return { x: rect.x + rect.width, y: rect.y + rect.height };
  }
}

/** `v => e.altKey ? Math.round(v) : Math.round(v/GRID)*GRID` (spec:319 "8px
 *  grid snap, Alt = free") — shared by resize/move gesture math below. */
export function snapValue(v: number, free: boolean): number {
  return free ? Math.round(v) : Math.round(v / GRID) * GRID;
}

/**
 * Per-handle resize patch math (spec:321-322): east-side handles grow width
 * by `+dx`; west-side handles shrink width by `dx` AND (only for an
 * absolutely/fixed-positioned node) move `x` by `dx` too (there is no `left`
 * to adjust on a static/relative node — non-absolute nodes resize SIZE only,
 * spec:322). South/north are the `height`/`y` analogue on the vertical axis.
 * A corner handle (e.g. `se`) touches both axes at once. Width/height are
 * clamped to {@link MIN_SIZE}.
 *
 * D1 (spec §6) — `context`, when supplied and `free` is false, additionally
 * edge-snaps the DRAGGED edge (only — the anchored opposite edge never moves,
 * unlike the move gesture where either edge may align) to the owner's own
 * `contextRects(id)` padding-box/sibling edges, within `threshold`, taking
 * priority over the plain 8px grid snap already applied above — same
 * "edge-align wins over grid" precedence {@link computeMovePatch} uses. The
 * VISUAL guide this same decision drives is the separate, pure
 * {@link computeResizeSnapGuides} (this function's own return shape — a
 * style-prop patch — stays exactly what the 8 pre-D1 tests above expect).
 */
/** EAST-handle width math (grid-snap, then optional edge-snap of the moving
 *  RIGHT edge) — factored out of {@link computeResizePatch} purely to keep
 *  ITS cognitive complexity down; behavior unchanged from the pre-D1 inline
 *  version. Also returns the matched snap candidate (`null` if none), so
 *  {@link computeResizeSnapGuides} can reuse this SAME computation for its
 *  guide geometry instead of re-deriving it (no drift between the patch the
 *  gesture commits and the guide it shows while committing it). */
function resizeEastWidth(
  dx: number,
  orig: RectLike,
  free: boolean,
  xCandidates: readonly SnapEdgeCandidate[],
  threshold: number,
): { value: number; match: SnapEdgeCandidate | null } {
  let width = Math.max(MIN_SIZE, snapValue(orig.width + dx, free));
  let match: SnapEdgeCandidate | null = null;
  if (xCandidates.length) {
    match = edgeSnapPoint(orig.x + width, xCandidates, threshold);
    if (match) width = Math.max(MIN_SIZE, match.edge - orig.x);
  }
  return { value: width, match };
}

/** WEST-handle width math: the WEST handle drags the left edge while the
 *  EAST edge stays anchored. Snap+clamp the width first, then derive x FROM
 *  the clamped width so the east edge is pinned: `x = eastEdge - width`.
 *  Deriving x independently (`orig.x + dx`) breaks under the MIN clamp —
 *  D3: over-dragging past the east edge pinned width at MIN but let x keep
 *  following the cursor, so the anchored east edge teleported and the
 *  resize became a move. This formula also preserves the
 *  `x + width == eastEdge` invariant for a non-multiple-of-8 drag, which
 *  the old independent per-axis snap could violate. Factored out of
 *  {@link computeResizePatch} for the same complexity/reuse reasons as
 *  {@link resizeEastWidth}. */
function resizeWestWidth(
  dx: number,
  orig: RectLike,
  free: boolean,
  xCandidates: readonly SnapEdgeCandidate[],
  threshold: number,
): { value: number; eastEdge: number; match: SnapEdgeCandidate | null } {
  const eastEdge = orig.x + orig.width;
  let width = Math.max(MIN_SIZE, snapValue(orig.width - dx, free));
  let match: SnapEdgeCandidate | null = null;
  if (xCandidates.length) {
    match = edgeSnapPoint(eastEdge - width, xCandidates, threshold);
    if (match) width = Math.max(MIN_SIZE, eastEdge - match.edge);
  }
  return { value: width, eastEdge, match };
}

/** SOUTH-handle height math — the vertical analogue of
 *  {@link resizeEastWidth}. */
function resizeSouthHeight(
  dy: number,
  orig: RectLike,
  free: boolean,
  yCandidates: readonly SnapEdgeCandidate[],
  threshold: number,
): { value: number; match: SnapEdgeCandidate | null } {
  let height = Math.max(MIN_SIZE, snapValue(orig.height + dy, free));
  let match: SnapEdgeCandidate | null = null;
  if (yCandidates.length) {
    match = edgeSnapPoint(orig.y + height, yCandidates, threshold);
    if (match) height = Math.max(MIN_SIZE, match.edge - orig.y);
  }
  return { value: height, match };
}

/** NORTH-handle height math — the vertical analogue of
 *  {@link resizeWestWidth} (the SOUTH edge is the anchor). */
function resizeNorthHeight(
  dy: number,
  orig: RectLike,
  free: boolean,
  yCandidates: readonly SnapEdgeCandidate[],
  threshold: number,
): { value: number; southEdge: number; match: SnapEdgeCandidate | null } {
  const southEdge = orig.y + orig.height;
  let height = Math.max(MIN_SIZE, snapValue(orig.height - dy, free));
  let match: SnapEdgeCandidate | null = null;
  if (yCandidates.length) {
    match = edgeSnapPoint(southEdge - height, yCandidates, threshold);
    if (match) height = Math.max(MIN_SIZE, southEdge - match.edge);
  }
  return { value: height, southEdge, match };
}

/** The x-axis half of {@link computeResizePatch} — `width` (+`x` if
 *  `isPositioned` and the WEST handle moved) for whichever of `pos`'s x-side
 *  (east/west/neither) applies. Factored out purely to keep
 *  `computeResizePatch` itself under the complexity ceiling. */
function resizeXPatch(
  pos: HandlePos,
  dx: number,
  orig: RectLike,
  isPositioned: boolean,
  free: boolean,
  xCandidates: readonly SnapEdgeCandidate[],
  threshold: number,
): Record<string, number> {
  if (pos === 'e' || pos === 'ne' || pos === 'se') {
    return { width: resizeEastWidth(dx, orig, free, xCandidates, threshold).value };
  }
  if (pos === 'w' || pos === 'nw' || pos === 'sw') {
    const { value: width, eastEdge } = resizeWestWidth(dx, orig, free, xCandidates, threshold);
    return isPositioned ? { width, x: eastEdge - width } : { width };
  }
  return {};
}

/** The y-axis analogue of {@link resizeXPatch} (south/north). */
function resizeYPatch(
  pos: HandlePos,
  dy: number,
  orig: RectLike,
  isPositioned: boolean,
  free: boolean,
  yCandidates: readonly SnapEdgeCandidate[],
  threshold: number,
): Record<string, number> {
  if (pos === 's' || pos === 'sw' || pos === 'se') {
    return { height: resizeSouthHeight(dy, orig, free, yCandidates, threshold).value };
  }
  if (pos === 'n' || pos === 'nw' || pos === 'ne') {
    const { value: height, southEdge } = resizeNorthHeight(dy, orig, free, yCandidates, threshold);
    return isPositioned ? { height, y: southEdge - height } : { height };
  }
  return {};
}

export function computeResizePatch(
  pos: HandlePos,
  dx: number,
  dy: number,
  orig: RectLike,
  isPositioned: boolean,
  free: boolean,
  context?: MoveSnapContext,
  threshold = EDGE_SNAP_THRESHOLD_PX,
): Record<string, number> {
  const targets = !free && context ? snapTargetsForContext(context) : null;
  const xCandidates = targets ? xEdgeCandidates(targets) : [];
  const yCandidates = targets ? yEdgeCandidates(targets) : [];
  return {
    ...resizeXPatch(pos, dx, orig, isPositioned, free, xCandidates, threshold),
    ...resizeYPatch(pos, dy, orig, isPositioned, free, yCandidates, threshold),
  };
}

/** Snap-target context for a move gesture — the owner's own
 *  `rects.contextRects(id)` shape (padding box + sibling rects), reduced to
 *  just the two fields the edge-snap below consumes. Reused, unchanged, by
 *  the D1 resize-snap path below (same shape, same source — a single
 *  `contextRectsForId` call at gesture start covers both). */
export interface MoveSnapContext {
  paddingBox?: DOMRectLike;
  siblings?: readonly DOMRectLike[];
  /** D1 (spec §6) — the immediate parent's own rect, unused by the
   *  edge-snap math above but carried through so a single
   *  `contextRectsForId(adapter, id)` call also feeds the D1.c
   *  parent-container outline (`RootSelectionOverlay.tsx`), without a
   *  narrower return type silently dropping the field the underlying
   *  `RectProvider.contextRects` already returns. */
  parent?: DOMRectLike;
  /** Persistent BOARD GUIDE edges in HOST-RELATIVE coordinates (the owner's
   *  `contextRects` converts them — see `board-guides.ts`). Merged into the
   *  same x/y edge-candidate pools the padding box and siblings feed, so
   *  move/resize snapping and the D1 guide visuals engage on a user-placed
   *  guide exactly the way they do on a sibling edge. */
  guideEdges?: { x?: readonly number[]; y?: readonly number[] };
}

/** ±4px — same threshold both the B2 move/resize edge-snap MATH and the D1
 *  snap-guide VISIBILITY below use, so a guide is shown if and only if the
 *  gesture it describes actually engaged (spec:321 "within ±4px prefer
 *  edge-alignment ... over the grid"; spec §6 D1 "snapping engages within
 *  threshold"). */
export const EDGE_SNAP_THRESHOLD_PX = 4;

/** One candidate target edge for edge-snapping: its coordinate (x for a
 *  vertical/left-right edge, y for a horizontal/top-bottom edge) paired with
 *  the SOURCE rect it came from (the parent padding box or a sibling) — the
 *  source rect is what a D1 snap guide spans across (see
 *  {@link computeMoveSnapGuides}/{@link computeResizeSnapGuides}). */
interface SnapEdgeCandidate {
  edge: number;
  rect: RectLike;
}

/** `context`'s padding-box + sibling rects (zero-area siblings dropped) — the
 *  shared first step both the x/y candidate builders below start from.
 *
 *  It used to call `ui-source/inspect.ts`'s `computeSnapTargets`, which insets
 *  a parent rect by a PADDING box and then filters. This call site has always
 *  passed zero padding — `context.paddingBox` is already the inset rect the
 *  adapter measured — so the inset half was dead here, and the one live half
 *  is the filter below. That single import was also the host's overlay bus
 *  reaching the DOM inspection estate, carrying `inspect.ts` and the inference
 *  diagnostics it reads into every editor boot (measured 2026-09-18, phase 1
 *  unit 9 of the open-source launch: two files). */
function snapTargetsForContext(context: MoveSnapContext): {
  paddingBox: RectLike;
  siblingRects: RectLike[];
  guideX: readonly number[];
  guideY: readonly number[];
} {
  return {
    paddingBox: context.paddingBox ?? { x: 0, y: 0, width: 0, height: 0 },
    siblingRects: (context.siblings ?? []).filter((r) => r.width > 0 && r.height > 0),
    guideX: context.guideEdges?.x ?? [],
    guideY: context.guideEdges?.y ?? [],
  };
}

/** The x-axis (left/right) snap candidates — the parent padding box's own
 *  left/right edges plus every sibling's left/right edges. */
function xEdgeCandidates(targets: {
  paddingBox: RectLike;
  siblingRects: RectLike[];
  guideX?: readonly number[];
}): SnapEdgeCandidate[] {
  const out: SnapEdgeCandidate[] = [
    { edge: targets.paddingBox.x, rect: targets.paddingBox },
    { edge: targets.paddingBox.x + targets.paddingBox.width, rect: targets.paddingBox },
  ];
  for (const r of targets.siblingRects) {
    out.push({ edge: r.x, rect: r });
    out.push({ edge: r.x + r.width, rect: r });
  }
  // A board guide spans the whole board: give its candidate a tall thin rect
  // so the D1 alignment guide drawn from the match visibly runs along it.
  for (const edge of targets.guideX ?? []) {
    out.push({ edge, rect: { x: edge, y: -100000, width: 0, height: 200000 } });
  }
  return out;
}

/** The y-axis (top/bottom) analogue of {@link xEdgeCandidates}. */
function yEdgeCandidates(targets: {
  paddingBox: RectLike;
  siblingRects: RectLike[];
  guideY?: readonly number[];
}): SnapEdgeCandidate[] {
  const out: SnapEdgeCandidate[] = [
    { edge: targets.paddingBox.y, rect: targets.paddingBox },
    { edge: targets.paddingBox.y + targets.paddingBox.height, rect: targets.paddingBox },
  ];
  for (const r of targets.siblingRects) {
    out.push({ edge: r.y, rect: r });
    out.push({ edge: r.y + r.height, rect: r });
  }
  for (const edge of targets.guideY ?? []) {
    out.push({ edge, rect: { x: -100000, y: edge, width: 200000, height: 0 } });
  }
  return out;
}

/** Snap `value` (the candidate LEFT/TOP edge of a `size`-wide/tall box) to the
 *  nearest of `candidates` within `threshold` px, preferring alignment of
 *  either the box's leading OR trailing edge to a target edge (spec:321
 *  "within ±4px prefer edge-alignment ... over the grid") — the MOVE-gesture
 *  case, where either edge of the moving box may be the one that aligns.
 *  Returns `value` unchanged (and `match: null`) when nothing is within
 *  threshold. */
function edgeSnapBox(
  value: number,
  size: number,
  candidates: readonly SnapEdgeCandidate[],
  threshold: number,
): { value: number; match: SnapEdgeCandidate | null } {
  let best = value;
  let bestDelta = threshold;
  let match: SnapEdgeCandidate | null = null;
  for (const c of candidates) {
    const dLeading = Math.abs(value - c.edge);
    if (dLeading <= bestDelta) {
      bestDelta = dLeading;
      best = c.edge;
      match = c;
    }
    const dTrailing = Math.abs(value + size - c.edge);
    if (dTrailing <= bestDelta) {
      bestDelta = dTrailing;
      best = c.edge - size;
      match = c;
    }
  }
  return { value: best, match };
}

/** Snap a SINGLE moving edge coordinate (e.g. a resize handle's dragged
 *  border) to the nearest of `candidates` within `threshold` — the RESIZE-
 *  gesture case, where only the one edge under the handle can align (the
 *  opposite edge is the anchor and never moves). `null` when nothing is
 *  within threshold. */
function edgeSnapPoint(
  value: number,
  candidates: readonly SnapEdgeCandidate[],
  threshold: number,
): SnapEdgeCandidate | null {
  let best: SnapEdgeCandidate | null = null;
  let bestDelta = threshold;
  for (const c of candidates) {
    const d = Math.abs(value - c.edge);
    if (d <= bestDelta) {
      bestDelta = d;
      best = c;
    }
  }
  return best;
}

/**
 * Move-gesture patch (spec:322 "move a positioned element writes left/top"):
 * grid-snaps `orig.x + dx`/`orig.y + dy` (Alt = free, matching resize), then —
 * unless Alt is held — prefers ±4px edge-alignment to the owner's own
 * `contextRects(id)` padding-box/sibling edges over the grid (spec:321's snap
 * MATH, {@link snapTargetsForContext} fed by `rects.contextRects`). The
 * VISUAL guide rendering this same snap decision drives is
 * {@link computeMoveSnapGuides} (D1, spec §6) — a separate pure function
 * (not this one's return shape) so this function's existing `{x,y}` contract
 * stays byte-for-byte stable for every caller/test that predates D1.
 */
export function computeMovePatch(
  dx: number,
  dy: number,
  orig: RectLike,
  free: boolean,
  context?: MoveSnapContext,
): { x: number; y: number } {
  let x = snapValue(orig.x + dx, free);
  let y = snapValue(orig.y + dy, free);
  if (!free && context) {
    const targets = snapTargetsForContext(context);
    x = edgeSnapBox(x, orig.width, xEdgeCandidates(targets), EDGE_SNAP_THRESHOLD_PX).value;
    y = edgeSnapBox(y, orig.height, yEdgeCandidates(targets), EDGE_SNAP_THRESHOLD_PX).value;
  }
  return { x, y };
}

// --- D1 — snap/alignment guides (spec §6 D1, §5 :461 "snap/alignment
//     guides") ------------------------------------------------------------

/** A single active D1 alignment guide: a straight line at coordinate `at`
 *  along the snapped axis (an x-coordinate for a `'vertical'` guide, a
 *  y-coordinate for a `'horizontal'` one — the guide LINE's own orientation,
 *  matching {@link computeMeasureLines}'s `orientation` convention), spanning
 *  `start`..`end` on the PERPENDICULAR axis (the union of the moving/
 *  resizing element's own extent and the target rect's extent, so the guide
 *  visibly touches both). Rendered ONLY while the underlying gesture's own
 *  edge-snap actually engaged (spec:465 "guides appear only within the snap
 *  threshold; disappear when not snapping") — {@link computeMoveSnapGuides}/
 *  {@link computeResizeSnapGuides} return `[]` whenever nothing snapped. */
export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  at: number;
  start: number;
  end: number;
}

export interface PointSnapResult {
  guides: SnapGuide[];
  position: { x: number; y: number };
}

/** Snap a native reference-point handle to the selected box and its layout
 * context. Each axis offers leading/center/trailing targets; the selected
 * box therefore gives useful corner/edge/center anchor positions while
 * sibling/parent rects provide alignment guides. Alt keeps the exact point
 * and suppresses every guide, matching move/resize gesture language. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pure resolver keeps native-point and generic-axis snap precedence in a single deterministic pass
export function computePointSnap(
  point: { x: number; y: number },
  selectedRect: RectLike,
  free: boolean,
  context?: MoveSnapContext,
  native?: {
    bounded?: boolean | undefined;
    snapPoints?: ReadonlyArray<{ x: number; y: number }> | undefined;
  },
  threshold = EDGE_SNAP_THRESHOLD_PX,
): PointSnapResult {
  if (free) return { guides: [], position: point };
  let nativeMatch: { x: number; y: number } | null = null;
  let nativeDistance = threshold;
  for (const candidate of native?.snapPoints ?? []) {
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance <= nativeDistance) {
      nativeDistance = distance;
      nativeMatch = candidate;
    }
  }
  if (nativeMatch) {
    return {
      guides: guidesFromMatches(
        { x: nativeMatch.x, y: nativeMatch.y, width: 0, height: 0 },
        { edge: nativeMatch.x, rect: selectedRect },
        { edge: nativeMatch.y, rect: selectedRect },
      ),
      position: nativeMatch,
    };
  }
  if (native?.bounded) return { guides: [], position: point };
  const x = snapValue(point.x, false);
  const y = snapValue(point.y, false);
  const targets = [
    selectedRect,
    context?.parent,
    context?.paddingBox,
    ...(context?.siblings ?? []),
  ].filter((rect): rect is RectLike => !!rect && rect.width > 0 && rect.height > 0);
  let xMatch: SnapEdgeCandidate | null = null;
  let yMatch: SnapEdgeCandidate | null = null;
  let xDelta = threshold;
  let yDelta = threshold;
  for (const rect of targets) {
    for (const edge of [rect.x, rect.x + rect.width / 2, rect.x + rect.width]) {
      const delta = Math.abs(x - edge);
      if (delta <= xDelta) {
        xDelta = delta;
        xMatch = { edge, rect };
      }
    }
    for (const edge of [rect.y, rect.y + rect.height / 2, rect.y + rect.height]) {
      const delta = Math.abs(y - edge);
      if (delta <= yDelta) {
        yDelta = delta;
        yMatch = { edge, rect };
      }
    }
  }
  const position = { x: xMatch?.edge ?? x, y: yMatch?.edge ?? y };
  return {
    guides: guidesFromMatches(
      { x: position.x, y: position.y, width: 0, height: 0 },
      xMatch,
      yMatch,
    ),
    position,
  };
}

/** Build the 0, 1, or 2 {@link SnapGuide}s for a matched x/y edge-snap pair —
 *  shared tail of {@link computeMoveSnapGuides}/{@link computeResizeSnapGuides}
 *  (both resolve their own x/y matches differently — move via
 *  {@link edgeSnapBox}, resize via {@link edgeSnapPoint} on a single dragged
 *  edge — but converge on the same "matched candidate -> guide spanning the
 *  moved rect ∪ target rect" geometry once a match exists). */
function guidesFromMatches(
  movedRect: RectLike,
  xMatch: SnapEdgeCandidate | null,
  yMatch: SnapEdgeCandidate | null,
): SnapGuide[] {
  const guides: SnapGuide[] = [];
  if (xMatch) {
    guides.push({
      orientation: 'vertical',
      at: xMatch.edge,
      start: Math.min(movedRect.y, xMatch.rect.y),
      end: Math.max(movedRect.y + movedRect.height, xMatch.rect.y + xMatch.rect.height),
    });
  }
  if (yMatch) {
    guides.push({
      orientation: 'horizontal',
      at: yMatch.edge,
      start: Math.min(movedRect.x, yMatch.rect.x),
      end: Math.max(movedRect.x + movedRect.width, yMatch.rect.x + yMatch.rect.width),
    });
  }
  return guides;
}

/**
 * D1 (spec §6) — the alignment guides a LIVE move gesture's own edge-snap
 * (the same math {@link computeMovePatch} applies to the committed patch)
 * currently engages, or `[]` when Alt is held, there's no context, or
 * nothing is within `threshold`. Deliberately a SEPARATE pure function from
 * `computeMovePatch` (not a richer return shape on it) so that function's
 * `{x,y}` contract — asserted by name in tests that predate D1 — never
 * changes shape.
 */
export function computeMoveSnapGuides(
  dx: number,
  dy: number,
  orig: RectLike,
  free: boolean,
  context: MoveSnapContext | undefined,
  threshold = EDGE_SNAP_THRESHOLD_PX,
): SnapGuide[] {
  if (free || !context) return [];
  const x = snapValue(orig.x + dx, false);
  const y = snapValue(orig.y + dy, false);
  const targets = snapTargetsForContext(context);
  const xMatch = edgeSnapBox(x, orig.width, xEdgeCandidates(targets), threshold).match;
  const yMatch = edgeSnapBox(y, orig.height, yEdgeCandidates(targets), threshold).match;
  const movedRect: RectLike = { x, y, width: orig.width, height: orig.height };
  return guidesFromMatches(movedRect, xMatch, yMatch);
}

/**
 * Alignment snap for a native 2D move whose writable value is the display
 * object's transform origin rather than its visual bounds' left/top. The
 * caller may grid-snap `proposedOrigin` first; this function only applies the
 * higher-priority sibling/parent edge alignment and returns the matching
 * guides from the exact same decision.
 */
export function computeNativeMoveSnap(
  proposedOrigin: { x: number; y: number },
  originalOrigin: { x: number; y: number },
  originalRect: RectLike,
  context: MoveSnapContext | undefined,
  axis: 'x' | 'y' | 'both' = 'both',
  free = false,
  threshold = EDGE_SNAP_THRESHOLD_PX,
  authoredGuides: { x?: readonly number[]; y?: readonly number[] } = {},
): PointSnapResult {
  if (free || (!context && !authoredGuides.x?.length && !authoredGuides.y?.length)) {
    return { position: proposedOrigin, guides: [] };
  }
  const movedRect: RectLike = {
    x: originalRect.x + proposedOrigin.x - originalOrigin.x,
    y: originalRect.y + proposedOrigin.y - originalOrigin.y,
    width: originalRect.width,
    height: originalRect.height,
  };
  const targets = context ? snapTargetsForContext(context) : null;
  const xCandidates = targets ? xEdgeCandidates(targets) : [];
  const yCandidates = targets ? yEdgeCandidates(targets) : [];
  for (const edge of authoredGuides.x ?? []) {
    xCandidates.push({
      edge,
      rect: { x: edge, y: movedRect.y, width: 0, height: movedRect.height },
    });
  }
  for (const edge of authoredGuides.y ?? []) {
    yCandidates.push({
      edge,
      rect: { x: movedRect.x, y: edge, width: movedRect.width, height: 0 },
    });
  }
  const xMatch =
    axis === 'y'
      ? { value: movedRect.x, match: null }
      : edgeSnapBox(movedRect.x, movedRect.width, xCandidates, threshold);
  const yMatch =
    axis === 'x'
      ? { value: movedRect.y, match: null }
      : edgeSnapBox(movedRect.y, movedRect.height, yCandidates, threshold);
  const snappedRect = { ...movedRect, x: xMatch.value, y: yMatch.value };
  return {
    position: {
      x: proposedOrigin.x + snappedRect.x - movedRect.x,
      y: proposedOrigin.y + snappedRect.y - movedRect.y,
    },
    guides: guidesFromMatches(snappedRect, xMatch.match, yMatch.match),
  };
}

/**
 * D1 (spec §6) — the alignment guide(s) a LIVE resize gesture's own
 * per-handle edge-snap (the same math {@link computeResizePatch} applies)
 * currently engages. Only the axis/axes the handle actually drags produce a
 * candidate match (an `'e'` handle only ever checks x; a corner checks
 * both) — mirrors `computeResizePatch`'s own `east`/`west`/`south`/`north`
 * gating. `[]` under the same bypass conditions `computeMoveSnapGuides` uses.
 */
export function computeResizeSnapGuides(
  pos: HandlePos,
  dx: number,
  dy: number,
  orig: RectLike,
  free: boolean,
  context: MoveSnapContext | undefined,
  threshold = EDGE_SNAP_THRESHOLD_PX,
): SnapGuide[] {
  if (free || !context) return [];
  const east = pos === 'e' || pos === 'ne' || pos === 'se';
  const west = pos === 'w' || pos === 'nw' || pos === 'sw';
  const south = pos === 's' || pos === 'sw' || pos === 'se';
  const north = pos === 'n' || pos === 'nw' || pos === 'ne';
  const targets = snapTargetsForContext(context);
  const xCandidates = xEdgeCandidates(targets);
  const yCandidates = yEdgeCandidates(targets);

  // Reuses the SAME per-handle helpers `computeResizePatch` calls (only
  // `.match`, discarding the recomputed `.value`) — the guide can never
  // drift from the patch it's describing.
  let xMatch: SnapEdgeCandidate | null = null;
  if (east) xMatch = resizeEastWidth(dx, orig, false, xCandidates, threshold).match;
  else if (west) xMatch = resizeWestWidth(dx, orig, false, xCandidates, threshold).match;

  let yMatch: SnapEdgeCandidate | null = null;
  if (south) yMatch = resizeSouthHeight(dy, orig, false, yCandidates, threshold).match;
  else if (north) yMatch = resizeNorthHeight(dy, orig, false, yCandidates, threshold).match;

  return guidesFromMatches(orig, xMatch, yMatch);
}

/**
 * Rotate-gesture patch (spec:322 "rotate handle writes `transform`"): the
 * angle between the gesture's START cursor position and its CURRENT position,
 * both measured from the selection's own center — `atan2(cursor−center) −
 * atan2(start−center)` in degrees, snapped to 15° unless Alt (spec:322). Both
 * `center`/`start`/`current` must be in the SAME coordinate frame (host-local,
 * matching the rect the handle itself is drawn from) — the caller's job.
 */
export function computeRotatePatch(
  center: { x: number; y: number },
  start: { x: number; y: number },
  current: { x: number; y: number },
  free: boolean,
  step = 15,
): { rotate: number } {
  const toDeg = (rad: number): number => (rad * 180) / Math.PI;
  const startAngle = toDeg(Math.atan2(start.y - center.y, start.x - center.x));
  const curAngle = toDeg(Math.atan2(current.y - center.y, current.x - center.x));
  const raw = curAngle - startAngle;
  const deg = free ? raw : Math.round(raw / step) * step;
  return { rotate: deg };
}

// --- Adapter-routing helpers (composite→owner-child routing, shared by
//     `rectForId` and every capability-specific wrapper below) -----------

/** The child adapter that owns `id` — the composite's owning child's adapter
 *  for a `CompositeAuthoringAdapter`, or `adapter` itself for a bare adapter.
 *  `null` when a composite has no owning child for `id`. Not exported: every
 *  outside caller wants one of the two capability-specific wrappers below. */
function ownerAdapterFor(adapter: AuthoringAdapter, id: string): AuthoringAdapter | null {
  if (adapter instanceof CompositeAuthoringAdapter) {
    const worldId = adapter.ownerOf(id);
    if (!worldId) return null;
    return adapter.childAdapters().find((c) => c.worldId === worldId)?.adapter ?? null;
  }
  return adapter;
}

const recordedBoxEdits = new WeakMap<
  AuthoringAdapter,
  { readonly provider: BoxEditProvider; readonly recorded: BoxEditProvider }
>();

/** One stable evidence-aware view of an owner's native box editor. The
 * provider still owns every mutation and return value; this only retains the
 * fact that a real shell consumer crossed each seam. */
function recordedBoxEdit(owner: AuthoringAdapter): BoxEditProvider | null {
  const provider = owner.boxEdit;
  if (!provider) return null;
  const cached = recordedBoxEdits.get(owner);
  if (cached?.provider === provider) return cached.recorded;
  const recorded: BoxEditProvider = {
    begin: (id) =>
      recordAuthoringConsumerUse({
        adapter: owner,
        seam: 'editor.boxEdit.begin',
        stage: 'effect',
        detail: `the world overlay began a box edit for ${id}`,
        run: () => provider.begin(id),
      }),
    apply: (id, patch) =>
      recordAuthoringConsumerUse({
        adapter: owner,
        seam: 'editor.boxEdit.apply',
        stage: 'effect',
        detail: `the world overlay applied a ${Object.keys(patch).join(', ')} box patch to ${id}`,
        run: () => provider.apply(id, patch),
      }),
    end: (id) =>
      recordAuthoringConsumerUse({
        adapter: owner,
        seam: 'editor.boxEdit.end',
        stage: 'effect',
        detail: `the world overlay ended a box edit for ${id}`,
        run: () => provider.end(id),
      }),
    ...(provider.gizmoOrigin
      ? {
          gizmoOrigin: (id: string) =>
            recordAuthoringConsumerUse({
              adapter: owner,
              seam: 'editor.boxEdit.gizmoOrigin',
              stage: 'operation',
              detail: `the world overlay read the native gizmo origin for ${id}`,
              run: () => provider.gizmoOrigin?.(id) ?? null,
            }),
        }
      : {}),
    ...(provider.referencePoint
      ? {
          referencePoint: (id: string) =>
            recordAuthoringConsumerUse({
              adapter: owner,
              seam: 'editor.boxEdit.referencePoint',
              stage: 'operation',
              detail: `the world overlay read the native reference point for ${id}`,
              run: () => provider.referencePoint?.(id) ?? null,
            }),
        }
      : {}),
  };
  recordedBoxEdits.set(owner, { provider, recorded });
  return recorded;
}

/**
 * Resolve a node's rect through EITHER a bare adapter's own `rects`
 * provider, OR — when the active adapter is a `CompositeAuthoringAdapter` —
 * its OWNING child's `rects` provider. `rects` is deliberately NOT merged
 * onto the composite (same stance as `pickable`/`boxEdit`/`text` —
 * `composite-authoring-adapter.test.ts`'s T0 suite), so a composite caller
 * must route through `ownerOf()` + `childAdapters()` itself — the SAME
 * routing `ownerAdapterFor` above already does, reused here. `null` when the
 * id has no owner, the owner has no `rects`, or the node is unmounted/
 * offscreen. (D4 — moved here from `RootSelectionOverlay.tsx`, which
 * re-exports it, so `editor-hotkeys.ts`'s arrow-nudge action can use it
 * without pulling in that component's whole dependency graph.)
 */
export function rectForId(adapter: AuthoringAdapter, id: string): DOMRectLike | null {
  return ownerAdapterFor(adapter, id)?.rects?.rect(id) ?? null;
}

/** `id`'s owning `BoxEditProvider`, or `null` when the id has no owner or its
 *  owner has no `boxEdit` (`boxEdit` is deliberately NOT merged onto the
 *  composite, same stance as `rects`/`pickable` — see `rectForId`'s doc
 *  comment above). Gates whether resize/move/rotate handles render for the
 *  current selection (spec:317). */
export function boxEditForId(adapter: AuthoringAdapter, id: string): BoxEditProvider | null {
  const owner = ownerAdapterFor(adapter, id);
  return owner ? recordedBoxEdit(owner) : null;
}

/** True when `id`'s owning adapter exposes `structure` (reorder/reparent/
 *  wrap/unwrap/duplicate/delete — spec:308-309's structural-gesture gate;
 *  those gestures are built elsewhere, this predicate is the
 *  capability check other phases' handles gate on). Deliberately checks the
 *  OWNING CHILD, not the composite's own always-present `structure` (which
 *  merely forwards to whichever owner the id resolves to and would report
 *  `true` even for an id whose real owner has none). */
export function structureCapableForId(adapter: AuthoringAdapter, id: string): boolean {
  return !!ownerAdapterFor(adapter, id)?.structure;
}

/** `id`'s owning `rects.contextRects(id)` (parent/siblings/padding-box), or
 *  `undefined` when the id has no owner or the owner has no `rects`/
 *  `contextRects`. Feeds {@link computeMovePatch}'s edge-snap. */
export function contextRectsForId(
  adapter: AuthoringAdapter,
  id: string,
): MoveSnapContext | undefined {
  return ownerAdapterFor(adapter, id)?.rects?.contextRects?.(id);
}

/** `id`'s owning `StructureProvider`, or `null` when the id has no owner or
 *  its owner has no `structure` — the D3.a canvas context-menu's actual
 *  action target (Duplicate/Wrap/Unwrap/Delete/Insert-child all route through
 *  the OBJECT this returns, never a concrete adapter cast — rule zero). Not
 *  the same thing as {@link structureCapableForId} (a boolean gate) — a
 *  caller that already knows it wants the provider itself uses this instead
 *  of gate-then-reach-in-again. */
export function structureForId(adapter: AuthoringAdapter, id: string): StructureProvider | null {
  return ownerAdapterFor(adapter, id)?.structure ?? null;
}

/** `id`'s owning `TextProvider`, or `null` when the id has no owner or its
 *  owner has no `text` (`text` is deliberately NOT merged/forwarded onto the
 *  composite — unlike `structure`, it follows the same "leave it to the
 *  owner-lookup caller" stance as `rects`/`boxEdit`, see
 *  `RootSelectionOverlay.rectForId`'s doc comment for the precedent this
 *  mirrors). Gates the D3.b inline text editor. */
export function textForId(adapter: AuthoringAdapter, id: string): TextProvider | null {
  return ownerAdapterFor(adapter, id)?.text ?? null;
}

/** `id`'s owning `ColorSampleProvider`, or `null` when the id has no owner or
 *  its owner has no `colorSample` (not merged onto the composite either —
 *  same NOT-merged group as `rects`/`boxEdit`/`text`). Feeds the D3.d
 *  eyedropper fallback swatch. */
export function colorSampleForId(
  adapter: AuthoringAdapter,
  id: string,
): ColorSampleProvider | null {
  return ownerAdapterFor(adapter, id)?.colorSample ?? null;
}

/**
 * `id`'s owning `SpatialHandlesProvider`, or `null` — routed to the OWNER like
 * every other non-merged provider above.
 *
 * GATED ON THE OWNER ALSO EXPOSING `rects`, because this overlay draws in the
 * rects frame: an adapter with world-space handles and no rects (the three
 * adapter — see the N-A table's own reason) has no frame here, and drawing its
 * points against someone else's coordinates would put a dot in the wrong place
 * rather than declining to draw one. Its handles are drawn by the 3D viewport,
 * which raycasts them in the space they are actually in.
 */
export function spatialHandlesForId(
  adapter: AuthoringAdapter,
  id: string,
): SpatialHandlesProvider | null {
  const owner = ownerAdapterFor(adapter, id);
  return owner?.rects ? spatialHandlesForAdapter(owner) : null;
}

/** Every empty-container hint reachable from `adapter`'s own `rects`
 *  provider — or, for a composite, from each VISIBLE child's own `rects`
 *  provider (D3.c). Mirrors `RootSelectionOverlay.collectMarqueeCandidates`'s
 *  identical per-child-iteration/session-hidden-skip shape (that helper
 *  lives in the sibling file rather than here purely because it was written
 *  first — both walk the SAME composite-children/hidden-world contract). */
export function emptyContainerHintsFor(
  adapter: AuthoringAdapter,
): Array<{ id: string; rect: DOMRectLike; displayName: string }> {
  const children: ReadonlyArray<{ worldId: string; adapter: AuthoringAdapter }> =
    adapter instanceof CompositeAuthoringAdapter
      ? adapter.childAdapters()
      : [{ worldId: '', adapter }];
  const out: Array<{ id: string; rect: DOMRectLike; displayName: string }> = [];
  for (const { worldId, adapter: child } of children) {
    if (!child.rects?.emptyContainers) continue;
    if (worldId && isRootHidden(worldId)) continue;
    out.push(...child.rects.emptyContainers());
  }
  return out;
}

// --- B3 — box-model spacing bands (spec §4 B3, §5 :460/:465-466) ------

export type SpacingSide =
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'marginTop'
  | 'marginRight'
  | 'marginBottom'
  | 'marginLeft';

export interface SpacingValues {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
}

/** Read the 8 spacing values off `adapter.inspector` (routed/merged on the
 *  composite, unlike `rects`/`boxEdit` — no owner lookup needed here) via the
 *  reserved `style.<prop>` inspector paths, parsed with the shared
 *  `numericStyleValue` (defensive: the declared `PropertyDescriptor.type` for
 *  each of these IS `'number'` on both react adapters today, so `get` already
 *  returns a parsed number — but a raw computed-style STRING like `"12px"`
 *  parses identically, so this stays correct even if that declared type ever
 *  changes, per this task's own note). Unresolved values default to `0`. */
export function readSpacingValues(adapter: AuthoringAdapter, id: string): SpacingValues {
  const read = (prop: SpacingSide): number => {
    const raw = adapter.inspector?.get(id, `style.${prop}`);
    return numericStyleValue(raw as string | number | undefined) ?? 0;
  };
  return {
    paddingTop: read('paddingTop'),
    paddingRight: read('paddingRight'),
    paddingBottom: read('paddingBottom'),
    paddingLeft: read('paddingLeft'),
    marginTop: read('marginTop'),
    marginRight: read('marginRight'),
    marginBottom: read('marginBottom'),
    marginLeft: read('marginLeft'),
  };
}

export interface SpacingBand {
  side: SpacingSide;
  kind: 'padding' | 'margin';
  x: number;
  y: number;
  width: number;
  height: number;
  cursor: string;
  /** Label anchor — centered in the band's thickness. */
  labelX: number;
  labelY: number;
  /** The side's REAL value (may be 0 even though the band itself is drawn at
   *  {@link ZERO_STRIP_PX} thickness so a zero side stays grabbable). */
  value: number;
  isZero: boolean;
}

/** A zero-value padding/margin side still renders a thin grab strip (spec
 *  B3 "zero-value side → still render a ~4px grab strip so zero padding is
 *  draggable") — this is that strip's thickness. */
export const ZERO_STRIP_PX = 4;

/**
 * Padding (inner) + margin (outer) band geometry for a selection `rect` given
 * its 8 parsed spacing values (spec:332-335). Padding bands sit INSIDE `rect`
 * (spec:460's "box-model spacing bands"); margin bands sit OUTSIDE it. Uses
 * `rect` + the raw values directly — NOT `rects.contextRects(id).paddingBox`
 * (that reflects only the BORDER box per its own doc comment in the react
 * adapters, i.e. ignores padding entirely — using it here would draw the
 * padding band at the wrong thickness whenever the node also has a border).
 * Pure; no DOM/adapter access.
 */
export function computeSpacingBands(rect: RectLike, values: SpacingValues): SpacingBand[] {
  const thickness = (v: number): number => (v > 0 ? v : ZERO_STRIP_PX);
  const pt = thickness(values.paddingTop);
  const pr = thickness(values.paddingRight);
  const pb = thickness(values.paddingBottom);
  const pl = thickness(values.paddingLeft);
  const mt = thickness(values.marginTop);
  const mr = thickness(values.marginRight);
  const mb = thickness(values.marginBottom);
  const ml = thickness(values.marginLeft);

  return [
    {
      side: 'paddingTop',
      kind: 'padding',
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: pt,
      cursor: 'ns-resize',
      labelX: rect.x + rect.width / 2,
      labelY: rect.y + pt / 2,
      value: values.paddingTop,
      isZero: values.paddingTop === 0,
    },
    {
      side: 'paddingBottom',
      kind: 'padding',
      x: rect.x,
      y: rect.y + rect.height - pb,
      width: rect.width,
      height: pb,
      cursor: 'ns-resize',
      labelX: rect.x + rect.width / 2,
      labelY: rect.y + rect.height - pb / 2,
      value: values.paddingBottom,
      isZero: values.paddingBottom === 0,
    },
    {
      side: 'paddingLeft',
      kind: 'padding',
      x: rect.x,
      y: rect.y,
      width: pl,
      height: rect.height,
      cursor: 'ew-resize',
      labelX: rect.x + pl / 2,
      labelY: rect.y + rect.height / 2,
      value: values.paddingLeft,
      isZero: values.paddingLeft === 0,
    },
    {
      side: 'paddingRight',
      kind: 'padding',
      x: rect.x + rect.width - pr,
      y: rect.y,
      width: pr,
      height: rect.height,
      cursor: 'ew-resize',
      labelX: rect.x + rect.width - pr / 2,
      labelY: rect.y + rect.height / 2,
      value: values.paddingRight,
      isZero: values.paddingRight === 0,
    },
    {
      side: 'marginTop',
      kind: 'margin',
      x: rect.x,
      y: rect.y - mt,
      width: rect.width,
      height: mt,
      cursor: 'ns-resize',
      labelX: rect.x + rect.width / 2,
      labelY: rect.y - mt / 2,
      value: values.marginTop,
      isZero: values.marginTop === 0,
    },
    {
      side: 'marginBottom',
      kind: 'margin',
      x: rect.x,
      y: rect.y + rect.height,
      width: rect.width,
      height: mb,
      cursor: 'ns-resize',
      labelX: rect.x + rect.width / 2,
      labelY: rect.y + rect.height + mb / 2,
      value: values.marginBottom,
      isZero: values.marginBottom === 0,
    },
    {
      side: 'marginLeft',
      kind: 'margin',
      x: rect.x - ml,
      y: rect.y,
      width: ml,
      height: rect.height,
      cursor: 'ew-resize',
      labelX: rect.x - ml / 2,
      labelY: rect.y + rect.height / 2,
      value: values.marginLeft,
      isZero: values.marginLeft === 0,
    },
    {
      side: 'marginRight',
      kind: 'margin',
      x: rect.x + rect.width,
      y: rect.y,
      width: mr,
      height: rect.height,
      cursor: 'ew-resize',
      labelX: rect.x + rect.width + mr / 2,
      labelY: rect.y + rect.height / 2,
      value: values.marginRight,
      isZero: values.marginRight === 0,
    },
  ];
}

/** Which raw delta axis (`dx`/`dy`) a given band drags along, and its sign —
 *  e.g. dragging the TOP padding band DOWN (`dy > 0`) grows `paddingTop`;
 *  dragging the TOP margin band UP (`dy < 0`, i.e. `-dy > 0`) grows
 *  `marginTop` (margin bands sit OUTSIDE the box, so their "grow" direction
 *  is the opposite screen direction from the same-named padding band). */
function axisDeltaForSide(side: SpacingSide, dx: number, dy: number): number {
  switch (side) {
    case 'paddingTop':
      return dy;
    case 'paddingBottom':
      return -dy;
    case 'paddingLeft':
      return dx;
    case 'paddingRight':
      return -dx;
    case 'marginTop':
      return -dy;
    case 'marginBottom':
      return dy;
    case 'marginLeft':
      return -dx;
    case 'marginRight':
      return dx;
  }
}

/**
 * Spacing-band drag → `boxEdit` patch (spec:333-335): the delta along the
 * band's own axis (see {@link axisDeltaForSide}) is added to the side's
 * original value and clamped to ≥0. Deliberately whole-PIXEL (`Math.round`),
 * NOT snapped to the 8px {@link GRID} B2's resize/move gestures use — a real
 * padding/margin is routinely NOT a multiple of 8 (this task's own e2e fixture
 * authors `padding: 12`), so grid-quantizing every spacing drag would make
 * that starting value permanently unreachable by any drag distance (e.g.
 * dragging `+8` from `12` would jump to `16` or `24`, never landing on the
 * expected `20`). Whole-px rounding still keeps the value tidy without that
 * unreachability trap.
 */
export function computeSpacingPatch(
  side: SpacingSide,
  dx: number,
  dy: number,
  origValue: number,
): Record<string, number> {
  const delta = axisDeltaForSide(side, dx, dy);
  const next = Math.max(0, Math.round(origValue + delta));
  return { [side]: next };
}

// --- D2 — marquee polish, drag-ghost, reorder clone-preview (spec §6 D2,
//     §5 :461-462/:466) ---------------------------------------------------

/** A drag-ghost's geometry: the dragged element's OWN original rect, offset
 *  by the pointer's delta since the gesture started (spec:399 "a semi-
 *  transparent follow-cursor ghost ... offset by the drag delta"). Shared by
 *  the B2 move gesture (`applyGesturePatch`'s `'move'` branch) and the D2.b
 *  reorder-preview drag below — both are "dragging a selected element on the
 *  canvas" per the spec's own D2 framing, just with a different commit path
 *  at drop (a `boxEdit` patch vs. a `structure.reorder`). Pure; no DOM/adapter
 *  access. */
export function computeDragGhost(origRect: RectLike, dx: number, dy: number): RectLike {
  return { x: origRect.x + dx, y: origRect.y + dy, width: origRect.width, height: origRect.height };
}

/** One sibling candidate for the D2.b reorder gap math: an id (the
 *  `structure.reorder(id, beforeSiblingId)` argument this sibling would BE,
 *  if the pointer lands before it) paired with its current on-screen rect.
 *  Deliberately excludes the DRAGGED node itself — the caller builds this
 *  list from the dragged id's ordered siblings, filtering the dragged id out
 *  (its own rect is busy being dragged, not a valid gap boundary). */
export interface SiblingRectEntry {
  id: string;
  rect: RectLike;
}

/** The live reorder-preview gap a pointer position resolves to among a set of
 *  sibling rects (spec:398-400 "live insertion preview ... updating as the
 *  pointer moves across sibling boundaries"). */
export interface ReorderGap {
  /** The exact `structure.reorder(id, beforeSiblingId)` second argument:
   *  the sibling to insert BEFORE, or `null` to insert at the END (spec's
   *  own contract doc comment: "null = move to the end"). */
  beforeSiblingId: string | null;
  /** The gap's index among `siblings` in AXIS order — `0` is "before the
   *  first sibling", `siblings.length` is "after the last" (same case
   *  `beforeSiblingId: null` reports). Exposed mainly for tests: it's a
   *  denser signal than re-deriving position from `beforeSiblingId` alone
   *  when two siblings tie on id. */
  index: number;
  /** A thin marker rect at the gap boundary — the live insertion-preview
   *  line/marker to render. Spans the cross-axis extent of the flanking
   *  sibling(s); its thickness is {@link REORDER_MARKER_THICKNESS_PX}. */
  marker: RectLike;
}

/** Thickness (px) of the D2.b live insertion-preview marker line. */
export const REORDER_MARKER_THICKNESS_PX = 3;

/** A sibling rect's center coordinate along one axis — the sort/compare key
 *  {@link computeReorderGap} uses throughout. */
function centerOn(r: RectLike, axis: 'x' | 'y'): number {
  return axis === 'x' ? r.x + r.width / 2 : r.y + r.height / 2;
}

/** The gap boundary coordinate along `axis`, given `ordered` siblings (sorted
 *  along that axis already) and the gap `index` among them: the leading edge
 *  of the first sibling (index 0), the trailing edge of the last (index ===
 *  length), or the midpoint between the flanking pair's facing edges
 *  otherwise. Factored out of {@link computeReorderGap} purely to keep ITS
 *  cognitive complexity down. */
function reorderGapBoundary(
  ordered: readonly SiblingRectEntry[],
  index: number,
  horizontal: boolean,
): number {
  if (index === 0) {
    const first = ordered[0]!.rect;
    return horizontal ? first.x : first.y;
  }
  if (index === ordered.length) {
    const last = ordered[ordered.length - 1]!.rect;
    return horizontal ? last.x + last.width : last.y + last.height;
  }
  const prev = ordered[index - 1]!.rect;
  const next = ordered[index]!.rect;
  return horizontal ? (prev.x + prev.width + next.x) / 2 : (prev.y + prev.height + next.y) / 2;
}

/** The D2.b insertion-preview marker rect: a thin {@link REORDER_MARKER_THICKNESS_PX}
 *  line at `boundary` along `axis`, spanning the CROSS-axis extent of every
 *  `ordered` sibling (so it reads as a full-width/height insertion line, not
 *  just as wide as its immediate neighbors). Factored out of
 *  {@link computeReorderGap} purely to keep ITS cognitive complexity down. */
function reorderMarkerRect(
  ordered: readonly SiblingRectEntry[],
  boundary: number,
  horizontal: boolean,
): RectLike {
  const crossMin = Math.min(...ordered.map((s) => (horizontal ? s.rect.y : s.rect.x)));
  const crossMax = Math.max(
    ...ordered.map((s) => (horizontal ? s.rect.y + s.rect.height : s.rect.x + s.rect.width)),
  );
  const half = REORDER_MARKER_THICKNESS_PX / 2;
  return horizontal
    ? {
        x: boundary - half,
        y: crossMin,
        width: REORDER_MARKER_THICKNESS_PX,
        height: crossMax - crossMin,
      }
    : {
        x: crossMin,
        y: boundary - half,
        width: crossMax - crossMin,
        height: REORDER_MARKER_THICKNESS_PX,
      };
}

/**
 * D2.b (spec:397-401) — resolve `pointer` to a live insertion gap among
 * `siblings` (the dragged node's OWN siblings, already excluding it — see
 * {@link SiblingRectEntry}'s doc comment). `null` only when `siblings` is
 * empty (nothing to compute a gap among — the caller's own "≥3 siblings"
 * capability gate should make this unreachable in practice, but this stays
 * honest about the degenerate input rather than fabricating a gap).
 *
 * Axis detection is PURE GEOMETRY, no CSS/flex-direction read needed: whichever
 * dimension the siblings' centers spread across MORE is the list's primary
 * axis (a horizontal flex-row spreads in x, a vertical stack spreads in y).
 * Siblings are then re-sorted along that axis (defensive — callers should
 * already pass DOM order, but the gap math only means something in spatial
 * order) and the pointer's coordinate along the SAME axis is compared against
 * each sibling's center to find how many siblings it has "passed" — that
 * count IS the gap index, and `beforeSiblingId` is whichever sibling sits at
 * that index (`null` past the last one).
 */
export function computeReorderGap(
  siblings: readonly SiblingRectEntry[],
  pointer: { x: number; y: number },
): ReorderGap | null {
  if (siblings.length === 0) return null;

  const xSpread =
    Math.max(...siblings.map((s) => centerOn(s.rect, 'x'))) -
    Math.min(...siblings.map((s) => centerOn(s.rect, 'x')));
  const ySpread =
    Math.max(...siblings.map((s) => centerOn(s.rect, 'y'))) -
    Math.min(...siblings.map((s) => centerOn(s.rect, 'y')));
  const horizontal = xSpread >= ySpread;
  const axis: 'x' | 'y' = horizontal ? 'x' : 'y';

  const ordered = [...siblings].sort((a, b) => centerOn(a.rect, axis) - centerOn(b.rect, axis));

  const pointerKey = horizontal ? pointer.x : pointer.y;
  let index = 0;
  while (index < ordered.length && centerOn(ordered[index]!.rect, axis) < pointerKey) index++;
  const beforeSiblingId = index < ordered.length ? ordered[index]!.id : null;

  const boundary = reorderGapBoundary(ordered, index, horizontal);
  const marker = reorderMarkerRect(ordered, boundary, horizontal);

  return { beforeSiblingId, index, marker };
}

/**
 * `id`'s ordered sibling ids, INCLUDING `id` itself (the caller filters it
 * back out when building {@link SiblingRectEntry}s) — read off `adapter`'s
 * OWN `hierarchy` (merged/routed on a `CompositeAuthoringAdapter`, same
 * stance `labelForId`/`RootSelectionOverlay.tsx` already document: no owner
 * lookup needed for `hierarchy`, unlike `rects`/`boxEdit`/`structure`). `null`
 * when `id` is unknown, or when it claims a `parentId` whose node can't be
 * resolved. A parentless (top-level) id's siblings are the OWNER'S OWN
 * `hierarchy.roots()` — for a composite, `roots()` returns synthetic
 * `world:<id>` GROUP nodes, so a top-level react-world node's real siblings
 * only resolve correctly through the group node's `childIds`, which is why
 * this reads `node.parentId` (already rewritten to the group id by the
 * composite for a child's own top-level root, per
 * `composite-authoring-adapter.ts`'s `node()`) rather than calling
 * `roots()` directly for every id.
 */
export function siblingIdsForId(adapter: AuthoringAdapter, id: string): string[] | null {
  const node = adapter.hierarchy.node(id);
  if (!node) return null;
  if (node.parentId) {
    const parent = adapter.hierarchy.node(node.parentId);
    return parent ? parent.childIds : null;
  }
  return adapter.hierarchy.roots().map((n) => n.id);
}

// --- D1.a — sibling-distance measure lines (spec §6 D1, §5 :461
//     "sibling-distance measure lines") -----------------------------------

/** One figma-style "hold-and-measure" gap line between two rects: a straight
 *  segment from `(x1,y1)` to `(x2,y2)` (always axis-aligned — either
 *  `y1 === y2`, a `'horizontal'` line measuring the x-axis gap, or
 *  `x1 === x2`, a `'vertical'` line measuring the y-axis gap), the gap's
 *  rounded px `distance`, and a `label` anchor at the segment's midpoint. */
export interface MeasureLine {
  orientation: 'horizontal' | 'vertical';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  distance: number;
  labelX: number;
  labelY: number;
}

/**
 * D1.a (spec §6 "sibling-distance measure lines ... between selection and
 * hover"): the gap line(s) between `a` (the selection) and `b` (the hover
 * target). A `'horizontal'` line (gap along x) is produced when the two
 * rects DON'T overlap on the x-axis (one is fully left/right of the other);
 * a `'vertical'` line (gap along y) when they don't overlap on the y-axis.
 * Both can be produced at once (the rects are diagonal from each other —
 * neither axis overlaps); neither is produced when the rects overlap on
 * BOTH axes (no meaningful "gap" to measure — honest empty result, never a
 * fabricated negative/zero line, per this task's own anti-fabrication rule).
 *
 * The line's position on its PERPENDICULAR axis is the midpoint of the two
 * rects' overlapping range on that axis when they DO overlap there (the
 * common figma case — a sibling directly beside or below the selection);
 * when they don't overlap on that axis either (the diagonal case), it falls
 * back to the midpoint between the two rects' own centers on that axis, so
 * the line still reads as "between" them rather than snapping to an
 * arbitrary edge. Pure geometry; `a`/`b` are interchangeable (order doesn't
 * change which lines are produced, only which distance/endpoint is which
 * rect's edge — commutative).
 */
export function computeMeasureLines(a: RectLike, b: RectLike): MeasureLine[] {
  const aLeft = a.x;
  const aRight = a.x + a.width;
  const aTop = a.y;
  const aBottom = a.y + a.height;
  const bLeft = b.x;
  const bRight = b.x + b.width;
  const bTop = b.y;
  const bBottom = b.y + b.height;

  const lines: MeasureLine[] = [];

  // Horizontal gap (x-axis separation) — only when the rects don't overlap
  // on x.
  let gapX: { x1: number; x2: number } | null = null;
  if (aRight <= bLeft) gapX = { x1: aRight, x2: bLeft };
  else if (bRight <= aLeft) gapX = { x1: bRight, x2: aLeft };
  if (gapX) {
    const overlapTop = Math.max(aTop, bTop);
    const overlapBottom = Math.min(aBottom, bBottom);
    const y =
      overlapBottom > overlapTop
        ? (overlapTop + overlapBottom) / 2
        : ((aTop + aBottom) / 2 + (bTop + bBottom) / 2) / 2;
    lines.push({
      orientation: 'horizontal',
      x1: gapX.x1,
      y1: y,
      x2: gapX.x2,
      y2: y,
      distance: Math.round(gapX.x2 - gapX.x1),
      labelX: (gapX.x1 + gapX.x2) / 2,
      labelY: y,
    });
  }

  // Vertical gap (y-axis separation) — only when the rects don't overlap
  // on y.
  let gapY: { y1: number; y2: number } | null = null;
  if (aBottom <= bTop) gapY = { y1: aBottom, y2: bTop };
  else if (bBottom <= aTop) gapY = { y1: bBottom, y2: aTop };
  if (gapY) {
    const overlapLeft = Math.max(aLeft, bLeft);
    const overlapRight = Math.min(aRight, bRight);
    const x =
      overlapRight > overlapLeft
        ? (overlapLeft + overlapRight) / 2
        : ((aLeft + aRight) / 2 + (bLeft + bRight) / 2) / 2;
    lines.push({
      orientation: 'vertical',
      x1: x,
      y1: gapY.y1,
      x2: x,
      y2: gapY.y2,
      distance: Math.round(gapY.y2 - gapY.y1),
      labelX: x,
      labelY: (gapY.y1 + gapY.y2) / 2,
    });
  }

  return lines;
}

// --- D1.c — position/parent-layout badge (spec §6 D1, §5 :461
//     "position/parent-layout badges") --------------------------------

/** The D1.c badge's two independent segments — each `null` when the
 *  underlying value couldn't be resolved (no `inspector`, no parent, an
 *  unreadable/absent style value), per this task's own honesty rule: "if a
 *  value can't be resolved, show nothing for it, never a fabricated
 *  default." Never both `null` AND rendered — the caller's own gate. */
export interface PositionBadgeInfo {
  /** `id`'s own `style.position` value (e.g. `'absolute'`), or `null`. */
  position: string | null;
  /** `id`'s PARENT's layout, summarized: `'flex row'`/`'flex col'` (from
   *  `display: flex`/`inline-flex` + `flexDirection`), `'grid'` (from
   *  `display: grid`/`inline-grid`), or the parent's raw `display` value for
   *  anything else (e.g. `'block'`) — `null` when there's no parent, no
   *  `inspector`, or the parent's `display` itself can't be read. */
  parentLayout: string | null;
}

/** Read a possibly-unset inspector value as a non-empty string, or `null` —
 *  the shared "honest unresolved" coercion both segments below use (an
 *  inspector `get` may return `undefined`, `null`, or even a non-string for
 *  an adapter that doesn't model the path at all). */
function readStyleString(
  inspector: { get(id: string, path: string): unknown } | undefined,
  id: string,
  path: string,
): string | null {
  const raw = inspector?.get(id, path);
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * D1.c (spec §6 "position/parent-layout badges") — `id`'s own position mode
 * plus its PARENT's summarized layout, read entirely through
 * `adapter.inspector.get`/`adapter.hierarchy.node` (both merged/routed on a
 * `CompositeAuthoringAdapter` already — `labelForId`/`siblingIdsForId`'s own
 * doc comments — so, unlike `rects`/`boxEdit`, no owner-child routing helper
 * is needed here; a bare adapter and a composite call this identically).
 * Each segment resolves independently — a missing/unreadable parent
 * `display` never blanks out an otherwise-resolved `position`, and vice
 * versa (spec's own "never a fabricated default" instruction).
 */
export function resolvePositionBadge(adapter: AuthoringAdapter, id: string): PositionBadgeInfo {
  const position = readStyleString(adapter.inspector, id, 'style.position');

  let parentLayout: string | null = null;
  const parentId = adapter.hierarchy.node(id)?.parentId ?? null;
  if (parentId) {
    const display = readStyleString(adapter.inspector, parentId, 'style.display');
    if (display === 'flex' || display === 'inline-flex') {
      const direction =
        readStyleString(adapter.inspector, parentId, 'style.flexDirection') ?? 'row';
      parentLayout = `flex ${direction.startsWith('column') ? 'col' : 'row'}`;
    } else if (display === 'grid' || display === 'inline-grid') {
      parentLayout = 'grid';
    } else if (display) {
      parentLayout = display;
    }
  }

  return { position, parentLayout };
}

// --- D4 — multi-select align/distribute toolbar (spec §6 D4, §5 :462
//     "alignment/distribute toolbar") -------------------------------------

/** One selected node's id paired with its current on-screen rect — reused
 *  (not re-declared) from the D2.b reorder-gap math above: both are just
 *  "an id + the rect it currently occupies", the same shape `AlignToolbar`
 *  needs for the align/distribute math below. */
export type AlignEntry = SiblingRectEntry;

export type AlignOp = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** One node's align/distribute RESULT: the absolute host-relative `x` and/or
 *  `y` its rect should move to (only the axis the op touches is present —
 *  align-left only ever sets `x`, never `y`), matching `boxEdit.apply`'s own
 *  ABSOLUTE-coordinate contract (spec:322/B2 — the same convention
 *  `computeMovePatch` already returns, NOT a delta). */
export interface AlignTarget {
  id: string;
  x?: number;
  y?: number;
}

/**
 * D4.b (spec §6 D4 "a multi-select align/distribute toolbar ... align
 * left/hcenter/right/top/vcenter/bottom (≥2 selected)"): every entry's target
 * position for `op`, computed from the SELECTION's own union bounding box
 * (spec's own figma-parity framing — "align left" moves every selected
 * node's left edge to the leftmost selected node's left edge, which IS the
 * union bbox's left edge; center/right/top/vcenter/bottom are the analogous
 * bbox edges/midpoints). `[]` for fewer than 2 entries — the toolbar's own
 * capability gate (this function stays honest about the degenerate input
 * rather than fabricating a single-node "alignment"). Pure; no adapter/DOM
 * access — the caller (`AlignToolbar.tsx`) is the one that routes each
 * target through `boxEditForId`.
 */
export function computeAlignTargets(entries: readonly AlignEntry[], op: AlignOp): AlignTarget[] {
  if (entries.length < 2) return [];
  const rects = entries.map((e) => e.rect);
  const minX = Math.min(...rects.map((r) => r.x));
  const maxRight = Math.max(...rects.map((r) => r.x + r.width));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxBottom = Math.max(...rects.map((r) => r.y + r.height));
  const centerX = (minX + maxRight) / 2;
  const centerY = (minY + maxBottom) / 2;
  const out: AlignTarget[] = [];
  for (const { id, rect } of entries) {
    switch (op) {
      case 'left':
        out.push({ id, x: minX });
        break;
      case 'hcenter':
        out.push({ id, x: centerX - rect.width / 2 });
        break;
      case 'right':
        out.push({ id, x: maxRight - rect.width });
        break;
      case 'top':
        out.push({ id, y: minY });
        break;
      case 'vcenter':
        out.push({ id, y: centerY - rect.height / 2 });
        break;
      case 'bottom':
        out.push({ id, y: maxBottom - rect.height });
        break;
    }
  }
  return out;
}

/**
 * D4.b (spec §6 D4 "distribute horizontally/vertically (≥3 selected)"):
 * equalize the GAP between consecutive entries along `axis`, keeping the
 * first (lowest-coordinate) and last (highest-coordinate) entries fixed at
 * their own current position — the standard figma distribute algorithm.
 * `[]` for fewer than 3 entries (spec's own "(≥3 selected)" gate — with only
 * 2 entries there is exactly one gap, nothing to "equalize" against, so an
 * honest empty result beats fabricating a no-op target). Pure; entries are
 * re-sorted internally by their CURRENT position along `axis` (the caller
 * doesn't need to pre-sort).
 */
export function computeDistributeTargets(
  entries: readonly AlignEntry[],
  axis: DistributeAxis,
): AlignTarget[] {
  if (entries.length < 3) return [];
  const horizontal = axis === 'horizontal';
  const sorted = [...entries].sort((a, b) =>
    horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const totalSpan = horizontal
    ? last.rect.x + last.rect.width - first.rect.x
    : last.rect.y + last.rect.height - first.rect.y;
  const totalSize = sorted.reduce((s, e) => s + (horizontal ? e.rect.width : e.rect.height), 0);
  const gap = (totalSpan - totalSize) / (sorted.length - 1);
  let cursor = horizontal ? first.rect.x : first.rect.y;
  const out: AlignTarget[] = [];
  for (const e of sorted) {
    out.push(horizontal ? { id: e.id, x: cursor } : { id: e.id, y: cursor });
    cursor += (horizontal ? e.rect.width : e.rect.height) + gap;
  }
  return out;
}

/** The union bounding box of `rects` (spec's own "the selection's own union
 *  bounding box" framing — see {@link computeAlignTargets}'s doc comment) —
 *  used by `AlignToolbar` purely to POSITION itself above the selection;
 *  `null` for an empty input (never a fabricated zero-rect). */
export function unionRect(rects: readonly RectLike[]): RectLike | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

// --- D4.c — arrow-nudge (spec §6 D4 "arrow-nudge (↑↓←→, Shift=×10) ...
//     writes margins/offsets") --------------------------------------------

/**
 * D4.c — the `boxEdit` patch one arrow-key nudge writes: for an
 * absolutely/fixed-positioned node, an ABSOLUTE `{x,y}` (the same convention
 * {@link computeMovePatch} already returns, matching B1's "x/y for
 * absolutely-positioned nodes → left/top"), offset by `(dx,dy)` from `rect`'s
 * current position. For anything else — the normal-document-flow case B1
 * also covers ("margin / padding → per-side style writes") — nudges
 * `marginLeft`/`marginTop` by the same delta instead (there is no `left`/
 * `top` to move on a non-positioned node — the only spatial lever B1 leaves
 * it is its own margin). Only the axis/axes actually nudged (`dx`/`dy`
 * non-zero) appear in the returned patch. Pure; no adapter/DOM access.
 */
export function computeArrowNudgePatch(
  dx: number,
  dy: number,
  isPositioned: boolean,
  rect: RectLike,
  margin: { left: number; top: number },
): Record<string, number> {
  const patch: Record<string, number> = {};
  if (isPositioned) {
    if (dx !== 0) patch['x'] = rect.x + dx;
    if (dy !== 0) patch['y'] = rect.y + dy;
    return patch;
  }
  if (dx !== 0) patch['marginLeft'] = margin.left + dx;
  if (dy !== 0) patch['marginTop'] = margin.top + dy;
  return patch;
}
