/**
 * The 3D board's LAYOUT MATH — pure, three-free, and the whole product.
 *
 * The board exists to answer one question a thumbnail grid structurally cannot:
 * *how big is this thing, really, next to that thing?* So every rule here
 * serves TRUE SCALE readability, and the module emits only TRANSLATIONS —
 * there is no scale channel in the output at all, because normalizing sizes
 * would destroy the only thing the surface is for.
 *
 * The rules, in the order they apply:
 *
 *  1. **One district per story group.** Districts are the story-grouping
 *     model's clusters (`stories/story-grouping.ts` — `storyGroupKey`), laid
 *     out along +Z on ONE ground plane, in FIRST-APPEARANCE order — the group
 *     of the first item that names it comes first. That is the same order the
 *     React story board clusters its frames in, so a project reads the same way
 *     on both boards; it is deterministic for the same input, which is all a
 *     surface needs to be comparable against itself.
 *  2. **Every exhibit stands DIRECTLY ON THE FLOOR: its bounding-box BASE sits
 *     exactly at y = 0.** There is no vertical channel at all — not a lift, not
 *     a datum, not furniture under an exhibit. A 0.2 m prop is a 0.2 m prop
 *     seen from a 0.2 m-tall silhouette on the same floor a 30 m building
 *     stands on, which is exactly the comparison the board is for; the placard
 *     states the metres. {@link groundTranslationY} is the one place that
 *     number is computed, so "grounded" is a single expression rather than a
 *     convention spread across callers.
 *  3. **Each district gets a ground PAD** — a floor rectangle sized to the
 *     district's own footprint, whose front edge (`minZ`) is the district
 *     label's anchor. The pad is the figure-ground device that makes a cluster
 *     read as a room instead of a loose row.
 *  4. **Within a district, sorted by footprint (bbox XZ area), small → large,
 *     row-major along +X** — wrapping into further rows ({@link rowWrapWidth})
 *     so a large collection reads as a near-square gallery, not a queue. The
 *     monotonic size ramp is what makes the walk readable as a scale chart
 *     rather than a pile.
 *  5. **Spacing is proportional to the LARGER of the two neighbouring
 *     FOOTPRINTS** ({@link BoardLayoutOptions.neighbourGapFactor}) — not to a
 *     constant and not to the item's own size. That is the anti-crowding rule:
 *     a 0.2 m prop standing next to a 30 m building gets a gap set by the
 *     BUILDING, so the small thing is never swallowed by its neighbour's
 *     silhouette. It is also what keeps two exhibits' ground-hugging geometry
 *     from ever overlapping in XZ, now that every base shares one plane.
 *
 * Degenerate input is normalized, never propagated: an empty `THREE.Box3` is
 * `+Infinity`/`-Infinity`, and one `NaN` in a transform poisons an entire
 * subtree, so non-finite bounds collapse to a zero-size point.
 */

/** An axis-aligned bounding box in the mounted object's own world units. */
export interface BoardBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** One thing to lay out: a qualified story mount and the group it belongs to. */
export interface BoardLayoutItem {
  readonly id: string;
  /** `storyGroupKey(...)` — `''` is the ungrouped/flat case. */
  readonly groupKey: string;
  readonly bounds: BoardBounds;
}

export interface BoardItemPlacement {
  readonly id: string;
  readonly groupKey: string;
  /**
   * Translation to ADD to the mounted object's position so its bbox base sits
   * on the floor (y = 0) and its bbox XZ centre sits in its district slot.
   * Translation only — the board never scales an exhibit and never lifts one.
   */
  readonly translation: readonly [number, number, number];
  /** World point at the slot's ground centre — the exhibit stands here. */
  readonly anchor: readonly [number, number, number];
  /** True-scale bbox spans, carried through for chrome (labels read them). */
  readonly size: readonly [number, number, number];
  /**
   * The slot's reserved ground rectangle `[width, depth]`, centred on
   * {@link anchor}: the exhibit's own footprint plus breathing room. It is what
   * spacing and pad sizing are measured against — never a drawn object.
   */
  readonly footprint: readonly [number, number];
}

