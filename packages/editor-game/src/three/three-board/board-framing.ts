/**
 * The 3D board's FRAMING MATH — pure, three-free, and the sibling of
 * `board-layout.ts`.
 *
 * Layout answers *where each exhibit stands* at true scale. This module
 * answers *what the default camera should fit*. Those are different
 * questions the moment one exhibit carries a helper volume — a light-beam
 * cone, an unbounded ground plane, a skybox-scale mesh — whose authored
 * AABB is orders of magnitude larger than the body a reader is trying to
 * identify. Framing the union then zooms the camera out until every
 * exhibit is a few pixels in a mostly-black frame.
 *
 * True scale is inviolable: nothing here scales an exhibit, and a helper
 * volume is still in the scene at its authored size. What changes is
 * which box the DEFAULT view (and the Frame button / view presets) fits:
 *
 *  1. **Per-exhibit presence.** Each exhibit's node boxes are reduced to
 *     the body worth standing next to its neighbours. A named helper —
 *     an authored overlay volume, a BackSide enclosure, or an unbounded
 *     plane — is dropped from that body when a body remains. A
 *     single-node exhibit is never trimmed: it *is* the exhibit, even
 *     when that exhibit is a 28 m cone or a 120 m tower.
 *  2. **Layout uses presence**, so a helper cannot reserve a floor slot
 *     the size of itself and push the next district out to its tip. The
 *     helper still extends through space at true scale.
 *  3. **The default frame is the union of placed presence boxes**, not
 *     the union of every authored vertex. Frame-selection still frames
 *     whatever is picked (the cone, if that is what was clicked).
 *
 * Size is the wrong axis for "volume vs body." An 8× sliver cut missed
 * the reported 16 × 16 × 28 m cone (1.75×). A relative-to-own-median cut
 * ate the subject of any exhibit that is one large mesh plus small
 * details (a hull with rivets; a building with a door). Mass distribution
 * cannot save it either: the same cone is 91 % of the lighthouse's mesh
 * surface (so a 90 % area box IS the cone) and still sits in the 90 %
 * triangle-count set. The discriminator that exists in the data is the
 * material flag the author set because the thing is a volume:
 * `depthWrite === false` (the cone: MeshBasicMaterial, transparent,
 * opacity 0.16, depthWrite false; every tower / hull / rivet mesh:
 * opaque standard material, depthWrite true). That flag arrives here as
 * {@link BoardNode.overlay}. Emissive intensity is not a volume mark —
 * the lantern house is emissive and is body.
 *
 * A 0.2 m prop next to a 30 m building is two compact exhibits, and the
 * union of those bodies is exactly the true-scale comparison the board
 * exists to show.
 */

import {
  type BoardBounds,
  type BoardItemPlacement,
  type BoardLayout,
  type BoardLayoutItem,
  layoutThreeBoard,
} from './board-layout';

export type { BoardBounds };

/** Why a node box was kept out of an exhibit's presence / default frame. */
export type BoardHelperKind = 'volume' | 'unbounded-plane' | 'environment-scale';

export interface BoardHelperVolume {
  readonly kind: BoardHelperKind;
  readonly bounds: BoardBounds;
  readonly size: readonly [number, number, number];
}

/**
 * One drawing node of an exhibit. The two flags are authored material
 * marks collected by `collectContentNodeRecords` — this module never
 * looks at a mesh.
 *
 *  - `overlay`: `depthWrite === false` (a light cone, trigger, AoE)
 *  - `enclosure`: `side === BackSide` (a skybox)
 */
export interface BoardNode {
  readonly bounds: BoardBounds;
  readonly overlay?: boolean;
  readonly enclosure?: boolean;
}

export interface ExhibitPresence {
  /** Union of every finite node box — the authored extent, true scale. */
  readonly full: BoardBounds;
  /** The body the board stands and frames. Equal to {@link full} when
   *  nothing was defensible to drop. */
  readonly presence: BoardBounds;
  readonly helpers: readonly BoardHelperVolume[];
}

