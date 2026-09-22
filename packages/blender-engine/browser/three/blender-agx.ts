import { encodeDisplayFrame, sampleDisplayLut } from './blender-display-lut';

/**
 * Blender's AgX view transform, transcribed from the pinned OCIO config.
 *
 * WHY THIS EXISTS AND `THREE.AgXToneMapping` DOES NOT DO. three's AgX is
 * Filament's approximation: it allocates log2 to `AgxMaxEv = 4.026069` where
 * Blender's config allocates to `+12.5260688117`, and it substitutes a
 * 6th-order polynomial for the config's curve. MEASURED on flat grey, it is
 * 23 to 48 levels of 255 away from Blender -- 42 of them at middle grey, where
 * Blender answers 0.4456 and three answers 0.6060. Every render this lane
 * produced carried that.
 *
 * THE CHAIN IS THE CONFIG'S, step for step (`AgX Base Rec.1886` on display
 * `sRGB`):
 *
 *   scene linear Rec.709 -> CIE XYZ D65 -> Linear FilmLight E-Gamut
 *   -> lg2 allocation over [-12.47393, +12.5260688117]
 *   -> AgX_Base_sRGB.cube, 57^3, TETRAHEDRAL
 *   -> Rec.1886 -> sRGB  (the Rec.709 matrices cancel: `srgb(x^2.4)`)
 *
 * VERIFIED THREE WAYS, all agreeing to the digit: this code, Blender's own
 * `image.save_render()` on a known float buffer, and the `PyOpenColorIO` 2.5.0
 * that ships inside the oracle.
 *
 *     scene linear   here        save_render    OCIO
 *      0.01337859    0.008866    0.00886492     --
 *      0.15904408    0.158059    0.15805990     --
 *      1.01823460    0.559880    0.55986845     --
 *            0.18    0.461326    --             0.46132022   (sRGB encoded)
 *
 * A render of a flat emission plane is NOT the instrument -- Cycles' film does
 * not hand the view transform exactly the colour the emission node was set to,
 * and chasing that cost a wrong "unexplained residual" once.
 *
 * THE LUT IS DATA, not a curve: `agx-base-srgb.lut` is the config's own
 * `AgX_Base_sRGB.cube` as little-endian uint16 over [0,1], red varying fastest,
 * 185,193 RGB triples. One part in 65,535 is 0.004 of a 255-level step, far
 * under anything measurable here, and it halves what a project carries.
 * Source sha256 e707a36f3e90ee79bc342332febf91334c02ce3974cac700ece00ca9d4507491.
 *
 * NOT WIRED INTO THE VIEW YET, and the reason is named rather than left to be
 * discovered: `renderer.toneMapping` applies per fragment inside every
 * material's shader, and that seam takes an enum, not a 3D texture. Reaching
 * it means the photograph rendering to a float target and this chain running
 * as a full-screen pass. Until then the capture still uses three's curve and
 * the AgX LOOKS are still refused by name in `bpy/_render_three.py` -- which
 * is the honest state, not a degrade. The LOOKS also need a SECOND pinned LUT
 * (`luminance_compensation_bt2020.cube`, 37^3): their process space is `AgX
 * Log`, which is not this chain's E-Gamut path.
 */

/** The LUT's edge length; `AgX_Base_sRGB.cube` says `LUT_3D_SIZE 57`. */
export const AGX_LUT_SIZE = 57;

/** `AllocationTransform {allocation: lg2, vars: [-12.47393, 12.5260688117]}`.
 *  The ends are `log2(2^-10 * 0.18)` and `log2(2^15 * 0.18)`: ten stops under
 *  middle grey to fifteen over, which is why middle grey lands on exactly
 *  0.4 of the domain. */
const LOG2_MIN = -12.47393;
const LOG2_MAX = 12.5260688117;

/** Linear Rec.709 -> CIE XYZ D65, the inverse of the config's own
 *  `Linear Rec.709` matrix. */
const RGB_TO_XYZ = [
  [0.4123908, 0.3575843, 0.1804808],
  [0.212639, 0.7151687, 0.0721923],
  [0.0193308, 0.1191948, 0.9505322],
] as const;

