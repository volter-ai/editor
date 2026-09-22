/**
 * Blender's MULTIPLE SCATTERING sky, transcribed from the pinned source.
 *
 * `intern/sky/source/sky_multiple_scattering.cpp` precomputes a 512x256 XYZ
 * texture and `gpu_shader_material_tex_sky.glsl`'s `node_tex_sky_nishita` reads
 * it back per direction; both halves are here because both are what a script
 * sees through `ShaderNodeTexSky`.
 *
 * This is the MULTIPLE scattering model, not Nishita's single scattering. The
 * courtyard's own recording is why: its seq 31 sets `sky_type = 'NISHITA'` and
 * native REFUSES -- `enum "NISHITA" not found in ('SINGLE_SCATTERING',
 * 'MULTIPLE_SCATTERING', 'PREETHAM', 'HOSEK_WILKIE')` -- so the sky it renders
 * is the untouched default, which is MULTIPLE_SCATTERING.
 *
 * The constants and the arithmetic are the source's. The XYZ-to-scene-linear
 * matrix is not in the source -- it comes from the colour configuration -- and
 * was measured off the oracle by round-tripping an EXR through
 * `Linear CIE-XYZ D65`.
 */
import * as THREE from 'three';

const M_PI_2_F = 1.5707963267948966;
const M_2PI_F = 6.2831853071795864;
const M_1_PI_F = 0.3183098861837067;
const M_1_4PI_F = 0.0795774715459476;

const GROUND_ALBEDO = 0.3;
const PHASE_ISOTROPIC = M_1_4PI_F;
const RAYLEIGH_PHASE_SCALE = (3.0 / 16.0) * M_1_PI_F;
const G = 0.8;
const SQR_G = G * G;
const EARTH_RADIUS = 6371.0;
const ATMOSPHERE_THICKNESS = 100.0;
const ATMOSPHERE_RADIUS = EARTH_RADIUS + ATMOSPHERE_THICKNESS;
const TRANSMITTANCE_STEPS = 64;
const IN_SCATTERING_STEPS = 64;
const TRANSMITTANCE_RES_X = 256;
const TRANSMITTANCE_RES_Y = 64;

/** Sampled at 630, 560, 490 and 430 nm -- the four wavelengths the model uses. */
const SUN_SPECTRAL_IRRADIANCE = [1.679, 1.828, 1.986, 1.307];
const MOLECULAR_SCATTERING_COEFFICIENT_BASE = [6.605e-3, 1.067e-2, 1.842e-2, 3.156e-2];
const OZONE_ABSORPTION_CROSS_SECTION = [3.472e-25, 3.914e-25, 1.349e-25, 11.03e-27];
const OZONE_MEAN_DOBSON = 334.5;
const AEROSOL_ABSORPTION_CROSS_SECTION = [2.8722e-24, 4.6168e-24, 7.9706e-24, 1.3578e-23];
const AEROSOL_SCATTERING_CROSS_SECTION = [1.5908e-22, 1.7711e-22, 2.0942e-22, 2.4033e-22];
const AEROSOL_BASE_DENSITY = 1.3681e20;
const AEROSOL_BACKGROUND_DENSITY = 2e6;
const AEROSOL_HEIGHT_SCALE = 0.73;

const SPECTRAL_XYZ = [
  [53.386917738564668023, 22.981337506691024754, 0.0],
  [43.904844466369358263, 71.347795700053393866, 0.102506867965741307],
  [1.6137278251608962005, 18.422960591455485011, 31.742921188390805758],
  [20.762668673810577145, 2.3614213523314368527, 110.48009643252140334],
];

/** `IMB_colormanagement_get_xyz_to_scene_linear()`, measured on the oracle by
 *  loading an EXR of the three basis vectors as `Linear CIE-XYZ D65`. */