export interface BoardExhibitMeasure {
  readonly id: string;
  readonly groupKey: string;
  readonly nodes: readonly (BoardBounds | BoardNode)[];
}

export interface BoardFramedExhibit {
  readonly id: string;
  readonly groupKey: string;
  readonly full: BoardBounds;
  readonly presence: BoardBounds;
  readonly helpers: readonly BoardHelperVolume[];
  readonly placement: BoardItemPlacement;
}

export interface BoardFrame {
  readonly layout: BoardLayout;
  readonly exhibits: readonly BoardFramedExhibit[];
  /** Union of placed presence boxes — what the default camera fits. */
  readonly frame: BoardBounds;
  /** Union of placed FULL boxes — what a naive frame-all would fit. */
  readonly fullFrame: BoardBounds;
}

const ZERO_BOUNDS: BoardBounds = { min: [0, 0, 0], max: [0, 0, 0] };

/** A plane is thinner than this on one axis, and larger than
 *  {@link PLANE_SPAN_METRES} on the other two. A shape of the box itself
 *  — not a comparison to its siblings — so a building with handles cannot
 *  classify as a plane. */
const PLANE_THIN_METRES = 0.35;
const PLANE_SPAN_METRES = 20;

function isFiniteBounds(bounds: BoardBounds): boolean {
  return [...bounds.min, ...bounds.max].every((value) => Number.isFinite(value));
}

function normalizeBounds(bounds: BoardBounds): BoardBounds {
  if (!isFiniteBounds(bounds)) return ZERO_BOUNDS;
  return {
    min: [
      Math.min(bounds.min[0], bounds.max[0]),
      Math.min(bounds.min[1], bounds.max[1]),
      Math.min(bounds.min[2], bounds.max[2]),
    ],
    max: [
      Math.max(bounds.min[0], bounds.max[0]),
      Math.max(bounds.min[1], bounds.max[1]),
      Math.max(bounds.min[2], bounds.max[2]),
    ],
  };
}

export function boundsSize(bounds: BoardBounds): readonly [number, number, number] {
  const normalized = normalizeBounds(bounds);
  return [
    normalized.max[0] - normalized.min[0],
    normalized.max[1] - normalized.min[1],
    normalized.max[2] - normalized.min[2],
  ];
}

export function boundsSpan(bounds: BoardBounds): number {
  return Math.max(...boundsSize(bounds));
}

export function unionBounds(boxes: readonly BoardBounds[]): BoardBounds {
  const finite = boxes.map(normalizeBounds).filter((box) => isFiniteBounds(box));
  if (finite.length === 0) return ZERO_BOUNDS;
  const first = finite[0]!;
  const min: [number, number, number] = [first.min[0], first.min[1], first.min[2]];
  const max: [number, number, number] = [first.max[0], first.max[1], first.max[2]];
  for (let i = 1; i < finite.length; i++) {
    const box = finite[i]!;
    min[0] = Math.min(min[0], box.min[0]);
    min[1] = Math.min(min[1], box.min[1]);
    min[2] = Math.min(min[2], box.min[2]);
    max[0] = Math.max(max[0], box.max[0]);
    max[1] = Math.max(max[1], box.max[1]);
    max[2] = Math.max(max[2], box.max[2]);
  }
  return { min, max };
}

export function translateBounds(
  bounds: BoardBounds,
  translation: readonly [number, number, number],
): BoardBounds {
  const normalized = normalizeBounds(bounds);
  return {
    min: [
      normalized.min[0] + translation[0],
      normalized.min[1] + translation[1],
      normalized.min[2] + translation[2],
    ],
    max: [
      normalized.max[0] + translation[0],
      normalized.max[1] + translation[1],
      normalized.max[2] + translation[2],
    ],
  };
}

/** Accept either a raw box or a {@link BoardNode} so layout ghosts (boxes
 *  only) and collected exhibits (boxes + overlay) share one call. */
