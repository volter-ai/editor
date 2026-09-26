/**
 * THE ATLAS — pack the frames, compose ONE document, rasterize it once, and
 * emit the ecosystem's standard artifact.
 *
 * The output pair is a PNG plus a Pixi/TexturePacker spritesheet JSON with a
 * named `animations` map. That is deliberate and is the whole
 * bring-your-own-sprites story: it is what Aseprite and TexturePacker export,
 * so a user's own sheet drops in with no code change when it honours the cycle
 * names, and ours drops into anything that reads the format.
 *
 * PACKING IS `maxrects-packer` — the library, not a shelf. The donor packed
 * with a hand-written shelf packer and said why: determinism
 * (`examples/top-down-survivor/src/tools/sprite-bake/atlas-layout.ts:6-11`).
 * MaxRects keeps that (same frame list in, same rectangle out) and stops
 * wasting the shelf's tail — the donor's 1024×512 sheet was mostly air.
 *
 * ONE RASTERIZATION, not one per frame. Every posed frame is embedded into a
 * single SVG document at its packed position and rasterized in one pass. Two
 * things fall out of that: it is several times faster than a call per frame,
 * and the seam check below can measure a tile against the pixels that are
 * actually beside it.
 */

import { MaxRectsPacker } from 'maxrects-packer';
import { assertFramesInsideCells, type CellRegion, frameFragment, rasterizeSvg } from './raster';
import type { SpriteBakeSpec } from './svg-rig';

/**
 * Transparent gutter around every cell, so a downscaled draw cannot sample a
 * neighbouring frame's pixels (donor: `atlas-layout.ts:16-18`).
 */
export const ATLAS_PADDING = 4;

export interface FramePlacement {
  readonly key: string;
  readonly animation: string;
  readonly index: number;
  readonly phase: number;
  readonly cell: number;
  readonly tiles: boolean;
  readonly origin: 'center' | 'top-left';
  /** Top-left of the cell inside the atlas. */
  readonly x: number;
  readonly y: number;
}

export interface AtlasLayout {
  readonly width: number;
  readonly height: number;
  readonly placements: readonly FramePlacement[];
}

/** Every frame the spec describes, in CATALOGUE order. */
export function specFrames(spec: SpriteBakeSpec): Omit<FramePlacement, 'x' | 'y'>[] {
  const frames: Omit<FramePlacement, 'x' | 'y'>[] = [];
  for (const animation of spec.animations) {
    if (animation.frames < 1) {
      throw new Error(
        `sprite/atlas: animation "${animation.name}" declares ${animation.frames} frames`,
      );
    }
    for (let index = 0; index < animation.frames; index++) {
      frames.push({
        key: `${animation.name}-${index}`,
        animation: animation.name,
        index,
        phase: index / animation.frames,
        cell: animation.cell,
        tiles: animation.tiles ?? false,
        origin: animation.rig.origin,
      });
    }
  }
  return frames;
}

/**
 * Place every frame. Deterministic: the packer is fed the frames in catalogue
 * order with rotation disabled, so the same catalogue always produces the same
 * rectangle in the same place — which is what lets a re-bake produce identical
 * bytes.
 */
export function packAtlas(
  frames: readonly Omit<FramePlacement, 'x' | 'y'>[],
  options: { padding?: number; maxSize?: number } = {},
): AtlasLayout {
  const padding = options.padding ?? ATLAS_PADDING;
  const maxSize = options.maxSize ?? 2048;
  const packer = new MaxRectsPacker(maxSize, maxSize, padding, {
    smart: true,
    pot: true,
    square: false,
    allowRotation: false,
    border: padding,
  });
  for (const frame of frames) packer.add(frame.cell, frame.cell, frame);
  if (packer.bins.length !== 1) {
    throw new Error(
      `sprite/atlas: ${frames.length} frames did not fit one ${maxSize}px sheet ` +
        `(${packer.bins.length} bins). Shrink a cell or raise maxSize.`,
    );
  }
  const bin = packer.bins[0];
  if (!bin) throw new Error('sprite/atlas: the packer produced no bin');
  const byKey = new Map<string, FramePlacement>();
  for (const rect of bin.rects) {
    const frame = (rect as { data?: Omit<FramePlacement, 'x' | 'y'> }).data;
    if (!frame) throw new Error('sprite/atlas: a packed rectangle carried no frame');
    byKey.set(frame.key, { ...frame, x: rect.x, y: rect.y });
  }
  // Emitted in CATALOGUE order, not packing order, so an animation's frame
  // list is in cycle order and the JSON diffs readably (donor:
  // `atlas-layout.ts:91-93`).
  const placements = frames.map((frame) => {
    const placed = byKey.get(frame.key);
    if (!placed) throw new Error(`sprite/atlas: frame ${frame.key} was never placed`);
    return placed;
  });
  return { width: bin.width, height: bin.height, placements };
}

