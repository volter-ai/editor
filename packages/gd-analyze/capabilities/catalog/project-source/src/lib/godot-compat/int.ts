/**
 * @godot-class int
 * @role PROTOCOL
 *
 * Godot 4.7's `int` constructors (`core/variant/variant_construct.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). An int is a JS number holding an integer.
 */

/**
 * `String::to_int` (`core/string/ustring.cpp:2291`): the digits before the first `.`, every other
 * character skipped, a `-` before any digit flipping the sign (`_to_int`, `:2256`).
 */
function stringToInt(text: string): number {
  const end = text.includes('.') ? text.indexOf('.') : text.length;
  let integer = 0;
  let positive = true;
  for (const c of text.slice(0, end)) {
    if (c >= '0' && c <= '9') integer = integer * 10 + (c.charCodeAt(0) - 48);
    else if (integer === 0 && c === '-') positive = !positive;
  }
  return positive ? integer : -integer;
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:67-71`): no arguments (0); `from`
 * an int (itself), a float (truncated toward zero, as the C++ cast is), a bool (1 or 0) or a
 * String (`String::to_int`).
 *
 * @godot int.int
 * @source core/variant/variant_construct.cpp:67
 */
export function construct(...args: readonly [] | readonly [number] | readonly [boolean] | readonly [string]): number {
  if (args.length === 0) return 0;
  const [from] = args;
  if (typeof from === 'boolean') return from ? 1 : 0;
  if (typeof from === 'string') return stringToInt(from);
  return Math.trunc(from);
}
