/**
 * Blender's `Standard` view transform, off a scene-linear frame.
 *
 * THE CONFIG SAYS WHAT THIS IS. In the pinned colour configuration
 * (`release/datafiles/colormanagement/config.ocio`) the `Standard` view
 * resolves to the `sRGB` display colour space, whose `from_display_reference`
 * is a `ColorSpaceTransform` to `Linear Rec.709` followed by
 * `ExponentWithLinearTransform {gamma: 2.4, offset: 0.055, direction: inverse}`.
 * Blender's scene reference IS Linear Rec.709, so the colour-space leg is the
 * identity and the whole transform is that one curve — the sRGB compound
 * (piece-wise) encoding, with no LUT and nothing to load.
 *
 * THE CONSTANTS ARE DERIVED, NOT QUOTED. OCIO computes the break point and the
 * linear slope from `gamma` and `offset` by requiring the two pieces to meet
 * with a continuous derivative, which lands at 0.0030402 and 12.9232 — close
 * to, and deliberately not, IEC 61966-2-1's rounded 0.0031308 and 12.92.
 * Deriving them here keeps the two numbers honest against the two the config
 * actually states.
 *
 * WHERE IT IS USED, and where it is not: a COMPOSITED frame, whose pixels are
 * the compositor's scene-referred output and can no longer be photographed
 * through three's own output encoding. An ordinary Standard render is still
 * three's capture, unchanged — it is the same curve applied by the same
 * renderer that drew the frame, and moving it here would change bytes for no
 * reason.
 *
 * NEGATIVE INPUT: clamped. OCIO's default negative handling for this transform
 * mirrors the curve about zero, which lands below zero and clips to byte 0 in
 * `encodeDisplayFrame` — the same byte clamping to zero produces, so the two
 * readings are indistinguishable in the PNG this writes.
 */
import { encodeDisplayFrame } from './blender-display-lut';

const GAMMA = 2.4;
const OFFSET = 0.055;
/** The display-side break, where the power piece meets the linear one. */
const BREAK = OFFSET / (GAMMA - 1);
/** The linear piece's slope, from matching the power piece's derivative there. */
const SLOPE = 1 / ((GAMMA / (1 + OFFSET)) * ((BREAK + OFFSET) / (1 + OFFSET)) ** (GAMMA - 1));
/** The same break expressed on the scene-linear side. */
const LINEAR_BREAK = ((BREAK + OFFSET) / (1 + OFFSET)) ** GAMMA;

/** One scene-linear channel through the sRGB compound encoding. */
export function standardChannel(value: number): number {
  if (!(value > 0)) return 0;
  if (value < LINEAR_BREAK) return value * SLOPE;
  return (1 + OFFSET) * value ** (1 / GAMMA) - OFFSET;
}

/** Scratch, as everything on the frame path is — see `blender-display-lut.ts`. */
const display: [number, number, number] = [0, 0, 0];

/** One scene-linear colour through Standard, to sRGB display.
 *  THE RETURNED TRIPLE IS SCRATCH — the next call overwrites it. */
export function standardDisplay(rgb: ArrayLike<number>): [number, number, number] {
  display[0] = standardChannel(rgb[0]!);
  display[1] = standardChannel(rgb[1]!);
  display[2] = standardChannel(rgb[2]!);
  return display;
}

export function standardEncodeFrame(
  pixels: Uint16Array,
  count: number,
  exposure: number,
): Uint8ClampedArray {
  return encodeDisplayFrame(pixels, count, exposure, standardDisplay);
}