const XYZ_TO_RGB = [
  [3.2409698963165283, -1.5373831987380981, -0.49861079454421997],
  [-0.969243586063385, 1.8759675025939941, 0.041555099189281464],
  [0.05563009902834892, -0.20397700369358063, 1.056971549987793],
];

const sqr = (a: number): number => a * a;
const saturate = (a: number): number => (a < 0 ? 0 : a > 1 ? 1 : a);
const mix = (x: number, y: number, a: number): number => x + a * (y - x);
const safeSqrt = (f: number): number => Math.sqrt(Math.max(f, 0));

/** `sun_direction(cos_theta)` -- in the model's own frame, azimuth zero. */
const sunDirection = (cosTheta: number): [number, number, number] => [
  -Math.sqrt(1.0 - cosTheta * cosTheta),
  0.0,
  cosTheta,
];

function raySphereIntersection(
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  radius: number,
): number {
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - radius * radius;
  if (c > 0 && b > 0) return -1;
  const d = b * b - c;
  if (d < 0) return -1;
  return d >= b * b ? -b + Math.sqrt(d) : -b - Math.sqrt(d);
}

const molecularPhase = (cosTheta: number): number => RAYLEIGH_PHASE_SCALE * (1.0 + sqr(cosTheta));

function aerosolPhase(cosTheta: number): number {
  const den = 1.0 + SQR_G + 2.0 * G * cosTheta;
  return (M_1_4PI_F * (1.0 - SQR_G)) / (den * Math.sqrt(den));
}

const aerosolDensity = (h: number): number =>
  AEROSOL_BASE_DENSITY *
  (Math.exp(-h / AEROSOL_HEIGHT_SCALE) + AEROSOL_BACKGROUND_DENSITY / AEROSOL_BASE_DENSITY);

export interface SkyParameters {
  sunElevation: number;
  sunRotation: number;
  altitude: number;
  airDensity: number;
  aerosolDensity: number;
  ozoneDensity: number;
}

/** `sky_simplify_multiscatter_elevation_rotation` -- the sun is wrapped into
 *  the half of the sphere the texture covers, and the rotation carries the
 *  other half. */
function simplify(sunElevation: number, sunRotation: number): [number, number] {
  let elevation = sunElevation % M_2PI_F;
  if (Math.abs(elevation) >= Math.PI) elevation -= Math.sign(elevation) * 2.0 * Math.PI;
  let rotation = sunRotation;
  if (elevation >= M_PI_2_F || elevation <= -M_PI_2_F) {
    elevation = Math.sign(elevation) * Math.PI - elevation;
    rotation += Math.PI;
  }
  rotation = rotation % M_2PI_F;
  if (rotation < 0) rotation += M_2PI_F;
  rotation = M_2PI_F - rotation;
  return [elevation, rotation];
}

class Atmosphere {
  private readonly lut = new Float32Array(TRANSMITTANCE_RES_Y * TRANSMITTANCE_RES_X * 4);

  constructor(
    private readonly air: number,
    private readonly aerosol: number,
    private readonly ozone: number,
  ) {}

  /** `get_atmosphere_collision_coefficients`, into a caller's four slots. */
  private coefficients(altitude: number, out: Float64Array): void {
    const local = aerosolDensity(altitude) * this.aerosol;
    const logH = Math.log(Math.max(altitude, 1e-4));
    const ozoneDensity = 3.78547397e20 * Math.exp(-sqr(logH - 3.22261) * 5.55555555 - logH);
    const molecular = Math.exp(-0.07771971 * altitude ** 1.16364243);
    for (let i = 0; i < 4; i++) {
      out[i] = AEROSOL_ABSORPTION_CROSS_SECTION[i]! * local; // aerosol absorption
      out[4 + i] = AEROSOL_SCATTERING_CROSS_SECTION[i]! * local; // aerosol scattering
      out[8 + i] =
        OZONE_ABSORPTION_CROSS_SECTION[i]! * OZONE_MEAN_DOBSON * ozoneDensity * this.ozone;
      out[12 + i] = MOLECULAR_SCATTERING_COEFFICIENT_BASE[i]! * molecular * this.air;
    }
  }