/** Compose every posed frame into one SVG document at its packed position. */
export function composeAtlasSvg(spec: SpriteBakeSpec, layout: AtlasLayout): string {
  const rigByAnimation = new Map(
    spec.animations.map((animation) => [animation.name, animation.rig]),
  );
  const parts: string[] = [];
  layout.placements.forEach((placement, order) => {
    const rig = rigByAnimation.get(placement.animation);
    if (!rig) throw new Error(`sprite/atlas: no rig for animation ${placement.animation}`);
    const offset = placement.origin === 'center' ? placement.cell / 2 : 0;
    const attributes = [`transform="translate(${placement.x + offset} ${placement.y + offset})"`];
    if (placement.tiles) {
      // A tile draws its wrap copies OUTSIDE its own bounds by design, so it is
      // CLIPPED to its cell. The donor needed a render target for the same job
      // (`render-atlas.ts:217-238`); SVG has clipping natively.
      const id = `tile${order}`;
      parts.push(
        `<defs><clipPath id="${id}"><rect x="0" y="0" width="${placement.cell}" ` +
          `height="${placement.cell}"/></clipPath></defs>`,
      );
      attributes.push(`clip-path="url(#${id})"`);
    }
    parts.push(
      `<g ${attributes.join(' ')}>${frameFragment(rig, placement.phase, `f${order}_`)}</g>`,
    );
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}">${parts.join('')}</svg>`
  );
}

// ---------------------------------------------------------------------------
// The spritesheet document
// ---------------------------------------------------------------------------

export interface AtlasSheet {
  readonly frames: Record<
    string,
    {
      frame: { x: number; y: number; w: number; h: number };
      sourceSize: { w: number; h: number };
      spriteSourceSize: { x: number; y: number; w: number; h: number };
    }
  >;
  readonly animations: Record<string, string[]>;
  readonly meta: {
    app: string;
    version: string;
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: number;
  };
}

