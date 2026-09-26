/**
 * GRIDS → FRAMES → THE SAME ATLAS. The pixel craft's exit into the shared
 * artifact.
 *
 * The far end of a pixel bake is byte-for-byte the far end of a vector bake: one
 * atlas PNG plus a Pixi/TexturePacker spritesheet JSON with a named
 * `animations` map, packed by `atlas.ts` and honouring the cycle-set contracts
 * in `cycles.ts`. The game never knows which craft drew a frame, a user's own
 * Aseprite sheet still drops in, and one project can mix the two.
 *
 * HOW, and why it is this rather than a second pipeline: a grid is emitted as
 * SVG RECTANGLES — one path per palette colour, horizontal runs merged — and
 * handed to the existing rig/atlas/raster path. It costs no second packer, no
 * second sheet writer, no second seam check and no new dependency, and the
 * fidelity is exact rather than approximately exact: resvg rasterizes with
 * `shapeRendering: crispEdges`, so integer rects at an integer scale produce
 * ONLY palette colours and transparency. That is measured, not assumed — a 4×4
 * checker rendered at 1× and 8× contains exactly two distinct pixel values.
 *
 * A CYCLE IS A FLIPBOOK RIG. `SvgRig.pose(phase)` returns transforms, so a
 * multi-frame pixel animation is one group per frame, all drawn, with the pose
 * showing exactly one of them. The frames are already discrete drawings — that
 * is what pixel animation IS — so there is nothing to interpolate and the
 * contact sheet, the atlas composer and the cell-overflow guard all work on it
 * unchanged.
 */

import { cellAt, EMPTY, type PixelGrid, type PixelPalette, swatchRgb } from './pixel-grid';
import {
  cssHex,
  group,
  rig,
  shape,
  type SpriteAnimationPlan,
  type SvgRig,
  type SvgShapeNode,
} from './svg-rig';

/** A one-cell transparent margin around the art, in cells. */
const CELL_MARGIN = 1;

/**
 * The square atlas cell an animation's grids need.
 *
 * `max(width, height) + 2` for sprites: the atlas refuses a frame that touches
 * its cell border (it would bleed into whatever the packer put next door), so
 * the margin is not padding-for-taste, it is what makes the frame legal.
 * A TILE is the exact opposite — covering its cell edge to edge is its job — so
 * it takes no margin and must be square.
 */
function pixelCell(g: PixelGrid, tiles = false): number {
  if (tiles) {
    if (g.width !== g.height) {
      throw new Error(
        `sprite/pixel-atlas: a tiling grid must be square, got ${g.width}×${g.height}`,
      );
    }
    return g.width;
  }
  return Math.max(g.width, g.height) + CELL_MARGIN * 2;
}

/**
 * One grid as path DATA, one entry per colour, horizontal runs merged.
 *
 * `originX`/`originY` place the grid's TOP-LEFT cell in the target's
 * coordinates, which is how the same emitter serves a centred sprite (negative
 * origin), a top-left tile (zero) and a preview laid out on a sheet (wherever
 * the sheet wants it). Emitted in INDEX order, so the same grid always produces
 * the same bytes and a re-bake reproduces the atlas.
 */
function gridPaths(
  g: PixelGrid,
  options: { originX?: number; originY?: number } = {},
): { index: number; d: string }[] {
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const runsByIndex = new Map<number, string[]>();
  for (let y = 0; y < g.height; y++) {
    let x = 0;
    while (x < g.width) {
      const index = cellAt(g, x, y);
      if (index === EMPTY) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < g.width && cellAt(g, end, y) === index) end++;
      const run = runsByIndex.get(index) ?? [];
      run.push(`M${originX + x} ${originY + y}h${end - x}v1h${-(end - x)}z`);
      runsByIndex.set(index, run);
      x = end;
    }
  }
  return [...runsByIndex.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({ index, d: (runsByIndex.get(index) as string[]).join('') }));
}

/** One grid as rig SHAPES — a filled path per palette colour. */
function gridShapes(
  g: PixelGrid,
  pal: PixelPalette,
  options: { originX?: number; originY?: number } = {},
): SvgShapeNode[] {
  return gridPaths(g, options).map((run) =>
    shape(run.d, { fill: { color: swatchRgb(pal, run.index) } }),
  );
}

/** One grid as a raw SVG fragment — what the preview sheets lay out. */
export function gridSvgFragment(
  g: PixelGrid,
  pal: PixelPalette,
  options: { originX?: number; originY?: number } = {},
): string {
  return gridPaths(g, options)
    .map((run) => `<path d="${run.d}" fill="${cssHex(swatchRgb(pal, run.index))}"/>`)
    .join('');
}

export interface PixelAnimationOptions {
  /** Animation name in the spritesheet's `animations` map, e.g. `invader-a`. */
  readonly name: string;
  /** The cycle's frames, in order. Every grid must be the same size. */
  readonly grids: readonly PixelGrid[];
  readonly palette: PixelPalette;
  /**
   * This animation TILES — it covers its cell edge to edge, skips the margin,
   * and has its wrap-around join measured by the bake.
   */
  readonly tiles?: boolean;
}

/** Every grid in one animation must be the same size (see `pixelCell`). */
function assertUniform(options: PixelAnimationOptions): PixelGrid {
  const first = options.grids[0];
  if (!first) throw new Error(`sprite/pixel-atlas: animation "${options.name}" has no frames`);
  for (const g of options.grids) {
    if (g.width === first.width && g.height === first.height) continue;
    throw new Error(
      `sprite/pixel-atlas: animation "${options.name}" mixes a ${first.width}×${first.height} ` +
        `frame with a ${g.width}×${g.height} one — one cycle is one cell size, or the sprite ` +
        'jumps by half a pixel between frames.',
    );
  }
  return first;
}

/** A flipbook rig over the grids — see the header. */
function gridRig(options: PixelAnimationOptions): SvgRig {
  const first = assertUniform(options);
  const tiles = options.tiles ?? false;
  const cell = pixelCell(first, tiles);
  const originX = tiles ? 0 : Math.floor((cell - first.width) / 2) - cell / 2;
  const originY = tiles ? 0 : Math.floor((cell - first.height) / 2) - cell / 2;
  const frames = options.grids.length;
  const children = options.grids.map((g, index) =>
    group(`frame${index}`, {
      // Every frame is DRAWN; the pose shows one. `rest.alpha = 0` is what
      // makes "shown" the exception rather than something every pose must
      // restate for every other frame.
      rest: { alpha: 0 },
      children: gridShapes(g, options.palette, { originX, originY }),
    }),
  );
  return rig({
    origin: tiles ? 'top-left' : 'center',
    children,
    pose: (phase) => ({ [`frame${Math.min(frames - 1, Math.round(phase * frames))}`]: { alpha: 1 } }),
  });
}

/**
 * One pixel animation, as the bake spec's own `SpriteAnimationPlan`.
 *
 * This is the whole seam: a project's rig module returns these beside (or
 * instead of) vector plans, and `project.sprites.bake` treats them identically.
 */
export function pixelAnimation(options: PixelAnimationOptions): SpriteAnimationPlan {
  const first = assertUniform(options);
  const tiles = options.tiles ?? false;
  const plan: {
    name: string;
    frames: number;
    cell: number;
    rig: SvgRig;
    tiles?: boolean;
  } = {
    name: options.name,
    frames: options.grids.length,
    cell: pixelCell(first, tiles),
    rig: gridRig(options),
  };
  if (tiles) plan.tiles = true;
  return plan;
}
