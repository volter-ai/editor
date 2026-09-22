/**
 * Tetrahedral sampling of normalized, red-fastest RGB display tables.
 *
 * THIS FILE IS THE FRAME LOOP, so it allocates NOTHING per pixel. Measured at
 * 1440x900: the previous shape returned a fresh array for each of the four
 * tetrahedron corners and built its result with `.map`, and `encodeDisplayFrame`
 * built a fresh `[r, g, b]` per pixel -- roughly ten allocations per pixel, 13M
 * per frame, and about half the wall clock. Every buffer below is module-level
 * scratch instead, which is why the returned triples are documented as SCRATCH:
 * a caller reads or copies the result before the next call, and the frame loop
 * does exactly that.
 */

/** Scratch: c000, second, third and c111 as four RGB triples. */
const corner = new Float64Array(12);
const sampled: [number, number, number] = [0, 0, 0];
const frac = new Float64Array(3);
const frameInput = new Float64Array(3);

/** THE SIX TETRAHEDRA of a cube cell, one row each: the second corner's
 *  offsets, the third corner's offsets, then which of `[fr, fg, fb]` supplies
 *  w1, w2 and w3. The same walk the branch chain did -- a flat table keeps the
 *  choice out of the sampler's own nesting. */
// biome-ignore format: one tetrahedron per row is the whole point of the table
const TETRA = new Int8Array([
  1, 0, 0,   1, 1, 0,   0, 1, 2,
  1, 0, 0,   1, 0, 1,   0, 2, 1,
  0, 0, 1,   1, 0, 1,   2, 0, 1,
  0, 0, 1,   0, 1, 1,   2, 1, 0,
  0, 1, 0,   0, 1, 1,   1, 2, 0,
  0, 1, 0,   1, 1, 0,   1, 0, 2,
]);

/** Which of the six the fractional position falls in -- the three fractions
 *  ordered largest first, as tetrahedral interpolation is defined. */
function tetraCase(fr: number, fg: number, fb: number): number {
  if (fr > fg) {
    if (fg > fb) return 0;
    return fr > fb ? 1 : 2;
  }
  if (fb > fg) return 3;
  if (fb > fr) return 4;
  return 5;
}

/** Tetrahedral sampling of normalized, red-fastest RGB display tables.
 *  THE RETURNED TRIPLE IS SCRATCH -- the next call overwrites it. */
export function sampleDisplayLut(
  lut: Uint16Array,
  n: number,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const plane = n * n;
  const x = Math.min(1, Math.max(0, r)) * (n - 1);
  const y = Math.min(1, Math.max(0, g)) * (n - 1);
  const z = Math.min(1, Math.max(0, b)) * (n - 1);
  const ir = Math.min(Math.floor(x), n - 2);
  const ig = Math.min(Math.floor(y), n - 2);
  const ib = Math.min(Math.floor(z), n - 2);
  const fr = x - ir;
  const fg = y - ig;
  const fb = z - ib;
  const read = (slot: number, dr: number, dg: number, db: number): void => {
    const at = (ir + dr + (ig + dg) * n + (ib + db) * plane) * 3;
    corner[slot] = lut[at]! / 65535;
    corner[slot + 1] = lut[at + 1]! / 65535;
    corner[slot + 2] = lut[at + 2]! / 65535;
  };
  read(0, 0, 0, 0);
  read(9, 1, 1, 1);
  frac[0] = fr;
  frac[1] = fg;
  frac[2] = fb;
  const t = tetraCase(fr, fg, fb) * 9;
  read(3, TETRA[t]!, TETRA[t + 1]!, TETRA[t + 2]!);
  read(6, TETRA[t + 3]!, TETRA[t + 4]!, TETRA[t + 5]!);
  const w1 = frac[TETRA[t + 6]!]!;
  const w2 = frac[TETRA[t + 7]!]!;
  const w3 = frac[TETRA[t + 8]!]!;
  for (let k = 0; k < 3; k++) {
    const c000 = corner[k]!;
    sampled[k] =
      c000 +
      w1 * (corner[3 + k]! - c000) +
      w2 * (corner[6 + k]! - corner[3 + k]!) +
      w3 * (corner[9 + k]! - corner[6 + k]!);
  }
  return sampled;
}

export function decodeHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -24 * fraction;
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** Transform associated scene-linear half-float RGBA to straight display RGBA.
 *  Unassociate before the nonlinear view transform; keep the input frame intact
 *  for the compositor and EXR. Alpha remains ungraded data.
 *  `through` is handed a REUSED triple -- it must read its three values before
 *  returning, which every display chain here does. */
export function encodeDisplayFrame(
  halfPixels: Uint16Array,
  pixelCount: number,
  exposure: number,
  through: (rgb: ArrayLike<number>) => readonly [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const at = i * 4;
    const alpha = decodeHalf(halfPixels[at + 3]!);
    const scale = alpha === 0 ? exposure : exposure / alpha;
    frameInput[0] = decodeHalf(halfPixels[at]!) * scale;
    frameInput[1] = decodeHalf(halfPixels[at + 1]!) * scale;
    frameInput[2] = decodeHalf(halfPixels[at + 2]!) * scale;
    const display = through(frameInput);
    out[at] = Math.round(display[0] * 255);
    out[at + 1] = Math.round(display[1] * 255);
    out[at + 2] = Math.round(display[2] * 255);
    out[at + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  }
  return out;
}

/**
 * Where a display table lives: beside this module, wherever this module is
 * served from.
 *
 * THE `.lut` SUFFIX IS SPELLED IN THE TEMPLATE, NOT IN THE ARGUMENT, and that
 * is the difference between a four-file glob and a whole-directory one. A
 * bundler cannot see the value of `file`, so it resolves
 * `new URL(`./${x}`, import.meta.url)` by globbing EVERY sibling -- measured
 * 2026-09-20 on the release build: every `.ts` in this directory came out
 * inlined as a base64 data URL beside the tables, 6.4 MB of module. With the
 * suffix in the template the glob is `./*.lut` and only the four tables are
 * reachable, which is the whole truth of what this function can return.
 */
export function displayTableUrl(file: string): URL {
  return new URL(`./${file.replace(/\.lut$/, '')}.lut`, import.meta.url);
}