  /** `get_transmittance`: the atmosphere from an altitude to the sun. */
  transmittance(cosTheta: number, normalizedAltitude: number, out: Float64Array): void {
    const [sx, sy, sz] = sunDirection(cosTheta);
    const distance = mix(EARTH_RADIUS, ATMOSPHERE_RADIUS, normalizedAltitude);
    const td = raySphereIntersection(0, 0, distance, sx, sy, sz, ATMOSPHERE_RADIUS);
    const step = td / TRANSMITTANCE_STEPS;
    const acc = [0, 0, 0, 0];
    const slots = new Float64Array(16);
    for (let s = 0; s < TRANSMITTANCE_STEPS; s++) {
      const t = (s + 0.5) * step;
      const x = sx * t,
        y = sy * t,
        z = distance + sz * t;
      const altitude = Math.max(Math.hypot(x, y, z) - EARTH_RADIUS, 0);
      this.coefficients(altitude, slots);
      for (let i = 0; i < 4; i++) {
        acc[i]! += (slots[i]! + slots[4 + i]! + slots[8 + i]! + slots[12 + i]!) * step;
      }
    }
    for (let i = 0; i < 4; i++) out[i] = Math.exp(-acc[i]!);
  }

  precompute(): void {
    const out = new Float64Array(4);
    for (let y = 0; y < TRANSMITTANCE_RES_Y; y++) {
      for (let x = 0; x < TRANSMITTANCE_RES_X; x++) {
        const u = x / (TRANSMITTANCE_RES_X - 1);
        const v = y / (TRANSMITTANCE_RES_Y - 1);
        this.transmittance(u * 2.0 - 1.0, v, out);
        const at = (y * TRANSMITTANCE_RES_X + x) * 4;
        for (let i = 0; i < 4; i++) this.lut[at + i] = out[i]!;
      }
    }
  }

  private lookup(cosTheta: number, normalizedAltitude: number, out: Float64Array): void {
    const x = (TRANSMITTANCE_RES_X - 1) * saturate(cosTheta * 0.5 + 0.5);
    const y = (TRANSMITTANCE_RES_Y - 1) * saturate(normalizedAltitude);
    const x1 = Math.trunc(x),
      y1 = Math.trunc(y);
    const x2 = Math.min(x1 + 1, TRANSMITTANCE_RES_X - 1);
    const y2 = Math.min(y1 + 1, TRANSMITTANCE_RES_Y - 1);
    const fx = x - x1,
      fy = y - y1;
    const a = (y1 * TRANSMITTANCE_RES_X + x1) * 4,
      b = (y1 * TRANSMITTANCE_RES_X + x2) * 4;
    const c = (y2 * TRANSMITTANCE_RES_X + x1) * 4,
      d = (y2 * TRANSMITTANCE_RES_X + x2) * 4;
    for (let i = 0; i < 4; i++) {
      out[i] = mix(
        mix(this.lut[a + i]!, this.lut[b + i]!, fx),
        mix(this.lut[c + i]!, this.lut[d + i]!, fx),
        fy,
      );
    }
  }

  private lookupAtGround(cosTheta: number, out: Float64Array): void {
    const x = (TRANSMITTANCE_RES_X - 1) * saturate(cosTheta * 0.5 + 0.5);
    const x1 = Math.trunc(x),
      x2 = Math.min(x1 + 1, TRANSMITTANCE_RES_X - 1);
    const fx = x - x1;
    for (let i = 0; i < 4; i++) out[i] = mix(this.lut[x1 * 4 + i]!, this.lut[x2 * 4 + i]!, fx);
  }

