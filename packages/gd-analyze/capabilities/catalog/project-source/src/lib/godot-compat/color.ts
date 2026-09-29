/**
 * @godot-class Color
 * @role PROTOCOL
 *
 * Godot 4.7's `Color` built-in value, transcribed from `core/math/color.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Components are `float` (always 32-bit), rounded with
 * `Math.fround`.
 */

const f32 = Math.fround;

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function make(r: number, g: number, b: number, a: number): Color {
  return Object.freeze({ r: f32(r), g: f32(g), b: f32(b), a: f32(a) });
}

/**
 * `0xRRGGBBAA` as a `uint32_t`: each byte divided by `255.0f` in float.
 *
 * @godot Color.hex
 * @source core/math/color.cpp:284
 */
export function hex(p_hex: number): Color {
  const value = p_hex >>> 0;
  const channel = (shift: number): number => f32(((value >>> shift) & 0xff) / f32(255));
  return make(channel(24), channel(16), channel(8), channel(0));
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:167-172`): no arguments
 * (`(0, 0, 0, 1)`, `core/math/color.h:251`), `from: Color`, `from: Color, alpha`
 * (`core/math/color.h:270`), `r, g, b` (alpha 1, `core/math/color.h:264`) and `r, g, b, a`.
 * The `code: String` constructors are not transcribed.
 *
 * @godot Color.Color
 * @source core/math/color.h:258
 */
export function construct(
  ...args:
    | readonly []
    | readonly [Color]
    | readonly [Color, number]
    | readonly [number, number, number]
    | readonly [number, number, number, number]
): Color {
  if (args.length === 0) return make(0, 0, 0, 1);
  if (args.length === 1) return make(args[0].r, args[0].g, args[0].b, args[0].a);
  if (args.length === 2) return make(args[0].r, args[0].g, args[0].b, args[1]);
  if (args.length === 3) return make(args[0], args[1], args[2], 1);
  return make(args[0], args[1], args[2], args[3]);
}

/**
 * The named colour `GRAY` is `Color::hex(0xBEBEBEFF)` (`core/math/color_names.inc:100`),
 * registered as a constant from the named-colour table (`core/variant/variant_call.cpp:3088`).
 *
 * @godot Color.GRAY
 * @source core/math/color_names.inc:100
 */
export const GRAY: Color = hex(0xbebebeff);

/**
 * `c.r = value` writes `float r` (`core/math/color.h:42`); a new record assigned back.
 *
 * @godot Color.r
 * @source core/math/color.h:42
 */
export function with_r(self: Color, value: number): Color {
  return make(value, self.g, self.b, self.a);
}

/**
 * @godot Color.g
 * @source core/math/color.h:43
 */
export function with_g(self: Color, value: number): Color {
  return make(self.r, value, self.b, self.a);
}

/**
 * @godot Color.b
 * @source core/math/color.h:44
 */
export function with_b(self: Color, value: number): Color {
  return make(self.r, self.g, value, self.a);
}

/**
 * @godot Color.a
 * @source core/math/color.h:45
 */
export function with_a(self: Color, value: number): Color {
  return make(self.r, self.g, self.b, value);
}

/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApproxReal(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/** `Math::lerp(float, float, float)` (`core/math/math_funcs.h:338`). */
function lerpReal(from: number, to: number, weight: number): number {
  return f32(from + f32(f32(to - from) * weight));
}

/** `std::round` on a float: halves round away from zero. */
function roundReal(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `(uintN_t)Math::round(value * scale)`: arm64 converts saturating at 0, then the low bits are kept. */
function channelBits(value: number, scale: number, mask: number): number {
  const rounded = roundReal(f32(value * scale));
  return rounded <= 0 ? 0 : Math.min(rounded, 4294967295) & mask;
}

/** Four 8-bit channels packed high to low as a `uint32_t` (a non-negative Variant int). */
function pack32(c0: number, c1: number, c2: number, c3: number): number {
  const byte = (value: number): number => channelBits(value, 255, 0xff);
  return ((byte(c0) << 24) | (byte(c1) << 16) | (byte(c2) << 8) | byte(c3)) >>> 0;
}

/**
 * Four 16-bit channels packed high to low as a `uint64_t`, returned as Godot's int64 Variant (the
 * bits reinterpreted as signed). A JS number holds it exactly only below 2^53.
 */
function pack64(c0: number, c1: number, c2: number, c3: number): number {
  const word = (value: number): bigint => BigInt(channelBits(value, 65535, 0xffff));
  const bits = (word(c0) << 48n) | (word(c1) << 32n) | (word(c2) << 16n) | word(c3);
  return Number(BigInt.asIntN(64, bits));
}

/**
 * @godot Color.to_argb32
 * @source core/math/color.cpp:40
 */
export function to_argb32(self: Color): number {
  return pack32(self.a, self.r, self.g, self.b);
}

/**
 * @godot Color.to_abgr32
 * @source core/math/color.cpp:52
 */
export function to_abgr32(self: Color): number {
  return pack32(self.a, self.b, self.g, self.r);
}

/**
 * @godot Color.to_rgba32
 * @source core/math/color.cpp:64
 */
export function to_rgba32(self: Color): number {
  return pack32(self.r, self.g, self.b, self.a);
}

/**
 * @godot Color.to_abgr64
 * @source core/math/color.cpp:76
 */
export function to_abgr64(self: Color): number {
  return pack64(self.a, self.b, self.g, self.r);
}

/**
 * @godot Color.to_argb64
 * @source core/math/color.cpp:88
 */
export function to_argb64(self: Color): number {
  return pack64(self.a, self.r, self.g, self.b);
}

/**
 * @godot Color.to_rgba64
 * @source core/math/color.cpp:100
 */
export function to_rgba64(self: Color): number {
  return pack64(self.r, self.g, self.b, self.a);
}

/**
 * Lowercase `rrggbb` or `rrggbbaa` (the Variant default is `with_alpha = true`,
 * `core/variant/variant_call.cpp:2421`), each channel rounded and clamped to 0..255
 * (`_append_hex`, `core/math/color.cpp:112`).
 *
 * @godot Color.to_html
 * @source core/math/color.cpp:120
 */
export function to_html(self: Color, p_alpha = true): string {
  const appendHex = (value: number): string => {
    const v = Math.min(Math.max(roundReal(f32(value * 255)), 0), 255);
    return v.toString(16).padStart(2, '0');
  };
  return appendHex(self.r) + appendHex(self.g) + appendHex(self.b) + (p_alpha ? appendHex(self.a) : '');
}

/**
 * Each channel clamped between the bounds' channels; the Variant defaults are `Color(0, 0, 0, 0)`
 * and `Color(1, 1, 1, 1)` (`core/variant/variant_call.cpp:2423`).
 *
 * @godot Color.clamp
 * @source core/math/color.cpp:270
 */
export function clamp(self: Color, p_min: Color = make(0, 0, 0, 0), p_max: Color = make(1, 1, 1, 1)): Color {
  const clampOne = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);
  return make(
    clampOne(self.r, p_min.r, p_max.r),
    clampOne(self.g, p_min.g, p_max.g),
    clampOne(self.b, p_min.b, p_max.b),
    clampOne(self.a, p_min.a, p_max.a),
  );
}

/**
 * `1 - r`, `1 - g`, `1 - b` (`Color::invert`, `core/math/color.cpp:278`); alpha kept.
 *
 * @godot Color.inverted
 * @source core/math/color.cpp:325
 */
export function inverted(self: Color): Color {
  return make(f32(1 - self.r), f32(1 - self.g), f32(1 - self.b), self.a);
}

/**
 * @godot Color.lerp
 * @source core/math/color.h:110
 */
export function lerp(self: Color, p_to: Color, p_weight: number): Color {
  const w = f32(p_weight);
  return make(lerpReal(self.r, p_to.r, w), lerpReal(self.g, p_to.g, w), lerpReal(self.b, p_to.b, w), lerpReal(self.a, p_to.a, w));
}

/**
 * Each colour channel moved `amount` of the way to 1; alpha kept.
 *
 * @godot Color.lightened
 * @source core/math/color.h:127
 */
export function lightened(self: Color, p_amount: number): Color {
  const amount = f32(p_amount);
  const up = (value: number): number => f32(value + f32(f32(1 - value) * amount));
  return make(up(self.r), up(self.g), up(self.b), self.a);
}

/**
 * Each colour channel scaled by `1 - amount`; alpha kept.
 *
 * @godot Color.darkened
 * @source core/math/color.h:119
 */
export function darkened(self: Color, p_amount: number): Color {
  const keep = f32(1 - f32(p_amount));
  return make(f32(self.r * keep), f32(self.g * keep), f32(self.b * keep), self.a);
}

/**
 * `p_over` composited over this colour ("over" with straight alpha); a zero result alpha is
 * `Color(0, 0, 0, 0)`.
 *
 * @godot Color.blend
 * @source core/math/color.h:178
 */
export function blend(self: Color, p_over: Color): Color {
  const sa = f32(1 - p_over.a);
  const a = f32(f32(self.a * sa) + p_over.a);
  if (a === 0) return make(0, 0, 0, 0);
  const mix = (under: number, over: number): number => f32(f32(f32(f32(under * self.a) * sa) + f32(over * p_over.a)) / a);
  return make(mix(self.r, p_over.r), mix(self.g, p_over.g), mix(self.b, p_over.b), a);
}

/**
 * `0.2126 r + 0.7152 g + 0.0722 b` in float.
 *
 * @godot Color.get_luminance
 * @source core/math/color.h:106
 */
export function get_luminance(self: Color): number {
  return f32(f32(f32(f32(0.2126) * self.r) + f32(f32(0.7152) * self.g)) + f32(f32(0.0722) * self.b));
}

/**
 * The sRGB transfer function inverted per channel; alpha kept.
 *
 * @godot Color.srgb_to_linear
 * @source core/math/color.h:192
 */
export function srgb_to_linear(self: Color): Color {
  const lin = (c: number): number =>
    c < f32(0.04045) ? f32(c * f32(1 / 12.92)) : f32(Math.pow(f32((c + 0.055) * (1.0 / (1.0 + 0.055))), f32(2.4)));
  return make(lin(self.r), lin(self.g), lin(self.b), self.a);
}

/**
 * The sRGB transfer function per channel; alpha kept.
 *
 * @godot Color.linear_to_srgb
 * @source core/math/color.h:199
 */
export function linear_to_srgb(self: Color): Color {
  const srgb = (c: number): number =>
    c < f32(0.0031308) ? f32(f32(12.92) * c) : (1.0 + 0.055) * f32(Math.pow(c, f32(1 / 2.4))) - 0.055;
  return make(srgb(self.r), srgb(self.g), srgb(self.b), self.a);
}

/**
 * @godot Color.is_equal_approx
 * @source core/math/color.cpp:262
 */
export function is_equal_approx(self: Color, p_color: Color): boolean {
  return (
    isEqualApproxReal(self.r, p_color.r) &&
    isEqualApproxReal(self.g, p_color.g) &&
    isEqualApproxReal(self.b, p_color.b) &&
    isEqualApproxReal(self.a, p_color.a)
  );
}

/**
 * `0xRRRRGGGGBBBBAAAA` as a `uint64_t`: each 16-bit word divided by `65535.0f`. A JS number carries
 * the argument exactly only below 2^53.
 *
 * @godot Color.hex64
 * @source core/math/color.cpp:296
 */
export function hex64(p_hex: number): Color {
  const value = BigInt.asUintN(64, BigInt(Math.trunc(p_hex)));
  const channel = (shift: bigint): number => f32(Number((value >> shift) & 0xffffn) / f32(65535));
  return make(channel(48n), channel(32n), channel(16n), channel(0n));
}

/** `_parse_col4` (`core/math/color.cpp:308`): one hex digit's value, or -1. */
function parseCol4(text: string, at: number): number {
  const code = text.charCodeAt(at);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/** `_parse_col8` (`core/math/color.cpp:321`). */
function parseCol8(text: string, at: number): number {
  return parseCol4(text, at) * 16 + parseCol4(text, at + 1);
}

/**
 * `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (the `#` optional); an empty string is `Color()`, and a
 * code of another length or with a character that is not a hex digit is an error that returns
 * `Color()`.
 *
 * @godot Color.html
 * @source core/math/color.cpp:331
 */
export function html(p_rgba: string): Color {
  if (p_rgba.length === 0) return make(0, 0, 0, 1);
  const at = p_rgba[0] === '#' ? 1 : 0;
  const digits = p_rgba.length - at;
  let r: number;
  let g: number;
  let b: number;
  let a = 1;
  if (digits === 3 || digits === 4) {
    r = f32(parseCol4(p_rgba, at) / 15);
    g = f32(parseCol4(p_rgba, at + 1) / 15);
    b = f32(parseCol4(p_rgba, at + 2) / 15);
    if (digits === 4) a = f32(parseCol4(p_rgba, at + 3) / 15);
  } else if (digits === 6 || digits === 8) {
    r = f32(parseCol8(p_rgba, at) / 255);
    g = f32(parseCol8(p_rgba, at + 2) / 255);
    b = f32(parseCol8(p_rgba, at + 4) / 255);
    if (digits === 8) a = f32(parseCol8(p_rgba, at + 6) / 255);
  } else {
    return make(0, 0, 0, 1);
  }
  if (r < 0 || g < 0 || b < 0 || a < 0) return make(0, 0, 0, 1);
  return make(r, g, b, a);
}

/**
 * Whether the text is 3, 4, 6 or 8 hex digits after an optional `#`.
 *
 * @godot Color.html_is_valid
 * @source core/math/color.cpp:372
 */
export function html_is_valid(p_color: string): boolean {
  if (p_color.length === 0) return false;
  const at = p_color[0] === '#' ? 1 : 0;
  const digits = p_color.length - at;
  if (!(digits === 3 || digits === 4 || digits === 6 || digits === 8)) return false;
  return /^[0-9a-fA-F]*$/u.test(p_color.slice(at));
}

/** The named colours (`core/math/color_names.inc:49`), NAME:RRGGBBAA, in the table's order. */
const NAMED_COLORS =
  'ALICE_BLUE:F0F8FFFF ANTIQUE_WHITE:FAEBD7FF AQUA:00FFFFFF AQUAMARINE:7FFFD4FF AZURE:F0FFFFFF ' +
  'BEIGE:F5F5DCFF BISQUE:FFE4C4FF BLACK:000000FF BLANCHED_ALMOND:FFEBCDFF BLUE:0000FFFF ' +
  'BLUE_VIOLET:8A2BE2FF BROWN:A52A2AFF BURLYWOOD:DEB887FF CADET_BLUE:5F9EA0FF CHARTREUSE:7FFF00FF ' +
  'CHOCOLATE:D2691EFF CORAL:FF7F50FF CORNFLOWER_BLUE:6495EDFF CORNSILK:FFF8DCFF CRIMSON:DC143CFF ' +
  'CYAN:00FFFFFF DARK_BLUE:00008BFF DARK_CYAN:008B8BFF DARK_GOLDENROD:B8860BFF DARK_GRAY:A9A9A9FF ' +
  'DARK_GREEN:006400FF DARK_KHAKI:BDB76BFF DARK_MAGENTA:8B008BFF DARK_OLIVE_GREEN:556B2FFF ' +
  'DARK_ORANGE:FF8C00FF DARK_ORCHID:9932CCFF DARK_RED:8B0000FF DARK_SALMON:E9967AFF ' +
  'DARK_SEA_GREEN:8FBC8FFF DARK_SLATE_BLUE:483D8BFF DARK_SLATE_GRAY:2F4F4FFF ' +
  'DARK_TURQUOISE:00CED1FF DARK_VIOLET:9400D3FF DEEP_PINK:FF1493FF DEEP_SKY_BLUE:00BFFFFF ' +
  'DIM_GRAY:696969FF DODGER_BLUE:1E90FFFF FIREBRICK:B22222FF FLORAL_WHITE:FFFAF0FF ' +
  'FOREST_GREEN:228B22FF FUCHSIA:FF00FFFF GAINSBORO:DCDCDCFF GHOST_WHITE:F8F8FFFF GOLD:FFD700FF ' +
  'GOLDENROD:DAA520FF GRAY:BEBEBEFF GREEN:00FF00FF GREEN_YELLOW:ADFF2FFF HONEYDEW:F0FFF0FF ' +
  'HOT_PINK:FF69B4FF INDIAN_RED:CD5C5CFF INDIGO:4B0082FF IVORY:FFFFF0FF KHAKI:F0E68CFF ' +
  'LAVENDER:E6E6FAFF LAVENDER_BLUSH:FFF0F5FF LAWN_GREEN:7CFC00FF LEMON_CHIFFON:FFFACDFF ' +
  'LIGHT_BLUE:ADD8E6FF LIGHT_CORAL:F08080FF LIGHT_CYAN:E0FFFFFF LIGHT_GOLDENROD:FAFAD2FF ' +
  'LIGHT_GRAY:D3D3D3FF LIGHT_GREEN:90EE90FF LIGHT_PINK:FFB6C1FF LIGHT_SALMON:FFA07AFF ' +
  'LIGHT_SEA_GREEN:20B2AAFF LIGHT_SKY_BLUE:87CEFAFF LIGHT_SLATE_GRAY:778899FF ' +
  'LIGHT_STEEL_BLUE:B0C4DEFF LIGHT_YELLOW:FFFFE0FF LIME:00FF00FF LIME_GREEN:32CD32FF LINEN:FAF0E6FF ' +
  'MAGENTA:FF00FFFF MAROON:B03060FF MEDIUM_AQUAMARINE:66CDAAFF MEDIUM_BLUE:0000CDFF ' +
  'MEDIUM_ORCHID:BA55D3FF MEDIUM_PURPLE:9370DBFF MEDIUM_SEA_GREEN:3CB371FF ' +
  'MEDIUM_SLATE_BLUE:7B68EEFF MEDIUM_SPRING_GREEN:00FA9AFF MEDIUM_TURQUOISE:48D1CCFF ' +
  'MEDIUM_VIOLET_RED:C71585FF MIDNIGHT_BLUE:191970FF MINT_CREAM:F5FFFAFF MISTY_ROSE:FFE4E1FF ' +
  'MOCCASIN:FFE4B5FF NAVAJO_WHITE:FFDEADFF NAVY_BLUE:000080FF OLD_LACE:FDF5E6FF OLIVE:808000FF ' +
  'OLIVE_DRAB:6B8E23FF ORANGE:FFA500FF ORANGE_RED:FF4500FF ORCHID:DA70D6FF PALE_GOLDENROD:EEE8AAFF ' +
  'PALE_GREEN:98FB98FF PALE_TURQUOISE:AFEEEEFF PALE_VIOLET_RED:DB7093FF PAPAYA_WHIP:FFEFD5FF ' +
  'PEACH_PUFF:FFDAB9FF PERU:CD853FFF PINK:FFC0CBFF PLUM:DDA0DDFF POWDER_BLUE:B0E0E6FF ' +
  'PURPLE:A020F0FF REBECCA_PURPLE:663399FF RED:FF0000FF ROSY_BROWN:BC8F8FFF ROYAL_BLUE:4169E1FF ' +
  'SADDLE_BROWN:8B4513FF SALMON:FA8072FF SANDY_BROWN:F4A460FF SEA_GREEN:2E8B57FF SEASHELL:FFF5EEFF ' +
  'SIENNA:A0522DFF SILVER:C0C0C0FF SKY_BLUE:87CEEBFF SLATE_BLUE:6A5ACDFF SLATE_GRAY:708090FF ' +
  'SNOW:FFFAFAFF SPRING_GREEN:00FF7FFF STEEL_BLUE:4682B4FF TAN:D2B48CFF TEAL:008080FF ' +
  'THISTLE:D8BFD8FF TOMATO:FF6347FF TRANSPARENT:FFFFFF00 TURQUOISE:40E0D0FF VIOLET:EE82EEFF ' +
  'WEB_GRAY:808080FF WEB_GREEN:008000FF WEB_MAROON:800000FF WEB_PURPLE:800080FF WHEAT:F5DEB3FF ' +
  'WHITE:FFFFFFFF WHITE_SMOKE:F5F5F5FF YELLOW:FFFF00FF YELLOW_GREEN:9ACD32FF';

/** The named-colour lookup, keyed by name with its underscores removed (`core/math/color.cpp:418`). */
let namedColorIndex: Map<string, number> | undefined;

/**
 * `Color::find_named_color` (`core/math/color.cpp:412`): the name with spaces, `-`, `_`, `'` and
 * `.` removed and upper-cased, looked up among the named colours.
 */
function findNamedColor(p_name: string): number | undefined {
  if (namedColorIndex === undefined) {
    namedColorIndex = new Map();
    for (const entry of NAMED_COLORS.split(' ')) {
      const [name, code] = entry.split(':') as [string, string];
      namedColorIndex.set(name.replaceAll('_', ''), Number.parseInt(code, 16));
    }
  }
  return namedColorIndex.get(p_name.replace(/[ \-_'.]/gu, '').toUpperCase());
}

/**
 * An HTML code when `html_is_valid`, else a named colour (`Color::named`, `core/math/color.cpp:404`),
 * else `p_default`.
 *
 * @godot Color.from_string
 * @source core/math/color.cpp:450
 */
export function from_string(p_string: string, p_default: Color): Color {
  if (html_is_valid(p_string)) return html(p_string);
  const code = findNamedColor(p_string);
  return code === undefined ? p_default : hex(code);
}

/**
 * `Color::set_hsv` (`core/math/color.cpp:182`): zero saturation is grey at `v`; otherwise the hue
 * sextant picks the channel order. The Variant default for `alpha` is 1.0
 * (`core/variant/variant_call.cpp:2441`).
 *
 * @godot Color.from_hsv
 * @source core/math/color.cpp:458
 */
export function from_hsv(p_h: number, p_s: number, p_v: number, p_alpha = 1.0): Color {
  const [s, v] = [f32(p_s), f32(p_v)];
  if (s === 0) return make(v, v, v, p_alpha);
  const h = f32(f32(f32(p_h) * 6) % 6);
  const i = Math.floor(h);
  const f = f32(h - i);
  const p = f32(v * f32(1 - s));
  const q = f32(v * f32(1 - f32(s * f)));
  const t = f32(v * f32(1 - f32(s * f32(1 - f))));
  const sextants: readonly (readonly [number, number, number])[] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
  ];
  const [r, g, b] = sextants[i] ?? [v, p, q];
  return make(r, g, b, p_alpha);
}

/** `ok_color::srgb_transfer_function` (`thirdparty/misc/ok_color.h:57`). */
function okSrgbTransfer(a: number): number {
  return 0.0031308 >= a ? 12.92 * a : 1.055 * Math.pow(a, 0.4166666666666667) - 0.055;
}

/** `ok_color::oklab_to_linear_srgb` (`thirdparty/misc/ok_color.h:84`). */
function oklabToLinearSrgb(L: number, a: number, b: number): readonly [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_];
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** `ok_color::compute_max_saturation` (`thirdparty/misc/ok_color.h:104`): one Halley step on a polynomial guess. */
function okMaxSaturation(a: number, b: number): number {
  let k: readonly number[];
  let w: readonly number[];
  if (-1.88170328 * a - 0.80936493 * b > 1) {
    k = [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245];
    w = [4.0767416621, -3.3077115913, 0.2309699292];
  } else if (1.81444104 * a - 1.19445276 * b > 1) {
    k = [0.73956515, -0.45954404, 0.08285427, 0.1254107, 0.14503204];
    w = [-1.2684380046, 2.6097574011, -0.3413193965];
  } else {
    k = [1.35733652, -0.00915799, -1.1513021, -0.50559606, 0.00692167];
    w = [-0.0041960863, -0.7034186147, 1.707614701];
  }
  const [k0, k1, k2, k3, k4] = k as [number, number, number, number, number];
  const [wl, wm, ws] = w as [number, number, number];
  const S = k0 + k1 * a + k2 * b + k3 * a * a + k4 * a * b;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const [l_, m_, s_] = [1 + S * kl, 1 + S * km, 1 + S * ks];
  const f = wl * l_ * l_ * l_ + wm * m_ * m_ * m_ + ws * s_ * s_ * s_;
  const f1 = wl * 3 * kl * l_ * l_ + wm * 3 * km * m_ * m_ + ws * 3 * ks * s_ * s_;
  const f2 = wl * 6 * kl * kl * l_ + wm * 6 * km * km * m_ + ws * 6 * ks * ks * s_;
  return S - (f * f1) / (f1 * f1 - 0.5 * f * f2);
}

/** `ok_color::find_cusp` (`thirdparty/misc/ok_color.h:170`): the lightness and chroma of the hue's cusp. */
function okFindCusp(a: number, b: number): readonly [number, number] {
  const S = okMaxSaturation(a, b);
  const [r, g, bl] = oklabToLinearSrgb(1, S * a, S * b);
  const L = Math.cbrt(1 / Math.max(r, g, bl));
  return [L, L * S];
}

/** `ok_color::find_gamut_intersection` (`thirdparty/misc/ok_color.h:187`), with its one Halley step. */
function okGamutIntersection(a: number, b: number, L1: number, C1: number, L0: number, cusp: readonly [number, number]): number {
  const [cL, cC] = cusp;
  if ((L1 - L0) * cC - (cL - L0) * C1 <= 0) return (cC * L0) / (C1 * cL + cC * (L0 - L1));
  let t = (cC * (L0 - 1)) / (C1 * (cL - 1) + cC * (L0 - L1));
  const dL = L1 - L0;
  const kl = 0.3963377774 * a + 0.2158037573 * b;
  const km = -0.1055613458 * a - 0.0638541728 * b;
  const ks = -0.0894841775 * a - 1.291485548 * b;
  const [ldt, mdt, sdt] = [dL + C1 * kl, dL + C1 * km, dL + C1 * ks];
  const L = L0 * (1 - t) + t * L1;
  const C = t * C1;
  const [l_, m_, s_] = [L + C * kl, L + C * km, L + C * ks];
  const [l, m, s] = [l_ * l_ * l_, m_ * m_ * m_, s_ * s_ * s_];
  const [d1l, d1m, d1s] = [3 * ldt * l_ * l_, 3 * mdt * m_ * m_, 3 * sdt * s_ * s_];
  const [d2l, d2m, d2s] = [6 * ldt * ldt * l_, 6 * mdt * mdt * m_, 6 * sdt * sdt * s_];
  const step = (wl: number, wm: number, ws: number): number => {
    const v = wl * l + wm * m + ws * s - 1;
    const v1 = wl * d1l + wm * d1m + ws * d1s;
    const v2 = wl * d2l + wm * d2m + ws * d2s;
    const u = v1 / (v1 * v1 - 0.5 * v * v2);
    return u >= 0 ? -v * u : Number.MAX_VALUE;
  };
  t += Math.min(
    step(4.0767416621, -3.3077115913, 0.2309699292),
    step(-1.2684380046, 2.6097574011, -0.3413193965),
    step(-0.0041960863, -0.7034186147, 1.707614701),
  );
  return t;
}

/** `ok_color::toe_inv` (`thirdparty/misc/ok_color.h:411`). */
function okToeInv(x: number): number {
  const k1 = 0.206;
  const k2 = 0.03;
  const k3 = (1 + k1) / (1 + k2);
  return (x * x + k1 * x) / (k3 * (x + k2));
}

/** `ok_color::get_Cs` (`thirdparty/misc/ok_color.h:451`): the chroma at zero, mid and max saturation. */
function okChromas(L: number, a: number, b: number): readonly [number, number, number] {
  const cusp = okFindCusp(a, b);
  const cMax = okGamutIntersection(a, b, L, 1, L, cusp);
  const [stS, stT] = [cusp[1] / cusp[0], cusp[1] / (1 - cusp[0])];
  const k = cMax / Math.min(L * stS, (1 - L) * stT);
  const midS =
    0.11516993 +
    1 / (7.4477897 + 4.1590124 * b + a * (-2.19557347 + 1.75198401 * b + a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
  const midT =
    0.11239642 +
    1 / (1.6132032 - 0.68124379 * b + a * (0.40370612 + 0.90148123 * b + a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
  const [ca, cb] = [L * midS, (1 - L) * midT];
  const cMid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / (ca * ca * ca * ca) + 1 / (cb * cb * cb * cb))));
  const [c0a, c0b] = [L * 0.4, (1 - L) * 0.8];
  const c0 = Math.sqrt(1 / (1 / (c0a * c0a) + 1 / (c0b * c0b)));
  return [c0, cMid, cMax];
}

/**
 * `Color::set_ok_hsl` (`core/math/color.cpp:236`): `ok_color::okhsl_to_srgb`
 * (`thirdparty/misc/ok_color.h:484`), then clamped to 0..1. The Variant default for `alpha` is 1.0
 * (`core/variant/variant_call.cpp:2442`).
 *
 * @godot Color.from_ok_hsl
 * @source core/math/color.cpp:486
 */
export function from_ok_hsl(p_h: number, p_s: number, p_l: number, p_alpha = 1.0): Color {
  const [h, s, l] = [f32(p_h), f32(p_s), f32(p_l)];
  let rgb: readonly [number, number, number];
  if (l === 1) {
    rgb = [1, 1, 1];
  } else if (l === 0) {
    rgb = [0, 0, 0];
  } else {
    const a_ = Math.cos(2 * Math.PI * h);
    const b_ = Math.sin(2 * Math.PI * h);
    const L = okToeInv(l);
    const [c0, cMid, cMax] = okChromas(L, a_, b_);
    let chroma: number;
    if (s < 0.8) {
      const t = 1.25 * s;
      const k1 = 0.8 * c0;
      const k2 = 1 - k1 / cMid;
      chroma = (t * k1) / (1 - k2 * t);
    } else {
      const t = (s - 0.8) / (1 - 0.8);
      const k1 = ((1 - 0.8) * cMid * cMid * 1.25 * 1.25) / c0;
      const k2 = 1 - k1 / (cMax - cMid);
      chroma = cMid + (t * k1) / (1 - k2 * t);
    }
    const [r, g, b] = oklabToLinearSrgb(L, chroma * a_, chroma * b_);
    rgb = [okSrgbTransfer(r), okSrgbTransfer(g), okSrgbTransfer(b)];
  }
  return clamp(make(rgb[0], rgb[1], rgb[2], p_alpha));
}

/**
 * Three 9-bit mantissas and a 5-bit shared exponent (bias 15, 9 mantissa bits); alpha 1.
 *
 * @godot Color.from_rgbe9995
 * @source core/math/color.cpp:464
 */
export function from_rgbe9995(p_rgbe: number): Color {
  const value = p_rgbe >>> 0;
  const m = f32(Math.pow(2, (value >>> 27) - 15 - 9));
  return make(f32((value & 0x1ff) * m), f32(((value >>> 9) & 0x1ff) * m), f32(((value >>> 18) & 0x1ff) * m), 1);
}

/**
 * Each 8-bit channel divided by `255.0f`; the Variant default for `a8` is 255
 * (`core/variant/variant_call.cpp:2444`).
 *
 * @godot Color.from_rgba8
 * @source core/math/color.cpp:478
 */
export function from_rgba8(p_r8: number, p_g8: number, p_b8: number, p_a8 = 255): Color {
  const d = f32(255);
  return make(f32(p_r8 / d), f32(p_g8 / d), f32(p_b8 / d), f32(p_a8 / d));
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:552`).
 *
 * @godot Color.OP_EQUAL
 * @source core/math/color.h:75
 */
export function op_equal(left: Color, right: Color | null): boolean {
  return right !== null && left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
}

/**
 * @godot Color.OP_NOT_EQUAL
 * @source core/math/color.h:78
 */
export function op_not_equal(left: Color, right: Color | null): boolean {
  return !op_equal(left, right);
}

/**
 * `1 - c` on every channel, alpha included.
 *
 * @godot Color.OP_NEGATE
 * @source core/math/color.h:379
 */
export function op_negate(self: Color): Color {
  return make(f32(1 - self.r), f32(1 - self.g), f32(1 - self.b), f32(1 - self.a));
}

/**
 * @godot Color.OP_POSITIVE
 * @source core/variant/variant_op.cpp:478
 */
export function op_positive(self: Color): Color {
  return self;
}

/**
 * `c == Color()`, which is opaque black `(0, 0, 0, 1)`.
 *
 * @godot Color.OP_NOT
 * @source core/variant/variant_op.cpp:903
 */
export function op_not(self: Color): boolean {
  return self.r === 0 && self.g === 0 && self.b === 0 && self.a === 1;
}

/**
 * @godot Color.OP_ADD
 * @source core/math/color.h:289
 */
export function op_add(left: Color, right: Color): Color {
  return make(f32(left.r + right.r), f32(left.g + right.g), f32(left.b + right.b), f32(left.a + right.a));
}

/**
 * @godot Color.OP_SUBTRACT
 * @source core/math/color.h:304
 */
export function op_subtract(left: Color, right: Color): Color {
  return make(f32(left.r - right.r), f32(left.g - right.g), f32(left.b - right.b), f32(left.a - right.a));
}

/**
 * `Color * Color` per channel (`core/math/color.h:319`) and `Color * float` on every channel,
 * alpha included (`core/math/color.h:327`).
 *
 * @godot Color.OP_MULTIPLY
 * @source core/math/color.h:319
 */
export function op_multiply(left: Color, right: Color | number): Color {
  if (typeof right === 'number') {
    const s = f32(right);
    return make(f32(left.r * s), f32(left.g * s), f32(left.b * s), f32(left.a * s));
  }
  return make(f32(left.r * right.r), f32(left.g * right.g), f32(left.b * right.b), f32(left.a * right.a));
}

/**
 * `Color / Color` per channel (`core/math/color.h:349`) and `Color / float` (`core/math/color.h:357`);
 * registered as plain `OperatorEvaluatorDiv`, so a zero divisor follows IEEE division.
 *
 * @godot Color.OP_DIVIDE
 * @source core/math/color.h:349
 */
export function op_divide(left: Color, right: Color | number): Color {
  if (typeof right === 'number') {
    const s = f32(right);
    return make(f32(left.r / s), f32(left.g / s), f32(left.b / s), f32(left.a / s));
  }
  return make(f32(left.r / right.r), f32(left.g / right.g), f32(left.b / right.b), f32(left.a / right.a));
}

/** Whether an Array or PackedColorArray element, or a Dictionary key, is this Color. */
function isColorEqual(value: unknown, c: Color): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const other = value as Record<string, unknown>;
  return other['r'] === c.r && other['g'] === c.g && other['b'] === c.b && other['a'] === c.a;
}

/**
 * `c in array` is `array.find(c) != -1` (also for `PackedColorArray`); `c in dict` is `dict.has(c)`
 * (`core/variant/variant_op.h:1180`). A Color key is matched by value.
 *
 * @godot Color.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Color, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isColorEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isColorEqual(key, left)) return true;
  return false;
}
