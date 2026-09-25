import * as THREE from 'three';

/**
 * The colour to give a TONE-MAPPED material so the screen shows the palette's
 * exact sRGB hex — the inverse of three's ACES fit (the input and output
 * matrices and the RRT/ODT rational, `tonemapping_pars_fragment`) through the
 * exposure; Linear divides by it; no tone mapping passes through; any other
 * operator is left as-is.
 *
 * WHICH SURFACES ACTUALLY WANT IT, measured on the live Model stage
 * (`document-script` over the session's scene, beside a `capture-editor-chrome`
 * frame of the same instant — the chrome door serves the PRESENTED frame, so
 * the two are the same pixels):
 *
 *  - `scene.background` as a `THREE.Color`: **no**. three does not shade a
 *    colour background, it CLEARS to it (`WebGLBackground.setClear` →
 *    `glClearColor`), so no fragment shader and no tone map ever touches it.
 *    Measured: the scene held `#494949` — this function's inversion of the
 *    palette's `#3f3f3f` — and the screen read `#494949` exactly, luminance
 *    73 against Blender's 63. The inversion was compensating for a transform
 *    that does not run, and that alone is what made the stage light.
 *  - the floor grid (`editor-floor-grid`, a `ShaderMaterial` with
 *    `toneMapped: true`): **yes**. Measured: `uColor` held `#575757` — this
 *    function's inversion of the palette's `#545454` — and the 1 m line read
 *    83–84 on screen, i.e. the operator ran and landed it on the palette.
 *  - the floor axes (`LineSegments2`/`LineMaterial`, `toneMapped: false`):
 *    **no**. `toneMapped: false` is honoured per material (three compiles the
 *    tone-map chunk per program, not as a composer output pass), so the
 *    inverted colour reached the screen raw and over-saturated: `#ee234d`
 *    where Blender's X axis is `#cb293f`.
 *
 * So the operator runs PER MATERIAL here, not in a final composer pass: the
 * grid's `toneMapped: true` was mapped and the axes' `toneMapped: false` was
 * not, in the same frame, through the same composer.
 */