/** The ground-plane rectangle a district's pad occupies. */
export interface BoardExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface BoardDistrictPlacement {
  readonly groupKey: string;
  /** Exhibits in their laid-out order: footprint area ascending. */
  readonly items: readonly BoardItemPlacement[];
  /** The district's floor pad rectangle. */
  readonly extent: BoardExtent;
  /** Label anchor for the district title — the pad's FRONT edge (`minZ`),
   *  centred in X, on the ground. */
  readonly anchor: readonly [number, number, number];
}

export interface BoardLayout {
  readonly districts: readonly BoardDistrictPlacement[];
  readonly extent: BoardExtent;
}

export interface BoardLayoutOptions {
  /** Gap between neighbouring slots as a fraction of the LARGER neighbour. */
  readonly neighbourGapFactor?: number;
  /** Floor for that gap, so two tiny props still read as two props (metres). */
  readonly minGap?: number;
  /** Gap between district pads as a fraction of the deeper district. */
  readonly districtGapFactor?: number;
  /** Floor for the district gap (metres). */
  readonly minDistrictGap?: number;
}

const DEFAULTS = {
  neighbourGapFactor: 0.45,
  minGap: 0.5,
  districtGapFactor: 0.6,
  minDistrictGap: 3,
} satisfies Required<BoardLayoutOptions>;

/** The smallest ground rectangle a slot reserves — enough that a coin-sized
 *  exhibit still has a readable patch of floor to itself. */
const SLOT_MIN_FOOTPRINT = 0.7;

const ZERO_BOUNDS: BoardBounds = { min: [0, 0, 0], max: [0, 0, 0] };

/**
 * An empty `THREE.Box3` is `[+Inf, -Inf]`, and a subtree of pure lights/audio
 * has no measurable extent at all. Either way the honest answer is "a point",
 * not `NaN` smeared through every downstream transform.
 */
