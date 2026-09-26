/**
 * THE PIXEL CANVAS — an indexed grid and the drawing VERBS that transform it.
 *
 * A pixel asset is a construction PROGRAM, exactly like a mesh: nobody places
 * one cell per tool call, and nobody emits a grid from memory (the measured
 * blind failure — column drift and broken silhouettes from about 16×16 up).
 * You write a script of verbs, run it, LOOK at the emitted previews
 * (`pixel-preview.ts`), and edit the script. So the verbs here are the level a
 * pixel artist thinks at — line, rect, ellipse, flood fill, mirror, wrap-shift,
 * auto-outline, ramp-shade, dither, replace-colour — with `set` underneath for
 * the surgical cells no primitive covers.
 *
 * PURE ARITHMETIC, ON PURPOSE. Nothing here imports anything: no renderer, no
 * DOM, no GPU, no session. Two consequences the rest of the kit is built on:
 * the bake runs anywhere Node runs, and the SAME functions run in the BROWSER
 * for art the game mutates while it plays (a shield bunker eroding pixel by
 * pixel is `set` plus `gridRgba` plus a texture upload, and nothing else).
 *
 * EVERY VERB IS `grid → grid`. A grid is treated as immutable; a verb copies,
 * writes, and hands back a new one, so a construction script reads as a
 * pipeline and an "undo" is deleting a line. Grids are small by definition
 * (the honest envelope is 8×8 to ~32×32), so the copy is never the cost.
 *
 * INDEXED, NEVER FREEHAND RGB. A cell holds a PALETTE INDEX; index 0 is
 * transparent and is not a colour. Colours live in named RAMPS (shadow → base
 * → light, hue-shifted — shadows lean cool, lights lean warm), which is what
 * makes `rampShade` expressible at all and what makes a palette swap one
 * constant instead of a repaint.
 */

/** The empty cell. Index 0 is transparent in every palette, by construction. */
export const EMPTY = 0;

/** One palette entry: a named colour, addressed by its index. */
export interface PixelSwatch {
  /** `<ramp>-<step>`, e.g. `phosphor-1`. Diagnostics name this, not a hex. */
  readonly name: string;
  /** 24-bit RGB. */
  readonly rgb: number;
}

/**
 * A palette: the flat swatch list plus the named ramps that give it structure.
 *
 * Ramps are ordered DARK → LIGHT. That order is not decoration: `rampShade`
 * walks it, and a cast that shares one outline value and a handful of ramps is
 * what makes a scene read as one piece of art.
 */
export interface PixelPalette {
  /** Index `i + 1` is `swatches[i]`; index 0 is {@link EMPTY}. */
  readonly swatches: readonly PixelSwatch[];
  /** Ramp name → its swatch INDICES, dark → light. */
  readonly ramps: Readonly<Record<string, readonly number[]>>;
}

/**
 * Build a palette from named ramps of RGB values.
 *
 *     const PAL = palette({ phosphor: [0x137a4a, 0x3ff08a, 0xc8ffe0] });
 *     const [SHADE, BASE, LIGHT] = ramp(PAL, 'phosphor');
 *
 * A one-colour ramp is a perfectly good ramp (the outline ink is one).
 */
export function palette(ramps: Readonly<Record<string, readonly number[]>>): PixelPalette {
  const swatches: PixelSwatch[] = [];
  const indices: Record<string, readonly number[]> = {};
  for (const [name, values] of Object.entries(ramps)) {
    if (values.length === 0) throw new Error(`sprite/pixel-grid: ramp "${name}" has no colours`);
    indices[name] = values.map((rgb, step) => {
      swatches.push({ name: `${name}-${step}`, rgb });
      return swatches.length; // 1-based: 0 is EMPTY
    });
  }
  if (swatches.length > 255) {
    throw new Error(
      `sprite/pixel-grid: ${swatches.length} swatches — a cell is one byte, so a palette holds ` +
        '255 colours plus transparent. Fewer ramps is also better art.',
    );
  }
  return { swatches, ramps: indices };
}

