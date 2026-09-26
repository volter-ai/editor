/**
 * The OKHSL conversion used by Godot 4.7's `Color` value.
 *
 * This is a direct TypeScript transcription of the MIT-licensed
 * `thirdparty/misc/ok_color.h` pinned at Godot commit
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. It intentionally owns only the
 * two conversion directions `Color` exposes; the unused gamut-clipping and
 * OKHSV routines from the upstream header are not copied into projects.
 */

interface Lab {
  L: number;
  a: number;
  b: number;
}
interface RGB {
  r: number;
  g: number;
  b: number;
}
interface HSL {
  h: number;
  s: number;
  l: number;
}
interface LC {
  L: number;
  C: number;
}
interface ST {
  S: number;
  T: number;
}
interface Cs {
  C0: number;
  Cmid: number;
  Cmax: number;
}

const PI = Math.PI;

function transfer(a: number): number {
  return a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
}

function inverseTransfer(a: number): number {
  return a > 0.04045 ? Math.pow((a + 0.055) / 1.055, 2.4) : a / 12.92;
}

function linearSrgbToOklab(c: RGB): Lab {
  const l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  const m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  const s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    L: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabToLinearSrgb(c: Lab): RGB {
  const lRoot = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const mRoot = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const sRoot = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function computeMaxSaturation(a: number, b: number): number {
  let k0: number;
  let k1: number;
  let k2: number;
  let k3: number;
  let k4: number;
  let wl: number;
  let wm: number;
  let ws: number;
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    [k0, k1, k2, k3, k4] = [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245];
    [wl, wm, ws] = [4.0767416621, -3.3077115913, 0.2309699292];
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    [k0, k1, k2, k3, k4] = [0.73956515, -0.45954404, 0.08285427, 0.1254107, 0.14503204];
    [wl, wm, ws] = [-1.2684380046, 2.6097574011, -0.3413193965];
  } else {
    [k0, k1, k2, k3, k4] = [1.35733652, -0.00915799, -1.1513021, -0.50559606, 0.00692167];
    [wl, wm, ws] = [-0.0041960863, -0.7034186147, 1.707614701];
  }
  let saturation = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const lr = 1 + saturation * kl;
  const mr = 1 + saturation * km;
  const sr = 1 + saturation * ks;
  const l = lr ** 3;
  const m = mr ** 3;
  const s = sr ** 3;
  const ld = 3 * kl * lr * lr;
  const md = 3 * km * mr * mr;
  const sd = 3 * ks * sr * sr;
  const ld2 = 6 * kl * kl * lr;
  const md2 = 6 * km * km * mr;
  const sd2 = 6 * ks * ks * sr;
  const f = wl * l + wm * m + ws * s;
  const f1 = wl * ld + wm * md + ws * sd;
  const f2 = wl * ld2 + wm * md2 + ws * sd2;
  saturation -= (f * f1) / (f1 * f1 - 0.5 * f * f2);
  return saturation;
}

function findCusp(a: number, b: number): LC {
  const saturation = computeMaxSaturation(a, b);
  const atMax = oklabToLinearSrgb({
    L: 1,
    a: saturation * a,
    b: saturation * b,
  });
  const L = Math.cbrt(1 / Math.max(atMax.r, atMax.g, atMax.b));
  return { L, C: L * saturation };
}

function gamutIntersection(
  a: number,
  b: number,
  L1: number,
  C1: number,
  L0: number,
  cusp: LC,
): number {
  if ((L1 - L0) * cusp.C - (cusp.L - L0) * C1 <= 0) {
    return (cusp.C * L0) / (C1 * cusp.L + cusp.C * (L0 - L1));
  }
  let t = (cusp.C * (L0 - 1)) / (C1 * (cusp.L - 1) + cusp.C * (L0 - L1));
  const dL = L1 - L0;
  const dC = C1;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const ldt = dL + dC * kl;
  const mdt = dL + dC * km;
  const sdt = dL + dC * ks;
  const L = L0 * (1 - t) + t * L1;
  const C = t * C1;
  const lr = L + C * kl;
  const mr = L + C * km;
  const sr = L + C * ks;
  const l = lr ** 3;
  const m = mr ** 3;
  const s = sr ** 3;
  const ld = 3 * ldt * lr * lr;
  const md = 3 * mdt * mr * mr;
  const sd = 3 * sdt * sr * sr;
  const ld2 = 6 * ldt * ldt * lr;
  const md2 = 6 * mdt * mdt * mr;
  const sd2 = 6 * sdt * sdt * sr;
  const correction = (v: number, v1: number, v2: number): number => {
    const u = v1 / (v1 * v1 - 0.5 * v * v2);
    return u >= 0 ? -v * u : Number.MAX_VALUE;
  };
  const tr = correction(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s - 1,
    4.0767416621 * ld - 3.3077115913 * md + 0.2309699292 * sd,
    4.0767416621 * ld2 - 3.3077115913 * md2 + 0.2309699292 * sd2,
  );
  const tg = correction(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s - 1,
    -1.2684380046 * ld + 2.6097574011 * md - 0.3413193965 * sd,
    -1.2684380046 * ld2 + 2.6097574011 * md2 - 0.3413193965 * sd2,
  );
  const tb = correction(
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s - 1,
    -0.0041960863 * ld - 0.7034186147 * md + 1.707614701 * sd,
    -0.0041960863 * ld2 - 0.7034186147 * md2 + 1.707614701 * sd2,
  );
  t += Math.min(tr, tg, tb);
  return t;
}

function toe(x: number): number {
  const k1 = 0.206;
  const k2 = 0.03;
  const k3 = (1 + k1) / (1 + k2);
  return 0.5 * (k3 * x - k1 + Math.sqrt((k3 * x - k1) ** 2 + 4 * k2 * k3 * x));
}

function toeInv(x: number): number {
  const k1 = 0.206;
  const k2 = 0.03;
  const k3 = (1 + k1) / (1 + k2);
  return (x * x + k1 * x) / (k3 * (x + k2));
}

function getStMid(a: number, b: number): ST {
  const S =
    0.11516993 +
    1 /
      (7.4477897 +
        4.1590124 * b +
        a *
          (-2.19557347 +
            1.75198401 * b +
            a *
              (-2.13704948 -
                10.02301043 * b +
                a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
  const T =
    0.11239642 +
    1 /
      (1.6132032 -
        0.68124379 * b +
        a *
          (0.40370612 +
            0.90148123 * b +
            a *
              (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
  return { S, T };
}

function getCs(L: number, a: number, b: number): Cs {
  const cusp = findCusp(a, b);
  const Cmax = gamutIntersection(a, b, L, 1, L, cusp);
  const Smax = cusp.C / cusp.L;
  const Tmax = cusp.C / (1 - cusp.L);
  const k = Cmax / Math.min(L * Smax, (1 - L) * Tmax);
  const mid = getStMid(a, b);
  const caMid = L * mid.S;
  const cbMid = (1 - L) * mid.T;
  const Cmid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / caMid ** 4 + 1 / cbMid ** 4)));
  const caZero = L * 0.4;
  const cbZero = (1 - L) * 0.8;
  const C0 = Math.sqrt(1 / (1 / caZero ** 2 + 1 / cbZero ** 2));
  return { C0, Cmid, Cmax };
}

export function okhslToSrgb(h: number, s: number, l: number): RGB {
  if (l === 1) return { r: 1, g: 1, b: 1 };
  if (l === 0) return { r: 0, g: 0, b: 0 };
  const a = Math.cos(2 * PI * h);
  const b = Math.sin(2 * PI * h);
  const L = toeInv(l);
  const cs = getCs(L, a, b);
  let C: number;
  if (s < 0.8) {
    const t = 1.25 * s;
    const k1 = 0.8 * cs.C0;
    const k2 = 1 - k1 / cs.Cmid;
    C = (t * k1) / (1 - k2 * t);
  } else {
    const t = (s - 0.8) / 0.2;
    const k0 = cs.Cmid;
    const k1 = (0.2 * cs.Cmid * cs.Cmid * 1.25 * 1.25) / cs.C0;
    const k2 = 1 - k1 / (cs.Cmax - cs.Cmid);
    C = k0 + (t * k1) / (1 - k2 * t);
  }
  const rgb = oklabToLinearSrgb({ L, a: C * a, b: C * b });
  return { r: transfer(rgb.r), g: transfer(rgb.g), b: transfer(rgb.b) };
}

export function srgbToOkhsl(rgb: RGB): HSL {
  if (rgb.r === 0 && rgb.g === 0 && rgb.b === 0) return { h: 0, s: 0, l: 0 };
  const lab = linearSrgbToOklab({
    r: inverseTransfer(rgb.r),
    g: inverseTransfer(rgb.g),
    b: inverseTransfer(rgb.b),
  });
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const a = lab.a / C;
  const b = lab.b / C;
  const h = 0.5 + (0.5 * Math.atan2(-lab.b, -lab.a)) / PI;
  const cs = getCs(lab.L, a, b);
  let s: number;
  if (C < cs.Cmid) {
    const k1 = 0.8 * cs.C0;
    const k2 = 1 - k1 / cs.Cmid;
    s = (C / (k1 + k2 * C)) * 0.8;
  } else {
    const k0 = cs.Cmid;
    const k1 = (0.2 * cs.Cmid * cs.Cmid * 1.25 * 1.25) / cs.C0;
    const k2 = 1 - k1 / (cs.Cmax - cs.Cmid);
    s = 0.8 + 0.2 * ((C - k0) / (k1 + k2 * (C - k0)));
  }
  return { h, s, l: toe(lab.L) };
}
