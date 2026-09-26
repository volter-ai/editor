/**
 * THE SIGHT LOOP — a contact sheet of every phase, at two sizes, over two
 * backdrops.
 *
 * A vector rig is code, and code you cannot see is code you cannot judge. This
 * is the emitter that closes that loop: render → LOOK → revise. It exists
 * because the two questions an art pass actually has are answered at different
 * magnifications and against different grounds:
 *
 *  - GAME SCALE answers "does the silhouette survive?" — at 24–48 on-screen px
 *    everything except the outline stops mattering, and a rig that only ever
 *    got looked at zoomed in is a rig nobody has seen.
 *  - 4× answers "is the drawing any good?" — where the rim sits, whether the
 *    fold reads as cloth, whether two shapes that should meet actually do.
 *  - DARK vs LIGHT is the alpha and the ink: art tuned only against the game's
 *    near-black floor hides a missing outline, and art tuned only against white
 *    hides the fact that the shadow is the same value as the ground.
 *
 * All phases in one row, because IDENTITY DRIFT between frames is a property of
 * the row and invisible one frame at a time.
 */

import { type RasterImage, rasterizeSvg } from './raster';
import { poseToSvgFragment, type SvgRig } from './svg-rig';

export interface ContactSheetOptions {
  /** The rig's square cell, in authored (baked) pixels. */
  readonly cell: number;
  /** How many phases to lay out. Phase `i` is `i / frames`. */
  readonly frames: number;
  /**
   * Authored size → on-screen size. The donor bakes at 2× and draws at 1/2
   * (`examples/top-down-survivor/src/lib/sprite-frames.ts:39-40`), so 0.5.
   */
  readonly gameScale?: number;
  /** Magnification of the second pair of rows, relative to game scale. */
  readonly zoom?: number;
  /** `[dark, light]` CSS colours. */
  readonly backdrops?: readonly [string, string];
  /** Gap between frames, in on-screen pixels at each band's own scale. */
  readonly gap?: number;
}

interface Band {
  readonly scale: number;
  readonly background: string;
}

/** The contact sheet as an SVG document. */
export function contactSheetSvg(rig: SvgRig, options: ContactSheetOptions): string {
  const gameScale = options.gameScale ?? 0.5;
  const zoom = options.zoom ?? 4;
  const [dark, light] = options.backdrops ?? ['#0b0e1a', '#e9edf5'];
  const gap = options.gap ?? 6;
  const bands: Band[] = [
    { scale: gameScale, background: dark },
    { scale: gameScale, background: light },
    { scale: gameScale * zoom, background: dark },
    { scale: gameScale * zoom, background: light },
  ];

  const rowWidths = bands.map((band) => options.frames * (options.cell * band.scale + gap) + gap);
  const width = Math.ceil(Math.max(...rowWidths));
  const parts: string[] = [];
  let y = 0;
  bands.forEach((band, bandIndex) => {
    const cell = options.cell * band.scale;
    const height = cell + gap * 2;
    parts.push(
      `<rect x="0" y="${y}" width="${width}" height="${height}" fill="${band.background}"/>`,
    );
    for (let index = 0; index < options.frames; index++) {
      const x = gap + index * (cell + gap);
      const originOffset = rig.origin === 'center' ? cell / 2 : 0;
      parts.push(
        `<g transform="translate(${x + originOffset} ${y + gap + originOffset}) ` +
          `scale(${band.scale})">` +
          poseToSvgFragment(rig, index / options.frames, `b${bandIndex}f${index}_`) +
          '</g>',
      );
    }
    y += height;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.ceil(y)}" ` +
    `viewBox="0 0 ${width} ${Math.ceil(y)}">${parts.join('')}</svg>`
  );
}

/** The contact sheet, rasterized — `.png` is the bytes to write or look at. */
export function contactSheet(rig: SvgRig, options: ContactSheetOptions): RasterImage {
  return rasterizeSvg(contactSheetSvg(rig, options));
}