  private lookupToSun(normalizedAltitude: number, out: Float64Array): void {
    const y = (TRANSMITTANCE_RES_Y - 1) * saturate(normalizedAltitude);
    const y1 = Math.trunc(y),
      y2 = Math.min(y1 + 1, TRANSMITTANCE_RES_Y - 1);
    const fy = y - y1;
    const x = TRANSMITTANCE_RES_X - 1;
    for (let i = 0; i < 4; i++) {
      out[i] = mix(
        this.lut[(y1 * TRANSMITTANCE_RES_X + x) * 4 + i]!,
        this.lut[(y2 * TRANSMITTANCE_RES_X + x) * 4 + i]!,
        fy,
      );
    }
  }

  /** `get_inscattering` along one ray, returned as spectral radiance. */
  inscattering(
    sun: [number, number, number],
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    td: number,
    out: Float64Array,
  ): void {
    const cosTheta = -(dx * sun[0] + dy * sun[1] + dz * sun[2]);
    const phaseM = molecularPhase(cosTheta);
    const phaseA = aerosolPhase(cosTheta);
    const dt = td / IN_SCATTERING_STEPS;
    const slots = new Float64Array(16);
    const toSun = new Float64Array(4);
    const ms = new Float64Array(4);
    const ground = new Float64Array(4);
    const atZero = new Float64Array(4);
    const atHeight = new Float64Array(4);
    const L = [0, 0, 0, 0];
    const transmittance = [1, 1, 1, 1];
    for (let s = 0; s < IN_SCATTERING_STEPS; s++) {
      const t = (s + 0.5) * dt;
      const x = ox + dx * t,
        y = oy + dy * t,
        z = oz + dz * t;
      const distance = Math.hypot(x, y, z);
      const altitude = Math.max(distance - EARTH_RADIUS, 0);
      const normalized = altitude / ATMOSPHERE_THICKNESS;
      const sampleCos = (x * sun[0] + y * sun[1] + z * sun[2]) / distance;
      this.coefficients(altitude, slots);
      this.lookup(sampleCos, normalized, toSun);
      // `lookup_multiscattering`: second-order bounce off the ground, plus the
      // analytical fit for everything else in the atmosphere.
      const omega = M_2PI_F * (1.0 - safeSqrt(1.0 - sqr(EARTH_RADIUS / distance)));
      this.lookupAtGround(sampleCos, ground);
      this.lookupToSun(0.0, atZero);
      this.lookupToSun(normalized, atHeight);
      const fit = 1.0 / (1.0 + 5.0 * Math.exp(-17.92 * sampleCos));
      const MS_FIT = [0.217, 0.347, 0.594, 1.0];
      for (let i = 0; i < 4; i++) {
        const groundToSample = atZero[i]! / atHeight[i]!;
        const lGround =
          PHASE_ISOTROPIC *
          omega *
          (GROUND_ALBEDO * M_1_PI_F) *
          ground[i]! *
          groundToSample *
          sampleCos;
        ms[i] = 0.02 * MS_FIT[i]! * fit + lGround;
      }
      for (let i = 0; i < 4; i++) {
        const extinction = slots[i]! + slots[4 + i]! + slots[8 + i]! + slots[12 + i]!;
        const S =
          SUN_SPECTRAL_IRRADIANCE[i]! *
          (slots[12 + i]! * (phaseM * toSun[i]! + ms[i]!) +
            slots[4 + i]! * (phaseA * toSun[i]! + ms[i]!));
        const stepT = Math.exp(-dt * extinction);
        // Energy-conserving analytical integration (Hillaire).
        const cut = Math.max(extinction, 1e-7);
        L[i]! += transmittance[i]! * ((S - S * stepT) / cut);
        transmittance[i]! *= stepT;
      }
    }
    for (let i = 0; i < 4; i++) out[i] = L[i]!;
  }
}

const SKY_WIDTH = 512;
const SKY_HEIGHT = 256;