export function toneMappedSourceColor(
  hex: number,
  renderer: THREE.WebGLRenderer | undefined,
): THREE.Color {
  const target = new THREE.Color(hex); // sRGB hex → linear, three's management
  if (!renderer || renderer.toneMapping === THREE.NoToneMapping) return target;
  const exposure = renderer.toneMappingExposure || 1;
  if (renderer.toneMapping === THREE.LinearToneMapping) return target.multiplyScalar(1 / exposure);
  if (renderer.toneMapping === THREE.AgXToneMapping) return agxSourceColor(target, exposure);
  if (renderer.toneMapping === THREE.CustomToneMapping) return godotFilmicSourceColor(target, exposure);
  if (renderer.toneMapping !== THREE.ACESFilmicToneMapping) return target;
  const IN: Mat3 = [
    [0.59719, 0.35458, 0.04823],
    [0.076, 0.90834, 0.01566],
    [0.0284, 0.13383, 0.83777],
  ];
  const OUT: Mat3 = [
    [1.60475, -0.53108, -0.07367],
    [-0.10208, 1.10813, -0.00605],
    [-0.00327, -0.07276, 1.07602],
  ];
  const fit = (v: number) =>
    (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const invertFit = (f: number) => {
    let lo = 0;
    let hi = 64;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fit(mid) < f) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const f = mulMat3(invertMat3(OUT), [target.r, target.g, target.b]);
  const u = f.map((c) => (c <= 0 ? 0 : invertFit(Math.min(c, 0.999)))) as Vec3;
  const x = mulMat3(invertMat3(IN), u).map((c) => Math.max(0, c) * (0.6 / exposure)) as Vec3;
  return new THREE.Color().setRGB(x[0], x[1], x[2], THREE.LinearSRGBColorSpace);
}
/**
 * The same inversion for AgX — the operator the Blender look's stage runs
 * (`ToolViewportDressing.toneMapping`), because Blender's own scene does.
 *
 * Every step of `AgXToneMapping` (`tonemapping_pars_fragment.glsl`) run
 * backwards: the Rec.2020 round trip, the outset matrix, the 2.2 linearize,
 * the sigmoid (bisected — the contrast approximation is a sixth-order
 * polynomial with no closed inverse), the log2 encode, and the inset matrix.
 * three spells its matrices COLUMN-major, as GLSL's `mat3(vec3, vec3, vec3)`
 * constructor does; these are the transposes, because {@link mulMat3} is
 * row-major.
 */
function agxSourceColor(target: THREE.Color, exposure: number): THREE.Color {
  // three spells its matrices COLUMN-major, as GLSL's `mat3(vec3, vec3, vec3)`
  // constructor does; these are the transposes, because {@link mulMat3} is
  // row-major. Every row sums to 1 — each of the four is grey-preserving, and
  // that is the cheap check that the transposition is the right way round.
  const SRGB_TO_REC2020: Mat3 = [
    [0.6274, 0.3293, 0.0433],
    [0.0691, 0.9195, 0.0113],
    [0.0164, 0.088, 0.8956],
  ];
  const REC2020_TO_SRGB: Mat3 = [
    [1.6605, -0.5876, -0.0728],
    [-0.1246, 1.1329, -0.0083],
    [-0.0182, -0.1006, 1.1187],
  ];
  const INSET: Mat3 = [
    [0.856627153315983, 0.0951212405381588, 0.0482516061458583],
    [0.137318972929847, 0.761241990602591, 0.101439036467562],
    [0.11189821299995, 0.0767994186031903, 0.811302368396859],
  ];
  const OUTSET: Mat3 = [
    [1.1271005818144368, -0.11060664309660323, -0.016493938717834573],
    [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
    [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405],
  ];
  const MIN_EV = -12.47393;
  const MAX_EV = 4.026069;
  const contrast = (x: number) => {
    const x2 = x * x;
    const x4 = x2 * x2;
    return (
      15.5 * x4 * x2 -
      40.14 * x4 * x +
      31.96 * x4 -
      6.868 * x2 * x +
      0.4298 * x2 +
      0.1191 * x -
      0.00232
    );
  };
  const invertContrast = (f: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (contrast(mid) < f) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Every step of the forward operator, backwards and in reverse order.
  const rec2020 = mulMat3(SRGB_TO_REC2020, [target.r, target.g, target.b]);
  const sigmoid = mulMat3(
    invertMat3(OUTSET),
    rec2020.map((c) => Math.max(0, c) ** (1 / 2.2)) as Vec3,
  );
  const open = sigmoid.map((c) => 2 ** (invertContrast(c) * (MAX_EV - MIN_EV) + MIN_EV)) as Vec3;
  const linear = mulMat3(REC2020_TO_SRGB, mulMat3(invertMat3(INSET), open)).map(
    (c) => Math.max(0, c) / exposure,
  ) as Vec3;
  return new THREE.Color().setRGB(linear[0], linear[1], linear[2], THREE.LinearSRGBColorSpace);
}
type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
function mulMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}
function invertMat3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/**
 * The same inversion for Godot's Filmic — the curve the presentation's `filmic` mapper installs
 * in three's custom slot (`components/standard-viewport-dressing.ts`): Hable's curve with an
 * exposure bias of 2, divided by its value at white, per channel. Monotonic, so bisected.
 */
function godotFilmicSourceColor(target: THREE.Color, exposure: number): THREE.Color {
  const hable = (x: number) =>
    (x * (0.88 * x + 0.06) + 0.002) / (x * (0.88 * x + 0.6) + 0.06) - 0.01 / 0.3;
  const white = hable(1);
  const curve = (x: number) => hable(x) / white;
  const invert = (f: number) => {
    if (f <= 0) return 0;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (curve(mid) < f) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return new THREE.Color().setRGB(
    invert(Math.min(target.r, 0.999)) / exposure,
    invert(Math.min(target.g, 0.999)) / exposure,
    invert(Math.min(target.b, 0.999)) / exposure,
    THREE.LinearSRGBColorSpace,
  );
}
