import { encodeDisplayFrame, sampleDisplayLut } from './blender-display-lut';

/** Blender 5.2 fbe6228777e7 OCIO Filmic/sRGB: log allocation, highlight
 * desaturation, then the display curve. filmic-srgb.lut contains the pinned
 * filmic_desat_33.cube followed by its 4096-entry display curve, normalized
 * to little-endian uint16. The table output is already display-encoded sRGB.
 */
const SIZE = 33;
const CUBE_VALUES = SIZE ** 3 * 3;
const CURVE_SIZE = 4096;
const LOG_MIN = -12.473931188;
const LOG_SPAN = 25;

function curve(lut: Uint16Array, value: number): number {
  const position = Math.min(1, Math.max(0, value)) * (CURVE_SIZE - 1);
  const index = Math.min(Math.floor(position), CURVE_SIZE - 2);
  const t = position - index;
  return ((1 - t) * lut[CUBE_VALUES + index]! + t * lut[CUBE_VALUES + index + 1]!) / 65535;
}

/** Scratch, as everything on the frame path is -- see `blender-display-lut.ts`. */
const display: [number, number, number] = [0, 0, 0];

/** One scene-linear colour through Filmic, to sRGB display.
 *  THE RETURNED TRIPLE IS SCRATCH -- the next call overwrites it. */
export function filmicDisplay(lut: Uint16Array, rgb: ArrayLike<number>): [number, number, number] {
  const desaturated = sampleDisplayLut(
    lut,
    SIZE,
    (Math.log2(Math.max(rgb[0]!, 1e-10)) - LOG_MIN) / LOG_SPAN,
    (Math.log2(Math.max(rgb[1]!, 1e-10)) - LOG_MIN) / LOG_SPAN,
    (Math.log2(Math.max(rgb[2]!, 1e-10)) - LOG_MIN) / LOG_SPAN,
  );
  display[0] = curve(lut, desaturated[0] / 0.66);
  display[1] = curve(lut, desaturated[1] / 0.66);
  display[2] = curve(lut, desaturated[2] / 0.66);
  return display;
}

export function filmicEncodeFrame(
  lut: Uint16Array,
  pixels: Uint16Array,
  count: number,
  exposure: number,
): Uint8ClampedArray {
  if (lut.length !== CUBE_VALUES + CURVE_SIZE)
    throw new Error('Invalid Blender Filmic display table');
  return encodeDisplayFrame(pixels, count, exposure, (rgb) => filmicDisplay(lut, rgb));
}