/** `SKY_multiple_scattering_precompute_texture`: the XYZ sky, mirrored in x. */
function precomputeTexture(p: SkyParameters, sunElevation: number): Float32Array {
  const sky = new Atmosphere(p.airDensity, p.aerosolDensity, p.ozoneDensity);
  sky.precompute();
  const altitude = Math.min(Math.max(p.altitude, 1.0), 99999.0) / 1000.0;
  const sun = sunDirection(Math.cos(M_PI_2_F - sunElevation));
  const pixels = new Float32Array(SKY_WIDTH * SKY_HEIGHT * 3);
  const half = SKY_WIDTH / 2;
  const L = new Float64Array(4);
  for (let y = 0; y < SKY_HEIGHT; y++) {
    for (let x = 0; x < half; x++) {
      const u = (x + 0.5) / SKY_WIDTH;
      const v = (y + 0.5) / SKY_HEIGHT;
      const azimuth = M_2PI_F * u;
      // More texels near the horizon, where the detail is.
      const l = v * 2.0 - 1.0;
      const elev = Math.sign(l) * sqr(l) * M_PI_2_F;
      const dx = Math.cos(elev) * Math.cos(azimuth);
      const dy = Math.cos(elev) * Math.sin(azimuth);
      const dz = Math.sin(elev);
      const oz = EARTH_RADIUS + altitude;
      const atmos = raySphereIntersection(0, 0, oz, dx, dy, dz, ATMOSPHERE_RADIUS);
      const groundHit = raySphereIntersection(0, 0, oz, dx, dy, dz, EARTH_RADIUS);
      const td = groundHit < 0 ? atmos : groundHit;
      sky.inscattering(sun, 0, 0, oz, dx, dy, dz, td, L);
      let X = 0,
        Y = 0,
        Z = 0;
      for (let i = 0; i < 4; i++) {
        X += SPECTRAL_XYZ[i]![0]! * L[i]!;
        Y += SPECTRAL_XYZ[i]![1]! * L[i]!;
        Z += SPECTRAL_XYZ[i]![2]! * L[i]!;
      }
      const at = (y * SKY_WIDTH + x) * 3;
      pixels[at] = X;
      pixels[at + 1] = Y;
      pixels[at + 2] = Z;
      const mirror = (y * SKY_WIDTH + (SKY_WIDTH - x - 1)) * 3;
      pixels[mirror] = X;
      pixels[mirror + 1] = Y;
      pixels[mirror + 2] = Z;
    }
  }
  return pixels;
}

/**
 * THE 15-SECOND HALF, as a pure function of the parameters.
 *
 * `precomputeTexture` walks 512x256 texels with 64 in-scattering steps each and
 * that is where a sky's cost lives; reading it back (below) is 32,768 bilinear
 * lookups and costs milliseconds. Split out because the expensive half takes
 * numbers and returns numbers -- no THREE, no DOM -- so a WORKER can run it and
 * post the Float32Array back. See `contributions/sky-precompute-worker.ts`.
 */
export function precomputeSkyTexture(p: SkyParameters): Float32Array {
  const [elevation] = simplify(p.sunElevation, p.sunRotation);
  return precomputeTexture(p, elevation);
}

/** The identity of a precomputed sky: every parameter the texture depends on.
 *  Rotation is NOT one of them -- `simplify` can fold half a turn of elevation
 *  into it, so it is folded here too and the texture keyed on what is left. */
export function skyTextureKey(p: SkyParameters): string {
  const [elevation] = simplify(p.sunElevation, p.sunRotation);
  return JSON.stringify([elevation, p.altitude, p.airDensity, p.aerosolDensity, p.ozoneDensity]);
}

/** Precomputed sky textures, however they were derived. `skyField` is
 *  synchronous and always will be -- a field over directions has no business
 *  being a promise -- so the ASYNC part is priming this map, and every caller
 *  of `skyField` then runs at lookup speed. A handful of entries covers the
 *  background/lighting pair a split world needs plus the last few edits. */
const SKY_TEXTURE_CACHE_LIMIT = 6;
const skyTextures = new Map<string, Float32Array>();