/** The Pixi spritesheet document, shaped exactly as `Assets.load` expects. */
export function buildSheet(
  layout: AtlasLayout,
  image: string,
  app = 'project.sprites.bake',
): AtlasSheet {
  const frames: AtlasSheet['frames'] = {};
  const animations: Record<string, string[]> = {};
  for (const placement of layout.placements) {
    frames[placement.key] = {
      frame: { x: placement.x, y: placement.y, w: placement.cell, h: placement.cell },
      sourceSize: { w: placement.cell, h: placement.cell },
      spriteSourceSize: { x: 0, y: 0, w: placement.cell, h: placement.cell },
    };
    const cycle = animations[placement.animation] ?? [];
    cycle.push(placement.key);
    animations[placement.animation] = cycle;
  }
  return {
    frames,
    animations,
    meta: {
      app,
      version: '1.0',
      image,
      format: 'RGBA8888',
      size: { w: layout.width, h: layout.height },
      scale: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// The seam check — ported from the donor, now renderer-free
// ---------------------------------------------------------------------------

export interface SeamReport {
  readonly animation: string;
  /** Mean channel difference across the wrapped column/row join. */
  readonly wrapColumn: number;
  readonly wrapRow: number;
  /** The same measurement for every ADJACENT pair inside the tile. */
  readonly interiorColumnMax: number;
  readonly interiorRowMax: number;
  readonly interiorColumnMean: number;
  readonly interiorRowMean: number;
  readonly seamless: boolean;
}

function columnDiff(
  pixels: Uint8Array,
  stride: number,
  left: number,
  right: number,
  top: number,
  height: number,
): number {
  let total = 0;
  for (let y = top; y < top + height; y++) {
    const a = (y * stride + left) * 4;
    const b = (y * stride + right) * 4;
    total +=
      Math.abs((pixels[a] ?? 0) - (pixels[b] ?? 0)) +
      Math.abs((pixels[a + 1] ?? 0) - (pixels[b + 1] ?? 0)) +
      Math.abs((pixels[a + 2] ?? 0) - (pixels[b + 2] ?? 0));
  }
  return total / (height * 3);
}

function rowDiff(
  pixels: Uint8Array,
  stride: number,
  top: number,
  bottom: number,
  left: number,
  width: number,
): number {
  let total = 0;
  for (let x = left; x < left + width; x++) {
    const a = (top * stride + x) * 4;
    const b = (bottom * stride + x) * 4;
    total +=
      Math.abs((pixels[a] ?? 0) - (pixels[b] ?? 0)) +
      Math.abs((pixels[a + 1] ?? 0) - (pixels[b + 1] ?? 0)) +
      Math.abs((pixels[a + 2] ?? 0) - (pixels[b + 2] ?? 0));
  }
  return total / (width * 3);
}

/**
 * Does the tile join to a copy of itself?
 *
 * Ported unchanged in substance from the donor (`render-atlas.ts:106-144`) and
 * now running on raw pixels with no renderer anywhere near it. A tile is
 * seamless when the join between its last column and its first is no more of a
 * discontinuity than any adjacency INSIDE the tile — that is the whole claim,
 * and it is one the pixels can answer. Comparing against the tile's own
 * interior maximum (rather than an invented constant) is what makes the check
 * survive an art change: add a hard line to the tile and the bar moves with it;
 * cut a mark off at the edge and the wrap join exceeds everything the interior
 * contains.
 */
export function measureSeam(
  pixels: Uint8Array,
  stride: number,
  placement: FramePlacement,
): SeamReport {
  const size = placement.cell;
  const { x: left, y: top } = placement;
  const columnDiffs: number[] = [];
  const rowDiffs: number[] = [];
  for (let i = 0; i < size - 1; i++) {
    columnDiffs.push(columnDiff(pixels, stride, left + i, left + i + 1, top, size));
    rowDiffs.push(rowDiff(pixels, stride, top + i, top + i + 1, left, size));
  }
  const wrapColumn = columnDiff(pixels, stride, left + size - 1, left, top, size);
  const wrapRow = rowDiff(pixels, stride, top + size - 1, top, left, size);
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
  const interiorColumnMax = Math.max(...columnDiffs);
  const interiorRowMax = Math.max(...rowDiffs);
  return {
    animation: placement.animation,
    wrapColumn,
    wrapRow,
    interiorColumnMax,
    interiorRowMax,
    interiorColumnMean: mean(columnDiffs),
    interiorRowMean: mean(rowDiffs),
    seamless: wrapColumn <= interiorColumnMax && wrapRow <= interiorRowMax,
  };
}

// ---------------------------------------------------------------------------
// The whole bake, as one pure function of the spec
// ---------------------------------------------------------------------------

export interface AtlasBakeResult {
  readonly png: Uint8Array;
  readonly sheet: AtlasSheet;
  readonly width: number;
  readonly height: number;
  readonly frameKeys: readonly string[];
  /** One report per animation declared as tiling. MEASURED, never asserted:
   *  what to do about a bad join is the caller's decision, not this file's. */
  readonly seams: readonly SeamReport[];
}

export function bakeAtlas(
  spec: SpriteBakeSpec,
  options: { padding?: number; maxSize?: number } = {},
): AtlasBakeResult {
  const layout = packAtlas(specFrames(spec), options);
  const image = rasterizeSvg(composeAtlasSvg(spec, layout));
  const regions: CellRegion[] = layout.placements
    .filter((placement) => !placement.tiles)
    .map((placement) => ({
      key: placement.key,
      x: placement.x,
      y: placement.y,
      cell: placement.cell,
    }));
  assertFramesInsideCells(
    image.pixels,
    image.width,
    regions,
    'the animation cell in the project’s rig module',
  );
  const seams = layout.placements
    .filter((placement) => placement.tiles)
    .map((placement) => measureSeam(image.pixels, image.width, placement));
  const imageName = spec.image.split('/').pop() ?? spec.image;
  return {
    png: image.png,
    sheet: buildSheet(layout, imageName),
    width: layout.width,
    height: layout.height,
    frameKeys: layout.placements.map((placement) => placement.key),
    seams,
  };
}
