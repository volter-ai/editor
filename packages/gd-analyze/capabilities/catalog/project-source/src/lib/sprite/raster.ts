/**
 * RASTERIZATION — SVG to pixels, headless.
 *
 * `@resvg/resvg-js` is resvg (the renderer behind `usvg`/tiny-skia) with a Node
 * binding: no GPU, no browser, no editor session, no window. That is the whole
 * reason the vector source format is SVG. The donor's bake had to ship its
 * render step INTO a live editor tab because rasterizing Pixi `Graphics` needs
 * a GPU (`examples/top-down-survivor/src/tools/sprite-bake.tool.ts:15-20`,
 * `src/tools/sprite-bake/render-atlas.ts:5-11`); a bake that needs a session is
 * a bake that cannot run in a check, on a build box, or from a script.
 *
 * DETERMINISM. resvg's rasterizer is CPU, fixed-point and seedless, so the same
 * SVG bytes produce the same pixels on the same build of the library. The rigs
 * upstream are pure functions of a phase, and the packer downstream is
 * deterministic for a fixed frame list — a re-bake reproduces the atlas.
 */

import { Resvg } from '@resvg/resvg-js';
import { poseToSvg, poseToSvgFragment, type SvgRig } from './svg-rig';

export interface RasterImage {
  /** RGBA, row-major, `width * height * 4` bytes. */
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** The same image as PNG bytes. */
  readonly png: Uint8Array;
}

/** Rasterize an SVG document. `width` overrides the document's own width. */
export function rasterizeSvg(svg: string, options: { width?: number } = {}): RasterImage {
  const resvg = new Resvg(
    svg,
    options.width === undefined
      ? { shapeRendering: 2, imageRendering: 0 }
      : { shapeRendering: 2, imageRendering: 0, fitTo: { mode: 'width', value: options.width } },
  );
  const rendered = resvg.render();
  return {
    pixels: new Uint8Array(rendered.pixels),
    width: rendered.width,
    height: rendered.height,
    png: new Uint8Array(rendered.asPng()),
  };
}

export interface RenderFramesOptions {
  /** How many cells the cycle has; frame `i` is posed at `i / cells`. */
  readonly cells: number;
  /** Square cell edge, in the rig's own (baked) pixels. */
  readonly cell: number;
  /** Multiplier on the output size. 1 bakes at authored size. */
  readonly scale?: number;
  /** A CSS colour painted behind each frame. Omitted leaves it transparent. */
  readonly background?: string;
}

/**
 * Pose a rig at every frame of its cycle and rasterize each one on its own.
 *
 * The atlas does NOT go through here — it composes one document and rasterizes
 * once (`atlas.ts`), which is both faster and the only way the seam check can
 * see real neighbouring pixels. This is the per-frame door the contact sheet
 * (`preview.ts`) and any one-off inspection use.
 */
export function renderFrames(rig: SvgRig, options: RenderFramesOptions): RasterImage[] {
  const scale = options.scale ?? 1;
  const images: RasterImage[] = [];
  for (let index = 0; index < options.cells; index++) {
    const documentOptions: { cell: number; scale: number; background?: string } = {
      cell: options.cell,
      scale,
    };
    if (options.background !== undefined) documentOptions.background = options.background;
    images.push(rasterizeSvg(poseToSvg(rig, index / options.cells, documentOptions)));
  }
  return images;
}

/** One posed frame as an SVG fragment — what the atlas composer embeds. */
export function frameFragment(rig: SvgRig, phase: number, idPrefix: string): string {
  return poseToSvgFragment(rig, phase, idPrefix);
}

/** A square region of a composed image, addressed by the frame that owns it. */
export interface CellRegion {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly cell: number;
}

/**
 * Every frame must sit strictly INSIDE its cell.
 *
 * Ported from the donor's own guard
 * (`examples/top-down-survivor/src/tools/sprite-bake/render-atlas.ts:146-196`),
 * including the reason it exists: a rig that overflows is invisible in the
 * sheet and obvious in the game, because its spill lands in whatever frame the
 * packer put next door and a hero walk cycle grows a stray imp horn. That
 * happened — the imp's horns cleared its 64px cell at the apex of its hop — and
 * eyeballing an atlas is exactly the wrong instrument for it, so the bake asks
 * the pixels instead: no non-transparent pixel may touch a cell's border ring.
 *
 * Tiles are exempt by not being passed in: covering a cell edge to edge is
 * their whole job.
 */
export function assertFramesInsideCells(
  pixels: Uint8Array,
  stride: number,
  regions: readonly CellRegion[],
  hint: string,
): void {
  const alphaAt = (x: number, y: number): number => pixels[(y * stride + x) * 4 + 3] ?? 0;
  const overflowing: string[] = [];
  for (const region of regions) {
    const { x, y, cell } = region;
    // Scanned strictly INSIDE the cell: the gutter can hold a neighbour's
    // spill, and a measurement that reads the neighbour cannot answer a
    // question about this frame.
    let left = cell;
    let top = cell;
    let right = -1;
    let bottom = -1;
    for (let row = 0; row < cell; row++) {
      for (let col = 0; col < cell; col++) {
        if (alphaAt(x + col, y + row) === 0) continue;
        if (col < left) left = col;
        if (col > right) right = col;
        if (row < top) top = row;
        if (row > bottom) bottom = row;
      }
    }
    if (left <= 0 || top <= 0 || right >= cell - 1 || bottom >= cell - 1) {
      overflowing.push(
        `${region.key} reaches [${left}, ${top}]–[${right}, ${bottom}] in a ${cell}px cell`,
      );
    }
  }
  if (overflowing.length > 0) {
    throw new Error(
      `sprite/raster: ${overflowing.length} frame(s) reach their cell border and will bleed into ` +
        `their neighbours — enlarge the animation's cell or pull the rig in (${hint}): ` +
        overflowing.join(', '),
    );
  }
}