/** Whether `skyField` for these parameters would be free. A caller that needs
 *  to stay off the main thread asks this FIRST and primes what is missing. */
export function hasSkyTexture(p: SkyParameters): boolean {
  return skyTextures.has(skyTextureKey(p));
}

/** Hand a derived texture in, from wherever it was derived. */
export function primeSkyTexture(p: SkyParameters, pixels: Float32Array): void {
  skyTextures.set(skyTextureKey(p), pixels);
  // Oldest out first: insertion order is the Map's own.
  if (skyTextures.size > SKY_TEXTURE_CACHE_LIMIT) {
    skyTextures.delete(skyTextures.keys().next().value as string);
  }
}

/**
 * One Sky Texture node as a field over directions, in Blender's Z-up frame.
 *
 * The texture is built once per node and read the way
 * `node_tex_sky_nishita` reads it: REPEAT in x (azimuth) and clamped in y,
 * with the elevation's non-linear transform undone.
 *
 * Uses a primed texture when there is one and derives it INLINE when there is
 * not. The inline path is the slow one on purpose: it is correct, and a caller
 * who cares about the main thread primes the cache first.
 */
export function skyField(p: SkyParameters): (direction: THREE.Vector3) => THREE.Vector3 {
  const [elevation, rotation] = simplify(p.sunElevation, p.sunRotation);
  const key = skyTextureKey(p);
  let pixels = skyTextures.get(key);
  if (pixels === undefined) {
    pixels = precomputeTexture(p, elevation);
    primeSkyTexture(p, pixels);
  }
  const colour = new THREE.Vector3();
  return (direction) => {
    const horizontal = Math.hypot(direction.x, direction.y);
    const dirElevation = Math.atan2(direction.z, horizontal);
    const phi = Math.atan2(direction.x, direction.y);
    let u = (phi + Math.PI + rotation) / M_2PI_F;
    u -= Math.floor(u); // REPEAT
    const abs = Math.abs(dirElevation);
    const v = saturate(Math.sqrt(abs / M_PI_2_F) * Math.sign(dirElevation) * 0.5 + 0.5);
    const fx = u * SKY_WIDTH - 0.5;
    const fy = v * SKY_HEIGHT - 0.5;
    const x1 = Math.floor(fx),
      y1 = Math.floor(fy);
    const tx = fx - x1,
      ty = fy - y1;
    const wrap = (x: number): number => ((x % SKY_WIDTH) + SKY_WIDTH) % SKY_WIDTH;
    const clamp = (y: number): number => (y < 0 ? 0 : y > SKY_HEIGHT - 1 ? SKY_HEIGHT - 1 : y);
    const xa = wrap(x1),
      xb = wrap(x1 + 1),
      ya = clamp(y1),
      yb = clamp(y1 + 1);
    const xyz = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const top = mix(
        pixels[(ya * SKY_WIDTH + xa) * 3 + i]!,
        pixels[(ya * SKY_WIDTH + xb) * 3 + i]!,
        tx,
      );
      const bottom = mix(
        pixels[(yb * SKY_WIDTH + xa) * 3 + i]!,
        pixels[(yb * SKY_WIDTH + xb) * 3 + i]!,
        tx,
      );
      xyz[i] = mix(top, bottom, ty);
    }
    return colour.set(
      XYZ_TO_RGB[0]![0]! * xyz[0]! + XYZ_TO_RGB[0]![1]! * xyz[1]! + XYZ_TO_RGB[0]![2]! * xyz[2]!,
      XYZ_TO_RGB[1]![0]! * xyz[0]! + XYZ_TO_RGB[1]![1]! * xyz[1]! + XYZ_TO_RGB[1]![2]! * xyz[2]!,
      XYZ_TO_RGB[2]![0]! * xyz[0]! + XYZ_TO_RGB[2]![1]! * xyz[1]! + XYZ_TO_RGB[2]![2]! * xyz[2]!,
    );
  };
}