/** One ramp's indices, dark → light. Throws by NAME on a typo. */
export function ramp(pal: PixelPalette, name: string): readonly number[] {
  const found = pal.ramps[name];
  if (!found) {
    throw new Error(
      `sprite/pixel-grid: no ramp named "${name}" — the palette has ` +
        `[${Object.keys(pal.ramps).join(', ')}]`,
    );
  }
  return found;
}

/** The RGB behind a cell index. Throws rather than drawing a wrong colour. */
export function swatchRgb(pal: PixelPalette, index: number): number {
  if (index === EMPTY) throw new Error('sprite/pixel-grid: index 0 is transparent, not a colour');
  const swatch = pal.swatches[index - 1];
  if (!swatch) {
    throw new Error(
      `sprite/pixel-grid: index ${index} is outside this palette (${pal.swatches.length} swatches)`,
    );
  }
  return swatch.rgb;
}

/** The canvas: width × height cells of palette indices, row-major. */
export interface PixelGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major, `width * height` bytes. `cells[y * width + x]`. */
  readonly cells: Uint8Array;
}

/** A blank grid (or one flooded with `index`). */
export function grid(width: number, height: number, index: number = EMPTY): PixelGrid {
  if (width < 1 || height < 1 || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`sprite/pixel-grid: a ${width}×${height} grid is not a grid`);
  }
  const cells = new Uint8Array(width * height);
  if (index !== EMPTY) cells.fill(index);
  return { width, height, cells };
}

/** The index at (x, y). Outside the grid reads as {@link EMPTY}. */
export function cellAt(g: PixelGrid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= g.width || y >= g.height) return EMPTY;
  return g.cells[y * g.width + x] ?? EMPTY;
}

/** A working copy — every verb starts here. */
function mutableCopy(g: PixelGrid): { width: number; height: number; cells: Uint8Array } {
  return { width: g.width, height: g.height, cells: Uint8Array.from(g.cells) };
}

function write(
  target: { width: number; height: number; cells: Uint8Array },
  x: number,
  y: number,
  index: number,
): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  target.cells[y * target.width + x] = index;
}

// ---------------------------------------------------------------------------
// The verbs
// ---------------------------------------------------------------------------

/** One cell, as a construction script writes it: `[x, y, index]`. */
export type CellWrite = readonly [x: number, y: number, index: number];

/**
 * Surgical cells — the escape hatch under every primitive.
 *
 * An eye, a highlight, the one pixel that turns a blob into a face. Coordinates
 * outside the grid are dropped rather than throwing: a verb that clips is
 * composable, and a script that walks a shape off the edge should show that in
 * the preview, not in a stack trace.
 */
export function set(g: PixelGrid, cells: readonly CellWrite[]): PixelGrid {
  const out = mutableCopy(g);
  for (const [x, y, index] of cells) write(out, x, y, index);
  return out;
}

/** A straight line, Bresenham — inclusive of both ends. */
export function line(
  g: PixelGrid,
  options: { x0: number; y0: number; x1: number; y1: number; index: number },
): PixelGrid {
  const out = mutableCopy(g);
  let { x0, y0 } = options;
  const { x1, y1, index } = options;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    write(out, x0, y0, index);
    if (x0 === x1 && y0 === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
  return out;
}

/** A rectangle. `fill: false` draws the one-cell border only. */
export function rect(
  g: PixelGrid,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    index: number;
    fill?: boolean;
  },
): PixelGrid {
  const out = mutableCopy(g);
  const filled = options.fill ?? true;
  for (let row = 0; row < options.height; row++) {
    for (let col = 0; col < options.width; col++) {
      const edge =
        row === 0 || col === 0 || row === options.height - 1 || col === options.width - 1;
      if (filled || edge) write(out, options.x + col, options.y + row, options.index);
    }
  }
  return out;
}

/**
 * An ellipse inscribed in the box `(cx ± rx, cy ± ry)`.
 *
 * Scan-converted from the ellipse equation rather than midpoint-stepped,
 * because at these radii what matters is that the result is SYMMETRIC — a
 * two-pixel-wider left shoulder is visible on a 12px sprite and midpoint
 * variants drift by exactly that.
 */
