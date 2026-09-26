/**
 * THE SIGHT LOOP for pixel art — edit script → run → LOOK → edit again.
 *
 * A construction script you cannot see is a script you cannot judge, and the
 * measured failure of blind pixel authoring is not subtle: column drift, broken
 * silhouettes, and frames that quietly stop being the same creature. These are
 * the four affordances that close that loop, one function each, all pure
 * (grid + palette in, PNG bytes out — no GPU, no session, no window):
 *
 *  - **8× nearest-neighbour, on DARK and LIGHT.** Two magnifications answer two
 *    different questions: 1× is whether the silhouette reads at the size the
 *    game draws it, 8× is whether the drawing is any good. Two backdrops
 *    because art tuned only against a near-black field hides a missing outline,
 *    and art tuned only against white hides a shadow that matches the ground.
 *  - **The cycle contact sheet** — every frame in one row, because identity
 *    drift is a property of the ROW and invisible one frame at a time.
 *  - **Onion skin** — the previous frame ghosted under the working one, the
 *    affordance whose absence is behind the dominant frame-drift failure.
 *  - **Frame diff** — exactly which cells changed, so drift is COUNTABLE
 *    (`changedCells`) rather than a vibe.
 *
 * Plus the tile's own proof: a 2×2 self-tiling, where a seam that the single
 * frame hides is obvious.
 *
 * Nearest-neighbour is not a setting here — it is arithmetic. A cell is emitted
 * as a rectangle `zoom` units wide and resvg rasterizes with `crispEdges`, so
 * an 8× preview contains exactly the palette's colours and nothing between
 * them.
 */

import { changedCells, EMPTY, type PixelGrid, type PixelPalette } from './pixel-grid';
import { gridSvgFragment } from './pixel-atlas';
import { type RasterImage, rasterizeSvg } from './raster';

/** `[dark, light]` — the two grounds every judgement is made against. */
export type Backdrops = readonly [string, string];

const DEFAULT_BACKDROPS: Backdrops = ['#0b0e1a', '#e9edf5'];
/** Gap between panels, in output pixels. */
const GAP = 8;

export interface PixelPreviewOptions {
  /** Magnification of the large band. 8 is the working size. */
  readonly zoom?: number;
  readonly backdrops?: Backdrops;
}

// NOT named `document`. The dev server prepends a lexical `window`/`document`
// shadow to every project module (the play-mode input gate), so a local
// `function document` is a duplicate declaration and the module fails to parse
// — with a syntax error, at bake time, nowhere near this line.
function svgDocument(width: number, height: number, body: string): RasterImage {
  return rasterizeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}">${body}</svg>`,
  );
}

/** One grid drawn at `scale`, with its own backdrop, at (x, y). */
function panel(
  g: PixelGrid,
  pal: PixelPalette,
  options: { x: number; y: number; scale: number; background: string; opacity?: number },
): string {
  const backdrop =
    `<rect x="${options.x}" y="${options.y}" width="${g.width * options.scale}" ` +
    `height="${g.height * options.scale}" fill="${options.background}"/>`;
  const opacity = options.opacity === undefined ? '' : ` opacity="${options.opacity}"`;
  return (
    backdrop +
    `<g transform="translate(${options.x} ${options.y}) scale(${options.scale})"${opacity}>` +
    gridSvgFragment(g, pal) +
    '</g>'
  );
}

/**
 * ONE frame, magnified and at game scale, over both backdrops.
 *
 * The default look after every burst of verbs: four panels, dark left, light
 * right, big above small.
 */
export function pixelPreview(
  g: PixelGrid,
  pal: PixelPalette,
  options: PixelPreviewOptions = {},
): RasterImage {
  const zoom = options.zoom ?? 8;
  const [dark, light] = options.backdrops ?? DEFAULT_BACKDROPS;
  const big = g.width * zoom;
  const width = GAP * 3 + big * 2;
  const height = GAP * 3 + g.height * zoom + g.height;
  const secondRow = GAP * 2 + g.height * zoom;
  return svgDocument(
    width,
    height,
    panel(g, pal, { x: GAP, y: GAP, scale: zoom, background: dark }) +
      panel(g, pal, { x: GAP * 2 + big, y: GAP, scale: zoom, background: light }) +
      panel(g, pal, { x: GAP, y: secondRow, scale: 1, background: dark }) +
      panel(g, pal, { x: GAP * 2 + big, y: secondRow, scale: 1, background: light }),
  );
}

/**
 * Every frame of a cycle in one row, twice — magnified over dark, then over
 * light — with a game-scale row underneath.
 *
 * Read it left to right and ask the only question that matters between frames:
 * is this the same creature moving, or a second creature?
 */