export function asBoardNode(input: BoardBounds | BoardNode): BoardNode {
  if ('min' in input) return { bounds: input };
  return {
    bounds: input.bounds,
    ...(input.overlay === true ? { overlay: true as const } : {}),
    ...(input.enclosure === true ? { enclosure: true as const } : {}),
  };
}

/** Named kind for a helper volume, or `null` when the box is the exhibit's body.
 *
 *  `overlay` / `enclosure` are authored material marks. Size never names a
 *  volume or a skybox: a sibling ratio is what ate the hull-with-rivets
 *  and the building-with-handles. */
export function classifyHelper(
  bounds: BoardBounds,
  flags: { overlay?: boolean; enclosure?: boolean } = {},
): BoardHelperKind | null {
  if (flags.overlay) return 'volume';
  if (flags.enclosure) return 'environment-scale';
  const size = boundsSize(bounds);
  const rankedSize = [...size].sort((a, b) => b - a);
  const longest = rankedSize[0] ?? 0;
  const mid = rankedSize[1] ?? 0;
  const shortest = rankedSize[2] ?? 0;
  if (shortest < PLANE_THIN_METRES && mid >= PLANE_SPAN_METRES && longest >= PLANE_SPAN_METRES) {
    return 'unbounded-plane';
  }
  return null;
}

/**
 * The body of one exhibit, given one box per content node.
 *
 * A node is dropped only when it has a named helper kind — overlay volume,
 * enclosure / skybox, or unbounded plane — AND at least one body node
 * remains. A stacked building (drum + crown) is all body. A hull with
 * rivets is all body. A single-node exhibit is never trimmed: it *is* the
 * exhibit, even if that exhibit is a plane or a cone.
 */
export function exhibitPresence(nodes: readonly (BoardBounds | BoardNode)[]): ExhibitPresence {
  const content = nodes
    .map(asBoardNode)
    .map((node) => ({
      bounds: normalizeBounds(node.bounds),
      overlay: node.overlay === true,
      enclosure: node.enclosure === true,
    }))
    .filter((node) => isFiniteBounds(node.bounds));
  const boxes = content.map((node) => node.bounds);
  const full = unionBounds(boxes);
  if (content.length < 2) return { full, presence: full, helpers: [] };

  const kinds = content.map((node) =>
    classifyHelper(node.bounds, { overlay: node.overlay, enclosure: node.enclosure }),
  );
  const body = content.filter((_, index) => kinds[index] === null).map((node) => node.bounds);
  if (body.length === 0) return { full, presence: full, helpers: [] };

  const helpers: BoardHelperVolume[] = [];
  for (let i = 0; i < content.length; i++) {
    const kind = kinds[i] ?? null;
    if (kind === null) continue;
    helpers.push({ kind, bounds: content[i]!.bounds, size: boundsSize(content[i]!.bounds) });
  }
  return { full, presence: unionBounds(body), helpers };
}

/**
 * Lay every exhibit out by its PRESENCE box and compute the default frame.
 *
 * `fullFrame` is carried so a test (and a doctor) can name the camera the
 * old union would have produced without reconstructing it.
 */
export function frameThreeBoard(exhibits: readonly BoardExhibitMeasure[]): BoardFrame {
  const measured = exhibits.map((exhibit) => ({
    exhibit,
    presence: exhibitPresence(exhibit.nodes),
  }));

  const layoutItems: BoardLayoutItem[] = measured.map(({ exhibit, presence }) => ({
    id: exhibit.id,
    groupKey: exhibit.groupKey,
    bounds: presence.presence,
  }));
  const layout = layoutThreeBoard(layoutItems);
  const placementById = new Map<string, BoardItemPlacement>();
  for (const district of layout.districts) {
    for (const item of district.items) placementById.set(item.id, item);
  }

  const framed: BoardFramedExhibit[] = [];
  const placedPresence: BoardBounds[] = [];
  const placedFull: BoardBounds[] = [];
  for (const { exhibit, presence } of measured) {
    const placement = placementById.get(exhibit.id);
    if (!placement) continue;
    framed.push({
      id: exhibit.id,
      groupKey: exhibit.groupKey,
      full: presence.full,
      presence: presence.presence,
      helpers: presence.helpers,
      placement,
    });
    placedPresence.push(translateBounds(presence.presence, placement.translation));
    placedFull.push(translateBounds(presence.full, placement.translation));
  }

  return {
    layout,
    exhibits: framed,
    frame: unionBounds(placedPresence),
    fullFrame: unionBounds(placedFull),
  };
}

