/**
 * Godot 4.7's complete `Color` Variant value protocol.
 *
 * Authority is the pinned engine's `core/math/color.{h,cpp}`, `color_names.inc`,
 * `thirdparty/misc/ok_color.h`, and the Variant operator/constructor tables at
 * commit `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The translator only lowers
 * syntax to these functions; component math and parsing stay in copied compat.
 */

import { okhslToSrgb, srgbToOkhsl } from './color-okhsl';
import type { ColorValue } from './variant';

const f32 = Math.fround;
const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Godot stores each Color component as a 32-bit float. */
export function godotColor(r = 0, g = 0, b = 0, a = 1): ColorValue {
  return { r: f32(r), g: f32(g), b: f32(b), a: f32(a) };
}

export function copyColor(value: ColorValue, alpha = value.a): ColorValue {
  return godotColor(value.r, value.g, value.b, alpha);
}

export function constructColor(...args: readonly unknown[]): ColorValue {
  if (args.length === 0) return godotColor();
  if (args.length === 1) {
    const value = args[0];
    return typeof value === 'string' ? colorFromCode(value) : copyColor(value as ColorValue);
  }
  if (args.length === 2) {
    const [value, alpha] = args;
    return typeof value === 'string'
      ? colorFromCode(value, Number(alpha))
      : copyColor(value as ColorValue, Number(alpha));
  }
  return godotColor(
    Number(args[0]),
    Number(args[1]),
    Number(args[2]),
    args.length === 3 ? 1 : Number(args[3]),
  );
}

function sameColor(a: ColorValue, b: unknown): b is ColorValue {
  if (typeof b !== 'object' || b === null) return false;
  const candidate = b as Partial<ColorValue>;
  return a.r === candidate.r && a.g === candidate.g && a.b === candidate.b && a.a === candidate.a;
}

export const colorEquals = sameColor;
export const colorNot = (value: ColorValue): boolean => sameColor(value, godotColor());
export const colorPositive = (value: ColorValue): ColorValue => copyColor(value);
export const colorNegative = (value: ColorValue): ColorValue =>
  godotColor(1 - value.r, 1 - value.g, 1 - value.b, 1 - value.a);

export function colorAdd(a: ColorValue, b: ColorValue): ColorValue {
  return godotColor(a.r + b.r, a.g + b.g, a.b + b.b, a.a + b.a);
}
export function colorSubtract(a: ColorValue, b: ColorValue): ColorValue {
  return godotColor(a.r - b.r, a.g - b.g, a.b - b.b, a.a - b.a);
}
export function colorMultiply(a: ColorValue, b: ColorValue | number): ColorValue {
  return typeof b === 'number'
    ? godotColor(a.r * b, a.g * b, a.b * b, a.a * b)
    : godotColor(a.r * b.r, a.g * b.g, a.b * b.b, a.a * b.a);
}
export function colorDivide(a: ColorValue, b: ColorValue | number): ColorValue {
  return typeof b === 'number'
    ? godotColor(a.r / b, a.g / b, a.b / b, a.a / b)
    : godotColor(a.r / b.r, a.g / b.g, a.b / b.b, a.a / b.a);
}

export function colorIn(value: ColorValue, container: unknown): boolean {
  if (Array.isArray(container)) return container.some((entry) => sameColor(value, entry));
  if (container instanceof Map) {
    for (const key of container.keys()) if (sameColor(value, key)) return true;
    return false;
  }
  if (typeof container === 'object' && container !== null) {
    return Object.prototype.hasOwnProperty.call(container, String(value));
  }
  return false;
}