export function ellipse(
  g: PixelGrid,
  options: { cx: number; cy: number; rx: number; ry: number; index: number; fill?: boolean },
): PixelGrid {
  const out = mutableCopy(g);
  const { cx, cy, rx, ry, index } = options;
  const filled = options.fill ?? true;
  const inside = (x: number, y: number): boolean => {
    const nx = (x - cx) / (rx + 0.5);
    const ny = (y - cy) / (ry + 0.5);
    return nx * nx + ny * ny <= 1;
  };
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (!inside(x, y)) continue;
      if (
        filled ||
        !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1))
      ) {
        write(out, x, y, index);
      }
    }
  }
  return out;
}

/** Flood fill (4-connected) from (x, y), replacing whatever index is there. */
export function fill(g: PixelGrid, options: { x: number; y: number; index: number }): PixelGrid {
  const target = cellAt(g, options.x, options.y);
  if (target === options.index) return g;
  const out = mutableCopy(g);
  const stack: number[] = [options.x, options.y];
  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) continue;
    if (out.cells[y * out.width + x] !== target) continue;
    out.cells[y * out.width + x] = options.index;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return out;
}

/**
 * Mirror one half onto the other about the grid's vertical centre line.
 *
 * Build half a sprite and mirror it: symmetry by construction is both faster
 * to author and the only way a 12px face comes out even. An odd width keeps
 * its centre column untouched.
 */
export function mirrorX(g: PixelGrid, options: { from?: 'left' | 'right' } = {}): PixelGrid {
  const from = options.from ?? 'left';
  const out = mutableCopy(g);
  const half = Math.floor(g.width / 2);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < half; x++) {
      const source = from === 'left' ? x : g.width - 1 - x;
      const destination = from === 'left' ? g.width - 1 - x : x;
      write(out, destination, y, cellAt(g, source, y));
    }
  }
  return out;
}

/**
 * Shift the whole grid, wrapping around the edges.
 *
 * The tile verb: a mark that leaves the right edge re-enters on the left, which
 * is how a seamless tile is drawn and how a scrolling strip is offset without
 * redrawing it.
 */
export function shiftWrap(g: PixelGrid, options: { dx?: number; dy?: number }): PixelGrid {
  const dx = ((options.dx ?? 0) % g.width) + g.width;
  const dy = ((options.dy ?? 0) % g.height) + g.height;
  const out = mutableCopy(g);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      write(out, (x + dx) % g.width, (y + dy) % g.height, cellAt(g, x, y));
    }
  }
  return out;
}

/**
 * Auto-outline: paint `index` into every EMPTY cell touching a drawn one.
 *
 * The chunky look as one call, and the reason a cast shares one ink value. The
 * outline grows OUTWARD, so a shape that already touches the grid edge loses
 * its outline there — the grid needs a one-cell margin, which is also what the
 * atlas's cell-border guard requires.
 */
export function outline(
  g: PixelGrid,
  options: { index: number; diagonal?: boolean },
): PixelGrid {
  const out = mutableCopy(g);
  const neighbours: readonly (readonly [number, number])[] = options.diagonal
    ? [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]
    : [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (cellAt(g, x, y) !== EMPTY) continue;
      const touches = neighbours.some(
        ([nx, ny]) => cellAt(g, x + nx, y + ny) !== EMPTY && cellAt(g, x + nx, y + ny) !== options.index,
      );
      if (touches) write(out, x, y, options.index);
    }
  }
  return out;
}

/**
 * Shade along a DIRECTION: re-step every cell of one ramp by where it sits.
 *
 * Value structure is the second thing a viewer reads (after silhouette), and
 * hand-picking each cell's step is exactly the blind work that goes wrong. This
 * projects each cell of the named ramp onto the light direction, normalises
 * across the drawn extent, and re-indexes: cells facing the light take the
 * ramp's light end, cells away from it the dark end.
 *
 * Cells of OTHER ramps are untouched, so a body can be shaded without moving
 * the outline or the eyes.
 */
