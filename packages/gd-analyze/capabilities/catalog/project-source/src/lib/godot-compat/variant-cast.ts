import { constructColor } from './color';
import { isGodotPackedArray } from './packed-array';
import { stringToFloat, stringToInt } from './string-encoding';
import type { ColorValue, GodotDictionary } from './variant';
import {
  godotNumericVariantTag,
  godotNumericVariantValue,
  godotTaggedVariantNumber,
} from './variant-number';

export type GodotVariantBuiltinCastTarget = 'int' | 'float' | 'bool' | 'Color';

function invalidBuiltinCast(value: unknown, target: GodotVariantBuiltinCastTarget): never {
  const source =
    value === null
      ? 'Nil'
      : Array.isArray(value)
        ? 'Array'
        : value instanceof Map
          ? 'Dictionary'
          : typeof value;
  throw new TypeError(`godot-compat: invalid Variant CAST_TO_BUILTIN from ${source} to ${target}.`);
}

function isColorValue(value: unknown): value is ColorValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const color = value as Partial<ColorValue>;
  return (
    typeof color.r === 'number' &&
    typeof color.g === 'number' &&
    typeof color.b === 'number' &&
    typeof color.a === 'number'
  );
}

/**
 * Godot 4's `OPCODE_CAST_TO_BUILTIN` for the primitive/value targets whose one-argument Variant
 * constructors are retained here. The opcode calls `Variant::construct`; it is a conversion, not
 * a nullable Object cast. Unsupported source tags therefore fail loudly, while accepted source
 * tags run the same one-argument constructor conversion.
 */
export function godotVariantBuiltinCast(value: unknown, target: 'int' | 'float'): number;
export function godotVariantBuiltinCast(value: unknown, target: 'bool'): boolean;
export function godotVariantBuiltinCast(value: unknown, target: 'Color'): ColorValue;
export function godotVariantBuiltinCast(
  value: unknown,
  target: GodotVariantBuiltinCastTarget,
): number | boolean | ColorValue {
  const numeric = godotNumericVariantValue(value);
  if (target === 'bool') {
    if (typeof value === 'boolean') return value;
    if (numeric !== undefined) return numeric !== 0;
    return invalidBuiltinCast(value, target);
  }
  if (target === 'int') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (numeric !== undefined) {
      const converted = Math.trunc(numeric);
      return godotNumericVariantTag(value) === undefined
        ? converted
        : godotTaggedVariantNumber(converted, 'int');
    }
    if (typeof value === 'string') return Number(stringToInt(value));
    return invalidBuiltinCast(value, target);
  }
  if (target === 'float') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (numeric !== undefined) {
      return godotNumericVariantTag(value) === undefined
        ? numeric
        : godotTaggedVariantNumber(numeric, 'float');
    }
    if (typeof value === 'string') return stringToFloat(value);
    return invalidBuiltinCast(value, target);
  }
  if (isColorValue(value) || typeof value === 'string') return constructColor(value);
  return invalidBuiltinCast(value, target);
}

/**
 * Godot 4's runtime cast for typed Array/Dictionary annotations.
 *
 * `GDScriptByteCodeGenerator::write_cast` lowers `as Array[T]` and
 * `as Dictionary[K, V]` to `OPCODE_CAST_TO_BUILTIN` carrying only the outer Variant tag. Generic
 * arguments remain a static GDScript contract and are not encoded in the cast opcode. Preserve
 * that exact division here: validate the retained runtime representation, return its original
 * identity on success, and return null on a tag mismatch without inspecting any element.
 */
export function godotVariantContainerCast<T>(value: unknown, target: 'Array'): T[] | null;
export function godotVariantContainerCast<K, V>(
  value: unknown,
  target: 'Dictionary',
): GodotDictionary<K, V> | null;
export function godotVariantContainerCast(
  value: unknown,
  target: 'Array' | 'Dictionary',
): unknown[] | GodotDictionary | null {
  if (target === 'Array') {
    return Array.isArray(value) && !isGodotPackedArray(value) ? value : null;
  }
  return value instanceof Map ? value : null;
}