function normalizeBounds(bounds: BoardBounds): BoardBounds {
  const values = [...bounds.min, ...bounds.max];
  if (values.some((value) => !Number.isFinite(value))) return ZERO_BOUNDS;
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

function sizeOf(bounds: BoardBounds): readonly [number, number, number] {
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
}

/** The sort key: ground-plane footprint area. */
export function footprintArea(bounds: BoardBounds): number {
  const size = sizeOf(normalizeBounds(bounds));
  return size[0] * size[2];
}

/**
 * Rule 2 in one expression: the Y translation that puts a bbox base on the
 * floor. Every exhibit gets this and nothing else, so there is exactly one
 * place a vertical offset could ever be reintroduced.
 */
export function groundTranslationY(bounds: BoardBounds): number {
  return -normalizeBounds(bounds).min[1];
}

/** The ground rectangle an exhibit of `size` reserves: its own XZ footprint
 *  plus breathing room, never smaller than {@link SLOT_MIN_FOOTPRINT}. */
export function slotFootprint(size: readonly [number, number, number]): readonly [number, number] {
  const groundSpan = Math.max(size[0], size[2]);
  const margin = Math.max(0.15, 0.1 * groundSpan);
  return [
    Math.max(size[0] + 2 * margin, SLOT_MIN_FOOTPRINT),
    Math.max(size[2] + 2 * margin, SLOT_MIN_FOOTPRINT),
  ];
}

/** The single number a gap is measured against: the slot's larger ground span. */
function slotSpan(footprint: readonly [number, number]): number {
  return Math.max(footprint[0], footprint[1]);
}

/** One district's members in reading order: footprint area ascending, ties on
 *  id so a rebuild can never reshuffle equal-footprint neighbours (sort
 *  stability is not enough — the INPUT order is discovery order, which moves). */
function orderDistrictMembers(
  members: readonly BoardLayoutItem[],
): { item: BoardLayoutItem; bounds: BoardBounds }[] {
  return members
    .map((item) => ({ item, bounds: normalizeBounds(item.bounds) }))
    .sort((a, b) => {
      const areaDelta = footprintArea(a.bounds) - footprintArea(b.bounds);
      return areaDelta !== 0 ? areaDelta : a.item.id < b.item.id ? -1 : 1;
    });
}

/** A slot mid-layout: everything known before the row's Z is settled. */
interface PendingSlot {
  readonly item: BoardLayoutItem;
  readonly bounds: BoardBounds;
  readonly size: readonly [number, number, number];
  readonly footprint: readonly [number, number];
  readonly centreX: number;
}

interface PendingRow {
  readonly slots: PendingSlot[];
  /** The row's +X edge (last slot's right edge). */
  readonly xEdge: number;
  /** Deepest slot in the row. */
  readonly depth: number;
}

/**
 * The width a district's rows wrap at. A 13-piece collection in one single
 * file reads as a queue, not a gallery — wrapping into aisles keeps a
 * district's footprint near-square so the overview camera can actually get
 * close. The cap is never allowed to split what cannot wrap: it always admits
 * the widest single slot (a 40 m building is its own row).
 */
function rowWrapWidth(members: readonly { bounds: BoardBounds }[]): number {
  const widest = Math.max(
    SLOT_MIN_FOOTPRINT,
    ...members.map(({ bounds }) => slotSpan(slotFootprint(sizeOf(bounds)))),
  );
  return Math.max(10, 2.2 * widest);
}

/**
 * Break one district's ordered members into rows along +X, wrapping at
 * {@link rowWrapWidth}. Row-major reading order is preserved: the footprint
 * sort walks row by row, small → large.
 */
function wrapDistrictRows(
  members: readonly { item: BoardLayoutItem; bounds: BoardBounds }[],
  neighbourGapFactor: number,
  minGap: number,
): PendingRow[] {
  const wrapWidth = rowWrapWidth(members);
  const rows: PendingRow[] = [];
  let current: { slots: PendingSlot[]; xEdge: number; depth: number; previousSpan: number | null } =
    { slots: [], xEdge: 0, depth: 0, previousSpan: null };
  const closeRow = () => {
    if (current.slots.length > 0) {
      rows.push({ slots: current.slots, xEdge: current.xEdge, depth: current.depth });
    }
    current = { slots: [], xEdge: 0, depth: 0, previousSpan: null };
  };
  for (const { item, bounds } of members) {
    const size = sizeOf(bounds);
    const footprint = slotFootprint(size);
    const span = slotSpan(footprint);
    const gap =
      current.previousSpan === null
        ? 0
        : Math.max(minGap, neighbourGapFactor * Math.max(current.previousSpan, span));
    if (current.slots.length > 0 && current.xEdge + gap + footprint[0] > wrapWidth) {
      closeRow();
    }
    const lead = current.previousSpan === null ? 0 : gap;
    const centreX = current.xEdge + lead + footprint[0] / 2;
    current.xEdge = centreX + footprint[0] / 2;
    current.depth = Math.max(current.depth, footprint[1]);
    current.previousSpan = span;
    current.slots.push({ item, bounds, size, footprint, centreX });
  }
  closeRow();
  return rows;
}

/**
 * Place one district's rows, front row at `zStart`, wrapping deeper rows
 * behind it. Returns the placements and the district's own footprint.
 */
function layoutDistrict(
  groupKey: string,
  members: readonly { item: BoardLayoutItem; bounds: BoardBounds }[],
  zStart: number,
  neighbourGapFactor: number,
  minGap: number,
): { placements: BoardItemPlacement[]; xEdge: number; depth: number } {
  const rows = wrapDistrictRows(members, neighbourGapFactor, minGap);
  const placements: BoardItemPlacement[] = [];
  let zEdge = zStart;
  let previousDepth: number | null = null;
  let xEdge = 0;
  for (const row of rows) {
    if (previousDepth !== null) {
      zEdge += Math.max(minGap, neighbourGapFactor * Math.max(previousDepth, row.depth));
    }
    const centreZ = zEdge + row.depth / 2;
    zEdge = centreZ + row.depth / 2;
    previousDepth = row.depth;
    xEdge = Math.max(xEdge, row.xEdge);
    for (const slot of row.slots) {
      placements.push({
        id: slot.item.id,
        groupKey,
        translation: [
          slot.centreX - (slot.bounds.min[0] + slot.bounds.max[0]) / 2,
          groundTranslationY(slot.bounds),
          centreZ - (slot.bounds.min[2] + slot.bounds.max[2]) / 2,
        ],
        anchor: [slot.centreX, 0, centreZ],
        size: slot.size,
        footprint: slot.footprint,
      });
    }
  }
  return { placements, xEdge, depth: zEdge - zStart };
}

/** The pad's breathing room around its row of slots. */
function padMargin(rowDepth: number): number {
  return Math.min(3, Math.max(0.6, 0.08 * rowDepth));
}

/**
 * Lay out every qualified story mount at true scale. Pure: same input,
 * same output, no three.js, no DOM.
 */
export function layoutThreeBoard(
  items: readonly BoardLayoutItem[],
  options: BoardLayoutOptions = {},
): BoardLayout {
  const neighbourGapFactor = options.neighbourGapFactor ?? DEFAULTS.neighbourGapFactor;
  const minGap = options.minGap ?? DEFAULTS.minGap;
  const districtGapFactor = options.districtGapFactor ?? DEFAULTS.districtGapFactor;
  const minDistrictGap = options.minDistrictGap ?? DEFAULTS.minDistrictGap;

  const byGroup = new Map<string, BoardLayoutItem[]>();
  for (const item of items) {
    const bucket = byGroup.get(item.groupKey);
    if (bucket) bucket.push(item);
    else byGroup.set(item.groupKey, [item]);
  }

  const districts: BoardDistrictPlacement[] = [];
  let zEdge = 0;
  let previousDepth: number | null = null;

  // `Map` iterates in insertion order, and insertion above is the order the
  // groups first appear in `items` — rule 1's first-appearance ordering, shared
  // with the React story board's sections.
  for (const groupKey of byGroup.keys()) {
    const members = orderDistrictMembers(byGroup.get(groupKey) ?? []);
    // Two passes: measure the district's own footprint first, then place it —
    // the pad margin depends on the measured depth.
    const measured = layoutDistrict(groupKey, members, 0, neighbourGapFactor, minGap);
    const margin = padMargin(Math.max(measured.depth, SLOT_MIN_FOOTPRINT));
    const padDepth = measured.depth + 2 * margin;
    if (previousDepth !== null) {
      zEdge += Math.max(minDistrictGap, districtGapFactor * Math.max(previousDepth, padDepth));
    }
    const padMinZ = zEdge;
    zEdge = padMinZ + padDepth;
    previousDepth = padDepth;

    const { placements, xEdge } = layoutDistrict(
      groupKey,
      members,
      padMinZ + margin,
      neighbourGapFactor,
      minGap,
    );
    const extent: BoardExtent = {
      minX: -margin,
      maxX: xEdge + margin,
      minZ: padMinZ,
      maxZ: padMinZ + padDepth,
    };
    districts.push({
      groupKey,
      items: placements,
      extent,
      anchor: [(extent.minX + extent.maxX) / 2, 0, extent.minZ],
    });
  }

  const extent: BoardExtent =
    districts.length === 0
      ? { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
      : {
          minX: Math.min(...districts.map((district) => district.extent.minX)),
          maxX: Math.max(...districts.map((district) => district.extent.maxX)),
          minZ: Math.min(...districts.map((district) => district.extent.minZ)),
          maxZ: Math.max(...districts.map((district) => district.extent.maxZ)),
        };

  return { districts, extent };
}
