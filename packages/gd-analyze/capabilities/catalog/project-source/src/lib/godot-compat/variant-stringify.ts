/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * Godot 4.7's `Variant::stringify` (`core/variant/variant.cpp:1597`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) for the types a translated `str()` passes, one
 * function per type: the lowering picks the function by the argument's analysed type, so no value
 * is ever classified at run time. An int is `itos`; a float `String::num_real(double, true)`; a
 * vector's components `String::num_real(float, true)` (real_t) or `itos`; a Color's
 * `String::num(component, 4)` (`core/string/ustring.cpp:1406-1617`). `String::num` formats with the
 * C library's `%.<n>lf`, which rounds the exact binary value half to even; that rounding is
 * transcribed over the double's exact decimal expansion.
 */

import type { Color } from './color';
import type { Vector2 } from './vector2';
import type { Vector2i } from './vector2i';
import type { Vector3 } from './vector3';
import type { Vector3i } from './vector3i';

const MAX_DECIMALS = 32;
const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;
const TWO_63 = 2 ** 63;

/** `%.<digits>lf` of a finite double: its exact value rounded half to even at `digits` places. */
function printfFixed(value: number, digits: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const exponentBits = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  let exponent: number;
  if (exponentBits === 0) exponent = -1074;
  else {
    mantissa |= 1n << 52n;
    exponent = exponentBits - 1075;
  }
  let numerator = mantissa * 10n ** BigInt(digits);
  let denominator = 1n;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  let quotient = numerator / denominator;
  const twice = 2n * (numerator % denominator);
  if (twice > denominator || (twice === denominator && (quotient & 1n) === 1n)) quotient += 1n;
  let text = quotient.toString();
  if (digits > 0) {
    text = text.padStart(digits + 1, '0');
    text = `${text.slice(0, -digits)}.${text.slice(-digits)}`;
  }
  return `${negative ? '-' : ''}${text}`;
}

/** `String::num` (`core/string/ustring.cpp:1406`). */
function num(value: number, decimals: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  let places = decimals;
  if (places < 0) {
    places = 14;
    const magnitude = Math.abs(value);
    if (magnitude > 10) places -= Math.floor(Math.log10(magnitude));
  }
  if (places > MAX_DECIMALS) places = MAX_DECIMALS;
  // A negative count formats as `%lf`: six places.
  const text = printfFixed(value, places < 0 ? 6 : places);
  // Trailing zeroes go, except one after the period.
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/u, '');
  return trimmed.endsWith('.') ? `${trimmed}0` : trimmed;
}

/** `(int64_t)value` as arm64 converts it (saturating), for the integral test `num_real` makes. */
function int64Of(value: number): bigint {
  if (value >= TWO_63) return INT64_MAX;
  if (value <= -TWO_63) return INT64_MIN;
  return BigInt(Math.trunc(value));
}

/** `String::num_real(double|float, true)` (`core/string/ustring.cpp:1573`, `:1597`). */
function numReal(value: number, single: boolean): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return num(value, 0);
  const integral = int64Of(value);
  const back = single ? Math.fround(Number(integral)) : Number(integral);
  if (value === back) return `${integral.toString()}.0`;
  let decimals = single ? 6 : 14;
  const magnitude = Math.abs(value);
  if (magnitude > 10) decimals -= Math.floor(single ? Math.fround(Math.log10(magnitude)) : Math.log10(magnitude));
  return num(value, decimals);
}

/**
 * An int's form: `itos`.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:1604
 */
export function godot_str_int(value: number): string {
  return BigInt(value).toString();
}

/**
 * A float's form: `String::num_real(double, true)`.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:1606
 */
export function godot_str_float(value: number): string {
  return numReal(value, false);
}

/**
 * A bool's form.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:1602
 */
export function godot_str_bool(value: boolean): string {
  return value ? 'true' : 'false';
}

/**
 * `Vector2::operator String`.
 *
 * @godot Variant (protocol)
 * @source core/math/vector2.cpp:219
 */
export function godot_str_vector2(value: Vector2): string {
  return `(${numReal(value.x, true)}, ${numReal(value.y, true)})`;
}

/**
 * `Vector2i::operator String`.
 *
 * @godot Variant (protocol)
 * @source core/math/vector2i.cpp:68
 */
export function godot_str_vector2i(value: Vector2i): string {
  return `(${godot_str_int(value.x)}, ${godot_str_int(value.y)})`;
}

/**
 * `Vector3::operator String`.
 *
 * @godot Variant (protocol)
 * @source core/math/vector3.cpp:157
 */
export function godot_str_vector3(value: Vector3): string {
  return `(${numReal(value.x, true)}, ${numReal(value.y, true)}, ${numReal(value.z, true)})`;
}

/**
 * `Vector3i::operator String`.
 *
 * @godot Variant (protocol)
 * @source core/math/vector3i.cpp:72
 */
export function godot_str_vector3i(value: Vector3i): string {
  return `(${godot_str_int(value.x)}, ${godot_str_int(value.y)}, ${godot_str_int(value.z)})`;
}

/**
 * `Color::operator String`: each component `String::num(c, 4)`.
 *
 * @godot Variant (protocol)
 * @source core/math/color.cpp:482
 */
export function godot_str_color(value: Color): string {
  return `(${num(value.r, 4)}, ${num(value.g, 4)}, ${num(value.b, 4)}, ${num(value.a, 4)})`;
}
