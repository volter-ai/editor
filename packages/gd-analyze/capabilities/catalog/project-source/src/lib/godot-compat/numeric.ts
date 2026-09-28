/**
 * @godot-class Variant
 * @role PROTOCOL
 *
 * Godot 4.7's Variant holding an int or a float, for an untyped variable the analysis finds holding
 * both at different times (`numeric-variant`, `src/analyze/numeric-variants.ts`), at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A JS number carries no int/float type, so such a
 * variable holds this tagged number: the type Godot's Variant keeps with the value
 * (`Variant::type`, `core/variant/variant.h`). Each assignment tags the value by its analysed type;
 * each operator, `str()` or comparison on it switches over the tag at its call site and runs that
 * type's evidenced operation, so the tag never decides anything but which one.
 */

/** An int or a float and which of the two it is. */
export interface GodotNumeric {
  readonly int: boolean;
  readonly value: number;
}

/**
 * An int stored into the variable.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:2310 (Variant(int64_t) keeps type INT)
 */
export function godot_numeric_int(value: number): GodotNumeric {
  return { int: true, value };
}

/**
 * A float stored into the variable.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:2365 (Variant(double) keeps type FLOAT)
 */
export function godot_numeric_float(value: number): GodotNumeric {
  return { int: false, value };
}

/**
 * Whether the variable holds an int (`Variant::get_type() == INT`), which selects the branch.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.h:381
 */
export function godot_numeric_is_int(number: GodotNumeric): boolean {
  return number.int;
}

/**
 * The value, for the branch that knows its type.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.h:381
 */
export function godot_numeric_value(number: GodotNumeric): number {
  return number.value;
}

/**
 * The value converted into an int place (`Variant::operator int64_t`): a float truncates toward
 * zero, as the C++ cast does.
 *
 * @godot Variant (protocol)
 * @source core/variant/variant.cpp:1477
 */
export function godot_numeric_to_int(number: GodotNumeric): number {
  return number.int ? number.value : Math.trunc(number.value);
}

/**
 * `clamp(x, min, max)` where an argument is an int or a float: x, then min if x is less, then max
 * if that is greater, each kept with its own type, as the Variant it returns is one of its
 * arguments (Variant comparison of an int and a float compares their values).
 *
 * @godot Variant (protocol)
 * @source core/variant/variant_utility.cpp:730
 */
export function godot_numeric_clamp(value: GodotNumeric, min: GodotNumeric, max: GodotNumeric): GodotNumeric {
  let result = value;
  if (result.value < min.value) result = min;
  if (result.value > max.value) result = max;
  return result;
}