export function pixelCycleSheet(
  grids: readonly PixelGrid[],
  pal: PixelPalette,
  options: PixelPreviewOptions = {},
): RasterImage {
  const first = grids[0];
  if (!first) throw new Error('sprite/pixel-preview: a cycle sheet needs at least one frame');
  const zoom = options.zoom ?? 8;
  const [dark, light] = options.backdrops ?? DEFAULT_BACKDROPS;
  const step = first.width * zoom + GAP;
  const width = GAP + step * grids.length;
  const rows = [
    { scale: zoom, background: dark, height: first.height * zoom },
    { scale: zoom, background: light, height: first.height * zoom },
    { scale: 1, background: dark, height: first.height },
  ];
  const parts: string[] = [];
  let y = GAP;
  for (const row of rows) {
    grids.forEach((g, index) => {
      parts.push(
        panel(g, pal, {
          x: GAP + index * (row.scale === 1 ? g.width + GAP : step),
          y,
          scale: row.scale,
          background: row.background,
        }),
      );
    });
    y += row.height + GAP;
  }
  return svgDocument(width, y, parts.join(''));
}

/**
 * ONION SKIN — the previous frame ghosted under the working one.
 *
 * The one affordance a frame-by-frame animator will not work without: it shows
 * what MOVED and, far more usefully, what should not have. Emitted over both
 * backdrops because a ghost that is invisible on dark is not a check.
 */
export function pixelOnion(
  previous: PixelGrid,
  working: PixelGrid,
  pal: PixelPalette,
  options: PixelPreviewOptions & { ghost?: number } = {},
): RasterImage {
  const zoom = options.zoom ?? 8;
  const ghost = options.ghost ?? 0.35;
  const [dark, light] = options.backdrops ?? DEFAULT_BACKDROPS;
  const big = working.width * zoom;
  const width = GAP * 3 + big * 2;
  const height = GAP * 2 + working.height * zoom;
  const stack = (x: number, background: string): string =>
    panel(previous, pal, { x, y: GAP, scale: zoom, background, opacity: ghost }) +
    `<g transform="translate(${x} ${GAP}) scale(${zoom})">${gridSvgFragment(working, pal)}</g>`;
  return svgDocument(width, height, stack(GAP, dark) + stack(GAP * 2 + big, light));
}

/**
 * FRAME DIFF — the cells that changed, as a picture and as a number.
 *
 * Both frames are drawn faintly for context; every cell that differs is marked
 * ADDED (drawn in `b`, empty or another colour in `a`) or REMOVED (drawn in
 * `a`, gone in `b`). A two-frame shuffle should light up a dozen cells; if it
 * lights up the whole body, the frames are two different creatures and the
 * cycle will read as a flicker.
 */
export function pixelFrameDiff(
  a: PixelGrid,
  b: PixelGrid,
  pal: PixelPalette,
  options: PixelPreviewOptions & { added?: string; removed?: string } = {},
): { image: RasterImage; changed: number } {
  const zoom = options.zoom ?? 8;
  const added = options.added ?? '#39ff88';
  const removed = options.removed ?? '#ff3355';
  const [dark] = options.backdrops ?? DEFAULT_BACKDROPS;
  const changed = changedCells(a, b);
  const marks: string[] = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const before = a.cells[y * a.width + x] ?? EMPTY;
      const after = b.cells[y * b.width + x] ?? EMPTY;
      if (before === after) continue;
      marks.push(
        `<rect x="${x}" y="${y}" width="1" height="1" fill="${after === EMPTY ? removed : added}"/>`,
      );
    }
  }
  const width = GAP * 2 + a.width * zoom;
  const height = GAP * 2 + a.height * zoom;
  const image = svgDocument(
    width,
    height,
    panel(a, pal, { x: GAP, y: GAP, scale: zoom, background: dark, opacity: 0.3 }) +
      `<g transform="translate(${GAP} ${GAP}) scale(${zoom})" opacity="0.3">` +
      gridSvgFragment(b, pal) +
      '</g>' +
      `<g transform="translate(${GAP} ${GAP}) scale(${zoom})">${marks.join('')}</g>`,
  );
  return { image, changed };
}

/**
 * A tile against three copies of itself.
 *
 * The bake MEASURES a tile's wrap join (`atlas.ts`, `measureSeam`); this is how
 * you SEE it. A mark that crosses an edge without being drawn again shifted by
 * a whole tile shows up here as a broken line down the middle.
 */
export function pixelTilingProof(
  g: PixelGrid,
  pal: PixelPalette,
  options: { zoom?: number; background?: string } = {},
): RasterImage {
  const zoom = options.zoom ?? 4;
  // A tile is judged AGAINST ITS GROUND, so this one paints a backdrop rather
  // than leaving the sheet transparent: a sparse star field over nothing is a
  // picture of nothing, and the seam that matters is the one a player sees.
  const parts: string[] = [
    `<rect x="0" y="0" width="${GAP * 2 + g.width * zoom * 2}" ` +
      `height="${GAP * 2 + g.height * zoom * 2}" fill="${options.background ?? DEFAULT_BACKDROPS[0]}"/>`,
  ];
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      parts.push(
        `<g transform="translate(${GAP + tx * g.width * zoom} ${GAP + ty * g.height * zoom}) ` +
          `scale(${zoom})">${gridSvgFragment(g, pal)}</g>`,
      );
    }
  }
  return svgDocument(
    GAP * 2 + g.width * zoom * 2,
    GAP * 2 + g.height * zoom * 2,
    parts.join(''),
  );
}