function hue(value: ColorValue): number {
  const min = Math.min(value.r, value.g, value.b);
  const max = Math.max(value.r, value.g, value.b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h =
    value.r === max
      ? (value.g - value.b) / delta
      : value.g === max
        ? 2 + (value.b - value.r) / delta
        : 4 + (value.r - value.g) / delta;
  h /= 6;
  if (h < 0) h += 1;
  return f32(h);
}

function saturation(value: ColorValue): number {
  const min = Math.min(value.r, value.g, value.b);
  const max = Math.max(value.r, value.g, value.b);
  return f32(max !== 0 ? (max - min) / max : 0);
}

function hsv(h: number, s: number, v: number, alpha: number): ColorValue {
  if (s === 0) return godotColor(v, v, v, alpha);
  const scaled = (h * 6) % 6;
  const sector = Math.floor(scaled);
  const fraction = scaled - sector;
  const p = v * (1 - s);
  const q = v * (1 - s * fraction);
  const t = v * (1 - s * (1 - fraction));
  switch (sector) {
    case 0:
      return godotColor(v, t, p, alpha);
    case 1:
      return godotColor(q, v, p, alpha);
    case 2:
      return godotColor(p, v, t, alpha);
    case 3:
      return godotColor(p, q, v, alpha);
    case 4:
      return godotColor(t, p, v, alpha);
    default:
      return godotColor(v, p, q, alpha);
  }
}

export const colorR = (value: ColorValue): number => value.r;
export const colorG = (value: ColorValue): number => value.g;
export const colorB = (value: ColorValue): number => value.b;
export const colorA = (value: ColorValue): number => value.a;
export const colorSetR = (value: ColorValue, component: number): number =>
  (value.r = f32(component));
export const colorSetG = (value: ColorValue, component: number): number =>
  (value.g = f32(component));
export const colorSetB = (value: ColorValue, component: number): number =>
  (value.b = f32(component));
export const colorSetA = (value: ColorValue, component: number): number =>
  (value.a = f32(component));

/** Rebuild one Color value channel for GDScript's nested Variant writeback chain. */
export function colorWithChannel(
  value: ColorValue,
  channel: 'r' | 'g' | 'b' | 'a',
  component: number,
): ColorValue {
  const copy = copyColor(value);
  if (channel === 'r') colorSetR(copy, component);
  else if (channel === 'g') colorSetG(copy, component);
  else if (channel === 'b') colorSetB(copy, component);
  else colorSetA(copy, component);
  return copy;
}

const roundAwayFromZero = (value: number): number =>
  value < 0 ? Math.ceil(value - 0.5) : Math.floor(value + 0.5);
const component8 = (value: number): number => clampNumber(roundAwayFromZero(value * 255), 0, 255);

export const colorR8 = (value: ColorValue): number => component8(value.r);
export const colorG8 = (value: ColorValue): number => component8(value.g);
export const colorB8 = (value: ColorValue): number => component8(value.b);
export const colorA8 = (value: ColorValue): number => component8(value.a);
export const colorSetR8 = (value: ColorValue, component: number): number =>
  (value.r = f32(clampNumber(Math.trunc(component), 0, 255) / 255));
export const colorSetG8 = (value: ColorValue, component: number): number =>
  (value.g = f32(clampNumber(Math.trunc(component), 0, 255) / 255));
export const colorSetB8 = (value: ColorValue, component: number): number =>
  (value.b = f32(clampNumber(Math.trunc(component), 0, 255) / 255));
export const colorSetA8 = (value: ColorValue, component: number): number =>
  (value.a = f32(clampNumber(Math.trunc(component), 0, 255) / 255));

export const colorH = hue;
export const colorS = saturation;
export const colorV = (value: ColorValue): number => f32(Math.max(value.r, value.g, value.b));
function replace(value: ColorValue, next: ColorValue): number {
  value.r = next.r;
  value.g = next.g;
  value.b = next.b;
  value.a = next.a;
  return 0;
}
export const colorSetH = (value: ColorValue, h: number): number =>
  replace(value, hsv(h, saturation(value), colorV(value), value.a));
export const colorSetS = (value: ColorValue, s: number): number =>
  replace(value, hsv(hue(value), s, colorV(value), value.a));
export const colorSetV = (value: ColorValue, v: number): number =>
  replace(value, hsv(hue(value), saturation(value), v, value.a));

function okhsl(value: ColorValue): { h: number; s: number; l: number } {
  const result = srgbToOkhsl(value);
  return {
    h: f32(Number.isNaN(result.h) ? 0 : clampNumber(result.h, 0, 1)),
    s: f32(Number.isNaN(result.s) ? 0 : clampNumber(result.s, 0, 1)),
    l: f32(Number.isNaN(result.l) ? 0 : clampNumber(result.l, 0, 1)),
  };
}
export const colorOkHslH = (value: ColorValue): number => okhsl(value).h;
export const colorOkHslS = (value: ColorValue): number => okhsl(value).s;
export const colorOkHslL = (value: ColorValue): number => okhsl(value).l;
function fromOkhsl(h: number, s: number, l: number, alpha: number): ColorValue {
  const rgb = okhslToSrgb(h, s, l);
  return colorClamp(godotColor(rgb.r, rgb.g, rgb.b, alpha));
}
export const colorSetOkHslH = (value: ColorValue, h: number): number => {
  const current = okhsl(value);
  return replace(value, fromOkhsl(h, current.s, current.l, value.a));
};
export const colorSetOkHslS = (value: ColorValue, s: number): number => {
  const current = okhsl(value);
  return replace(value, fromOkhsl(current.h, s, current.l, value.a));
};
export const colorSetOkHslL = (value: ColorValue, l: number): number => {
  const current = okhsl(value);
  return replace(value, fromOkhsl(current.h, current.s, l, value.a));
};

export function colorClamp(
  value: ColorValue,
  min = godotColor(0, 0, 0, 0),
  max = godotColor(1, 1, 1, 1),
): ColorValue {
  return godotColor(
    clampNumber(value.r, min.r, max.r),
    clampNumber(value.g, min.g, max.g),
    clampNumber(value.b, min.b, max.b),
    clampNumber(value.a, min.a, max.a),
  );
}
export const colorInverted = (value: ColorValue): ColorValue =>
  godotColor(1 - value.r, 1 - value.g, 1 - value.b, value.a);
export function colorLerp(value: ColorValue, to: ColorValue, weight: number): ColorValue {
  return godotColor(
    value.r + (to.r - value.r) * weight,
    value.g + (to.g - value.g) * weight,
    value.b + (to.b - value.b) * weight,
    value.a + (to.a - value.a) * weight,
  );
}
/**
 * Godot 3.6 `core/math/color.h::linear_interpolate`, the same componentwise unclamped equation
 * retained as `lerp` in Godot 4.
 */
export const colorLinearInterpolate = colorLerp;
export const colorLightened = (value: ColorValue, amount: number): ColorValue =>
  godotColor(
    value.r + (1 - value.r) * amount,
    value.g + (1 - value.g) * amount,
    value.b + (1 - value.b) * amount,
    value.a,
  );
export const colorDarkened = (value: ColorValue, amount: number): ColorValue =>
  godotColor(value.r * (1 - amount), value.g * (1 - amount), value.b * (1 - amount), value.a);
export function colorBlend(value: ColorValue, over: ColorValue): ColorValue {
  const sa = 1 - over.a;
  const a = value.a * sa + over.a;
  if (a === 0) return godotColor(0, 0, 0, 0);
  return godotColor(
    (value.r * value.a * sa + over.r * over.a) / a,
    (value.g * value.a * sa + over.g * over.a) / a,
    (value.b * value.a * sa + over.b * over.a) / a,
    a,
  );
}
export const colorLuminance = (value: ColorValue): number =>
  f32(0.2126 * value.r + 0.7152 * value.g + 0.0722 * value.b);
export const colorSrgbToLinear = (value: ColorValue): ColorValue =>
  godotColor(
    value.r < 0.04045 ? value.r / 12.92 : Math.pow((value.r + 0.055) / 1.055, 2.4),
    value.g < 0.04045 ? value.g / 12.92 : Math.pow((value.g + 0.055) / 1.055, 2.4),
    value.b < 0.04045 ? value.b / 12.92 : Math.pow((value.b + 0.055) / 1.055, 2.4),
    value.a,
  );
export const colorLinearToSrgb = (value: ColorValue): ColorValue =>
  godotColor(
    value.r < 0.0031308 ? 12.92 * value.r : 1.055 * Math.pow(value.r, 1 / 2.4) - 0.055,
    value.g < 0.0031308 ? 12.92 * value.g : 1.055 * Math.pow(value.g, 1 / 2.4) - 0.055,
    value.b < 0.0031308 ? 12.92 * value.b : 1.055 * Math.pow(value.b, 1 / 2.4) - 0.055,
    value.a,
  );

function equalApprox(a: number, b: number): boolean {
  if (a === b) return true;
  const tolerance = Math.max(0.00001 * Math.abs(a), 0.00001);
  return Math.abs(a - b) < tolerance;
}
export const colorIsEqualApprox = (a: ColorValue, b: ColorValue): boolean =>
  equalApprox(a.r, b.r) && equalApprox(a.g, b.g) && equalApprox(a.b, b.b) && equalApprox(a.a, b.a);

const byteCast = (value: number): number => ((roundAwayFromZero(value * 255) % 256) + 256) % 256;
const wordCast = (value: number): bigint =>
  BigInt(((roundAwayFromZero(value * 65535) % 65536) + 65536) % 65536);
const pack32 = (a: number, b: number, c: number, d: number): number =>
  (byteCast(a) * 0x1000000 + byteCast(b) * 0x10000 + byteCast(c) * 0x100 + byteCast(d)) >>> 0;
const pack64 = (a: number, b: number, c: number, d: number): bigint =>
  (wordCast(a) << 48n) | (wordCast(b) << 32n) | (wordCast(c) << 16n) | wordCast(d);
export const colorToArgb32 = (v: ColorValue): number => pack32(v.a, v.r, v.g, v.b);
export const colorToAbgr32 = (v: ColorValue): number => pack32(v.a, v.b, v.g, v.r);
export const colorToRgba32 = (v: ColorValue): number => pack32(v.r, v.g, v.b, v.a);
export const colorToArgb64 = (v: ColorValue): bigint => pack64(v.a, v.r, v.g, v.b);
export const colorToAbgr64 = (v: ColorValue): bigint => pack64(v.a, v.b, v.g, v.r);
export const colorToRgba64 = (v: ColorValue): bigint => pack64(v.r, v.g, v.b, v.a);

function hexByte(value: number): string {
  return component8(value).toString(16).padStart(2, '0');
}
export const colorToHtml = (value: ColorValue, withAlpha = true): string =>
  hexByte(value.r) + hexByte(value.g) + hexByte(value.b) + (withAlpha ? hexByte(value.a) : '');

export function colorHex(value: number | bigint): ColorValue {
  let packed = BigInt.asUintN(32, BigInt(value));
  const a = Number(packed & 255n) / 255;
  packed >>= 8n;
  const b = Number(packed & 255n) / 255;
  packed >>= 8n;
  const g = Number(packed & 255n) / 255;
  packed >>= 8n;
  const r = Number(packed & 255n) / 255;
  return godotColor(r, g, b, a);
}
export function colorHex64(value: number | bigint): ColorValue {
  let packed = BigInt.asUintN(64, BigInt(value));
  const a = Number(packed & 65535n) / 65535;
  packed >>= 16n;
  const b = Number(packed & 65535n) / 65535;
  packed >>= 16n;
  const g = Number(packed & 65535n) / 65535;
  packed >>= 16n;
  const r = Number(packed & 65535n) / 65535;
  return godotColor(r, g, b, a);
}
export const colorHtmlIsValid = (code: string): boolean =>
  /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(code);
export function colorHtml(code: string): ColorValue {
  if (!colorHtmlIsValid(code)) return godotColor();
  const digits = code.startsWith('#') ? code.slice(1) : code;
  const expanded = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return colorHex(BigInt(`0x${expanded.length === 6 ? expanded + 'ff' : expanded}`));
}

export const GODOT_COLOR_CONSTANTS = Object.freeze({
  // GENERATED from Godot 4.7's extension_api.json; kept as float values because Color stores float.
  ALICE_BLUE: godotColor(0.9411765, 0.972549, 1, 1),
  ANTIQUE_WHITE: godotColor(0.98039216, 0.92156863, 0.84313726, 1),
  AQUA: godotColor(0, 1, 1, 1),
  AQUAMARINE: godotColor(0.49803922, 1, 0.83137256, 1),
  AZURE: godotColor(0.9411765, 1, 1, 1),
  BEIGE: godotColor(0.9607843, 0.9607843, 0.8627451, 1),
  BISQUE: godotColor(1, 0.89411765, 0.76862746, 1),
  BLACK: godotColor(0, 0, 0, 1),
  BLANCHED_ALMOND: godotColor(1, 0.92156863, 0.8039216, 1),
  BLUE: godotColor(0, 0, 1, 1),
  BLUE_VIOLET: godotColor(0.5411765, 0.16862746, 0.8862745, 1),
  BROWN: godotColor(0.64705884, 0.16470589, 0.16470589, 1),
  BURLYWOOD: godotColor(0.87058824, 0.72156864, 0.5294118, 1),
  CADET_BLUE: godotColor(0.37254903, 0.61960787, 0.627451, 1),
  CHARTREUSE: godotColor(0.49803922, 1, 0, 1),
  CHOCOLATE: godotColor(0.8235294, 0.4117647, 0.11764706, 1),
  CORAL: godotColor(1, 0.49803922, 0.3137255, 1),
  CORNFLOWER_BLUE: godotColor(0.39215687, 0.58431375, 0.92941177, 1),
  CORNSILK: godotColor(1, 0.972549, 0.8627451, 1),
  CRIMSON: godotColor(0.8627451, 0.078431375, 0.23529412, 1),
  CYAN: godotColor(0, 1, 1, 1),
  DARK_BLUE: godotColor(0, 0, 0.54509807, 1),
  DARK_CYAN: godotColor(0, 0.54509807, 0.54509807, 1),
  DARK_GOLDENROD: godotColor(0.72156864, 0.5254902, 0.043137256, 1),
  DARK_GRAY: godotColor(0.6627451, 0.6627451, 0.6627451, 1),
  DARK_GREEN: godotColor(0, 0.39215687, 0, 1),
  DARK_KHAKI: godotColor(0.7411765, 0.7176471, 0.41960785, 1),
  DARK_MAGENTA: godotColor(0.54509807, 0, 0.54509807, 1),
  DARK_OLIVE_GREEN: godotColor(0.33333334, 0.41960785, 0.18431373, 1),
  DARK_ORANGE: godotColor(1, 0.54901963, 0, 1),
  DARK_ORCHID: godotColor(0.6, 0.19607843, 0.8, 1),
  DARK_RED: godotColor(0.54509807, 0, 0, 1),
  DARK_SALMON: godotColor(0.9137255, 0.5882353, 0.47843137, 1),
  DARK_SEA_GREEN: godotColor(0.56078434, 0.7372549, 0.56078434, 1),
  DARK_SLATE_BLUE: godotColor(0.28235295, 0.23921569, 0.54509807, 1),
  DARK_SLATE_GRAY: godotColor(0.18431373, 0.30980393, 0.30980393, 1),
  DARK_TURQUOISE: godotColor(0, 0.80784315, 0.81960785, 1),
  DARK_VIOLET: godotColor(0.5803922, 0, 0.827451, 1),
  DEEP_PINK: godotColor(1, 0.078431375, 0.5764706, 1),
  DEEP_SKY_BLUE: godotColor(0, 0.7490196, 1, 1),
  DIM_GRAY: godotColor(0.4117647, 0.4117647, 0.4117647, 1),
  DODGER_BLUE: godotColor(0.11764706, 0.5647059, 1, 1),
  FIREBRICK: godotColor(0.69803923, 0.13333334, 0.13333334, 1),
  FLORAL_WHITE: godotColor(1, 0.98039216, 0.9411765, 1),
  FOREST_GREEN: godotColor(0.13333334, 0.54509807, 0.13333334, 1),
  FUCHSIA: godotColor(1, 0, 1, 1),
  GAINSBORO: godotColor(0.8627451, 0.8627451, 0.8627451, 1),
  GHOST_WHITE: godotColor(0.972549, 0.972549, 1, 1),
  GOLD: godotColor(1, 0.84313726, 0, 1),
  GOLDENROD: godotColor(0.85490197, 0.64705884, 0.1254902, 1),
  GRAY: godotColor(0.74509805, 0.74509805, 0.74509805, 1),
  GREEN: godotColor(0, 1, 0, 1),
  GREEN_YELLOW: godotColor(0.6784314, 1, 0.18431373, 1),
  HONEYDEW: godotColor(0.9411765, 1, 0.9411765, 1),
  HOT_PINK: godotColor(1, 0.4117647, 0.7058824, 1),
  INDIAN_RED: godotColor(0.8039216, 0.36078432, 0.36078432, 1),
  INDIGO: godotColor(0.29411766, 0, 0.50980395, 1),
  IVORY: godotColor(1, 1, 0.9411765, 1),
  KHAKI: godotColor(0.9411765, 0.9019608, 0.54901963, 1),
  LAVENDER: godotColor(0.9019608, 0.9019608, 0.98039216, 1),
  LAVENDER_BLUSH: godotColor(1, 0.9411765, 0.9607843, 1),
  LAWN_GREEN: godotColor(0.4862745, 0.9882353, 0, 1),
  LEMON_CHIFFON: godotColor(1, 0.98039216, 0.8039216, 1),
  LIGHT_BLUE: godotColor(0.6784314, 0.84705883, 0.9019608, 1),
  LIGHT_CORAL: godotColor(0.9411765, 0.5019608, 0.5019608, 1),
  LIGHT_CYAN: godotColor(0.8784314, 1, 1, 1),
  LIGHT_GOLDENROD: godotColor(0.98039216, 0.98039216, 0.8235294, 1),
  LIGHT_GRAY: godotColor(0.827451, 0.827451, 0.827451, 1),
  LIGHT_GREEN: godotColor(0.5647059, 0.93333334, 0.5647059, 1),
  LIGHT_PINK: godotColor(1, 0.7137255, 0.75686276, 1),
  LIGHT_SALMON: godotColor(1, 0.627451, 0.47843137, 1),
  LIGHT_SEA_GREEN: godotColor(0.1254902, 0.69803923, 0.6666667, 1),
  LIGHT_SKY_BLUE: godotColor(0.5294118, 0.80784315, 0.98039216, 1),
  LIGHT_SLATE_GRAY: godotColor(0.46666667, 0.53333336, 0.6, 1),
  LIGHT_STEEL_BLUE: godotColor(0.6901961, 0.76862746, 0.87058824, 1),
  LIGHT_YELLOW: godotColor(1, 1, 0.8784314, 1),
  LIME: godotColor(0, 1, 0, 1),
  LIME_GREEN: godotColor(0.19607843, 0.8039216, 0.19607843, 1),
  LINEN: godotColor(0.98039216, 0.9411765, 0.9019608, 1),
  MAGENTA: godotColor(1, 0, 1, 1),
  MAROON: godotColor(0.6901961, 0.1882353, 0.3764706, 1),
  MEDIUM_AQUAMARINE: godotColor(0.4, 0.8039216, 0.6666667, 1),
  MEDIUM_BLUE: godotColor(0, 0, 0.8039216, 1),
  MEDIUM_ORCHID: godotColor(0.7294118, 0.33333334, 0.827451, 1),
  MEDIUM_PURPLE: godotColor(0.5764706, 0.4392157, 0.85882354, 1),
  MEDIUM_SEA_GREEN: godotColor(0.23529412, 0.7019608, 0.44313726, 1),
  MEDIUM_SLATE_BLUE: godotColor(0.48235294, 0.40784314, 0.93333334, 1),
  MEDIUM_SPRING_GREEN: godotColor(0, 0.98039216, 0.6039216, 1),
  MEDIUM_TURQUOISE: godotColor(0.28235295, 0.81960785, 0.8, 1),
  MEDIUM_VIOLET_RED: godotColor(0.78039217, 0.08235294, 0.52156866, 1),
  MIDNIGHT_BLUE: godotColor(0.09803922, 0.09803922, 0.4392157, 1),
  MINT_CREAM: godotColor(0.9607843, 1, 0.98039216, 1),
  MISTY_ROSE: godotColor(1, 0.89411765, 0.88235295, 1),
  MOCCASIN: godotColor(1, 0.89411765, 0.70980394, 1),
  NAVAJO_WHITE: godotColor(1, 0.87058824, 0.6784314, 1),
  NAVY_BLUE: godotColor(0, 0, 0.5019608, 1),
  OLD_LACE: godotColor(0.99215686, 0.9607843, 0.9019608, 1),
  OLIVE: godotColor(0.5019608, 0.5019608, 0, 1),
  OLIVE_DRAB: godotColor(0.41960785, 0.5568628, 0.13725491, 1),
  ORANGE: godotColor(1, 0.64705884, 0, 1),
  ORANGE_RED: godotColor(1, 0.27058825, 0, 1),
  ORCHID: godotColor(0.85490197, 0.4392157, 0.8392157, 1),
  PALE_GOLDENROD: godotColor(0.93333334, 0.9098039, 0.6666667, 1),
  PALE_GREEN: godotColor(0.59607846, 0.9843137, 0.59607846, 1),
  PALE_TURQUOISE: godotColor(0.6862745, 0.93333334, 0.93333334, 1),
  PALE_VIOLET_RED: godotColor(0.85882354, 0.4392157, 0.5764706, 1),
  PAPAYA_WHIP: godotColor(1, 0.9372549, 0.8352941, 1),
  PEACH_PUFF: godotColor(1, 0.85490197, 0.7254902, 1),
  PERU: godotColor(0.8039216, 0.52156866, 0.24705882, 1),
  PINK: godotColor(1, 0.7529412, 0.79607844, 1),
  PLUM: godotColor(0.8666667, 0.627451, 0.8666667, 1),
  POWDER_BLUE: godotColor(0.6901961, 0.8784314, 0.9019608, 1),
  PURPLE: godotColor(0.627451, 0.1254902, 0.9411765, 1),
  REBECCA_PURPLE: godotColor(0.4, 0.2, 0.6, 1),
  RED: godotColor(1, 0, 0, 1),
  ROSY_BROWN: godotColor(0.7372549, 0.56078434, 0.56078434, 1),
  ROYAL_BLUE: godotColor(0.25490198, 0.4117647, 0.88235295, 1),
  SADDLE_BROWN: godotColor(0.54509807, 0.27058825, 0.07450981, 1),
  SALMON: godotColor(0.98039216, 0.5019608, 0.44705883, 1),
  SANDY_BROWN: godotColor(0.95686275, 0.6431373, 0.3764706, 1),
  SEA_GREEN: godotColor(0.18039216, 0.54509807, 0.34117648, 1),
  SEASHELL: godotColor(1, 0.9607843, 0.93333334, 1),
  SIENNA: godotColor(0.627451, 0.32156864, 0.1764706, 1),
  SILVER: godotColor(0.7529412, 0.7529412, 0.7529412, 1),
  SKY_BLUE: godotColor(0.5294118, 0.80784315, 0.92156863, 1),
  SLATE_BLUE: godotColor(0.41568628, 0.3529412, 0.8039216, 1),
  SLATE_GRAY: godotColor(0.4392157, 0.5019608, 0.5647059, 1),
  SNOW: godotColor(1, 0.98039216, 0.98039216, 1),
  SPRING_GREEN: godotColor(0, 1, 0.49803922, 1),
  STEEL_BLUE: godotColor(0.27450982, 0.50980395, 0.7058824, 1),
  TAN: godotColor(0.8235294, 0.7058824, 0.54901963, 1),
  TEAL: godotColor(0, 0.5019608, 0.5019608, 1),
  THISTLE: godotColor(0.84705883, 0.7490196, 0.84705883, 1),
  TOMATO: godotColor(1, 0.3882353, 0.2784314, 1),
  TRANSPARENT: godotColor(1, 1, 1, 0),
  TURQUOISE: godotColor(0.2509804, 0.8784314, 0.8156863, 1),
  VIOLET: godotColor(0.93333334, 0.50980395, 0.93333334, 1),
  WEB_GRAY: godotColor(0.5019608, 0.5019608, 0.5019608, 1),
  WEB_GREEN: godotColor(0, 0.5019608, 0, 1),
  WEB_MAROON: godotColor(0.5019608, 0, 0, 1),
  WEB_PURPLE: godotColor(0.5019608, 0, 0.5019608, 1),
  WHEAT: godotColor(0.9607843, 0.87058824, 0.7019608, 1),
  WHITE: godotColor(1, 1, 1, 1),
  WHITE_SMOKE: godotColor(0.9607843, 0.9607843, 0.9607843, 1),
  YELLOW: godotColor(1, 1, 0, 1),
  YELLOW_GREEN: godotColor(0.6039216, 0.8039216, 0.19607843, 1),
} as const);
for (const named of Object.values(GODOT_COLOR_CONSTANTS)) Object.freeze(named);

function normalizedColorName(value: string): string {
  return value.replace(/[ \-_'.]/g, '').toUpperCase();
}
export function colorFromString(value: string, fallback: ColorValue): ColorValue {
  if (colorHtmlIsValid(value)) return colorHtml(value);
  const wanted = normalizedColorName(value);
  for (const [name, named] of Object.entries(GODOT_COLOR_CONSTANTS)) {
    if (name.replaceAll('_', '') === wanted) return copyColor(named);
  }
  return copyColor(fallback);
}
export function colorFromCode(value: string, alpha?: number): ColorValue {
  const parsed = colorFromString(value, godotColor());
  if (alpha !== undefined) parsed.a = f32(alpha);
  return parsed;
}
export const colorFromHsv = (h: number, s: number, v: number, alpha = 1): ColorValue =>
  hsv(h, s, v, alpha);
export const colorFromOkHsl = (h: number, s: number, l: number, alpha = 1): ColorValue =>
  fromOkhsl(h, s, l, alpha);
export function colorFromRgbe9995(value: number): ColorValue {
  const packed = value >>> 0;
  const scale = Math.pow(2, ((packed >>> 27) & 31) - 24);
  return godotColor(
    (packed & 0x1ff) * scale,
    ((packed >>> 9) & 0x1ff) * scale,
    ((packed >>> 18) & 0x1ff) * scale,
    1,
  );
}
export const colorFromRgba8 = (r: number, g: number, b: number, a = 255): ColorValue =>
  godotColor(r / 255, g / 255, b / 255, a / 255);