export function rampShade(
  g: PixelGrid,
  pal: PixelPalette,
  options: { ramp: string; direction: readonly [number, number]; region?: readonly number[] },
): PixelGrid {
  const steps = ramp(pal, options.ramp);
  const member = new Set(options.region ?? steps);
  const [dx, dy] = options.direction;
  const magnitude = Math.hypot(dx, dy) || 1;
  const ux = dx / magnitude;
  const uy = dy / magnitude;

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  const projections: number[] = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (!member.has(cellAt(g, x, y))) continue;
      const projection = x * ux + y * uy;
      projections.push(projection);
      if (projection < low) low = projection;
      if (projection > high) high = projection;
    }
  }
  if (projections.length === 0) return g;

  const span = high - low || 1;
  const out = mutableCopy(g);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (!member.has(cellAt(g, x, y))) continue;
      const t = (x * ux + y * uy - low) / span;
      const step = Math.min(steps.length - 1, Math.floor(t * steps.length));
      write(out, x, y, steps[step] as number);
    }
  }
  return out;
}

/**
 * Checker a region with `index` — a DELIBERATE gradient band, never noise.
 *
 * Dithering is how two ramp steps blend without a third colour; scattered
 * dither is how art turns to mush. So this takes a region and a parity and
 * touches only cells that are already drawn (or already one of `over`), which
 * keeps the checker inside the silhouette.
 */
export function dither(
  g: PixelGrid,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    index: number;
    parity?: 0 | 1;
    over?: readonly number[];
  },
): PixelGrid {
  const parity = options.parity ?? 0;
  const over = options.over ? new Set(options.over) : null;
  const out = mutableCopy(g);
  for (let row = 0; row < options.height; row++) {
    for (let col = 0; col < options.width; col++) {
      const x = options.x + col;
      const y = options.y + row;
      if ((x + y) % 2 !== parity) continue;
      const current = cellAt(g, x, y);
      if (over ? !over.has(current) : current === EMPTY) continue;
      write(out, x, y, options.index);
    }
  }
  return out;
}

/** Swap one index for another everywhere — the one-line palette experiment. */
export function replaceColor(g: PixelGrid, options: { from: number; to: number }): PixelGrid {
  const out = mutableCopy(g);
  for (let i = 0; i < out.cells.length; i++) {
    if (out.cells[i] === options.from) out.cells[i] = options.to;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading a grid back
// ---------------------------------------------------------------------------

/**
 * How many cells differ between two grids of the same size.
 *
 * Frame-identity drift is the dominant failure of pixel animation, and it is
 * only ever caught as a VIBE unless something counts it. This is the number
 * behind `pixelFrameDiff`'s picture: a two-frame shuffle that changes 40 cells
 * has changed the creature, not its pose.
 */
export function changedCells(a: PixelGrid, b: PixelGrid): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `sprite/pixel-grid: cannot diff a ${a.width}×${a.height} grid against a ${b.width}×${b.height} one`,
    );
  }
  let changed = 0;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) changed++;
  return changed;
}

/**
 * The grid as straight (non-premultiplied) RGBA bytes.
 *
 * The browser-side door: a grid the GAME mutates while it plays becomes a
 * texture through this and a buffer upload (`gridTexture` in `runtime.ts`). It
 * is also pure arithmetic, so a unit test can assert the exact bytes without a
 * renderer anywhere near it.
 */
export function gridRgba(g: PixelGrid, pal: PixelPalette): Uint8Array {
  const out = new Uint8Array(g.width * g.height * 4);
  for (let i = 0; i < g.cells.length; i++) {
    const index = g.cells[i] ?? EMPTY;
    if (index === EMPTY) continue;
    const rgb = swatchRgb(pal, index);
    const at = i * 4;
    out[at] = (rgb >> 16) & 0xff;
    out[at + 1] = (rgb >> 8) & 0xff;
    out[at + 2] = rgb & 0xff;
    out[at + 3] = 255;
  }
  return out;
}