export interface BoardCameraSpec {
  readonly fovDeg: number;
  readonly aspect: number;
  readonly padding?: number;
}

export interface BoardCameraPose {
  readonly target: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly distance: number;
}

/**
 * Perspective fit of `frame` along `direction` (centre → camera). Same
 * geometry as `perspectiveDistanceToFitBox`, kept three-free so the unit
 * test is bounds-in / pose-out.
 */
export function boardCameraPose(
  frame: BoardBounds,
  direction: readonly [number, number, number],
  camera: BoardCameraSpec,
): BoardCameraPose {
  const normalized = normalizeBounds(frame);
  const target = [
    (normalized.min[0] + normalized.max[0]) / 2,
    (normalized.min[1] + normalized.max[1]) / 2,
    (normalized.min[2] + normalized.max[2]) / 2,
  ] as const;
  const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const view: readonly [number, number, number] = [
    direction[0] / length,
    direction[1] / length,
    direction[2] / length,
  ];
  const fallbackUp: readonly [number, number, number] =
    Math.abs(view[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const rightRaw: readonly [number, number, number] = [
    fallbackUp[1] * view[2] - fallbackUp[2] * view[1],
    fallbackUp[2] * view[0] - fallbackUp[0] * view[2],
    fallbackUp[0] * view[1] - fallbackUp[1] * view[0],
  ];
  const rightLen = Math.hypot(...rightRaw) || 1;
  const right: readonly [number, number, number] = [
    rightRaw[0] / rightLen,
    rightRaw[1] / rightLen,
    rightRaw[2] / rightLen,
  ];
  const up: readonly [number, number, number] = [
    view[1] * right[2] - view[2] * right[1],
    view[2] * right[0] - view[0] * right[2],
    view[0] * right[1] - view[1] * right[0],
  ];

  let halfDepth = 0;
  let halfHeight = 0;
  let halfWidth = 0;
  for (const x of [normalized.min[0], normalized.max[0]]) {
    for (const y of [normalized.min[1], normalized.max[1]]) {
      for (const z of [normalized.min[2], normalized.max[2]]) {
        const ox = x - target[0];
        const oy = y - target[1];
        const oz = z - target[2];
        halfWidth = Math.max(halfWidth, Math.abs(ox * right[0] + oy * right[1] + oz * right[2]));
        halfHeight = Math.max(halfHeight, Math.abs(ox * up[0] + oy * up[1] + oz * up[2]));
        halfDepth = Math.max(halfDepth, Math.abs(ox * view[0] + oy * view[1] + oz * view[2]));
      }
    }
  }

  const padding = camera.padding ?? 1.15;
  const verticalHalfFov = (camera.fovDeg * 0.5 * Math.PI) / 180;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.01));
  const fitDistance = Math.max(
    halfHeight / Math.tan(verticalHalfFov),
    halfWidth / Math.tan(horizontalHalfFov),
  );
  const distance = Math.max(fitDistance * padding + halfDepth, 3);
  return {
    target,
    distance,
    position: [
      target[0] + view[0] * distance,
      target[1] + view[1] * distance,
      target[2] + view[2] * distance,
    ],
  };
}

/** Approximate on-screen height of a world-space span at `distance`, as a
 *  fraction of the viewport. Used by tests to pin "identifiable", not by
 *  the board itself. */
export function viewportHeightFraction(
  worldHeight: number,
  distance: number,
  fovDeg: number,
): number {
  if (!(distance > 0)) return 0;
  const half = Math.tan((fovDeg * 0.5 * Math.PI) / 180) * distance;
  return worldHeight / (2 * half);
}