/** CIE XYZ D65 -> Linear FilmLight E-Gamut, verbatim from the config. */
const XYZ_TO_EGAMUT = [
  [1.5250528, -0.3159135, -0.1226583],
  [-0.5091526, 1.3333274, 0.1382844],
  [0.0957153, 0.0508974, 0.7879558],
] as const;

/** In place, into `out`. A frame is 1.3M pixels, so nothing on this path
 *  allocates -- see `blender-display-lut.ts`'s header. */
function transform(
  m: readonly (readonly number[])[],
  v: ArrayLike<number>,
  out: Float64Array,
): void {
  const a = v[0]!;
  const b = v[1]!;
  const c = v[2]!;
  out[0] = m[0]![0]! * a + m[0]![1]! * b + m[0]![2]! * c;
  out[1] = m[1]![0]! * a + m[1]![1]! * b + m[1]![2]! * c;
  out[2] = m[2]![0]! * a + m[2]![1]! * b + m[2]![2]! * c;
}

/** Scratch for the two matrix stages and the display answer. */
const stageA = new Float64Array(3);
const stageB = new Float64Array(3);
const display: [number, number, number] = [0, 0, 0];

/** The sRGB display colourspace's own encode -- piecewise, not a pure 2.2. */
function srgbEncode(value: number): number {
  const v = Math.min(1, Math.max(0, value));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/**
 * The 57^3 LUT, sampled TETRAHEDRALLY -- which is what the config asks for by
 * name (`interpolation: tetrahedral`).
 *
 * On the neutral diagonal every barycentric weight collapses to the same `t`,
 * so a grey input is a straight lerp between the two diagonal corners; that is
 * the case the verification above exercises, and rendering at inputs that land
 * exactly ON a grid point exercises the table itself with no interpolation at
 * all.
 */
/** The returned triple is SCRATCH -- the next call overwrites it. */
export function sampleAgxLut(
  lut: Uint16Array,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  return sampleDisplayLut(lut, AGX_LUT_SIZE, r, g, b);
}

/** One scene-linear Rec.709 colour through Blender's AgX, to sRGB display.
 *  THE RETURNED TRIPLE IS SCRATCH -- the next call overwrites it. */
export function agxDisplay(lut: Uint16Array, rgb: ArrayLike<number>): [number, number, number] {
  transform(RGB_TO_XYZ, rgb, stageB);
  transform(XYZ_TO_EGAMUT, stageB, stageA);
  const span = LOG2_MAX - LOG2_MIN;
  const formed = sampleAgxLut(
    lut,
    (Math.log2(Math.max(stageA[0]!, 1e-10)) - LOG2_MIN) / span,
    (Math.log2(Math.max(stageA[1]!, 1e-10)) - LOG2_MIN) / span,
    (Math.log2(Math.max(stageA[2]!, 1e-10)) - LOG2_MIN) / span,
  );
  // The view ends at Rec.1886 and the display is sRGB; both are Rec.709
  // primaries, so the matrices cancel and only the two curves remain.
  display[0] = srgbEncode(Math.max(0, formed[0]) ** 2.4);
  display[1] = srgbEncode(Math.max(0, formed[1]) ** 2.4);
  display[2] = srgbEncode(Math.max(0, formed[2]) ** 2.4);
  return display;
}

/**
 * THE LOOKS, as the config's own composed transform.
 *
 * A look is not a curve that can be applied after the fact. OCIO converts to
 * the look's process space (`AgX Log` -- luminance-compensated Rec.2020 through
 * a SECOND 37^3 LUT, an inset matrix and the lg2 allocation), grades there,
 * converts back, and only then runs the display view. Two of those steps invert
 * a 3D LUT, which is not something to do per pixel in a browser.
 *
 * SO THE COMPOSED look+view IS SAMPLED, by OCIO itself, on the display LUT's
 * own lg2 grid -- `2^(x*(MAX-MIN)+MIN)` at every 57^3 corner, through the
 * `sRGB`/`AgX` display view with the look overridden. The table that comes out
 * is a drop-in for the base one: allocate, sample, done -- its values ARE the
 * sRGB display answer, so no `Rec.1886` step follows it.
 *
 * MEASURED against OCIO's direct answer for ten colours off the grid: WORST 3
 * LEVELS of 255 (`AgX - Medium High Contrast`) and 1 (`AgX - Punchy`). That
 * residual is resampling a curve that already contains an interpolated LUT,
 * and it lands on an artifact that is a DECLARED difference -- a three.js
 * raster is never compared to a Cycles path trace for equality.
 *
 * TWO OTHER REPRESENTATIONS WERE TRIED AND MEASURED WORSE. Baking the look
 * alone as a scene-to-scene map and re-log-encoding it scored 19 levels,
 * because a saturation grade produces NEGATIVE linear values and a log
 * encoding collapses every one of them onto its floor -- which is exactly why
 * the config's own `AgX Log` carries a luminance-compensation LUT to remove
 * the negatives before the grade. Carrying the log span alongside the table
 * did not help, because the loss is the floor, not the clamp.
 *
 * A LOOK WITH NO TABLE HERE IS REFUSED BY NAME in `bpy/_render_three.py`.
 * There is no generic path: `AgX - Base Contrast` is the identity and already
 * accepted, these two are baked, and the rest say so.
 */
export const AGX_LOOK_TABLES = {
  'AgX - Medium High Contrast': 'agx-look-medium-high-contrast.lut',
  'AgX - Punchy': 'agx-look-punchy.lut',
} as const;

/** One scene-linear Rec.709 colour through a composed look+view table.
 *  The returned triple is SCRATCH, as in `agxDisplay`. */
export function agxDisplayWithLook(
  lookLut: Uint16Array,
  rgb: ArrayLike<number>,
): [number, number, number] {
  // The composed table is sampled in the SCENE's own channels: OCIO was handed
  // `2^(x*(MAX-MIN)+MIN)` per axis, so the grid axis IS the allocated scene
  // value and no matrix runs before the lookup.
  const span = LOG2_MAX - LOG2_MIN;
  return sampleAgxLut(
    lookLut,
    (Math.log2(Math.max(rgb[0]!, 1e-10)) - LOG2_MIN) / span,
    (Math.log2(Math.max(rgb[1]!, 1e-10)) - LOG2_MIN) / span,
    (Math.log2(Math.max(rgb[2]!, 1e-10)) - LOG2_MIN) / span,
  );
}

/** One IEEE half (uint16 bits) as a JS number. `readRenderTargetPixels` on a
 *  `HalfFloatType` target hands back exactly these. */
export { decodeHalf } from './blender-display-lut';

/**
 * A captured HDR frame through Blender's AgX, as the RGBA bytes a PNG wants.
 *
 * THE FRAME IS ALREADY THERE. `Object3DDocumentSession.captureImage` renders
 * into a `HalfFloatType` target to keep lit surfaces off the byte clip, and
 * only then resolves through the viewport's output pass into the bytes it
 * reads back. That half-float target is scene-referred linear -- which is the
 * one thing an AgX LOOK, an EXR write and this transform all need and an
 * 8-bit canvas cannot give. `readRenderTargetPixels` accepts it: three's
 * `textureTypeReadable` passes `HalfFloatType` whenever
 * `EXT_color_buffer_half_float` or `EXT_color_buffer_float` is present, and
 * WebGL2 has both.
 *
 * ALPHA IS CARRIED, NOT TRANSFORMED. Blender treats alpha as data, not colour,
 * everywhere else in this lane (`Image.save`'s encode does the same), so it is
 * scaled to a byte and nothing more.
 */
export function agxEncodeFrame(
  lut: Uint16Array,
  halfPixels: Uint16Array,
  pixelCount: number,
  options: { readonly exposure?: number; readonly composedLook?: boolean } = {},
): Uint8ClampedArray {
  // BLENDER'S EXPOSURE IS A LINEAR MULTIPLIER APPLIED BEFORE THE VIEW
  // TRANSFORM (`view_settings.exposure` in stops, which the session already turns
  // into `2 ** stops`), which is the same place `toneMappingExposure` sat.
  const exposure = options.exposure ?? 1;
  // A composed look table IS the display answer; the base table still has the
  // matrices and the `Rec.1886 -> sRGB` tail after it.
  const through = options.composedLook === true ? agxDisplayWithLook : agxDisplay;
  return encodeDisplayFrame(halfPixels, pixelCount, exposure, (rgb) => through(lut, rgb));
}
